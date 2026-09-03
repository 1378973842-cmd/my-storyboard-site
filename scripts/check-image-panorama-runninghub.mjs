/**
 * AG268c：全景图（RunningHub v2 AI 应用 → 新节点 360 VR 预览）
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  PANO_FOV_DEFAULT,
  PANO_FOV_MAX,
  PANO_FOV_MIN,
  PANO_PITCH_MAX,
  PANO_PREVIEW_ASPECT,
  clampPanoCamera,
  panoAspectToCss,
} from '../src/lib/infiniteCanvas/panoramaSphereView.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

function assert(cond, name) {
  if (!cond) {
    console.error('FAIL', name);
    process.exit(1);
  }
  console.log('ok', name);
}

assert(panoAspectToCss('21:9') === '21 / 9', '21:9 → css');
assert(panoAspectToCss('16:9') === '16 / 9', '16:9 → css');
assert(PANO_PREVIEW_ASPECT === '16:9', 'preview observe 16:9');
assert(panoAspectToCss('') === '21 / 9', 'empty aspect fallback');
assert(clampPanoCamera({ pitch: 200 }).pitch === PANO_PITCH_MAX, 'pitch clamp max');
assert(clampPanoCamera({ pitch: -200 }).pitch === -PANO_PITCH_MAX, 'pitch clamp min');
assert(clampPanoCamera({ fov: 10 }).fov === PANO_FOV_MIN, 'fov clamp min');
assert(clampPanoCamera({ fov: 200 }).fov === PANO_FOV_MAX, 'fov clamp max');
assert(clampPanoCamera({}).fov === PANO_FOV_DEFAULT, 'default fov');

const checks = [
  [/data-action="panorama"/, engine, 'action bar panorama button'],
  [/data-action="pano-capture"/, engine, 'pano screenshot'],
  [/data-action="pano-reset"/, engine, 'pano reset'],
  [/data-action="pano-fs"/, engine, 'pano fullscreen'],
  [/RUNNINGHUB_PANORAMA_APP_ID\s*=\s*'2047927552609624065'/, engine, 'app id'],
  [/RUNNINGHUB_PANORAMA_IMAGE_FIELD[\s\S]{0,80}nodeId:\s*'4'/, engine, 'image node 4'],
  [/aspectRatio:\s*'21:9'/, engine, 'default 21:9'],
  [/quality:\s*'medium'/, engine, 'default medium'],
  [/resolution:\s*'4k'/, engine, 'default 4k'],
  [/\/api\/runninghub\/v2\/run-ai-app/, engine, 'v2 run-ai-app'],
  [/function openImagePanorama/, engine, 'openImagePanorama'],
  [/function runImagePanoramaJob/, engine, 'runImagePanoramaJob'],
  [/rhUploadValueIfNeeded\s*\([^)]*'2'/, engine, 'v2 fileName upload'],
  [/editOrigin\s*=\s*'panorama'/, engine, 'panorama editOrigin'],
  [/kind === 'panorama'/, engine, 'normalize panorama origin'],
  [/function mountPanoramaPreview/, engine, 'mountPanoramaPreview'],
  [/function openPanoramaFullscreen/, engine, 'openPanoramaFullscreen'],
  [/function capturePanoramaStill/, engine, 'capturePanoramaStill'],
  [/from '\.\/panoramaSphereView\.js'/, engine, 'imports panorama module'],
  [/version:\s*'2'/, engine, 'rh query version 2'],
  [/if\(imagePanoramaState\) positionImagePanoramaOverlay\(\)/, engine, 'applyViewport tracks panorama overlay'],
  [/await prepareImageEditCanvasFocus\(node\.id, 'panorama'\)[\s\S]{0,400}beginImageExpandOpenFade|await prepareImageEditCanvasFocus\(node\.id, 'panorama'\)[\s\S]{0,280}is-image-expand-source/, engine, 'dock after viewport focus'],
  [/function setPanoramaPreviewLive/, engine, 'toggle live preview'],
  [/data-pano-mode="exit"/, engine, 'exit panorama preview'],
  [/data-pano-mode="enter"/, engine, 'enter panorama preview'],
  [/function panoramaLiveLayoutSize/, engine, '16:9 live layout'],
  [/_panoPreview = true/, engine, 'spawn starts in live preview'],
  [/\.pano-stage\b/, css, 'pano stage css'],
  [/\.pano-fs-host\b/, css, 'fullscreen css'],
  [/\.pano-corner\b/, css, 'corner enter/exit'],
  [/\.image-action-bar-btn-text[\s\S]{0,200}data-pano-mode="exit"|image-action-bar-btn-text" data-pano-mode="exit"/, engine, 'exit inside action bar'],
  [/\.is-image-expand-source \.image-preview-wrap img/, css, 'hide source img during overlay'],
];

if (/async function runImagePanoramaJob[\s\S]{0,1800}rhUploadImageDownloadUrl/.test(engine)) {
  console.error('FAIL', 'panorama must use fileName upload, not download_url');
  process.exit(1);
}

let failed = 0;
for (const [re, src, name] of checks) {
  if (!re.test(src)) {
    console.error('FAIL', name);
    failed += 1;
  } else {
    console.log('ok', name);
  }
}
if (failed) {
  console.error(`image-panorama-runninghub check failed: ${failed}`);
  process.exit(1);
}
console.log('image-panorama-runninghub check passed');
