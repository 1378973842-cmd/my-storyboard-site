import { readFileSync, existsSync } from "fs";
import path from "path";
import { FormData } from "undici";

export type StoryboardImageEnv = {
  apiBase: string;
  apiKey: string;
  editPath: string;
  gptPath: string;
  t2iPath: string;
  queryPath: string;
  uploadPath: string;
  gptQuality: string;
};

export const RUNNINGHUB_G2_RATIOS = [
  "1:1",
  "1:2",
  "2:1",
  "1:3",
  "3:1",
  "2:3",
  "3:2",
  "3:4",
  "4:3",
  "4:5",
  "5:4",
  "9:16",
  "16:9",
  "21:9",
  "9:21",
] as const;

export type RunningHubG2AspectRatio = (typeof RUNNINGHUB_G2_RATIOS)[number];

export function getStoryboardImageEnv(): StoryboardImageEnv | null {
  let apiKey = (process.env.STORYBOARD_IMAGE_API_KEY ?? "").trim();
  if (/^bearer\s+/i.test(apiKey)) apiKey = apiKey.replace(/^bearer\s+/i, "").trim();
  if (!apiKey) return null;

  const apiBase = (process.env.STORYBOARD_IMAGE_API_BASE ?? "https://www.runninghub.cn").replace(/\/+$/, "");
  const editPath =
    (process.env.STORYBOARD_IMAGE_EDIT_PATH ?? "/openapi/v2/rhart-image-n-pro/edit").trim() ||
    "/openapi/v2/rhart-image-n-pro/edit";
  const gptPath =
    (process.env.STORYBOARD_IMAGE_GPT_PATH ?? "/openapi/v2/rhart-image-g-2/image-to-image").trim() ||
    "/openapi/v2/rhart-image-g-2/image-to-image";
  const t2iPath =
    (process.env.STORYBOARD_IMAGE_T2I_PATH ?? "/openapi/v2/rhart-image-n-pro-official/text-to-image").trim() ||
    "/openapi/v2/rhart-image-n-pro-official/text-to-image";

  return {
    apiBase,
    apiKey,
    editPath,
    gptPath,
    t2iPath,
    queryPath: (process.env.STORYBOARD_IMAGE_QUERY_PATH ?? "/openapi/v2/query").trim() || "/openapi/v2/query",
    uploadPath:
      (process.env.STORYBOARD_IMAGE_UPLOAD_PATH ?? "/openapi/v2/media/upload/binary").trim() ||
      "/openapi/v2/media/upload/binary",
    gptQuality: (process.env.STORYBOARD_IMAGE_GPT_QUALITY ?? "medium").trim().toLowerCase() || "medium",
  };
}

export function mapRunningHubResolution(imageSize: unknown): "1k" | "2k" | "4k" {
  const raw = String(imageSize ?? "2K").trim().toUpperCase();
  if (raw === "1K") return "1k";
  if (raw === "4K") return "4k";
  return "2k";
}

export function mapRunningHubG2OutputParams(imageSize: unknown, aspectRatio: unknown, qualityOverride?: unknown): {
  resolution: "1k" | "2k" | "4k";
  aspectRatio: string;
  quality: "low" | "medium" | "high";
} {
  const env = getStoryboardImageEnv();
  const override = String(qualityOverride ?? "").trim().toLowerCase();
  let quality: "low" | "medium" | "high" = "medium";
  if (override === "low" || override === "medium" || override === "high") {
    quality = override;
  } else {
    const q = (env?.gptQuality || "medium").toLowerCase();
    quality = q === "low" || q === "high" ? q : "medium";
  }
  const ratio = String(aspectRatio ?? "1:1").trim();
  const allowed = new Set<string>(RUNNINGHUB_G2_RATIOS as unknown as string[]);
  return {
    resolution: mapRunningHubResolution(imageSize),
    aspectRatio: allowed.has(ratio) ? ratio : "1:1",
    quality,
  };
}

function rhUrl(env: StoryboardImageEnv, subPath: string): string {
  const p = subPath.startsWith("/") ? subPath : `/${subPath}`;
  return `${env.apiBase}${p}`;
}

