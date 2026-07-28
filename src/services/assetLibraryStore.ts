import { copyFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import type { CanvasAccessContext } from "./infiniteCanvasStore.js";

export type AssetLibraryItem = {
  id: string;
  name: string;
  url: string;
  created_at: number;
};

export type AssetLibraryCategory = {
  id: string;
  name: string;
  type: "image";
  /** 子文件夹父级；空/缺省 = 主文件夹 */
  parent_id?: string | null;
  items: AssetLibraryItem[];
};

export type AssetLibraryDoc = {
  categories: AssetLibraryCategory[];
  updated_at: number;
};

let libraryRoot = "";
let projectRoot = "";

const DEFAULT_CATEGORIES: Omit<AssetLibraryCategory, "items">[] = [
  { id: "character", name: "角色", type: "image" },
  { id: "scene", name: "场景", type: "image" },
  { id: "prop", name: "道具", type: "image" },
  { id: "style", name: "风格", type: "image" },
  { id: "sfx", name: "音效", type: "image" },
  { id: "others", name: "Others", type: "image" },
];

export function initAssetLibraryStore(root: string) {
  projectRoot = root;
  libraryRoot = path.join(root, "data", "asset-library");
  mkdirSync(libraryRoot, { recursive: true });
}

function nowMs() {
  return Date.now();
}

function assertOwner(ctx: CanvasAccessContext | null | undefined): string {
  if (!ctx?.userId) {
    const err = new Error("请先登录") as Error & { status?: number };
    err.status = 401;
    throw err;
  }
  return ctx.userId;
}

function ownerFile(ownerId: string) {
  const safe = String(ownerId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) throw new Error("无效的用户 ID");
  return path.join(libraryRoot, `${safe}.json`);
}

function ownerAssetDir(ownerId: string) {
  const safe = String(ownerId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  const dir = path.join(projectRoot, "public", "uploads", "asset-library", safe);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function defaultLibrary(): AssetLibraryDoc {
  return {
    categories: DEFAULT_CATEGORIES.map((cat) => ({ ...cat, items: [] })),
    updated_at: nowMs(),
  };
}

function sortItems(lib: AssetLibraryDoc) {
  for (const cat of lib.categories) {
    cat.items.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
  }
  lib.updated_at = nowMs();
  return lib;
}

function readLibrary(ownerId: string): AssetLibraryDoc {
  const fp = ownerFile(ownerId);
  if (!existsSync(fp)) {
    const lib = defaultLibrary();
    writeFileSync(fp, JSON.stringify(lib, null, 2), "utf8");
    return lib;
  }
  try {
    const parsed = JSON.parse(readFileSync(fp, "utf8")) as AssetLibraryDoc;
    const categories = Array.isArray(parsed.categories) ? parsed.categories : [];
    const byId = new Map(categories.map((c) => [c.id, c]));
    for (const seed of DEFAULT_CATEGORIES) {
      if (!byId.has(seed.id)) {
        categories.push({ ...seed, items: [] });
      }
    }
    return sortItems({
      categories: categories.map((c) => ({
        id: String(c.id || uuidv4().replace(/-/g, "")),
        name: sanitizeName(c.name, "未命名文件夹"),
        type: "image" as const,
        parent_id: c.parent_id ? String(c.parent_id) : null,
        items: Array.isArray(c.items) ? c.items : [],
      })),
      updated_at: Number(parsed.updated_at) || nowMs(),
    });
  } catch {
    const lib = defaultLibrary();
    writeFileSync(fp, JSON.stringify(lib, null, 2), "utf8");
    return lib;
  }
}

function writeLibrary(ownerId: string, lib: AssetLibraryDoc) {
  writeFileSync(ownerFile(ownerId), JSON.stringify(sortItems(lib), null, 2), "utf8");
}

function sanitizeName(raw: unknown, fallback: string): string {
  return String(raw || "")
    .replace(/[\\/:*?"<>|]+/g, "_")
    .trim()
    .slice(0, 120) || fallback;
}

function findCategory(lib: AssetLibraryDoc, categoryId: string) {
  const cat = lib.categories.find((c) => c.id === categoryId);
  if (!cat) {
    const err = new Error("文件夹不存在") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  return cat;
}

function findItem(lib: AssetLibraryDoc, itemId: string) {
  for (const cat of lib.categories) {
    const item = cat.items.find((i) => i.id === itemId);
    if (item) return { cat, item };
  }
  const err = new Error("素材不存在") as Error & { status?: number };
  err.status = 404;
  throw err;
}

function resolveSourcePath(url: string): string | null {
  const text = String(url || "").trim();
  if (!text.startsWith("/uploads/")) return null;
  const rel = text.replace(/^\/+uploads\/+/, "").replace(/\\/g, "/");
  const abs = path.join(projectRoot, "public", "uploads", rel);
  if (!existsSync(abs)) return null;
  return abs;
}

function guessExtFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return ext;
  return ".png";
}

export function getAssetLibrary(ctx?: CanvasAccessContext | null): AssetLibraryDoc {
  const ownerId = assertOwner(ctx);
  return readLibrary(ownerId);
}

export function createAssetCategory(
  name: string,
  ctx?: CanvasAccessContext | null,
  parentId?: string | null
) {
  const ownerId = assertOwner(ctx);
  const lib = readLibrary(ownerId);
  let parent_id: string | null = parentId ? String(parentId) : null;
  if (parent_id) {
    findCategory(lib, parent_id); // 父级必须存在
  }
  const category: AssetLibraryCategory = {
    id: `cat_${uuidv4().replace(/-/g, "").slice(0, 12)}`,
    name: sanitizeName(name, "新建文件夹"),
    type: "image",
    parent_id,
    items: [],
  };
  lib.categories.unshift(category);
  writeLibrary(ownerId, lib);
  return { library: lib, category };
}

export function renameAssetCategory(categoryId: string, name: string, ctx?: CanvasAccessContext | null) {
  const ownerId = assertOwner(ctx);
  const lib = readLibrary(ownerId);
  const cat = findCategory(lib, categoryId);
  cat.name = sanitizeName(name, cat.name);
  writeLibrary(ownerId, lib);
  return { library: lib, category: cat };
}

export function deleteAssetCategory(categoryId: string, ctx?: CanvasAccessContext | null) {
  const ownerId = assertOwner(ctx);
  const lib = readLibrary(ownerId);
  findCategory(lib, categoryId);
  const removeIds = new Set<string>();
  const collect = (id: string) => {
    removeIds.add(id);
    for (const c of lib.categories) {
      if (c.parent_id === id) collect(c.id);
    }
  };
  collect(categoryId);
  for (const cat of lib.categories) {
    if (!removeIds.has(cat.id)) continue;
    for (const item of cat.items) {
      const abs = resolveSourcePath(item.url);
      if (abs && existsSync(abs)) {
        try {
          unlinkSync(abs);
        } catch {
          /* ignore */
        }
      }
    }
  }
  lib.categories = lib.categories.filter((c) => !removeIds.has(c.id));
  if (!lib.categories.length) {
    lib.categories.push({
      id: `cat_${uuidv4().replace(/-/g, "").slice(0, 12)}`,
      name: "未命名文件夹",
      type: "image",
      parent_id: null,
      items: [],
    });
  }
  writeLibrary(ownerId, lib);
  return { library: lib };
}

export function duplicateAssetCategory(categoryId: string, ctx?: CanvasAccessContext | null) {
  const ownerId = assertOwner(ctx);
  const lib = readLibrary(ownerId);
  const source = findCategory(lib, categoryId);
  const category: AssetLibraryCategory = {
    id: `cat_${uuidv4().replace(/-/g, "").slice(0, 12)}`,
    name: sanitizeName(`${source.name} 副本`, "新建文件夹"),
    type: "image",
    parent_id: source.parent_id || null,
    items: source.items.map((item) => ({
      ...item,
      id: `asset_${uuidv4().replace(/-/g, "").slice(0, 12)}`,
      created_at: nowMs(),
    })),
  };
  lib.categories.unshift(category);
  writeLibrary(ownerId, lib);
  return { library: lib, category };
}

export function addAssetItem(
  payload: { category_id: string; url: string; name?: string },
  ctx?: CanvasAccessContext | null
) {
  const ownerId = assertOwner(ctx);
  const lib = readLibrary(ownerId);
  const cat = findCategory(lib, payload.category_id);
  const src = resolveSourcePath(payload.url);
  if (!src) throw new Error("只支持保存本站 /uploads/ 下的图片");
  const ext = guessExtFromPath(src);
  const safeBase = sanitizeName(payload.name || path.basename(src, ext), "asset");
  const destName = `lib_${uuidv4().replace(/-/g, "").slice(0, 12)}_${safeBase}${ext}`;
  const destAbs = path.join(ownerAssetDir(ownerId), destName);
  copyFileSync(src, destAbs);
  const item: AssetLibraryItem = {
    id: `asset_${uuidv4().replace(/-/g, "").slice(0, 12)}`,
    name: safeBase.slice(0, 120),
    url: `/uploads/asset-library/${ownerId.replace(/[^a-zA-Z0-9_-]/g, "")}/${destName}`,
    created_at: nowMs(),
  };
  cat.items.unshift(item);
  writeLibrary(ownerId, lib);
  return { library: lib, item };
}

export function addAssetItemFromBuffer(
  payload: { category_id: string; buffer: Buffer; filename?: string; mime?: string },
  ctx?: CanvasAccessContext | null
) {
  const ownerId = assertOwner(ctx);
  const lib = readLibrary(ownerId);
  const cat = findCategory(lib, payload.category_id);
  const mime = String(payload.mime || "").toLowerCase();
  let ext = path.extname(payload.filename || "").toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) {
    ext = mime.includes("jpeg") ? ".jpg" : mime.includes("webp") ? ".webp" : mime.includes("gif") ? ".gif" : ".png";
  }
  const safeBase = sanitizeName(path.basename(payload.filename || "upload", ext), "asset");
  const destName = `lib_${uuidv4().replace(/-/g, "").slice(0, 12)}_${safeBase}${ext}`;
  const destAbs = path.join(ownerAssetDir(ownerId), destName);
  writeFileSync(destAbs, payload.buffer);
  const item: AssetLibraryItem = {
    id: `asset_${uuidv4().replace(/-/g, "").slice(0, 12)}`,
    name: safeBase.slice(0, 120),
    url: `/uploads/asset-library/${ownerId.replace(/[^a-zA-Z0-9_-]/g, "")}/${destName}`,
    created_at: nowMs(),
  };
  cat.items.unshift(item);
  writeLibrary(ownerId, lib);
  return { library: lib, item };
}

export function renameAssetItem(itemId: string, name: string, ctx?: CanvasAccessContext | null) {
  const ownerId = assertOwner(ctx);
  const lib = readLibrary(ownerId);
  const { item } = findItem(lib, itemId);
  item.name = sanitizeName(name, item.name);
  writeLibrary(ownerId, lib);
  return { library: lib, item };
}

export function deleteAssetItem(itemId: string, ctx?: CanvasAccessContext | null) {
  const ownerId = assertOwner(ctx);
  const lib = readLibrary(ownerId);
  let removed: AssetLibraryItem | null = null;
  for (const cat of lib.categories) {
    cat.items = cat.items.filter((item) => {
      if (item.id === itemId) {
        removed = item;
        return false;
      }
      return true;
    });
  }
  if (!removed) {
    const err = new Error("素材不存在") as Error & { status?: number };
    err.status = 404;
    throw err;
  }
  const abs = resolveSourcePath(removed.url);
  if (abs && existsSync(abs)) {
    try {
      unlinkSync(abs);
    } catch {
      /* ignore */
    }
  }
  writeLibrary(ownerId, lib);
  return { library: lib };
}

export function moveAssetItem(itemId: string, categoryId: string, ctx?: CanvasAccessContext | null) {
  const ownerId = assertOwner(ctx);
  const lib = readLibrary(ownerId);
  const target = findCategory(lib, categoryId);
  const found = findItem(lib, itemId);
  if (found.cat.id === target.id) return { library: lib, item: found.item };
  found.cat.items = found.cat.items.filter((i) => i.id !== itemId);
  target.items.unshift(found.item);
  writeLibrary(ownerId, lib);
  return { library: lib, item: found.item };
}
