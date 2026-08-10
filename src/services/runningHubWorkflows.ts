import type { Express, Request, RequestHandler } from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { FormData } from "undici";
import { formatRhApiError } from "../lib/runningHubAdmin.js";

/**
 * RunningHub 自定义工作流 / AI 应用：从旧版 Python 服务（canvas_source/main.py）1:1 移植的
 * 运行时接口（提交/查询/上传/预览）与配置管理接口（工作流、AI 应用的增删改查）。
 */

export type RhWorkflowField = {
  id: string;
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  fieldType: string;
  label: string;
  enabled: boolean;
  sourceFromUpstream: boolean;
  group: string;
  note: string;
  options: string[];
  random_enabled: boolean;
  min: string | number;
  max: string | number;
  step: string | number;
  imageOrder: number;
  required: boolean;
};

export type RhWorkflowConfig = {
  workflowId: string;
  title: string;
  description: string;
  fields: RhWorkflowField[];
  workflowJson: Record<string, unknown>;
  optionalImageMode: string;
  raw: unknown;
  updatedAt: number;
};

export type RhAppConfig = {
  appId: string;
  title: string;
  description: string;
  fields: RhWorkflowField[];
  raw: unknown;
  updatedAt: number;
};

export type RunningHubWorkflowDeps = {
  projectRoot: string;
  /** 与生图/画布共用的登录 Cookie 校验中间件；缺省不校验（仅独立画布服务） */
  requireGate?: RequestHandler;
  /** RH 配置增删改与列表：仅管理员（画布读单条工作流仍用 requireGate） */
  requireAdmin?: RequestHandler;
};

function httpError(status: number, message: string): Error & { status: number } {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  return err;
}

function isSuccessCode(code: unknown): boolean {
  return code === 0 || code === "0";
}

// ---------------------------------------------------------------------------
// RunningHub 客户端：Base URL / API Key（新变量优先，回退到分镜生图已有配置）
// ---------------------------------------------------------------------------

function runninghubApiBase(): string {
  const base = (process.env.RUNNINGHUB_API_BASE || process.env.STORYBOARD_IMAGE_API_BASE || "https://www.runninghub.cn").trim();
  return (base || "https://www.runninghub.cn").replace(/\/+$/, "");
}

function normalizeRunningHubApiKey(raw: string): string {
  let key = String(raw || "").trim();
  if (/^bearer\s+/i.test(key)) key = key.replace(/^bearer\s+/i, "").trim();
  return key;
}

export type RunningHubApiKeyEntry = {
  id: string;
  label: string;
  key: string;
};

/** 服务端完整列表（含密钥）；勿直接下发前端。 */
function listRunningHubApiKeyEntries(): RunningHubApiKeyEntry[] {
  const out: RunningHubApiKeyEntry[] = [];
  const push = (id: string, label: string, raw: string) => {
    const key = normalizeRunningHubApiKey(raw);
    if (!key) return;
    if (out.some((item) => item.key === key)) return;
    out.push({ id, label, key });
  };
  push("credit", "key1", process.env.RUNNINGHUB_API_KEY || process.env.STORYBOARD_IMAGE_API_KEY || "");
  push("wallet", "wallet", process.env.RUNNINGHUB_WALLET_API_KEY || "");
  // 额外 Key：RUNNINGHUB_API_KEYS="key2:sk-1|key3:sk-2"
  const extra = String(process.env.RUNNINGHUB_API_KEYS || "").trim();
  if (extra) {
    const parts = extra.split("|").map((s) => s.trim()).filter(Boolean);
    parts.forEach((part, index) => {
      const colon = part.indexOf(":");
      if (colon > 0) {
        push(`extra-${index + 1}`, part.slice(0, colon).trim() || `key${index + 2}`, part.slice(colon + 1));
      } else {
        push(`extra-${index + 1}`, `key${index + 2}`, part);
      }
    });
  }
  return out;
}

/** 前端下拉只用 id + 显示名，不含密钥正文。 */
export function listRunningHubApiKeysForClient(): Array<{ id: string; label: string }> {
  return listRunningHubApiKeyEntries().map(({ id, label }) => ({ id, label }));
}

function runninghubApiKeyRaw(useWallet: boolean): string {
  if (useWallet) {
    const wallet = normalizeRunningHubApiKey(process.env.RUNNINGHUB_WALLET_API_KEY || "");
    if (wallet) return wallet;
  }
  return normalizeRunningHubApiKey(process.env.RUNNINGHUB_API_KEY || process.env.STORYBOARD_IMAGE_API_KEY || "");
}

function runninghubApiKey(useWallet = false): string {
  const key = runninghubApiKeyRaw(useWallet);
  if (!key) throw httpError(400, "未配置 RunningHub API Key，请在 .env 中设置 RUNNINGHUB_API_KEY");
  return key;
}

/** 前端只传 apiKeyId；服务端映射为真实 Key。 */
function resolveRequestApiKey(opts: {
  apiKeyId?: unknown;
  apiKey?: unknown;
  useWallet?: boolean;
}): string {
  const id = String(opts.apiKeyId || "").trim();
  if (id) {
    const entry = listRunningHubApiKeyEntries().find((item) => item.id === id);
    if (!entry) throw httpError(400, "无效的 API Key 选择");
    return entry.key;
  }
  // 兼容旧请求：若仍带明文 apiKey，仅当它属于服务端配置时才接受
  const fromClient = normalizeRunningHubApiKey(String(opts.apiKey || ""));
  if (fromClient) {
    const known = listRunningHubApiKeyEntries();
    if (!known.some((item) => item.key === fromClient)) {
      throw httpError(400, "无效的 API Key（须为服务端已配置的 Key）");
    }
    return fromClient;
  }
  return runninghubApiKey(Boolean(opts.useWallet));
}

