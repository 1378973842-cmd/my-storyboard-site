#!/usr/bin/env node
/**
 * 找回「磁盘有图、画布 JSON 未引用」的孤儿 uploads，可选贴回指定画布。
 *
 * 用法：
 *   node scripts/recover-orphan-uploads.mjs --since 2026-07-21
 *   node scripts/recover-orphan-uploads.mjs --since 2026-07-21 --canvas <canvasId> --apply
 *   node scripts/recover-orphan-uploads.mjs --hours 24
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploadsRoot = path.join(root, "public", "uploads");
const canvasDir = path.join(root, "data", "canvases");

function parseArgs(argv) {
  const out = { since: "", canvas: "", apply: false, hours: 0, limit: 200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--since") out.since = String(argv[++i] || "");
    else if (a === "--canvas") out.canvas = String(argv[++i] || "");
    else if (a === "--apply") out.apply = true;
    else if (a === "--hours") out.hours = Number(argv[++i] || 0) || 0;
    else if (a === "--limit") out.limit = Math.max(1, Number(argv[++i] || 200) || 200);
  }
  return out;
}

function sinceMs(opts) {
  if (opts.hours > 0) return Date.now() - opts.hours * 3600 * 1000;
  if (opts.since) {
    const t = Date.parse(opts.since);
    if (!Number.isNaN(t)) return t;
  }
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - 1);
  return d.getTime();
}

function walkFiles(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const fp = path.join(dir, name);
    let st;
    try {
      st = statSync(fp);
    } catch {
      continue;
    }
    if (st.isDirectory()) walkFiles(fp, out);
    else out.push({ fp, mtimeMs: st.mtimeMs, size: st.size });
  }
  return out;
}

function toUploadUrl(fp) {
  const rel = path.relative(path.join(root, "public"), fp).split(path.sep).join("/");
  return `/${rel}`;
}

function collectReferencedUrls() {
  const refs = new Set();
  if (!existsSync(canvasDir)) return refs;
  const re = /\/uploads\/[A-Za-z0-9._\-\/]+/g;
  for (const name of readdirSync(canvasDir)) {
    if (!name.endsWith(".json")) continue;
    if (name.includes(".tmp") || name.endsWith(".bak")) continue;
    let text = "";
    try {
      text = readFileSync(path.join(canvasDir, name), "utf8");
    } catch {
      continue;
    }
    for (const m of text.match(re) || []) refs.add(m.split("?")[0]);
  }
  return refs;
}

function isImageFile(fp) {
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(fp);
}

function uid(prefix = "img") {
  return `${prefix}_${Math.random().toString(16).slice(2, 10)}_${Date.now()}`;
}

function writeCanvasAtomic(fp, doc) {
  const tmp = `${fp}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(doc, null, 2), "utf8");
  try {
    renameSync(tmp, fp);
  } catch {
    writeFileSync(fp, readFileSync(tmp));
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

function applyOrphansToCanvas(canvasId, orphans) {
  const fp = path.join(canvasDir, `${canvasId}.json`);
  if (!existsSync(fp)) throw new Error(`画布不存在: ${canvasId}`);
  const doc = JSON.parse(readFileSync(fp, "utf8"));
  if (!Array.isArray(doc.nodes)) doc.nodes = [];
  writeFileSync(`${fp}.bak`, readFileSync(fp));
  const cols = 8;
  const gapX = 280;
  const gapY = 280;
  const originX = Number(doc.viewport?.x || 0) + 80;
  const originY = Number(doc.viewport?.y || 0) + 80;
  let added = 0;
  for (let i = 0; i < orphans.length; i++) {
    const url = orphans[i].url;
    const col = i % cols;
    const row = Math.floor(i / cols);
    doc.nodes.push({
      id: uid("img"),
      type: "image",
      x: originX + col * gapX,
      y: originY + row * gapY,
      url,
      name: path.basename(url),
      mediaKind: "image",
      recoveredOrphan: true,
    });
    added += 1;
  }
  doc.updated_at = Date.now();
  writeCanvasAtomic(fp, doc);
  return added;
}

const opts = parseArgs(process.argv.slice(2));
const cutoff = sinceMs(opts);
const refs = collectReferencedUrls();
const files = walkFiles(uploadsRoot)
  .filter((f) => isImageFile(f.fp) && f.mtimeMs >= cutoff)
  .map((f) => ({ ...f, url: toUploadUrl(f.fp) }))
  .filter((f) => !refs.has(f.url))
  .sort((a, b) => b.mtimeMs - a.mtimeMs);

const list = files.slice(0, opts.limit);
console.log(`[orphan] since=${new Date(cutoff).toISOString()} referenced=${refs.size}`);
console.log(`[orphan] orphan images=${files.length} (showing ${list.length})`);
for (const f of list.slice(0, 30)) {
  console.log(`  ${new Date(f.mtimeMs).toISOString()}  ${f.url}`);
}
if (files.length > 30) console.log(`  … +${files.length - 30} more`);

if (!opts.apply) {
  console.log("\n[orphan] dry-run only. To attach onto a canvas:");
  console.log(
    `  node scripts/recover-orphan-uploads.mjs --since ${opts.since || "2026-07-21"} --canvas <canvasId> --apply`
  );
  process.exit(0);
}

if (!opts.canvas) {
  console.error("[orphan] --apply requires --canvas <id>");
  process.exit(1);
}
if (!list.length) {
  console.log("[orphan] nothing to apply");
  process.exit(0);
}
mkdirSync(canvasDir, { recursive: true });
const added = applyOrphansToCanvas(opts.canvas, list);
console.log(`[orphan] attached ${added} images → canvas ${opts.canvas}`);
console.log(`[orphan] backup: data/canvases/${opts.canvas}.json.bak`);
