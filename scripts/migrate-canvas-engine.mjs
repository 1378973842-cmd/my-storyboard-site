import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const srcPath = path.join(root, 'canvas_source/static/js/canvas.js');
const cssPath = path.join(root, 'canvas_source/static/css/canvas.css');
const ltxPath = path.join(root, 'canvas_source/static/ltx-director-timeline.js');

let js = fs.readFileSync(srcPath, 'utf8');

js = js.replace(
  /window\.addEventListener\('message',[\s\S]*?render\(\);\r?\n\}\);\r?\nwindow\.addEventListener\('studio-lang-change',[\s\S]*?render\(\);\r?\n\}\);\r?\n/,
  ''
);

const domBlock = `let dom = {};
let shell, canvasGate, board, world, nodesEl, minimap, minimapContent, minimapViewport, linksEl, linkControlsEl;
let dropOverlay, createMenu, linkCreateMenu, nodeInputMenu, nodeOutputMenu, imageNodeMenu;
let selectionBox, selectionHub, gateStatus, gateCreateBtn, gateCreateSmartBtn, gateRefreshBtn;
let gateBackBtn, gateTrashBtn, gateTrashCount, gateTitleText, gateSubtitle, gateCanvasList;
let gateTitleInput, gateConfirmBtn, gateCancelBtn, backToManagerBtn, currentCanvasTitle, currentCanvasTime;
let outputLightbox, outputPreview, outputLightboxImg, outputCompareContainer, outputCompareResult;
let outputCompareOriginal, outputCompareOriginalWrap, outputCompareSlider, outputResolution;
let outputDownloadBtn, outputLightboxVideo, outputPromptPanel, outputPromptText, outputCopyPromptBtn;
let outputRerunBtn, logModal, logList, errorModal, errorTitle, errorMessage;
function bindDomElements(root) {
  const g = (id) => root.querySelector('#' + id);
  dom = new Proxy({}, { get: (_, id) => g(String(id)) });
  shell = g('shell');
  canvasGate = g('canvasGate');
  board = g('board');
  world = g('world');
  nodesEl = g('nodes');
  minimap = g('minimap');
  minimapContent = g('minimapContent');
  linksEl = g('links');
  linkControlsEl = g('linkControls');
  dropOverlay = g('dropOverlay');
  createMenu = g('createMenu');
  linkCreateMenu = g('linkCreateMenu');
  nodeInputMenu = g('nodeInputMenu');
  nodeOutputMenu = g('nodeOutputMenu');
  imageNodeMenu = g('imageNodeMenu');
  selectionBox = g('selectionBox');
  selectionHub = g('selectionHub');
  gateStatus = g('gateStatus');
  gateCreateBtn = g('gateCreateBtn');
  gateCreateSmartBtn = g('gateCreateSmartBtn');
  gateRefreshBtn = g('gateRefreshBtn');
  gateBackBtn = g('gateBackBtn');
  gateTrashBtn = g('gateTrashBtn');
  gateTrashCount = g('gateTrashCount');
  gateTitleText = g('gateTitleText');
  gateSubtitle = g('gateSubtitle');
  gateCanvasList = g('gateCanvasList');
  gateTitleInput = g('gateTitleInput');
  gateConfirmBtn = g('gateConfirmBtn');
  gateCancelBtn = g('gateCancelBtn');
  backToManagerBtn = g('backToManagerBtn');
  currentCanvasTitle = g('currentCanvasTitle');
  currentCanvasTime = g('currentCanvasTime');
  outputLightbox = g('outputLightbox');
  outputPreview = g('outputPreview');
  outputLightboxImg = g('outputLightboxImg');
  outputCompareContainer = g('outputCompareContainer');
  outputCompareResult = g('outputCompareResult');
  outputCompareOriginal = g('outputCompareOriginal');
  outputCompareOriginalWrap = g('outputCompareOriginalWrap');
  outputCompareSlider = g('outputCompareSlider');
  outputResolution = g('outputResolution');
  outputDownloadBtn = g('outputDownloadBtn');
  outputLightboxVideo = g('outputLightboxVideo');
  outputPromptPanel = g('outputPromptPanel');
  outputPromptText = g('outputPromptText');
  outputCopyPromptBtn = g('outputCopyPromptBtn');
  outputRerunBtn = g('outputRerunBtn');
  logModal = g('logModal');
  logList = g('logList');
  errorModal = g('errorModal');
  errorTitle = g('errorTitle');
  errorMessage = g('errorMessage');
  minimapViewport = g('minimapViewport');
}`;

js = js.replace(
  /const shell = document\.getElementById\('shell'\);[\s\S]*?const errorMessage = document\.getElementById\('errorMessage'\);/,
  domBlock
);

