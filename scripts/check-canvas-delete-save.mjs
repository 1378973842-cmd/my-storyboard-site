/**
 * 删节点时摘掉指向它的边；没带删除标记的瘦稿重放仍被缩水/空连线拦住。
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { initInfiniteCanvasStore, saveCanvas } from '../src/services/infiniteCanvasStore.ts';

const root = mkdtempSync(path.join(tmpdir(), 'canvas-del-'));
const id = 'board1';
const ctx = { userId: 'u1' };
initInfiniteCanvasStore(root);
const dir = path.join(root, 'data', 'canvases');
mkdirSync(dir, { recursive: true });
const fp = path.join(dir, `${id}.json`);

const img = (nodeId) => ({ id: nodeId, type: 'image', url: `/u/${nodeId}` });
const gen = (nodeId) => ({ id: nodeId, type: 'generator' });
const anchor = 'anchor';
const baseNodes = [img('a'), img('b'), img('c'), img('d'), img('e'), img('f'), gen('g'), gen(anchor)];
const baseEdges = [
  { id: 'c1', from: 'e', to: anchor },
  { id: 'c2', from: 'f', to: anchor },
];

function writeBoard(nodes, connections) {
  writeFileSync(fp, JSON.stringify({
    id,
    title: 't',
    icon: '🧩',
    kind: 'classic',
    created_at: 1,
    updated_at: 1,
    owner_id: 'u1',
    nodes,
    connections,
    viewport: { x: 0, y: 0, scale: 1 },
    logs: [],
    settings: {},
  }));
}

function readBoard() {
  return JSON.parse(readFileSync(fp, 'utf8'));
}

function dangling(doc) {
  const ids = new Set(doc.nodes.map((node) => node.id));
  return (doc.connections || []).filter((edge) => !ids.has(edge.from) || !ids.has(edge.to));
}

const warnings = [];
const orig = console.warn;
console.warn = (...args) => { warnings.push(args.map(String).join(' ')); };

function save(nodes, connections, extra = {}) {
  warnings.length = 0;
  return saveCanvas(id, {
    nodes,
    connections,
    base_updated_at: readBoard().updated_at,
    ...extra,
  }, ctx);
}

function fail(label) {
  console.error('FAIL:', label);
  console.error(warnings.join('\n'));
  process.exit(1);
}

writeBoard(baseNodes, baseEdges);
save(baseNodes.filter((node) => node.id !== anchor), [], {});
{
  const doc = readBoard();
  if (doc.nodes.some((node) => node.id === anchor)) fail('anchor delete kept the node');
  if (doc.nodes.length !== 7) fail('anchor delete node count ' + doc.nodes.length);
  if (doc.connections.length !== 0) fail('anchor delete left connections');
  if (dangling(doc).length) fail('anchor delete left dangling edges');
}

writeBoard(baseNodes, baseEdges);
const replayNodes = baseNodes.filter((node) => !['e', 'f', anchor].includes(node.id));
save(replayNodes, [], {});
{
  const doc = readBoard();
  if (doc.nodes.length !== 8) fail('replay without marker changed nodes');
  if (doc.connections.length !== 2) fail('replay without marker cleared live edges');
  if (!warnings.some((line) => line.includes('blocked suspicious shrink'))) fail('replay did not hit shrink');
  if (!warnings.some((line) => line.includes('blocked empty connections overwrite'))) fail('replay did not hit empty connections');
}

writeBoard(baseNodes, baseEdges);
save(replayNodes, [], { intentional_delete: true });
{
  const doc = readBoard();
  if (doc.nodes.length !== 5) fail('marked delete did not shrink');
  if (doc.connections.length !== 0) fail('marked delete left edges');
  if (dangling(doc).length) fail('marked delete left dangling edges');
  if (warnings.length) fail('marked delete was warned');
}

writeBoard(baseNodes, baseEdges);
save(baseNodes.filter((node) => node.id !== anchor), baseEdges, {});
{
  const doc = readBoard();
  if (doc.connections.length !== 0) fail('server did not drop edges sent after the node was gone');
  if (dangling(doc).length) fail('forgotten cascade left dangling edges');
}

writeBoard(baseNodes, [{ id: 'c0', from: 'a', to: 'b' }]);
save(baseNodes, [], {});
{
  const doc = readBoard();
  if (doc.connections.length !== 1) fail('unmarked wipe of a live edge was stored');
}
save(baseNodes, [], { intentional_delete: true });
{
  const doc = readBoard();
  if (doc.connections.length !== 0) fail('marked delete of the last edge did not clear it');
}

console.warn = orig;
rmSync(root, { recursive: true, force: true });
console.log('check-canvas-delete-save: ok');
