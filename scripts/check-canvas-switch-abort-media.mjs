import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const checks = [
  [eng.includes('function abortCanvasMediaLoads') && eng.includes('canvasMediaEpoch'), 'abort media + epoch'],
  [eng.includes('function scheduleImageFitGeometry'), 'throttled image-fit geometry'],
  [eng.includes('abortCanvasMediaLoads();') && eng.includes('async function openCanvas'), 'openCanvas aborts old media first'],
  [eng.includes('async function returnToCanvasManager') && eng.includes('abortCanvasMediaLoads'), 'return-to-manager aborts media'],
  [!eng.includes('while((savingCanvasNow || saveCanvasAgain || localCanvasDirty) && guard < 40)'), 'switch no longer waits on save loop'],
  [eng.includes('if(fitEpoch !== canvasMediaEpoch) return'), 'stale image onload ignored'],
  [eng.includes('scheduleImageFitGeometry();') && !eng.includes('loadedImg.onload = () => {\n                    fitImageNodeToNaturalAspect(node, el, loadedImg);\n                    refreshGeometryAfterLayout();'), 'onload no longer full-board refreshGeometryAfterLayout'],
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
  console.error(`\ncheck-canvas-switch-abort-media: ${failed} failed`);
  process.exit(1);
}
console.log('\ncheck-canvas-switch-abort-media: all passed');
