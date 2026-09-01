/**
 * AG265c / AG267c：新视角·3D机位（数值提示词 + 原图身份 + 预览构图参考）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildNovelViewOrbitPrompt,
  clampOrbitCamera,
  fitDistanceForFocal,
  orbitCameraPosition,
  orbitCaptureSize,
  orbitHudChips,
  verticalFovDeg,
  NOVEL_VIEW_ORBIT_CAPTURE_MAX_EDGE,
  NOVEL_VIEW_ORBIT_DEFAULT,
} from '../src/lib/infiniteCanvas/novelViewOrbit.js';
import {
  applyDepthToPositions,
  depth01ToOffsetZ,
  normalizeDepth01,
  orientDepthNearCenter,
  sampleDepthBilinear,
} from '../src/lib/infiniteCanvas/novelViewDepth.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');
const estimateSrc = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/novelViewDepthEstimate.js'), 'utf8');
const viewSrc = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/novelViewOrbitView.js'), 'utf8');

function assert(cond, name) {
  if (!cond) {
    console.error('FAIL', name);
    process.exit(1);
  }
  console.log('ok', name);
}

const def = clampOrbitCamera({});
assert(def.yaw === 0 && def.pitch === 0 && def.distance === 1 && def.focalMm === 50, 'defaults');
assert(clampOrbitCamera({ yaw: 400, pitch: -90, distance: 0.1, focalMm: 8 }).yaw === 180, 'yaw clamp');
assert(clampOrbitCamera({ pitch: -90 }).pitch === -60, 'pitch clamp');
assert(clampOrbitCamera({ distance: 9 }).distance === 2.5, 'distance clamp');

const front = orbitCameraPosition(0, 0, 2);
assert(Math.abs(front.x) < 1e-9 && Math.abs(front.y) < 1e-9 && Math.abs(front.z - 2) < 1e-9, 'front = +Z');
const right = orbitCameraPosition(90, 0, 1);
assert(right.x > 0.99 && Math.abs(right.z) < 1e-6, 'yaw +90 = +X');
const up = orbitCameraPosition(0, 90, 1);
assert(up.y > 0.99 && Math.abs(up.z) < 1e-6, 'pitch +90 would be +Y (clamped in UI)');

assert(verticalFovDeg(24) > verticalFovDeg(50), 'wider lens = larger FOV');
assert(fitDistanceForFocal(50) > 0.5, 'fit distance positive');

const prompt = buildNovelViewOrbitPrompt({ yaw: 40, pitch: 12, distance: 0.85, focalMm: 35 });
assert(prompt.includes('向右旋转 40°'), 'prompt yaw right');
assert(prompt.includes('从上方俯 12°'), 'prompt pitch down');
assert(prompt.includes('拉近到 0.85 倍'), 'prompt dolly in');
assert(prompt.includes('35mm') && prompt.includes('广角'), 'prompt 35mm wide');
assert(prompt.includes('第二张是目标机位预览'), 'prompt names pose preview');
assert(prompt.includes('不要复制预览里的纸片拉伸'), 'prompt forbids cardboard copy');
assert(prompt.includes('不要在画面中出现控件'), 'prompt forbids widgets');
assert(!prompt.includes('红色箭头'), 'orbit prompt is not arrow recipe');

const leftPrompt = buildNovelViewOrbitPrompt({ yaw: -25, pitch: -8, distance: 1.4, focalMm: 85 });
assert(leftPrompt.includes('向左旋转 25°'), 'prompt yaw left');
assert(leftPrompt.includes('从下方仰 8°'), 'prompt pitch up');
assert(leftPrompt.includes('拉远到 1.4 倍'), 'prompt dolly out');
assert(leftPrompt.includes('长焦'), '85mm tele');

const still = buildNovelViewOrbitPrompt(NOVEL_VIEW_ORBIT_DEFAULT);
assert(still.includes('水平朝向保持原机位') && still.includes('50mm'), 'identity pose still has lens');

const cap = orbitCaptureSize(4000, 2000);
assert(cap.width === NOVEL_VIEW_ORBIT_CAPTURE_MAX_EDGE && cap.height === 768, 'capture long-edge cap');

const chips = orbitHudChips({ yaw: 40, pitch: 0, distance: 1, focalMm: 50 }, false);
assert(chips.some(c => c.includes('右') && c.includes('40')), 'hud yaw chip');

const depth = normalizeDepth01([10, 20, 30, 40]);
assert(depth[0] === 0 && depth[3] === 1, 'normalize 0–1');
assert(Math.abs(depth01ToOffsetZ(0, 0.4) - 0.2) < 1e-9, 'near → +Z');
assert(Math.abs(depth01ToOffsetZ(1, 0.4) + 0.2) < 1e-9, 'far → −Z');
assert(Math.abs(sampleDepthBilinear(new Float32Array([0, 1, 0, 1]), 2, 2, 0.5, 0) - 0.5) < 1e-9, 'bilinear mid');
const farCenter = new Float32Array(100);
for (let y = 0; y < 10; y++) {
  for (let x = 0; x < 10; x++) {
    farCenter[y * 10 + x] = (x >= 3 && x <= 6 && y >= 3 && y <= 6) ? 0.95 : 0.1;
  }
}
const oriented = orientDepthNearCenter(farCenter, 10, 10);
assert(oriented[55] < 0.2, 'invert so center is nearer');
const pos = new Float32Array([0, 0, 0]);
const uv = new Float32Array([0.5, 0.5]);
applyDepthToPositions(pos, uv, 1, 1, { data: new Float32Array([0]), width: 1, height: 1, strength: 0.4 });
assert(pos[2] > 0, 'center near vertex lifts toward camera');

const checks = [
  [/data-novel-view-mode="arrow"/, engine, 'flyout arrow item'],
  [/data-novel-view-mode="orbit"/, engine, 'flyout orbit item'],
  [/3D机位/, engine, '3D机位 label'],
  [/function openImageNovelOrbit/, engine, 'openImageNovelOrbit'],
  [/function runImageNovelOrbitJob/, engine, 'runImageNovelOrbitJob'],
  [/function createNovelViewOrbitView/, viewSrc, 'createNovelViewOrbitView'],
  [/captureStill/, viewSrc, 'captureStill'],
  [/grid\.visible = false/, viewSrc, 'capture hides grid'],
  [/preserveDrawingBuffer:\s*true/, viewSrc, 'preserveDrawingBuffer for capture'],
  [/function captureNovelOrbitPreview/, engine, 'captureNovelOrbitPreview'],
  [/orbit-preview\.jpg/, engine, 'orbit-preview.jpg upload'],
  [/role:\s*'pose'/, engine, 'pose reference role'],
  [/NOVEL_VIEW_ORBIT_DEFAULT\.focalMm/, viewSrc, 'focal uses 50mm base distance'],
  [/estimateNovelViewDepth/, engine, 'estimateNovelViewDepth'],
  [/kickNovelOrbitDepth/, engine, 'kickNovelOrbitDepth'],
  [/\/api\/canvas\/novel-view-depth/, estimateSrc, 'depth API client'],
  [/Depth Anything/, engine, 'Depth Anything label'],
  [/data-novel-orbit-relief/, engine, 'relief slider'],
  [/from '\.\/novelViewDepthEstimate\.js'/, engine, 'imports depth estimate'],
  [/from 'three'/, viewSrc, 'three.js preview'],
  [/editOrigin\s*=\s*orbit \? 'novel-view-orbit'/, engine, 'orbit editOrigin'],
  [/from '\.\/novelViewOrbit\.js'/, engine, 'imports orbit math'],
  [/from '\.\/novelViewOrbitView\.js'/, engine, 'imports orbit view'],
  [/isImageNovelOrbitOpen/, engine, 'isImageNovelOrbitOpen'],
  [/\.image-novel-orbit-viewport\b/, css, 'orbit viewport css'],
  [/\.image-action-novel-wrap\b/, css, 'flyout wrap css'],
];

const routes = fs.readFileSync(path.join(root, 'src/services/infiniteCanvasRoutes.ts'), 'utf8');
if (!/\/api\/canvas\/novel-view-depth/.test(routes)) {
  console.error('FAIL', 'novel-view-depth route');
  process.exit(1);
}
console.log('ok novel-view-depth route');

let failed = 0;
for (const [re, src, name] of checks) {
  if (!re.test(src)) {
    console.error('FAIL', name);
    failed += 1;
  } else {
    console.log('ok', name);
  }
}

const jobSlice = engine.match(/async function runImageNovelOrbitJob[\s\S]{0,2800}/);
if (!jobSlice || !/createCanvasImageTask/.test(jobSlice[0])) {
  console.error('FAIL', 'orbit job must use createCanvasImageTask');
  process.exit(1);
}
if (/async function runImageNovelOrbitJob[\s\S]{0,2800}composeNovelViewInput/.test(engine)) {
  console.error('FAIL', 'orbit must not bake arrow composite');
  process.exit(1);
}
if (/async function runImageNovelOrbitJob[\s\S]{0,2800}scene-with-arrow/.test(engine)) {
  console.error('FAIL', 'orbit must not submit scene-with-arrow.png');
  process.exit(1);
}
if (!/async function runImageNovelOrbitJob[\s\S]{0,2600}role:\s*'source'/.test(engine)) {
  console.error('FAIL', 'orbit must send clean source image');
  process.exit(1);
}
if (!/async function runImageNovelOrbitJob[\s\S]{0,2800}role:\s*'pose'/.test(engine)) {
  console.error('FAIL', 'orbit must send pose preview as second ref');
  process.exit(1);
}
if (/async function runImageNovelOrbitJob[\s\S]{0,2800}\/api\/runninghub\/v2\/run-workflow/.test(engine)) {
  console.error('FAIL', 'orbit must not submit qwen workflow');
  process.exit(1);
}
console.log('ok orbit job uses source + pose preview + createCanvasImageTask');

if (failed) {
  console.error(`novel-view-orbit check failed: ${failed}`);
  process.exit(1);
}
console.log('novel-view-orbit check passed');
