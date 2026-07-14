import type { Express, Request, RequestHandler } from "express";
import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  augmentChatCompletionsBody,
  extractTextLlmMessageContent,
  postTextLlm,
  resolveTextLlmEnv,
  textLlmConfigError,
} from "./canvasTextLlmBridge.js";

export type MxShellMode = "one_shot" | "multi_cam";
export type MxShellCameraIntensity = "restrained" | "standard" | "flashy";

export type MxShellRefBinding = {
  index?: number;
  name?: string;
  kind?: string; // character | prop | scene | auto
  url?: string;
};

export type MxShellPromptBody = {
  mode?: string;
  story?: string;
  atmosphere?: string;
  /** 运镜强度：restrained / standard / flashy */
  cameraIntensity?: string;
  camera_intensity?: string;
  imageUrls?: string[];
  /** 图N → 角色/道具/场景名；有命名时模型必须按此绑定 {@图N} */
  imageBindings?: MxShellRefBinding[];
  model?: string;
};

export type MxShellPromptResult = {
  mode: MxShellMode;
  mode_label: string;
  prompt: string;
  display_text: string;
  has_refs: boolean;
  ref_count: number;
  bindings?: Array<{ index: number; name: string; kind: string }>;
};

const MX_SHELL_STORY_MIN = 10;
const MX_SHELL_STORY_MAX = 12000;
const MX_SHELL_ATMOSPHERE_MAX = 800;
const MX_SHELL_REF_MAX = 8;

const MX_SHELL_API_CONSTRAINT = `
---

## API 输出约束（本站画布节点强制）

你现在运行在 API 模式，必须遵守：

1. 禁止输出分析思路、开场白、结语、Markdown 代码块围栏以外的解释。
2. 仅返回一个 JSON 对象，结构如下：
{
  "mode": "one_shot" 或 "multi_cam",
  "prompt": "按本 SKILL 输出模板生成的完整提示词纯文本"
}
3. \`prompt\` 必须严格遵循本 SKILL 的输出模板顺序：
   【基础设定】→【氛围与画质】→【声音】→【画面内容】
4. 若用户选择一镜到底，\`prompt\` 使用「一镜到底模式模板」。
5. 若用户选择多机位分镜，\`prompt\` 使用「多机位分镜模式模板」，每个分镜含时间段、景别+角度+运镜四件套、动作描述。
6. 强制执行本 SKILL 核心原则：禁止文学化修辞（对白/画外音除外）、物理优先、时间轴精确到秒。
7. 运镜强制：每镜写「手法名 + 方向/路径 + 速度质感 + 戏剧动机」；景别/角度/运镜分开；禁止空词与矛盾组合（见 references/camera-moves.md）。
8. 按用户指定的运镜强度（restrained / standard / flashy）选词；默认 standard。
9. 有参考图时：基础设定每个元素不超过 20 字简短描述，并用 {@图1} {@图2} … 标注（按用户给出的图序号）。
10. 若用户提供了【参考图绑定】表：必须严格按表把故事中的同名角色/道具/场景绑定到对应 {@图N}；禁止把角色参考图当成场景，也禁止把场景参考图当成角色。
11. 若某张图已命名但故事中未出现该名：仍在【基础设定】中列出该元素，并标注 {@图N}；不要擅自改名。
12. 若某张图未命名：可按视觉内容推断类型，但仍必须使用正确的 {@图N} 序号。
13. 无参考图时：基础设定给出详细物理描述；不要强行写 {@图N}。
14. 声音默认：不需要配乐，仅保留同期声；不添加素材中未指定的额外音轨；禁止字幕叠加。
15. 对白格式：角色/旁白 + 情绪标签 + 关联动作 + 说："台词"。
16. \`prompt\` 内不要再包一层 JSON；它是可直接粘贴给 Seedance 的纯文本。
`.trim();

