/**
 * RunningHub MiniMax 海螺 H3：multimodal-to-video
 * POST /openapi/v2/minimax/hailuo-h3/multimodal-to-video
 */
import { existsSync, readFileSync } from "fs";
import path from "path";
import { FormData } from "undici";
import {
  getStoryboardImageEnv,
  isPublicRunningHubImageUrl,
  normalizeImageInputForUpload,
  resolveInputsToRunningHubUrls,
  submitAndPollRunningHub,
  type StoryboardImageEnv,
} from "./runningHubStoryboardImage.js";

export const RUNNINGHUB_HAILUO_H3_PATH = "/openapi/v2/minimax/hailuo-h3/multimodal-to-video";
export const HAILUO_H3_MODEL_ID = "hailuo-h3";

export const HAILUO_H3_RESOLUTIONS = ["768P", "2K"] as const;
export const HAILUO_H3_RATIOS = [
  "adaptive",
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
] as const;

export function isHailuoH3Model(model?: string): boolean {
  const m = String(model || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return (
    m === "hailuo-h3" ||
    m === "minimax-hailuo-h3" ||
    m === "hailuo-h3-multimodal" ||
    m.includes("hailuo-h3")
  );
}

export function getHailuoH3SubmitPath(): string {
  return (
    (process.env.RUNNINGHUB_HAILUO_H3_PATH ?? RUNNINGHUB_HAILUO_H3_PATH).trim() ||
    RUNNINGHUB_HAILUO_H3_PATH
  );
}

function getRunningHubEnv(): StoryboardImageEnv {
  const env = getStoryboardImageEnv();
  if (env) return env;
  let apiKey = (process.env.RUNNINGHUB_API_KEY ?? "").trim();
  if (/^bearer\s+/i.test(apiKey)) apiKey = apiKey.replace(/^bearer\s+/i, "").trim();
  if (!apiKey) throw new Error("未配置 STORYBOARD_IMAGE_API_KEY / RUNNINGHUB_API_KEY");
  const apiBase = (process.env.STORYBOARD_IMAGE_API_BASE ?? "https://www.runninghub.cn").replace(/\/+$/, "");
  return {
    apiBase,
    apiKey,
    editPath: "/openapi/v2/rhart-image-n-pro/edit",
    gptPath: "/openapi/v2/rhart-image-g-2/image-to-image",
    t2iPath: "/openapi/v2/rhart-image-n-pro-official/text-to-image",
    queryPath: (process.env.STORYBOARD_IMAGE_QUERY_PATH ?? "/openapi/v2/query").trim() || "/openapi/v2/query",
    uploadPath:
      (process.env.STORYBOARD_IMAGE_UPLOAD_PATH ?? "/openapi/v2/media/upload/binary").trim() ||
      "/openapi/v2/media/upload/binary",
    gptQuality: "medium",
  };
}

export function mapHailuoH3Resolution(raw: unknown): (typeof HAILUO_H3_RESOLUTIONS)[number] {
  const text = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (text === "2K" || text === "2KP" || text === "1440P") return "2K";
  return "768P";
}

export function mapHailuoH3Duration(raw: unknown): string {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return "5";
  return String(Math.max(5, Math.min(15, n)));
}

export function mapHailuoH3Ratio(raw: unknown): (typeof HAILUO_H3_RATIOS)[number] {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!text || text === "keep_ratio" || text === "keep" || text === "auto") return "adaptive";
  const allowed = new Set<string>(HAILUO_H3_RATIOS as unknown as string[]);
  if (allowed.has(text)) return text as (typeof HAILUO_H3_RATIOS)[number];
  // 常见别名
  if (text === "adapt") return "adaptive";
  return "adaptive";
}

