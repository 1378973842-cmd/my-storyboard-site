/**
 * 文本节点（原 prompt）：图台编辑 + 格式栏 + LLM dock；下游仍读纯文本
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');
const i18n = fs.readFileSync(path.join(root, 'public/canvas/i18n-canvas.js'), 'utf8');

const checks = [
  [eng.includes('function isTextConsoleNode'), 'text console helper'],
  [eng.includes('function syncTextNodeChrome'), 'sync text chrome'],
  [eng.includes('function runTextNodeChat'), 'text node LLM chat'],
  [eng.includes('function enterTextNodeEdit'), 'double-click enter edit'],
  [eng.includes('function exitTextNodeEdit'), 'exit text edit'],
  [eng.includes("e.detail >= 2"), 'dblclick to edit'],
  [eng.includes("el.getAttribute?.('contenteditable') === 'false'"), 'editable=false lets mousedown bubble'],
  [eng.includes("addEventListener('dblclick'"), 'dblclick listener fallback'],
  [eng.includes('gen-dock is-floating text-node-dock'), 'text dock reuses gen-dock shell'],
  [eng.includes('text-node-dock-provider'), 'text dock provider chip'],
  [eng.includes('function appendTextNodeRefAdd'), 'text dock + upload/pick'],
  [eng.includes('function attachFilesToTextNode'), 'text dock file upload'],
  [eng.includes("to.type === 'prompt'") && eng.includes("['image','group','output','frameStack','imageBatch']"), 'prompt accepts image inputs'],
  [eng.includes('function applyTextNodeStageContent'), 'write chat to stage'],
  [eng.includes('text-stage-only'), 'stage-only body class'],
  [eng.includes('text-node-editor'), 'text editor stage'],
  [eng.includes('contenteditable="${editing ? \'true\' : \'false\'}"') || eng.includes("contenteditable=\"${editing ? 'true' : 'false'}\""), 'edit only when editing'],
  [eng.includes("tr('canvas.textNode')"), 'Text title i18n'],
  [eng.includes('syncTextNodeChrome()'), 'hooked from gen dock sync'],
  [eng.includes("if(type === 'prompt') return {w:260, h:0}"), 'default size matches generator width'],
  [eng.includes('function syncTextNodeFrame'), 'sync text frame like empty gen'],
  [eng.includes('CANVAS_MEDIA_MIN_EDGE') && eng.includes('syncTextNodeFrame'), 'text stage uses media min edge'],
  [css.includes('.text-stage-frame'), 'square stage frame CSS'],
  [css.includes('aspect-ratio:1'), '1:1 stage like empty gen'],
  [css.includes('.prompt-node .node-head') && css.includes('display:none'), 'hide head like generator'],
  [css.includes('width:496px') && css.includes('.prompt-node'), 'prompt-node CSS matches 496 media edge'],
  [css.includes('.text-format-bar'), 'format bar CSS'],
  [css.includes('.text-node-dock'), 'text dock CSS'],
  [i18n.includes('canvas.textNode'), 'i18n textNode key'],
  [eng.includes("type:'prompt'") && eng.includes("type === 'prompt'"), 'keep prompt type for compatibility'],
  [eng.includes("prompt:n.text || ''"), 'generators still read plain text'],
  [eng.includes('function appendGenDockPromptRefs'), 'upstream text chips next to +'],
  [eng.includes('prompt-ref-glyph'), 'text glyph icon in + strip'],
  [eng.includes('is-prompt-ref'), 'prompt-ref chip class'],
  [eng.includes('renderGenDockImageInputs(list, gen, imageInputs, promptInputs)') || eng.includes('renderGenDockImageInputs(wrap.querySelector(\'.gen-dock-refs\'), node, imageInputs, promptInputs)'), 'dock refs render passes promptInputs'],
  [css.includes('.input-item.is-prompt-ref') && css.includes('.prompt-ref-line'), 'prompt-ref glyph CSS'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) process.exit(1);
console.log('ok: text node checks passed');
