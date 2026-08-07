/**
 * 生图 count=2 不应只落 1 张：同步 dock 数量；多张 appendGenerated
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const syncStart = eng.indexOf('function syncGeneratorDockFieldsIntoNode');
const syncFn = eng.slice(syncStart, eng.indexOf('async function runGenerator(', syncStart));
const singleStart = eng.indexOf('async function runGeneratorSingle');
const singleFn = eng.slice(singleStart, eng.indexOf('async function runGeneratorBatchParallel', singleStart));
const videoStart = eng.indexOf('async function runVideoNode');
const videoFn = eng.slice(videoStart, eng.indexOf('async function uploadCanvasUrlToComfy', videoStart));

const checks = [
  [syncFn.includes("querySelector('.gen-dock-count-input')"), 'dock sync reads count input'],
  [syncFn.includes('gen.count = Math.max(1, Math.min(8'), 'dock sync writes node.count'],
  [singleFn.includes('const appendGenerated = count > 1 || Boolean(opts.appendGenerated)'), 'multi-count appendGenerated'],
  [singleFn.includes('appendGenerated,'), 'pending uses appendGenerated var'],
  [eng.includes("countInput.oninput = e => {\n            e.stopPropagation();\n            applyCount(e.target.value);\n        };"), 'count oninput binds'],
  [videoFn.includes('syncGeneratorDockFieldsIntoNode(node)'), 'video run syncs dock count'],
  [eng.includes("appendGenerated: count > 1 || Boolean(opts.cascade)"), 'video already appends on multi'],
];

let failed = 0;
for(const [ok, label] of checks){
  if(!ok){
    console.error('FAIL:', label);
    failed++;
  } else console.log('OK:', label);
}
if(failed){
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncheck-gen-count-multi: all passed');
