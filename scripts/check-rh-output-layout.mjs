/**
 * RH 输出 UI：历史切换不盖视频、去掉 VIDEO 角标、输入输出跟媒体比例、无可见滚动条；
 * RH 不挂顶部 agent-result-stage；有图时输入/输出去井框。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [!eng.includes('rh-output-video-badge'), 'VIDEO badge removed from preview html'],
  [eng.includes('rh-output-toolbar'), 'history toolbar outside media'],
  [eng.includes('function rhApplyFrameAspect'), 'aspect helper exists'],
  [eng.includes('rhApplyFrameAspect(frameEl, mediaEl'), 'input tiles apply aspect'],
  [eng.includes('rhApplyFrameAspect(mediaEl, mediaTag'), 'output applies aspect'],
  [eng.includes('paneHead.hidden = true'), 'hides duplicate pane-head when filled'],
  [/if\s*\(\s*node\.type\s*===\s*['"]rh['"]\s*\)\s*return\s*['"]['"]/.test(eng)
    || /if\s*\(\s*node\.type\s*===\s*['"]rh['"]\s*\)\s*return\s*;/.test(eng), 'RH skips agent-result-stage'],
  [eng.includes("ta.style.height = `${Math.max(72, ta.scrollHeight)}px`"), 'prompt auto-grows'],
  [css.includes('.rh-output-toolbar'), 'toolbar css'],
  [css.includes('object-fit:contain') && css.includes('.rh-media-tile-media img'), 'input contain not cover'],
  [css.includes('.rh-input-stack::-webkit-scrollbar'), 'input scrollbars hidden'],
  [css.includes('.rh-media-tile.has-media .rh-media-tile-veil') && /has-media\s+\.rh-media-tile-veil\s*\{\s*opacity:\s*0/.test(css), 'has-media veil off'],
  [css.includes('.rh-media-grid.is-solo .rh-media-tile.has-media'), 'solo filled tile no forced well'],
  [!css.includes('.rh-output-video-badge'), 'video badge css removed'],
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
console.log('\ncheck-rh-output-layout: all passed');
