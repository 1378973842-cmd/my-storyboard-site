import { config as loadDotenv } from "dotenv";
import { existsSync, readFileSync } from "fs";
import express from "express";
import Database from "better-sqlite3";
import { Agent, setGlobalDispatcher, FormData } from "undici";
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

function getGridEnv(): { apiBase: string; apiKey: string } {
  const base = (process.env.IMAGE_GRID_API_BASE ?? process.env.THIRD_PARTY_API_BASE ?? "").trim();
  let key = (process.env.IMAGE_GRID_API_KEY ?? process.env.THIRD_PARTY_API_KEY ?? "").trim();
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  return { apiBase: base, apiKey: key };
}

function readPromptFile(relativePath: string): string {
  try {
    const baseDir = path.dirname(fileURLToPath(import.meta.url));
    const full = path.join(baseDir, relativePath);
    return readFileSync(full, "utf8");
  } catch (e) {
    return "";
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isUpstreamOverloaded(status: number, payload: any): boolean {
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const msg =
    (typeof payload === "object" && payload
      ? payload.error?.message || payload.message || JSON.stringify(payload)
      : String(payload || "")
    ).toLowerCase();
  return msg.includes("负载") || msg.includes("饱和") || msg.includes("rate") || msg.includes("too many") || msg.includes("overload");
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

function guessExtFromMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  return "png";
}

async function imageInputToBlob(input: string): Promise<{ blob: globalThis.Blob; filename: string }> {
  const trimmed = input.trim();
  const dataUrlMatch = /^data:(image\/[^;]+);base64,(.+)$/is.exec(trimmed);
  if (dataUrlMatch) {
    const mime = dataUrlMatch[1];
    const b64 = dataUrlMatch[2].replace(/\s/g, "");
    const buf = Buffer.from(b64, "base64");
    const blob = new Blob([buf], { type: mime });
    return { blob, filename: `upload.${guessExtFromMime(mime)}` };
  }

  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const resp = await fetch(trimmed);
    if (!resp.ok) throw new Error(`拉取图片失败 (${resp.status})`);
    const mime = resp.headers.get("content-type") || "image/png";
    const ab = await resp.arrayBuffer();
    const blob = new Blob([ab], { type: mime });
    return { blob, filename: `remote.${guessExtFromMime(mime)}` };
  }

  // Some gateways accept raw base64. We treat it as png bytes.
  if (/^[a-z0-9+/=\r\n]+$/i.test(trimmed) && trimmed.length > 200) {
    const buf = Buffer.from(trimmed.replace(/\s/g, ""), "base64");
    const blob = new Blob([buf], { type: "image/png" });
    return { blob, filename: "base64.png" };
  }

  throw new Error("不支持的图片输入格式（需要 dataURL / http(s) URL / base64）");
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

    // 不要“无条件”把 reference 名字/图片喂给生图接口。
    // 只有当 prompt 中出现了明确的 `图1 / 图[1] / 图 1` 引用标记时，
    // 才将 references 图片随请求一并传入，避免“没提参考图却被参考图影响”的错误行为。
    const enhancedPrompt = prompt;

    const extractCitedReferenceIndices = (
      text: string,
      maxReferences: number
    ): number[] => {
      // 支持：图1 / 图[1] / 图 01 / @图1 / @资产2
      const re = /(?:@资产|@图|图)\s*\[?\s*(\d{1,3})\s*\]?/gu;
      const out = new Set<number>();
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const n = Number.parseInt(m[1], 10);
        if (!Number.isFinite(n)) continue;
        if (n <= 0) continue;
        const idx = n - 1;
        if (idx >= 0 && idx < maxReferences) out.add(idx);
      }
      return Array.from(out);
    };

    const citedRefIndices =
      typeof prompt === "string" && Array.isArray(references)
        ? extractCitedReferenceIndices(prompt, references.length)
        : [];

    try {
      console.log(`Calling image generation API: ${cleanBase}/images/generations`);
      const timeoutMs = Number(process.env.IMAGE_API_TIMEOUT_MS || 60000);
      
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
      // 仅当 prompt 已明确引用且引用编号有效时才传入 images，保证“引用缺失 -> 不使用参考图”
      if (citedRefIndices.length > 0 && references && Array.isArray(references) && references.length > 0) {
        const imagePayload = citedRefIndices
          .map((idx) => references[idx])
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
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(new Error(`IMAGE_API_TIMEOUT_${timeoutMs}ms`)), timeoutMs);
          response = await fetch(`${cleanBase}/images/generations`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(requestBody),
            signal: ctrl.signal,
          });
          clearTimeout(timer);

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

  // Step 2.2: Generate 3x3 storyboard grid (script -> 9 prompts -> one 3x3 image)
  app.post("/api/generate-9grid", async (req, res) => {
    const { story, references, mode, imagePrompt: imagePromptInput } = req.body as {
      story?: string;
      references?: Array<{ url?: string; name?: string } | string>;
      mode?: "prompts_only" | "image_only" | "full";
      imagePrompt?: string;
    };
    const runMode = mode || "full";

    const { apiBase: textApiBase, apiKey: textApiKey } = getThirdPartyEnv();
    const { apiBase: gridApiBase, apiKey: gridApiKey } = getGridEnv();

    if ((runMode === "prompts_only" || runMode === "full") && (!textApiBase || !textApiKey)) {
      return res.status(400).json({
        error:
          "缺少文本模型 API 配置。请在项目根目录的 .env 中设置 THIRD_PARTY_API_BASE 与 THIRD_PARTY_API_KEY，保存后重启 npm run dev。",
      });
    }

    if ((runMode === "image_only" || runMode === "full") && (!gridApiBase || !gridApiKey)) {
      return res.status(400).json({
        error:
          "缺少 9 宫格生图 API 配置。请在项目根目录的 .env 中设置 IMAGE_GRID_API_BASE（可选）与 IMAGE_GRID_API_KEY（必填），保存后重启 npm run dev。",
      });
    }

    if ((runMode === "prompts_only" || runMode === "full") && (typeof story !== "string" || story.trim().length < 10)) {
      return res.status(400).json({ error: "请先输入剧本故事（至少 10 个字符）" });
    }

    let cleanTextBase = textApiBase.replace(/\/+$/, "");
    if (!cleanTextBase.startsWith("http://") && !cleanTextBase.startsWith("https://")) {
      cleanTextBase = `https://${cleanTextBase}`;
    }
    if (!cleanTextBase.endsWith("/v1") && !cleanTextBase.includes("/v1/")) {
      cleanTextBase = `${cleanTextBase}/v1`;
    }

    let cleanGridBase = gridApiBase.replace(/\/+$/, "");
    if (!cleanGridBase.startsWith("http://") && !cleanGridBase.startsWith("https://")) {
      cleanGridBase = `https://${cleanGridBase}`;
    }
    if (!cleanGridBase.endsWith("/v1") && !cleanGridBase.includes("/v1/")) {
      cleanGridBase = `${cleanGridBase}/v1`;
    }

    const refItems = Array.isArray(references)
      ? references
          .map((r: any, idx: number) => {
            if (typeof r === "string") return { url: r, name: `角色${String(idx + 1).padStart(2, "0")}` };
            return {
              url: String(r?.url || "").trim(),
              name: String(r?.name || "").trim() || `角色${String(idx + 1).padStart(2, "0")}`,
            };
          })
          .filter((r: { url: string }) => r.url.length > 0)
      : [];
    const refUrls = refItems.map((r) => r.url);

    const systemBase = readPromptFile("./prompts/nine_grid_system_prompt.txt");
    const systemInstruction =
      `${systemBase}\n\n` +
      `【额外强制输出约束】你必须且只能输出一个合法 JSON，对象结构必须为：\n` +
      `{\n  "shots": [\n    { "n": 1, "specs": "...", "prompt": "..." },\n    ...,\n    { "n": 9, "specs": "...", "prompt": "..." }\n  ]\n}\n` +
      `要求：shots 长度必须为 9；prompt 为可直接用于文生图的纯中文长句/段落，不要包含任何 Markdown 代码块。`;

    try {
      let shots: any[] = [];
      let imagePrompt = String(imagePromptInput || "").trim();

      if (runMode === "prompts_only" || runMode === "full") {
        // Phase A: text model -> 9 shot prompts
        const citedRefsText =
          refItems.length > 0
            ? refItems
                .map((r, i) => `- 图${i + 1}（${r.name}）：参考图（按上传顺序，人物/场景名称已标注）`)
                .join("\n")
            : "无";

        const textReqBody = {
          model: process.env.TEXT_MODEL || "gemini-3-pro-preview",
          messages: [
            { role: "system", content: systemInstruction },
            {
              role: "user",
              content: `剧本故事：\n${story}\n\n参考图列表（按顺序，用户会用“图1/图2/...”指代）：\n${citedRefsText}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        };

        const maxRetries = Number(process.env.TEXT_API_RETRIES || 4);
        const baseDelayMs = Number(process.env.TEXT_API_RETRY_BASE_DELAY_MS || 1200);
        const textTimeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 60000);

        let textPayload: any = null;
        let lastStatus = 0;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(
              () => ctrl.abort(new Error(`TEXT_API_TIMEOUT_${textTimeoutMs}ms`)),
              textTimeoutMs
            );

            const textRes = await fetch(`${cleanTextBase}/chat/completions`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${textApiKey}`,
              },
              body: JSON.stringify(textReqBody),
              signal: ctrl.signal,
            });
            clearTimeout(timer);

            lastStatus = textRes.status;
            const raw = await textRes.text().catch(() => "");
            textPayload = (() => {
              try {
                return raw ? JSON.parse(raw) : {};
              } catch {
                return { error: { message: raw.slice(0, 500) } };
              }
            })();

            if (textRes.ok) break;

            if (!isUpstreamOverloaded(textRes.status, textPayload) || attempt === maxRetries) {
              const msg =
                textPayload?.error?.message || textPayload?.message || JSON.stringify(textPayload).slice(0, 500);
              return res.status(500).json({
                error: `分镜提示词生成失败：${msg}`,
                meta: { status: textRes.status, attempt, maxRetries },
              });
            }

            const jitter = Math.floor(Math.random() * 260);
            const delay = Math.min(12000, baseDelayMs * Math.pow(2, attempt) + jitter);
            console.warn("[9grid] text upstream overloaded, retrying...", {
              status: textRes.status,
              attempt,
              delay,
            });
            await sleep(delay);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            const jitter = Math.floor(Math.random() * 260);
            const delay = Math.min(12000, baseDelayMs * Math.pow(2, attempt) + jitter);

            if (attempt === maxRetries) {
              return res.status(500).json({
                error: `分镜提示词生成失败：${msg}`,
                meta: { status: lastStatus || 0, attempt, maxRetries },
              });
            }

            console.warn("[9grid] text fetch error, retrying...", { msg, attempt, delay });
            await sleep(delay);
            continue;
          }
        }

        const content = textPayload?.choices?.[0]?.message?.content || "";
        const parsed = extractJSON(String(content));
        shots = Array.isArray(parsed?.shots) ? parsed.shots : [];
        if (shots.length !== 9) {
          return res.status(500).json({ error: `分镜提示词生成失败：shots 数量不是 9（得到 ${shots.length}）` });
        }

        const shotLines = shots
          .map((s: any, idx: number) => {
            const n = Number(s?.n || idx + 1);
            const p = String(s?.prompt || "").trim();
            return `格子${n}：${p}`;
          })
          .join("\n");

      const gridPrefix =
        `在3X3网格中生成9个连贯分镜，固定版式为“从左到右、从上到下 1-9 顺序”。` +
        `每个格子严格为16:9横屏，整体大图严格为16:9。` +
        `九格必须无任何分隔线、无边框、无留白、无黑边、无白边、无拼接缝；` +
        `九格彼此紧贴，像一张完整画布被分为九个镜头。` +
        `以参考图为主体，保持环境空间布局一致、人物与物品相对位置合理，并通过不同角度推进剧情连贯发展。` +
        `全图要求4K极致分辨率、超高清细节、电影级质感、风格高度一致。` +
        `负向约束：禁止任何文字元素、禁止字幕、禁止对白台词字卡、禁止标题字、禁止 logo、禁止水印、禁止网格线、禁止边框、禁止任何装饰性分割元素。` +
        `如果模型倾向添加文字，必须改为纯画面表达，画面中不得出现可读字符。` +
        ` "image_generation_model": "gemini-3.1-flash-image-preview-4k", "grid_layout": "3x3", "grid_aspect_ratio": "16:9"。\n`;

        const refMapLines =
          refItems.length > 0
            ? refItems.map((r, i) => `图${i + 1}（${r.name}）`).join("、")
            : "无";
        imagePrompt = `${gridPrefix}\n参考图命名映射：${refMapLines}\n九宫格内容要求（从左到右、从上到下对应1-9）：\n${shotLines}`;
        if (runMode === "prompts_only") {
          return res.json({ shots, imagePrompt });
        }
      }

      if (!imagePrompt) {
        return res.status(400).json({ error: "缺少 imagePrompt" });
      }

      // Phase B: image model -> one grid image
      const modelName = (process.env.IMAGE_GRID_MODEL || "gemini-3.1-flash-image-preview-4k").trim();
      const timeoutMs = Number(process.env.IMAGE_API_TIMEOUT_MS || 180000);
      if (refUrls.length === 0) {
        return res.status(400).json({ error: "请至少上传 1 张参考图（图1）用于九宫格生成" });
      }

      // 网关文档显示 4K 模型使用 /images/edits 且必须 multipart/form-data 传 file
      const blobs = await Promise.all(refUrls.map(imageInputToBlob));
      const form = new FormData();
      form.set("model", modelName);
      form.set("prompt", imagePrompt);
      form.set("response_format", "url");
      form.set("aspect_ratio", "16:9");
      form.set("image_size", "4K");
      for (const b of blobs) {
        form.append("image", b.blob, b.filename);
      }

      const imageRetries = Number(process.env.IMAGE_API_RETRIES || 2);
      const imageRetryBaseMs = Number(process.env.IMAGE_API_RETRY_BASE_DELAY_MS || 2200);
      let imgPayload: any = null;
      let imgStatus = 0;

      for (let attempt = 0; attempt <= imageRetries; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(new Error(`IMAGE_API_TIMEOUT_${timeoutMs}ms`)), timeoutMs);
        try {
          const imgRes = await fetch(`${cleanGridBase}/images/edits`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${gridApiKey}`,
            },
            body: form as any,
            signal: ctrl.signal,
          });
          clearTimeout(timer);

          imgStatus = imgRes.status;
          const contentType = imgRes.headers.get("content-type");
          imgPayload = contentType && contentType.includes("application/json") ? await imgRes.json() : await imgRes.text();

          if (imgRes.ok) break;

          // 仅对可恢复错误自动重试：网关抖动/上游拥塞
          const retryable = [502, 503, 504, 429].includes(imgRes.status) || isUpstreamOverloaded(imgRes.status, imgPayload);
          if (!retryable || attempt === imageRetries) {
            const detail =
              typeof imgPayload === "object"
                ? imgPayload.error?.message || imgPayload.message || JSON.stringify(imgPayload)
                : String(imgPayload || "").slice(0, 500);
            return res.status(500).json({ error: `九宫格生图失败 (${imgRes.status})：${detail}` });
          }

          const jitter = Math.floor(Math.random() * 300);
          const delay = Math.min(18000, imageRetryBaseMs * Math.pow(2, attempt) + jitter);
          console.warn("[9grid] image upstream unstable, retrying...", { status: imgRes.status, attempt, delay });
          await sleep(delay);
        } catch (err) {
          clearTimeout(timer);
          const msg = err instanceof Error ? err.message : String(err);
          if (attempt === imageRetries) {
            return res.status(500).json({ error: `九宫格生图失败：${msg}` });
          }
          const jitter = Math.floor(Math.random() * 300);
          const delay = Math.min(18000, imageRetryBaseMs * Math.pow(2, attempt) + jitter);
          console.warn("[9grid] image fetch error, retrying...", { msg, attempt, delay });
          await sleep(delay);
        }
      }

      if (!imgPayload || imgStatus === 0) {
        return res.status(500).json({ error: "九宫格生图失败：上游无有效响应" });
      }

      const url = extractGeneratedImageFromResponse(imgPayload);
      if (!url) {
        return res.status(500).json({ error: "九宫格生图失败：未解析到图片 url/b64_json" });
      }

      return res.json({ url, shots });
    } catch (e) {
      console.error("Generate 9-grid error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "九宫格生成失败" });
    }
  });

  // Step 2.1: Edit Image (Third-party API)
  app.post("/api/edit-image", async (req, res) => {
    const { prompt, target_image, references, images, image_size, aspect_ratio } = req.body;
    console.log("Received image edit request:", {
      prompt_preview: typeof prompt === "string" ? prompt.slice(0, 80) : "",
      has_target: typeof target_image === "string" && target_image.length > 0,
      references_count: Array.isArray(references) ? references.length : 0,
      images_count: Array.isArray(images) ? images.length : 0,
      image_size,
      aspect_ratio,
    });
    const { apiBase, apiKey } = getThirdPartyEnv();

    if (!apiBase || !apiKey) {
      return res.status(400).json({
        error:
          "缺少 API 配置。请在项目根目录的 .env 中设置 THIRD_PARTY_API_BASE 和 THIRD_PARTY_API_KEY，保存后重启 npm run dev。",
      });
    }

    let cleanBase = apiBase.replace(/\/+$/, "");
    if (!cleanBase.startsWith("http://") && !cleanBase.startsWith("https://")) {
      cleanBase = `https://${cleanBase}`;
    }
    if (!cleanBase.endsWith("/v1") && !cleanBase.includes("/v1/")) {
      cleanBase = `${cleanBase}/v1`;
    }

    if (typeof prompt !== "string" || prompt.trim().length === 0) {
      return res.status(400).json({ error: "缺少 prompt" });
    }

    const refUrlsFromLegacy = Array.isArray(references)
      ? references
          .map((r: { url?: string } | string) => (typeof r === "string" ? r : r?.url))
          .filter((u: unknown): u is string => typeof u === "string" && u.trim().length > 0)
      : [];

    let orderedImageUrls: string[] = [];
    if (Array.isArray(images) && images.length > 0) {
      orderedImageUrls = images
        .map((x: unknown) => (typeof x === "string" ? x : (x as { url?: string })?.url))
        .filter((u): u is string => typeof u === "string" && u.trim().length > 0);
    } else if (typeof target_image === "string" && target_image.trim().length > 0) {
      orderedImageUrls = [target_image.trim(), ...refUrlsFromLegacy];
    }

    if (orderedImageUrls.length === 0) {
      return res.status(400).json({
        error: "缺少图片：请传 images（按顺序的 url 数组），或传 target_image（可与 references 搭配）",
      });
    }

    try {
      const baseTimeoutMs = Number(process.env.IMAGE_API_TIMEOUT_MS || 60000);

      // 上传侧（data URL）payload 往往更大，上游处理更慢；
      // 对 data URL 自动放宽超时，避免只因为“慢”就触发连续失败链。
      const anyDataUrl = orderedImageUrls.some((u) => u.trim().startsWith("data:image/"));

      const timeoutMs = anyDataUrl ? Math.max(baseTimeoutMs, 180000) : baseTimeoutMs;

      const envCandidates = [String(process.env.IMAGE_EDIT_MODEL || "").trim(), String(process.env.IMAGE_MODEL || "").trim()].filter(
        (x) => x.length > 0
      );

      // 只使用 .env 指定模型：避免 token 对硬编码候选不具备权限（403），导致“全失败”。
      const modelCandidates = Array.from(new Set(envCandidates.length ? envCandidates : ["gemini-3.1-flash-image-preview-2k"]));

      console.log("[edit-image] modelCandidates:", modelCandidates, "timeoutMs:", timeoutMs, "imageCount:", orderedImageUrls.length);

      const imageBlobs = await Promise.all(orderedImageUrls.map((u) => imageInputToBlob(u)));

      const orderHint =
        "【多图顺序】以下请求附件中的图片按先后顺序依次为图1、图2、图3…（仅为编号，不预设哪一张必须被编辑、哪一张只能作参考）。具体要参照哪张、修改或融合哪张，完全以用户下文为准。\n\n";
      const fullPrompt = orderHint + String(prompt).trim();

      const buildForm = (modelName: string) => {
        const form = new FormData();
        form.set("model", modelName);
        form.set("prompt", fullPrompt);
        form.set("response_format", "url");
        if (aspect_ratio) form.set("aspect_ratio", String(aspect_ratio));
        // 对 /images/edits：image_size 在网关侧是可用参数，且未传时会有默认（截图显示默认 4K）。
        // 为了避免编辑在错误分辨率下更慢导致超时：只要前端传了就直接透传。
        if (image_size) form.set("image_size", String(image_size));
        for (const b of imageBlobs) {
          form.append("image", b.blob, b.filename);
        }
        return form;
      };

      // 对编辑请求优先只走 /images/edits，避免 /images/generations 走到网关默认模型导致 403
      const endpoints = ["/images/edits"];
      const errors: string[] = [];

      for (const modelName of modelCandidates) {
        for (const endpoint of endpoints) {
          const ctrl = new AbortController();
          const timer = setTimeout(
            () => ctrl.abort(new Error(`IMAGE_API_TIMEOUT_${timeoutMs}ms`)),
            timeoutMs
          );
          try {
            const response = await fetch(`${cleanBase}${endpoint}`, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiKey}`,
              },
              body: buildForm(modelName) as any,
              signal: ctrl.signal,
            });

            const contentType = response.headers.get("content-type");
            const responseData =
              contentType && contentType.includes("application/json")
                ? await response.json()
                : await response.text();

            if (!response.ok) {
              const detail =
                typeof responseData === "object"
                  ? responseData.error?.message ||
                    responseData.message ||
                    JSON.stringify(responseData)
                  : responseData || "无响应内容";
              errors.push(`${modelName} @ ${endpoint} -> ${response.status}: ${String(detail).slice(0, 220)}`);
              continue;
            }

            const imageUrl = extractGeneratedImageFromResponse(responseData);
            if (imageUrl) {
              console.log("Image edit success with:", { model: modelName, endpoint });
              return res.json({ url: imageUrl });
            }
            errors.push(`${modelName} @ ${endpoint} -> 200 但未解析到图片字段`);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            errors.push(`${modelName} @ ${endpoint} -> ${msg}`);
            console.warn("Image edit attempt failed:", { model: modelName, endpoint, msg });
            continue;
          } finally {
            clearTimeout(timer);
          }
        }
      }

      return res.status(500).json({
        error: `编辑失败：已尝试多模型与接口组合，均未成功。${errors.join(" | ")}`,
      });
    } catch (error) {
      console.error("Image edit error:", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "编辑失败，请检查 API 配置或网络" });
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
