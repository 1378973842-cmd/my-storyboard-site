/**
 * 新视角深度立板：服务端跑 Depth Anything Small（浏览器在国内常拉不到 HF）。
 */
import path from "path";
import { mkdirSync } from "fs";
import sharp from "sharp";
import { readUploadsBytes } from "./ossStore.js";
import {
  NOVEL_VIEW_DEPTH_INFER_MAX,
  normalizeDepth01,
} from "../lib/infiniteCanvas/novelViewDepth.js";

export interface NovelViewDepthResult {
  width: number;
  height: number;
  /** uint8 0–255，已归一化；0 近 255 远（未做中心近距翻转，客户端再 orient） */
  dataB64: string;
  model: string;
}

const MODEL_ID = "onnx-community/depth-anything-v2-small";
const HF_HOSTS = ["https://hf-mirror.com", "https://huggingface.co"];

type DepthPipe = (image: unknown) => Promise<{
  predicted_depth?: { data?: ArrayLike<number>; dims?: number[] };
  depth?: { data?: ArrayLike<number>; width?: number; height?: number };
}>;

let pipePromise: Promise<DepthPipe> | null = null;

function normalizeUploadsPath(raw: string): string | null {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/uploads/")) {
    const rel = trimmed.slice("/uploads/".length).replace(/\\/g, "/");
    if (!rel || rel.includes("..")) return null;
    return `/uploads/${rel}`;
  }
  try {
    const u = new URL(trimmed);
    if (u.pathname.startsWith("/uploads/")) {
      const rel = u.pathname.slice("/uploads/".length).replace(/\\/g, "/");
      if (!rel || rel.includes("..")) return null;
      return `/uploads/${rel}`;
    }
  } catch {
    /* ignore */
  }
  return null;
}

async function loadSourceBuffer(projectRoot: string, sourceUrl: string): Promise<Buffer> {
  const uploadsPath = normalizeUploadsPath(sourceUrl);
  if (uploadsPath) {
    const got = await readUploadsBytes(projectRoot, uploadsPath);
    if (got?.buffer?.length) return got.buffer;
    throw new Error(`找不到原图：${uploadsPath}`);
  }
  if (/^https?:\/\//i.test(sourceUrl)) {
    const r = await fetch(sourceUrl);
    if (!r.ok) throw new Error(`下载原图失败 (${r.status})`);
    return Buffer.from(await r.arrayBuffer());
  }
  throw new Error("不支持的原图地址");
}

async function loadPipeline(projectRoot: string): Promise<DepthPipe> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowRemoteModels = true;
  env.allowLocalModels = true;
  env.useBrowserCache = false;
  env.useFS = true;
  env.useFSCache = true;
  const cacheDir = path.join(projectRoot, "data", "hf-cache");
  mkdirSync(cacheDir, { recursive: true });
  env.cacheDir = cacheDir;
  let lastErr: unknown = null;
  for (const host of HF_HOSTS) {
    try {
      env.remoteHost = host;
      env.remotePathTemplate = "{model}/resolve/{revision}/{file}";
      return (await pipeline("depth-estimation", MODEL_ID, {
        dtype: "q8",
      })) as unknown as DepthPipe;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Depth Anything 模型加载失败");
}

function getPipeline(projectRoot: string): Promise<DepthPipe> {
  if (!pipePromise) {
    pipePromise = loadPipeline(projectRoot).catch((err) => {
      pipePromise = null;
      throw err;
    });
  }
  return pipePromise;
}

function tensorToFloat(t: { data?: ArrayLike<number> } | undefined): Float32Array | null {
  if (!t?.data) return null;
  if (t.data instanceof Float32Array) return t.data;
  return Float32Array.from(t.data as ArrayLike<number>);
}

export async function estimateNovelViewDepthOnServer(opts: {
  projectRoot: string;
  sourceUrl?: string;
  imageBuffer?: Buffer;
}): Promise<NovelViewDepthResult> {
  const sourceBuf = opts.imageBuffer?.length
    ? opts.imageBuffer
    : await loadSourceBuffer(opts.projectRoot, String(opts.sourceUrl || ""));
  const resized = sharp(sourceBuf).rotate().removeAlpha();
  const meta = await resized.metadata();
  const nw = Math.max(1, meta.width || 1);
  const nh = Math.max(1, meta.height || 1);
  const scale = Math.min(1, NOVEL_VIEW_DEPTH_INFER_MAX / Math.max(nw, nh));
  const w = Math.max(16, Math.round(nw * scale));
  const h = Math.max(16, Math.round(nh * scale));
  const png = await resized.resize(w, h, { fit: "fill" }).png().toBuffer();
  const { RawImage } = await import("@huggingface/transformers");
  const image = await RawImage.fromBlob(new Blob([png], { type: "image/png" }));
  const pipe = await getPipeline(opts.projectRoot);
  const out = await pipe(image);
  let raw = tensorToFloat(out?.predicted_depth);
  let width = 0;
  let height = 0;
  const dims = out?.predicted_depth?.dims;
  if (raw && Array.isArray(dims) && dims.length >= 2) {
    height = Number(dims[dims.length - 2]) || 0;
    width = Number(dims[dims.length - 1]) || 0;
  }
  if (!raw && out?.depth?.data && out.depth.width && out.depth.height) {
    width = out.depth.width;
    height = out.depth.height;
    raw = Float32Array.from(out.depth.data as ArrayLike<number>);
  }
  if (!raw?.length || !width || !height) throw new Error("深度图为空");
  const norm = normalizeDepth01(raw);
  const u8 = Buffer.alloc(norm.length);
  for (let i = 0; i < norm.length; i++) u8[i] = Math.round(norm[i] * 255);
  return {
    width,
    height,
    dataB64: u8.toString("base64"),
    model: "Depth Anything",
  };
}
