import type { Express, Request, RequestHandler } from "express";
import { existsSync, readFileSync } from "fs";
import path from "path";
import sharp from "sharp";
import { v4 as uuidv4 } from "uuid";
import {
  augmentChatCompletionsBody,
  extractTextLlmMessageContent,
  isApimartGeminiFlashModel,
  isRunningHubChatModel,
  postTextLlm,
  resolveTextLlmEnv,
  textLlmConfigError,
} from "./canvasTextLlmBridge.js";
import {
  getNineGridG2Path,
  getStoryboardImageEnv,
  isPublicRunningHubImageUrl,
  normalizeImageInputForUpload,
  RUNNINGHUB_G2_OFFICIAL_I2I_PATH,
  runStoryboardRunningHubG2Job,
  runStoryboardRunningHubJob,
  uploadBinaryToRunningHub,
} from "./runningHubStoryboardImage.js";

export const IMAGE_REPAIR_REVERSE_USER_PROMPT =
  "帮我从生成逻辑出发反推画面背后的生成逻辑以中文提示词的形式给我。";
export const IMAGE_REPAIR_LINEART_PROMPT =
  "把原图转化为干净流畅的纯线稿,仅保留黑白两色确保黑白层次清晰、色彩关系明确,去除多余杂色与渐变，画面不要有饱和度。";
export const IMAGE_REPAIR_BLUR_PROMPT = "完全高斯模糊整张图，其他不变。";

