/**
 * 框选重绘服务端贴回：sharp 只改选区像素；并输出同管道「对比底图」。
 * 灯箱对比必须用 compareUrl（底图 PNG），不能用原 JPEG——否则框外也会因解码路径不同看起来像像素偏移。
 */
import sharp from "sharp";
import { readUploadsBytes } from "./ossStore.js";

export type BoxRepaintBox = { x: number; y: number; w: number; h: number };

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
  if (sourceUrl.startsWith("data:")) {
    const m = /^data:image\/[^;]+;base64,(.+)$/is.exec(sourceUrl);
    if (!m) throw new Error("无法解析 data URL");
    return Buffer.from(m[1].replace(/\s/g, ""), "base64");
  }
  throw new Error("不支持的原图地址");
}

/** 原图 → 同管道 PNG 底图（EXIF rotate + ensureAlpha），供灯箱对比，避免 JPEG vs 结果 PNG 假偏移 */
export async function encodeEditCompareBaseline(opts: {
  projectRoot: string;
  sourceUrl: string;
}): Promise<{ comparePng: Buffer; width: number; height: number }> {
  const sourceBuf = await loadSourceBuffer(opts.projectRoot, opts.sourceUrl);
  const base = sharp(sourceBuf).rotate().ensureAlpha();
  const { data, info } = await base.raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  if (channels < 4) throw new Error("内部像素格式异常");
  const comparePng = await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer();
  return { comparePng, width, height };
}

export async function compositeBoxRepaintPatch(opts: {
  projectRoot: string;
  sourceUrl: string;
  patchPng: Buffer;
  box: BoxRepaintBox;
}): Promise<{ resultPng: Buffer; comparePng: Buffer; width: number; height: number; box: BoxRepaintBox }> {
  const sourceBuf = await loadSourceBuffer(opts.projectRoot, opts.sourceUrl);
  // rotate()：与浏览器 <img> 展示一致，按 EXIF 校正后再贴选区
  const base = sharp(sourceBuf).rotate().ensureAlpha();
  const { data: baseData, info } = await base.raw().toBuffer({ resolveWithObject: true });
  const width = info.width;
  const height = info.height;
  const channels = info.channels;
  if (channels < 4) throw new Error("内部像素格式异常");

  const bx = Math.max(0, Math.min(width - 1, Math.round(Number(opts.box.x) || 0)));
  const by = Math.max(0, Math.min(height - 1, Math.round(Number(opts.box.y) || 0)));
  const bw = Math.max(1, Math.min(width - bx, Math.round(Number(opts.box.w) || 1)));
  const bh = Math.max(1, Math.min(height - by, Math.round(Number(opts.box.h) || 1)));

  const patchRgba = await sharp(opts.patchPng)
    .ensureAlpha()
    .resize(bw, bh, { fit: "fill" })
    .raw()
    .toBuffer();

  const baselineData = Buffer.from(baseData);
  const resultData = Buffer.from(baseData);

  for (let py = 0; py < bh; py += 1) {
    for (let px = 0; px < bw; px += 1) {
      const pi = (py * bw + px) * 4;
      const a = (patchRgba[pi + 3] || 0) / 255;
      if (a <= 0.001) continue;
      const oi = ((by + py) * width + (bx + px)) * 4;
      const inv = 1 - a;
      resultData[oi] = Math.round(resultData[oi] * inv + patchRgba[pi] * a);
      resultData[oi + 1] = Math.round(resultData[oi + 1] * inv + patchRgba[pi + 1] * a);
      resultData[oi + 2] = Math.round(resultData[oi + 2] * inv + patchRgba[pi + 2] * a);
      resultData[oi + 3] = 255;
    }
  }

  const rawOpts = { raw: { width, height, channels: 4 as const } };
  const [resultPng, comparePng] = await Promise.all([
    sharp(resultData, rawOpts).png().toBuffer(),
    sharp(baselineData, rawOpts).png().toBuffer(),
  ]);

  return {
    resultPng,
    comparePng,
    width,
    height,
    box: { x: bx, y: by, w: bw, h: bh },
  };
}
