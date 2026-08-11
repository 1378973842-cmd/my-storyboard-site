/**
 * 右键图片 / 生图 / 生视频图台：只出菜单，不 applyNodeSelection（避免唤出控制台）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

function sliceHandler(needle){
  const start = eng.indexOf(needle);
  if(start < 0) return '';
  const end = eng.indexOf('};', start);
  return eng.slice(start, end + 2);
}

const heroCtx = sliceHandler('hero.oncontextmenu = e => {');
const emptyNeedle = "emptyStage.oncontextmenu = e => {";
const emptyCtx = sliceHandler(emptyNeedle);
const tileCtx = sliceHandler('tile.oncontextmenu = e => {');
const bodyCtx = sliceHandler('body.oncontextmenu = e => {');

const checks = [
  [Boolean(heroCtx), 'hero contextmenu found'],
  [Boolean(emptyCtx), 'empty stage contextmenu found'],
  [Boolean(tileCtx), 'tile contextmenu found'],
  [Boolean(bodyCtx), 'image body contextmenu found'],
  [heroCtx.includes('openResultsMenu'), 'hero opens results menu'],
  [!/applyNodeSelection\s*\(/.test(heroCtx), 'hero contextmenu does not select'],
  [emptyCtx.includes('openResultsMenu'), 'empty opens results menu'],
  [!/applyNodeSelection\s*\(/.test(emptyCtx), 'empty contextmenu does not select'],
  [tileCtx.includes('openResultsMenu'), 'tile opens results menu'],
  [!/applyNodeSelection\s*\(/.test(tileCtx), 'tile contextmenu does not select'],
  [bodyCtx.includes('openImageNodeMenu'), 'image body opens image menu'],
  [!/applyNodeSelection\s*\(/.test(bodyCtx), 'image body contextmenu does not select'],
  [eng.includes('不选中以免唤出控制台') || eng.includes('避免唤出下方生成控制台') || eng.includes('会 syncImageGenDock 唤出控制台'), 'comment documents no-console intent'],
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
console.log('\ncheck-node-contextmenu-console: all passed');
