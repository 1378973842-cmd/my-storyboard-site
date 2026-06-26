import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type CanvasRecord = {
  id: string;
  title: string;
  icon: string;
  kind: "classic" | "smart";
  created_at: number;
  updated_at: number;
  deleted_at?: number;
  node_count: number;
  /** 列表卡片封面：从 output / image / frameStack 等节点提取的首张可用图片 */
  preview_url?: string;
};

export type CanvasDocument = {
  id: string;
  title: string;
  icon: string;
  kind: "classic" | "smart";
  created_at: number;
  updated_at: number;
  deleted_at?: number;
  /** 创建者；缺省表示登录体系上线前的团队共享画布 */
  owner_id?: string;
  nodes: unknown[];
  connections: unknown[];
  viewport: { x: number; y: number; scale: number };
  logs?: unknown[];
  settings?: Record<string, unknown>;
};

export type CanvasAccessContext = {
  userId: string;
  isAdmin?: boolean;
};

let canvasDir = "";

export function initInfiniteCanvasStore(projectRoot: string) {
  canvasDir = path.join(projectRoot, "data", "canvases");
  mkdirSync(canvasDir, { recursive: true });
}

function nowMs() {
  return Date.now();
}

function sanitizeCanvasId(id: string) {
  const cleaned = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleaned) throw new Error("无效的画布 ID");
  return cleaned;
}

export function canAccessCanvas(doc: CanvasDocument, ctx: CanvasAccessContext | null): boolean {
  if (!ctx?.userId) return false;
  if (ctx.isAdmin) return true;
  const owner = String(doc.owner_id || "").trim();
  if (!owner) return true;
  return owner === ctx.userId;
}

function assertCanvasAccess(doc: CanvasDocument, ctx: CanvasAccessContext | null): void {
  if (!canAccessCanvas(doc, ctx)) {
    const err = new Error("无权访问该画布") as Error & { status?: number };
    err.status = 403;
    throw err;
  }
}

function filePath(id: string) {
  return path.join(canvasDir, `${sanitizeCanvasId(id)}.json`);
}

function normalizeKind(kind?: string): "classic" | "smart" {
  return String(kind || "").trim().toLowerCase() === "smart" ? "smart" : "classic";
}

function isImagePreviewUrl(raw: unknown): boolean {
  const url = String(raw || "").trim();
  if (!url) return false;
  const lower = url.toLowerCase().split("?")[0];
  if (lower.startsWith("data:image/")) return true;
  if (/\.(mp4|webm|mov|m4v|avi|mkv)(\b|$)/.test(lower)) return false;
  if (/\.(mp3|wav|ogg|m4a|aac|flac)(\b|$)/.test(lower)) return false;
  return (
    /\.(png|jpe?g|webp|gif|bmp|svg|avif|heic|heif)(\b|$)/.test(lower) ||
    lower.includes("/uploads/")
  );
}

/** 从画布节点中提取一张代表性预览图（优先 output 结果，其次 image / frameStack） */
function extractPreviewUrl(doc: CanvasDocument): string {
  const nodes = Array.isArray(doc.nodes) ? (doc.nodes as Record<string, unknown>[]) : [];
  const urls: string[] = [];
  const push = (raw: unknown) => {
    const url = String(raw || "").trim();
    if (!isImagePreviewUrl(url) || urls.includes(url)) return;
    urls.push(url);
  };

  for (const node of nodes) {
    if (node.type === "output" && Array.isArray(node.images)) {
      for (const img of node.images as Record<string, unknown>[]) push(img?.url);
    }
  }
  if (urls.length) return urls[urls.length - 1];

  for (const node of nodes) {
    if (node.type === "image" && node.mediaKind !== "video") push(node.url);
  }
  if (urls.length) return urls[0];

  for (const node of nodes) {
    if (node.type === "frameStack" && Array.isArray(node.images)) {
      for (const img of node.images as Record<string, unknown>[]) push(img?.url);
    }
  }
  if (urls.length) return urls[0];

  for (const node of nodes) {
    if (Array.isArray(node.generatedOutputs)) {
      for (const out of node.generatedOutputs) push(out);
    }
  }
  if (urls.length) return urls[urls.length - 1];

  for (const node of nodes) {
    if (node.type === "group" && Array.isArray(node.items)) {
      for (const childId of node.items) {
        const child = nodes.find((n) => n.id === childId);
        if (child?.type === "image") push(child.url);
      }
    }
  }

  return urls[0] || "";
}

