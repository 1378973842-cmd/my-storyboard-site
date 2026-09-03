import path from "path";
import { existsSync, readFileSync, statSync } from "fs";
import OSS from "ali-oss";

type OssClient = OSS;

let client: OssClient | null = null;

type UploadInput = {
  key: string;
  buffer: Buffer;
  mime?: string;
  /** 自定义 OSS 对象元数据（x-oss-meta-*），仅作调试/归属标记 */
  meta?: Record<string, string | number>;
};

/**
 * 是否需要把 /uploads/xxx 内部路径的 OSS key 映射成 /uploads/xxx（供数据库/画布 JSON 保存 & 请求走签名的统一入口）。
 */
function normalizeInternalPath(raw: string): string {
  const text = String(raw || "").trim().replace(/\\/g, "/");
  if (!text.startsWith("/uploads/")) return "";
  const rel = text.slice("/uploads/".length);
  if (!rel || rel.includes("..")) return "";
  return `/uploads/${rel}`;
}

function stripPrefix(key: string): string {
  const prefix = (process.env.OSS_PREFIX || "").replace(/\/$/, "");
  if (!prefix) return key;
  const norm = String(key || "").replace(/^\/+/, "");
  return norm.startsWith(prefix + "/") ? norm.slice(prefix.length + 1) : norm;
}

function mimeFromUploadsRel(rel: string): string {
  const ext = path.extname(rel).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  return "application/octet-stream";
}

/** 读 /uploads 字节：本地盘优先，没有则走 OSS。生图/生视频参考图不要 HTTP 拉站内地址（无登录态会 401，RH 当空图）。 */
export async function readUploadsBytes(
  projectRoot: string,
  internalPath: string
): Promise<{ buffer: Buffer; mime: string; filename: string } | null> {
  const normalized = normalizeInternalPath(internalPath);
  if (!normalized) return null;
  const rel = normalized.slice("/uploads/".length);
  const abs = path.join(projectRoot, "public", "uploads", rel);
  const root = path.join(projectRoot, "public", "uploads");
  if (!abs.startsWith(root)) return null;
  if (existsSync(abs)) {
    return { buffer: readFileSync(abs), mime: mimeFromUploadsRel(rel), filename: path.basename(abs) };
  }
  if (!isOssEnabled()) return null;
  try {
    const r = await getClient().get(mapUploadsPathToKey(normalized));
    const raw = r.content;
    const buffer = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as Uint8Array);
    if (!buffer.length) return null;
    return { buffer, mime: mimeFromUploadsRel(rel), filename: path.basename(rel) };
  } catch {
    return null;
  }
}

/** 相对路径或同源绝对 URL → 站内 `/uploads/...`；其它返回空。 */
export function parseUploadsPath(raw: string): string {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text.startsWith("/uploads/")) return normalizeInternalPath(text.split("?")[0]);
  try {
    const u = new URL(text);
    if (u.pathname.startsWith("/uploads/")) return normalizeInternalPath(u.pathname);
  } catch {
    /* ignore */
  }
  return "";
}

export async function uploadsAssetExists(
  projectRoot: string,
  internalPath: string
): Promise<boolean> {
  const normalized = parseUploadsPath(internalPath) || normalizeInternalPath(internalPath);
  if (!normalized) return false;
  const rel = normalized.slice("/uploads/".length);
  const abs = path.join(projectRoot, "public", "uploads", rel);
  const root = path.join(projectRoot, "public", "uploads");
  if (!abs.startsWith(root)) return false;
  if (existsSync(abs)) return true;
  if (!isOssEnabled()) return false;
  try {
    await getClient().head(mapUploadsPathToKey(normalized));
    return true;
  } catch {
    return false;
  }
}

/** 视觉模型 / 上游 API 用：本地盘或 OSS 读成 data URL，避免把要登录的 /uploads 交给第三方。 */
export async function uploadsToDataUrl(
  projectRoot: string,
  rawUrl: string
): Promise<string | null> {
  const internal = parseUploadsPath(rawUrl);
  if (!internal) return null;
  const got = await readUploadsBytes(projectRoot, internal);
  if (!got?.buffer?.length) return null;
  return `data:${got.mime};base64,${got.buffer.toString("base64")}`;
}

