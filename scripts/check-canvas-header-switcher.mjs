/**
 * 顶栏画布胶囊：名称下拉切换 + 保存态图标（√ / 转圈）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nav = fs.readFileSync(path.join(root, 'src/components/StudioTopNav.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const checks = [
  [nav.includes('studio-canvas-header-pill'), 'pill chrome'],
  [nav.includes('fetchCanvasSwitcherList') && nav.includes('prefetchCanvasList'), 'list cache/prefetch'],
  [nav.includes('AnimatePresence') && nav.includes('studio-canvas-switcher'), 'switcher spring enter'],
  [!nav.includes('titleClickTimerRef'), 'no open delay timer'],
  [nav.includes('e.detail > 1'), 'dblclick click guard'],
  [nav.includes('搜索画布'), 'switcher search'],
  [nav.includes('新建画布'), 'new canvas action'],
  [nav.includes('Loader2') && nav.includes('is-spin'), 'saving spinner'],
  [nav.includes('<Check') && nav.includes('studio-canvas-pill-status'), 'saved check icon'],
  [!nav.includes('studio-canvas-meta-date'), 'no paren date in header'],
  [nav.includes('onDoubleClick') && nav.includes('startRename'), 'dblclick rename kept'],
  [nav.includes("id: 'personal', label: '个人空间'") && nav.includes("id: 'gallery', label: '公共画廊'"), 'brand menu personal/gallery'],
  [nav.includes("id === 'personal'") && nav.includes('openPersonal()'), 'personal action wired'],
  [nav.includes("id === 'gallery'") && nav.includes('openGallery()'), 'gallery action wired'],
  [nav.indexOf("id: 'gate'") < nav.indexOf("id: 'personal'") && nav.indexOf("id: 'personal'") < nav.indexOf("id: 'rename'"), 'menu order under gate'],
  [eng.includes('export function getCurrentCanvasId'), 'getCurrentCanvasId export'],
  [css.includes('studio-canvas-header-pill') && css.includes('studio-canvas-switcher'), 'pill/switcher css'],
  [css.includes('backdrop-filter: blur(12px)'), 'lighter switcher blur'],
  [css.includes('.studio-canvas-switcher-list::-webkit-scrollbar'), 'switcher scrollbar hidden'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) process.exit(1);
console.log('ok: canvas header switcher checks passed');