function rhUrl(subPath: string): string {
  return `${runninghubApiBase()}${subPath}`;
}

function rhHeaders(json: boolean, apiKey = ""): Record<string, string> {
  const headers: Record<string, string> = {};
  const key = normalizeRunningHubApiKey(apiKey);
  if (key) headers.Authorization = `Bearer ${key}`;
  if (json) headers["Content-Type"] = "application/json";
  return headers;
}

async function rhJson(res: globalThis.Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// 字段提取 / 归一化（移植自 canvas_source/main.py 的 runninghub_* 系列函数）
// ---------------------------------------------------------------------------

function isWorkflowLinkValue(value: unknown): boolean {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number";
}

function isLikelyTextFieldName(fieldName: string): boolean {
  const name = String(fieldName || "").trim().toLowerCase();
  if (!name) return false;
  if (/^(prompt|text|string|negative|positive|caption|description|content|query|instruction|system|user|note|msg|message)$/.test(name)) {
    return true;
  }
  if (/(^|_)(prompt|text|caption|description|content)(_|$)/.test(name)) return true;
  if (/提示词|文案|描述|内容|文本/.test(String(fieldName || ""))) return true;
  return false;
}

function isPlainNumberValue(fieldValue: string): boolean {
  const value = String(fieldValue || "").trim();
  return Boolean(value) && value.length <= 12 && /^-?\d+(\.\d+)?$/.test(value) && !Number.isNaN(Number(value));
}

function inferFieldType(fieldName: string, fieldValue: string): string {
  const value = String(fieldValue || "").trim();
  // prompt/text 类字段名：必须是文本，勿被默认值文案里的 image/mask 等词带偏成图片
  if (isLikelyTextFieldName(fieldName)) {
    if (/^(true|false)$/i.test(value)) return "BOOLEAN";
    if (isPlainNumberValue(value)) return "NUMBER";
    return "TEXT";
  }
  const name = String(fieldName || "").toLowerCase();
  // 媒体：优先字段名；默认值只认扩展名，不认英语散文里的 image/picture
  if (/\b(image|img|mask|photo|picture)\b/.test(name) || /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(value)) return "IMAGE";
  if (/\b(video|movie|mp4)\b/.test(name) || /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(value)) return "VIDEO";
  if (/\b(audio|sound|music|voice)\b/.test(name) || /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(value)) return "AUDIO";
  if (/^(true|false)$/i.test(value)) return "BOOLEAN";
  if (isPlainNumberValue(value)) return "NUMBER";
  return "TEXT";
}

function stringifyFieldValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

/** 从工作流 JSON（ComfyUI prompt 格式）里提取所有非连线的输入字段 */
function collectWorkflowFields(workflowJson: Record<string, unknown>): RhWorkflowField[] {
  const fields: RhWorkflowField[] = [];
  if (!workflowJson || typeof workflowJson !== "object") return fields;
  for (const [nodeId, nodeContentRaw] of Object.entries(workflowJson)) {
    const nodeContent = nodeContentRaw as Record<string, unknown>;
    if (!nodeContent || typeof nodeContent !== "object") continue;
    const inputs = nodeContent.inputs as Record<string, unknown> | undefined;
    if (!inputs || typeof inputs !== "object") continue;
    for (const [fieldName, rawValue] of Object.entries(inputs)) {
      if (isWorkflowLinkValue(rawValue)) continue;
      const fieldValue = stringifyFieldValue(rawValue);
      const fieldType = inferFieldType(fieldName, fieldValue);
      const meta = nodeContent._meta as Record<string, unknown> | undefined;
      const group = String(
        (meta && meta.title) || nodeContent.class_type || nodeContent._class || nodeContent.type || ""
      );
      fields.push({
        id: `${nodeId}::${fieldName}`,
        nodeId: String(nodeId),
        fieldName: String(fieldName),
        fieldValue,
        fieldType,
        label: String(fieldName),
        enabled: false,
        sourceFromUpstream: true,
        group,
        note: "",
        options: [],
        random_enabled: false,
        min: "",
        max: "",
        step: "",
        imageOrder: 0,
        required: fieldType === "IMAGE",
      });
    }
  }
  return fields;
}

/** 节点运行时提交用的原始字段清单（不做 enabled 过滤，画布节点按需覆盖） */
function workflowNodeInfoList(workflowJson: Record<string, unknown>): Array<{
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  fieldType: string;
  source: string;
}> {
  const result: Array<{ nodeId: string; fieldName: string; fieldValue: string; fieldType: string; source: string }> = [];
  if (!workflowJson || typeof workflowJson !== "object") return result;
  for (const [nodeId, nodeContentRaw] of Object.entries(workflowJson)) {
    const nodeContent = nodeContentRaw as Record<string, unknown>;
    const inputs = nodeContent && typeof nodeContent === "object" ? (nodeContent.inputs as Record<string, unknown>) : undefined;
    if (!inputs || typeof inputs !== "object") continue;
    for (const [fieldName, rawValue] of Object.entries(inputs)) {
      if (isWorkflowLinkValue(rawValue)) continue;
      const fieldValue = stringifyFieldValue(rawValue);
      result.push({
        nodeId: String(nodeId),
        fieldName: String(fieldName),
        fieldValue,
        fieldType: inferFieldType(fieldName, fieldValue),
        source: "workflow",
      });
    }
  }
  return result;
}

function normalizeField(rawInput: unknown, fallback: Partial<RhWorkflowField> = {}): RhWorkflowField {
  const raw = (rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {}) as Record<string, unknown>;
  let options: string[] = [];
  const rawOptions = raw.options ?? fallback.options;
  if (typeof rawOptions === "string") {
    options = rawOptions.split(/[\r\n,]+/).map((s) => s.trim()).filter(Boolean);
  } else if (Array.isArray(rawOptions)) {
    options = rawOptions.map((item) => String(item).trim()).filter(Boolean);
  }
  const nodeId = String(raw.nodeId ?? fallback.nodeId ?? raw.node_id ?? "").trim();
  const fieldName = String(raw.fieldName ?? raw.inputName ?? raw.name ?? fallback.fieldName ?? "").trim();
  const fieldId = String(raw.id ?? raw.fieldId ?? raw.key ?? raw.nodeId ?? fallback.id ?? "").trim();
  let fieldValueRaw = raw.fieldValue ?? raw.defaultValue ?? raw.value ?? fallback.fieldValue ?? "";
  const fieldValue = stringifyFieldValue(fieldValueRaw);
  return {
    id: fieldId || `${nodeId}::${fieldName}`,
    nodeId,
    fieldName,
    fieldValue,
    fieldType: String(raw.fieldType ?? fallback.fieldType ?? "TEXT"),
    label: String(raw.label ?? raw.title ?? fieldName ?? fallback.label ?? ""),
    enabled: Boolean(raw.enabled ?? fallback.enabled ?? true),
    sourceFromUpstream: Boolean(raw.sourceFromUpstream ?? fallback.sourceFromUpstream ?? true),
    group: String(raw.group ?? fallback.group ?? ""),
    note: String(raw.note ?? fallback.note ?? ""),
    options,
    random_enabled: Boolean(raw.random_enabled ?? fallback.random_enabled ?? false),
    min: (raw.min ?? fallback.min ?? "") as string | number,
    max: (raw.max ?? fallback.max ?? "") as string | number,
    step: (raw.step ?? fallback.step ?? "") as string | number,
    imageOrder: Number(raw.imageOrder ?? raw.image_order ?? fallback.imageOrder ?? 0) || 0,
    required: Boolean(raw.required ?? fallback.required ?? false),
  };
}

/** 字段值形如 ["node_id", 0] 说明仍是未展开的连线，不落盘保存 */
function isSavedLinkField(field: RhWorkflowField): boolean {
  const text = String(field?.fieldValue ?? "").trim();
  if (!text.startsWith("[") || !text.endsWith("]")) return false;
  try {
    return isWorkflowLinkValue(JSON.parse(text));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// 输出提取 / 本地落地
// ---------------------------------------------------------------------------

type RhOutputRef = { url: string; kind?: "image" | "video" | "audio"; fileType?: string };

function inferKindFromFileType(raw: unknown): RhOutputRef["kind"] | "" {
  const text = String(raw || "").trim().toLowerCase();
  if (!text) return "";
  if (/(^|\/)(video|mp4|webm|mov|m4v|mkv)(\b|$)/.test(text) || text === "video") return "video";
  if (/(^|\/)(audio|mp3|wav|ogg|m4a|flac|aac)(\b|$)/.test(text) || text === "audio") return "audio";
  if (/(^|\/)(image|png|jpe?g|webp|gif|bmp)(\b|$)/.test(text) || text === "image") return "image";
  return "";
}

function inferKindFromUrl(url: string): RhOutputRef["kind"] | "" {
  const clean = String(url || "").split("?")[0].split("#")[0].toLowerCase();
  if (/\.(mp4|webm|mov|m4v|mkv)$/.test(clean)) return "video";
  if (/\.(mp3|wav|ogg|m4a|flac|aac)$/.test(clean)) return "audio";
  if (/\.(png|jpe?g|webp|gif|bmp)$/.test(clean)) return "image";
  return "";
}

function extractOutputRefs(data: unknown): RhOutputRef[] {
  let arr: unknown[] = [];
  if (Array.isArray(data)) {
    arr = data;
  } else if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const key of ["outputs", "results", "files", "data"]) {
      const value = obj[key];
      if (Array.isArray(value)) {
        arr = value;
        break;
      }
    }
    if (!arr.length && (obj.fileUrl || obj.url)) arr = [obj];
  }
  const outputs: RhOutputRef[] = [];
  const pushOne = (urlRaw: unknown, fileTypeRaw?: unknown) => {
    const url = String(urlRaw || "").trim();
    if (!url) return;
    const fileType = String(fileTypeRaw || "").trim();
    const kind = inferKindFromFileType(fileType) || inferKindFromUrl(url) || undefined;
    outputs.push(kind ? { url, kind, fileType: fileType || undefined } : { url, fileType: fileType || undefined });
  };
  for (const item of arr) {
    if (typeof item === "string") {
      pushOne(item);
    } else if (item && typeof item === "object") {
      const obj = item as Record<string, unknown>;
      const url = obj.fileUrl ?? obj.file_url ?? obj.url ?? obj.downloadUrl ?? obj.download_url;
      const fileType = obj.fileType ?? obj.file_type ?? obj.type ?? obj.outputType ?? obj.mimeType ?? obj.contentType;
      if (Array.isArray(url)) url.filter(Boolean).forEach((u) => pushOne(u, fileType));
      else if (url) pushOne(url, fileType);
    }
  }
  return outputs;
}

/** @deprecated 兼容旧调用；新逻辑用 extractOutputRefs */
function extractOutputs(data: unknown): string[] {
  return extractOutputRefs(data).map((item) => item.url);
}

const OUTPUT_EXT_BY_CONTENT_TYPE: Array<[RegExp, string]> = [
  [/mp4/, "mp4"],
  [/webm/, "webm"],
  [/quicktime/, "mov"],
  [/x-matroska|matroska/, "mkv"],
  [/^video\//, "mp4"],
  [/mpeg/, "mp3"],
  [/wav/, "wav"],
  [/ogg/, "ogg"],
  [/^audio\//, "mp3"],
  [/webp/, "webp"],
  [/jpeg/, "jpg"],
  [/png/, "png"],
  [/gif/, "gif"],
];
const ALLOWED_OUTPUT_EXT = new Set([
  "png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "webm", "mov", "m4v", "mkv", "mp3", "wav", "ogg", "m4a", "flac", "aac",
]);
const EXT_BY_KIND: Record<string, string> = { video: "mp4", audio: "mp3", image: "png" };

function sniffMediaExt(buf: Buffer): string {
  if (!buf || buf.length < 12) return "";
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "png";
  if (buf[0] === 0xff && buf[1] === 0xd8) return "jpg";
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return "gif";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "webp";
  // ISO BMFF: ....ftyp → mp4/mov
  if (buf.toString("ascii", 4, 8) === "ftyp") return "mp4";
  // EBML → webm/mkv
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "webm";
  if (buf.toString("ascii", 0, 3) === "ID3") return "mp3";
  if (buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0) return "mp3";
  return "";
}

function outputExt(remote: string, contentType: string, hintExt = "", kind: RhOutputRef["kind"] | "" = ""): string {
  const fromHint = String(hintExt || "").replace(/^\./, "").toLowerCase();
  if (ALLOWED_OUTPUT_EXT.has(fromHint)) return fromHint === "jpeg" ? "jpg" : fromHint;
  const tail = String(remote || "").split("?")[0].split("#")[0];
  const fromUrl = path.extname(tail).replace(/^\./, "").toLowerCase();
  if (ALLOWED_OUTPUT_EXT.has(fromUrl)) return fromUrl === "jpeg" ? "jpg" : fromUrl;
  const ct = String(contentType || "").toLowerCase();
  for (const [re, mapped] of OUTPUT_EXT_BY_CONTENT_TYPE) {
    if (re.test(ct)) return mapped;
  }
  if (kind && EXT_BY_KIND[kind]) return EXT_BY_KIND[kind];
  return "png";
}

function kindFromExt(ext: string): RhOutputRef["kind"] | "" {
  const e = String(ext || "").toLowerCase();
  if (["mp4", "webm", "mov", "m4v", "mkv"].includes(e)) return "video";
  if (["mp3", "wav", "ogg", "m4a", "flac", "aac"].includes(e)) return "audio";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(e)) return "image";
  return "";
}

async function storeRemoteOutput(
  remote: string,
  projectRoot: string,
  opts: { fileType?: string; kind?: RhOutputRef["kind"] } = {}
): Promise<RhOutputRef> {
  const remoteUrl = String(remote || "").trim();
  if (!/^https?:\/\//.test(remoteUrl)) {
    const kind = opts.kind || inferKindFromFileType(opts.fileType) || inferKindFromUrl(remoteUrl) || undefined;
    return kind ? { url: remoteUrl, kind, fileType: opts.fileType } : { url: remoteUrl, fileType: opts.fileType };
  }
  const resp = await fetch(remoteUrl);
  if (!resp.ok) {
    const kind = opts.kind || inferKindFromFileType(opts.fileType) || inferKindFromUrl(remoteUrl) || undefined;
    return kind ? { url: remoteUrl, kind, fileType: opts.fileType } : { url: remoteUrl, fileType: opts.fileType };
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  const sniffed = sniffMediaExt(buf);
  const hintFromType = String(opts.fileType || "").split("/").pop()?.replace(/^\./, "") || "";
  const ext = sniffed || outputExt(remoteUrl, resp.headers.get("content-type") || "", hintFromType, opts.kind || "");
  const kind = opts.kind || kindFromExt(ext) || inferKindFromFileType(opts.fileType) || inferKindFromUrl(remoteUrl) || undefined;
  const filename = `rh_${uuidv4().replace(/-/g, "").slice(0, 12)}.${ext}`;
  const dir = path.join(projectRoot, "public", "uploads", "runninghub");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, filename), buf);
  return {
    url: `/uploads/runninghub/${filename}`,
    kind,
    fileType: opts.fileType || (kind ? EXT_BY_KIND[kind] || ext : ext),
  };
}

function failReason(raw: unknown): string {
  if (!raw || typeof raw !== "object") return formatRhApiError(raw, "");
  const obj = raw as Record<string, unknown>;
  const data = obj.data;
  const candidates: unknown[] = [];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    // 优先可读文案；空对象 failedReason:{} 交给 formatRhApiError 跳过
    candidates.push(
      d.errorMessage,
      d.error_message,
      d.failedReason,
      d.failReason,
      d.message,
      d.error,
      d.errorCode != null || d.error_code != null
        ? { errorCode: d.errorCode ?? d.error_code, errorMessage: d.errorMessage ?? d.error_message }
        : null,
    );
  }
  candidates.push(obj.errorMessage, obj.error_message, obj.msg, obj.message, obj.error);
  for (const value of candidates) {
    if (value == null) continue;
    if (typeof value === "object" && !Array.isArray(value) && !Object.keys(value as object).length) continue;
    const text = formatRhApiError(value, "");
    if (text && text !== "{}" && text !== "[]") return text;
  }
  return formatRhApiError(raw, "");
}

