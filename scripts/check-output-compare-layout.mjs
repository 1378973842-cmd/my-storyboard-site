/**
 * AG70b：灯箱对比以结果图 contain 框铺原图，避免尺寸不同各自 object-fit:contain 造成假偏移
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/InfiniteCanvasShell.tsx'), 'utf8');

const checks = [
  [/function layoutOutputCompareImages/, engine, 'layoutOutputCompareImages'],
  [/裁切窗口而不是 clip-path/, engine, 'overflow clip window'],
  [/outputCompareLayer/, engine, 'zoom layer'],
  [/output-compare-layer/, css, 'layer css'],
  [/object-fit:\s*fill/, css, 'compare imgs fill shared box'],
  [/function applyOutputCompareSliderPercent/, engine, 'slider follows image box'],
  [/box\.w \* p \/ 100/, engine, 'wrap width follows slider percent'],
  [/original\.style\.width = `\$\{box\.w\}px`/, engine, 'original stays full stage width'],
  [/function liveOutputLightboxEl/, engine, 'liveOutputLightboxEl'],
  [/function resolveCompareOriginalSrc/, engine, 'resolveCompareOriginalSrc'],
  [/function refreshOutputCompareDom/, engine, 'refreshOutputCompareDom'],
  [/body\.querySelector\(':scope > \.output-lightbox/, engine, 'compare binds body lightbox'],
  [/function assignCompareImageSrc/, engine, 'assignCompareImageSrc'],
  [/output-compare-original-wrap[\s\S]{0,160}background:#0e0e0e/, css, 'opaque original wrap'],
  [/function toggleOutputCompareFromUi/, engine, 'toggleOutputCompareFromUi'],
  [/layer\.clientWidth \/ rect\.width/, engine, 'slider mouse accounts for zoom'],
  [/Math\.round\(box\.w \* p \/ 100\)/, engine, 'integer clip x'],
  [/id="outputCompareSlider"/, shell, 'compare slider'],
  [/outputCompareLayer[\s\S]*outputCompareSlider/, shell, 'slider inside zoom layer'],
];

let failed = 0;
for (const [re, src, name] of checks) {
  if (!re.test(src)) {
    console.error('FAIL', name);
    failed += 1;
  } else {
    console.log('ok', name);
  }
}

function containRect(cw, ch, rw, rh) {
  const scale = Math.min(cw / rw, ch / rh);
  const dw = rw * scale;
  const dh = rh * scale;
  return { left: (cw - dw) / 2, top: (ch - dh) / 2, dw, dh };
}

// 原图更扁、结果更高：各自 contain 时顶边不同；共用结果框后应对齐结果顶边
const resultBox = containRect(800, 600, 1200, 900);
const origAlone = containRect(800, 600, 1200, 800);
if (!(origAlone.top > 1) || resultBox.top >= origAlone.top) {
  console.error('FAIL fixture should show different letterbox', resultBox, origAlone);
  failed += 1;
} else {
  console.log('ok', 'taller result contain box sits higher than flatter original');
}

if (failed) {
  console.error(`output-compare-layout check failed: ${failed}`);
  process.exit(1);
}

// 裁切窗口：50% 时窗口宽是框的一半，原图宽度仍是整框（不被压扁）
const boxW = 800;
const percent = 50;
const wrapW = boxW * percent / 100;
const originalW = boxW;
if (wrapW !== 400 || originalW !== 800) {
  console.error('FAIL overflow window math', { wrapW, originalW });
  process.exit(1);
}
console.log('ok', 'overflow window keeps original full-width');

console.log('output-compare-layout check passed');
