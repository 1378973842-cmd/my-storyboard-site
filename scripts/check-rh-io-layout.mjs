/**
 * RH 节点布局：提示词横跨输入+参数；运行钮在输出列下方；输入/输出上行对齐
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

assert.match(engine, /rh-tri rh-tri-io/);
assert.match(engine, /rh-prompt-rail/);
assert.match(engine, /rh-out-actions/);
assert.match(engine, /class="rh-prompt-list"/);
// 运行钮不在 rh-foot 里，而在输出动作区
const footIdx = engine.indexOf('<div class="rh-foot">');
const bodyFn = engine.slice(engine.indexOf('function renderRhBody'), engine.indexOf('function renderRhBody') + 4500);
assert.match(bodyFn, /rh-out-actions[\s\S]*rh-run-row/);
assert.ok(bodyFn.includes('rh-foot'));
const footChunk = bodyFn.slice(bodyFn.indexOf('<div class="rh-foot">'));
assert.doesNotMatch(footChunk.slice(0, 400), /rh-run-row/);

assert.match(css, /\.rh-tri\.rh-tri-io/);
assert.match(css, /grid-area:\s*prompt/);
assert.match(css, /grid-area:\s*actions/);
assert.match(css, /"prompt prompt actions"/);
assert.match(css, /\.rh-out-actions \.rh-run-row/);

assert.match(engine, /rh-output-toolbar-slot/);
assert.match(css, /\.rh-input-stack:has\(\.rh-media-tile\.has-media\)/);
assert.doesNotMatch(engine, /隐藏重复的 pane-head/);

console.log('OK: rh-tri-io grid with prompt rail + out actions');
console.log('OK: run button under output, not in foot');
console.log('OK: CSS areas prompt/actions');
console.log('OK: toolbar slot + filled input padding sync');
console.log('\ncheck-rh-io-layout: all passed');
