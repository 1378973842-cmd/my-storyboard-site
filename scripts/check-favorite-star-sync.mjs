import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const toggleStart = eng.indexOf('async function toggleFavoriteForUrl');
const toggleEnd = eng.indexOf('\nfunction generatorHistoryLightboxSource', toggleStart);
const toggle = toggleStart >= 0 && toggleEnd > toggleStart ? eng.slice(toggleStart, toggleEnd) : '';

const checks = [
  [eng.includes('function syncFavoriteButtonsForUrl') && eng.includes('favoriteUrlAliases'), 'scoped favorite star sync'],
  [toggle.includes('syncFavoriteButtonsForUrl') && !toggle.includes('syncOutputFavoriteButtons()'), 'toggle no longer full-board star sync'],
  [!toggle.includes('refreshIcons'), 'toggle does not recreate lucide icons'],
  [eng.includes('if(scope instanceof Element) refreshIcons(scope);'), 'unscoped sync skips lucide.createIcons'],
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
  console.error(`\ncheck-favorite-star-sync: ${failed} failed`);
  process.exit(1);
}
console.log('\ncheck-favorite-star-sync: all passed');
