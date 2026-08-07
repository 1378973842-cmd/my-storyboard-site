/**
 * 视频控制台：发送钮左侧有生成数量（1–8×），runVideoNode 按 count 并发
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const videoDockStart = eng.indexOf('function videoDockShellHtml');
const videoDockEnd = eng.indexOf('function bindVideoDockControls');
const videoDock = videoDockStart >= 0 && videoDockEnd > videoDockStart
  ? eng.slice(videoDockStart, videoDockEnd)
  : '';
const runStart = eng.indexOf('async function runVideoNode');
const runEnd = eng.indexOf('async function uploadCanvasUrlToComfy');
const runVideo = runStart >= 0 && runEnd > runStart
  ? eng.slice(runStart, runEnd)
  : '';
const bindStart = eng.indexOf('function bindVideoDockControls');
const bindEnd = eng.indexOf('function buildVideoDockContent');
const bindVideo = bindStart >= 0 && bindEnd > bindStart
  ? eng.slice(bindStart, bindEnd)
  : '';

const checks = [
  [videoDock.includes('gen-dock-count-lite'), 'video dock count UI'],
  [videoDock.includes('gen-dock-count-input'), 'video dock count input'],
  [videoDock.includes('if(node.count == null) node.count = 1'), 'video dock default count'],
  [bindVideo.includes("wrap.querySelector('.gen-dock-count-input')"), 'bind count input'],
  [bindVideo.includes("wrap.querySelectorAll('.gen-dock-count-step')"), 'bind count steppers'],
  [runVideo.includes('const count = Math.max(1, Math.min(8, Number(node.count || 1)))'), 'runVideoNode reads count'],
  [runVideo.includes('Array.from({length:count}'), 'runVideoNode N pendings'],
  [runVideo.includes('Promise.all(pendingIds.map'), 'multi count runs concurrent'],
  [runVideo.includes("pullFocusedEditableIntoModel()"), 'pulls focused count before run'],
  [runVideo.includes('成功') || runVideo.includes('Video batch'), 'partial failure alert'],
  [runVideo.includes('nodes.find(n => n.id === nodeId)'), 'execute resolves live node'],
  [/function addVideoNode\(point[\s\S]{0,900}?count:\s*1,/.test(eng), 'addVideoNode count:1'],
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
console.log('\ncheck-video-dock-count: all passed');