export function buildImageRepairFinalPrompt(reversedPrompt: string): string {
  const body = String(reversedPrompt || "").trim();
  return `请你根据以下提示词,还原图片1线稿,并且根据图片2物体固有色进行上色，最后生图：${body}`;
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

type ImageRepairTaskStatus =
  | "processing_reverse"
  | "processing_lineart"
  | "processing_blur"
  | "processing_composite"
  | "completed"
  | "failed"
  | "cancelled";

type ImageRepairTask = {
  id: string;
  status: ImageRepairTaskStatus;
  stage_label: string;
  created_at: number;
  updated_at: number;
  reversed_prompt: string;
  lineart_image_url: string;
  blur_image_url: string;
  final_image_url: string;
  error: string;
};

function isImageRepairTaskCancelled(task: ImageRepairTask): boolean {
  return (task as { status: string }).status === "cancelled";
}

export type ImageRepairAgentRunBody = {
  source_image_url?: string;
  text_model?: string;
  image_model?: string;
  canvas_resolution?: string;
  canvas_ratio?: string;
  canvas_custom_ratio?: string;
  reverse_prompt?: string;
  lineart_prompt?: string;
  blur_prompt?: string;
};

export type ImageRepairAgentBridgeDeps = {
  projectRoot: string;
  persistImage: (url: string, meta?: { userId?: string }) => Promise<string>;
  requireGate?: RequestHandler;
};

const tasks = new Map<string, ImageRepairTask>();

const VISION_MAX_EDGE = Math.max(512, Number(process.env.GEMINI_VISION_MAX_EDGE || 1536) || 1536);
const VISION_JPEG_QUALITY = Math.min(95, Math.max(50, Number(process.env.GEMINI_VISION_JPEG_QUALITY || 82) || 82));

function canvasRatioToAspectRatio(body: ImageRepairAgentRunBody): string {
  const key = String(body.canvas_ratio || "wide").trim() || "wide";
  if (/^\d+:\d+$/.test(key)) return key;
  if (key === "custom" && body.canvas_custom_ratio) {
    const raw = String(body.canvas_custom_ratio).trim();
    if (raw.includes(":")) return raw;
  }
  return CANVAS_RATIO_TO_ASPECT[key] || "16:9";
}

function toCanvasUploadPath(raw: string): string {
  const url = String(raw || "").trim();
  if (!url) return "";
  if (url.startsWith("/uploads/")) return url;
  return normalizeImageInputForUpload(url, "");
}

function isGptImage2Model(model?: string): boolean {
  return /^gpt-image-2(-稳定)?$/i.test(String(model || "").trim());
}

function isGptImage2Stable(model?: string): boolean {
  return /^gpt-image-2-稳定$/i.test(String(model || "").trim());
}

function normalizeImageModel(model?: string): string {
  const m = String(model || "").trim();
  if (isGptImage2Stable(m)) return "gpt-image-2-稳定";
  if (isGptImage2Model(m)) return "gpt-image-2";
  return "nano-banana-pro";
}

async function compressForVision(input: Buffer): Promise<Buffer> {
  return sharp(input)
    .rotate()
    .resize({
      width: VISION_MAX_EDGE,
      height: VISION_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: VISION_JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}

async function readImageBuffer(projectRoot: string, input: string): Promise<Buffer> {
  const trimmed = String(input || "").trim();
  const dataMatch = /^data:(image\/[^;]+);base64,(.+)$/is.exec(trimmed);
  if (dataMatch) return Buffer.from(dataMatch[2].replace(/\s/g, ""), "base64");
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
  throw new Error("无法读取图片");
}

function formatVisionUpstreamError(rawMsg: string, model: string): string {
  const msg = String(rawMsg || "").trim();
  if (
    isApimartGeminiFlashModel(model) &&
    /fetch failed|econnreset|enotfound|etimedout|und_err_connect_timeout|timeout|timed out|aborted/i.test(msg)
  ) {
    return `无法连接 APIMart（api.apimart.ai）：${msg}

【说明】修图 Agent 第一步「反推生成逻辑」会调用 APIMart Chat Completions API。当前环境无法连通该域名（TCP 443 超时），常见于未配置可访问外网的代理/VPN。

可行方案：
1. 开启能访问 api.apimart.ai 的网络后重试；
2. 在节点内将「文本模型」改为 glm-5.1（走 RunningHub，本机网络已可连通）。`;
  }
  if (isRunningHubChatModel(model) && /upstream error|do request failed/i.test(msg)) {
    return `${msg}\n\n【说明】RunningHub 上游瞬时故障或排队，请稍后重试。`;
  }
  return msg;
}

async function resolveImageForVision(projectRoot: string, rawUrl: string, model?: string): Promise<string> {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (/^https?:\/\//i.test(url) && isPublicRunningHubImageUrl(url)) return url;

  const normalized = url.startsWith("data:") ? url : normalizeImageInputForUpload(url, projectRoot);
  const rawBuf = await readImageBuffer(projectRoot, normalized);
  const compressed = await compressForVision(rawBuf);
  const dataUrl = `data:image/jpeg;base64,${compressed.toString("base64")}`;

  if (isRunningHubChatModel(model || "") || isApimartGeminiFlashModel(model || "")) return dataUrl;

  const rhEnv = getStoryboardImageEnv();
  if (rhEnv) {
    try {
      return await uploadBinaryToRunningHub(rhEnv, dataUrl, projectRoot);
    } catch (err) {
      console.warn("[image-repair-agent] vision upload fallback base64:", err);
    }
  }
  return dataUrl;
}

async function runVisionReversePrompt(opts: {
  req: Request;
  projectRoot: string;
  imageUrl: string;
  model?: string;
  userPrompt: string;
}): Promise<string> {
  const model = String(opts.model || process.env.TEXT_MODEL || "gemini-3.5-flash").trim();
  const { apiBase, apiKey } = resolveTextLlmEnv(model);
  if (!apiBase || !apiKey) throw new Error(textLlmConfigError(model));

  const resolved = await resolveImageForVision(opts.projectRoot, opts.imageUrl, model);
  if (!resolved) throw new Error("无法读取待修复图片");

  const system =
    "你是专业的 AI 绘画提示词分析师。请根据用户上传的图片，用中文输出一段可直接用于文生图/图生图的提示词，描述画面的主体、构图、风格、光影与色彩。只输出提示词正文，不要 Markdown、不要编号列表、不要解释。";
  const requestBody = augmentChatCompletionsBody(model, {
    model,
    stream: false,
    messages: [
      { role: "system", content: system },
      {
        role: "user",
        content: [
          { type: "text", text: String(opts.userPrompt || IMAGE_REPAIR_REVERSE_USER_PROMPT).trim() },
          { type: "image_url", image_url: { url: resolved } },
        ],
      },
    ],
    max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 4096),
  });

  const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 300000);
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
        `视觉模型错误 (${response.status})`;
      throw new Error(errMsg);
    }
    const text = extractTextLlmMessageContent(model, data).trim();
    if (!text) throw new Error("反推提示词返回空内容");
    return text.replace(/^```[\s\S]*?```$/m, "").trim();
  } catch (err) {
    clearTimeout(timer);
    const raw = err instanceof Error ? err.message : String(err);
    throw new Error(formatVisionUpstreamError(raw, model));
  }
}

