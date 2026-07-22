import { config as loadDotenv } from "dotenv";
import { v4 as uuidv4 } from "uuid";
import { existsSync, mkdirSync, readFileSync } from "fs";
import { writeFile } from "fs/promises";
import express from "express";
import Database from "better-sqlite3";
import { Agent, setGlobalDispatcher, FormData } from "undici";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import {
  registerInfiniteCanvasRoutes,
} from "./src/services/infiniteCanvasRoutes.js";
import {
  analyzeNineGridReferenceLooks,
  formatNineGridRefLooksForPhaseA,
} from "./src/services/canvasNineGridBridge.js";
import {
  augmentChatCompletionsBody,
  extractTextLlmMessageContent,
  parseTextLlmResponseBody,
  postTextLlm,
  resolveTextLlmEnv,
  textLlmConfigError,
} from "./src/services/canvasTextLlmBridge.js";
import { buildNineGridImagePrompt, buildNineGridShotExpandRetryMessage, mapNineGridShotsFromLlm, NINE_GRID_JSON_OUTPUT_CONSTRAINT, NINE_GRID_SHOT_PROMPT_MIN_CHARS, nineGridShotsBelowMinChars } from "./src/lib/nineGrid/nineGridCore.js";
import {
  getNineGridG2Path,
  getStoryboardImageEnv,
  runStoryboardRunningHubGenerateJob,
  runStoryboardRunningHubG2Job,
  runStoryboardRunningHubJob,
} from "./src/services/runningHubStoryboardImage.js";
import {
  bootstrapAdminUser,
  createRequireAuth,
  createRequireAdmin,
  initUserAuthSchema,
  registerUserAuthRoutes,
  validateAuthForDeploy,
} from "./src/services/userAuth.js";
import {
  initStudioAnnouncementsSchema,
  registerStudioAnnouncementRoutes,
} from "./src/services/studioAnnouncements.js";
import {
  initCanvasGenerationsSchema,
  registerCanvasGenerationsRoutes,
  createPersistImageHandler,
  backfillLegacyGeneratedImageOwnership,
  recordFileOwnership,
} from "./src/services/canvasGenerations.js";
import {
  registerProtectedUploadRoutes,
  publicStaticExceptUploads,
} from "./src/services/protectedUploads.js";

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
validateAuthForDeploy();

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

function getGptEditEnv(): { apiBase: string; apiKey: string } {
  const base =
    (process.env.GPT_IMAGE_EDIT_API_BASE ?? "").trim() ||
    (process.env.THIRD_PARTY_API_BASE ?? "").trim();
  let key = (process.env.GPT_IMAGE_EDIT_API_KEY ?? "").trim();
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  if (!key) {
    key = (process.env.THIRD_PARTY_API_KEY ?? "").trim();
    if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  }
  return { apiBase: base, apiKey: key };
}

function getGridEnv(): { apiBase: string; apiKey: string } {
  const gridBase = (process.env.IMAGE_GRID_API_BASE ?? "").trim();
  const tpBase = (process.env.THIRD_PARTY_API_BASE ?? "").trim();
  const apiBase = gridBase || tpBase;

  let key = (process.env.IMAGE_GRID_API_KEY ?? "").trim();
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  if (!key) {
    key = (process.env.THIRD_PARTY_API_KEY ?? "").trim();
    if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  }
  return { apiBase, apiKey: key };
}

/** 九宫格 Phase A（剧本→9 条 prompt）：可与主页 THIRD_PARTY 使用不同令牌 */
function getNineGridTextEnv(model?: string): { apiBase: string; apiKey: string } {
  return resolveTextLlmEnv(model);
}

/** 分镜页 / 九宫格 Phase A 文本：共用 NINE_GRID_TEXT_*，缺省回退 THIRD_PARTY_* */
function getStoryboardTextEnv(model?: string): { apiBase: string; apiKey: string } {
  return getNineGridTextEnv(model);
}

function resolveStoryboardTextModel(requested?: string): string {
  return resolveNineGridTextModel(requested);
}

/** 与画布 Batch Poster Agent 一致：优先 gemini-3.5-flash，避开无渠道的 gemini-3.1-pro-preview */
function resolveNineGridTextModel(requested?: string): string {
  const explicit = String(requested || process.env.NINE_GRID_TEXT_MODEL || "").trim();
  if (explicit) return explicit;
  const textModel = String(process.env.TEXT_MODEL || "").trim();
  if (textModel && !/^gemini-3\.1-pro-preview$/i.test(textModel)) return textModel;
  return "gemini-3.5-flash";
}

/**
 * /images/generations 与剧本、对话通常走同一套 THIRD_PARTY 网关。
 * 若同时配置了 IMAGE_GRID_*（九宫格/edits 专用），优先用 THIRD_PARTY，避免文生图误打到仅支持 edits 的地址。
 * 仅当 THIRD_PARTY 未配全时，再回退到 getGridEnv()。
 */
function getGenerateImageEnv(): { apiBase: string; apiKey: string } {
  const tp = getThirdPartyEnv();
  if (tp.apiBase && tp.apiKey) return tp;
  return getGridEnv();
}

