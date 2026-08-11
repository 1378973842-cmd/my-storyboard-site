/**
 * 框组/图片组：壳外左上浮标；框组顶边包住子图浮标；默认底更可辨
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const fitStart = eng.indexOf('function fitGroupFrameToChildren(');
const fitFn = eng.slice(fitStart, eng.indexOf('\nfunction ', fitStart + 1));

const shellStart = eng.indexOf('function groupShellFloatTitleHtml(');
const shellFn = eng.slice(shellStart, eng.indexOf('\nfunction ', shellStart + 1));

const checks = [
  [eng.includes('function groupShellFloatTitleHtml'), 'groupShellFloatTitleHtml exists'],
  [eng.includes("node.type === 'imageBatch'") && eng.includes('is-image-batch-shell'), 'imageBatch uses shell float class'],
  [eng.includes('FRAME_GROUP_PAD_TOP = 56'), 'frame top pad covers float titles'],
  [fitFn.includes('FRAME_GROUP_PAD_TOP'), 'fitGroupFrame uses top pad'],
  [css.includes('rgba(72,72,78,.22)'), 'frame group more transparent'],
  [css.includes('.group-node,\n.imageBatch-node {\n  cursor:grab') || /group-node[\s\S]{0,80}cursor:\s*grab/.test(css), 'group shells use grab (palm) cursor'],
  [css.includes('group-member') && /group-member[\s\S]{0,40}cursor:\s*default/.test(css), 'group members keep default cursor'],
  [/canvas-node-drag[\s\S]{0,120}group-node\.is-dragging[\s\S]{0,80}cursor:\s*grabbing/.test(css), 'dragging group uses grabbing'],
  [css.includes('.group-shell-float-title'), 'shell float title styles'],
  [/group\.type === 'imageBatch'\) return 0/.test(eng) || eng.includes("group.type === 'group' || group.type === 'imageBatch') return 0"), 'imageBatch head inset is 0'],
  [shellFn.includes('新建组') && !shellFn.includes('data-lucide') && !shellFn.includes('group-shell-float-delete'), 'shell float text-only new group'],
  [css.includes('.node.group-member.is-dragging') && css.includes('z-index:15'), 'drag keeps members above shell'],
  [css.includes('.theme-dark .group-node') && /group-node[\s\S]{0,280}backdrop-filter:\s*none/.test(css), 'frame group backdrop-filter none'],
  [/group-node\.selected:not\(\.is-dragging\)[\s\S]{0,400}z-index:\s*0\s*!important/.test(css), 'selected frame group stays under nodes'],
  [/imageBatch-node\.selected:not\(\.is-dragging\)[\s\S]{0,400}z-index:\s*0\s*!important/.test(css), 'selected imageBatch stays under members'],
  [/uniqueMembers\.forEach\(syncNodeGroupMemberClass\)[\s\S]{0,200}commitStructureDomPatch\(\{\s*addedIds:\s*needMount/.test(eng), 'group members class before shell mount'],
  [/node\.type === 'group'[\s\S]{0,180}insertBefore\(fresh,\s*nodesEl\.firstChild\)/.test(eng), 'frame group DOM prepended'],
  [/node\.type === 'imageBatch'[\s\S]{0,120}insertBefore\(fresh,\s*nodesEl\.firstChild\)/.test(eng), 'imageBatch DOM prepended'],
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
console.log('\ncheck-group-shell-float-title: all passed');
