import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

function sliceFn(name, nextName) {
  const start = eng.indexOf(`function ${name}(`);
  const end = nextName ? eng.indexOf(`function ${nextName}(`, start + 1) : eng.length;
  return start >= 0 && end > start ? eng.slice(start, end) : '';
}

const media = sliceFn('genStageMediaHtml', 'formatGenStageVideoTime');
const thumb = sliceFn('genStageThumbHtml', 'genStageTileAspectCss');

const checks = [
  [Boolean(media), 'genStageMediaHtml exists'],
  [Boolean(thumb), 'genStageThumbHtml exists'],
  [media.includes('loading="eager"') && media.includes('decoding="sync"'), 'stage media loads eager/sync'],
  [!media.includes('loading="lazy"') && !media.includes('decoding="async"'), 'stage media is not lazy/async'],
  [thumb.includes('loading="eager"') && thumb.includes('decoding="sync"'), 'stage thumb loads eager/sync'],
  [!thumb.includes('loading="lazy"') && !thumb.includes('decoding="async"'), 'stage thumb is not lazy/async'],
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
  console.error(`\ncheck-gen-stage-eager-image: ${failed} failed`);
  process.exit(1);
}
console.log('\ncheck-gen-stage-eager-image: all passed');
