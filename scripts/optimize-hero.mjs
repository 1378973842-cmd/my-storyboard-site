/** 一次性：把 public/cover-hero-candidate-* 压成网页可用的 2560px JPG。 */
import sharp from 'sharp';
import { readdirSync, statSync } from 'fs';
import path from 'path';

const pub = path.resolve('public');
const candidates = readdirSync(pub).filter((f) => f.startsWith('cover-hero-candidate-'));

for (const f of candidates) {
  const n = f.match(/candidate-(\d)/)?.[1];
  const out = path.join(pub, `cover-hero-option-${n}.jpg`);
  await sharp(path.join(pub, f))
    .resize({ width: 2560, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(out);
  console.log(`${f} -> cover-hero-option-${n}.jpg (${Math.round(statSync(out).size / 1024)} KB)`);
}
