/**
 * 节点 / 连线层级：连线在下；拖动节点抬高
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const linksBlock = css.match(/\.links\s*\{[^}]+\}/);
const linksDragBlock = css.match(/\.links\.is-dragging-link\s*\{[^}]+\}/);
const linksZ = linksBlock?.[0]?.match(/z-index\s*:\s*(\d+)/)?.[1];
const linksDragZ = linksDragBlock?.[0]?.match(/z-index\s*:\s*(\d+)/)?.[1];

const checks = [
  [Number(linksZ) <= 1, `links z-index below nodes (got ${linksZ})`],
  [Number(linksDragZ) <= 1, `temp-link drag keeps links below nodes (got ${linksDragZ})`],
  [css.includes('连线永远在节点下方'), 'links-below comment'],
  [!css.includes('连线盖在节点之上'), 'old links-above comment removed'],
  [css.includes('.infinite-canvas-root.canvas-node-drag .node.selected') && css.includes('z-index:12'), 'selected drag raise'],
  [css.includes('.infinite-canvas-root.canvas-node-drag .node.is-dragging') && css.includes('z-index:14'), 'is-dragging raise'],
  [eng.includes('function setDragNodesRaised'), 'raise helper'],
  [eng.includes('function clearAllDragRaisedNodes'), 'clear helper'],
  [eng.includes('setDragNodesRaised(dragNode, true)'), 'raise on drag chrome'],
  [eng.includes('clearAllDragRaisedNodes()'), 'clear on end/reset'],
];

let failed = 0;
for(const [ok, label] of checks){
  if(!ok){
    console.error('FAIL:', label);
    failed++;
  } else {
    console.log('OK:', label);
  }
}
if(failed){
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncheck-node-link-stacking: all passed');
