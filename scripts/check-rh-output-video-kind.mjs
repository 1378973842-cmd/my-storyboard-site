/**
 * RH 输出：保留 fileType/kind；视频勿默认落成 png；画布标题跟 kind
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const svc = fs.readFileSync(path.join(root, 'src/services/runningHubWorkflows.ts'), 'utf8');

const checks = [
  [svc.includes('function extractOutputRefs'), 'extractOutputRefs exists'],
  [svc.includes('sniffMediaExt'), 'magic-byte sniff exists'],
  [svc.includes('outputs.push(await storeRemoteOutput'), 'query stores typed outputs'],
  [svc.includes('outputs,'), 'query returns outputs array'],
  [eng.includes('result.outputs'), 'runRhNode reads typed outputs'],
  [eng.includes('function rhOutputPaneTitle'), 'dynamic output title helper'],
  [eng.includes("'输出视频'"), 'zh output video label'],
  [eng.includes('优先视频'), 'prefers video among mixed outputs'],
  [eng.includes('mkv'), 'isVideoUrl includes mkv'],
  [/ftyp/.test(svc), 'sniffs mp4 ftyp'],
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
console.log('\ncheck-rh-output-video-kind: all passed');