function normalizeNodeInfoList(raw: unknown): { nodeId: string; fieldName: string; fieldValue: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const nodeId = String(row.nodeId ?? "").trim();
      const fieldName = String(row.fieldName ?? "").trim();
      if (!nodeId || !fieldName) return null;
      return { nodeId, fieldName, fieldValue: stringifyFieldValue(row.fieldValue) };
    })
    .filter(Boolean) as { nodeId: string; fieldName: string; fieldValue: string }[];
}

const ASSET_MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
};

/** 素材上传用：把 /uploads/… 本地路径或 http(s) 远程地址读成二进制 */
async function readAssetBytes(
  url: string,
  projectRoot: string
): Promise<{ buffer: Buffer; mime: string; filename: string }> {
  const trimmed = url.trim();
  if (trimmed.startsWith("/uploads/")) {
    const rel = trimmed.replace(/^\/uploads\//, "").replace(/\\/g, "/");
    if (rel.includes("..")) throw httpError(400, "非法素材路径");
    const abs = path.join(projectRoot, "public", "uploads", rel);
    if (!existsSync(abs)) throw httpError(400, `本地素材不存在：${trimmed}`);
    const ext = path.extname(abs).toLowerCase();
    return {
      buffer: readFileSync(abs),
      mime: ASSET_MIME_BY_EXT[ext] || "application/octet-stream",
      filename: path.basename(abs),
    };
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    const resp = await fetch(trimmed);
    if (!resp.ok) throw httpError(400, `下载素材失败 HTTP ${resp.status}`);
    const buffer = Buffer.from(await resp.arrayBuffer());
    const mime = resp.headers.get("content-type") || "application/octet-stream";
    let filename = "asset.bin";
    try {
      filename = path.basename(new URL(trimmed).pathname) || filename;
    } catch {
      /* ignore */
    }
    return { buffer, mime, filename };
  }
  throw httpError(400, `不支持的素材地址：${trimmed}`);
}

// ---------------------------------------------------------------------------
// 配置存储：data/runninghub-workflows.json（按 workflowId 存）/ data/runninghub-apps.json（按 appId 存）
// ---------------------------------------------------------------------------

let workflowsFile = "";
let appsFile = "";

export function initRunningHubWorkflowsStore(projectRoot: string) {
  const dataDir = path.join(projectRoot, "data");
  mkdirSync(dataDir, { recursive: true });
  workflowsFile = path.join(dataDir, "runninghub-workflows.json");
  appsFile = path.join(dataDir, "runninghub-apps.json");
}

function loadJsonStore<T>(file: string, fallback: T): T {
  if (!file || !existsSync(file)) return fallback;
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

function saveJsonStore(file: string, data: unknown) {
  writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function loadWorkflowStore(): Record<string, RhWorkflowConfig> {
  return loadJsonStore<Record<string, RhWorkflowConfig>>(workflowsFile, {});
}

function saveWorkflowStore(store: Record<string, RhWorkflowConfig>) {
  saveJsonStore(workflowsFile, store);
}

function loadAppStore(): Record<string, RhAppConfig> {
  return loadJsonStore<Record<string, RhAppConfig>>(appsFile, {});
}

function saveAppStore(store: Record<string, RhAppConfig>) {
  saveJsonStore(appsFile, store);
}

// ---------------------------------------------------------------------------
// 拉取工作流 JSON（工作流详情 / 参数列表共用）
// ---------------------------------------------------------------------------

async function fetchRunningHubWorkflowJson(
  workflowId: string
): Promise<{ workflowJson: Record<string, unknown>; raw: unknown }> {
  const apiKey = runninghubApiKey();
  const resp = await fetch(rhUrl("/api/openapi/getJsonApiFormat"), {
    method: "POST",
    headers: rhHeaders(true, apiKey),
    body: JSON.stringify({ apiKey, workflowId }),
  });
  const raw = await rhJson(resp);
  if (!resp.ok) throw httpError(resp.status, JSON.stringify(raw).slice(0, 800));
  const rawObj = raw as Record<string, unknown>;
  if (!raw || typeof raw !== "object" || !isSuccessCode(rawObj.code)) {
    throw httpError(400, String(rawObj?.msg || "") || `RunningHub 工作流参数拉取失败：${JSON.stringify(raw).slice(0, 300)}`);
  }
  const data = rawObj.data && typeof rawObj.data === "object" ? (rawObj.data as Record<string, unknown>) : {};
  const prompt = data.prompt;
  let workflowJson: Record<string, unknown> = {};
  if (typeof prompt === "string" && prompt.trim()) {
    try {
      workflowJson = JSON.parse(prompt);
    } catch (exc) {
      throw httpError(502, `RunningHub 工作流 JSON 解析失败：${(exc as Error).message}`);
    }
  } else if (prompt && typeof prompt === "object") {
    workflowJson = prompt as Record<string, unknown>;
  }
  return { workflowJson, raw };
}

// ---------------------------------------------------------------------------
// 路由注册
// ---------------------------------------------------------------------------

function sendError(res: import("express").Response, err: unknown, fallback: string) {
  const e = err as Error & { status?: number };
  const status = e?.status || 500;
  const message = e?.message || fallback;
  res.status(status).json({ success: false, error: message, detail: message });
}

export function registerRunningHubWorkflowRoutes(app: Express, deps: RunningHubWorkflowDeps) {
  initRunningHubWorkflowsStore(deps.projectRoot);
  const mw: RequestHandler[] = deps.requireGate ? [deps.requireGate] : [];
  const adminMw: RequestHandler[] = deps.requireAdmin ? [...mw, deps.requireAdmin] : mw;
  console.log("[runninghub-workflows] routes ready: /api/runninghub/* (submit/query/upload-asset/workflows/apps)");

  // ---- 运行时：AI 应用一键跑 ----
  app.get("/api/runninghub/app-info", ...mw, async (req: Request, res) => {
    try {
      const webappId = String(req.query.webappId || "").trim();
      if (!webappId) throw httpError(400, "webappId 必填");
      const useWallet =
        String(req.query.useWallet || "").trim() === "1" ||
        String(req.query.useWallet || "").toLowerCase() === "true";
      const apiKey = resolveRequestApiKey({
        apiKeyId: req.query.apiKeyId,
        apiKey: req.query.apiKey,
        useWallet,
      });
      const url = rhUrl(
        `/api/webapp/apiCallDemo?apiKey=${encodeURIComponent(apiKey)}&webappId=${encodeURIComponent(webappId)}`
      );
      const resp = await fetch(url, { headers: rhHeaders(false, apiKey) });
      const raw = (await rhJson(resp)) as Record<string, unknown>;
      if (!resp.ok) throw httpError(resp.status, JSON.stringify(raw).slice(0, 500));
      if (raw && typeof raw === "object" && raw.code !== undefined && raw.code !== null && !isSuccessCode(raw.code)) {
        throw httpError(400, String(raw.msg || "") || `RunningHub 查询失败 code=${raw.code}`);
      }
      res.json({ success: true, data: (raw?.data as unknown) || {} });
    } catch (err) {
      sendError(res, err, "查询应用信息失败");
    }
  });

  app.post("/api/runninghub/submit", ...mw, async (req: Request, res) => {
    try {
      const body = req.body || {};
      const webappId = String(body.webappId || "").trim();
      if (!webappId) throw httpError(400, "webappId 必填");
      const useWallet = Boolean(body.useWallet);
      const apiKey = resolveRequestApiKey({
        apiKeyId: body.apiKeyId,
        apiKey: body.apiKey,
        useWallet,
      });
      const payload: Record<string, unknown> = {
        apiKey,
        webappId,
        nodeInfoList: normalizeNodeInfoList(body.nodeInfoList),
      };
      const instanceType = String(body.instanceType || "").trim();
      if (instanceType) payload.instanceType = instanceType;
      const resp = await fetch(rhUrl("/task/openapi/ai-app/run"), {
        method: "POST",
        headers: rhHeaders(true, apiKey),
        body: JSON.stringify(payload),
      });
      const raw = (await rhJson(resp)) as Record<string, unknown>;
      if (!resp.ok) throw httpError(resp.status, JSON.stringify(raw).slice(0, 800));
      if (isSuccessCode(raw.code)) {
        const taskId = (raw.data as Record<string, unknown>)?.taskId;
        if (!taskId) throw httpError(502, `RunningHub 未返回 taskId：${JSON.stringify(raw).slice(0, 300)}`);
        return res.json({ success: true, data: { taskId, raw } });
      }
      throw httpError(400, formatRhApiError(raw.msg, `RunningHub 提交失败：${JSON.stringify(raw).slice(0, 300)}`));
    } catch (err) {
      sendError(res, err, "提交任务失败");
    }
  });

  app.post("/api/runninghub/workflow-submit", ...mw, async (req: Request, res) => {
    try {
      const body = req.body || {};
      const workflowId = String(body.workflowId || "").trim();
      if (!workflowId) throw httpError(400, "workflowId 必填");
      const useWallet = Boolean(body.useWallet);
      const apiKey = resolveRequestApiKey({
        apiKeyId: body.apiKeyId,
        apiKey: body.apiKey,
        useWallet,
      });
      const payload: Record<string, unknown> = { apiKey, workflowId, addMetadata: true };
      if (Array.isArray(body.nodeInfoList) && body.nodeInfoList.length) payload.nodeInfoList = normalizeNodeInfoList(body.nodeInfoList);
      if (body.workflow) {
        payload.workflow = typeof body.workflow === "object" ? JSON.stringify(body.workflow) : String(body.workflow);
      }
      const instanceType = String(body.instanceType || "").trim();
      if (instanceType) payload.instanceType = instanceType;
      const resp = await fetch(rhUrl("/task/openapi/create"), {
        method: "POST",
        headers: rhHeaders(true, apiKey),
        body: JSON.stringify(payload),
      });
      const raw = (await rhJson(resp)) as Record<string, unknown>;
      if (!resp.ok) throw httpError(resp.status, JSON.stringify(raw).slice(0, 800));
      if (isSuccessCode(raw.code)) {
        const taskId = (raw.data as Record<string, unknown>)?.taskId;
        if (!taskId) throw httpError(502, `RunningHub 工作流未返回 taskId：${JSON.stringify(raw).slice(0, 300)}`);
        return res.json({ success: true, data: { taskId, raw } });
      }
      throw httpError(400, formatRhApiError(raw.msg, `RunningHub 工作流提交失败：${JSON.stringify(raw).slice(0, 300)}`));
    } catch (err) {
      sendError(res, err, "提交工作流失败");
    }
  });

  app.get("/api/runninghub/query", ...mw, async (req: Request, res) => {
    try {
      const taskId = String(req.query.taskId || "").trim();
      if (!taskId) throw httpError(400, "taskId 必填");
      const useWallet =
        String(req.query.useWallet || "").trim() === "1" ||
        String(req.query.useWallet || "").toLowerCase() === "true";
      const apiKey = resolveRequestApiKey({
        apiKeyId: req.query.apiKeyId,
        apiKey: req.query.apiKey,
        useWallet,
      });
      const resp = await fetch(rhUrl("/task/openapi/outputs"), {
        method: "POST",
        headers: rhHeaders(true, apiKey),
        body: JSON.stringify({ apiKey, taskId }),
      });
      const raw = (await rhJson(resp)) as Record<string, unknown>;
      if (!resp.ok) throw httpError(resp.status, JSON.stringify(raw).slice(0, 800));
      const code = raw.code;
      const outputs: RhOutputRef[] = [];
      let status: string;
      if (isSuccessCode(code)) {
        status = "SUCCESS";
        for (const remote of extractOutputRefs(raw.data)) {
          try {
            outputs.push(await storeRemoteOutput(remote.url, deps.projectRoot, {
              fileType: remote.fileType,
              kind: remote.kind,
            }));
          } catch {
            outputs.push(remote);
          }
        }
      } else if (code === 804 || code === "804") status = "RUNNING";
      else if (code === 813 || code === "813") status = "QUEUED";
      else if (code === 805 || code === "805") status = "FAILED";
      else status = "UNKNOWN";
      // urls：兼容旧前端；outputs：带 kind，避免视频被当成图片
      res.json({
        success: true,
        data: {
          status,
          urls: outputs.map((item) => item.url),
          outputs,
          failReason: failReason(raw),
          code,
          raw,
        },
      });
    } catch (err) {
      sendError(res, err, "查询任务失败");
    }
  });

  app.post("/api/runninghub/upload-asset", ...mw, async (req: Request, res) => {
    try {
      const body = req.body || {};
      const sourceUrl = String(body.url || "").trim();
      if (!sourceUrl) throw httpError(400, "url 必填");
      const useWallet = Boolean(body.useWallet);
      const apiKey = resolveRequestApiKey({
        apiKeyId: body.apiKeyId,
        apiKey: body.apiKey,
        useWallet,
      });
      const { buffer, mime, filename } = await readAssetBytes(sourceUrl, deps.projectRoot);
      if (!buffer.length) throw httpError(400, "素材为空，无法上传到 RunningHub");
      const form = new FormData();
      form.append("apiKey", apiKey);
      form.append("fileType", "input");
      form.append("file", new Blob([new Uint8Array(buffer)], { type: mime }), filename);
      const resp = await fetch(rhUrl("/task/openapi/upload"), {
        method: "POST",
        headers: rhHeaders(false, apiKey),
        body: form as unknown as BodyInit,
      });
      const raw = (await rhJson(resp)) as Record<string, unknown>;
      if (!resp.ok) throw httpError(resp.status, JSON.stringify(raw).slice(0, 800));
      const data = raw.data as Record<string, unknown> | undefined;
      if (isSuccessCode(raw.code) && data?.fileName) {
        return res.json({ success: true, data: { fileName: data.fileName, fileType: data.fileType || mime } });
      }
      throw httpError(400, formatRhApiError(raw.msg, `RunningHub 上传失败：${JSON.stringify(raw).slice(0, 300)}`));
    } catch (err) {
      sendError(res, err, "上传素材失败");
    }
  });

  app.get("/api/runninghub/workflow-info", ...mw, async (req: Request, res) => {
    try {
      const workflowId = String(req.query.workflowId || "").trim();
      if (!workflowId) throw httpError(400, "workflowId 必填");
      const { workflowJson, raw } = await fetchRunningHubWorkflowJson(workflowId);
      res.json({ success: true, data: { workflowId, nodeInfoList: workflowNodeInfoList(workflowJson), raw } });
    } catch (err) {
      sendError(res, err, "拉取工作流信息失败");
    }
  });

  // ---- 配置管理：工作流（列表/写 admin；单条 GET 供画布 ensureRunningHubWorkflow） ----
  app.get("/api/runninghub/workflows", ...adminMw, (_req, res) => {
    const store = loadWorkflowStore();
    const items = Object.values(store)
      .filter((cfg): cfg is RhWorkflowConfig => Boolean(cfg && typeof cfg === "object"))
      .map((cfg) => ({
        workflowId: cfg.workflowId,
        title: cfg.title || cfg.workflowId,
        fieldCount: (cfg.fields || []).length,
        updatedAt: cfg.updatedAt,
        description: cfg.description || "",
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "zh"));
    res.json({ workflows: items });
  });

  app.get("/api/runninghub/workflows/:id", ...mw, (req, res) => {
    try {
      const key = String(req.params.id || "").trim();
      if (!key) throw httpError(400, "workflowId 必填");
      const cfg = loadWorkflowStore()[key];
      if (!cfg) throw httpError(404, "RunningHub 工作流未找到");
      res.json({ workflow: cfg });
    } catch (err) {
      sendError(res, err, "获取工作流失败");
    }
  });

  app.post("/api/runninghub/workflows/fetch", ...adminMw, async (req: Request, res) => {
    try {
      const body = req.body || {};
      const workflowId = String(body.workflowId || "").trim();
      if (!workflowId) throw httpError(400, "workflowId 必填");
      const { workflowJson, raw } = await fetchRunningHubWorkflowJson(workflowId);
      const fields = collectWorkflowFields(workflowJson);
      res.json({
        success: true,
        data: {
          workflowId,
          title: String(body.title || workflowId),
          description: String(body.description || ""),
          fields,
          workflowJson,
          raw,
        },
      });
    } catch (err) {
      sendError(res, err, "拉取工作流失败");
    }
  });

  app.put("/api/runninghub/workflows/:id", ...adminMw, (req, res) => {
    try {
      const key = String(req.params.id || "").trim();
      if (!key) throw httpError(400, "workflowId 必填");
      const body = req.body || {};
      const fields = (Array.isArray(body.fields) ? body.fields : [])
        .map((item: unknown) => normalizeField(item))
        .filter((f: RhWorkflowField) => !isSavedLinkField(f));
      const cfg: RhWorkflowConfig = {
        workflowId: key,
        title: String(body.title || key).trim() || key,
        description: String(body.description || ""),
        fields,
        workflowJson: body.workflowJson && typeof body.workflowJson === "object" ? body.workflowJson : {},
        optionalImageMode: String(body.optionalImageMode || "prune-workflow"),
        raw: body.raw && typeof body.raw === "object" ? body.raw : {},
        updatedAt: Date.now(),
      };
      const store = loadWorkflowStore();
      store[key] = cfg;
      saveWorkflowStore(store);
      res.json({ success: true, workflow: cfg });
    } catch (err) {
      sendError(res, err, "保存工作流失败");
    }
  });

  app.delete("/api/runninghub/workflows/:id", ...adminMw, (req, res) => {
    try {
      const key = String(req.params.id || "").trim();
      if (!key) throw httpError(400, "workflowId 必填");
      const store = loadWorkflowStore();
      if (!store[key]) throw httpError(404, "RunningHub 工作流未找到");
      delete store[key];
      saveWorkflowStore(store);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "删除工作流失败");
    }
  });

  // ---- 配置管理：AI 应用（字段由前端从 app-info 原始返回派生后整份提交保存） ----
  app.get("/api/runninghub/apps", ...adminMw, (_req, res) => {
    const store = loadAppStore();
    const items = Object.values(store)
      .filter((cfg): cfg is RhAppConfig => Boolean(cfg && typeof cfg === "object"))
      .map((cfg) => ({
        appId: cfg.appId,
        title: cfg.title || cfg.appId,
        fieldCount: (cfg.fields || []).length,
        updatedAt: cfg.updatedAt,
        description: cfg.description || "",
      }))
      .sort((a, b) => a.title.localeCompare(b.title, "zh"));
    res.json({ apps: items });
  });

  app.get("/api/runninghub/apps/:id", ...adminMw, (req, res) => {
    try {
      const key = String(req.params.id || "").trim();
      if (!key) throw httpError(400, "webappId 必填");
      const cfg = loadAppStore()[key];
      if (!cfg) throw httpError(404, "RunningHub 应用未找到");
      res.json({ app: cfg });
    } catch (err) {
      sendError(res, err, "获取应用失败");
    }
  });

  app.put("/api/runninghub/apps/:id", ...adminMw, (req, res) => {
    try {
      const key = String(req.params.id || "").trim();
      if (!key) throw httpError(400, "webappId 必填");
      const body = req.body || {};
      const fields = (Array.isArray(body.fields) ? body.fields : []).map((item: unknown) => normalizeField(item));
      const cfg: RhAppConfig = {
        appId: key,
        title: String(body.title || key).trim() || key,
        description: String(body.description || ""),
        fields,
        raw: body.raw && typeof body.raw === "object" ? body.raw : {},
        updatedAt: Date.now(),
      };
      const store = loadAppStore();
      store[key] = cfg;
      saveAppStore(store);
      res.json({ success: true, app: cfg });
    } catch (err) {
      sendError(res, err, "保存应用失败");
    }
  });

  app.delete("/api/runninghub/apps/:id", ...adminMw, (req, res) => {
    try {
      const key = String(req.params.id || "").trim();
      if (!key) throw httpError(400, "webappId 必填");
      const store = loadAppStore();
      if (!store[key]) throw httpError(404, "RunningHub 应用未找到");
      delete store[key];
      saveAppStore(store);
      res.json({ success: true });
    } catch (err) {
      sendError(res, err, "删除应用失败");
    }
  });
}

/**
 * 供 /api/config 合并展示：画布 RH 节点下拉框（rhEntryOptions/currentRunningHubWorkflowConfig 等，见
 * canvasEngine.js）直接消费 provider.rh_workflows / rh_apps 里的完整配置（含 fields/workflowJson），
 * 因此这里返回完整对象而非精简摘要。
 */
export function listRunningHubWorkflowsForConfig(): Array<RhWorkflowConfig & { enabled: true }> {
  const store = loadWorkflowStore();
  return Object.values(store)
    .filter((cfg): cfg is RhWorkflowConfig => Boolean(cfg && typeof cfg === "object"))
    .map((cfg) => ({ ...cfg, enabled: true as const }))
    .sort((a, b) => a.title.localeCompare(b.title, "zh"));
}

export function listRunningHubAppsForConfig(): Array<RhAppConfig & { enabled: true }> {
  const store = loadAppStore();
  return Object.values(store)
    .filter((cfg): cfg is RhAppConfig => Boolean(cfg && typeof cfg === "object"))
    .map((cfg) => ({ ...cfg, enabled: true as const }))
    .sort((a, b) => a.title.localeCompare(b.title, "zh"));
}
