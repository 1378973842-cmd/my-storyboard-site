/**
 * 视频台播放器：左上静音+收藏，底栏播放/进度/放大
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [eng.includes('function genStageVideoPlayerHtml'), 'player html helper'],
  [eng.includes('function genStageHeroMediaHtml'), 'hero media switch'],
  [eng.includes('function bindGenStageVideoPlayers'), 'bind helper'],
  [eng.includes('bindGenStageVideoPlayers(root, node)'), 'wired from stage bind'],
  [eng.includes('data-video-action="mute"'), 'mute chip'],
  [eng.includes('data-video-action="play"'), 'play btn'],
  [eng.includes('data-video-action="expand"'), 'expand btn'],
  [eng.includes('gen-stage-video-seek'), 'seek input'],
  [eng.includes("node?.type === 'video' && isVideoUrl(url)"), 'video-node only'],
  [css.includes('.gen-stage-video-shell'), 'shell css'],
  [css.includes('.gen-stage-video-bar'), 'bar css'],
  [css.includes('.gen-stage-video-chip'), 'top chip css'],
  [css.includes('height:5px') && css.includes('.gen-stage-video-seek::-webkit-slider-runnable-track'), 'thick seek track'],
  [css.includes('width:16px; height:16px') && css.includes('.gen-stage-video-seek::-webkit-slider-thumb'), 'large seek thumb'],
  [css.includes('font-size:13.5px') && css.includes('.gen-stage-video-tcur'), 'larger time labels'],
  [eng.includes("node?.type === 'video' ? '条' : '张'"), 'video stack badge unit 条'],
  [css.includes('.video-node .gen-stage.is-busy:not(.is-grid) .gen-stage-video-bar'), 'busy locks video bar'],
  [css.includes('.video-node .gen-stage.is-busy:not(.is-grid) .gen-stage-stack-expand'), 'busy keeps stack expand'],
  [eng.includes('controlsLocked') && eng.includes('stageBusyCollapsed'), 'busy click guards'],
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
console.log('\ncheck-video-stage-player: all passed');
