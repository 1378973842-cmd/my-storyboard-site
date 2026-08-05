/**
 * 连线删钮：媒体节点遮挡，避免线从图片底下穿过时误出剪刀
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const checks = [
  [eng.includes('LINK_HOVER_MEDIA_OCCLUDER_TYPES'), 'media occluder type set'],
  [eng.includes('function isWorldPointOccludedByMediaNode'), 'world-point media occlusion'],
  [eng.includes('function isLinkHoverOccluded'), 'combined link hover occlusion'],
  [eng.includes("isWorldPointOccludedByMediaNode(hit)"), 'reject hits under media nodes'],
  [eng.includes('!isLinkHoverOccluded(e.clientX, e.clientY, point, hit)'), 'follow-path respects occlusion'],
  [!eng.includes('能量流动时：跳过昂贵的 elementsFromPoint，只靠几何命中'), 'must not skip occlusion while energy flowing'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) process.exit(1);
console.log('ok: link hover occlusion checks passed');
