/**
 * 多张静帧拖入画布默认打成图片组（files + localPaths）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const uploadStart = eng.indexOf('async function uploadMediaFiles(');
const uploadFn = eng.slice(uploadStart, eng.indexOf('\nasync function ', uploadStart + 1));

const localStart = eng.indexOf('async function createImageCardsFromLocalPaths(');
const localFn = eng.slice(localStart, eng.indexOf('\nasync function ', localStart + 1));

const dropStart = eng.indexOf('async function applyImageDropPayloadToBoard(');
const dropFn = eng.slice(dropStart, eng.indexOf('\nasync function ', dropStart + 1));

const checks = [
  [uploadFn.includes('opts.group !== false'), 'uploadMediaFiles auto-groups unless group:false'],
  [uploadFn.includes('createImageBatchForUploadedNodes'), 'uploadMediaFiles creates image batch'],
  [localFn.includes('created.length > 1'), 'localPaths multi-image gates on length > 1'],
  [localFn.includes('createImageBatchForUploadedNodes'), 'localPaths creates image batch'],
  [dropFn.includes('uploadImageGroup') && dropFn.includes('localPaths'), 'board drop routes files/localPaths'],
  [eng.includes('async function uploadImageGroup') && eng.includes('{group:true}'), 'uploadImageGroup still forces group'],
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
console.log('\ncheck-multi-image-drop-batch: all passed');
