import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

assert.ok(existsSync(join(root, 'public/brand-logo.png')), 'missing public/brand-logo.png');
const mp4 = join(root, 'public/brand-boot-splash.mp4');
assert.ok(existsSync(mp4), 'missing public/brand-boot-splash.mp4');
assert.ok(statSync(mp4).size > 100_000, 'brand-boot-splash.mp4 too small');

const splash = readFileSync(join(root, 'src/components/InfiniteCanvas/CanvasBootSplash.tsx'), 'utf8');
assert.match(splash, /BRAND_BOOT_SPLASH_SRC/);
assert.match(splash, /createPortal/);
assert.match(splash, /onCanDismiss/);
assert.match(splash, /onEnded/);
assert.doesNotMatch(splash, /canvasReady/);

const host = readFileSync(join(root, 'src/components/InfiniteCanvas/InfiniteCanvas.tsx'), 'utf8');
assert.match(host, /CanvasBootSplash/);
assert.match(host, /isDocumentReload/);
assert.doesNotMatch(host, /splashCanvasReady/);
assert.match(host, /onCanDismiss=\{dismissBootSplash\}/);

const css = readFileSync(join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');
assert.match(css, /\.canvas-boot-splash-video/);
assert.match(css, /position:\s*fixed/);

console.log('check-canvas-boot-splash: ok');
