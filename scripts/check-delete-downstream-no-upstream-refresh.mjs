/**
 * 删除下游（截帧/剪辑）时勿 refresh 上游视频台，避免闪一下
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const delStart = eng.indexOf('function deleteNode(id, event)');
const delFn = eng.slice(delStart, eng.indexOf('function clearNodeContentBeforeDelete', delStart));
const selStart = eng.indexOf('function deleteSelectedNodes()');
const selFn = eng.slice(selStart, eng.indexOf('function hasImageFiles', selStart));

const checks = [
  [eng.includes('function consumerNeighborIdsAfterDelete'), 'helper exists'],
  [eng.includes('del.has(c.from) && c.to && !del.has(c.to)'), 'only refresh consumers'],
  [delFn.includes('consumerNeighborIdsAfterDelete([id])'), 'deleteNode uses helper'],
  [selFn.includes('consumerNeighborIdsAfterDelete(toDelete)'), 'deleteSelected uses helper'],
  [!delFn.includes('.flatMap(c => [c.from, c.to])'), 'deleteNode no longer refreshes both ends'],
  [!selFn.includes('.flatMap(c => [c.from, c.to])'), 'deleteSelected no longer refreshes both ends'],
];

let failed = 0;
for(const [ok, label] of checks){
  if(!ok){
    console.error('FAIL:', label);
    failed++;
  } else console.log('OK:', label);
}
if(failed){
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncheck-delete-downstream-no-upstream-refresh: all passed');
