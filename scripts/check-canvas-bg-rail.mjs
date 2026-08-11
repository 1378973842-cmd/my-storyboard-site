/**
 * 图片组/新建组/文本：共用圆点+竖条背景色；图片组创建不跳视口中心；自定义背景穿透 ::before
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const buildStart = eng.indexOf('function buildImageBatchFromImages(');
const buildFn = eng.slice(buildStart, eng.indexOf('\nfunction ', buildStart + 1));
const textBarStart = eng.indexOf('function remountTextFormatBar(');
const textBarFn = eng.slice(textBarStart, eng.indexOf('\nfunction ', textBarStart + 1));
const frameBarStart = eng.indexOf('function remountFrameGroupActionBar(');
const frameBarFn = eng.slice(frameBarStart, eng.indexOf('\nfunction ', frameBarStart + 1));

const checks = [
  [eng.includes('function syncShellBgDom'), 'syncShellBgDom exists'],
  [eng.includes('function openCanvasBgRailMenu'), 'shared bg rail'],
  [eng.includes('CANVAS_BG_PRESETS'), 'shared presets'],
  [buildFn.includes('nodeBounds') && buildFn.includes('IMAGE_BATCH_EDGE_PADDING'), 'batch create uses selection bounds'],
  [!/anchor \|\| defaultPoint/.test(buildFn), 'batch create no longer defaults to viewport center first'],
  [eng.includes('syncShellBgDom(el, node.frameBg)'), 'render applies shell bg dom'],
  [css.includes('.has-custom-bg') && css.includes('--shell-bg'), 'custom bg CSS overrides charcoal'],
  [css.includes('.imageBatch-node.has-custom-bg::before') && /transparent\s*!important/.test(css), '::before cleared for custom bg'],
  [frameBarFn.includes('canvas-bg-chip-btn'), 'frame group uses chip UI'],
  [textBarFn.includes('openCanvasBgRailMenu') && textBarFn.includes("mode: 'text'"), 'text node uses vertical rail'],
  [!textBarFn.includes('text-format-bg-input'), 'text node no native color input'],
  [eng.includes("className = 'canvas-bg-rail'"), 'rail class canvas-bg-rail'],
];

let failed = 0;
for(const [ok, label] of checks){
  if(!ok){
    console.error('FAIL:', label);
    failed++;
  } else console.log('OK:', label);
}
if(failed){
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncheck-canvas-bg-rail: all passed');
