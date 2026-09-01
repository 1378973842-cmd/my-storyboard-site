/**
 * AG264c：新视角（箭头→焦段/光圈/三轴提示词 → 图片生成 API）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  apertureFromWidthFrac,
  buildNovelViewPrompt,
  cameraAxesFromArrow,
  focalMmFromLength,
  nearestAspectRatio,
  novelViewFromArrow,
  NOVEL_VIEW_DEFAULT_MODEL,
  NOVEL_VIEW_DEFAULT_WIDTH,
  NOVEL_VIEW_MODELS,
} from '../src/lib/infiniteCanvas/novelViewCamera.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

function assert(cond, name) {
  if (!cond) {
    console.error('FAIL', name);
    process.exit(1);
  }
  console.log('ok', name);
}

assert(focalMmFromLength(0.08) === 16, 'short arrow → 16mm');
assert(focalMmFromLength(0.62) === 200, 'long arrow → 200mm');
assert(focalMmFromLength(0.35) === 57, 'mid arrow → 57mm');
assert(apertureFromWidthFrac(0.006) === 16, 'thin arrow → f/16');
assert(apertureFromWidthFrac(0.09) === 1.4, 'thick arrow → f/1.4');
assert(apertureFromWidthFrac(NOVEL_VIEW_DEFAULT_WIDTH) === 11, 'default width → f/11');

const axes = cameraAxesFromArrow({ x: 0.8, y: 0.85 }, { x: 0.2, y: 0.2 }, 'into');
assert(axes.camPosText.includes('右'), 'start in lower-right → 机位偏右');
assert(axes.yawText.includes('左'), 'arrow leftward → 朝画面左侧');
assert(axes.pitchText.includes('仰拍'), 'arrow up-left → 仰拍');
assert(axes.depthText === '朝画面深处推进', 'left-drag depth = into');
assert(cameraAxesFromArrow({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.5 }, 'out').depthText === '朝画面前方退出', 'right-drag depth = out');

const view = novelViewFromArrow({ x: 0.7, y: 0.8 }, { x: 0.25, y: 0.25 }, 0.04, 'into');
assert(view.hasArrow, 'hasArrow');
assert(view.prompt.includes('机位严格设在图中红色箭头的尾部'), 'prompt locks arrow tail');
assert(view.prompt.includes('使用 ') && view.prompt.includes('mm 焦段镜头'), 'prompt has focal');
assert(view.prompt.includes('光圈 f/'), 'prompt has aperture');
assert(view.prompt.includes('左右轴') && view.prompt.includes('上下轴') && view.prompt.includes('纵深轴'), 'prompt has 3 axes');
assert(view.prompt.includes('保持场景主体、光线与氛围不变'), 'prompt keeps subject');
assert(buildNovelViewPrompt(85, 2.8, view.axes).includes('85mm'), 'manual prompt interpolates mm');
assert(nearestAspectRatio(1920, 1080, ['1:1', '16:9', '9:16']) === '16:9', 'nearest 16:9');
assert(NOVEL_VIEW_DEFAULT_MODEL === 'gpt-image-2', 'default model gpt-image-2');
assert(NOVEL_VIEW_MODELS.includes('nano-banana-pro') && NOVEL_VIEW_MODELS.includes('gpt-image-2'), 'both models listed');

const checks = [
  [/data-action="novel-view"/, engine, 'action bar button'],
  [/新视角/, engine, '新视角 label'],
  [/function openImageNovelView/, engine, 'openImageNovelView'],
  [/function runImageNovelViewJob/, engine, 'runImageNovelViewJob'],
  [/function composeNovelViewInput/, engine, 'composeNovelViewInput'],
  [/scene-with-arrow\.png/, engine, 'annotated png name'],
  [/editOrigin[\s\S]{0,80}'novel-view'/, engine, 'novel-view editOrigin'],
  [/_editSourceUrl\s*=\s*String\(job\.url/, engine, 'novel-view stores compare source'],
  [/function bindImageEditCompareSource/, engine, 'bindImageEditCompareSource'],
  [/NOVEL_VIEW_DEFAULT_MODEL/, engine, 'default model const'],
  [/createCanvasImageTask/, engine, 'createCanvasImageTask'],
  [/async function runImageNovelViewJob[\s\S]{0,2200}createCanvasImageTask/, engine, 'job uses canvas image API'],
  [/async function runImageNovelViewJob[\s\S]{0,1800}gpt-image-2|NOVEL_VIEW_DEFAULT_MODEL/, engine, 'job default gpt-image-2'],
  [/nano-banana-pro/, engine, 'nano-banana-pro option'],
  [/from '\.\/novelViewCamera\.js'/, engine, 'imports camera module'],
  [/kind === 'novel-view'/, engine, 'normalize novel-view origin'],
  [/\.image-novel-view-canvas\b/, css, 'arrow canvas css'],
  [/\.image-novel-view-hud\b/, css, 'hud css'],
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
if (/async function runImageNovelViewJob[\s\S]{0,2800}\/api\/runninghub\/v2\/run-workflow/.test(engine)) {
  console.error('FAIL', 'novel view must not submit qwen workflow');
  process.exit(1);
}
if (!/async function runImageNovelViewJob[\s\S]{0,2200}createCanvasImageTask/.test(engine)) {
  console.error('FAIL', 'novel view must use createCanvasImageTask');
  process.exit(1);
}
if (failed) {
  console.error(`novel-view check failed: ${failed}`);
  process.exit(1);
}
console.log('novel-view check passed');
