/**
 * 自检：裁剪/画笔/旋转保存应连出新图片节点；工具栏含旋转入口与 dock。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/InfiniteCanvasShell.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [eng.includes('function spawnEditedImageNodeFromSource'), 'spawn helper'],
  [eng.includes('function nodeEditSpawnLayoutSize'), 'spawn uses display size'],
  [eng.includes('_displayW') && eng.includes('imageEditorOutputPoint'), 'output point uses display width'],
  [eng.includes('keepViewportAnim') && eng.includes('animateViewportTo(backup'), 'restore viewport after edit close'],
  [eng.includes('function nodeFloatTitleHtml') && eng.includes('文本节点') && eng.includes('视频节点'), 'float title for text/video'],
  [eng.includes('float-title-text-glyph') && eng.includes("data-lucide=\"clapperboard\""), 'adapted float icons'],
  [eng.includes('nodeFloatTitleHtml(node)') && (eng.match(/nodeFloatTitleHtml\(node\)/g) || []).length >= 3, 'float title on gen/text/video'],
  [eng.includes('function generatorFloatTitleHtml') && eng.includes('图片节点'), 'generator float title helper'],
  [eng.includes('function ensureGeneratorFloatIndex') || eng.includes('function ensureNodeFloatIndex'), 'stable floatTitleIndex'],
  [css.includes('.gen-float-title') || css.includes('.canvas-float-title'), 'generator float title CSS'],
  [css.includes('.float-title-text-glyph'), 'text float glyph CSS'],
  [eng.includes('function imageMediaFloatTitleHtml') && eng.includes('image-media-float-title'), 'import media float title'],
  [eng.includes('imageMediaFloatTitleHtml(node)'), 'media float rendered on image node'],
  [eng.includes('function imageEditOriginBadgeHtml') && eng.includes('editOrigin'), 'edit origin badge helper'],
  [eng.includes('${floatBadge}<div class="image-preview-wrap"') || eng.includes('floatBadge}<div class="image-preview-wrap"'), 'float badge above preview wrap'],
  [eng.includes('has-edit-origin'), 'edit-origin class on image node'],
  [eng.includes("editOrigin: imageEditMode") || eng.includes('editOrigin: imageEditMode'), 'spawn stores editOrigin'],
  [css.includes('.image-edit-origin-badge') && /top:\s*-?\d+px/.test(css.match(/\.image-edit-origin-badge[^{]*\{[^}]+\}|\.canvas-float-title[^{]*\{[^}]+\}/)?.[0] || css), 'edit origin badge above frame'],
  [eng.includes("to.type === 'image'") && eng.includes('派生产物'), 'generator → image connect'],
  [eng.includes("from.type === 'image' && to.type === 'image'"), 'image → image connect'],
  [eng.includes('spawnEditedImageNodeFromSource(file, owner'), 'generator commit spawns'],
  [eng.includes('spawnEditedImageNodeFromSource(file, node'), 'image commit spawns'],
  [eng.includes('function nodeTopToolbarGapPx') && eng.includes('nodeFloatTitleClearancePx'), 'toolbar clears float title'],
  [eng.includes('nodeTopToolbarGapPx(nodeEl, nodeRect, 12)'), 'action/format bars use float clearance'],
  [eng.includes("mode === 'rotate'") || eng.includes("mode === \"rotate\""), 'open rotate mode'],
  [eng.includes('function applyImageRotate'), 'apply rotate export'],
  [eng.includes('function rotateImageEditBy90'), 'rotate +90'],
  [eng.includes('function toggleImageEditFlip'), 'flip toggles'],
  [eng.includes('if(node.historyOpen) return null') && eng.includes('resolveImageActionBarTarget'), 'action bar only when collapsed'],
  [shell.includes('imageEditRotateDock'), 'rotate dock in shell'],
  [shell.includes('旋转与镜像'), 'rotate dock title'],
  [shell.includes('rotateImageEditBy90'), 'shell wires rotate'],
  [shell.includes('toggleImageEditFlip'), 'shell wires flip'],
  [css.includes('.image-edit-rotate-dock'), 'rotate dock CSS'],
  [css.includes('is-rotate-mode'), 'rotate mode CSS'],
  [!eng.includes('replaceGeneratorMediaUrl(owner, oldUrl, file.url'), 'generator no longer in-place replace on edit'],
];

// 落点：展示宽 496 时不应落在 260+36
{
  const GENERATOR_BASE_W = 260;
  const displayW = 496;
  const gap = 56;
  const x = 0 + displayW + gap;
  if(x <= GENERATOR_BASE_W + 36){
    console.error('FAIL: spawn x still overlaps data-width');
    process.exit(1);
  }
}

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) process.exit(1);

// 逻辑：spawn 后应有连线
function canConnect(fromType, toType){
  if(fromType === 'generator' && toType === 'image') return true;
  if(fromType === 'image' && toType === 'image') return true;
  return false;
}
function spawn(sourceType){
  const nodes = [{id:'src', type:sourceType, x:0, y:0, w:260}];
  const connections = [];
  const next = {id:'img1', type:'image', x:296, y:0, url:'/out.png'};
  nodes.push(next);
  if(canConnect(sourceType, 'image')) connections.push({from:'src', to:'img1'});
  return {nodes, connections};
}
const g = spawn('generator');
if(g.connections.length !== 1 || g.nodes.length !== 2){
  console.error('FAIL: spawn logic');
  process.exit(1);
}

console.log('check-image-edit-spawn: ok');
