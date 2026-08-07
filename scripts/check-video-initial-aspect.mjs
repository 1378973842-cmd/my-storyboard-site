/**
 * 视频生成节点初始比例：画布新建 16:9；从图/图片生成台拉出 adaptive + 空台跟上游
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const addStart = eng.indexOf('function addVideoNode');
const addFn = eng.slice(addStart, eng.indexOf('function buildUploadedVideoNode', addStart));
const linkStart = eng.indexOf('function createLinkedNode');
const linkFn = eng.slice(linkStart, eng.indexOf('function createNodeByType', linkStart));
const tileStart = eng.indexOf('function genStageTileAspectCss');
const tileFn = eng.slice(tileStart, eng.indexOf('function aspectLabelToCss', tileStart));
const labelStart = eng.indexOf('function genStageAspectLabelFromNode');
const labelFn = eng.slice(labelStart, eng.indexOf('function genStageAspectCssFromItem', labelStart));
const upStart = eng.indexOf('function upstreamReferenceNodeSize');
const upFn = eng.slice(upStart, eng.indexOf('function upstreamReferenceNodeWidth', upStart));
const srcHelper = eng.slice(
  eng.indexOf('function isVideoAspectSourceNode'),
  eng.indexOf('function createLinkedNode'),
);

const checks = [
  [addFn.includes("opts.aspectRatio || '16:9'"), 'canvas default 16:9'],
  [!/aspectRatio:\s*'adaptive'/.test(addFn), 'addVideoNode no longer hardcodes adaptive'],
  [linkFn.includes("aspectRatio:'adaptive'") && linkFn.includes('isVideoAspectSourceNode'), 'linked uses aspect source helper'],
  [srcHelper.includes("type === 'generator'") && srcHelper.includes("type === 'image'"), 'generator + image are aspect sources'],
  [upFn.includes("type === 'generator'") && upFn.includes('_displayW'), 'upstream size from generator stage'],
  [tileFn.includes('upstreamReferenceNodeSize') && tileFn.includes("'16 / 9'"), 'empty adaptive stage: upstream or 16:9'],
  [labelFn.includes("return ''") && !/return '16:9'/.test(labelFn), 'label still does not fake adaptive as 16:9'],
  [!linkFn.includes('morphEmptyGenStageToConsoleRatio(created)'), 'linked video does not morph-jitter'],
  [linkFn.includes('resyncGenFrameAfterLinkChange'), 'linked video still resyncs frame'],
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
console.log('\ncheck-video-initial-aspect: all passed');