async function readMediaBytes(
  input: string,
  projectRoot: string
): Promise<{ buffer: Buffer; mime: string; filename: string }> {
  const trimmed = input.trim();
  const dataMatch = /^data:((?:image|video|audio)\/[^;]+);base64,(.+)$/is.exec(trimmed);
  if (dataMatch) {
    const mime = dataMatch[1];
    const buf = Buffer.from(dataMatch[2].replace(/\s/g, ""), "base64");
    const ext = mime.includes("mp4")
      ? "mp4"
      : mime.includes("webm")
        ? "webm"
        : mime.includes("mov")
          ? "mov"
          : mime.includes("wav")
            ? "wav"
            : mime.includes("mpeg") || mime.includes("mp3")
              ? "mp3"
              : mime.includes("png")
                ? "png"
                : "bin";
    return { buffer: buf, mime, filename: `upload.${ext}` };
  }
  if (trimmed.startsWith("/uploads/")) {
    const rel = trimmed.replace(/^\/uploads\//, "").replace(/\\/g, "/");
    if (rel.includes("..")) throw new Error("非法媒体路径");
    const abs = path.join(projectRoot, "public", "uploads", rel);
    if (!existsSync(abs)) throw new Error(`本地媒体不存在：${trimmed}`);
    const buf = readFileSync(abs);
    const ext = path.extname(abs).toLowerCase() || ".bin";
    const mime =
      ext === ".mp4"
        ? "video/mp4"
        : ext === ".webm"
          ? "video/webm"
          : ext === ".mov"
            ? "video/quicktime"
            : ext === ".mp3"
              ? "audio/mpeg"
              : ext === ".wav"
                ? "audio/wav"
                : ext === ".png"
                  ? "image/png"
                  : ext === ".webp"
                    ? "image/webp"
                    : "application/octet-stream";
    return { buffer: buf, mime, filename: path.basename(abs) };
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const resp = await fetch(trimmed);
    if (!resp.ok) throw new Error(`拉取媒体失败 (${resp.status})`);
    const mime = (resp.headers.get("content-type") || "application/octet-stream").split(";")[0];
    const buf = Buffer.from(await resp.arrayBuffer());
    return { buffer: buf, mime, filename: "remote.bin" };
  }
  throw new Error("不支持的媒体输入（需要 data URL、/uploads/ 路径或 http(s) URL）");
}

async function uploadMediaToRunningHub(
  env: StoryboardImageEnv,
  input: string,
  projectRoot: string
): Promise<string> {
  const normalized = normalizeImageInputForUpload(input, projectRoot);
  if (isPublicRunningHubImageUrl(normalized)) return normalized.trim();
  const { buffer, mime, filename } = await readMediaBytes(normalized, projectRoot);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  const uploadUrl = `${env.apiBase}${env.uploadPath.startsWith("/") ? env.uploadPath : `/${env.uploadPath}`}`;
  const res = await fetch(uploadUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.apiKey}`, Accept: "application/json" },
    body: form as unknown as BodyInit,
  });
  const raw = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      typeof (raw as Record<string, unknown>)?.message === "string"
        ? String((raw as Record<string, unknown>).message)
        : JSON.stringify(raw).slice(0, 800);
    throw new Error(`RunningHub 媒体上传失败 (${res.status})：${msg}`);
  }
  const candidates = [raw, (raw as Record<string, unknown>)?.data].filter(Boolean);
  for (const item of candidates) {
    if (!item || typeof item !== "object") continue;
    const u =
      (item as Record<string, unknown>).download_url ??
      (item as Record<string, unknown>).downloadUrl ??
      (item as Record<string, unknown>).url;
    if (typeof u === "string" && u.startsWith("http")) return u;
  }
  throw new Error(`RunningHub 上传未返回 download_url：${JSON.stringify(raw).slice(0, 500)}`);
}

async function resolveMediaUrls(
  inputs: string[],
  projectRoot: string,
  env: StoryboardImageEnv,
  max: number
): Promise<string[]> {
  const out: string[] = [];
  for (const input of inputs.slice(0, max)) {
    if (!input?.trim()) continue;
    out.push(await uploadMediaToRunningHub(env, input.trim(), projectRoot));
  }
  return out;
}

export async function runHailuoH3VideoJob(opts: {
  prompt: string;
  images?: string[];
  videos?: string[];
  audios?: string[];
  resolution?: unknown;
  duration?: unknown;
  ratio?: unknown;
  projectRoot: string;
}): Promise<string> {
  const prompt = String(opts.prompt || "").trim();
  if (!prompt) throw new Error("缺少视频提示词");
  if (prompt.length > 20480) throw new Error("提示词过长（上限 20480）");

  const env = getRunningHubEnv();
  const imageUrls = await resolveInputsToRunningHubUrls(opts.images || [], opts.projectRoot, env);
  const videoUrls = await resolveMediaUrls(opts.videos || [], opts.projectRoot, env, 3);
  const audioUrls = await resolveMediaUrls(opts.audios || [], opts.projectRoot, env, 3);

  const body: Record<string, unknown> = {
    prompt,
    imageUrls: imageUrls.slice(0, 9),
    videoUrls,
    audioUrls,
    resolution: mapHailuoH3Resolution(opts.resolution),
    duration: mapHailuoH3Duration(opts.duration),
    ratio: mapHailuoH3Ratio(opts.ratio),
  };

  return submitAndPollRunningHub(env, getHailuoH3SubmitPath(), body, "canvas-video/hailuo-h3");
}
