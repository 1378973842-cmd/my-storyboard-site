/**
 * RH 异步任务：提交后登记 ledger，刷新/切画布可续查
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const runStart = eng.indexOf('async function runRhNode');
const runEnd = eng.indexOf('function renderComfySettings');
const runRh = runStart >= 0 && runEnd > runStart ? eng.slice(runStart, runEnd) : '';

const checks = [
  [runRh.includes("canvasTaskType = 'runninghub'"), 'pending tagged runninghub'],
  [runRh.includes('registerCanvasTaskLedger'), 'RH registers ledger after submit'],
  [runRh.includes('pollRunningHubTask'), 'runRh polls via shared helper'],
  [eng.includes("'runninghub'"), 'runninghub in resumable set'],
  [eng.includes("if(p.canvasTaskType === 'runninghub') pollRunningHubTask"), 'resume polls RH'],
  [eng.includes('function completeRunningHubTask') && eng.includes('function pollRunningHubTask'), 'complete/poll helpers'],
  [eng.includes('gen.type === \'rh\'') || eng.includes('gen.type === "rh"'), 'resume rebuilds RH pending'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`OK: ${label}`);
  else {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) {
  console.error(`\ncheck-rh-task-resume: ${failed} failed`);
  process.exit(1);
}
console.log('\ncheck-rh-task-resume: all passed');
