/**
 * 多选外框：左键按住可拖动已选节点
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const hullStart = eng.indexOf('function startSelectionHullDrag(');
const hullFn = eng.slice(hullStart, eng.indexOf('\nfunction ', hullStart + 1));

const checks = [
  [eng.includes('function startSelectionHullDrag'), 'startSelectionHullDrag exists'],
  [eng.includes('function onSelectionBoxMouseDown'), 'selection box mousedown handler'],
  [eng.includes("on(selectionBox, 'mousedown', onSelectionBoxMouseDown)"), 'wired via mousedown not pointerdown'],
  [!eng.includes("on(selectionBox, 'pointerdown'"), 'selection box not on pointerdown'],
  [eng.includes('setSelectionBoxHullInteractive'), 'hull interactive class toggle'],
  [eng.includes('is-selection-hull'), 'hull class name'],
  [hullFn.includes('collectDragChildren') && hullFn.includes('pendingNodeDrag'), 'hull drag reuses node drag children'],
  [!hullFn.includes('applyNodeSelection'), 'hull drag does not collapse multi-select'],
  [hullFn.includes("addEventListener('pointerup'") || hullFn.includes('pointerup'), 'pointerup fallback ends drag'],
  [eng.includes('.selection-box') && eng.includes('canStartBoardPanFromTarget'), 'board pan skips selection box'],
  [css.includes('.selection-box.is-selection-hull') && /pointer-events:\s*auto/.test(css), 'hull receives pointer events'],
  [css.includes('cursor:grab') || css.includes('cursor: grab'), 'hull grab cursor'],
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
console.log('\ncheck-selection-hull-drag: all passed');
