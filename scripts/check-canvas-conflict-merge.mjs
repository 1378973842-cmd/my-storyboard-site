import assert from 'node:assert/strict';
import {
  enrichLiveNodesFromRemote,
  mergeCanvasConnectionLists,
  mergeCanvasNodeLists,
} from '../src/lib/infiniteCanvas/canvasConflictMerge.js';

// 删除的节点不得被远端并集复活
{
  const local = [{ id: 'a', x: 10, y: 20, url: 'u1' }];
  const remote = [
    { id: 'a', x: 0, y: 0, url: 'u1' },
    { id: 'b', x: 5, y: 5, url: 'u2' },
  ];
  const merged = mergeCanvasNodeLists(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'a');
}

// 同 id：远端媒体更丰时吸收，但坐标+正在编辑的 prompt 保持本地
{
  const local = [{ id: 'a', x: 99, y: 88, w: 100, prompt: 'typing…' }];
  const remote = [{ id: 'a', x: 1, y: 2, w: 200, url: 'https://x', prompt: 'old', history: [{ id: 1 }] }];
  const merged = mergeCanvasNodeLists(local, remote);
  assert.equal(merged[0].x, 99);
  assert.equal(merged[0].y, 88);
  assert.equal(merged[0].url, 'https://x');
  assert.equal(merged[0].prompt, 'typing…');
  assert.equal(merged[0].history.length, 1);
}

// 连线：本地为准
{
  const local = [{ id: 'c1', from: 'a', to: 'b' }];
  const remote = [
    { id: 'c1', from: 'a', to: 'b' },
    { id: 'c2', from: 'a', to: 'gone' },
  ];
  const merged = mergeCanvasConnectionLists(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, 'c1');
}

// 就地充实：保持引用；远端旧 prompt 不得覆盖本地输入
{
  const live = [{ id: 'a', x: 50, y: 60, prompt: 'live-typing' }];
  const ref = live[0];
  const changed = enrichLiveNodesFromRemote(live, [
    { id: 'a', x: 0, y: 0, url: '/output/x.png', prompt: 'stale', history: [{ id: 1 }] },
    { id: 'ghost', x: 1, y: 1, url: '/output/y.png' },
  ]);
  assert.equal(changed, true);
  assert.equal(live[0], ref);
  assert.equal(live.length, 1);
  assert.equal(ref.x, 50);
  assert.equal(ref.url, '/output/x.png');
  assert.equal(ref.prompt, 'live-typing');
}

console.log('check-canvas-conflict-merge: ok');
