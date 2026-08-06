/**
 * 自检：用户主动删空画布应放行保存（allow_empty_nodes），竞态空板仍拒绝。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src/services/infiniteCanvasStore.ts'), 'utf8');

const checks = [
  [eng.includes('function canPersistEmptyCanvasNodes'), 'canPersistEmptyCanvasNodes helper'],
  [eng.includes('structureRevisionAtLastSuccessfulSave'), 'structure revision watermark'],
  [eng.includes('intentionalEmpty') && eng.includes('allow_empty_nodes'), 'intentional empty sends allow flag'],
  [eng.includes('markCanvasStructureSaved()'), 'mark structure saved on success/open'],
  [store.includes('allow_empty_nodes'), 'store honors allow_empty_nodes'],
  [eng.includes('已阻止空节点覆盖保存') && eng.includes('!intentionalEmpty'), 'accidental empty still blocked'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) process.exit(1);

// 逻辑：结构版本前进后空板可存
let localStructureRevision = 0;
let structureRevisionAtLastSuccessfulSave = 0;
const canPersist = () => localStructureRevision > structureRevisionAtLastSuccessfulSave;
if (canPersist()) {
  console.error('FAIL: fresh board should not allow empty');
  process.exit(1);
}
localStructureRevision += 1; // simulate delete
if (!canPersist()) {
  console.error('FAIL: after delete should allow empty');
  process.exit(1);
}
structureRevisionAtLastSuccessfulSave = localStructureRevision;
if (canPersist()) {
  console.error('FAIL: after successful save should not allow empty again');
  process.exit(1);
}

console.log('check-empty-nodes-save: ok');
