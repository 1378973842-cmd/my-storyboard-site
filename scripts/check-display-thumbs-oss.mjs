import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const gate = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasGateCollections.js'), 'utf8');

function sliceFn(src, name, nextName) {
  const start = src.indexOf(`function ${name}(`);
  const end = nextName ? src.indexOf(`function ${nextName}(`, start + 1) : src.length;
  return start >= 0 && end > start ? src.slice(start, end) : '';
}

const card = sliceFn(eng, 'buildCanvasItemElement', 'renderCanvasListInto');
const output = sliceFn(eng, 'renderOutputMedia', 'outputGridLayout');
const wrap = sliceFn(eng, 'bindOutputWrap', 'outputDomKeyForItem');
const oss = sliceFn(eng, 'bindOssDirectImg', 'uploadItemName');

const checks = [
  [Boolean(card), 'buildCanvasItemElement exists'],
  [Boolean(output), 'renderOutputMedia exists'],
  [Boolean(wrap), 'bindOutputWrap exists'],
  [Boolean(oss) && oss.includes('resolveDisplayMediaUrl'), 'bindOssDirectImg signs display src'],
  [card.includes('canvasThumbUrl(previewUrl)') && card.includes('data-full-src'), 'gate cards use thumb + full-src'],
  [card.includes('bindOssDirectImg'), 'gate cards hydrate OSS'],
  [output.includes('canvasThumbUrl(url)') && output.includes('data-full-src'), 'output grid uses thumb + full-src'],
  [!output.includes('<img src="${safe}" data-url="${safe}"'), 'output grid no longer loads original as src'],
  [wrap.includes('bindOssDirectImg(img)'), 'output wrap hydrates OSS'],
  [gate.includes('function gatePreviewSrc') && gate.includes('data-full-src'), 'collection covers use thumbs'],
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
  console.error(`\ncheck-display-thumbs-oss: ${failed} failed`);
  process.exit(1);
}
console.log('\ncheck-display-thumbs-oss: all passed');
