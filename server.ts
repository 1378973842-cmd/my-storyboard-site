import { config as loadDotenv } from "dotenv";
import { existsSync } from "fs";
import express from "express";
import Database from "better-sqlite3";
import { Agent, setGlobalDispatcher } from "undici";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

/** 从当前脚本所在目录向上查找 .env（不依赖 process.cwd，避免从别的目录启动时读不到配置） */
function loadEnvFromProject(): void {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    const envPath = path.join(dir, ".env");
    if (existsSync(envPath)) {
      // 若外部环境已存在同名变量（可能为空字符串），默认 dotenv 不会覆盖，导致读不到 .env
      loadDotenv({ path: envPath, override: true });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  loadDotenv();
}

loadEnvFromProject();

function getThirdPartyEnv(): { apiBase: string; apiKey: string } {
  let apiKey = (process.env.THIRD_PARTY_API_KEY ?? "").trim();
  // 文档要求 Header 为 Bearer sk-xxx；若 .env 里误写了前缀，避免变成 Bearer Bearer ...
  if (/^bearer\s+/i.test(apiKey)) {
    apiKey = apiKey.replace(/^bearer\s+/i, "").trim();
  }
  return {
    apiBase: (process.env.THIRD_PARTY_API_BASE ?? "").trim(),
    apiKey,
  };
}

// Increase headers timeout to 5 minutes to prevent HeadersTimeoutError from slow APIs
setGlobalDispatcher(new Agent({
  headersTimeout: 300000, // 5 minutes
  bodyTimeout: 300000,    // 5 minutes
  connectTimeout: 60000   // 1 minute
}));

function extractJSON(content: string): any {
  try {
    return JSON.parse(content);
  } catch (e) {}

  const markdownMatch = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (markdownMatch) {
    try {
      return JSON.parse(markdownMatch[1]);
    } catch (e) {}
  }

  const start = content.indexOf('{');
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < content.length; i++) {
      const char = content[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (char === '\\') {
          escape = true;
        } else if (char === '"') {
          inString = false;
        }
      } else {
        if (char === '"') {
          inString = true;
        } else if (char === '{') {
          depth++;
        } else if (char === '}') {
          depth--;
          if (depth === 0) {
            const jsonStr = content.substring(start, i + 1);
            try {
              return JSON.parse(jsonStr);
            } catch (e) {
              break;
            }
          }
        }
      }
    }
  }

  const firstBrace = content.indexOf('{');
  const lastBrace = content.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(content.substring(firstBrace, lastBrace + 1));
    } catch (e) {}
  }

  throw new Error("无法从模型响应中解析出合法的 JSON 内容");
}

/**
 * 前端上传的参考图多为 data URL；多数 OpenAI 兼容生图网关要求 `image` 为纯 base64 或公网 URL，
 * 整条 data: 字符串可能导致请求被拒或返回异常。
 */
function normalizeReferenceImageForUpstream(url: string): string {
  if (!url || typeof url !== "string") return url;
  const trimmed = url.trim();
  const m = /^data:image\/[^;]+;base64,(.+)$/is.exec(trimmed);
  if (!m) return trimmed;
  const mode = (process.env.IMAGE_GEN_REFERENCE_MODE || "base64").toLowerCase();
  if (mode === "data_url") return trimmed;
  // 默认：去掉前缀，只传 base64 正文
  return m[1].replace(/\s/g, "");
}

