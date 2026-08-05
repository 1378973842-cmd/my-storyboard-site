/**
 * RH 真·等比缩放：内部固定基准宽 + transform；外壳=视觉尺寸。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

assert(engine.includes('const RH_BASE_W = 820'), 'missing RH_BASE_W');
assert(engine.includes('const RH_DEFAULT_SCALE = 2.5'), 'missing RH_DEFAULT_SCALE 2.5');
assert(engine.includes('RH_DEFAULT_W'), 'missing RH_DEFAULT_W');
assert(engine.includes('function isRhStyleScaleNode'), 'missing isRhStyleScaleNode');
assert(engine.includes("node?.type === 'videoReverse'"), 'videoReverse must share RH scale shell');
assert(engine.includes('function syncRhNodeScale'), 'missing syncRhNodeScale');
assert(engine.includes('function fitRhNodeFrame'), 'missing fitRhNodeFrame');
assert(engine.includes("className = 'rh-scale-slot'"), 'missing rh-scale-slot');
assert(engine.includes("className = 'rh-node-scale'"), 'missing rh-node-scale wrap');
assert(engine.includes('真·等比缩放'), 'missing approach comment');
assert(!engine.includes("width:calc(100% / var(--rh-ui-scale"), 'must not use 100%/scale width trick');
assert(css.includes('.rh-scale-slot'), 'missing slot CSS');
assert(css.includes('width:var(--rh-base-w, 820px)'), 'inner must stay base width');
assert(css.includes('overflow:hidden'), 'sized slot must clip');
assert(css.includes('.videoReverse-node'), 'videoReverse shell CSS missing');
assert(engine.includes('AGENT_PREMIUM_SCALE_TYPES'), 'missing premium agent scale set');
assert(engine.includes('agent-scale-node'), 'premium agents must use agent-scale-node');
assert(css.includes('.agent-scale-node'), 'missing agent-scale-node CSS');
assert(css.includes('.agent-h-panes'), 'missing agent horizontal panes CSS');
assert(engine.includes('agent-h-body'), 'premium agents must use agent-h-body');
assert(engine.includes('agentPremiumBaseW'), 'missing agentPremiumBaseW');
assert(engine.includes('replicaAgent:560'), 'horizontal replica base should be 560');

function visualSize(baseW, baseH, scale) {
  return { w: Math.round(baseW * scale), h: Math.round(baseH * scale) };
}
const v = visualSize(820, 400, 1.5);
assert(v.w === 1230 && v.h === 600, 'visual shell math');
const def = visualSize(820, 400, 2.5);
assert(def.w === 2050 && def.h === 1000, 'default 2.5× shell math');

console.log('check-rh-ui-scale: pass');