export function isOssEnabled(): boolean {
  return Boolean(
    process.env.OSS_BUCKET &&
      process.env.OSS_ACCESS_KEY_ID &&
      process.env.OSS_ACCESS_KEY_SECRET
  );
}

function getClient(): OssClient {
  if (client) return client;
  if (!isOssEnabled()) {
    throw new Error("OSS 未配置（缺少 OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET）");
  }
  const region = process.env.OSS_REGION || "oss-cn-hangzhou";
  const bucket = process.env.OSS_BUCKET || "";
  client = new OSS({
    region,
    bucket,
    accessKeyId: process.env.OSS_ACCESS_KEY_ID || "",
    accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET || "",
    secure: true,
  });
  return client;
}

/** 把内部站内路径映射为 OSS 对象 key（不含 /uploads/ 前缀），可选外加 OSS_PREFIX。 */
export function mapUploadsPathToKey(internalPath: string): string {
  const normalized = normalizeInternalPath(internalPath);
  if (!normalized) return String(internalPath || "").replace(/^\/+/, "");
  const rel = normalized.slice("/uploads/".length);
  const prefix = (process.env.OSS_PREFIX || "").replace(/^\/+|\/+$/g, "");
  return prefix ? `${prefix}/${rel}` : rel;
}

/** 把 OSS 对象 key 映射回站内相对路径（反向）。 */
export function keyToUploadsPath(key: string): string {
  const stripped = stripPrefix(key);
  return `/uploads/${stripped}`;
}

/** 生成一个用于私有读的签名 URL（默认 1 小时）。站内 /uploads 不要 302 到这里，否则 canvas 跨域污染。 */
export function signUploadsUrl(
  internalPath: string,
  opts: { ttlSeconds?: number } = {}
): string {
  if (!isOssEnabled()) {
    return internalPath;
  }
  const key = mapUploadsPathToKey(internalPath);
  const ttl = Number(opts.ttlSeconds || process.env.OSS_SIGN_TTL_SECONDS || 3600);
  const c = getClient();
  const url = c.signatureUrl(key, { expires: ttl });
  return url;
}

/** 浏览器直传：签名 PUT。Content-Type 必须与请求头一字不差。 */
export function signUploadsPutUrl(
  internalPath: string,
  opts: { mime?: string; ttlSeconds?: number } = {}
): string {
  const key = mapUploadsPathToKey(internalPath);
  const ttl = Number(opts.ttlSeconds || 600);
  const mime = opts.mime || "application/octet-stream";
  return getClient().signatureUrl(key, {
    method: "PUT",
    expires: ttl,
    "Content-Type": mime,
  });
}

function ossCorsOrigins(): string[] {
  const extra = String(process.env.OSS_CORS_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return [
    "https://dreamgrid.cn",
    "https://www.dreamgrid.cn",
    "http://localhost:3005",
    "http://127.0.0.1:3005",
    ...extra,
  ];
}

/** 允许浏览器 GET 签名图 / PUT 直传。无 PutBucketCORS 权限时只打日志，不挡启动。 */
export async function ensureOssBucketCors(): Promise<void> {
  if (!isOssEnabled()) return;
  const bucket = process.env.OSS_BUCKET || "";
  try {
    await getClient().putBucketCORS(bucket, [
      {
        allowedOrigin: ossCorsOrigins(),
        allowedMethod: ["GET", "HEAD", "PUT", "POST"],
        allowedHeader: ["*"],
        exposeHeader: ["ETag", "Content-Length", "x-oss-request-id"],
        maxAgeSeconds: "3600",
      },
    ]);
  } catch (e) {
    console.warn("[oss] putBucketCORS 失败（直传会回退本站上传）", (e as Error)?.message);
  }
}

function headerVal(headers: Record<string, unknown>, name: string): string {
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers || {})) {
    if (k.toLowerCase() === lower && v != null) return String(v);
  }
  return "";
}

