/**
 * 视频反推：底栏不被裁 + 左侧上传区存在（静态源码自检）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [eng.includes("node.type === 'videoReverse' ? 'rh-node '"), 'videoReverse mounts rh-node shell class'],
  [eng.includes('uploadVideosToVideoReverse'), 'uploadVideosToVideoReverse helper'],
  [eng.includes('bindVideoReverseUpload'), 'bindVideoReverseUpload binder'],
  [eng.includes('video-reverse-upload'), 'left upload dropzone markup'],
  [eng.includes('video-reverse-media'), 'left media well class'],
  [css.includes('.video-reverse-upload'), 'upload zone CSS'],
  [css.includes('.video-reverse-preview'), 'preview CSS'],
];

let failed = 0;
for(const [ok, label] of checks){
  if(!ok){
    console.error(`FAIL: ${label}`);
    failed++;
  } else {
    console.log(`OK: ${label}`);
  }
}
if(failed) process.exit(1);
console.log('check-video-reverse-upload: all passed');
