/**
 * AG261c / AG262c / AG262qa：重绘菜单 + 蒙版重绘（Qwen Edit RH 工作流）自检
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');
const uploadRoute = fs.readFileSync(path.join(root, 'src/services/runningHubWorkflows.ts'), 'utf8');

const checks = [
  [/data-action="repaint"/, engine, 'repaint action button'],
  [/data-repaint-mode="mask"/, engine, 'mask menu item'],
  [/data-repaint-mode="crop"/, engine, 'crop menu item'],
  [/function openImageMaskRepaint/, engine, 'openImageMaskRepaint'],
  [/function runImageMaskRepaintJob/, engine, 'runImageMaskRepaintJob'],
  [/function composeMaskRepaintTransparentPng/, engine, 'transparent composite'],
  [/RUNNINGHUB_MASK_REPAINT_WORKFLOW_ID\s*=\s*'2029197668701970433'/, engine, 'qwen edit workflow id'],
  [/RUNNINGHUB_MASK_REPAINT_IMAGE_FIELD[\s\S]{0,80}nodeId:\s*'13'/, engine, 'loadimage node 13'],
  [/RUNNINGHUB_MASK_REPAINT_TEXT_FIELD[\s\S]{0,80}nodeId:\s*'15'/, engine, 'crtext node 15'],
  [/\/api\/runninghub\/v2\/run-workflow/, engine, 'v2 run-workflow submit'],
  [/editOrigin\s*=\s*'repaint'/, engine, 'repaint editOrigin'],
  [/Mask repaint|蒙版重绘/, engine, 'mask-repaint label'],
  [/function ensureMaskRepaintCompareBaseline/, engine, 'ensureMaskRepaintCompareBaseline'],
  [/\/api\/canvas\/edit-compare-baseline/, engine, 'edit-compare-baseline API'],
  [/version:\s*'2'/, engine, 'rh query version 2'],
  [/\.image-repaint-menu\b/, css, 'menu css'],
  [/\.image-repaint-top-dock\b/, css, 'top dock css'],
  [/\.image-repaint-mask-canvas\b/, css, 'mask canvas css'],
];

// 蒙版重绘须走 Qwen Edit 工作流，不再走 gpt expand_outpaint / 贴回补丁
if (/function stitchMaskRepaintOntoSource/.test(engine)) {
  console.error('FAIL', 'stitch fallback must be removed');
  process.exit(1);
}
if (/mask\.png['"]\s*,\s*role:\s*['"]mask['"]/.test(engine)) {
  console.error('FAIL', 'repaint must not submit separate mask role');
  process.exit(1);
}
if (!/async function runImageMaskRepaintJob[\s\S]{0,2500}RUNNINGHUB_MASK_REPAINT_WORKFLOW_ID/.test(engine)) {
  console.error('FAIL', 'repaint job must submit qwen edit workflow');
  process.exit(1);
}

// LoadImage 必须 fileName（rhUploadValueIfNeeded），禁止误用 download_url（会丢 alpha / 非 LoadImage 语义）
const jobSlice = engine.match(/async function runImageMaskRepaintJob[\s\S]{0,2200}/);
if (!jobSlice || !/rhUploadValueIfNeeded\s*\(/.test(jobSlice[0])) {
  console.error('FAIL', 'mask repaint must upload via rhUploadValueIfNeeded (fileName for LoadImage)');
  process.exit(1);
}
if (/async function runImageMaskRepaintJob[\s\S]{0,2200}rhUploadImageDownloadUrl/.test(engine)) {
  console.error('FAIL', 'mask repaint must not use rhUploadImageDownloadUrl for LoadImage');
  process.exit(1);
}

// 软 alpha：禁止硬阈值 ma > 8 打洞
if (/composeMaskRepaintTransparentPng[\s\S]{0,1200}ma\s*>\s*8/.test(engine)) {
  console.error('FAIL', 'compose must not hard-punch mask with ma > 8');
  process.exit(1);
}
if (!/composeMaskRepaintTransparentPng[\s\S]{0,1600}strength/.test(engine)) {
  console.error('FAIL', 'compose must map brush alpha to soft PNG alpha');
  process.exit(1);
}

// upload-asset 路径不得 flatten alpha（蒙版 PNG 依赖透明通道）
if (/upload-asset[\s\S]{0,800}flattenAlpha/.test(uploadRoute)) {
  console.error('FAIL', 'upload-asset must not flatten alpha');
  process.exit(1);
}
console.log('ok mask LoadImage uses fileName + soft alpha; upload-asset keeps alpha');

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
  console.error(`image-repaint-menu check failed: ${failed}`);
  process.exit(1);
}
console.log('image-repaint-menu check passed');
