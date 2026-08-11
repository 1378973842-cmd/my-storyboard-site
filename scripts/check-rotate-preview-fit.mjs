/**
 * 旋转 90° 预览：外框宽高对调，避免 CSS rotate 后留黑边
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const checks = [
  [eng.includes('function ensureRotatePreviewBaseSize'), 'base size capture'],
  [eng.includes('function clearRotatePreviewLayout'), 'clear rotate layout'],
  [eng.includes('const swap = deg === 90 || deg === 270'), 'preview swaps 90/270'],
  [eng.includes('shell.style.aspectRatio = `${outW} / ${outH}`'), 'shell aspect swap'],
  [eng.includes("translate(-50%, -50%) rotate(${deg}deg)"), 'centered rotate transform'],
  [eng.includes('clearRotatePreviewLayout()') && eng.includes('detachInplaceEditSurface'), 'clear on detach'],
  [/canvasEl\.width = swap \? nh : nw/.test(eng), 'save path still swaps canvas'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) process.exit(1);
console.log('ok: rotate preview fit checks passed');
