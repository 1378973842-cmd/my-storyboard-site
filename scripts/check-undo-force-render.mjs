/**
 * Ctrl+Z / redo：回滚后必须 force render，避免 DOM 未刷新却已 scheduleSave
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const start = eng.indexOf('function applyCanvasHistoryState(');
const end = eng.indexOf('function performUndo(', start);
const body = eng.slice(start, end);

const saveStart = eng.indexOf('async function saveCanvas(');
const saveHead = eng.slice(saveStart, saveStart + 2200);

const checks = [
  [Boolean(body), 'applyCanvasHistoryState found'],
  [body.includes('render({ force: true })') || body.includes('render({force: true})'), 'undo/redo force render'],
  [body.includes('sanitizeConnections()'), 'undo sanitizes connections'],
  [body.includes('scheduleSave()'), 'undo schedules save'],
  [body.includes('syncGeneratorInputs()'), 'undo syncs generator inputs'],
  [/sanitizeConnections\(\);\s*const savedConnections = connections;/.test(saveHead), 'save uses post-sanitize connections'],
  [eng.includes('undoStack = [];') && eng.includes('redoStack = [];'), 'open canvas clears undo stacks'],
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
console.log('\ncheck-undo-force-render: all passed');
