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
assert(engine.includes('function syncRhNodeScale'), 'missing syncRhNodeScale');
assert(engine.includes('function fitRhNodeFrame'), 'missing fitRhNodeFrame');
assert(engine.includes("className = 'rh-scale-slot'"), 'missing rh-scale-slot');
assert(engine.includes("className = 'rh-node-scale'"), 'missing rh-node-scale wrap');
assert(engine.includes('真·等比缩放'), 'missing approach comment');
assert(!engine.includes("width:calc(100% / var(--rh-ui-scale"), 'must not use 100%/scale width trick');
assert(css.includes('.rh-scale-slot'), 'missing slot CSS');
assert(css.includes('width:var(--rh-base-w, 820px)'), 'inner must stay base width');
assert(css.includes('overflow:hidden'), 'sized slot must clip');

function visualSize(baseW, baseH, scale) {
  return { w: Math.round(baseW * scale), h: Math.round(baseH * scale) };
}
const v = visualSize(820, 400, 1.5);
assert(v.w === 1230 && v.h === 600, 'visual shell math');

console.log('check-rh-ui-scale: pass');