function rhHeaders(env: StoryboardImageEnv, json = true): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${env.apiKey}`,
    Accept: "application/json",
  };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function queryStatus(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  const data = o.data;
  const values = [o.status, o.state, o.taskStatus, o.task_status];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    values.push(d.status, d.state, d.taskStatus, d.task_status);
  }
  for (const v of values) {
    if (v != null && String(v).trim()) return String(v).trim().toUpperCase();
  }
  return "";
}

function extractTaskId(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const o = raw as Record<string, unknown>;
  for (const key of ["taskId", "task_id", "id"]) {
    if (o[key]) return String(o[key]);
  }
  const data = o.data;
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    for (const key of ["taskId", "task_id", "id"]) {
      if (d[key]) return String(d[key]);
    }
  }
  return "";
}

function extractResultUrl(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const containers: Record<string, unknown>[] = [raw as Record<string, unknown>];
  const data = (raw as Record<string, unknown>).data;
  if (data && typeof data === "object") containers.push(data as Record<string, unknown>);

  for (const container of containers) {
    let results = container.results ?? container.result ?? container.outputs ?? container.output;
    if (results && typeof results === "object" && !Array.isArray(results)) results = [results];
    if (Array.isArray(results)) {
      for (const item of results) {
        if (typeof item === "string" && /^https?:\/\//i.test(item)) return item;
        if (item && typeof item === "object") {
          const u =
            (item as Record<string, unknown>).url ??
            (item as Record<string, unknown>).download_url ??
            (item as Record<string, unknown>).downloadUrl;
          if (typeof u === "string" && /^https?:\/\//i.test(u)) return u;
        }
      }
    }
    for (const key of ["url", "download_url", "downloadUrl", "imageUrl", "image_url"]) {
      const v = container[key];
      if (typeof v === "string" && /^https?:\/\//i.test(v)) return v;
    }
  }
  return null;
}

function isTerminalSuccess(status: string): boolean {
  return ["SUCCESS", "SUCCEEDED", "COMPLETED", "COMPLETE", "FINISHED", "DONE", "3"].includes(status);
}

function isTerminalFailed(status: string): boolean {
  return ["FAILED", "FAIL", "ERROR", "CANCELED", "CANCELLED", "4"].includes(status);
}

async function readImageBytes(input: string, projectRoot: string): Promise<{ buffer: Buffer; mime: string; filename: string }> {
  const trimmed = input.trim();
  const dataMatch = /^data:(image\/[^;]+);base64,(.+)$/is.exec(trimmed);
  if (dataMatch) {
    const mime = dataMatch[1];
    const buf = Buffer.from(dataMatch[2].replace(/\s/g, ""), "base64");
    return { buffer: buf, mime, filename: `upload.${mime.includes("png") ? "png" : "jpg"}` };
  }
  if (trimmed.startsWith("/uploads/")) {
    const rel = trimmed.replace(/^\/uploads\//, "").replace(/\\/g, "/");
    if (rel.includes("..")) throw new Error("非法图片路径");
    const abs = path.join(projectRoot, "public", "uploads", rel);
    if (!existsSync(abs)) throw new Error(`本地图片不存在：${trimmed}`);
    const buf = readFileSync(abs);
    const ext = path.extname(abs).toLowerCase() || ".png";
    const mime =
      ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : ext === ".gif" ? "image/gif" : "image/jpeg";
    return { buffer: buf, mime, filename: path.basename(abs) };
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const resp = await fetch(trimmed);
    if (!resp.ok) throw new Error(`拉取图片失败 (${resp.status})`);
    const mime = (resp.headers.get("content-type") || "image/png").split(";")[0];
    const buf = Buffer.from(await resp.arrayBuffer());
    return { buffer: buf, mime, filename: "remote.jpg" };
  }
  if (/^[a-z0-9+/=\r\n]+$/i.test(trimmed) && trimmed.length > 200) {
    const buf = Buffer.from(trimmed.replace(/\s/g, ""), "base64");
    return { buffer: buf, mime: "image/png", filename: "base64.png" };
  }
  throw new Error("不支持的图片输入（需要 data URL、/uploads/ 路径或 http(s) URL）");
}

/** RunningHub / 第三方云端无法访问 localhost / 内网 URL */
export function isPublicRunningHubImageUrl(url: string): boolean {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1" || host === "::1" || host.endsWith(".local")) {
      return false;
    }
    if (/^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) {
      return false;
    }
    const port = u.port || (u.protocol === "https:" ? "443" : "80");
    if (port !== "80" && port !== "443") return false;
    return true;
  } catch {
    return false;
  }
}

/** 将本站绝对 URL 还原为 /uploads/…，便于读本地文件并上传到 RunningHub */
export function normalizeImageInputForUpload(input: string, projectRoot: string): string {
  const trimmed = input.trim();
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) return trimmed;
  try {
    const u = new URL(trimmed);
    if (!u.pathname.startsWith("/uploads/")) return trimmed;
    const rel = u.pathname.replace(/^\/uploads\//, "").replace(/\\/g, "/");
    if (rel.includes("..")) return trimmed;
    const abs = path.join(projectRoot, "public", "uploads", rel);
    if (existsSync(abs)) return u.pathname;
  } catch {
    /* ignore */
  }
  return trimmed;
}

export async function uploadBinaryToRunningHub(
  env: StoryboardImageEnv,
  input: string,
  projectRoot: string
): Promise<string> {
  const normalized = normalizeImageInputForUpload(input, projectRoot);
  if (isPublicRunningHubImageUrl(normalized)) {
    return normalized.trim();
  }
  const { buffer, mime, filename } = await readImageBytes(normalized, projectRoot);
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  const res = await fetch(rhUrl(env, env.uploadPath), {
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
    throw new Error(`RunningHub 上传失败 (${res.status})：${msg}`);
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

export async function resolveInputsToRunningHubUrls(
  inputs: string[],
  projectRoot: string,
  env: StoryboardImageEnv
): Promise<string[]> {
  const out: string[] = [];
  for (const input of inputs.slice(0, 10)) {
    if (!input?.trim()) continue;
    out.push(await uploadBinaryToRunningHub(env, input.trim(), projectRoot));
  }
  return out;
}

export async function submitAndPollRunningHub(
  env: StoryboardImageEnv,
  submitPath: string,
  body: Record<string, unknown>,
  logTag: string
): Promise<string> {
  const pollMs = Number(process.env.STORYBOARD_IMAGE_POLL_MS || 2000);
  const deadline = Date.now() + Number(process.env.STORYBOARD_IMAGE_TIMEOUT_MS || 1800000);

  console.log(`[${logTag}] submit`, {
    path: submitPath,
    resolution: body.resolution,
    aspectRatio: body.aspectRatio,
    imageUrlCount: Array.isArray(body.imageUrls) ? body.imageUrls.length : 0,
  });

  const submitRes = await fetch(rhUrl(env, submitPath), {
    method: "POST",
    headers: rhHeaders(env),
    body: JSON.stringify(body),
  });
  const submitRaw = await submitRes.json().catch(() => ({}));
  if (!submitRes.ok) {
    const msg =
      typeof (submitRaw as Record<string, unknown>)?.message === "string"
        ? String((submitRaw as Record<string, unknown>).message)
        : JSON.stringify(submitRaw).slice(0, 800);
    throw new Error(`RunningHub 提交失败 (${submitRes.status})：${msg}`);
  }

  const immediate = extractResultUrl(submitRaw);
  if (immediate) return immediate;

  const taskId = extractTaskId(submitRaw);
  if (!taskId) throw new Error(`RunningHub 未返回 taskId：${JSON.stringify(submitRaw).slice(0, 500)}`);

  console.log(`[${logTag}] taskId=${taskId}, polling…`);

  let lastPayload: unknown = null;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    const qRes = await fetch(rhUrl(env, env.queryPath), {
      method: "POST",
      headers: rhHeaders(env),
      body: JSON.stringify({ taskId }),
    });
    const qRaw = await qRes.json().catch(() => ({}));
    lastPayload = qRaw;
    if (!qRes.ok) {
      const msg =
        typeof (qRaw as Record<string, unknown>)?.message === "string"
          ? String((qRaw as Record<string, unknown>).message)
          : JSON.stringify(qRaw).slice(0, 500);
      throw new Error(`RunningHub 查询失败 (${qRes.status})：${msg}`);
    }
    const status = queryStatus(qRaw);
    if (isTerminalSuccess(status)) {
      const url = extractResultUrl(qRaw);
      if (!url) throw new Error(`RunningHub 任务成功但未解析到 results[0].url：${JSON.stringify(qRaw).slice(0, 500)}`);
      return url;
    }
    if (isTerminalFailed(status)) {
      throw new Error(`RunningHub 任务失败：${JSON.stringify(qRaw).slice(0, 800)}`);
    }
  }
  throw new Error(`RunningHub 任务超时：${JSON.stringify(lastPayload).slice(0, 500)}`);
}

export async function runStoryboardRunningHubJob(opts: {
  prompt: string;
  images: string[];
  image_size?: unknown;
  aspect_ratio?: unknown;
  projectRoot: string;
}): Promise<string> {
  const env = getStoryboardImageEnv();
  if (!env) throw new Error("未配置 STORYBOARD_IMAGE_API_KEY");
  const imageUrls = await resolveInputsToRunningHubUrls(opts.images, opts.projectRoot, env);
  if (!imageUrls.length) throw new Error("缺少参考图");
  const body = {
    prompt: opts.prompt.trim(),
    imageUrls,
    resolution: mapRunningHubResolution(opts.image_size),
    aspectRatio: String(opts.aspect_ratio || "1:1").trim() || "1:1",
  };
  return submitAndPollRunningHub(env, env.editPath, body, "edit-image/runninghub");
}

export async function runStoryboardRunningHubG2Job(opts: {
  prompt: string;
  images: string[];
  image_size?: unknown;
  aspect_ratio?: unknown;
  quality?: unknown;
  projectRoot: string;
}): Promise<string> {
  const env = getStoryboardImageEnv();
  if (!env) throw new Error("未配置 STORYBOARD_IMAGE_API_KEY");
  const imageUrls = await resolveInputsToRunningHubUrls(opts.images, opts.projectRoot, env);
  if (!imageUrls.length) throw new Error("缺少参考图");
  const g2 = mapRunningHubG2OutputParams(opts.image_size, opts.aspect_ratio, opts.quality);
  const body = {
    prompt: opts.prompt.trim(),
    imageUrls,
    resolution: g2.resolution,
    aspectRatio: g2.aspectRatio,
    quality: g2.quality,
  };
  return submitAndPollRunningHub(env, env.gptPath, body, "edit-image/runninghub-g2");
}

export function extractCitedReferenceIndices(text: string, maxReferences: number): number[] {
  const re = /(?:@资产|@图|图)\s*\[?\s*(\d{1,3})\s*\]?/gu;
  const out = new Set<number>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const n = Number.parseInt(m[1], 10);
    if (!Number.isFinite(n) || n <= 0) continue;
    const idx = n - 1;
    if (idx >= 0 && idx < maxReferences) out.add(idx);
  }
  return Array.from(out);
}

export async function runStoryboardRunningHubGenerateJob(opts: {
  prompt: string;
  image_size?: unknown;
  aspect_ratio?: unknown;
  references?: Array<{ url?: string } | string>;
  projectRoot: string;
}): Promise<string> {
  const env = getStoryboardImageEnv();
  if (!env) throw new Error("未配置 STORYBOARD_IMAGE_API_KEY");
  const refs = (opts.references || [])
    .map((r) => (typeof r === "string" ? r : r?.url))
    .filter((u): u is string => typeof u === "string" && u.trim().length > 0);

  const cited = extractCitedReferenceIndices(opts.prompt, refs.length);
  const resolution = mapRunningHubResolution(opts.image_size);
  const aspectRatio = String(opts.aspect_ratio || "16:9").trim() || "16:9";

  if (cited.length > 0 && refs.length > 0) {
    const urls = cited.map((i) => refs[i]).filter(Boolean);
    const imageUrls = await resolveInputsToRunningHubUrls(urls, opts.projectRoot, env);
    const body = { prompt: opts.prompt.trim(), imageUrls, resolution, aspectRatio };
    return submitAndPollRunningHub(env, env.editPath, body, "generate-image/runninghub-edit");
  }

  const body = { prompt: opts.prompt.trim(), resolution, aspectRatio };
  return submitAndPollRunningHub(env, env.t2iPath, body, "generate-image/runninghub-t2i");
}

export const RUNNINGHUB_YOUCHUAN_RATIOS = ["1:1", "4:3", "3:2", "16:9", "3:4", "2:3", "9:16"] as const;
/** @deprecated use RUNNINGHUB_YOUCHUAN_RATIOS */
export const RUNNINGHUB_MJ_V81_RATIOS = RUNNINGHUB_YOUCHUAN_RATIOS;

function clampRhNum(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function isMidjourneyV81Model(model?: string): boolean {
  return /^midjourneyv8\.1$/i.test(String(model || "").trim());
}

export function isNiji7Model(model?: string): boolean {
  return /^niji7$/i.test(String(model || "").trim());
}

async function resolveYouchuanImageRefs(
  imageUrl: string | null | undefined,
  sref: string | null | undefined,
  projectRoot: string,
  env: StoryboardImageEnv
): Promise<{ imageUrl: string | null; sref: string | null }> {
  let resolvedImageUrl: string | null = null;
  if (imageUrl?.trim()) {
    const urls = await resolveInputsToRunningHubUrls([imageUrl.trim()], projectRoot, env);
    resolvedImageUrl = urls[0] || null;
  }
  let resolvedSref: string | null = null;
  if (sref?.trim()) {
    const urls = await resolveInputsToRunningHubUrls([sref.trim()], projectRoot, env);
    resolvedSref = urls[0] || null;
  }
  return { imageUrl: resolvedImageUrl, sref: resolvedSref };
}

function mapYouchuanAspectRatio(aspect_ratio?: unknown): string {
  const allowed = new Set<string>(RUNNINGHUB_YOUCHUAN_RATIOS as unknown as string[]);
  const aspectRatioRaw = String(aspect_ratio || "1:1").trim() || "1:1";
  return allowed.has(aspectRatioRaw) ? aspectRatioRaw : "1:1";
}

export async function runStoryboardRunningHubMjV81Job(opts: {
  prompt: string;
  aspect_ratio?: unknown;
  chaos?: unknown;
  quality?: unknown;
  stylize?: unknown;
  raw?: unknown;
  imageUrl?: string | null;
  iw?: unknown;
  sref?: string | null;
  sw?: unknown;
  sv?: unknown;
  hd?: unknown;
  projectRoot: string;
}): Promise<string> {
  const env = getStoryboardImageEnv();
  if (!env) throw new Error("未配置 STORYBOARD_IMAGE_API_KEY");
  const mjPath =
    (process.env.STORYBOARD_IMAGE_MJ_V81_PATH ?? "/openapi/v2/youchuan/text-to-image-v81").trim() ||
    "/openapi/v2/youchuan/text-to-image-v81";

  const { imageUrl, sref } = await resolveYouchuanImageRefs(opts.imageUrl, opts.sref, opts.projectRoot, env);
  const aspectRatio = mapYouchuanAspectRatio(opts.aspect_ratio);
  const qualityRaw = String(opts.quality ?? "1").trim();
  const quality = qualityRaw === "4" ? "4" : "1";

  const body: Record<string, unknown> = {
    prompt: opts.prompt.trim(),
    chaos: Math.round(clampRhNum(opts.chaos, 0, 100, 0)),
    quality,
    stylize: Math.round(clampRhNum(opts.stylize, 0, 1000, 0)),
    raw: Boolean(opts.raw),
    imageUrl,
    iw: clampRhNum(opts.iw, 0, 3, 1),
    sref,
    sw: Math.round(clampRhNum(opts.sw, 0, 1000, 100)),
    sv: 6,
    aspectRatio,
    hd: Boolean(opts.hd),
  };

  return submitAndPollRunningHub(env, mjPath, body, "canvas-image/mj-v81");
}

export async function runStoryboardRunningHubNiji7Job(opts: {
  prompt: string;
  aspect_ratio?: unknown;
  chaos?: unknown;
  stylize?: unknown;
  weird?: unknown;
  raw?: unknown;
  imageUrl?: string | null;
  iw?: unknown;
  sref?: string | null;
  sw?: unknown;
  sv?: unknown;
  projectRoot: string;
}): Promise<string> {
  const env = getStoryboardImageEnv();
  if (!env) throw new Error("未配置 STORYBOARD_IMAGE_API_KEY");
  const nijiPath =
    (process.env.STORYBOARD_IMAGE_NIJI7_PATH ?? "/openapi/v2/youchuan/text-to-image-niji7").trim() ||
    "/openapi/v2/youchuan/text-to-image-niji7";

  const { imageUrl, sref } = await resolveYouchuanImageRefs(opts.imageUrl, opts.sref, opts.projectRoot, env);
  const aspectRatio = mapYouchuanAspectRatio(opts.aspect_ratio);

  const body: Record<string, unknown> = {
    prompt: opts.prompt.trim(),
    chaos: Math.round(clampRhNum(opts.chaos, 0, 100, 0)),
    stylize: Math.round(clampRhNum(opts.stylize, 0, 1000, 0)),
    weird: Math.round(clampRhNum(opts.weird, 0, 3000, 0)),
    raw: Boolean(opts.raw),
    imageUrl,
    iw: clampRhNum(opts.iw, 0, 2, 1),
    sref,
    sw: Math.round(clampRhNum(opts.sw, 0, 1000, 100)),
    sv: Math.round(clampRhNum(opts.sv, 1, 4, 4)),
    aspectRatio,
  };

  return submitAndPollRunningHub(env, nijiPath, body, "canvas-image/niji7");
}
