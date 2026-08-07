/**
 * 视频展开格：勿把 adaptive 假成 16:9；natural 可纠正错 stamp
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const labelFn = eng.slice(
  eng.indexOf('function genStageAspectLabelFromNode'),
  eng.indexOf('function genStageAspectCssFromItem'),
);
const tileFn = eng.slice(
  eng.indexOf('function applyNaturalAspectToGenTile'),
  eng.indexOf('function generatorPendingList'),
);
const stampFn = eng.slice(
  eng.indexOf('function stampHistoryNaturalAspect'),
  eng.indexOf('function genStageCoverFavHtml'),
);

const checks = [
  [labelFn.includes("node?.type === 'video'"), 'video branch in aspect label'],
  [!/return '16:9'/.test(labelFn), 'video adaptive not faked as 16:9'],
  [labelFn.includes("return ''"), 'video adaptive returns empty'],
  [!tileFn.includes("getPropertyValue('--gen-tile-ar')) return"), 'natural always applies on tiles'],
  [stampFn.includes('Math.log(naturalAr / stampedAr)'), 'stamp corrects mismatched aspect'],
  [eng.includes('优先用已出结果的真实比例'), 'grid cell width prefers result aspect'],
  [eng.includes("genStageAspectCssForUrl(node, url) || genStageTileAspectCss(node)"), 'tile html aspect fallback'],
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
console.log('\ncheck-video-grid-aspect: all passed');