js = js.replace(/document\.getElementById\(/g, 'domGet(');
js = js.replace(/document\.querySelectorAll\(/g, 'domQueryAll(');
js = js.replace(/document\.querySelector\(/g, 'domQuery(');
js = js.replace(/document\.body\.classList/g, 'canvasRoot.classList');
js = js.replace(/document\.documentElement\.classList/g, 'canvasRoot.classList');
js = js.replace(/document\.body\.appendChild/g, 'canvasRoot.appendChild');
js = js.replace(/window\.onload = async \(\) => \{[\s\S]*?\};\s*$/m, '');

js = js.replace(/^refreshIcons\(\);\r?\n/m, '');

const wireUiStart = 'gateCreateBtn.addEventListener';
const wireUiEnd = "backToManagerBtn.addEventListener('click', returnToCanvasManager);";
const wireUiIdx = js.indexOf(wireUiStart);
const wireUiEndIdx = js.indexOf(wireUiEnd);
if (wireUiIdx >= 0 && wireUiEndIdx >= 0) {
  const endPos = wireUiEndIdx + wireUiEnd.length;
  const block = js.slice(wireUiIdx, endPos);
  js = js.slice(0, wireUiIdx) + `function wireCanvasUiEvents() {\n${block}\n}\n` + js.slice(endPos);
}

const boardStart = 'board.onmousedown = e => {';
const boardIdx = js.indexOf(boardStart);
const boardEndMarker = "    else uploadImages(files);\n});\n";
const boardEndIdx = js.indexOf(boardEndMarker, boardIdx);
if (boardIdx >= 0 && boardEndIdx >= 0) {
  const endPos = boardEndIdx + boardEndMarker.length;
  let block = js.slice(boardIdx, endPos);
  block = block.replace(/board\.addEventListener\(/g, 'on(board, ');
  block = block.replace(
    /board\.onwheel = e => \{([\s\S]*?)scheduleSave\(\);\n\};/,
    'on(board, "wheel", e => {$1scheduleSave();\n}, { passive: false });'
  );
  js = js.slice(0, boardIdx) + `function wireBoardEvents() {\n${block}\n}\n` + js.slice(endPos);
}

js = js.replace(/domGet\(([^)]+)\)\.addEventListener/g, 'domGet($1)?.addEventListener');

js = js.replace(/window\.addEventListener\(/g, 'on(window, ');
js = js.replace(/document\.addEventListener\(/g, 'on(document, ');

const header = `/* eslint-disable */
/** Infinite canvas engine — scoped to canvasRoot. */
let canvasRoot = null;
function domGet(id) {
  if (!canvasRoot) return null;
  const key = String(id).replace(/^#/, '');
  return canvasRoot.querySelector('#' + CSS.escape(key));
}
function domQuery(sel) {
  return canvasRoot ? canvasRoot.querySelector(sel) : null;
}
function domQueryAll(sel) {
  return canvasRoot ? canvasRoot.querySelectorAll(sel) : [];
}
const disposers = [];
function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  disposers.push(() => target.removeEventListener(type, handler, opts));
}
`;

const footer = `
export async function mountInfiniteCanvasEngine(root) {
  canvasRoot = root;
  bindDomElements(root);
  applyTheme(localStorage.getItem('studio_theme') || localStorage.getItem(CANVAS_THEME_KEY) || 'light');
  applyQuickToolbarState();
  if (window.StudioI18n) window.StudioI18n.apply?.();
  initOutputCompareEvents();
  initOutputPreviewZoomEvents();
  applyViewport();
  await loadConfig();
  pruneMissingComfyWorkflows();
  await loadCanvasList(false);
  setCanvasMode(false);
  wireCanvasUiEvents();
  wireBoardEvents();
  exposeCanvasGlobals();
  return disposeInfiniteCanvasEngine;
}

function exposeCanvasGlobals() {
  const map = {
    addImageNode, addPromptNode, addLoopNode, addLLMNode, addGeneratorNode, addMsGenNode,
    addVideoNode, addRhNode, addComfyNode, addLTXDirectorNode, addOutputNode, groupSelectedImages,
    toggleQuickToolbar, openCanvasLog, closeCanvasLog, closeOutputLightbox, menuAdd, closeImageEditor,
    undoEditDrawing, redoEditDrawing, clearEditDrawing, setBrushTool, toggleGridCustomMode,
    applyGridPreset, setGridCustomOrientation, undoGridCustomLine, clearGridCustomLines,
    resetImageEditZoom, resetCropBox, applyImageEdit, closeErrorModal, copyErrorMessage,
    createCanvas, createSmartCanvas, loadCanvasList, openCanvas, deleteCanvas, returnToCanvasManager,
  };
  Object.entries(map).forEach(([k, v]) => { if (typeof v === 'function') window[k] = v; });
}

export function disposeInfiniteCanvasEngine() {
  disposers.forEach((d) => {
    try { d(); } catch (_) {}
  });
  disposers.length = 0;
  if (board) {
    board.onmousedown = null;
    board.onwheel = null;
    board.ondblclick = null;
    board.oncontextmenu = null;
    board.onmousemove = null;
    board.onmouseleave = null;
  }
  window.onmousemove = null;
  window.onmouseup = null;
  canvasRoot = null;
}
`;

const outDir = path.join(root, 'src/lib/infiniteCanvas');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'canvasEngine.js'), header + js + footer);

let css = fs.readFileSync(cssPath, 'utf8');
css = css.replace(/@import url[^;]+;/, '');
css = css.replace(/^:root\s*\{/m, '.infinite-canvas-root {');
css = css.replace(/^\.theme-dark\s*\{/m, '.infinite-canvas-root.theme-dark {');
css = css.replace(/^body\s*\{[^}]+\}\s*/m, '');
css = css.replace(/^body\./gm, '.infinite-canvas-root.');
css = css.replace(
  /^\.shell\s*\{[^}]*height:100vh[^}]*\}/m,
  '.infinite-canvas-root .shell { position:relative; width:100%; height:100%; overflow:hidden; }'
);

const cssOut = path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css');
fs.mkdirSync(path.dirname(cssOut), { recursive: true });
fs.writeFileSync(
  cssOut,
  [
    '.infinite-canvas-host{width:100%;height:100%;position:relative;overflow:hidden;}',
    '.infinite-canvas-root{width:100%;height:100%;position:relative;overflow:hidden;background:var(--page);color:var(--text);font-family:Inter,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;}',
    css,
  ].join('\n')
);

const pubDir = path.join(root, 'public/canvas');
fs.mkdirSync(pubDir, { recursive: true });
fs.copyFileSync(ltxPath, path.join(pubDir, 'ltx-director-timeline.js'));

console.log('Engine bytes:', (header + js + footer).length);
