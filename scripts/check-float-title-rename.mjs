/**
 * 带浮标节点：双击左上角名字原地重命名
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const renameStart = eng.indexOf('function beginNodeFloatTitleRename(');
const renameFn = eng.slice(renameStart, eng.indexOf('\nfunction ', renameStart + 1));

const checks = [
  [eng.includes('function nodeFloatTitleCustom'), 'custom float title getter'],
  [eng.includes('function applyNodeFloatTitleCustom'), 'custom float title setter'],
  [eng.includes('function beginNodeFloatTitleRename'), 'begin rename'],
  [eng.includes('function bindNodeFloatTitleRename'), 'bind rename'],
  [eng.includes('bindNodeFloatTitleRename(el, node)'), 'renderNode binds rename'],
  [eng.includes('data-float-rename="1"'), 'labels marked renamable'],
  [renameFn.includes('ondblclick') || eng.includes('beginNodeFloatTitleRename(node, labelEl)'), 'dblclick starts rename'],
  [renameFn.includes('pushUndo()') && renameFn.includes('scheduleSave()'), 'rename persists with undo'],
  [eng.includes('nodeFloatTitleCustom(node)') && eng.includes("type === 'group'"), 'frame group uses custom/default'],
  [/float-title-label[\s\S]{0,80}pointer-events:\s*auto/.test(css), 'label receives pointer events'],
  [css.includes('.float-title-input'), 'inline rename input styles'],
  [eng.includes('.float-title-label') && eng.includes('isNodeControl'), 'float label not drag surface'],
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
console.log('\ncheck-float-title-rename: all passed');
