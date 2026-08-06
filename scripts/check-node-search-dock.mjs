/**
 * 自检：侧栏节点搜索入口 + 图1分类面板
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/InfiniteCanvasShell.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [shell.includes('canvasNodeSearchBtn') && shell.includes('openCanvasNodeSearch'), 'side dock search button'],
  [shell.includes('Search') && shell.includes('from \'lucide-react\''), 'Search icon import'],
  [eng.includes('CANVAS_NODE_SEARCH_CATS') && eng.includes("id:'world'"), 'category filters'],
  [eng.includes('function canvasNodeSearchThumbUrl') && eng.includes('canvas-node-search-thumb'), 'thumbnails in list'],
  [eng.includes('搜索节点...') || eng.includes('Search nodes'), 'search placeholder'],
  [eng.includes('flashLocateNodeOnCanvas') && eng.includes('viewport.scale = 0.4'), 'search locate uses favorite-style focus'],
  [eng.includes('setCanvasNodeSearchBtnActive'), 'dock active state sync'],
  [css.includes('.canvas-node-search-cats') && css.includes('.canvas-node-search-thumb'), 'panel CSS'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) process.exit(1);
console.log('check-node-search-dock: ok');