const MX_SHELL_CAMERA_MOVE_TERMS = [
  "固定镜头",
  "固定机位",
  "摇摄",
  "俯仰",
  "上摇",
  "下摇",
  "推进",
  "拉远",
  "横移",
  "升降",
  "手持",
  "稳定器",
  "摇臂",
  "变焦",
  "希区柯克",
  "跟拍",
  "跟随",
  "甩镜",
  "快速变焦",
  "环绕",
  "滑轨",
  "拉焦",
  "长镜头",
  "过肩",
  "dolly",
  "tracking",
  "steadicam",
  "crane",
  "pan",
  "tilt",
  "zoom",
];

const MX_SHELL_CAMERA_EMPTY_WORDS = [
  "电影感运镜",
  "高级运镜",
  "氛围运镜",
  "张力运镜",
  "酷炫运镜",
  "丝滑动效",
];

const MX_SHELL_CAMERA_CONTRADICTIONS: Array<{ re: RegExp; label: string }> = [
  { re: /固定(?:镜头|机位).{0,12}(?:推进|拉远|跟拍|跟随|横移|环绕)/, label: "固定+位移运镜" },
  { re: /(?:推进|拉远|跟拍|跟随|横移|环绕).{0,12}固定(?:镜头|机位)/, label: "位移运镜+固定" },
  { re: /手持.{0,10}稳定器|稳定器.{0,10}手持/, label: "手持+稳定器" },
  { re: /中景运镜|近景运镜|全景运镜|特写运镜/, label: "把景别当运镜" },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUpstreamOverloaded(status: number, payload: unknown): boolean {
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const msg = (
    typeof payload === "object" && payload
      ? (payload as { error?: { message?: unknown }; message?: unknown }).error?.message ||
        (payload as { message?: unknown }).message ||
        JSON.stringify(payload)
      : String(payload || "")
  )
    .toString()
    .toLowerCase();
  return (
    msg.includes("负载") ||
    msg.includes("饱和") ||
    msg.includes("rate") ||
    msg.includes("too many") ||
    msg.includes("overload")
  );
}

function stripMarkdownCodeFence(text: string): string {
  let s = String(text || "").trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(s);
  if (fenced) s = fenced[1].trim();
  return s;
}

function extractBalancedJsonObject(text: string): unknown {
  const cleaned = stripMarkdownCodeFence(text);
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function listenPort(): number {
  return Number(process.env.PORT) || 3000;
}

function absoluteImageUrl(req: Request, url: string): string {
  const u = String(url || "").trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u) || u.startsWith("data:")) return u;
  if (u.startsWith("/")) {
    const host = req.get("host") || `127.0.0.1:${listenPort()}`;
    const proto = (req.get("x-forwarded-proto") as string) || "http";
    return `${proto}://${host}${u}`;
  }
  return u;
}

function guessImageMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function resolveImageForVision(req: Request, projectRoot: string, rawUrl: string): string {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (url.startsWith("blob:")) {
    throw new Error("参考图为浏览器临时地址(blob)，请重新连接图片或先上传到画布");
  }
  if (url.startsWith("data:") || /^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/uploads/")) {
    const rel = url.replace(/^\/uploads\//, "").replace(/\\/g, "/");
    const abs = path.join(projectRoot, "public", "uploads", rel);
    if (!existsSync(abs)) return absoluteImageUrl(req, url);
    const buf = readFileSync(abs);
    return `data:${guessImageMime(abs)};base64,${buf.toString("base64")}`;
  }
  return absoluteImageUrl(req, url);
}

export function normalizeMxShellMode(value: unknown): MxShellMode {
  const original = String(value || "").trim();
  if (original === "one_shot" || original === "multi_cam") return original;
  const raw = original.toLowerCase().replace(/[\s_-]+/g, "");
  if (raw === "oneshot" || raw === "onelongtake" || raw === "single" || original.includes("一镜")) {
    return "one_shot";
  }
  if (raw === "multicam" || raw === "multishot" || original.includes("多机位") || original.includes("分镜")) {
    return "multi_cam";
  }
  // 默认多机位：更贴近分镜工作流；用户可在节点显式改为一镜到底
  return "multi_cam";
}

export function mxShellModeLabel(mode: MxShellMode): string {
  return mode === "one_shot" ? "一镜到底" : "多机位分镜";
}

function loadMxShellCameraMoves(projectRoot: string): string {
  const candidates = [
    path.join(projectRoot, "prompts", "mx-shell-prompt", "references", "camera-moves.md"),
    path.join(projectRoot, "skills", "mx-shell-prompt", "references", "camera-moves.md"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const body = readFileSync(file, "utf8").trim();
    if (body) return body;
  }
  return "";
}

function loadMxShellSystemPrompt(projectRoot: string): string {
  const candidates = [
    path.join(projectRoot, "prompts", "mx_shell_prompt_system.md"),
    path.join(projectRoot, "skills", "mx-shell-prompt", "Skill", "SKILL.md"),
  ];
  const cameraMoves = loadMxShellCameraMoves(projectRoot);
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const body = readFileSync(file, "utf8").trim();
    if (!body) continue;
    const parts = [body];
    if (cameraMoves) {
      parts.push(`---\n\n## 运镜词典（强制参考）\n\n${cameraMoves}`);
    }
    parts.push(MX_SHELL_API_CONSTRAINT);
    return parts.join("\n\n");
  }
  throw new Error("缺少 Mx-Shell SKILL 文件：prompts/mx_shell_prompt_system.md");
}

export function normalizeMxShellCameraIntensity(value: unknown): MxShellCameraIntensity {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (raw === "restrained" || raw === "克制" || raw === "low") return "restrained";
  if (raw === "flashy" || raw === "炫技" || raw === "high") return "flashy";
  return "standard";
}

function mxShellCameraIntensityLabel(intensity: MxShellCameraIntensity): string {
  if (intensity === "restrained") return "克制";
  if (intensity === "flashy") return "炫技";
  return "标准";
}

function normalizeStory(value: unknown): string {
  return String(value || "").trim().slice(0, MX_SHELL_STORY_MAX);
}

function normalizeAtmosphere(value: unknown): string {
  return String(value || "").trim().slice(0, MX_SHELL_ATMOSPHERE_MAX);
}

function normalizeImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const url = String(item || "").trim();
    if (!url || out.includes(url)) continue;
    out.push(url);
    if (out.length >= MX_SHELL_REF_MAX) break;
  }
  return out;
}

function normalizeRefKind(value: unknown): string {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "character" || raw === "角色" || raw === "人物") return "character";
  if (raw === "prop" || raw === "道具" || raw === "物品") return "prop";
  if (raw === "scene" || raw === "场景" || raw === "环境") return "scene";
  return "auto";
}

function kindLabelZh(kind: string): string {
  if (kind === "character") return "角色";
  if (kind === "prop") return "道具";
  if (kind === "scene") return "场景";
  return "未指定";
}

export function normalizeImageBindings(
  value: unknown,
  imageCount: number
): Array<{ index: number; name: string; kind: string }> {
  if (!Array.isArray(value) || imageCount <= 0) return [];
  const out: Array<{ index: number; name: string; kind: string }> = [];
  const used = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as MxShellRefBinding;
    let index = Math.round(Number(row.index));
    if (!Number.isFinite(index) || index < 1) index = out.length + 1;
    if (index < 1 || index > imageCount || used.has(index)) continue;
    const name = String(row.name || "")
      .trim()
      .slice(0, 24);
    const kind = normalizeRefKind(row.kind);
    used.add(index);
    out.push({ index, name, kind });
    if (out.length >= MX_SHELL_REF_MAX) break;
  }
  // 补齐未声明的图序号，便于模型仍能引用 {@图N}
  for (let i = 1; i <= imageCount; i += 1) {
    if (used.has(i)) continue;
    out.push({ index: i, name: "", kind: "auto" });
  }
  return out.sort((a, b) => a.index - b.index);
}

