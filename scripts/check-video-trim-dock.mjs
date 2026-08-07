/**
 * 视频剪辑底栏：胶片条选区 + 与图片裁剪同款进场动效
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [eng.includes('function openVideoTrimDock'), 'openVideoTrimDock'],
  [eng.includes('function closeVideoTrimDock'), 'closeVideoTrimDock'],
  [eng.includes('function positionVideoTrimDock'), 'positionVideoTrimDock'],
  [eng.includes('function commitVideoTrim'), 'commitVideoTrim'],
  [eng.includes('function exportTrimmedVideoBlob'), 'MediaRecorder export'],
  [eng.includes('function placeTrimmedVideoNode'), 'places trimmed video node'],
  [eng.includes("connections.push({id:uid('c'), from:sourceNode.id, to:videoNode.id})"), 'connects source→clip'],
  [eng.includes('openVideoTrimDock(node)'), 'scissors opens trim dock'],
  [eng.includes('function attachVideoTrimPreview'), 'stage preview locked to trim range'],
  [eng.includes('function videoTrimRangeSecs'), 'trim range helper'],
  [eng.includes("trimRangeForNode"), 'player UI uses trim window'],
  [!eng.includes('视频剪辑即将上线'), 'placeholder softAlert removed'],
  [eng.includes("host.classList.add('active')"), 'dock active class for enter anim'],
  [css.includes('.video-trim-dock'), 'trim dock css'],
  [css.includes('.video-trim-strip-wrap'), 'filmstrip wrap'],
  [css.includes('.video-trim-sel'), 'selection window'],
  [css.includes('.video-trim-handle'), 'trim handles'],
  [css.includes('.video-trim-dur'), 'duration pill'],
  [css.includes('animation:image-edit-dock-in'), 'reuses crop dock enter motion'],
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
console.log('\ncheck-video-trim-dock: all passed');
