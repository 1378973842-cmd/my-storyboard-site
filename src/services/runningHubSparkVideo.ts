/**
 * RunningHub Seedance 2.0（路径 sparkvideo-2.0）：multimodal-video
 * POST /openapi/v2/rhart-video/sparkvideo-2.0/multimodal-video
 */
import {
  getStoryboardImageEnv,
  resolveInputsToRunningHubUrls,
  submitAndPollRunningHub,
} from "./runningHubStoryboardImage.js";
import { getRunningHubEnv, resolveMediaUrls } from "./runningHubHailuoVideo.js";

export const RUNNINGHUB_SPARKVIDEO_20_PATH =
  "/openapi/v2/rhart-video/sparkvideo-2.0/multimodal-video";
export const SEEDANCE_2_MODEL_ID = "seedance-2.0";

export const SPARK_VIDEO_RESOLUTIONS = [
  "480p",
  "720p",
  "native1080p",
  "native4k",
  "1080p",
  "2k",
  "4k",
] as const;

export const SPARK_VIDEO_RATIOS = [
  "adaptive",
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
] as const;

export function isSparkVideo20Model(model?: string): boolean {
  const m = String(model || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return (
    m === "seedance-2.0" ||
    m === "seedance-2" ||
    m === "seedance2.0" ||
    m === "sparkvideo-2.0" ||
    m === "spark-video-2.0" ||
    m.includes("sparkvideo-2") ||
    m.includes("seedance-2")
  );
}

export function getSparkVideo20SubmitPath(): string {
  return (
    (process.env.RUNNINGHUB_SPARKVIDEO_20_PATH ?? RUNNINGHUB_SPARKVIDEO_20_PATH).trim() ||
    RUNNINGHUB_SPARKVIDEO_20_PATH
  );
}

export function mapSparkVideoResolution(raw: unknown): (typeof SPARK_VIDEO_RESOLUTIONS)[number] {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (text === "native1080p" || text === "native-1080p") return "native1080p";
  if (text === "native4k" || text === "native-4k") return "native4k";
  if (text === "480p" || text === "480") return "480p";
  if (text === "1080p" || text === "1080") return "1080p";
  if (text === "2k" || text === "2kp" || text === "1440p") return "2k";
  if (text === "4k" || text === "4kp" || text === "2160p") return "4k";
  if (text === "768p" || text === "768") return "720p";
  return "720p";
}

export function mapSparkVideoDuration(raw: unknown): string {
  const text = String(raw ?? "").trim();
  if (text === "-1") return "5";
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return "5";
  return String(Math.max(4, Math.min(15, n)));
}

export function mapSparkVideoRatio(raw: unknown): (typeof SPARK_VIDEO_RATIOS)[number] {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!text || text === "keep_ratio" || text === "keep" || text === "auto" || text === "adapt") {
    return "adaptive";
  }
  const allowed = new Set<string>(SPARK_VIDEO_RATIOS as unknown as string[]);
  if (allowed.has(text)) return text as (typeof SPARK_VIDEO_RATIOS)[number];
  return "adaptive";
}

export async function runSparkVideo20Job(opts: {
  prompt: string;
  images?: string[];
  videos?: string[];
  audios?: string[];
  resolution?: unknown;
  duration?: unknown;
  ratio?: unknown;
  generateAudio?: boolean;
  realPersonMode?: boolean;
  watermark?: boolean;
  seed?: unknown;
  projectRoot: string;
}): Promise<string> {
  const prompt = String(opts.prompt || "").trim();
  if (!prompt) throw new Error("缺少视频提示词");
  if (prompt.length > 20480) throw new Error("提示词过长（上限 20480）");

  const env = getStoryboardImageEnv() || getRunningHubEnv();
  const imageUrls = await resolveInputsToRunningHubUrls(opts.images || [], opts.projectRoot, env, {
    flattenAlpha: true,
  });
  const videoUrls = await resolveMediaUrls(opts.videos || [], opts.projectRoot, env, 3);
  const audioUrls = await resolveMediaUrls(opts.audios || [], opts.projectRoot, env, 3);

  const seedRaw = Math.round(Number(opts.seed));
  const seed = Number.isFinite(seedRaw) ? Math.max(-1, Math.min(2147483647, seedRaw)) : -1;

  const body: Record<string, unknown> = {
    prompt,
    resolution: mapSparkVideoResolution(opts.resolution),
    duration: mapSparkVideoDuration(opts.duration),
    imageUrls: imageUrls.slice(0, 9),
    videoUrls,
    audioUrls,
    generateAudio: opts.generateAudio !== false,
    ratio: mapSparkVideoRatio(opts.ratio),
    realPersonMode: opts.realPersonMode !== false,
    conversionSlots: ["all"],
    returnLastFrame: false,
    seed,
    watermark: Boolean(opts.watermark),
  };

  return submitAndPollRunningHub(env, getSparkVideo20SubmitPath(), body, "canvas-video/seedance-2.0");
}
