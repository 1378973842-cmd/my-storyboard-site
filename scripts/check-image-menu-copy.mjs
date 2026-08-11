/**
 * 图片节点右键：创建副本文案 + 复制图片（剪贴板）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const menuStart = eng.indexOf('function openImageNodeMenu(');
const menuEnd = eng.indexOf('function openFrameStackImageMenu(', menuStart);
const menu = eng.slice(menuStart, menuEnd);

const genStart = eng.indexOf('function openGenStageResultMenu(');
const genEnd = eng.indexOf('function ', genStart + 10);
// openGenStageResultMenu is long; slice until next top-level-ish function after a reasonable span
const genSlice = eng.slice(genStart, genStart + 12000);

const checks = [
  [menu.includes("en ? 'Create copy' : '创建副本'"), 'image menu duplicate label is 创建副本'],
  [!menu.includes("'复制节点'"), 'image menu has no 复制节点'],
  [menu.includes('data-image-copy'), 'image menu has copy-image action'],
  [menu.includes("en ? 'Copy image' : '复制图片'"), 'image menu copy-image label'],
  [menu.includes('copyImageUrlToClipboard(url)'), 'image menu wires clipboard helper'],
  [eng.includes('async function copyImageUrlToClipboard'), 'clipboard helper exists'],
  [genSlice.includes("en ? 'Create copy' : '创建副本'"), 'gen menu duplicate label is 创建副本'],
  [!genSlice.includes("'复制节点'"), 'gen menu has no 复制节点'],
  [genSlice.includes('data-gen-copy-image'), 'gen menu has copy-image for stills'],
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
console.log('\ncheck-image-menu-copy: all passed');
