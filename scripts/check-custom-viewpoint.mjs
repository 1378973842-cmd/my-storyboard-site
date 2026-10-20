/**
 * 自定义视角：菜单取代 3D机位；生成走视角 Agent 英文提示词 + nano-banana-pro。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/InfiniteCanvasShell.tsx'), 'utf8');

function assert(cond, name) {
  if (!cond) {
    console.error('FAIL', name);
    process.exit(1);
  }
  console.log('ok', name);
}

assert(engine.includes('data-novel-view-mode="custom"'), 'menu offers custom viewpoint');
assert(engine.includes('data-novel-view-mode="arrow"'), 'arrow aim stays');
assert(!engine.includes('data-novel-view-mode="orbit"'), '3D orbit is not a menu item');
assert(engine.includes("mode === 'custom' || mode === 'orbit'"), 'leftover orbit clicks open custom');
assert(engine.includes('function openImageCustomViewpoint'), 'open panel');
assert(engine.includes('function runImageCustomViewpointJob'), 'run job');
assert(engine.includes("generatorNanoBananaProModel('runninghub')"), 'model list still includes nano-banana-pro');
assert(engine.includes('data-custom-view-menu="model"') && engine.includes('viewpointImageModel(job.model)') && engine.includes('nano-banana-2.1'), 'custom viewpoint can pick nano-banana-2.1');
assert(engine.includes('data-custom-view-menu="size"') && engine.includes("customViewpointResolution"), 'resolution menu');
assert(engine.includes('data-custom-view-count') && engine.includes('clampCustomViewpointCount'), 'count stepper');
assert(engine.includes('canvas_resolution: resolution'), 'job sends chosen resolution');
assert(engine.includes('Math.min(4,'), 'count cap is 4');
assert(engine.includes("origin === 'custom-viewpoint'"), 'spawn origin');
assert(engine.includes('/api/canvas/viewpoint-agent'), 'job calls viewpoint agent');
assert(engine.includes('ensureDurableCanvasImageUrl(job.url, source?.id)'), 'custom viewpoint uploads blob refs before the agent');
const linkStart = engine.indexOf('function linkCreateOptions');
const linkEnd = engine.indexOf('function openLinkCreateMenu');
assert(linkStart > 0 && linkEnd > linkStart && !engine.slice(linkStart, linkEnd).includes('viewpointAgent'), 'link menu has no viewpoint agent');
assert(!shell.includes('视角 Agent') && !shell.includes('addViewpointAgentNode'), 'shell menu has no viewpoint agent');
assert(css.includes('.image-custom-view-prompt'), 'prompt field css');

const closeStart = engine.indexOf('function closeImageCustomViewpoint');
const closeEnd = engine.indexOf('function wireImageCustomViewpointUi');
assert(closeStart > 0 && closeEnd > closeStart, 'close function exists');
assert(!engine.slice(closeStart, closeEnd).includes('closeImageNovelOrbit'), 'custom close does not call orbit close');

console.log('custom viewpoint checks passed');
