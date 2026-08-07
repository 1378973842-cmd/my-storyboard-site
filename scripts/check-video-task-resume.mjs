/**
 * 视频异步任务：提交即返回 taskId，刷新可续查
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const bridge = fs.readFileSync(path.join(root, 'src/services/canvasVideoBridge.ts'), 'utf8');

const runStart = eng.indexOf('async function runVideoNode');
const runEnd = eng.indexOf('async function uploadCanvasUrlToComfy');
const runVideo = runStart >= 0 && runEnd > runStart ? eng.slice(runStart, runEnd) : '';

const checks = [
  [bridge.includes('/api/canvas-video-tasks'), 'POST video tasks route'],
  [bridge.includes("app.get(\"/api/canvas-video-tasks/:taskId\""), 'GET video task poll route'],
  [bridge.includes('runCanvasVideoTask'), 'background video runner'],
  [runVideo.includes('createCanvasVideoTask'), 'runVideo creates async tasks'],
  [runVideo.includes("canvasTaskType: 'canvas-video'"), 'pending tagged canvas-video'],
  [runVideo.includes('pollCanvasVideoTask'), 'runVideo polls tasks'],
  [eng.includes("resumable = new Set(['online-image', 'replica-agent', 'image-repair-agent', 'canvas-video'])"), 'video resumable on reopen'],
  [eng.includes("if(p.canvasTaskType === 'canvas-video') pollCanvasVideoTask"), 'resume polls video'],
  [eng.includes('function completeCanvasVideoTask') && eng.includes('function pollCanvasVideoTask'), 'complete/poll helpers'],
  [eng.includes('ledger 有 task 但节点 _pending') || eng.includes('重建占位'), 'resume rebuilds pending slots'],
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
  console.error(`\ncheck-video-task-resume: ${failed} failed`);
  process.exit(1);
}
console.log('\ncheck-video-task-resume: all passed');