function readDoc(id: string): CanvasDocument {
  const fp = filePath(id);
  if (!existsSync(fp)) throw new Error("画布不存在");
  return JSON.parse(readFileSync(fp, "utf8")) as CanvasDocument;
}

function writeDoc(doc: CanvasDocument) {
  doc.updated_at = nowMs();
  const fp = filePath(doc.id);
  if (existsSync(fp)) {
    try {
      const prev = JSON.parse(readFileSync(fp, "utf8")) as CanvasDocument;
      const prevNodeCount = Array.isArray(prev.nodes) ? prev.nodes.length : 0;
      // 仅在有节点的版本上刷新 .bak，避免空画布覆盖最后一次有效备份
      if (prevNodeCount > 0) {
        writeFileSync(`${fp}.bak`, readFileSync(fp));
      }
    } catch {
      /* ignore backup failure */
    }
  }
  writeFileSync(fp, JSON.stringify(doc, null, 2), "utf8");
}

function toRecord(doc: CanvasDocument): CanvasRecord {
  const preview_url = extractPreviewUrl(doc);
  return {
    id: doc.id,
    title: doc.title || "未命名画布",
    icon: doc.icon || "🧩",
    kind: normalizeKind(doc.kind),
    created_at: doc.created_at || 0,
    updated_at: doc.updated_at || 0,
    deleted_at: doc.deleted_at || 0,
    node_count: Array.isArray(doc.nodes) ? doc.nodes.length : 0,
    ...(preview_url ? { preview_url } : {}),
  };
}

function cleanupTrash() {
  const cutoff = nowMs() - TRASH_RETENTION_MS;
  for (const name of readdirSync(canvasDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const doc = JSON.parse(readFileSync(path.join(canvasDir, name), "utf8")) as CanvasDocument;
      if (doc.deleted_at && doc.deleted_at < cutoff) {
        unlinkSync(path.join(canvasDir, name));
      }
    } catch {
      /* ignore corrupt files */
    }
  }
}

function iterRecords(deleted: boolean, ctx?: CanvasAccessContext | null): CanvasRecord[] {
  cleanupTrash();
  const out: CanvasRecord[] = [];
  for (const name of readdirSync(canvasDir)) {
    if (!name.endsWith(".json")) continue;
    try {
      const doc = JSON.parse(readFileSync(path.join(canvasDir, name), "utf8")) as CanvasDocument;
      const isDeleted = Boolean(doc.deleted_at);
      if (isDeleted !== deleted) continue;
      if (ctx && !canAccessCanvas(doc, ctx)) continue;
      out.push(toRecord(doc));
    } catch {
      /* skip */
    }
  }
  return out.sort((a, b) => (deleted ? (b.deleted_at || 0) - (a.deleted_at || 0) : b.updated_at - a.updated_at));
}

export function listCanvases(ctx?: CanvasAccessContext | null) {
  return iterRecords(false, ctx);
}

export function listDeletedCanvases(ctx?: CanvasAccessContext | null) {
  return iterRecords(true, ctx);
}