function buildMxShellUserMessage(opts: {
  mode: MxShellMode;
  story: string;
  atmosphere: string;
  cameraIntensity: MxShellCameraIntensity;
  refCount: number;
  bindings: Array<{ index: number; name: string; kind: string }>;
}): string {
  const modeLabel = mxShellModeLabel(opts.mode);
  const intensityLabel = mxShellCameraIntensityLabel(opts.cameraIntensity);
  const lines = [
    `模式（必须严格使用）：${modeLabel}（mode=${opts.mode}）`,
    `运镜强度（必须遵守）：${intensityLabel}（camera_intensity=${opts.cameraIntensity}）`,
    "",
    "【用户素材】",
    opts.story,
  ];
  if (opts.atmosphere) {
    lines.push("", "【氛围与画质偏好（用户可改，未提供则按素材推断）】", opts.atmosphere);
  }
  if (opts.refCount > 0) {
    lines.push(
      "",
      `【参考图】已附带 ${opts.refCount} 张图，按顺序称为图1…图${opts.refCount}（与附件图片顺序一致）。`,
      "基础设定中每个元素用不超过 20 字的简短描述，并标注 {@图N}。",
      "请根据参考图提取角色/道具/场景的核心可见特征，不要编造与图明显冲突的外形。"
    );
    const named = opts.bindings.filter((b) => b.name);
    if (named.length) {
      lines.push("", "【参考图绑定】（权威映射，必须遵守）");
      for (const b of opts.bindings) {
        const label = b.name
          ? `${kindLabelZh(b.kind)}「${b.name}」`
          : `${kindLabelZh(b.kind)}（未命名，可按视觉推断）`;
        lines.push(`图${b.index} = ${label} → 必须使用 {@图${b.index}}`);
      }
      lines.push(
        "若故事中出现与绑定同名的角色/道具/场景，必须绑定到上表对应 {@图N}。",
        "禁止交换绑定；禁止把角色图写成场景，或把场景图写成角色。"
      );
    } else {
      lines.push(
        "",
        "【参考图绑定】用户未命名。请按视觉内容推断每张图是角色/道具/场景，并在【基础设定】中正确标注 {@图N}；推断结果要与故事人物一致。"
      );
    }
  } else {
    lines.push(
      "",
      "【参考图】无。请根据素材自动提取角色/场景/道具，并给出详细物理描述（无 {@图N} 也可）。"
    );
  }
  lines.push(
    "",
    "【运镜要求】",
    "每镜运镜必须写四件套：手法名 + 方向/路径 + 速度质感 + 戏剧动机。",
    "景别、角度、运镜分开写；禁止空词与矛盾组合；词库见 system 中的运镜词典。",
    "",
    "请按 Mx-Shell_Prompts SKILL 执行：收集/推断参数 → 填入对应模式模板 → 仅输出 JSON（含完整 prompt 纯文本）。"
  );
  return lines.join("\n");
}

function parseMxShellResponse(
  raw: string,
  mode: MxShellMode,
  cameraIntensity: MxShellCameraIntensity
): MxShellPromptResult {
  const text = String(raw || "").trim();
  if (!text) throw new Error("模型返回了空内容");

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stripMarkdownCodeFence(text));
  } catch {
    parsed = extractBalancedJsonObject(text);
  }

  // 容错：若模型直接吐出 Mx-Shell 纯文本模板，包一层返回
  if (!parsed || typeof parsed !== "object") {
    if (text.includes("【基础设定】") && text.includes("【画面内容】")) {
      assertMxShellPromptShape(text, mode, cameraIntensity);
      return {
        mode,
        mode_label: mxShellModeLabel(mode),
        prompt: text,
        display_text: text,
        has_refs: false,
        ref_count: 0,
      };
    }
    throw new Error(`模型返回的不是合法 JSON：${text.slice(0, 240)}`);
  }

  const obj = parsed as Record<string, unknown>;
  const prompt = String(obj.prompt || obj.display_text || obj.full_prompt || "").trim();
  if (!prompt) throw new Error("模型 JSON 缺少 prompt");
  assertMxShellPromptShape(prompt, mode, cameraIntensity);
  const resolvedMode = normalizeMxShellMode(obj.mode || mode);
  return {
    mode: resolvedMode,
    mode_label: mxShellModeLabel(resolvedMode),
    prompt,
    display_text: prompt,
    has_refs: false,
    ref_count: 0,
  };
}

function extractPictureContent(prompt: string): string {
  const idx = prompt.indexOf("【画面内容】");
  if (idx < 0) return prompt;
  return prompt.slice(idx);
}