function readPromptFile(relativePath: string, baseDir: string): string {
  try {
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

/** 网关 504：多为上游生图过久，中转在限时内未收到响应而断开 */
function appendImageEdit504Hint(details: string): string {
  const d = String(details || "").trim();
  if (!d || !/\b504\b/i.test(d)) return d || details;
  return `${d}\n\n【说明】HTTP 504 通常为 API 网关在超时时间内未等到上游生图完成。可尝试：GPT 输出尺寸改小（如 1024）；参考图只留 1 张；稍后重试；或向中转方确认 gpt-image-2 的 /images/edits 超时与队列策略。`;
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

/**
 * 分镜文案里常见的 @资产N_、@图N_ 前缀易被生图模型判为无效或触发策略，导致 422。
 * 过长提示也可能被拒。
 */
function sanitizeImagePromptForGemini(prompt: string): string {
  let s = String(prompt || "").trim();
  s = s.replace(/@资产\s*\d+\s*_[^：:\n\r]+[：:]\s*/gi, "");
  s = s.replace(/@图\s*\d+\s*_[^，。\n\r]+[，,]?\s*/gi, "");
  s = s.replace(/[ \t]+/g, " ");
  s = s.replace(/\n{3,}/g, "\n\n");
  const max = Number(process.env.IMAGE_PROMPT_MAX_CHARS || "12000");
  if (max > 0 && s.length > max) {
    s = `${s.slice(0, max).trim()}\n…（已截断至约 ${max} 字以适配生图接口）`;
  }
  return s.trim();
}

function appendGeminiImage422Guidance(msg: string): string {
  const m = (msg || "").trim();
  if (!m) return m;
  if (/【可尝试】/.test(m)) return m;
  return `${m}\n\n【可尝试】① 去掉暴力/色情/名人肖像等敏感描述；② 缩短提示词；③ 删除「图1」「@资产1」等参考图引用后重试（服务端会在 422 时自动去掉参考图再试一次）；④ 更换宽高比，或调整 .env 中 IMAGE_MODEL。`;
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

/**
 * 将 AI 返回的图片（http(s) URL / data URL / 纯 base64）落盘到 public/uploads，
 * 返回前端可用的站内路径（如 /uploads/xxx.png），并写入 generated_images 表。
 */
async function persistAiImageToLocalStorage(
  imageUrl: string,
  projectRoot: string,
  db: InstanceType<typeof Database>,
  ownerUserId?: string
): Promise<string> {
  const uploadsAbs = path.join(projectRoot, "public", "uploads");
  mkdirSync(uploadsAbs, { recursive: true });

  const input = String(imageUrl || "").trim();
  if (!input) throw new Error("空图片内容");

  if (input.startsWith("/uploads/")) {
    const relFile = input.slice("/uploads/".length).replace(/\\/g, "/");
    if (!relFile || relFile.includes("..")) throw new Error("非法图片路径");
    const uploadsRoot = path.join(projectRoot, "public", "uploads");
    const abs = path.join(uploadsRoot, relFile);
    if (abs.startsWith(uploadsRoot) && existsSync(abs)) return input;
  }

  let buffer: Buffer;
  let mime = "image/png";

  if (input.startsWith("data:")) {
    const m = /^data:(image\/[^;]+);base64,(.+)$/is.exec(input);
    if (!m) throw new Error("无法解析 data URL 图片");
    mime = m[1];
    buffer = Buffer.from(m[2].replace(/\s/g, ""), "base64");
  } else if (/^https?:\/\//i.test(input)) {
    const maxBytes = Number(process.env.UPSTREAM_IMAGE_PROXY_MAX_BYTES || 50 * 1024 * 1024);
    const timeoutMs = Number(process.env.UPSTREAM_IMAGE_PROXY_TIMEOUT_MS || 120000);
    const maxAttempts = 3;
    let lastErr: Error | null = null;
    let downloaded: Buffer | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new Error(`IMAGE_PERSIST_FETCH_TIMEOUT_${timeoutMs}ms`)), timeoutMs);
      try {
        const r = await fetch(input, { signal: ctrl.signal });
        if (!r.ok) throw new Error(`下载图片失败 (${r.status})`);
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (ct.includes("image/")) mime = ct.split(";")[0].trim() || mime;
        const arr = await r.arrayBuffer();
        const byteLength = arr.byteLength;
        if (byteLength <= 0) {
          throw new Error("__PERSIST_EMPTY_BODY__");
        }
        if (byteLength > maxBytes) {
          const mb = (byteLength / (1024 * 1024)).toFixed(2);
          const maxMb = (maxBytes / (1024 * 1024)).toFixed(0);
          throw new Error(`图片过大（${mb} MB，上限 ${maxMb} MB）`);
        }
        if (ct && !ct.includes("image/") && !ct.includes("octet-stream")) {
          console.warn("[persist-image] unexpected content-type", {
            contentType: ct,
            bytes: byteLength,
            url: input.slice(0, 160),
          });
        }
        downloaded = Buffer.from(arr);
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e : new Error(String(e));
        if (lastErr.message === "__PERSIST_EMPTY_BODY__" && attempt < maxAttempts) {
          console.warn("[persist-image] upstream body empty, retrying", {
            attempt,
            maxAttempts,
            url: input.slice(0, 160),
          });
          await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
          continue;
        }
        if (lastErr.message === "__PERSIST_EMPTY_BODY__") {
          throw new Error("上游图片为空（RunningHub 返回的 URL 暂无可下载内容，请稍后重试）");
        }
        throw lastErr;
      } finally {
        clearTimeout(timer);
      }
    }
    if (!downloaded) {
      throw lastErr || new Error("下载图片失败");
    }
    buffer = downloaded;
  } else if (/^[a-z0-9+/=\r\n]+$/i.test(input) && input.length > 200) {
    buffer = Buffer.from(input.replace(/\s/g, ""), "base64");
  } else {
    throw new Error("不支持的图片格式（需要 http(s) / data URL / base64）");
  }

  const ext = guessExtFromMime(mime);
  const id = uuidv4();
  const filename = `${id}.${ext}`;
  const relativeWebPath = `/uploads/${filename}`;
  const absPath = path.join(uploadsAbs, filename);

  await writeFile(absPath, buffer);

  try {
    db.prepare(
      `INSERT INTO generated_images (id, relative_path, source_kind, bytes, mime) VALUES (?, ?, ?, ?, ?)`
    ).run(id, relativeWebPath, "ai", buffer.length, mime);
  } catch (e) {
    console.warn("[persist-image] generated_images insert skipped:", e);
  }

  if (ownerUserId) recordFileOwnership(db, relativeWebPath, ownerUserId);

  return relativeWebPath;
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

type GptImage2Size =
  | "1024x1024"
  | "1536x1024"
  | "1024x1536"
  | "2048x2048"
  | "2048x1152"
  | "2016x864"
  | "720x1280"
  | "1152x2048"
  | "3840x2160"
  | "2160x3840";

function gcdInt(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

const GPT_IMAGE2_SIZE_BY_ASPECT_RES: Record<
  string,
  Partial<Record<"1k" | "2k" | "4k", GptImage2Size>>
> = {
  "1:1": { "1k": "1024x1024", "2k": "2048x2048", "4k": "2048x2048" },
  "9:16": { "1k": "720x1280", "2k": "1152x2048", "4k": "2160x3840" },
  "16:9": { "1k": "2048x1152", "2k": "2048x1152", "4k": "3840x2160" },
  "2:3": { "1k": "1024x1536", "2k": "1152x2048", "4k": "2160x3840" },
  "3:2": { "1k": "1536x1024", "2k": "2048x1152", "4k": "3840x2160" },
  "3:4": { "1k": "1024x1536", "2k": "1152x2048", "4k": "2160x3840" },
  "4:3": { "1k": "1536x1024", "2k": "2048x1152", "4k": "3840x2160" },
};

function normalizeGptImage2ResolutionTier(imageSize: unknown): "1k" | "2k" | "4k" {
  const raw = String(imageSize ?? "2K").trim().toUpperCase();
  if (raw === "1K") return "1k";
  if (raw === "4K") return "4k";
  if (raw === "2K") return "2k";
  return "2k";
}

function resolveGptImage2Size(imageSize: unknown, aspectRatio: unknown): GptImage2Size {
  const rawSize = String(imageSize ?? "").trim();
  const upper = rawSize.toUpperCase();
  if (upper === "1024X1024") return "1024x1024";
  if (upper === "1536X1024") return "1536x1024";
  if (upper === "1024X1536") return "1024x1536";
  if (upper === "2048X2048") return "2048x2048";
  if (upper === "2048X1152") return "2048x1152";
  if (upper === "2016X864") return "2016x864";
  if (upper === "720X1280") return "720x1280";
  if (upper === "1152X2048") return "1152x2048";
  if (upper === "3840X2160") return "3840x2160";
  if (upper === "2160X3840") return "2160x3840";

  const wxh = /^(\d+)\s*[xX]\s*(\d+)$/.exec(rawSize);
  if (wxh) {
    const w = Number(wxh[1]);
    const h = Number(wxh[2]);
    if (w > 0 && h > 0) {
      const normalized = `${w}x${h}`;
      const normalizedUpper = normalized.toUpperCase();
      if (normalizedUpper === "720X1280") return "720x1280";
      if (normalizedUpper === "1152X2048") return "1152x2048";
      if (normalizedUpper === "2160X3840") return "2160x3840";
      if (normalizedUpper === "3840X2160") return "3840x2160";
      if (normalizedUpper === "2048X1152") return "2048x1152";
      if (normalizedUpper === "1024X1536") return "1024x1536";
      if (normalizedUpper === "1536X1024") return "1536x1024";
      if (normalizedUpper === "1024X1024") return "1024x1024";
      if (normalizedUpper === "2048X2048") return "2048x2048";
      const g = gcdInt(w, h);
      const aspect = `${Math.round(w / g)}:${Math.round(h / g)}`;
      const tier = Math.max(w, h) >= 3000 ? "4k" : Math.max(w, h) >= 1800 ? "2k" : "1k";
      const mapped = GPT_IMAGE2_SIZE_BY_ASPECT_RES[aspect]?.[tier];
      if (mapped) return mapped;
    }
  }

  const tier = normalizeGptImage2ResolutionTier(imageSize);
  const ratio = String(aspectRatio ?? "").trim();
  const mapped = GPT_IMAGE2_SIZE_BY_ASPECT_RES[ratio]?.[tier];
  if (mapped) return mapped;

  const portraitRatios = new Set(["3:4", "9:16", "2:3", "4:5"]);
  return portraitRatios.has(ratio) ? "1024x1536" : "1536x1024";
}

async function startServer() {
  const app = express();
  if (process.env.TRUST_PROXY === "1" || process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }
  const PORT = Number(process.env.PORT) || 3000;
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  /**
   * 开发：入口一般在仓库根（.dev-server.mjs），与静态资源、DB 同级。
   * 生产：入口在 dist-server/server.mjs，静态与数据库仍以仓库根为准；PM2 请设置 cwd 为仓库根，或通过 APP_ROOT 覆盖。
   */
  const projectRoot =
    (process.env.APP_ROOT && String(process.env.APP_ROOT).trim()) ||
    (process.env.NODE_ENV === "production" ? process.cwd() : scriptDir);

  const tp = getThirdPartyEnv();
  if (!tp.apiBase || !tp.apiKey) {
    console.warn(
      "[API] THIRD_PARTY_API_BASE / THIRD_PARTY_API_KEY 未设置。请将 .env 放在项目根目录（与 package.json 同级），并重启 npm run dev。"
    );
  }

  mkdirSync(path.join(projectRoot, "public", "uploads"), { recursive: true });

  /**
   * SQLite 与前端结构对齐说明：
   * - projects：一条记录 = 一个导演项目；references_json = ReferenceImage[]；
   *   data_json = GenerationResponse（global_assets.scenes[*].image_url、storyboards[*].image_url / image_history 等）。
   * - generated_images：每次后端落盘的 AI 生成图元数据（路径与 projects.data_json 中的 /uploads/... 对应）。
   */
  const db = new Database(path.join(projectRoot, "projects.db"));
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
    );

    CREATE TABLE IF NOT EXISTS generated_images (
      id TEXT PRIMARY KEY,
      relative_path TEXT NOT NULL UNIQUE,
      source_kind TEXT,
      bytes INTEGER,
      mime TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_generated_images_created ON generated_images(created_at);
  `);

  // Migration: Add context column if it doesn't exist
  try {
    db.prepare("ALTER TABLE projects ADD COLUMN context TEXT").run();
  } catch (e) {
    // Column already exists or other error
  }
  try {
    db.prepare("ALTER TABLE projects ADD COLUMN user_id TEXT").run();
  } catch (e) {
    /* column exists */
  }
  try {
    db.prepare("CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)").run();
  } catch (e) {
    /* ignore */
  }

  initUserAuthSchema(db);
  initStudioAnnouncementsSchema(db);
  bootstrapAdminUser(db);
  const adminBootstrap = db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1").get() as
    | { id: string }
    | undefined;
  if (adminBootstrap?.id) {
    const n = backfillLegacyGeneratedImageOwnership(db, adminBootstrap.id);
    if (n > 0) console.log(`[auth] 已为 ${n} 张历史 AI 图片登记文件归属（管理员）`);
  }
  initCanvasGenerationsSchema(db);
  const requireAuth = createRequireAuth(db);
  const requireAdmin = createRequireAdmin(db);

  const canAccessProject = (
    row: { user_id?: string | null } | undefined,
    userId: string,
    isAdmin: boolean
  ): boolean => {
    if (isAdmin) return true;
    if (!row) return false;
    const owner = String(row.user_id || "").trim();
    if (!owner) return true;
    return owner === userId;
  };

  if (String(process.env.TRUST_PROXY || "").trim() === "1" || process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ limit: '50mb', extended: true }));
  registerProtectedUploadRoutes(app, db, projectRoot, requireAuth);
  app.use(publicStaticExceptUploads(projectRoot));

  const basePersistImage = (url: string) => persistAiImageToLocalStorage(url, projectRoot, db);
  const persistImageWithOwner = createPersistImageHandler(db, basePersistImage);

  /** 无限画布：内置存储（data/canvases），无需单独启动 canvas_source Python */
  registerInfiniteCanvasRoutes(app, projectRoot, {
    persistImage: persistImageWithOwner,
    requireGate: requireAuth,
    requireAdmin,
    db,
  });
  mkdirSync(path.join(projectRoot, "data", "canvases"), { recursive: true });

  registerUserAuthRoutes(app, db, projectRoot);
  registerStudioAnnouncementRoutes(app, db, requireAuth, requireAdmin);
  registerCanvasGenerationsRoutes(app, db, projectRoot);

  // Project Management Routes
  app.get("/api/projects", requireAuth, (req, res) => {
    try {
      const user = req.authUser!;
      const projects =
        user.role === "admin"
          ? db.prepare("SELECT id, title, updatedAt FROM projects ORDER BY updatedAt DESC").all()
          : db
              .prepare(
                "SELECT id, title, updatedAt FROM projects WHERE user_id IS NULL OR user_id = ? ORDER BY updatedAt DESC"
              )
              .all(user.id);
      res.json(projects);
    } catch (error) {
      res.status(500).json({ error: "无法获取项目列表" });
    }
  });

  app.get("/api/projects/:id", requireAuth, (req, res) => {
    try {
      const user = req.authUser!;
      const project = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id) as
        | { user_id?: string | null }
        | undefined;
      if (!project) return res.status(404).json({ error: "项目不存在" });
      if (!canAccessProject(project, user.id, user.role === "admin")) {
        return res.status(403).json({ error: "无权访问该项目" });
      }
      
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

  app.post("/api/projects", requireAuth, (req, res) => {
    const { id, title, context, script, selectedStyle, imageSize, aspectRatio, references, data } = req.body;
    const user = req.authUser!;
    try {
      const existing = db.prepare("SELECT user_id FROM projects WHERE id = ?").get(id) as
        | { user_id?: string | null }
        | undefined;
      if (existing && !canAccessProject(existing, user.id, user.role === "admin")) {
        return res.status(403).json({ error: "无权修改该项目" });
      }
      const stmt = db.prepare(`
        INSERT INTO projects (id, title, context, script, selectedStyle, imageSize, aspectRatio, references_json, data_json, user_id, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          context = excluded.context,
          script = excluded.script,
          selectedStyle = excluded.selectedStyle,
          imageSize = excluded.imageSize,
          aspectRatio = excluded.aspectRatio,
          references_json = excluded.references_json,
          data_json = excluded.data_json,
          user_id = COALESCE(projects.user_id, excluded.user_id),
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
        JSON.stringify(data || null),
        user.id
      );
      
      res.json({ success: true });
    } catch (error) {
      console.error("Save project error:", error);
      res.status(500).json({ error: "保存项目失败" });
    }
  });

  app.delete("/api/projects/:id", requireAuth, (req, res) => {
    try {
      const user = req.authUser!;
      const existing = db.prepare("SELECT user_id FROM projects WHERE id = ?").get(req.params.id) as
        | { user_id?: string | null }
        | undefined;
      if (!existing) return res.status(404).json({ error: "项目不存在" });
      if (!canAccessProject(existing, user.id, user.role === "admin")) {
        return res.status(403).json({ error: "无权删除该项目" });
      }
      db.prepare("DELETE FROM projects WHERE id = ?").run(req.params.id);
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: "删除项目失败" });
    }
  });

  // Step 1: Generate Script JSON (storyboard LLM — same channel as nine-grid Phase A)
  app.post("/api/generate-script", requireAuth, async (req, res) => {
    const { script, context, style, references, textModel } = req.body;

    const resolvedTextModel = resolveStoryboardTextModel(textModel);
    const { apiBase, apiKey } = getStoryboardTextEnv(resolvedTextModel);

    if (!apiBase || !apiKey) {
      return res.status(400).json({ 
        error: textLlmConfigError(resolvedTextModel)
      });
    }

    const cleanBase = apiBase;

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
      const maxRetries = Number(process.env.TEXT_API_RETRIES || 4);
      const baseDelayMs = Number(process.env.TEXT_API_RETRY_BASE_DELAY_MS || 1200);
      const textTimeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 120000);

      const chatRequestBody = augmentChatCompletionsBody(resolvedTextModel, {
          model: resolvedTextModel,
          messages: [
            { role: "system", content: systemInstruction },
            {
              role: "user",
              content: `前情提要（全局设定）：${context || "无"}\n\n剧本大纲：${script}\n\n参考资产列表：\n${
                references && references.length > 0
                  ? references
                      .map((r: any) => `- 图${r.index} (${r.name}): ${r.type === "character" ? "角色" : "场景"}`)
                      .join("\n")
                  : "无"
              }`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.7,
        });

      let data: any = null;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(
            () => ctrl.abort(new Error(`TEXT_API_TIMEOUT_${textTimeoutMs}ms`)),
            textTimeoutMs
          );
          const response = await postTextLlm(resolvedTextModel, cleanBase, apiKey, chatRequestBody, {
            signal: ctrl.signal,
          });
          clearTimeout(timer);

          const raw = await response.text();
          const contentType = response.headers.get("content-type");

          if (!response.ok) {
            let payload: any = {};
            if (contentType?.includes("application/json") && raw) {
              try {
                payload = JSON.parse(raw);
              } catch {
                payload = { error: { message: raw.slice(0, 300) } };
              }
            } else {
              payload = { error: { message: raw.slice(0, 300) } };
            }

            if (isUpstreamOverloaded(response.status, payload) && attempt < maxRetries) {
              const jitter = Math.floor(Math.random() * 260);
              const delay = Math.min(12000, baseDelayMs * Math.pow(2, attempt) + jitter);
              console.warn("[generate-script] upstream overloaded, retrying...", {
                status: response.status,
                attempt,
                delay,
              });
              await sleep(delay);
              continue;
            }

            const errMsg =
              (typeof payload?.error?.message === "string" && payload.error.message) ||
              (typeof payload?.message === "string" && payload.message) ||
              `API 错误 (${response.status}): ${response.statusText}`;
            return res.status(response.status).json({ error: errMsg });
          }

          data = parseTextLlmResponseBody(raw);
          if (data?.error && !extractTextLlmMessageContent(resolvedTextModel, data).trim()) {
            throw new Error(
              typeof (data.error as { message?: unknown })?.message === "string"
                ? String((data.error as { message: string }).message)
                : `预期返回 JSON 但收到了: ${raw.slice(0, 100)}...`
            );
          }
          break;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          const retryable =
            msg.startsWith("TEXT_API_TIMEOUT_") || /fetch failed|network|ECONNRESET|aborted/i.test(msg);
          if (retryable && attempt < maxRetries) {
            const jitter = Math.floor(Math.random() * 260);
            const delay = Math.min(12000, baseDelayMs * Math.pow(2, attempt) + jitter);
            console.warn("[generate-script] transient error, retrying...", { msg, attempt, delay });
            await sleep(delay);
            continue;
          }
          console.error("Script generation error:", err);
          return res.status(500).json({ error: msg });
        }
      }

      if (!data) {
        return res.status(503).json({
          error:
            "分镜生成多次重试后仍失败，上游可能持续过载。请稍后再试；也可在 .env 提高 TEXT_API_RETRIES 或 TEXT_API_TIMEOUT_MS。",
        });
      }

      const content = extractTextLlmMessageContent(resolvedTextModel, data);
      if (!content) {
        return res.status(500).json({ error: "文本模型未返回有效内容（choices[0].message.content 为空）" });
      }

      const parsedJSON = extractJSON(content);
      if (!parsedJSON || typeof parsedJSON !== "object") {
        return res.status(500).json({ error: "模型输出无法解析为 JSON 对象" });
      }
      if (!Array.isArray(parsedJSON.storyboards) || parsedJSON.storyboards.length === 0) {
        return res.status(500).json({ error: "模型返回缺少分镜列表 storyboards，请重试或缩短剧本" });
      }
      if (!parsedJSON.global_assets || !Array.isArray(parsedJSON.global_assets.scenes)) {
        parsedJSON.global_assets = { scenes: [{ description: "", image_url: "" }] };
      }
      parsedJSON.storyboards = parsedJSON.storyboards.map((s: any, i: number) => ({
        ...s,
        shot_number: String(s?.shot_number ?? `镜头 ${String(i + 1).padStart(2, "0")}`),
        summary: typeof s?.summary === "string" ? s.summary : "",
        director_notes: typeof s?.director_notes === "string" ? s.director_notes : "",
        image_prompt: typeof s?.image_prompt === "string" ? s.image_prompt : "",
        video_prompt: typeof s?.video_prompt === "string" ? s.video_prompt : "",
      }));
      if (!Array.isArray(parsedJSON.qa_check)) {
        parsedJSON.qa_check = [];
      }
      res.json(parsedJSON);
    } catch (error) {
      console.error("Script generation error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "服务器内部错误" });
    }
  });

  // 导演台：自然语言 → SceneData JSON
  app.post("/api/director-scene", requireAuth, async (req, res) => {
    const { instruction, snapshot, textModel } = req.body || {};
    const promptText = String(instruction || "").trim();
    if (!promptText) {
      return res.status(400).json({ error: "请提供 instruction" });
    }

    const resolvedTextModel = resolveStoryboardTextModel(textModel);
    const { apiBase, apiKey } = getStoryboardTextEnv(resolvedTextModel);
    if (!apiBase || !apiKey) {
      return res.status(400).json({ error: textLlmConfigError(resolvedTextModel) });
    }

    const systemInstruction =
      readPromptFile("prompts/director_scene_system_prompt.txt", projectRoot) ||
      "你是 3D 场景导演。只输出 SceneData JSON：camera.position/rotation/fov 与 characters[].id/position/rotation/posePreset。";

    try {
      const response = await postTextLlm(
        resolvedTextModel,
        apiBase,
        apiKey,
        augmentChatCompletionsBody(resolvedTextModel, {
          model: resolvedTextModel,
          messages: [
            { role: "system", content: systemInstruction },
            {
              role: "user",
              content: `当前场景快照：\n${JSON.stringify(snapshot || {}, null, 2)}\n\n导演指令：${promptText}\n\n请只输出 SceneData JSON。`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.4,
        }),
      );

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`API 错误: ${response.status} ${errText.slice(0, 200)}`);
      }

      const rawJson = await response.text();
      const data = parseTextLlmResponseBody(rawJson);
      const content = extractTextLlmMessageContent(resolvedTextModel, data);
      let sceneData: unknown = null;
      try {
        sceneData = JSON.parse(content);
      } catch {
        const start = content.indexOf("{");
        const end = content.lastIndexOf("}");
        if (start >= 0 && end > start) {
          sceneData = JSON.parse(content.slice(start, end + 1));
        }
      }
      if (!sceneData || typeof sceneData !== "object") {
        return res.status(500).json({ error: "模型输出无法解析为 JSON", raw: content.slice(0, 500) });
      }
      res.json({ sceneData });
    } catch (error) {
      console.error("director-scene error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : "服务器内部错误" });
    }
  });

  // Step 1.2: Generate Scene Description
  app.post("/api/generate-scene-description", requireAuth, async (req, res) => {
    const { script, context, style, index, textModel } = req.body;

    const resolvedTextModel = resolveStoryboardTextModel(textModel);
    const { apiBase, apiKey } = getStoryboardTextEnv(resolvedTextModel);

    if (!apiBase || !apiKey) {
      return res.status(400).json({ error: textLlmConfigError(resolvedTextModel) });
    }

    const cleanBase = apiBase;

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
      const response = await postTextLlm(
        resolvedTextModel,
        cleanBase,
        apiKey,
        augmentChatCompletionsBody(resolvedTextModel, {
          model: resolvedTextModel,
          messages: [
            { role: "system", content: systemInstruction },
            {
              role: "user",
              content: `前情提要（全局设定）：${context || '无'}\n\n剧本大纲：${script}\n\n请重新生成场景 ${index + 1} 的描述。`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.8,
        })
      );

      if (!response.ok) {
        throw new Error(`API 错误: ${response.status}`);
      }

      const data = await response.json();
      const content = extractTextLlmMessageContent(resolvedTextModel, data);
      res.json(extractJSON(content));
    } catch (error) {
      console.error("Generate scene description error:", error);
      res.status(500).json({ error: "重新生成描述失败" });
    }
  });

  // Step 1.5: Regenerate a single shot
  app.post("/api/regenerate-shot", requireAuth, async (req, res) => {
    const { script, context, style, references, shot_summary, shot_number, textModel } = req.body;

    const resolvedTextModel = resolveStoryboardTextModel(textModel);
    const { apiBase, apiKey } = getStoryboardTextEnv(resolvedTextModel);

    if (!apiBase || !apiKey) {
      return res.status(400).json({ error: textLlmConfigError(resolvedTextModel) });
    }

    const cleanBase = apiBase;

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
      const response = await postTextLlm(
        resolvedTextModel,
        cleanBase,
        apiKey,
        augmentChatCompletionsBody(resolvedTextModel, {
          model: resolvedTextModel,
          messages: [
            { role: "system", content: systemInstruction },
            {
              role: "user",
              content: `前情提要（全局设定）：${context || '无'}\n\n剧本背景：${script}\n需要重新生成的镜头描述：${shot_summary}\n\n参考资产列表：\n${references && references.length > 0
                ? references.map((r: any) => `- 图${r.index} (${r.name}): ${r.type === 'character' ? '角色' : '场景'}`).join('\n')
                : '无'}`,
            },
          ],
          response_format: { type: "json_object" },
          temperature: 0.9,
        })
      );

      if (!response.ok) {
        throw new Error(`API 错误: ${response.status}`);
      }

      const data = await response.json();
      const content = extractTextLlmMessageContent(resolvedTextModel, data);
      res.json(extractJSON(content));
    } catch (error) {
      console.error("Regenerate shot error:", error);
      res.status(500).json({ error: "重新生成失败" });
    }
  });

  // Step 2: Generate Image (RunningHub storyboard 或 Third-party 回退)
  app.post("/api/generate-image", requireAuth, async (req, res) => {
    const { prompt, image_size, aspect_ratio, references, scope } = req.body;
    console.log("Received image generation request:", { prompt, image_size, aspect_ratio, scope });

    const rhEnv = getStoryboardImageEnv();
    if (rhEnv) {
      try {
        if (typeof prompt !== "string" || !prompt.trim()) {
          return res.status(400).json({ error: "缺少 prompt" });
        }
        const url = await runStoryboardRunningHubGenerateJob({
          prompt: prompt.trim(),
          image_size,
          aspect_ratio,
          references: Array.isArray(references) ? references : [],
          projectRoot,
        });
        const localUrl = await persistAiImageToLocalStorage(url, projectRoot, db, req.authUser!.id);
        return res.json({ url: localUrl });
      } catch (error) {
        console.error("[generate-image/runninghub] error:", error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : "生图失败（RunningHub）",
        });
      }
    }

    const { apiBase, apiKey } = getGenerateImageEnv();

    if (!apiBase || !apiKey) {
      return res.status(400).json({
        error:
          "缺少生图 API 配置。请在项目根目录 .env 中设置 THIRD_PARTY_API_BASE / THIRD_PARTY_API_KEY（推荐，与剧本接口一致），或仅配置 IMAGE_GRID_API_BASE / IMAGE_GRID_API_KEY，保存后重启 npm run dev。",
      });
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
      const modelName = process.env.IMAGE_MODEL || "nano-banana-pro-稳定";
      const requestBody: any = {
        model: modelName,
        prompt: enhancedPrompt,
        response_format: "url",
        aspect_ratio: aspect_ratio || "16:9"
      };

      // 供应商文档：image_size 仅 nano-banana 系列支持；后台模型名可能带 pro / 2k 等后缀
      if (/nano-banana/i.test(modelName)) {
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

      const readUpstreamBody = async (r: Response): Promise<any> => {
        const ct = r.headers.get("content-type");
        if (ct && ct.includes("application/json")) {
          try {
            return await r.json();
          } catch {
            return null;
          }
        }
        return await r.text();
      };

      const executeImageGen = async (body: Record<string, any>): Promise<Response> => {
        let retries = 3;
        let lastResponse: Response | undefined;
        let lastError: unknown = null;
        while (retries > 0) {
          try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(new Error(`IMAGE_API_TIMEOUT_${timeoutMs}ms`)), timeoutMs);
            const r = await fetch(`${cleanBase}/images/generations`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
              },
              body: JSON.stringify(body),
              signal: ctrl.signal,
            });
            clearTimeout(timer);
            lastResponse = r;
            if (r.ok) return r;
            if (![502, 503, 504].includes(r.status)) return r;
            console.warn(`API returned ${r.status}, retrying... (${retries} left)`);
          } catch (err) {
            lastError = err;
            console.warn(`Network error, retrying... (${retries} left)`, err);
          }
          retries--;
          if (retries > 0) {
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }
        }
        if (!lastResponse) {
          throw lastError instanceof Error ? lastError : new Error("请求失败，已达到最大重试次数");
        }
        return lastResponse;
      };

      let workingBody: Record<string, any> = { ...requestBody };
      let response = await executeImageGen(workingBody);
      let responseData: any = await readUpstreamBody(response);

      // Gemini 常见 422：参考图与文案不匹配、或提示词含剧本标记；先去掉参考图再试一次
      if (!response.ok && response.status === 422 && Array.isArray(workingBody.image) && workingBody.image.length > 0) {
        console.warn("[generate-image] upstream 422, retrying without reference images");
        const { image: _drop, ...rest } = workingBody;
        workingBody = rest;
        response = await executeImageGen(workingBody);
        responseData = await readUpstreamBody(response);
      }

      // 仍 422：用清理后的纯画面描述再试（去掉 @资产 / @图 等模板前缀）
      if (!response.ok && response.status === 422) {
        const sanitized = sanitizeImagePromptForGemini(enhancedPrompt);
        if (sanitized !== enhancedPrompt && sanitized.length > 20) {
          console.warn("[generate-image] upstream 422, retrying with sanitized prompt (no refs)");
          workingBody = { ...workingBody, prompt: sanitized };
          delete workingBody.image;
          response = await executeImageGen(workingBody);
          responseData = await readUpstreamBody(response);
        }
      }

      if (!response.ok) {
        console.error("API Error Response Status:", response.status);
        console.error("API Error Response Headers:", Object.fromEntries(response.headers.entries()));
        console.error("API Error Response Body:", responseData);
        let errorMessage = `生图 API 错误 (${response.status}): `;
        if (typeof responseData === "object" && responseData !== null) {
          errorMessage += responseData.error?.message || responseData.message || JSON.stringify(responseData);
        } else {
          errorMessage += responseData ? String(responseData).slice(0, 500) : "无响应内容 (可能是网关超时或代理错误)";
        }
        if (response.status === 422) {
          errorMessage = appendGeminiImage422Guidance(errorMessage);
        }
        throw new Error(errorMessage);
      }

      const imageUrl = extractGeneratedImageFromResponse(responseData);

      if (imageUrl) {
        const localUrl = await persistAiImageToLocalStorage(imageUrl, projectRoot, db, req.authUser!.id);
        res.json({ url: localUrl });
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
  app.post("/api/generate-9grid", requireAuth, async (req, res) => {
    const { story, references, mode, imagePrompt: imagePromptInput, imageModel, textModel } = req.body as {
      story?: string;
      references?: Array<{ url?: string; name?: string } | string>;
      mode?: "prompts_only" | "image_only" | "full";
      imagePrompt?: string;
      imageModel?: string;
      textModel?: string;
    };
    const runMode = mode || "full";
    const requestedImageModel = String(imageModel || "").trim() || (process.env.IMAGE_GRID_MODEL || "nano-banana-pro-稳定").trim();
    const useGptImage2Requested = /^gpt-image-2$/i.test(requestedImageModel);

    const resolvedNineGridTextModel = resolveNineGridTextModel(textModel);
    const { apiBase: textApiBase, apiKey: textApiKey } = resolveTextLlmEnv(resolvedNineGridTextModel);
    const { apiBase: gridApiBase, apiKey: gridApiKey } = getGridEnv();

    if ((runMode === "prompts_only" || runMode === "full") && (!textApiBase || !textApiKey)) {
      return res.status(400).json({
        error: textLlmConfigError(resolvedNineGridTextModel),
      });
    }

    if ((runMode === "image_only" || runMode === "full") && !useGptImage2Requested && (!gridApiBase || !gridApiKey)) {
      return res.status(400).json({
        error:
          "缺少 9 宫格生图 API 配置。请在项目根目录的 .env 中设置 IMAGE_GRID_API_BASE（可选）与 IMAGE_GRID_API_KEY（必填），保存后重启 npm run dev。",
      });
    }

    if ((runMode === "prompts_only" || runMode === "full") && (typeof story !== "string" || story.trim().length < 10)) {
      return res.status(400).json({ error: "请先输入剧本故事（至少 10 个字符）" });
    }

    const cleanTextBase = textApiBase;

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

    const systemBase = readPromptFile("./prompts/nine_grid_system_prompt.txt", projectRoot);
    const systemInstruction = `${systemBase}\n\n${NINE_GRID_JSON_OUTPUT_CONSTRAINT}`;

    try {
      let shots: any[] = [];
      let imagePrompt = String(imagePromptInput || "").trim();

      if (runMode === "prompts_only" || runMode === "full") {
        // Phase A0: vision -> reference look anchors (costume / hair / accessories)
        let refLooks: Awaited<ReturnType<typeof analyzeNineGridReferenceLooks>> = [];
        if (refItems.length > 0) {
          console.log("[9grid] Phase A0 ref vision", { refs: refItems.length, model: resolvedNineGridTextModel });
          refLooks = await analyzeNineGridReferenceLooks(req, projectRoot, refItems, {
            model: resolvedNineGridTextModel,
            apiBase: cleanTextBase,
            apiKey: textApiKey,
          });
          const failed = refLooks.filter((l) => l.visionFailed);
          if (failed.length) {
            console.warn("[9grid] Phase A0 partial vision", {
              total: refItems.length,
              failed: failed.map((l) => ({ index: l.index, name: l.name })),
            });
          }
        }
        const refAnchorsBlock = formatNineGridRefLooksForPhaseA(refLooks);

        // Phase A: text model -> 9 shot prompts
        const citedRefsText =
          refItems.length > 0
            ? refItems
                .map((r, i) => `- 图${i + 1}（${r.name}）：参考图（按上传顺序，人物/场景名称已标注）`)
                .join("\n")
            : "无";

        const phaseAUserContent = `剧本故事：\n${story}\n\n参考图列表（按顺序，用户会用“图1/图2/...”指代）：\n${citedRefsText}${
          refAnchorsBlock ? `\n\n${refAnchorsBlock}` : ""
        }`;

        const phaseAMessages: Array<{ role: string; content: string }> = [
          { role: "system", content: systemInstruction },
          { role: "user", content: phaseAUserContent },
        ];

        const maxRetries = Number(process.env.TEXT_API_RETRIES || 4);
        const baseDelayMs = Number(process.env.TEXT_API_RETRY_BASE_DELAY_MS || 1200);
        const textTimeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 60000);
        const qualityRetries = Math.max(0, Math.min(2, Number(process.env.NINE_GRID_TEXT_QUALITY_RETRIES || 1)));

        const textKeySource = (process.env.RUNNINGHUB_LLM_API_KEY ?? "").trim()
          ? "RUNNINGHUB_LLM_API_KEY"
          : (process.env.NINE_GRID_TEXT_API_KEY ?? "").trim()
            ? "NINE_GRID_TEXT_API_KEY"
            : (process.env.STORYBOARD_IMAGE_API_KEY ?? "").trim()
              ? "STORYBOARD_IMAGE_API_KEY"
              : "THIRD_PARTY_API_KEY";
        console.log("[9grid] Phase A chat/completions", {
          model: resolvedNineGridTextModel,
          apiBase: cleanTextBase,
          keySource: textKeySource,
        });

        let shotLines: Array<{ n: number; prompt: string; specs?: string }> | null = null;

        for (let qualityAttempt = 0; qualityAttempt <= qualityRetries; qualityAttempt++) {
          const textReqBody = augmentChatCompletionsBody(resolvedNineGridTextModel, {
            model: resolvedNineGridTextModel,
            messages: phaseAMessages,
            response_format: { type: "json_object" },
            temperature: qualityAttempt > 0 ? 0.55 : 0.7,
          });

          let textPayload: any = null;
          let lastStatus = 0;

          for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
              const ctrl = new AbortController();
              const timer = setTimeout(
                () => ctrl.abort(new Error(`TEXT_API_TIMEOUT_${textTimeoutMs}ms`)),
                textTimeoutMs
              );

              const textRes = await postTextLlm(
                resolvedNineGridTextModel,
                cleanTextBase,
                textApiKey,
                textReqBody,
                { signal: ctrl.signal }
              );
              clearTimeout(timer);

              lastStatus = textRes.status;
              const raw = await textRes.text().catch(() => "");
              textPayload = parseTextLlmResponseBody(raw);

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

          const content = extractTextLlmMessageContent(resolvedNineGridTextModel, textPayload || {});
          const parsed = extractJSON(String(content));
          shots = Array.isArray(parsed?.shots) ? parsed.shots : [];
          if (shots.length !== 9) {
            return res.status(500).json({ error: `分镜提示词生成失败：shots 数量不是 9（得到 ${shots.length}）` });
          }

          shotLines = mapNineGridShotsFromLlm(shots);
          if (!shotLines) {
            return res.status(500).json({ error: "分镜提示词生成失败：shots 解析异常" });
          }

          const shortNums = nineGridShotsBelowMinChars(shotLines);
          if (shortNums.length === 0) break;

          console.warn("[9grid] Phase A prompts too short", {
            qualityAttempt,
            shortNums,
            lengths: shotLines.map((s) => ({ n: s.n, len: s.prompt.length })),
          });

          if (qualityAttempt >= qualityRetries) {
            return res.status(500).json({
              error: `分镜提示词生成失败：格子 ${shortNums.join("、")} 的描述不足 ${NINE_GRID_SHOT_PROMPT_MIN_CHARS} 字（请缩短剧本或重试 Phase A）`,
              meta: {
                shortShots: shortNums,
                minChars: NINE_GRID_SHOT_PROMPT_MIN_CHARS,
                lengths: shotLines.map((s) => ({ n: s.n, chars: s.prompt.length })),
              },
              shots: shotLines,
            });
          }

          phaseAMessages.push(
            { role: "assistant", content: String(content) },
            { role: "user", content: buildNineGridShotExpandRetryMessage(shortNums) }
          );
        }

        if (!shotLines) {
          return res.status(500).json({ error: "分镜提示词生成失败：未生成有效 shots" });
        }

        shots = shotLines;
        imagePrompt = buildNineGridImagePrompt(shotLines, refItems, {
          refLooks,
          imageModel: requestedImageModel,
        });
        if (runMode === "prompts_only") {
          return res.json({ shots: shotLines, imagePrompt, refLooks });
        }
      }

      if (!imagePrompt) {
        return res.status(400).json({ error: "缺少 imagePrompt" });
      }

      // Phase B: image model -> one grid image（支持 nano 与 gpt-image-2）
      const modelName = String(imageModel || "").trim() || (process.env.IMAGE_GRID_MODEL || "nano-banana-pro-稳定").trim();
      const useGptImage2 = /^gpt-image-2$/i.test(modelName);
      const baseImageTimeoutMs = Number(process.env.IMAGE_API_TIMEOUT_MS || 180000);
      const timeoutMs = useGptImage2
        ? Math.max(baseImageTimeoutMs, Number(process.env.NINE_GRID_GPT_IMAGE_TIMEOUT_MS || 420000))
        : baseImageTimeoutMs;
      if (refUrls.length === 0) {
        return res.status(400).json({ error: "请至少上传 1 张参考图（图1）用于九宫格生成" });
      }

      // 网关 /images/edits：multipart/form-data；image_size 与模型名中的 2K/4K 对齐
      const gridImageSize = /4k/i.test(modelName) ? "4K" : /2k/i.test(modelName) ? "2K" : "4K";
      const blobs = await Promise.all(refUrls.map(imageInputToBlob));
      const { apiBase: imageApiBaseRaw, apiKey: imageApiKey } = useGptImage2 ? getGptEditEnv() : getGridEnv();
      if (!imageApiBaseRaw || !imageApiKey) {
        return res.status(400).json({
          error: useGptImage2
            ? "缺少 GPT 生图 API 配置。请检查 GPT_IMAGE_EDIT_API_BASE / GPT_IMAGE_EDIT_API_KEY（或 THIRD_PARTY_API_BASE / THIRD_PARTY_API_KEY）后重试。"
            : "缺少 9 宫格生图 API 配置。请在项目根目录的 .env 中设置 IMAGE_GRID_API_BASE（可选）与 IMAGE_GRID_API_KEY（必填），保存后重启 npm run dev。",
        });
      }
      let cleanImageBase = imageApiBaseRaw.replace(/\/+$/, "");
      if (!cleanImageBase.startsWith("http://") && !cleanImageBase.startsWith("https://")) {
        cleanImageBase = `https://${cleanImageBase}`;
      }
      if (!cleanImageBase.endsWith("/v1") && !cleanImageBase.includes("/v1/")) {
        cleanImageBase = `${cleanImageBase}/v1`;
      }

      const form = new FormData();
      form.set("model", modelName);
      form.set("prompt", imagePrompt);
      if (useGptImage2) {
        form.set("response_format", "b64_json");
        form.set("size", "3840x2160");
        form.set("n", "1");
      } else {
        form.set("response_format", "url");
        form.set("aspect_ratio", "16:9");
        form.set("image_size", gridImageSize);
      }
      for (const b of blobs) {
        form.append("image", b.blob, b.filename);
      }

      console.log("[9grid] Phase B images/edits", {
        model: modelName,
        apiBase: cleanImageBase,
        timeoutMs,
        referencesCount: blobs.length,
        promptLength: imagePrompt.length,
        fixedSize: useGptImage2 ? "3840x2160" : undefined,
      });

      const imageRetries = Number(process.env.IMAGE_API_RETRIES || 2);
      const imageRetryBaseMs = Number(process.env.IMAGE_API_RETRY_BASE_DELAY_MS || 2200);
      let imgPayload: any = null;
      let imgStatus = 0;

      for (let attempt = 0; attempt <= imageRetries; attempt++) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(new Error(`IMAGE_API_TIMEOUT_${timeoutMs}ms`)), timeoutMs);
        try {
          const imgRes = await fetch(`${cleanImageBase}/images/edits`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${imageApiKey}`,
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
            console.error("[9grid] image request failed (non-retryable or max retry)", {
              status: imgRes.status,
              attempt,
              model: modelName,
              referencesCount: blobs.length,
              promptLength: imagePrompt.length,
              detail: String(detail).slice(0, 800),
            });
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
            console.error("[9grid] image request threw error (max retry reached)", {
              attempt,
              model: modelName,
              timeoutMs,
              referencesCount: blobs.length,
              promptLength: imagePrompt.length,
              message: msg,
            });
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

      const localUrl = await persistAiImageToLocalStorage(url, projectRoot, db, req.authUser!.id);
      return res.json({ url: localUrl, shots });
    } catch (e) {
      console.error("Generate 9-grid error:", e);
      return res.status(500).json({ error: e instanceof Error ? e.message : "九宫格生成失败" });
    }
  });

  // Step 2.1: Edit Image (Third-party API)
  app.post("/api/edit-image", requireAuth, async (req, res) => {
    const { prompt, target_image, references, images, image_size, aspect_ratio, model, response_format } = req.body;
    console.log("Received image edit request:", {
      prompt_preview: typeof prompt === "string" ? prompt.slice(0, 80) : "",
      has_target: typeof target_image === "string" && target_image.length > 0,
      references_count: Array.isArray(references) ? references.length : 0,
      images_count: Array.isArray(images) ? images.length : 0,
      image_size,
      aspect_ratio,
      model,
      response_format,
    });
    const requestModel = typeof model === "string" ? model.trim() : "";
    const gptRequested = /^gpt-image-2(-稳定)?$/i.test(requestModel);
    const gptOfficialPath = /^gpt-image-2-稳定$/i.test(requestModel);
    const { apiBase, apiKey } = gptRequested ? getGptEditEnv() : getThirdPartyEnv();

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

    const rhEnv = getStoryboardImageEnv();
    if (rhEnv) {
      try {
        const userPrompt = String(prompt).trim();
        const url = gptRequested
          ? await runStoryboardRunningHubG2Job({
              prompt: userPrompt,
              images: orderedImageUrls,
              image_size,
              aspect_ratio,
              projectRoot,
              pathOverride: gptOfficialPath ? getNineGridG2Path() : undefined,
            })
          : await runStoryboardRunningHubJob({
              prompt: userPrompt,
              images: orderedImageUrls,
              image_size,
              aspect_ratio,
              projectRoot,
            });
        const localUrl = await persistAiImageToLocalStorage(url, projectRoot, db, req.authUser!.id);
        return res.json({
          url: localUrl,
          meta: gptRequested ? { model: requestModel || "gpt-image-2" } : undefined,
        });
      } catch (error) {
        console.error(gptRequested ? "[edit-image/runninghub-g2] error:" : "[edit-image/runninghub] error:", error);
        return res.status(500).json({
          error: error instanceof Error ? error.message : "编辑失败（RunningHub）",
        });
      }
    }

    try {
      const baseTimeoutMs = Number(process.env.IMAGE_API_TIMEOUT_MS || 60000);

      // 上传侧（data URL）payload 往往更大，上游处理更慢；
      // 对 data URL 自动放宽超时，避免只因为“慢”就触发连续失败链。
      const anyDataUrl = orderedImageUrls.some((u) => u.trim().startsWith("data:image/"));

      const timeoutMs = gptRequested
        ? Math.max(baseTimeoutMs, anyDataUrl ? 300000 : 240000)
        : anyDataUrl
          ? Math.max(baseTimeoutMs, 180000)
          : baseTimeoutMs;
      const envCandidates = [String(process.env.IMAGE_EDIT_MODEL || "").trim(), String(process.env.IMAGE_MODEL || "").trim()].filter(
        (x) => x.length > 0
      );

      // 显式传 model（例如 GPT 编辑）时，严格只打该模型，不做回退。
      // 未显式传 model（旧编辑模式）时，仍保留 env 候选回退以提高可用性。
      const modelCandidates = requestModel
        ? [requestModel]
        : Array.from(new Set([...(envCandidates.length ? envCandidates : ["nano-banana-pro-稳定"])].filter(Boolean)));

      console.log("[edit-image] modelCandidates:", modelCandidates, "timeoutMs:", timeoutMs, "imageCount:", orderedImageUrls.length);

      const imageBlobs = await Promise.all(orderedImageUrls.map((u) => imageInputToBlob(u)));

      const userPrompt = String(prompt).trim();

      const formatUpstreamError = (status: number, responseData: any): string => {
        if (responseData == null) return `HTTP ${status}，无响应体`;
        if (typeof responseData === "string") {
          const t = responseData.trim();
          return t.length > 0 ? t.slice(0, 1200) : `HTTP ${status}，空文本响应`;
        }
        const o = responseData as Record<string, unknown>;
        const err = o.error as Record<string, unknown> | undefined;
        const parts: string[] = [];
        if (err) {
          if (typeof err.message === "string") parts.push(err.message);
          if (typeof (err as { code?: string }).code === "string") parts.push("code: " + (err as { code: string }).code);
          if (typeof (err as { type?: string }).type === "string") parts.push("type: " + (err as { type: string }).type);
        }
        if (typeof o.message === "string") parts.push(o.message);
        if (parts.length) return `HTTP ${status}：${parts.join("；").slice(0, 1200)}`;
        try {
          return `HTTP ${status}：${JSON.stringify(responseData).slice(0, 1200)}`;
        } catch {
          return `HTTP ${status}，无法解析错误体`;
        }
      };
      const isRetryableStatus = (status: number): boolean =>
        [408, 425, 429, 500, 502, 503, 504, 524].includes(status);

      const buildForm = (
        modelName: string,
        blobs: Array<{ blob: globalThis.Blob; filename: string }>,
        options?: { responseFormatOverride?: string; gptPlainPrompt?: boolean }
      ) => {
        const isGptImage2 = /^gpt-image-2$/i.test(modelName.trim());
        const requestResponseFormat = typeof response_format === "string" ? response_format.trim() : "";
        const editResponseFormat = String(process.env.IMAGE_EDIT_RESPONSE_FORMAT || "").trim();
        const responseFormat =
          options?.responseFormatOverride ||
          requestResponseFormat ||
          editResponseFormat ||
          (isGptImage2 ? "b64_json" : "url");
        const form = new FormData();
        form.set("model", modelName);
        // gpt-image-2 按标准 /images/edits 字段发送：image + prompt + model + size + response_format
        const promptForForm =
          isGptImage2 && options?.gptPlainPrompt !== false
            ? userPrompt
            : userPrompt;
        form.set("prompt", promptForForm);
        form.set("response_format", responseFormat);
        if (isGptImage2) {
          form.set("size", resolveGptImage2Size(image_size, aspect_ratio));
          form.set("n", "1");
        } else {
          if (aspect_ratio) form.set("aspect_ratio", String(aspect_ratio));
          if (image_size) form.set("image_size", String(image_size));
        }
        for (const b of blobs) {
          form.append("image", b.blob, b.filename);
        }
        return form;
      };

      // 对编辑请求优先只走 /images/edits，避免 /images/generations 走到网关默认模型导致 403
      const endpoints = ["/images/edits"];
      const errors: string[] = [];

      for (const modelName of modelCandidates) {
        const isGpt2Model = /^gpt-image-2$/i.test(modelName.trim());
        const blobVariants: Array<{ label: string; blobs: Array<{ blob: globalThis.Blob; filename: string }> }> = isGpt2Model
          ? [
              { label: "all_images", blobs: imageBlobs },
              ...(imageBlobs.length > 2 ? [{ label: "first_2_images", blobs: imageBlobs.slice(0, 2) }] : []),
              ...(imageBlobs.length > 1 ? [{ label: "first_1_image", blobs: imageBlobs.slice(0, 1) }] : []),
            ]
          : [{ label: "default", blobs: imageBlobs }];

        for (const endpoint of endpoints) {
          const isGpt2 = /^gpt-image-2$/i.test(modelName.trim());
          const attemptConfigs: Array<{ label: string; formOpts?: { responseFormatOverride?: string } }> = [
            { label: "primary" },
            ...(isGpt2
              ? ([{ label: "retry_url_format", formOpts: { responseFormatOverride: "url" } }] as const)
              : []),
          ];

          for (const variant of blobVariants) {
            for (const cfg of attemptConfigs) {
            const maxHttpRetries = Number(process.env.IMAGE_EDIT_HTTP_RETRIES || 2);
            for (let httpAttempt = 0; httpAttempt <= maxHttpRetries; httpAttempt++) {
              console.log("[edit-image] upstream request", {
                endpoint,
                model: modelName,
                variant: variant.label,
                attempt: cfg.label,
                retry: httpAttempt,
                response_format:
                  cfg.formOpts?.responseFormatOverride ||
                  (typeof response_format === "string" ? response_format : ""),
                image_count: variant.blobs.length,
                aspect_ratio: aspect_ratio ? String(aspect_ratio) : "",
                image_size: image_size ? String(image_size) : "",
                prompt_len: userPrompt.length,
              });
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
                  body: buildForm(modelName, variant.blobs, cfg.formOpts) as any,
                  signal: ctrl.signal,
                });

                const contentType = response.headers.get("content-type");
                const responseData =
                  contentType && contentType.includes("application/json")
                    ? await response.json()
                    : await response.text();

                if (!response.ok) {
                  const detail = formatUpstreamError(response.status, responseData);
                  errors.push(`${modelName} @ ${endpoint} [${variant.label}/${cfg.label}#${httpAttempt}] -> ${detail}`);
                  const canRetry = isRetryableStatus(response.status) && httpAttempt < maxHttpRetries;
                  if (canRetry) {
                    const delay = Math.min(12000, 1800 * Math.pow(2, httpAttempt));
                    console.warn("[edit-image] retryable upstream error, retrying...", {
                      status: response.status,
                      attempt: cfg.label,
                      retry: httpAttempt,
                      delay,
                    });
                    await sleep(delay);
                    continue;
                  }
                  break;
                }

                const imageUrl = extractGeneratedImageFromResponse(responseData);
                if (imageUrl) {
                  console.log("Image edit success with:", {
                    model: modelName,
                    endpoint,
                    variant: variant.label,
                    attempt: cfg.label,
                    retry: httpAttempt,
                  });
                  const localUrl = await persistAiImageToLocalStorage(imageUrl, projectRoot, db, req.authUser!.id);
                  return res.json({
                    url: localUrl,
                    meta: isGpt2Model ? { model: modelName, image_count_used: variant.blobs.length } : undefined,
                  });
                }
                errors.push(`${modelName} @ ${endpoint} [${variant.label}/${cfg.label}#${httpAttempt}] -> 200 但未解析到图片字段`);
                break;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                errors.push(`${modelName} @ ${endpoint} [${variant.label}/${cfg.label}#${httpAttempt}] -> ${msg}`);
                const canRetry = /timeout|timed out|aborted|fetch failed|network|ECONNRESET|ENOTFOUND/i.test(msg) && httpAttempt < maxHttpRetries;
                if (canRetry) {
                  const delay = Math.min(12000, 1800 * Math.pow(2, httpAttempt));
                  console.warn("[edit-image] transient error, retrying...", {
                    attempt: cfg.label,
                    retry: httpAttempt,
                    delay,
                    msg,
                  });
                  await sleep(delay);
                  continue;
                }
                break;
              } finally {
                clearTimeout(timer);
              }
            }
            }
          }
        }
      }

      const joinedErrors = appendImageEdit504Hint(errors.join(" | "));
      if (requestModel) {
        return res.status(500).json({
          error: `编辑失败：指定模型 ${requestModel} 调用失败。原因：${joinedErrors || "上游未返回可解析错误信息"}`,
        });
      }
      return res.status(500).json({
        error: `编辑失败：已尝试多模型与接口组合，均未成功。${joinedErrors}`,
      });
    } catch (error) {
      console.error("Image edit error:", error);
      return res.status(500).json({ error: error instanceof Error ? error.message : "编辑失败，请检查 API 配置或网络" });
    }
  });

  /**
   * 可选：将未内置的画布 API 转发到原 Python 服务。
   * 设置 CANVAS_API_ORIGIN=http://127.0.0.1:3000 且 CANVAS_USE_PYTHON_PROXY=1 时启用。
   */
  const canvasApiOrigin = (process.env.CANVAS_API_ORIGIN || "http://127.0.0.1:3000").replace(/\/$/, "");
  const canvasProxyEnabled = process.env.CANVAS_USE_PYTHON_PROXY === "1";
  const canvasApiPrefixes = [
    "/api/view",
    "/api/runninghub",
    "/api/providers",
    "/api/models",
    "/api/conversations",
    "/api/download-output",
    "/api/app-info",
    "/api/update-",
  ];
  app.use(async (req, res, next) => {
    if (!canvasProxyEnabled) return next();
    const p = req.path;
    const shouldProxy = canvasApiPrefixes.some(
      (prefix) => p === prefix || p.startsWith(`${prefix}/`) || (prefix.endsWith("/") && p.startsWith(prefix))
    );
    if (!shouldProxy) return next();
    try {
      const url = `${canvasApiOrigin}${req.originalUrl}`;
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers)) {
        if (!value || key === "host" || key === "connection" || key === "content-length") continue;
        if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
        else headers.set(key, value);
      }
      const method = req.method || "GET";
      const hasBody = method !== "GET" && method !== "HEAD";
      let body: string | undefined;
      if (hasBody && req.body !== undefined) {
        headers.set("content-type", headers.get("content-type") || "application/json");
        body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      }
      const upstream = await fetch(url, { method, headers, body });
      res.status(upstream.status);
      upstream.headers.forEach((val, key) => {
        if (key === "transfer-encoding" || key === "connection") return;
        res.setHeader(key, val);
      });
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.send(buf);
    } catch (err) {
      console.error("[canvas-proxy]", err);
      res.status(502).json({
        error: "画布服务未连接，请先运行 canvas_source 目录下的「启动服务.bat」（默认 http://127.0.0.1:3000）",
      });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      root: projectRoot,
      server: {
        middlewareMode: true,
        watch: { ignored: ["**/data/**"] },
      },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(projectRoot, "dist");
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
