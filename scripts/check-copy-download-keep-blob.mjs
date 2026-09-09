import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

function sliceFn(src, name, nextName) {
  const start = src.indexOf(`function ${name}(`);
  const end = nextName ? src.indexOf(`function ${nextName}(`, start + 1) : src.length;
  return start >= 0 && end > start ? src.slice(start, end) : '';
}

const fetchBlob = sliceFn(eng, 'fetchDisplayMediaBlob', 'uploadItemName');
const copy = sliceFn(eng, 'copyImageUrlToClipboard', 'blobToPngClipboardBlob');
const download = sliceFn(eng, 'downloadUrl', 'syncOutputCompareBtn');
const upload = sliceFn(eng, 'uploadMediaFiles', 'uploadImages');
const fill = sliceFn(eng, 'fillImageNode', 'setImageNodeFromOutput');
const batch = sliceFn(eng, 'uploadImagesToImageBatch', 'bindImageBatchUpload');
const imgThenStart = upload.indexOf('if(imageFiles.length)');
const videoThenStart = upload.indexOf('if(videoFiles.length)');
const imgThen = imgThenStart >= 0 && videoThenStart > imgThenStart
  ? upload.slice(imgThenStart, videoThenStart)
  : '';

const checks = [
  [Boolean(fetchBlob) && fetchBlob.includes('resolveDisplayMediaUrl'), 'fetchDisplayMediaBlob uses signed URL'],
  [!fetchBlob.includes('_previewObjectUrl') && !fetchBlob.includes('livePreviewBlobUrl'), 'copy/download ignore display JPEG preview blob'],
  [copy.includes('fetchDisplayMediaBlob') && copy.includes("ClipboardItem({ 'image/png': pngPromise })"), 'copy writes ClipboardItem promise via signed/blob fetch'],
  [download.includes('fetchDisplayMediaBlob'), 'downloadUrl uses fetchDisplayMediaBlob'],
  [!download.includes('await fetch(url)'), 'downloadUrl no longer fetch(raw url)'],
  [Boolean(imgThen) && imgThen.includes('swapCanvasBlobMediaUrl'), 'drag-in images keep blob via swapCanvasBlobMediaUrl'],
  [Boolean(imgThen) && !imgThen.includes('refreshNodes'), 'drag-in images do not refreshNodes after upload'],
  [fill.includes('swapCanvasBlobMediaUrl') && !fill.includes('refreshNodes([nodeId])'), 'fillImageNode keeps blob'],
  [batch.includes('swapCanvasBlobMediaUrl') && !/refreshNodes\(\[batch\.id\]\)/.test(batch.slice(batch.indexOf('uploaded.forEach'))), 'image batch upload keeps blob'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`OK: ${label}`);
  else {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) {
  console.error(`\ncheck-copy-download-keep-blob: ${failed} failed`);
  process.exit(1);
}
console.log('\ncheck-copy-download-keep-blob: all passed');
