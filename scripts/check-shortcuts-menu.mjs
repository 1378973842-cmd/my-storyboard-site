/**
 * 快捷键菜单与 canvasEngine 实际绑定对齐（防空白拖/滚轮文案冲突）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shell = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/InfiniteCanvasShell.tsx'), 'utf8');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'public/canvas/i18n-canvas.js'), 'utf8');

const groupsStart = shell.indexOf('const SHORTCUT_GROUPS');
const groupsEnd = shell.indexOf('];', groupsStart);
const groups = shell.slice(groupsStart, groupsEnd + 2);

const checks = [
  [groups.includes("keys: ['Ctrl', 'G']"), 'menu has Ctrl+G'],
  [groups.includes("keys: ['Ctrl', 'B']"), 'menu has Ctrl+B'],
  [groups.includes("keys: ['Delete', 'Backspace']"), 'menu lists Delete/Backspace'],
  [groups.includes("keys: ['Ctrl', '滚轮']"), 'menu zoom is Ctrl+wheel'],
  [groups.includes("keys: ['鼠标滚轮']") && groups.includes('平移画布'), 'menu wheel is pan'],
  [!/平移画布（空白处）[\s\S]{0,40}拖动空白处/.test(groups), 'no blank-drag-as-pan conflict'],
  [groups.includes("keys: ['拖动空白处']") && groups.includes('框选节点'), 'blank drag is box-select'],
  [groups.includes('双击浮标'), 'menu documents float rename'],
  [groups.includes('拖动选区框') || groups.includes('多选外框'), 'menu documents selection hull drag'],
  [eng.includes("e.key.toLowerCase() === 'g'"), 'engine binds Ctrl+G'],
  [eng.includes("e.key === 'Delete' || e.key === 'Backspace'"), 'engine binds Delete/Backspace'],
  [eng.includes('zoomViewportAtClient') && eng.includes('e.ctrlKey || e.metaKey'), 'engine Ctrl+wheel zooms'],
  [/viewport\.x -= e\.deltaX/.test(eng) && /viewport\.y -= e\.deltaY/.test(eng), 'engine plain wheel pans'],
  [eng.includes('startSelection(e)'), 'engine blank drag starts selection'],
  [i18n.includes('空白处拖拽框选') || i18n.includes('box-select'), 'i18n hint updated'],
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
console.log('\ncheck-shortcuts-menu: all passed');