async function runImageEditJob(opts: {
  prompt: string;
  images: string[];
  imageModel: string;
  imageSize: string;
  aspectRatio: string;
  projectRoot: string;
}): Promise<string> {
  if (isGptImage2Model(opts.imageModel)) {
    const pathOverride = isGptImage2Stable(opts.imageModel)
      ? getNineGridG2Path() || RUNNINGHUB_G2_OFFICIAL_I2I_PATH
      : undefined;
    return runStoryboardRunningHubG2Job({
      prompt: opts.prompt,
      images: opts.images,
      image_size: opts.imageSize,
      aspect_ratio: opts.aspectRatio,
      projectRoot: opts.projectRoot,
      pathOverride,
    });
  }
  return runStoryboardRunningHubJob({
    prompt: opts.prompt,
    images: opts.images,
    image_size: opts.imageSize,
    aspect_ratio: opts.aspectRatio,
    projectRoot: opts.projectRoot,
  });
}

function normalizeRunBody(body: ImageRepairAgentRunBody) {
  return {
    sourceUrl: toCanvasUploadPath(String(body.source_image_url || "").trim()),
    textModel: String(body.text_model || "").trim(),
    imageModel: normalizeImageModel(body.image_model),
    imageSize: String(body.canvas_resolution || "2k").trim() || "2k",
    aspectRatio: canvasRatioToAspectRatio(body),
    reversePrompt: String(body.reverse_prompt || IMAGE_REPAIR_REVERSE_USER_PROMPT).trim(),
    lineartPrompt: String(body.lineart_prompt || IMAGE_REPAIR_LINEART_PROMPT).trim(),
    blurPrompt: String(body.blur_prompt || IMAGE_REPAIR_BLUR_PROMPT).trim(),
  };
}

