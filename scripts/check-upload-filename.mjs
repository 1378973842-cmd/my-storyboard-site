/**
 * 自检：上传文件名 Latin-1 → UTF-8 还原，避免拖入画布中文名乱码
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const routes = fs.readFileSync(path.join(root, 'src/services/infiniteCanvasRoutes.ts'), 'utf8');
const util = fs.readFileSync(path.join(root, 'src/lib/decodeUploadFilename.ts'), 'utf8');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const checks = [
  [util.includes('Buffer.from(raw, "latin1")') || util.includes("Buffer.from(raw, 'latin1')"), 'latin1→utf8 repair'],
  [routes.includes('decodeUploadFilename'), 'routes uses decodeUploadFilename'],
  [eng.includes('supported[i]?.name || file.name'), 'upload prefers browser File.name'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}

// 逻辑镜像（与 decodeUploadFilename 同启发式）
function decodeUploadFilename(name) {
  const raw = String(name ?? '').trim();
  if (!raw) return '';
  if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(raw)) return raw;
  if (/[\u00C0-\u00FF]/.test(raw)) {
    const repaired = Buffer.from(raw, 'latin1').toString('utf8');
    if (repaired && !repaired.includes('\uFFFD') && /[\u4e00-\u9fff]/.test(repaired)) return repaired;
  }
  return raw;
}

const sample = '测试图片.png';
const mojibake = Buffer.from(sample, 'utf8').toString('latin1');
const fixed = decodeUploadFilename(mojibake);
if (fixed !== sample) {
  console.error(`FAIL: repair expected "${sample}", got "${fixed}"`);
  failed += 1;
}
if (decodeUploadFilename(sample) !== sample) {
  console.error('FAIL: already-good CJK should pass through');
  failed += 1;
}

if (failed) process.exit(1);
console.log('check-upload-filename: ok');
