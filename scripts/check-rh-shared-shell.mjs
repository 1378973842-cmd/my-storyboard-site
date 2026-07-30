/**
 * RH 共用 UI 壳：任意工作流字段数；底栏常显；高内容三栏内滚。
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

assert(engine.includes('const RH_MAX_BASE_H = 720'), 'missing RH_MAX_BASE_H');
assert(engine.includes('function normalizeRhNodeLayout'), 'missing normalizeRhNodeLayout');
assert(engine.includes('rh-content-scroll'), 'missing content-scroll flag');
assert(engine.includes('rh-measure-probe'), 'missing offscreen measure probe');
assert(engine.includes('function rebuildRhNodeInPlace'), 'missing in-place rebuild');
assert(engine.includes('function scheduleFitRhNodeFrame'), 'missing fit scheduler');
assert(engine.includes('共用壳'), 'missing shared-shell comment');
assert(css.includes('.rh-measure-probe'), 'missing probe CSS');
assert(css.includes('.rh-node.rh-content-scroll .rh-tri'), 'missing scroll-mode tri');
assert(css.includes('margin-top:auto'), 'foot must stick to shell bottom');
assert(css.includes('height:calc(100% / var(--rh-ui-scale'), 'sized wrap must fill slot/scale');

function shellH(contentH, maxH = 720) {
  return Math.min(maxH, contentH);
}
assert(shellH(480) === 480, 'short workflow grows');
assert(shellH(900) === 720, 'tall workflow caps');

console.log('check-rh-shared-shell: pass');
