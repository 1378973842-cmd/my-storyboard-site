/**
 * 改模型不应无故把空图台往上拽：morph 收尾用 frame 高；比例未变不 morph
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const morphStart = eng.indexOf('function morphEmptyGenStageToConsoleRatio');
const morphFn = eng.slice(morphStart, eng.indexOf('function scheduleImageGenDockFollow', morphStart));
const bindStart = eng.indexOf('function bindImageGenDockControls');
const bindFn = eng.slice(bindStart, eng.indexOf('function remountImageGenDock', bindStart));

const checks = [
  [morphFn.includes('frame?.isConnected') && morphFn.includes('frame.offsetHeight'), 'snap prefers frame height'],
  [!/const h = Math\.max\(1, Math\.round\(el\.offsetHeight \|\| frame/.test(morphFn), 'snap no longer prefers el.offsetHeight'],
  [bindFn.includes('const arBefore = genStageTileAspectCss(node)'), 'model change captures aspect before'],
  [bindFn.includes('arBefore !== arAfter') && bindFn.includes('morphEmptyGenStageToConsoleRatio(node)'), 'morph only when aspect changes'],
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
console.log('\ncheck-gen-model-no-jump: all passed');
