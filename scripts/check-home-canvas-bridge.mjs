/**
 * Self-check: home canvas bridge + home carousel modules exist with expected APIs.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8');
}

const bridgeSrc = read('src/lib/homeCanvasBridge.ts');
assert.match(bridgeSrc, /export async function createAndOpenCanvas/);
assert.match(bridgeSrc, /export async function openExistingCanvas/);
assert.match(bridgeSrc, /export async function fetchRecentCanvases/);
assert.match(bridgeSrc, /新建画布/);

const apiSrc = read('src/lib/homeCarouselApi.ts');
assert.match(apiSrc, /export async function fetchHomeCarousel/);
assert.match(apiSrc, /export async function addHomeCarouselItem/);
assert.match(apiSrc, /export async function deleteHomeCarouselItem/);

const svcSrc = read('src/services/homeCarousel.ts');
assert.match(svcSrc, /\/api\/home-carousel/);
assert.match(svcSrc, /\/api\/admin\/home-carousel\/upload/);
assert.match(svcSrc, /app\.put\("\/api\/admin\/home-carousel"/);
assert.match(svcSrc, /initHomeCarouselSchema/);
assert.match(svcSrc, /registerHomeCarouselRoutes/);

const stripSrc = read('src/components/HomeCarouselStrip.tsx');
assert.match(stripSrc, /VISIBLE = 3/);
assert.match(stripSrc, /GAP_PX/);
assert.match(stripSrc, /setCardW\(\(w - GAP_PX \* \(VISIBLE - 1\)\) \/ VISIBLE\)/);
assert.match(stripSrc, /精选推荐/);
const cssSrc = read('src/index.css');
assert.match(cssSrc, /aspect-ratio: 16 \/ 9/);
assert.match(cssSrc, /cover-home-carousel-shell/);
assert.equal(cssSrc.includes('100cqi'), false);

const serverSrc = read('server.ts');
assert.match(serverSrc, /initHomeCarouselSchema/);
assert.match(serverSrc, /registerHomeCarouselRoutes/);

console.log('check-home-canvas-bridge: ok');
