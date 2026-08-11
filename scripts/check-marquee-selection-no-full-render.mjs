/**
 * 框选松手只刷选中态，禁止整板 render（否则后续节点 DOM 重建会闪）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const start = eng.indexOf('function finishSelection(');
if(start < 0){
    console.error('FAIL: finishSelection missing');
    process.exit(1);
}
const end = eng.indexOf('\nfunction ', start + 1);
const fn = eng.slice(start, end > start ? end : start + 1200);

const checks = [
  [fn.includes('refreshSelectionVisuals()'), 'finishSelection refreshes selection visuals'],
  [!/\brender\s*\(/.test(fn), 'finishSelection does not call full render()'],
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
console.log('\ncheck-marquee-selection-no-full-render: all passed');
