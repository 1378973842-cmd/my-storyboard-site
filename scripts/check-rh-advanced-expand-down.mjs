/**
 * RH 高级设置：展开时壳高下延（不顶着封顶往上挤主区）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

assert.match(eng, /advancedOpen \? contentH : Math\.min\(RH_MAX_BASE_H/);
assert.match(eng, /!advancedOpen && contentH > RH_MAX_BASE_H/);
assert.match(eng, /requestAnimationFrame\(\(\) => scheduleFitRhNodeFrame\(node\)\)/);
assert.match(css, /\.rh-advanced\.is-open/);
assert.match(css, /\.rh-advanced-toggle\.is-open i \{\s*transform:\s*none/);

console.log('OK: advanced open bypasses RH_MAX_BASE_H cap');
console.log('OK: fit scheduled after display frame');
console.log('OK: chevron stays down when open');
console.log('\ncheck-rh-advanced-expand-down: all passed');
