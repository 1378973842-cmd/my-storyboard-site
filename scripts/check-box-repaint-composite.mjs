/**
 * 服务端框选贴回：框外像素必须与对比底图逐字节一致
 */
import sharp from 'sharp';
import { compositeBoxRepaintPatch, encodeEditCompareBaseline } from '../src/services/boxRepaintComposite.ts';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'box-repaint-'));
const uploadsRel = 'public/uploads';
const uploadsAbs = path.join(tmp, uploadsRel);
fs.mkdirSync(uploadsAbs, { recursive: true });

const W = 64;
const H = 48;
const baseRaw = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i += 1) {
  baseRaw[i * 3] = (i * 13) & 255;
  baseRaw[i * 3 + 1] = (i * 29) & 255;
  baseRaw[i * 3 + 2] = (i * 47) & 255;
}
const sourcePng = await sharp(baseRaw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
const sourceName = 'box-src.png';
fs.writeFileSync(path.join(uploadsAbs, sourceName), sourcePng);

const bx = 10;
const by = 8;
const bw = 20;
const bh = 16;
const patchRaw = Buffer.alloc(bw * bh * 4);
for (let i = 0; i < bw * bh; i += 1) {
  patchRaw[i * 4] = 220;
  patchRaw[i * 4 + 1] = 40;
  patchRaw[i * 4 + 2] = 40;
  // 边缘透明、中心实心
  const x = i % bw;
  const y = (i / bw) | 0;
  const dist = Math.min(x, y, bw - 1 - x, bh - 1 - y);
  patchRaw[i * 4 + 3] = dist >= 3 ? 255 : Math.round((dist / 3) * 255);
}
const patchPng = await sharp(patchRaw, { raw: { width: bw, height: bh, channels: 4 } }).png().toBuffer();

const composed = await compositeBoxRepaintPatch({
  projectRoot: tmp,
  sourceUrl: `/uploads/${sourceName}`,
  patchPng,
  box: { x: bx, y: by, w: bw, h: bh },
});

const result = await sharp(composed.resultPng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const compare = await sharp(composed.comparePng).ensureAlpha().raw().toBuffer({ resolveWithObject: true });

if (result.info.width !== compare.info.width || result.info.height !== compare.info.height) {
  console.error('FAIL size mismatch');
  process.exit(1);
}

let outsideDiff = 0;
let insideChanged = 0;
for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < W; x += 1) {
    const i = (y * W + x) * 4;
    const inBox = x >= bx && x < bx + bw && y >= by && y < by + bh;
    const same =
      result.data[i] === compare.data[i] &&
      result.data[i + 1] === compare.data[i + 1] &&
      result.data[i + 2] === compare.data[i + 2];
    if (!inBox && !same) outsideDiff += 1;
    if (inBox && !same) insideChanged += 1;
  }
}

fs.rmSync(tmp, { recursive: true, force: true });

if (outsideDiff !== 0) {
  console.error('FAIL outside pixels differ', outsideDiff);
  process.exit(1);
}
if (insideChanged < 10) {
  console.error('FAIL expected inside pixels to change', insideChanged);
  process.exit(1);
}
console.log('ok box-repaint-composite outside identical', { insideChanged });

// engine must call server composite + use compareUrl
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
if (!/\/api\/canvas\/box-repaint-composite/.test(engine)) {
  console.error('FAIL engine must call box-repaint-composite');
  process.exit(1);
}
if (!/compareUrl/.test(engine) || !/out\._editSourceUrl\s*=\s*compareUrl/.test(engine)) {
  console.error('FAIL engine must set _editSourceUrl to compareUrl');
  process.exit(1);
}
console.log('ok engine uses server composite + compareUrl');

if (!/function ensureMaskRepaintCompareBaseline/.test(engine)) {
  console.error('FAIL engine must define ensureMaskRepaintCompareBaseline');
  process.exit(1);
}
if (!/\/api\/canvas\/edit-compare-baseline/.test(engine)) {
  console.error('FAIL engine must call edit-compare-baseline');
  process.exit(1);
}
if (!/editOrigin === 'repaint'[\s\S]{0,120}ensureMaskRepaintCompareBaseline/.test(engine)) {
  console.error('FAIL mask repaint must request compare baseline');
  process.exit(1);
}
console.log('ok mask repaint uses edit-compare-baseline');

const tmp2 = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-compare-'));
const up2 = path.join(tmp2, 'public/uploads');
fs.mkdirSync(up2, { recursive: true });
const jpegName = 'mask-src.jpg';
const jpegBuf = await sharp(baseRaw, { raw: { width: W, height: H, channels: 3 } })
  .jpeg({ quality: 90 })
  .toBuffer();
fs.writeFileSync(path.join(up2, jpegName), jpegBuf);
const encoded = await encodeEditCompareBaseline({
  projectRoot: tmp2,
  sourceUrl: `/uploads/${jpegName}`,
});
if (!encoded.comparePng?.length || encoded.width !== W || encoded.height !== H) {
  console.error('FAIL encodeEditCompareBaseline size', encoded.width, encoded.height);
  process.exit(1);
}
const meta = await sharp(encoded.comparePng).metadata();
if (meta.format !== 'png') {
  console.error('FAIL encodeEditCompareBaseline must be png', meta.format);
  process.exit(1);
}
fs.rmSync(tmp2, { recursive: true, force: true });
console.log('ok encodeEditCompareBaseline jpeg→png');

const routes = fs.readFileSync(path.join(root, 'src/services/infiniteCanvasRoutes.ts'), 'utf8');
if (!/\/api\/canvas\/edit-compare-baseline/.test(routes)) {
  console.error('FAIL routes must register edit-compare-baseline');
  process.exit(1);
}
console.log('ok routes edit-compare-baseline');
