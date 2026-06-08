import type { Express, Request } from "express";
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
1. 判定画面中是否存在明显的【人类角色】（纯风景、空镜头、纯车辆、静物、雕像、动物、UI 界面，请判定为不存在；仅当存在可辨识的真人/类人角色时才判 true）。
2. 写一段英文场景描述 reverse_prompt，供后续「洗图」模型在参考构图与氛围的前提下重新绘制，而非逐像素复制原图。

# 核心规则
1. 如果【存在】人类角色：
   - 忽略具体长相，人物统一用占位符 "[Subject]" 代替。
   - 重点描述：景别、相机角度、主体在画面中的位置关系、背景环境类型、姿势与 blocking、表情与眼神朝向、整体光影基调与色彩氛围。
   - 不要罗列服装/logo/文字/UI 水印等易触发贴图复制的细节。
2. 如果【不存在】人类角色：
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

const GEMINI_VLM_USER_MESSAGE = `请分析这张视频关键帧（图1），并仅输出一个 JSON 对象。has_character 为布尔值；reverse_prompt 为英文逗号分隔描述短语（用于洗图重绘，勿写成原图像素级清单，勿包含图中文字/logo）。`;

const REPLICA_GEMINI_MODEL = "gemini-3.5-flash";

/** gpt-image-2 第二阶段换人提示词 */
const GPT_IMAGE2_SWAP_TEMPLATE = `完全保留图1（中转图）的背景、画风、构图和光影，将图1中的人物面部、发型、五官特征和服装，完全替换为图2（角色参考图）中的人物特征。确保新人物的眼神朝向和身体姿势与图1完全一致，生成一张完美的复刻图片。`;

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

function formatGeminiUpstreamError(rawMsg: string): string {
  const msg = String(rawMsg || "").trim();
  if (/upstream error|do request failed/i.test(msg)) {
    return `${msg}\n\n【说明】这是 Comfly（THIRD_PARTY_API_BASE）转发 Gemini 上游失败，与 localhost 图片无关。常见原因：网关瞬时故障、${REPLICA_GEMINI_MODEL} 排队或超时。请稍后重试；若持续失败请联系 Comfly 或暂时更换复刻 Agent 反推模型。`;
  }
  if (/high demand/i.test(msg)) {
    return `${msg}\n\n【说明】Gemini 模型当前访问量过高，请稍后重试。`;
  }
  return msg;
}

/**
 * Gemini 无法拉取 localhost；先压缩再优先上传到 RunningHub 拿公网 https URL，
 * 上传失败再回退压缩后的 JPEG base64。
 */
async function resolveImageForGeminiVision(projectRoot: string, rawUrl: string): Promise<string> {
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
      "背景参考图无法被 Gemini 读取：请使用本站 /uploads 图片，或提供公网可访问的 https 图片地址（localhost 不可用）"
    );
  }

  const rawBuf = await readImageBufferForGemini(projectRoot, normalized);
  const compressed = await compressImageForGeminiVision(rawBuf);
  const compressedDataUrl = `data:image/jpeg;base64,${compressed.toString("base64")}`;
  console.log("[replica-agent] Gemini vision image compressed", {
    rawKB: Math.round(rawBuf.length / 1024),
    jpegKB: Math.round(compressed.length / 1024),
  });

  const rhEnv = getStoryboardImageEnv();
  if (rhEnv) {
    try {
      const publicUrl = await uploadBinaryToRunningHub(rhEnv, compressedDataUrl, projectRoot);
      console.log("[replica-agent] Gemini vision image via RunningHub URL", { urlLen: publicUrl.length });
      return publicUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn("[replica-agent] RunningHub upload for Gemini failed, fallback to base64:", msg);
    }
  }

  return compressedDataUrl;
}

function textFromChatResponse(raw: Record<string, unknown>): string {
  const choices = raw.choices;
  if (!Array.isArray(choices) || !choices.length) return "";
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text || "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
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
  const reverse_prompt = String(obj.reverse_prompt || "").trim();
  if (!reverse_prompt) throw new Error("Gemini JSON 缺少有效的 reverse_prompt");
  const has_character = obj.has_character === true;
  return { has_character, reverse_prompt };
}