/** 按 Mx-Shell skill 输出模板硬校验四段结构 + 模式形态 + 运镜质量 */
function assertMxShellPromptShape(
  prompt: string,
  mode: MxShellMode,
  cameraIntensity: MxShellCameraIntensity = "standard"
): void {
  const required = ["【基础设定】", "【氛围与画质】", "【声音】", "【画面内容】"];
  const missing = required.filter((h) => !prompt.includes(h));
  if (missing.length) {
    throw new Error(`prompt 未遵循 Mx-Shell 模板（缺少 ${missing.join("、")}）`);
  }
  const picture = extractPictureContent(prompt);
  if (mode === "one_shot") {
    const hasOneShot =
      /一镜到底/.test(prompt) || /分镜\s*[:：]\s*单镜头/.test(prompt) || /景别\s*[:：]/.test(prompt);
    if (!hasOneShot) {
      throw new Error("一镜到底模式的 prompt 缺少「一镜到底 / 景别」等模板字段");
    }
    if (!/运镜手法\s*[:：]/.test(picture) && !/运镜\s*[:：]/.test(picture)) {
      throw new Error("一镜到底模式的 prompt 缺少「运镜手法」字段");
    }
  } else {
    const shotHits = prompt.match(/分镜\s*\d+/g) || [];
    if (shotHits.length < 2) {
      throw new Error("多机位分镜模式的 prompt 至少需要 2 个「分镜N」段落");
    }
  }

  for (const word of MX_SHELL_CAMERA_EMPTY_WORDS) {
    if (picture.includes(word)) {
      throw new Error(`运镜描述含空词「${word}」，请改写为具体手法+方向+速度+动机`);
    }
  }
  for (const item of MX_SHELL_CAMERA_CONTRADICTIONS) {
    if (item.re.test(picture)) {
      throw new Error(`运镜存在矛盾组合（${item.label}），请按运镜词典改写`);
    }
  }
  const hasLegalMove = MX_SHELL_CAMERA_MOVE_TERMS.some((term) =>
    picture.toLowerCase().includes(term.toLowerCase())
  );
  if (!hasLegalMove) {
    throw new Error("【画面内容】未使用可识别的运镜手法名（见 camera-moves 词典）");
  }
  // 希区柯克变焦必须写清推进/变焦配合
  if (/希区柯克/.test(picture) && !/(推进|拉远).{0,24}(变焦|zoom)|(变焦|zoom).{0,24}(推进|拉远|反向)/i.test(picture)) {
    throw new Error("希区柯克变焦须写明推进与变焦的反向配合");
  }
  if (cameraIntensity === "restrained") {
    const flashyHits = ["甩镜", "快速变焦", "子弹时间", "360环绕", "全圈"].filter((w) =>
      picture.includes(w)
    );
    if (flashyHits.length) {
      throw new Error(`运镜强度为克制，请去掉炫技手法：${flashyHits.join("、")}`);
    }
  }
}

