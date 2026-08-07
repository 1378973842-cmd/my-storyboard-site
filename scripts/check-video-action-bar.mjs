/**
 * 视频卡 / 视频生成节点：上方动作条（剪辑入口·截帧·素材库·下载·放大）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src/services/assetLibraryStore.ts'), 'utf8');

const resolveFn = eng.slice(
  eng.indexOf('function resolveImageActionBarTarget'),
  eng.indexOf('function removeImageActionBar'),
);
const barHtml = eng.slice(
  eng.indexOf('function imageActionBarHtmlForTarget'),
  eng.indexOf('function remountImageActionBar'),
);

const checks = [
  [eng.includes('function isCanvasVideoSourceNode'), 'video source helper'],
  [resolveFn.includes("kind:'video-image'"), 'upload video bar target'],
  [resolveFn.includes("kind:'video-gen'"), 'video-gen bar target'],
  [barHtml.includes('data-action="edit"'), 'edit/scissors btn'],
  [barHtml.includes('data-action="capture"'), 'capture btn'],
  [barHtml.includes('data-action="save-library"'), 'save library btn'],
  [barHtml.includes('data-action="download"'), 'download btn'],
  [barHtml.includes('data-action="enlarge"'), 'enlarge btn'],
  [eng.includes('openVideoCaptureMenu(btn, node)'), 'capture wired'],
  [eng.includes('openVideoTrimDock(node)'), 'trim dock wired'],
  [eng.includes("resolveVideoElementForCapture"), 'capture finds stage video'],
  [css.includes('.image-action-bar-sep'), 'toolbar sep css'],
  [store.includes('ASSET_VIDEO_EXTS'), 'asset lib video exts'],
  [store.includes('guessExtFromMime'), 'asset lib mime guess'],
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
console.log('\ncheck-video-action-bar: all passed');
