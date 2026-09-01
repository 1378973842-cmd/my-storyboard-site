/**
 * 视频图台展开/收起：与图片同款 FLIP；视频幽灵用当前帧截图
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const checks = [
  [eng.includes('function mediaSnapshotForFlipGhost'), 'video frame snapshot helper'],
  [eng.includes("toDataURL('image/jpeg'"), 'canvas frame capture'],
  [eng.includes("querySelector?.('img, video, .gen-stage-video-el')"), 'finds stage video el'],
  [eng.includes('node._stageFlipping = true'), 'marks flipping before remount'],
  [eng.includes('if(node?._stageFlipping)'), 'defers natural aspect during flip'],
  [eng.includes('outputUrlValue(g.dataset.flipUrl)'), 'normalizes ghost url keys'],
  [eng.includes('function softHideImageGenDockForCollapse'), 'dock soft-hides on collapse'],
  [eng.includes('function finishImageGenDockAfterStageFlip'), 'dock fade-in after collapse flip'],
  [eng.includes('playCanvasChromeExit'), 'chrome exit animation helper'],
  [eng.includes('if(node._stageFlipping)') && eng.includes('scheduleImageActionBarFollow(node)'), 'skip dock snap-follow during flip'],
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
console.log('\ncheck-video-stage-flip: all passed');
