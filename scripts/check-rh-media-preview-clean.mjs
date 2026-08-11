/**
 * RH 输入：有图不叠浮标、无 title 弹提示；输出：完整预览不强制 3/4 裁切
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const mediaStart = eng.indexOf('function renderRhMediaFields(');
const mediaFn = eng.slice(mediaStart, eng.indexOf('\nfunction ', mediaStart + 1));
const outStart = eng.indexOf('function rhRenderOutputPane(');
const outFn = eng.slice(outStart, eng.indexOf('\nfunction ', outStart + 1));
const outMediaCss = css.match(/\.rh-output-media\s*\{[\s\S]*?\n\}/)?.[0] || '';

const checks = [
  [!mediaFn.includes('title="${escapeAttr(tech)}"') && !mediaFn.includes("title=\"${escapeAttr(tech)}\""), 'input tile has no tech title tooltip'],
  [mediaFn.includes('has-media') && !/has-media[\s\S]*rh-media-tile-badge/.test(mediaFn.split('? `')[1] || ''), 'filled tile omits badge in has-media branch'],
  [!mediaFn.includes('已上传') || !mediaFn.includes('sourceHint'), 'no uploaded foot overlay copy'],
  [!outFn.includes("aspect-ratio:3/4") && !outFn.includes('aspect-ratio:9/16'), 'output has no forced 3/4 or 9/16'],
  [/max-height\s*:\s*none/.test(outMediaCss), 'output media max-height none'],
  [css.includes('.rh-media-tile.has-media .rh-media-tile-badge') && css.includes('display:none'), 'CSS hides badge on filled tiles'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error('FAIL:', label);
    failed++;
  } else console.log('OK:', label);
}
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncheck-rh-media-preview-clean: all passed');
