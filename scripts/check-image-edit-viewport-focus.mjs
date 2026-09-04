/**
 * 裁剪/画笔/旋转：聚焦放大不应被远程同步或误触空白立即打回原比例
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const interacting = eng.slice(
  eng.indexOf('function isCanvasInteracting('),
  eng.indexOf('\nfunction ', eng.indexOf('function isCanvasInteracting(') + 1),
);
const prepare = eng.slice(
  eng.indexOf('function prepareImageEditCanvasFocus('),
  eng.indexOf('\nfunction ', eng.indexOf('function prepareImageEditCanvasFocus(') + 1),
);
const boardDown = eng.slice(
  eng.indexOf('board.onmousedown = e => {'),
  eng.indexOf('on(board, \'pointerdown\'', eng.indexOf('board.onmousedown = e => {')),
);
const animate = eng.slice(
  eng.indexOf('function animateViewportTo('),
  eng.indexOf('\nfunction ', eng.indexOf('function animateViewportTo(') + 1),
);

const checks = [
  [interacting.includes('isImageEditOpen()') || interacting.includes('imageEditViewportAnimActive'), 'interacting covers image-edit focus'],
  [eng.includes('imageEditOpenedAt'), 'open timestamp guard exists'],
  [eng.includes('imageEditViewportAnimActive'), 'viewport anim active flag'],
  [prepare.includes('touchBoardInteraction()'), 'prepare marks board interaction'],
  [prepare.includes('imageEditOpenedAt'), 'prepare stamps open time'],
  [/Date\.now\(\)\s*-\s*imageEditOpenedAt\s*<\s*480/.test(boardDown), 'blank click ignores fresh open'],
  [boardDown.includes('image-edit-rotate-dock'), 'blank click excludes rotate dock'],
  [/keepLocalViewport\s*=\s*isImageEditOpen\(\)/.test(eng), 'remote sync keeps viewport while editing'],
  [/stiffness\s*=\s*320/.test(animate) && /maxMs\s*=\s*780/.test(animate), 'focus spring tightened'],
  [/cancelImageEditViewportAnim[\s\S]{0,120}imageEditViewportAnimActive\s*=\s*false/.test(eng), 'cancel clears anim active'],
  [/if\(mode === 'rotate'\) return/.test(prepare), 'rotate skips entrance viewport zoom'],
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
console.log('\ncheck-image-edit-viewport-focus: all passed');