async function runGeminiVisionAnalysis(opts: {
  req: Request;
  projectRoot: string;
  imageUrl: string;
  model?: string;
}): Promise<GeminiReplicaAnalysis> {
  const apiBase = (process.env.THIRD_PARTY_API_BASE || "").trim().replace(/\/$/, "");
  const apiKey = (process.env.THIRD_PARTY_API_KEY || "").trim();
  if (!apiBase || !apiKey) {
    throw new Error("缺少 Gemini 配置：请在 .env 中设置 THIRD_PARTY_API_BASE 与 THIRD_PARTY_API_KEY");
  }
  const model =
    String(opts.model || "").trim() ||
    REPLICA_GEMINI_MODEL ||
    (process.env.TEXT_MODEL || "").trim();
  const resolved = await resolveImageForGeminiVision(opts.projectRoot, opts.imageUrl);
  if (!resolved) throw new Error("无法读取背景参考图");
  if (/^https?:\/\//i.test(resolved) && !isPublicRunningHubImageUrl(resolved)) {
    throw new Error(
      "背景参考图无法被 Gemini 读取：本地开发地址（如 localhost:3005）不能传给云端，请刷新页面后重试；若仍失败请重启 npm run dev"
    );
  }

  // 与 Comfly「Chat(分析图片)」文档一致：单条 user 消息，content 为 [text, image_url]
  const visionPrompt = `${GEMINI_VLM_SYSTEM}\n\n${GEMINI_VLM_USER_MESSAGE}`;
  const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
    { type: "text", text: visionPrompt },
    { type: "image_url", image_url: { url: resolved } },
  ];

  const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 300000);
  const maxRetries = Math.max(0, Number(process.env.GEMINI_VISION_MAX_RETRIES || 3));
  const payload = JSON.stringify({
    model,
    stream: false,
    messages: [{ role: "user", content: contentParts }],
    max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 4096),
  });
  console.log("[replica-agent] Gemini vision request", {
    model,
    imageMode: resolved.startsWith("data:") ? "base64" : "url",
    payloadKB: Math.round(payload.length / 1024),
  });

  let lastError = "Gemini 接口未知错误";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await fetch(`${apiBase}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: payload,
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
        throw new Error(formatGeminiUpstreamError(errMsg));
      }
      const text = textFromChatResponse(data).trim();
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
      throw new Error(formatGeminiUpstreamError(msg));
    }
  }
  throw new Error(formatGeminiUpstreamError(lastError));
}

function buildWashPromptWithCharacter(reversePrompt: string, stylePrompt: string): string {
  const base = `在保持图1的构图、角色 blocking 与光影氛围的前提下，重新绘制一张全新图片（允许材质、纹理与细节呈现差异，避免贴图式复制原图）。角色姿势、表情与眼神朝向参考图1。画面内容参考：${reversePrompt.trim()}`;
  const style = String(stylePrompt || "").trim();
  if (style) return `${base}\n\n风格限定：${style}`;
  return base;
}

function buildWashPromptEmptyShot(reversePrompt: string, stylePrompt: string): string {
  const base = `在保持图1整体构图、透视关系与光影氛围的前提下，重新绘制一张全新场景图（允许材质、纹理与细节差异，不要贴图复制，不要保留任何 UI 文字、logo 或水印）。画面内容参考：${reversePrompt.trim()}`;
  const style = String(stylePrompt || "").trim();
  if (style) return `${base}\n\n风格限定：${style}`;
  return base;
}

function buildSwapPrompt(stylePrompt: string): string {
  const style = String(stylePrompt || "").trim();
  if (style) return `${GPT_IMAGE2_SWAP_TEMPLATE}\n\n风格限定：${style}`;
  return GPT_IMAGE2_SWAP_TEMPLATE;
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
  stylePrompt: string;
  geminiModel?: string;
  imageSize: string;
  aspectRatio: string;
} {
  const backgroundUrl = toCanvasUploadPath(String(body.background_image_url || body.background_url || "").trim());
  const characterUrl = toCanvasUploadPath(String(body.character_image_url || body.character_url || "").trim());
  const upstream = normalizeUpstreamPrompts(body.upstream_prompts);
  const styleParts = [String(body.style_prompt || "").trim(), upstream].filter(Boolean);
  return {
    backgroundUrl,
    characterUrl,
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

/** 是否进入完整双阶段：Gemini 判定有人物 且 用户提供了角色参考图 */
function shouldRunStage2(analysis: GeminiReplicaAnalysis, characterUrl: string): boolean {
  return analysis.has_character && Boolean(String(characterUrl || "").trim());
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
  const characterInput = normalized.characterUrl
    ? normalizeImageInputForUpload(normalized.characterUrl, deps.projectRoot)
    : "";
  const stylePrompt = normalized.stylePrompt;
  const imageSize = normalized.imageSize;
  const aspectRatio = normalized.aspectRatio;

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
    });
    task.has_character = analysis.has_character;
    task.reverse_prompt = analysis.reverse_prompt;

    const runStage2 = shouldRunStage2(analysis, characterInput);
    task.route = runStage2 ? "full" : "wash_only";
    task.skipped_stage2 = !runStage2;

    task.stage_label = runStage2
      ? "正在进行第一阶段洗图…"
      : analysis.has_character
        ? "检测到人物但未提供角色图，仅洗图…"
        : "检测到空镜头，仅洗图（跳过换人）…";
    task.updated_at = Date.now();

    const washPrompt = runStage2
      ? buildWashPromptWithCharacter(analysis.reverse_prompt, stylePrompt)
      : buildWashPromptEmptyShot(analysis.reverse_prompt, stylePrompt);
    task.wash_prompt = washPrompt;

    console.log("[replica-agent] stage1 wash", {
      taskId,
      route: task.route,
      has_character: analysis.has_character,
      hasCharacterRef: Boolean(characterInput),
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
    const swapPrompt = buildSwapPrompt(stylePrompt);
    task.swap_prompt = swapPrompt;

    console.log("[replica-agent] stage2 swap", { taskId, swapLen: swapPrompt.length });
    const finalUpstream = await runStoryboardRunningHubG2Job({
      prompt: swapPrompt,
      images: [task.washed_image_url, characterInput],
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
  app.post("/api/canvas/replica-agent-run", (req, res) => {
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

  app.get("/api/canvas/replica-agent-tasks/:taskId", (req, res) => {
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