/** 从各兼容形态里取出可给前端的图片地址（https 或 data URL） */
function extractGeneratedImageFromResponse(responseData: any): string | null {
  if (!responseData || typeof responseData !== "object") return null;

  const isUsableUrl = (u: unknown): u is string =>
    typeof u === "string" &&
    u.length > 0 &&
    (u.startsWith("http://") || u.startsWith("https://") || u.startsWith("data:"));

  const d0 = Array.isArray(responseData.data) ? responseData.data[0] : undefined;
  const img0 = Array.isArray(responseData.images) ? responseData.images[0] : undefined;

  const directUrl =
    (d0 && isUsableUrl(d0.url) && d0.url) ||
    (img0 && isUsableUrl(img0.url) && img0.url) ||
    (isUsableUrl(responseData.url) && responseData.url) ||
    (responseData.output?.[0] && isUsableUrl(responseData.output[0].url) && responseData.output[0].url) ||
    (responseData.result && isUsableUrl(responseData.result.url) && responseData.result.url);

  if (directUrl) return directUrl;

  const b64 =
    (typeof d0?.b64_json === "string" && d0.b64_json) ||
    (typeof d0?.base64 === "string" && d0.base64) ||
    (typeof img0?.b64_json === "string" && img0.b64_json) ||
    (typeof responseData.b64_json === "string" && responseData.b64_json);

  if (b64) {
    const clean = b64.replace(/\s/g, "");
    return `data:image/png;base64,${clean}`;
  }

  return null;
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  const tp = getThirdPartyEnv();
  if (!tp.apiBase || !tp.apiKey) {
    console.warn(
      "[API] THIRD_PARTY_API_BASE / THIRD_PARTY_API_KEY 未设置。请将 .env 放在项目根目录（与 package.json 同级），并重启 npm run dev。"
    );
  }

  // Initialize Database
  const db = new Database("projects.db");
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      context TEXT,
      script TEXT,
      selectedStyle TEXT,
      imageSize TEXT,
      aspectRatio TEXT,
      references_json TEXT,
      data_json TEXT,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migration: Add context column if it doesn't exist
  try {
    db.prepare("ALTER TABLE projects ADD COLUMN context TEXT").run();
  } catch (e) {
    // Column already exists or other error
  }

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));

  // Project Management Routes
  app.get("/api/projects", (req, res) => {
    try {
      const projects = db.prepare("SELECT id, title, updatedAt FROM projects ORDER BY updatedAt DESC").all();
      res.json(projects);
    } catch (error) {
      res.status(500).json({ error: "无法获取项目列表" });
    }
  });

  app.get("/api/projects/:id", (req, res) => {
    try {
      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
      if (!project) return res.status(404).json({ error: "项目不存在" });
      
      // Parse JSON fields
      res.json({
        ...project,
        references: JSON.parse((project as any).references_json || "[]"),
        data: JSON.parse((project as any).data_json || "null")
      });
    } catch (error) {
      res.status(500).json({ error: "无法加载项目" });
    }
  });

  app.post("/api/projects", (req, res) => {
    const { id, title, context, script, selectedStyle, imageSize, aspectRatio, references, data } = req.body;
    try {
      const stmt = db.prepare(`
        INSERT INTO projects (id, title, context, script, selectedStyle, imageSize, aspectRatio, references_json, data_json, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          context = excluded.context,
          script = excluded.script,
          selectedStyle = excluded.selectedStyle,
          imageSize = excluded.imageSize,
          aspectRatio = excluded.aspectRatio,
          references_json = excluded.references_json,
          data_json = excluded.data_json,
          updatedAt = CURRENT_TIMESTAMP
      `);
      
      stmt.run(
        id, 
        title, 
        context,
        script, 
        selectedStyle, 
        imageSize, 
        aspectRatio, 
        JSON.stringify(references || []), 
        JSON.stringify(data || null)
      );
      
      res.json({ success: true });
    } catch (error) {
      console.error("Save project error:", error);
      res.status(500).json({ error: "保存项目失败" });
    }
  });

  app.delete("/api/projects/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "删除项目失败" });
    }
  });

  // Step 1: Generate Script JSON (Gemini 3.0 Pro via OpenAI Format)
  app.post("/api/generate-script", async (req, res) => {
    const { script, context, style, references } = req.body;

    const { apiBase, apiKey } = getThirdPartyEnv();

    if (!apiBase || !apiKey) {
      return res.status(400).json({ 
        error: "缺少 API 配置。请在项目根目录的 .env 中设置 THIRD_PARTY_API_BASE 和 THIRD_PARTY_API_KEY，保存后重启 npm run dev。" 
      });
    }

    // 智能处理 Base URL
    let cleanBase = apiBase.replace(/\/+$/, "");
    // 如果用户没填 /v1，且不是以 v1 结尾的，自动补全（针对 OpenAI 兼容供应商的常见习惯）
    if (!cleanBase.endsWith("/v1") && !cleanBase.includes("/v1/")) {
      cleanBase = `${cleanBase}/v1`;
    }

    const pixarInstruction = style === 'Pixar' 
      ? "\n\n## 🎨 画风特定约束\n由于当前画风是 Pixar，你必须在每个 `image_prompt` 以及 `global_assets.scenes` 的 `description` 最开头严格包含以下文字：'迪士尼皮克斯 3D 风格，8k 分辨率，极致细节，电影感照明，虚幻引擎 5 渲染质感，电影级调色。'" 
      : "";

    const imagePromptDesc = style === 'Pixar'
      ? "【字数要求：严格控制在 150-250 个汉字之间，不可少于 150 字】。必须以'迪士尼皮克斯 3D 风格，8k 分辨率，极致细节，电影感照明，虚幻引擎 5 渲染质感，电影级调色'开头。必须采用'前景/中景/背景'三层构图，通过极度细腻的材质、光影、微表情描述来扩充篇幅。明确描述每个主体的朝向、相对距离及空间坐标。精确引用参考资产。"
      : "【字数要求：严格控制在 150-250 个汉字之间，不可少于 150 字】。必须采用'前景/中景/背景'三层构图，通过极度细腻的材质、光影、环境氛围描述来扩充篇幅。明确描述每个主体的朝向、相对距离及空间坐标。精确引用参考资产，如：'前景是图1的背面视角，中景是图2的正面防守姿态'。交互动作必须描述起始前摇。";

    const systemInstruction = `
# Role: 即梦 Seedance 2.0 首席视听技术导演

## Background
你是一位拥有20年好莱坞院线经验、精通分镜脚本创作，深谙镜头语言、角色塑造、节奏控制与无缝衔接的全套导演技法。同时，你是精通“即梦（Dreamina）”生图底层逻辑以及“Seedance 2.0”多模态生成语法的【首席视听技术导演】。

## 🎬 核心创作哲学
1. 藏宝图法则：若是过场戏，用高质量的10秒长镜头带过；若是高潮重头戏，必须精细拆解。
2. 无声法则：关掉声音仅凭画面就能让观众理解故事。
3. 前置建构：必须先生成【150-250字的高定起始帧生图Prompt】，严禁少于150字，需通过增加环境细节、光影质感、角色微表情描述来确保篇幅。
4. 绝对连戏：通过全局资产设定，在后续Prompt中通过“@角色”反复调用。
5. 【核心更新：完整因果律与动作起点法则】：Seedance 2.0 具备极强的物理推演能力。对于“交互动作”（如A拍打B导致B受惊），分镜起始帧生图【必须定格在“动作开始阶段（前摇/起势）”】（如：手正伸出准备拍肩膀的过程），绝不可直接跳到动作结束的阶段。通过视频Prompt让AI推演完整物理反馈。

## 📐 空间坐标与高级语法
* 多主体深度构图（必选）：当画面涉及多个角色或物体时，必须采用“前景/中景/背景”三层构图逻辑。明确描述每个主体的朝向（正面/背面/侧面/45度侧脸）、相对距离以及在画面中的具体空间坐标。
* 机位坐标化：明确构图位置（黄金分割点/前景遮挡/对角线构图）。
* 视线矢量：描述角色双眼的“看向目标”，决定头部正确朝向与眼神交锋。
* 动作拆解：起势（特写意图/动作起点） → 过程（中景轨迹） → 落点（物理反馈）。

## 🖼️ 参考资产调用规范
用户会提供一系列【参考资产】（角色或场景），每个资产都有【编号】和【名称】。
在编写 \`image_prompt\` 和 \`video_prompt\` 时，你必须：
1. 精确引用资产：使用 "图[编号]" 的格式。例如："图1 正在..."。
2. 保持一致性：确保剧本中的角色行为与提供的参考资产类型（角色/场景）匹配。
3. 空间布局：如果同时出现多个参考资产，请明确它们在画面中的相对位置（如：图1在左侧，图2在背景）。

---
## 🔴 绝对输出约束 (CRITICAL: JSON ONLY)
用户会向你发送【画风基调】、【剧本大纲】以及【参考资产列表】。你必须且只能返回一个合法的 JSON 对象，绝对不要包含任何 Markdown 代码块（如 \`\`\`json）或解释性文本。前端程序将直接解析你的输出。

你的 JSON 必须严格遵循以下结构：
{
  "global_assets": {
    "scenes": [{"description": "@资产1_核心场景空镜：[必须包含：核心场景的详细环境描述，用于生成空镜，不含人物。如果画风是 Pixar，必须以'迪士尼皮克斯 3D 风格，8k 分辨率，极致细节，电影感照明，虚幻引擎 5 渲染质感，电影级调色。'开头]", "image_url": ""}]
  },
  "storyboards": [
    {
      "shot_number": "镜头 01",
      "summary": "一句话概括画面",
      "director_notes": "导演思路，分析空间过渡、景别设计、动作起点的因果逻辑。",
      "image_prompt": "${imagePromptDesc}",
      "video_prompt": "@图01_分镜作为首帧画面，以 图[编号] 为形象参考。[主体]在[场景]中[顺着起始帧完成连贯的具体动作]。[明确运镜方向，如固定镜头捕捉物理反馈]。"
    }
  ],
  "qa_check": [
    "静音理解度：是否达标...",
    "参考资产引用：是否精确使用了用户提供的资产编号...",
    "动作因果律：动作起始帧是否保留了完整的剧情因果律..."
  ]
}

${pixarInstruction}
当前画风基调设定：${style}`;

    try {
      const response = await fetch(`${cleanBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: process.env.TEXT_MODEL || "gemini-3-pro-preview",
          messages: [
            { role: "system", content: systemInstruction },
            { 
              role: "user", 
              content: `前情提要（全局设定）：${context || '无'}\n\n剧本大纲：${script}\n\n参考资产列表：\n${references && references.length > 0 
                ? references.map((r: any) => `- 图${r.index} (${r.name}): ${r.type === 'character' ? '角色' : '场景'}`).join('\n') 
                : '无'}` 
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.7
        })
      });

      const contentType = response.headers.get("content-type");
      
      if (!response.ok) {
        if (contentType && contentType.includes("application/json")) {
          const errorData = await response.json();
          return res.status(response.status).json({ 
            error: errorData.error?.message || `API 错误 (${response.status}): ${response.statusText}` 
          });
        } else {
          const errorText = await response.text();
          return res.status(response.status).json({ 
            error: `API 返回了非 JSON 响应 (可能是 HTML 错误页)。状态码: ${response.status}。内容摘要: ${errorText.slice(0, 100)}...` 
          });
        }
      }

      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        throw new Error(`预期返回 JSON 但收到了: ${text.slice(0, 100)}...`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      
      const parsedJSON = extractJSON(content);
      res.json(parsedJSON);
    } catch (error) {
      console.error("Script generation error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "服务器内部错误" });
    }
  });

  // Step 1.2: Generate Scene Description
  app.post("/api/generate-scene-description", async (req, res) => {
    const { script, context, style, index } = req.body;

    const { apiBase, apiKey } = getThirdPartyEnv();

    if (!apiBase || !apiKey) {
      return res.status(400).json({ error: "缺少 API 配置。" });
    }

    let cleanBase = apiBase.replace(/\/+$/, "");
    if (!cleanBase.endsWith("/v1") && !cleanBase.includes("/v1/")) {
      cleanBase = `${cleanBase}/v1`;
    }

    const pixarInstruction = style === 'Pixar' 
      ? "\n\n## 🎨 画风特定约束\n由于当前画风是 Pixar，你必须在 `description` 的最开头严格包含以下文字：'迪士尼皮克斯 3D 风格，8k 分辨率，极致细节，电影感照明，虚幻引擎 5 渲染质感，电影级调色。'" 
      : "";

    const systemInstruction = `
# Role: 即梦 Seedance 2.0 首席视听技术导演

你现在需要为剧本中的一个核心场景重新生成环境描述。
你必须且只能返回一个合法的 JSON 对象。

你的 JSON 必须严格遵循以下结构：
{
  "description": "@资产${index + 1}_核心场景空境：[必须包含：核心场景的详细环境描述，用于生成空镜，不含人物]"
}

${pixarInstruction}
当前画风基调设定：${style}`;

    try {
      const response = await fetch(`${cleanBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: process.env.TEXT_MODEL || "gemini-3-pro-preview",
          messages: [
            { role: "system", content: systemInstruction },
            { 
              role: "user", 
              content: `前情提要（全局设定）：${context || '无'}\n\n剧本大纲：${script}\n\n请重新生成场景 ${index + 1} 的描述。` 
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.8
        })
      });

      if (!response.ok) {
        throw new Error(`API 错误: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      res.json(extractJSON(content));
    } catch (error) {
      console.error("Generate scene description error:", error);
      res.status(500).json({ error: "重新生成描述失败" });
    }
  });

  // Step 1.5: Regenerate a single shot
  app.post("/api/regenerate-shot", async (req, res) => {
    const { script, context, style, references, shot_summary, shot_number } = req.body;

    const { apiBase, apiKey } = getThirdPartyEnv();

    if (!apiBase || !apiKey) {
      return res.status(400).json({ error: "缺少 API 配置。" });
    }

    let cleanBase = apiBase.replace(/\/+$/, "");
    if (!cleanBase.endsWith("/v1") && !cleanBase.includes("/v1/")) {
      cleanBase = `${cleanBase}/v1`;
    }

    const pixarInstruction = style === 'Pixar' 
      ? "\n\n## 🎨 画风特定约束\n由于当前画风是 Pixar，你必须在 `image_prompt` 的最开头严格包含以下文字：'迪士尼皮克斯 3D 风格，8k 分辨率，极致细节，电影感照明，虚幻引擎 5 渲染质感，电影级调色。'" 
      : "";

    const imagePromptDesc = style === 'Pixar'
      ? "【字数要求：严格控制在 150-250 个汉字之间，不可少于 150 字】。必须以'迪士尼皮克斯 3D 风格，8k 分辨率，极致细节，电影感照明，虚幻引擎 5 渲染质感，电影级调色'开头。必须采用'前景/中景/背景'三层构图，通过极度细腻的材质、光影、微表情描述来扩充篇幅。明确描述每个主体的朝向、相对距离及空间坐标。精确引用参考资产。"
      : "【字数要求：严格控制在 150-250 个汉字之间，不可少于 150 字】。必须采用'前景/中景/背景'三层构图，通过极度细腻的材质、光影、环境氛围描述来扩充篇幅。明确描述每个主体的朝向、相对距离及空间坐标。精确引用参考资产，如：'前景是图1的背面视角，中景是图2的正面防守姿态'。";

    const systemInstruction = `
# Role: 即梦 Seedance 2.0 首席视听技术导演

你现在需要为剧本中的一个特定分镜重新生成导演描述和提示词。
你必须且只能返回一个合法的 JSON 对象，包含单个分镜的信息。

你的 JSON 必须严格遵循以下结构：
{
  "shot_number": "${shot_number}",
  "summary": "一句话概括画面",
  "director_notes": "导演思路...",
  "image_prompt": "${imagePromptDesc}",
  "video_prompt": "@图[编号]_分镜作为首帧画面..."
}

${pixarInstruction}
当前画风基调设定：${style}
参考资产引用规范：仅使用 "图[编号]" 格式。`;

    try {
      const response = await fetch(`${cleanBase}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: process.env.TEXT_MODEL || "gemini-3-pro-preview",
          messages: [
            { role: "system", content: systemInstruction },
            { 
              role: "user", 
              content: `前情提要（全局设定）：${context || '无'}\n\n剧本背景：${script}\n需要重新生成的镜头描述：${shot_summary}\n\n参考资产列表：\n${references && references.length > 0 
                ? references.map((r: any) => `- 图${r.index} (${r.name}): ${r.type === 'character' ? '角色' : '场景'}`).join('\n') 
                : '无'}` 
            }
          ],
          response_format: { type: "json_object" },
          temperature: 0.9
        })
      });

      if (!response.ok) {
        throw new Error(`API 错误: ${response.status}`);
      }

      const data = await response.json();
      const content = data.choices[0].message.content;
      res.json(extractJSON(content));
    } catch (error) {
      console.error("Regenerate shot error:", error);
      res.status(500).json({ error: "重新生成失败" });
    }
  });

  // Step 2: Generate Image (Third-party API)
  app.post("/api/generate-image", async (req, res) => {
    const { prompt, image_size, aspect_ratio, references } = req.body;
    console.log("Received image generation request:", { prompt, image_size, aspect_ratio });
    const { apiBase, apiKey } = getThirdPartyEnv();

    if (!apiBase || !apiKey) {
      return res.status(400).json({ error: "缺少 API 配置。请在项目根目录的 .env 中设置 THIRD_PARTY_API_BASE 和 THIRD_PARTY_API_KEY，保存后重启 npm run dev。" });
    }

    // 智能处理 Base URL
    let cleanBase = apiBase.replace(/\/+$/, "");
    if (!cleanBase.startsWith("http://") && !cleanBase.startsWith("https://")) {
      cleanBase = `https://${cleanBase}`;
    }
    if (!cleanBase.endsWith("/v1") && !cleanBase.includes("/v1/")) {
      cleanBase = `${cleanBase}/v1`;
    }

    // 增强提示词以包含参考信息（保留文字描述作为辅助）
    let enhancedPrompt = prompt;
    if (references && Array.isArray(references) && references.length > 0) {
      const refNames = references.map(r => r.name).join(", ");
      enhancedPrompt = `${prompt}\n\n[Reference Assets: ${refNames}]`;
    }

    try {
      console.log(`Calling image generation API: ${cleanBase}/images/generations`);
      
      // 构造请求体，严格遵循用户提供的 OpenAPI 规范
      const modelName = process.env.IMAGE_MODEL || "gemini-3.1-flash-image-preview-2k";
      const requestBody: any = {
        model: modelName,
        prompt: enhancedPrompt,
        response_format: "url",
        aspect_ratio: aspect_ratio || "16:9"
      };

      // 供应商文档：image_size 仅 nano-banana-2 系列支持；后台模型名可能带后缀
      if (/nano-banana-2/i.test(modelName)) {
        requestBody.image_size = image_size || "4K";
      }

      // 根据规范，参考图字段名为 'image'，且为字符串数组（公网 URL 或 base64）
      if (references && Array.isArray(references) && references.length > 0) {
        const imagePayload = references
          .map((r: { url?: string }) => r?.url)
          .filter((u: string | undefined): u is string => typeof u === "string" && u.length > 0)
          .map(normalizeReferenceImageForUpstream);
        if (imagePayload.length > 0) {
          requestBody.image = imagePayload;
        }
      }

      let response;
      let retries = 3;
      let lastError = null;

      while (retries > 0) {
        try {
          response = await fetch(`${cleanBase}/images/generations`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody)
          });

          if (response.ok) {
            break; // Success, exit retry loop
          }

          // If not 502/503/504, don't retry, just break and handle error
          if (![502, 503, 504].includes(response.status)) {
            break;
          }

          console.warn(`API returned ${response.status}, retrying... (${retries} left)`);
        } catch (err) {
          lastError = err;
          console.warn(`Network error, retrying... (${retries} left)`, err);
        }
        
        retries--;
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds before retry
        }
      }

      if (!response) {
        throw lastError || new Error("请求失败，已达到最大重试次数");
      }

      const contentType = response.headers.get("content-type");
      let responseData: any;

      if (contentType && contentType.includes("application/json")) {
        responseData = await response.json();
      } else {
        responseData = await response.text();
      }

      if (!response.ok) {
        console.error("API Error Response Status:", response.status);
        console.error("API Error Response Headers:", Object.fromEntries(response.headers.entries()));
        console.error("API Error Response Body:", responseData);
        let errorMessage = `生图 API 错误 (${response.status}): `;
        if (typeof responseData === 'object') {
          errorMessage += responseData.error?.message || responseData.message || JSON.stringify(responseData);
        } else {
          errorMessage += responseData ? responseData.slice(0, 500) : "无响应内容 (可能是网关超时或代理错误)";
        }
        throw new Error(errorMessage);
      }

      const imageUrl = extractGeneratedImageFromResponse(responseData);

      if (imageUrl) {
        res.json({ url: imageUrl });
      } else {
        console.error("API response missing image url/b64:", JSON.stringify(responseData).slice(0, 2000));
        res.status(500).json({
          error:
            "API 响应中未解析到图片（无 url 或 b64_json）。请检查生图模型、参考图格式；若必须用完整 data URL 传参考图，可在 .env 设置 IMAGE_GEN_REFERENCE_MODE=data_url 后重启服务。",
        });
      }
    } catch (error) {
      console.error("Image generation error details:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "生图失败，请检查 API 配置或网络" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
