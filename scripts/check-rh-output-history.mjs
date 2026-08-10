/**
 * RH 结果追加历史 + 登记成片库 / 本板日志
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const gen = fs.readFileSync(path.join(root, 'src/services/canvasGenerations.ts'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [eng.includes('appendGenerated:true'), 'RH commit appends generatedOutputs'],
  [eng.includes('recordRhOutputsToHistoryLibrary'), 'records to history library helper'],
  [eng.includes("'/api/canvas-generations'"), 'POSTs canvas-generations'],
  [eng.includes("run?.nodeType === 'rh') return 'RunningHub'"), 'RH platform label in board logs'],
  [eng.includes('rh-output-history'), 'history nav UI'],
  [eng.includes('node.previewIndex = Math.max(0, (node.generatedOutputs || []).length - 1)'), 'preview jumps to latest'],
  [gen.includes('app.post("/api/canvas-generations"'), 'POST /api/canvas-generations route'],
  [css.includes('.rh-output-history'), 'history nav css'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error('FAIL:', label);
    failed++;
  } else console.log('OK:', label);
}
if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncheck-rh-output-history: all passed');
