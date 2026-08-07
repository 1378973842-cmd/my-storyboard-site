/**
 * 视频/生图控制台与图台对齐：morph 收尾重贴 dock；布局变化跟随
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const morphStart = eng.indexOf('function morphEmptyGenStageToConsoleRatio');
const morphFn = eng.slice(morphStart, eng.indexOf('function scheduleImageGenDockFollow', morphStart));
const followStart = eng.indexOf('function scheduleImageGenDockFollow');
const followFn = eng.slice(followStart, eng.indexOf('function scheduleImageActionBarFollow', followStart));
const roStart = eng.indexOf('function bindNodeLayoutObserver');
const roFn = eng.slice(roStart, eng.indexOf('function refreshGeometryAfterLayout', roStart));

const checks = [
  [morphFn.includes("frame.style.height = ''"), 'morph finish clears frame height'],
  [morphFn.includes('snapAfterLayout'), 'morph finish snaps after layout'],
  [morphFn.includes('positionImageGenDock(node)'), 'morph finish repositions dock'],
  [!morphFn.includes('pinDock();\n        // 连线几何延后'), 'morph finish no longer freezes dock forever'],
  [followFn.includes('requestAnimationFrame(() => {\n            if(imageGenDockNodeId !== node.id) return;\n            positionImageGenDock(node);\n            requestAnimationFrame'), 'dock follow double rAF'],
  [roFn.includes('scheduleImageGenDockFollow(dockNode)'), 'ResizeObserver follows dock'],
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
console.log('\ncheck-video-dock-align: all passed');
