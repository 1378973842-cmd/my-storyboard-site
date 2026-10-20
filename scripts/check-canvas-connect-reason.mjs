import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const enginePath = path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js');
const source = fs.readFileSync(enginePath, 'utf8');

const signature = 'export function canvasAgentConnectRejectReason(';
const start = source.indexOf(signature);
assert.ok(start >= 0, 'canvasAgentConnectRejectReason missing');
const open = source.indexOf('{', start);
const close = source.indexOf('\n}', open);
assert.ok(close > open, 'canvasAgentConnectRejectReason unclosed');
const extracted = source.slice(start, close + 2);
assert.equal(extracted.includes('wouldCreateGeneratorCycle'), false);
assert.equal(extracted.includes('成环'), false);
assert.ok(extracted.indexOf('端点 id 为空或自连') < extracted.indexOf('端点不存在'));
assert.ok(extracted.indexOf('端点不存在') < extracted.indexOf('框组无端口'));
assert.ok(extracted.indexOf('框组无端口') < extracted.indexOf('这个类型组合不被允许'));

const reason = new Function(
  'nodes',
  `${extracted.replace(/^export /, '')}\nreturn canvasAgentConnectRejectReason;`,
);

const nodes = [
  { id: 'grp-1', type: 'group' },
  { id: 'gen-1', type: 'generator' },
  { id: 'prompt-1', type: 'prompt' },
];
const reject = reason(nodes);

assert.equal(reject('', 'gen-1'), '端点 id 为空或自连： -> gen-1');
assert.equal(reject('grp-1', 'grp-1'), '端点 id 为空或自连：grp-1 -> grp-1');
assert.equal(reject('ghost-id', 'grp-1'), '端点不存在：ghost-id 不在画布上');
assert.equal(extracted.includes('框组无端口'), true);
assert.equal(reject('ghost-id', 'grp-1').includes('框组无端口'), false);
assert.equal(reject('gen-1', 'grp-1'), '框组无端口，不能作为连线端点：grp-1');
assert.equal(
  reject('gen-1', 'prompt-1'),
  'generator → prompt 这个类型组合不被允许。端点：gen-1 (generator) → prompt-1 (prompt)',
);

const orderNote = '这里的检查顺序必须和 canConnect 的前三行 return 一致';
assert.equal(source.split(orderNote).length - 1, 2);

const canConnectCalls = source.match(/canConnect\(/g) || [];
const canConnectDefs = source.match(/function canConnect\(/g) || [];
assert.equal(canConnectDefs.length, 1);
assert.equal(canConnectCalls.length - canConnectDefs.length, 28);
assert.equal((source.match(/canvasAgentConnectRejectReason\(/g) || []).length, 2);
assert.equal(source.includes('Invalid canvas connection'), false);
assert.equal(
  source.split('connections.filter(c => c.to !== node.id || canConnect(c.from, node.id))').length - 1,
  2,
);
assert.equal(
  source.includes('connections = (connections || []).filter(c => canConnect(c.from, c.to));'),
  true,
);
assert.match(source, /function canConnect\(fromId, toId\)\{/);

for (const rel of [
  'canvas_source/static/js/canvas.js',
  'scripts/check-image-edit-spawn.mjs',
]) {
  const text = fs.readFileSync(path.join(root, rel), 'utf8');
  assert.equal(text.includes('canvasAgentConnectRejectReason'), false, rel);
}

console.log('canvas-connect-reason self-check: ok');
