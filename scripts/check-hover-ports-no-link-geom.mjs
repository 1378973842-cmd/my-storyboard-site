/**
 * 悬停打开端口勿刷连线几何；已有连线端点始终贴边（避免对端节点闪）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const indexCss = fs.readFileSync(path.join(root, 'src/index.css'), 'utf8');
const canvasCss = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const openStart = eng.indexOf('function setNodePortsOpen(');
const openFn = eng.slice(openStart, eng.indexOf('\nfunction ', openStart + 1));
const connStart = eng.indexOf('function portPointForConnection(');
const connFn = eng.slice(connStart, eng.indexOf('\nfunction ', connStart + 1));
const layoutStart = eng.indexOf('function portPointFromLayout(');
const layoutFn = eng.slice(layoutStart, eng.indexOf('\nfunction ', layoutStart + 1));
const pillStart = indexCss.indexOf('.studio-canvas-header-pill {');
const pillEnd = indexCss.indexOf('\n  }', pillStart);
const pillCss = pillStart >= 0 && pillEnd > pillStart ? indexCss.slice(pillStart, pillEnd + 4) : '';
const pillHasBackdrop = /backdrop-filter\s*:/.test(pillCss);
const portDotBlock = canvasCss.match(/\.port-dot\s*\{[\s\S]*?\n\}/)?.[0] || '';

const checks = [
  [openFn.includes('function setNodePortsOpen'), 'setNodePortsOpen exists'],
  [!openFn.includes('scheduleLinkGeometryRefresh'), 'setNodePortsOpen does not refresh link geometry'],
  [connFn.includes('expanded:false'), 'portPointForConnection pins edge'],
  [!/expanded:\s*false\s*\}\s*:\s*\{\s*\}/.test(connFn) && !connFn.includes('flowing ?'), 'no hover-expanded branch for connections'],
  [layoutFn.includes('opts.expanded === false'), 'portPointFromLayout honors expanded:false'],
  [!/const expanded = opts\.expanded === true \|\| nodePortsExpanded/.test(layoutFn), 'no ignore-false OR with nodePortsExpanded'],
  [pillCss.includes('background: #1c1b1b') || pillCss.includes('background:#1c1b1b'), 'header pill solid bg'],
  [!pillHasBackdrop, 'header pill has no backdrop-filter'],
  [!/will-change\s*:/.test(portDotBlock), 'port-dot has no will-change (avoids image flash)'],
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
console.log('\ncheck-hover-ports-no-link-geom: all passed');