/** HEAD：本地优先，否则 OSS。给视频播放器 Length / Type，避免整文件入内存。 */
export async function headUploadsObject(
  projectRoot: string,
  internalPath: string
): Promise<{ mime: string; size: number } | null> {
  const normalized = normalizeInternalPath(internalPath);
  if (!normalized) return null;
  const rel = normalized.slice("/uploads/".length);
  const abs = path.join(projectRoot, "public", "uploads", rel);
  const root = path.join(projectRoot, "public", "uploads");
  if (abs.startsWith(root) && existsSync(abs)) {
    try {
      return { mime: mimeFromUploadsRel(rel), size: statSync(abs).size };
    } catch {
      /* fall through */
    }
  }
  if (!isOssEnabled()) return null;
  try {
    const r = await getClient().head(mapUploadsPathToKey(normalized));
    const headers = (r.res?.headers || {}) as Record<string, unknown>;
    const size = Number(headerVal(headers, "content-length") || 0);
    const mime = headerVal(headers, "content-type") || mimeFromUploadsRel(rel);
    return { mime, size };
  } catch {
    return null;
  }
}

/** 流式读 OSS（支持 Range）。站内代理用，禁止整段视频 load 进 2G ECS。 */
export async function streamUploadsObject(
  internalPath: string,
  opts?: { range?: string }
): Promise<{
  stream: NodeJS.ReadableStream;
  status: number;
  headers: Record<string, string>;
} | null> {
  if (!isOssEnabled()) return null;
  const normalized = normalizeInternalPath(internalPath);
  if (!normalized) return null;
  const key = mapUploadsPathToKey(normalized);
  const options = opts?.range ? { headers: { Range: opts.range } } : undefined;
  try {
    const result = await getClient().getStream(key, options);
    const raw = (result.res?.headers || {}) as Record<string, unknown>;
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (v != null) headers[k] = String(v);
    }
    return {
      stream: result.stream as NodeJS.ReadableStream,
      status: Number(result.res?.status || (opts?.range ? 206 : 200)),
      headers,
    };
  } catch {
    return null;
  }
}

/** 上传 Buffer 到 OSS（私有对象）。返回内部站内路径 `/uploads/...`。 */
export async function uploadBufferToOss(input: UploadInput): Promise<string> {
  const c = getClient();
  const mime = input.mime || "application/octet-stream";
  // meta 仅作对象标记；UserMeta 类型要求 uid/pid，用宽松断言以兼容自定义键
  const opts: OSS.PutObjectOptions = { mime };
  if (input.meta) opts.meta = input.meta as OSS.UserMeta;
  await c.put(input.key, input.buffer, opts);
  return keyToUploadsPath(input.key);
}

/**
 * 懒迁移 / 兜底：当 OSS 已启用但该对象尚未存在时，把本地 public/uploads 的对应文件抓下来传上 OSS。
 * 返回 true 表示已上传成功；false 表示本地也没有 / OSS 未启用。
 */
export async function ensureOssObjectUploaded(
  projectRoot: string,
  internalPath: string
): Promise<boolean> {
  if (!isOssEnabled()) return false;
  const normalized = normalizeInternalPath(internalPath);
  if (!normalized) return false;
  const key = mapUploadsPathToKey(normalized);
  const c = getClient();
  try {
    await c.head(key);
    return true; // 已在 OSS
  } catch {
    // 不存在，从本地读取上传
  }
  const localAbs = path.join(
    projectRoot,
    "public",
    normalized.replace(/^\/uploads\//, "uploads/")
  );
  if (!existsSync(localAbs)) return false;
  try {
    const buffer = readFileSync(localAbs);
    const ext = path.extname(localAbs).toLowerCase();
    const mime =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
          ? "image/webp"
          : ext === ".gif"
            ? "image/gif"
            : ext === ".mp4"
              ? "video/mp4"
              : ext === ".webm"
                ? "video/webm"
                : ext === ".mov"
                  ? "video/quicktime"
                  : "image/png";
    await c.put(key, buffer, { mime });
    return true;
  } catch (e) {
    console.warn("[oss] lazy upload failed", key, (e as Error)?.message);
    return false;
  }
}

