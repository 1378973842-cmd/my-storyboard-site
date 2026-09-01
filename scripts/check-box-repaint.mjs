/**
 * AG263c：框选重绘 UI + PixelRunner 贴回/校色参数自检
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  DEFAULT_BOX_REPAINT_BLEND_CONFIG,
  resolveBoxRepaintBlendConfig,
  makeInwardFeatherMask,
  blendMatchPatch,
  estimatePatchAlignment,
  compositeBoxRepaint,
} from '../src/lib/infiniteCanvas/boxRepaintBlendMatch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');
const blend = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/boxRepaintBlendMatch.js'), 'utf8');

const checks = [
  [/function openImageBoxRepaint/, engine, 'openImageBoxRepaint'],
  [/开场前不 await 整图 fetch|禁止开场前 await 整图 fetch|坐标必须用原图 natural/, engine, 'box open skips pre-fetch / uses full natural'],
  [/function applyImageEditKeepNaturalSize/, engine, 'applyImageEditKeepNaturalSize'],
  [/function scaleBoxRepaintCoordsToImage/, engine, 'scaleBoxRepaintCoordsToImage'],
  [/按原图像素换算|防裁到左上角/, engine, 'thumb→full coord remap'],
  [/applyImageEditKeepNaturalSize\(imageBoxRepaintState,\s*keep\)/, engine, 'box open sync keep natural'],
  [/exportBoxRepaintCropBlob\(\s*st\.url,\s*box,\s*BOX_REPAINT_UPLOAD_MAX_EDGE,\s*\{\s*w:\s*st\.srcW,\s*h:\s*st\.srcH/, engine, 'crop passes coordSpace'],
  [/聚焦完成前只挂 is-opening/, engine, 'fade after focus'],
  [/if\(imageBoxRepaintState\) positionImageBoxRepaintOverlay/, engine, 'viewport sync box overlay'],
  [/function buildBoxRepaintPrompt/, engine, 'buildBoxRepaintPrompt'],
  [/就地编辑附图裁切区|In-place image edit of the attached crop/, engine, 'box prompt locks in-place edit'],
  [/禁止新增人物|Do NOT add any new person/, engine, 'box prompt bans extra faces'],
  [/function runImageBoxRepaintJob/, engine, 'runImageBoxRepaintJob'],
  [/function finalizeBoxRepaintStitch/, engine, 'finalizeBoxRepaintStitch'],
  [/editOrigin\s*=\s*'box-repaint'/, engine, 'box-repaint editOrigin'],
  [/kind === 'box-repaint'/, engine, 'normalize box-repaint origin'],
  [/['"]Box repaint['"]|框选重绘/, engine, 'box-repaint badge label'],
  [/stitchBoxRepaintResult/, engine, 'import stitchBoxRepaintResult'],
  [/BOX_REPAINT_UPLOAD_MAX_EDGE\s*=\s*1536/, engine, 'upload max edge 1536'],
  [/DEFAULT_BOX_REPAINT_BLEND_CONFIG/, engine, 'default blend config'],
  [/nano-banana-pro/, engine, 'nano-banana-pro model'],
  [/createCanvasImageTask/, engine, 'createCanvasImageTask'],
  [/async function runImageBoxRepaintJob[\s\S]{0,1800}nano-banana-pro/, engine, 'box job uses nano via image API'],
  [/\.image-box-repaint-layer\b/, css, 'box layer css'],
  [/\.image-box-repaint-rect\b/, css, 'box rect css'],
  [/totalStrength:\s*78/, blend, 'totalStrength 78'],
  [/luminanceStrength:\s*82/, blend, 'luminanceStrength 82'],
  [/colorStrength:\s*76/, blend, 'colorStrength 76'],
  [/saturationStrength:\s*62/, blend, 'saturationStrength 62'],
  [/featherRadius:\s*20/, blend, 'featherRadius 20'],
  [/alignmentMaxOffset:\s*120/, blend, 'alignmentMaxOffset 120'],
  [/alignmentMaxScale:\s*2\.52/, blend, 'alignmentMaxScale 2.52'],
  [/alignmentMaxRotation:\s*1\.75/, blend, 'alignmentMaxRotation 1.75'],
  [/buildScaleCandidates/, blend, 'buildScaleCandidates'],
  [/estimatePatchAlignment/, blend, 'estimatePatchAlignment'],
  [/placeResultIntoTargetBounds/, blend, 'placeResultIntoTargetBounds'],
  [/fitMode:\s*'stretch'/, blend, 'fitMode stretch'],
  [/alignmentEnabled:\s*false/, blend, 'alignment off by default'],
  [/smoothstep\(0,\s*feather,\s*dist\)/, blend, 'feather softstep'],
  [/box_crop\.jpg/, engine, 'jpeg crop upload'],
  [/9_000_000/, engine, 'jpeg 9MB target'],
  [/analysisMaxEdge:\s*512/, blend, 'analysisMaxEdge 512'],
  [/粗搜：仅平移/, blend, 'alignment coarse translation-only'],
  [/credentials:\s*'include'/, blend, 'loadRgba fetch credentials'],
  [/先不落裁切图/, engine, 'no raw crop before stitch'],
  [/box-repaint-composite/, engine, 'server box-repaint-composite'],
  [/out\._editSourceUrl\s*=\s*compareUrl/, engine, 'compare uses same-pipeline baseline'],
];

if (!/mode === 'crop'[\s\S]{0,120}openImageBoxRepaint/.test(engine)) {
  console.error('FAIL', 'crop menu must open box repaint');
  process.exit(1);
}
if (/async function runImageBoxRepaintJob[\s\S]{0,2800}\/api\/runninghub\/v2\/run-workflow/.test(engine)) {
  console.error('FAIL', 'box repaint must not submit qwen workflow');
  process.exit(1);
}
if (!/async function runImageBoxRepaintJob[\s\S]{0,2200}createCanvasImageTask/.test(engine)) {
  console.error('FAIL', 'box repaint must use createCanvasImageTask');
  process.exit(1);
}

let failed = 0;

// Node 无 DOM ImageData：给 composite 自检一个最小 polyfill
if (typeof ImageData === 'undefined') {
  globalThis.ImageData = class ImageData {
    constructor(dataOrW, heightOrW, maybeH) {
      if (typeof dataOrW === 'number') {
        this.width = dataOrW;
        this.height = heightOrW;
        this.data = new Uint8ClampedArray(dataOrW * heightOrW * 4);
      } else {
        this.data = dataOrW;
        this.width = heightOrW;
        this.height = maybeH ?? heightOrW;
      }
    }
  };
}

for (const [re, src, name] of checks) {
  if (!re.test(src)) {
    console.error('FAIL', name);
    failed += 1;
  } else {
    console.log('ok', name);
  }
}

// 缩略图坐标 → 原图：选脸中心不得落成左上角白边
{
  const scale = (box, coordW, coordH, imageW, imageH) => {
    let { x, y, w, h } = box;
    const cw = Math.max(0, Number(coordW) || 0);
    const ch = Math.max(0, Number(coordH) || 0);
    const ow = Math.max(1, Number(imageW) || 1);
    const oh = Math.max(1, Number(imageH) || 1);
    if (cw > 1 && ch > 1 && (Math.abs(cw - ow) > 1 || Math.abs(ch - oh) > 1)) {
      x *= ow / cw;
      y *= oh / ch;
      w *= ow / cw;
      h *= oh / ch;
    }
    return { x, y, w, h };
  };
  // thumb 512×512 上框选脸心 → 原图 2048×2048 应对齐中心附近
  const mapped = scale({ x: 180, y: 160, w: 140, h: 160 }, 512, 512, 2048, 2048);
  if (mapped.x < 600 || mapped.y < 500 || mapped.w < 400) {
    console.error('FAIL', 'thumb→full remap scales face box', mapped);
    failed += 1;
  } else {
    console.log('ok', 'thumb→full remap scales face box');
  }
  // 同尺寸不改
  const same = scale({ x: 10, y: 20, w: 30, h: 40 }, 100, 100, 100, 100);
  if (same.x !== 10 || same.w !== 30) {
    console.error('FAIL', 'same-size remap identity', same);
    failed += 1;
  } else {
    console.log('ok', 'same-size remap identity');
  }
}

const cfg = resolveBoxRepaintBlendConfig({});
if (cfg.totalStrength !== 78 || cfg.featherRadius !== 20 || cfg.luminanceStrength !== 82) {
  console.error('FAIL', 'resolved defaults mismatch', cfg);
  failed += 1;
} else if (cfg.alignmentEnabled !== false || cfg.fitMode !== 'stretch') {
  console.error('FAIL', 'defaults must disable align + stretch', cfg);
  failed += 1;
} else {
  console.log('ok', 'resolved defaults');
}

// softstep 羽化：中心 1，角点 0
{
  const large = makeInwardFeatherMask(256, 256, 20);
  const largeCenter = large[128 * 256 + 128];
  const largeCorner = large[0];
  if (!(largeCenter > 0.99 && largeCorner < 0.01)) {
    console.error('FAIL', 'feather softstep shape', { largeCenter, largeCorner });
    failed += 1;
  } else {
    console.log('ok', 'feather softstep', {
      largeCenter: Number(largeCenter.toFixed(3)),
      largeCorner: Number(largeCorner.toFixed(3)),
    });
  }
}

// contain 等比入框：200x100 图装进 100x100 → 应是 100x50 居中（对齐 PixelRunner selection）
{
  const rw = 200, rh = 100, tw = 100, th = 100;
  const sc = Math.min(tw / rw, th / rh);
  const dw = rw * sc, dh = rh * sc;
  const dx = (tw - dw) / 2, dy = (th - dh) / 2;
  if (!(Math.abs(dw - 100) < 0.01 && Math.abs(dh - 50) < 0.01 && Math.abs(dx) < 0.01 && Math.abs(dy - 25) < 0.01)) {
    console.error('FAIL', 'contain math', { dw, dh, dx, dy });
    failed += 1;
  } else {
    console.log('ok', 'contain math');
  }
}

// tiny synthetic blend: darker source vs brighter ref → midDelta > 0
const w = 48;
const h = 48;
const src = new Uint8ClampedArray(w * h * 4);
const ref = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < src.length; i += 4) {
  src[i] = 80; src[i + 1] = 80; src[i + 2] = 80; src[i + 3] = 255;
  ref[i] = 140; ref[i + 1] = 140; ref[i + 2] = 140; ref[i + 3] = 255;
}
const matched = blendMatchPatch(
  { width: w, height: h, data: src, scaleX: 1, scaleY: 1 },
  { width: w, height: h, data: ref },
  DEFAULT_BOX_REPAINT_BLEND_CONFIG
);
const mid = matched.data[(24 * w + 24) * 4];
if (!(mid > 90)) {
  console.error('FAIL', 'blend should lift dark patch toward reference', mid);
  failed += 1;
} else {
  console.log('ok', 'blend lifts tone', mid);
}

// 对齐搜索不得卡死：128×128 应在数百毫秒级完成（曾有四重嵌套卡死主线程）
{
  const aw = 128;
  const ah = 128;
  const aSrc = new Uint8ClampedArray(aw * ah * 4);
  const aRef = new Uint8ClampedArray(aw * ah * 4);
  for (let y = 0; y < ah; y += 1) {
    for (let x = 0; x < aw; x += 1) {
      const i = (y * aw + x) * 4;
      const edge = x > 40 && x < 50 ? 220 : 80;
      aSrc[i] = aSrc[i + 1] = aSrc[i + 2] = edge;
      aSrc[i + 3] = 255;
      const rx = x - 3;
      const refEdge = rx > 40 && rx < 50 ? 220 : 80;
      aRef[i] = aRef[i + 1] = aRef[i + 2] = refEdge;
      aRef[i + 3] = 255;
    }
  }
  const t0 = Date.now();
  estimatePatchAlignment(
    { width: aw, height: ah, data: aSrc, scaleX: 1, scaleY: 1 },
    { width: aw, height: ah, data: aRef, scaleX: 1, scaleY: 1 },
    DEFAULT_BOX_REPAINT_BLEND_CONFIG
  );
  const ms = Date.now() - t0;
  if (ms > 2500) {
    console.error('FAIL', 'alignment too slow', ms);
    failed += 1;
  } else {
    console.log('ok', 'alignment timing', `${ms}ms`);
  }
}

// 框外像素必须原样保留（对比滑块看到的位移若来自框外，应是假阳性）
{
  const W = 64;
  const H = 64;
  const orig = new ImageData(W, H);
  for (let i = 0; i < orig.data.length; i += 4) {
    orig.data[i] = (i * 17) & 255;
    orig.data[i + 1] = (i * 31) & 255;
    orig.data[i + 2] = (i * 47) & 255;
    orig.data[i + 3] = 255;
  }
  const before = new Uint8ClampedArray(orig.data);
  const pw = 20;
  const ph = 20;
  const patch = { width: pw, height: ph, data: new Uint8ClampedArray(pw * ph * 4) };
  patch.data.fill(200);
  for (let i = 3; i < patch.data.length; i += 4) patch.data[i] = 255;
  const out = compositeBoxRepaint(orig, patch, { x: 22, y: 22, w: pw, h: ph }, 8);
  let outsideOk = true;
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      if (x >= 22 && x < 42 && y >= 22 && y < 42) continue;
      const i = (y * W + x) * 4;
      if (
        out.data[i] !== before[i] ||
        out.data[i + 1] !== before[i + 1] ||
        out.data[i + 2] !== before[i + 2]
      ) {
        outsideOk = false;
        break;
      }
    }
    if (!outsideOk) break;
  }
  if (!outsideOk) {
    console.error('FAIL', 'outside-box pixels must be unchanged');
    failed += 1;
  } else {
    console.log('ok', 'outside-box pixels unchanged');
  }
}

if (failed) {
  console.error(`box-repaint check failed: ${failed}`);
  process.exit(1);
}
console.log('box-repaint check passed');
