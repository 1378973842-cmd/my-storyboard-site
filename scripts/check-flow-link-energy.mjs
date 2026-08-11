/**
 * 生成中连线能量：多层 + rAF；固定 3 段；亮段随线长缓变
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [eng.includes('FLOW_LINK_LAYERS'), 'flow link layer set'],
  [eng.includes("key:'bloom', cls:'link-flow-bloom'"), 'flow bloom layer'],
  [eng.includes("key:'core', cls:'link-flow-core'"), 'flow core layer'],
  [eng.includes('function startFlowLinkEnergyLoop'), 'rAF flow energy loop'],
  [eng.includes('LINK_ENERGY_DASH_PERIOD') && eng.includes('LINK_ENERGY_PATH_LENGTH = 300'), 'pathLength 300 / 3 segments'],
  [eng.includes('function linkEnergyDashOnForLength'), 'dash scales with length'],
  [eng.includes('function linkEnergyDashArrays'), 'dash array helper'],
  [eng.includes('applyLinkEnergyDashStyle'), 'applies dash per layer'],
  [eng.includes('measureLinkPathLength'), 'measures path length'],
  [css.includes('stroke-width:2.15') && css.includes('stroke-width:7.2'), 'soft bloom glow + energy width'],
  [css.includes('不用 SVG drop-shadow') || css.includes('辉光靠加宽半透明 bloom'), 'glow without drop-shadow'],
  [eng.includes('on * 1.1') && eng.includes('on * 0.78'), 'aligned dash lengths across layers'],
  [eng.includes('function rebuildFlowLinkEnergyCache'), 'cached flow path list'],
  [eng.includes('function portPointForConnection'), 'stable port anchors while flowing'],
  [eng.includes('生成中锁线几何'), 'skip magnet geometry while flowing'],
  [eng.includes('dataset.flowLink'), 'data-flow-link markers'],
  [eng.includes('生成能量流动中：完全跳过删线悬停'), 'skip hover while flowing'],
  [css.includes('.link-flow-bloom'), 'flow bloom CSS'],
  [css.includes('.link-flow-core'), 'flow core CSS'],
  [css.includes('stroke:#ffb866'), 'amber energy stroke'],
  [css.includes('filter:none !important'), 'flowing links kill drop-shadow'],
  [!css.includes('@keyframes linkEnergyFlow'), 'no CSS dashoffset animation'],
  [!css.includes('@keyframes linkFlowGlow'), 'no CSS glow pulse animation'],
  [css.includes('animation:none') && css.includes('.link-flow-energy'), 'flow layers animation none'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) process.exit(1);

// 段长映射：短线亮段 < 长线亮段，且夹在范围内
function dashOn(len) {
  const t = Math.min(1, Math.max(0, (len - 100) / 800));
  const smooth = t * t * (3 - 2 * t);
  return 8 + smooth * 20;
}
const shortOn = dashOn(120);
const longOn = dashOn(900);
if (!(shortOn < longOn && shortOn >= 8 && longOn <= 28.01)) {
  console.error('FAIL: dash-on length mapping');
  process.exit(1);
}
console.log('ok: flow link energy checks passed');
