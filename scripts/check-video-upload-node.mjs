/**
 * 拖入画布的视频 → type:video 图台节点，无生成控制台
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const uploadStart = eng.indexOf('async function uploadMediaFiles');
const uploadFn = eng.slice(uploadStart, eng.indexOf('async function uploadImages(files, point)', uploadStart));
const createStart = eng.indexOf('function createImageCardFromUrl');
const createFn = eng.slice(createStart, eng.indexOf('function placeImageUrlOnCanvas', createStart));
const syncStart = eng.indexOf('function syncImageGenDock');
const syncDock = eng.slice(syncStart, eng.indexOf('function resolveImageActionBarTarget', syncStart));
const llmVidStart = eng.indexOf('function llmInputVideos');
const llmVidFn = eng.slice(llmVidStart, eng.indexOf('function videoReverseInputText', llmVidStart));

const checks = [
  [eng.includes('function buildUploadedVideoNode'), 'buildUploadedVideoNode'],
  [eng.includes('noGenConsole:true'), 'marks noGenConsole'],
  [eng.includes('function nodeShowsGenDock'), 'nodeShowsGenDock helper'],
  [uploadFn.includes("kind === 'video'"), 'uploadMediaFiles routes video'],
  [uploadFn.includes('buildUploadedVideoNode(file.url'), 'upload builds video node'],
  [createFn.includes('isVideoUrl(url)'), 'url drop routes video'],
  [createFn.includes('buildUploadedVideoNode(url'), 'url builds video node'],
  [syncDock.includes('nodeShowsGenDock(only)'), 'dock gated by nodeShowsGenDock'],
  [eng.includes('buildUploadedVideoNode(file.url, {x:baseX'), 'videoReverse upload uses video node'],
  [llmVidFn.includes("n.type === 'video'"), 'llmInputVideos reads video nodes'],
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
console.log('\ncheck-video-upload-node: all passed');
