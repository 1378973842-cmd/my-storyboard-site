/**
 * RH 输出预览：视频可点开灯箱（非仅多结果切换）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [eng.includes('function outputLightboxIsVideo'), 'outputLightboxIsVideo helper'],
  [eng.includes('openOutputLightbox(url, node)'), 'RH output click opens lightbox'],
  [eng.includes('rh-output-video-badge'), 'VIDEO badge in preview html'],
  [eng.includes('class="rh-output-count"'), 'count is button for multi-switch'],
  [css.includes('.rh-output-video-badge'), 'video badge css'],
  [!/outline-offset:-0\.5px;\s*\}\s*color:#ffb866/.test(css), 'no orphaned css after badge'],
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
console.log('\ncheck-rh-output-open-video: all passed');
