/**
 * 截帧：三选项菜单；截完在视频后连出图片节点（不再进截帧集）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [eng.includes('function openVideoCaptureMenu'), 'capture menu helper'],
  [eng.includes('data-capture-mode="current"'), 'current option'],
  [eng.includes('data-capture-mode="first"'), 'first option'],
  [eng.includes('data-capture-mode="last"'), 'last option'],
  [eng.includes('function placeCapturedFrameImageNode'), 'places image node'],
  [eng.includes('VIDEO_DERIVED_NODE_GAP_X'), 'spawn gap constant'],
  [eng.includes('function sourceMediaStageSize'), 'measures source stage size'],
  [eng.includes('_fitMinEdge'), 'capture locks fit to source min edge'],
  [eng.includes("floatTitleKind:'capture'"), 'capture float title kind'],
  [eng.includes("floatTitleKind = 'trim'") || eng.includes("floatTitleKind:'trim'"), 'trim float title kind'],
  [eng.includes('function ensureFloatTitleIndexByKind'), 'kind-scoped float index'],
  [eng.includes("zh:'截帧'"), 'capture label 截帧'],
  [eng.includes("zh:'剪辑'"), 'trim label 剪辑'],
  [eng.includes('placeCapturedFrameImageNode(node, file.url, file.name || label, {nw:w, nh:h})'), 'passes capture natural size'],
  [eng.includes("connections.push({id:uid('c'), from:sourceNode.id, to:imgNode.id})"), 'connects video→image'],
  [eng.includes('function seekVideoForCaptureMode'), 'seek by mode'],
  [eng.includes('openVideoCaptureMenu(btn, node)'), 'action bar opens menu'],
  [!/ensureFrameStackForVideo\(node\)/.test(eng.slice(eng.indexOf('async function captureVideoFrameFromNode'), eng.indexOf('function bindVideoCaptureFrame'))), 'capture no longer uses frame stack'],
  [css.includes('.video-capture-menu'), 'menu css'],
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
console.log('\ncheck-video-capture-menu: all passed');