export function createCanvas(
  payload: { title?: string; icon?: string; kind?: string; owner_id?: string },
  ctx?: CanvasAccessContext | null
) {
  if (!ctx?.userId) {
    const err = new Error("请先登录后再创建画布") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  const kind = normalizeKind(payload.kind);
  const ts = nowMs();
  const doc: CanvasDocument = {
    id: uuidv4().replace(/-/g, ""),
    title: (payload.title || (kind === "smart" ? "智能画布" : "未命名画布")).slice(0, 80),
    icon: (payload.icon || (kind === "smart" ? "sparkles" : "🧩")).slice(0, 32),
    kind,
    owner_id: ctx.userId,
    created_at: ts,
    updated_at: ts,
    nodes: [],
    connections: [],
    viewport: { x: 0, y: 0, scale: 1 },
    logs: [],
    settings: {},
  };
  writeDoc(doc);
  return doc;
}

export function getCanvas(id: string, allowDeleted = false, ctx?: CanvasAccessContext | null) {
  const doc = readDoc(id);
  if (!allowDeleted && doc.deleted_at) throw new Error("画布已在回收站");
  assertCanvasAccess(doc, ctx ?? null);
  return doc;
}

export function getCanvasMeta(id: string, ctx?: CanvasAccessContext | null) {
  const doc = getCanvas(id, false, ctx);
  return {
    id: doc.id,
    updated_at: doc.updated_at,
    title: doc.title,
    icon: doc.icon,
    kind: doc.kind,
  };
}

export function saveCanvas(
  id: string,
  payload: {
    title?: string;
    icon?: string;
    nodes?: unknown[];
    connections?: unknown[];
    viewport?: { x: number; y: number; scale: number };
    logs?: unknown[];
    settings?: Record<string, unknown>;
    base_updated_at?: number;
    allow_empty_nodes?: boolean;
  },
  ctx?: CanvasAccessContext | null
) {
  const doc = getCanvas(id, true, ctx);
  const current = Number(doc.updated_at || 0);
  if (payload.base_updated_at && current && Number(payload.base_updated_at) < current) {
    const err = new Error("画布已被其他页面更新") as Error & { status?: number; canvas?: CanvasDocument; updated_at?: number };
    err.status = 409;
    err.canvas = doc;
    err.updated_at = current;
    throw err;
  }
  doc.title = (payload.title || doc.title || "未命名画布").slice(0, 80);
  doc.icon = (payload.icon || doc.icon || "🧩").slice(0, 32);
  const existingNodeCount = Array.isArray(doc.nodes) ? doc.nodes.length : 0;
  const incomingNodes = payload.nodes;
  if (
    Array.isArray(incomingNodes) &&
    incomingNodes.length === 0 &&
    existingNodeCount > 0 &&
    payload.allow_empty_nodes !== true
  ) {
    console.warn(
      `[canvas-store] blocked empty nodes overwrite for ${id} (existing ${existingNodeCount} nodes)`
    );
  } else if (incomingNodes !== undefined) {
    doc.nodes = incomingNodes;
  }
  const existingConnCount = Array.isArray(doc.connections) ? doc.connections.length : 0;
  const incomingConnections = payload.connections;
  if (
    Array.isArray(incomingConnections) &&
    incomingConnections.length === 0 &&
    existingConnCount > 0 &&
    payload.allow_empty_nodes !== true
  ) {
    console.warn(
      `[canvas-store] blocked empty connections overwrite for ${id} (existing ${existingConnCount} connections)`
    );
  } else if (incomingConnections !== undefined) {
    doc.connections = incomingConnections;
  }
  doc.viewport = payload.viewport ?? doc.viewport ?? { x: 0, y: 0, scale: 1 };
  doc.logs = Array.isArray(payload.logs) ? payload.logs.slice(-500) : doc.logs || [];
  doc.settings = payload.settings ?? doc.settings ?? {};
  writeDoc(doc);
  return doc;
}

export function softDeleteCanvas(id: string, ctx?: CanvasAccessContext | null) {
  const doc = getCanvas(id, false, ctx);
  doc.deleted_at = nowMs();
  writeDoc(doc);
  return { ok: true as const };
}

export function restoreCanvas(id: string, ctx?: CanvasAccessContext | null) {
  const doc = readDoc(id);
  assertCanvasAccess(doc, ctx ?? null);
  delete doc.deleted_at;
  writeDoc(doc);
  return doc;
}

export function purgeCanvas(id: string, ctx?: CanvasAccessContext | null) {
  const doc = readDoc(id);
  assertCanvasAccess(doc, ctx ?? null);
  const fp = filePath(id);
  if (existsSync(fp)) unlinkSync(fp);
  return { ok: true as const };
}
