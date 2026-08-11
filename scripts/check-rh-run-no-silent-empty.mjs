/**
 * RH outputs 解析：SUCCESS 时 data 可能是 URL 字符串；UNKNOWN 不得当「运行中」空转
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const svc = fs.readFileSync(path.join(root, 'src/services/runningHubWorkflows.ts'), 'utf8');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const preview = fs.readFileSync(path.join(root, 'src/components/RhLivePreviewPanel.tsx'), 'utf8');

const extractStart = svc.indexOf('function extractOutputRefs(');
const extractFn = svc.slice(extractStart, svc.indexOf('\nfunction ', extractStart + 1));
const runStart = eng.indexOf('async function runRhNode(');
const runFn = eng.slice(runStart, eng.indexOf('\nfunction ', runStart + 1));
const paneStart = eng.indexOf('function rhRenderOutputPane(');
const paneFn = eng.slice(paneStart, eng.indexOf('\nfunction ', paneStart + 1));

const checks = [
  [extractFn.includes('typeof data === "string"') || extractFn.includes("typeof data === 'string'"), 'extractOutputRefs handles string data'],
  [extractFn.includes('fileList') || extractFn.includes('outputUrl'), 'extractOutputRefs has extra url keys'],
  [svc.includes('[runninghub] query taskId='), 'query logs status/code'],
  [runFn.includes("data.status === 'RUNNING'") && runFn.includes('UNKNOWN'), 'runRhNode rejects unknown status'],
  [runFn.includes('softAlert(errMsg') || runFn.includes('softAlert(errMsg ||'), 'runRhNode softAlerts on failure'],
  [paneFn.includes("runStatus === 'failed'") && paneFn.includes('is-failed'), 'output pane shows failed state'],
  [preview.includes("data.status === 'QUEUED' || data.status === 'RUNNING'"), 'admin preview only treats queued/running as wait'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error('FAIL:', label);
    failed++;
  } else console.log('OK:', label);
}
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncheck-rh-run-no-silent-empty: all passed');
