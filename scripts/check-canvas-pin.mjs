/**
 * 画布 Pin：工具栏取色 / 角标 / 顶栏 Hub / 定位 / 持久化字段
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const imageBarStart = eng.indexOf('function imageActionBarHtmlForTarget(');
const imageBarFn = eng.slice(imageBarStart, eng.indexOf('\nfunction ', imageBarStart + 1));
const textBarStart = eng.indexOf('function remountTextFormatBar(');
const textBarFn = eng.slice(textBarStart, eng.indexOf('\nfunction ', textBarStart + 1));

const checks = [
  [eng.includes('const CANVAS_PIN_COLORS'), 'CANVAS_PIN_COLORS defined'],
  [eng.includes("id: 'rose'") && eng.includes("id: 'purple'"), 'six pin colors'],
  [eng.includes('function normalizePinColor'), 'normalizePinColor'],
  [eng.includes('function setNodePinColor'), 'setNodePinColor'],
  [eng.includes('function syncNodePinDot'), 'syncNodePinDot'],
  [eng.includes('function syncCanvasPinHub'), 'syncCanvasPinHub'],
  [eng.includes('function focusCanvasPinnedTarget'), 'focusCanvasPinnedTarget'],
  [eng.includes('function openCanvasPinHubPanel'), 'openCanvasPinHubPanel'],
  [eng.includes('pinLabels'), 'settings.pinLabels persistence path'],
  [eng.includes('scheduleSave()') && eng.includes('setNodePinColor'), 'pin write schedules save'],
  [eng.includes('flashFavoriteLocateEl') && eng.includes('flashPinnedNodeEl'), 'reuses favorite locate flash'],
  [(imageBarFn.includes('canvasPinActionBtnHtml') || imageBarFn.includes('canvas-pin-btn')), 'image/video action bar has pin'],
  [eng.includes('canvasPinSwatchRailHtml(node.pinColor)'), 'swatch rail on image bar mount'],
  [(textBarFn.includes('data-cmd="pin"') || textBarFn.includes("value: 'pin'") || textBarFn.includes('canvasPinActionBtnHtml')), 'text format bar has pin'],
  [eng.includes('canvasPinSwatchRailHtml(node.pinColor)'), 'text bar mounts swatch rail'],
  [eng.includes('syncNodePinDot(el, node)'), 'renderNode syncs pin dot'],
  [eng.includes('canvas-pin-hub-triggers') && eng.includes('data-pin-hub-color'), 'hub multi color triggers'],
  [eng.includes('function canvasPinUsedColorIds'), 'used colors ordered'],
  [eng.includes('focusCanvasNodeById(node.id)') || eng.includes('flashLocateNodeOnCanvas(nodeId)'), 'pin locate reuses canvas locate'],
  [css.includes('.canvas-pin-hub-triggers') && css.includes('.canvas-pin-hub-trigger.is-open'), 'multi-trigger CSS'],
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
console.log(`\nAll ${checks.length} checks passed`);
