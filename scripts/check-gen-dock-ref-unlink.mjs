/**
 * 自检：参考图 xx 删除须用真实节点 id 找连线（合成 id 如 nodeId:preview 不能直接 match）。
 */
function connectionFromIdForGenSource(sourceId, nodeIds){
  const raw = String(sourceId || '').trim();
  if(!raw) return '';
  if(nodeIds.has(raw)) return raw;
  const head = raw.split(':')[0];
  return head || raw;
}

const nodeIds = new Set(['gen_a', 'img_b', 'batch_c']);
const cases = [
  ['gen_a:preview', 'gen_a'],
  ['img_b', 'img_b'],
  ['batch_c:img_9', 'batch_c'],
  ['stack_x:img:2', 'stack_x'],
];

for(const [src, want] of cases){
  const got = connectionFromIdForGenSource(src, nodeIds);
  if(got !== want){
    console.error('check-gen-dock-ref-unlink FAIL', {src, got, want});
    process.exit(1);
  }
}

const connections = [{id:'c1', from:'gen_a', to:'gen_dst'}];
const fromId = connectionFromIdForGenSource('gen_a:preview', nodeIds);
const conn = connections.find(c => c.from === fromId && c.to === 'gen_dst');
if(!conn){
  console.error('check-gen-dock-ref-unlink FAIL: connection not found for :preview source');
  process.exit(1);
}
// 旧逻辑会挂：直接用合成 id 找连线
if(connections.find(c => c.from === 'gen_a:preview' && c.to === 'gen_dst')){
  console.error('check-gen-dock-ref-unlink FAIL: unexpected synthetic-id connection');
  process.exit(1);
}

console.log('check-gen-dock-ref-unlink: ok');
