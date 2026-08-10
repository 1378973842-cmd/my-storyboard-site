/**
 * RH 生图/生视频记录用时：落盘 runMs、输出角标、成片库 params.run_ms
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [eng.includes('return {url, kind, runMs}'), 'RH outputs keep runMs'],
  [eng.includes('runMs ? {url, kind, runMs}'), 'mergeGeneratedOutputs keeps runMs'],
  [eng.includes('recordRhOutputsToHistoryLibrary(outputs, run, node, runMs)'), 'library record gets runMs'],
  [eng.includes('run_ms:itemMs'), 'params.run_ms written'],
  [eng.includes('rh-output-duration'), 'output duration pill'],
  [eng.includes('history-library-card-duration'), 'library duration badge'],
  [eng.includes('用时 ${formatRunDuration(runMs)}') || eng.includes('Took'), 'status shows duration'],
  [css.includes('.rh-output-duration'), 'duration css'],
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
console.log('\ncheck-rh-run-duration: all passed');