async function runImageRepairTask(
  taskId: string,
  req: Request,
  body: ImageRepairAgentRunBody,
  deps: ImageRepairAgentBridgeDeps
) {
  const task = tasks.get(taskId);
  if (!task) return;

  const persistOwned = (url: string, meta?: { userId?: string }) =>
    deps.persistImage(url, { ...meta, userId: req.authUser?.id ?? meta?.userId });

  const normalized = normalizeRunBody(body);
  const sourceInput = normalizeImageInputForUpload(normalized.sourceUrl, deps.projectRoot);
  if (!sourceInput) {
    task.status = "failed";
    task.error = "缺少待修复图片";
    task.stage_label = "失败";
    task.updated_at = Date.now();
    return;
  }

  if (!getStoryboardImageEnv()) {
    task.status = "failed";
    task.error = "未配置 STORYBOARD_IMAGE_API_KEY，无法调用生图接口";
    task.stage_label = "失败";
    task.updated_at = Date.now();
    return;
  }

  try {
    task.status = "processing_reverse";
    task.stage_label = "正在反推生成逻辑…";
    task.updated_at = Date.now();

    const reversed = await runVisionReversePrompt({
      req,
      projectRoot: deps.projectRoot,
      imageUrl: sourceInput,
      model: normalized.textModel,
      userPrompt: normalized.reversePrompt,
    });
    if (isImageRepairTaskCancelled(task)) return;
    task.reversed_prompt = reversed;

    task.status = "processing_lineart";
    task.stage_label = "正在提取线稿…";
    task.updated_at = Date.now();
    const lineartUpstream = await runImageEditJob({
      prompt: normalized.lineartPrompt,
      images: [sourceInput],
      imageModel: normalized.imageModel,
      imageSize: normalized.imageSize,
      aspectRatio: normalized.aspectRatio,
      projectRoot: deps.projectRoot,
    });
    if (isImageRepairTaskCancelled(task)) return;
    task.lineart_image_url = await persistOwned(lineartUpstream);

    task.status = "processing_blur";
    task.stage_label = "正在生成模糊固有色参考…";
    task.updated_at = Date.now();
    const blurUpstream = await runStoryboardRunningHubG2Job({
      prompt: normalized.blurPrompt,
      images: [sourceInput],
      image_size: normalized.imageSize,
      aspect_ratio: normalized.aspectRatio,
      projectRoot: deps.projectRoot,
    });
    if (isImageRepairTaskCancelled(task)) return;
    task.blur_image_url = await persistOwned(blurUpstream);

    task.status = "processing_composite";
    task.stage_label = "正在合成修复画面…";
    task.updated_at = Date.now();
    const finalPrompt = buildImageRepairFinalPrompt(reversed);
    const compositeUpstream = await runImageEditJob({
      prompt: finalPrompt,
      images: [task.lineart_image_url, task.blur_image_url],
      imageModel: normalized.imageModel,
      imageSize: normalized.imageSize,
      aspectRatio: normalized.aspectRatio,
      projectRoot: deps.projectRoot,
    });
    if (isImageRepairTaskCancelled(task)) return;
    task.final_image_url = await persistOwned(compositeUpstream);

    task.status = "completed";
    task.stage_label = "完成";
    task.updated_at = Date.now();
    console.log("[image-repair-agent] completed", { taskId, final: task.final_image_url });
  } catch (err) {
    if (isImageRepairTaskCancelled(task)) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[image-repair-agent] failed:", taskId, msg);
    task.status = "failed";
    task.error = msg;
    task.stage_label = "失败";
    task.updated_at = Date.now();
  }
}

export function registerCanvasImageRepairAgentRoutes(app: Express, deps: ImageRepairAgentBridgeDeps) {
  const gate = deps.requireGate;
  app.post("/api/canvas/image-repair-agent-run", ...(gate ? [gate] : []), (req, res) => {
    const body = (req.body || {}) as ImageRepairAgentRunBody;
    const { sourceUrl } = normalizeRunBody(body);
    if (!sourceUrl) {
      return res.status(400).json({ error: "缺少 source_image_url（待修复图片）" });
    }

    const taskId = `repair_${uuidv4().replace(/-/g, "")}`;
    const now = Date.now();
    tasks.set(taskId, {
      id: taskId,
      status: "processing_reverse",
      stage_label: "正在反推生成逻辑…",
      created_at: now,
      updated_at: now,
      reversed_prompt: "",
      lineart_image_url: "",
      blur_image_url: "",
      final_image_url: "",
      error: "",
    });

    void runImageRepairTask(taskId, req, body, deps);
    return res.json({ task_id: taskId, status: "processing_reverse" });
  });

  app.get("/api/canvas/image-repair-agent-tasks/:taskId", ...(gate ? [gate] : []), (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) {
      return res.status(404).json({
        error: "修图 Agent 任务不存在，可能服务已重启或任务已过期",
        status: "failed",
      });
    }
    return res.json({
      id: task.id,
      status: task.status,
      stage_label: task.stage_label,
      reversed_prompt: task.reversed_prompt || undefined,
      lineart_image_url: task.lineart_image_url || undefined,
      blur_image_url: task.blur_image_url || undefined,
      final_image_url: task.final_image_url || undefined,
      error: task.error || undefined,
    });
  });

  app.post("/api/canvas/image-repair-agent-tasks/:taskId/cancel", ...(gate ? [gate] : []), (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) {
      return res.status(404).json({ error: "修图 Agent 任务不存在", status: "failed" });
    }
    if (task.status === "completed" || task.status === "failed" || task.status === "cancelled") {
      return res.json({ id: task.id, status: task.status });
    }
    task.status = "cancelled";
    task.error = "已取消";
    task.stage_label = "已取消";
    task.updated_at = Date.now();
    return res.json({ id: task.id, status: "cancelled" });
  });
}
