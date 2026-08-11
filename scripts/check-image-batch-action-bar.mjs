/**
 * 图片组选中工具栏：解组 / 禁用所有 / 背景色（图1 芯片 + 图2 竖条）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const remountStart = eng.indexOf('function remountImageBatchActionBar(');
const remountFn = eng.slice(remountStart, eng.indexOf('\nfunction ', remountStart + 1));

const checks = [
  [eng.includes('function syncImageBatchActionBar'), 'syncImageBatchActionBar exists'],
  [eng.includes('function remountImageBatchActionBar'), 'remountImageBatchActionBar exists'],
  [eng.includes('function ungroupImageBatch'), 'ungroupImageBatch exists'],
  [(() => {
    const i = eng.indexOf('function ungroupImageBatch(');
    const fn = eng.slice(i, eng.indexOf('\nfunction ', i + 1));
    return fn.includes('commitStructureDomPatch') && !fn.includes('render()');
  })(), 'ungroupImageBatch uses local DOM patch'],
  [(() => {
    const i = eng.indexOf('function ungroupFrameGroup(');
    const fn = eng.slice(i, eng.indexOf('\nfunction ', i + 1));
    return fn.includes('commitStructureDomPatch') && !fn.includes('render()');
  })(), 'ungroupFrameGroup uses local DOM patch'],
  [eng.includes('function openImageBatchBgMenu'), 'bg menu exists'],
  [eng.includes('IMAGE_BATCH_BG_PRESETS') || eng.includes('CANVAS_BG_PRESETS'), 'bg presets'],
  [eng.includes('syncImageBatchActionBar()'), 'wired into selection refresh'],
  [remountFn.includes('data-action="ungroup"') && remountFn.includes('解组'), 'toolbar has ungroup'],
  [remountFn.includes('data-action="disable"') && (remountFn.includes('禁用所有') || remountFn.includes('Disable all')), 'toolbar has disable all'],
  [remountFn.includes('canvas-bg-chip-btn') && remountFn.includes('image-batch-bg-chip'), 'toolbar has fig1 color chip'],
  [eng.includes('canvas-bg-rail') && eng.includes('CANVAS_BG_PRESETS'), 'fig2 vertical rail shared'],
  [eng.includes("type === 'imageBatch'") && eng.includes('syncShellBgDom'), 'imageBatch applies frameBg via syncShellBgDom'],
  [css.includes('.canvas-bg-rail') && css.includes('.canvas-bg-chip'), 'bg UI styles'],
  [css.includes('.canvas-bg-dot.is-none::after') || css.includes('.image-batch-bg-dot.is-none::after'), 'none swatch slash'],
  [css.includes('has-custom-bg'), 'custom bg class styles'],
  [eng.includes('function selectionImagesForBatch'), 'selectionImagesForBatch expands group shells'],
  [eng.includes('function detachNodesFromOtherGroups'), 'detachNodesFromOtherGroups exists'],
  [/detachNodesFromOtherGroups\(list\)/.test(eng) && /batch\.items\s*=\s*list\.map/.test(eng), 'buildImageBatch detaches then assigns all items'],
  [/createImageBatchFromSelection[\s\S]{0,220}selectionImagesForBatch\(/.test(eng), 'createImageBatchFromSelection uses selectionImagesForBatch'],
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
console.log('\ncheck-image-batch-action-bar: all passed');
