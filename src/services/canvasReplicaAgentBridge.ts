import type { Express, Request, RequestHandler } from "express";
import {
  augmentChatCompletionsBody,
  extractTextLlmMessageContent,
  isApimartGeminiFlashModel,
  isRunningHubChatModel,
  postTextLlm,
  resolveTextLlmEnv,
  textLlmConfigError,
} from "./canvasTextLlmBridge.js";
import { v4 as uuidv4 } from "uuid";
import { existsSync, readFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import {
  getStoryboardImageEnv,
  isPublicRunningHubImageUrl,
  normalizeImageInputForUpload,
  runStoryboardRunningHubG2Job,
  uploadBinaryToRunningHub,
} from "./runningHubStoryboardImage.js";

/** Gemini VLM 系统提示（纯中文）— 反推用于「洗图」重绘，非贴图复刻 */
const GEMINI_VLM_SYSTEM = `# 角色
你是一位专业的电影视觉特效导演和 AI 图像分析师。

# 任务
请仔细分析这张上传的“视频关键帧（图1）”。你需要完成两件事：
1. 判定画面中是否存在明显的【可替换角色主体】——包括真人/类人、卡通人形、游戏/UI 广告里的 2D/3D 角色、拟人化或风格化动物 mascot（如猪、牛、鸭、老虎、熊猫等）。纯风景、空镜头、纯车辆、无生命静物、仅有 UI 界面时请判 false。
2. 写一段英文场景描述 reverse_prompt，供后续「洗图」模型在参考构图与氛围的前提下重新绘制，而非逐像素复制原图。

# 核心规则
1. 如果【存在】可替换角色主体（含卡通/游戏/动物 mascot）：
   - 忽略具体长相与物种细节，每个主体统一用占位符 "[Subject]" 或 "[Subject_N]"（有圈号标注时）代替。
   - 重点描述：景别、相机角度、主体在画面中的位置关系、背景环境类型、姿势与 blocking、表情与眼神朝向、整体光影基调与色彩氛围。
   - 不要罗列服装/logo/文字/UI 水印等易触发贴图复制的细节。
   - **严禁**在 reverse_prompt 中描述 emoji 表情气泡、对话框、speech bubble、thought bubble、表情符号贴纸、UI 图标——这些是临时标注/UI 元数据，不是场景内容。
2. 如果【不存在】可替换角色（纯空镜/静物/环境）：
   - 重点描述：场景类型、空间层次、整体构图与透视关系、主光源方向、色彩基调与氛围。
   - 用概括性语言描述主体（如 "large golden statue in temple hall"），不要逐像素枚举每个装饰、按钮、logo、字幕或 UI 文字。
   - 禁止在 reverse_prompt 中出现原图中的可读文字、品牌 logo、水印、免责声明等。
3. 请使用英文撰写描述短语，用逗号分隔；偏「氛围 + 构图 + 光影」，而非「原图元素清单」。

# 输出格式
请必须输出标准的 JSON 格式，不要包含任何 Markdown 标记（如 \`\`\`json）或多余字符，确保可以直接被 JSON.parse 解析。
格式如下：
{
  "has_character": true,
  "reverse_prompt": "这里填写详细的英文描述短语"
}`;

const GEMINI_VLM_USER_MESSAGE = `请分析这张视频关键帧（图1），并仅输出一个 JSON 对象。has_character 表示是否存在可替换的角色主体（含卡通/游戏/动物 mascot）；reverse_prompt 为英文逗号分隔描述短语（用于洗图重绘，勿写成原图像素级清单，勿包含图中文字/logo/emoji 气泡/对话框/UI 贴纸）。`;

/** 从 VLM 反推文本中剔除 emoji/气泡/UI 贴纸描述（VLM 常误写入） */
const REVERSE_PROMPT_UI_SEGMENT_RE =
  /speech\s*bubble|thought\s*bubble|emoji\s*bubble|emoji\s*icon|emoticon|expressive\s+icon|cartoon\s+symbol|emotion\s+bubbles?|sick\s+emoji|purple\s+emoji|green\s+emoji|floating\s+above.*(?:bubble|emoji|icon)|accompanied\s+by.*(?:emoji|bubble|icon)|containing\s+a\s+(?:purple|green|stylized).*?(?:icon|symbol|emoji)/i;

function sanitizeReversePrompt(text: string): string {
  const parts = String(text || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((part) => !REVERSE_PROMPT_UI_SEGMENT_RE.test(part));
  return parts.join(", ").replace(/\s+/g, " ").trim();
}

/** 从 reverse_prompt 解析实际出现的角色编号 */
function extractSubjectsFromReversePrompt(text: string): number[] {
  const found = new Set<number>();
  const re = /\[Subject(?:_(\d+))?\]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = m[1] ? Number(m[1]) : 1;
    if (Number.isFinite(n) && n >= 1 && n <= 5) found.add(n);
  }
  return [...found].sort((a, b) => a - b);
}

/** 用户选的换人编号 ∩ 关键帧里实际出现的 Subject 编号 */
function effectiveTargetMarkers(requested: number[], reversePrompt: string): number[] {
  const req = (requested || []).filter((m) => m >= 1 && m <= 5);
  const detected = extractSubjectsFromReversePrompt(reversePrompt);
  if (!detected.length) return req.length ? req : [1];
  const set = new Set(detected);
  const effective = req.filter((m) => set.has(m));
  return effective.length ? effective : detected;
}

const REPLICA_GEMINI_MODEL = "gemini-3.5-flash";

/** gpt-image-2 第二阶段换人提示词（默认：替换全部角色主体） */
const GPT_IMAGE2_SWAP_TEMPLATE =
  "完全保留图1（中转图）的景别、背景、画风、构图和光影。将图1中角色替换为图2对应角色的五官与全套服装，" +
  "但输出必须仍是图1的单镜头画面；若图2是三视图对照表，只借鉴正面造型的服装与五官，禁止输出白底三视图或复制图2版式。" +
  "确保 blocking 与眼神与图1一致。";

const REPLICA_SHEET_OUTPUT_BAN =
  "输出必须是与图1相同的单镜头电影画面；禁止白底三视图拼版、禁止角色对照表版式、禁止多视角拼图。";

function looksLikeCharacterSheetReversePrompt(text: string): boolean {
  return /model\s*sheet|turnaround|three\s+.*views|full-body\s+views|character\s*sheet|frontal\s+view\s+in\s+the\s+center|side\s+profile.*front.*back|solid\s+clean\s+white\s+background.*studio/i.test(
    String(text || "")
  );
}

function markerCircled(n: number): string {
  const m = Math.floor(Number(n));
  if (m >= 1 && m <= 20) return String.fromCharCode(0x2460 + m - 1);
  return String(m > 0 ? m : 1);
}

function normalizeTargetMarkers(body: ReplicaAgentRunBody): number[] {
  const raw = body.replica_target_markers;
  if (Array.isArray(raw) && raw.length) {
    const markers = [...new Set(
      raw.map((n) => Math.floor(Number(n))).filter((n) => n >= 1 && n <= 5)
    )].sort((a, b) => a - b);
    if (markers.length) return markers;
  }
  const single = Math.floor(Number(body.replica_target_marker || 1));
  return [single >= 1 && single <= 5 ? single : 1];
}

function buildGeminiMarkerHint(markers: number[]): string {
  if (!markers.length) return "";
  if (markers.length === 1) {
    const m = markers[0];
    return `\n\n补充说明：图中角色编号可能显示为圈号 ${markerCircled(m)} 或数字 ${m}（含小圆点贴纸）。请单独描述该编号角色的 blocking、姿势与眼神；在 reverse_prompt 中用 [Subject_${m}] 指代。emoji 表情气泡、对话框贴纸不是编号，请忽略且不要在 reverse_prompt 中描述。`;
  }
  const circled = markers.map(markerCircled).join("、");
  const digits = markers.join("、");
  const subjects = markers.map((m) => `[Subject_${m}]`).join("、");
  return `\n\n补充说明：图中角色编号可能为圈号（${circled}）或阿拉伯数字（${digits}）。请分别描述各编号角色的 blocking、姿势与眼神；在 reverse_prompt 中用 ${subjects} 指代。emoji 表情气泡不是编号，必须忽略。`;
}

function replicaAnnotationStripNote(markers?: number[]): string {
  const list = (markers || []).filter((m) => m >= 1);
  const markerPart = list.length
    ? `圈号/数字标注（如 ${list.map((m) => `${markerCircled(m)}/${m}`).join("、")}）`
    : "圈号/数字标注";
  return `图1上的 ${markerPart}、emoji 表情气泡、对话框贴纸、临时 UI 符号均为元数据，成图必须全部去除，不得保留 speech bubble 或 emoji 图标。`;
}

function buildCompositeRefSheetNote(markers: number[]): string {
  const rows = markers
    .map((m) => `${markerCircled(m)}（数字${m}）→ 图2对照表中标注为 ${m} 或 ${markerCircled(m)} 的那一位角色`)
    .join("；");
  return `图2为多人角色对照表（character sheet）。${rows}。严禁把对照表中未在图1出现的角色追加进画面；严禁改变图1角色数量与站位，仅替换对应编号角色的外观。`;
}

const CANVAS_RATIO_TO_ASPECT: Record<string, string> = {
  square: "1:1",
  portrait: "2:3",
  landscape: "3:2",
  portrait43: "3:4",
  landscape43: "4:3",
  story: "9:16",
  wide: "16:9",
};

export type ReplicaAgentRunBody = {
  background_url?: string;
  background_image_url?: string;
  character_url?: string;
  character_image_url?: string;
  style_prompt?: string;
  upstream_prompts?: string | string[];
  gemini_model?: string;
  canvas_resolution?: string;
  canvas_ratio?: string;
  canvas_custom_ratio?: string;
  /** 多人同框时仅替换该编号角色（①=1 …）；兼容旧字段 */
  replica_target_marker?: number;
  /** 一次运行替换多个编号角色 */
  replica_target_markers?: number[];
  /** 多张角色参考图（图2…） */
  character_image_urls?: string[];
};

export type ReplicaAgentTaskStatus =
  | "processing_stage1"
  | "processing_stage2"
  | "completed"
  | "failed";

export type ReplicaAgentRoute = "full" | "wash_only";

type GeminiReplicaAnalysis = {
  has_character: boolean;
  reverse_prompt: string;
};

type ReplicaAgentTask = {
  id: string;
  status: ReplicaAgentTaskStatus;
  stage_label: string;
  route: ReplicaAgentRoute;
  has_character: boolean;
  skipped_stage2: boolean;
  created_at: number;
  updated_at: number;
  reverse_prompt: string;
  wash_prompt: string;
  swap_prompt: string;
  washed_image_url: string;
  final_image_url: string;
  error: string;
};

const tasks = new Map<string, ReplicaAgentTask>();

export type ReplicaAgentBridgeDeps = {
  projectRoot: string;
  persistImage: (url: string) => Promise<string>;
  requireGate?: RequestHandler;
};

const GEMINI_VISION_MAX_EDGE = Math.max(
  512,
  Number(process.env.GEMINI_VISION_MAX_EDGE || 1536) || 1536
);
const GEMINI_VISION_JPEG_QUALITY = Math.min(
  95,
  Math.max(50, Number(process.env.GEMINI_VISION_JPEG_QUALITY || 82) || 82)
);

/** 缩小并转 JPEG，避免 Comfly/Gemini 因 1.6MB+ PNG base64 或拉取大图超时 */
/** 缩小并转 JPEG，避免 Comfly/Gemini 因 1.6MB+ PNG base64 或拉取大图超时 */
async function compressImageForGeminiVision(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({
      width: GEMINI_VISION_MAX_EDGE,
      height: GEMINI_VISION_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: GEMINI_VISION_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

async function readImageBufferForGemini(projectRoot: string, input: string): Promise<Buffer> {
  const trimmed = String(input || "").trim();
  const dataMatch = /^data:(image\/[^;]+);base64,(.+)$/is.exec(trimmed);
  if (dataMatch) {
    return Buffer.from(dataMatch[2].replace(/\s/g, ""), "base64");
  }
  const normalized = normalizeImageInputForUpload(trimmed, projectRoot);
  if (normalized.startsWith("/uploads/")) {
    const rel = normalized.replace(/^\/uploads\//, "").replace(/\\/g, "/");
    if (!rel || rel.includes("..")) throw new Error(`非法图片路径：${normalized}`);
    const abs = path.join(projectRoot, "public", "uploads", rel);
    if (!existsSync(abs)) throw new Error(`本地图片不存在：${normalized}`);
    return readFileSync(abs);
  }
  if (/^https?:\/\//i.test(normalized) && isPublicRunningHubImageUrl(normalized)) {
    const resp = await fetch(normalized);
    if (!resp.ok) throw new Error(`拉取图片失败 (${resp.status})`);
    return Buffer.from(await resp.arrayBuffer());
  }
  throw new Error("无法读取 Gemini 分析用图片");
}

/** 宽图三视图对照表：裁出中间正面视图，避免 g2 直接复制拼版 */
const TURNAROUND_SHEET_WIDE_ASPECT_MIN = 2.15;
const TURNAROUND_SHEET_CLASSIC_MIN = 1.32;
const TURNAROUND_SHEET_CLASSIC_MAX = 1.68;

function shouldCropTurnaroundPanel(w: number, h: number): "horizontal" | "vertical" | null {
  if (!w || !h) return null;
  const aspect = w / h;
  if (aspect >= TURNAROUND_SHEET_WIDE_ASPECT_MIN) return "horizontal";
  if (aspect >= TURNAROUND_SHEET_CLASSIC_MIN && aspect <= TURNAROUND_SHEET_CLASSIC_MAX) return "horizontal";
  if (aspect <= 1 / TURNAROUND_SHEET_WIDE_ASPECT_MIN) return "vertical";
  return null;
}

async function extractTurnaroundFrontPanel(
  projectRoot: string,
  imageInput: string,
  persistImage: (url: string) => Promise<string>
): Promise<string> {
  const normalized = normalizeImageInputForUpload(String(imageInput || "").trim(), projectRoot);
  if (!normalized) return imageInput;
  const rawBuf = await readImageBufferForGemini(projectRoot, normalized);
  const meta = await sharp(rawBuf).metadata();
  const w = meta.width || 0;
  const h = meta.height || 0;
  const mode = shouldCropTurnaroundPanel(w, h);
  if (!mode) return normalized;

  let cropped: Buffer | null = null;
  if (mode === "horizontal") {
    const panelW = Math.max(1, Math.round(w / 3));
    const left = Math.max(0, Math.round((w - panelW) / 2));
    cropped = await sharp(rawBuf)
      .extract({ left, top: 0, width: Math.min(panelW, w - left), height: h })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  } else {
    const panelH = Math.max(1, Math.round(h / 3));
    const top = Math.max(0, Math.round((h - panelH) / 2));
    cropped = await sharp(rawBuf)
      .extract({ left: 0, top, width: w, height: Math.min(panelH, h - top) })
      .jpeg({ quality: 90, mozjpeg: true })
      .toBuffer();
  }
  if (!cropped) return normalized;

  const saved = await persistImage(`data:image/jpeg;base64,${cropped.toString("base64")}`);
  console.log("[replica-agent] cropped turnaround front panel", {
    input: normalized.slice(0, 96),
    size: `${w}x${h}`,
    mode,
    saved,
  });
  return normalizeImageInputForUpload(saved, projectRoot);
}

async function prepareCharacterRefsForSwap(
  projectRoot: string,
  inputs: string[],
  persistImage: (url: string) => Promise<string>
): Promise<string[]> {
  const out: string[] = [];
  for (const input of inputs) {
    if (!String(input || "").trim()) continue;
    out.push(await extractTurnaroundFrontPanel(projectRoot, input, persistImage));
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGeminiError(status: number, message: string): boolean {
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const m = String(message || "").toLowerCase();
  return (
    m.includes("upstream error") ||
    m.includes("do request failed") ||
    m.includes("high demand") ||
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("fetch failed") ||
    m.includes("econnreset") ||
    m.includes("负载") ||
    m.includes("饱和")
  );
}

function formatVisionUpstreamError(rawMsg: string, model: string): string {
  const msg = String(rawMsg || "").trim();
  const label = isRunningHubChatModel(model) ? model : "Gemini";
  if (/upstream error|do request failed/i.test(msg)) {
    return `${msg}\n\n【说明】这是 ${label} 上游失败。常见原因：网关瞬时故障、模型排队或超时。请稍后重试或更换文本模型。`;
  }
  if (/high demand/i.test(msg)) {
    return `${msg}\n\n【说明】${label} 当前访问量过高，请稍后重试。`;
  }
  return msg;
}

/**
 * 视觉分析用图：压缩为 JPEG。GLM（RunningHub LLM）支持 base64 image_url；
 * Gemini/Comfly 无法拉取 localhost，优先上传到 RunningHub 拿公网 URL，失败再回退 base64。
 */
async function resolveImageForVision(projectRoot: string, rawUrl: string, model?: string): Promise<string> {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url) && isPublicRunningHubImageUrl(url)) {
    return url;
  }

  const normalized = url.startsWith("data:") ? url : normalizeImageInputForUpload(url, projectRoot);
  const needsLocalRead =
    normalized.startsWith("/uploads/") || normalized.startsWith("data:") || normalized === url;
  if (!needsLocalRead) {
    throw new Error(
      "背景参考图无法被视觉模型读取：请使用本站 /uploads 图片，或提供公网可访问的 https 图片地址"
    );
  }

  const rawBuf = await readImageBufferForGemini(projectRoot, normalized);
  const compressed = await compressImageForGeminiVision(rawBuf);
  const compressedDataUrl = `data:image/jpeg;base64,${compressed.toString("base64")}`;
  console.log("[replica-agent] vision image compressed", {
    model: model || REPLICA_GEMINI_MODEL,
    rawKB: Math.round(rawBuf.length / 1024),
    jpegKB: Math.round(compressed.length / 1024),
  });

  if (isRunningHubChatModel(model || "") || isApimartGeminiFlashModel(model || "")) {
    return compressedDataUrl;
  }

  const rhEnv = getStoryboardImageEnv();
  if (rhEnv) {
    try {
      const publicUrl = await uploadBinaryToRunningHub(rhEnv, compressedDataUrl, projectRoot);
      console.log("[replica-agent] vision image via RunningHub URL", { urlLen: publicUrl.length });
      return publicUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[replica-agent] RunningHub upload for vision failed, fallback to base64:", msg);
    }
  }

  return compressedDataUrl;
}

function stripJsonFence(text: string): string {
  let s = String(text || "").trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(s);
  if (fenced) s = fenced[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start >= 0 && end > start) s = s.slice(start, end + 1);
  return s;
}

export function parseGeminiReplicaJson(raw: string): GeminiReplicaAnalysis {
  const text = stripJsonFence(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini 返回的不是合法 JSON：${text.slice(0, 240)}`);
  }
  const obj = parsed as Record<string, unknown>;
  const reverse_prompt = sanitizeReversePrompt(String(obj.reverse_prompt || "").trim());
  if (!reverse_prompt) throw new Error("Gemini JSON 缺少有效的 reverse_prompt");
  const has_character = obj.has_character === true;
  return { has_character, reverse_prompt };
}

async function runGeminiVisionAnalysis(opts: {
  req: Request;
  projectRoot: string;
  imageUrl: string;
  model?: string;
  targetMarkers?: number[];
}): Promise<GeminiReplicaAnalysis> {
  const model =
    String(opts.model || "").trim() ||
    REPLICA_GEMINI_MODEL ||
    (process.env.TEXT_MODEL || "").trim();
  const { apiBase, apiKey } = resolveTextLlmEnv(model);
  if (!apiBase || !apiKey) {
    throw new Error(textLlmConfigError(model));
  }
  const resolved = await resolveImageForVision(opts.projectRoot, opts.imageUrl, model);
  if (!resolved) throw new Error("无法读取背景参考图");
  if (
    !isRunningHubChatModel(model) &&
    /^https?:\/\//i.test(resolved) &&
    !isPublicRunningHubImageUrl(resolved)
  ) {
    throw new Error(
      "背景参考图无法被云端读取：本地开发地址（如 localhost）不能传给 Gemini，请刷新后重试；或改用 glm-5.1（支持 base64 传图）"
    );
  }

  // 与 Comfly「Chat(分析图片)」文档一致：单条 user 消息，content 为 [text, image_url]
  const markers = (opts.targetMarkers || []).filter((m) => m >= 1);
  const markerHint = buildGeminiMarkerHint(markers);
  const visionPrompt = `${GEMINI_VLM_SYSTEM}\n\n${GEMINI_VLM_USER_MESSAGE}${markerHint}`;
  const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: visionPrompt },
    { type: "image_url", image_url: { url: resolved } },
  ];

  const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 300000);
  const maxRetries = Math.max(0, Number(process.env.GEMINI_VISION_MAX_RETRIES || 3));
  const requestBody = augmentChatCompletionsBody(model, {
    model,
    stream: false,
    messages: [{ role: "user", content: contentParts }],
    max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 4096),
  });
  console.log("[replica-agent] vision request", {
    model,
    imageMode: resolved.startsWith("data:") ? "base64" : "url",
  });

  let lastError = "视觉模型接口未知错误";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await postTextLlm(model, apiBase, apiKey, requestBody, { signal: ctrl.signal });
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
          `Gemini 接口错误 (${response.status})`;
        lastError = errMsg;
        if (isRetryableGeminiError(response.status, errMsg) && attempt < maxRetries) {
          const delay = Math.min(15000, 2000 * Math.pow(2, attempt));
          console.warn("[replica-agent] Gemini retry", {
            attempt,
            status: response.status,
            delay,
            err: errMsg.slice(0, 160),
          });
          await sleep(delay);
          continue;
        }
        throw new Error(formatVisionUpstreamError(errMsg, model));
      }
      const text = extractTextLlmMessageContent(model, data).trim();
      if (!text) throw new Error("Gemini 反推返回空内容");
      return parseGeminiReplicaJson(text);
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      lastError = msg;
      const transient =
        /timeout|timed out|aborted|fetch failed|network|econnreset|enotfound/i.test(msg);
      if (transient && attempt < maxRetries) {
        const delay = Math.min(15000, 2000 * Math.pow(2, attempt));
        console.warn("[replica-agent] Gemini transient retry", { attempt, delay, err: msg.slice(0, 160) });
        await sleep(delay);
        continue;
      }
      if (err instanceof Error && err.message.includes("【说明】")) throw err;
      throw new Error(formatVisionUpstreamError(msg, model));
    }
  }
  throw new Error(formatVisionUpstreamError(lastError, model));
}

function buildWashPromptWithCharacter(reversePrompt: string, stylePrompt: string, markers?: number[]): string {
  const cleanPrompt = sanitizeReversePrompt(reversePrompt);
  const list = (markers || []).filter((m) => m >= 1);
  const markerNote = ` ${replicaAnnotationStripNote(list)}`;
  const base = `在保持图1的构图、角色 blocking 与光影氛围的前提下，重新绘制一张全新图片（允许材质、纹理与细节呈现差异，避免贴图式复制原图）。角色姿势、表情与眼神朝向参考图1。画面内容参考：${cleanPrompt.trim()}${markerNote}。${REPLICA_SHEET_OUTPUT_BAN}`;
  const style = String(stylePrompt || "").trim();
  if (style) return `${base}\n\n风格限定：${style}`;
  return base;
}

function buildWashPromptEmptyShot(reversePrompt: string, stylePrompt: string): string {
  const cleanPrompt = sanitizeReversePrompt(reversePrompt);
  const base = `在保持图1整体构图、透视关系与光影氛围的前提下，重新绘制一张全新场景图（允许材质、纹理与细节差异，不要贴图复制，不要保留任何 UI 文字、logo、水印、emoji 气泡或标注贴纸）。画面内容参考：${cleanPrompt.trim()}`;
  const style = String(stylePrompt || "").trim();
  if (style) return `${base}\n\n风格限定：${style}`;
  return base;
}

function buildSwapPrompt(stylePrompt: string, markers?: number[], refImageCount = 1): string {
  const style = String(stylePrompt || "").trim();
  const styleSuffix = style ? `\n\n风格限定：${style}` : "";
  const stripNote = replicaAnnotationStripNote(markers);
  const list = (markers || []).filter((m) => m >= 1);
  const compositeNote =
    refImageCount === 1 && list.length > 1 ? `\n\n${buildCompositeRefSheetNote(list)}` : "";
  if (!list.length) {
    return `${GPT_IMAGE2_SWAP_TEMPLATE}\n\n${stripNote}\n\n${REPLICA_SHEET_OUTPUT_BAN}${styleSuffix}`;
  }
  if (list.length === 1) {
    const m = list[0];
    const mark = markerCircled(m);
    return (
      `完全保留图1（中转图）的景别、背景、画风、构图和光影。仅将图1中标注为 ${mark} 或数字 ${m} 的角色主体（面部/五官/体型/服装等）` +
      `替换为图2（角色参考图）中同样标注为 ${mark} 或 ${m} 的角色特征；图1中其他未标注角色必须完全保持原样。` +
      `若图2是三视图/对照表，只提取正面造型的服装与五官融入图1单镜头画面，禁止输出三视图拼图或对照表版式。` +
      `确保该角色眼神朝向、blocking 与图1一致。${stripNote}${compositeNote}\n\n${REPLICA_SHEET_OUTPUT_BAN}${styleSuffix}`
    );
  }
  const marks = list.map(markerCircled).join("、");
  const digits = list.join("、");
  const refNote =
    refImageCount > 1
      ? `图2至图${refImageCount + 1}为角色参考图，各图以圈号或数字标注对应角色。`
      : "图2为角色对照表（character sheet）。";
  return `完全保留图1（中转图）的背景、画风、构图和光影。${refNote}请将图1中标注为圈号 ${marks}（或数字 ${digits}）的各角色，分别替换为参考图中同编号角色的外观；未选中的编号角色保持原样。禁止追加图1中原本不存在的角色。${stripNote}${compositeNote}${styleSuffix}`;
}

function normalizeUpstreamPrompts(raw: unknown): string {
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item || "").trim()).filter(Boolean).join("\n\n");
  }
  return String(raw || "").trim();
}

/** 画布 ratio 键 → RunningHub gpt-image-2 宽高比；默认 wide（16:9，适配横屏视频帧） */
function canvasRatioToAspectRatio(body: ReplicaAgentRunBody): string {
  const key = String(body.canvas_ratio || "wide").trim() || "wide";
  if (/^\d+:\d+$/.test(key)) return key;
  if (key === "custom" && body.canvas_custom_ratio) {
    const raw = String(body.canvas_custom_ratio).trim();
    if (raw.includes(":")) return raw;
    const m = raw.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      const ratio = w / h;
      if (ratio > 1.05) return "16:9";
      if (ratio < 0.95) return "9:16";
      return "1:1";
    }
  }
  return CANVAS_RATIO_TO_ASPECT[key] || "16:9";
}

function toCanvasUploadPath(raw: string): string {
  const url = String(raw || "").trim();
  if (!url || url.startsWith("data:")) return url;
  if (url.startsWith("/uploads/")) return url;
  try {
    const u = new URL(url);
    if (u.pathname.startsWith("/uploads/")) return u.pathname;
  } catch {
    /* ignore */
  }
  return url;
}

function normalizeReplicaRunBody(body: ReplicaAgentRunBody): {
  backgroundUrl: string;
  characterUrl: string;
  characterUrls: string[];
  stylePrompt: string;
  geminiModel?: string;
  imageSize: string;
  aspectRatio: string;
} {
  const backgroundUrl = toCanvasUploadPath(String(body.background_image_url || body.background_url || "").trim());
  const charArray = Array.isArray(body.character_image_urls)
    ? body.character_image_urls.map((u) => toCanvasUploadPath(String(u || "").trim())).filter(Boolean)
    : [];
  const singleChar = toCanvasUploadPath(String(body.character_image_url || body.character_url || "").trim());
  const characterUrls = charArray.length ? charArray : singleChar ? [singleChar] : [];
  const upstream = normalizeUpstreamPrompts(body.upstream_prompts);
  const styleParts = [String(body.style_prompt || "").trim(), upstream].filter(Boolean);
  return {
    backgroundUrl,
    characterUrl: characterUrls[0] || "",
    characterUrls,
    stylePrompt: styleParts.join("\n\n"),
    geminiModel: body.gemini_model,
    imageSize: String(body.canvas_resolution || "2K").trim() || "2K",
    aspectRatio: canvasRatioToAspectRatio(body),
  };
}

function stageLabelForStatus(status: ReplicaAgentTaskStatus, task?: ReplicaAgentTask): string {
  if (status === "processing_stage1") return "正在进行第一阶段洗图…";
  if (status === "processing_stage2") return "正在换人…";
  if (status === "completed") {
    if (task?.skipped_stage2) {
      if (task.has_character) return "完成（未提供角色参考图，已跳过换人）";
      return "完成（空镜头，已跳过换人）";
    }
    return "完成";
  }
  if (status === "failed") return "失败";
  return "";
}

/** 是否进入完整双阶段：用户提供了至少一张角色参考图即执行换人 */
function shouldRunStage2(_analysis: GeminiReplicaAnalysis, characterUrls: string[]): boolean {
  return characterUrls.some((u) => Boolean(String(u || "").trim()));
}

/** 洗图阶段是否按「有角色 blocking」处理（含用户已提供角色参考但 VLM 误判为空镜的情况） */
function shouldUseCharacterWashPrompt(analysis: GeminiReplicaAnalysis, characterUrls: string[]): boolean {
  const hasRefs = characterUrls.some((u) => Boolean(String(u || "").trim()));
  return analysis.has_character || hasRefs;
}

async function runReplicaAgentTask(
  taskId: string,
  req: Request,
  body: ReplicaAgentRunBody,
  deps: ReplicaAgentBridgeDeps
) {
  const task = tasks.get(taskId);
  if (!task) return;

  const normalized = normalizeReplicaRunBody(body);
  // 传给 RunningHub 时用 /uploads 相对路径，由 resolveInputsToRunningHubUrls 读本地并上传到 RH
  const backgroundInput = normalizeImageInputForUpload(normalized.backgroundUrl, deps.projectRoot);
  const characterInputs = normalized.characterUrls
    .map((url) => normalizeImageInputForUpload(url, deps.projectRoot))
    .filter(Boolean);
  const stylePrompt = normalized.stylePrompt;
  const imageSize = normalized.imageSize;
  const aspectRatio = normalized.aspectRatio;
  const targetMarkers = normalizeTargetMarkers(body);

  if (!getStoryboardImageEnv()) {
    task.status = "failed";
    task.error = "未配置 STORYBOARD_IMAGE_API_KEY，无法调用 gpt-image-2（RunningHub）";
    task.updated_at = Date.now();
    return;
  }

  try {
    task.status = "processing_stage1";
    task.stage_label = "正在分析画面…";
    task.updated_at = Date.now();

    const analysis = await runGeminiVisionAnalysis({
      req,
      projectRoot: deps.projectRoot,
      imageUrl: backgroundInput,
      model: normalized.geminiModel,
      targetMarkers: characterInputs.length ? targetMarkers : undefined,
    });
    const rawReverse = analysis.reverse_prompt;
    analysis.reverse_prompt = sanitizeReversePrompt(rawReverse);
    const swapMarkers = effectiveTargetMarkers(targetMarkers, rawReverse);
    task.has_character = analysis.has_character;
    task.reverse_prompt = analysis.reverse_prompt;

    if (looksLikeCharacterSheetReversePrompt(analysis.reverse_prompt)) {
      throw new Error(
        "图1（背景/构图参考）被识别为「角色三视图/对照表」，不是分镜关键帧。请在复刻 Agent「角色映射」中：海滩/分镜图 → 背景/构图参考，三视图 → 角色参考，并确保第一张连线为构图图。删除 Output 中旧结果后重试。"
      );
    }

    const hasCharacterRef = characterInputs.length > 0;
    const runStage2 = shouldRunStage2(analysis, normalized.characterUrls);
    const useCharacterWash = shouldUseCharacterWashPrompt(analysis, normalized.characterUrls);
    task.route = runStage2 ? "full" : "wash_only";
    task.skipped_stage2 = !runStage2;
    if (hasCharacterRef && !analysis.has_character) {
      task.has_character = true;
    }
    if (swapMarkers.length !== targetMarkers.length) {
      console.log("[replica-agent] markers narrowed to frame subjects", {
        taskId,
        requested: targetMarkers,
        effective: swapMarkers,
        detected: extractSubjectsFromReversePrompt(rawReverse),
      });
    }

    task.stage_label = runStage2
      ? "正在进行第一阶段洗图…"
      : analysis.has_character
        ? "检测到角色但未提供角色图，仅洗图…"
        : "检测到空镜头，仅洗图（跳过换人）…";
    task.updated_at = Date.now();

    const washPrompt = useCharacterWash
      ? buildWashPromptWithCharacter(analysis.reverse_prompt, stylePrompt, swapMarkers)
      : buildWashPromptEmptyShot(analysis.reverse_prompt, stylePrompt);
    task.wash_prompt = washPrompt;

    console.log("[replica-agent] stage1 wash", {
      taskId,
      route: task.route,
      has_character: analysis.has_character,
      hasCharacterRef: characterInputs.length > 0,
      useCharacterWash,
      requestedMarkers: targetMarkers,
      swapMarkers,
      characterRefCount: characterInputs.length,
      backgroundInput: backgroundInput.slice(0, 80),
    });
    const washedUpstream = await runStoryboardRunningHubG2Job({
      prompt: washPrompt,
      images: [backgroundInput],
      image_size: imageSize,
      aspect_ratio: aspectRatio,
      projectRoot: deps.projectRoot,
    });
    task.washed_image_url = await deps.persistImage(washedUpstream);

    if (!runStage2) {
      task.final_image_url = task.washed_image_url;
      task.swap_prompt = "";
      task.status = "completed";
      task.stage_label = stageLabelForStatus("completed", task);
      task.updated_at = Date.now();
      console.log("[replica-agent] completed wash_only", { taskId, final: task.final_image_url });
      return;
    }

    task.status = "processing_stage2";
    task.stage_label = "正在换人…";
    task.updated_at = Date.now();
    const swapCharacterInputs = await prepareCharacterRefsForSwap(
      deps.projectRoot,
      characterInputs,
      deps.persistImage
    );
    const swapPrompt = buildSwapPrompt(stylePrompt, swapMarkers, swapCharacterInputs.length);
    task.swap_prompt = swapPrompt;

    console.log("[replica-agent] stage2 swap", {
      taskId,
      swapLen: swapPrompt.length,
      requestedMarkers: targetMarkers,
      swapMarkers,
      characterRefCount: swapCharacterInputs.length,
      croppedRefs: swapCharacterInputs.map((u) => u.slice(0, 80)),
    });
    const finalUpstream = await runStoryboardRunningHubG2Job({
      prompt: swapPrompt,
      images: [task.washed_image_url, ...swapCharacterInputs],
      image_size: imageSize,
      aspect_ratio: aspectRatio,
      projectRoot: deps.projectRoot,
    });
    task.final_image_url = await deps.persistImage(finalUpstream);

    task.status = "completed";
    task.stage_label = stageLabelForStatus("completed", task);
    task.updated_at = Date.now();
    console.log("[replica-agent] completed full", { taskId, final: task.final_image_url });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[replica-agent] failed:", taskId, msg);
    task.status = "failed";
    task.error = msg;
    task.stage_label = "失败";
    task.updated_at = Date.now();
  }
}

export function registerCanvasReplicaAgentRoutes(app: Express, deps: ReplicaAgentBridgeDeps) {
  const gate = deps.requireGate;
  app.post("/api/canvas/replica-agent-run", ...(gate ? [gate] : []), (req, res) => {
    const body = (req.body || {}) as ReplicaAgentRunBody;
    const { backgroundUrl } = normalizeReplicaRunBody(body);
    if (!backgroundUrl) {
      return res.status(400).json({ error: "缺少 background_image_url（图1 背景/构图参考）" });
    }

    const taskId = `replica_${uuidv4().replace(/-/g, "")}`;
    const now = Date.now();
    tasks.set(taskId, {
      id: taskId,
      status: "processing_stage1",
      stage_label: "正在分析画面…",
      route: "wash_only",
      has_character: false,
      skipped_stage2: false,
      created_at: now,
      updated_at: now,
      reverse_prompt: "",
      wash_prompt: "",
      swap_prompt: "",
      washed_image_url: "",
      final_image_url: "",
      error: "",
    });

    void runReplicaAgentTask(taskId, req, body, deps);
    return res.json({ task_id: taskId, status: "processing_stage1" });
  });

  app.get("/api/canvas/replica-agent-tasks/:taskId", ...(gate ? [gate] : []), (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) {
      return res.status(404).json({
        error: "复刻 Agent 任务不存在，可能服务已重启或任务已过期",
        status: "failed",
      });
    }
    return res.json({
      id: task.id,
      status: task.status,
      stage_label: task.stage_label || stageLabelForStatus(task.status, task),
      route: task.route,
      has_character: task.has_character,
      skipped_stage2: task.skipped_stage2,
      reverse_prompt: task.reverse_prompt || undefined,
      wash_prompt: task.wash_prompt || undefined,
      swap_prompt: task.swap_prompt || undefined,
      washed_image_url: task.washed_image_url || undefined,
      final_image_url: task.final_image_url || undefined,
      error: task.error || undefined,
      updated_at: task.updated_at,
    });
  });
}
