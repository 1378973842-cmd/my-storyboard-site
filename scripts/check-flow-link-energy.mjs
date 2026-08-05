/**
 * 生成中连线能量：对齐拉线多层 + rAF dashoffset + 琥珀色；流动时跳过删线悬停
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
  [eng.includes('LINK_ENERGY_DASH_PERIOD = 104'), 'dash period matches dasharray (104)'],
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
console.log('ok: flow link energy checks passed');
