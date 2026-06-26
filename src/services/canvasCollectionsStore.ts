import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { CanvasAccessContext } from "./infiniteCanvasStore.js";

export type CanvasCollectionRecord = {
  id: string;
  name: string;
  owner_id: string;
  canvas_ids: string[];
  created_at: number;
  updated_at: number;
};

type CollectionsFile = {
  collections: CanvasCollectionRecord[];
};

let collectionsDir = "";

export function initCanvasCollectionsStore(projectRoot: string) {
  collectionsDir = path.join(projectRoot, "data", "canvas-collections");
  mkdirSync(collectionsDir, { recursive: true });
}

function nowMs() {
  return Date.now();
}

function ownerFile(ownerId: string) {
  const safe = String(ownerId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("无效的用户 ID");
  return path.join(collectionsDir, `${safe}.json`);
}

function readOwnerFile(ownerId: string): CollectionsFile {
  const fp = ownerFile(ownerId);
  if (!existsSync(fp)) return { collections: [] };
  try {
    const data = JSON.parse(readFileSync(fp, "utf8")) as CollectionsFile;
    return { collections: Array.isArray(data.collections) ? data.collections : [] };
  } catch {
    return { collections: [] };
  }
}

function writeOwnerFile(ownerId: string, data: CollectionsFile) {
  writeFileSync(ownerFile(ownerId), JSON.stringify(data, null, 2), "utf8");
}

function assertOwner(ctx: CanvasAccessContext | null | undefined): string {
  if (!ctx?.userId) {
    const err = new Error("请先登录") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return ctx.userId;
}

function normalizeName(raw: unknown): string {
  return String(raw || "")
    .trim()
    .slice(0, 40);
}

function normalizeCanvasIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const id of raw) {
    const cleaned = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (cleaned && !out.includes(cleaned)) out.push(cleaned);
  }
  return out;
}

function findCollection(data: CollectionsFile, id: string, ownerId: string) {
  const col = data.collections.find((c) => c.id === id);
  if (!col || col.owner_id !== ownerId) {
    const err = new Error("合集不存在") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return col;
}

export function listCanvasCollections(ctx?: CanvasAccessContext | null): CanvasCollectionRecord[] {
  const ownerId = assertOwner(ctx);
  return readOwnerFile(ownerId)
    .collections.filter((c) => c.owner_id === ownerId)
    .sort((a, b) => (b.updated_at || 0) - (a.updated_at || 0));
}

export function createCanvasCollection(
  payload: { name?: string; canvas_ids?: string[] },
  ctx?: CanvasAccessContext | null
): CanvasCollectionRecord {
  const ownerId = assertOwner(ctx);
  const name = normalizeName(payload.name) || "未命名合集";
  const ts = nowMs();
  const doc: CanvasCollectionRecord = {
    id: uuidv4().replace(/-/g, ""),
    name,
    owner_id: ownerId,
    canvas_ids: normalizeCanvasIds(payload.canvas_ids),
    created_at: ts,
    updated_at: ts,
  };
  const data = readOwnerFile(ownerId);
  data.collections.push(doc);
  writeOwnerFile(ownerId, data);
  return doc;
}

export function updateCanvasCollection(
  id: string,
  payload: { name?: string; canvas_ids?: string[] },
  ctx?: CanvasAccessContext | null
): CanvasCollectionRecord {
  const ownerId = assertOwner(ctx);
  const data = readOwnerFile(ownerId);
  const col = findCollection(data, id, ownerId);
  if (payload.name !== undefined) col.name = normalizeName(payload.name) || col.name;
  if (payload.canvas_ids !== undefined) col.canvas_ids = normalizeCanvasIds(payload.canvas_ids);
  col.updated_at = nowMs();
  writeOwnerFile(ownerId, data);
  return col;
}

export function deleteCanvasCollection(id: string, ctx?: CanvasAccessContext | null): { ok: true } {
  const ownerId = assertOwner(ctx);
  const data = readOwnerFile(ownerId);
  const before = data.collections.length;
  data.collections = data.collections.filter((c) => !(c.id === id && c.owner_id === ownerId));
  if (data.collections.length === before) {
    const err = new Error("合集不存在") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  writeOwnerFile(ownerId, data);
  return { ok: true };
}

export function addCanvasToCollection(
  collectionId: string,
  canvasId: string,
  ctx?: CanvasAccessContext | null
): CanvasCollectionRecord {
  const ownerId = assertOwner(ctx);
  const cleaned = String(canvasId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleaned) throw new Error("无效的画布 ID");
  const data = readOwnerFile(ownerId);
  const col = findCollection(data, collectionId, ownerId);
  if (!col.canvas_ids.includes(cleaned)) col.canvas_ids.push(cleaned);
  for (const other of data.collections) {
    if (other.id === col.id) continue;
    const before = other.canvas_ids.length;
    other.canvas_ids = other.canvas_ids.filter((x) => x !== cleaned);
    if (other.canvas_ids.length !== before) other.updated_at = nowMs();
  }
  col.updated_at = nowMs();
  writeOwnerFile(ownerId, data);
  return col;
}

export function pruneCanvasFromAllCollections(
  canvasId: string,
  ctx?: CanvasAccessContext | null
): void {
  const ownerId = assertOwner(ctx);
  const cleaned = String(canvasId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleaned) return;
  const data = readOwnerFile(ownerId);
  let changed = false;
  for (const col of data.collections) {
    const next = col.canvas_ids.filter((x) => x !== cleaned);
    if (next.length !== col.canvas_ids.length) {
      col.canvas_ids = next;
      col.updated_at = nowMs();
      changed = true;
    }
  }
  if (changed) writeOwnerFile(ownerId, data);
}

export function removeCanvasFromCollection(
  collectionId: string,
  canvasId: string,
  ctx?: CanvasAccessContext | null
): CanvasCollectionRecord {
  const ownerId = assertOwner(ctx);
  const cleaned = String(canvasId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const data = readOwnerFile(ownerId);
  const col = findCollection(data, collectionId, ownerId);
  col.canvas_ids = col.canvas_ids.filter((x) => x !== cleaned);
  col.updated_at = nowMs();
  writeOwnerFile(ownerId, data);
  return col;
}
