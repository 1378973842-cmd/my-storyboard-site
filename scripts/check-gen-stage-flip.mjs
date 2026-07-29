/**
 * 生图叠卡↔网格：铺开/叠合动画接线自检。
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

assert(engine.includes('function setGenStageHistoryOpen'), 'missing setGenStageHistoryOpen');
assert(engine.includes('function playGenStageFlipMorph'), 'missing playGenStageFlipMorph');
assert(engine.includes('function spawnGenStageFlipGhostFromCapture'), 'missing pre-destroy ghost spawn');
assert(engine.includes('setGenStageHistoryOpen(node, true)'), 'expand not wired');
assert(engine.includes('setGenStageHistoryOpen(node, false)'), 'collapse not wired');
assert(engine.includes('setGenStageHistoryOpen(n, false)'), 'board-click collapse not wired');
assert(css.includes('.gen-stage-flip-ghost'), 'missing ghost CSS');
assert(engine.includes('扇叠 peek 不参与 FLIP 终点'), 'collapse should gather to hero only');
assert(engine.includes('收尾再 fit 会微挪'), 'should avoid end fit snap');

console.log('check-gen-stage-flip: pass');