async function callMxShellLlm(opts: {
  systemPrompt: string;
  userMessage: string;
  imageDataUrls: string[];
  model: string;
}): Promise<string> {
  const { apiBase, apiKey } = resolveTextLlmEnv(opts.model);
  if (!apiBase || !apiKey) {
    throw new Error(textLlmConfigError(opts.model));
  }
  const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 300000);
  const maxRetries = 4;
  const baseDelayMs = 2000;
  let lastError = "";

  const userContent: Array<Record<string, unknown>> = [
    { type: "text", text: opts.userMessage },
  ];
  for (const url of opts.imageDataUrls) {
    userContent.push({ type: "image_url", image_url: { url } });
  }

  const requestBody = augmentChatCompletionsBody(opts.model, {
    model: opts.model,
    stream: false,
    messages: [
      { role: "system", content: opts.systemPrompt },
      {
        role: "user",
        content: opts.imageDataUrls.length ? userContent : opts.userMessage,
      },
    ],
    max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 8192),
    temperature: 0.7,
  });

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await postTextLlm(opts.model, apiBase, apiKey, requestBody, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const rawText = await response.text();
      let data: Record<string, unknown> = {};
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        data = { error: { message: rawText.slice(0, 400) } };
      }
      if (!response.ok) {
        const errMsg =
          (typeof (data?.error as { message?: unknown })?.message === "string" &&
            (data.error as { message: string }).message) ||
          rawText.slice(0, 400) ||
          `上游接口错误 (${response.status})`;
        if (isUpstreamOverloaded(response.status, errMsg) && attempt < maxRetries) {
          const delay =
            Math.min(12000, baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 260));
          console.warn("[mx-shell-prompt] upstream overloaded, retrying...", { attempt, delay });
          await sleep(delay);
          lastError = errMsg;
          continue;
        }
        throw new Error(errMsg);
      }
      return extractTextLlmMessageContent(opts.model, data).trim();
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        isUpstreamOverloaded(0, msg) || /fetch failed|network|econnreset|aborted/i.test(msg);
      if (retryable && attempt < maxRetries) {
        const delay =
          Math.min(12000, baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 260));
        console.warn("[mx-shell-prompt] transient error, retrying...", { attempt, delay, msg });
        await sleep(delay);
        lastError = msg;
        continue;
      }
      throw err instanceof Error ? err : new Error(msg);
    }
  }
  throw new Error(lastError || "Mx-Shell 提示词生成失败");
}

export async function generateMxShellPromptOnServer(
  req: Request,
  projectRoot: string,
  body: MxShellPromptBody
): Promise<MxShellPromptResult> {
  const mode = normalizeMxShellMode(body.mode);
  const story = normalizeStory(body.story);
  if (story.length < MX_SHELL_STORY_MIN) {
    throw new Error(`素材过短（至少 ${MX_SHELL_STORY_MIN} 字）：请提供故事大纲、剧本片段或分镜草稿`);
  }
  const atmosphere = normalizeAtmosphere(body.atmosphere);
  const cameraIntensity = normalizeMxShellCameraIntensity(
    body.cameraIntensity ?? body.camera_intensity
  );
  const imageUrls = normalizeImageUrls(body.imageUrls);
  const imageDataUrls = imageUrls.map((url) => resolveImageForVision(req, projectRoot, url)).filter(Boolean);
  const bindings = normalizeImageBindings(body.imageBindings, imageDataUrls.length);
  const model =
    String(body.model || "").trim() ||
    (process.env.TEXT_MODEL || "").trim() ||
    "gemini-3.5-flash";
  const systemPrompt = loadMxShellSystemPrompt(projectRoot);
  const baseUser = buildMxShellUserMessage({
    mode,
    story,
    atmosphere,
    cameraIntensity,
    refCount: imageDataUrls.length,
    bindings,
  });

  const maxAttempts = 3;
  let lastError = "";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const userMessage =
        attempt === 0 || !lastError
          ? baseUser
          : `${baseUser}\n\n【上次输出未通过校验，请整份重写】\n${lastError}\n硬性：每镜运镜四件套完整；禁止固定+位移等矛盾组合与空词。`;
      const text = await callMxShellLlm({
        systemPrompt,
        userMessage,
        imageDataUrls,
        model,
      });
      const result = parseMxShellResponse(text, mode, cameraIntensity);
      result.has_refs = imageDataUrls.length > 0;
      result.ref_count = imageDataUrls.length;
      result.bindings = bindings;
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn("[mx-shell-prompt] parse/generate failed:", { attempt, lastError });
      if (attempt < maxAttempts - 1) {
        await sleep(Math.min(8000, 1500 * Math.pow(2, attempt)));
      }
    }
  }
  throw new Error(lastError || "Mx-Shell 提示词生成失败");
}

export function registerCanvasMxShellPromptRoutes(
  app: Express,
  projectRoot: string,
  gate?: RequestHandler
) {
  app.post("/api/canvas/mx-shell-prompt", ...(gate ? [gate] : []), async (req, res) => {
    try {
      const result = await generateMxShellPromptOnServer(req, projectRoot, req.body || {});
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[mx-shell-prompt] failed:", msg);
      return res.status(502).json({ error: msg });
    }
  });
}
