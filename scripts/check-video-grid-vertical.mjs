/**
 * 视频图台展开：与图片生成同款 √n 方阵（不再强制单列竖排）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const start = eng.indexOf('function genStageGridCols');
const end = eng.indexOf('function genStageGridCellWidth');
const body = start >= 0 && end > start ? eng.slice(start, end) : '';

const checks = [
  [!body.includes("node?.type === 'video'"), 'no video-only 1-col branch'],
  [body.includes('Math.ceil(Math.sqrt(n))'), 'uses sqrt grid like image gen'],
  [eng.includes('genStageGridCols(total, node)'), 'render passes node'],
  [eng.includes("node?.type === 'video' ? '条' : '张'"), 'video badge unit 条'],
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
console.log('\ncheck-video-grid-vertical: all passed');
