/* eslint-disable */
/** Infinite canvas engine — scoped to canvasRoot. */
import {
    augmentImagePromptWithReferenceCostumeLock,
    buildNineGridImagePrompt,
    dataUrlToBlob,
    estimateNineGridGap,
    normalizeNineGridShots,
    NINE_GRID_SHOT_PROMPT_MIN_CHARS,
    nineGridFallbackSlicePosition,
    splitNineGridToNine,
} from '../nineGrid/nineGridCore.js';
import {
    clearCanvasFavoriteNavigation,
    readCanvasFavoriteNavigation,
} from '../canvasFavoriteNavigation.ts';
import {
    bindGateCollectionsHost,
    clearGateReturnCollection,
    loadCanvasCollections,
    openCreateCollectionModal,
    renderGateLibrary,
    renderGateTrashList,
    resumeCollectionBrowseAfterGate,
    beginCollectionBrowseResume,
    refreshOpenCollectionBrowseIfOpen,
    wireGateCollectionUi,
} from './canvasGateCollections.js';
import { closeAllCanvasCustomSelects, mountCanvasCustomSelects } from './canvasCustomSelect.js';
let canvasRoot = null;
function apiFetch(url, options = {}) {
    return fetch(url, { credentials: 'same-origin', ...options });
}
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
let boardPanCleanup = null;
let lastBoardInteractionAt = 0;
let spacePanArmed = false;
let altModifierArmed = false;
let boardEventsWired = false;
let imageEditorUiWired = false;
/** 拖节点/缩放/平移后：禁止 safeRender / 远程全量同步，避免闪屏 */
const CANVAS_INTERACTION_COOLDOWN_MS = 8000;
const LAST_CANVAS_ID_KEY = 'gemini-infinite-canvas-last-id';
function readLastCanvasId(){
    try { return sessionStorage.getItem(LAST_CANVAS_ID_KEY) || ''; } catch(_) { return ''; }
}
function writeLastCanvasId(id){
    try {
        if(id) sessionStorage.setItem(LAST_CANVAS_ID_KEY, String(id));
        else sessionStorage.removeItem(LAST_CANVAS_ID_KEY);
    } catch(_) {}
}
function isCanvasInteracting(){
    return Boolean(dragBoard || dragNode || pendingNodeDrag || resizeNode || minimapDrag || tempLink);
}
/** 删除/撤销等编辑操作前清掉可能卡住的拖拽态，避免 render() 被 isCanvasInteracting 挡掉 */
function cancelTempLink(){
    if(linkDragCleanup){
        linkDragCleanup();
        linkDragCleanup = null;
    }
    if(!tempLink) return;
    tempLink = null;
    if(linksEl){
        linksEl.classList.remove('is-dragging-link');
        linksEl.querySelector('path.link.temp')?.remove();
    }
    withCanvasRootClass(list => list.remove('canvas-linking'));
}
function setTempLinkLayerActive(active){
    if(linksEl) linksEl.classList.toggle('is-dragging-link', Boolean(active));
    withCanvasRootClass(list => list.toggle('canvas-linking', Boolean(active)));
}
function refreshTempLinkDom(){
    ensureLiveCanvasDom();
    if(!linksEl || !tempLink) return;
    setTempLinkLayerActive(true);
    const d = linkPathD(tempLink.x1, tempLink.y1, tempLink.x2, tempLink.y2);
    let tempPath = linksEl.querySelector('path.link.temp');
    if(!tempPath){
        tempPath = pathEl(tempLink.x1, tempLink.y1, tempLink.x2, tempLink.y2, 'link temp');
        linksEl.appendChild(tempPath);
    } else {
        tempPath.setAttribute('d', d);
    }
}
function resetCanvasInteractionForEdit(){
    pendingNodeDrag = null;
    dragNode = null;
    dragBoard = null;
    resizeNode = null;
    minimapDrag = false;
    cancelTempLink();
    clearWindowPointerHandlers();
    clearBoardPanListeners();
    if(board){
        board.classList.remove('is-panning');
        if(!spacePanArmed) board.style.cursor = '';
    }
    withCanvasRootClass(list => list.remove('canvas-node-drag', 'canvas-node-resize', 'canvas-selecting', 'canvas-space-pan'));
    if(spacePanArmed) withCanvasRootClass(list => list.add('canvas-space-pan'));
}
function syncCanvasModelFromState(){
    if(!canvas) return;
    canvas.nodes = serializableCanvasNodes();
    canvas.connections = JSON.parse(JSON.stringify(connections));
}
/** 删/改节点结构后：同步内存模型、刷新 DOM，并清掉可能卡住的拖拽态 */
function commitCanvasStructureEdit(){
    localStructureRevision += 1;
    resetCanvasInteractionForEdit();
    rebindDomIfStale();
    if((!nodesEl || !world) && canvasRoot) bindDomElements(canvasRoot);
    syncCanvasModelFromState();
    try {
        render({ force: true });
    } catch(err) {
        console.error('[infinite-canvas] structure render failed', err);
        ensureEditorDomFromModel();
        refreshGeometry();
    }
    if(nodesEl){
        [...nodesEl.children].forEach(child => {
            if(child.dataset?.id && !nodes.some(n => n.id === child.dataset.id)) child.remove();
        });
    }
    syncLinkDomToConnections();
    refreshGeometry();
    refreshGeometryAfterLayout();
    if(minimapState) updateMinimapNodePositions();
}
function shouldBlockCanvasGateTransition(){
    return isCanvasInteracting() || Date.now() - lastBoardInteractionAt < CANVAS_INTERACTION_COOLDOWN_MS;
}
const POINTER_DRAG_THRESHOLD = 3;
function pointerMovedEnough(startX, startY, event, threshold=POINTER_DRAG_THRESHOLD){
    if(!event || startX == null || startY == null) return false;
    return Math.abs(event.clientX - startX) > threshold || Math.abs(event.clientY - startY) > threshold;
}
function clearBoardPanListeners(){
    if(boardPanCleanup){
        boardPanCleanup();
        boardPanCleanup = null;
    }
}
function on(target, type, handler, opts) {
  target.addEventListener(type, handler, opts);
  disposers.push(() => target.removeEventListener(type, handler, opts));
}

// ---- Custom tooltip: replaces native `title` popups (system-styled, delayed, unthemed)
// with a themed one, by transiently stealing the `title` attribute during hover.
// ponytail: desktop-hover only, no touch/long-press handling — acceptable ceiling for a creative-tool canvas.
let tooltipEl = null;
let tooltipTimer = null;
let tooltipTarget = null;
function hideCustomTooltip(){
  clearTimeout(tooltipTimer);
  tooltipTimer = null;
  tooltipTarget = null;
  if(tooltipEl){ tooltipEl.remove(); tooltipEl = null; }
}
function positionCustomTooltip(target){
  if(!tooltipEl) return;
  const r = target.getBoundingClientRect();
  const tw = tooltipEl.offsetWidth;
  const th = tooltipEl.offsetHeight;
  // 侧边工具栏是纵向排列，提示放在图标右侧比上下更贴合视觉动线
  const isSideDock = Boolean(target.closest('.canvas-side-dock'));
  tooltipEl.classList.toggle('is-side', isSideDock);
  if(isSideDock){
    let left = r.right + 10;
    let flipped = false;
    if(left + tw > window.innerWidth - 8){ left = r.left - tw - 10; flipped = true; }
    const top = Math.max(8, Math.min(r.top + r.height / 2 - th / 2, window.innerHeight - th - 8));
    tooltipEl.style.left = `${left}px`;
    tooltipEl.style.top = `${top}px`;
    tooltipEl.classList.toggle('is-flipped', flipped);
    return;
  }
  const left = Math.max(8, Math.min(r.left + r.width / 2 - tw / 2, window.innerWidth - tw - 8));
  let top = r.top - th - 8;
  let flipped = false;
  if(top < 8){ top = r.bottom + 8; flipped = true; }
  tooltipEl.style.left = `${left}px`;
  tooltipEl.style.top = `${top}px`;
  tooltipEl.classList.toggle('is-flipped', flipped);
}
function watchTooltipTarget(){
  if(!tooltipTarget) return;
  if(!tooltipTarget.isConnected){ hideCustomTooltip(); return; }
  requestAnimationFrame(watchTooltipTarget);
}
function showCustomTooltip(target, text){
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(() => {
    tooltipEl = document.createElement('div');
    tooltipEl.className = 'canvas-custom-tooltip';
    tooltipEl.textContent = text;
    document.body.appendChild(tooltipEl);
    positionCustomTooltip(target);
    requestAnimationFrame(() => { tooltipEl?.classList.add('is-visible'); watchTooltipTarget(); });
  }, 420);
}
function wireCustomTooltips(root){
  on(root, 'pointerover', e => {
    const target = e.target?.closest?.('[title]');
    if(!target || !root.contains(target) || target === tooltipTarget) return;
    const text = target.getAttribute('title');
    if(!text) return;
    hideCustomTooltip();
    tooltipTarget = target;
    target.dataset.tooltipStash = text;
    target.removeAttribute('title');
    showCustomTooltip(target, text);
  });
  on(root, 'pointerout', e => {
    const target = e.target?.closest?.('[data-tooltip-stash]');
    if(!target || (e.relatedTarget && target.contains(e.relatedTarget))) return;
    target.setAttribute('title', target.dataset.tooltipStash);
    delete target.dataset.tooltipStash;
    hideCustomTooltip();
  });
}
function refreshIcons(scope){
    if(!window.lucide?.createIcons) return;
    if(scope instanceof Element) lucide.createIcons({ root: scope });
    else lucide.createIcons();
}
function scheduleRenderCanvasList(){
    requestAnimationFrame(() => {
        renderCanvasList();
    });
}
function tr(key){ return window.StudioI18n ? StudioI18n.t(key) : key; }
function trf(key, values={}){
    return Object.entries(values).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), tr(key));
}
function langIsEn(){ return window.StudioI18n?.lang?.() === 'en'; }
function actionFailed(labelKey, detail=''){
    const label = tr(labelKey);
    return langIsEn() ? `${label} failed${detail ? `: ${detail}` : ''}` : `${label}失败${detail ? `：${detail}` : ''}`;
}
function noReturnedImage(labelKey){ return langIsEn() ? `${tr(labelKey)} failed: no image returned` : `${tr(labelKey)}失败：未返回图片`; }
function applyLanguage(lang){
    if(lang && window.StudioI18n) StudioI18n.set(lang);
    document.title = tr('canvas.title');
    refreshGateViewControls();
    if(canvas) {
        currentCanvasTitle.textContent = canvas?.title || tr('canvas.untitled');
    }
    renderCanvasList();
    render();
}
on(window, 'message', event => {
    if(event.data?.type === 'studio-lang') applyLanguage(event.data.lang);
    if(event.data?.type === 'canvas_updated') handleCanvasUpdatedMessage(event.data);
    if(event.data?.type === 'canvas-focus'){
        // 从其他标签页切换回画布时，重新拉取工作流列表并刷新节点
        loadConfig().then(() => {
            pruneMissingComfyWorkflows();
            if(typeof render === 'function') render();
        });
        if(canvas) syncRemoteCanvasNow();
    }
});
on(window, 'studio-lang-change', () => {
    document.title = tr('canvas.title');
    refreshGateViewControls();
    if(canvas) currentCanvasTitle.textContent = canvas?.title || tr('canvas.untitled');
    renderCanvasList();
    render();
});
let dom = {};
let shell, canvasGate, board, world, nodesEl, minimap, minimapContent, minimapViewport, linksEl, linkControlsEl;
let dropOverlay, createMenu, linkCreateMenu, nodeInputMenu, nodeOutputMenu, imageNodeMenu, selectionMenu;
let selectionBox, gateStatus, gateCreateBtn, gateCreateCollectionBtn, gateCreateSmartBtn, gateRefreshBtn;
let gateBackBtn, gateTrashBtn, gateTrashCount, gateTitleText, gateSubtitle, gateCanvasList;
let gateCollectionsRoot, gateUncategorizedSection, gateUncategorizedCount;
let gateContextMenuEl, gateCollectionModalEl, gateCollectionModalTitleEl, gateCollectionNameInputEl;
let gateCollectionModalConfirmEl, gateCollectionModalCancelEl;
let gateCollectionBrowseModalEl, gateCollectionBrowseTitleEl, gateCollectionBrowseCountEl;
let gateCollectionBrowseListEl, gateCollectionBrowseCloseEl;
let gateTitleInput, gateConfirmBtn, gateCancelBtn, backToManagerBtn, currentCanvasTitle, currentCanvasTime;
let gateSearchInput, gateFilterBtn, gateFilterMenu, gateFilterLabel, gateViewGridBtn, gateViewListBtn;
let gateBoardShell, gateListTableHead;
let gateSearchQuery = '';
let gateFilterType = 'all';
let gateSortBy = 'updated';
let gateSortOrder = 'desc';
let gateViewMode = 'grid';
let workflowTemplateModal, workflowTemplateList, workflowTemplateBtn;
let outputLightbox, outputPreview, outputLightboxImg, outputCompareContainer, outputCompareResult;
let outputCompareOriginal, outputCompareOriginalWrap, outputCompareSlider, outputResolution;
let outputDownloadBtn, outputLightboxVideo, outputPromptPanel, outputPromptText, outputCopyPromptBtn;
let outputRerunBtn, logModal, logList, logSearchInput, logModalCount, logClearBar, logClearBtn, logClearCancel, logClearConfirm, errorModal, errorTitle, errorMessage;
let workflowTemplateSearchInput, workflowTemplateTitleInput, workflowTemplateDescInput;
let workflowTemplateSaveForm, workflowTemplateSaveCancel, workflowTemplateSaveConfirm;
let workflowTemplateDeleteBar, workflowTemplateDeleteLabel, workflowTemplateDeleteCancel, workflowTemplateDeleteConfirm;
let logSearchQuery = '';
let logStatusFilter = 'all';
let workflowTemplateSearchQuery = '';
let workflowTemplateKindFilter = 'all';
let workflowTemplateSaveMode = 'canvas';
let pendingDeleteTemplateId = null;
let outputLightboxAnchor = null;
function resolveLiveShell(){
    if(!canvasRoot) return null;
    const live = canvasRoot.querySelector('#shell');
    if(live) shell = live;
    return live;
}
let gateViewRequested = false;

function syncCanvasPageMarkers(){
    if(!canvasRoot) return;
    try {
        const hasActiveCanvas = Boolean(canvas);
        // 门控页（选择画布）时 canvasOpen/is-editor 必须为 false，否则 CSS 会把 gate 藏起来再闪出来
        canvasRoot.dataset.editorSession = hasActiveCanvas ? '1' : '0';
        canvasRoot.dataset.canvasOpen = hasActiveCanvas ? '1' : '0';
        canvasRoot.classList.toggle('is-editor', hasActiveCanvas);
    } catch(_) {}
}
function shouldKeepEditorShellOpen(){
    return Boolean(canvas) && !gateViewRequested;
}
function syncShellEditorClass(){
    if(syncShellEditorClass._busy) return;
    syncShellEditorClass._busy = true;
    try {
        const liveShell = resolveLiveShell();
        if(!liveShell) return;
        const keepEditor = shouldKeepEditorShellOpen();
        if(!liveShell.classList.contains('shell')) liveShell.classList.add('shell');
        if(keepEditor){
            if(liveShell.classList.contains('no-canvas')) liveShell.classList.remove('no-canvas');
        } else if(gateViewRequested){
            if(!liveShell.classList.contains('no-canvas')) liveShell.classList.add('no-canvas');
        }
        syncCanvasPageMarkers();
    } finally {
        syncShellEditorClass._busy = false;
    }
}
function suppressAccidentalGate(){
    syncShellEditorClass();
}
function rebindDomIfStale(){
    if(!canvasRoot) return false;
    const liveBoard = canvasRoot.querySelector('#board');
    const liveShell = canvasRoot.querySelector('#shell');
    const liveNodes = canvasRoot.querySelector('#nodes');
    if(
        liveBoard && liveShell && liveNodes
        && board === liveBoard && shell === liveShell && nodesEl === liveNodes
    ) return true;
    bindDomElements(canvasRoot);
    ensureImageEditorUi();
    if(!canvas) return true;
    syncShellEditorClass();
    ensureEditorDomFromModel();
    applyViewport();
    syncLinkDomToConnections();
    return true;
}
function showCanvasGateView({ clearEditor = false } = {}){
    gateViewRequested = true;
    if(creatingCanvas) setCreateMode(false);
    if(clearEditor) writeLastCanvasId('');
    if(canvasRoot){
        try {
            canvasRoot.dataset.canvasOpen = '0';
            canvasRoot.dataset.editorSession = '0';
        } catch(_) {}
    }
    setCanvasMode(false, { clearEditor, force: true });
}
function syncEditorSessionMarker(){
    syncCanvasPageMarkers();
}
function ensureEditorShellVisible(){
    if(!canvas) return;
    if(!gateViewRequested) return;
    gateViewRequested = false;
    syncShellEditorClass();
}
function markCanvasEditorSession(open){
    if(!canvasRoot) return;
    try {
        if(open && canvas){
            canvasRoot.classList.add('is-editor');
            canvasRoot.dataset.editorSession = '1';
            canvasRoot.dataset.canvasOpen = '1';
        } else {
            canvasRoot.classList.remove('is-editor');
            canvasRoot.dataset.canvasOpen = '0';
            canvasRoot.dataset.editorSession = '0';
        }
    } catch(_) {}
}
function bindDomElements(root) {
  const g = (id) => root.querySelector('#' + id) ?? document.getElementById(id);
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
  if(dropOverlay && dropOverlay.dataset.defaultHint == null){
      dropOverlay.dataset.defaultHint = dropOverlay.textContent?.trim() || '拖放图片到画布';
  }
  createMenu = g('createMenu');
  linkCreateMenu = g('linkCreateMenu');
  nodeInputMenu = g('nodeInputMenu');
  nodeOutputMenu = g('nodeOutputMenu');
  imageNodeMenu = g('imageNodeMenu');
  selectionMenu = g('selectionMenu');
  selectionBox = g('selectionBox');
  gateStatus = g('gateStatus');
  gateCreateBtn = g('gateCreateBtn');
  gateCreateCollectionBtn = g('gateCreateCollectionBtn');
  gateCreateSmartBtn = g('gateCreateSmartBtn');
  gateRefreshBtn = g('gateRefreshBtn');
  gateBackBtn = g('gateBackBtn');
  gateTrashBtn = g('gateTrashBtn');
  gateTrashCount = g('gateTrashCount');
  gateTitleText = g('gateTitleText');
  gateSubtitle = g('gateSubtitle');
  gateCanvasList = g('gateCanvasList');
  gateCollectionsRoot = g('gateCollectionsRoot');
  gateUncategorizedSection = g('gateUncategorizedSection');
  gateUncategorizedCount = g('gateUncategorizedCount');
  gateContextMenuEl = g('gateContextMenu');
  gateCollectionModalEl = g('gateCollectionModal');
  gateCollectionModalTitleEl = g('gateCollectionModalTitle');
  gateCollectionNameInputEl = g('gateCollectionNameInput');
  gateCollectionModalConfirmEl = g('gateCollectionModalConfirm');
  gateCollectionModalCancelEl = g('gateCollectionModalCancel');
  gateCollectionBrowseModalEl = g('gateCollectionBrowseModal');
  gateCollectionBrowseTitleEl = g('gateCollectionBrowseTitle');
  gateCollectionBrowseCountEl = g('gateCollectionBrowseCount');
  gateCollectionBrowseListEl = g('gateCollectionBrowseList');
  gateCollectionBrowseCloseEl = g('gateCollectionBrowseClose');
  gateSearchInput = g('gateSearchInput');
  gateFilterBtn = g('gateFilterBtn');
  gateFilterMenu = g('gateFilterMenu');
  gateFilterLabel = g('gateFilterLabel');
  gateViewGridBtn = g('gateViewGridBtn');
  gateViewListBtn = g('gateViewListBtn');
  gateBoardShell = g('gateBoardShell');
  gateListTableHead = g('gateListTableHead');
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
  logSearchInput = g('logSearchInput');
  logModalCount = g('logModalCount');
  logClearBar = g('logClearBar');
  logClearBtn = g('logClearBtn');
  logClearCancel = g('logClearCancel');
  logClearConfirm = g('logClearConfirm');
  workflowTemplateModal = g('workflowTemplateModal');
  workflowTemplateList = g('workflowTemplateList');
  workflowTemplateBtn = g('workflowTemplateBtn');
  workflowTemplateSearchInput = g('workflowTemplateSearchInput');
  workflowTemplateTitleInput = g('workflowTemplateTitleInput');
  workflowTemplateDescInput = g('workflowTemplateDescInput');
  workflowTemplateSaveForm = g('workflowTemplateSaveForm');
  workflowTemplateSaveCancel = g('workflowTemplateSaveCancel');
  workflowTemplateSaveConfirm = g('workflowTemplateSaveConfirm');
  workflowTemplateDeleteBar = g('workflowTemplateDeleteBar');
  workflowTemplateDeleteLabel = g('workflowTemplateDeleteLabel');
  workflowTemplateDeleteCancel = g('workflowTemplateDeleteCancel');
  workflowTemplateDeleteConfirm = g('workflowTemplateDeleteConfirm');
  errorModal = g('errorModal');
  errorTitle = g('errorTitle');
  errorMessage = g('errorMessage');
  minimapViewport = g('minimapViewport');
  resolveLiveShell();
  syncShellEditorClass();
  syncCanvasTopbarLabels();
}
function syncCanvasTopbarLabels(){
  if(!canvas) return;
  if(currentCanvasTitle){
    currentCanvasTitle.textContent = canvas.title || tr('canvas.untitled');
  }
  if(currentCanvasTime){
    currentCanvasTime.textContent = formatCanvasTime(canvas.updated_at || canvas.created_at);
  }
}
function withCanvasRootClass(mutator) {
    if(!canvasRoot) return;
    mutator(canvasRoot.classList);
}
let canvases = [];
let canvasCollections = [];
let deletedCanvases = [];
let canvas = null;
let favoriteOutputPaths = new Set();
let nodes = [];
let connections = [];
let viewport = {x: -1800, y: -1000, scale: 1};
let dragNode = null;
let groupDropHighlightIds = new Set();
/** mousedown 后、未超过拖动阈值前：纯点击不应走 endDrag / updateGroupMembership */
let pendingNodeDrag = null;
let dragBoard = null;
let minimapDrag = false;
let minimapState = null;
let minimapRenderQueued = false;
let linkGeomQueued = false;
let linkGeomFilter = null;
let layoutLinkRefreshToken = 0;
let nodeLayoutObserver = null;
let nodeLayoutRefreshTimer = null;
let resizeNode = null;
let llmPaneDrag = null;
let tempLink = null;
let linkDragCleanup = null;
let knifeActive = false;
let knifePoint = null;
let knifeTrail = [];
let knifeChanged = false;
let knifeNeedsRender = false;
let selectDrag = null;
let menuPoint = null;
let linkCreateState = null;
let internalDrag = false;
let selected = new Set();
function isNodeDisabled(node){
    return Boolean(node?.disabled);
}
function isNodeEnabled(node){
    return Boolean(node) && !isNodeDisabled(node);
}
function toggleSelectedNodesDisabled(){
    if(!selected.size) return;
    const ids = [...selected];
    const refreshIds = new Set(ids);
    ids.forEach(id => {
        const node = nodes.find(n => n.id === id);
        if(!node) return;
        if(isNodeDisabled(node)) delete node.disabled;
        else node.disabled = true;
        parentPromptGroupIdsForChild(id).forEach(gid => refreshIds.add(gid));
    });
    refreshNodes([...refreshIds]);
    ids.forEach(id => syncLoopsForUpstreamNode(id));
    syncGeneratorInputs();
    refreshGeneratorInputViews();
    renderLinks();
    scheduleSave();
}
function loopsReceivingFromNode(nodeId){
    return connections
        .filter(c => c.from === nodeId)
        .map(c => nodes.find(n => n.id === c.to))
        .filter(n => n?.type === 'loop');
}
function syncLoopsForUpstreamNode(nodeId){
    const loopIds = new Set();
    loopsReceivingFromNode(nodeId).forEach(loop => {
        syncLoopImageBatchSize(loop);
        loopIds.add(loop.id);
    });
    if(loopIds.size) refreshNodes([...loopIds]);
}
let saveTimer = null;
let creatingCanvas = false;
let createCanvasInFlight = false;
let createCanvasKind = 'classic';
let trashMode = false;
let pendingDeleteCanvasId = null;
let pendingPurgeCanvasId = null;
let emojiPickerCanvasId = null;
let localCanvasDirty = false;
let localStructureRevision = 0;
/** 最近一次已知落盘的节点数，用于阻止误写空 nodes */
let lastKnownSavedNodeCount = 0;
let savingCanvasNow = false;
let saveCanvasAgain = false;
let applyingRemoteCanvas = false;
let remoteSyncTimer = null;
let remoteSyncInterval = null;
let remoteSyncBusy = false;
let lastCanvasUpdatedAt = 0;
let models = {gpt:'gpt-image-2', nano:'nano-banana-pro'};
let imageModels = ['gpt-image-2', 'nano-banana-pro'];
const BATCH_POSTER_BASE_PROMPT = '【标题文字规则 — 结构锁定 / 视觉随主题 / 分层配色】必须完全保留参考海报上所有标题的字面文案（逐字一致，不得增删改字、不得翻译、不得改大小写或标点）；必须完全保留标题在画面中的位置、行数、对齐方式与排版层级（不得移动、合并或拆分标题区域）；必须重新设计标题的字体风格与配色，使其与下方场景主题的世界观和主色系统一；同一海报内主标题、促销高亮词/数字（FREE/TRILLION/BONUS/JACKPOT/%/纯数字）、副文案（如 up to）、CTA 按钮文字须使用不同配色层级，至少 3 种可区分的填充/发光色，禁止所有标题区块同一渐变色；含数字或 FREE 类促销词须用最高对比度高亮色；禁止照搬参考图标题的字体外观与颜色；参考图仅用于标题文案与排版参考，不复制参考图的背景、角色或整体配色。\n\n博弈游戏美术风格，老虎机手游广告，2D美式卡通风格，粗黑的闭合轮廓线，矢量插画，平涂赛璐璐风格，高饱和度，鲜艳的色彩，高对比度。\n\n场景：{theme_prompt}\n\n{title_style}';
const BATCH_POSTER_PLAN_B_SCENE_BASE = '博弈游戏美术风格，老虎机手游广告，2D美式卡通风格，粗黑的闭合轮廓线，矢量插画，平涂赛璐璐风格，高饱和度，鲜艳的色彩，高对比度。';
const BATCH_POSTER_DEFAULT_TITLE_STYLE_LAYERS = {
    headline:'Bold display lettering with theme-primary gradient fill and dark stroke for main banner text',
    emphasis:'Brilliant high-contrast accent fill with strong outer glow for numeric amounts and promo words like FREE, TRILLION, BONUS, JACKPOT, %',
    secondary:'Softer supporting micro-copy in lower-saturation theme tint with lighter visual weight',
    cta:'High-contrast white bold text on a saturated pill button color distinct from headline and emphasis',
};
function normalizeBatchPosterTitleStyleLayers(raw){
    const defaults = BATCH_POSTER_DEFAULT_TITLE_STYLE_LAYERS;
    if(typeof raw === 'string' && raw.trim()) return {...defaults, headline:raw.trim()};
    if(raw && typeof raw === 'object'){
        const pick = (keys) => {
            for(const key of keys){
                const val = String(raw[key] || '').trim();
                if(val) return val;
            }
            return '';
        };
        return {
            headline:pick(['headline','main','banner','primary']) || defaults.headline,
            emphasis:pick(['emphasis','highlight','promo','accent']) || defaults.emphasis,
            secondary:pick(['secondary','support','micro','sub']) || defaults.secondary,
            cta:pick(['cta','button','action']) || defaults.cta,
        };
    }
    return {...defaults};
}
function formatBatchPosterTitleStyleForPrompt(layers){
    const style = normalizeBatchPosterTitleStyleLayers(layers);
    return [
        'Title typography tiers (wording/placement from reference; apply by text role — never use one color for all blocks):',
        `- Main headline / banner: ${style.headline}`,
        `- Promo emphasis (numbers, FREE, TRILLION, BONUS, JACKPOT, %): ${style.emphasis}`,
        `- Supporting micro-copy (e.g. up to): ${style.secondary}`,
        `- CTA button text (e.g. CLAIM NOW): ${style.cta}`,
    ].join('\n');
}
function normalizeBatchPosterTitleCopy(raw){
    if(typeof raw === 'string' && raw.trim()){
        const headline = raw.trim();
        return {headline, emphasis:'', secondary:'', cta:'', blocks:[headline]};
    }
    if(raw && typeof raw === 'object'){
        const pick = keys => {
            for(const key of keys){
                const val = String(raw[key] || '').trim();
                if(val) return val;
            }
            return '';
        };
        const headline = pick(['headline','main','banner','primary','title']);
        const emphasis = pick(['emphasis','highlight','promo','accent']);
        const secondary = pick(['secondary','support','micro','sub']);
        const cta = pick(['cta','button','action']);
        const rawBlocks = Array.isArray(raw.blocks)
            ? raw.blocks
            : Array.isArray(raw.lines)
                ? raw.lines
                : Array.isArray(raw.text_blocks)
                    ? raw.text_blocks
                    : [];
        const blocks = rawBlocks.map(item => String(item || '').trim()).filter(Boolean);
        const layered = [headline, emphasis, secondary, cta].filter(Boolean);
        const merged = [...new Set([...blocks, ...layered])];
        return {headline, emphasis, secondary, cta, blocks:merged};
    }
    return {headline:'', emphasis:'', secondary:'', cta:'', blocks:[]};
}
function batchPosterTitleCopyHasContent(copy){
    const normalized = normalizeBatchPosterTitleCopy(copy);
    if(normalized.headline || normalized.emphasis || normalized.secondary || normalized.cta) return true;
    return Array.isArray(normalized.blocks) && normalized.blocks.some(item => String(item || '').trim());
}
function batchPosterTitleCopyRulesFromBase(basePrompt){
    const text = String(basePrompt || BATCH_POSTER_BASE_PROMPT);
    const idx = text.indexOf('\n\n博弈游戏');
    return idx > 0 ? text.slice(0, idx).trim() : text.split('\n\n')[0].trim();
}
function formatBatchPosterTitleCopyForPrompt(titleCopy){
    const copy = normalizeBatchPosterTitleCopy(titleCopy);
    const lines = ['【参考海报标题字面文案 — 逐字锁定】'];
    if(copy.headline) lines.push(`- Main headline / 主标题字面（必须完全一致）: "${copy.headline}"`);
    if(copy.emphasis) lines.push(`- Promo emphasis / 促销高亮字面: "${copy.emphasis}"`);
    if(copy.secondary) lines.push(`- Supporting micro-copy / 副文案字面: "${copy.secondary}"`);
    if(copy.cta) lines.push(`- CTA button / 按钮文字字面: "${copy.cta}"`);
    if(lines.length <= 1) return '';
    lines.push('若 nano 场景稿上已有错误、乱码或与以上不一致的文字，必须用以上字面文案完整替换；不得保留任何错误字符。');
    return lines.join('\n');
}
const BATCH_POSTER_VISION_TEXT_MODEL = 'gemini-3.5-flash';
function isBatchPosterUpstreamOverloaded(message){
    const m = String(message || '').toLowerCase();
    return m.includes('负载') || m.includes('饱和') || m.includes('overload') || m.includes('too many') || /\b429\b/.test(m);
}
async function resolveBatchPosterPosterUrlForApi(posterUrl){
    const url = String(posterUrl || '').trim();
    if(!url) return '';
    if(url.startsWith('data:')) return url;
    if(url.startsWith('blob:')) return await urlToBase64(url);
    if(url.startsWith('/') && !url.startsWith('//')){
        if(url.startsWith('/uploads/')) return url;
        try { return await urlToBase64(url); } catch { return url; }
    }
    return url;
}
async function extractBatchPosterTitleCopy(posterUrl, node){
    let visionUrl = '';
    try {
        visionUrl = await resolveBatchPosterPosterUrlForApi(posterUrl);
    } catch(err) {
        throw new Error(langIsEn()
            ? `Cannot read reference poster image: ${err?.message || err}`
            : `无法读取参考海报图片：${err?.message || err}`);
    }
    if(!visionUrl){
        throw new Error(langIsEn() ? 'Reference poster URL is empty' : '参考海报地址为空');
    }
    try {
        const res = await apiFetch('/api/canvas/batch-poster-extract-titles', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                posterUrl:visionUrl,
                model:BATCH_POSTER_VISION_TEXT_MODEL,
            }),
        });
        if(!res.ok){
            const msg = await responseErrorMessage(res, langIsEn() ? 'Title OCR failed' : '标题 OCR 失败');
            if(isBatchPosterUpstreamOverloaded(msg)){
                console.warn('[batch-poster] title OCR upstream busy, skipping locked copy:', msg);
                return null;
            }
            throw new Error(msg);
        }
        const data = await res.json();
        const copy = normalizeBatchPosterTitleCopy(data?.titleCopy || data);
        if(!batchPosterTitleCopyHasContent(copy)){
            throw new Error(langIsEn()
                ? 'Title OCR returned no text. Try a sharper reference poster or re-connect the image.'
                : '标题 OCR 未识别到任何文案，请换更清晰的参考图或重新连接图片。');
        }
        return copy;
    } catch(err) {
        const msg = err?.message || String(err);
        if(isBatchPosterUpstreamOverloaded(msg)){
            console.warn('[batch-poster] title OCR upstream busy, skipping locked copy:', msg);
            return null;
        }
        throw err;
    }
}
function formatBatchPosterTitleCopyPreview(copy){
    const normalized = normalizeBatchPosterTitleCopy(copy);
    const blocks = Array.isArray(normalized.blocks) ? normalized.blocks.filter(item => String(item || '').trim()) : [];
    if(blocks.length) return blocks.slice(0, 4).map(item => String(item).trim()).join(' · ');
    return [normalized.headline, normalized.emphasis, normalized.secondary, normalized.cta].filter(Boolean).join(' · ');
}
function batchPosterCachedTitleCopyForPoster(node, posterUrl){
    if(!node || !posterUrl) return null;
    if(String(node.planBTitleCopyPosterUrl || '').trim() !== String(posterUrl || '').trim()) return null;
    const cached = normalizeBatchPosterTitleCopy(node.planBTitleCopy);
    return batchPosterTitleCopyHasContent(cached) ? cached : null;
}
async function resolveBatchPosterPlanBTitleCopy(posterRef, node){
    const posterUrl = String(posterRef?.url || '').trim();
    if(!posterUrl){
        throw new Error(langIsEn() ? 'Connect a reference poster image to the Image input.' : '请通过 Image 端口连接一张参考海报图。');
    }
    const cached = batchPosterCachedTitleCopyForPoster(node, posterUrl);
    if(cached){
        console.log('[batch-poster] plan B using cached title copy for poster');
        return cached;
    }
    const copy = await extractBatchPosterTitleCopy(posterUrl, node);
    if(copy){
        node.planBTitleCopy = copy;
        node.planBTitleCopyPosterUrl = posterUrl;
        node.planBTitleCopyStatus = langIsEn() ? 'Title copy locked' : '标题文案已锁定';
        scheduleSave();
        return copy;
    }
    throw new Error(langIsEn()
        ? 'Plan B requires locked reference title copy, but title OCR failed (upstream busy). Connect the poster and click「Extract reference titles」, wait a minute, then run again.'
        : 'B计划·复刻参考文案需要锁定参考标题，但标题 OCR 失败（上游繁忙）。请先连接参考海报并点击「提取参考标题」，稍等片刻后再一键批量生成。');
}
async function prefetchBatchPosterTitleCopyForNode(node, {force = false} = {}){
    if(!node || node.type !== 'batchPosterAgent' || !isBatchPosterPlanBReferenceCopy(node)) return;
    const posterRef = batchPosterAgentPosterRef(node);
    const posterUrl = String(posterRef?.url || '').trim();
    if(!posterUrl) return;
    if(!force && batchPosterCachedTitleCopyForPoster(node, posterUrl)) return;
    if(node._batchPosterTitlePrefetchBusy) return;
    node._batchPosterTitlePrefetchBusy = true;
    node.planBTitleCopyStatus = langIsEn() ? 'Extracting reference titles…' : '正在提取参考标题…';
    refreshNodes([node.id]);
    try {
        const copy = await extractBatchPosterTitleCopy(posterUrl, node);
        if(copy){
            node.planBTitleCopy = copy;
            node.planBTitleCopyPosterUrl = posterUrl;
            node.planBTitleCopyStatus = langIsEn() ? 'Title copy locked' : '标题文案已锁定';
            scheduleSave();
        } else {
            node.planBTitleCopyStatus = langIsEn()
                ? 'OCR skipped (upstream busy). Retry extract or run batch later.'
                : 'OCR 已跳过（上游繁忙），请稍后点「提取参考标题」或再试批量生成。';
        }
    } catch(err) {
        node.planBTitleCopyStatus = err?.message || String(err);
    } finally {
        node._batchPosterTitlePrefetchBusy = false;
        refreshNodes([node.id]);
    }
}
function batchPosterPlanBCopySectionHtml(node){
    if(!isBatchPosterPlanBReferenceCopy(node)) return '';
    const copy = normalizeBatchPosterTitleCopy(node.planBTitleCopy);
    const hasCopy = batchPosterTitleCopyHasContent(copy);
    const status = String(node.planBTitleCopyStatus || '').trim()
        || (hasCopy
            ? (langIsEn() ? 'Title copy locked' : '标题文案已锁定')
            : (langIsEn() ? 'Not extracted yet — required before batch run' : '尚未提取 — 批量生成前必须锁定参考标题'));
    const preview = hasCopy ? formatBatchPosterTitleCopyPreview(copy) : '';
    return `
        <div class="batch-poster-planb-copy-section">
            <div class="batch-poster-field">
                <span class="batch-poster-field-label">${langIsEn() ? 'Reference title copy' : '参考标题文案'}</span>
                <p class="batch-poster-field-hint batch-poster-planb-copy-status">${escapeHtml(status)}</p>
                ${preview ? `<p class="batch-poster-field-hint batch-poster-planb-copy-preview">${escapeHtml(preview)}</p>` : ''}
                <button type="button" class="batch-poster-extract-titles-btn setting-input">${langIsEn() ? 'Extract reference titles' : '提取参考标题'}</button>
                <span class="batch-poster-field-hint batch-poster-field-hint-muted">${langIsEn()
                    ? 'Plan B locks exact wording from the poster. Extract when connected, before running batch.'
                    : 'B计划需逐字锁定参考海报标题。连接参考图后先提取，再一键批量生成。'}</span>
            </div>
        </div>`;
}
function syncBatchPosterPlanBCopyUi(wrap, node){
    if(!wrap || !node) return;
    const section = wrap.querySelector('.batch-poster-planb-copy-section');
    if(section) section.style.display = isBatchPosterPlanBReferenceCopy(node) ? '' : 'none';
    const statusEl = wrap.querySelector('.batch-poster-planb-copy-status');
    const previewEl = wrap.querySelector('.batch-poster-planb-copy-preview');
    const copy = normalizeBatchPosterTitleCopy(node.planBTitleCopy);
    const hasCopy = batchPosterTitleCopyHasContent(copy);
    if(statusEl){
        statusEl.textContent = String(node.planBTitleCopyStatus || '').trim()
            || (hasCopy
                ? (langIsEn() ? 'Title copy locked' : '标题文案已锁定')
                : (langIsEn() ? 'Not extracted yet — required before batch run' : '尚未提取 — 批量生成前必须锁定参考标题'));
    }
    if(previewEl){
        if(hasCopy){
            previewEl.textContent = formatBatchPosterTitleCopyPreview(copy);
            previewEl.style.display = '';
        } else {
            previewEl.textContent = '';
            previewEl.style.display = 'none';
        }
    }
}
const BATCH_POSTER_PRESET_OPTIONS = [
    {value:'random', labelEn:'Random', labelZh:'随机脑暴'},
    {value:'maleHardcore', labelEn:'Male Hardcore', labelZh:'硬核征服向'},
    {value:'femaleFantasy', labelEn:'Female Fantasy', labelZh:'梦幻女性向'},
    {value:'trendingCasual', labelEn:'Trending Casual', labelZh:'潮流高波动'},
    {value:'nostalgicClassics', labelEn:'Nostalgic Classics', labelZh:'复古怀旧向'},
    {value:'mythicBeasts', labelEn:'Mythic & Beasts', labelZh:'神话猛兽向'},
    {value:'culturalMysteries', labelEn:'Cultural Mysteries', labelZh:'异域文明探索'},
    {value:'luckyAnimalJackpots', labelEn:'Lucky Animal Jackpots', labelZh:'财富神兽存钱罐'},
    {value:'vegasLuxuryWealth', labelEn:'Vegas Luxury Wealth', labelZh:'维加斯奢华财富'},
    {value:'chineseStyle', labelEn:'Chinese Style', labelZh:'中国风'},
    {value:'seasonalAntagonists', labelEn:'Seasonal Antagonists', labelZh:'节日反派特供'},
    {value:'fairyTaleLegends', labelEn:'Fairy Tale Legends', labelZh:'经典童话新编'},
];
const BATCH_POSTER_PRESET_THEME_IDS = {
    nostalgicClassics:[20,14,37,38,39,60,61,62,63,64,65,66,67,68,69,70,71,75,78,79,80,81,82,83],
    mythicBeasts:[18,12,19,31,36,40,41,52,53,77],
    maleHardcore:[3,4,10,17,21,28,30,42,74],
    femaleFantasy:[2,6,7,11,13,24,26,29,33,43,73],
    trendingCasual:[15,16,22,23,25,27,32,44,72],
    culturalMysteries:[1,5,8,9,34,35,45],
    luckyAnimalJackpots:[46,47],
    vegasLuxuryWealth:[48,49,76],
    chineseStyle:[11,26,46,50,51,58,59],
    seasonalAntagonists:[54,55],
    fairyTaleLegends:[56,57],
};
let batchPosterThemeCatalogCache = null;
let batchPosterThemeCatalogPromise = null;
async function ensureBatchPosterThemeCatalog(){
    if(batchPosterThemeCatalogCache) return batchPosterThemeCatalogCache;
    if(!batchPosterThemeCatalogPromise){
        batchPosterThemeCatalogPromise = apiFetch('/api/canvas/batch-poster-theme-catalog')
            .then(res => res.ok ? res.json() : null)
            .catch(() => null)
            .then(data => {
                batchPosterThemeCatalogCache = data && typeof data === 'object' ? data : {presets:BATCH_POSTER_PRESET_THEME_IDS, themes:[]};
                return batchPosterThemeCatalogCache;
            });
    }
    return batchPosterThemeCatalogPromise;
}
function batchPosterThemesForPreset(preset, catalog){
    const key = normalizeBatchPosterPreset(preset);
    if(key === 'random') return [];
    const ids = catalog?.presets?.[key] || BATCH_POSTER_PRESET_THEME_IDS[key] || [];
    const themes = Array.isArray(catalog?.themes) ? catalog.themes : [];
    return themes.filter(theme => ids.includes(Number(theme.id)));
}
function normalizeBatchPosterThemeId(value){
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? id : null;
}
function normalizeBatchPosterCustomTheme(value){
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 120);
}
function normalizeBatchPosterThemeSource(value, node){
    const key = String(value || '').trim();
    if(key === 'custom') return 'custom';
    if(key === 'preset') return 'preset';
    if(node && normalizeBatchPosterCustomTheme(node.custom_theme)) return 'custom';
    return 'preset';
}
function batchPosterUsesCustomTheme(node){
    return normalizeBatchPosterThemeSource(node?.theme_source, node) === 'custom';
}
function batchPosterThemeSectionHtml(node){
    const mode = normalizeBatchPosterThemeSource(node?.theme_source, node);
    const customValue = normalizeBatchPosterCustomTheme(node?.custom_theme);
    const presetLabel = langIsEn() ? 'Preset catalog' : '预设主题库';
    const customLabel = langIsEn() ? 'Custom theme' : '自定义主题';
    const ipNote = langIsEn()
        ? 'Style reference only; you are responsible for IP and commercial use.'
        : '仅作风格参考，请注意版权与商用合规。';
    return `
        <div class="batch-poster-theme-section">
            <span class="batch-poster-field-label">${langIsEn() ? 'Theme Source' : '主题来源'}</span>
            <div class="batch-poster-theme-segmented" role="tablist" aria-label="${langIsEn() ? 'Theme source' : '主题来源'}">
                <button type="button" class="batch-poster-theme-segment${mode === 'preset' ? ' active' : ''}" data-theme-source="preset" role="tab" aria-selected="${mode === 'preset'}">${escapeHtml(presetLabel)}</button>
                <button type="button" class="batch-poster-theme-segment${mode === 'custom' ? ' active' : ''}" data-theme-source="custom" role="tab" aria-selected="${mode === 'custom'}">${escapeHtml(customLabel)}</button>
            </div>
            <div class="batch-poster-theme-preset-panel"${mode === 'preset' ? '' : ' hidden'}>
                ${batchPosterPresetSelectHtml(node)}
                ${batchPosterSpecificThemeSelectHtml(node)}
            </div>
            <div class="batch-poster-theme-custom-panel"${mode === 'custom' ? '' : ' hidden'}>
                <label class="batch-poster-field batch-poster-custom-theme-field">
                    <span class="batch-poster-field-label">${langIsEn() ? 'Your theme' : '主题描述'}</span>
                    <input class="batch-poster-custom-theme setting-input" type="text" maxlength="120" placeholder="${langIsEn() ? 'Ninja Turtles, cyberpunk street…' : '忍者神龟、赛博朋克街头…'}" value="${escapeAttr(customValue)}">
                    <span class="batch-poster-field-hint">${langIsEn() ? 'Any IP or concept; LLM will expand into poster scenes.' : '任意 IP 或概念，将由 LLM 扩写为多张海报场景。'}</span>
                    <span class="batch-poster-field-hint batch-poster-field-hint-muted">${escapeHtml(ipNote)}</span>
                </label>
            </div>
        </div>`;
}
function syncBatchPosterThemeControls(wrap, node){
    if(!wrap || !node) return;
    const mode = normalizeBatchPosterThemeSource(node.theme_source, node);
    wrap.querySelectorAll('.batch-poster-theme-segment').forEach(btn => {
        const active = btn.dataset.themeSource === mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const presetPanel = wrap.querySelector('.batch-poster-theme-preset-panel');
    const customPanel = wrap.querySelector('.batch-poster-theme-custom-panel');
    if(presetPanel) presetPanel.hidden = mode !== 'preset';
    if(customPanel) customPanel.hidden = mode !== 'custom';
    const themeSelect = wrap.querySelector('.batch-poster-specific-theme');
    if(themeSelect) themeSelect.disabled = mode !== 'preset' || normalizeBatchPosterPreset(node.selectedPreset) === 'random';
}
function batchPosterSpecificThemeSelectHtml(node){
    const preset = normalizeBatchPosterPreset(node?.selectedPreset);
    const isRandom = preset === 'random';
    const randomLabel = langIsEn() ? 'All Themes (Random)' : '全部主题（随机）';
    const presetRandomLabel = langIsEn() ? 'Random within preset' : '预设内随机';
    const selectedThemeId = normalizeBatchPosterThemeId(node?.selectedThemeId);
    const themes = batchPosterThemesForPreset(preset, batchPosterThemeCatalogCache);
    const options = isRandom
        ? `<option value="">${escapeHtml(randomLabel)}</option>`
        : [`<option value="">${escapeHtml(presetRandomLabel)}</option>`]
            .concat(themes.map(theme => {
                const id = Number(theme.id);
                const label = `${theme.name || `#${id}`} (#${id})`;
                return `<option value="${id}" ${selectedThemeId === id ? 'selected' : ''}>${escapeHtml(label)}</option>`;
            }))
            .join('');
    return `
        <label class="batch-poster-field">
            <span class="batch-poster-field-label">Specific Theme</span>
            <select class="batch-poster-specific-theme setting-input" ${isRandom ? 'disabled' : ''}>${options}</select>
        </label>`;
}
function refreshBatchPosterSpecificThemeSelect(wrap, node, catalog){
    const select = wrap?.querySelector?.('.batch-poster-specific-theme');
    if(!select || !node) return;
    const preset = normalizeBatchPosterPreset(node.selectedPreset);
    const isRandom = preset === 'random';
    const randomLabel = langIsEn() ? 'All Themes (Random)' : '全部主题（随机）';
    const presetRandomLabel = langIsEn() ? 'Random within preset' : '预设内随机';
    select.disabled = batchPosterUsesCustomTheme(node) || isRandom;
    select.innerHTML = '';
    if(isRandom){
        node.selectedThemeId = null;
        select.appendChild(new Option(randomLabel, ''));
        return;
    }
    select.appendChild(new Option(presetRandomLabel, ''));
    const themes = batchPosterThemesForPreset(preset, catalog);
    const ids = themes.map(theme => Number(theme.id));
    themes.forEach(theme => {
        select.appendChild(new Option(`${theme.name || `#${theme.id}`} (#${theme.id})`, String(theme.id)));
    });
    const selectedThemeId = normalizeBatchPosterThemeId(node.selectedThemeId);
    if(selectedThemeId && ids.includes(selectedThemeId)){
        select.value = String(selectedThemeId);
    } else {
        select.value = '';
        node.selectedThemeId = null;
    }
}
let chatModels = ['gpt-4o-mini'];
let videoModels = [];
let msChatModels = [];
let apiProviders = [];
let comfyBackendCount = 1;
let comfyWorkflows = [];
let comfyWorkflowCache = {};
let runningHubWorkflowCache = {};
let managedProviderId = 'runninghub';
let localImageModels = [];
let localChatModels = [];
const HIDDEN_CANVAS_NODE_TYPES = new Set(['msgen', 'comfy', 'ltxDirector']);
function filterCanvasNodeOptions(options){
    return (options || []).filter(opt => !HIDDEN_CANVAS_NODE_TYPES.has(opt.type));
}
const MS_GEN_MODELS = {
    zimage:    { label: 'ZImage',     modelId: 'Tongyi-MAI/Z-Image-Turbo',            supportsImage: false, endpoint: '/generate'            },
    qwen_edit: { label: 'Qwen Edit',  modelId: 'Qwen/Qwen-Image-Edit-2511',            supportsImage: true,  endpoint: '/api/angle/generate'  },
    klein_edit:{ label: 'Klein',      modelId: 'black-forest-labs/FLUX.2-klein-9B',   supportsImage: true,  endpoint: '/api/ms/generate'     },
    custom:    { label: '自定义', labelKey: 'canvas.custom', modelId: '',                acceptsImage: true,   endpoint: '/api/ms/generate'     }
};
let hasManagedImageModels = false;
let hasManagedChatModels = false;
let outputCompareDrag = false;
let outputPreviewZoom = 1;
let outputPreviewPan = {x: 0, y: 0};
let outputPreviewPanDrag = null;
let currentOutputCompareUrl = '';
let currentOutputMeta = null;
let currentOutputLightboxOutId = '';
let currentOutputLightboxUrl = '';
const missingAssetUrls = new Set();
let outputTimer = null;
let loopContext = null;
let clipboard = null;
let lastImagePasteAt = 0;
const activeCanvasTaskPolls = new Set();
let hoveredConnectionId = '';
let connHoverRAF = 0;
let connHoverPendingEvent = null;
let connHoverLastAt = 0;
const CONN_HOVER_MIN_MS = 56;
let lastMouseBoard = {x: 0, y: 0};
let undoStack = [];
let redoStack = [];
const UNDO_MAX = 30;
let viewportCullRaf = 0;
const VIEWPORT_CULL_PAD = 300;
const LOOP_PARALLEL_MAX = 10;
const cascadeRunningIds = new Set();
const cascadeStopIds = new Set();
const cascadeSerialIds = new Set(); // 记录以串行循环模式启动的运行，用于停止按钮
let cropState = null;
let cropDrag = null;
let cropAspectLock = 'original';
let imageEditMode = 'crop';
let imageEditModeTouched = false;
let editDrawState = null;
let editDrawUndoStack = [];
let editDrawRedoStack = [];
const EDIT_DRAW_HISTORY_MAX = 40;
let brushTool = 'free';
let brushLabelCounter = 1;
let brushLabelPick = 1;
let gridCustomMode = false;
let gridCustomLines = []; // [{type:'h'|'v', pos:0-1}] 相对图片尺寸的分数位置
let gridCustomOrientation = 'h'; // 当前点击放置方向
let gridCustomHistory = []; // 撤销栈：每次放线前快照
let gridCustomDrag = null; // {index, pointerId}
let imageEditZoom = 1.0;
let imageEditBaseW = 0; // zoom=1 时图片显示宽度
let imageEditBaseH = 0;
let textSelectionGuard = null;
const PROMPT_TEXT_MAX_LENGTH = 20000;
const CLIENT_ID = 'canvas_' + Math.random().toString(36).slice(2);
const LTX_DIRECTOR_WORKFLOW = 'LTXDirectorv2-API.json';
const LTX_DIRECTOR_WF_NODE = '46';
const LTX_DIRECTOR_SEED_NODE = '94:28';
const LTX_SEGMENT_COLORS = ['#e07b3a', '#3b82f6', '#10b981', '#8b5cf6', '#ec4899', '#f59e0b'];
const CANVAS_EMOJIS = ['layers','sparkles','image','palette','wand-2','star','heart','rocket','flame','moon','cloud','leaf','gem','compass','pin','flag','bookmark','crown'];
function renderCanvasIcon(icon, size = 14) {
    // 旧的默认 emoji 或空值都映射为 layers
    if(!icon || icon === '🧩') return `<i data-lucide="layers" style="width:${size}px;height:${size}px"></i>`;
    // 含非 ASCII 字符（用户旧选过的 emoji）继续按文本渲染
    if(/[^\x00-\x7F]/.test(icon)) return escapeHtml(icon);
    return `<i data-lucide="${escapeHtml(icon)}" style="width:${size}px;height:${size}px"></i>`;
}

const SIZE_MAP = {
    square: { '1k':'1024x1024', '2k':'2048x2048', '4k':'2880x2880' },
    portrait: { '1k':'1024x1536', '2k':'1360x2048', '4k':'2352x3520' },
    portrait43: { '1k':'1008x1344', '2k':'1536x2048', '4k':'2448x3264' },
    landscape43: { '1k':'1344x1008', '2k':'2048x1536', '4k':'3264x2448' },
    landscape: { '1k':'1536x1024', '2k':'2048x1360', '4k':'3520x2352' },
    story: { '1k':'720x1280', '2k':'1152x2048', '4k':'2160x3840' },
    wide: { '1k':'1280x720', '2k':'2048x1152', '4k':'3840x2160' }
};
const RES_LONG_SIDE = { '1k':1536, '2k':2048, '4k':3840 };
const RES_PIXEL_LIMIT = { '1k':1572864, '2k':4194304, '4k':8294400 };
const CUSTOM_IMAGE_MODELS_KEY = 'canvas_custom_image_models';
const MANAGED_IMAGE_MODELS_KEY = 'canvas_image_models_ordered';
const MANAGED_CHAT_MODELS_KEY = 'canvas_chat_models_ordered';
const CANVAS_THEME_KEY = 'canvas_theme';
const QUICK_TOOLBAR_COLLAPSED_KEY = 'canvas_quick_toolbar_collapsed';
const DEFAULT_VIDEO_MODELS = [
    // Veo
    'veo2', 'veo2-fast', 'veo2-pro',
    'veo3', 'veo3-fast', 'veo3-pro',
    'veo3.1', 'veo3.1-fast', 'veo3.1-quality', 'veo3.1-lite',
    // Sora
    'sora-2', 'sora-2-pro',
    // 通义万相
    'wan2.6-t2v', 'wan2.6-i2v',
    'wan2.5-t2v-preview', 'wan2.5-i2v-preview',
    'wan2.2-t2v-plus', 'wan2.2-i2v-plus', 'wan2.2-i2v-flash',
    // Seedance
    'doubao-seedance-2-0-260128',
    'doubao-seedance-2-0-fast-260128',
    'doubao-seedance-1-5-pro-251215',
    'doubao-seedance-1-0-pro-250528',
    'doubao-seedance-1-0-lite-t2v-250428',
    'doubao-seedance-1-0-lite-i2v-250428'
];

function uid(prefix='n'){ return `${prefix}_${Math.random().toString(16).slice(2)}_${Date.now()}`; }
function applyTheme(_theme){
    // ponytail: 画布固定暗房，不跟全站浅色切换；升级路径见 STUDIO_RULES §三（方案 B 暖浅 token）
    const dark = true;
    if(canvasRoot){
        canvasRoot.classList.add('infinite-canvas-root');
        canvasRoot.classList.toggle('studio-theme-dark', dark);
        canvasRoot.classList.toggle('theme-dark', dark);
    }
    if(shell) shell.classList.toggle('theme-dark', dark);
    if(canvas?.settings?.boardBg) applyBoardBackground(canvas.settings.boardBg, { save: false });
}
const BOARD_BG_DEFAULT = { light: '#F8FAFC', dark: '#12100E' };
let boardBackgroundColor = '';
function defaultBoardBackground(){
    const dark = canvasRoot?.classList.contains('theme-dark');
    return dark ? BOARD_BG_DEFAULT.dark : BOARD_BG_DEFAULT.light;
}
function normalizeBoardHex(raw){
    const s = String(raw || '').trim().replace(/^#/, '');
    if(!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return `#${s.toUpperCase()}`;
}
function hexToBoardRgb(hex){
    const n = normalizeBoardHex(hex);
    if(!n) return null;
    return {
        r: parseInt(n.slice(1, 3), 16),
        g: parseInt(n.slice(3, 5), 16),
        b: parseInt(n.slice(5, 7), 16),
    };
}
function deriveBoardGridColor(hex){
    const rgb = hexToBoardRgb(hex);
    if(!rgb) return 'rgba(148,163,184,.18)';
    const lum = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    if(lum > 0.62) return '#d9e1ea';
    if(canvasRoot?.classList.contains('theme-dark')) return 'rgba(255,184,102,.08)';
    return `rgba(255,255,255,${(0.06 + (1 - lum) * 0.14).toFixed(3)})`;
}
function applyBoardBackground(color, { save = true } = {}){
    const hex = normalizeBoardHex(color) || defaultBoardBackground();
    boardBackgroundColor = hex;
    const grid = deriveBoardGridColor(hex);
    if(canvasRoot){
        canvasRoot.style.setProperty('--page', hex);
        canvasRoot.style.setProperty('--grid', grid);
    }
    if(board) board.style.backgroundColor = hex;
    if(canvas){
        canvas.settings = {...(canvas.settings || {}), boardBg: hex};
    }
    if(typeof window !== 'undefined'){
        window.dispatchEvent(new CustomEvent('canvas-board-bg-change', { detail: { color: hex } }));
    }
    if(save && canvas) scheduleNodeDragSave();
}
export function getCanvasBoardBackground(){
    return boardBackgroundColor || canvas?.settings?.boardBg || defaultBoardBackground();
}
export function getCanvasViewportScale(){
    return viewport?.scale ?? 1;
}
const viewportScaleListeners = new Set();
function notifyViewportScaleChange(){
    const scale = getCanvasViewportScale();
    if(typeof window !== 'undefined'){
        window.dispatchEvent(new CustomEvent('canvas-viewport-change', { detail: { scale } }));
    }
    viewportScaleListeners.forEach(listener => {
        try { listener(scale); } catch(_) { /* ignore */ }
    });
}
export function subscribeCanvasViewportScale(listener){
    if(typeof listener !== 'function') return () => {};
    viewportScaleListeners.add(listener);
    listener(getCanvasViewportScale());
    return () => viewportScaleListeners.delete(listener);
}
export function resetCanvasViewportZoom(){
    if(!canvas || !board) return;
    const rect = board.getBoundingClientRect();
    const center = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    viewport.scale = 1;
    viewport.x = rect.width / 2 - center.x;
    viewport.y = rect.height / 2 - center.y;
    applyViewport();
    scheduleViewportSave();
}
export function zoomCanvasViewport(factor){
    if(!canvas || !board || !Number.isFinite(factor) || factor <= 0) return;
    const rect = board.getBoundingClientRect();
    const center = screenToWorld(rect.left + rect.width / 2, rect.top + rect.height / 2);
    const next = Math.min(3, Math.max(0.08, (viewport.scale || 1) * factor));
    viewport.scale = next;
    viewport.x = rect.width / 2 - center.x * next;
    viewport.y = rect.height / 2 - center.y * next;
    applyViewport();
    scheduleViewportSave();
}
export function fitCanvasViewportAll(){
    if(!canvas || !board) return;
    const rects = (nodes || []).map(estimatedNodeRect);
    if(!rects.length) return resetCanvasViewportZoom();
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rects.forEach(r => {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
    });
    const bw = Math.max(1, maxX - minX);
    const bh = Math.max(1, maxY - minY);
    const margin = 0.1;
    const rect = board.getBoundingClientRect();
    const scale = Math.min(3, Math.max(0.08, Math.min(
        rect.width / (bw * (1 + margin * 2)),
        rect.height / (bh * (1 + margin * 2)),
    )));
    const cx = minX + bw / 2;
    const cy = minY + bh / 2;
    viewport.scale = scale;
    viewport.x = rect.width / 2 - cx * scale;
    viewport.y = rect.height / 2 - cy * scale;
    applyViewport();
    scheduleViewportSave();
}
/** Shell 激活或 board 尺寸变化后重算视口/连线/小地图（修复封面进入时汇聚动画导致的错位） */
export function refreshInfiniteCanvasLayout(){
    if(!canvasRoot || !board) return;
    rebindDomIfStale();
    const liveShell = resolveLiveShell();
    if(liveShell?.classList.contains('no-canvas') && !canvas) return;
    applyViewport();
    refreshGeometryAfterLayout();
    scheduleMinimapRender();
}
/** 返回条挂到顶栏后重新绑定 DOM 并刷新标题/时间 */
export function syncCanvasTopbarDom(){
    if(!canvasRoot) return;
    backToManagerBtn = document.getElementById('backToManagerBtn');
    currentCanvasTitle = document.getElementById('currentCanvasTitle');
    currentCanvasTime = document.getElementById('currentCanvasTime');
    syncCanvasTopbarLabels();
}
export function setCanvasBoardBackground(color){
    if(!canvas) return;
    applyBoardBackground(color, { save: true });
}
function applyQuickToolbarState(){
    const toolbar = domGet('quickToolbar');
    if(!toolbar) return;
    toolbar.classList.remove('collapsed');
    refreshIcons();
}
function toggleQuickToolbar(){
    const toolbar = domGet('quickToolbar');
    const next = !toolbar?.classList.contains('collapsed');
    localStorage.setItem(QUICK_TOOLBAR_COLLAPSED_KEY, next ? '1' : '0');
    applyQuickToolbarState();
}
function loadLocalModelLists(){
    try {
        const managedRaw = localStorage.getItem(MANAGED_IMAGE_MODELS_KEY);
        const raw = JSON.parse(managedRaw || localStorage.getItem(CUSTOM_IMAGE_MODELS_KEY) || '[]');
        localImageModels = Array.isArray(raw) ? raw.filter(Boolean) : [];
        hasManagedImageModels = Boolean(managedRaw);
    } catch(e) {
        localImageModels = [];
        hasManagedImageModels = false;
    }
    try {
        const managedRaw = localStorage.getItem(MANAGED_CHAT_MODELS_KEY);
        const raw = JSON.parse(managedRaw || '[]');
        localChatModels = Array.isArray(raw) ? raw.filter(Boolean) : [];
        hasManagedChatModels = Boolean(managedRaw);
    } catch(e) {
        localChatModels = [];
        hasManagedChatModels = false;
    }
}
function uniqueModels(list){
    const seen = new Set();
    return list.map(item => String(item || '').trim()).filter(item => {
        if(!item || seen.has(item)) return false;
        seen.add(item);
        return true;
    });
}
function siteImageProviderEntry(extra = {}){
    return {
        id: 'runninghub',
        name: 'RunningHub',
        enabled: true,
        image_models: imageModels,
        chat_models: chatModels,
        video_models: videoModels.length ? videoModels : DEFAULT_VIDEO_MODELS,
        has_key: false,
        key_preview: '',
        ...extra,
    };
}
function defaultApiProviders(){
    return [siteImageProviderEntry()];
}
function normalizeLoadedProviders(list){
    const mapped = (list?.length ? list : defaultApiProviders()).map(p => {
        const rawId = String(p?.id || '').trim().toLowerCase();
        if(rawId === 'comfly' || rawId === 'runninghub'){
            return siteImageProviderEntry({
                ...p,
                image_models: uniqueModels([...(p.image_models || []), ...imageModels]),
            });
        }
        return {
            ...p,
            id: String(p?.id || '').trim(),
            name: p.name || p.label || p.id,
            enabled: p.enabled !== false,
        };
    });
    const out = [];
    const seen = new Set();
    for(const p of mapped){
        if(String(p?.id || '').toLowerCase() === 'comfly') continue;
        if(!p?.id || seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
    }
    if(!out.some(p => p.id === 'runninghub')) out.unshift(siteImageProviderEntry());
    return out;
}
function legacyImageProviderId(id){
    const text = String(id || '').trim().toLowerCase();
    return text === 'comfly' ? 'runninghub' : String(id || '').trim();
}
function providerDisplayName(provider){
    if(!provider) return '';
    if(provider.id === 'runninghub' || String(provider.id || '').toLowerCase() === 'comfly') return 'RunningHub';
    return provider.name || provider.label || provider.id || '';
}
function isRunningHubProvider(provider){
    const id = String(provider?.id || '').trim().toLowerCase();
    const protocol = String(provider?.protocol || '').trim().toLowerCase();
    const name = String(provider?.name || '').trim().toLowerCase();
    return id === 'runninghub' || protocol === 'runninghub' || name === 'runninghub' || id === 'rh';
}
function normalizeProviderId(value){
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 40);
}
function imageApiProviders(){
    const seen = new Set();
    return (apiProviders.length ? apiProviders : defaultApiProviders())
        .map(p => {
            const rawId = String(p?.id || '').trim().toLowerCase();
            if(rawId === 'comfly'){
                return siteImageProviderEntry({
                    ...p,
                    image_models: uniqueModels([...(p.image_models || []), ...imageModels]),
                });
            }
            if(rawId === 'runninghub') return {...p, id: 'runninghub', name: 'RunningHub'};
            return p;
        })
        .filter(p => {
            if(p.id === 'modelscope' || p.enabled === false) return false;
            if(!(p.image_models || []).length) return false;
            if(seen.has(p.id)) return false;
            seen.add(p.id);
            return true;
        });
}
function providerById(id){
    const normalized = legacyImageProviderId(id);
    const list = apiProviders.length ? apiProviders : defaultApiProviders();
    return list.find(p => p.id === normalized)
        || list.find(p => String(p.id || '').toLowerCase() === 'comfly' && normalized === 'runninghub')
        || imageApiProviders()[0]
        || defaultApiProviders()[0];
}
function resolveProviderId(id){
    return providerById(id)?.id || 'runninghub';
}
function chatApiProviders(){
    const providers = (apiProviders.length ? apiProviders : defaultApiProviders())
        .filter(p => p.enabled !== false && (p.chat_models || []).length);
    return providers.length ? providers : defaultApiProviders();
}
function resolveChatProviderId(id){
    const providers = chatApiProviders();
    return providers.find(p => p.id === id)?.id || providers[0]?.id || 'comfly';
}
function chatProviderOptions(selectedId){
    const selected = resolveChatProviderId(selectedId);
    return chatApiProviders().map(provider => `<option value="${escapeHtml(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${escapeHtml(provider.name || provider.id)}</option>`).join('');
}
function providerChatModels(providerId){
    const provider = apiProviders.find(p => p.id === providerId);
    return uniqueModels(provider?.chat_models || []);
}
function resolveImageProviderId(id){
    const providers = imageApiProviders();
    const normalized = legacyImageProviderId(id);
    return providers.find(p => p.id === normalized)?.id || providers[0]?.id || '';
}
function providerOptions(selectedId){
    const selected = resolveImageProviderId(selectedId);
    const providers = imageApiProviders();
    if(!providers.length) return `<option value="" disabled selected>${tr('canvas.noApiProviders') || '暂无 API 平台'}</option>`;
    return providers.map(provider => `<option value="${escapeHtml(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${escapeHtml(providerDisplayName(provider))}</option>`).join('');
}
function providerImageModels(providerId){
    // 不走 providerById（会 fallback 到第一个 provider，造成串台），直接查精确匹配
    const normalized = legacyImageProviderId(providerId);
    let provider = apiProviders.find(p => p.id === normalized);
    if(!provider && normalized === 'runninghub'){
        provider = apiProviders.find(p => String(p.id || '').toLowerCase() === 'comfly');
    }
    return uniqueModels(provider?.image_models || imageModels);
}
function videoApiProviders(){
    const providers = (apiProviders.length ? apiProviders : defaultApiProviders())
        .filter(p => p.id !== 'modelscope' && !isRunningHubProvider(p) && p.enabled !== false);
    return providers.length ? providers : defaultApiProviders();
}
function resolveVideoProviderId(id){
    const providers = videoApiProviders();
    return providers.find(p => p.id === id)?.id || providers[0]?.id || 'comfly';
}
function videoProviderOptions(selectedId){
    const selected = resolveVideoProviderId(selectedId);
    return videoApiProviders().map(provider => `<option value="${escapeHtml(provider.id)}" ${provider.id === selected ? 'selected' : ''}>${escapeHtml(provider.name || provider.id)}</option>`).join('');
}
function providerVideoModels(providerId){
    // 不走 providerById（会 fallback 到第一个 provider，造成串台），直接查精确匹配
    const provider = apiProviders.find(p => p.id === providerId);
    return uniqueModels(provider?.video_models || []);
}
function videoModelOptions(selectedModel, providerId){
    const models = providerVideoModels(providerId);
    if(!models.length){
        return `<option value="" disabled selected>${tr('canvas.noModelsHint') || '暂无模型，请到 API 设置添加'}</option>`;
    }
    const selected = selectedModel || models[0];
    return uniqueModels([selected, ...models]).filter(Boolean).map(model => `<option value="${escapeHtml(model)}" ${model === selected ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('');
}
function allImageModels(providerId){
    const providerModels = providerImageModels(providerId || managedProviderId);
    return uniqueModels(providerModels);
}
function modelscopeImageModels(selected = ''){
    const provider = (apiProviders.length ? apiProviders : []).find(p => p.id === 'modelscope');
    return uniqueModels([
        selected,
        ...((provider?.image_models || []).length ? provider.image_models : []),
        'Tongyi-MAI/Z-Image-Turbo',
        'black-forest-labs/FLUX.2-klein-9B'
    ]);
}
function modelscopeImageModelOptions(selectedModel){
    const selectedValue = selectedModel || modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo';
    return modelscopeImageModels(selectedValue).map(model => `<option value="${escapeHtml(model)}" ${model === selectedValue ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('');
}
function currentMsModelId(modelKey, node){
    if(modelKey === 'custom') return node.msCustomModel || modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo';
    return (MS_GEN_MODELS[modelKey] || MS_GEN_MODELS.zimage).modelId;
}
function modelscopeLorasForModel(modelId){
    const provider = (apiProviders.length ? apiProviders : []).find(p => p.id === 'modelscope');
    const list = Array.isArray(provider?.ms_loras) ? provider.ms_loras : [];
    return list.filter(lora =>
        lora && lora.enabled !== false &&
        String(lora.id || '').trim() &&
        String(lora.target_model || lora.model || '').trim() === String(modelId || '').trim()
    );
}
function modelscopeLoraOptions(loras, selectedId){
    return loras.map(lora => {
        const id = String(lora.id || '').trim();
        const label = String(lora.name || id).trim();
        return `<option value="${escapeHtml(id)}" ${id === selectedId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
}
function allChatModels(){
    const providerModels = chatApiProviders().flatMap(p => p.chat_models || []);
    return uniqueModels(hasManagedChatModels ? localChatModels : [...providerModels, ...chatModels, ...localChatModels]);
}
function resolveImageModel(value){
    if(value === 'gpt') return models.gpt;
    if(value === 'nano') return models.nano;
    return normalizeLegacyImageModelId(value) || allImageModels(managedProviderId)[0] || models.gpt;
}
function normalizedImageQuality(value){
    const quality = String(value || 'auto').trim().toLowerCase();
    return ['low','medium','high'].includes(quality) ? quality : '';
}
function resolveChatModel(value, providerId=''){
    const providerModels = providerId ? providerChatModels(providerId) : [];
    return value || providerModels[0] || allChatModels()[0] || chatModels[0] || 'gpt-4o-mini';
}
/** 画布 Agent 文本模型：仅保留有有效 API 路由的模型 */
const CANVAS_AGENT_TEXT_MODELS = ['gemini-3.5-flash', 'glm-5.1'];
function clampAgentTextModel(value){
    const saved = String(value || '').trim();
    return CANVAS_AGENT_TEXT_MODELS.includes(saved) ? saved : CANVAS_AGENT_TEXT_MODELS[0];
}
function defaultAgentChatModel(){
    return CANVAS_AGENT_TEXT_MODELS[0];
}
function agentTextModelOptions(selected){
    const sel = clampAgentTextModel(selected);
    return CANVAS_AGENT_TEXT_MODELS.map(model => `<option value="${escapeHtml(model)}" ${model === sel ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('');
}
function resolveReplicaAgentTextModel(node){
    return clampAgentTextModel(node?.textModel || node?.gemini_model);
}
function resolveImageRepairAgentTextModel(node){
    return clampAgentTextModel(node?.textModel);
}
function resolveImageRepairAgentImageModel(node){
    const saved = String(node?.imageModel || '').trim();
    return resolveImageModel(saved || models.gpt || 'gpt-image-2');
}
function imageRepairAgentImageModelOptions(node){
    const providerId = resolveImageProviderId(imageApiProviders()[0]?.id || managedProviderId);
    const all = allImageModels(providerId);
    const gpt = all.find(m => /^gpt-image-2$/i.test(String(m || '').trim())) || models.gpt || 'gpt-image-2';
    const nano = all.find(m => /^nano-banana-pro$/i.test(String(m || '').trim())) || models.nano || 'nano-banana-pro';
    const list = uniqueModels([gpt, nano]);
    const selected = resolveImageRepairAgentImageModel(node);
    return list.map(model => `<option value="${escapeHtml(model)}" ${model === selected ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('');
}
function resolveBatchPosterChatModel(node){
    return clampAgentTextModel(node?.model);
}
function humanizeCanvasGenerationError(raw){
    const text = String(raw || '').trim();
    if(!text) return tr('canvas.generationFailed');
    if(/content security audit did not pass|内容安全审查未通过/i.test(text)) return tr('canvas.contentSecurityRejected');
    const jsonStart = text.indexOf('{');
    if(jsonStart >= 0){
        try {
            const parsed = JSON.parse(text.slice(jsonStart));
            const msg = String(parsed?.errorMessage || parsed?.message || '').trim();
            if(/content security|内容安全/i.test(msg)) return tr('canvas.contentSecurityRejected');
            if(msg) return msg;
        } catch { /* keep fallback */ }
    }
    return text.length > 280 ? `${text.slice(0, 280)}…` : text;
}
function showErrorModal(message, title=tr('canvas.generationFailed')){
    if(!errorModal || !errorMessage){
        setStatus(String(message || title || ''));
        return;
    }
    errorTitle.textContent = title || tr('canvas.generationFailed');
    errorMessage.textContent = message || title;
    errorModal.classList.add('open');
    refreshIcons();
}
/** 轻量反馈：优先状态栏，避免系统 alert 打断心流 */
function softAlert(message){
    const text = String(message || '').trim();
    if(!text) return;
    setStatus(text);
    if(errorModal?.classList.contains('open')) return;
}
function apiErrorMessage(data, fallback='请求失败'){
    if(!data) return fallback;
    if(typeof data === 'string') return data || fallback;
    const detail = data.detail ?? data.error ?? data.message;
    if(typeof detail === 'string') return detail || fallback;
    if(Array.isArray(detail)){
        const messages = detail.map(item => {
            if(typeof item === 'string') return item;
            const loc = Array.isArray(item?.loc) ? item.loc.filter(x => x !== 'body').join('.') : '';
            const msg = item?.msg || item?.message || JSON.stringify(item);
            return loc ? `${loc}: ${msg}` : msg;
        }).filter(Boolean);
        return messages.join('\n') || fallback;
    }
    if(detail && typeof detail === 'object'){
        return detail.message || detail.msg || JSON.stringify(detail);
    }
    try {
        return JSON.stringify(data);
    } catch(e) {
        return fallback;
    }
}
async function responseErrorMessage(response, fallback='请求失败'){
    try {
        const data = await response.clone().json();
        return apiErrorMessage(data, fallback);
    } catch(e) {
        try {
            const text = await response.text();
            return text || fallback;
        } catch(_) {
            return fallback;
        }
    }
}
function closeErrorModal(){
    if(errorModal) errorModal.classList.remove('open');
}
async function copyErrorMessage(){
    const text = errorMessage?.textContent || '';
    if(!text) return;
    try {
        await navigator.clipboard.writeText(text);
    } catch(e) {
        const range = document.createRange();
        range.selectNodeContents(errorMessage);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
    }
}
async function copyTextToClipboard(text){
    const value = String(text || '');
    if(!value) return false;
    try {
        if(navigator.clipboard?.writeText){
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch(_) {}
    try {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        ta.style.top = '0';
        canvasRoot.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand('copy');
        ta.remove();
        return ok;
    } catch(_) {
        return false;
    }
}
function parseRatioValue(value){
    const raw = String(value || '').trim();
    if(!raw) return null;
    if(raw.includes(':')){
        const [w,h] = raw.split(':').map(Number);
        if(w > 0 && h > 0) return w / h;
    }
    const n = Number(raw);
    return n > 0 ? n : null;
}
function parseSizeValue(value){
    const match = String(value || '').trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/);
    return match ? {width:match[1], height:match[2]} : null;
}
function gcdInt(a, b){
    a = Math.abs(Math.round(Number(a) || 0));
    b = Math.abs(Math.round(Number(b) || 0));
    while(b){ const t = b; b = a % b; a = t; }
    return a || 1;
}
function ratioPartsFromDimensions(width, height){
    const w = Math.max(1, Math.round(Number(width) || 1));
    const h = Math.max(1, Math.round(Number(height) || 1));
    const target = w / h;
    let best = {width:1, height:1, score:Infinity};
    const maxPart = 21;
    for(let rw = 1; rw <= maxPart; rw++){
        for(let rh = 1; rh <= maxPart; rh++){
            const ratio = rw / rh;
            const relativeError = Math.abs(ratio - target) / target;
            const complexityPenalty = Math.max(rw, rh) * 0.0008;
            const score = relativeError + complexityPenalty;
            if(score < best.score) best = {width:rw, height:rh, score};
        }
    }
    const g = gcdInt(best.width, best.height);
    return {width:best.width / g, height:best.height / g};
}
function apiImageSize(ratioValue, resolutionValue, customRatioValue = '', customSizeValue = ''){
    if(resolutionValue === 'custom') return String(customSizeValue || '').trim();
    const resolutionKey = resolutionValue || '1k';
    if(ratioValue === 'custom' || ratioValue === 'source'){
        const parsed = parseRatioValue(customRatioValue);
        const longSide = RES_LONG_SIDE[resolutionKey] || 1024;
        if(parsed){
            const pixelLimit = RES_PIXEL_LIMIT[resolutionKey] || (longSide * longSide);
            const rawWidth = parsed >= 1 ? longSide : Math.min(longSide * parsed, Math.sqrt(pixelLimit * parsed));
            const rawHeight = parsed >= 1 ? Math.min(longSide / parsed, Math.sqrt(pixelLimit / parsed)) : longSide;
            const width = Math.floor(rawWidth / 16) * 16;
            const height = Math.floor(rawHeight / 16) * 16;
            return `${Math.max(64, width)}x${Math.max(64, height)}`;
        }
    }
    const ratioKey = ratioValue && SIZE_MAP[ratioValue] ? ratioValue : 'square';
    return SIZE_MAP[ratioKey]?.[resolutionKey] || SIZE_MAP.square[resolutionKey] || SIZE_MAP.square['1k'];
}
function parseSizePair(value){
    const match = String(value || '').match(/(\d+)\s*x\s*(\d+)/i);
    return match ? {width:Number(match[1]), height:Number(match[2])} : null;
}
function nearestFourKSizeFor(width, height){
    const w = Math.max(1, Number(width) || 1);
    const h = Math.max(1, Number(height) || 1);
    const ratio = w / h;
    let best = null;
    Object.entries(SIZE_MAP).forEach(([key, values]) => {
        const size = parseSizePair(values?.['4k']);
        if(!size) return;
        const score = Math.abs(Math.log(ratio / (size.width / size.height)));
        if(!best || score < best.score) best = {...size, key, score};
    });
    return best;
}
function exceedsFourKStandard(width, height){
    const standard = nearestFourKSizeFor(width, height);
    if(!standard) return false;
    return Number(width) > standard.width || Number(height) > standard.height;
}
const GENERATOR_ALL_RATIO_KEYS = ['square','portrait','landscape','portrait43','landscape43','story','wide','source','custom'];
const GENERATOR_ALL_RESOLUTION_KEYS = ['1k','2k','4k','custom'];
const GENERATOR_G2_RATIO_KEYS = ['square','portrait','landscape','portrait43','landscape43','story','wide'];
const GENERATOR_MJ_V81_RATIO_KEYS = ['square','landscape43','landscape','wide','portrait43','portrait','story'];
function isMidjourneyV81Model(model){
    return /^midjourneyv8\.1$/i.test(String(resolveImageModel(model) || '').trim());
}
function isNiji7Model(model){
    return /^niji7$/i.test(String(resolveImageModel(model) || '').trim());
}
function isYouchuanRhModel(model){
    return isMidjourneyV81Model(model) || isNiji7Model(model);
}
function clampGenInt(value, min, max, fallback){
    const n = Number(value);
    if(!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
}
function clampGenFloat(value, min, max, fallback){
    const n = Number(value);
    if(!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}
function ensureYouchuanNodeDefaults(node){
    if(!node || !isYouchuanRhModel(node.model)) return;
    node.mjChaos = clampGenInt(node.mjChaos, 0, 100, 0);
    node.mjStylize = clampGenInt(node.mjStylize, 0, 1000, 0);
    node.mjSw = clampGenInt(node.mjSw, 0, 1000, 100);
    node.mjRaw = Boolean(node.mjRaw);
    if(isMidjourneyV81Model(node.model)){
        node.mjQuality = String(node.mjQuality || '1') === '4' ? '4' : '1';
        node.mjIw = clampGenFloat(node.mjIw, 0, 3, 1);
        node.mjSv = 6;
        node.mjHd = Boolean(node.mjHd);
    }
    if(isNiji7Model(node.model)){
        node.mjWeird = clampGenInt(node.mjWeird, 0, 3000, 0);
        node.mjIw = clampGenFloat(node.mjIw, 0, 2, 1);
        node.mjSv = clampGenInt(node.mjSv, 1, 4, 4);
    }
}
function isGptImage2Model(model){
    return /^gpt-image-2$/i.test(String(resolveImageModel(model) || '').trim());
}
function normalizeLegacyImageModelId(value){
    const v = String(value || '').trim();
    if(v === 'nano-banana-pro-2k') return 'nano-banana-pro-稳定';
    return v;
}
function generatorModelCaps(model){
    if(isMidjourneyV81Model(model)){
        return {
            profile: 'midjourney-v81',
            ratioKeys: GENERATOR_MJ_V81_RATIO_KEYS,
            resolutionKeys: [],
            showQuality: false,
            showYouchuanPanel: true,
            showMjQuality: true,
            showMjHd: true,
            showWeird: false,
            showSvSelect: false,
            iwMax: 3,
            mjQualityValues: ['1','4'],
            defaultMjQuality: '1',
            qualityValues: null,
            defaultQuality: '',
        };
    }
    if(isNiji7Model(model)){
        return {
            profile: 'niji7',
            ratioKeys: GENERATOR_MJ_V81_RATIO_KEYS,
            resolutionKeys: [],
            showQuality: false,
            showYouchuanPanel: true,
            showMjQuality: false,
            showMjHd: false,
            showWeird: true,
            showSvSelect: true,
            iwMax: 2,
            qualityValues: null,
            defaultQuality: '',
        };
    }
    if(isGptImage2Model(model)){
        return {
            profile: 'gpt-image-2',
            ratioKeys: GENERATOR_G2_RATIO_KEYS,
            resolutionKeys: ['1k','2k','4k'],
            showQuality: true,
            showYouchuanPanel: false,
            showMjQuality: false,
            qualityValues: ['low','medium','high'],
            defaultQuality: 'medium',
        };
    }
    return {
        profile: 'standard',
        ratioKeys: GENERATOR_ALL_RATIO_KEYS,
        resolutionKeys: GENERATOR_ALL_RESOLUTION_KEYS,
        showQuality: false,
        showYouchuanPanel: false,
        showMjQuality: false,
        qualityValues: null,
        defaultQuality: '',
    };
}
function normalizeApiNodeSizeChoice(node){
    if(!node || node.type !== 'generator') return;
    const caps = generatorModelCaps(node.model);
    ensureYouchuanNodeDefaults(node);
    const resolution = String(node.resolution || '1k').trim().toLowerCase();
    if(caps.resolutionKeys.length && !caps.resolutionKeys.includes(resolution)){
        node.resolution = caps.resolutionKeys.includes('2k') ? '2k' : (caps.resolutionKeys[0] || '1k');
        node.customSize = '';
        node.customWidth = '';
        node.customHeight = '';
    }
    if(node.resolution === 'custom'){
        node.ratio = '';
        return;
    }
    const ratio = String(node.ratio || 'square').trim();
    if(!caps.ratioKeys.includes(ratio)){
        node.ratio = caps.ratioKeys.includes('square') ? 'square' : (caps.ratioKeys[0] || 'square');
        node.customRatio = '';
        node.customRatioWidth = '';
        node.customRatioHeight = '';
    }
    if(caps.showQuality){
        const q = String(node.quality || caps.defaultQuality || 'medium').trim().toLowerCase();
        node.quality = (caps.qualityValues || []).includes(q) ? q : (caps.defaultQuality || 'medium');
    } else {
        node.quality = 'auto';
    }
    if(caps.showMjQuality){
        node.mjQuality = String(node.mjQuality || caps.defaultMjQuality || '1') === '4' ? '4' : '1';
    }
    if(!caps.resolutionKeys.length){
        node.customSize = '';
        node.customWidth = '';
        node.customHeight = '';
    }
}
async function generatorSizeForRun(gen, refs){
    if((gen.ratio || 'square') === 'source'){
        const ref = refs?.[0];
        if(ref?.url){
            try {
                const dims = await getImageDimensions(ref.url);
                const parts = ratioPartsFromDimensions(dims.width, dims.height);
                gen.customRatioWidth = String(parts.width);
                gen.customRatioHeight = String(parts.height);
                gen.customRatio = `${parts.width}:${parts.height}`;
            } catch(_) {}
        }
    }
    const ratio = (gen.ratio === 'source' && !gen.customRatio)
        ? 'square'
        : (gen.ratio ?? 'square');
    return apiImageSize(ratio, gen.resolution || '1k', gen.customRatio || '', gen.customSize || '');
}
function normalizeApiNodeLayout(node){
    if(!node || node.type !== 'generator') return;
    if(Number(node.w || 0) === 418) node.w = 380;
    if(node.h || Math.abs(Number(node.w || 380) - 380) > 1) node._userSized = true;
}
const GENERATOR_BASE_W = 380;
const GENERATOR_MIN_W = 220;
function generatorUiScale(node){
    return Number(node.w || GENERATOR_BASE_W) / GENERATOR_BASE_W;
}
function measureGeneratorBaseFrame(node, el){
    const scaleWrap = el?.querySelector('.generator-node-scale');
    if(!scaleWrap) return Number(node._baseFrameH || 320);
    return Math.max(96, Math.ceil(scaleWrap.scrollHeight + 8));
}
function syncGeneratorNodeScale(node, el){
    if(!el || node.type !== 'generator') return 1;
    const scale = generatorUiScale(node);
    el.style.setProperty('--generator-ui-scale', String(scale));
    return scale;
}
function syncGeneratorNodeFrame(node, el){
    if(!el || node.type !== 'generator') return;
    const scale = syncGeneratorNodeScale(node, el);
    if(!node._baseFrameH) node._baseFrameH = measureGeneratorBaseFrame(node, el);
    const isManual = Boolean(node._userSized || Math.abs(scale - 1) > 0.01);
    if(!isManual){
        node.w = GENERATOR_BASE_W;
        delete node.h;
        el.style.width = `${GENERATOR_BASE_W}px`;
        el.style.height = '';
        el.classList.remove('sized');
        return;
    }
    node.w = Math.max(GENERATOR_MIN_W, Math.round(Number(node.w || GENERATOR_BASE_W)));
    node.h = Math.max(96, Math.round(Number(node._baseFrameH || 320) * generatorUiScale(node)));
    el.classList.add('sized');
    el.style.width = `${node.w}px`;
    el.style.height = `${node.h}px`;
}
function rebaseGeneratorFrame(node){
    const el = nodesEl?.querySelector(`.node[data-id="${node.id}"]`);
    if(!el) return;
    const prevW = node.w;
    const prevSized = node._userSized;
    const prevScale = generatorUiScale(node);
    el.style.setProperty('--generator-ui-scale', '1');
    el.style.width = `${GENERATOR_BASE_W}px`;
    node.w = GENERATOR_BASE_W;
    requestAnimationFrame(() => {
        node._baseFrameH = measureGeneratorBaseFrame(node, el);
        if(prevSized || Math.abs(prevScale - 1) > 0.01){
            node._userSized = true;
            node.w = Math.max(GENERATOR_MIN_W, Number(prevW || GENERATOR_BASE_W));
        }
        syncGeneratorNodeFrame(node, el);
    });
}
function fitGeneratorNodeHeight(node){
    if(!node || node.type !== 'generator') return;
    const el = nodesEl?.querySelector(`.node[data-id="${node.id}"]`);
    if(!el) return;
    if(node._baseFrameH) syncGeneratorNodeFrame(node, el);
    else requestAnimationFrame(() => {
        node._baseFrameH = measureGeneratorBaseFrame(node, el);
        syncGeneratorNodeFrame(node, el);
    });
}
function imageModelOptions(selectedModel, providerId){
    if(!imageApiProviders().length){
        return `<option value="" disabled selected>${tr('canvas.noApiProvidersHint') || '暂无 API 平台，请到 API 设置添加'}</option>`;
    }
    const models = allImageModels(providerId);
    if(!models.length){
        return `<option value="" disabled selected>${tr('canvas.noImageModelsHint') || '暂无生图模型，请到 API 设置添加'}</option>`;
    }
    const selectedValue = resolveImageModel(selectedModel);
    const options = models.map(model => `<option value="${escapeHtml(model)}" ${model === selectedValue ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('');
    const hasSelected = models.includes(selectedValue);
    return `${hasSelected || !selectedValue ? '' : `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>`}${options}`;
}
function chatModelOptions(selectedModel, providerId=''){
    const models = providerId ? providerChatModels(providerId) : allChatModels();
    if(!models.length){
        return `<option value="" disabled selected>${tr('canvas.noModelsHint') || '暂无模型，请到 API 设置添加'}</option>`;
    }
    const selectedValue = resolveChatModel(selectedModel, providerId);
    const options = models.map(model => `<option value="${escapeHtml(model)}" ${model === selectedValue ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('');
    const hasSelected = models.includes(selectedValue);
    return `${hasSelected || !selectedValue ? '' : `<option value="${escapeHtml(selectedValue)}" selected>${escapeHtml(selectedValue)}</option>`}${options}`;
}
function formatCanvasTime(value){
    if(!value) return '--';
    const raw = Number(value);
    const time = raw < 10000000000 ? raw * 1000 : raw;
    const date = new Date(time);
    if(Number.isNaN(date.getTime())) return '--';
    return date.toLocaleString(window.StudioI18n?.lang() === 'en' ? 'en-US' : 'zh-CN', { month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}
function formatCanvasCreatedLabel(value){
    if(!value) return '--';
    const raw = Number(value);
    const time = raw < 10000000000 ? raw * 1000 : raw;
    const date = new Date(time);
    if(Number.isNaN(date.getTime())) return '--';
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${d} ${hh}:${mm}`;
}
function formatCanvasEditedLabel(value){
    if(!value) return langIsEn() ? 'Edited --' : '编辑于 --';
    const raw = Number(value);
    const time = raw < 10000000000 ? raw * 1000 : raw;
    const date = new Date(time);
    if(Number.isNaN(date.getTime())) return langIsEn() ? 'Edited --' : '编辑于 --';
    const diff = Date.now() - date.getTime();
    if(diff < 0) return langIsEn() ? 'Edited just now' : '编辑于 刚刚';
    const sec = Math.floor(diff / 1000);
    if(langIsEn()){
        if(sec < 60) return 'Edited just now';
        const min = Math.floor(sec / 60);
        if(min < 60) return `Edited ${min} min ago`;
        const hr = Math.floor(min / 60);
        if(hr < 24) return `Edited ${hr} hr ago`;
        const day = Math.floor(hr / 24);
        if(day < 30) return `Edited ${day} d ago`;
        return `Edited ${formatCanvasTime(value)}`;
    }
    if(sec < 60) return '编辑于 几秒前';
    const min = Math.floor(sec / 60);
    if(min < 60) return `编辑于 ${min} 分钟前`;
    const hr = Math.floor(min / 60);
    if(hr < 24) return `编辑于 ${hr} 小时前`;
    const day = Math.floor(hr / 24);
    if(day < 30) return `编辑于 ${day} 天前`;
    return `编辑于 ${formatCanvasTime(value)}`;
}
function setStatus(text){
    const saveEl = domGet('saveState');
    if(saveEl) saveEl.textContent = text;
    if(gateStatus) gateStatus.textContent = text;
    setGateFeedback(text);
}
function setGateFeedback(text){
    if(!gateSubtitle || !shell?.classList?.contains('no-canvas')) return;
    if(trashMode) return;
    const msg = String(text || '').trim();
    const isError = /失败|failed|error|错误/i.test(msg);
    if(!isError){
        gateSubtitle.hidden = true;
        gateSubtitle.classList.remove('is-visible');
        gateSubtitle.textContent = '';
        gateSubtitle.style.color = '';
        return;
    }
    gateSubtitle.hidden = false;
    gateSubtitle.classList.add('is-visible');
    gateSubtitle.textContent = msg;
    gateSubtitle.style.color = '#dc2626';
}
function refreshGateViewControls(){
    canvasGate.classList.toggle('trash-mode', trashMode);
    if(gateTitleText) gateTitleText.textContent = trashMode ? tr('canvas.trash') : tr('canvas.selectCanvas');
    if(gateSubtitle){
        if(trashMode){
            gateSubtitle.hidden = false;
            gateSubtitle.classList.add('is-visible');
            gateSubtitle.textContent = tr('canvas.trashSubtitle');
            gateSubtitle.style.color = '';
        } else if(!gateSubtitle.classList.contains('is-feedback')){
            gateSubtitle.hidden = true;
            gateSubtitle.classList.remove('is-visible');
            gateSubtitle.textContent = '';
            gateSubtitle.style.color = '';
        }
    }
    const trashCount = deletedCanvases.length;
    if(gateTrashCount){
        gateTrashCount.textContent = String(trashCount);
        gateTrashCount.classList.toggle('visible', trashCount > 0);
    }
    const countPill = domGet('gateCountPill');
    if(countPill){
        const items = trashMode ? deletedCanvases : canvases;
        const suffix = tr('canvas.countSuffix');
        countPill.textContent = suffix ? `${items.length} ${suffix}` : String(items.length);
    }
    if(gateUncategorizedCount && !trashMode){
        const inCol = new Set();
        canvasCollections.forEach(col => (col.canvas_ids || []).forEach(id => inCol.add(id)));
        const uncat = canvases.filter(c => !inCol.has(c.id)).length;
        gateUncategorizedCount.textContent = String(uncat);
    }
    // 智能画布尚未接入本站，隐藏入口避免与经典「新建画布」混用、也避免有时看见有时没有
    if(gateCreateSmartBtn) gateCreateSmartBtn.hidden = true;
    if(gateCreateCollectionBtn) gateCreateCollectionBtn.hidden = trashMode;
    syncGateToolbarUi();
}
function notifySmartCanvasUnavailable(){
    const msg = langIsEn()
        ? 'Smart canvas is not available on this site yet. Use "New canvas" to create a classic canvas.'
        : '智能画布尚未接入本站，请使用「新建画布」创建经典画布。';
    showErrorModal(msg, langIsEn() ? 'Smart canvas' : '智能画布');
    setStatus(msg);
}
function setCanvasMode(open, { clearEditor = false, force = false } = {}){
    const liveShell = resolveLiveShell();
    if(!liveShell) return;
    if(!open && canvas && !force) return;
    if(!open){
        if(!force && !gateViewRequested) return;
        if(!force && shouldBlockCanvasGateTransition()) return;
        if(!force && clearEditor && canvas) return;
    } else {
        gateViewRequested = false;
    }
    const wasEditor = !liveShell.classList.contains('no-canvas');
    if(open){
        if(liveShell.classList.contains('no-canvas')) liveShell.classList.remove('no-canvas');
        if(canvas) markCanvasEditorSession(true);
    } else if((force || gateViewRequested) && !shouldKeepEditorShellOpen()){
        if(!liveShell.classList.contains('no-canvas')) liveShell.classList.add('no-canvas');
        markCanvasEditorSession(false);
    }
    try {
        document.body.dataset.infiniteCanvasEditor = open ? '1' : '0';
    } catch(_) {}
    if(!open && clearEditor){
        if(nodesEl) nodesEl.innerHTML = '';
        if(linksEl) linksEl.innerHTML = '';
        if(linkControlsEl) linkControlsEl.innerHTML = '';
    } else if(open && currentCanvasTitle) {
        currentCanvasTitle.textContent = canvas?.title || tr('canvas.untitled');
        currentCanvasTime.textContent = formatCanvasTime(canvas?.updated_at || canvas?.created_at);
    }
    syncCanvasPageMarkers();
    if(wasEditor !== open) refreshIcons();
}
function ensureCanvas(){
    if(canvas) return true;
    setStatus(tr('canvas.needCanvas'));
    return false;
}
function setCreateMode(active, kind='classic'){
    creatingCanvas = active;
    createCanvasKind = active ? ((kind === 'smart') ? 'smart' : 'classic') : 'classic';
    if(active) trashMode = false;
    canvasGate.classList.toggle('creating', active);
    refreshGateViewControls();
    if(!active && gateSubtitle) gateSubtitle.style.color = '';
    setStatus(active ? tr('canvas.enterCanvasName') : (canvases.length ? tr('canvas.chooseFirst') : tr('canvas.noCanvasCreateFirst')));
    if(active) {
        if(gateTitleInput){
            gateTitleInput.placeholder = createCanvasKind === 'smart'
                ? (tr('canvas.newSmartCanvasPlaceholder') || tr('canvas.newCanvasPlaceholder'))
                : tr('canvas.newCanvasPlaceholder');
        }
    } else if(gateTitleInput) {
        gateTitleInput.value = '';
        gateTitleInput.placeholder = tr('canvas.newCanvasPlaceholder');
    }
    renderCanvasList();
    refreshIcons();
}
function screenToWorld(clientX, clientY){
    if(!board) return { x:0, y:0 };
    const rect = board.getBoundingClientRect();
    const scale = viewport.scale || 1;
    return {
        x:(clientX - rect.left - viewport.x) / scale,
        y:(clientY - rect.top - viewport.y) / scale,
    };
}
/** 仅阻止浏览器中键自动滚动；不可 stopPropagation，否则 board 收不到中键按下 */
function preventCanvasMiddleMouseDefault(e){
    if(e.button !== 1) return;
    const inShell = e.target?.closest?.('.infinite-canvas-root, .infinite-canvas-host, .infinite-canvas-page');
    if(inShell) e.preventDefault();
}
function applyViewport(){
    if(!world) return;
    world.style.transform = `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`;
    if(minimapState) updateMinimapViewport();
    else scheduleMinimapRender();
    notifyViewportScaleChange();
    scheduleViewportNodeCull();
}
/** 视口外节点 visibility:hidden（保留布局，避免连线端点错位） */
function scheduleViewportNodeCull(){
    if(!nodesEl || !board) return;
    if(viewportCullRaf) return;
    viewportCullRaf = requestAnimationFrame(() => {
        viewportCullRaf = 0;
        cullNodesOutsideViewport();
    });
}
function cullNodesOutsideViewport(){
    if(!nodesEl || !board || !canvas) return;
    const view = currentWorldViewRect();
    const pad = VIEWPORT_CULL_PAD / Math.max(0.01, viewport.scale || 1);
    const minX = view.x - pad;
    const minY = view.y - pad;
    const maxX = view.x + view.w + pad;
    const maxY = view.y + view.h + pad;
    nodesEl.querySelectorAll('.node').forEach(el => {
        const id = el.dataset?.id;
        const node = id ? nodes.find(n => n.id === id) : null;
        if(!node){
            el.style.visibility = '';
            return;
        }
        const r = estimatedNodeRect(node);
        const visible = r.x + r.w >= minX && r.x <= maxX && r.y + r.h >= minY && r.y <= maxY;
        el.style.visibility = visible ? '' : 'hidden';
    });
}
/** 与 infinite-canvas.css .port 定位一致：圆点中心在节点边缘外 var(--port-dot-outset) */
const PORT_DOT_OUTSET = 12;
const PORT_ANCHOR_DX = { in: -PORT_DOT_OUTSET, out: PORT_DOT_OUTSET };

/** 端口圆点"磁吸"效果：鼠标靠近圆点时圆点跟随吸附，移开后弹簧回位 */
const PORT_MAGNET_RADIUS = 68; // 屏幕像素，超出此半径不产生吸附
const PORT_MAGNET_MAX_PULL = 20; // 屏幕像素，圆点被吸附的最大位移
let portMagnetMouse = null;
let portMagnetRAF = 0;
const portMagnetActivePorts = new Set();
function resetPortMagnet(port){
    port.classList.remove('is-magnetic');
    const dot = port.querySelector('.port-dot');
    if(dot){
        dot.style.removeProperty('--dot-x');
        dot.style.removeProperty('--dot-y');
    }
}
function clearAllPortMagnet(){
    portMagnetMouse = null;
    if(portMagnetRAF){
        cancelAnimationFrame(portMagnetRAF);
        portMagnetRAF = 0;
    }
    portMagnetActivePorts.forEach(resetPortMagnet);
    portMagnetActivePorts.clear();
}
function runPortMagnetUpdate(){
    portMagnetRAF = 0;
    const mouse = portMagnetMouse;
    if(!mouse || !nodesEl){
        clearAllPortMagnet();
        return;
    }
    const scale = viewport.scale || 1;
    const world = screenToWorld(mouse.x, mouse.y);
    const radiusWorld = PORT_MAGNET_RADIUS / scale + 28;
    const stillActive = new Set();
    nodes.forEach(n => {
        const rect = estimatedNodeRect(n);
        if(world.x < rect.x - radiusWorld || world.x > rect.x + rect.w + radiusWorld ||
            world.y < rect.y - radiusWorld || world.y > rect.y + rect.h + radiusWorld) return;
        const el = nodesEl.querySelector(`.node[data-id="${CSS.escape(n.id)}"]`);
        if(!el) return;
        el.querySelectorAll('.port').forEach(port => {
            const dot = port.querySelector('.port-dot');
            if(!dot) return;
            const r = port.getBoundingClientRect();
            const cx = r.left + r.width / 2;
            const cy = r.top + r.height / 2;
            const dx = mouse.x - cx;
            const dy = mouse.y - cy;
            const dist = Math.hypot(dx, dy);
            if(dist > PORT_MAGNET_RADIUS){
                if(portMagnetActivePorts.has(port)) resetPortMagnet(port);
                return;
            }
            const t = 1 - dist / PORT_MAGNET_RADIUS;
            const eased = t * t * (3 - 2 * t); // smoothstep：越靠近圆心吸附越强
            const pull = Math.min(dist, PORT_MAGNET_MAX_PULL) * eased;
            const ux = dist ? dx / dist : 0;
            const uy = dist ? dy / dist : 0;
            dot.style.setProperty('--dot-x', `${(ux * pull / scale).toFixed(2)}px`);
            dot.style.setProperty('--dot-y', `${(uy * pull / scale).toFixed(2)}px`);
            port.classList.add('is-magnetic');
            stillActive.add(port);
        });
    });
    portMagnetActivePorts.forEach(port => { if(!stillActive.has(port)) resetPortMagnet(port); });
    portMagnetActivePorts.clear();
    stillActive.forEach(p => portMagnetActivePorts.add(p));
}
function schedulePortMagnetUpdate(clientX, clientY){
    portMagnetMouse = { x: clientX, y: clientY };
    if(portMagnetRAF) return;
    portMagnetRAF = requestAnimationFrame(runPortMagnetUpdate);
}
function nodeLayoutSize(n, el){
    const size = defaultNodeSize(n.type);
    const useFast = isCanvasInteracting() || Date.now() - lastBoardInteractionAt < 1200;
    const w = Math.max(1, n.w || (!useFast && el?.offsetWidth) || size.w || 260);
    let h = n.h || (!useFast && el?.offsetHeight) || size.h || 0;
    if(!h || h < 1) h = 160;
    return { w, h: Math.max(1, h) };
}
function estimatedNodeRect(n){
    const el = nodesEl?.querySelector?.(`.node[data-id="${CSS.escape(n.id)}"]`);
    const { w, h } = nodeLayoutSize(n, el);
    return { x: n.x || 0, y: n.y || 0, w, h };
}
function currentWorldViewRect(){
    if(!board){
        const scale = viewport.scale || 1;
        return {x:-viewport.x / scale, y:-viewport.y / scale, w:1200 / scale, h:800 / scale};
    }
    const rect = board.getBoundingClientRect();
    const scale = viewport.scale || 1;
    return {
        x:-viewport.x / scale,
        y:-viewport.y / scale,
        w:Math.max(1, rect.width) / scale,
        h:Math.max(1, rect.height) / scale
    };
}
function minimapBounds(){
    const rects = (nodes || []).map(estimatedNodeRect);
    rects.push(currentWorldViewRect());
    if(!rects.length) return {x:0, y:0, w:1000, h:700};
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    rects.forEach(r => {
        minX = Math.min(minX, r.x);
        minY = Math.min(minY, r.y);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
    });
    const pad = Math.max(240, Math.max(maxX - minX, maxY - minY) * 0.08);
    return {x:minX - pad, y:minY - pad, w:Math.max(1, maxX - minX + pad * 2), h:Math.max(1, maxY - minY + pad * 2)};
}
function scheduleMinimapRender({ positionsOnly = false } = {}){
    if(minimapRenderQueued) return;
    minimapRenderQueued = true;
    requestAnimationFrame(() => {
        minimapRenderQueued = false;
        if(dragBoard) updateMinimapViewport();
        else if(dragNode || (positionsOnly && minimapState)) updateMinimapNodePositions();
        else renderMinimap();
    });
}
function updateMinimapNodePositions(){
    if(!minimapContent || !minimapState) return;
    const {bounds, scale, ox, oy} = minimapState;
    (nodes || []).forEach(n => {
        const el = minimapContent.querySelector(`.minimap-node[data-node-id="${CSS.escape(n.id)}"]`);
        if(!el) return;
        const r = estimatedNodeRect(n);
        el.style.left = `${ox + (r.x - bounds.x) * scale}px`;
        el.style.top = `${oy + (r.y - bounds.y) * scale}px`;
        el.style.width = `${Math.max(3, r.w * scale)}px`;
        el.style.height = `${Math.max(3, r.h * scale)}px`;
    });
    updateMinimapViewport();
}
function renderMinimap(){
    if(!minimapContent || !minimapViewport) return;
    const bounds = minimapBounds();
    const cw = minimapContent.clientWidth || 172;
    const ch = minimapContent.clientHeight || 110;
    const scale = Math.min(cw / bounds.w, ch / bounds.h);
    const mapW = bounds.w * scale;
    const mapH = bounds.h * scale;
    const ox = (cw - mapW) / 2;
    const oy = (ch - mapH) / 2;
    minimapState = {bounds, scale, ox, oy, cw, ch};
    const nodeHtml = (nodes || []).map(n => {
        const r = estimatedNodeRect(n);
        return `<div class="minimap-node ${selected.has(n.id) ? 'selected' : ''}" data-node-id="${escapeAttr(n.id)}" style="left:${ox + (r.x - bounds.x) * scale}px;top:${oy + (r.y - bounds.y) * scale}px;width:${Math.max(3, r.w * scale)}px;height:${Math.max(3, r.h * scale)}px"></div>`;
    }).join('');
    minimapContent.innerHTML = `${nodeHtml}${nodes?.length ? '' : '<div class="minimap-empty">EMPTY</div>'}<div id="minimapViewport" class="minimap-viewport"></div>`;
    minimapViewport = domGet('minimapViewport');
    updateMinimapViewport();
}
function updateMinimapViewport(){
    if(!minimapViewport || !minimapState) return;
    const r = currentWorldViewRect();
    const {bounds, scale, ox, oy} = minimapState;
    minimapViewport.style.left = `${ox + (r.x - bounds.x) * scale}px`;
    minimapViewport.style.top = `${oy + (r.y - bounds.y) * scale}px`;
    minimapViewport.style.width = `${Math.max(8, r.w * scale)}px`;
    minimapViewport.style.height = `${Math.max(8, r.h * scale)}px`;
}
function minimapEventToWorld(e){
    if(!minimapState) renderMinimap();
    const state = minimapState;
    const rect = minimapContent.getBoundingClientRect();
    const x = (e.clientX - rect.left - state.ox) / state.scale + state.bounds.x;
    const y = (e.clientY - rect.top - state.oy) / state.scale + state.bounds.y;
    return {x, y};
}
function centerViewportOnWorldPoint(point){
    const rect = board.getBoundingClientRect();
    viewport.x = rect.width / 2 - point.x * viewport.scale;
    viewport.y = rect.height / 2 - point.y * viewport.scale;
    applyViewport();
    renderLinks();
}
let favoriteImageHighlightTimer = null;
function clearFavoriteImageHighlight(){
    if(favoriteImageHighlightTimer){
        clearTimeout(favoriteImageHighlightTimer);
        favoriteImageHighlightTimer = null;
    }
    if(nodesEl){
        nodesEl.querySelectorAll('.output-img-wrap.is-favorite-locate-flash').forEach(el => {
            el.classList.remove('is-favorite-locate-flash');
        });
    }
}
function nodeContainsFavoriteImage(node, targetUrl){
    if(!node || !targetUrl) return false;
    if(node.type === 'image' && normalizeFavoritePath(node.url) === targetUrl) return true;
    if(node.type === 'output' || node.type === 'frameStack'){
        return (node.images || []).some(item => normalizeFavoritePath(outputUrlValue(item)) === targetUrl);
    }
    if(Array.isArray(node.generatedOutputs)){
        return node.generatedOutputs.some(url => normalizeFavoritePath(url) === targetUrl);
    }
    return false;
}
function resolveFavoriteTargetNode(nodeId, imageUrl){
    const targetUrl = normalizeFavoritePath(imageUrl);
    if(nodeId){
        const direct = nodes.find(n => n.id === nodeId);
        if(direct && (!targetUrl || nodeContainsFavoriteImage(direct, targetUrl) || direct.type === 'output' || direct.type === 'frameStack')) return direct;
    }
    if(!targetUrl) return nodeId ? nodes.find(n => n.id === nodeId) || null : null;
    for(const node of nodes){
        if(nodeContainsFavoriteImage(node, targetUrl)) return node;
    }
    return nodeId ? nodes.find(n => n.id === nodeId) || null : null;
}
function flashFavoriteOutputImage(nodeId, imageUrl){
    clearFavoriteImageHighlight();
    const targetUrl = normalizeFavoritePath(imageUrl);
    if(!targetUrl || !nodesEl) return;
    const nodeEl = nodesEl.querySelector(`.node[data-id="${CSS.escape(String(nodeId))}"]`);
    if(!nodeEl) return;
    const wraps = nodeEl.querySelectorAll('.output-img-wrap[data-output-url]');
    for(const wrap of wraps){
        const wrapUrl = normalizeFavoritePath(wrap.dataset.outputUrl || wrap.querySelector('img')?.dataset?.url || '');
        if(wrapUrl !== targetUrl) continue;
        wrap.classList.add('is-favorite-locate-flash');
        favoriteImageHighlightTimer = setTimeout(() => {
            wrap.classList.remove('is-favorite-locate-flash');
            favoriteImageHighlightTimer = null;
        }, 4200);
        break;
    }
}
function focusCanvasFavoriteTarget({ nodeId = '', imageUrl = '' } = {}){
    if(!canvas || !board || !nodesEl) return false;
    rebindDomIfStale();
    const node = resolveFavoriteTargetNode(nodeId, imageUrl);
    if(!node){
        setStatus(langIsEn() ? 'Target not found on this canvas' : '未在该画布上找到对应图片');
        return false;
    }
    selected.clear();
    selected.add(node.id);
    refreshSelectionVisuals();
    safeRender({ force: true });
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const box = nodeBounds([node.id]);
            centerViewportOnWorldPoint({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
            flashFavoriteOutputImage(node.id, imageUrl);
            refreshGeometryAfterLayout();
        });
    });
    setStatus(langIsEn() ? 'Located favorite on canvas' : '已定位到画布中的收藏图片');
    return true;
}
export async function consumeQueuedCanvasFavoriteNavigation(){
    const target = readCanvasFavoriteNavigation();
    if(!target?.canvasId) return { ok: false, reason: 'empty' };
    clearCanvasFavoriteNavigation();
    try {
        if(!canvas || canvas.id !== target.canvasId){
            await openCanvas(target.canvasId);
        }
        if(!canvas || canvas.id !== target.canvasId){
            throw new Error(langIsEn() ? 'Canvas unavailable' : '画布不可用');
        }
        const focused = focusCanvasFavoriteTarget(target);
        return { ok: focused, reason: focused ? 'focused' : 'not_found' };
    } catch(err) {
        const msg = err instanceof Error ? err.message : String(err);
        setStatus(langIsEn() ? `Locate failed: ${msg}` : `定位失败：${msg}`);
        showErrorModal(
            langIsEn() ? `Could not open canvas: ${msg}` : `无法打开画布：${msg}`,
            langIsEn() ? 'Locate favorite' : '定位收藏'
        );
        console.error('[infinite-canvas] favorite navigation failed', err);
        return { ok: false, reason: 'error', message: msg };
    }
}
function refreshGeometry(){
    updateLinksGeometry();
}
function bindNodeLayoutObserver(el){
    if(!el || typeof ResizeObserver === 'undefined') return;
    if(!nodeLayoutObserver){
        nodeLayoutObserver = new ResizeObserver(() => {
            clearTimeout(nodeLayoutRefreshTimer);
            nodeLayoutRefreshTimer = setTimeout(() => scheduleLinkGeometryRefresh(), 32);
        });
    }
    if(el._layoutObserved) return;
    el._layoutObserved = true;
    nodeLayoutObserver.observe(el);
}
function refreshGeometryAfterLayout(){
    const token = ++layoutLinkRefreshToken;
    const step = (remaining, waitForIdle) => {
        requestAnimationFrame(() => {
            if(token !== layoutLinkRefreshToken) return;
            if(waitForIdle && isCanvasInteracting()){
                step(remaining, true);
                return;
            }
            if(remaining > 1){
                refreshGeometry();
                step(remaining - 1, false);
            } else if(remaining === 1){
                renderLinks();
            }
        });
    };
    step(2, true);
}
let viewportSaveTimer = null;
function scheduleSave(){
    if(!canvas || applyingRemoteCanvas) return;
    localCanvasDirty = true;
    if(!saveTimer && !savingCanvasNow) setStatus('Saving...');
    clearTimeout(saveTimer);
    if(savingCanvasNow){
        saveCanvasAgain = true;
        return;
    }
    saveTimer = setTimeout(saveCanvas, 500);
}
/** 拖节点/改尺寸：长防抖，避免松手后立刻保存→409/远程同步→全量 render */
function scheduleNodeDragSave(){
    if(!canvas || applyingRemoteCanvas) return;
    localCanvasDirty = true;
    if(!saveTimer && !savingCanvasNow) setStatus('Saving...');
    clearTimeout(saveTimer);
    if(savingCanvasNow){
        saveCanvasAgain = true;
        return;
    }
    saveTimer = setTimeout(saveCanvas, 1200);
}
/** 滚轮/平移仅改视口：长防抖，避免每次缩放都触发保存→同步→全量 render 闪屏 */
function scheduleViewportSave(){
    if(!canvas || applyingRemoteCanvas) return;
    localCanvasDirty = true;
    clearTimeout(viewportSaveTimer);
    clearTimeout(saveTimer);
    viewportSaveTimer = setTimeout(() => {
        viewportSaveTimer = null;
        scheduleSave();
    }, 2000);
}
function refreshOutputTimer(){
    const hasPending = nodes.some(n => n.type === 'output' && (n._pending || []).length);
    if(hasPending && !outputTimer){
        outputTimer = setInterval(() => {
            const pendingById = new Map();
            nodes.filter(n => n.type === 'output').forEach(node => {
                (node._pending || []).forEach(p => pendingById.set(p.id, p));
            });
            if(pendingById.size){
                domQueryAll('.output-time-pill.running').forEach(pill => {
                    const pendingId = pill.closest('[data-pending-id]')?.dataset.pendingId;
                    const pending = pendingById.get(pendingId);
                    if(!pending) return;
                    if(pending.stageLabel) pill.textContent = pending.stageLabel;
                    else pill.textContent = formatRunDuration(nowMs() - Number(pending.startedAt || nowMs()));
                });
            } else {
                clearInterval(outputTimer);
                outputTimer = null;
            }
        }, 1000);
    } else if(!hasPending && outputTimer){
        clearInterval(outputTimer);
        outputTimer = null;
    }
}
function serializableCanvasNode(node){
    const copy = {...(node || {})};
    // 运行时字段禁止落盘，否则重开会出现假「运行中」/编辑态残留
    delete copy._ltxEditor;
    delete copy.running;
    delete copy._batchPosterRuns;
    delete copy._batchPosterTitlePrefetchBusy;
    delete copy._batchProgress;
    delete copy.batchProgress;
    delete copy.cellEditing;
    delete copy._cascadeFailed;
    delete copy._cascadeIdx;
    delete copy._agentStopRequested;
    return copy;
}
function serializableCanvasNodes(list=nodes){
    return (list || []).map(serializableCanvasNode);
}
async function saveCanvas(){
    if(!canvas || applyingRemoteCanvas) return;
    if(savingCanvasNow){
        saveCanvasAgain = true;
        return;
    }
    sanitizeConnections();
    const nodePayload = serializableCanvasNodes();
    const knownNodeCount = Math.max(
        lastKnownSavedNodeCount || 0,
        Array.isArray(canvas.nodes) ? canvas.nodes.length : 0
    );
    if(nodePayload.length === 0 && knownNodeCount > 0){
        console.error('[infinite-canvas] Refusing to save empty nodes over existing workflow', canvas.id);
        setStatus(langIsEn() ? 'Save blocked (empty nodes)' : '已阻止空节点覆盖保存');
        localCanvasDirty = false;
        saveCanvasAgain = false;
        return;
    }
    savingCanvasNow = true;
    saveCanvasAgain = false;
    try {
        const res = await apiFetch(`/api/canvases/${canvas.id}`, {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                title:canvas.title,
                icon:canvas.icon || '🧩',
                nodes:nodePayload,
                connections,
                viewport,
                logs:canvas.logs || [],
                settings: canvas.settings || {},
                client_id:CLIENT_ID,
                base_updated_at:Number(lastCanvasUpdatedAt || canvas.updated_at || 0)
            })
        });
        if(res.status === 409){
            const data = await res.json().catch(() => ({}));
            const remote = data.detail?.canvas || data.canvas;
            if(localCanvasDirty || saveCanvasAgain || Date.now() - lastBoardInteractionAt < CANVAS_INTERACTION_COOLDOWN_MS){
                lastCanvasUpdatedAt = Number(data.detail?.updated_at || data.updated_at || remote?.updated_at || lastCanvasUpdatedAt || 0);
                saveCanvasAgain = true;
                setStatus('Saving...');
                return;
            }
            if(remote && !localCanvasDirty){
                applyRemoteCanvasData(remote);
            }
            setStatus('Synced');
            return;
        }
        if(!res.ok) throw new Error('save failed');
        const data = await res.json().catch(() => ({}));
        if(data.canvas) canvas = {...canvas, ...data.canvas};
        canvas.updated_at = Number(canvas.updated_at || Date.now());
        lastCanvasUpdatedAt = canvas.updated_at;
        lastKnownSavedNodeCount = Array.isArray(canvas.nodes) ? canvas.nodes.length : nodePayload.length;
        localCanvasDirty = Boolean(saveCanvasAgain);
        if(currentCanvasTime) currentCanvasTime.textContent = formatCanvasTime(canvas.updated_at);
        setStatus('Saved');
    } catch(e) {
        setStatus('Save failed');
        console.error(e);
    } finally {
        savingCanvasNow = false;
        if(saveCanvasAgain && canvas && !applyingRemoteCanvas){
            saveCanvasAgain = false;
            localCanvasDirty = true;
            setTimeout(saveCanvas, 0);
        }
    }
}

async function loadConfig(){
    loadLocalModelLists();
    try {
        const cfg = await apiFetch('/api/config').then(r=>r.json());
        imageModels = cfg.image_models?.length ? cfg.image_models : imageModels;
        chatModels = cfg.chat_models?.length ? cfg.chat_models : chatModels;
        videoModels = cfg.video_models?.length ? cfg.video_models : DEFAULT_VIDEO_MODELS;
        msChatModels = cfg.ms_chat_models?.length ? cfg.ms_chat_models : msChatModels;
        comfyBackendCount = Math.max(1, (cfg.comfy_instances || []).length || 1);
        apiProviders = normalizeLoadedProviders(cfg.api_providers);
        if(typeof render === 'function' && canvas) safeRender({ force: true });
        models.nano = imageModels.find(m => m.toLowerCase().includes('nano')) || 'nano-banana-pro';
        models.gpt = imageModels.find(m => !m.toLowerCase().includes('nano')) || cfg.image_model || 'gpt-image-2';
        try {
            const wf = await apiFetch('/api/workflows').then(r=>r.json());
            comfyWorkflows = wf.workflows || [];
        } catch(_) {
            comfyWorkflows = [];
        }
        runningHubWorkflowCache = {};
        const rhProvider = apiProviders.find(p => p.id === 'runninghub');
        const rhWorkflowIds = (rhProvider?.rh_workflows || []).map(item => String(item.workflowId || item.id || '').trim()).filter(Boolean);
        await Promise.all(rhWorkflowIds.map(async workflowId => {
            try { await ensureRunningHubWorkflow(workflowId); } catch(_) {}
        }));
    } catch(e) {
        apiProviders = defaultApiProviders();
    }
}

// 监听 API 设置页面的变更广播，实时刷新画布的模型/平台下拉
try {
    const apiChannel = new BroadcastChannel('studio-api');
    apiChannel.onmessage = async (e) => {
        if(e.data?.type === 'providers-changed' || e.data?.type === 'workflows-changed'){
            await loadConfig();
            pruneMissingComfyWorkflows();
            if(typeof render === 'function') render();
        }
    };
} catch(e) { /* 不支持 BroadcastChannel 的旧浏览器忽略 */ }
function msChatModelOptions(selected){
    // 单一数据源：从 API 设置里 modelscope 平台的 chat_models 取
    const msProvider = apiProviders.find(p => p.id === 'modelscope');
    const list = uniqueModels(msProvider?.chat_models || []);
    if(!list.length){
        return `<option value="" disabled selected>${tr('canvas.noModelsHint') || '暂无模型，请到 API 设置添加'}</option>`;
    }
    const sel = selected && list.includes(selected) ? selected : list[0];
    return list.map(m => `<option value="${escapeHtml(m)}" ${m === sel ? 'selected' : ''}>${escapeHtml(m.split('/').pop().split(':')[0])}</option>`).join('');
}
async function loadCanvasList(openFirst=true){
    try {
        const res = await apiFetch('/api/canvases');
        if(!res.ok) throw new Error(tr('canvas.canvasListFailed'));
        const data = await res.json();
        canvases = data.canvases || [];
        if(!trashMode) await loadCanvasCollections();
        refreshGateViewControls();
        scheduleRenderCanvasList();
        refreshTrashCount();
        if(openFirst){
            const firstClassic = canvases.find(c => (c.kind || 'classic') !== 'smart');
            if(firstClassic) await openCanvas(firstClassic.id);
        }
        if(!canvas) {
            if(shouldBlockCanvasGateTransition() || canvas) return;
            const liveShell = resolveLiveShell();
            if(liveShell?.classList.contains('no-canvas')) {
                const gateMsg = trashMode ? (deletedCanvases.length ? tr('canvas.trash') : tr('canvas.trashEmpty')) : (canvases.length ? tr('canvas.chooseFirst') : tr('canvas.noCanvasCreateFirst'));
                setStatus(gateMsg);
                // 勿自动进入 creating：会隐藏顶栏「新建画布/智能画布」，导致与有列表时 UI 不一致
            }
        }
    } catch(e) {
        setStatus(tr('canvas.canvasListFailed'));
        console.error(e);
    }
}
let workflowTemplates = [];
const WORKFLOW_RUNTIME_DROP = ['running','runStatus','runError','_cascadeIdx','_cascadeFailed','_cascadeIdx','generatedOutputs','outputText','frameOutputId'];
function stripNodeForWorkflowTemplate(node){
    const copy = {...(node || {})};
    WORKFLOW_RUNTIME_DROP.forEach(key => delete copy[key]);
    delete copy._ltxEditor;
    delete copy._pending;
    if(copy.type === 'output') copy.images = [];
    if(copy.type === 'image'){
        copy.url = '';
        copy.name = copy.name || (langIsEn() ? 'Reference image' : '参考图');
    }
    if(copy.type === 'group' || copy.type === 'imageBatch') copy.items = [];
    if(copy.type === 'frameStack') copy.images = [];
    if(copy.type === 'video') copy.url = '';
    return copy;
}
function workflowTemplateBounds(template){
    const list = template?.nodes || [];
    if(!list.length) return {minX:0, minY:0, maxX:0, maxY:0, width:0, height:0};
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    list.forEach(n => {
        const x = Number(n.x || 0);
        const y = Number(n.y || 0);
        const w = Number(n.w || (n.type === 'output' ? 460 : (n.type === 'replicaAgent' || n.type === 'imageRepairAgent') ? 320 : 260));
        const h = Number(n.h || ((n.type === 'replicaAgent' || n.type === 'imageRepairAgent') ? 480 : 180));
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
    });
    return {minX, minY, maxX, maxY, width:maxX - minX, height:maxY - minY};
}
function computeWorkflowTemplateOffset(template){
    const bounds = workflowTemplateBounds(template);
    const center = defaultPoint(0, 0);
    return {
        x: Math.round(center.x - bounds.minX - bounds.width / 2),
        y: Math.round(center.y - bounds.minY - bounds.height / 2),
    };
}
function instantiateWorkflowTemplate(template, offset={x:0, y:0}){
    const idMap = new Map();
    (template.nodes || []).forEach(n => {
        idMap.set(String(n.id), uid(String(n.type || 'n').slice(0, 4)));
    });
    const keyToId = new Map();
    const newNodes = (template.nodes || []).map(raw => {
        const oldId = String(raw.id || '');
        const node = stripNodeForWorkflowTemplate({...raw});
        const newId = idMap.get(oldId);
        node.id = newId;
        node.x = Number(node.x || 0) + Number(offset.x || 0);
        node.y = Number(node.y || 0) + Number(offset.y || 0);
        if(raw.templateKey) keyToId.set(String(raw.templateKey), newId);
        delete node.templateKey;
        if(Array.isArray(node.items)){
            node.items = node.items.map(id => idMap.get(String(id))).filter(Boolean);
        }
        if(node.type === 'replicaAgent'){
            node.roles = {};
            const roleSource = template.roleTemplate || {};
            Object.entries(roleSource).forEach(([key, role]) => {
                const mappedId = keyToId.get(key) || idMap.get(key);
                if(mappedId && ['background','character'].includes(role)) node.roles[mappedId] = role;
            });
            if(raw.roles && typeof raw.roles === 'object'){
                Object.entries(raw.roles).forEach(([oldRoleId, role]) => {
                    const mappedId = idMap.get(String(oldRoleId));
                    if(mappedId && ['background','character'].includes(role)) node.roles[mappedId] = role;
                });
            }
            node.inputs = [];
        }
        if(node.type === 'imageRepairAgent'){
            node.inputs = [];
            node.runStatus = 'idle';
            node.runError = '';
            node.running = false;
        }
        if(node.type === 'batchPosterAgent'){
            node.inputs = [];
            node.spawnedImageIds = [];
            node.pipelineMode = normalizeBatchPosterPipelineMode(node.pipelineMode);
            normalizeBatchPosterAgentNode(node);
            node.selectedPreset = normalizeBatchPosterPreset(node.selectedPreset);
            node.selectedThemeId = normalizeBatchPosterThemeId(node.selectedThemeId);
            node.custom_theme = normalizeBatchPosterCustomTheme(node.custom_theme);
            node.theme_source = normalizeBatchPosterThemeSource(node.theme_source, node);
            syncBatchPosterSelectedAspectRatio(node);
            node.batchProgress = null;
            node._batchPosterRuns = null;
            node.running = false;
            node.runStatus = 'idle';
            node.runError = '';
        }
        if(node.type === 'slotsLoopVideoAgent'){
            node.inputs = [];
            node.model = clampAgentTextModel(node.model);
            node.duration = normalizeSlotsLoopVideoDuration(node.duration);
            node.creative_idea = String(node.creative_idea || '').trim().slice(0, 500);
            node.outputText = String(node.outputText || '');
            node.running = false;
            node.runStatus = node.runStatus || 'idle';
            node.runError = '';
        }
        if(node.type === 'nineGridAgent'){
            node.inputs = [];
            node.shots = Array.isArray(node.shots) ? node.shots : [];
            node.croppedUrls = Array.isArray(node.croppedUrls) ? node.croppedUrls : [];
            if(!node.refNames || typeof node.refNames !== 'object') node.refNames = {};
            normalizeNineGridAgentNode(node);
            node.batchProgress = null;
            node.running = false;
            node.runStatus = 'idle';
            node.runError = '';
            node.cellEditing = {};
        }
        return node;
    });
    const newConnections = (template.connections || []).map(c => ({
        id:uid('c'),
        from:idMap.get(String(c.from)),
        to:idMap.get(String(c.to)),
    })).filter(c => c.from && c.to);
    const videoId = keyToId.get('video');
    const stackId = keyToId.get('frames');
    if(videoId && stackId){
        const videoNode = newNodes.find(n => n.id === videoId);
        const stackNode = newNodes.find(n => n.id === stackId);
        if(videoNode){
            videoNode.frameOutputId = stackId;
        }
        if(stackNode){
            stackNode.sourceVideoId = videoId;
        }
    }
    return {nodes:newNodes, connections:newConnections};
}
async function fetchWorkflowTemplate(templateId){
    const res = await apiFetch(`/api/canvas-workflow-templates/${encodeURIComponent(templateId)}`);
    if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Failed to load workflow template' : '加载工作流模板失败'));
    const data = await res.json();
    if(!data.template) throw new Error(langIsEn() ? 'Workflow template not found' : '工作流模板不存在');
    return data.template;
}
async function loadWorkflowTemplates(){
    try {
        const res = await apiFetch('/api/canvas-workflow-templates');
        if(!res.ok) throw new Error('workflow templates failed');
        const data = await res.json();
        workflowTemplates = data.templates || [];
        renderWorkflowTemplateLists();
    } catch(e) {
        console.warn('[infinite-canvas] workflow templates load failed', e);
        workflowTemplates = [];
        renderWorkflowTemplateLists();
    }
}
function syncStudioFilterChips(root, attr, activeValue){
    if(!root) return;
    root.querySelectorAll(`[${attr}]`).forEach(btn => {
        btn.classList.toggle('is-active', btn.getAttribute(attr) === activeValue);
    });
}
function formatWorkflowTemplateDate(ts){
    const n = Number(ts || 0);
    if(!n) return '';
    const d = new Date(n);
    if(Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString(langIsEn() ? 'en-US' : 'zh-CN', { month:'2-digit', day:'2-digit' });
}
function filteredWorkflowTemplates(){
    const q = workflowTemplateSearchQuery.trim().toLowerCase();
    return (workflowTemplates || []).filter(item => {
        if(workflowTemplateKindFilter === 'builtin' && !item.builtin) return false;
        if(workflowTemplateKindFilter === 'custom' && item.builtin) return false;
        if(!q) return true;
        const hay = `${item.title || ''} ${item.description || ''} ${item.id || ''}`.toLowerCase();
        return hay.includes(q);
    });
}
function renderWorkflowTemplateCard(item){
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `workflow-template-card ${item.builtin ? 'is-builtin' : 'is-custom'}`;
    card.dataset.templateId = item.id;
    const nodeCount = Number(item.node_count || 0);
    const linkCount = Number(item.connection_count || 0);
    const dateLabel = !item.builtin && item.updated_at ? formatWorkflowTemplateDate(item.updated_at) : '';
    const metaParts = [
        item.builtin ? (langIsEn() ? 'Built-in' : '内置') : (langIsEn() ? 'Custom' : '自定义'),
        `${nodeCount} ${langIsEn() ? 'nodes' : '节点'}`,
        linkCount ? `${linkCount} ${langIsEn() ? 'links' : '连线'}` : '',
        dateLabel,
    ].filter(Boolean);
    card.innerHTML = `
        <div class="workflow-template-card-top">
            <div class="workflow-template-card-icon"><i data-lucide="${escapeAttr(item.icon || 'layout-template')}" class="w-4 h-4"></i></div>
            <div class="workflow-template-card-body">
                <div class="workflow-template-card-title">${escapeHtml(item.title || item.id)}</div>
                <div class="workflow-template-card-desc">${escapeHtml(item.description || (langIsEn() ? 'No description' : '暂无说明'))}</div>
                <div class="workflow-template-card-meta">
                    <span class="workflow-template-card-badge ${item.builtin ? 'is-builtin' : ''}">${escapeHtml(metaParts[0])}</span>
                    <span>${escapeHtml(metaParts.slice(1).join(' · '))}</span>
                </div>
            </div>
        </div>
        <span class="workflow-template-card-action">${langIsEn() ? 'Insert into canvas' : '插入到画布'}</span>
        ${!item.builtin ? `<span class="workflow-template-delete" data-delete-template="${escapeAttr(item.id)}" title="${tr('common.delete')}">×</span>` : ''}
    `;
    card.onclick = e => {
        if(e.target.closest('[data-delete-template]')) return;
        void insertWorkflowTemplateIntoCanvas(item.id);
    };
    const del = card.querySelector('[data-delete-template]');
    if(del){
        del.onmousedown = e => e.stopPropagation();
        del.onclick = e => {
            e.preventDefault();
            e.stopPropagation();
            showWorkflowTemplateDeleteConfirm(item.id);
        };
    }
    return card;
}
function renderWorkflowTemplateLists(){
    if(!workflowTemplateList) return;
    workflowTemplateList.innerHTML = '';
    const items = filteredWorkflowTemplates();
    if(!items.length){
        const emptyText = workflowTemplates.length
            ? (langIsEn() ? 'No templates match your filters' : '没有符合筛选条件的模板')
            : tr('canvas.workflowTemplatesEmpty');
        workflowTemplateList.innerHTML = `<div class="workflow-template-empty">${escapeHtml(emptyText)}</div>`;
        refreshIcons();
        return;
    }
    items.forEach(item => workflowTemplateList.appendChild(renderWorkflowTemplateCard(item)));
    refreshIcons();
}
function closeWorkflowTemplateSaveForm(){
    workflowTemplateSaveForm?.setAttribute('hidden', '');
}
function openWorkflowTemplateSaveForm(mode = 'canvas'){
    if(mode === 'canvas' && (!canvas || !nodes.length)){
        showErrorModal(langIsEn() ? 'Canvas is empty' : '当前画布没有节点，无法保存为模板', langIsEn() ? 'Cannot save' : '无法保存');
        return;
    }
    if(mode === 'selection' && (!canvas || selected.size < 1)){
        showErrorModal(langIsEn() ? 'Select nodes first' : '请先框选节点', langIsEn() ? 'Cannot save' : '无法保存');
        return;
    }
    workflowTemplateSaveMode = mode;
    if(workflowTemplateTitleInput){
        workflowTemplateTitleInput.value = mode === 'canvas'
            ? String(canvas?.title || '').trim()
            : '';
    }
    if(workflowTemplateDescInput) workflowTemplateDescInput.value = '';
    workflowTemplateSaveForm?.removeAttribute('hidden');
    workflowTemplateDeleteBar?.setAttribute('hidden', '');
    workflowTemplateTitleInput?.focus();
    workflowTemplateTitleInput?.select();
}
async function confirmWorkflowTemplateSave(){
    const title = String(workflowTemplateTitleInput?.value || '').trim();
    const description = String(workflowTemplateDescInput?.value || '').trim();
    if(!title){
        showErrorModal(langIsEn() ? 'Template name is required' : '请填写模板名称', langIsEn() ? 'Cannot save' : '无法保存');
        return;
    }
    try {
        let templateNodes = [];
        let templateConnections = [];
        if(workflowTemplateSaveMode === 'selection'){
            const built = buildWorkflowTemplateFromNodeIds([...selected]);
            templateNodes = built.nodes;
            templateConnections = built.connections;
            if(!templateNodes.length){
                showErrorModal(langIsEn() ? 'No nodes to save' : '没有可保存的节点', langIsEn() ? 'Cannot save' : '无法保存');
                return;
            }
        } else {
            const built = buildWorkflowTemplateFromNodeIds(nodes.map(n => n.id));
            templateNodes = built.nodes;
            templateConnections = built.connections;
        }
        await saveWorkflowTemplatePayload({
            title,
            description,
            icon: workflowTemplateSaveMode === 'canvas' ? (canvas.icon || 'workflow') : 'workflow',
            nodes: templateNodes,
            connections: templateConnections,
        });
        closeWorkflowTemplateSaveForm();
        setStatus(langIsEn() ? 'Workflow template saved' : '工作流模板已保存');
    } catch(e) {
        showErrorModal(e.message || String(e), langIsEn() ? 'Save template failed' : '保存模板失败');
    }
}
function showWorkflowTemplateDeleteConfirm(templateId){
    if(!templateId) return;
    pendingDeleteTemplateId = templateId;
    const item = workflowTemplates.find(t => t.id === templateId);
    if(workflowTemplateDeleteLabel){
        workflowTemplateDeleteLabel.textContent = langIsEn()
            ? `Delete workflow template "${item?.title || templateId}"?`
            : `确定删除工作流模板「${item?.title || templateId}」？`;
    }
    workflowTemplateDeleteBar?.removeAttribute('hidden');
    closeWorkflowTemplateSaveForm();
}
function hideWorkflowTemplateDeleteConfirm(){
    pendingDeleteTemplateId = null;
    workflowTemplateDeleteBar?.setAttribute('hidden', '');
}
async function insertWorkflowTemplateIntoCanvas(templateId){
    if(!ensureCanvas()) return;
    try {
        const template = await fetchWorkflowTemplate(templateId);
        pushUndo();
        const offset = computeWorkflowTemplateOffset(template);
        const {nodes:newNodes, connections:newConnections} = instantiateWorkflowTemplate(template, offset);
        nodes.push(...newNodes);
        connections.push(...newConnections);
        sanitizeConnections();
        syncGeneratorInputs();
        selected.clear();
        newNodes.forEach(n => selected.add(n.id));
        closeWorkflowTemplateModal();
        render();
        scheduleSave();
        setStatus(langIsEn() ? 'Workflow inserted' : '已插入工作流');
    } catch(e) {
        showErrorModal(e.message || String(e), langIsEn() ? 'Insert workflow failed' : '插入工作流失败');
    }
}
async function createCanvasFromWorkflowTemplate(templateId){
    if(createCanvasInFlight) return;
    createCanvasInFlight = true;
    setStatus(langIsEn() ? 'Creating canvas from template…' : '正在从模板创建画布…');
    try {
        const template = await fetchWorkflowTemplate(templateId);
        const title = `${template.title || tr('canvas.untitled')} ${new Date().toLocaleTimeString(window.StudioI18n?.lang() === 'en' ? 'en-US' : 'zh-CN', {hour:'2-digit', minute:'2-digit'})}`;
        const res = await apiFetch('/api/canvases', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({title, kind:'classic', icon: template.icon || 'workflow'})
        });
        if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Create canvas failed' : '创建画布失败'));
        const data = await res.json();
        await openCanvas(data.canvas.id);
        const {nodes:newNodes, connections:newConnections} = instantiateWorkflowTemplate(template, {x:0, y:0});
        pushUndo();
        nodes = newNodes;
        connections = newConnections;
        sanitizeConnections();
        syncGeneratorInputs();
        selected.clear();
        newNodes.forEach(n => selected.add(n.id));
        render();
        scheduleSave();
        setStatus(langIsEn() ? 'Canvas ready' : '画布已就绪');
    } catch(e) {
        showErrorModal(e.message || String(e), langIsEn() ? 'Create from template failed' : '从模板创建失败');
    } finally {
        createCanvasInFlight = false;
    }
}
async function saveCurrentCanvasAsWorkflowTemplate(){
    openWorkflowTemplateModal();
    openWorkflowTemplateSaveForm('canvas');
}
async function saveSelectedAsWorkflowTemplate(){
    openWorkflowTemplateModal();
    openWorkflowTemplateSaveForm('selection');
}
async function deleteWorkflowTemplate(templateId){
    if(!templateId) return;
    try {
        const res = await apiFetch(`/api/canvas-workflow-templates/${encodeURIComponent(templateId)}`, {method:'DELETE'});
        if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Delete failed' : '删除失败'));
        hideWorkflowTemplateDeleteConfirm();
        await loadWorkflowTemplates();
    } catch(e) {
        showErrorModal(e.message || String(e), langIsEn() ? 'Delete failed' : '删除失败');
    }
}
function openWorkflowTemplateModal(){
    if(!ensureCanvas()) return;
    void loadWorkflowTemplates();
    workflowTemplateModal?.classList.add('open');
    hideWorkflowTemplateDeleteConfirm();
    closeWorkflowTemplateSaveForm();
    syncStudioFilterChips(workflowTemplateModal, 'data-wf-filter', workflowTemplateKindFilter);
    refreshIcons();
}
function closeWorkflowTemplateModal(){
    workflowTemplateModal?.classList.remove('open');
    hideWorkflowTemplateDeleteConfirm();
    closeWorkflowTemplateSaveForm();
}
async function loadTrashList(){
    try {
        const res = await apiFetch('/api/canvases/trash');
        if(!res.ok) throw new Error(tr('canvas.trashLoadFailed'));
        const data = await res.json();
        deletedCanvases = data.canvases || [];
        refreshGateViewControls();
        renderCanvasList();
        setStatus(deletedCanvases.length ? tr('canvas.trash') : tr('canvas.trashEmpty'));
    } catch(e) {
        setStatus(tr('canvas.trashLoadFailed'));
        console.error(e);
    }
}
async function refreshTrashCount(){
    if(trashMode) return;
    try {
        const res = await apiFetch('/api/canvases/trash');
        if(!res.ok) return;
        const data = await res.json();
        deletedCanvases = data.canvases || [];
        refreshGateViewControls();
    } catch(e) {}
}
async function setTrashMode(active){
    trashMode = active;
    creatingCanvas = false;
    pendingDeleteCanvasId = null;
    pendingPurgeCanvasId = null;
    emojiPickerCanvasId = null;
    canvasGate.classList.toggle('creating', false);
    refreshGateViewControls();
    if(trashMode) await loadTrashList();
    else await loadCanvasList(false);
    refreshIcons();
}
function getGateCreateTitleInput(){
    return document.getElementById('gateCreateCardInput') || gateTitleInput;
}
function filterGateCanvasItems(items){
    const q = gateSearchQuery.trim().toLowerCase();
    if(!q) return items;
    return items.filter(item => String(item?.title || '').toLowerCase().includes(q));
}
function syncGateListTableHead(){
    if(!gateListTableHead) return;
    const en = langIsEn();
    const labels = en
        ? ['Preview', 'Name', 'Type', 'Content', 'Created', 'Updated']
        : ['预览', '名称', '类型', '内容', '创建时间', '最近更新'];
    gateListTableHead.querySelectorAll('.gate-list-col').forEach((el, i) => {
        if(labels[i]) el.textContent = labels[i];
    });
}
function applyGateListViewClass(list){
    if(!list) return;
    const isList = gateViewMode === 'list';
    list.classList.toggle('is-list-view', isList);
    if(gateBoardShell) gateBoardShell.classList.toggle('is-list-view', isList);
    if(gateListTableHead){
        gateListTableHead.hidden = !isList;
        gateListTableHead.setAttribute('aria-hidden', isList ? 'false' : 'true');
    }
}
function gateFilterTypeLabel(type){
    if(langIsEn()){
        if(type === 'folders') return 'Folders only';
        if(type === 'projects') return 'Projects only';
        return 'Show all';
    }
    if(type === 'folders') return '仅文件夹';
    if(type === 'projects') return '仅项目';
    return '显示全部';
}
function syncGateFilterMenuUi(){
    if(!gateFilterMenu) return;
    gateFilterMenu.querySelectorAll('[data-gate-filter-type]').forEach(btn => {
        const active = btn.getAttribute('data-gate-filter-type') === gateFilterType;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    gateFilterMenu.querySelectorAll('[data-gate-sort-by]').forEach(btn => {
        const active = btn.getAttribute('data-gate-sort-by') === gateSortBy;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
    gateFilterMenu.querySelectorAll('[data-gate-sort-order]').forEach(btn => {
        const active = btn.getAttribute('data-gate-sort-order') === gateSortOrder;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-checked', active ? 'true' : 'false');
    });
}
function syncGateToolbarUi(){
    if(gateFilterLabel){
        gateFilterLabel.textContent = trashMode ? '回收站' : gateFilterTypeLabel(gateFilterType);
    }
    if(gateViewGridBtn){
        gateViewGridBtn.classList.toggle('is-active', gateViewMode === 'grid');
        gateViewGridBtn.setAttribute('aria-pressed', gateViewMode === 'grid' ? 'true' : 'false');
    }
    if(gateViewListBtn){
        gateViewListBtn.classList.toggle('is-active', gateViewMode === 'list');
        gateViewListBtn.setAttribute('aria-pressed', gateViewMode === 'list' ? 'true' : 'false');
    }
    if(gateFilterMenu) gateFilterMenu.hidden = true;
    syncGateListTableHead();
    syncGateFilterMenuUi();
}
function closeGateFilterMenu(){
    if(gateFilterMenu) gateFilterMenu.hidden = true;
}
function buildCreateCanvasCardElement(){
    const el = document.createElement('div');
    el.className = `canvas-item canvas-create-card${creatingCanvas ? ' is-creating' : ''}`;
    el.id = 'gateCreateCard';
    if(creatingCanvas){
        const draft = gateTitleInput?.value || '';
        el.innerHTML = `
            <div class="canvas-create-card-shell is-editing">
                <span class="canvas-create-card-plus"><i data-lucide="plus" class="w-5 h-5"></i></span>
                <span class="canvas-create-card-label">新建项目</span>
                <input id="gateCreateCardInput" class="canvas-create-card-input gate-name-input" type="text" maxlength="80" placeholder="${escapeAttr(tr('canvas.newCanvasPlaceholder'))}" value="${escapeAttr(draft)}" />
                <div class="canvas-create-card-actions">
                    <button type="button" class="canvas-create-card-submit" aria-label="${escapeAttr(tr('common.confirm'))}"><i data-lucide="check" class="w-4 h-4"></i></button>
                    <button type="button" class="canvas-create-card-cancel" aria-label="${escapeAttr(tr('common.cancel'))}"><i data-lucide="x" class="w-4 h-4"></i></button>
                </div>
            </div>`;
        const input = el.querySelector('#gateCreateCardInput');
        const submit = el.querySelector('.canvas-create-card-submit');
        const cancel = el.querySelector('.canvas-create-card-cancel');
        submit?.addEventListener('click', (e) => { e.stopPropagation(); void createCanvas(); });
        cancel?.addEventListener('click', (e) => { e.stopPropagation(); setCreateMode(false); });
        input?.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if(e.key === 'Enter'){ e.preventDefault(); void createCanvas(); }
            if(e.key === 'Escape'){ e.preventDefault(); setCreateMode(false); }
        });
        if(gateTitleInput && input) input.addEventListener('input', () => { gateTitleInput.value = input.value; });
        requestAnimationFrame(() => { input?.focus(); input?.select(); });
    } else {
        el.innerHTML = `
            <button type="button" class="canvas-create-card-shell">
                <span class="canvas-create-card-plus"><i data-lucide="plus" class="w-5 h-5"></i></span>
                <span class="canvas-create-card-label">新建项目</span>
            </button>`;
        el.querySelector('button')?.addEventListener('click', (e) => {
            e.stopPropagation();
            setCreateMode(true);
        });
    }
    return el;
}
function appendCreateCanvasCard(list){
    if(trashMode || !list || gateViewMode === 'list') return;
    list.appendChild(buildCreateCanvasCardElement());
}
function canvasDeleteConfirmMessage(title, mode){
    const name = escapeHtml(title || tr('canvas.untitled'));
    if(mode === 'purge') return trf('canvas.purgeConfirmNamed', { name });
    return trf('canvas.moveToTrashConfirmNamed', { name });
}
function renderCanvasList(){
    if(trashMode){
        renderGateTrashList(gateCanvasList);
        if(gateCollectionsRoot) gateCollectionsRoot.innerHTML = '';
        return;
    }
    renderGateLibrary();
}
function buildCanvasItemElement(item, { collectionId = '' } = {}){
    const row = document.createElement('div');
    const isSmartCanvas = (item.kind || 'classic') === 'smart';
    const isDeletePending = pendingDeleteCanvasId === item.id || pendingPurgeCanvasId === item.id;
    const previewUrl = String(item.preview_url || item.previewUrl || '').trim();
    const hasPreview = previewUrl && !isVideoUrl(previewUrl) && !isAudioUrl(previewUrl);
    const createdLabel = formatCanvasCreatedLabel(item.created_at);
    const editedLabel = formatCanvasEditedLabel(item.updated_at || item.created_at);
    const typeLabel = langIsEn() ? 'Project' : '项目';
    row.className = `canvas-item ${isSmartCanvas ? 'smart-canvas' : ''} ${canvas?.id === item.id ? 'active' : ''} ${isDeletePending ? 'is-delete-pending' : ''}`;
    row.dataset.canvasId = item.id;
    if(collectionId) row.dataset.collectionId = collectionId;
    row.innerHTML = `
            <div class="canvas-open" role="button" tabindex="${trashMode ? '-1' : '0'}">
                <div class="canvas-card-preview${hasPreview ? ' has-preview' : ''}">
                    <div class="canvas-card-preview-bg" aria-hidden="true">${hasPreview ? `<img class="canvas-card-preview-img" src="${escapeAttr(previewUrl)}" alt="" loading="lazy" draggable="false">` : ''}</div>
                    <span class="canvas-preview-mark" role="button" tabindex="0" title="${trashMode ? tr('canvas.deletedCanvas') : tr('canvas.changeIcon')}">${renderCanvasIcon(isSmartCanvas && /[^\x00-\x7F]/.test(item.icon || '') ? 'sparkles' : item.icon, 18)}</span>
                    ${isSmartCanvas ? `<span class="canvas-kind-chip">${tr('canvas.smartCanvasShort')}</span>` : ''}
                </div>
                <div class="canvas-card-foot">
                    <div class="canvas-card-title">${escapeHtml(item.title)}</div>
                    <div class="canvas-card-edited">${trashMode ? `${tr('canvas.deletedAt')} ${formatCanvasTime(item.deleted_at)}` : editedLabel}</div>
                </div>
            </div>
            <div class="gate-list-row-meta">
                <span class="gate-list-cell-type">${typeLabel}</span>
                <span class="gate-list-cell-content">—</span>
                <span class="gate-list-cell-created">${createdLabel}</span>
            </div>
            ${trashMode ? (pendingPurgeCanvasId === item.id ? `
                <div class="canvas-delete-confirm">
                    <div class="canvas-delete-box">
                        <div class="canvas-delete-title">${canvasDeleteConfirmMessage(item.title, 'purge')}</div>
                        <div class="canvas-delete-actions">
                            <button class="canvas-confirm-btn" type="button">${tr('common.confirm')}</button>
                            <button class="canvas-cancel-btn" type="button">${tr('common.cancel')}</button>
                        </div>
                    </div>
                </div>
            ` : `
                <button class="canvas-delete canvas-restore" type="button" title="${tr('canvas.restoreCanvas')}" aria-label="${tr('canvas.restoreCanvas')} ${escapeHtml(item.title)}" style="right:42px">
                    <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
                </button>
                <button class="canvas-delete canvas-purge" type="button" title="${tr('canvas.purgeCanvas')}" aria-label="${tr('canvas.purgeCanvas')} ${escapeHtml(item.title)}">
                    <i data-lucide="x" class="w-3.5 h-3.5"></i>
                </button>
            `) : (pendingDeleteCanvasId === item.id ? `
                <div class="canvas-delete-confirm">
                    <div class="canvas-delete-box">
                        <div class="canvas-delete-title">${canvasDeleteConfirmMessage(item.title, 'trash')}</div>
                        <div class="canvas-delete-actions">
                            <button class="canvas-confirm-btn" type="button">${tr('common.confirm')}</button>
                            <button class="canvas-cancel-btn" type="button">${tr('common.cancel')}</button>
                        </div>
                    </div>
                </div>
            ` : `
                <button class="canvas-card-edit" type="button" title="${tr('canvas.rename')}" aria-label="${tr('canvas.rename')} ${escapeHtml(item.title)}">
                    <i data-lucide="pencil" class="w-3.5 h-3.5"></i>
                </button>
                <button class="canvas-delete" type="button" title="${tr('canvas.moveToTrash')}" aria-label="${tr('canvas.moveToTrash')} ${escapeHtml(item.title)}">
                    <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
                </button>
            `)}
            ${!trashMode && emojiPickerCanvasId === item.id ? `
                <div class="emoji-picker">
                    ${CANVAS_EMOJIS.map(icon => `<button class="emoji-option" type="button" data-icon="${escapeHtml(icon)}">${renderCanvasIcon(icon, 14)}</button>`).join('')}
                </div>
            ` : ''}
        `;
    if(!trashMode) row.querySelector('.canvas-open').onclick = () => openCanvas(item.id);
    const titleEl = row.querySelector('.canvas-card-title');
    const editBtn = row.querySelector('.canvas-card-edit');
    if(editBtn && titleEl && !trashMode) {
        editBtn.onmousedown = e => e.stopPropagation();
        editBtn.onclick = e => { e.stopPropagation(); startTitleEdit(item.id, titleEl); };
    }
    const iconBtn = row.querySelector('.canvas-preview-mark');
    if(iconBtn && !trashMode) {
        iconBtn.onclick = e => toggleEmojiPicker(item.id, e);
        iconBtn.onkeydown = e => {
            if(e.key === 'Enter' || e.key === ' ') toggleEmojiPicker(item.id, e);
        };
    }
    row.querySelectorAll('.emoji-option').forEach(btn => {
        btn.onclick = e => setCanvasIcon(item.id, btn.dataset.icon, e);
    });
    const deleteBtn = row.querySelector('.canvas-delete');
    if(deleteBtn) deleteBtn.onclick = e => requestDeleteCanvas(item.id, e);
    const confirmBtn = row.querySelector('.canvas-confirm-btn');
    if(confirmBtn) confirmBtn.onclick = e => trashMode ? purgeCanvas(item.id, e) : deleteCanvas(item.id, e);
    const cancelBtn = row.querySelector('.canvas-cancel-btn');
    if(cancelBtn) cancelBtn.onclick = e => cancelDeleteCanvas(e);
    const restoreBtn = row.querySelector('.canvas-restore');
    if(restoreBtn) restoreBtn.onclick = e => restoreCanvas(item.id, e);
    const purgeBtn = row.querySelector('.canvas-purge');
    if(purgeBtn) purgeBtn.onclick = e => requestPurgeCanvas(item.id, e);
    return row;
}
function gateEntitySortTime(entity, sortBy){
    const field = sortBy === 'created' ? 'created_at' : 'updated_at';
    const raw = Number(entity?.[field] || entity?.created_at || 0);
    return raw < 10000000000 ? raw * 1000 : raw;
}
function sortGateEntitiesForList(list, sortBy, sortOrder){
    const dir = sortOrder === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => (gateEntitySortTime(a, sortBy) - gateEntitySortTime(b, sortBy)) * dir);
}
function renderCanvasListInto(list){
    if(!list) return;
    refreshGateViewControls();
    applyGateListViewClass(list);
    let items = trashMode ? deletedCanvases : canvases;
    if(!trashMode){
        const inCol = new Set();
        canvasCollections.forEach(col => (col.canvas_ids || []).forEach(id => inCol.add(id)));
        items = canvases.filter(c => !inCol.has(c.id));
        items = sortGateEntitiesForList(items, gateSortBy, gateSortOrder);
    }
    items = filterGateCanvasItems(items);
    list.innerHTML = '';
    if(!trashMode) appendCreateCanvasCard(list);
    if(!items.length){
        if(trashMode || gateSearchQuery.trim()){
            const empty = document.createElement('div');
            empty.className = 'gate-list-empty gate-list-empty-compact';
            empty.textContent = gateSearchQuery.trim()
                ? (langIsEn() ? 'No matching canvases' : '没有匹配的项目')
                : (trashMode ? tr('canvas.trashEmpty') : (langIsEn() ? 'No items here' : '暂无项目'));
            list.appendChild(empty);
        }
        refreshIcons(list);
        return;
    }
    items.forEach(item => {
        list.appendChild(buildCanvasItemElement(item));
    });
    refreshIcons(list);
}
function bindGateCollectionsIntegration(){
    bindGateCollectionsHost({
        apiFetch,
        tr,
        escapeHtml,
        getCanvases: () => canvases,
        getCollections: () => canvasCollections,
        setCollections: (next) => { canvasCollections = Array.isArray(next) ? next : []; },
        loadCanvasList,
        filterGateCanvasItems,
        appendCreateCanvasCard,
        applyGateListViewClass,
        getGateFilterType: () => gateFilterType,
        getGateSortBy: () => gateSortBy,
        getGateSortOrder: () => gateSortOrder,
        getGateSearchQuery: () => gateSearchQuery,
        formatCanvasEditedLabel,
        formatCanvasCreatedLabel,
        langIsEn,
        renderCanvasList,
        renderCanvasListInto,
        buildCanvasItemElement,
        refreshGateViewControls,
        refreshIcons,
        setStatus,
        showErrorModal,
        gateCollectionsRoot,
        gateCanvasList,
        gateUncategorizedSection,
        gateContextMenuEl,
        gateCollectionModalEl,
        gateCollectionModalTitleEl,
        gateCollectionNameInputEl,
        gateCollectionModalConfirmEl,
        gateCollectionModalCancelEl,
        gateCollectionBrowseModalEl,
        gateCollectionBrowseTitleEl,
        gateCollectionBrowseCountEl,
        gateCollectionBrowseListEl,
        gateCollectionBrowseCloseEl,
        getCanvasRoot: () => canvasRoot,
        openCanvas,
    });
}
async function createCanvas(){
    if(createCanvasInFlight) return;
    createCanvasInFlight = true;
    if(!creatingCanvas) setCreateMode(true, createCanvasKind);
    const customTitle = getGateCreateTitleInput()?.value?.trim?.() || '';
    const isSmart = createCanvasKind === 'smart';
    const titleBase = isSmart ? tr('canvas.newSmartCanvas') : tr('canvas.newCanvas');
    const title = customTitle || `${titleBase} ${new Date().toLocaleTimeString(window.StudioI18n?.lang() === 'en' ? 'en-US' : 'zh-CN', {hour:'2-digit', minute:'2-digit'})}`;
    trashMode = false;
    refreshGateViewControls();
    setStatus(langIsEn() ? 'Creating canvas…' : '正在创建画布…');
    const abort = new AbortController();
    const timeoutId = setTimeout(() => abort.abort(), 30000);
    try {
        const res = await apiFetch('/api/canvases', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({title, icon:isSmart ? 'sparkles' : '🧩', kind:isSmart ? 'smart' : 'classic'}),
            signal: abort.signal
        });
        clearTimeout(timeoutId);
        const contentType = (res.headers.get('content-type') || '').toLowerCase();
        if(!contentType.includes('application/json')){
            throw new Error(
                langIsEn()
                    ? 'Canvas API unavailable (got HTML). Stop npm run dev, free port 3005, then start again.'
                    : '画布 API 未生效（返回了网页）。请停止 npm run dev，结束占用 3005 端口的旧进程后重新启动。'
            );
        }
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.detail || data.error || tr('canvas.createFailed'));
        if(isSmart){
            setCreateMode(false);
            await loadCanvasList(false);
            notifySmartCanvasUnavailable();
            return;
        }
        canvas = data.canvas;
        canvas.logs = canvas.logs || [];
        nodes = canvas.nodes || [];
        connections = canvas.connections || [];
        viewport = canvas.viewport || {x:0, y:0, scale:1};
        lastKnownSavedNodeCount = nodes.length;
        sanitizeConnections();
        migrateImageBatchNodes();
        migratePromptGroupNodes();
        syncAllLoopImageBatchSizes();
        selected.clear();
        setCanvasMode(true);
        writeLastCanvasId(canvas.id);
        safeRender({ force: true });
        setStatus('Saved');
        setCreateMode(false);
        await loadCanvasList(false);
        renderCanvasList();
    } catch(e) {
        clearTimeout(timeoutId);
        const aborted = e?.name === 'AbortError';
        const msg = aborted
            ? (langIsEn() ? 'Create canvas timed out (30s).' : '创建画布超时（30 秒），请检查开发服务是否已重启。')
            : (e?.message || tr('canvas.createFailed'));
        setStatus(msg);
        showErrorModal(
            langIsEn()
                ? `${msg} Restart npm run dev if /api/canvases returns HTML (stale Node on port 3005).`
                : `${msg} 若 /api/canvases 返回网页而非 JSON，请重新执行 npm run dev（常见原因：3005 端口被旧 Node 占用）。`,
            tr('canvas.createFailed')
        );
        console.error(e);
    } finally {
        createCanvasInFlight = false;
    }
}
async function createSmartCanvas(){
    notifySmartCanvasUnavailable();
}
function openSmartCanvasPage(id){
    if(!id) return;
    notifySmartCanvasUnavailable();
}
function toggleEmojiPicker(id, event){
    event?.preventDefault();
    event?.stopPropagation();
    pendingDeleteCanvasId = null;
    emojiPickerCanvasId = emojiPickerCanvasId === id ? null : id;
    renderCanvasList();
}
async function setCanvasIcon(id, icon, event){
    event?.preventDefault();
    event?.stopPropagation();
    const item = canvases.find(c => c.id === id);
    if(item) item.icon = icon || 'layers';
    emojiPickerCanvasId = null;
    renderCanvasList();
    try {
        let target = canvas?.id === id ? canvas : null;
        if(!target) {
            const data = await apiFetch(`/api/canvases/${id}`).then(r => r.json());
            target = data.canvas;
        }
        target.icon = icon || 'layers';
        const res = await apiFetch(`/api/canvases/${id}`, {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                title:target.title,
                icon:target.icon,
                base_updated_at:Number(target.updated_at || lastCanvasUpdatedAt || 0)
            })
        });
        if(!res.ok) throw new Error('图标保存失败');
        if(canvas?.id === id) canvas.icon = target.icon;
        await loadCanvasList(false);
    } catch(e) {
        setStatus('图标保存失败');
        console.error(e);
    }
}
function startTitleEdit(id, titleEl){
    if(!titleEl || titleEl.querySelector('input')) return;
    const item = canvases.find(c => c.id === id);
    const current = item?.title || titleEl.textContent || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 80;
    input.value = current;
    input.className = 'canvas-card-title-input';
    titleEl.innerHTML = '';
    titleEl.appendChild(input);
    input.onmousedown = e => e.stopPropagation();
    input.onclick = e => e.stopPropagation();
    input.focus();
    input.select();
    let done = false;
    const finish = async (commit) => {
        if(done) return;
        done = true;
        const newTitle = input.value.trim();
        if(commit && newTitle && newTitle !== current){
            await setCanvasTitle(id, newTitle);
        } else {
            renderCanvasList();
        }
    };
    input.onblur = () => finish(true);
    input.onkeydown = e => {
        e.stopPropagation();
        if(e.key === 'Enter'){ e.preventDefault(); finish(true); }
        if(e.key === 'Escape'){ e.preventDefault(); finish(false); }
    };
}
async function setCanvasTitle(id, title){
    const item = canvases.find(c => c.id === id);
    if(item) item.title = title;
    if(canvas?.id === id) canvas.title = title;
    renderCanvasList();
    try {
        let target = canvas?.id === id ? canvas : null;
        if(!target){
            const data = await apiFetch(`/api/canvases/${id}`).then(r => r.json());
            target = data.canvas;
        }
        target.title = title;
        const res = await apiFetch(`/api/canvases/${id}`, {
            method:'PUT',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                title:target.title,
                icon:target.icon,
                base_updated_at:Number(target.updated_at || lastCanvasUpdatedAt || 0)
            })
        });
        if(!res.ok) throw new Error('重命名失败');
        if(currentCanvasTitle && canvas?.id === id) currentCanvasTitle.textContent = title;
        await loadCanvasList(false);
    } catch(e){
        setStatus('重命名失败');
        console.error(e);
    }
}
async function openCanvas(id, options = {}){
    const fromCollectionBrowse = Boolean(options.fromCollectionBrowse);
    if(canvas?.id === id){
        if (!fromCollectionBrowse) clearGateReturnCollection();
        setCanvasMode(true);
        applyViewport();
        refreshGeometry();
        setStatus('Ready');
        return;
    }
    if (!fromCollectionBrowse) clearGateReturnCollection();
    clearTimeout(saveTimer);
    saveTimer = null;
    clearTimeout(viewportSaveTimer);
    viewportSaveTimer = null;
    const liveShell = resolveLiveShell();
    if(liveShell?.classList.contains('no-canvas')) liveShell.classList.remove('no-canvas');
    setStatus('Opening...');
    try {
        const res = await apiFetch(`/api/canvases/${id}`);
        if(!res.ok) throw new Error(tr('canvas.openFailed'));
        const data = await res.json();
        canvas = data.canvas;
        if((canvas.kind || 'classic') === 'smart'){
            notifySmartCanvasUnavailable();
            showCanvasGateView({ clearEditor: true });
            return;
        }
        canvas.logs = canvas.logs || [];
        nodes = canvas.nodes || [];
        connections = canvas.connections || [];
        undoStack = [];
        redoStack = [];
        viewport = canvas.viewport || {x:0, y:0, scale:1};
        lastCanvasUpdatedAt = Number(canvas.updated_at || 0);
        lastKnownSavedNodeCount = nodes.length;
        localCanvasDirty = false;
        resetTransientNodeRunState();
        sanitizeConnections();
        migrateImageBatchNodes();
        migratePromptGroupNodes();
        syncAllLoopImageBatchSizes();
        nodes.filter(n => n.type === 'replicaAgent').forEach(syncReplicaAgentRoles);
        pruneMissingComfyWorkflows();
        await refreshMissingCanvasAssets();
        await loadFavoriteOutputPaths();
        applyBoardBackground(canvas.settings?.boardBg, { save: false });
        selected.clear();
        setCanvasMode(true);
        writeLastCanvasId(canvas.id);
        renderCanvasList();
        safeRender({ force: true });
        syncOutputFavoriteButtons();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                refreshInfiniteCanvasLayout();
            });
        });
        resumeCanvasImageTasks();
        startCanvasRemotePolling();
        setStatus('Ready');
    } catch(e) {
        canvas = null;
        nodes = [];
        connections = [];
        selected.clear();
        showCanvasGateView({ clearEditor: true });
        setStatus(tr('canvas.openFailed'));
        const msg = e instanceof Error ? e.message : String(e);
        showErrorModal(
            langIsEn() ? `Failed to open canvas: ${msg}` : `打开画布失败：${msg}`,
            tr('canvas.openFailed')
        );
        console.error(e);
    }
}
function remoteCanvasContentEquals(remote){
    if(!remote) return false;
    try {
        return JSON.stringify(remote.nodes || []) === JSON.stringify(nodes || [])
            && JSON.stringify(remote.connections || []) === JSON.stringify(connections || []);
    } catch(_) {
        return false;
    }
}
function applyRemoteCanvasData(remote){
    if(!remote || !canvas || remote.id !== canvas.id) return;
    if(localCanvasDirty || saveTimer || savingCanvasNow || saveCanvasAgain){
        clearTimeout(remoteSyncTimer);
        remoteSyncTimer = setTimeout(syncRemoteCanvasNow, 1000);
        return;
    }
    if(Date.now() - lastBoardInteractionAt < CANVAS_INTERACTION_COOLDOWN_MS){
        clearTimeout(remoteSyncTimer);
        remoteSyncTimer = setTimeout(syncRemoteCanvasNow, 2000);
        return;
    }
    if(isCanvasInteracting()){
        clearTimeout(remoteSyncTimer);
        remoteSyncTimer = setTimeout(syncRemoteCanvasNow, 1200);
        return;
    }
    applyingRemoteCanvas = true;
    try {
        const keepLocalViewport = Date.now() - lastBoardInteractionAt < 6000;
        const localViewport = keepLocalViewport ? {...viewport} : null;
        const viewportOnly = remoteCanvasContentEquals(remote);
        canvas = remote;
        canvas.logs = canvas.logs || [];
        lastCanvasUpdatedAt = Number(canvas.updated_at || Date.now());
        lastKnownSavedNodeCount = Array.isArray(canvas.nodes) ? canvas.nodes.length : 0;
        localCanvasDirty = false;
        applyBoardBackground(canvas.settings?.boardBg, { save: false });
        if(viewportOnly){
            if(!localViewport) viewport = canvas.viewport || viewport;
            applyViewport();
            if(currentCanvasTime) currentCanvasTime.textContent = formatCanvasTime(canvas.updated_at || canvas.created_at);
            setStatus('Synced');
            return;
        }
        nodes = canvas.nodes || [];
        connections = canvas.connections || [];
        viewport = canvas.viewport || {x:0, y:0, scale:1};
        if(localViewport) viewport = localViewport;
        lastKnownSavedNodeCount = nodes.length;
        resetTransientNodeRunState();
        sanitizeConnections();
        migrateImageBatchNodes();
        migratePromptGroupNodes();
        syncAllLoopImageBatchSizes();
        pruneMissingComfyWorkflows();
        selected.clear();
        renderCanvasList();
        if(Date.now() - lastBoardInteractionAt >= CANVAS_INTERACTION_COOLDOWN_MS){
            safeRender({ force: true });
            refreshMissingCanvasAssets().then(() => {
                if(Date.now() - lastBoardInteractionAt >= CANVAS_INTERACTION_COOLDOWN_MS) safeRender({ force: true });
            });
        } else {
            applyViewport();
            updateLinksGeometry();
        }
        resumeCanvasImageTasks();
        if(currentCanvasTitle) currentCanvasTitle.textContent = canvas.title || tr('canvas.untitled');
        if(currentCanvasTime) currentCanvasTime.textContent = formatCanvasTime(canvas.updated_at || canvas.created_at);
        setStatus('Synced');
    } finally {
        applyingRemoteCanvas = false;
    }
}
function canvasLocalAssetUrls(){
    const urls = new Set();
    const add = value => {
        const url = outputUrlValue(value);
        if(url && (url.startsWith('/output/') || url.startsWith('/assets/'))) urls.add(url);
    };
    nodes.forEach(node => {
        if(node.url) add(node.url);
        (node.images || []).forEach(add);
        (node.generatedOutputs || []).forEach(add);
        Object.entries(node.imageComparisons || {}).forEach(([key, value]) => {
            add(key);
            add(value);
        });
    });
    (canvas?.logs || []).forEach(log => {
        (log.outputs || []).forEach(add);
        (log.refs || []).forEach(add);
        (log.run?.refs || []).forEach(add);
    });
    return [...urls];
}
async function refreshMissingCanvasAssets(){
    missingAssetUrls.clear();
    const urls = canvasLocalAssetUrls();
    if(!urls.length) return;
    try {
        const data = await apiFetch('/api/canvas-assets/check', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({urls})
        }).then(r => r.json());
        const exists = data.exists || {};
        Object.entries(exists).forEach(([url, ok]) => { if(!ok) missingAssetUrls.add(url); });
    } catch(e) {
        console.warn('canvas asset check failed', e);
    }
}
async function syncRemoteCanvasNow(){
    if(!canvas) return;
    if(isCanvasInteracting()){
        clearTimeout(remoteSyncTimer);
        remoteSyncTimer = setTimeout(syncRemoteCanvasNow, 900);
        return;
    }
    if(Date.now() - lastBoardInteractionAt < CANVAS_INTERACTION_COOLDOWN_MS){
        clearTimeout(remoteSyncTimer);
        remoteSyncTimer = setTimeout(syncRemoteCanvasNow, CANVAS_INTERACTION_COOLDOWN_MS);
        return;
    }
    try {
        const res = await apiFetch(`/api/canvases/${canvas.id}`);
        if(!res.ok) throw new Error(tr('canvas.openFailed'));
        const data = await res.json();
        const remote = data.canvas;
        const remoteUpdatedAt = Number(remote?.updated_at || 0);
        const localUpdatedAt = Number(lastCanvasUpdatedAt || 0);
        if(remoteUpdatedAt > localUpdatedAt){
            applyRemoteCanvasData(remote);
        }
    } catch(e) {
        console.error(e);
        setStatus('Sync failed');
    }
}
async function checkRemoteCanvasVersion(){
    if(!canvas || applyingRemoteCanvas || remoteSyncBusy) return;
    if(document.hidden) return;
    if(isCanvasInteracting()) return;
    if(Date.now() - lastBoardInteractionAt < CANVAS_INTERACTION_COOLDOWN_MS) return;
    remoteSyncBusy = true;
    try {
        const res = await apiFetch(`/api/canvases/${canvas.id}/meta`);
        if(!res.ok) throw new Error('meta failed');
        const meta = await res.json();
        const remoteUpdatedAt = Number(meta.updated_at || 0);
        if(remoteUpdatedAt > Number(lastCanvasUpdatedAt || 0)){
            await syncRemoteCanvasNow();
        }
    } catch(e) {
        // 轮询失败不打扰创作；下一轮会重试。
    } finally {
        remoteSyncBusy = false;
    }
}
function startCanvasRemotePolling(){
    stopCanvasRemotePolling();
    remoteSyncInterval = setInterval(checkRemoteCanvasVersion, 2500);
}
function stopCanvasRemotePolling(){
    if(remoteSyncInterval){
        clearInterval(remoteSyncInterval);
        remoteSyncInterval = null;
    }
}
function handleCanvasUpdatedMessage(data){
    if(!canvas || !data || data.type !== 'canvas_updated') return;
    if(data.client_id && data.client_id === CLIENT_ID) return;
    if(data.canvas_id !== canvas.id) return;
    const remoteUpdatedAt = Number(data.updated_at || 0);
    if(remoteUpdatedAt && remoteUpdatedAt <= Number(lastCanvasUpdatedAt || 0)) return;
    const delay = (isCanvasInteracting() || localCanvasDirty || saveTimer || savingCanvasNow) ? 4000 : 800;
    clearTimeout(remoteSyncTimer);
    remoteSyncTimer = setTimeout(syncRemoteCanvasNow, delay);
    if(!isCanvasInteracting()) setStatus(localCanvasDirty || saveTimer ? 'Saving...' : 'Syncing...');
}
async function returnToCanvasManager(){
    clearTimeout(saveTimer);
    saveTimer = null;
    clearTimeout(viewportSaveTimer);
    viewportSaveTimer = null;
    if(canvas && localCanvasDirty) await saveCanvas();
    writeLastCanvasId('');
    stopCanvasRemotePolling();
    canvas = null;
    nodes = [];
    connections = [];
    selected.clear();
    viewport = {x: -1800, y: -1000, scale: 1};
    beginCollectionBrowseResume();
    showCanvasGateView({ clearEditor: true });
    trashMode = false;
    pendingPurgeCanvasId = null;
    refreshGateViewControls();
    await loadCanvasList(false);
    setCreateMode(false);
    refreshOpenCollectionBrowseIfOpen();
}
export async function renameCurrentCanvas(){
    if(!canvas?.id) return;
    const current = canvas.title || tr('canvas.untitled');
    const next = window.prompt(tr('canvas.rename'), current);
    if(next === null) return;
    const trimmed = String(next).trim();
    if(!trimmed || trimmed === current) return;
    await setCanvasTitle(canvas.id, trimmed);
}
export async function updateCurrentCanvasTitle(title){
    if(!canvas?.id) return false;
    const trimmed = String(title || '').trim();
    if(!trimmed) return false;
    const current = canvas.title || tr('canvas.untitled');
    if(trimmed === current) return true;
    await setCanvasTitle(canvas.id, trimmed);
    return true;
}
function requestDeleteCanvas(id, event){
    event?.preventDefault();
    event?.stopPropagation();
    emojiPickerCanvasId = null;
    pendingPurgeCanvasId = null;
    pendingDeleteCanvasId = id;
    if(creatingCanvas) setCreateMode(false);
    renderCanvasList();
}
function requestPurgeCanvas(id, event){
    event?.preventDefault();
    event?.stopPropagation();
    emojiPickerCanvasId = null;
    pendingDeleteCanvasId = null;
    pendingPurgeCanvasId = id;
    if(creatingCanvas) setCreateMode(false);
    renderCanvasList();
}
function cancelDeleteCanvas(event){
    event?.preventDefault();
    event?.stopPropagation();
    pendingDeleteCanvasId = null;
    pendingPurgeCanvasId = null;
    renderCanvasList();
}
async function deleteCanvas(id, event){
    event?.preventDefault();
    event?.stopPropagation();
    setStatus('Moving to trash...');
    try {
        const res = await apiFetch(`/api/canvases/${id}`, {method:'DELETE'});
        if(!res.ok) throw new Error(tr('canvas.moveToTrashFailed'));
        const deletingCurrent = canvas?.id === id;
        pendingDeleteCanvasId = null;
        canvases = canvases.filter(item => item.id !== id);
        if(deletingCurrent){
            canvas = null;
            nodes = [];
            connections = [];
            selected.clear();
            viewport = {x: -1800, y: -1000, scale: 1};
            showCanvasGateView({ clearEditor: true });
        }
        renderCanvasList();
        setStatus(canvases.length ? tr('canvas.movedToTrash') : tr('canvas.noCanvasCreateFirst'));
        void refreshTrashCount();
    } catch(e) {
        setStatus(tr('canvas.moveToTrashFailed'));
        console.error(e);
    }
}
async function restoreCanvas(id, event){
    event?.preventDefault();
    event?.stopPropagation();
    setStatus('Restoring...');
    try {
        const res = await apiFetch(`/api/canvases/${id}/restore`, {method:'POST'});
        if(!res.ok) throw new Error(tr('canvas.restoreFailed'));
        pendingPurgeCanvasId = null;
        deletedCanvases = deletedCanvases.filter(item => item.id !== id);
        await loadCanvasList(false);
        await loadTrashList();
        setStatus(tr('canvas.restored'));
    } catch(e) {
        setStatus(tr('canvas.restoreFailed'));
        console.error(e);
    }
}
async function purgeCanvas(id, event){
    event?.preventDefault();
    event?.stopPropagation();
    setStatus('Deleting...');
    try {
        const res = await apiFetch(`/api/canvases/${id}/purge`, {method:'DELETE'});
        if(!res.ok) throw new Error(tr('canvas.purgeFailed'));
        pendingPurgeCanvasId = null;
        deletedCanvases = deletedCanvases.filter(item => item.id !== id);
        renderCanvasList();
        setStatus(deletedCanvases.length ? tr('canvas.purged') : tr('canvas.trashEmpty'));
    } catch(e) {
        setStatus(tr('canvas.purgeFailed'));
        console.error(e);
    }
}
window.createCanvas = createCanvas;
window.createSmartCanvas = createSmartCanvas;
window.loadCanvasList = loadCanvasList;
window.openCanvas = openCanvas;
window.deleteCanvas = deleteCanvas;
window.returnToCanvasManager = returnToCanvasManager;
function bindClick(el, handler) {
    if(!el) return;
    on(el, 'click', handler);
}
function isImageEditOpen(){
    return Boolean(cropState && domGet('imageEditModal')?.classList.contains('open'));
}
function ensureImageEditorUi(){
    if(imageEditorUiWired) return;
    imageEditorUiWired = true;
    on(document, 'mousedown', event => {
        if(!isImageEditOpen()) return;
        if(event.target.closest('#cropHandle')){
            beginCropDrag(event, 'resize');
        } else if(event.target.closest('#cropBox') && !event.target.closest('#cropHandle')){
            beginCropDrag(event, 'move');
        }
    });
    on(document, 'pointerdown', event => {
        if(!isImageEditOpen() || imageEditMode !== 'brush') return;
        if(event.target.closest('.image-edit-head, .image-edit-tools, .image-edit-actions, .image-edit-mode, #cropBox, #cropHandle')) return;
        if(!event.target.closest('#cropCanvas')) return;
        beginEditDraw(event);
    }, true);
    on(document, 'pointermove', event => {
        if(!editDrawState && !gridCustomDrag) return;
        if(isImageEditOpen() || editDrawState || gridCustomDrag) moveEditDraw(event);
    });
    on(document, 'pointerup', event => {
        if(editDrawState || gridCustomDrag) endEditDraw(event);
    });
    on(document, 'pointercancel', event => {
        if(editDrawState || gridCustomDrag) endEditDraw(event);
    });
    on(document, 'wheel', event => {
        if(!cropState || !isImageEditOpen()) return;
        const stage = event.target.closest('#imageEditStage');
        if(!stage) return;
        event.preventDefault();
        event.stopPropagation();
        const oldZoom = imageEditZoom;
        const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
        imageEditZoom = Math.max(0.15, Math.min(6.0, imageEditZoom * factor));
        const stageRect = stage.getBoundingClientRect();
        const mx = event.clientX - stageRect.left;
        const my = event.clientY - stageRect.top;
        const contentX = stage.scrollLeft + mx;
        const contentY = stage.scrollTop + my;
        applyImageEditZoom();
        const scale = imageEditZoom / oldZoom;
        stage.scrollLeft = contentX * scale - mx;
        stage.scrollTop = contentY * scale - my;
    }, {passive: false});
}
function wireCanvasUiEvents() {
if(!wireCanvasUiEvents._collectionsWired){
    bindGateCollectionsIntegration();
    wireGateCollectionUi();
    wireCanvasUiEvents._collectionsWired = true;
}
bindClick(gateCreateBtn, () => setCreateMode(true));
bindClick(gateCreateCollectionBtn, () => openCreateCollectionModal());
bindClick(gateCreateSmartBtn, () => createSmartCanvas());
bindClick(gateBackBtn, () => { gateFilterType = 'all'; setTrashMode(false); });
bindClick(gateTrashBtn, () => setTrashMode(true));
bindClick(gateRefreshBtn, () => trashMode ? loadTrashList() : loadCanvasList(false));
if(gateSearchInput){
    on(gateSearchInput, 'input', () => {
        gateSearchQuery = gateSearchInput.value || '';
        renderCanvasList();
    });
}
if(gateFilterBtn && gateFilterMenu){
    bindClick(gateFilterBtn, (e) => {
        e.stopPropagation();
        gateFilterMenu.hidden = !gateFilterMenu.hidden;
        if(!gateFilterMenu.hidden){
            syncGateFilterMenuUi();
            refreshIcons(gateFilterMenu);
        }
    });
    gateFilterMenu.querySelectorAll('[data-gate-filter-type]').forEach(btn => {
        bindClick(btn, () => {
            if(trashMode) setTrashMode(false);
            gateFilterType = btn.getAttribute('data-gate-filter-type') || 'all';
            syncGateToolbarUi();
            renderCanvasList();
        });
    });
    gateFilterMenu.querySelectorAll('[data-gate-sort-by]').forEach(btn => {
        bindClick(btn, () => {
            if(trashMode) setTrashMode(false);
            gateSortBy = btn.getAttribute('data-gate-sort-by') === 'created' ? 'created' : 'updated';
            syncGateToolbarUi();
            renderCanvasList();
        });
    });
    gateFilterMenu.querySelectorAll('[data-gate-sort-order]').forEach(btn => {
        bindClick(btn, () => {
            if(trashMode) setTrashMode(false);
            gateSortOrder = btn.getAttribute('data-gate-sort-order') === 'asc' ? 'asc' : 'desc';
            syncGateToolbarUi();
            renderCanvasList();
        });
    });
    on(document, 'click', (e) => {
        if(gateFilterMenu.hidden) return;
        if(gateFilterBtn.contains(e.target) || gateFilterMenu.contains(e.target)) return;
        closeGateFilterMenu();
    });
}
if(gateViewGridBtn){
    bindClick(gateViewGridBtn, () => {
        gateViewMode = 'grid';
        syncGateToolbarUi();
        renderCanvasList();
    });
}
if(gateViewListBtn){
    bindClick(gateViewListBtn, () => {
        gateViewMode = 'list';
        syncGateToolbarUi();
        renderCanvasList();
    });
}
bindClick(workflowTemplateBtn, () => openWorkflowTemplateModal());
bindStudioModalControls();
bindClick(gateConfirmBtn, () => { void createCanvas(); });
bindClick(gateCancelBtn, () => setCreateMode(false));
if(gateTitleInput){
    on(gateTitleInput, 'keydown', e => {
        if(e.key === 'Enter') { e.preventDefault(); void createCanvas(); }
        if(e.key === 'Escape') setCreateMode(false);
    });
}
on(document, 'mousedown', e => {
    if(emojiPickerCanvasId === null) return;
    if(e.target.closest('.emoji-picker') || e.target.closest('.canvas-preview-mark')) return;
    emojiPickerCanvasId = null;
    renderCanvasList();
});
on(window, 'studio-theme-change', event => applyTheme(event.detail?.theme || 'light'));
ensureImageEditorUi();
on(window, 'resize', () => {
    if(cropState) syncImageEditOverflow();
});
bindClick(backToManagerBtn, () => returnToCanvasManager());
bindCanvasMenuWheelScroll();
}


function addNode(node){
    if(!ensureCanvas()) return;
    nodes.push(node);
    render();
    scheduleSave();
    const freshEl = nodesEl?.querySelector(`.node[data-id="${CSS.escape(node.id)}"]`);
    if(freshEl) freshEl.classList.add('node-just-added');
    return node;
}
function defaultPoint(dx=0, dy=0){
    if(board){
        const rect = board.getBoundingClientRect();
        return screenToWorld(rect.left + rect.width / 2 + dx, rect.top + rect.height / 2 + dy);
    }
    return screenToWorld(window.innerWidth / 2 + dx, window.innerHeight / 2 + dy);
}
function canStartBoardPanFromTarget(target){
    if(!board || !target) return false;
    if(isEditableTarget(target)) return false;
    if(target.closest?.(
        '.node, .minimap, .create-menu, #createMenu, #linkCreateMenu, #nodeInputMenu, #nodeOutputMenu, #imageNodeMenu, .link-delete, .link-hit, .link-controls'
    )) return false;
    return board.contains(target);
}
/** Space / 中键：允许从节点表面平移，但仍避开输入框、端口、菜单等 */
function canStartForcedPanFromTarget(target){
    if(!board || !target) return false;
    if(isEditableTarget(target)) return false;
    if(target.closest?.(
        'button, select, textarea, input, .port, .resize-handle, .minimap, .create-menu, #createMenu, #linkCreateMenu, #nodeInputMenu, #nodeOutputMenu, #imageNodeMenu, .link-delete, .link-hit, .link-controls, .canvas-custom-select'
    )) return false;
    return board.contains(target);
}
function setSpacePanArmed(active){
    spacePanArmed = Boolean(active);
    withCanvasRootClass(list => list.toggle('canvas-space-pan', spacePanArmed && Boolean(canvas)));
    if(!spacePanArmed && board && !dragBoard) board.style.cursor = '';
}
function addImageNode(point){
    const p = point || defaultPoint(-120, 0);
    return addNode({id:uid('img'), type:'image', x:p.x, y:p.y, url:'', name:'空白图片'});
}
function addPromptNode(point){
    const p = point || defaultPoint(0, 0);
    return addNode({id:uid('prompt'), type:'prompt', x:p.x, y:p.y, text:''});
}
function addLoopNode(point){
    const p = point || defaultPoint(40, 0);
    return addNode({
        id:uid('loop'),
        type:'loop',
        x:p.x,
        y:p.y,
        count:3,
        mode:'serial',
        showPrompt:false,
        variablePrompt:'',
        fixedPrompt:''
    });
}
function addGroupNode(point){
    const p = point || defaultPoint(40, 0);
    return addNode({id:uid('grp'), type:'group', x:p.x, y:p.y, w:300, h:220, items:[]});
}
function pickMediaForNode(nodeId){
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*,audio/*';
    input.multiple = true;
    input.onchange = () => {
        if(input.files?.length) fillImageNode(nodeId, input.files, {group:input.files.length > 1});
    };
    input.click();
}
function addLLMNode(point){
    const p = point || defaultPoint(80, 0);
    const providerId = chatApiProviders()[0]?.id || 'comfly';
    return addNode({
        id:uid('llm'),
        type:'llm',
        x:p.x,
        y:p.y,
        llmProvider:providerId,
        model:resolveChatModel('', providerId),
        mode:'node',
        systemPrompt:'You are a helpful assistant. Rewrite the input into a concise image prompt.',
        chatInput:'',
        messages:[],
        outputText:'',
        llmInputHeight:110,
        llmOutputHeight:150,
        running:false
    });
}
function addGeneratorNode(point){
    const p = point || defaultPoint(120, 0);
    const providerId = imageApiProviders()[0]?.id || '';
    return addNode({id:uid('gen'), type:'generator', x:p.x, y:p.y, apiProvider:providerId, model:allImageModels(providerId)[0] || '', ratio:'square', resolution:'1k', customRatio:'', customSize:'', customRatioWidth:'', customRatioHeight:'', customWidth:'', customHeight:'', inputs:[]});
}
function addReplicaAgentNode(point){
    const p = point || defaultPoint(160, 0);
    return addNode({
        id:uid('agent'),
        type:'replicaAgent',
        x:p.x,
        y:p.y,
        w:320,
        h:480,
        style_prompt:'',
        ratio:'source',
        resolution:'2k',
        customRatio:'',
        customRatioWidth:'',
        customRatioHeight:'',
        roles:{},
        replica_target_markers:[1],
        replica_character_ref_urls:[],
        textModel:defaultAgentChatModel(),
        inputs:[],
        runStatus:'idle',
        generatedOutputs:[],
        running:false
    });
}
function addImageRepairAgentNode(point){
    const p = point || defaultPoint(180, 0);
    return addNode({
        id:uid('repair'),
        type:'imageRepairAgent',
        x:p.x,
        y:p.y,
        w:320,
        h:460,
        textModel:defaultAgentChatModel(),
        imageModel:models.gpt || 'gpt-image-2',
        ratio:'source',
        resolution:'2k',
        customRatio:'',
        customRatioWidth:'',
        customRatioHeight:'',
        inputs:[],
        runStatus:'idle',
        generatedOutputs:[],
        count:1,
        running:false,
        runError:''
    });
}
function addBatchPosterAgentNode(point){
    const p = point || defaultPoint(200, 0);
    const llmProv = chatApiProviders()[0]?.id || 'comfly';
    return addNode({
        id:uid('bposter'),
        type:'batchPosterAgent',
        x:p.x,
        y:p.y,
        w:340,
        h:520,
        batch_count:3,
        selectedPreset:'random',
        selectedThemeId:null,
        theme_source:'preset',
        custom_theme:'',
        base_prompt:BATCH_POSTER_BASE_PROMPT,
        llmProvider:llmProv,
        model:defaultAgentChatModel(llmProv),
        apiProvider:imageApiProviders()[0]?.id || 'comfly',
        ratio:'source',
        resolution:'2k',
        customRatio:'',
        selectedAspectRatio:'16:9',
        customRatioWidth:'',
        customRatioHeight:'',
        inputs:[],
        imageModel:models.gpt || 'gpt-image-2',
        pipelineMode:'standard',
        spawnedImageIds:[],
        batchProgress:null,
        runStatus:'idle',
        runError:'',
        running:false
    });
}
function addVideoReverseNode(point){
    const p = point || defaultPoint(180, 0);
    const allModels = chatModels.length ? chatModels : ['gemini-3.5-flash'];
    const geminiModels = allModels.filter(m => /gemini/i.test(String(m)));
    const defaultModel = geminiModels[0] || 'gemini-3.5-flash';
    return addNode({
        id:uid('vrev'),
        type:'videoReverse',
        x:p.x,
        y:p.y,
        w:380,
        h:460,
        model:defaultModel,
        system_prompt:'你是专业的视频分析助手。请根据用户提供的视频与提示词，输出清晰、结构化的分析结果。',
        outputText:'',
        runStatus:'idle',
        running:false
    });
}
function addSlotsLoopVideoAgentNode(point){
    const p = point || defaultPoint(200, 0);
    return addNode({
        id:uid('slotsloop'),
        type:'slotsLoopVideoAgent',
        x:p.x,
        y:p.y,
        w:380,
        h:520,
        model:defaultAgentChatModel(),
        duration:5,
        creative_idea:'',
        outputText:'',
        outputData:null,
        runStatus:'idle',
        runError:'',
        running:false,
    });
}
function addMsGenNode(point){
    const p = point || defaultPoint(140, 0);
    return addNode({
        id:uid('msgen'),
        type:'msgen',
        x:p.x,
        y:p.y,
        msgenModel:'zimage',
        msWidth:1024,
        msHeight:1024,
        msCustomModel:modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo',
        msRatio:'square',
        msResolution:'1k',
        msCustomRatio:'',
        msCustomSize:'',
        msCustomRatioWidth:'',
        msCustomRatioHeight:'',
        msCustomWidth:'',
        msCustomHeight:'',
        count:1,
        fitImage:false,
        inputs:[],
        running:false
    });
}
function addVideoNode(point){
    const p = point || defaultPoint(160, 0);
    const providerId = videoApiProviders()[0]?.id || 'comfly';
    return addNode({
        id:uid('vid'),
        type:'video',
        x:p.x,
        y:p.y,
        apiProvider:providerId,
        model:videoModels[0] || DEFAULT_VIDEO_MODELS[0],
        duration:5,
        aspectRatio:'16:9',
        resolution:'',
        enhancePrompt:false,
        enableUpsample:false,
        watermark:false,
        cameraFixed:false,
        generateAudio:false,
        useFrameRoles:false,
        inputs:[],
        running:false
    });
}
function addRhNode(point){
    const p = point || defaultPoint(180, 0);
    return addNode({
        id:uid('rh'),
        type:'rh',
        x:p.x,
        y:p.y,
        w:430,
        h:0,
        rhMode:'app',
        rhPayment:'free',
        webappId:'',
        workflowId:'',
        instanceType:'',
        rhAppInfo:null,
        rhWorkflowInfo:null,
        rhParams:{},
        inputs:[],
        running:false
    });
}
function defaultLTXSegment(start=0, length=120){
    return {
        id:uid('ltxseg'),
        type:'text',
        prompt:'',
        start,
        length,
        color:LTX_SEGMENT_COLORS[0],
        strength:1,
        imageRef:null
    };
}
function addLTXDirectorNode(point){
    const p = point || defaultPoint(200, 0);
    return addNode({
        id:uid('ltxdir'),
        type:'ltxDirector',
        x:p.x,
        y:p.y,
        w:1000,
        h:800,
        globalPrompt:'',
        durationFrames:120,
        durationSeconds:5,
        frameRate:24,
        customWidth:0,
        customHeight:0,
        displayMode:'seconds',
        useCustomAudio:false,
        imgCompression:18,
        epsilon:0.001,
        divisibleBy:32,
        noiseSeed:12,
        ltxTimelineData:'',
        ltxLocalPrompts:'',
        ltxSegmentLengths:'',
        ltxGuideStrength:'',
        ltxSegments:[],
        ltxSelectedSegId:'',
        inputs:[],
        running:false
    });
}
async function getImageDimensions(url){
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({width: img.naturalWidth, height: img.naturalHeight});
        img.onerror = () => reject(new Error('图片加载失败'));
        img.src = url;
    });
}
async function urlToBase64(url){
    const res = await fetch(url);
    if(!res.ok) throw new Error('图片读取失败');
    const blob = await res.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}
function renderMsGenBody(node){
    const wrap = document.createElement('div');
    wrap.className = 'generator-body';
    const modelKey = node.msgenModel || 'zimage';
    const msModel = MS_GEN_MODELS[modelKey] || MS_GEN_MODELS.zimage;
    const inputSources = generatorSources(node);
    const ordered = orderedSources(node, inputSources);
    const imageInputs = ordered.filter(src => src.refs?.length);
    const promptInputs = ordered.filter(src => src.prompt && !src.refs?.length);
    const referenceImages = ordered.flatMap(src => src.refs || []);
    const isCustomMs = modelKey === 'custom';
    const msUsesImages = Boolean(msModel.supportsImage || msModel.acceptsImage);
    node.msCustomModel = node.msCustomModel || modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo';
    const msModelId = currentMsModelId(modelKey, node);
    const msLoras = modelscopeLorasForModel(msModelId);
    const selectedMsLora = msLoras.find(lora => String(lora.id || '').trim() === String(node.msLoraId || '').trim()) || msLoras[0];
    const loraEnabled = Boolean(node.msLoraEnabled);
    const loraStrength = node.msLoraStrength ?? Number(selectedMsLora?.strength ?? 0.8);
    const msCount = Math.max(1, Math.min(8, Number(node.count || 1)));
    wrap.innerHTML = `
        <div class="ms-model-tabs">
            ${Object.entries(MS_GEN_MODELS).map(([k,m]) =>
                `<button type="button" data-model="${k}" class="${modelKey===k?'active':''}">${escapeHtml(m.labelKey ? tr(m.labelKey) : m.label)}</button>`
            ).join('')}
        </div>
        <div class="ms-content">
            <div class="prompt-list mt-2 mb-2"></div>
            ${msUsesImages ? `
            <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2">${tr('canvas.images')}</div>
            <div class="input-list ms-img-list"></div>
            ` : ''}
        </div>
        <div class="ms-controls">
            <div class="gen-settings">
                ${isCustomMs ? `
                <div class="gen-settings-row">
                    <select class="select-lite ms-custom-model-select">${modelscopeImageModelOptions(node.msCustomModel)}</select>
                </div>
                ` : ''}
                <div class="gen-settings-row">
                    <select class="select-lite resolution compact-select" data-field="msResolution">
                        <option value="1k">1K</option>
                        <option value="2k">2K</option>
                        <option value="4k">4K</option>
                    <option value="custom">${tr('canvas.custom')}</option>
                </select>
                <select class="select-lite ratio compact-select" data-field="msRatio">
                    <option value="square">1:1</option>
                    <option value="portrait">2:3</option>
                    <option value="landscape">3:2</option>
                        <option value="portrait43">3:4</option>
                        <option value="landscape43">4:3</option>
                        <option value="story">9:16</option>
                        <option value="wide">16:9</option>
                        <option value="custom">${tr('canvas.custom')}</option>
                    </select>
                    <div class="gen-count-row">
                        <div class="gen-stepper">
                            <button class="gen-step-btn" data-ms-step="-1" type="button" title="${tr('canvas.decrease')}" aria-label="${tr('canvas.decreaseCount')}"><i data-lucide="chevron-left" class="w-3.5 h-3.5"></i></button>
                            <input class="gen-count-input ms-count-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${msCount}">
                            <button class="gen-step-btn" data-ms-step="1" type="button" title="${tr('canvas.increase')}" aria-label="${tr('canvas.increaseCount')}"><i data-lucide="chevron-right" class="w-3.5 h-3.5"></i></button>
                        </div>
                    </div>
                </div>
                <div class="gen-settings-row ms-custom-ratio-row" style="display:none">
                    <label class="field">
                        <div class="setting-title">${tr('canvas.ratioWidth')}</div>
                        <input class="setting-input ms-custom-ratio-w-input" type="number" min="1" step="1" value="${escapeHtml(node.msCustomRatioWidth || '')}" placeholder="4">
                    </label>
                    <label class="field">
                        <div class="setting-title">${tr('canvas.ratioHeight')}</div>
                        <input class="setting-input ms-custom-ratio-h-input" type="number" min="1" step="1" value="${escapeHtml(node.msCustomRatioHeight || '')}" placeholder="3">
                    </label>
                </div>
                <div class="gen-settings-row ms-custom-size-row" style="display:none">
                    <label class="field">
                        <div class="setting-title">${tr('canvas.width')}</div>
                        <input class="setting-input ms-custom-w-input" type="number" min="64" step="64" value="${escapeHtml(node.msCustomWidth || '')}" placeholder="Auto">
                    </label>
                    <label class="field">
                        <div class="setting-title">${tr('canvas.height')}</div>
                        <input class="setting-input ms-custom-h-input" type="number" min="64" step="64" value="${escapeHtml(node.msCustomHeight || '')}" placeholder="Auto">
                    </label>
                    <button class="secondary-btn ms-fit-size-btn" type="button" style="height:32px;align-self:flex-end;padding:0 10px;font-size:11px">${tr('canvas.fitImageSize')}</button>
                </div>
                ${msLoras.length ? `
                <div class="gen-settings-row">
                    <label class="setting-check" style="cursor:pointer">
                        <input type="checkbox" class="ms-lora-check" ${node.msLoraEnabled ? 'checked' : ''}>
                        <span style="font-size:11px;font-weight:700">${tr('canvas.enableLora')}</span>
                    </label>
                </div>
                ${node.msLoraEnabled ? `
                <div class="gen-settings-row">
                    <label class="field" style="flex:1">
                        <div class="setting-title">LoRA</div>
                        <select class="select-lite ms-lora-select">${modelscopeLoraOptions(msLoras, String(selectedMsLora?.id || '').trim())}</select>
                    </label>
                </div>
                <div class="gen-settings-row">
                    <label class="field" style="flex:1">
                        <div class="setting-title" style="display:flex;justify-content:space-between">
                            <span>${tr('canvas.loraStrength')}</span><span class="ms-lora-strength-val">${loraStrength.toFixed(2)}</span>
                        </div>
                        <input type="range" class="canvas-range ms-lora-strength-slider" min="0.1" max="1.0" step="0.05" value="${loraStrength}">
                    </label>
                </div>` : ''}` : ''}
                ${!msLoras.length ? `<div class="gen-settings-row"><div style="color:var(--faint);font-size:11px;font-weight:700;line-height:1.45">${tr('canvas.noLoraForModel')}</div></div>` : ''}
            </div>
            <div class="gen-run-row">
                ${agentGenRunActionsHtml(node.id, `<button class="gen-btn ${agentPendingRunState(node.id, tr('canvas.msGenerate'), tr('canvas.generating')).runningCls}">
                    <i data-lucide="zap" class="w-4 h-4"></i>${escapeHtml(agentPendingRunState(node.id, tr('canvas.msGenerate'), tr('canvas.generating')).label)}
                </button>`)}
                ${cascadeBtnHtml(node)}
            </div>
            ${retryBarHtml(node)}
        </div>
    `;
    wrap.querySelectorAll('.ms-model-tabs button').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            if(node.msgenModel !== btn.dataset.model){
                node.msLoraId = '';
                delete node.msLoraStrength;
                node.msLoraEnabled = false;
            }
            node.msgenModel = btn.dataset.model;
            render();
            scheduleSave();
        };
    });
    const msCustomModelSelect = wrap.querySelector('.ms-custom-model-select');
    if(msCustomModelSelect){
        msCustomModelSelect.onmousedown = e => e.stopPropagation();
        msCustomModelSelect.onclick = e => e.stopPropagation();
        msCustomModelSelect.onchange = e => {
            e.stopPropagation();
            node.msCustomModel = e.target.value;
            node.msLoraId = '';
            delete node.msLoraStrength;
            node.msLoraEnabled = false;
            scheduleSave();
            render();
        };
    }
    const msRatioSelect = wrap.querySelector('[data-field="msRatio"]');
    const msResolutionSelect = wrap.querySelector('[data-field="msResolution"]');
    if(msRatioSelect && msResolutionSelect){
        const msCustomRatioRow = wrap.querySelector('.ms-custom-ratio-row');
        const msCustomSizeRow = wrap.querySelector('.ms-custom-size-row');
        const msCustomRatioWInput = wrap.querySelector('.ms-custom-ratio-w-input');
        const msCustomRatioHInput = wrap.querySelector('.ms-custom-ratio-h-input');
        const msCustomWInput = wrap.querySelector('.ms-custom-w-input');
        const msCustomHInput = wrap.querySelector('.ms-custom-h-input');
        const msFitSizeBtn = wrap.querySelector('.ms-fit-size-btn');
        if((!node.msCustomRatioWidth || !node.msCustomRatioHeight) && node.msCustomRatio) {
            const raw = String(node.msCustomRatio || '');
            if(raw.includes(':')){
                const [w,h] = raw.split(':');
                node.msCustomRatioWidth = node.msCustomRatioWidth || w;
                node.msCustomRatioHeight = node.msCustomRatioHeight || h;
            }
        }
        if((!node.msCustomWidth || !node.msCustomHeight) && node.msCustomSize) {
            const parsed = parseSizeValue(node.msCustomSize);
            node.msCustomWidth = node.msCustomWidth || parsed?.width || '';
            node.msCustomHeight = node.msCustomHeight || parsed?.height || '';
        }
        const syncMsCustomSizeControls = () => {
            const ratioValue = node.msRatio && [...msRatioSelect.options].some(opt => opt.value === node.msRatio) ? node.msRatio : 'square';
            msRatioSelect.value = ratioValue;
            msResolutionSelect.value = node.msResolution || '1k';
            msRatioSelect.disabled = node.msResolution === 'custom';
            msCustomRatioRow.style.display = node.msRatio === 'custom' ? 'flex' : 'none';
            msCustomSizeRow.style.display = node.msResolution === 'custom' ? 'flex' : 'none';
            msCustomRatioWInput.value = node.msCustomRatioWidth || '';
            msCustomRatioHInput.value = node.msCustomRatioHeight || '';
            msCustomWInput.value = node.msCustomWidth || '';
            msCustomHInput.value = node.msCustomHeight || '';
            if(msFitSizeBtn) msFitSizeBtn.disabled = !referenceImages.some(ref => ref.url);
        };
        msRatioSelect.onmousedown = e => e.stopPropagation();
        msRatioSelect.onclick = e => e.stopPropagation();
        msRatioSelect.onchange = e => {
            e.stopPropagation();
            node.msRatio = e.target.value;
            if(node.msRatio !== 'custom') {
                node.msCustomRatio = '';
                node.msCustomRatioWidth = '';
                node.msCustomRatioHeight = '';
            }
            syncMsCustomSizeControls();
            scheduleSave();
        };
        msResolutionSelect.onmousedown = e => e.stopPropagation();
        msResolutionSelect.onclick = e => e.stopPropagation();
        msResolutionSelect.onchange = e => {
            e.stopPropagation();
            node.msResolution = e.target.value;
            if(node.msResolution === 'custom') {
                node.msRatio = '';
            } else if(!node.msRatio) {
                node.msRatio = 'square';
                node.msCustomSize = '';
                node.msCustomWidth = '';
                node.msCustomHeight = '';
            } else {
                node.msCustomSize = '';
                node.msCustomWidth = '';
                node.msCustomHeight = '';
            }
            syncMsCustomSizeControls();
            scheduleSave();
        };
        [msCustomRatioWInput, msCustomRatioHInput].forEach(input => {
            input.onmousedown = e => e.stopPropagation();
            input.onclick = e => e.stopPropagation();
            input.oninput = () => {
                node.msCustomRatioWidth = msCustomRatioWInput.value;
                node.msCustomRatioHeight = msCustomRatioHInput.value;
                node.msCustomRatio = node.msCustomRatioWidth && node.msCustomRatioHeight ? `${node.msCustomRatioWidth}:${node.msCustomRatioHeight}` : '';
                node.msRatio = 'custom';
                syncMsCustomSizeControls();
                scheduleSave();
            };
        });
        [msCustomWInput, msCustomHInput].forEach(input => {
            input.onmousedown = e => e.stopPropagation();
            input.onclick = e => e.stopPropagation();
            input.oninput = () => {
                node.msCustomWidth = msCustomWInput.value;
                node.msCustomHeight = msCustomHInput.value;
                node.msCustomSize = node.msCustomWidth && node.msCustomHeight ? `${node.msCustomWidth}x${node.msCustomHeight}` : '';
                node.msResolution = 'custom';
                node.msRatio = '';
                syncMsCustomSizeControls();
                scheduleSave();
            };
        });
        if(msFitSizeBtn){
            msFitSizeBtn.onmousedown = e => e.stopPropagation();
            msFitSizeBtn.onclick = async e => {
                e.stopPropagation();
                const ref = referenceImages.find(item => item.url);
                if(!ref) return;
                try {
                    const dims = await getImageDimensions(ref.url);
                    node.msCustomWidth = dims.width;
                    node.msCustomHeight = dims.height;
                    node.msCustomSize = `${dims.width}x${dims.height}`;
                    node.msResolution = 'custom';
                    node.msRatio = '';
                    syncMsCustomSizeControls();
                    scheduleSave();
                } catch(err) {
                    showErrorModal(tr('canvas.imageReadFailed'));
                }
            };
        }
        syncMsCustomSizeControls();
    }
    const msCountInput = wrap.querySelector('.ms-count-input');
    if(msCountInput){
        msCountInput.onmousedown = e => e.stopPropagation();
        msCountInput.onclick = e => e.stopPropagation();
        msCountInput.oninput = e => {
            node.count = Math.max(1, Math.min(8, Number(e.target.value) || 1));
            scheduleSave();
        };
        msCountInput.onblur = e => { e.target.value = String(Math.max(1, Math.min(8, Number(node.count || 1)))); };
        wrap.querySelectorAll('[data-ms-step]').forEach(btn => {
            btn.onclick = e => {
                e.stopPropagation();
                const next = Math.max(1, Math.min(8, Number(node.count || 1) + Number(btn.dataset.msStep || 0)));
                node.count = next;
                msCountInput.value = String(next);
                scheduleSave();
            };
        });
    }
    const msLoraCheck = wrap.querySelector('.ms-lora-check');
    if(msLoraCheck){
        msLoraCheck.onchange = e => {
            node.msLoraEnabled = e.target.checked;
            if(node.msLoraEnabled && !node.msLoraId && msLoras[0]){
                node.msLoraId = String(msLoras[0].id || '').trim();
                node.msLoraStrength = Number(msLoras[0].strength ?? 0.8);
            }
            scheduleSave();
            render();
        };
    }
    const msLoraSelect = wrap.querySelector('.ms-lora-select');
    if(msLoraSelect){
        msLoraSelect.onmousedown = e => e.stopPropagation();
        msLoraSelect.onclick = e => e.stopPropagation();
        msLoraSelect.onchange = e => {
            node.msLoraId = e.target.value;
            const picked = msLoras.find(lora => String(lora.id || '').trim() === node.msLoraId);
            node.msLoraStrength = Number(picked?.strength ?? node.msLoraStrength ?? 0.8);
            scheduleSave();
            render();
        };
    }
    const msLoraSlider = wrap.querySelector('.ms-lora-strength-slider');
    if(msLoraSlider){
        msLoraSlider.onmousedown = e => e.stopPropagation();
        msLoraSlider.onclick = e => e.stopPropagation();
        msLoraSlider.oninput = e => {
            node.msLoraStrength = parseFloat(e.target.value);
            const val = wrap.querySelector('.ms-lora-strength-val');
            if(val) val.textContent = node.msLoraStrength.toFixed(2);
            scheduleSave();
        };
    }
    // Make entire setting-check pill clickable (not just the checkbox square)
    wrap.querySelectorAll('.setting-check').forEach(pill => {
        pill.onmousedown = e => e.stopPropagation();
        const cb = pill.querySelector('input[type="checkbox"]');
        if(!cb) return;
        pill.onclick = e => {
            e.stopPropagation();
            e.preventDefault(); // prevent native label activation; we handle it
            cb.checked = !cb.checked;
            cb.dispatchEvent(new Event('change'));
        };
        cb.onclick = e => e.stopPropagation(); // prevent bubble → pill.onclick
    });
    if(msUsesImages){
        const list = wrap.querySelector('.ms-img-list');
        renderImageInputList(list, node, imageInputs);
    }
    renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    wrap.querySelector('.gen-btn').onclick = e => { e.stopPropagation(); runCanvasGenerate(node.id); };
    bindCascadeButtons(wrap, node.id);
    return wrap;
}
async function runMsGenNode(nodeId, opts={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || isNodeDisabled(node)) return;
    const loopCtx = opts.loopContext !== undefined ? opts.loopContext : loopContext;
    const sources = orderedSources(node, generatorSources(node, loopCtx));
    const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
    const refs = imageRefsOnly(sources.flatMap(s => s.refs || []));
    const modelKey = node.msgenModel || 'zimage';
    const msModel = MS_GEN_MODELS[modelKey] || MS_GEN_MODELS.zimage;
    const msModelId = currentMsModelId(modelKey, node);
    const msLoras = modelscopeLorasForModel(msModelId);
    if(!prompt){ softAlert(tr('canvas.needPrompt')); return; }
    if(msModel.supportsImage && !refs.length){ softAlert(tr('canvas.needImage')); return; }
    const count = Math.max(1, Math.min(8, Number(node.count || 1)));
    // 链路中间节点默认不创建 Output；链尾、手动开启或已有 Output 连接时才输出。
    let out = outputForNode(node, 460);
    const pendingIds = Array.from({length:count}, () => uid('p'));
    const run = runSnapshot(node, prompt, refs);
    if(out) out._pending = [...(out._pending || []), ...pendingIds.map(id => makePending(id, run))];
    syncAppendableNodeRunState(node);
    refreshRunNodes(node, out);
    const execute = async () => {
    try {
        const size = apiImageSize(node.msRatio ?? 'square', node.msResolution || '1k', node.msCustomRatio || '', node.msCustomSize || '');
        const parsed = parseSizeValue(size);
        let width = Number(parsed?.width) || 1024;
        let height = Number(parsed?.height) || 1024;
        if(!parsed && node.msWidth && node.msHeight){
            width = Number(node.msWidth) || width;
            height = Number(node.msHeight) || height;
        }
        const imageUrls = [];
        if(msModel.supportsImage || msModel.acceptsImage){
            for(const ref of refs.slice(0,3)){
                if(ref.url){
                    try { imageUrls.push(await urlToBase64(ref.url)); }
                    catch(e){ imageUrls.push(ref.url); }
                }
            }
        }
        const submitMs = async () => {
            let apiBody;
            if(modelKey === 'zimage'){
                apiBody = { prompt, resolution: `${width}x${height}`, client_id: CLIENT_ID };
            } else if(modelKey === 'qwen_edit'){
                apiBody = { prompt, image_urls: imageUrls, resolution: `${width}x${height}`, client_id: CLIENT_ID };
            } else if(modelKey === 'custom'){
                apiBody = {
                    prompt,
                    model: node.msCustomModel || modelscopeImageModels()[0] || 'Tongyi-MAI/Z-Image-Turbo',
                    image_urls: imageUrls,
                    width,
                    height,
                    size: `${width}x${height}`,
                    client_id: CLIENT_ID
                };
            } else {
                apiBody = { prompt, model: msModel.modelId, image_urls: imageUrls, width, height, size:`${width}x${height}`, client_id: CLIENT_ID };
            }
            if(node.msLoraEnabled){
                const selected = msLoras.find(lora => String(lora.id || '').trim() === String(node.msLoraId || '').trim()) || msLoras[0];
                const loraId = String(selected?.id || node.msLoraId || '').trim();
                if(!loraId) throw new Error(tr('canvas.noLoraBoundError'));
                apiBody.loras = { [loraId]: Number(node.msLoraStrength ?? selected?.strength ?? 0.8) };
            }
            const res = await fetch(msModel.endpoint, {
                method:'POST', headers:{'Content-Type':'application/json'},
                body:JSON.stringify(apiBody)
            });
            if(!res.ok) throw new Error(await responseErrorMessage(res, tr('canvas.msFailed')));
            return await res.json();
        };
        const results = await Promise.all(Array.from({length:count}, submitMs));
        const metas = collectRunMetas(out, pendingIds);
        const outputUrls = results.map(data => data.url).filter(Boolean);
        run.request = results[0] ? requestMetaFromResult(results[0]) : {};
        if(out) out._pending = (out._pending || []).filter(p => !pendingIds.includes(p.id));
        appendOutputImages(out, outputUrls, refs[0], metas);
        mergeGeneratedOutputs(node, outputUrls, Boolean(opts.cascade));
        addGenerationLog({run, outputs:outputUrls, runMs:Math.max(...metas.map(m => m.runMs || 0), 0)});
        syncAgentRunStatusAfterTask(node, {completed:agentPendingCount(node.id) === 0});
        refreshRunNodes(node, out);
        scheduleSave();
    } catch(err){
        const metas = collectRunMetas(out, pendingIds);
        addGenerationLog({run, outputs:[], runMs:Math.max(...metas.map(m => m.runMs || 0), 0), error:err.message || String(err)});
        if(out) out._pending = (out._pending || []).filter(p => !pendingIds.includes(p.id));
        syncAgentRunStatusAfterTask(node, {failed:agentPendingCount(node.id) === 0, error:err.message || String(err)});
        refreshRunNodes(node, out);
        if(opts.cascade) throw err;
    }
    };
    if(opts.cascade) await execute();
    else void execute();
}
function addComfyNode(point){
    const p = point || defaultPoint(160, 0);
    return addNode({
        id:uid('comfy'),
        type:'comfy',
        x:p.x,
        y:p.y,
        w:420,
        h:460,
        mode:'text',
        width:1024,
        height:1024,
        enhanceStrength:0.5,
        enhanceUpscale:false,
        enhanceUpscaleRes:2048,
        editUpscale:false,
        editUpscaleRes:2048,
        editModel:allImageModels(imageApiProviders()[0]?.id || 'comfly')[0] || models.gpt,
        ratio:'square',
        resolution:'1k',
        customRatio:'',
        customSize:'',
        customRatioWidth:'',
        customRatioHeight:'',
        customWidth:'',
        customHeight:'',
        comfyWorkflow:'',
        comfyParams:{},
        count:1,
        inputs:[]
    });
}
function addOutputNode(point){
    const p = point || defaultPoint(260, 0);
    return addNode({id:uid('out'), type:'output', x:p.x, y:p.y, images:[]});
}
function addFrameStackNode(point, sourceVideoId=''){
    const p = point || defaultPoint(380, 0);
    return {id:uid('fstack'), type:'frameStack', x:p.x, y:p.y, images:[], sourceVideoId:sourceVideoId || ''};
}
function isImageStackNode(node){
    return node && node.type === 'frameStack';
}
const GROUP_DROP_SNAP_PADDING = 16;
const GROUP_DROP_HEAD_INSET = 48;
const GROUP_CHILD_GAP = 12;
const GROUP_DROP_OVERLAP_RATIO = 0.3;
const GROUP_RESIZE_HANDLE_INSET = 32;
const GROUP_DEFAULT_W = 380;
const GROUP_DEFAULT_H_IMAGE_BATCH = 300;
const GROUP_DEFAULT_H_PROMPT_GROUP = 380;
const GROUP_PANEL_HEAD_IMAGE_BATCH = 156;
const GROUP_PANEL_HEAD_PROMPT_GROUP = 228;
function groupPanelHeadInset(group){
    if(!group) return GROUP_DROP_HEAD_INSET;
    const fallback = group.type === 'imageBatch'
        ? GROUP_PANEL_HEAD_IMAGE_BATCH
        : group.type === 'promptGroup'
            ? GROUP_PANEL_HEAD_PROMPT_GROUP
            : GROUP_DROP_HEAD_INSET;
    const el = nodesEl?.querySelector(`.node[data-id="${CSS.escape(group.id)}"]`);
    if(!el) return fallback;
    const headH = el.querySelector('.node-head')?.offsetHeight || 42;
    const chrome = el.querySelector('.group-panel-chrome');
    if(chrome){
        const chromeH = chrome.offsetHeight || 0;
        if(chromeH > 0) return Math.max(fallback, headH + chromeH + 8);
    }
    return fallback;
}
function isImageBatchMember(group, child){
    if(!group || group.type !== 'imageBatch' || !child || child.type !== 'image') return false;
    if(!Array.isArray(group.items) || !group.items.includes(child.id)) return false;
    return isCenterInGroupRect(nodeRect(child), nodeRect(group));
}
function groupMemberChildren(group){
    if(!group || !['group','imageBatch','promptGroup'].includes(group.type)) return [];
    const childType = group.type === 'promptGroup' ? 'prompt' : 'image';
    return (group.items || [])
        .map(id => nodes.find(n => n.id === id))
        .filter(n => {
            if(!n || n.type !== childType) return false;
            if(group.type === 'promptGroup') return isPromptGroupMember(group, n);
            if(group.type === 'imageBatch') return isImageBatchMember(group, n);
            return isCenterInGroupRect(nodeRect(n), nodeRect(group));
        });
}
function groupUsesResizeHandleInset(group){
    return Boolean(group && ['group','imageBatch','promptGroup'].includes(group.type));
}
function groupInnerRect(group){
    const gr = nodeRect(group);
    const pad = GROUP_DROP_SNAP_PADDING;
    const head = groupPanelHeadInset(group);
    const handleInset = groupUsesResizeHandleInset(group) ? GROUP_RESIZE_HANDLE_INSET : 0;
    return {
        x: gr.x + pad,
        y: gr.y + head,
        w: Math.max(48, gr.w - pad * 2 - handleInset),
        h: Math.max(120, gr.h - head - pad - handleInset),
        pad,
        head,
        handleInset,
    };
}
function isPointInGroupRect(point, group){
    if(!point || !group) return false;
    const gr = nodeRect(group);
    return point.x >= gr.x && point.x <= gr.x + gr.w
        && point.y >= gr.y && point.y <= gr.y + gr.h;
}
function isPointInGroupInnerZone(point, group){
    if(!point || !group) return false;
    const inner = groupInnerRect(group);
    return point.x >= inner.x && point.x <= inner.x + inner.w
        && point.y >= inner.y && point.y <= inner.y + inner.h;
}
function isChildInGroupInnerZone(child, group){
    if(!child || !group) return false;
    const cr = nodeRect(child);
    const inner = groupInnerRect(group);
    if(cr.cx >= inner.x && cr.cx <= inner.x + inner.w && cr.cy >= inner.y && cr.cy <= inner.y + inner.h) return true;
    const overlapX = Math.max(0, Math.min(cr.x + cr.w, inner.x + inner.w) - Math.max(cr.x, inner.x));
    const overlapY = Math.max(0, Math.min(cr.y + cr.h, inner.y + inner.h) - Math.max(cr.y, inner.y));
    const overlapArea = overlapX * overlapY;
    const childArea = Math.max(1, cr.w * cr.h);
    return overlapArea / childArea >= GROUP_DROP_OVERLAP_RATIO;
}
function isChildDropTargetForGroup(group, child, point=null){
    if(!group || !child) return false;
    if(point && isPointInGroupRect(point, group)) return true;
    if(isCenterInGroupRect(nodeRect(child), nodeRect(group))) return true;
    return isChildInGroupInnerZone(child, group);
}
function findGroupForChild(child, groupType, point=null){
    const groups = nodes.filter(n => n.type === groupType);
    if(!groups.length || !child) return null;
    if(groupType === 'imageBatch' || groupType === 'promptGroup'){
        const pickSmallest = list => list.sort((a, b) => (a.w * a.h) - (b.w * b.h))[0] || null;
        return pickSmallest(groups.filter(g => isChildDropTargetForGroup(g, child, point)));
    }
    const cr = nodeRect(child);
    return groups.find(g => isCenterInGroupRect(cr, nodeRect(g))) || null;
}
function layoutMetricsForChild(child){
    const el = nodesEl?.querySelector(`.node[data-id="${CSS.escape(child.id)}"]`);
    const size = defaultNodeSize(child.type);
    const w = Math.max(1, child.w || el?.offsetWidth || size.w || 260);
    let h = child.h || el?.offsetHeight || size.h || 0;
    if(!h || h < 1){
        if(child.type === 'prompt') h = 204;
        else if(child.type === 'image') h = 148;
        else h = 160;
    }
    return { w, h: Math.max(1, Math.round(h)) };
}
function groupItemsForLayout(group, opts={}){
    if(!group) return [];
    const childType = group.type === 'promptGroup' ? 'prompt' : 'image';
    if(opts.layoutAllItems){
        return (group.items || [])
            .map(id => nodes.find(n => n.id === id))
            .filter(n => n?.type === childType);
    }
    return groupMemberChildren(group);
}
function groupGridMetrics(group, children){
    const metrics = children.map(c => layoutMetricsForChild(c));
    if(group.type === 'promptGroup'){
        return {
            childW: Math.max(...metrics.map(m => m.w), 260),
            childH: Math.max(...metrics.map(m => m.h), 180),
        };
    }
    return {
        childW: Math.max(...metrics.map(m => m.w), 180),
        childH: Math.max(...metrics.map(m => m.h), 120),
    };
}
function layoutGroupChildren(group, opts={}){
    if(!group || !['group','imageBatch','promptGroup'].includes(group.type)) return false;
    const children = groupItemsForLayout(group, opts);
    if(!children.length) return false;
    const resizeMode = opts.resizeGroup;
    const inner = groupInnerRect(group);
    const gap = GROUP_CHILD_GAP;
    const minGroup = defaultNodeSize(group.type);
    const tailInset = (inner.handleInset || 0) + inner.pad;
    const { childW, childH } = groupGridMetrics(group, children);
    const idealCols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(children.length))));
    const cols = (resizeMode === true || resizeMode === 'auto')
        ? Math.min(children.length, idealCols)
        : Math.max(1, Math.min(children.length, Math.floor((inner.w + gap) / (childW + gap))));
    const rows = Math.ceil(children.length / cols);
    const gridW = cols * childW + Math.max(0, cols - 1) * gap;
    const gridH = rows * childH + Math.max(0, rows - 1) * gap;
    const offsetX = inner.x + Math.max(0, (inner.w - gridW) / 2);
    const rowStartY = inner.y;
    children.forEach((child, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        child.x = Math.round(offsetX + col * (childW + gap));
        child.y = Math.round(rowStartY + row * (childH + gap));
    });
    const needW = gridW + inner.pad + tailInset;
    const needH = gridH + inner.head + tailInset;
    const fitH = Math.max(minGroup.h || 220, Math.round(needH));
    if(resizeMode === true || resizeMode === 'auto'){
        group.w = Math.max(minGroup.w || 260, Math.round(needW));
        group.h = fitH;
    } else if(resizeMode === false){
        group.h = fitH;
    }
    if(opts.updateDom !== false){
        children.forEach(child => {
            const el = nodesEl.querySelector(`.node[data-id="${CSS.escape(child.id)}"]`);
            if(el){
                el.style.left = `${child.x}px`;
                el.style.top = `${child.y}px`;
            }
        });
        const groupEl = nodesEl.querySelector(`.node[data-id="${CSS.escape(group.id)}"]`);
        if(groupEl && group.w && group.h){
            groupEl.classList.add('sized');
            groupEl.style.width = `${group.w}px`;
            groupEl.style.height = `${group.h}px`;
        }
    }
    return true;
}
function organizeGroupChildren(groupId){
    if(!ensureCanvas()) return;
    const group = nodes.find(n => n.id === groupId);
    if(!group || !['group','imageBatch','promptGroup'].includes(group.type)) return;
    pushUndo();
    layoutGroupChildren(group, { resizeGroup: false, layoutAllItems: true, updateDom: true });
    scheduleLinkGeometryRefresh(new Set([group.id, ...(group.items || [])]));
    if(minimapState) updateMinimapNodePositions();
    scheduleSave();
}
function bindGroupTidyButton(body, group){
    const btn = body.querySelector('.group-tidy-btn');
    if(!btn) return;
    btn.onmousedown = e => e.stopPropagation();
    btn.onclick = e => {
        e.stopPropagation();
        organizeGroupChildren(group.id);
    };
}
function reflowGroupsForMovedChildren(movedNodes, resizeGroup='auto'){
    const groupsToLayout = new Set();
    GROUP_MEMBERSHIP_PAIRS.forEach(({ childType, groupType }) => {
        (movedNodes || []).filter(n => n?.type === childType).forEach(child => {
            const containing = findGroupByCenter(child, groupType);
            if(containing) groupsToLayout.add(containing.id);
        });
    });
    nodes.filter(n => n.type === 'imageBatch' || n.type === 'promptGroup' || n.type === 'group').forEach(g => {
        if((g.items || []).some(id => (movedNodes || []).some(m => m.id === id))) groupsToLayout.add(g.id);
    });
    groupsToLayout.forEach(id => {
        const g = nodes.find(n => n.id === id);
        if(g) layoutGroupChildren(g, { resizeGroup, layoutAllItems: true, updateDom: true });
    });
    if(groupsToLayout.size){
        scheduleLinkGeometryRefresh(new Set([...groupsToLayout].flatMap(id => {
            const g = nodes.find(n => n.id === id);
            return g ? [g.id, ...(g.items || [])] : [id];
        })));
    }
}
function imageBatchChildImages(batch){
    return (batch?.items || []).map(id => nodes.find(n => n.id === id)).filter(n => isNodeEnabled(n) && n?.type === 'image' && n?.url && mediaKindForNode(n) === 'image');
}
function createImageBatchChild(batch, url, name, index){
    const i = index ?? imageBatchChildImages(batch).length;
    const child = {
        id:uid('img'),
        type:'image',
        x:Number(batch.x || 0) + GROUP_DROP_SNAP_PADDING,
        y:Number(batch.y || 0) + GROUP_DROP_HEAD_INSET + i * 28,
        url,
        name:name || outputImageName(url),
    };
    nodes.push(child);
    batch.items = batch.items || [];
    batch.items.push(child.id);
    return child;
}
function addImageBatchNode(point){
    const p = point || defaultPoint(380, 0);
    return addNode({id:uid('ibatch'), type:'imageBatch', x:p.x, y:p.y, w:GROUP_DEFAULT_W, h:GROUP_DEFAULT_H_IMAGE_BATCH, items:[]});
}
function addPromptGroupNode(point){
    const p = point || defaultPoint(40, 0);
    return addNode({id:uid('pg'), type:'promptGroup', x:p.x, y:p.y, w:GROUP_DEFAULT_W, h:GROUP_DEFAULT_H_PROMPT_GROUP, items:[], prefixPrompt:''});
}
function migrateImageBatchNodes(){
    let changed = false;
    nodes.forEach(batch => {
        if(batch.type !== 'imageBatch') return;
        batch.items = batch.items || [];
        const legacy = batch.images;
        if(!Array.isArray(legacy) || !legacy.length){
            if(legacy !== undefined) delete batch.images;
            return;
        }
        legacy.forEach((item, i) => {
            const url = outputUrlValue(item);
            if(!url) return;
            const name = (typeof item === 'object' && item.name) || outputImageName(url);
            createImageBatchChild(batch, url, name, i);
        });
        delete batch.images;
        if(!batch.w) batch.w = 300;
        if(!batch.h) batch.h = Math.max(220, GROUP_DROP_HEAD_INSET + legacy.length * 28 + GROUP_DROP_SNAP_PADDING);
        changed = true;
    });
    return changed;
}
function migratePromptGroupNodes(){
    let changed = false;
    nodes.filter(n => n.type === 'promptGroup').forEach(g => {
        if(prunePromptGroupItems(g)) changed = true;
    });
    return changed;
}
async function uploadImagesToImageBatch(batchId, files){
    const batch = nodes.find(n => n.id === batchId);
    if(!batch || batch.type !== 'imageBatch') return;
    const imgs = [...files].filter(file => mediaKindForUpload(file) === 'image');
    if(!imgs.length) return;
    const form = new FormData();
    imgs.forEach(file => form.append('files', file));
    const res = await apiFetch('/api/ai/upload', {method:'POST', body:form});
    if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Upload failed' : '上传失败'));
    const data = await res.json();
    const uploaded = (data.files || []).filter(file => file?.url);
    if(!uploaded.length) throw new Error(langIsEn() ? 'Upload returned no image URL' : '上传未返回图片地址');
    pushUndo();
    const base = imageBatchChildImages(batch).length;
    uploaded.forEach((file, i) => createImageBatchChild(batch, file.url, file.name, base + i));
    layoutGroupChildren(batch, { resizeGroup: 'auto', layoutAllItems: true, updateDom: true });
    refreshNodes([batch.id]);
    scheduleLinkGeometryRefresh(new Set([batch.id, ...(batch.items || [])]));
    scheduleSave();
}
function bindImageBatchUpload(body, batch){
    const btn = body.querySelector('.image-batch-upload-btn');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    body.appendChild(input);
    const pick = () => input.click();
    const handleFiles = async fileList => {
        if(!fileList?.length) return;
        try {
            await uploadImagesToImageBatch(batch.id, fileList);
        } catch(err) {
            softAlert(err?.message || (langIsEn() ? 'Upload failed' : '上传失败'));
        } finally {
            input.value = '';
        }
    };
    if(btn) btn.onclick = e => { e.stopPropagation(); pick(); };
    input.onchange = () => handleFiles(input.files);
    body.ondragover = e => {
        e.preventDefault();
        e.stopPropagation();
        body.classList.add('image-batch-drag-over');
    };
    body.ondragleave = e => {
        e.stopPropagation();
        body.classList.remove('image-batch-drag-over');
    };
    body.ondrop = async e => {
        e.preventDefault();
        e.stopPropagation();
        body.classList.remove('image-batch-drag-over');
        if(isActiveOutputImageDrag(e.dataTransfer)) return;
        if(e.dataTransfer?.files?.length) await handleFiles(e.dataTransfer.files);
    };
}
function ensureFrameStackForVideo(videoNode){
    if(!videoNode || videoNode.type !== 'image' || mediaKindForNode(videoNode) !== 'video') return null;
    let stack = videoNode.frameOutputId ? nodes.find(n => n.id === videoNode.frameOutputId && n.type === 'frameStack') : null;
    if(!stack){
        stack = connections
            .filter(c => c.from === videoNode.id)
            .map(c => nodes.find(n => n.id === c.to))
            .find(n => n?.type === 'frameStack') || null;
    }
    if(!stack){
        stack = addFrameStackNode({
            x:Number(videoNode.x || 0) + 380,
            y:Number(videoNode.y || 0),
        }, videoNode.id);
        nodes.push(stack);
        videoNode.frameOutputId = stack.id;
    } else {
        videoNode.frameOutputId = stack.id;
        if(!stack.sourceVideoId) stack.sourceVideoId = videoNode.id;
    }
    if(!connections.some(c => c.from === videoNode.id && c.to === stack.id)){
        connections.push({id:uid('c'), from:videoNode.id, to:stack.id});
    }
    return stack;
}
function isOpenScrollableCanvasMenu(target){
    const menu = target?.closest?.('.create-menu.open');
    if(!menu) return false;
    return menu.scrollHeight > menu.clientHeight + 1;
}
function bindCanvasMenuWheelScroll(){
    [createMenu, linkCreateMenu, nodeInputMenu, nodeOutputMenu, imageNodeMenu, selectionMenu].forEach(menu => {
        if(!menu) return;
        on(menu, 'wheel', e => {
            if(!menu.classList.contains('open')) return;
            e.stopPropagation();
        }, {passive: true});
    });
    if(errorMessage){
        on(errorMessage, 'wheel', e => e.stopPropagation(), {passive: true});
    }
    if(nodesEl){
        on(nodesEl, 'wheel', e => {
            if(e.target.closest('.node-retry-msg')) e.stopPropagation();
        }, {capture: true, passive: true});
    }
}
function openCreateMenu(clientX, clientY){
    menuPoint = screenToWorld(clientX, clientY);
    closeLinkCreateMenu();
    createMenu.style.left = `${clientX}px`;
    createMenu.style.top = `${clientY}px`;
    createMenu.classList.add('open');
    refreshIcons();
}
function closeCreateMenu(){
    createMenu.classList.remove('open');
    closeLinkCreateMenu();
    closeImageNodeMenu();
    closeSelectionMenu();
}
function closeSelectionMenu(){
    selectionMenu?.classList.remove('open');
}
function getSelectedLayoutNodes(){
    const ids = new Set([...selected]);
    const childInSelectedGroup = new Set();
    nodes.forEach(n => {
        if((n.type === 'group' || n.type === 'promptGroup' || n.type === 'imageBatch') && ids.has(n.id)){
            (n.items || []).forEach(id => childInSelectedGroup.add(id));
        }
    });
    return [...ids]
        .map(id => nodes.find(n => n.id === id))
        .filter(n => n && !childInSelectedGroup.has(n.id));
}
function isPointInSelectedRegion(clientX, clientY){
    if(!selected.size) return false;
    const layoutNodes = getSelectedLayoutNodes();
    if(!layoutNodes.length) return false;
    const bounds = nodeBounds(layoutNodes.map(n => n.id));
    const p = screenToWorld(clientX, clientY);
    const pad = 20 / Math.max(viewport.scale || 1, 0.25);
    return p.x >= bounds.x - pad && p.x <= bounds.x + bounds.w + pad && p.y >= bounds.y - pad && p.y <= bounds.y + bounds.h + pad;
}
function buildWorkflowTemplateFromNodeIds(nodeIdSource){
    const ids = new Set([...nodeIdSource].map(String));
    nodes.forEach(n => {
        if((n.type === 'group' || n.type === 'promptGroup' || n.type === 'imageBatch') && ids.has(n.id)){
            (n.items || []).forEach(id => ids.add(String(id)));
        }
    });
    const templateNodes = nodes
        .filter(n => ids.has(n.id))
        .map(n => {
            const copy = stripNodeForWorkflowTemplate({...n});
            if((copy.type === 'group' || copy.type === 'promptGroup' || copy.type === 'imageBatch') && Array.isArray(copy.items)){
                copy.items = copy.items.filter(id => ids.has(String(id)));
            }
            if(copy.type === 'replicaAgent' && copy.roles && typeof copy.roles === 'object'){
                const roles = {};
                Object.entries(copy.roles).forEach(([imgId, role]) => {
                    if(ids.has(String(imgId))) roles[imgId] = role;
                });
                copy.roles = roles;
            }
            if(copy.type === 'frameStack' && copy.sourceVideoId && !ids.has(String(copy.sourceVideoId))){
                delete copy.sourceVideoId;
            }
            if(copy.type === 'image' && copy.frameOutputId && !ids.has(String(copy.frameOutputId))){
                delete copy.frameOutputId;
            }
            return copy;
        });
    const templateConnections = connections
        .filter(c => ids.has(String(c.from)) && ids.has(String(c.to)))
        .map(c => ({from:c.from, to:c.to}));
    return {nodes:templateNodes, connections:templateConnections};
}
async function saveWorkflowTemplatePayload(payload){
    const res = await apiFetch('/api/canvas-workflow-templates', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload),
    });
    if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Save template failed' : '保存模板失败'));
    await loadWorkflowTemplates();
}
function openSelectionMenu(clientX, clientY){
    if(!selectionMenu || selected.size < 1) return;
    menuPoint = screenToWorld(clientX, clientY);
    createMenu.classList.remove('open');
    closeLinkCreateMenu();
    closeImageNodeMenu();
    const multi = selected.size >= 2;
    selectionMenu.innerHTML = `
        <div class="menu-section-title">${tr('canvas.selectionActions')}</div>
        ${multi ? `<button type="button" class="menu-btn" data-selection-action="merge-batch" title="${escapeAttr(tr('canvas.mergeImageBatchHint'))}"><i data-lucide="images" class="w-4 h-4"></i><span>${escapeHtml(tr('canvas.mergeImageBatch'))}</span></button>` : ''}
        <button type="button" class="menu-btn" data-selection-action="save-workflow" title="${escapeAttr(tr('canvas.saveSelectionAsWorkflowHint'))}"><i data-lucide="bookmark-plus" class="w-4 h-4"></i><span>${escapeHtml(tr('canvas.saveSelectionAsWorkflow'))}</span></button>
        ${multi ? `<button type="button" class="menu-btn" data-selection-action="organize" title="${escapeAttr(tr('canvas.organizeWorkflowHint'))}"><i data-lucide="workflow" class="w-4 h-4"></i><span>${escapeHtml(tr('canvas.organizeWorkflow'))}</span></button>` : ''}
        ${multi ? `<button type="button" class="menu-btn" data-selection-action="image-batch"><i data-lucide="images" class="w-4 h-4"></i><span>${escapeHtml(tr('canvas.imageBatchNode'))}</span></button>` : ''}
        ${multi ? `<button type="button" class="menu-btn" data-selection-action="prompt-group"><i data-lucide="layers" class="w-4 h-4"></i><span>${escapeHtml(tr('canvas.promptGroupNode'))}</span></button>` : ''}
    `;
    selectionMenu.style.left = `${clientX}px`;
    selectionMenu.style.top = `${clientY}px`;
    selectionMenu.classList.add('open');
    selectionMenu.querySelector('[data-selection-action="save-workflow"]').onclick = e => {
        e.stopPropagation();
        closeSelectionMenu();
        void saveSelectedAsWorkflowTemplate();
    };
    if(multi){
        const mergeBtn = selectionMenu.querySelector('[data-selection-action="merge-batch"]');
        if(mergeBtn){
            mergeBtn.onclick = e => {
                e.stopPropagation();
                closeSelectionMenu();
                mergeSelectedImagesToBatch();
            };
        }
        selectionMenu.querySelector('[data-selection-action="organize"]').onclick = e => {
            e.stopPropagation();
            closeSelectionMenu();
            organizeSelectedNodes();
        };
        selectionMenu.querySelector('[data-selection-action="image-batch"]').onclick = e => {
            e.stopPropagation();
            closeSelectionMenu();
            createImageBatchFromSelection();
        };
        selectionMenu.querySelector('[data-selection-action="prompt-group"]').onclick = e => {
            e.stopPropagation();
            closeSelectionMenu();
            createPromptGroupFromSelection();
        };
    }
    refreshIcons();
}
function linkCreateOptions(state){
    const node = nodes.find(n => n.id === state?.originId);
    if(!node) return [];
    if(state.originKind === 'out'){
        if(['image','prompt','loop','group','promptGroup','llm'].includes(node.type)){
            return filterCanvasNodeOptions([
                {type:'generator', label:tr('canvas.apiGenerate'), icon:'wand-sparkles'},
                {type:'rh', label:tr('canvas.rhGenerate'), icon:'workflow'},
                {type:'video', label:tr('canvas.videoGenerateNode'), icon:'clapperboard'},
                {type:'replicaAgent', label:'复刻 Agent', icon:'bot'},
                {type:'imageRepairAgent', label:langIsEn() ? 'Repair Agent' : '修图 Agent', icon:'wand-sparkles'},
                {type:'batchPosterAgent', label:'Batch Poster Agent', icon:'layout-grid'},
                {type:'nineGridAgent', label:langIsEn() ? 'Nine Grid Agent' : '九宫格 Agent', icon:'grid-3x3'},
                {type:'slotsLoopVideoAgent', label:langIsEn() ? 'Slots Loop Video Agent' : 'Slots 循环视频 Agent', icon:'repeat-2'},
                {type:'videoReverse', label:'视频反推', icon:'scan-search'},
                {type:'llm', label:'LLM', icon:'message-square-text'}
            ]);
        }
        return [];
    }
    if(CANVAS_GENERATOR_TYPES.includes(node.type) || node.type === 'llm'){
        return [
            {type:'image', label:tr('canvas.imageCard'), icon:'image-plus'},
            {type:'prompt', label:tr('canvas.prompt'), icon:'text-cursor-input'},
            {type:'loop', label:tr('canvas.loopNode'), icon:'repeat-2'},
            {type:'group', label:tr('canvas.group'), icon:'group'},
            {type:'llm', label:'LLM', icon:'message-square-text'}
        ];
    }
    return [];
}
function openLinkCreateMenu(originId, originKind, clientX, clientY){
    const state = {originId, originKind, point:screenToWorld(clientX, clientY)};
    const options = linkCreateOptions(state);
    if(!options.length) return false;
    linkCreateState = state;
    createMenu.classList.remove('open');
    linkCreateMenu.innerHTML = options.map(opt => `<button class="menu-btn" data-link-create="${escapeAttr(opt.type)}"><i data-lucide="${escapeAttr(opt.icon)}" class="w-4 h-4"></i><span>${escapeHtml(opt.label)}</span></button>`).join('');
    linkCreateMenu.style.left = `${clientX}px`;
    linkCreateMenu.style.top = `${clientY}px`;
    linkCreateMenu.classList.add('open');
    linkCreateMenu.querySelectorAll('[data-link-create]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            createLinkedNode(btn.dataset.linkCreate);
        };
    });
    refreshIcons();
    return true;
}
function openGeneratorNodeMenu(nodeId, clientX, clientY){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || (!CANVAS_GENERATOR_TYPES.includes(node.type) && node.type !== 'videoReverse' && node.type !== 'batchPosterAgent' && node.type !== 'nineGridAgent' && node.type !== 'imageRepairAgent' && node.type !== 'slotsLoopVideoAgent')) return false;
    const el = nodesEl.querySelector(`.node[data-id="${CSS.escape(nodeId)}"]`);
    const rect = el?.getBoundingClientRect();
    const point = screenToWorld(clientX, clientY);
    const inputOptions = linkCreateOptions({originId:nodeId, originKind:'in', point});
    const outputOptions = [
        {type:'output', label:'Output', icon:'circle-dot'},
        ...(CANVAS_IMAGE_OUTPUT_TYPES.includes(node.type) && node.type !== 'replicaAgent' && node.type !== 'imageRepairAgent' ? filterCanvasNodeOptions([
            {type:'generator', label:tr('canvas.apiGenerate'), icon:'wand-sparkles'},
            {type:'video', label:tr('canvas.videoGenerateNode'), icon:'clapperboard'}
        ]) : [])
    ];
    const buttonsHtml = (options, kind) => `<div class="node-port-menu-grid">${options.map(opt => `<button class="menu-btn" data-link-create="${escapeAttr(opt.type)}" data-link-kind="${kind}" title="${escapeAttr(opt.label)}"><i data-lucide="${escapeAttr(opt.icon)}"></i><span>${escapeHtml(opt.label.replace('生成', ''))}</span></button>`).join('')}</div>`;
    linkCreateState = {originId:nodeId, originKind:'in', point};
    createMenu.classList.remove('open');
    linkCreateMenu.classList.remove('open');
    nodeInputMenu.classList.add('node-port-menu');
    nodeOutputMenu.classList.add('node-port-menu');
    nodeInputMenu.innerHTML = `<div class="menu-section-title">添加输入</div>${buttonsHtml(inputOptions, 'in')}`;
    nodeOutputMenu.innerHTML = `<div class="menu-section-title">添加输出</div>${buttonsHtml(outputOptions, 'out')}`;
    const inputLeft = Math.max(10, (rect?.left || clientX) - 158);
    const outputLeft = Math.min(window.innerWidth - 158, (rect?.right || clientX) + 10);
    const menuTop = Math.max(10, Math.min(window.innerHeight - 260, (rect?.top || clientY) + 36));
    nodeInputMenu.style.left = `${inputLeft}px`;
    nodeInputMenu.style.top = `${menuTop}px`;
    nodeOutputMenu.style.left = `${outputLeft}px`;
    nodeOutputMenu.style.top = `${menuTop}px`;
    nodeInputMenu.classList.add('open');
    nodeOutputMenu.classList.add('open');
    [nodeInputMenu, nodeOutputMenu].forEach(menu => menu.querySelectorAll('[data-link-create]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            linkCreateState = {originId:nodeId, originKind:btn.dataset.linkKind || 'in', point};
            createLinkedNode(btn.dataset.linkCreate);
        };
    }));
    refreshIcons();
    return true;
}
function closeLinkCreateMenu(){
    linkCreateMenu.classList.remove('open');
    linkCreateMenu.innerHTML = '';
    nodeInputMenu.classList.remove('open');
    nodeOutputMenu.classList.remove('open');
    nodeInputMenu.classList.remove('node-port-menu');
    nodeOutputMenu.classList.remove('node-port-menu');
    nodeInputMenu.innerHTML = '';
    nodeOutputMenu.innerHTML = '';
    linkCreateState = null;
}
function openImageNodeMenu(nodeId, clientX, clientY){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'image') return;
    closeCreateMenu();
    const url = String(node.url || '').trim();
    const canEdit = url && mediaKindForNode(node) === 'image' && !isMissingAssetUrl(url);
    const canDownload = url && !isMissingAssetUrl(url);
    imageNodeMenu.innerHTML = `
        ${canEdit ? `<button class="menu-btn" data-image-edit="${escapeAttr(nodeId)}"><i data-lucide="image" class="w-4 h-4"></i><span>${escapeHtml(tr('canvas.editImage'))}</span></button>` : ''}
        ${canDownload ? `<button class="menu-btn" data-image-download="${escapeAttr(nodeId)}"><i data-lucide="download" class="w-4 h-4"></i><span>${tr('canvas.outputDownloadImage')}</span></button>` : ''}
        <button class="menu-btn" data-image-replace="${escapeAttr(nodeId)}"><i data-lucide="image-plus" class="w-4 h-4"></i><span>${langIsEn() ? 'Replace' : '替换'}</span></button>
    `;
    imageNodeMenu.style.left = `${clientX}px`;
    imageNodeMenu.style.top = `${clientY}px`;
    imageNodeMenu.classList.add('open');
    const editBtn = imageNodeMenu.querySelector('[data-image-edit]');
    if(editBtn){
        editBtn.onclick = e => {
            e.stopPropagation();
            closeImageNodeMenu();
            openImageEditor(nodeId);
        };
    }
    const downloadBtn = imageNodeMenu.querySelector('[data-image-download]');
    if(downloadBtn){
        downloadBtn.onclick = e => {
            e.stopPropagation();
            closeImageNodeMenu();
            downloadUrl(url, outputDownloadName(url)).catch(err => softAlert(err.message || tr('canvas.outputDownloadEmpty')));
        };
    }
    imageNodeMenu.querySelector('[data-image-replace]').onclick = e => {
        e.stopPropagation();
        closeImageNodeMenu();
        pickImageForNode(nodeId);
    };
    refreshIcons();
}
function openFrameStackImageMenu(ownerNodeId, imageUrl, imageName, clientX, clientY){
    const owner = nodes.find(n => n.id === ownerNodeId);
    if(!owner || !isImageStackNode(owner) || !imageUrl || isMissingAssetUrl(imageUrl)) return;
    closeCreateMenu();
    imageNodeMenu.innerHTML = `
        <button class="menu-btn" data-frame-edit="1"><i data-lucide="image" class="w-4 h-4"></i><span>${escapeHtml(tr('canvas.editImage'))}</span></button>
    `;
    imageNodeMenu.style.left = `${clientX}px`;
    imageNodeMenu.style.top = `${clientY}px`;
    imageNodeMenu.classList.add('open');
    imageNodeMenu.querySelector('[data-frame-edit]').onclick = e => {
        e.stopPropagation();
        closeImageNodeMenu();
        openFrameStackImageEditor(ownerNodeId, imageUrl, imageName);
    };
    refreshIcons();
}
function openOutputImageMenu(nodeId, imageUrl, clientX, clientY){
    const node = nodes.find(n => n.id === nodeId);
    const url = String(imageUrl || '').trim();
    if(!node || node.type !== 'output' || !url || isMissingAssetUrl(url)) return;
    closeCreateMenu();
    const imageName = outputImageName(url);
    imageNodeMenu.classList.add('output-node-menu');
    imageNodeMenu.innerHTML = `
        <button class="menu-btn" data-output-edit="1"><i data-lucide="image" class="w-4 h-4"></i><span>${escapeHtml(tr('canvas.editImage'))}</span></button>
        <button class="menu-btn" data-output-download="1"><i data-lucide="download" class="w-4 h-4"></i><span>${tr('canvas.outputDownloadImage')}</span></button>
    `;
    const menuWidth = 220;
    imageNodeMenu.style.left = `${Math.max(10, Math.min(window.innerWidth - menuWidth - 10, clientX))}px`;
    imageNodeMenu.style.top = `${clientY}px`;
    imageNodeMenu.classList.add('open');
    imageNodeMenu.querySelector('[data-output-edit]')?.addEventListener('click', e => {
        e.stopPropagation();
        closeImageNodeMenu();
        openOutputImageEditor(nodeId, url, imageName);
    }, {once:true});
    imageNodeMenu.querySelector('[data-output-download]')?.addEventListener('click', e => {
        e.stopPropagation();
        closeImageNodeMenu();
        downloadUrl(url, outputDownloadName(url)).catch(err => softAlert(err.message || tr('canvas.outputDownloadEmpty')));
    }, {once:true});
    refreshIcons();
}
function closeImageNodeMenu(){
    imageNodeMenu.classList.remove('open');
    imageNodeMenu.classList.remove('output-node-menu');
    imageNodeMenu.innerHTML = '';
}
function outputImageUrls(node){
    return (node?.images || []).filter(item => mediaKindForOutputItem(item) === 'image').map(outputUrlValue).filter(Boolean);
}
function outputDownloadableImageUrls(node){
    return (node?.images || []).map(outputUrlValue).filter(url => url && !isMissingAssetUrl(url) && (url.startsWith('/output/') || url.startsWith('/assets/')));
}
function createInputGroupFromOutput(node, point){
    const urls = outputImageUrls(node);
    if(!node || !urls.length) return null;
    const cols = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(urls.length))));
    const cardW = 260;
    const cardH = 336;
    const gap = 24;
    const base = point || {x:Number(node.x || 0), y:Number(node.y || 0)};
    const imageNodes = urls.map((url, i) => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const img = {
            id:uid('img'),
            type:'image',
            x:base.x + 24 + col * (cardW + gap),
            y:base.y + 58 + row * (cardH + gap),
            w:cardW,
            h:cardH,
            url,
            name:outputImageName(url)
        };
        nodes.push(img);
        return img;
    });
    const rows = Math.ceil(urls.length / cols);
    const group = {
        id:uid('grp'),
        type:'group',
        x:base.x,
        y:base.y,
        w:cols * cardW + (cols - 1) * gap + 48,
        h:rows * cardH + (rows - 1) * gap + 90,
        items:imageNodes.map(img => img.id)
    };
    nodes.push(group);
    return group;
}
function convertOutputNodeToInputGroup(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'output') return;
    if(!outputImageUrls(node).length) return;
    pushUndo();
    const downstream = connections.filter(c => c.from === nodeId).map(c => c.to);
    const group = createInputGroupFromOutput(node, {x:Number(node.x || 0), y:Number(node.y || 0)});
    if(!group) return;
    nodes = nodes.filter(n => n.id !== nodeId);
    connections = connections.filter(c => c.from !== nodeId && c.to !== nodeId);
    downstream.forEach(toId => {
        if(canConnect(group.id, toId) && !connections.some(c => c.from === group.id && c.to === toId)){
            connections.push({id:uid('c'), from:group.id, to:toId});
        }
    });
    selected.clear();
    selected.add(group.id);
    syncGeneratorInputs();
    refreshGeneratorInputViews();
    render();
    scheduleSave();
}
function copyOutputNodeToInputGroup(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'output') return;
    if(!outputImageUrls(node).length) return;
    pushUndo();
    const group = createInputGroupFromOutput(node, {x:Number(node.x || 0) + 36, y:Number(node.y || 0) + 36});
    if(!group) return;
    selected.clear();
    selected.add(group.id);
    syncGeneratorInputs();
    refreshGeneratorInputViews();
    render();
    scheduleSave();
}
async function downloadOutputNodeImages(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    const urls = outputDownloadableImageUrls(node);
    if(!node || !urls.length){
        softAlert(tr('canvas.outputDownloadEmpty'));
        return;
    }
    try {
        const res = await apiFetch('/api/canvas-assets/download', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                urls,
                filename:`${(canvas?.title || 'canvas-output').slice(0, 48)}-${node.id}.zip`
            })
        });
        if(!res.ok) throw new Error(await responseErrorMessage(res, tr('canvas.outputDownloadEmpty')));
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${(canvas?.title || 'canvas-output').slice(0, 48)}-${node.id}.zip`;
        canvasRoot.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } catch(err) {
        softAlert(err.message || tr('canvas.outputDownloadEmpty'));
    }
}
function createLinkedNode(type){
    const state = linkCreateState;
    closeLinkCreateMenu();
    if(!state) return;
    const origin = nodes.find(n => n.id === state.originId);
    if(!origin) return;
    pushUndo();
    const created = createNodeByType(type, state.point);
    if(!created) return;
    const fromId = state.originKind === 'out' ? origin.id : created.id;
    const toId = state.originKind === 'out' ? created.id : origin.id;
    const fromNode = nodes.find(n => n.id === fromId);
    const toNode = nodes.find(n => n.id === toId);
    if(fromNode && toNode) ensureLoopAcceptsConnection(fromNode, toNode);
    if(canConnect(fromId, toId) && !connections.some(c => c.from === fromId && c.to === toId)){
        connections.push({id:uid('c'), from:fromId, to:toId});
        if(toNode?.type === 'loop') syncLoopImageBatchSize(toNode);
        syncGeneratorInputs();
        scheduleSave();
        render();
    }
}
function createNodeByType(type, point){
    if(type === 'image') return addImageNode(point);
    if(type === 'prompt') return addPromptNode(point);
    if(type === 'loop') return addLoopNode(point);
    if(type === 'group') return addGroupNode(point);
    if(type === 'llm') return addLLMNode(point);
    if(type === 'generator') return addGeneratorNode(point);
    if(type === 'replicaAgent') return addReplicaAgentNode(point);
    if(type === 'imageRepairAgent') return addImageRepairAgentNode(point);
    if(type === 'batchPosterAgent') return addBatchPosterAgentNode(point);
    if(type === 'nineGridAgent') return addNineGridAgentNode(point);
    if(type === 'slotsLoopVideoAgent') return addSlotsLoopVideoAgentNode(point);
    if(type === 'videoReverse') return addVideoReverseNode(point);
    if(type === 'msgen') return addMsGenNode(point);
    if(type === 'video') return addVideoNode(point);
    if(type === 'rh') return addRhNode(point);
    if(type === 'comfy') return addComfyNode(point);
    if(type === 'ltxDirector') return addLTXDirectorNode(point);
    if(type === 'output') return addOutputNode(point);
    if(type === 'imageBatch') return addImageBatchNode(point);
    return null;
}
function menuAdd(type){
    closeCreateMenu();
    if(type === 'image') addImageNode(menuPoint);
    if(type === 'imageBatch') addImageBatchNode(menuPoint);
    if(type === 'prompt') addPromptNode(menuPoint);
    if(type === 'loop') addLoopNode(menuPoint);
    if(type === 'llm') addLLMNode(menuPoint);
    if(type === 'generator') addGeneratorNode(menuPoint);
    if(type === 'replicaAgent') addReplicaAgentNode(menuPoint);
    if(type === 'imageRepairAgent') addImageRepairAgentNode(menuPoint);
    if(type === 'batchPosterAgent') addBatchPosterAgentNode(menuPoint);
    if(type === 'nineGridAgent') addNineGridAgentNode(menuPoint);
    if(type === 'slotsLoopVideoAgent') addSlotsLoopVideoAgentNode(menuPoint);
    if(type === 'videoReverse') addVideoReverseNode(menuPoint);
    if(type === 'msgen') addMsGenNode(menuPoint);
    if(type === 'video') addVideoNode(menuPoint);
    if(type === 'rh') addRhNode(menuPoint);
    if(type === 'comfy') addComfyNode(menuPoint);
    if(type === 'ltxDirector') addLTXDirectorNode(menuPoint);
    if(type === 'output') addOutputNode(menuPoint);
}
function mediaKindForUpload(file){
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    if(type.startsWith('video/') || /\.(mp4|webm|mov|m4v|avi|mkv)(\?|$)/.test(name)) return 'video';
    if(type.startsWith('audio/') || /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name)) return 'audio';
    return 'image';
}
function isSupportedUploadFile(file){
    const type = String(file?.type || '').toLowerCase();
    const name = String(file?.name || '').toLowerCase();
    return type.startsWith('image/') || type.startsWith('video/') || type.startsWith('audio/')
        || /\.(png|jpe?g|webp|gif|bmp|avif|mp4|webm|mov|m4v|avi|mkv|mp3|wav|m4a|aac|ogg|flac)(\?|$)/.test(name);
}
function dataTransferItemEntry(item){
    try { return item?.webkitGetAsEntry?.() || null; } catch { return null; }
}
async function filesFromEntry(entry){
    if(!entry) return [];
    if(entry.isFile){
        return new Promise(resolve => entry.file(file => resolve(file ? [file] : []), () => resolve([])));
    }
    if(!entry.isDirectory) return [];
    const reader = entry.createReader();
    const children = [];
    while(true){
        const batch = await new Promise(resolve => reader.readEntries(resolve, () => resolve([])));
        if(!batch.length) break;
        children.push(...batch);
    }
    const nested = await Promise.all(children.map(filesFromEntry));
    return nested.flat();
}
async function uploadFilesFromDataTransfer(dataTransfer){
    const items = [...(dataTransfer?.items || [])];
    const entries = items.map(dataTransferItemEntry).filter(Boolean);
    const raw = entries.length
        ? (await Promise.all(entries.map(filesFromEntry))).flat()
        : [...(dataTransfer?.files || [])];
    return raw.filter(isSupportedUploadFile);
}
function isAudioUrl(url){
    return /\.(mp3|wav|m4a|aac|ogg|flac)(\?|$)/i.test(String(url || ''));
}
function isTextUrl(url){
    return /\.(txt|json|csv|srt|vtt|md)(\?|$)/i.test(String(url || ''));
}
function mediaKindForRef(ref){
    const kind = String(ref?.kind || ref?.mediaKind || '').toLowerCase();
    if(['video','audio','image','text','file'].includes(kind)) return kind;
    const url = String(ref?.url || ref || '');
    if(isVideoUrl(url)) return 'video';
    if(isAudioUrl(url)) return 'audio';
    if(isTextUrl(url)) return 'text';
    return 'image';
}
function imageRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForRef(ref) === 'image');
}
function videoRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForRef(ref) === 'video');
}
function audioRefsOnly(refs){
    return (refs || []).filter(ref => ref?.url && mediaKindForRef(ref) === 'audio');
}
function mediaKindForNode(node){
    if(node?.mediaKind) return node.mediaKind;
    if(isVideoUrl(node?.url)) return 'video';
    if(isAudioUrl(node?.url)) return 'audio';
    return 'image';
}
function nodeTitleForMedia(node){
    const kind = mediaKindForNode(node);
    if(kind === 'video') return 'Video';
    if(kind === 'audio') return 'Audio';
    return 'Image';
}
const IMAGE_DROP_EXT_RE = /\.(png|jpe?g|webp|gif)$/i;
const IMAGE_DROP_TEXT_TYPES = [
    'text/uri-list',
    'text/plain',
    'text/html',
    'DownloadURL',
    'text/x-moz-url',
    'text/x-file-url',
    'public.file-url',
    'public.url',
    'UniformResourceLocator',
    'FileName',
    'FileNameW'
];
const IMAGE_DROP_TYPE_HINT_RE = /^(?:files?|image\/.+|text\/(?:uri-list|html|plain|x-moz-url|x-file-url)|downloadurl|public\.(?:file-url|url)|uniformresourcelocator|filenamew?)$|application\/x-qt-(?:windows-mime|image)|application\/x-moz-file|com\.eagle/i;
function dropDataTypes(dataTransfer){
    return [...(dataTransfer?.types || [])].map(type => String(type || ''));
}
function readDropData(dataTransfer, type){
    try { return dataTransfer?.getData?.(type) || ''; } catch(_) { return ''; }
}
function decodeDropText(value){
    const text = String(value || '').trim();
    if(!text) return '';
    try { return decodeURIComponent(text); } catch(_) { return text; }
}
function imageDropTextFragments(value){
    const text = String(value || '').trim();
    if(!text) return [];
    const fragments = [];
    if(/<img|<a\s/i.test(text)){
        const doc = new DOMParser().parseFromString(text, 'text/html');
        doc.querySelectorAll('img[src],a[href]').forEach(el => fragments.push(el.getAttribute('src') || el.getAttribute('href') || ''));
    }
    text.split(/\r?\n/).forEach(line => {
        const item = line.trim();
        if(item) fragments.push(item);
    });
    const downloadUrl = text.match(/^image\/[^\s:]+:(.+)$/i);
    if(downloadUrl) fragments.push(downloadUrl[1]);
    return fragments;
}
function uniqueValues(values){
    const seen = new Set();
    return values.filter(value => {
        const key = String(value || '').trim();
        if(!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
function dropTextCandidates(dataTransfer){
    if(!dataTransfer) return [];
    const types = uniqueValues([...IMAGE_DROP_TEXT_TYPES, ...dropDataTypes(dataTransfer)]);
    const values = types.map(type => readDropData(dataTransfer, type)).filter(Boolean);
    return uniqueValues(values.flatMap(imageDropTextFragments).map(decodeDropText))
        .filter(s => s && !s.startsWith('#'));
}
function isRemoteImageDropValue(value){
    const text = String(value || '').trim();
    return /^https?:\/\/.+/i.test(text) || /^data:image\//i.test(text) || /^blob:/i.test(text);
}
function isLocalImageDropValue(value){
    const text = String(value || '').trim();
    if(!text) return false;
    let path = text;
    if(/^file:/i.test(path)){
        try {
            const url = new URL(path);
            if(url.protocol !== 'file:') return false;
            path = decodeURIComponent(url.pathname || path);
        } catch(_) {
            return false;
        }
    }
    if(/^\/[a-zA-Z]:[\\/]/.test(path)) path = path.slice(1);
    const clean = path.split(/[?#]/, 1)[0];
    const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(clean);
    const isPosixPath = clean.startsWith('/');
    return (isWindowsPath || isPosixPath) && IMAGE_DROP_EXT_RE.test(clean);
}
function imageFilesFromDataTransfer(dataTransfer){
    return [...(dataTransfer?.files || [])].filter(isSupportedUploadFile);
}
function localImagePathsFromDataTransfer(dataTransfer){
    return uniqueValues(dropTextCandidates(dataTransfer).filter(isLocalImageDropValue));
}
function imageUrlFromDataTransfer(dataTransfer){
    return dropTextCandidates(dataTransfer).find(isRemoteImageDropValue) || '';
}
function imageDropPayload(dataTransfer){
    const files = imageFilesFromDataTransfer(dataTransfer);
    if(files.length) return {type:'files', files};
    const localPaths = localImagePathsFromDataTransfer(dataTransfer);
    if(localPaths.length) return {type:'localPaths', localPaths};
    const url = imageUrlFromDataTransfer(dataTransfer);
    if(url) return {type:'url', url};
    return {type:'none'};
}
async function resolveImageDropPayload(dataTransfer){
    const payload = imageDropPayload(dataTransfer);
    if(payload.type !== 'none') return payload;
    if(hasImageFiles(dataTransfer?.items)){
        const files = await uploadFilesFromDataTransfer(dataTransfer);
        if(files.length) return {type:'files', files};
    }
    return payload;
}
async function importLocalImages(paths){
    if(!paths?.length) return [];
    const response = await apiFetch('/api/ai/import-local-image', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({paths})
    });
    if(!response.ok) throw new Error(await responseErrorMessage(response, langIsEn() ? 'Local image import failed' : '导入本地图片失败'));
    const data = await response.json();
    return data.files || [];
}
function layoutUploadedMediaNodes(created, base){
    const list = [...(created || [])];
    if(!list.length) return;
    const cols = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(list.length))));
    const gapX = 280;
    const gapY = 250;
    const startX = base.x - ((cols - 1) * gapX) / 2;
    list.forEach((node, i) => {
        node.x = startX + (i % cols) * gapX;
        node.y = base.y + Math.floor(i / cols) * gapY;
    });
}
function createImageBatchForUploadedNodes(created, point){
    const targets = [...(created || [])].filter(n => n?.type === 'image' && n?.url && mediaKindForNode(n) === 'image');
    if(targets.length < 2) return null;
    const batch = buildImageBatchFromImages(targets, point);
    selected.clear();
    selected.add(batch.id);
    return batch;
}
async function uploadMediaFiles(files, point, onlyImages=false, opts={}){
    if(!ensureCanvas()) return;
    const supported = [...files].filter(file => {
        const kind = mediaKindForUpload(file);
        return onlyImages ? kind === 'image' : ['image','video','audio'].includes(kind);
    });
    if(!supported.length) return [];
    const form = new FormData();
    supported.forEach(file => form.append('files', file));
    const data = await apiFetch('/api/ai/upload', {method:'POST', body:form}).then(r=>r.json());
    const base = point || screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
    const created = [];
    (data.files || []).forEach((file, i) => {
        const kind = file.kind || mediaKindForUpload(supported[i]);
        const node = {
            id:uid('img'),
            type:'image',
            x:base.x + i * 36,
            y:base.y + i * 36,
            url:file.url,
            name:file.name,
            mediaKind:kind
        };
        nodes.push(node);
        created.push(node);
    });
    if(opts.group){
        const imageNodes = created.filter(n => n?.type === 'image' && n?.url && mediaKindForNode(n) === 'image');
        if(imageNodes.length > 1){
            created.batch = createImageBatchForUploadedNodes(created, base);
        }
    }
    render();
    if(created.batch?.id){
        relayoutGroupsWithMeasuredChrome([created.batch.id], 'auto');
    }
    scheduleSave();
    return created;
}
async function uploadImages(files, point){
    return uploadMediaFiles(files, point, false);
}
async function uploadImageGroup(files, point){
    return uploadMediaFiles(files, point, false, {group:true});
}
async function waitForVideoFrameReady(video){
    const notReadyMsg = langIsEn() ? 'Video is not ready yet. Play it briefly and try again.' : '视频尚未就绪，请先播放后再截取。';
    const decodeFailMsg = langIsEn() ? 'Failed to decode this frame. Scrub the timeline and try again.' : '无法解码当前帧，请拖动进度条后再截取。';
    const waitOnce = (event, timeoutMs) => new Promise((resolve, reject) => {
        if(event === 'loadedmetadata' && video.readyState >= HTMLMediaElement.HAVE_METADATA) return resolve();
        if(event === 'loadeddata' && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return resolve();
        const timer = setTimeout(() => {
            video.removeEventListener(event, onEvent);
            reject(new Error(notReadyMsg));
        }, timeoutMs);
        const onEvent = () => {
            clearTimeout(timer);
            video.removeEventListener(event, onEvent);
            resolve();
        };
        video.addEventListener(event, onEvent);
    });
    if(video.readyState < HTMLMediaElement.HAVE_METADATA){
        await waitOnce('loadedmetadata', 10000);
    }
    if(!video.videoWidth || !video.videoHeight){
        if(video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA){
            await waitOnce('loadeddata', 10000);
        }
    }
    if(!video.videoWidth || !video.videoHeight){
        const wasMuted = video.muted;
        video.muted = true;
        try {
            await video.play();
            await waitOnce('loadeddata', 3000);
        } catch(_) {
            /* autoplay blocked — seek path below may still work */
        } finally {
            video.pause();
            video.muted = wasMuted;
        }
    }
    if(!video.videoWidth || !video.videoHeight) throw new Error(notReadyMsg);
    await seekVideoFrameForCapture(video, decodeFailMsg);
}
function waitVideoSeek(video, time, errMsg, timeoutMs=5000){
    return new Promise((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => done(() => reject(new Error(errMsg))), timeoutMs);
        const onSeeked = () => done(resolve);
        const onError = () => done(() => reject(new Error(errMsg)));
        const done = cb => {
            if(settled) return;
            settled = true;
            clearTimeout(timer);
            video.removeEventListener('seeked', onSeeked);
            video.removeEventListener('error', onError);
            cb();
        };
        video.addEventListener('seeked', onSeeked);
        video.addEventListener('error', onError, {once:true});
        try {
            video.currentTime = time;
            if(!video.seeking && Math.abs(video.currentTime - time) < 0.02){
                done(resolve);
            }
        } catch(err) {
            done(() => reject(err instanceof Error ? err : new Error(errMsg)));
        }
    });
}
function waitVideoPaintSync(){
    return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}
/** 暂停时 rVFC 不会回调；用 seek + 双 rAF 等待帧绘制完成 */
async function seekVideoFrameForCapture(video, errMsg){
    const duration = Number.isFinite(video.duration) ? video.duration : null;
    const targetTime = duration === null
        ? Math.max(0, video.currentTime)
        : Math.max(0, Math.min(video.currentTime, Math.max(0, duration - 0.001)));
    const epsilon = Math.min(0.05, Math.max(0.001, targetTime * 0.01 + 0.001));
    const atTarget = Math.abs(video.currentTime - targetTime) < 0.0005;
    if(atTarget && targetTime > epsilon){
        await waitVideoSeek(video, Math.max(0, targetTime - epsilon), errMsg);
        await waitVideoSeek(video, targetTime, errMsg);
    } else if(atTarget && targetTime <= 0.0005){
        await waitVideoSeek(video, Math.min(0.001, duration || 0.001), errMsg);
        if(targetTime > 0) await waitVideoSeek(video, targetTime, errMsg);
    } else {
        await waitVideoSeek(video, targetTime, errMsg);
    }
    await waitVideoPaintSync();
}
function refreshImageStackConsumers(nodeId){
    syncGeneratorInputs();
    refreshGeneratorInputViews();
    connections.filter(c => c.from === nodeId).forEach(c => {
        const target = nodes.find(n => n.id === c.to);
        if(target && ['replicaAgent','imageRepairAgent','generator','loop','llm'].includes(target.type)) refreshNodes([target.id]);
    });
}
function refreshVideoFrameConsumers(nodeId){
    refreshImageStackConsumers(nodeId);
}
async function uploadImagesToStackNode(nodeId, files){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || !isImageStackNode(node)) return;
    const imgs = [...files].filter(file => mediaKindForUpload(file) === 'image');
    if(!imgs.length) return;
    const form = new FormData();
    imgs.forEach(file => form.append('files', file));
    const res = await apiFetch('/api/ai/upload', {method:'POST', body:form});
    if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Upload failed' : '上传失败'));
    const data = await res.json();
    const uploaded = (data.files || []).filter(file => file?.url);
    if(!uploaded.length) throw new Error(langIsEn() ? 'Upload returned no image URL' : '上传未返回图片地址');
    pushUndo();
    appendOutputImages(node, uploaded.map(file => file.url), null, uploaded.map(file => ({kind:'image', name:file.name})));
    refreshNodes([node.id]);
    refreshImageStackConsumers(node.id);
    scheduleSave();
}
function bindFrameStackUpload(body, node){
    const btn = body.querySelector('.frame-stack-upload-btn');
    const empty = body.querySelector('.frame-stack-empty');
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = true;
    input.style.display = 'none';
    body.appendChild(input);
    const pick = () => input.click();
    const handleFiles = async fileList => {
        if(!fileList?.length) return;
        try {
            await uploadImagesToStackNode(node.id, fileList);
        } catch(err) {
            softAlert(err?.message || (langIsEn() ? 'Upload failed' : '上传失败'));
        } finally {
            input.value = '';
        }
    };
    if(btn) btn.onclick = e => { e.stopPropagation(); pick(); };
    if(empty) empty.onclick = e => { e.stopPropagation(); pick(); };
    input.onchange = () => handleFiles(input.files);
    body.ondragover = e => {
        e.preventDefault();
        e.stopPropagation();
        body.classList.add('frame-stack-drag-over');
    };
    body.ondragleave = e => {
        e.stopPropagation();
        body.classList.remove('frame-stack-drag-over');
    };
    body.ondrop = async e => {
        e.preventDefault();
        e.stopPropagation();
        body.classList.remove('frame-stack-drag-over');
        if(isActiveOutputImageDrag(e.dataTransfer)) return;
        if(e.dataTransfer?.files?.length) await handleFiles(e.dataTransfer.files);
    };
}
async function captureVideoFrameFromNode(nodeId){
    if(!ensureCanvas()) return null;
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'image' || mediaKindForNode(node) !== 'video' || !node.url) return null;
    const el = nodesEl?.querySelector(`.node[data-id="${CSS.escape(nodeId)}"]`);
    const video = el?.querySelector('video');
    if(!video){
        softAlert(langIsEn() ? 'Video player not found' : '未找到视频播放器');
        return null;
    }
    await waitForVideoFrameReady(video);
    const w = video.videoWidth;
    const h = video.videoHeight;
    if(!w || !h) throw new Error(langIsEn() ? 'Video is not ready yet. Play it briefly and try again.' : '视频尚未就绪，请先播放后再截取。');
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', {willReadFrequently:true});
    if(!ctx) throw new Error(langIsEn() ? 'Failed to capture frame' : '截取失败');
    ctx.drawImage(video, 0, 0, w, h);
    const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(result => {
            if(result) resolve(result);
            else reject(new Error(langIsEn() ? 'Failed to export frame' : '导出帧失败'));
        }, 'image/jpeg', 0.95);
    });
    const baseName = String(node.name || 'video').replace(/\.[^.]+$/, '') || 'video';
    const filename = `${baseName}_frame_${Date.now()}.jpg`;
    const form = new FormData();
    form.append('files', blob, filename);
    const res = await apiFetch('/api/ai/upload', {method:'POST', body:form});
    if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Upload failed' : '上传失败'));
    const data = await res.json();
    const file = (data.files || [])[0];
    if(!file?.url) throw new Error(langIsEn() ? 'Upload returned no image URL' : '上传未返回图片地址');
    pushUndo();
    const stack = ensureFrameStackForVideo(node);
    if(!stack) throw new Error(langIsEn() ? 'Failed to create frame stack node' : '创建截帧集节点失败');
    const frameIndex = (stack.images || []).length + 1;
    appendOutputImages(stack, [file.url], null, [{
        kind:'image',
        name:file.name || `${baseName}_frame_${frameIndex}.jpg`,
        width:w,
        height:h,
        time:video.currentTime,
    }]);
    render();
    refreshVideoFrameConsumers(stack.id);
    scheduleSave();
    return {url:file.url, stackId:stack.id, width:w, height:h};
}
function bindVideoCaptureFrame(body, node){
    const btn = body.querySelector('.btn-capture-frame');
    const video = body.querySelector('video');
    if(!btn || !video) return;
    btn.onmousedown = e => {
        e.preventDefault();
        e.stopPropagation();
    };
    btn.onclick = async e => {
        e.preventDefault();
        e.stopPropagation();
        if(btn.disabled) return;
        btn.disabled = true;
        const oldLabel = btn.textContent;
        btn.textContent = langIsEn() ? 'Capturing…' : '截取中…';
        try {
            await captureVideoFrameFromNode(node.id);
        } catch(err) {
            softAlert(err?.message || (langIsEn() ? 'Failed to capture frame' : '截取当前帧失败'));
        } finally {
            btn.disabled = false;
            btn.textContent = oldLabel || (langIsEn() ? 'Capture frame' : '截取当前帧');
        }
    };
}
function createImageCardFromUrl(url, point, name='image'){
    if(!ensureCanvas() || !url) return null;
    const p = point || defaultPoint(0, 0);
    const mediaKind = isVideoUrl(url) ? 'video' : isAudioUrl(url) ? 'audio' : 'image';
    const node = {id:uid('img'), type:'image', x:p.x, y:p.y, url, name:name || outputImageName(url), mediaKind};
    pushUndo();
    nodes.push(node);
    selected.clear();
    selected.add(node.id);
    render();
    scheduleSave();
    return node;
}
/** 素材库 / 历史生成：在视口中心放置图片节点 */
function placeImageUrlOnCanvas(url, name='image'){
    if(!ensureCanvas() || !url) return null;
    const point = board
        ? screenToWorld(board.getBoundingClientRect().left + board.clientWidth / 2, board.getBoundingClientRect().top + board.clientHeight / 2)
        : defaultPoint(0, 0);
    const node = createImageCardFromUrl(url, point, name);
    if(node) setStatus(langIsEn() ? 'Image placed' : '已放置图片');
    return node;
}
async function downloadAllCanvasOutputImages(){
    if(!ensureCanvas()) return;
    const urls = [];
    const seen = new Set();
    nodes.filter(n => n.type === 'output' || n.type === 'frameStack').forEach(node => {
        outputDownloadableImageUrls(node).forEach(url => {
            if(!url || seen.has(url)) return;
            seen.add(url);
            urls.push(url);
        });
    });
    if(!urls.length){
        softAlert(tr('canvas.outputDownloadEmpty'));
        return;
    }
    try {
        setStatus(langIsEn() ? `Exporting ${urls.length} images…` : `正在导出 ${urls.length} 张…`);
        const res = await apiFetch('/api/canvas-assets/download', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                urls,
                filename:`${(canvas?.title || 'canvas-output').slice(0, 48)}-all.zip`
            })
        });
        if(!res.ok) throw new Error(await responseErrorMessage(res, tr('canvas.outputDownloadEmpty')));
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${(canvas?.title || 'canvas-output').slice(0, 48)}-all.zip`;
        canvasRoot.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
        setStatus(langIsEn() ? 'Export ready' : '导出完成');
    } catch(err) {
        softAlert(err.message || tr('canvas.outputDownloadEmpty'));
    }
}
function exportCanvasWorkflowJson(mode='canvas'){
    if(!ensureCanvas()) return;
    let ids = [];
    if(mode === 'selection' && selected.size){
        ids = [...selected];
    } else {
        ids = nodes.map(n => n.id);
    }
    const built = buildWorkflowTemplateFromNodeIds(ids);
    if(!built.nodes?.length){
        softAlert(langIsEn() ? 'No nodes to export' : '没有可导出的节点');
        return;
    }
    const payload = {
        version:1,
        kind:'lhz-canvas-workflow',
        title: canvas?.title || 'workflow',
        exportedAt: new Date().toISOString(),
        nodes: built.nodes,
        connections: built.connections,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type:'application/json'});
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${String(payload.title || 'workflow').slice(0, 48)}.json`;
    canvasRoot.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    setStatus(langIsEn() ? 'Workflow JSON exported' : '工作流 JSON 已导出');
}
async function importCanvasWorkflowJsonFile(file){
    if(!ensureCanvas() || !file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        const template = {
            title: data.title || file.name || 'imported',
            nodes: data.nodes || data.template?.nodes || [],
            connections: data.connections || data.template?.connections || [],
            icon: data.icon || 'workflow',
        };
        if(!template.nodes.length) throw new Error(langIsEn() ? 'Invalid workflow JSON' : '无效的工作流 JSON');
        pushUndo();
        const offset = computeWorkflowTemplateOffset(template);
        const {nodes:newNodes, connections:newConnections} = instantiateWorkflowTemplate(template, offset);
        nodes.push(...newNodes);
        connections.push(...newConnections);
        sanitizeConnections();
        syncGeneratorInputs();
        selected.clear();
        newNodes.forEach(n => selected.add(n.id));
        render();
        scheduleSave();
        setStatus(langIsEn() ? 'Workflow imported' : '工作流已导入');
    } catch(err) {
        showErrorModal(err.message || String(err), langIsEn() ? 'Import failed' : '导入失败');
    }
}
function openCanvasWorkflowImportPicker(){
    if(!ensureCanvas()) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
        const file = input.files?.[0];
        if(file) void importCanvasWorkflowJsonFile(file);
    };
    input.click();
}
function closeCanvasGenerationBrowser(){
    document.getElementById('canvasGenerationBrowser')?.remove();
}
function openCanvasHistoryHub(tab = 'library'){
    if(!ensureCanvas() || !isInfiniteCanvasEditorOpen()) return;
    if(tab === 'logs'){
        closeCanvasGenerationBrowser();
        openCanvasLog();
        return;
    }
    closeCanvasLog();
    void openCanvasGenerationBrowser();
}
async function openCanvasGenerationBrowser(){
    if(!ensureCanvas() || !isInfiniteCanvasEditorOpen()) return;
    closeCanvasGenerationBrowser();
    const root = canvasRoot || document.querySelector('.infinite-canvas-root');
    if(!root) return;
    const modal = document.createElement('div');
    modal.id = 'canvasGenerationBrowser';
    modal.className = 'canvas-gen-browser-modal';
    modal.innerHTML = `
        <div class="canvas-gen-browser-panel" role="dialog" aria-label="历史">
            <div class="canvas-gen-browser-head">
                <div>
                    <div class="canvas-gen-browser-title">历史</div>
                    <div class="canvas-gen-browser-sub">成片库可跨画布放入当前板 · 本板日志看运行记录</div>
                </div>
                <button type="button" class="canvas-gen-browser-close" aria-label="关闭">×</button>
            </div>
            <div class="canvas-history-tabs" role="tablist">
                <button type="button" class="canvas-history-tab is-active" data-history-tab="library" role="tab" aria-selected="true">成片库</button>
                <button type="button" class="canvas-history-tab" data-history-tab="logs" role="tab" aria-selected="false">本板日志</button>
            </div>
            <input class="canvas-gen-browser-search" type="search" placeholder="搜索提示词 / 模型…" autocomplete="off" />
            <div class="canvas-gen-browser-list"><div class="canvas-gen-browser-empty">加载中…</div></div>
        </div>
    `;
    const list = modal.querySelector('.canvas-gen-browser-list');
    const search = modal.querySelector('.canvas-gen-browser-search');
    let items = [];
    const renderItems = () => {
        const q = String(search.value || '').trim().toLowerCase();
        const filtered = items.filter(item => {
            if(!q) return true;
            return `${item.prompt || ''} ${item.model || ''}`.toLowerCase().includes(q);
        });
        list.innerHTML = filtered.length
            ? filtered.map(item => {
                const url = item.preview_path || item.thumbnail_path || '';
                return `<button type="button" class="canvas-gen-browser-item" data-url="${escapeAttr(url)}" data-name="${escapeAttr((item.model || 'gen') + '')}">
                    <img src="${escapeAttr(item.thumbnail_path || url)}" alt="" loading="lazy" />
                    <div class="canvas-gen-browser-meta">
                        <div class="canvas-gen-browser-prompt">${escapeHtml(String(item.prompt || '').slice(0, 120) || '（无提示词）')}</div>
                        <div class="canvas-gen-browser-model">${escapeHtml(item.model || '未知模型')}</div>
                    </div>
                </button>`;
            }).join('')
            : `<div class="canvas-gen-browser-empty">${langIsEn() ? 'No generations found' : '没有匹配的历史生成'}</div>`;
        list.querySelectorAll('.canvas-gen-browser-item').forEach(btn => {
            btn.onclick = () => {
                const url = btn.getAttribute('data-url');
                const name = btn.getAttribute('data-name') || 'image';
                if(!url) return;
                placeImageUrlOnCanvas(url, name);
                closeCanvasGenerationBrowser();
            };
        });
    };
    const load = async () => {
        try {
            const q = encodeURIComponent(String(search.value || '').trim());
            const res = await apiFetch(`/api/canvas-generations?limit=120${q ? `&q=${q}` : ''}`);
            if(!res.ok) throw new Error(await responseErrorMessage(res, '加载失败'));
            const data = await res.json();
            items = Array.isArray(data.items) ? data.items : [];
            renderItems();
        } catch(err) {
            list.innerHTML = `<div class="canvas-gen-browser-empty">${escapeHtml(err.message || '加载失败')}</div>`;
        }
    };
    modal.addEventListener('mousedown', e => { if(e.target === modal) closeCanvasGenerationBrowser(); });
    modal.querySelector('.canvas-gen-browser-close').onclick = () => closeCanvasGenerationBrowser();
    modal.querySelectorAll('[data-history-tab]').forEach(btn => {
        btn.onclick = () => {
            const tab = btn.getAttribute('data-history-tab');
            if(tab === 'logs') openCanvasHistoryHub('logs');
        };
    });
    let timer = 0;
    search.addEventListener('input', () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => { void load(); }, 220);
    });
    root.appendChild(modal);
    requestAnimationFrame(() => search.focus());
    void load();
}
async function createImageCardsFromLocalPaths(paths, point){
    if(!ensureCanvas()) return [];
    setStatus(langIsEn() ? 'Importing images...' : '导入图片...');
    try {
        const files = await importLocalImages(paths);
        const base = point || screenToWorld(window.innerWidth / 2, window.innerHeight / 2);
        const created = [];
        files.forEach((file, i) => {
            const node = {id:uid('img'), type:'image', x:base.x + i * 36, y:base.y + i * 36, url:file.url, name:file.name, mediaKind:'image'};
            nodes.push(node);
            created.push(node);
        });
        render();
        scheduleSave();
        setStatus('Ready');
        return created;
    } catch(err) {
        setStatus('Ready');
        throw err;
    }
}
async function applyImageDropPayloadToBoard(payload, point){
    if(payload.type === 'files'){
        if(payload.files.length > 1) return uploadImageGroup(payload.files, point);
        return uploadImages(payload.files, point);
    }
    if(payload.type === 'localPaths') return createImageCardsFromLocalPaths(payload.localPaths, point);
    if(payload.type === 'url') {
        createImageCardFromUrl(payload.url, point, outputImageName(payload.url));
        return [];
    }
    return [];
}
async function applyImageDropPayloadToNode(nodeId, payload){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'image') return;
    if(payload.type === 'files') {
        await fillImageNode(nodeId, payload.files, {group:payload.files.length > 1});
        return;
    }
    if(payload.type === 'localPaths') {
        const files = await importLocalImages(payload.localPaths);
        const file = files[0];
        if(file?.url) {
            pushUndo();
            node.url = file.url;
            node.name = file.name || outputImageName(file.url);
            node.mediaKind = 'image';
            render();
            scheduleSave();
        }
        return;
    }
    if(payload.type === 'url' && payload.url){
        pushUndo();
        node.url = payload.url;
        node.name = outputImageName(payload.url);
        node.mediaKind = isVideoUrl(payload.url) ? 'video' : isAudioUrl(payload.url) ? 'audio' : 'image';
        render();
        scheduleSave();
    }
}
function allowImageNodeDropEvent(e, highlightEl){
    if(hasImageDropData(e.dataTransfer) || isActiveOutputImageDrag(e.dataTransfer)){
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        highlightEl?.classList.add('drag-over');
        dropOverlay.classList.remove('active');
    }
}
function clearImageNodeDropState(e, highlightEl){
    e.preventDefault();
    e.stopPropagation();
    highlightEl?.classList.remove('drag-over');
    dropOverlay.classList.remove('active');
}
async function handleImageNodeDropEvent(e, nodeId, highlightEl){
    const batch = nodes.find(g => g.type === 'imageBatch' && (g.items || []).includes(nodeId));
    if(batch){
        if(isActiveOutputImageDrag(e.dataTransfer)){
            clearImageNodeDropState(e, highlightEl);
            const url = resolveOutputDragUrl(e.dataTransfer);
            if(!url) return;
            pushUndo();
            createImageBatchChild(batch, url, outputImageName(url));
            layoutGroupChildren(batch, { resizeGroup: 'auto', layoutAllItems: true, updateDom: true });
            refreshNodes([batch.id]);
            scheduleLinkGeometryRefresh(new Set([batch.id, ...(batch.items || [])]));
            scheduleSave();
            return;
        }
        const payload = await resolveImageDropPayload(e.dataTransfer);
        clearImageNodeDropState(e, highlightEl);
        if(payload.type === 'files' && payload.files?.length){
            try {
                await uploadImagesToImageBatch(batch.id, payload.files);
            } catch(err) {
                setStatus('Ready');
                showErrorModal(err?.message || (langIsEn() ? 'Image import failed' : '导入图片失败'), langIsEn() ? 'Image import failed' : '导入图片失败');
            }
            return;
        }
    }
    if(isActiveOutputImageDrag(e.dataTransfer)){
        clearImageNodeDropState(e, highlightEl);
        setImageNodeFromOutput(nodeId, resolveOutputDragUrl(e.dataTransfer));
        return;
    }
    const payload = await resolveImageDropPayload(e.dataTransfer);
    clearImageNodeDropState(e, highlightEl);
    if(payload.type === 'none') return;
    try {
        await applyImageDropPayloadToNode(nodeId, payload);
    } catch(err) {
        setStatus('Ready');
        showErrorModal(err.message || (langIsEn() ? 'Image import failed' : '导入图片失败'), langIsEn() ? 'Image import failed' : '导入图片失败');
    }
}
async function fillImageNode(nodeId, files, opts={}){
    if(!ensureCanvas()) return;
    const imgs = [...files].filter(file => ['image','video','audio'].includes(mediaKindForUpload(file)));
    if(!imgs.length) return;
    if(opts.group && imgs.length > 1){
        const source = nodes.find(n => n.id === nodeId);
        pushUndo();
        const point = source ? {x:Number(source.x || 0), y:Number(source.y || 0)} : defaultPoint(0, 0);
        const outgoing = connections.filter(c => c.from === source?.id).map(c => c.to);
        const incoming = connections.filter(c => c.to === source?.id).map(c => c.from);
        const created = await uploadImageGroup(imgs, point);
        const batch = created?.batch;
        if(source && created?.length > 1){
            nodes = nodes.filter(n => n.id !== source.id);
            connections = connections.filter(c => c.from !== source.id && c.to !== source.id);
            if(batch){
                outgoing.forEach(toId => {
                    if(canConnect(batch.id, toId) && !connections.some(c => c.from === batch.id && c.to === toId)){
                        connections.push({id:uid('c'), from:batch.id, to:toId});
                    }
                });
                incoming.forEach(fromId => {
                    if(canConnect(fromId, batch.id) && !connections.some(c => c.from === fromId && c.to === batch.id)){
                        connections.push({id:uid('c'), from:fromId, to:batch.id});
                    }
                });
            }
            selected.delete(source.id);
            render();
            scheduleSave();
        }
        return;
    }
    const form = new FormData();
    form.append('files', imgs[0]);
    const data = await apiFetch('/api/ai/upload', {method:'POST', body:form}).then(r=>r.json());
    const file = data.files?.[0];
    const node = nodes.find(n => n.id === nodeId);
    if(file && node){
        node.url = file.url;
        node.name = file.name;
        node.mediaKind = file.kind || mediaKindForUpload(imgs[0]);
        render();
        scheduleSave();
    }
}
function setImageNodeFromOutput(nodeId, url){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'image' || !url || isVideoUrl(url) || isAudioUrl(url)) return;
    pushUndo();
    node.url = url;
    node.name = outputImageName(url);
    node.mediaKind = 'image';
    render();
    scheduleSave();
}
function clearImageNode(nodeId, event=null){
    if(event){
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation?.();
    }
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'image') return;
    pushUndo();
    node.url = '';
    node.mediaKind = 'image';
    node.name = '空白图片';
    render();
    scheduleSave();
}
function pickImageForNode(nodeId){
    pickMediaForNode(nodeId);
}
function cropBounds(){
    const img = domGet('cropImage');
    return {w:img.clientWidth || 1, h:img.clientHeight || 1};
}
function cropAspectRatioValue(img){
    if(cropAspectLock === 'free') return null;
    if(cropAspectLock === 'original'){
        const nw = img?.naturalWidth || 0;
        const nh = img?.naturalHeight || 0;
        if(nw > 0 && nh > 0) return nw / nh;
        return null;
    }
    const parts = String(cropAspectLock || '').split(':').map(Number);
    if(parts.length === 2 && parts[0] > 0 && parts[1] > 0) return parts[0] / parts[1];
    return null;
}
function fitCropBoxToAspect(aspect, maxW, maxH){
    let cw = maxW;
    let ch = cw / aspect;
    if(ch > maxH){
        ch = maxH;
        cw = ch * aspect;
    }
    return {w:Math.max(24, Math.round(cw)), h:Math.max(24, Math.round(ch))};
}
function syncCropAspectUI(){
    domQueryAll('[data-crop-aspect]').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cropAspect === cropAspectLock);
    });
    const img = domGet('cropImage');
    const aspect = cropAspectRatioValue(img);
    const hint = domGet('cropAspectHint');
    if(!hint) return;
    if(!aspect){
        hint.textContent = langIsEn() ? 'Free crop' : '自由裁剪';
    } else if(cropAspectLock === 'original'){
        const nw = img?.naturalWidth || 0;
        const nh = img?.naturalHeight || 0;
        hint.textContent = langIsEn()
            ? `Locked to source (${nw}:${nh})`
            : `锁定原图比例 (${nw}:${nh})`;
    } else {
        hint.textContent = langIsEn() ? `Locked ${cropAspectLock}` : `锁定比例 ${cropAspectLock}`;
    }
}
function setCropAspectLock(lock){
    cropAspectLock = lock || 'free';
    syncCropAspectUI();
    if(!cropState) return;
    const img = domGet('cropImage');
    const aspect = cropAspectRatioValue(img);
    if(aspect){
        const {w, h} = cropBounds();
        const fitted = fitCropBoxToAspect(aspect, w, h);
        cropState.w = fitted.w;
        cropState.h = fitted.h;
        cropState.x = Math.round((w - cropState.w) / 2);
        cropState.y = Math.round((h - cropState.h) / 2);
    }
    clampCrop();
    renderCropBox();
}
function editDrawCanvas(){
    return domGet('editDrawCanvas');
}
function resizeEditDrawCanvas(){
    const img = domGet('cropImage');
    const canvasEl = editDrawCanvas();
    if(!img || !canvasEl) return;
    const w = Math.max(1, img.naturalWidth || img.clientWidth || 1);
    const h = Math.max(1, img.naturalHeight || img.clientHeight || 1);
    if(canvasEl.width !== w || canvasEl.height !== h){
        canvasEl.width = w;
        canvasEl.height = h;
    }
    canvasEl.style.width = `${img.clientWidth || 1}px`;
    canvasEl.style.height = `${img.clientHeight || 1}px`;
}
function setImageEditMode(mode, userTouched=false){
    rebindDomIfStale();
    if(userTouched) imageEditModeTouched = true;
    const prevImageEditMode = imageEditMode;
    imageEditMode = ['crop','brush'].includes(mode) ? mode : 'crop';
    const cropCanvasEl = domGet('cropCanvas');
    if(cropCanvasEl){
        cropCanvasEl.classList.toggle('brush-mode', imageEditMode === 'brush');
    }
    domQueryAll('[data-image-edit-mode]').forEach(btn => btn.classList.toggle('active', btn.dataset.imageEditMode === imageEditMode));
    domGet('imageCropTools')?.classList.toggle('active', imageEditMode === 'crop');
    domGet('imageBrushTools')?.classList.toggle('active', imageEditMode === 'brush');
    const title = domGet('imageEditTitle');
    const sub = domGet('imageEditSub');
    const apply = domGet('imageEditApplyBtn');
    const titleKey = imageEditMode === 'crop' ? 'canvas.cropImage' : 'canvas.brushEdit';
    const subKey = imageEditMode === 'crop' ? 'canvas.cropHint' : 'canvas.brushHint';
    if(title) title.textContent = tr(titleKey);
    if(sub) sub.textContent = tr(subKey);
    if(apply && imageEditMode === 'crop'){
        apply.innerHTML = `<i data-lucide="crop" class="w-4 h-4"></i><span>${tr('canvas.applyCrop')}</span>`;
    }
    resizeEditDrawCanvas();
    if(imageEditMode === 'crop'){
        clearEditDrawing(true);
        syncCropAspectUI();
    } else if(prevImageEditMode === 'crop'){
        clearEditDrawing(true);
    }
    if(imageEditMode === 'brush'){
        syncBrushApplyLabel();
        syncAnnotationLabelPickUI();
        syncAnnotationRestoreButton();
    } else {
        syncAnnotationLabelPickUI();
        syncAnnotationRestoreButton();
    }
    syncEditDrawingHistoryButtons();
    syncBrushToolButtons();
    refreshIcons();
}
function inferAnnotationBaseUrl(url){
    const raw = String(url || '').trim();
    if(!raw || !/_mark\.(png|jpe?g|webp)$/i.test(raw)) return '';
    return raw.replace(/_mark(?=\.(png|jpe?g|webp)$)/i, '');
}
function getAnnotationBaseUrl(){
    if(!cropState) return '';
    const target = cropState.saveTarget || {type:'node', nodeId:cropState.nodeId};
    if(target.type === 'frameStack' || target.type === 'output'){
        const owner = nodes.find(n => n.id === target.ownerNodeId);
        const cur = String(target.url || '').trim();
        for(const item of (owner?.images || [])){
            if(outputUrlValue(item) !== cur) continue;
            const pre = typeof item === 'object' ? String(item.pre_annotation_url || '').trim() : '';
            if(pre) return pre;
            return inferAnnotationBaseUrl(cur);
        }
        return inferAnnotationBaseUrl(cur);
    }
    const node = nodes.find(n => n.id === (target.nodeId || cropState.nodeId));
    const pre = String(node?.pre_annotation_url || '').trim();
    if(pre) return pre;
    return inferAnnotationBaseUrl(node?.url);
}
function setAnnotationLabelPick(n){
    brushLabelPick = Math.max(1, Math.min(5, Math.floor(Number(n) || 1)));
    syncAnnotationLabelPickUI();
}
function syncAnnotationLabelPickUI(){
    const wrap = domGet('annotationLabelPick');
    if(!wrap) return;
    const show = imageEditMode === 'brush' && brushTool === 'label';
    wrap.style.display = show ? 'flex' : 'none';
    if(!show) return;
    wrap.innerHTML = `
        <span class="annotation-label-pick-title">${langIsEn() ? 'Place as' : '放置编号'}</span>
        <div class="annotation-label-pick-chips">
            ${[1,2,3,4,5].map(n => `<button type="button" class="annotation-label-chip ${brushLabelPick === n ? 'active' : ''}" data-label-pick="${n}">${circledNumber(n)}</button>`).join('')}
        </div>
    `;
    wrap.querySelectorAll('[data-label-pick]').forEach(chip => {
        chip.onmousedown = e => e.stopPropagation();
        chip.onclick = e => {
            e.stopPropagation();
            setAnnotationLabelPick(Number(chip.dataset.labelPick));
        };
    });
}
function syncAnnotationRestoreButton(){
    const btn = domGet('annotationRestoreBtn');
    if(!btn) return;
    const show = imageEditMode === 'brush' && Boolean(getAnnotationBaseUrl());
    btn.style.display = show ? '' : 'none';
    if(!show) return;
    const canRestore = Boolean(getAnnotationBaseUrl());
    btn.disabled = !canRestore;
    btn.style.opacity = canRestore ? '1' : '.42';
    btn.title = canRestore
        ? (langIsEn() ? 'Restore image before marking' : '恢复标注前的原图')
        : (langIsEn() ? 'No original image found before marking' : '未找到标注前原图，请用「替换」重新上传');
}
function syncBrushApplyLabel(){
    const apply = domGet('imageEditApplyBtn');
    if(!apply || imageEditMode !== 'brush') return;
    if(brushTool === 'label'){
        apply.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i><span>${langIsEn() ? 'Save marks' : '保存标注'}</span>`;
    } else {
        apply.innerHTML = `<i data-lucide="paintbrush" class="w-4 h-4"></i><span>${tr('canvas.applyBrush')}</span>`;
    }
    refreshIcons();
}
async function restoreAnnotationBase(){
    if(!cropState) return;
    const baseUrl = getAnnotationBaseUrl();
    if(!baseUrl){
        softAlert(langIsEn()
            ? 'Cannot find the original image before marking. Use Replace on the image node to upload again.'
            : '找不到标注前的原图。请在图片节点上使用「替换」重新上传原图。');
        return;
    }
    if(!window.confirm(langIsEn()
        ? 'Restore the image before all character marks? Saved marks will be removed.'
        : '确定恢复标注前的原图？已保存的编号标注将全部清除。')) return;
    const target = cropState.saveTarget || {type:'node', nodeId:cropState.nodeId};
    if(target.type === 'frameStack' || target.type === 'output'){
        const owner = nodes.find(n => n.id === target.ownerNodeId);
        const oldUrl = target.url;
        if(!owner || !oldUrl) return;
        owner.images = (owner.images || []).map(item => {
            if(outputUrlValue(item) !== oldUrl) return item;
            if(typeof item === 'string') return baseUrl;
            const next = {...item, url:baseUrl};
            delete next.pre_annotation_url;
            return next;
        });
        target.url = baseUrl;
        if(owner.type === 'frameStack') refreshVideoFrameConsumers(owner.id);
        refreshNodes([owner.id]);
    } else {
        const node = nodes.find(n => n.id === (target.nodeId || cropState.nodeId));
        if(!node) return;
        node.url = baseUrl;
        delete node.pre_annotation_url;
        render();
    }
    const img = domGet('cropImage');
    img.onload = () => {
        img.onload = null;
        resizeEditDrawCanvas();
        resetEditDrawingHistory();
        clearEditDrawing(true);
        brushLabelCounter = 1;
        syncAnnotationRestoreButton();
    };
    img.src = baseUrl;
    scheduleSave();
}
function editDrawSnapshot(){
    const canvasEl = editDrawCanvas();
    return {
        imageData: canvasEl.getContext('2d').getImageData(0, 0, canvasEl.width, canvasEl.height),
        labelCounter: brushLabelCounter,
    };
}
function restoreEditDrawSnapshot(snapshot){
    if(!snapshot) return;
    const canvasEl = editDrawCanvas();
    const imageData = snapshot.imageData || snapshot;
    canvasEl.getContext('2d').putImageData(imageData, 0, 0);
    if(snapshot.labelCounter) brushLabelCounter = snapshot.labelCounter;
}
function pushEditDrawHistory(){
    editDrawUndoStack.push(editDrawSnapshot());
    if(editDrawUndoStack.length > EDIT_DRAW_HISTORY_MAX) editDrawUndoStack.shift();
    editDrawRedoStack = [];
    syncEditDrawingHistoryButtons();
}
function syncEditDrawingHistoryButtons(){
    ['brushUndoBtn'].forEach(id => {
        const btn = domGet(id);
        if(btn){ btn.disabled = !editDrawUndoStack.length; btn.style.opacity = editDrawUndoStack.length ? '1' : '.42'; }
    });
    ['brushRedoBtn'].forEach(id => {
        const btn = domGet(id);
        if(btn){ btn.disabled = !editDrawRedoStack.length; btn.style.opacity = editDrawRedoStack.length ? '1' : '.42'; }
    });
}
function undoEditDrawing(){
    if(!editDrawUndoStack.length) return;
    editDrawRedoStack.push(editDrawSnapshot());
    restoreEditDrawSnapshot(editDrawUndoStack.pop());
    syncEditDrawingHistoryButtons();
}
function redoEditDrawing(){
    if(!editDrawRedoStack.length) return;
    editDrawUndoStack.push(editDrawSnapshot());
    restoreEditDrawSnapshot(editDrawRedoStack.pop());
    syncEditDrawingHistoryButtons();
}
function clearEditDrawing(silent=false){
    const canvasEl = editDrawCanvas();
    if(!silent && editCanvasHasPixels()) pushEditDrawHistory();
    canvasEl.getContext('2d').clearRect(0, 0, canvasEl.width, canvasEl.height);
    brushLabelCounter = 1;
    syncEditDrawingHistoryButtons();
}
function resetEditDrawingHistory(){
    editDrawUndoStack = [];
    editDrawRedoStack = [];
    brushLabelCounter = 1;
    syncEditDrawingHistoryButtons();
}
function setBrushTool(tool){
    brushTool = ['free','rect','ellipse','label'].includes(tool) ? tool : 'free';
    syncBrushToolButtons();
    syncBrushApplyLabel();
    syncAnnotationLabelPickUI();
    syncAnnotationRestoreButton();
}
function syncBrushToolButtons(){
    domQueryAll('[data-brush-tool]').forEach(btn => {
        const active = btn.dataset.brushTool === brushTool;
        btn.classList.toggle('primary', active);
        btn.classList.toggle('secondary', !active);
    });
}
function editDrawPoint(event){
    const canvasEl = editDrawCanvas();
    const rect = canvasEl.getBoundingClientRect();
    return {
        x:(event.clientX - rect.left) * canvasEl.width / Math.max(1, rect.width),
        y:(event.clientY - rect.top) * canvasEl.height / Math.max(1, rect.height),
    };
}
function gridCustomLineHit(point){
    if(!gridCustomLines.length) return -1;
    const canvasEl = editDrawCanvas();
    const threshold = Math.max(8, Math.min(canvasEl.width, canvasEl.height) / 80);
    let best = -1;
    let bestDist = Infinity;
    gridCustomLines.forEach((line, index) => {
        const dist = line.type === 'h'
            ? Math.abs(point.y - line.pos * canvasEl.height)
            : Math.abs(point.x - line.pos * canvasEl.width);
        if(dist < bestDist && dist <= threshold){
            best = index;
            bestDist = dist;
        }
    });
    return best;
}
function setGridCustomLinePos(index, point){
    const canvasEl = editDrawCanvas();
    const line = gridCustomLines[index];
    if(!line) return;
    line.pos = line.type === 'h'
        ? Math.max(0.001, Math.min(0.999, point.y / Math.max(1, canvasEl.height)))
        : Math.max(0.001, Math.min(0.999, point.x / Math.max(1, canvasEl.width)));
}
function editBrushSize(){
    return Number(domGet('paintBrushSize')?.value || 20);
}
function brushColor(){
    return domGet('paintBrushColor')?.value || '#ff2d55';
}
function setupDrawStyle(ctx){
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = editBrushSize();
    ctx.strokeStyle = brushColor();
    ctx.fillStyle = brushColor();
    ctx.globalCompositeOperation = 'source-over';
}
function circledNumber(n){
    if(n >= 1 && n <= 20) return String.fromCharCode(0x2460 + n - 1);
    return String(n);
}
function drawBrushShape(ctx, start, end, preview=false){
    setupDrawStyle(ctx);
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    if(brushTool === 'rect'){
        ctx.strokeRect(x, y, w, h);
    } else if(brushTool === 'ellipse'){
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(1, w / 2), Math.max(1, h / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
    }
}
function drawNumberLabel(point){
    const canvasEl = editDrawCanvas();
    const ctx = canvasEl.getContext('2d');
    const size = Math.max(32, editBrushSize() * 3.6);
    const n = brushTool === 'label' ? brushLabelPick : brushLabelCounter++;
    const text = circledNumber(n);
    setupDrawStyle(ctx);
    ctx.save();
    ctx.font = `900 ${size}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(3, size / 8);
    ctx.strokeStyle = 'rgba(255,255,255,0.92)';
    ctx.strokeText(text, point.x, point.y);
    ctx.fillStyle = brushColor();
    ctx.fillText(text, point.x, point.y);
    ctx.restore();
}
function beginEditDraw(event){
    if(imageEditMode === 'crop') return;
    if(imageEditMode === 'grid'){
        if(!gridCustomMode) return;
        // 自定义模式：拖动已有线，或点击空白处放置新线
        event.preventDefault();
        event.stopPropagation();
        const canvasEl = editDrawCanvas();
        canvasEl.setPointerCapture?.(event.pointerId);
        const point = editDrawPoint(event);
        const hitIndex = gridCustomLineHit(point);
        gridCustomHistory.push([...gridCustomLines.map(line => ({...line}))]);
        if(hitIndex >= 0){
            gridCustomDrag = {index: hitIndex, pointerId: event.pointerId};
            setGridCustomLinePos(hitIndex, point);
            refreshGridSplitPreview();
            _syncGridCustomUndoBtn();
            return;
        }
        const rect = canvasEl.getBoundingClientRect();
        const fracX = Math.max(0.001, Math.min(0.999, (event.clientX - rect.left) / rect.width));
        const fracY = Math.max(0.001, Math.min(0.999, (event.clientY - rect.top) / rect.height));
        gridCustomLines.push({type: gridCustomOrientation, pos: gridCustomOrientation === 'h' ? fracY : fracX});
        gridCustomDrag = {index: gridCustomLines.length - 1, pointerId: event.pointerId};
        _syncGridCustomUndoBtn();
        refreshGridSplitPreview();
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    const canvasEl = editDrawCanvas();
    if(!canvasEl?.getContext) return;
    canvasEl.setPointerCapture?.(event.pointerId);
    const ctx = canvasEl.getContext('2d');
    const p = editDrawPoint(event);
    pushEditDrawHistory();
    if(imageEditMode === 'brush' && brushTool === 'label'){
        drawNumberLabel(p);
        editDrawState = null;
        canvasEl.releasePointerCapture?.(event.pointerId);
        syncEditDrawingHistoryButtons();
        return;
    }
    editDrawState = {x:p.x, y:p.y, sx:p.x, sy:p.y, pointerId:event.pointerId, snapshot:(imageEditMode === 'brush' && brushTool !== 'free') ? editDrawSnapshot() : null};
    setupDrawStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x + 0.01, p.y + 0.01);
    if(brushTool === 'free') ctx.stroke();
}
function moveEditDraw(event){
    if(imageEditMode === 'grid' && gridCustomMode && gridCustomDrag){
        event.preventDefault();
        event.stopPropagation();
        setGridCustomLinePos(gridCustomDrag.index, editDrawPoint(event));
        refreshGridSplitPreview();
        return;
    }
    if(!editDrawState || imageEditMode === 'crop' || imageEditMode === 'grid') return;
    event.preventDefault();
    event.stopPropagation();
    const ctx = editDrawCanvas().getContext('2d');
    const p = editDrawPoint(event);
    if(imageEditMode === 'brush' && brushTool !== 'free'){
        restoreEditDrawSnapshot(editDrawState.snapshot);
        drawBrushShape(ctx, {x:editDrawState.sx, y:editDrawState.sy}, p, true);
        return;
    }
    setupDrawStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(editDrawState.x, editDrawState.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    editDrawState.x = p.x;
    editDrawState.y = p.y;
}
function endEditDraw(event){
    if(editDrawState && event?.pointerId != null) editDrawCanvas().releasePointerCapture?.(event.pointerId);
    if(gridCustomDrag && event?.pointerId != null) editDrawCanvas().releasePointerCapture?.(event.pointerId);
    editDrawState = null;
    gridCustomDrag = null;
    syncEditDrawingHistoryButtons();
}
function editCanvasHasPixels(){
    const canvasEl = editDrawCanvas();
    const data = canvasEl.getContext('2d').getImageData(0, 0, canvasEl.width, canvasEl.height).data;
    for(let i = 3; i < data.length; i += 4) if(data[i] > 0) return true;
    return false;
}
function syncGridGapValue(){
    const input = domGet('gridGapSize');
    const value = Math.max(0, Math.min(240, Number(input?.value || 0)));
    if(input) input.value = value;
    const label = domGet('gridGapValue');
    if(label) label.textContent = String(value);
    return value;
}
function gridSplitSettings(){
    const hLines = Math.max(0, Math.min(20, Number(domGet('gridHorizontalLines')?.value || 0)));
    const vLines = Math.max(0, Math.min(20, Number(domGet('gridVerticalLines')?.value || 0)));
    const gap = syncGridGapValue();
    return {rows:hLines + 1, cols:vLines + 1, gap};
}
function gridSplitRects(width, height){
    if(gridCustomMode) return gridSplitRectsCustom(width, height);
    const {rows, cols, gap} = gridSplitSettings();
    const halfGap = gap / 2;
    const rects = [];
    for(let row = 0; row < rows; row++){
        const topLine = row * height / rows;
        const bottomLine = (row + 1) * height / rows;
        const y1 = Math.round(row === 0 ? 0 : topLine + halfGap);
        const y2 = Math.round(row === rows - 1 ? height : bottomLine - halfGap);
        for(let col = 0; col < cols; col++){
            const leftLine = col * width / cols;
            const rightLine = (col + 1) * width / cols;
            const x1 = Math.round(col === 0 ? 0 : leftLine + halfGap);
            const x2 = Math.round(col === cols - 1 ? width : rightLine - halfGap);
            if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
        }
    }
    return rects;
}
function gridSplitRectsCustom(width, height){
    const gap = Math.max(0, Math.min(240, Number(domGet('gridGapSize')?.value || 0)));
    const halfGap = gap / 2;
    // 按方向归类，转换为像素位置（去重并排序）
    const rawH = [...new Set(gridCustomLines.filter(l => l.type === 'h').map(l => l.pos * height))].sort((a, b) => a - b);
    const rawV = [...new Set(gridCustomLines.filter(l => l.type === 'v').map(l => l.pos * width))].sort((a, b) => a - b);
    const hCuts = [0, ...rawH, height]; // 切割边界（含图片两端）
    const vCuts = [0, ...rawV, width];
    const rects = [];
    for(let row = 0; row < hCuts.length - 1; row++){
        for(let col = 0; col < vCuts.length - 1; col++){
            const y1 = Math.round(row === 0 ? hCuts[row] : hCuts[row] + halfGap);
            const y2 = Math.round(row === hCuts.length - 2 ? hCuts[row + 1] : hCuts[row + 1] - halfGap);
            const x1 = Math.round(col === 0 ? vCuts[col] : vCuts[col] + halfGap);
            const x2 = Math.round(col === vCuts.length - 2 ? vCuts[col + 1] : vCuts[col + 1] - halfGap);
            if(x2 > x1 && y2 > y1) rects.push({row, col, x:x1, y:y1, w:x2 - x1, h:y2 - y1});
        }
    }
    return rects;
}
function gridLayoutFromRects(rects){
    const rows = Math.max(1, ...rects.map(r => Number(r.row || 0) + 1));
    const cols = Math.max(1, ...rects.map(r => Number(r.col || 0) + 1));
    return {type:'grid-split', groupId:uid('grid'), rows, cols};
}
function applyGridPreset(rows, cols){
    gridCustomMode = false;
    gridCustomLines = [];
    gridCustomHistory = [];
    gridCustomDrag = null;
    const h = domGet('gridHorizontalLines');
    const v = domGet('gridVerticalLines');
    if(h){ h.disabled = false; h.value = String(Math.max(0, Number(rows || 1) - 1)); }
    if(v){ v.disabled = false; v.value = String(Math.max(0, Number(cols || 1) - 1)); }
    const toggle = domGet('gridCustomToggle');
    const custom = domGet('gridCustomControls');
    const regular = domGet('gridRegularControls');
    if(toggle){
        toggle.classList.remove('primary');
        toggle.classList.add('secondary');
    }
    if(custom) custom.style.display = 'none';
    if(regular) regular.style.display = 'contents';
    _syncGridCustomCursor();
    _syncGridCustomUndoBtn();
    refreshGridSplitPreview();
}
// ——— 自定义宫格辅助函数 ———
function toggleGridCustomMode(){
    gridCustomMode = !gridCustomMode;
    if(gridCustomMode){ gridCustomLines = []; gridCustomHistory = []; } // 进入自定义时清空旧线及历史
    gridCustomDrag = null;
    const toggle = domGet('gridCustomToggle');
    const regular = domGet('gridRegularControls');
    const custom = domGet('gridCustomControls');
    toggle.classList.toggle('primary', gridCustomMode);
    toggle.classList.toggle('secondary', !gridCustomMode);
    // 禁用/启用常规输入
    ['gridHorizontalLines','gridVerticalLines'].forEach(id => {
        const el = domGet(id);
        if(el) el.disabled = gridCustomMode;
    });
    if(custom) custom.style.display = gridCustomMode ? 'flex' : 'none';
    _syncGridCustomCursor();
    _syncGridCustomUndoBtn();
    refreshGridSplitPreview();
}
function setGridCustomOrientation(orient){
    gridCustomOrientation = orient;
    domGet('gridOrientH').classList.toggle('primary', orient === 'h');
    domGet('gridOrientH').classList.toggle('secondary', orient !== 'h');
    domGet('gridOrientV').classList.toggle('primary', orient === 'v');
    domGet('gridOrientV').classList.toggle('secondary', orient !== 'v');
    _syncGridCustomCursor();
}
function clearGridCustomLines(){
    gridCustomHistory = [];
    gridCustomLines = [];
    gridCustomDrag = null;
    _syncGridCustomUndoBtn();
    refreshGridSplitPreview();
}
function undoGridCustomLine(){
    if(!gridCustomHistory.length) return;
    gridCustomLines = gridCustomHistory.pop();
    gridCustomDrag = null;
    _syncGridCustomUndoBtn();
    refreshGridSplitPreview();
}
function _syncGridCustomUndoBtn(){
    const btn = domGet('gridUndoBtn');
    if(!btn) return;
    btn.disabled = gridCustomHistory.length === 0;
    btn.style.opacity = gridCustomHistory.length === 0 ? '0.4' : '1';
}
// ——— 图片缩放 ———
function applyImageEditZoom(){
    if(!imageEditBaseW) return;
    const img = domGet('cropImage');
    const oldW = img.clientWidth;
    img.style.maxWidth = 'none';
    img.style.maxHeight = 'none';
    img.style.width = Math.round(imageEditBaseW * imageEditZoom) + 'px';
    img.style.height = Math.round(imageEditBaseH * imageEditZoom) + 'px';
    resizeEditDrawCanvas();
    // 按比例同步裁剪框位置
    if(cropState && oldW > 0){
        const scale = img.clientWidth / oldW;
        cropState.x = Math.round(cropState.x * scale);
        cropState.y = Math.round(cropState.y * scale);
        cropState.w = Math.round(cropState.w * scale);
        cropState.h = Math.round(cropState.h * scale);
        clampCrop();
        renderCropBox();
    }
    if(imageEditMode === 'grid') refreshGridSplitPreview();
    syncImageEditOverflow();
    _updateZoomLabel();
}
function syncImageEditOverflow(){
    const stage = domGet('imageEditStage');
    const crop = domGet('cropCanvas');
    if(!stage || !crop) return;
    const rect = crop.getBoundingClientRect();
    const pad = 36;
    const overflowX = rect.width + pad > stage.clientWidth;
    const overflowY = rect.height + pad > stage.clientHeight;
    stage.classList.toggle('overflowing', overflowX || overflowY);
    stage.classList.toggle('overflow-x', overflowX);
    stage.classList.toggle('overflow-y', overflowY);
}
function resetImageEditZoom(){
    const stage = domGet('imageEditStage');
    imageEditZoom = 1.0;
    applyImageEditZoom();
    if(stage){ stage.scrollLeft = 0; stage.scrollTop = 0; }
}
function _updateZoomLabel(){
    const el = domGet('imageEditZoomLabel');
    if(el) el.textContent = Math.round(imageEditZoom * 100) + '%';
}
function _syncGridCustomCursor(){
    const cropCanvasEl = domGet('cropCanvas');
    cropCanvasEl.classList.toggle('grid-custom-h', imageEditMode === 'grid' && gridCustomMode && gridCustomOrientation === 'h');
    cropCanvasEl.classList.toggle('grid-custom-v', imageEditMode === 'grid' && gridCustomMode && gridCustomOrientation === 'v');
}
function refreshGridSplitPreview(){
    const canvasEl = editDrawCanvas();
    const ctx = canvasEl.getContext('2d');
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if(imageEditMode !== 'grid') return;
    const countEl = domGet('gridSplitCount');
    const lineWidth = Math.max(2, Math.round(Math.min(canvasEl.width, canvasEl.height) / 320));
    const drawGuideLine = (x1, y1, x2, y2) => {
        ctx.save();
        ctx.lineWidth = lineWidth + 2;
        ctx.strokeStyle = 'rgba(2,6,23,0.72)';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.lineWidth = lineWidth;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        ctx.restore();
    };
    if(gridCustomMode){
        // 自定义模式：按已放置线渲染（包含空心范围预览）
        const gap = Math.max(0, Math.min(240, Number(domGet('gridGapSize')?.value || 0)));
        const hLines = gridCustomLines.filter(l => l.type === 'h');
        const vLines = gridCustomLines.filter(l => l.type === 'v');
        if(countEl) countEl.textContent = tr('canvas.gridWillOutput').replace('{n}', (hLines.length + 1) * (vLines.length + 1));
        ctx.save();
        hLines.forEach(l => {
            const y = l.pos * canvasEl.height;
            if(gap > 0){
                drawGuideLine(0, y - gap / 2, canvasEl.width, y - gap / 2);
                drawGuideLine(0, y + gap / 2, canvasEl.width, y + gap / 2);
            } else {
                drawGuideLine(0, y, canvasEl.width, y);
            }
        });
        vLines.forEach(l => {
            const x = l.pos * canvasEl.width;
            if(gap > 0){
                drawGuideLine(x - gap / 2, 0, x - gap / 2, canvasEl.height);
                drawGuideLine(x + gap / 2, 0, x + gap / 2, canvasEl.height);
            } else {
                drawGuideLine(x, 0, x, canvasEl.height);
            }
        });
        ctx.restore();
        return;
    }
    // 常规模式
    const {rows, cols, gap} = gridSplitSettings();
    if(countEl) countEl.textContent = tr('canvas.gridWillOutput').replace('{n}', rows * cols);
    ctx.save();
    const scaleX = canvasEl.width;
    const scaleY = canvasEl.height;
    for(let i = 1; i < cols; i++){
        const x = i * scaleX / cols;
        if(gap > 0){
            drawGuideLine(x - gap / 2, 0, x - gap / 2, scaleY);
            drawGuideLine(x + gap / 2, 0, x + gap / 2, scaleY);
        } else {
            drawGuideLine(x, 0, x, scaleY);
        }
    }
    for(let i = 1; i < rows; i++){
        const y = i * scaleY / rows;
        if(gap > 0){
            drawGuideLine(0, y - gap / 2, scaleX, y - gap / 2);
            drawGuideLine(0, y + gap / 2, scaleX, y + gap / 2);
        } else {
            drawGuideLine(0, y, scaleX, y);
        }
    }
    ctx.restore();
}
function imageEditorOutputPoint(node, offsetY=0){
    return {x:(node.x || 0) + Number(node.w || 260) + 36, y:(node.y || 0) + offsetY};
}
function imageEditorOutputNode(sourceNode){
    let out = connections.filter(c => c.from === sourceNode.id)
        .map(c => nodes.find(n => n.id === c.to))
        .find(n => n?.type === 'output');
    if(!out){
        const p = imageEditorOutputPoint(sourceNode, 0);
        out = {id:uid('out'), type:'output', x:p.x, y:p.y, images:[]};
        nodes.push(out);
    }
    return out;
}
function addGeneratedImageNode(file, sourceNode, suffix, offsetY=0, extra={}){
    const p = imageEditorOutputPoint(sourceNode, offsetY);
    const next = {id:uid('img'), type:'image', x:p.x, y:p.y, url:file.url, name:file.name || suffix, ...extra};
    nodes.push(next);
    selected.clear();
    selected.add(next.id);
    return next;
}
function renderCropBox(){
    if(!cropState) return;
    const box = domGet('cropBox');
    box.style.left = `${cropState.x}px`;
    box.style.top = `${cropState.y}px`;
    box.style.width = `${cropState.w}px`;
    box.style.height = `${cropState.h}px`;
}
function resetCropBox(){
    if(!cropState) return;
    const {w, h} = cropBounds();
    const img = domGet('cropImage');
    const aspect = cropAspectRatioValue(img);
    if(aspect){
        const fitted = fitCropBoxToAspect(aspect, w, h);
        cropState.w = fitted.w;
        cropState.h = fitted.h;
        cropState.x = Math.round((w - cropState.w) / 2);
        cropState.y = Math.round((h - cropState.h) / 2);
    } else {
        cropState.x = Math.round(w * 0.08);
        cropState.y = Math.round(h * 0.08);
        cropState.w = Math.round(w * 0.84);
        cropState.h = Math.round(h * 0.84);
    }
    clampCrop();
    renderCropBox();
}
async function commitImageEditorFile(file){
    if(!cropState || !file?.url) return false;
    const target = cropState.saveTarget || {type:'node', nodeId:cropState.nodeId};
    if(target.type === 'frameStack' || target.type === 'output'){
        const owner = nodes.find(n => n.id === target.ownerNodeId);
        const oldUrl = target.url;
        if(!owner || !oldUrl) return false;
        owner.images = (owner.images || []).map(item => {
            if(outputUrlValue(item) !== oldUrl) return item;
            const preUrl = (typeof item === 'object' && item.pre_annotation_url) ? item.pre_annotation_url : oldUrl;
            if(typeof item === 'string'){
                return {url:file.url, name:file.name || outputImageName(file.url), pre_annotation_url:preUrl};
            }
            return {...item, url:file.url, name:file.name || item.name, pre_annotation_url:preUrl};
        });
        target.url = file.url;
        if(owner.type === 'frameStack') refreshImageStackConsumers(owner.id);
        refreshNodes([owner.id]);
        scheduleSave();
        return true;
    }
    const node = nodes.find(n => n.id === (target.nodeId || cropState.nodeId));
    if(!node) return false;
    const markSave = /_mark\.(png|jpe?g|webp)$/i.test(String(file.name || file.url || ''));
    if(markSave && !node.pre_annotation_url) node.pre_annotation_url = node.url;
    node.url = file.url;
    node.name = file.name;
    render();
    scheduleSave();
    return true;
}
function finishImageEditorLayout(){
    if(!cropState) return;
    const img = domGet('cropImage');
    if(!img?.naturalWidth) return;
    imageEditBaseW = img.clientWidth;
    imageEditBaseH = img.clientHeight;
    _updateZoomLabel();
    resizeEditDrawCanvas();
    resetEditDrawingHistory();
    clearEditDrawing(true);
    resetCropBox();
    syncCropAspectUI();
    setImageEditMode(imageEditModeTouched ? imageEditMode : 'crop', imageEditModeTouched);
    syncImageEditOverflow();
    refreshIcons();
    syncAnnotationLabelPickUI();
    syncAnnotationRestoreButton();
}
function openImageEditorCore({nodeId, url, name, saveTarget}){
    if(!url || isMissingAssetUrl(url)) return;
    ensureImageEditorUi();
    cropState = {
        nodeId: nodeId || saveTarget?.ownerNodeId || '',
        x:0, y:0, w:0, h:0,
        saveTarget: saveTarget || {type:'node', nodeId},
    };
    gridCustomMode = false;
    gridCustomLines = [];
    gridCustomHistory = [];
    gridCustomDrag = null;
    gridCustomOrientation = 'h';
    imageEditZoom = 1.0;
    imageEditBaseW = 0;
    imageEditBaseH = 0;
    cropAspectLock = 'original';
    imageEditModeTouched = false;
    brushTool = 'free';
    brushLabelPick = 1;
    brushLabelCounter = 1;
    _updateZoomLabel();
    const modal = domGet('imageEditModal');
    const img = domGet('cropImage');
    img.style.width = '';
    img.style.height = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
    modal.classList.add('open');
    canvasRoot?.classList.add('image-edit-open');
    document.documentElement.classList.add('canvas-image-edit-open');
    img.onload = () => finishImageEditorLayout();
    img.onerror = () => finishImageEditorLayout();
    if(shouldUseCrossOriginImage(url)) img.crossOrigin = 'anonymous';
    else img.removeAttribute('crossorigin');
    setImageEditMode('crop');
    img.src = url;
    if(img.complete && img.naturalWidth > 0) finishImageEditorLayout();
}
function openImageEditor(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node?.url) return;
    if(mediaKindForNode(node) !== 'image') return;
    openImageEditorCore({
        nodeId,
        url: node.url,
        name: node.name || 'image',
        saveTarget:{type:'node', nodeId},
    });
}
function openFrameStackImageEditor(ownerNodeId, imageUrl, imageName){
    openImageEditorCore({
        nodeId:ownerNodeId,
        url:imageUrl,
        name:imageName || outputImageName(imageUrl),
        saveTarget:{type:'frameStack', ownerNodeId, url:imageUrl, name:imageName || outputImageName(imageUrl)},
    });
}
function openOutputImageEditor(outputNodeId, imageUrl, imageName){
    openImageEditorCore({
        nodeId:outputNodeId,
        url:imageUrl,
        name:imageName || outputImageName(imageUrl),
        saveTarget:{type:'output', ownerNodeId:outputNodeId, url:imageUrl, name:imageName || outputImageName(imageUrl)},
    });
}
function closeImageEditor(){
    domGet('imageEditModal').classList.remove('open');
    canvasRoot?.classList.remove('image-edit-open');
    document.documentElement.classList.remove('canvas-image-edit-open');
    const img = domGet('cropImage');
    img.onload = null;
    img.removeAttribute('src');
    img.style.width = '';
    img.style.height = '';
    img.style.maxWidth = '';
    img.style.maxHeight = '';
    clearEditDrawing(true);
    cropState = null;
    cropDrag = null;
    editDrawState = null;
    resetEditDrawingHistory();
    gridCustomDrag = null;
    imageEditZoom = 1.0;
    imageEditBaseW = 0;
    imageEditBaseH = 0;
    imageEditModeTouched = false;
    domGet('imageEditStage')?.classList.remove('overflowing', 'overflow-x', 'overflow-y');
    const cropCanvasEl = domGet('cropCanvas');
    if(cropCanvasEl){
        cropCanvasEl.classList.remove('grid-custom-h', 'grid-custom-v', 'dragging-image');
        cropCanvasEl.style.width = '';
        cropCanvasEl.style.height = '';
    }
}
function clampCrop(){
    if(!cropState) return;
    const {w, h} = cropBounds();
    const aspect = cropAspectRatioValue(domGet('cropImage'));
    if(aspect){
        cropState.w = Math.max(24, Math.min(cropState.w, w));
        cropState.h = Math.max(24, Math.round(cropState.w / aspect));
        if(cropState.h > h){
            cropState.h = Math.max(24, Math.min(h, cropState.h));
            cropState.w = Math.max(24, Math.round(cropState.h * aspect));
        }
    } else {
        cropState.w = Math.max(24, Math.min(cropState.w, w));
        cropState.h = Math.max(24, Math.min(cropState.h, h));
    }
    cropState.x = Math.max(0, Math.min(cropState.x, w - cropState.w));
    cropState.y = Math.max(0, Math.min(cropState.y, h - cropState.h));
}
function beginCropDrag(event, mode){
    if(!cropState) return;
    event.preventDefault();
    event.stopPropagation();
    cropDrag = {mode, sx:event.clientX, sy:event.clientY, start:{...cropState}};
}
on(window, 'mousemove', event => {
    if(!cropDrag || !cropState) return;
    const dx = event.clientX - cropDrag.sx;
    const dy = event.clientY - cropDrag.sy;
    if(cropDrag.mode === 'move'){
        cropState.x = cropDrag.start.x + dx;
        cropState.y = cropDrag.start.y + dy;
    } else {
        const aspect = cropAspectRatioValue(domGet('cropImage'));
        const {w: maxW, h: maxH} = cropBounds();
        const maxAvailW = maxW - cropDrag.start.x;
        const maxAvailH = maxH - cropDrag.start.y;
        if(aspect){
            let nw = cropDrag.start.w + dx;
            let nh = nw / aspect;
            if(nh > maxAvailH){
                nh = maxAvailH;
                nw = nh * aspect;
            }
            if(nw > maxAvailW){
                nw = maxAvailW;
                nh = nw / aspect;
            }
            cropState.w = Math.max(24, nw);
            cropState.h = Math.max(24, nh);
            cropState.x = cropDrag.start.x;
            cropState.y = cropDrag.start.y;
        } else {
            cropState.w = cropDrag.start.w + dx;
            cropState.h = cropDrag.start.h + dy;
            cropState.x = cropDrag.start.x;
            cropState.y = cropDrag.start.y;
        }
    }
    clampCrop();
    renderCropBox();
});
on(window, 'mouseup', () => { cropDrag = null; });
async function uploadCroppedBlob(blob, name){
    const form = new FormData();
    form.append('files', blob, name);
    const data = await apiFetch('/api/ai/upload', {method:'POST', body:form}).then(r=>r.json());
    return data.files?.[0];
}
async function uploadImageBlobs(blobs){
    const form = new FormData();
    blobs.forEach(item => form.append('files', item.blob, item.name));
    const data = await apiFetch('/api/ai/upload', {method:'POST', body:form}).then(r=>r.json());
    return data.files || [];
}
function shouldUseCrossOriginImage(url){
    const raw = String(url || '').trim();
    if(!raw || raw.startsWith('data:') || raw.startsWith('blob:')) return false;
    try {
        const parsed = new URL(raw, window.location.origin);
        return parsed.origin !== window.location.origin;
    } catch {
        return false;
    }
}
async function applyImageCrop(){
    if(!cropState) return;
    const img = domGet('cropImage');
    if(!img.naturalWidth || !img.naturalHeight){
        softAlert(langIsEn() ? 'Image not loaded yet. Close and reopen the editor.' : '图片尚未加载完成，请关闭后重新打开编辑。');
        return;
    }
    const scaleX = img.naturalWidth / (img.clientWidth || 1);
    const scaleY = img.naturalHeight / (img.clientHeight || 1);
    const sx = Math.max(0, Math.round(cropState.x * scaleX));
    const sy = Math.max(0, Math.round(cropState.y * scaleY));
    const sw = Math.max(1, Math.round(cropState.w * scaleX));
    const sh = Math.max(1, Math.round(cropState.h * scaleY));
    const canvasEl = document.createElement('canvas');
    canvasEl.width = sw;
    canvasEl.height = sh;
    canvasEl.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if(!blob){
        softAlert(langIsEn()
            ? 'Crop export failed. Re-upload the image or use a same-site file.'
            : '裁剪导出失败。请用「替换」重新上传本地图片后再试。');
        return;
    }
    const baseName = cropState.saveTarget?.name || cropState.saveTarget?.url || 'image';
    const base = String(baseName).replace(/\.[^.]+$/, '').split('/').pop() || 'image';
    const file = await uploadCroppedBlob(blob, `${base}_crop.png`);
    if(file && await commitImageEditorFile(file)){
        closeImageEditor();
    }
}
async function applyImageBrush(){
    if(!cropState) return;
    const img = domGet('cropImage');
    if(!img.naturalWidth || !img.naturalHeight || !editCanvasHasPixels()) return;
    const canvasEl = document.createElement('canvas');
    canvasEl.width = img.naturalWidth;
    canvasEl.height = img.naturalHeight;
    const ctx = canvasEl.getContext('2d');
    ctx.drawImage(img, 0, 0, canvasEl.width, canvasEl.height);
    ctx.drawImage(editDrawCanvas(), 0, 0);
    const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
    if(!blob) return;
    const baseName = cropState.saveTarget?.name || cropState.saveTarget?.url || 'image';
    const base = String(baseName).replace(/\.[^.]+$/, '').split('/').pop() || 'image';
    const suffix = brushTool === 'label' ? '_mark' : '_paint';
    const file = await uploadCroppedBlob(blob, `${base}${suffix}.png`);
    if(file && await commitImageEditorFile(file)){
        closeImageEditor();
    }
}
async function applyImageGridSplit(){
    if(!cropState) return;
    const node = nodes.find(n => n.id === cropState.nodeId);
    const img = domGet('cropImage');
    if(!node || !img.naturalWidth || !img.naturalHeight) return;
    const rects = gridSplitRects(img.naturalWidth, img.naturalHeight);
    if(!rects.length) return;
    const base = (node.name || 'image').replace(/\.[^.]+$/, '');
    const blobs = [];
    for(const rect of rects){
        const canvasEl = document.createElement('canvas');
        canvasEl.width = rect.w;
        canvasEl.height = rect.h;
        canvasEl.getContext('2d').drawImage(img, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        const blob = await new Promise(resolve => canvasEl.toBlob(resolve, 'image/png'));
        if(blob) blobs.push({blob, name:`${base}_r${rect.row + 1}_c${rect.col + 1}.png`});
    }
    if(!blobs.length) return;
    const files = await uploadImageBlobs(blobs);
    if(files.length){
        const out = imageEditorOutputNode(node);
        const urls = files.map(file => file.url).filter(Boolean);
        const layout = gridLayoutFromRects(rects);
        appendOutputImages(out, urls, {url:node.url, name:node.name || 'source image'}, urls.map((url, i) => ({
            runMs:0,
            run:{prompt:'宫格切分', refs:[{url:node.url, name:node.name || 'source image'}]},
            grid:{...layout, row:rects[i]?.row || 0, col:rects[i]?.col || 0, w:rects[i]?.w || 1, h:rects[i]?.h || 1}
        })), layout);
        closeImageEditor();
        render();
        scheduleSave();
    }
}
function applyImageEdit(){
    if(imageEditMode === 'brush') return applyImageBrush();
    return applyImageCrop();
}

function nodeHasLiveMedia(node){
    return node?.type === 'image' && node.url && ['video','audio'].includes(mediaKindForNode(node));
}
function captureMediaPlaybackState(media){
    if(!media) return null;
    return {
        currentTime:Number.isFinite(media.currentTime) ? media.currentTime : 0,
        paused:Boolean(media.paused),
        playbackRate:Number.isFinite(media.playbackRate) ? media.playbackRate : 1,
        muted:Boolean(media.muted),
        volume:Number.isFinite(media.volume) ? media.volume : 1
    };
}
function restoreMediaPlaybackState(media, state){
    if(!media || !state) return;
    try { media.playbackRate = state.playbackRate || 1; } catch(e) {}
    try { media.muted = state.muted; } catch(e) {}
    try { media.volume = state.volume; } catch(e) {}
    const applyTime = () => {
        if(Number.isFinite(state.currentTime) && state.currentTime > 0 && Math.abs((media.currentTime || 0) - state.currentTime) > 0.2){
            try { media.currentTime = state.currentTime; } catch(e) {}
        }
        if(!state.paused && typeof media.play === 'function'){
            const promise = media.play();
            if(promise?.catch) promise.catch(() => {});
        }
    };
    if(media.readyState >= 1) applyTime();
    else media.addEventListener('loadedmetadata', applyTime, {once:true});
}
function mediaSignatureFromElement(el){
    const media = el?.querySelector?.('video,audio');
    if(!media) return '';
    const tag = media.tagName.toLowerCase();
    const url = media.dataset?.url || media.getAttribute('src') || '';
    return url ? `${tag}:${url}` : '';
}
function transplantNodeMediaElement(oldNodeEl, newNodeEl){
    const oldMedia = oldNodeEl?.querySelector?.('video,audio');
    const newMedia = newNodeEl?.querySelector?.('video,audio');
    if(!oldMedia || !newMedia) return;
    const oldSignature = mediaSignatureFromElement(oldNodeEl);
    const newSignature = mediaSignatureFromElement(newNodeEl);
    if(!oldSignature || oldSignature !== newSignature) return;
    const state = captureMediaPlaybackState(oldMedia);
    newMedia.replaceWith(oldMedia);
    restoreMediaPlaybackState(oldMedia, state);
    requestAnimationFrame(() => restoreMediaPlaybackState(oldMedia, state));
}
function captureMediaPlaybackStates(){
    const states = new Map();
    nodesEl.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {
        const tag = media.tagName.toLowerCase();
        const url = media.dataset.url || media.getAttribute('src') || '';
        if(url) states.set(`${tag}:${url}`, captureMediaPlaybackState(media));
    });
    return states;
}
function restoreMediaPlaybackStates(states){
    if(!states?.size) return;
    nodesEl.querySelectorAll('video[data-url], audio[data-url]').forEach(media => {
        const tag = media.tagName.toLowerCase();
        const url = media.dataset.url || media.getAttribute('src') || '';
        restoreMediaPlaybackState(media, states.get(`${tag}:${url}`));
    });
}

function safeRender(options = {}){
    if(!options.force && (isCanvasInteracting() || Date.now() - lastBoardInteractionAt < CANVAS_INTERACTION_COOLDOWN_MS)) return;
    try {
        render(options);
    } catch(err) {
        console.error('[infinite-canvas] render failed', err);
        const msg = err instanceof Error ? err.message : String(err);
        showErrorModal(
            langIsEn()
                ? `Canvas render failed: ${msg}\n\nYou can keep editing or use the back button to return to the canvas list.`
                : `画布渲染失败：${msg}\n\n可继续编辑，或点左上角返回画布列表。`,
            langIsEn() ? 'Canvas error' : '画布错误'
        );
        setStatus(langIsEn() ? 'Render error' : '渲染异常');
    }
}
function render(options = {}){
    if(!options.force && isCanvasInteracting()) return;
    if(!nodesEl || !world) return;
    const outputScrolls = captureOutputScrolls();
    const mediaStates = captureMediaPlaybackStates();
    const reusableMediaNodes = new Map();
    nodesEl.querySelectorAll('.node').forEach(el => {
        const node = nodes.find(n => n.id === el.dataset.id);
        if(nodeHasLiveMedia(node)) reusableMediaNodes.set(node.id, el);
    });
    applyViewport();
    [...nodesEl.children].forEach(child => {
        if(!reusableMediaNodes.has(child.dataset?.id)) child.remove();
    });
    nodes.forEach(node => {
        const fresh = renderNode(node);
        const old = reusableMediaNodes.get(node.id);
        nodesEl.appendChild(fresh);
        if(old){
            transplantNodeMediaElement(old, fresh);
            if(old !== fresh) old.remove();
        }
    });
    restoreMediaPlaybackStates(mediaStates);
    restoreOutputScrolls(outputScrolls);
    refreshIcons();
    refreshGeometry();
    refreshGeometryAfterLayout();
    refreshOutputTimer();
}
function refreshNodes(ids=[]){
    const uniqueIds = [...new Set((ids || []).filter(Boolean))];
    if(!uniqueIds.length) return;
    const outputScrolls = captureOutputScrolls();
    applyViewport();
    for(const id of uniqueIds){
        const node = nodes.find(n => n.id === id);
        if(!node) continue;
        if(node.type === 'output' && refreshOutputNodeContent(node)) continue;
        if(node.type === 'generator' && refreshGeneratorNodeContent(node)) continue;
        if(node.type === 'rh' && refreshRhNodeContent(node)) continue;
        const current = nodesEl.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
        if(!current){
            render();
            return;
        }
        const fresh = renderNode(node);
        if(nodeHasLiveMedia(node)) transplantNodeMediaElement(current, fresh);
        current.replaceWith(fresh);
    }
    restoreOutputScrolls(outputScrolls);
    refreshIcons();
    refreshGeometry();
    refreshGeometryAfterLayout();
    refreshOutputTimer();
    syncLinkFlowForNodes(uniqueIds);
}
/** 运行态徽章 HTML（与 renderNode 一致） */
function nodeRunStatusHtml(node){
    const showStatus = ['generator','msgen','comfy','ltxDirector','llm','rh','replicaAgent','imageRepairAgent','batchPosterAgent','nineGridAgent','slotsLoopVideoAgent','videoReverse'].includes(node.type) && node.runStatus
        && node.runStatus !== 'idle';
    if(!showStatus) return '';
    const label = { queued:'排队中', running:'运行中', done:'完成', failed:'失败' }[node.runStatus] || '';
    return `<span class="node-run-status ${node.runStatus}"><span class="dot"></span>${escapeHtml(label)}${node._cascadeIdx?' '+node._cascadeIdx:''}</span>`;
}
function patchNodeHeadStatus(el, node){
    const headRight = el.querySelector('.node-head > div:last-child');
    if(!headRight) return false;
    const deleteBtn = headRight.querySelector('.node-delete-btn');
    if(!deleteBtn) return false;
    headRight.querySelectorAll('.node-run-status').forEach(n => n.remove());
    const html = nodeRunStatusHtml(node);
    if(html) deleteBtn.insertAdjacentHTML('beforebegin', html);
    return true;
}
function patchNodeRetryBar(el, node){
    const body = el.querySelector('.node-body');
    if(!body) return false;
    body.querySelectorAll('[data-retry-bar]').forEach(n => n.remove());
    const html = retryBarHtml(node);
    if(html){
        body.insertAdjacentHTML('beforeend', html);
        bindCascadeButtons(body, node.id);
    }
    return true;
}
function patchGenRunButton(el, node, defaultLabel, activeLabel){
    const btn = el.querySelector('.gen-run-row .gen-btn, .gen-run-actions .gen-btn');
    if(!btn) return false;
    const state = agentPendingRunState(node.id, defaultLabel, activeLabel);
    btn.classList.toggle('running', Boolean(state.runningCls));
    if(isNodeDisabled(node)) btn.setAttribute('disabled', '');
    else btn.removeAttribute('disabled');
    const icon = btn.querySelector('i[data-lucide]');
    const iconHtml = icon ? icon.outerHTML : '';
    btn.innerHTML = `${iconHtml}${escapeHtml(state.label)}`;
    return true;
}
/** generator 增量刷新：不重建 gen-settings，保住表单焦点 */
function refreshGeneratorNodeContent(node){
    if(node.type !== 'generator') return false;
    const el = nodesEl.querySelector(`.generator-node[data-id="${CSS.escape(node.id)}"], .node.generator-node[data-id="${CSS.escape(node.id)}"]`);
    if(!el?.querySelector('.gen-settings')) return false;
    if(!patchNodeHeadStatus(el, node)) return false;
    patchGenRunButton(el, node, tr('canvas.apiGenerate'), tr('canvas.generating'));
    patchNodeRetryBar(el, node);
    const cascadeSlot = el.querySelector('.gen-run-row');
    if(cascadeSlot){
        cascadeSlot.querySelectorAll('.gen-cascade-btn').forEach(b => b.remove());
        const cascadeHtml = cascadeBtnHtml(node);
        if(cascadeHtml){
            cascadeSlot.insertAdjacentHTML('beforeend', cascadeHtml);
            bindCascadeButtons(cascadeSlot, node.id);
        }
    }
    // 输入缩略图可更新；不碰 .gen-settings
    try {
        const sources = orderedSources(node, generatorSources(node));
        const imageInputs = sources
            .map(src => ({...src, refs:imageRefsOnly(src.refs || [])}))
            .filter(src => src.refs?.length);
        renderPromptPreview(el.querySelector('.prompt-list'), sources.filter(src => src.prompt && !src.refs?.length));
        renderImageInputList(el.querySelector('.input-list'), node, imageInputs);
    } catch(err) {
        console.warn('[infinite-canvas] generator incremental patch partial fail', err);
    }
    return true;
}
/** rh 增量刷新：不重建 rh-prompt-list textarea，保住焦点 */
function refreshRhNodeContent(node){
    if(node.type !== 'rh') return false;
    const el = nodesEl.querySelector(`.rh-node[data-id="${CSS.escape(node.id)}"], .node.rh-node[data-id="${CSS.escape(node.id)}"]`);
    if(!el?.querySelector('.rh-prompt-list')) return false;
    if(!patchNodeHeadStatus(el, node)) return false;
    patchGenRunButton(el, node, tr('canvas.rhRun'), tr('canvas.rhRunning'));
    patchNodeRetryBar(el, node);
    const cascadeSlot = el.querySelector('.gen-run-row');
    if(cascadeSlot){
        cascadeSlot.querySelectorAll('.gen-cascade-btn').forEach(b => b.remove());
        const cascadeHtml = cascadeBtnHtml(node);
        if(cascadeHtml){
            cascadeSlot.insertAdjacentHTML('beforeend', cascadeHtml);
            bindCascadeButtons(cascadeSlot, node.id);
        }
    }
    // 媒体缩略图可更新；不重建 prompt textarea / 参数表单
    try {
        const fields = rhActiveFields(node);
        const media = rhMediaSources(node);
        renderRhMediaFields(el.querySelector('.rh-input-list'), node, fields, media);
    } catch(err) {
        console.warn('[infinite-canvas] rh incremental patch partial fail', err);
    }
    return true;
}
function refreshRunNodes(node, out=null){
    refreshNodes([node?.id, out?.id]);
}
function captureOutputScrolls(){
    const state = new Map();
    // output 节点滚动位置
    nodesEl.querySelectorAll('.output-node, .frame-stack-node').forEach(el => {
        const body = el.querySelector('.node-body');
        if(body) state.set('out:' + el.dataset.id, { top:body.scrollTop, left:body.scrollLeft });
    });
    // LLM 聊天日志滚动位置（记录是否在底部，以便恢复时保持底部）
    nodesEl.querySelectorAll('.llm-node').forEach(el => {
        const log = el.querySelector('.llm-chat-log');
        if(!log) return;
        const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 12;
        state.set('llm:' + el.dataset.id, { top:log.scrollTop, atBottom });
    });
    return state;
}
function restoreOutputScrolls(state){
    requestAnimationFrame(() => {
        state.forEach((pos, key) => {
            if(key.startsWith('out:')){
                const id = key.slice(4);
                const body = nodesEl.querySelector(`.output-node[data-id="${CSS.escape(id)}"] .node-body`);
                if(body){ body.scrollTop = pos.top || 0; body.scrollLeft = pos.left || 0; }
            } else if(key.startsWith('llm:')){
                const id = key.slice(4);
                const log = nodesEl.querySelector(`.llm-node[data-id="${CSS.escape(id)}"] .llm-chat-log`);
                if(log){
                    // 之前在底部 → 保持底部（显示最新消息）；否则恢复原位
                    log.scrollTop = pos.atBottom ? log.scrollHeight : (pos.top || 0);
                }
            }
        });
    });
}
function isNodeControl(target){
    return !!target.closest('textarea, input, select, option, button, audio, video, [contenteditable="true"], .seg, .gen-btn, .comfy-run, .input-item, .blank-image, .mode-tabs, .ms-model-tabs, .llm-provider, .llm-output, .llm-chat-log, .llm-bubble, .llm-pane-resizer, .loop-preview, .ltx-director-timeline-host, .pr-wrapper, .pr-toolbar, .pr-viewport, .pr-canvas, .pr-player-controls, .pr-prompt-area, .slots-loop-copy-btn, .slots-loop-copy-full-btn, .slots-loop-run-btn, .canvas-custom-select');
}
function destroyLTXEditor(node){
    if(!node?._ltxEditor) return;
    try { node._ltxEditor.destroy?.(); } catch(e) {}
    node._ltxEditor = null;
}
function isNodeDragSurface(target){
    return !isNodeControl(target) && !target.closest('.port, .resize-handle, .output-img-wrap');
}
const NODE_TYPE_ICON = {
    image:'image', prompt:'type', loop:'repeat', promptGroup:'layers', group:'folder',
    imageBatch:'images', frameStack:'images', llm:'brain', replicaAgent:'copy',
    imageRepairAgent:'wrench', batchPosterAgent:'layout-grid', nineGridAgent:'grid-3x3',
    slotsLoopVideoAgent:'clapperboard', videoReverse:'rewind', comfy:'workflow',
    ltxDirector:'film', rh:'cloud', msgen:'sparkles', video:'video', output:'layout-grid'
};
function renderNode(node){
    normalizeApiNodeLayout(node);
    if(node.type === 'rh' && Number(node.h) === 560) delete node.h;
    const el = document.createElement('div');
    const size = defaultNodeSize(node.type);
    const hasFixedSize = Boolean(node.h || size.h);
    const inGroup = nodes.some(g => (g.type === 'group' || g.type === 'promptGroup' || g.type === 'imageBatch') && (g.items || []).includes(node.id));
    el.className = `node ${node.type}-node ${node.type === 'frameStack' ? 'output-node ' : ''}${inGroup ? 'group-member ' : ''}${node.url ? 'has-image' : ''} ${hasFixedSize ? 'sized' : ''} ${selected.has(node.id) ? 'selected' : ''} ${isNodeDisabled(node) ? 'is-disabled' : ''}`;
    el.style.left = `${node.x}px`;
    el.style.top = `${node.y}px`;
    el.style.width = `${node.w || size.w}px`;
    if(node.h || size.h) el.style.height = `${node.h || size.h}px`;
    if(node.type === 'output' || node.type === 'frameStack') syncOutputNodeThumbVars(el, node);
    el.dataset.id = node.id;
    el.onclick = (e) => {
        e.stopPropagation();
        if(isNodeControl(e.target)) return;
        // Ctrl/Cmd 多选已在 mousedown → startNodeDrag 中处理，避免 click 二次切换
        if(e.ctrlKey || e.metaKey) return;
        applyNodeSelection(node.id, e);
    };
    el.oncontextmenu = e => {
        if(!CANVAS_GENERATOR_TYPES.includes(node.type) && node.type !== 'output' && node.type !== 'videoReverse' && node.type !== 'batchPosterAgent' && node.type !== 'nineGridAgent' && node.type !== 'imageRepairAgent' && node.type !== 'slotsLoopVideoAgent') return;
        e.preventDefault();
        e.stopPropagation();
        if(node.type === 'output'){
            if(e.target.closest('.output-img-wrap')) return;
            return;
        }
        else openGeneratorNodeMenu(node.id, e.clientX, e.clientY);
    };
    const title = node.type === 'image' ? 'Image' : node.type === 'prompt' ? 'Prompt' : node.type === 'loop' ? tr('canvas.loopNode') : node.type === 'promptGroup' ? 'Prompts' : node.type === 'group' ? 'Group' : node.type === 'output' ? 'Output' : node.type === 'imageBatch' ? (langIsEn() ? 'Image batch' : '图片组') : node.type === 'frameStack' ? (langIsEn() ? 'Frame Stack' : '截帧集') : node.type === 'llm' ? 'LLM' : node.type === 'replicaAgent' ? '复刻 Agent' : node.type === 'imageRepairAgent' ? (langIsEn() ? 'Repair Agent' : '修图 Agent') : node.type === 'batchPosterAgent' ? 'Batch Poster Agent' : node.type === 'nineGridAgent' ? (langIsEn() ? 'Nine Grid Agent' : '九宫格 Agent') : node.type === 'slotsLoopVideoAgent' ? (langIsEn() ? 'Slots Loop Video Agent' : 'Slots 循环视频 Agent') : node.type === 'videoReverse' ? '视频反推' : node.type === 'comfy' ? 'ComfyUI' : node.type === 'ltxDirector' ? tr('canvas.ltxDirector') : node.type === 'rh' ? 'RunningHub' : node.type === 'msgen' ? tr('canvas.modelscopeGenerate') : node.type === 'video' ? tr('canvas.videoGenerateNode') : tr('canvas.apiGenerate');
    const displayTitle = node.type === 'image' && node.url ? nodeTitleForMedia(node) : title;
    // 运行状态徽章：含单节点失败与级联失败
    const showStatus = ['generator','msgen','comfy','ltxDirector','llm','rh','replicaAgent','imageRepairAgent','batchPosterAgent','nineGridAgent','slotsLoopVideoAgent','videoReverse'].includes(node.type) && node.runStatus
        && node.runStatus !== 'idle';
    const statusHtml = showStatus ? (() => {
        const label = { queued:'排队中', running:'运行中', done:'完成', failed:'失败' }[node.runStatus] || '';
        return `<span class="node-run-status ${node.runStatus}"><span class="dot"></span>${escapeHtml(label)}${node._cascadeIdx?' '+node._cascadeIdx:''}</span>`;
    })() : '';
    const disabledBadge = isNodeDisabled(node)
        ? `<span class="node-disabled-badge" title="${escapeAttr(tr('canvas.nodeDisableHint'))}">${escapeHtml(tr('canvas.nodeDisabled'))}</span>`
        : '';
    const promptGroupHeadToggle = node.type === 'promptGroup' ? promptGroupHeadToggleHtml(node) : '';
    const headIcon = NODE_TYPE_ICON[node.type] || 'zap';
    el.innerHTML = `<div class="node-head"><span class="node-head-icon"><i data-lucide="${headIcon}" class="w-3 h-3"></i></span><span class="node-title">${displayTitle}</span><div style="display:flex;align-items:center;gap:8px;margin-left:auto">${promptGroupHeadToggle}${disabledBadge}${statusHtml}<button type="button" class="node-delete-btn text-gray-300 hover:text-red-500" aria-label="${escapeAttr(tr('common.delete'))}"><i data-lucide="x" class="w-4 h-4"></i></button></div></div>`;
    const deleteBtn = el.querySelector('.node-delete-btn');
    if(deleteBtn){
        deleteBtn.onmousedown = e => e.stopPropagation();
    }
    if(node.type === 'promptGroup'){
        const headToggle = el.querySelector('[data-pg-head-toggle]');
        if(headToggle){
            headToggle.onmousedown = e => e.stopPropagation();
            headToggle.onclick = e => {
                e.stopPropagation();
                togglePromptGroupAllChildren(node);
            };
        }
    }
    const body = document.createElement('div');
    body.className = 'node-body';
    if(node.type === 'image') {
        if(node.url) {
            const missing = isMissingAssetUrl(node.url);
            const mediaKind = mediaKindForNode(node);
            const isEditableImage = mediaKind === 'image' && !missing;
            body.innerHTML = `<div class="image-preview-wrap">${missing ? missingAssetHtml(node.url) : `<img src="${escapeAttr(node.url)}" draggable="false">`}</div><div class="image-caption text-[11px] text-gray-400 truncate">${escapeHtml(node.name || 'image')}${missing ? ` · ${langIsEn() ? 'missing' : '文件缺失'}` : ''}</div>`;
            if(!missing && mediaKind !== 'image'){
                const mediaHtml = mediaKind === 'video'
                    ? `<div class="media-card video-card"><div class="video-player-wrap"><video src="${escapeAttr(node.url)}" data-url="${escapeAttr(node.url)}" controls preload="auto" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"></video><button type="button" class="btn-capture-frame">${langIsEn() ? 'Capture frame' : '截取当前帧'}</button></div></div>`
                    : `<div class="media-card audio-card"><i data-lucide="file-audio" class="w-8 h-8"></i><div class="audio-title">${escapeHtml(node.name || 'Audio')}</div><div class="audio-sub">AUDIO</div><audio src="${escapeAttr(node.url)}" data-url="${escapeAttr(node.url)}" controls preload="metadata"></audio></div>`;
                body.innerHTML = `<div class="image-preview-wrap">${mediaHtml}</div><div class="image-caption text-[11px] text-gray-400 truncate">${escapeHtml(node.name || nodeTitleForMedia(node))}</div>`;
                if(mediaKind === 'video') bindVideoCaptureFrame(body, node);
            }
            const previewWrap = body.querySelector('.image-preview-wrap');
            const loadedImg = body.querySelector('img');
            const openEditor = e => {
                if(!isEditableImage) return;
                e.preventDefault();
                e.stopPropagation();
                e.stopImmediatePropagation();
                openImageEditor(node.id);
            };
            body.onmousedown = e => {
                if(e.detail >= 2){
                    openEditor(e);
                    return;
                }
                startNodeDrag(e, node);
            };
            body.ondragover = e => allowImageNodeDropEvent(e, previewWrap);
            body.ondragleave = e => {
                e.stopPropagation();
                previewWrap.classList.remove('drag-over');
            };
            body.ondrop = e => handleImageNodeDropEvent(e, node.id, previewWrap);
            body.oncontextmenu = e => {
                e.preventDefault();
                e.stopPropagation();
                openImageNodeMenu(node.id, e.clientX, e.clientY);
            };
            if(loadedImg && isEditableImage){
                loadedImg.addEventListener('mousedown', e => {
                    if(e.detail >= 2) openEditor(e);
                }, true);
                loadedImg.addEventListener('dblclick', openEditor, true);
            }
            if(isEditableImage) body.addEventListener('dblclick', openEditor, true);
            if(loadedImg && loadedImg.complete && loadedImg.naturalHeight > 0){
                requestAnimationFrame(refreshGeometry);
            } else if(loadedImg) {
                loadedImg.onload = () => refreshGeometryAfterLayout();
            }
        } else {
        body.innerHTML = `<div class="blank-image"><i data-lucide="image-plus" class="w-7 h-7"></i><div class="text-[11px] font-bold">${tr('canvas.clickDragPasteImage')}</div></div>`;
            const blank = body.querySelector('.blank-image');
            blank.onclick = () => pickImageForNode(node.id);
            blank.ondragover = e => allowImageNodeDropEvent(e, blank);
            blank.ondragleave = e => { e.stopPropagation(); blank.classList.remove('drag-over'); };
            blank.ondrop = e => handleImageNodeDropEvent(e, node.id, blank);
        }
    }
    if(node.type === 'prompt') {
        body.innerHTML = `<div class="prompt-editor"><textarea placeholder="${tr('canvas.promptPlaceholder')}">${escapeHtml(node.text || '')}</textarea>${promptCounterHtml(node.text || '')}</div>`;
        const textarea = body.querySelector('textarea');
        bindScrollableText(textarea);
        textarea.oninput = e => {
            node.text = e.target.value;
            refreshPromptCounter(body, node.text);
            scheduleSave();
            syncGeneratorInputs();
            refreshGeneratorInputViews();
            refreshDownstreamVideoReverseNodes(node.id);
            refreshDownstreamSlotsLoopVideoNodes(node.id);
            scheduleLinkGeometryRefresh([node.id]);
        };
    }
    if(node.type === 'loop') body.appendChild(renderLoopBody(node));
    if(node.type === 'group') {
        const items = (node.items || []).map(id => nodes.find(n => n.id === id)).filter(Boolean);
        const imgCount = items.filter(n => n.type === 'image').length;
        const parts = [];
        if(imgCount) parts.push(`${imgCount} ${tr('canvas.imageCount')}`);
        const text = parts.length ? `${parts.join(' · ')} ${tr('canvas.grouped')}` : tr('canvas.groupEmpty');
        body.innerHTML = `<div class="text-[11px] text-gray-400">${text}</div>`;
    }
    if(node.type === 'promptGroup') {
        prunePromptGroupItems(node);
        const listed = (node.items || []).map(id => nodes.find(n => n.id === id)).filter(n => n?.type === 'prompt');
        const activeCount = activePromptGroupChildren(node).length;
        const hasPrefix = Boolean(String(node.prefixPrompt || '').trim());
        const childRows = listed.length
            ? listed.map((p, i) => {
                const outside = !isPromptGroupMember(node, p);
                const off = isNodeDisabled(p);
                const label = String(p.text || '').trim();
                const short = label ? (label.length > 30 ? `${label.slice(0, 30)}…` : label) : `${tr('canvas.promptCount')} ${i + 1}`;
                return `<div class="prompt-group-child-row ${outside ? 'is-outside' : ''} ${off ? 'is-off' : ''}">
                    <span class="prompt-group-child-label" title="${escapeAttr(label)}">${i + 1}. ${escapeHtml(short)}</span>
                    ${outside ? `<span class="prompt-group-child-tag">${langIsEn() ? 'Outside' : '已移出'}</span>` : ''}
                    <button type="button" class="prompt-group-child-toggle ${off ? 'off' : ''}" data-pg-toggle="${escapeAttr(p.id)}" title="${escapeAttr(tr('canvas.nodeDisableHint'))}">${off ? (langIsEn() ? 'Off' : '关') : (langIsEn() ? 'On' : '开')}</button>
                </div>`;
            }).join('')
            : `<div class="prompt-group-child-empty">${tr('canvas.promptGroupDropPrompts')}</div>`;
        body.innerHTML = `
            <div class="prompt-group-body">
                <div class="group-panel-chrome">
                    <div class="prompt-group-meta">${activeCount}/${listed.length} ${tr('canvas.promptCount')} ${tr('canvas.grouped')}${hasPrefix ? ` · ${tr('canvas.promptGroupPrefix')}` : ''}</div>
                    <button type="button" class="secondary-btn group-tidy-btn" title="${escapeAttr(tr('canvas.organizeGroupChildrenHint'))}"><i data-lucide="layout-grid" class="w-3.5 h-3.5"></i><span>${escapeHtml(tr('canvas.organizeGroupChildren'))}</span></button>
                    <div class="prompt-group-children">${childRows}</div>
                    <div class="prompt-group-prefix-label">${tr('canvas.promptGroupPrefix')}</div>
                    <textarea class="prompt-group-prefix" placeholder="${escapeAttr(tr('canvas.promptGroupPrefixPlaceholder'))}">${escapeHtml(node.prefixPrompt || '')}</textarea>
                </div>
            </div>
        `;
        body.querySelectorAll('[data-pg-toggle]').forEach(btn => {
            btn.onmousedown = e => e.stopPropagation();
            btn.onclick = e => {
                e.stopPropagation();
                const pid = btn.getAttribute('data-pg-toggle');
                const p = nodes.find(n => n.id === pid);
                if(!p) return;
                togglePromptGroupChildEnabled(node, p);
            };
        });
        const prefixEl = body.querySelector('.prompt-group-prefix');
        if(prefixEl){
            prefixEl.onmousedown = e => e.stopPropagation();
            prefixEl.onclick = e => e.stopPropagation();
            prefixEl.onwheel = e => e.stopPropagation();
            prefixEl.oninput = e => {
                node.prefixPrompt = e.target.value;
                const meta = body.querySelector('.prompt-group-meta');
                if(meta){
                    const active = Boolean(String(node.prefixPrompt || '').trim());
                    meta.textContent = `${activeCount}/${listed.length} ${tr('canvas.promptCount')} ${tr('canvas.grouped')}${active ? ` · ${tr('canvas.promptGroupPrefix')}` : ''}`;
                }
                scheduleSave();
                syncGeneratorInputs();
                refreshGeneratorInputViews();
            };
        }
        bindGroupTidyButton(body, node);
    }
    if(node.type === 'llm') body.appendChild(renderLLMBody(node));
    if(node.type === 'generator') body.appendChild(renderGeneratorBody(node));
    if(node.type === 'replicaAgent') body.appendChild(renderReplicaAgentBody(node));
    if(node.type === 'imageRepairAgent') body.appendChild(renderImageRepairAgentBody(node));
    if(node.type === 'batchPosterAgent') body.appendChild(renderBatchPosterAgentBody(node));
    if(node.type === 'nineGridAgent') body.appendChild(renderNineGridAgentBody(node));
    if(node.type === 'slotsLoopVideoAgent') body.appendChild(renderSlotsLoopVideoAgentBody(node));
    if(node.type === 'videoReverse') body.appendChild(renderVideoReverseBody(node));
    if(node.type === 'msgen') body.appendChild(renderMsGenBody(node));
    if(node.type === 'video') body.appendChild(renderVideoBody(node));
    if(node.type === 'rh') body.appendChild(renderRhBody(node));
    if(node.type === 'comfy') body.appendChild(renderComfyBody(node));
    if(node.type === 'ltxDirector') body.appendChild(renderLTXDirectorBody(node));
    if(node.type === 'output') {
        const pendingHtml = (node._pending || []).map(p => outputPendingHtml(p)).join('');
        body.innerHTML = renderOutputGrid(node, pendingHtml);
        syncOutputNodeThumbVars(el, node);
        body.onwheel = e => {
            e.stopPropagation();
        };
        body.querySelectorAll('.output-img-wrap').forEach(wrap => bindOutputWrap(wrap, node));
    }
    if(node.type === 'frameStack') {
        const count = (node.images || []).length;
        const emptyLabel = langIsEn() ? 'Drop images here or upload' : '拖入图片或点击上传';
        const gridHtml = count
            ? renderOutputGrid(node)
            : `<div class="frame-stack-empty"><i data-lucide="images" class="w-6 h-6"></i><div>${emptyLabel}</div></div>`;
        body.innerHTML = `
            <div class="frame-stack-toolbar">
                <button type="button" class="secondary-btn frame-stack-upload-btn"><i data-lucide="image-plus" class="w-3.5 h-3.5"></i><span>${langIsEn() ? 'Upload' : '上传图片'}</span></button>
                <span class="frame-stack-count">${count} ${langIsEn() ? 'images' : '张'}</span>
            </div>
            ${gridHtml}
        `;
        body.onwheel = e => { e.stopPropagation(); };
        body.querySelectorAll('.output-img-wrap').forEach(wrap => bindOutputWrap(wrap, node));
        bindFrameStackUpload(body, node);
    }
    if(node.type === 'imageBatch') {
        const imgNodes = imageBatchChildImages(node);
        const text = imgNodes.length
            ? `${imgNodes.length} ${tr('canvas.imageCount')} ${tr('canvas.grouped')}`
            : tr('canvas.groupEmpty');
        body.innerHTML = `
            <div class="image-batch-body">
                <div class="group-panel-chrome">
                    <div class="image-batch-meta text-[11px] text-gray-400">${text}</div>
                    <div class="image-batch-actions">
                        <button type="button" class="secondary-btn image-batch-upload-btn"><i data-lucide="image-plus" class="w-3.5 h-3.5"></i><span>${langIsEn() ? 'Upload' : '上传图片'}</span></button>
                        <button type="button" class="secondary-btn group-tidy-btn" title="${escapeAttr(tr('canvas.organizeGroupChildrenHint'))}"><i data-lucide="layout-grid" class="w-3.5 h-3.5"></i><span>${escapeHtml(tr('canvas.organizeGroupChildren'))}</span></button>
                    </div>
                    <div class="image-batch-hint text-[10px] text-gray-500">${escapeHtml(tr('canvas.imageBatchConnectHint'))}</div>
                </div>
            </div>
        `;
        bindImageBatchUpload(body, node);
        bindGroupTidyButton(body, node);
    }
    if(node.type === 'generator'){
        const scaleWrap = document.createElement('div');
        scaleWrap.className = 'generator-node-scale';
        scaleWrap.appendChild(el.querySelector('.node-head'));
        scaleWrap.appendChild(body);
        el.appendChild(scaleWrap);
    } else {
        el.appendChild(body);
    }
    if(node.type === 'promptGroup') bindPromptGroupOutputDrop(node, el);
    el.querySelectorAll('button, select, textarea, input').forEach(control => {
        if(control.classList.contains('node-delete-btn')) return;
        control.addEventListener('mousedown', e => e.stopPropagation());
        control.addEventListener('click', e => e.stopPropagation());
    });
    el.onmousedown = e => {
        if(e.button !== 0) return;
        // Space 按下时优先平移，绝不拖节点
        if(spacePanArmed){
            if(canStartForcedPanFromTarget(e.target)) startBoardPan(e, {allowOverNodes:true});
            return;
        }
        if(!isNodeDragSurface(e.target)) return;
        startNodeDrag(e, node);
    };
    const canInput = ['generator','comfy','ltxDirector','output','llm','msgen','video','rh','replicaAgent','imageRepairAgent','batchPosterAgent','nineGridAgent','slotsLoopVideoAgent','videoReverse','frameStack','loop'].includes(node.type);
    const canOutput = ['image','prompt','loop','group','promptGroup','generator','comfy','ltxDirector','llm','msgen','video','rh','replicaAgent','imageRepairAgent','videoReverse','slotsLoopVideoAgent','frameStack','imageBatch'].includes(node.type);
    if(canInput) el.insertAdjacentHTML('beforeend', `<div class="port in" title="${tr('canvas.connectHere')}"><span class="port-dot"></span></div>`);
    if(canOutput) el.insertAdjacentHTML('beforeend', `<div class="port out" title="${tr('canvas.dragConnect')}"><span class="port-dot"></span></div>`);
    el.insertAdjacentHTML('beforeend', `<div class="resize-handle" title="${tr('canvas.resize')}"></div>`);
    el.querySelector('.resize-handle').onmousedown = e => { if(e.button === 0 && !e.shiftKey) startNodeResize(e, node); };
    el.ondragstart = e => { e.preventDefault(); e.stopPropagation(); };
    bindNodeLayoutObserver(el);
    if(node.type === 'generator') fitGeneratorNodeHeight(node);
    mountCanvasCustomSelects(el);
    return el;
}
async function loadFavoriteOutputPaths(){
    try {
        const res = await apiFetch('/api/favorites/paths', { credentials: 'same-origin' });
        if(!res.ok) return;
        const data = await res.json().catch(() => ({}));
        favoriteOutputPaths = new Set(
            (Array.isArray(data.paths) ? data.paths : [])
                .map(normalizeFavoritePath)
                .filter(Boolean),
        );
    } catch {
        favoriteOutputPaths = new Set();
    }
}
function normalizeFavoritePath(raw){
    const text = String(raw || '').trim().replace(/\\/g, '/');
    if(!text) return '';
    if(text.startsWith('/uploads/')) return text.split('?')[0];
    try {
        const parsed = new URL(text, window.location.origin);
        if(parsed.pathname.startsWith('/uploads/')) return parsed.pathname;
    } catch {
        /* ignore */
    }
    return text.split('?')[0];
}
function isOutputUrlFavorited(url){
    const raw = String(url || '').trim();
    if(!raw) return false;
    const normalized = normalizeFavoritePath(raw);
    return favoriteOutputPaths.has(raw)
        || (normalized && favoriteOutputPaths.has(normalized));
}
function rememberFavoritePath(url, favorited){
    const raw = String(url || '').trim();
    const normalized = normalizeFavoritePath(raw);
    if(favorited){
        if(raw) favoriteOutputPaths.add(raw);
        if(normalized) favoriteOutputPaths.add(normalized);
    } else {
        if(raw) favoriteOutputPaths.delete(raw);
        if(normalized) favoriteOutputPaths.delete(normalized);
    }
}
function syncOutputFavoriteBtn(btn, url){
    if(!btn) return;
    const active = isOutputUrlFavorited(url);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    btn.title = active
        ? (langIsEn() ? 'Remove from favorites' : '取消收藏')
        : (langIsEn() ? 'Add to favorites' : '收藏到我的收藏');
}
function syncOutputFavoriteButtons(scope){
    const root = scope instanceof Element ? scope : nodesEl;
    if(!root) return;
    root.querySelectorAll('.output-img-wrap[data-output-url]').forEach(wrap => {
        const url = wrap.dataset.outputUrl || wrap.querySelector('img')?.dataset?.url || '';
        syncOutputFavoriteBtn(wrap.querySelector('.output-fav-btn'), url);
    });
    refreshIcons(scope instanceof Element ? scope : undefined);
}
function outputFavoriteBtnHtml(url){
    if(!url || isMissingAssetUrl(url)) return '';
    const active = isOutputUrlFavorited(url);
    const title = active
        ? (langIsEn() ? 'Remove from favorites' : '取消收藏')
        : (langIsEn() ? 'Add to favorites' : '收藏到我的收藏');
    return `<button type="button" class="output-fav-btn${active ? ' is-active' : ''}" title="${escapeAttr(title)}" aria-pressed="${active ? 'true' : 'false'}"><i data-lucide="star" class="w-3.5 h-3.5"></i></button>`;
}
async function toggleOutputFavorite(wrap, node){
    const url = wrap.dataset.outputUrl || wrap.querySelector('img')?.dataset?.url || '';
    if(!url) return;
    const meta = outputMetaFor(url, node);
    const btn = wrap.querySelector('.output-fav-btn');
    if(btn) btn.disabled = true;
    try {
        const res = await apiFetch('/api/favorites/toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({
                thumbnail_path: url,
                prompt: outputMetaPrompt(meta),
                model: outputImageModelLabel(meta),
                params: meta.params && typeof meta.params === 'object' ? meta.params : {},
                canvas_id: canvas?.id || '',
                node_id: node?.id || '',
            }),
        });
        const data = await res.json().catch(() => ({}));
        if(!res.ok) throw new Error(data.error || (langIsEn() ? 'Favorite failed' : '收藏失败'));
        const canonical = normalizeFavoritePath(data.item?.thumbnail_path || url);
        rememberFavoritePath(canonical || url, !!data.favorited);
        const liveWrap = wrap.isConnected
            ? wrap
            : nodesEl?.querySelector(`.output-img-wrap[data-output-url="${CSS.escape(normalizeFavoritePath(url) || url)}"]`);
        syncOutputFavoriteBtn(liveWrap?.querySelector('.output-fav-btn'), url);
        if(liveWrap) refreshIcons(liveWrap);
        setStatus(data.favorited ? (langIsEn() ? 'Added to favorites' : '已加入我的收藏') : (langIsEn() ? 'Removed from favorites' : '已取消收藏'));
    } catch(e) {
        setStatus(e instanceof Error ? e.message : (langIsEn() ? 'Favorite failed' : '收藏失败'));
    } finally {
        const liveWrap = wrap.isConnected
            ? wrap
            : nodesEl?.querySelector(`.output-img-wrap[data-output-url="${CSS.escape(normalizeFavoritePath(url) || url)}"]`);
        const liveBtn = liveWrap?.querySelector('.output-fav-btn') || btn;
        if(liveBtn) liveBtn.disabled = false;
    }
}
function bindOutputWrap(wrap, node){
    const img = wrap.querySelector('img');
    const video = wrap.querySelector('video');
    const audio = wrap.querySelector('audio');
    const fileCard = wrap.querySelector('.output-file-card');
    const del = wrap.querySelector('.output-del');
    const fav = wrap.querySelector('.output-fav-btn');
    if(img){
        img.draggable = true;
        img.ondragstart = e => {
            e.stopPropagation();
            img.dataset.dragging = '1';
            img.closest('.output-img-wrap')?.setAttribute('data-dragging-source', '1');
            const prompt = outputMetaPrompt(outputMetaFor(img.dataset.url, node));
            beginOutputDragSession(e, img, img.dataset.url, prompt);
            setCanvasOutputDragActive(true);
            setOutputDragPreview(e, img);
            e.dataTransfer.effectAllowed = 'copy';
            e.dataTransfer.setData('application/x-canvas-output-image', img.dataset.url);
            e.dataTransfer.setData(OUTPUT_DRAG_PROMPT_MIME, prompt || '');
            e.dataTransfer.setData('text/uri-list', img.dataset.url);
        };
        img.ondragend = () => {
            endOutputDragSession();
            setCanvasOutputDragActive(false);
            img.closest('.output-img-wrap')?.removeAttribute('data-dragging-source');
            setTimeout(() => { delete img.dataset.dragging; }, 0);
        };
        img.oncontextmenu = e => {
            e.preventDefault();
            e.stopPropagation();
            const url = img.dataset.url || wrap.dataset.outputUrl || '';
            if(isImageStackNode(node)){
                openFrameStackImageMenu(node.id, url, outputImageName(url), e.clientX, e.clientY);
                return;
            }
            if(node.type === 'output'){
                openOutputImageMenu(node.id, url, e.clientX, e.clientY);
            }
        };
        img.onclick = e => {
            e.stopPropagation();
            if(img.dataset.dragging) return;
            openOutputLightbox(img.dataset.url, node);
        };
    }
    if(video){
        video.onclick = e => {
            e.stopPropagation();
            openOutputLightbox(video.dataset.url, node);
        };
    }
    if(fileCard){
        fileCard.onclick = e => {
            e.stopPropagation();
            const url = wrap.dataset.outputUrl;
            if(url) downloadUrl(url, outputDownloadName(url)).catch(err => softAlert(err.message || '下载失败'));
        };
    }
    if(del){
        del.onmousedown = e => e.stopPropagation();
        del.onclick = e => {
            e.stopPropagation();
            const pid = wrap.dataset.pendingId;
            if(pid){
                const pending = (node._pending || []).find(p => p.id === pid);
                const sourceId = pending?.run?.node?.id || '';
                node._pending = (node._pending || []).filter(p => p.id !== pid);
                if(sourceId) reconcileAgentRunStateFromPending(sourceId);
                refreshNodes(sourceId ? [sourceId, node.id] : [node.id]);
                if(sourceId) syncLinkFlowForNodes([sourceId, node.id]);
                refreshOutputTimer();
            } else {
                const url = img?.dataset.url || video?.dataset.url || audio?.dataset.url || wrap.dataset.outputUrl || wrap.dataset.missingUrl || '';
                node.images = (node.images || []).filter(item => outputUrlValue(item) !== url);
                if(node.imageComparisons) delete node.imageComparisons[url];
                scheduleSave();
                refreshNodes([node.id]);
            }
            if(isImageStackNode(node)) refreshImageStackConsumers(node.id);
        };
    }
    if(fav && node.type === 'output'){
        fav.onmousedown = e => e.stopPropagation();
        fav.onclick = e => {
            e.stopPropagation();
            void toggleOutputFavorite(wrap, node);
        };
    }
}
function outputDomKeyForItem(item){
    return `url:${outputUrlValue(item)}`;
}
function outputDomKeyForPending(pending){
    return `pending:${pending?.id || ''}`;
}
function refreshOutputNodeContent(node){
    if(!['output','frameStack'].includes(node.type)) return false;
    const selector = node.type === 'output' ? '.output-node' : '.frame-stack-node';
    const el = nodesEl.querySelector(`${selector}[data-id="${CSS.escape(node.id)}"]`);
    const body = el?.querySelector('.node-body');
    const grid = body?.querySelector('.output-grid');
    if(!body || !grid) return false;
    body.onwheel = e => { e.stopPropagation(); };
    if(node.type === 'output'){
        const pendingHtml = (node._pending || []).map(p => outputPendingHtml(p)).join('');
        body.innerHTML = renderOutputGrid(node, pendingHtml);
        const nodeEl = el;
        syncOutputNodeThumbVars(nodeEl, node);
        body.querySelectorAll('.output-img-wrap').forEach(wrap => bindOutputWrap(wrap, node));
        syncOutputFavoriteButtons(body);
        refreshOutputTimer();
        return true;
    }
    const layout = outputGridLayout(node);
    grid.classList.toggle('grid-layout', !!layout);
    if(layout) grid.style.setProperty('--grid-cols', String(Math.max(1, Number(layout.cols || 1))));
    else grid.style.removeProperty('--grid-cols');
    const items = [
        ...(node.images || []).map(item => ({
            key:outputDomKeyForItem(item),
            html:renderOutputMedia(item, !!layout)
        })),
        ...(node._pending || []).map(p => ({
            key:outputDomKeyForPending(p),
            html:outputPendingHtml(p)
        }))
    ];
    const wanted = new Set(items.map(item => item.key));
    [...grid.children].forEach(child => {
        const key = child.dataset.pendingId ? outputDomKeyForPending({id:child.dataset.pendingId}) : `url:${child.dataset.outputUrl || child.dataset.missingUrl || child.querySelector('img,video,audio')?.dataset.url || ''}`;
        if(!wanted.has(key)) child.remove();
        else child.dataset.outputKey = key;
    });
    items.forEach(item => {
        let child = [...grid.children].find(el => el.dataset.outputKey === item.key);
        if(!child){
            grid.insertAdjacentHTML('beforeend', item.html);
            child = grid.lastElementChild;
            child.dataset.outputKey = item.key;
            bindOutputWrap(child, node);
        }
        grid.appendChild(child);
    });
    refreshOutputTimer();
    return true;
}
function syncOutputNodeThumbVars(el, node){
    if(!el || !node) return;
    const w = Math.max(220, Number(node.w || 460));
    const pad = 52;
    const gap = 8;
    const cols = chunkOutputImagesForRender(node.images || []).some(chunk => chunk.type === 'grid')
        ? 3
        : Math.max(2, Math.min(4, Math.floor((w - pad) / 150)));
    const cell = Math.max(108, Math.floor((w - pad - gap * Math.max(0, cols - 1)) / cols));
    const thumbMax = Math.min(420, cell);
    const thumbMin = Math.max(96, thumbMax - 28);
    el.style.setProperty('--output-thumb-max', `${thumbMax}px`);
    el.style.setProperty('--output-thumb-min', `${thumbMin}px`);
}
function defaultNodeSize(type){
    if(type === 'image') return {w:260, h:336};
    if(type === 'prompt') return {w:310, h:0};
    if(type === 'loop') return {w:336, h:0};
    if(type === 'llm') return {w:420, h:590};
    if(type === 'generator') return {w:380, h:0};
    if(type === 'replicaAgent') return {w:320, h:480};
    if(type === 'imageRepairAgent') return {w:320, h:460};
    if(type === 'batchPosterAgent') return {w:340, h:520};
    if(type === 'nineGridAgent') return {w:360, h:560};
    if(type === 'slotsLoopVideoAgent') return {w:380, h:520};
    if(type === 'videoReverse') return {w:380, h:460};
    if(type === 'msgen') return {w:380, h:0};
    if(type === 'video') return {w:400, h:0};
    if(type === 'rh') return {w:430, h:0};
    if(type === 'comfy') return {w:420, h:460};
    if(type === 'ltxDirector') return {w:1000, h:800};
    if(type === 'output') return {w:460, h:0};
    if(type === 'frameStack') return {w:460, h:0};
    if(type === 'imageBatch') return {w:GROUP_DEFAULT_W, h:GROUP_DEFAULT_H_IMAGE_BATCH};
    if(type === 'promptGroup') return {w:GROUP_DEFAULT_W, h:GROUP_DEFAULT_H_PROMPT_GROUP};
    return {w:260, h:0};
}
function loopCount(node){
    return Math.max(1, Math.min(100, Number(node?.count || 1) || 1));
}
function splitPromptIntoItems(text){
    const trimmed = String(text || '').trim();
    if(!trimmed) return [];
    const numbered = trimmed.split(/\s*(?:^|\s)\d+\s*[.、)）．]\s+/).map(s => s.trim()).filter(Boolean);
    if(numbered.length >= 2) return numbered;
    const lines = trimmed.split(/\r?\n+/).map(s => s.trim()).filter(Boolean);
    if(lines.length >= 2) return lines;
    return [trimmed];
}
const loopPromptVisiting = new Set();
function loopPromptUpstreamHint(node, promptItemCount){
    if(!promptItemCount) return '';
    const key = node?.mode === 'parallel' ? 'canvas.loopPromptHintParallel' : 'canvas.loopPromptHintSerial';
    return trf(key, {n: promptItemCount});
}
function applyPromptGroupPrefix(prefix, text){
    const base = String(text || '').trim();
    const pre = String(prefix || '').trim();
    if(!pre) return base;
    if(!base) return pre;
    return `${pre}\n\n${base}`;
}
function isPromptGroupMember(group, child){
    if(!group || group.type !== 'promptGroup' || !child || child.type !== 'prompt') return false;
    if(!Array.isArray(group.items) || !group.items.includes(child.id)) return false;
    return isCenterInGroupRect(nodeRect(child), nodeRect(group));
}
function activePromptGroupChildren(groupNode){
    if(!groupNode || groupNode.type !== 'promptGroup') return [];
    return (groupNode.items || [])
        .map(id => nodes.find(n => n.id === id))
        .filter(n => n?.type === 'prompt' && isNodeEnabled(n) && isPromptGroupMember(groupNode, n));
}
function prunePromptGroupItems(groupNode){
    if(!groupNode || groupNode.type !== 'promptGroup' || !Array.isArray(groupNode.items)) return false;
    const before = groupNode.items.length;
    groupNode.items = groupNode.items.filter(id => {
        const child = nodes.find(n => n.id === id);
        return child?.type === 'prompt' && isPromptGroupMember(groupNode, child);
    });
    return groupNode.items.length !== before;
}
function syncPromptGroupDownstreamLoops(group){
    if(!group || group.type !== 'promptGroup') return;
    connections
        .filter(c => c.from === group.id)
        .map(c => nodes.find(n => n.id === c.to))
        .filter(n => n?.type === 'loop')
        .forEach(loop => syncLoopCountFromPromptGroup(loop, group));
}
function promptGroupChildTexts(groupNode){
    if(!groupNode || groupNode.type !== 'promptGroup') return [];
    if(prunePromptGroupItems(groupNode)) syncPromptGroupDownstreamLoops(groupNode);
    const prefix = groupNode.prefixPrompt || '';
    return activePromptGroupChildren(groupNode)
        .map(p => applyPromptGroupPrefix(prefix, p.text || ''))
        .filter(Boolean);
}
function promptGroupMemberPrompts(group){
    if(!group || group.type !== 'promptGroup') return [];
    prunePromptGroupItems(group);
    return (group.items || [])
        .map(id => nodes.find(n => n.id === id))
        .filter(n => n?.type === 'prompt' && isPromptGroupMember(group, n));
}
function parentPromptGroupIdsForChild(childId){
    return nodes
        .filter(g => g.type === 'promptGroup' && Array.isArray(g.items) && g.items.includes(childId))
        .map(g => g.id);
}
function promptGroupHeadToggleState(group){
    const members = promptGroupMemberPrompts(group);
    if(!members.length) return 'empty';
    const active = members.filter(p => isNodeEnabled(p)).length;
    if(active === 0) return 'off';
    if(active === members.length) return 'on';
    return 'partial';
}
function promptGroupHeadToggleTitle(group, state){
    const members = promptGroupMemberPrompts(group);
    const active = members.filter(p => isNodeEnabled(p)).length;
    if(state === 'on') return langIsEn() ? `All ${members.length} prompts enabled` : `全部 ${members.length} 条已启用`;
    if(state === 'off') return langIsEn() ? 'All prompts disabled' : '全部子提示词已关闭';
    if(state === 'partial') return langIsEn() ? `${active}/${members.length} prompts enabled` : `${active}/${members.length} 条已启用`;
    return langIsEn() ? 'No prompts inside group' : '组内无有效提示词';
}
function promptGroupHeadToggleHtml(node){
    const state = promptGroupHeadToggleState(node);
    const title = promptGroupHeadToggleTitle(node, state);
    const icon = state === 'off' ? 'toggle-left' : 'toggle-right';
    return `<button type="button" class="node-enable-toggle ${state}" data-pg-head-toggle="${escapeAttr(node.id)}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}" ${state === 'empty' ? 'disabled' : ''}><i data-lucide="${icon}" class="w-4 h-4"></i></button>`;
}
function setPromptGroupChildEnabled(prompt, enabled){
    if(!prompt || prompt.type !== 'prompt') return;
    if(enabled) delete prompt.disabled;
    else prompt.disabled = true;
}
function togglePromptGroupChildEnabled(group, prompt){
    if(!group || !prompt) return;
    setPromptGroupChildEnabled(prompt, !isNodeEnabled(prompt));
    const refreshIds = new Set([group.id, prompt.id]);
    refreshNodes([...refreshIds]);
    syncGeneratorInputs();
    refreshGeneratorInputViews();
    scheduleSave();
}
function togglePromptGroupAllChildren(group){
    if(!group || group.type !== 'promptGroup') return;
    const state = promptGroupHeadToggleState(group);
    if(state === 'empty') return;
    const enableAll = state !== 'on';
    const members = promptGroupMemberPrompts(group);
    members.forEach(p => setPromptGroupChildEnabled(p, enableAll));
    refreshNodes([group.id, ...members.map(p => p.id)]);
    syncGeneratorInputs();
    refreshGeneratorInputViews();
    scheduleSave();
}
function loopInputPromptItems(node){
    if(!node?.showPrompt) return [];
    if(loopPromptVisiting.has(node.id)) return [];
    loopPromptVisiting.add(node.id);
    try {
        const items = [];
        connections.filter(c => c.to === node.id)
            .map(c => nodes.find(n => n.id === c.from))
            .filter(Boolean)
            .forEach(n => {
                let text = '';
                if(n.type === 'prompt') {
                    if(!isNodeEnabled(n)) return;
                    if((n.text || '').trim()) items.push((n.text || '').trim());
                    return;
                }
                else if(n.type === 'promptGroup') {
                    promptGroupChildTexts(n).forEach(text => items.push(text));
                    return;
                }
                else if(n.type === 'loop') text = renderLoopPrompt(n);
                else if(n.type === 'llm') text = n.outputText || '';
                if(String(text || '').trim()) items.push(String(text || '').trim());
            });
        return items;
    } finally {
        loopPromptVisiting.delete(node.id);
    }
}
function loopInputPrompt(node, ctx=loopContext){
    const items = loopInputPromptItems(node);
    if(!items.length) return '';
    const startBase = Math.max(1, Number(node?.loopStart) || 1);
    const currentIndex = Math.max(1, Number(ctx?.index || startBase) || startBase);
    return items[(currentIndex - 1) % items.length];
}
function renderLoopPrompt(node, ctx=loopContext){
    if(!node?.showPrompt) return '';
    const variable = String(node?.variablePrompt || '').trim();
    const count = loopCount(node);
    const index = Math.max(1, Number(ctx?.index || 1) || 1);
    const total = Math.max(1, Number(ctx?.total || count) || count);
    const replaceVars = text => String(text || '')
        .replaceAll('《计数》', String(index))
        .replaceAll('《总数》', String(total))
        .replaceAll('《进度》', `${index}/${total}`)
        .replaceAll(`[${tr('canvas.counterToken')}]`, String(index))
        .replaceAll(`[${tr('canvas.totalToken')}]`, String(total))
        .replaceAll(`[${tr('canvas.progressToken')}]`, `${index}/${total}`);
    const selected = loopInputPrompt(node, ctx);
    if(selected) return replaceVars(selected);
    return replaceVars(variable);
}
function imageRefsFromNode(node){
    if(!node || isNodeDisabled(node)) return [];
    if(node.type === 'frameStack'){
        return (node.images || []).map((item, i) => ({
            url:outputUrlValue(item),
            name:(item && typeof item === 'object' && item.name) || outputImageName(outputUrlValue(item)) || `image-${i + 1}.jpg`,
            role:node.role || '',
            kind:'image',
        })).filter(ref => ref.url);
    }
    if(node.type === 'imageBatch'){
        return imageBatchChildImages(node).map(img => ({url:img.url, name:img.name || 'image', role:img.role || '', kind:'image'}));
    }
    if(node.type === 'image' && node.url && mediaKindForNode(node) === 'image') return [{url:node.url, name:node.name || 'image', role:node.role || '', kind:'image'}];
    if(node.type === 'group'){
        return (node.items || [])
            .map(id => nodes.find(x => x.id === id))
            .filter(x => isNodeEnabled(x) && x?.type === 'image' && x?.url && mediaKindForNode(x) === 'image')
            .map(img => ({url:img.url, name:img.name || 'image', role:img.role || '', kind:'image'}));
    }
    if(node.type === 'output'){
        const last = [...(node.images || [])].reverse().map(outputUrlValue).find(url => url && !isVideoUrl(url) && !isAudioUrl(url));
        if(!last) return [];
        return [{url:last, name:outputImageName(last) || 'output.png', kind:'image'}];
    }
    if(CANVAS_IMAGE_OUTPUT_TYPES.includes(node.type)) return generatedImageRefs(node).filter(ref => ref.kind === 'image');
    return [];
}
function loopImageOutputHint(node, ctx=loopContext){
    const allRefs = loopAllConnectedImageRefs(node);
    const batch = loopInputImageRefs(node, ctx).length;
    const rounds = loopCount(node);
    const total = batch * rounds;
    if(!allRefs.length) return tr('canvas.loopImageEmpty');
    let hint = trf('canvas.loopImageWillOutput', {batch, rounds, total});
    const batchSize = Math.max(1, Math.min(100, Number(node.imageBatchSize) || 1));
    if(allRefs.length > 1 && batchSize < allRefs.length){
        hint += ` · ${tr('canvas.loopImageBatchWarning')}`;
    }
    const promptNeed = maxFigureIndexInLoopPrompts(node);
    if(promptNeed > 1 && batchSize < promptNeed){
        hint += ` · ${trf('canvas.loopImagePromptNeedFigures', {n: promptNeed})}`;
    }
    return hint;
}
function loopAllConnectedImageRefs(node){
    if(!node?.imageInput) return [];
    return connections
        .filter(c => c.to === node.id)
        .map(c => nodes.find(n => n.id === c.from))
        .filter(n => isNodeEnabled(n))
        .flatMap(n => imageRefsFromNode(n))
        .filter(ref => ref?.url);
}
function loopImageRefLabel(index){
    const n = Math.max(1, Number(index) || 1);
    return langIsEn() ? `Image ${n}` : `图${n}`;
}
function renderLoopImageRefList(container, node, ctx=null){
    if(!container) return;
    const refs = loopAllConnectedImageRefs(node);
    if(!refs.length){
        container.innerHTML = '';
        container.hidden = true;
        return;
    }
    const previewCtx = ctx || {index:Math.max(1, Number(node.loopStart) || 1)};
    const activeUrls = new Set(loopInputImageRefs(node, previewCtx).map(ref => ref.url));
    container.hidden = false;
    container.innerHTML = `
        <div class="loop-image-ref-hint">${escapeHtml(tr('canvas.loopImageOrderHint'))}</div>
        <div class="loop-image-ref-row">${refs.map((ref, idx) => {
            const url = ref.url || '';
            const active = activeUrls.has(url);
            const thumb = url && !isMissingAssetUrl(url)
                ? `<img src="${escapeAttr(url)}" alt="" referrerpolicy="no-referrer">`
                : (url ? missingAssetHtml(url, true) : '<i data-lucide="image" class="w-5 h-5"></i>');
            return `<div class="loop-image-ref-item ${active ? 'is-active' : 'is-idle'}" title="${escapeAttr(ref.name || loopImageRefLabel(idx + 1))}">
                <div class="loop-image-ref-thumb">${thumb}<span class="loop-image-ref-index">${escapeHtml(loopImageRefLabel(idx + 1))}</span></div>
                <span class="loop-image-ref-name">${escapeHtml(ref.name || loopImageRefLabel(idx + 1))}</span>
            </div>`;
        }).join('')}</div>`;
    refreshIcons();
}
function loopInputImageRefs(node, ctx=loopContext){
    if(!node?.imageInput) return [];
    const allRefs = connections
        .filter(c => c.to === node.id)
        .map(c => nodes.find(n => n.id === c.from))
        .filter(n => isNodeEnabled(n))
        .flatMap(n => imageRefsFromNode(n))
        .filter(ref => ref?.url);
    if(!allRefs.length) return [];
    const startBase = Math.max(1, Number(node.loopStart) || 1);
    const batchSize = Math.max(1, Math.min(100, Number(node.imageBatchSize) || 1));
    const roundIndex = Math.max(1, Number(ctx?.index || startBase) || startBase);
    const roundOffset = Math.max(0, roundIndex - startBase);
    if(batchSize >= allRefs.length && roundOffset === 0) return allRefs.slice(0, batchSize);
    const result = [];
    const base = (startBase - 1 + roundOffset * batchSize) % allRefs.length;
    for(let i = 0; i < batchSize; i++) result.push(allRefs[(base + i) % allRefs.length]);
    return result;
}
function loopTokenLabel(token){
    if(token === '《计数》') return tr('canvas.counterToken');
    if(token === '《总数》') return tr('canvas.totalToken');
    if(token === '《进度》') return tr('canvas.progressToken');
    return token;
}
function autoSizeLoopNode(node, opening){
    if(!node) return;
    if(opening){
        node.w = Math.max(Number(node.w || 0), 336);
        node.h = Math.max(Number(node.h || 0), 360);
    } else {
        node.w = Math.min(Number(node.w || 336), 336);
        delete node.h;
    }
}
function autoSizeLoopForPanels(node){
    if(!node) return;
    node.w = Math.max(Number(node.w || 0), 336);
    if(node.showPrompt && node.imageInput) node.h = 390;
    else if(node.showPrompt) node.h = 330;
    else if(node.imageInput) node.h = 320;
    else delete node.h;
}
function loopTokenChipHtml(token){
    return `<span class="loop-token-chip" contenteditable="false" data-token="${escapeAttr(token)}"><span>${escapeHtml(loopTokenLabel(token))}</span><button type="button" aria-label="${tr('common.delete')}" title="${tr('common.delete')}">×</button></span>`;
}
function loopVariableHtml(text){
    const token = '《计数》';
    return String(text || '').split(token).map((part, i) => `${i ? loopTokenChipHtml(token) : ''}${escapeHtml(part)}`).join('');
}
function loopEditorText(editor){
    const walk = node => {
        if(node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
        if(node.nodeType !== Node.ELEMENT_NODE) return '';
        if(node.classList?.contains('loop-token-chip')) return node.dataset.token || '';
        if(node.tagName === 'BR') return '\n';
        return [...node.childNodes].map(walk).join('');
    };
    return [...(editor?.childNodes || [])].map(walk).join('').replace(/\u00a0/g, ' ');
}
function insertLoopToken(editor, token){
    if(!editor) return;
    editor.focus();
    const chipWrap = document.createElement('span');
    chipWrap.innerHTML = loopTokenChipHtml(token);
    const chip = chipWrap.firstElementChild;
    const spacer = document.createTextNode(' ');
    const sel = window.getSelection();
    if(sel && sel.rangeCount && editor.contains(sel.anchorNode)){
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(spacer);
        range.insertNode(chip);
        range.setStartAfter(spacer);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
    } else {
        editor.appendChild(chip);
        editor.appendChild(spacer);
    }
}
function promptTextLength(text){
    return Array.from(String(text || '')).length;
}
function promptCounterHtml(text){
    const count = promptTextLength(text);
    const over = count > PROMPT_TEXT_MAX_LENGTH;
    return `<div class="prompt-counter ${over ? 'over' : ''}"><span>${count.toLocaleString()}</span><span>/ ${PROMPT_TEXT_MAX_LENGTH.toLocaleString()}</span></div>`;
}
function refreshPromptCounter(container, text){
    const counter = container?.querySelector('.prompt-counter');
    if(!counter) return;
    const count = promptTextLength(text);
    counter.classList.toggle('over', count > PROMPT_TEXT_MAX_LENGTH);
    counter.innerHTML = `<span>${count.toLocaleString()}</span><span>/ ${PROMPT_TEXT_MAX_LENGTH.toLocaleString()}</span>`;
}
function renderLoopBody(node){
    const wrap = document.createElement('div');
    wrap.className = 'loop-body';
    node.count = loopCount(node);
    node.loopStart = Math.max(1, Number(node.loopStart) || 1);
    node.imageBatchSize = Math.max(1, Math.min(100, Number(node.imageBatchSize) || 1));
    node.mode = node.mode === 'parallel' ? 'parallel' : 'serial';
    node.showPrompt = Boolean(node.showPrompt);
    node.imageInput = Boolean(node.imageInput);
    const imageInputCount = loopInputImageRefs(node, {index:node.loopStart}).length;
    const promptItemCount = node.showPrompt ? loopInputPromptItems(node).length : 0;
    const hasUpstreamPrompt = promptItemCount > 0;
    const loopTargetId = findLoopCascadeTarget(node.id);
    wrap.innerHTML = `
        <div class="loop-count-row">
            <div class="loop-run-row">
                <div class="loop-count-group">
                    <span class="loop-count-label">${tr('canvas.loopCount')}</span>
                    <input class="loop-count-input" type="number" min="1" max="100" step="1" value="${node.count}">
                </div>
                <div class="seg loop-mode" title="${node.mode === 'parallel' ? (langIsEn() ? `Run rounds simultaneously (max ${LOOP_PARALLEL_MAX})` : `多轮同时运行（最多 ${LOOP_PARALLEL_MAX} 路）`) : (langIsEn() ? 'Run rounds one by one' : '逐轮排队运行')}">
                    <button type="button" data-loop-mode="serial" class="${node.mode !== 'parallel' ? 'active' : ''}">${tr('canvas.loopSerial')}</button>
                    <button type="button" data-loop-mode="parallel" class="${node.mode === 'parallel' ? 'active' : ''}">${tr('canvas.loopParallel')}</button>
                </div>
            </div>
            <div class="loop-toggle-row">
                <button class="loop-toggle loop-image-toggle ${node.imageInput ? 'active' : ''}" type="button"><i data-lucide="image" class="w-3.5 h-3.5"></i>${tr('canvas.loopImageToggle')}</button>
                <button class="loop-toggle loop-prompt-toggle ${node.showPrompt ? 'active' : ''}" type="button"><i data-lucide="text-cursor-input" class="w-3.5 h-3.5"></i>${tr('canvas.loopPromptToggle')}</button>
            </div>
        </div>
        ${node.imageInput ? `<div class="loop-image-panel">
            <div class="loop-image-row">
                <span class="loop-count-label">${tr('canvas.loopImageStart')}</span>
                <input class="loop-count-input loop-image-start-input" type="number" min="1" max="9999" step="1" value="${node.loopStart}">
                <span class="loop-count-label">${tr('canvas.loopBatchSize')}</span>
                <input class="loop-count-input loop-batch-input" type="number" min="1" max="100" step="1" value="${node.imageBatchSize}">
            </div>
            <div class="loop-image-ref-list"></div>
            <div class="loop-image-hint">${imageInputCount ? loopImageOutputHint(node, {index:node.loopStart}) : tr('canvas.loopImageEmpty')}</div>
        </div>` : ''}
        ${node.showPrompt ? `<div class="loop-prompt-panel ${hasUpstreamPrompt ? 'has-upstream' : ''}">
            ${hasUpstreamPrompt ? '' : `<div class="loop-field">
                <div class="loop-variable-editor" contenteditable="true" data-placeholder="">${loopVariableHtml(node.variablePrompt || '')}</div>
            </div>`}
            ${hasUpstreamPrompt ? `<div class="loop-prompt-hint">${escapeHtml(loopPromptUpstreamHint(node, promptItemCount))}</div>` : ''}
            <div class="loop-start-row">
                <button class="loop-token-btn loop-counter-token-btn" type="button" data-token="《计数》">${tr('canvas.counterToken')}</button>
                <span class="loop-count-label">${tr('canvas.loopStart')}</span>
                <input class="loop-count-input loop-start-input" type="number" min="1" max="9999" step="1" value="${node.loopStart}">
            </div>
        </div>` : ''}
    `;
    const countInput = wrap.querySelector('.loop-count-input');
    const variable = wrap.querySelector('.loop-variable-editor');
    const toggle = wrap.querySelector('.loop-prompt-toggle');
    const imageToggle = wrap.querySelector('.loop-image-toggle');
    if(variable) {
        variable.onmousedown = e => e.stopPropagation();
        variable.onclick = e => e.stopPropagation();
        variable.onwheel = e => e.stopPropagation();
    }
    const refreshPreview = () => {
        const preview = wrap.querySelector('.loop-preview:last-child');
        if(preview) preview.textContent = renderLoopPrompt(node, {index:1, total:loopCount(node)}) || tr('canvas.noPromptMeta');
    };
    const refreshImageHint = () => {
        renderLoopImageRefList(wrap.querySelector('.loop-image-ref-list'), node);
        const hint = wrap.querySelector('.loop-image-hint');
        if(!hint) return;
        hint.textContent = loopImageOutputHint(node, {index:node.loopStart});
    };
    if(node.imageInput) {
        syncLoopImageBatchSize(node);
        refreshImageHint();
    }
    countInput.oninput = e => {
        node.count = loopCount({count:e.target.value});
        e.target.value = node.count;
        refreshPreview();
        /* 同步下游生成节点上的轮数文字，避免修改次数后按钮残留旧值 */
        if(loopTargetId){
            const targetEl = domQuery(`.node[data-id="${loopTargetId}"]`);
            const targetCascadeBtn = targetEl?.querySelector('[data-cascade]');
            if(targetCascadeBtn){
                const span = targetCascadeBtn.querySelector('span');
                if(span) span.textContent = loopCascadeButtonLabel(node.count);
            }
        }
        scheduleSave();
    };
    const startInput = wrap.querySelector('.loop-start-input');
    if(startInput){
        startInput.onmousedown = e => e.stopPropagation();
        startInput.onclick = e => e.stopPropagation();
        startInput.oninput = e => {
            node.loopStart = Math.max(1, Number(e.target.value) || 1);
            refreshImageHint();
            scheduleSave();
            syncGeneratorInputs();
            refreshGeneratorInputViews();
        };
    }
    const imageStartInput = wrap.querySelector('.loop-image-start-input');
    if(imageStartInput){
        imageStartInput.onmousedown = e => e.stopPropagation();
        imageStartInput.onclick = e => e.stopPropagation();
        imageStartInput.oninput = e => {
            node.loopStart = Math.max(1, Number(e.target.value) || 1);
            refreshImageHint();
            scheduleSave();
            syncGeneratorInputs();
            refreshGeneratorInputViews();
        };
    }
    const batchInput = wrap.querySelector('.loop-batch-input');
    if(batchInput){
        batchInput.onmousedown = e => e.stopPropagation();
        batchInput.onclick = e => e.stopPropagation();
        batchInput.oninput = e => {
            node.imageBatchSize = Math.max(1, Math.min(100, Number(e.target.value) || 1));
            node._loopBatchManual = true;
            e.target.value = node.imageBatchSize;
            refreshImageHint();
            scheduleSave();
            syncGeneratorInputs();
            refreshGeneratorInputViews();
        };
    }
    wrap.querySelectorAll('[data-loop-mode]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            node.mode = btn.dataset.loopMode === 'parallel' ? 'parallel' : 'serial';
            render();
            scheduleSave();
        };
    });
    toggle.onclick = e => {
        e.stopPropagation();
        const opening = !node.showPrompt;
        node.showPrompt = opening;
        autoSizeLoopNode(node, opening);
        autoSizeLoopForPanels(node);
        if(!opening){
            connections = connections.filter(c => c.to !== node.id || canConnect(c.from, node.id));
        }
        render();
        scheduleSave();
        syncGeneratorInputs();
        refreshGeneratorInputViews();
    };
    if(variable) {
        variable.oninput = e => {
            node.variablePrompt = loopEditorText(variable);
            refreshPreview();
            scheduleSave();
            syncGeneratorInputs();
            refreshGeneratorInputViews();
        };
        variable.addEventListener('click', e => {
            const btn = e.target.closest('.loop-token-chip button');
            if(!btn) return;
            e.preventDefault();
            e.stopPropagation();
            btn.closest('.loop-token-chip')?.remove();
            node.variablePrompt = loopEditorText(variable);
            refreshPreview();
            scheduleSave();
            syncGeneratorInputs();
            refreshGeneratorInputViews();
        });
    }
    wrap.querySelectorAll('[data-token]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const token = btn.dataset.token || '';
            if(!variable) return;
            insertLoopToken(variable, token);
            node.variablePrompt = loopEditorText(variable);
            variable.focus();
            refreshPreview();
            scheduleSave();
            syncGeneratorInputs();
            refreshGeneratorInputViews();
        };
    });
    if(imageToggle){
        imageToggle.onclick = e => {
            e.stopPropagation();
            node.imageInput = !node.imageInput;
            if(node.imageInput){
                node.loopStart = Math.max(1, Number(node.loopStart) || 1);
                node.imageBatchSize = Math.max(1, Math.min(100, Number(node.imageBatchSize) || 1));
            } else {
                connections = connections.filter(c => c.to !== node.id || canConnect(c.from, node.id));
            }
            autoSizeLoopForPanels(node);
            render();
            scheduleSave();
            syncGeneratorInputs();
            refreshGeneratorInputViews();
        };
    }
    return wrap;
}
function renderLLMBody(node){
    const wrap = document.createElement('div');
    wrap.className = 'llm-body';
    const mode = node.mode || 'node';
    node.llmProvider = resolveChatProviderId(node.llmProvider || 'comfly');
    const llmProv = node.llmProvider;
    if(llmProv === 'modelscope') node.model = node.llmMsModel || node.model;
    if(!providerChatModels(llmProv).includes(node.model)) node.model = providerChatModels(llmProv)[0] || node.model;
    const modelOpts = chatModelOptions(node.model, llmProv);
    const imgs = llmInputImages(node);
    const vids = llmInputVideos(node);
    const mediaBadge = vids.length
        ? `<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:8px;background:rgba(59,130,246,.12);color:#1d4ed8;font-size:10.5px;font-weight:700;width:fit-content;line-height:1.4"><i data-lucide="video" class="w-3 h-3"></i>已连接 ${vids.length} 个视频 · 请选 Gemini 模型</div>`
        : imgs.length
            ? `<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:8px;background:rgba(16,185,129,.12);color:#047857;font-size:10.5px;font-weight:700;width:fit-content;line-height:1.4"><i data-lucide="image" class="w-3 h-3"></i>已连接 ${imgs.length} 张图片 · 需选 VL 视觉模型（如 Qwen2.5-VL）</div>`
            : '';
    node.showSystem = Boolean(node.showSystem);
    wrap.innerHTML = `
        <div class="llm-row">
            <select class="select-lite llm-provider-select" style="flex:1">${chatProviderOptions(llmProv)}</select>
            <select class="select-lite llm-model">${modelOpts}</select>
            <div class="llm-mode"><button data-mode="node">${tr('canvas.nodeMode')}</button><button data-mode="chat">${tr('canvas.chatMode')}</button></div>
            <button class="llm-sys-toggle ${node.showSystem ? 'active' : ''}" type="button">System</button>
        </div>
        ${mediaBadge}
        ${node.showSystem ? `<textarea class="llm-system" placeholder="${tr('canvas.systemPrompt')}">${escapeHtml(node.systemPrompt || '')}</textarea>` : ''}
        <div class="llm-node-pane"></div>
        <div class="llm-chat-pane"></div>
    `;
    const providerSelect = wrap.querySelector('.llm-provider-select');
    const modelSelect = wrap.querySelector('.llm-model');
    providerSelect.value = llmProv;
    modelSelect.value = resolveChatModel(node.model, llmProv);
    [providerSelect, modelSelect].forEach(input => {
        input.onmousedown = e => e.stopPropagation();
        input.onclick = e => e.stopPropagation();
    });
    providerSelect.onchange = e => {
        e.stopPropagation();
        node.llmProvider = e.target.value;
        const models = providerChatModels(node.llmProvider);
        node.model = models[0] || '';
        if(node.llmProvider === 'modelscope') node.llmMsModel = node.model;
        render();
        scheduleSave();
    };
    modelSelect.onchange = e => {
        e.stopPropagation();
        node.model = e.target.value;
        if((node.llmProvider||'comfly') === 'modelscope') node.llmMsModel = e.target.value;
        scheduleSave();
    };
    wrap.querySelector('.llm-sys-toggle').onclick = e => { e.stopPropagation(); node.showSystem = !node.showSystem; render(); scheduleSave(); };
    const sysEl = wrap.querySelector('.llm-system');
    if(sysEl){ sysEl.oninput = e => { node.systemPrompt = e.target.value; scheduleSave(); }; bindScrollableText(sysEl); }
    wrap.querySelectorAll('[data-mode]').forEach(btn => {
        btn.classList.toggle('active', mode === btn.dataset.mode);
        btn.onclick = e => { e.stopPropagation(); node.mode = btn.dataset.mode; render(); scheduleSave(); };
    });
    const nodePane = wrap.querySelector('.llm-node-pane');
    const chatPane = wrap.querySelector('.llm-chat-pane');
    if(mode === 'chat'){
        nodePane.style.display = 'none';
        renderLLMChatPane(chatPane, node);
    } else {
        chatPane.style.display = 'none';
        renderLLMNodePane(nodePane, node);
    }
    return wrap;
}
function renderLLMNodePane(container, node){
    const connectedInput = llmInputText(node);
    const isReadonly = connectedInput.length > 0;
    const inputValue = connectedInput || node.userInput || '';
    const inputHeight = Math.max(70, node.llmInputHeight || 110);
    const outputHeight = Math.max(70, node.llmOutputHeight || 150);
    const inputPlaceholder = langIsEn() ? 'Type input, or connect a Prompt node…' : '直接输入，或连接提示词节点…';
    container.innerHTML = `
        <div class="llm-pane-label">Input${isReadonly ? ' <span style="font-size:9px;opacity:.5;font-weight:600;text-transform:none;letter-spacing:0">(来自连接)</span>' : ''}</div>
        <textarea class="llm-input-area llm-input-output" style="height:${inputHeight}px; flex:0 0 ${inputHeight}px;" ${isReadonly ? 'readonly' : ''} placeholder="${inputPlaceholder}">${escapeHtml(inputValue)}</textarea>
        <div class="llm-pane-resizer" title="${tr('canvas.resizePanes')}"></div>
        <div class="llm-pane-label">Output</div>
        <div class="llm-output-wrap" style="height:${outputHeight}px; flex:0 0 ${outputHeight}px;">
            <button class="llm-copy-btn llm-output-copy" type="button" title="复制"><i data-lucide="copy" class="w-3.5 h-3.5"></i></button>
            <div class="llm-output llm-result-output">${escapeHtml(node.outputText || tr('canvas.llmOutputEmpty'))}</div>
        </div>
        <div class="gen-run-row mt-2">
            <button class="llm-run ${node.running ? 'running' : ''}" ${node.running ? 'disabled' : ''}><i data-lucide="play" class="w-4 h-4"></i>${node.running ? tr('canvas.running') : 'Run LLM'}</button>
            ${cascadeBtnHtml(node)}
        </div>
        ${retryBarHtml(node)}
    `;
    const inputEl = container.querySelector('.llm-input-output');
    bindScrollableText(inputEl);
    if(!isReadonly){
        inputEl.oninput = e => { node.userInput = e.target.value; };
    }
    bindScrollableText(container.querySelector('.llm-result-output'));
    container.querySelector('.llm-pane-resizer').onmousedown = e => startLLMPaneResize(e, node);
    container.querySelector('.llm-run').onclick = e => { e.stopPropagation(); runLLMNode(node.id); };
    bindCascadeButtons(container, node.id);
    const copyBtn = container.querySelector('.llm-output-copy');
    if(copyBtn){
        copyBtn.onmousedown = e => e.stopPropagation();
        copyBtn.onclick = async e => {
            e.stopPropagation();
            const text = node.outputText || '';
            if(!text) return;
            if(await copyTextToClipboard(text)){
                copyBtn.classList.add('copied');
                setTimeout(() => copyBtn.classList.remove('copied'), 1500);
            }
        };
    }
}
function renderLLMChatPane(container, node){
    const messages = node.messages || [];
    container.innerHTML = `
        <div class="llm-chat-log">${messages.length ? messages.map((msg, mi) => `<div class="llm-bubble ${msg.role === 'user' ? 'user' : 'assistant'}" data-msg-idx="${mi}">${escapeHtml(msg.content || '')}${msg.role === 'assistant' ? `<button class="llm-bubble-copy" type="button" title="复制"><i data-lucide="copy" style="width:11px;height:11px;display:inline-block;vertical-align:middle"></i></button>` : ''}</div>`).join('') : `<div class="text-[11px] text-gray-300">${tr('canvas.startChat')}</div>`}</div>
        <textarea class="llm-chat-input mt-2" rows="2" placeholder="${tr('canvas.chatInput')}">${escapeHtml(node.chatInput || '')}</textarea>
        <button class="llm-run mt-2" ${node.running ? 'disabled' : ''}><i data-lucide="send" class="w-4 h-4"></i>${node.running ? tr('canvas.sending') : 'Send'}</button>
    `;
    bindScrollableText(container.querySelector('.llm-chat-log'));
    bindScrollableText(container.querySelector('.llm-chat-input'));
    const chatInputEl = container.querySelector('.llm-chat-input');
    chatInputEl.oninput = e => { node.chatInput = e.target.value; scheduleSave(); };
    chatInputEl.onkeydown = e => {
        if(e.key === 'Enter' && !e.shiftKey && !e.isComposing){
            e.preventDefault();
            e.stopPropagation();
            runLLMChat(node.id);
        }
    };
    container.querySelector('.llm-run').onclick = e => { e.stopPropagation(); runLLMChat(node.id); };
    container.querySelectorAll('.llm-bubble-copy').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = async e => {
            e.stopPropagation();
            const bubble = btn.closest('.llm-bubble');
            const idx = Number(bubble?.dataset.msgIdx);
            const msg = (node.messages || [])[idx];
            if(!msg) return;
            if(await copyTextToClipboard(msg.content || '')){
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 1500);
            }
        };
    });
}
function bindScrollableText(el){
    if(!el) return;
    const stop = e => e.stopPropagation();
    const beginSelection = e => {
        e.stopPropagation();
        textSelectionGuard = {
            el,
            scrollTop:el.scrollTop || 0,
            scrollLeft:el.scrollLeft || 0,
            clientY:e.clientY,
            wheelUntil:0,
            active:true
        };
    };
    el.addEventListener('mousedown', beginSelection);
    el.addEventListener('mousemove', e => {
        e.stopPropagation();
        if(textSelectionGuard?.el === el) textSelectionGuard.clientY = e.clientY;
    });
    el.addEventListener('mouseup', e => {
        e.stopPropagation();
        if(textSelectionGuard?.el === el) textSelectionGuard.active = false;
    });
    el.addEventListener('mouseleave', e => {
        e.stopPropagation();
        if(textSelectionGuard?.el === el) {
            el.scrollTop = textSelectionGuard.scrollTop;
            el.scrollLeft = textSelectionGuard.scrollLeft;
        }
    });
    el.addEventListener('scroll', () => {
        const guard = textSelectionGuard;
        if(!guard || guard.el !== el || !guard.active || Date.now() < guard.wheelUntil) {
            if(guard?.el === el) {
                guard.scrollTop = el.scrollTop || 0;
                guard.scrollLeft = el.scrollLeft || 0;
            }
            return;
        }
        const nextTop = el.scrollTop || 0;
        const prevTop = guard.scrollTop || 0;
        const rect = el.getBoundingClientRect();
        const pointerBelow = Number.isFinite(guard.clientY) && guard.clientY > rect.bottom - 10;
        const pointerAbove = Number.isFinite(guard.clientY) && guard.clientY < rect.top + 10;
        const jumpedToTop = prevTop > Math.max(80, el.clientHeight * 0.45) && nextTop < 4 && !pointerAbove;
        const wrongDirectionJump = pointerBelow && nextTop < prevTop - Math.max(40, el.clientHeight * 0.25);
        if(jumpedToTop || wrongDirectionJump) {
            requestAnimationFrame(() => {
                if(textSelectionGuard?.el === el && textSelectionGuard.active) {
                    el.scrollTop = prevTop;
                    el.scrollLeft = guard.scrollLeft || 0;
                }
            });
            return;
        }
        guard.scrollTop = nextTop;
        guard.scrollLeft = el.scrollLeft || 0;
    }, {passive:true});
    el.addEventListener('click', stop);
    el.addEventListener('dblclick', stop);
    el.addEventListener('wheel', e => {
        e.stopPropagation();
        if(textSelectionGuard?.el === el) textSelectionGuard.wheelUntil = Date.now() + 180;
    }, {passive:true});
}
function startLLMPaneResize(e, node){
    e.preventDefault();
    e.stopPropagation();
    llmPaneDrag = {
        node,
        sy:e.clientY,
        inputStart:Math.max(70, node.llmInputHeight || 110),
        outputStart:Math.max(70, node.llmOutputHeight || 150)
    };
    window.onmousemove = onLLMPaneResize;
    window.onmouseup = endDrag;
}
function onLLMPaneResize(e){
    if(!llmPaneDrag) return;
    const total = llmPaneDrag.inputStart + llmPaneDrag.outputStart;
    const delta = (e.clientY - llmPaneDrag.sy) / viewport.scale;
    const minPane = 70;
    const nextInput = Math.max(minPane, Math.min(total - minPane, llmPaneDrag.inputStart + delta));
    const nextOutput = Math.max(minPane, total - nextInput);
    llmPaneDrag.node.llmInputHeight = Math.round(nextInput);
    llmPaneDrag.node.llmOutputHeight = Math.round(nextOutput);
    const el = nodesEl.querySelector(`.node[data-id="${llmPaneDrag.node.id}"]`);
    if(el){
        const inputEl = el.querySelector('.llm-input-output');
        const outputEl = el.querySelector('.llm-result-output');
        if(inputEl){
            inputEl.style.height = `${llmPaneDrag.node.llmInputHeight}px`;
            inputEl.style.flexBasis = `${llmPaneDrag.node.llmInputHeight}px`;
        }
        if(outputEl){
            outputEl.style.height = `${llmPaneDrag.node.llmOutputHeight}px`;
            outputEl.style.flexBasis = `${llmPaneDrag.node.llmOutputHeight}px`;
        }
    }
}
function llmInputText(node){
    return connections.filter(c => c.to === node.id).map(c => nodes.find(n => n.id === c.from)).filter(Boolean).map(n => {
        if(n.type === 'prompt') return isNodeEnabled(n) ? (n.text || '') : '';
        if(n.type === 'loop') return renderLoopPrompt(n);
        if(n.type === 'promptGroup') return promptGroupChildTexts(n).join('\n\n');
        if(n.type === 'llm') return n.outputText || '';
        return '';
    }).filter(Boolean).join('\n\n');
}
function llmInputImages(node){
    const urls = [];
    connections.filter(c => c.to === node.id).map(c => nodes.find(n => n.id === c.from)).filter(Boolean).forEach(n => {
        if(isImageStackNode(n)){
            (n.images || []).forEach(item => {
                const url = outputUrlValue(item);
                if(url && !isVideoUrl(url) && !isAudioUrl(url)) urls.push(url);
            });
        }
        if(n.type === 'image' && n.url && mediaKindForNode(n) === 'image') urls.push(n.url);
        if(n.type === 'output' && (n.images||[]).length){
            const last = [...n.images].reverse().map(outputUrlValue).find(url => url && !isVideoUrl(url) && !isAudioUrl(url));
            if(last) urls.push(last);
        }
        if(n.type === 'group' || n.type === 'imageBatch'){
            const items = (n.items || []).map(id => nodes.find(x => x.id === id)).filter(x => x?.type === 'image' && x?.url && mediaKindForNode(x) === 'image');
            items.forEach(img => urls.push(img.url));
        }
    });
    return urls;
}
function llmInputVideos(node){
    const urls = [];
    connections.filter(c => c.to === node.id).map(c => nodes.find(n => n.id === c.from)).filter(Boolean).forEach(n => {
        if(n.type === 'image' && n.url && mediaKindForNode(n) === 'video') urls.push(n.url);
    });
    return urls;
}
function videoReverseInputText(node){
    return llmInputText(node);
}
function videoReverseConnectedPromptNodes(node){
    if(!node || node.type !== 'videoReverse') return [];
    return connections
        .filter(c => c.to === node.id)
        .map(c => nodes.find(n => n.id === c.from))
        .filter(n => n?.type === 'prompt');
}
function videoReverseInputVideos(node){
    return llmInputVideos(node);
}
const SLOTS_LOOP_VIDEO_DURATION_MIN = 3;
const SLOTS_LOOP_VIDEO_DURATION_MAX = 15;
const SLOTS_LOOP_VIDEO_DURATION_DEFAULT = 5;
function normalizeSlotsLoopVideoDuration(value){
    const n = Math.round(Number(value));
    if(!Number.isFinite(n)) return SLOTS_LOOP_VIDEO_DURATION_DEFAULT;
    return Math.max(SLOTS_LOOP_VIDEO_DURATION_MIN, Math.min(SLOTS_LOOP_VIDEO_DURATION_MAX, n));
}
function slotsLoopVideoAgentImageRef(node, ctx=loopContext){
    const sources = orderedSources(node, generatorSources(node, ctx));
    const refs = imageRefsOnly(sources.flatMap(s => s.refs || []));
    return refs[0] || null;
}
function slotsLoopVideoAgentCreativeIdea(node){
    const sources = orderedSources(node, generatorSources(node));
    const promptSrc = sources.find(s => s.prompt && !s.refs?.length);
    const upstream = String(promptSrc?.prompt || '').trim();
    const inline = String(node.creative_idea || '').trim();
    if(upstream && inline) return `${upstream}\n${inline}`.trim();
    return upstream || inline;
}
async function resolveSlotsLoopVideoImageUrlForApi(rawUrl){
    const url = String(rawUrl || '').trim();
    if(!url) return '';
    if(url.startsWith('data:')) return url;
    if(url.startsWith('blob:')) return await urlToBase64(url);
    if(url.startsWith('/') && !url.startsWith('//')){
        if(url.startsWith('/uploads/')) return url;
        try { return await urlToBase64(url); } catch { return url; }
    }
    return url;
}
function formatSlotsLoopVideoOutputText(data){
    if(!data) return '';
    if(typeof data.display_text === 'string' && data.display_text.trim()) return data.display_text.trim();
    const segments = Array.isArray(data.segments) ? data.segments : [];
    const lines = segments.map(seg => {
        const from = Number(seg?.from || 0);
        const to = Number(seg?.to || 0);
        const prompt = String(seg?.prompt || '').trim();
        const pad = n => String(n).padStart(2, '0');
        return `（${pad(from)} - ${to} 秒）：\n${prompt}`;
    }).filter(Boolean);
    const full = String(data.full_prompt || '').trim();
    if(!full) return lines.join('\n\n');
    return `${lines.join('\n\n')}\n\n---\n【合并版 · 可直接用于 Seedance】\n${full}`;
}
function refreshDownstreamSlotsLoopVideoNodes(fromNodeId){
    const targetIds = connections
        .filter(c => c.from === fromNodeId)
        .map(c => c.to)
        .filter(id => nodes.find(n => n.id === id)?.type === 'slotsLoopVideoAgent');
    if(targetIds.length) refreshNodes(targetIds);
}
function renderSlotsLoopVideoAgentBody(node){
    node.model = clampAgentTextModel(node.model);
    node.duration = normalizeSlotsLoopVideoDuration(node.duration);
    const imageRef = slotsLoopVideoAgentImageRef(node);
    const creative = slotsLoopVideoAgentCreativeIdea(node);
    const outputText = String(node.outputText || '').trim();
    const outputPlaceholder = langIsEn()
        ? 'Run to generate Seedance loop video prompts…'
        : '运行后将在此显示 Seedance 循环视频提示词…';
    const themeLabel = node.outputData?.theme_label ? String(node.outputData.theme_label) : '';
    const wrap = document.createElement('div');
    wrap.className = 'generator-body slots-loop-video-body';
    wrap.innerHTML = `
        <div class="slots-loop-video-section">
            <div class="slots-loop-video-section-title">${langIsEn() ? 'Image input' : '图片输入'}</div>
            <div class="input-list slots-loop-input-list"></div>
        </div>
        <div class="slots-loop-video-badge-row">
            ${imageRef?.url
                ? `<div class="slots-loop-video-badge ok"><i data-lucide="image" class="w-3.5 h-3.5"></i><span>${langIsEn() ? 'Slots image connected' : '已连接 Slots 静态图'}</span></div>`
                : `<div class="slots-loop-video-badge warn"><i data-lucide="image-off" class="w-3.5 h-3.5"></i><span>${langIsEn() ? 'Connect an Image node' : '请连接 Image 图片节点'}</span></div>`}
            ${creative
                ? `<div class="slots-loop-video-badge ok"><i data-lucide="lightbulb" class="w-3.5 h-3.5"></i><span>${langIsEn() ? 'Creative idea set' : '已设置创意想法'}</span></div>`
                : `<div class="slots-loop-video-badge warn"><i data-lucide="lightbulb" class="w-3.5 h-3.5"></i><span>${langIsEn() ? 'Optional: add creative idea below or connect Prompt' : '可选：下方填写创意或连接提示词节点'}</span></div>`}
        </div>
        <label class="field">
            <div class="setting-title">${langIsEn() ? 'Duration (seconds)' : '视频时长（秒）'}</div>
            <input class="setting-input slots-loop-duration" type="number" min="${SLOTS_LOOP_VIDEO_DURATION_MIN}" max="${SLOTS_LOOP_VIDEO_DURATION_MAX}" step="1" value="${normalizeSlotsLoopVideoDuration(node.duration)}">
            <span class="batch-poster-field-hint">${langIsEn() ? `Custom ${SLOTS_LOOP_VIDEO_DURATION_MIN}–${SLOTS_LOOP_VIDEO_DURATION_MAX}s` : `可自定义 ${SLOTS_LOOP_VIDEO_DURATION_MIN}–${SLOTS_LOOP_VIDEO_DURATION_MAX} 秒`}</span>
        </label>
        <label class="field">
            <div class="setting-title">${langIsEn() ? 'Text model' : '文本模型'}</div>
            <select class="select-lite slots-loop-text-model">${agentTextModelOptions(resolveBatchPosterChatModel(node))}</select>
        </label>
        <label class="field">
            <div class="setting-title">${langIsEn() ? 'Creative idea (optional)' : '创意想法（可选）'}</div>
            <textarea class="slots-loop-creative-idea" placeholder="${langIsEn() ? 'e.g. buffalo stomps, fireball drops…' : '如：野牛跺脚、火球砸下…'}">${escapeHtml(node.creative_idea || '')}</textarea>
        </label>
        <div class="llm-pane-label">${langIsEn() ? 'Video prompts' : '视频提示词'}${themeLabel ? ` · ${escapeHtml(themeLabel)}` : ''}</div>
        <div class="slots-loop-video-output ${outputText ? '' : 'is-empty'}">${escapeHtml(outputText || outputPlaceholder)}</div>
        <div class="slots-loop-copy-row" style="display:${outputText ? 'flex' : 'none'}">
            <button type="button" class="gen-btn slots-loop-copy-btn"><i data-lucide="copy" class="w-4 h-4"></i><span>${langIsEn() ? 'Copy all' : '复制全部'}</span></button>
            <button type="button" class="gen-btn slots-loop-copy-full-btn"><i data-lucide="clipboard-copy" class="w-4 h-4"></i><span>${langIsEn() ? 'Copy merged' : '复制合并版'}</span></button>
        </div>
        ${node.runError ? `<div class="replica-run-error">${escapeHtml(node.runError)}</div>` : ''}
        <div class="gen-run-row">
            <button class="gen-btn slots-loop-run-btn ${node.running ? 'running' : ''}"><i data-lucide="repeat-2" class="w-4 h-4"></i><span>${node.running ? (langIsEn() ? 'Generating…' : '生成中…') : (langIsEn() ? 'Generate prompts' : '生成提示词')}</span></button>
        </div>
    `;
    const durationInput = wrap.querySelector('.slots-loop-duration');
    durationInput.onmousedown = e => e.stopPropagation();
    durationInput.onclick = e => e.stopPropagation();
    durationInput.oninput = e => {
        e.stopPropagation();
        node.duration = normalizeSlotsLoopVideoDuration(e.target.value);
        scheduleSave();
    };
    durationInput.onblur = e => {
        e.target.value = String(normalizeSlotsLoopVideoDuration(node.duration));
    };
    const modelSelect = wrap.querySelector('.slots-loop-text-model');
    modelSelect.onmousedown = e => e.stopPropagation();
    modelSelect.onclick = e => e.stopPropagation();
    modelSelect.onchange = e => {
        e.stopPropagation();
        node.model = clampAgentTextModel(e.target.value);
        scheduleSave();
    };
    const creativeEl = wrap.querySelector('.slots-loop-creative-idea');
    bindScrollableText(creativeEl);
    creativeEl.oninput = e => {
        node.creative_idea = String(e.target.value || '').slice(0, 500);
        scheduleSave();
    };
    bindScrollableText(wrap.querySelector('.slots-loop-video-output'));
    const copyAllBtn = wrap.querySelector('.slots-loop-copy-btn');
    if(copyAllBtn){
        copyAllBtn.onclick = async e => {
            e.stopPropagation();
            const ok = await copyTextToClipboard(node.outputText || '');
            setStatus(ok ? (langIsEn() ? 'Copied video prompts' : '已复制视频提示词') : (langIsEn() ? 'Copy failed' : '复制失败'));
        };
    }
    const copyFullBtn = wrap.querySelector('.slots-loop-copy-full-btn');
    if(copyFullBtn){
        copyFullBtn.onclick = async e => {
            e.stopPropagation();
            const full = String(node.outputData?.full_prompt || '').trim();
            const ok = await copyTextToClipboard(full || node.outputText || '');
            setStatus(ok ? (langIsEn() ? 'Copied merged prompt' : '已复制合并版提示词') : (langIsEn() ? 'Copy failed' : '复制失败'));
        };
    }
    wrap.querySelector('.slots-loop-run-btn').onclick = e => {
        e.stopPropagation();
        void runSlotsLoopVideoAgent(node.id);
    };
    const sources = orderedSources(node, generatorSources(node));
    const imageInputs = sources
        .map(src => ({...src, refs:imageRefsOnly(src.refs || [])}))
        .filter(src => src.refs?.length);
    renderImageInputList(wrap.querySelector('.slots-loop-input-list'), node, imageInputs, langIsEn() ? 'Connect Slots static image' : '请连接 Slots 静态图');
    return wrap;
}
async function runSlotsLoopVideoAgent(nodeId, opts={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'slotsLoopVideoAgent' || isNodeDisabled(node)) return;
    const imageRef = slotsLoopVideoAgentImageRef(node);
    if(!imageRef?.url){
        const msg = langIsEn() ? 'Connect a Slots static image to the Image input.' : '请通过 Image 端口连接一张 Slots 静态图。';
        node.runStatus = 'failed';
        node.runError = msg;
        refreshNodes([nodeId]);
        return;
    }
    if(!opts.cascade){
        node.runStatus = 'running';
        node.runError = '';
        node.running = true;
        refreshNodes([nodeId]);
    }
    setStatus(langIsEn() ? 'Slots Loop Video Agent: generating prompts…' : 'Slots 循环视频 Agent：正在生成提示词…');
    const execute = async () => {
    try {
        let visionUrl = '';
        try {
            visionUrl = await resolveSlotsLoopVideoImageUrlForApi(imageRef.url);
        } catch(err) {
            throw new Error(langIsEn()
                ? `Cannot read Slots image: ${err?.message || err}`
                : `无法读取 Slots 静态图：${err?.message || err}`);
        }
        const res = await apiFetch('/api/canvas/slots-loop-video-prompt', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                imageUrl:visionUrl,
                durationSec:normalizeSlotsLoopVideoDuration(node.duration),
                creativeIdea:slotsLoopVideoAgentCreativeIdea(node),
                model:clampAgentTextModel(node.model),
            }),
        });
        if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Prompt generation failed' : '视频提示词生成失败'));
        const data = await res.json();
        node.outputData = data;
        node.outputText = formatSlotsLoopVideoOutputText(data);
        if(!opts.cascade) node.running = false;
        node.runStatus = 'done';
        node.runError = '';
        refreshNodes([nodeId]);
        setStatus(langIsEn() ? 'Slots loop video prompts ready' : 'Slots 循环视频提示词已生成');
        scheduleSave();
    } catch(err) {
        if(!opts.cascade) node.running = false;
        node.runStatus = 'failed';
        node.runError = err.message || String(err);
        refreshNodes([nodeId]);
        if(opts.cascade) throw err;
        scheduleSave();
    }
    };
    if(opts.cascade) await execute();
    else void execute();
}
function runSlotsLoopVideoFromButton(nodeId, event){
    event?.preventDefault?.();
    event?.stopPropagation?.();
    void runSlotsLoopVideoAgent(nodeId);
}
window.runSlotsLoopVideoFromButton = runSlotsLoopVideoFromButton;
function replicaAgentUpstreamImages(node, ctx=loopContext){
    if(!node || node.type !== 'replicaAgent') return [];
    return orderedSources(node, generatorSources(node, ctx))
        .filter(s => s.refs?.length)
        .flatMap(s => s.refs.map((ref, i) => {
            const url = ref.url || '';
            const kind = ref.kind || 'image';
            if(!url || kind !== 'image') return null;
            return {
                id:s.refs.length > 1 ? `${s.id}:ref:${i}:${url}` : s.id,
                type:'image',
                url,
                name:ref.name || outputImageName(url),
                mediaKind:'image',
                role:ref.role || '',
            };
        }))
        .filter(Boolean);
}
function isReplicaBackgroundSourceId(sourceId){
    const id = String(sourceId || '');
    return id.includes(':image:') || id.includes(':img:') || id.includes(':generated:') || id.includes(':batch-image') || id.includes(':group-');
}
function isReplicaDirectImageSource(img){
    const n = nodes.find(x => x.id === img?.id);
    return isNodeEnabled(n) && n?.type === 'image' && Boolean(img?.url);
}
function normalizeReplicaCharacterRefUrls(node){
    if(!Array.isArray(node?.replica_character_ref_urls)) return [];
    return [...new Set(node.replica_character_ref_urls.map(u => String(u || '').trim()).filter(Boolean))];
}
function syncReplicaAgentRoles(node){
    if(!node || node.type !== 'replicaAgent') return;
    if(!node.roles || typeof node.roles !== 'object') node.roles = {};
    const images = replicaAgentUpstreamImages(node);
    const ids = new Set(images.map(img => img.id));
    Object.keys(node.roles).forEach(id => {
        if(!ids.has(id)) delete node.roles[id];
    });
    // 生成器/输出帧等：默认构图参考
    images.filter(img => isReplicaBackgroundSourceId(img.id)).forEach(img => {
        if(node.roles[img.id] !== 'character') node.roles[img.id] = 'background';
    });
    const directImages = images.filter(isReplicaDirectImageSource);
    const explicitBackground = directImages.find(img => node.roles[img.id] === 'background');
    if(directImages.length >= 2){
        const bg = explicitBackground || directImages[0];
        node.roles[bg.id] = 'background';
        directImages.forEach(img => {
            if(img.id === bg.id) return;
            if(node.roles[img.id] !== 'background') node.roles[img.id] = 'character';
        });
    } else if(directImages.length === 1){
        if(node.roles[directImages[0].id] !== 'character') node.roles[directImages[0].id] = 'background';
    }
    images.forEach(img => {
        if(!['background','character'].includes(node.roles[img.id])) node.roles[img.id] = 'background';
    });
    let backgrounds = images.filter(img => node.roles[img.id] === 'background');
    if(images.length > 1 && !backgrounds.length){
        const fallback = images.find(img => isReplicaBackgroundSourceId(img.id)) || directImages[0] || images[0];
        if(fallback) node.roles[fallback.id] = 'background';
        backgrounds = images.filter(img => node.roles[img.id] === 'background');
    }
    if(backgrounds.length > 1){
        const keep = backgrounds[0];
        backgrounds.slice(1).forEach(img => {
            if(img.id === keep.id) return;
            node.roles[img.id] = 'character';
        });
    }
    node.replica_character_ref_urls = images
        .filter(img => node.roles[img.id] === 'character')
        .map(img => String(img.url || '').trim())
        .filter(Boolean);
}
function updateReplicaAgentStatusBadges(nodeEl, node){
    if(!nodeEl || !node || node.type !== 'replicaAgent') return;
    syncReplicaAgentRoles(node);
    const {background, characters} = replicaAgentRoleImages(node);
    const bgOk = Boolean(background?.url);
    const charCount = characters.length;
    const charOk = charCount > 0;
    const badges = nodeEl.querySelectorAll('.replica-status-badge');
    if(badges[0]){
        badges[0].classList.toggle('ok', bgOk);
        badges[0].classList.toggle('warn', !bgOk);
        const span = badges[0].querySelector('span');
        if(span){
            span.textContent = bgOk
                ? (langIsEn() ? 'Background ready (图1)' : '已连接背景/构图参考（图1）')
                : (langIsEn() ? 'Connect background (图1)' : '请连接背景/构图参考（图1）');
        }
    }
    if(badges[1]){
        badges[1].classList.toggle('ok', charOk);
        badges[1].classList.toggle('neutral', !charOk);
        const span = badges[1].querySelector('span');
        if(span){
            span.textContent = charOk
                ? (langIsEn() ? `${charCount} character ref(s) ready` : `已连接 ${charCount} 张角色参考`)
                : (langIsEn() ? 'Character ref optional' : '角色参考可选');
        }
    }
}
function replicaAgentSizeSettingsHtml(node){
    return `<div class="replica-section replica-section-size">
        <div class="replica-section-title">${langIsEn() ? 'Output size' : '输出尺寸'}</div>
        <div class="gen-settings replica-size-settings">
            <div class="gen-settings-row api-size-row">
                <select class="select-lite resolution compact-select replica-resolution" data-field="resolution">
                    <option value="1k">1K</option>
                    <option value="2k">2K</option>
                    <option value="4k">4K</option>
                </select>
                <select class="select-lite ratio compact-select replica-ratio" data-field="ratio">
                    <option value="square">1:1</option>
                    <option value="portrait">2:3</option>
                    <option value="landscape">3:2</option>
                    <option value="portrait43">3:4</option>
                    <option value="landscape43">4:3</option>
                    <option value="story">9:16</option>
                    <option value="wide">16:9</option>
                    <option value="source">${tr('canvas.adaptiveRatio')}</option>
                    <option value="custom">${tr('canvas.custom')}</option>
                </select>
            </div>
            <div class="gen-settings-row custom-ratio-row replica-custom-ratio-row" style="display:none">
                <label class="field">
                    <div class="setting-title">${tr('canvas.ratioWidth')}</div>
                    <input class="setting-input replica-custom-ratio-w" type="number" min="1" step="1" value="${escapeHtml(node.customRatioWidth || '')}" placeholder="9">
                </label>
                <label class="field">
                    <div class="setting-title">${tr('canvas.ratioHeight')}</div>
                    <input class="setting-input replica-custom-ratio-h" type="number" min="1" step="1" value="${escapeHtml(node.customRatioHeight || '')}" placeholder="16">
                </label>
            </div>
        </div>
    </div>`;
}
function bindReplicaAgentSizeControls(wrap, node, backgroundUrl){
    if(!wrap || !node) return;
    const ratioSelect = wrap.querySelector('.replica-ratio');
    const resolutionSelect = wrap.querySelector('.replica-resolution');
    const customRatioRow = wrap.querySelector('.replica-custom-ratio-row');
    const customRatioWInput = wrap.querySelector('.replica-custom-ratio-w');
    const customRatioHInput = wrap.querySelector('.replica-custom-ratio-h');
    if(!ratioSelect || !resolutionSelect) return;
    const hydrateCustomParts = () => {
        if((!node.customRatioWidth || !node.customRatioHeight) && node.customRatio) {
            const raw = String(node.customRatio || '');
            if(raw.includes(':')){
                const [w, h] = raw.split(':');
                node.customRatioWidth = node.customRatioWidth || w;
                node.customRatioHeight = node.customRatioHeight || h;
            }
        }
    };
    hydrateCustomParts();
    let sourceRatioRequest = 0;
    const updateSourceRatioFromBackground = async () => {
        if(node.ratio !== 'source') return;
        const requestId = ++sourceRatioRequest;
        const url = String(backgroundUrl || '').trim();
        if(!url){
            node.customRatio = '';
            node.customRatioWidth = '';
            node.customRatioHeight = '';
            if(customRatioWInput) customRatioWInput.value = '';
            if(customRatioHInput) customRatioHInput.value = '';
            return;
        }
        try {
            const dims = await getImageDimensions(url);
            if(requestId !== sourceRatioRequest || node.ratio !== 'source') return;
            const parts = ratioPartsFromDimensions(dims.width, dims.height);
            node.customRatioWidth = String(parts.width);
            node.customRatioHeight = String(parts.height);
            node.customRatio = `${parts.width}:${parts.height}`;
            if(customRatioWInput) customRatioWInput.value = node.customRatioWidth;
            if(customRatioHInput) customRatioHInput.value = node.customRatioHeight;
            scheduleSave();
            syncBatchPosterSelectedAspectRatio(node);
        } catch(_) {}
    };
    const syncSizeControls = () => {
        const ratioValue = node.ratio && [...ratioSelect.options].some(opt => opt.value === node.ratio) ? node.ratio : 'source';
        ratioSelect.value = ratioValue;
        node.ratio = ratioValue;
        resolutionSelect.value = node.resolution || '2k';
        if(customRatioRow){
            customRatioRow.style.display = (node.ratio === 'custom' || node.ratio === 'source') ? 'flex' : 'none';
        }
        if(customRatioWInput){
            customRatioWInput.disabled = node.ratio === 'source';
            customRatioWInput.value = node.customRatioWidth || '';
        }
        if(customRatioHInput){
            customRatioHInput.disabled = node.ratio === 'source';
            customRatioHInput.value = node.customRatioHeight || '';
        }
        if(node.ratio === 'source') void updateSourceRatioFromBackground();
        syncBatchPosterSelectedAspectRatio(node);
    };
    ratioSelect.onmousedown = e => e.stopPropagation();
    ratioSelect.onclick = e => e.stopPropagation();
    ratioSelect.onchange = e => {
        e.stopPropagation();
        node.ratio = e.target.value;
        if(node.ratio !== 'custom' && node.ratio !== 'source') {
            node.customRatio = '';
            node.customRatioWidth = '';
            node.customRatioHeight = '';
        } else if(node.ratio === 'source') {
            node.customRatio = '';
            node.customRatioWidth = '';
            node.customRatioHeight = '';
        }
        syncSizeControls();
        scheduleSave();
    };
    resolutionSelect.onmousedown = e => e.stopPropagation();
    resolutionSelect.onclick = e => e.stopPropagation();
    resolutionSelect.onchange = e => {
        e.stopPropagation();
        node.resolution = e.target.value || '2k';
        syncSizeControls();
        scheduleSave();
    };
    [customRatioWInput, customRatioHInput].forEach(input => {
        if(!input) return;
        input.onmousedown = e => e.stopPropagation();
        input.onclick = e => e.stopPropagation();
        input.oninput = () => {
            node.customRatioWidth = customRatioWInput?.value || '';
            node.customRatioHeight = customRatioHInput?.value || '';
            node.customRatio = node.customRatioWidth && node.customRatioHeight
                ? `${node.customRatioWidth}:${node.customRatioHeight}`
                : '';
            node.ratio = 'custom';
            syncSizeControls();
            syncBatchPosterSelectedAspectRatio(node);
            scheduleSave();
        };
    });
    syncSizeControls();
}
function normalizeReplicaTargetMarkers(node){
    if(Array.isArray(node?.replica_target_markers) && node.replica_target_markers.length){
        return [...new Set(
            node.replica_target_markers
                .map(n => Math.max(1, Math.min(5, Math.floor(Number(n) || 0))))
                .filter(n => n >= 1)
        )].sort((a, b) => a - b);
    }
    const single = Math.max(1, Math.min(5, Math.floor(Number(node?.replica_target_marker || 1) || 1)));
    return [single];
}
function renderReplicaAgentRoleMapper(listEl, node){
    if(!listEl || !node) return;
    syncReplicaAgentRoles(node);
    const images = replicaAgentUpstreamImages(node);
    if(!images.length){
        listEl.innerHTML = `<div class="replica-role-empty">${langIsEn() ? 'Connect image nodes, then assign roles. For empty shots, connect only image 1.' : '连接上游图片后分配角色；纯空镜/风景请只连图1。'}</div>`;
        return;
    }
    listEl.innerHTML = images.map(img => {
        const role = node.roles?.[img.id] || 'background';
        return `<div class="replica-role-item" data-image-id="${escapeAttr(img.id)}">
            <div class="replica-role-thumb"><img src="${escapeAttr(img.url)}" alt=""></div>
            <div class="replica-role-meta">
                <div class="replica-role-name">${escapeHtml(img.name || 'image')}</div>
                <select class="select-lite replica-role-select" data-image-id="${escapeAttr(img.id)}">
                    <option value="background" ${role === 'background' ? 'selected' : ''}>背景/构图参考</option>
                    <option value="character" ${role === 'character' ? 'selected' : ''}>人脸/角色参考</option>
                </select>
            </div>
        </div>`;
    }).join('');
    listEl.querySelectorAll('.replica-role-select').forEach(select => {
        select.onmousedown = e => e.stopPropagation();
        select.onclick = e => e.stopPropagation();
        select.onchange = e => {
            e.stopPropagation();
            const imageId = select.dataset.imageId;
            if(!imageId) return;
            if(!node.roles) node.roles = {};
            const nextRole = select.value === 'character' ? 'character' : 'background';
            node.roles[imageId] = nextRole;
            syncReplicaAgentRoles(node);
            scheduleSave();
            const nodeEl = nodesEl?.querySelector?.(`.node[data-id="${CSS.escape(node.id)}"]`);
            updateReplicaAgentStatusBadges(nodeEl, node);
            bindReplicaAgentSizeControls(nodeEl?.querySelector?.('.replica-agent-body'), node, replicaAgentRoleImages(node).background?.url || '');
        };
    });
    mountCanvasCustomSelects(listEl);
}
const BATCH_POSTER_RATIO_TO_ASPECT = {
    square:'1:1',
    wide:'16:9',
    story:'9:16',
    portrait43:'3:4',
    landscape43:'4:3',
    portrait:'2:3',
    landscape:'3:2',
};
function resolveBatchPosterSelectedAspectRatio(node){
    const ratio = String(node?.ratio || 'source').trim();
    if(ratio === 'custom' || ratio === 'source'){
        const custom = String(node?.customRatio || '').trim().replace(/\s/g, '');
        if(/^\d+:\d+$/.test(custom)) return custom;
    }
    return BATCH_POSTER_RATIO_TO_ASPECT[ratio] || '16:9';
}
function syncBatchPosterSelectedAspectRatio(node){
    if(!node || node.type !== 'batchPosterAgent') return;
    node.selectedAspectRatio = resolveBatchPosterSelectedAspectRatio(node);
}
function normalizeBatchPosterPipelineMode(mode){
    const key = String(mode || 'standard').trim();
    if(key === 'plan_b_theme') return 'plan_b_theme';
    if(key === 'plan_b') return 'plan_b';
    return 'standard';
}
function isBatchPosterPlanB(node){
    const mode = normalizeBatchPosterPipelineMode(node?.pipelineMode);
    return mode === 'plan_b' || mode === 'plan_b_theme';
}
function isBatchPosterPlanBReferenceCopy(node){
    return normalizeBatchPosterPipelineMode(node?.pipelineMode) === 'plan_b';
}
function isBatchPosterPlanBThemeCopy(node){
    return normalizeBatchPosterPipelineMode(node?.pipelineMode) === 'plan_b_theme';
}
function batchPosterPlanBHintText(mode){
    if(mode === 'plan_b_theme'){
        return langIsEn()
            ? 'Plan B·Theme copy: LLM writes Slots ad copy per theme → nano scene (blank titles) → gpt uses reference layout only + theme fonts/colors. No $ symbol; balanced size, spacing, and line-height.'
            : 'B计划·主题文案：LLM 按主题撰写 Slots 买量文案 → nano 出场景（标题留白）→ gpt 仅借鉴参考图排版 + 主题配色。禁止 $ 符号；字号、字距、行距需得体。';
    }
    if(mode === 'plan_b'){
        return langIsEn()
            ? 'Plan B·Reference copy: VL extracts reference title copy → nano drafts scene (blank title zones) → gpt-image-2 overlays exact wording + theme fonts/colors.'
            : 'B计划·复刻参考文案：VL 提取参考标题文案 → nano 出场景（标题区留白）→ gpt-image-2 叠加逐字文案与主题字体配色。';
    }
    return '';
}
function normalizeBatchPosterAgentNode(node){
    if(!node || node.type !== 'batchPosterAgent') return;
    node.pipelineMode = normalizeBatchPosterPipelineMode(node.pipelineMode);
    node.custom_theme = normalizeBatchPosterCustomTheme(node.custom_theme);
    node.theme_source = normalizeBatchPosterThemeSource(node.theme_source, node);
    if(!node.apiProvider) node.apiProvider = imageApiProviders()[0]?.id || managedProviderId || 'comfly';
    if(!node.resolution) node.resolution = '2k';
    const legacy = String(node.imageModel || '').trim();
    if(legacy) node.imageModel = resolveImageModel(legacy);
    else if(!node.imageModel) node.imageModel = models.gpt || 'gpt-image-2';
    node.model = clampAgentTextModel(node.model);
}
function batchPosterPipelineSelectHtml(node){
    const mode = normalizeBatchPosterPipelineMode(node?.pipelineMode);
    return `
        <label class="batch-poster-field">
            <span class="batch-poster-field-label">${langIsEn() ? 'Pipeline' : '生成流程'}</span>
            <select class="batch-poster-pipeline setting-input">
                <option value="standard" ${mode === 'standard' ? 'selected' : ''}>${langIsEn() ? 'Standard (single model)' : '标准流程（单模型）'}</option>
                <option value="plan_b" ${mode === 'plan_b' ? 'selected' : ''}>${langIsEn() ? 'Plan B: reference copy + gpt titles' : 'B计划：复刻参考文案 + gpt 标题'}</option>
                <option value="plan_b_theme" ${mode === 'plan_b_theme' ? 'selected' : ''}>${langIsEn() ? 'Plan B: theme copy + layout ref' : 'B计划：主题原创文案 + 借鉴排版'}</option>
            </select>
        </label>
        <div class="batch-poster-planb-hint" style="display:${mode === 'plan_b' || mode === 'plan_b_theme' ? 'block' : 'none'}">${escapeHtml(batchPosterPlanBHintText(mode))}</div>`;
}
function syncBatchPosterPipelineUi(wrap, node){
    if(!wrap || !node) return;
    const mode = normalizeBatchPosterPipelineMode(node?.pipelineMode);
    const planB = isBatchPosterPlanB(node);
    const imageModelField = wrap.querySelector('.batch-poster-image-model-field');
    const planBHint = wrap.querySelector('.batch-poster-planb-hint');
    if(imageModelField) imageModelField.style.display = planB ? 'none' : '';
    if(planBHint){
        planBHint.style.display = planB ? 'block' : 'none';
        if(planB) planBHint.textContent = batchPosterPlanBHintText(mode);
    }
    syncBatchPosterPlanBCopyUi(wrap, node);
}
function resolveBatchPosterImageModel(node){
    normalizeBatchPosterAgentNode(node);
    return resolveImageModel(node.imageModel);
}
function batchPosterImageModelOptions(node){
    normalizeBatchPosterAgentNode(node);
    const providerId = resolveImageProviderId(node.apiProvider || managedProviderId);
    const all = allImageModels(providerId);
    const gpt = all.find(m => /^gpt-image-2$/i.test(String(m || '').trim())) || models.gpt || 'gpt-image-2';
    const nano = all.find(m => /^nano-banana-pro$/i.test(String(m || '').trim())) || models.nano || 'nano-banana-pro';
    const list = uniqueModels([gpt, nano]);
    const selected = resolveBatchPosterImageModel(node);
    return list.map(model => `<option value="${escapeHtml(model)}" ${model === selected ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('');
}
function batchPosterAgentPosterRef(node, ctx=loopContext){
    const sources = orderedSources(node, generatorSources(node, ctx));
    const refs = imageRefsOnly(sources.flatMap(s => s.refs || []));
    return refs[0] || null;
}
function normalizeBatchPosterPreset(value){
    const key = String(value || 'random').trim();
    if(key === 'random') return 'random';
    const aliases = {asianFortuneLuck:'chineseStyle'};
    const resolved = aliases[key] || key;
    if(BATCH_POSTER_PRESET_OPTIONS.some(opt => opt.value === resolved)) return resolved;
    return 'random';
}
function batchPosterPresetSelectHtml(node){
    const preset = normalizeBatchPosterPreset(node?.selectedPreset);
    const options = BATCH_POSTER_PRESET_OPTIONS.map(opt => {
        const label = langIsEn() ? opt.labelEn : opt.labelZh;
        return `<option value="${opt.value}" ${preset === opt.value ? 'selected' : ''}>${escapeHtml(label)}</option>`;
    }).join('');
    return `
        <label class="batch-poster-field">
            <span class="batch-poster-field-label">Theme Preset</span>
            <select class="batch-poster-preset setting-input">${options}</select>
        </label>`;
}
function snapshotBatchPosterGenStub(node){
    const stub = JSON.parse(JSON.stringify(node || {}));
    stub.type = 'batchPosterAgent';
    normalizeBatchPosterAgentNode(stub);
    syncBatchPosterSelectedAspectRatio(stub);
    return stub;
}
function snapshotBatchPosterBrainstormConfig(node){
    syncBatchPosterSelectedAspectRatio(node);
    const useCustom = batchPosterUsesCustomTheme(node);
    return {
        model:resolveBatchPosterChatModel(node),
        useCustom,
        customTheme:useCustom ? normalizeBatchPosterCustomTheme(node.custom_theme) : '',
        themeId:useCustom ? null : normalizeBatchPosterThemeId(node.selectedThemeId),
        selectedPreset:normalizeBatchPosterPreset(node.selectedPreset),
        selectedAspectRatio:node.selectedAspectRatio || resolveBatchPosterSelectedAspectRatio(node),
        pipelineMode:normalizeBatchPosterPipelineMode(node.pipelineMode),
    };
}
function snapshotBatchPosterRunContext(node, count, posterRef){
    const pipelineMode = normalizeBatchPosterPipelineMode(node.pipelineMode);
    return {
        count,
        posterRef:{url:posterRef.url, name:posterRef.name || 'poster'},
        genStub:snapshotBatchPosterGenStub(node),
        brainstorm:snapshotBatchPosterBrainstormConfig(node),
        planB:pipelineMode === 'plan_b' || pipelineMode === 'plan_b_theme',
        planBThemeCopy:pipelineMode === 'plan_b_theme',
        planBReferenceCopy:pipelineMode === 'plan_b',
        pipelineMode,
        basePrompt:String(node.base_prompt || BATCH_POSTER_BASE_PROMPT),
    };
}
function ensureBatchPosterRuns(node){
    if(!node._batchPosterRuns || typeof node._batchPosterRuns !== 'object') node._batchPosterRuns = {};
}
function registerBatchPosterRun(node, runToken, meta={}){
    ensureBatchPosterRuns(node);
    node._batchPosterRuns[runToken] = {
        status:'running',
        llmPendingIds:meta.llmPendingIds || [],
        progress:{phase:'llm', current:0, total:Number(meta.count || 0)},
        error:'',
    };
}
function updateBatchPosterRunProgress(node, runToken, patch){
    const entry = node._batchPosterRuns?.[runToken];
    if(!entry) return;
    entry.progress = {...(entry.progress || {}), ...patch};
    updateBatchPosterRunButton(node);
}
function activeBatchPosterRunCount(node){
    return Object.values(node._batchPosterRuns || {}).filter(entry => entry?.status === 'running').length;
}
function finishBatchPosterRun(node, runToken, {error=''}={}){
    if(node._batchPosterRuns?.[runToken]) delete node._batchPosterRuns[runToken];
    if(error) node.runError = error;
    else if(!Object.keys(node._batchPosterRuns || {}).length) node.runError = '';
    syncBatchPosterNodeRunState(node);
    updateBatchPosterRunButton(node);
}
function removeBatchPosterRunPending(out, runToken, extraIds=[]){
    if(!out) return;
    const drop = new Set(extraIds);
    out._pending = (out._pending || []).filter(p => {
        if(drop.has(p.id)) return false;
        if(p.batchPosterRunToken === runToken) return false;
        return true;
    });
}
function batchPosterBrainstormStatusLabelFromCfg(cfg){
    if(cfg?.useCustom){
        const custom = String(cfg.customTheme || '').trim();
        if(custom) return langIsEn() ? `Brainstorming "${custom}"…` : `正在围绕「${custom}」脑暴…`;
        return langIsEn() ? 'Enter custom theme…' : '请填写自定义主题…';
    }
    if(cfg?.themeId) return langIsEn() ? 'Generating theme variants…' : '正在生成主题变体…';
    return langIsEn() ? 'Brainstorming themes…' : '正在脑暴主题…';
}
function syncBatchPosterNodeRunState(node){
    if(!node || node.type !== 'batchPosterAgent') return;
    const pendingN = agentPendingCount(node.id);
    const activeN = activeBatchPosterRunCount(node);
    node.running = pendingN > 0 || activeN > 0;
    if(node.running) node.runStatus = 'running';
    else if(node.runStatus === 'running') node.runStatus = node.runError ? 'failed' : 'idle';
}
async function brainstormBatchPosterThemes(count, node, brainstormCfg=null){
    const cfg = brainstormCfg || snapshotBatchPosterBrainstormConfig(node);
    const model = cfg.model;
    if(!brainstormCfg && node.model !== model){
        node.model = model;
        scheduleSave();
    }
    const payload = {
        count,
        selectedPreset:cfg.selectedPreset,
        selectedAspectRatio:cfg.selectedAspectRatio,
        model,
        pipelineMode:cfg.pipelineMode,
    };
    if(cfg.useCustom && cfg.customTheme) payload.customTheme = cfg.customTheme;
    else if(cfg.themeId) payload.themeId = cfg.themeId;
    const res = await apiFetch('/api/canvas/batch-poster-brainstorm', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
    });
    if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Batch Poster LLM failed' : 'Batch Poster 主题脑暴失败'));
    const data = await res.json();
    const themes = Array.isArray(data.themes)
        ? data.themes.map(normalizeBatchPosterThemeSlot).filter(slot => slot.theme_prompt)
        : [];
    if(themes.length < count){
        throw new Error(langIsEn()
            ? `Brainstorm returned ${themes.length} theme(s), expected ${count}`
            : `脑暴只返回 ${themes.length} 个主题，需要 ${count} 个`);
    }
    return themes.slice(0, count);
}
function normalizeBatchPosterThemeSlot(item){
    if(typeof item === 'string'){
        const theme_prompt = item.trim();
        return theme_prompt ? {theme_prompt, title_style:{...BATCH_POSTER_DEFAULT_TITLE_STYLE_LAYERS}} : null;
    }
    if(!item || typeof item !== 'object') return null;
    const theme_prompt = String(item.theme_prompt || item.theme || item.description || item.prompt || item.text || '').trim();
    if(!theme_prompt) return null;
    const rawStyle = item.title_style ?? item.titleStyle ?? item.typography ?? item.title_typography;
    const slot = {
        theme_prompt,
        title_style:normalizeBatchPosterTitleStyleLayers(rawStyle),
    };
    const rawCopy = item.title_copy ?? item.titleCopy ?? item.copy;
    if(rawCopy) slot.title_copy = normalizeBatchPosterTitleCopy(rawCopy);
    return slot;
}
function formatBatchPosterReferenceTitleStyleForPrompt(){
    return [
        'Title typography (reference copy mode):',
        '- Match image 2 title block positions, alignment, line breaks, hierarchy, and relative sizes exactly.',
        '- Recolor fonts to harmonize with image 1 scene palette; do NOT copy image 2 font colors.',
        '- Use at least 3 distinct color tiers across text blocks; promo/numeric lines highest contrast.',
    ].join('\n');
}
function formatBatchPosterThemeTitleCopyForPrompt(titleCopy, themeCreative = false){
    const copy = normalizeBatchPosterTitleCopy(titleCopy);
    const lines = themeCreative
        ? ['【主题原创标题文案 — 必须逐字渲染，禁止复刻参考图文字】']
        : ['【参考海报标题字面文案 — 逐字锁定】'];
    const blocks = Array.isArray(copy.blocks) ? copy.blocks.filter(item => String(item || '').trim()) : [];
    if(blocks.length){
        lines.push('【全部标题区块 — 每一段必须独立渲染，与参考图2完全一致】');
        blocks.forEach((block, idx) => {
            lines.push(`${idx + 1}. "${String(block).trim()}"`);
        });
        lines.push('若下方四层字段与 blocks 不一致，以 blocks 为准。禁止编造未列出的 JACKPOT、CLAIM NOW、100 FREE SPINS 等买量套话。');
    }
    if(copy.headline) lines.push(`- Main headline / 主标题字面（必须完全一致）: "${copy.headline}"`);
    if(copy.emphasis) lines.push(`- Promo emphasis / 促销高亮字面: "${copy.emphasis}"`);
    if(copy.secondary) lines.push(`- Supporting micro-copy / 副文案字面: "${copy.secondary}"`);
    if(copy.cta) lines.push(`- CTA button / 按钮文字字面: "${copy.cta}"`);
    if(lines.length <= 1) return '';
    if(themeCreative){
        lines.push('全文禁止出现美元符号 $。字号层级、字距、行距与区块间距须符合专业 Slots 买量海报排版。');
    } else {
        lines.push('必须逐字渲染以上全部文案；禁止翻译、改写、合并或替换为其它促销套话。若图1上有错误/乱码文字，必须用以上字面完整替换。图2为排版与字面权威参考。');
    }
    return lines.join('\n');
}
function batchPosterPlanBSceneTitleZoneSuffix(){
    return langIsEn()
        ? '\n\n[Scene pass — seamless full-bleed illustration] Single continuous poster illustration edge-to-edge. Do NOT draw any readable letters, numbers, words, or button text. Reserve top and bottom areas for titles later, but extend the same sky/environment/atmosphere naturally into those bands — NO horizontal seam, NO letterbox bars, NO solid empty strips, NO hard divider between "scene" and "title zone". Characters and props stay in the middle; only soft bokeh/smoke/light may spill into title bands.'
        : '\n\n【场景阶段 — 全幅连续插画】整张海报为一张连续无裁切插画，禁止任何可读文字、字母、数字或按钮文案。顶部与底部虽预留给标题，但必须让天空/环境/光效自然延伸进这些区域，禁止出现横向硬切分隔线、上下色带、纯色空条或「场景条+标题条」拼贴感。角色与道具居中，仅允许柔和 bokeh/烟雾/光效渗入标题区。';
}
function batchPosterPlanBTypoSeamRules(){
    return langIsEn()
        ? 'Seamless title integration: remove any visible horizontal divider or letterbox bar between the middle scene and top/bottom title bands. Extend/blend atmosphere from the scene into title areas so the poster reads as ONE continuous illustration with typography on top — like professional mobile slot ads. You may repaint only pixels in title bands to eliminate seams; do NOT move or alter central characters, props, or core composition.'
        : '标题无缝融合：消除画面中部与上下标题区之间的任何横向硬切分隔线、色带或 letterbox 条。将场景氛围自然延伸进标题区，使整张海报像专业 Slots 买量广告一样是一张连续插画+叠字。仅允许重绘标题区像素以消除接缝，禁止移动或改变中央角色、道具与核心构图。';
}
function buildBatchPosterSceneOnlyPrompt(basePrompt, themePrompt, retryAttempt = 0){
    const theme = String(themePrompt || '').trim();
    let prompt = String(basePrompt || BATCH_POSTER_BASE_PROMPT);
    if(prompt.includes('{theme_prompt}')) prompt = prompt.replace('{theme_prompt}', theme);
    else prompt = `${prompt}\n\n${theme}`;
    if(prompt.includes('{title_style}')) prompt = prompt.replace('{title_style}', '');
    prompt = prompt.replace(/\n{3,}/g, '\n\n').trim();
    prompt += batchPosterPlanBSceneTitleZoneSuffix();
    if(retryAttempt > 0) prompt += BATCH_POSTER_SAFE_RETRY_SUFFIX;
    return prompt;
}
function buildBatchPosterTypographyEditPrompt(titleStyle, titleCopy, basePrompt, opts={}){
    const themeCreative = opts.titleMode === 'theme_creative';
    const titleBlock = themeCreative
        ? formatBatchPosterTitleStyleForPrompt(titleStyle)
        : formatBatchPosterReferenceTitleStyleForPrompt();
    const copyBlock = formatBatchPosterThemeTitleCopyForPrompt(titleCopy, themeCreative);
    const titleRules = themeCreative ? '' : batchPosterTitleCopyRulesFromBase(basePrompt);
    const lead = themeCreative
        ? (langIsEn()
            ? 'Edit image 1 (nano scene draft). Keep scene, characters, props, background, and composition EXACTLY unchanged. Image 2 is LAYOUT-ONLY reference: copy title block positions, alignment, hierarchy, line breaks, margins, and relative sizes — do NOT copy its wording.'
            : '编辑图1（nano 场景稿）。场景、角色、道具、背景与构图完全不变。图2仅作排版参考：借鉴标题区块位置、对齐、层级、换行、边距与相对字号，禁止复刻其字面文案。')
        : (langIsEn()
            ? 'Edit image 1 (nano scene draft). Keep scene, characters, props, background, and composition EXACTLY unchanged. Image 2 is the authoritative reference for BOTH title wording and layout — every visible title string on image 2 must appear on image 1 with identical spelling, casing, and punctuation.'
            : '编辑图1（nano 场景稿）。场景、角色、道具、背景与构图必须完全保持不变。图2是标题【字面文案+排版】的权威参考——图2上每一段可见标题必须逐字出现在图1上，拼写、大小写、标点完全一致。');
    const rules = themeCreative
        ? (langIsEn()
            ? 'ONLY add/replace title typography and layered colors on image 1. Do NOT change scene art. Render the exact title_copy strings below with title_style fonts/colors. Never copy text from image 2. No dollar sign ($) anywhere. Use professional Slots ad typography: balanced font sizes, clear letter-spacing, comfortable line-height between stacked lines, and proper padding between headline/emphasis/cta blocks.'
            : '仅在图1叠加/替换标题字体与分层配色，禁止改动场景。必须逐字渲染下方 title_copy，并套用 title_style 配色字体；禁止复制图2文字；全文禁止 $；专业 Slots 海报排版：字号层级合理、字距清晰、行距舒适、各标题区块间距得体。')
        : (langIsEn()
            ? 'ONLY add/replace title typography and layered colors on image 1. Do NOT change scene art. You MUST render ONLY the exact literal strings listed below and visible on image 2 — character-for-character. Do NOT invent generic slot ad copy (no random JACKPOT, CLAIM NOW, 100 FREE SPINS, COWABUNGA COINS, etc. unless explicitly listed). Replace any wrong or garbled text on image 1. Never use one color for all title blocks.'
            : '仅在图1叠加/替换标题字体与分层配色，禁止改动场景。必须且只能渲染下方列出的字面文案（与图2一致），逐字一致；禁止编造通用买量套话（不得随机出现 JACKPOT、CLAIM NOW、100 FREE SPINS、COWABUNGA COINS 等，除非已明确列出）；完整替换图1上任何错误文字；禁止所有标题同一配色。');
    return [lead, titleRules, rules, batchPosterPlanBTypoSeamRules(), copyBlock, titleBlock].filter(Boolean).join('\n\n');
}
async function buildBatchPosterImagePayload(node, prompt, posterRef, opts={}){
    const imageModel = opts.modelOverride ? resolveImageModel(opts.modelOverride) : resolveBatchPosterImageModel(node);
    const genStub = {...node, model:imageModel, apiProvider: node.apiProvider || 'comfly'};
    const refs = posterRef ? [posterRef] : [];
    const ratioMeta = await replicaAgentRatioForRun(genStub, {url: posterRef?.url});
    return {
        prompt,
        provider_id: resolveImageProviderId(genStub.apiProvider),
        model: imageModel,
        size: await generatorSizeForRun({...genStub, ...ratioMeta}, refs),
        canvas_resolution: node.resolution || '2k',
        canvas_ratio: ratioMeta.canvas_ratio || 'wide',
        canvas_custom_ratio: ratioMeta.canvas_custom_ratio || node.customRatio || '',
        reference_images: refs,
    };
}
async function buildBatchPosterTypographyEditPayload(node, draftUrl, posterRef, titleStyle, titleCopy, basePrompt, opts={}){
    const imageModel = models.gpt || 'gpt-image-2';
    const genStub = {...node, model:imageModel, apiProvider: node.apiProvider || 'comfly', quality: node.quality || 'medium'};
    const refs = [
        {url:draftUrl, name:'draft', kind:'image'},
        {url:posterRef.url, name:posterRef.name || 'poster', kind:'image'},
    ];
    const ratioMeta = await replicaAgentRatioForRun(genStub, {url:posterRef?.url});
    const prompt = buildBatchPosterTypographyEditPrompt(titleStyle, titleCopy, basePrompt, opts);
    const payload = {
        prompt,
        provider_id: resolveImageProviderId(genStub.apiProvider),
        model: imageModel,
        size: await generatorSizeForRun({...genStub, ...ratioMeta}, refs),
        canvas_resolution: node.resolution || '2k',
        canvas_ratio: ratioMeta.canvas_ratio || 'wide',
        canvas_custom_ratio: ratioMeta.canvas_custom_ratio || node.customRatio || '',
        reference_images: refs,
    };
    const quality = normalizedImageQuality(genStub.quality);
    if(quality) payload.quality = quality;
    return payload;
}
function batchPosterDraftUrlFromTaskResult(result){
    const data = result || {};
    return data.url || (Array.isArray(data.images) ? data.images[0] : '') || '';
}
const BATCH_POSTER_IMAGE_MAX_RETRIES = 2;
const BATCH_POSTER_SAFE_RETRY_SUFFIX = '\n\nFamily-friendly casino promotional art only. Avoid violence, horror, gore, explicit content, and disturbing imagery.';
function buildBatchPosterThemePrompt(basePrompt, themePrompt, titleStyle, retryAttempt = 0){
    const theme = String(themePrompt || '').trim();
    const titleBlock = formatBatchPosterTitleStyleForPrompt(titleStyle);
    let prompt = String(basePrompt || BATCH_POSTER_BASE_PROMPT);
    if(prompt.includes('{theme_prompt}')) prompt = prompt.replace('{theme_prompt}', theme);
    else prompt = `${prompt}\n\n${theme}`;
    if(prompt.includes('{title_style}')) prompt = prompt.replace('{title_style}', titleBlock);
    else prompt = `${prompt}\n\n${titleBlock}`;
    if(retryAttempt > 0) prompt += BATCH_POSTER_SAFE_RETRY_SUFFIX;
    return prompt;
}
function batchPosterModerationRetryAttempt(lastError, round){
    if(!round) return 0;
    return /1501|内容安全|content security/i.test(String(lastError || '')) ? round : 0;
}
async function runBatchPosterImageSlot(genStub, themeSlot, basePrompt, posterRef, run, out, ownerNodeId, runToken, retryAttempt = 0){
    const ownerNode = nodes.find(n => n.id === ownerNodeId);
    const slot = typeof themeSlot === 'string'
        ? {theme_prompt:themeSlot, title_style:{...BATCH_POSTER_DEFAULT_TITLE_STYLE_LAYERS}}
        : (themeSlot || {});
    const prompt = buildBatchPosterThemePrompt(basePrompt, slot.theme_prompt, slot.title_style, retryAttempt);
    const payload = await buildBatchPosterImagePayload(genStub, prompt, posterRef);
    const taskInfo = await createCanvasImageTask(payload);
    if(out){
        out._pending = [
            ...(out._pending || []),
            makePending(uid('p'), {...run, prompt}, {
                canvasTaskId:taskInfo.task_id,
                canvasTaskType:'online-image',
                batchPosterRunToken:runToken,
            }),
        ];
    }
    refreshRunNodes(ownerNode, out);
    scheduleSave();
    const status = await pollCanvasImageTask(taskInfo.task_id);
    const errNode = nodes.find(n => n.id === ownerNodeId);
    return {status, error: errNode?.runError || ''};
}
async function runBatchPosterImageSlotPlanB(genStub, themeSlot, basePrompt, posterRef, refTitleCopy, run, out, ownerNodeId, runToken, opts={}){
    const ownerNode = nodes.find(n => n.id === ownerNodeId);
    const planBThemeCopy = Boolean(opts.planBThemeCopy);
    const retryAttempt = Number(opts.retryAttempt || 0);
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const slot = typeof themeSlot === 'string'
        ? {theme_prompt:themeSlot, title_style:{...BATCH_POSTER_DEFAULT_TITLE_STYLE_LAYERS}}
        : (themeSlot || {});
    const titleMode = planBThemeCopy ? 'theme_creative' : 'reference';
    const titleCopy = planBThemeCopy
        ? normalizeBatchPosterTitleCopy(slot.title_copy)
        : normalizeBatchPosterTitleCopy(refTitleCopy);
    if(!planBThemeCopy && !batchPosterTitleCopyHasContent(titleCopy)){
        throw new Error(langIsEn()
            ? 'Plan B reference copy mode requires locked title copy before typography pass.'
            : 'B计划·复刻参考文案在标题精修前必须已有锁定的参考标题文案。');
    }
    const nanoModel = models.nano || 'nano-banana-pro';
    onProgress?.({phase:'image', subPhase:'scene'});
    const scenePrompt = buildBatchPosterSceneOnlyPrompt(BATCH_POSTER_PLAN_B_SCENE_BASE, slot.theme_prompt, retryAttempt);
    const scenePayload = await buildBatchPosterImagePayload(genStub, scenePrompt, null, {modelOverride:nanoModel});
    const sceneTask = await createCanvasImageTask(scenePayload);
    const sceneResult = await waitForCanvasImageTask(sceneTask.task_id);
    const draftUrl = batchPosterDraftUrlFromTaskResult(sceneResult);
    if(!draftUrl) throw new Error(langIsEn() ? 'Plan B scene pass returned no image' : 'B计划场景阶段未返回图片');
    onProgress?.({phase:'image', subPhase:'typography'});
    const typoPayload = await buildBatchPosterTypographyEditPayload(genStub, draftUrl, posterRef, slot.title_style, titleCopy, basePrompt, {titleMode});
    const taskInfo = await createCanvasImageTask(typoPayload);
    if(out){
        out._pending = [
            ...(out._pending || []),
            makePending(uid('p'), {...run, prompt:typoPayload.prompt}, {
                canvasTaskId:taskInfo.task_id,
                canvasTaskType:'online-image',
                batchPosterRunToken:runToken,
                stageLabel:langIsEn() ? 'Refining titles (gpt-image-2)…' : '标题精修 (gpt-image-2)…',
            }),
        ];
    }
    refreshRunNodes(ownerNode, out);
    scheduleSave();
    const status = await pollCanvasImageTask(taskInfo.task_id);
    const errNode = nodes.find(n => n.id === ownerNodeId);
    return {status, error: errNode?.runError || ''};
}
function batchPosterBrainstormStatusLabel(node){
    if(batchPosterUsesCustomTheme(node)){
        const custom = normalizeBatchPosterCustomTheme(node?.custom_theme);
        if(custom) return langIsEn() ? `Brainstorming "${custom}"…` : `正在围绕「${custom}」脑暴…`;
        return langIsEn() ? 'Enter custom theme…' : '请填写自定义主题…';
    }
    if(normalizeBatchPosterThemeId(node?.selectedThemeId)) return langIsEn() ? 'Generating theme variants…' : '正在生成主题变体…';
    return langIsEn() ? 'Brainstorming themes…' : '正在脑暴主题…';
}
function batchPosterGlobalStatusLabel(node){
    if(batchPosterUsesCustomTheme(node)){
        const custom = normalizeBatchPosterCustomTheme(node?.custom_theme);
        if(custom) return langIsEn() ? `Batch Poster: brainstorming "${custom}"…` : `Batch Poster：正在围绕「${custom}」脑暴…`;
        return langIsEn() ? 'Batch Poster: enter custom theme' : 'Batch Poster：请填写自定义主题';
    }
    if(normalizeBatchPosterThemeId(node?.selectedThemeId)) return langIsEn() ? 'Batch Poster: generating theme variants…' : 'Batch Poster：正在生成主题变体…';
    return langIsEn() ? 'Batch Poster: brainstorming themes…' : 'Batch Poster：正在脑暴主题…';
}
function updateBatchPosterRunButton(node){
    syncBatchPosterNodeRunState(node);
    const el = nodesEl?.querySelector?.(`.node[data-id="${CSS.escape(node.id)}"] .batch-poster-run-btn`);
    if(!el) return;
    const span = el.querySelector('span');
    const pendingN = agentPendingCount(node.id);
    const activeN = activeBatchPosterRunCount(node);
    const busy = pendingN > 0 || activeN > 0;
    el.disabled = false;
    el.classList.toggle('running', busy);
    if(busy){
        if(span){
            if(activeN > 1){
                span.textContent = langIsEn()
                    ? `Generating (${pendingN}, ${activeN} batches)…`
                    : `生成中 (${pendingN}，${activeN} 批)…`;
            } else {
                span.textContent = langIsEn() ? `Generating (${pendingN})…` : `生成中 (${pendingN})…`;
            }
        }
        return;
    }
    el.classList.remove('running');
    if(span) span.textContent = langIsEn() ? 'Run Batch' : '一键批量生成';
}
async function executeBatchPosterRun(nodeId, runToken, ctx, run, out, llmPendingIds){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    const posterRef = ctx.posterRef;
    const count = ctx.count;
    try {
        if(node._agentStopRequested) throw new Error(langIsEn() ? 'Stopped' : '已停止');
        const themes = await brainstormBatchPosterThemes(count, node, ctx.brainstorm);
        if(node._agentStopRequested) throw new Error(langIsEn() ? 'Stopped' : '已停止');
        let planBTitleCopy = null;
        if(ctx.planBReferenceCopy){
            planBTitleCopy = await resolveBatchPosterPlanBTitleCopy(posterRef, node);
        }
        if(node._agentStopRequested) throw new Error(langIsEn() ? 'Stopped' : '已停止');
        removeBatchPosterRunPending(out, runToken, llmPendingIds);
        updateBatchPosterRunProgress(node, runToken, {phase:'image', current:0, total:count});
        const slots = themes.map(entry => ({...entry, status:'pending', lastError:''}));
        const onProgress = patch => updateBatchPosterRunProgress(node, runToken, patch);
        const generateBatchPosterSlot = async (slot, round) => {
            if(node._agentStopRequested){
                slot.status = 'failed';
                slot.lastError = langIsEn() ? 'Stopped' : '已停止';
                return 'failed';
            }
            try {
                const retryAttempt = batchPosterModerationRetryAttempt(slot.lastError, round);
                const result = ctx.planB
                    ? await runBatchPosterImageSlotPlanB(ctx.genStub, slot, ctx.basePrompt, posterRef, planBTitleCopy, run, out, nodeId, runToken, {
                        planBThemeCopy:ctx.planBThemeCopy,
                        retryAttempt,
                        onProgress,
                    })
                    : await runBatchPosterImageSlot(ctx.genStub, slot, ctx.basePrompt, posterRef, run, out, nodeId, runToken, retryAttempt);
                slot.status = result.status;
                slot.lastError = result.error || (result.status !== 'succeeded' ? (result.error || '') : '');
                const done = slots.filter(s => s.status === 'succeeded').length;
                updateBatchPosterRunProgress(node, runToken, {phase:'image', current:done, total:count});
                return result.status;
            } catch(slotErr) {
                slot.status = 'failed';
                slot.lastError = slotErr.message || String(slotErr);
                return 'failed';
            }
        };
        await Promise.all(slots.map(slot => generateBatchPosterSlot(slot, 0)));
        for(let round = 1; round <= BATCH_POSTER_IMAGE_MAX_RETRIES; round++){
            if(node._agentStopRequested) break;
            const failedSlots = slots.filter(slot => slot.status !== 'succeeded');
            if(!failedSlots.length) break;
            await Promise.all(failedSlots.map(slot => generateBatchPosterSlot(slot, round)));
        }
        if(node._agentStopRequested){
            removeBatchPosterRunPending(out, runToken, llmPendingIds);
            finishBatchPosterRun(node, runToken);
            refreshRunNodes(node, out);
            setStatus(langIsEn() ? 'Batch Poster stopped' : 'Batch Poster 已停止');
            scheduleSave();
            return;
        }
        await saveCanvas();
        const generatedCount = slots.filter(slot => slot.status === 'succeeded').length;
        const lastFailure = slots.find(slot => slot.status !== 'succeeded')?.lastError || '';
        if(!generatedCount){
            finishBatchPosterRun(node, runToken, {error:lastFailure || (langIsEn() ? 'Batch Poster image generation failed' : 'Batch Poster 图片生成失败')});
            refreshRunNodes(node, out);
            showErrorModal(lastFailure || (langIsEn() ? 'Batch Poster failed' : 'Batch Poster 批量生成失败'), 'Batch Poster Agent');
            scheduleSave();
            return;
        }
        if(generatedCount < count){
            const partialMsg = langIsEn()
                ? `Batch Poster: ${generatedCount}/${count} image(s) added (${count - generatedCount} failed after retries)`
                : `Batch Poster：已追加 ${generatedCount}/${count} 张海报（${count - generatedCount} 张重试后仍失败）`;
            node.runError = partialMsg;
            finishBatchPosterRun(node, runToken);
            refreshRunNodes(node, out);
            setStatus(partialMsg);
            scheduleSave();
            return;
        }
        finishBatchPosterRun(node, runToken);
        refreshRunNodes(node, out);
        setStatus(langIsEn() ? `Batch Poster: added ${generatedCount} image(s) to output` : `Batch Poster：已向 Output 追加 ${generatedCount} 张海报`);
        scheduleSave();
    } catch(err) {
        removeBatchPosterRunPending(out, runToken, llmPendingIds);
        const stopped = node._agentStopRequested || /已停止|Stopped/i.test(String(err?.message || err));
        finishBatchPosterRun(node, runToken, stopped ? {} : {error:err.message || String(err)});
        refreshRunNodes(node, out);
        if(!stopped) showErrorModal(err.message || (langIsEn() ? 'Batch Poster failed' : 'Batch Poster 批量生成失败'), 'Batch Poster Agent');
        else setStatus(langIsEn() ? 'Batch Poster stopped' : 'Batch Poster 已停止');
        scheduleSave();
    } finally {
        delete node._agentStopRequested;
    }
}
async function runBatchPosterAgent(nodeId, opts={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'batchPosterAgent' || isNodeDisabled(node)) return;
    const count = Math.max(1, Math.min(10, Number(node.batch_count || 3)));
    const posterRef = batchPosterAgentPosterRef(node);
    if(!posterRef?.url){
        const msg = langIsEn() ? 'Connect a reference poster image to the Image input.' : '请通过 Image 端口连接一张参考海报图。';
        node.runStatus = 'failed';
        node.runError = msg;
        refreshNodes([nodeId]);
        if(opts.cascade) throw new Error(msg);
        return;
    }
    if(batchPosterUsesCustomTheme(node) && !normalizeBatchPosterCustomTheme(node.custom_theme)){
        const msg = langIsEn() ? 'Enter a custom theme before running.' : '请先填写自定义主题。';
        node.runStatus = 'failed';
        node.runError = msg;
        refreshNodes([nodeId]);
        if(opts.cascade) throw new Error(msg);
        return;
    }
    delete node._agentStopRequested;
    const runToken = uid('bpr');
    const ctx = snapshotBatchPosterRunContext(node, count, posterRef);
    const llmPendingIds = Array.from({length:count}, () => uid('p'));
    registerBatchPosterRun(node, runToken, {count, llmPendingIds});
    syncBatchPosterNodeRunState(node);
    node.runError = '';
    updateBatchPosterRunButton(node);
    const refs = [{url:posterRef.url, name:posterRef.name || 'poster'}];
    const run = runSnapshot(node, ctx.planB
        ? (ctx.planBThemeCopy
            ? (langIsEn() ? 'Batch Poster Agent (Plan B theme copy)' : 'Batch Poster B计划·主题文案')
            : (langIsEn() ? 'Batch Poster Agent (Plan B)' : 'Batch Poster B计划'))
        : (langIsEn() ? 'Batch Poster Agent' : 'Batch Poster 批量海报'), refs);
    let out = outputForNode(node, 460);
    const llmStageLabel = batchPosterBrainstormStatusLabelFromCfg(ctx.brainstorm);
    if(out){
        out._pending = [
            ...(out._pending || []),
            ...llmPendingIds.map(id => makePending(id, run, {
                stageLabel:llmStageLabel,
                batchPosterRunToken:runToken,
            })),
        ];
    }
    refreshRunNodes(node, out);
    scheduleSave();
    refreshNodes([nodeId]);
    setStatus(batchPosterBrainstormStatusLabelFromCfg(ctx.brainstorm));
    if(opts.cascade) await executeBatchPosterRun(nodeId, runToken, ctx, run, out, llmPendingIds);
    else void executeBatchPosterRun(nodeId, runToken, ctx, run, out, llmPendingIds);
}
function runBatchPosterFromButton(nodeId, event){
    event?.preventDefault?.();
    event?.stopPropagation?.();
    void runBatchPosterAgent(nodeId);
}
window.runBatchPosterFromButton = runBatchPosterFromButton;
function isNineGridAgentType(type){
    return type === 'nineGridAgent';
}
function nineGridRefLookForIndex(node, idx){
    const looks = Array.isArray(node?.refLooks) ? node.refLooks : [];
    const oneBased = idx + 1;
    return looks.find(l => Number(l?.index) === oneBased) || looks[idx] || null;
}
function nineGridRefVisionWarnings(node){
    const entries = collectNineGridRefEntries(node);
    if(!entries.length) return [];
    const warnings = [];
    entries.forEach((entry, idx) => {
        const look = nineGridRefLookForIndex(node, idx);
        if(!look) warnings.push({ index:idx + 1, name:entry.name || `图${idx + 1}`, kind:'missing' });
        else if(look.visionFailed) warnings.push({ index:idx + 1, name:look.name || entry.name, kind:'failed' });
    });
    return warnings;
}
function collectNineGridRefEntries(node){
    const sources = orderedSources(node, generatorSources(node));
    const entries = [];
    const seen = new Set();
    sources.forEach(src => {
        imageRefsOnly(src.refs || []).forEach(ref => {
            const key = String(src.imageId || src.id || ref.url || '');
            if(!ref.url || !key || seen.has(key)) return;
            seen.add(key);
            entries.push({
                key,
                imageId:src.imageId || null,
                url:ref.url,
                name:String(ref.name || '').trim(),
                preview:src.preview || ref.url,
            });
        });
    });
    return entries;
}
function renderNineGridRefList(list, node, emptyText=null){
    if(!list) return;
    if(!node.refNames || typeof node.refNames !== 'object') node.refNames = {};
    const entries = collectNineGridRefEntries(node);
    if(!entries.length){
        list.innerHTML = `<div class="nine-grid-ref-empty">${escapeHtml(emptyText || (langIsEn() ? 'Connect reference images' : '请连接参考图'))}</div>`;
        return;
    }
    list.innerHTML = `
        <div class="nine-grid-ref-hint">${langIsEn() ? 'Name each ref (e.g. Mia) so prompts can cite the matching image.' : '为参考图命名（如 Mia），脚本中同名可绑定对应参考图。'}</div>
        <div class="nine-grid-ref-row">${entries.map((entry, idx) => {
            const stored = String(node.refNames[entry.key] ?? entry.name ?? '').trim();
            const look = nineGridRefLookForIndex(node, idx);
            const visionBadge = !look
                ? `<span class="nine-grid-ref-vision nine-grid-ref-vision--pending" title="${escapeAttr(langIsEn() ? 'Run Phase A to analyze' : '运行「生成分镜」后分析造型')}">?</span>`
                : look.visionFailed
                    ? `<span class="nine-grid-ref-vision nine-grid-ref-vision--warn" title="${escapeAttr(langIsEn() ? 'Vision failed — re-run Phase A; image model uses uploaded ref' : '视觉分析失败，请重跑分镜；出图仍会上传该参考图')}">!</span>`
                    : `<span class="nine-grid-ref-vision nine-grid-ref-vision--ok" title="${escapeAttr(langIsEn() ? 'Look anchor ready' : '造型锚点已提取')}">✓</span>`;
            return `<div class="nine-grid-ref-item" data-ref-key="${escapeAttr(entry.key)}">
                <div class="nine-grid-ref-thumb"><img src="${escapeAttr(entry.preview)}" alt="" referrerpolicy="no-referrer"><span class="nine-grid-ref-index">图${idx + 1}</span>${visionBadge}</div>
                <input type="text" class="nine-grid-ref-name setting-input" data-ref-key="${escapeAttr(entry.key)}" value="${escapeHtml(stored)}" placeholder="${escapeAttr(langIsEn() ? 'Name e.g. Mia' : '名称，如 Mia')}" maxlength="24">
            </div>`;
        }).join('')}</div>`;
    list.querySelectorAll('.nine-grid-ref-name').forEach(input => {
        input.onmousedown = e => e.stopPropagation();
        input.oninput = e => {
            e.stopPropagation();
            const key = input.dataset.refKey;
            if(!key) return;
            node.refNames[key] = input.value.slice(0, 24);
            const entry = entries.find(item => item.key === key);
            if(entry?.imageId){
                const imgNode = nodes.find(n => n.id === entry.imageId);
                if(imgNode) imgNode.name = node.refNames[key];
            }
            scheduleSave();
        };
    });
}
function normalizeNineGridAgentNode(node){
    if(!node || node.type !== 'nineGridAgent') return;
    if(!node.refNames || typeof node.refNames !== 'object') node.refNames = {};
    if(!Array.isArray(node.refLooks)) node.refLooks = [];
    if(!node.apiProvider) node.apiProvider = imageApiProviders()[0]?.id || managedProviderId || 'runninghub';
    if(!node.resolution) node.resolution = '4k';
    if(!node.ratio) node.ratio = 'wide';
    if(!node.quality) node.quality = 'medium';
    const legacy = String(node.imageModel || node.model || '').trim();
    if(/^nano-banana-pro-4k$/i.test(legacy) || legacy === 'nano') node.model = models.nano || 'nano-banana-pro';
    else if(legacy) node.model = resolveImageModel(legacy);
    else if(!node.model) node.model = models.nano || 'nano-banana-pro';
    if(node.imageModel) delete node.imageModel;
    if(isGptImage2Model(node.model) && node.quality === 'auto') node.quality = 'medium';
    if(!node.textModel || !CANVAS_AGENT_TEXT_MODELS.includes(String(node.textModel || '').trim())){
        node.textModel = CANVAS_AGENT_TEXT_MODELS[0];
    }
}
function resolveNineGridAgentTextModel(node){
    normalizeNineGridAgentNode(node);
    return String(node?.textModel || CANVAS_AGENT_TEXT_MODELS[0]).trim() || CANVAS_AGENT_TEXT_MODELS[0];
}
function nineGridImageModelOptions(node){
    const providerId = resolveImageProviderId(node.apiProvider || managedProviderId);
    const all = allImageModels(providerId);
    const nano = all.find(m => /^nano-banana-pro$/i.test(String(m || '').trim())) || models.nano || 'nano-banana-pro';
    const gpt = all.find(m => /^gpt-image-2$/i.test(String(m || '').trim())) || models.gpt || 'gpt-image-2';
    const list = uniqueModels([nano, gpt]);
    const selected = resolveImageModel(node.model);
    return list.map(model => `<option value="${escapeHtml(model)}" ${model === selected ? 'selected' : ''}>${escapeHtml(model)}</option>`).join('');
}
async function buildNineGridImageTaskPayload(node, imagePrompt, refs, opts={}){
    const genStub = {
        apiProvider:node.apiProvider || imageApiProviders()[0]?.id || managedProviderId,
        model:resolveImageModel(node.model),
        resolution:opts.resolution || node.resolution || '4k',
        ratio:opts.ratio || node.ratio || 'wide',
        customRatio:'',
        quality:opts.quality || node.quality || 'medium',
    };
    const payload = await buildGeneratorTaskPayload(genStub, imagePrompt, refs);
    payload.nine_grid_agent = true;
    return payload;
}
async function waitForCanvasImageTask(taskId){
    while(true){
        const res = await apiFetch(`/api/canvas-image-tasks/${encodeURIComponent(taskId)}`);
        if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Image task poll failed' : '生图任务查询失败'));
        const data = await res.json();
        if(data.status === 'succeeded') return data.result || {};
        if(data.status === 'failed') throw new Error(data.error || (langIsEn() ? 'Image generation failed' : '生图失败'));
        await sleep(1800);
    }
}
async function fetchCanvasImageTaskResult(taskId){
    const res = await apiFetch(`/api/canvas-image-tasks/${encodeURIComponent(taskId)}`);
    if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Failed to load image task' : '读取生图任务失败'));
    const data = await res.json();
    const result = data.result || {};
    return result.url || (Array.isArray(result.images) ? result.images[0] : '') || '';
}
function addNineGridAgentNode(point){
    const p = point || defaultPoint(200, 0);
    const providerId = imageApiProviders()[0]?.id || managedProviderId || 'runninghub';
    return addNode({
        id:uid('ngrid'),
        type:'nineGridAgent',
        x:p.x,
        y:p.y,
        w:360,
        h:560,
        story:'',
        shots:[],
        refLooks:[],
        gridUrl:null,
        croppedUrls:[],
        cropPadding:0,
        cropGap:0,
        apiProvider:providerId,
        model:models.nano || 'nano-banana-pro',
        resolution:'4k',
        ratio:'wide',
        quality:'medium',
        textModel:CANVAS_AGENT_TEXT_MODELS[0],
        cellEditing:{},
        inputs:[],
        refNames:{},
        lastOutputGroupId:null,
        batchProgress:null,
        runStatus:'idle',
        runError:'',
        running:false,
    });
}
function nineGridAgentStory(node){
    const sources = orderedSources(node, generatorSources(node));
    const promptSrc = sources.find(s => s.prompt && !s.refs?.length);
    const inline = String(node.story || '').trim();
    if(promptSrc?.prompt) return String(promptSrc.prompt).trim();
    return inline;
}
function nineGridAgentRefs(node){
    normalizeNineGridAgentNode(node);
    return collectNineGridRefEntries(node).map((entry, idx) => {
        const custom = String(node.refNames?.[entry.key] || '').trim();
        const fallback = entry.name && !/^edit_result_|\.(png|jpe?g|webp|gif)$/i.test(entry.name) ? entry.name : '';
        return {
            url:entry.url,
            name:custom || fallback || `角色${String(idx + 1).padStart(2, '0')}`,
        };
    }).filter(r => r.url);
}
function nineGridAgentRefsPayload(node){
    return nineGridAgentRefs(node).map((r, idx) => ({
        url:r.url,
        name:r.name || `角色${String(idx + 1).padStart(2, '0')}`,
    }));
}
function updateNineGridAgentProgress(node, phase, current, total){
    node.batchProgress = {phase, current, total};
    // 只改按钮文案，避免运行中 refreshNodes 重建 body 导致输入失焦
    updateNineGridRunButtons(node);
}
function updateNineGridRunButtons(node){
    const el = nodesEl?.querySelector?.(`.node[data-id="${CSS.escape(node.id)}"]`);
    if(!el) return;
    const phaseA = el.querySelector('.nine-grid-phase-a-btn span');
    const phaseB = el.querySelector('.nine-grid-phase-b-btn span');
    const full = el.querySelector('.nine-grid-full-btn span');
    const progress = node.batchProgress || {};
    const runningLabel = langIsEn() ? 'Running…' : '运行中…';
    if(node.running){
        if(phaseA) phaseA.textContent = progress.phase === 'text' ? runningLabel : (langIsEn() ? 'Phase A: Prompts' : '① 生成分镜');
        if(phaseB) phaseB.textContent = progress.phase === 'image' ? runningLabel : (langIsEn() ? 'Phase B: Grid image' : '② 生成大图');
        if(full) full.textContent = runningLabel;
        return;
    }
    if(phaseA) phaseA.textContent = langIsEn() ? 'Phase A: Prompts' : '① 生成分镜';
    if(phaseB) phaseB.textContent = langIsEn() ? 'Phase B: Grid image' : '② 生成大图';
    if(full) full.textContent = langIsEn() ? 'Run all' : '一键全流程';
}
async function nineGridFetchJson(body){
    const res = await apiFetch('/api/generate-9grid', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(body),
    });
    let data = {};
    try { data = await res.json(); } catch(_) {}
    if(!res.ok) throw new Error(data.error || await responseErrorMessage(res, langIsEn() ? 'Nine-grid request failed' : '九宫格请求失败'));
    return data;
}
async function uploadNineGridDataUrls(dataUrls){
    const blobs = (dataUrls || []).map((url, i) => ({
        blob:dataUrlToBlob(url),
        name:`nine_grid_shot_${String(i + 1).padStart(2, '0')}.png`,
    }));
    return uploadImageBlobs(blobs);
}
async function syncNineGridSpawnedOutputs(node, croppedUrls, opts={}){
    if(!Array.isArray(croppedUrls) || !croppedUrls.length) return;
    if(opts.newGroup === true || !node.lastOutputGroupId) node.lastOutputGroupId = uid('ngrid');
    const groupId = node.lastOutputGroupId;
    const refs = nineGridAgentRefs(node);
    const run = runSnapshot(node, langIsEn() ? 'Nine Grid Agent' : '九宫格 Agent', refs);
    const out = outputForNode(node, 460);
    if(out){
        const shots = normalizeNineGridShots(node.shots) || [];
        const imageModel = resolveImageModel(node.model);
        const layout = {type:'grid-split', groupId, rows:3, cols:3};
        const metas = croppedUrls.map((url, i) => ({
            runMs:0,
            run,
            model:imageModel,
            prompt:String(shots[i]?.prompt || '').trim(),
            grid:{...layout, row:Math.floor(i / 3), col:i % 3, w:16, h:9},
        }));
        appendOutputImages(out, croppedUrls, refs[0] || null, metas, layout);
    }
    node.croppedUrls = croppedUrls.slice();
    const refreshIds = [node.id];
    if(out) refreshIds.push(out.id);
    refreshNodes(refreshIds);
    scheduleSave();
}
async function runNineGridPhaseA(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'nineGridAgent' || isNodeDisabled(node)) return;
    const story = nineGridAgentStory(node);
    const refs = nineGridAgentRefsPayload(node);
    if(story.length < 10){
        const msg = langIsEn() ? 'Enter a story (10+ chars) or connect a Prompt node.' : '请输入剧本（至少 10 字）或连接 Prompt 节点。';
        node.runStatus = 'failed';
        node.runError = msg;
        refreshNodes([nodeId]);
        return;
    }
    if(!refs.length){
        const msg = langIsEn() ? 'Connect at least one reference image.' : '请至少连接 1 张参考图。';
        node.runStatus = 'failed';
        node.runError = msg;
        refreshNodes([nodeId]);
        return;
    }
    node.running = true;
    node.runStatus = 'running';
    node.runError = '';
    updateNineGridAgentProgress(node, 'text', 0, 1);
    try {
        const data = await nineGridFetchJson({
            mode:'prompts_only',
            story,
            references:refs,
            textModel:resolveNineGridAgentTextModel(node),
        });
        const shots = normalizeNineGridShots(data.shots);
        if(!shots) throw new Error(langIsEn() ? 'Invalid shots response' : '分镜提示词返回格式异常');
        node.shots = shots;
        node.refLooks = Array.isArray(data.refLooks) ? data.refLooks : [];
        const visionWarn = nineGridRefVisionWarnings(node);
        if(visionWarn.length){
            const labels = visionWarn.map(w => `图${w.index}（${w.name}）`).join('、');
            const hint = langIsEn()
                ? `Vision anchor incomplete for ${labels}. Re-run Phase A if needed; Phase B still uploads all refs.`
                : `参考图 ${labels} 的视觉锚点未完整提取，已用占位约束；建议重跑「生成分镜」。出图阶段仍会上传全部参考图。`;
            node.runError = hint;
        }
        node.gridUrl = null;
        node.croppedUrls = [];
        node.runStatus = 'done';
    } catch(err) {
        node.runStatus = 'failed';
        node.runError = err.message || String(err);
    } finally {
        node.running = false;
        node.batchProgress = null;
        updateNineGridRunButtons(node);
        refreshNodes([nodeId]);
        scheduleSave();
    }
}
async function runNineGridPhaseB(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'nineGridAgent' || isNodeDisabled(node)) return;
    const refs = nineGridAgentRefsPayload(node);
    const shots = normalizeNineGridShots(node.shots);
    if(!refs.length){
        const msg = langIsEn() ? 'Connect at least one reference image.' : '请至少连接 1 张参考图。';
        node.runError = msg;
        node.runStatus = 'failed';
        refreshNodes([nodeId]);
        return;
    }
    if(!shots || shots.some(s => String(s.prompt || '').trim().length < NINE_GRID_SHOT_PROMPT_MIN_CHARS)){
        const msg = langIsEn()
            ? `Run Phase A first; each cell prompt needs at least ${NINE_GRID_SHOT_PROMPT_MIN_CHARS} Chinese characters.`
            : `请先运行 Phase A，并确保每格描述不少于 ${NINE_GRID_SHOT_PROMPT_MIN_CHARS} 字。`;
        node.runError = msg;
        node.runStatus = 'failed';
        refreshNodes([nodeId]);
        return;
    }
    node.running = true;
    node.runStatus = 'running';
    node.runError = '';
    updateNineGridAgentProgress(node, 'image', 0, 1);
    try {
        const imagePrompt = buildNineGridImagePrompt(shots, refs, {
            refLooks:Array.isArray(node.refLooks) ? node.refLooks : [],
            imageModel:resolveImageModel(node.model),
        });
        const payload = await buildNineGridImageTaskPayload(node, imagePrompt, refs);
        const taskInfo = await createCanvasImageTask(payload);
        const result = await waitForCanvasImageTask(taskInfo.task_id);
        const gridUrl = result.url || (Array.isArray(result.images) ? result.images[0] : '') || '';
        if(!gridUrl) throw new Error(langIsEn() ? 'No grid image URL returned' : '未返回九宫格大图 URL');
        node.gridUrl = gridUrl;
        node.running = true;
        updateNineGridAgentProgress(node, 'crop', 0, 1);
        try {
            const dataUrls = await splitNineGridToNine(gridUrl, node.cropPadding || 0, node.cropGap || 0);
            const uploaded = await uploadNineGridDataUrls(dataUrls);
            const urls = uploaded.map(f => f.url).filter(Boolean);
            if(urls.length !== 9) throw new Error(langIsEn() ? 'Upload after split failed' : '切图上传失败');
            await syncNineGridSpawnedOutputs(node, urls, {newGroup:true});
        } catch(cropErr) {
            node.croppedUrls = [];
            node.runError = cropErr.message || String(cropErr);
            node.runStatus = 'failed';
            throw cropErr;
        }
        node.runStatus = 'done';
    } catch(err) {
        node.runStatus = 'failed';
        node.runError = err.message || String(err);
    } finally {
        node.running = false;
        node.batchProgress = null;
        updateNineGridRunButtons(node);
        refreshNodes([nodeId]);
        scheduleSave();
    }
}
async function runNineGridFull(nodeId){
    await runNineGridPhaseA(nodeId);
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.runStatus === 'failed' || !normalizeNineGridShots(node.shots)) return;
    await runNineGridPhaseB(nodeId);
}
async function runNineGridCrop(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'nineGridAgent' || !node.gridUrl || isNodeDisabled(node)) return;
    node.running = true;
    node.runError = '';
    updateNineGridAgentProgress(node, 'crop', 0, 1);
    try {
        const dataUrls = await splitNineGridToNine(node.gridUrl, node.cropPadding || 0, node.cropGap || 0);
        const uploaded = await uploadNineGridDataUrls(dataUrls);
        const urls = uploaded.map(f => f.url).filter(Boolean);
        if(urls.length !== 9) throw new Error(langIsEn() ? 'Upload after split failed' : '切图上传失败');
        await syncNineGridSpawnedOutputs(node, urls);
        node.runStatus = 'done';
    } catch(err) {
        node.runStatus = 'failed';
        node.runError = err.message || String(err);
    } finally {
        node.running = false;
        node.batchProgress = null;
        updateNineGridRunButtons(node);
        refreshNodes([nodeId]);
        scheduleSave();
    }
}
async function runNineGridCellEdit(nodeId, idx){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'nineGridAgent') return;
    normalizeNineGridAgentNode(node);
    const i = Number(idx);
    if(!Number.isFinite(i) || i < 0 || i > 8) return;
    const editing = node.cellEditing || {};
    if(editing[i]) return;
    const prompt = String(node.shots?.[i]?.prompt || '').trim();
    const cropped = Array.isArray(node.croppedUrls) ? node.croppedUrls[i] : '';
    const target = cropped || node.gridUrl || '';
    if(!target || !prompt) return;
    editing[i] = true;
    node.cellEditing = {...editing};
    node.runError = '';
    refreshNodes([nodeId]);
    try {
        const charRefs = nineGridAgentRefs(node);
        const editPrompt = cropped
            ? prompt
            : `只编辑九宫格第${i + 1}格对应内容，其余8格保持不变。${prompt}`;
        const refImages = [
            {url:target, name:`格子${i + 1}`, kind:'image'},
            ...charRefs.map((r, refIdx) => ({
                url:r.url,
                name:r.name || `角色${String(refIdx + 1).padStart(2, '0')}`,
                kind:'image',
            })),
        ];
        const cellResolution = isGptImage2Model(node.model)
            ? (node.resolution === '4k' ? '2k' : (node.resolution || '2k'))
            : '2k';
        const payload = await buildNineGridImageTaskPayload(node, editPrompt, refImages, {
            resolution:cellResolution,
            ratio:'wide',
        });
        const taskInfo = await createCanvasImageTask(payload);
        const result = await waitForCanvasImageTask(taskInfo.task_id);
        const url = result.url || (Array.isArray(result.images) ? result.images[0] : '') || '';
        if(!url) throw new Error(langIsEn() ? 'No image URL returned' : '未返回图片 URL');
        const next = Array.isArray(node.croppedUrls) && node.croppedUrls.length === 9
            ? node.croppedUrls.slice()
            : Array.from({length:9}, () => '');
        next[i] = url;
        await syncNineGridSpawnedOutputs(node, next);
    } catch(err) {
        node.runStatus = 'failed';
        node.runError = err.message || String(err);
    } finally {
        delete editing[i];
        node.cellEditing = {...editing};
        refreshNodes([nodeId]);
        scheduleSave();
    }
}
function renderNineGridShotCells(node){
    const shots = normalizeNineGridShots(node.shots) || [];
    if(!shots.length) {
        return `<div class="nine-grid-empty">${langIsEn() ? 'Run Phase A to generate 9 shot prompts.' : '运行 Phase A 后显示 9 格分镜面板。'}</div>`;
    }
    return `<div class="nine-grid-shot-grid">${shots.map((shot, idx) => {
        const cropped = node.croppedUrls?.[idx] || '';
        const pos = nineGridFallbackSlicePosition(idx);
        const editing = Boolean(node.cellEditing?.[idx]);
        const preview = cropped
            ? `<img src="${escapeAttr(cropped)}" alt="" referrerpolicy="no-referrer" />`
            : node.gridUrl
                ? `<div class="nine-grid-slice-wrap"><img src="${escapeAttr(node.gridUrl)}" alt="" referrerpolicy="no-referrer" style="left:-${pos.col * 100}%;top:-${pos.row * 100}%;" /></div>`
                : `<div class="nine-grid-shot-placeholder">${langIsEn() ? 'Waiting' : '等待'}</div>`;
        return `<div class="nine-grid-shot-cell" data-shot-idx="${idx}">
            <div class="nine-grid-shot-head">
                <span>${langIsEn() ? 'Cell' : '格子'} ${shot.n}</span>
                <button type="button" class="nine-grid-cell-edit-btn ${editing ? 'running' : ''}" data-ngrid-edit="${idx}" ${editing ? 'disabled' : ''}>${editing ? (langIsEn() ? 'Editing…' : '编辑中…') : (langIsEn() ? 'Edit' : '编辑')}</button>
            </div>
            <div class="nine-grid-shot-preview">${preview}</div>
            <textarea class="nine-grid-shot-prompt" data-ngrid-prompt="${idx}" rows="3">${escapeHtml(shot.prompt || '')}</textarea>
        </div>`;
    }).join('')}</div>`;
}
function renderNineGridAgentBody(node){
    normalizeNineGridAgentNode(node);
    if(!Array.isArray(node.shots)) node.shots = [];
    if(!Array.isArray(node.croppedUrls)) node.croppedUrls = [];
    const refs = nineGridAgentRefs(node);
    const story = nineGridAgentStory(node);
    const wrap = document.createElement('div');
    wrap.className = 'generator-body nine-grid-agent-body';
    const scroll = document.createElement('div');
    scroll.className = 'nine-grid-scroll';
    scroll.innerHTML = `
        <div class="nine-grid-section">
            <div class="nine-grid-section-title">${langIsEn() ? 'Story' : '剧本'}</div>
            <textarea class="nine-grid-story-input" placeholder="${escapeAttr(langIsEn() ? 'Story or connect Prompt upstream…' : '粘贴剧本，或上游连接 Prompt…')}">${escapeHtml(node.story || '')}</textarea>
            ${story && story !== String(node.story || '').trim() ? `<div class="nine-grid-hint">${escapeHtml(langIsEn() ? 'Using upstream Prompt' : '当前使用上游 Prompt')}</div>` : ''}
        </div>
        <div class="nine-grid-section">
            <div class="nine-grid-section-title">${langIsEn() ? 'References' : '参考图'} · ${refs.length}</div>
            <div class="input-list nine-grid-input-list"></div>
        </div>
        <div class="nine-grid-section nine-grid-crop-row">
            <label><span>Padding</span><input type="number" class="nine-grid-padding setting-input" min="0" max="200" value="${Number(node.cropPadding || 0)}"></label>
            <label><span>Gap</span><input type="number" class="nine-grid-gap setting-input" min="0" max="200" value="${Number(node.cropGap || 0)}"></label>
            <button type="button" class="nine-grid-estimate-gap-btn">${langIsEn() ? 'Estimate seam' : '估算 seam'}</button>
        </div>
        <div class="nine-grid-section">
            <label class="nine-grid-model-field">
                <span>${langIsEn() ? 'Text model' : '文本模型'}</span>
                <select class="nine-grid-text-model setting-input">${agentTextModelOptions(resolveNineGridAgentTextModel(node))}</select>
            </label>
            <label class="nine-grid-model-field">
                <span>${langIsEn() ? 'Image model' : '生图模型'}</span>
                <select class="nine-grid-model setting-input">${nineGridImageModelOptions(node)}</select>
            </label>
            ${isGptImage2Model(node.model) ? `
            <label class="nine-grid-model-field">
                <span>${langIsEn() ? 'Quality' : '质量'}</span>
                <select class="nine-grid-quality setting-input">
                    <option value="low" ${node.quality === 'low' ? 'selected' : ''}>low</option>
                    <option value="medium" ${node.quality === 'medium' ? 'selected' : ''}>medium</option>
                    <option value="high" ${node.quality === 'high' ? 'selected' : ''}>high</option>
                </select>
            </label>` : ''}
            <label class="nine-grid-model-field">
                <span>${langIsEn() ? 'Resolution' : '分辨率'}</span>
                <select class="nine-grid-resolution setting-input">
                    <option value="1k" ${node.resolution === '1k' ? 'selected' : ''}>1K</option>
                    <option value="2k" ${node.resolution === '2k' ? 'selected' : ''}>2K</option>
                    <option value="4k" ${node.resolution === '4k' ? 'selected' : ''}>4K</option>
                </select>
            </label>
        </div>
        <div class="nine-grid-section nine-grid-shots-section">${renderNineGridShotCells(node)}</div>
        ${node.runError ? `<div class="replica-run-error">${escapeHtml(node.runError)}</div>` : ''}
    `;
    const runRow = document.createElement('div');
    runRow.className = 'gen-run-row nine-grid-run-row';
    runRow.innerHTML = `
        <button type="button" class="gen-btn nine-grid-phase-a-btn ${node.running ? 'running' : ''}"><span>${langIsEn() ? 'Phase A: Prompts' : '① 生成分镜'}</span></button>
        <button type="button" class="gen-btn nine-grid-phase-b-btn ${node.running ? 'running' : ''}"><span>${langIsEn() ? 'Phase B: Grid image' : '② 生成大图'}</span></button>
        <button type="button" class="gen-btn nine-grid-full-btn ${node.running ? 'running' : ''}"><span>${langIsEn() ? 'Run all' : '一键全流程'}</span></button>
        <button type="button" class="gen-btn nine-grid-crop-btn ${node.running ? 'running' : ''}" ${!node.gridUrl || isNodeDisabled(node) ? 'disabled' : ''}><span>${langIsEn() ? 'Re-crop 9' : '重新切 9 张'}</span></button>
    `;
    wrap.appendChild(scroll);
    wrap.appendChild(runRow);
    bindNineGridAgentControls(wrap, node);
    const sources = orderedSources(node, generatorSources(node));
    const imageInputs = sources
        .map(src => ({...src, refs:imageRefsOnly(src.refs || [])}))
        .filter(src => src.refs?.length);
    renderNineGridRefList(wrap.querySelector('.nine-grid-input-list'), node, langIsEn() ? 'Connect reference images' : '请连接参考图');
    return wrap;
}
function bindNineGridAgentControls(wrap, node){
    if(!wrap || !node) return;
    const storyEl = wrap.querySelector('.nine-grid-story-input');
    if(storyEl){
        bindScrollableText(storyEl);
        storyEl.oninput = e => {
            node.story = e.target.value;
            scheduleSave();
        };
        storyEl.onmousedown = e => e.stopPropagation();
    }
    const padEl = wrap.querySelector('.nine-grid-padding');
    if(padEl){
        padEl.oninput = e => {
            node.cropPadding = Math.max(0, Math.min(200, Number(padEl.value || 0)));
            scheduleSave();
        };
        padEl.onmousedown = e => e.stopPropagation();
    }
    const gapEl = wrap.querySelector('.nine-grid-gap');
    if(gapEl){
        gapEl.oninput = e => {
            node.cropGap = Math.max(0, Math.min(200, Number(gapEl.value || 0)));
            scheduleSave();
        };
        gapEl.onmousedown = e => e.stopPropagation();
    }
    const modelEl = wrap.querySelector('.nine-grid-model');
    const textModelEl = wrap.querySelector('.nine-grid-text-model');
    if(textModelEl){
        textModelEl.onchange = e => {
            e.stopPropagation();
            node.textModel = clampAgentTextModel(textModelEl.value);
            scheduleSave();
        };
        textModelEl.onmousedown = e => e.stopPropagation();
    }
    if(modelEl){
        modelEl.onchange = e => {
            e.stopPropagation();
            node.model = resolveImageModel(modelEl.value);
            if(!isGptImage2Model(node.model)) node.quality = 'auto';
            else if(!node.quality || node.quality === 'auto') node.quality = 'medium';
            scheduleSave();
            refreshNodes([node.id]);
        };
        modelEl.onmousedown = e => e.stopPropagation();
    }
    const qualityEl = wrap.querySelector('.nine-grid-quality');
    if(qualityEl){
        qualityEl.onchange = e => {
            e.stopPropagation();
            node.quality = qualityEl.value;
            scheduleSave();
        };
        qualityEl.onmousedown = e => e.stopPropagation();
    }
    const resolutionEl = wrap.querySelector('.nine-grid-resolution');
    if(resolutionEl){
        resolutionEl.onchange = e => {
            e.stopPropagation();
            node.resolution = resolutionEl.value;
            scheduleSave();
        };
        resolutionEl.onmousedown = e => e.stopPropagation();
    }
    const sortedShots = normalizeNineGridShots(node.shots) || [];
    wrap.querySelectorAll('[data-ngrid-prompt]').forEach(ta => {
        bindScrollableText(ta);
        const idx = Number(ta.dataset.ngridPrompt);
        const promptText = String(sortedShots[idx]?.prompt || '').trim();
        if(promptText) ta.value = promptText;
        ta.oninput = e => {
            if(!Array.isArray(node.shots)) node.shots = [];
            const shotN = sortedShots[idx]?.n ?? idx + 1;
            const raw = node.shots.find(s => Number(s?.n || 0) === shotN) || node.shots[idx];
            if(raw) raw.prompt = e.target.value;
            scheduleSave();
        };
        ta.onmousedown = e => e.stopPropagation();
    });
    wrap.querySelectorAll('[data-ngrid-edit]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            void runNineGridCellEdit(node.id, btn.dataset.ngridEdit);
        };
    });
    const estBtn = wrap.querySelector('.nine-grid-estimate-gap-btn');
    if(estBtn){
        estBtn.onmousedown = e => e.stopPropagation();
        estBtn.onclick = e => {
            e.stopPropagation();
            if(!node.gridUrl) return;
            void estimateNineGridGap(node.gridUrl).then(gap => {
                node.cropGap = gap;
                if(gapEl) gapEl.value = String(gap);
                scheduleSave();
                refreshNodes([node.id]);
            }).catch(err => {
                node.runError = err.message || String(err);
                refreshNodes([node.id]);
            });
        };
    }
    wrap.querySelector('.nine-grid-phase-a-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        void runNineGridPhaseA(node.id);
    });
    wrap.querySelector('.nine-grid-phase-b-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        void runNineGridPhaseB(node.id);
    });
    wrap.querySelector('.nine-grid-full-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        void runNineGridFull(node.id);
    });
    wrap.querySelector('.nine-grid-crop-btn')?.addEventListener('click', e => {
        e.stopPropagation();
        void runNineGridCrop(node.id);
    });
    updateNineGridRunButtons(node);
}
function runNineGridFromButton(nodeId, phase, event){
    event?.preventDefault?.();
    event?.stopPropagation?.();
    if(phase === 'a') void runNineGridPhaseA(nodeId);
    else if(phase === 'b') void runNineGridPhaseB(nodeId);
    else void runNineGridFull(nodeId);
}
window.runNineGridFromButton = runNineGridFromButton;
function bindBatchPosterAgentControls(wrap, node){
    if(!wrap || !node) return;
    const countInput = wrap.querySelector('.batch-poster-count');
    if(countInput){
        countInput.value = String(Math.max(1, Math.min(10, Number(node.batch_count || 3))));
        countInput.oninput = e => {
            e.stopPropagation();
            node.batch_count = Math.max(1, Math.min(10, Number(countInput.value || 3)));
            scheduleSave();
        };
        countInput.onmousedown = e => e.stopPropagation();
    }
    const presetSelect = wrap.querySelector('.batch-poster-preset');
    if(presetSelect){
        presetSelect.value = normalizeBatchPosterPreset(node.selectedPreset);
        presetSelect.onchange = e => {
            e.stopPropagation();
            node.selectedPreset = normalizeBatchPosterPreset(presetSelect.value);
            if(normalizeBatchPosterPreset(node.selectedPreset) === 'random') node.selectedThemeId = null;
            refreshBatchPosterSpecificThemeSelect(wrap, node, batchPosterThemeCatalogCache);
            syncBatchPosterThemeControls(wrap, node);
            scheduleSave();
        };
        presetSelect.onmousedown = e => e.stopPropagation();
    }
    wrap.querySelectorAll('.batch-poster-theme-segment').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            const next = normalizeBatchPosterThemeSource(btn.dataset.themeSource, node);
            if(next === node.theme_source) return;
            node.theme_source = next;
            if(next === 'preset') node.custom_theme = normalizeBatchPosterCustomTheme(node.custom_theme);
            else node.selectedThemeId = null;
            syncBatchPosterThemeControls(wrap, node);
            scheduleSave();
        };
    });
    const customThemeInput = wrap.querySelector('.batch-poster-custom-theme');
    if(customThemeInput){
        customThemeInput.onmousedown = e => e.stopPropagation();
        customThemeInput.onclick = e => e.stopPropagation();
        customThemeInput.oninput = e => {
            e.stopPropagation();
            node.custom_theme = normalizeBatchPosterCustomTheme(customThemeInput.value);
            scheduleSave();
        };
    }
    const themeSelect = wrap.querySelector('.batch-poster-specific-theme');
    if(themeSelect){
        themeSelect.onchange = e => {
            e.stopPropagation();
            node.selectedThemeId = normalizeBatchPosterThemeId(themeSelect.value);
            syncBatchPosterThemeControls(wrap, node);
            scheduleSave();
        };
        themeSelect.onmousedown = e => e.stopPropagation();
    }
    const textModelSelect = wrap.querySelector('.batch-poster-text-model');
    if(textModelSelect){
        textModelSelect.onchange = e => {
            e.stopPropagation();
            node.model = clampAgentTextModel(textModelSelect.value);
            scheduleSave();
        };
        textModelSelect.onmousedown = e => e.stopPropagation();
    }
    const imageModelSelect = wrap.querySelector('.batch-poster-image-model');
    if(imageModelSelect){
        imageModelSelect.onchange = e => {
            e.stopPropagation();
            node.imageModel = resolveImageModel(imageModelSelect.value);
            scheduleSave();
        };
        imageModelSelect.onmousedown = e => e.stopPropagation();
    }
    const pipelineSelect = wrap.querySelector('.batch-poster-pipeline');
    if(pipelineSelect){
        pipelineSelect.onchange = e => {
            e.stopPropagation();
            node.pipelineMode = normalizeBatchPosterPipelineMode(pipelineSelect.value);
            syncBatchPosterPipelineUi(wrap, node);
            scheduleSave();
        };
        pipelineSelect.onmousedown = e => e.stopPropagation();
    }
    syncBatchPosterPipelineUi(wrap, node);
    const extractTitlesBtn = wrap.querySelector('.batch-poster-extract-titles-btn');
    if(extractTitlesBtn){
        extractTitlesBtn.onmousedown = e => e.stopPropagation();
        extractTitlesBtn.onclick = e => {
            e.stopPropagation();
            e.preventDefault();
            void prefetchBatchPosterTitleCopyForNode(node, {force:true});
        };
    }
    void ensureBatchPosterThemeCatalog().then(catalog => {
        refreshBatchPosterSpecificThemeSelect(wrap, node, catalog);
        syncBatchPosterThemeControls(wrap, node);
    });
    const basePromptEl = wrap.querySelector('.batch-poster-base-prompt');
    if(basePromptEl){
        basePromptEl.value = node.base_prompt || BATCH_POSTER_BASE_PROMPT;
        basePromptEl.readOnly = true;
    }
    const runBtn = wrap.querySelector('.batch-poster-run-btn');
    if(runBtn){
        runBtn.onclick = e => runBatchPosterFromButton(node.id, e);
        runBtn.onmousedown = e => e.stopPropagation();
    }
    bindReplicaAgentSizeControls(wrap, node, batchPosterAgentPosterRef(node)?.url || '');
    syncBatchPosterSelectedAspectRatio(node);
    syncBatchPosterThemeControls(wrap, node);
    updateBatchPosterRunButton(node);
}
function renderBatchPosterAgentBody(node){
    normalizeBatchPosterAgentNode(node);
    reconcileBatchPosterAgentRunState(node);
    if(!node.base_prompt) node.base_prompt = BATCH_POSTER_BASE_PROMPT;
    if(!node.selectedPreset) node.selectedPreset = 'random';
    if(node.selectedThemeId != null) node.selectedThemeId = normalizeBatchPosterThemeId(node.selectedThemeId);
    node.custom_theme = normalizeBatchPosterCustomTheme(node.custom_theme);
    node.theme_source = normalizeBatchPosterThemeSource(node.theme_source, node);
    const wrap = document.createElement('div');
    wrap.className = 'generator-body batch-poster-agent-body';
    const scroll = document.createElement('div');
    scroll.className = 'batch-poster-scroll';
    scroll.innerHTML = `
        <div class="batch-poster-section">
            <div class="batch-poster-section-title">${langIsEn() ? 'Image input' : '图片输入'}</div>
            <div class="input-list batch-poster-input-list"></div>
        </div>
        <div class="batch-poster-section">
            <label class="batch-poster-field">
                <span class="batch-poster-field-label">Batch Count</span>
                <input class="batch-poster-count setting-input" type="number" min="1" max="10" step="1" value="${Math.max(1, Math.min(10, Number(node.batch_count || 3)))}">
            </label>
            ${batchPosterThemeSectionHtml(node)}
            ${batchPosterPipelineSelectHtml(node)}
            ${batchPosterPlanBCopySectionHtml(node)}
            <label class="batch-poster-field">
                <span class="batch-poster-field-label">${langIsEn() ? 'Text model' : '文本模型'}</span>
                <select class="batch-poster-text-model setting-input">${agentTextModelOptions(resolveBatchPosterChatModel(node))}</select>
            </label>
            <label class="batch-poster-field batch-poster-image-model-field">
                <span class="batch-poster-field-label">${langIsEn() ? 'Image model' : '生图模型'}</span>
                <select class="batch-poster-image-model setting-input">${batchPosterImageModelOptions(node)}</select>
            </label>
        </div>
        ${replicaAgentSizeSettingsHtml(node)}
        <div class="batch-poster-section">
            <label class="batch-poster-field">
                <span class="batch-poster-field-label">Base Prompt</span>
                <textarea class="batch-poster-base-prompt replica-style-input" rows="5" readonly tabindex="-1">${escapeHtml(node.base_prompt || BATCH_POSTER_BASE_PROMPT)}</textarea>
            </label>
        </div>
        ${node.runError ? `<div class="replica-run-error">${escapeHtml(node.runError)}</div>` : ''}
    `;
    const runRow = document.createElement('div');
    runRow.className = 'gen-run-row batch-poster-run-row';
    const batchPosterBtn = agentPendingRunState(node.id, langIsEn() ? 'Run Batch' : '一键批量生成', langIsEn() ? 'Generating' : '生成中');
    runRow.innerHTML = agentGenRunActionsHtml(node.id, `<button type="button" class="gen-btn batch-poster-run-btn ${batchPosterBtn.runningCls}"><i data-lucide="layers" class="w-4 h-4"></i><span>${escapeHtml(batchPosterBtn.label)}</span></button>`);
    wrap.appendChild(scroll);
    wrap.appendChild(runRow);
    bindBatchPosterAgentControls(wrap, node);
    bindCascadeButtons(wrap, node.id);
    const sources = orderedSources(node, generatorSources(node));
    const imageInputs = sources
        .map(src => ({...src, refs:imageRefsOnly(src.refs || [])}))
        .filter(src => src.refs?.length);
    renderImageInputList(wrap.querySelector('.batch-poster-input-list'), node, imageInputs, langIsEn() ? 'Connect a reference poster image' : '请连接参考海报图');
    void prefetchBatchPosterTitleCopyForNode(node);
    return wrap;
}
function imageRepairAgentSourceImage(node, ctx=loopContext){
    const sources = orderedSources(node, generatorSources(node, ctx));
    const refs = imageRefsOnly(sources.flatMap(s => s.refs || []));
    return refs[0] || null;
}
function bindImageRepairAgentControls(wrap, node){
    if(!wrap || !node) return;
    const textSelect = wrap.querySelector('.image-repair-text-model');
    if(textSelect){
        textSelect.onmousedown = e => e.stopPropagation();
        textSelect.onclick = e => e.stopPropagation();
        textSelect.onchange = e => {
            e.stopPropagation();
            node.textModel = clampAgentTextModel(textSelect.value);
            scheduleSave();
        };
    }
    const imageSelect = wrap.querySelector('.image-repair-image-model');
    if(imageSelect){
        imageSelect.onmousedown = e => e.stopPropagation();
        imageSelect.onclick = e => e.stopPropagation();
        imageSelect.onchange = e => {
            e.stopPropagation();
            node.imageModel = resolveImageModel(imageSelect.value);
            scheduleSave();
        };
    }
    bindReplicaAgentSizeControls(wrap, node, imageRepairAgentSourceImage(node)?.url || '');
    bindAgentCountControls(wrap, node, {inputSelector: '.image-repair-count-input', stepAttr: 'data-repair-step'});
}
function renderImageRepairAgentBody(node){
    if(node.running){
        const hasPending = nodes.some(n => n.type === 'output' && (n._pending || []).some(p => p.run?.node?.id === node.id));
        if(!hasPending){
            node.running = false;
            if(node.runStatus === 'running') node.runStatus = 'idle';
        }
    }
    const source = imageRepairAgentSourceImage(node);
    const srcOk = Boolean(source?.url);
    const runError = String(node.runError || '').trim();
    const wrap = document.createElement('div');
    wrap.className = 'generator-body image-repair-agent-body';
    const scroll = document.createElement('div');
    scroll.className = 'replica-agent-scroll';
    scroll.innerHTML = `
        <div class="replica-status-row">
            <div class="replica-status-badge ${srcOk ? 'ok' : 'warn'}"><i data-lucide="image" class="w-3.5 h-3.5"></i><span>${srcOk ? (langIsEn() ? 'Source image ready' : '已连接待修复图片') : (langIsEn() ? 'Connect source image' : '请连接待修复图片')}</span></div>
        </div>
        ${runError ? `<div class="replica-run-error">${escapeHtml(runError)}</div>` : ''}
        <label class="replica-field">
            <span class="replica-field-label">${langIsEn() ? 'Text model (reverse prompt)' : '文本模型（反推提示词）'}</span>
            <select class="image-repair-text-model setting-input">${agentTextModelOptions(resolveImageRepairAgentTextModel(node))}</select>
        </label>
        <label class="replica-field">
            <span class="replica-field-label">${langIsEn() ? 'Image model (lineart & composite)' : '生图模型（线稿与合成）'}</span>
            <select class="image-repair-image-model setting-input">${imageRepairAgentImageModelOptions(node)}</select>
        </label>
        ${replicaAgentSizeSettingsHtml(node)}
        <div class="replica-section">
            <div class="replica-section-title">${langIsEn() ? 'Batch count' : '批量数量'}</div>
            <div class="replica-marker-hint">${langIsEn() ? 'Each click runs this many repairs; you can click again while tasks are running.' : '每次点击按此数量启动修复；运行中可继续点击追加任务。'}</div>
            ${agentCountStepperHtml(node, 'image-repair-count-input setting-input', 'data-repair-step')}
        </div>
        <div class="replica-section">
            <div class="replica-section-title">${langIsEn() ? 'Pipeline' : '修复流程'}</div>
            <div class="replica-marker-hint">${langIsEn() ? '1) Reverse generation logic → 2) Line art → 3) Blur color ref (gpt-image-2) → 4) Composite restore' : '1）反推生成逻辑 → 2）提取线稿 → 3）模糊固有色参考（gpt-image-2）→ 4）线稿+模糊合成修复'}</div>
        </div>
    `;
    const pendingN = agentPendingCount(node.id);
    const runRow = document.createElement('div');
    runRow.className = 'gen-run-row replica-run-row';
    const btnLabel = pendingN > 0
        ? (langIsEn() ? `Repairing (${pendingN})…` : `修复中 (${pendingN})…`)
        : (langIsEn() ? 'Run repair' : '开始修复');
    runRow.innerHTML = `${agentGenRunActionsHtml(node.id, `<button type="button" class="gen-btn image-repair-run-btn ${pendingN > 0 ? 'running' : ''}" onclick="runImageRepairAgentFromButton('${node.id}', event)"><i data-lucide="wand-sparkles" class="w-4 h-4"></i><span>${btnLabel}</span></button>`)}${cascadeBtnHtml(node)}`;
    wrap.appendChild(scroll);
    wrap.appendChild(runRow);
    bindImageRepairAgentControls(wrap, node);
    bindCascadeButtons(wrap, node.id);
    return wrap;
}
function renderReplicaAgentBody(node){
    syncReplicaAgentRoles(node);
    if(node.running){
        const hasPending = nodes.some(n => n.type === 'output' && (n._pending || []).some(p => p.run?.node?.id === node.id));
        if(!hasPending){
            node.running = false;
            if(node.runStatus === 'running') node.runStatus = 'idle';
        }
    }
    const {background, character, characters, images} = replicaAgentRoleImages(node);
    const bgOk = Boolean(background?.url);
    const charCount = characters.length;
    const charOk = charCount > 0;
    const targetMarkers = normalizeReplicaTargetMarkers(node);
    const runError = String(node.runError || '').trim();
    const wrap = document.createElement('div');
    wrap.className = 'generator-body replica-agent-body';
    const scroll = document.createElement('div');
    scroll.className = 'replica-agent-scroll';
    scroll.innerHTML = `
        <div class="replica-status-row">
            <div class="replica-status-badge ${bgOk ? 'ok' : 'warn'}"><i data-lucide="image" class="w-3.5 h-3.5"></i><span>${bgOk ? (langIsEn() ? 'Background ready (图1)' : '已连接背景/构图参考（图1）') : (langIsEn() ? 'Connect background (图1)' : '请连接背景/构图参考（图1）')}</span></div>
            <div class="replica-status-badge ${charOk ? 'ok' : 'neutral'}"><i data-lucide="user" class="w-3.5 h-3.5"></i><span>${charOk ? (langIsEn() ? `${charCount} character ref(s) ready` : `已连接 ${charCount} 张角色参考`) : (langIsEn() ? 'Character ref optional' : '角色参考可选')}</span></div>
        </div>
        ${runError ? `<div class="replica-run-error">${escapeHtml(runError)}</div>` : ''}
        <label class="replica-field">
            <span class="replica-field-label">${langIsEn() ? 'Text model (vision)' : '文本模型（画面分析）'}</span>
            <select class="replica-text-model setting-input">${agentTextModelOptions(resolveReplicaAgentTextModel(node))}</select>
        </label>
        ${replicaAgentSizeSettingsHtml(node)}
        <div class="replica-section">
            <div class="replica-section-title">${langIsEn() ? 'Style constraints' : '风格限定'}</div>
            <textarea class="replica-style-input" placeholder="${langIsEn() ? 'Describe style constraints…' : '输入风格限定词…'}">${escapeHtml(node.style_prompt || '')}</textarea>
        </div>
        <div class="replica-section">
            <div class="replica-section-title">${langIsEn() ? 'Swap targets (multi-select)' : '换人目标（可多选）'}</div>
            <div class="replica-marker-chips">
                ${[1,2,3,4,5].map(n => `<button type="button" class="replica-marker-chip ${targetMarkers.includes(n) ? 'active' : ''}" data-marker="${n}">${circledNumber(n)}</button>`).join('')}
            </div>
            <div class="replica-marker-hint">${langIsEn() ? 'Use brush → Place label → ①②③ on each character in BOTH keyframe and ref sheet (not emoji). Numbers must match: ① on pig in frame = ① on pig in ref. Select all target numbers below. Do not use tiny stickers the model cannot read.' : '请用「编辑图片 → 画笔 → 放置编号 → ①②③」分别标在关键帧与角色对照表的每个角色上（不要用 emoji）。编号必须一一对应：关键帧猪=①，对照表猪也=①。下方换人目标请全选要换的编号。编号请足够大，避免过小贴纸模型无法识别。'}</div>
        </div>
        <div class="replica-section replica-section-roles">
            <div class="replica-section-title">${langIsEn() ? 'Role mapping' : '角色映射'}${images.length ? ` · ${images.length}` : ''}</div>
            <div class="replica-role-list"></div>
        </div>
    `;
    const runRow = document.createElement('div');
    runRow.className = 'gen-run-row replica-run-row';
    const upstreamLoop = resolveCascadeLoop(node.id);
    const batchLabel = upstreamLoop && upstreamLoop.count > 1
        ? (langIsEn() ? `Run all ${upstreamLoop.count} rounds` : `批量复刻 ${upstreamLoop.count} 轮`)
        : (langIsEn() ? 'Run replica' : '开始复刻');
    const replicaBtn = agentPendingRunState(node.id, batchLabel, langIsEn() ? 'Running' : '运行中');
    runRow.innerHTML = `${agentGenRunActionsHtml(node.id, `<button type="button" class="gen-btn replica-run-btn ${replicaBtn.runningCls}" onclick="runReplicaAgentFromButton('${node.id}', event)"><i data-lucide="zap" class="w-4 h-4"></i><span>${escapeHtml(replicaBtn.label)}</span></button>`)}${cascadeBtnHtml(node)}`;
    wrap.appendChild(scroll);
    wrap.appendChild(runRow);
    bindCascadeButtons(wrap, node.id);
    const textModelSelect = scroll.querySelector('.replica-text-model');
    if(textModelSelect){
        textModelSelect.onmousedown = e => e.stopPropagation();
        textModelSelect.onchange = e => {
            e.stopPropagation();
            node.textModel = clampAgentTextModel(textModelSelect.value);
            scheduleSave();
        };
    }
    const textarea = scroll.querySelector('.replica-style-input');
    bindScrollableText(textarea);
    textarea.oninput = e => {
        node.style_prompt = e.target.value;
        scheduleSave();
    };
    const markerChips = scroll.querySelectorAll('.replica-marker-chip');
    markerChips.forEach(chip => {
        chip.onmousedown = e => e.stopPropagation();
        chip.onclick = e => {
            e.stopPropagation();
            const n = Math.max(1, Math.min(5, Number(chip.dataset.marker) || 1));
            let markers = normalizeReplicaTargetMarkers(node);
            if(markers.includes(n)){
                if(markers.length <= 1) return;
                markers = markers.filter(m => m !== n);
            } else {
                markers = [...markers, n].sort((a, b) => a - b);
            }
            node.replica_target_markers = markers;
            scheduleSave();
            markerChips.forEach(btn => {
                const v = Number(btn.dataset.marker);
                btn.classList.toggle('active', markers.includes(v));
            });
        };
    });
    renderReplicaAgentRoleMapper(scroll.querySelector('.replica-role-list'), node);
    bindReplicaAgentSizeControls(scroll, node, background?.url || '');
    return wrap;
}
function runReplicaAgentFromButton(nodeId, event){
    event?.preventDefault?.();
    event?.stopPropagation?.();
    void runReplicaAgent(nodeId);
}
window.runReplicaAgentFromButton = runReplicaAgentFromButton;
function outputPendingHtml(p){
    const label = p.stageLabel || formatRunDuration(nowMs() - Number(p.startedAt || nowMs()));
    return `<div class="output-img-wrap loading-wrap" data-pending-id="${escapeAttr(p.id)}"><div class="output-pending-waves" aria-hidden="true"><span></span><span></span><span></span></div><span class="output-time-pill running">${escapeHtml(label)}</span><button class="output-del" title="${tr('common.delete')}">×</button></div>`;
}
function canvasLocalUploadPath(url){
    const raw = String(url || '').trim();
    if(!raw) return '';
    if(raw.startsWith('/uploads/')) return raw;
    try {
        const parsed = new URL(raw, window.location.origin);
        if(parsed.pathname.startsWith('/uploads/')) return parsed.pathname;
    } catch(_) {}
    return raw;
}
function replicaAgentRoleImages(node, ctx=loopContext){
    syncReplicaAgentRoles(node);
    const images = replicaAgentUpstreamImages(node, ctx);
    let background = images.find(img => node.roles?.[img.id] === 'background') || null;
    if(ctx?.nodeId && ctx?.index){
        const loopFrame = images.find(img => String(img.id || '').startsWith(`${ctx.nodeId}:image:${ctx.index}:`));
        if(loopFrame?.url) background = loopFrame;
    }
    if(!background?.url){
        background = images.find(img => node.roles?.[img.id] === 'background')
            || images[0]
            || null;
    }
    const bgKey = background ? `${background.id}::${background.url}` : '';
    const characters = images.filter(img => {
        if(node.roles?.[img.id] !== 'character') return false;
        if(background && `${img.id}::${img.url}` === bgKey) return false;
        return true;
    });
    const character = characters[0] || null;
    return {background, character, characters, images};
}
async function replicaAgentRatioForRun(node, background){
    if(node?.ratio && node.ratio !== 'source'){
        return {
            canvas_ratio:node.ratio,
            canvas_custom_ratio:node.customRatio || '',
        };
    }
    if(!background?.url){
        return {canvas_ratio:node?.ratio === 'source' ? 'wide' : (node?.ratio || 'wide')};
    }
    try {
        const dims = await Promise.race([
            getImageDimensions(background.url),
            sleep(8000).then(() => { throw new Error(langIsEn() ? 'Image dimension read timed out' : '读取图片尺寸超时'); }),
        ]);
        const ratio = dims.width / Math.max(1, dims.height);
        if(ratio > 1.05) return {canvas_ratio:'wide'};
        if(ratio < 0.95) return {canvas_ratio:'story'};
        return {canvas_ratio:'square'};
    } catch(_) {
        return {canvas_ratio:node?.ratio || 'wide'};
    }
}
async function runReplicaAgent(nodeId, opts={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'replicaAgent' || isNodeDisabled(node)) return;
    if(!opts.cascade){
        const loop = resolveCascadeLoop(nodeId);
        if(loop && loop.count > 1){
            return runNodeCascade(nodeId);
        }
    }
    const loopCtx = opts.loopContext !== undefined ? opts.loopContext : loopContext;
    const {background, characters} = replicaAgentRoleImages(node, loopCtx);
    if(!background?.url){
        const msg = langIsEn()
            ? 'Connect an image to this node and assign it as background/keyframe (图1).'
            : '请连接图片节点，并在角色映射中指定「背景/构图参考」（图1）。';
        node.runStatus = 'failed';
        node.runError = msg;
        refreshNodes([nodeId]);
        return;
    }
    if(!opts.cascade){
        node.runStatus = 'running';
        node.runError = '';
        refreshNodes([nodeId]);
        setStatus(langIsEn() ? 'Starting replica Agent…' : '正在启动复刻 Agent…');
    }
    const upstreamPrompts = orderedSources(node, generatorSources(node, loopCtx))
        .map(s => s.prompt)
        .filter(Boolean);
    const ratioPayload = await replicaAgentRatioForRun(node, background);
    console.info('[replica-agent] run', {
        nodeId: node.id,
        background: background.url,
        characters: characters.map(c => c.url),
        markers: normalizeReplicaTargetMarkers(node),
    });
    const refs = [background, ...characters].filter(r => r?.url).map(r => ({url:r.url, name:r.name || 'image'}));
    let out = outputForNode(node, 460);
    const run = runSnapshot(node, node.style_prompt ? `复刻 Agent：${node.style_prompt}` : '复刻 Agent 双阶段生图', refs);
    const pendingId = uid('p');
    try {
        const res = await apiFetch('/api/canvas/replica-agent-run', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                background_image_url:canvasLocalUploadPath(background.url),
                character_image_urls:characters.map(r => canvasLocalUploadPath(r.url)),
                style_prompt:node.style_prompt || '',
                upstream_prompts:upstreamPrompts,
                canvas_resolution:node.resolution || '2k',
                canvas_ratio:ratioPayload.canvas_ratio,
                canvas_custom_ratio:ratioPayload.canvas_custom_ratio || '',
                replica_target_markers:normalizeReplicaTargetMarkers(node),
                gemini_model:resolveReplicaAgentTextModel(node),
            })
        });
        if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Replica Agent failed to start' : '复刻 Agent 启动失败'));
        const data = await res.json();
        if(out) out._pending = [...(out._pending || []), makePending(pendingId, run, {
            canvasTaskId:data.task_id,
            canvasTaskType:'replica-agent',
            stageLabel:langIsEn() ? 'Analyzing frame…' : '正在分析画面…',
            appendGenerated:Boolean(opts.cascade)
        })];
        refreshRunNodes(node, out);
        scheduleSave();
        await saveCanvas();
        if(opts.cascade){
            const status = await pollReplicaAgentTask(data.task_id);
            if(status !== 'completed') throw new Error(node.runError || (langIsEn() ? 'Replica Agent failed' : '复刻 Agent 失败'));
            node.runStatus = 'done';
            node.runError = '';
        } else {
            syncAppendableNodeRunState(node);
            void pollReplicaAgentTask(data.task_id);
        }
    } catch(err) {
        if(!opts.cascade){
            syncAgentRunStatusAfterTask(node, {failed:agentPendingCount(node.id) === 0, error:err.message || String(err)});
        } else {
            node.runStatus = 'failed';
            node.runError = err.message || String(err);
        }
        refreshRunNodes(node, out);
        scheduleSave();
        if(opts.cascade) throw err;
    } finally {
        if(opts.cascade){
            node.running = false;
            refreshRunNodes(node, out);
        }
        setStatus('Ready');
    }
}
function runImageRepairAgentFromButton(nodeId, event){
    event?.preventDefault?.();
    event?.stopPropagation?.();
    void runImageRepairAgent(nodeId);
}
window.runImageRepairAgentFromButton = runImageRepairAgentFromButton;
async function runImageRepairAgent(nodeId, opts={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'imageRepairAgent' || isNodeDisabled(node)) return;
    if(!opts.cascade){
        const loop = resolveCascadeLoop(nodeId);
        if(loop && loop.count > 1) return runNodeCascade(nodeId);
    }
    const loopCtx = opts.loopContext !== undefined ? opts.loopContext : loopContext;
    const source = imageRepairAgentSourceImage(node, loopCtx);
    if(!source?.url){
        const msg = langIsEn() ? 'Connect one image node to repair.' : '请连接一张待修复的图片。';
        node.runStatus = 'failed';
        node.runError = msg;
        refreshNodes([nodeId]);
        return;
    }
    const count = Math.max(1, Math.min(8, Number(node.count || 1)));
    if(!opts.cascade){
        node.runStatus = 'running';
        node.runError = '';
    }
    node.running = true;
    refreshNodes([nodeId]);
    setStatus(langIsEn() ? `Starting repair Agent ×${count}…` : `正在启动修图 Agent ×${count}…`);
    const ratioPayload = await replicaAgentRatioForRun(node, source);
    const refs = [{url:source.url, name:source.name || 'image'}];
    let out = outputForNode(node, 460);
    const run = runSnapshot(node, langIsEn() ? 'Repair Agent 4-stage pipeline' : '修图 Agent 四阶段修复', refs);
    const taskPayload = {
        source_image_url:canvasLocalUploadPath(source.url),
        text_model:resolveImageRepairAgentTextModel(node),
        image_model:resolveImageRepairAgentImageModel(node),
        canvas_resolution:node.resolution || '2k',
        canvas_ratio:ratioPayload.canvas_ratio,
        canvas_custom_ratio:ratioPayload.canvas_custom_ratio || '',
    };
    try {
        await Promise.all(Array.from({length:count}, async () => {
            const res = await apiFetch('/api/canvas/image-repair-agent-run', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify(taskPayload)
            });
            if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Repair Agent failed to start' : '修图 Agent 启动失败'));
            const data = await res.json();
            const pendingId = uid('p');
            if(out) out._pending = [...(out._pending || []), makePending(pendingId, run, {
                canvasTaskId:data.task_id,
                canvasTaskType:'image-repair-agent',
                stageLabel:langIsEn() ? 'Reversing prompt…' : '正在反推生成逻辑…',
                appendGenerated:true
            })];
            void pollImageRepairAgentTask(data.task_id);
        }));
        refreshRunNodes(node, out);
        scheduleSave();
        await saveCanvas();
        setStatus(langIsEn() ? `Repair Agent queued ×${count}` : `已排队 ${count} 个修图任务`);
    } catch(err) {
        syncAgentRunStatusAfterTask(node, {failed:!opts.cascade, error: err.message || String(err)});
        refreshRunNodes(node, out);
        scheduleSave();
        if(opts.cascade) throw err;
    }
}
function refreshDownstreamVideoReverseNodes(fromNodeId){
    const targetIds = connections
        .filter(c => c.from === fromNodeId)
        .map(c => c.to)
        .filter(id => nodes.find(n => n.id === id)?.type === 'videoReverse');
    if(targetIds.length) refreshNodes(targetIds);
}
function renderVideoReverseBody(node){
    const promptNodes = videoReverseConnectedPromptNodes(node);
    const promptText = videoReverseInputText(node);
    const videos = videoReverseInputVideos(node);
    const models = CANVAS_AGENT_TEXT_MODELS;
    node.model = clampAgentTextModel(node.model);
    let promptBadge;
    if(!promptNodes.length){
        promptBadge = `<div class="video-reverse-badge warn"><i data-lucide="text-cursor-input" class="w-3.5 h-3.5"></i><span>请连接提示词节点（提示词右侧端口 → 本节点左侧端口）</span></div>`;
    } else if(!promptText.trim()){
        promptBadge = `<div class="video-reverse-badge warn"><i data-lucide="text-cursor-input" class="w-3.5 h-3.5"></i><span>已连接提示词，请在提示词节点里填写反推要求</span></div>`;
    } else {
        promptBadge = `<div class="video-reverse-badge ok"><i data-lucide="text-cursor-input" class="w-3.5 h-3.5"></i><span>已连接反推提示词</span></div>`;
    }
    const outputText = String(node.outputText || '').trim();
    const outputPlaceholder = '运行后将在此显示视频反推内容…';
    const wrap = document.createElement('div');
    wrap.className = 'generator-body video-reverse-body';
    wrap.innerHTML = `
        <div class="video-reverse-badge-row">
            ${videos.length ? `<div class="video-reverse-badge ok"><i data-lucide="video" class="w-3.5 h-3.5"></i><span>已连接 ${videos.length} 个视频</span></div>` : `<div class="video-reverse-badge warn"><i data-lucide="video-off" class="w-3.5 h-3.5"></i><span>请连接视频节点</span></div>`}
            ${promptBadge}
        </div>
        <label class="field">
            <div class="setting-title">${langIsEn() ? 'Text model (video analysis)' : '文本模型（视频分析）'}</div>
            <select class="select-lite video-reverse-model">${models.map(m => `<option value="${escapeHtml(m)}" ${m === node.model ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}</select>
        </label>
        <label class="field">
            <div class="setting-title">System（可选）</div>
            <textarea class="video-reverse-system" placeholder="系统指令，可留空使用默认">${escapeHtml(node.system_prompt || '')}</textarea>
        </label>
        <div class="llm-pane-label">反推结果</div>
        <div class="video-reverse-output ${outputText ? '' : 'is-empty'}">${escapeHtml(outputText || outputPlaceholder)}</div>
        <div class="gen-run-row">
            <button class="gen-btn video-reverse-run ${node.running ? 'running' : ''}" ${node.running ? 'disabled' : ''}><i data-lucide="scan-search" class="w-4 h-4"></i><span>${node.running ? '分析中…' : '运行反推'}</span></button>
        </div>
    `;
    const modelSelect = wrap.querySelector('.video-reverse-model');
    modelSelect.onmousedown = e => e.stopPropagation();
    modelSelect.onclick = e => e.stopPropagation();
    modelSelect.onchange = e => {
        e.stopPropagation();
        node.model = clampAgentTextModel(e.target.value);
        scheduleSave();
    };
    const systemEl = wrap.querySelector('.video-reverse-system');
    bindScrollableText(systemEl);
    systemEl.oninput = e => {
        node.system_prompt = e.target.value;
        scheduleSave();
    };
    bindScrollableText(wrap.querySelector('.video-reverse-output'));
    wrap.querySelector('.video-reverse-run').onclick = e => {
        e.stopPropagation();
        runVideoReverseNode(node.id);
    };
    return wrap;
}
async function runVideoReverseNode(nodeId, opts={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'videoReverse' || (node.running && !opts.cascade)) return;
    const message = videoReverseInputText(node).trim();
    const videos = videoReverseInputVideos(node);
    const promptNodes = videoReverseConnectedPromptNodes(node);
    if(!promptNodes.length){
        softAlert(langIsEn() ? 'Connect a Prompt node: drag from the prompt OUT port to this node IN port.' : '请先连接「提示词」节点：从提示词右侧输出端口，拖到视频反推节点左侧输入端口。');
        return;
    }
    if(!message){
        softAlert(langIsEn() ? 'The connected Prompt node is empty. Write your reverse-engineering instructions first.' : '提示词节点已连接，但内容为空。请先在提示词里写好反推要求。');
        return;
    }
    if(!videos.length){
        softAlert(langIsEn() ? 'Connect a video Image node.' : '请连接包含视频的「图片」节点（mediaKind 为 video）。');
        return;
    }
    if(!opts.cascade){ node.running = true; node.runStatus = 'running'; refreshNodes([node.id]); }
    try {
        node.outputText = await callCanvasLLM(node, message, [], {videos});
        if(!opts.cascade) node.running = false;
        node.runStatus = 'done';
        node.runError = '';
        refreshNodes([node.id]);
        scheduleSave();
    } catch(err) {
        if(!opts.cascade) node.running = false;
        node.runStatus = 'failed';
        node.runError = err.message || String(err);
        refreshNodes([node.id]);
        if(opts.cascade) throw err;
    }
}
function renderGeneratorBody(node){
    const wrap = document.createElement('div');
    wrap.className = 'generator-body';
    const inputSources = generatorSources(node);
    const ordered = orderedSources(node, inputSources);
    const imageInputs = ordered.filter(src => src.refs?.length);
    const promptInputs = ordered.filter(src => src.prompt && !src.refs?.length);
    node.apiProvider = resolveImageProviderId(node.apiProvider || '');
    const migratedModel = normalizeLegacyImageModelId(node.model);
    if(migratedModel !== String(node.model || '').trim()) node.model = migratedModel;
    const imageProviderModels = providerImageModels(node.apiProvider);
    if(!imageProviderModels.length) node.model = '';
    else if(!imageProviderModels.includes(resolveImageModel(node.model))) node.model = imageProviderModels[0] || '';
    const perItemRefs = perItemGroupImageRefs(ordered, null);
    const perItemHint = perItemRefs?.length >= 2
        ? `<div class="image-batch-per-item-hint text-[10px] text-amber-400/90 mb-2">${escapeHtml(trf('canvas.imageBatchPerItemHint', {n: perItemRefs.length}))}</div>`
        : '';
    wrap.innerHTML = `
        <div class="prompt-list mb-3"></div>
        <div class="generator-section-label">${tr('canvas.images')}</div>
        ${perItemHint}
        <div class="input-list"></div>
        <div class="gen-settings">
            <div class="gen-settings-row gen-provider-row">
                <select class="select-lite provider-select">${providerOptions(node.apiProvider)}</select>
                <select class="select-lite model-select">${imageModelOptions(node.model, node.apiProvider)}</select>
            </div>
            <div class="gen-settings-row gen-params-row api-size-row">
                <select class="select-lite resolution compact-select" data-field="resolution">
                    <option value="1k">1K</option>
                    <option value="2k">2K</option>
                    <option value="4k">4K</option>
                    <option value="custom">${tr('canvas.custom')}</option>
                </select>
                <select class="select-lite ratio compact-select" data-field="ratio">
                    <option value="square">1:1</option>
                    <option value="portrait">2:3</option>
                    <option value="landscape">3:2</option>
                    <option value="portrait43">3:4</option>
                    <option value="landscape43">4:3</option>
                    <option value="story">9:16</option>
                    <option value="wide">16:9</option>
                    <option value="source">${tr('canvas.adaptiveRatio')}</option>
                    <option value="custom">${tr('canvas.custom')}</option>
                </select>
                <select class="select-lite mj-quality-select compact-select" hidden aria-hidden="true">
                    <option value="1">Q 1</option>
                    <option value="4">Q 4</option>
                </select>
                <select class="select-lite quality-select">
                    <option value="auto">Q auto</option>
                    <option value="low">Q low</option>
                    <option value="medium">Q med</option>
                    <option value="high">Q high</option>
                </select>
                <div class="gen-count-row">
                    <div class="gen-stepper">
                        <button class="gen-step-btn" data-step="-1" type="button" title="${tr('canvas.decrease')}" aria-label="${tr('canvas.decreaseCount')}"><i data-lucide="chevron-left" class="w-3.5 h-3.5"></i></button>
                        <input class="gen-count-input" type="text" inputmode="numeric" pattern="[0-9]*" value="${Math.max(1, Math.min(8, Number(node.count || 1)))}">
                        <button class="gen-step-btn" data-step="1" type="button" title="${tr('canvas.increase')}" aria-label="${tr('canvas.increaseCount')}"><i data-lucide="chevron-right" class="w-3.5 h-3.5"></i></button>
                    </div>
                </div>
            </div>
            <div class="gen-mj-panel" hidden>
                <div class="gen-settings-row gen-mj-advanced-row">
                    <label class="field">
                        <div class="setting-title">${tr('canvas.mjChaos')}</div>
                        <input class="setting-input mj-chaos-input" type="number" min="0" max="100" step="1" value="${clampGenInt(node.mjChaos, 0, 100, 0)}">
                    </label>
                    <label class="field">
                        <div class="setting-title">${tr('canvas.mjStylize')}</div>
                        <input class="setting-input mj-stylize-input" type="number" min="0" max="1000" step="1" value="${clampGenInt(node.mjStylize, 0, 1000, 0)}">
                    </label>
                    <label class="field mj-weird-field">
                        <div class="setting-title">${tr('canvas.mjWeird')}</div>
                        <input class="setting-input mj-weird-input" type="number" min="0" max="3000" step="1" value="${clampGenInt(node.mjWeird, 0, 3000, 0)}">
                    </label>
                    <label class="field mj-iw-field">
                        <div class="setting-title">${tr('canvas.mjIw')}</div>
                        <input class="setting-input mj-iw-input" type="number" min="0" max="3" step="0.1" value="${clampGenFloat(node.mjIw, 0, 3, 1)}">
                    </label>
                    <label class="field mj-sv-field">
                        <div class="setting-title">${tr('canvas.mjSv')}</div>
                        <select class="select-lite mj-sv-select compact-select">
                            <option value="1">SV 1</option>
                            <option value="2">SV 2</option>
                            <option value="3">SV 3</option>
                            <option value="4">SV 4</option>
                        </select>
                    </label>
                </div>
                <div class="gen-settings-row gen-mj-toggle-row">
                    <label class="setting-check mj-hd-check mj-hd-field ${node.mjHd ? 'active' : ''}">
                        <input type="checkbox" class="mj-hd-input" ${node.mjHd ? 'checked' : ''}>
                        <span class="check-dot"></span><span>${tr('canvas.mjHd')}</span>
                    </label>
                    <label class="setting-check mj-raw-check ${node.mjRaw ? 'active' : ''}">
                        <input type="checkbox" class="mj-raw-input" ${node.mjRaw ? 'checked' : ''}>
                        <span class="check-dot"></span><span>${tr('canvas.mjRaw')}</span>
                    </label>
                </div>
                <div class="gen-mj-hint">${tr('canvas.mjRefHint')}</div>
            </div>
            <div class="gen-settings-row custom-ratio-row" style="display:none">
                <label class="field">
                    <div class="setting-title">${tr('canvas.ratioWidth')}</div>
                    <input class="setting-input custom-ratio-w-input" type="number" min="1" step="1" value="${escapeHtml(node.customRatioWidth || '')}" placeholder="4">
                </label>
                <label class="field">
                    <div class="setting-title">${tr('canvas.ratioHeight')}</div>
                    <input class="setting-input custom-ratio-h-input" type="number" min="1" step="1" value="${escapeHtml(node.customRatioHeight || '')}" placeholder="3">
                </label>
            </div>
            <div class="gen-settings-row custom-size-row" style="display:none">
                <label class="field">
                    <div class="setting-title">${tr('canvas.width')}</div>
                    <input class="setting-input custom-w-input" type="number" min="64" step="64" value="${escapeHtml(node.customWidth || '')}" placeholder="Auto">
                </label>
                <label class="field">
                    <div class="setting-title">${tr('canvas.height')}</div>
                    <input class="setting-input custom-h-input" type="number" min="64" step="64" value="${escapeHtml(node.customHeight || '')}" placeholder="Auto">
                </label>
                <button class="secondary-btn fit-size-btn" type="button" style="height:32px;align-self:flex-end;padding:0 10px;font-size:11px">${tr('canvas.fitImageSize')}</button>
            </div>
        </div>
        <div class="gen-run-row">
            ${hasUpstreamLoop(node.id) ? '' : (() => {
                const genBtn = agentPendingRunState(node.id, tr('canvas.apiGenerate'), tr('canvas.generating'));
                return agentGenRunActionsHtml(node.id, `<button class="gen-btn ${genBtn.runningCls}" ${isNodeDisabled(node) ? 'disabled' : ''}><i data-lucide="zap" class="w-4 h-4"></i>${escapeHtml(genBtn.label)}</button>`);
            })()}
            ${cascadeBtnHtml(node)}
        </div>
        ${retryBarHtml(node)}
    `;
    const providerSelect = wrap.querySelector('.provider-select');
    const modelSelect = wrap.querySelector('.model-select');
    providerSelect.onmousedown = e => e.stopPropagation();
    providerSelect.onclick = e => e.stopPropagation();
    providerSelect.onchange = e => {
        e.stopPropagation();
        node.apiProvider = e.target.value;
        const providerModels = providerImageModels(node.apiProvider);
        if(!providerModels.includes(resolveImageModel(node.model))) node.model = providerModels[0] || '';
        modelSelect.innerHTML = imageModelOptions(node.model, node.apiProvider);
        normalizeApiNodeSizeChoice(node);
        syncSizeControls();
        scheduleSave();
    };
    modelSelect.onmousedown = e => e.stopPropagation();
    modelSelect.onclick = e => e.stopPropagation();
    modelSelect.onchange = e => {
        e.stopPropagation();
        node.model = e.target.value;
        normalizeApiNodeSizeChoice(node);
        syncSizeControls();
        scheduleSave();
    };
    const ratioSelect = wrap.querySelector('.ratio');
    const resolutionSelect = wrap.querySelector('.resolution');
    const qualitySelect = wrap.querySelector('.quality-select');
    const mjQualitySelect = wrap.querySelector('.mj-quality-select');
    const genMjPanel = wrap.querySelector('.gen-mj-panel');
    const mjChaosInput = wrap.querySelector('.mj-chaos-input');
    const mjStylizeInput = wrap.querySelector('.mj-stylize-input');
    const mjIwInput = wrap.querySelector('.mj-iw-input');
    const mjWeirdField = wrap.querySelector('.mj-weird-field');
    const mjWeirdInput = wrap.querySelector('.mj-weird-input');
    const mjSvField = wrap.querySelector('.mj-sv-field');
    const mjSvSelect = wrap.querySelector('.mj-sv-select');
    const mjHdField = wrap.querySelector('.mj-hd-field');
    const mjHdCheck = wrap.querySelector('.mj-hd-check');
    const mjRawCheck = wrap.querySelector('.mj-raw-check');
    const mjHdInput = wrap.querySelector('.mj-hd-input');
    const mjRawInput = wrap.querySelector('.mj-raw-input');
    const customRatioRow = wrap.querySelector('.custom-ratio-row');
    const customSizeRow = wrap.querySelector('.custom-size-row');
    const customRatioWInput = wrap.querySelector('.custom-ratio-w-input');
    const customRatioHInput = wrap.querySelector('.custom-ratio-h-input');
    const customWInput = wrap.querySelector('.custom-w-input');
    const customHInput = wrap.querySelector('.custom-h-input');
    const fitSizeBtn = wrap.querySelector('.fit-size-btn');
    const genSettingsEl = wrap.querySelector('.gen-settings');
    const paramsRowEl = wrap.querySelector('.gen-params-row');
    const referenceImages = ordered.flatMap(src => src.refs || []);
    const syncGeneratorParamLayout = () => {
        const caps = generatorModelCaps(node.model);
        const isYouchuan = Boolean(caps.showYouchuanPanel);
        const showQuality = Boolean(caps.showQuality);
        const showMjQuality = Boolean(caps.showMjQuality);
        const showResolution = caps.resolutionKeys.length > 0;
        if(genSettingsEl){
            genSettingsEl.dataset.showQuality = showQuality ? '1' : '0';
            genSettingsEl.dataset.modelProfile = caps.profile || 'standard';
        }
        if(paramsRowEl){
            let cols = 3;
            if(isYouchuan && showMjQuality) cols = 3;
            else if(isYouchuan) cols = 2;
            else if(showQuality && showResolution) cols = 4;
            else if(showQuality || showResolution) cols = 3;
            else cols = 2;
            paramsRowEl.dataset.cols = String(cols);
        }
        resolutionSelect.classList.toggle('is-hidden', !showResolution);
        resolutionSelect.toggleAttribute('hidden', !showResolution);
        qualitySelect.classList.toggle('is-hidden', !showQuality);
        qualitySelect.toggleAttribute('hidden', !showQuality);
        qualitySelect.setAttribute('aria-hidden', showQuality ? 'false' : 'true');
        mjQualitySelect.classList.toggle('is-hidden', !showMjQuality);
        mjQualitySelect.toggleAttribute('hidden', !showMjQuality);
        mjQualitySelect.setAttribute('aria-hidden', showMjQuality ? 'false' : 'true');
        if(genMjPanel) genMjPanel.hidden = !isYouchuan;
        if(mjHdField) mjHdField.classList.toggle('is-hidden', !caps.showMjHd);
        if(mjWeirdField) mjWeirdField.classList.toggle('is-hidden', !caps.showWeird);
        if(mjSvField) mjSvField.classList.toggle('is-hidden', !caps.showSvSelect);
        if(genSettingsEl) genSettingsEl.dataset.iwMax = String(caps.iwMax || 3);
        if(modelSelect?.selectedIndex >= 0) modelSelect.title = modelSelect.options[modelSelect.selectedIndex]?.text || '';
        if(providerSelect?.selectedIndex >= 0) providerSelect.title = providerSelect.options[providerSelect.selectedIndex]?.text || '';
        rebaseGeneratorFrame(node);
    };
    const syncYouchuanControls = () => {
        ensureYouchuanNodeDefaults(node);
        const caps = generatorModelCaps(node.model);
        if(!caps.showYouchuanPanel){
            syncGeneratorParamLayout();
            return;
        }
        if(caps.showMjQuality){
            const values = caps.mjQualityValues || ['1','4'];
            const selected = values.includes(String(node.mjQuality || '1')) ? String(node.mjQuality) : (caps.defaultMjQuality || '1');
            node.mjQuality = selected;
            mjQualitySelect.innerHTML = values.map(v => `<option value="${v}">Q ${v}</option>`).join('');
            mjQualitySelect.value = selected;
        }
        if(mjChaosInput) mjChaosInput.value = String(node.mjChaos ?? 0);
        if(mjStylizeInput) mjStylizeInput.value = String(node.mjStylize ?? 0);
        if(mjWeirdInput && caps.showWeird) mjWeirdInput.value = String(node.mjWeird ?? 0);
        if(mjIwInput){
            const iwMax = caps.iwMax || 3;
            mjIwInput.max = String(iwMax);
            mjIwInput.value = String(node.mjIw ?? 1);
        }
        if(mjSvSelect && caps.showSvSelect) mjSvSelect.value = String(node.mjSv ?? 4);
        if(mjHdInput) mjHdInput.checked = Boolean(node.mjHd);
        if(mjRawInput) mjRawInput.checked = Boolean(node.mjRaw);
        mjHdCheck?.classList.toggle('active', Boolean(node.mjHd));
        mjRawCheck?.classList.toggle('active', Boolean(node.mjRaw));
        syncGeneratorParamLayout();
    };
    const syncQualityControls = () => {
        const caps = generatorModelCaps(node.model);
        if(caps.showYouchuanPanel){
            syncYouchuanControls();
            return;
        }
        if(!caps.showQuality){
            node.quality = 'auto';
            syncGeneratorParamLayout();
            return;
        }
        const values = caps.qualityValues || ['low','medium','high'];
        const current = String(node.quality || caps.defaultQuality || 'medium').trim().toLowerCase();
        const selected = values.includes(current) ? current : (caps.defaultQuality || 'medium');
        node.quality = selected;
        qualitySelect.innerHTML = values.map(v => `<option value="${v}">Q ${v}</option>`).join('');
        qualitySelect.value = selected;
        qualitySelect.disabled = false;
        syncGeneratorParamLayout();
    };
    const hydrateCustomParts = () => {
        if((!node.customRatioWidth || !node.customRatioHeight) && node.customRatio) {
            const raw = String(node.customRatio || '');
            if(raw.includes(':')){
                const [w,h] = raw.split(':');
                node.customRatioWidth = node.customRatioWidth || w;
                node.customRatioHeight = node.customRatioHeight || h;
            }
        }
        if((!node.customWidth || !node.customHeight) && node.customSize) {
            const parsed = parseSizeValue(node.customSize);
            node.customWidth = node.customWidth || parsed?.width || '';
            node.customHeight = node.customHeight || parsed?.height || '';
        }
    };
    hydrateCustomParts();
    let sourceRatioRequest = 0;
    const updateSourceRatioFromFirstRef = async () => {
        if(node.ratio !== 'source') return;
        const ref = referenceImages.find(item => item.url);
        const requestId = ++sourceRatioRequest;
        if(!ref){
            node.customRatio = '';
            node.customRatioWidth = '';
            node.customRatioHeight = '';
            customRatioWInput.value = '';
            customRatioHInput.value = '';
            return;
        }
        try {
            const dims = await getImageDimensions(ref.url);
            if(requestId !== sourceRatioRequest || node.ratio !== 'source') return;
            const parts = ratioPartsFromDimensions(dims.width, dims.height);
            node.customRatioWidth = String(parts.width);
            node.customRatioHeight = String(parts.height);
            node.customRatio = `${parts.width}:${parts.height}`;
            customRatioWInput.value = node.customRatioWidth;
            customRatioHInput.value = node.customRatioHeight;
            scheduleSave();
        } catch(_) {}
    };
    const syncSizeControls = () => {
        normalizeApiNodeSizeChoice(node);
        const caps = generatorModelCaps(node.model);
        const showResolution = caps.resolutionKeys.length > 0;
        [...ratioSelect.options].forEach(opt => {
            const allowed = caps.ratioKeys.includes(opt.value);
            opt.disabled = !allowed;
            opt.hidden = !allowed;
        });
        [...resolutionSelect.options].forEach(opt => {
            const allowed = caps.resolutionKeys.includes(opt.value);
            opt.disabled = !allowed;
            opt.hidden = !allowed;
        });
        const squareOption = ratioSelect.querySelector('option[value="square"]');
        if(squareOption){
            squareOption.disabled = false;
            squareOption.title = '';
        }
        const ratioValue = node.ratio && [...ratioSelect.options].some(opt => opt.value === node.ratio && !opt.hidden) ? node.ratio : (caps.ratioKeys.includes('square') ? 'square' : caps.ratioKeys[0]);
        ratioSelect.value = ratioValue;
        node.ratio = ratioValue;
        const resolutionValue = showResolution && node.resolution && caps.resolutionKeys.includes(node.resolution)
            ? node.resolution
            : (caps.resolutionKeys[0] || '1k');
        if(showResolution){
            resolutionSelect.value = resolutionValue;
            node.resolution = resolutionValue;
        }
        ratioSelect.disabled = node.resolution === 'custom';
        customRatioRow.style.display = (node.ratio === 'custom' || node.ratio === 'source') ? 'flex' : 'none';
        customSizeRow.style.display = node.resolution === 'custom' ? 'flex' : 'none';
        customRatioWInput.disabled = node.ratio === 'source';
        customRatioHInput.disabled = node.ratio === 'source';
        customRatioWInput.value = node.customRatioWidth || '';
        customRatioHInput.value = node.customRatioHeight || '';
        customWInput.value = node.customWidth || '';
        customHInput.value = node.customHeight || '';
        if(fitSizeBtn) fitSizeBtn.disabled = !referenceImages.some(ref => ref.url);
        syncQualityControls();
        if(node.ratio === 'source') updateSourceRatioFromFirstRef();
    };
    const bindMjField = (el, apply) => {
        if(!el) return;
        el.onmousedown = e => e.stopPropagation();
        el.onclick = e => e.stopPropagation();
        el.onchange = e => { e.stopPropagation(); apply(e); syncMjControls(); scheduleSave(); };
        el.oninput = e => { e.stopPropagation(); apply(e); scheduleSave(); };
    };
    bindMjField(mjQualitySelect, e => { node.mjQuality = e.target.value === '4' ? '4' : '1'; });
    bindMjField(mjChaosInput, e => { node.mjChaos = clampGenInt(e.target.value, 0, 100, 0); });
    bindMjField(mjStylizeInput, e => { node.mjStylize = clampGenInt(e.target.value, 0, 1000, 0); });
    bindMjField(mjWeirdInput, e => { node.mjWeird = clampGenInt(e.target.value, 0, 3000, 0); });
    bindMjField(mjIwInput, e => {
        const iwMax = generatorModelCaps(node.model).iwMax || 3;
        node.mjIw = clampGenFloat(e.target.value, 0, iwMax, 1);
    });
    bindMjField(mjSvSelect, e => { node.mjSv = clampGenInt(e.target.value, 1, 4, 4); });
    [mjHdCheck, mjRawCheck].forEach(label => {
        if(!label) return;
        label.onmousedown = e => e.stopPropagation();
        label.onclick = e => {
            e.stopPropagation();
            e.preventDefault();
            if(label === mjHdCheck){
                node.mjHd = !node.mjHd;
                if(mjHdInput) mjHdInput.checked = node.mjHd;
            } else {
                node.mjRaw = !node.mjRaw;
                if(mjRawInput) mjRawInput.checked = node.mjRaw;
            }
            syncYouchuanControls();
            scheduleSave();
        };
    });
    qualitySelect.onmousedown = e => e.stopPropagation();
    qualitySelect.onclick = e => e.stopPropagation();
    qualitySelect.onchange = e => {
        e.stopPropagation();
        node.quality = e.target.value;
        scheduleSave();
    };
    ratioSelect.onmousedown = e => e.stopPropagation();
    ratioSelect.onclick = e => e.stopPropagation();
    ratioSelect.onchange = e => {
        e.stopPropagation();
        node.ratio = e.target.value;
        normalizeApiNodeSizeChoice(node);
        if(node.ratio !== 'custom' && node.ratio !== 'source') {
            node.customRatio = '';
            node.customRatioWidth = '';
            node.customRatioHeight = '';
        } else if(node.ratio === 'source') {
            node.customRatio = '';
            node.customRatioWidth = '';
            node.customRatioHeight = '';
        }
        syncSizeControls();
        scheduleSave();
    };
    resolutionSelect.onmousedown = e => e.stopPropagation();
    resolutionSelect.onclick = e => e.stopPropagation();
    resolutionSelect.onchange = e => {
        e.stopPropagation();
        node.resolution = e.target.value;
        if(node.resolution === 'custom') {
            node.ratio = '';
        } else if(!node.ratio) {
            node.ratio = 'square';
            node.customSize = '';
            node.customWidth = '';
            node.customHeight = '';
        } else {
            node.customSize = '';
            node.customWidth = '';
            node.customHeight = '';
        }
        normalizeApiNodeSizeChoice(node);
        syncSizeControls();
        scheduleSave();
    };
    [customRatioWInput, customRatioHInput].forEach(input => {
        input.onmousedown = e => e.stopPropagation();
        input.onclick = e => e.stopPropagation();
        input.oninput = e => {
            node.customRatioWidth = customRatioWInput.value;
            node.customRatioHeight = customRatioHInput.value;
            node.customRatio = node.customRatioWidth && node.customRatioHeight ? `${node.customRatioWidth}:${node.customRatioHeight}` : '';
            node.ratio = 'custom';
            syncSizeControls();
            scheduleSave();
        };
    });
    [customWInput, customHInput].forEach(input => {
        input.onmousedown = e => e.stopPropagation();
        input.onclick = e => e.stopPropagation();
        input.oninput = e => {
            node.customWidth = customWInput.value;
            node.customHeight = customHInput.value;
            node.customSize = node.customWidth && node.customHeight ? `${node.customWidth}x${node.customHeight}` : '';
            node.resolution = 'custom';
            node.ratio = '';
            syncSizeControls();
            scheduleSave();
        };
    });
    if(fitSizeBtn){
        fitSizeBtn.onmousedown = e => e.stopPropagation();
        fitSizeBtn.onclick = async e => {
            e.stopPropagation();
            const ref = referenceImages.find(item => item.url);
            if(!ref) return;
            try {
                const dims = await getImageDimensions(ref.url);
                node.customWidth = dims.width;
                node.customHeight = dims.height;
                node.customSize = `${dims.width}x${dims.height}`;
                node.resolution = 'custom';
                node.ratio = '';
                syncSizeControls();
                scheduleSave();
            } catch(err) {
                    showErrorModal(tr('canvas.imageReadFailed'));
            }
        };
    }
    syncSizeControls();
    const countInput = wrap.querySelector('.gen-count-input');
    countInput.onmousedown = e => e.stopPropagation();
    countInput.onclick = e => e.stopPropagation();
    countInput.oninput = e => {
        const value = Math.max(1, Math.min(8, Number(e.target.value) || 1));
        node.count = value;
        scheduleSave();
    };
    countInput.onblur = e => { e.target.value = String(Math.max(1, Math.min(8, Number(node.count || 1)))); };
    wrap.querySelectorAll('[data-step]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const next = Math.max(1, Math.min(8, Number(node.count || 1) + Number(btn.dataset.step || 0)));
            node.count = next;
            countInput.value = String(next);
            scheduleSave();
        };
    });
    const list = wrap.querySelector('.input-list');
    renderImageInputList(list, node, imageInputs);
    renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    const genBtn = wrap.querySelector('.gen-btn');
    if(genBtn) genBtn.onclick = e => { e.stopPropagation(); runCanvasGenerate(node.id); };
    bindCascadeButtons(wrap, node.id);
    return wrap;
}
function renderVideoBody(node){
    const wrap = document.createElement('div');
    wrap.className = 'generator-body';
    const inputSources = generatorSources(node);
    const ordered = orderedSources(node, inputSources);
    const imageInputs = ordered.filter(src => src.refs?.length);
    const promptInputs = ordered.filter(src => src.prompt && !src.refs?.length);
    node.apiProvider = resolveVideoProviderId(node.apiProvider || 'comfly');
    node.model = node.model || 'veo3-fast';
    wrap.innerHTML = `
        <div class="prompt-list mb-3"></div>
        <div class="generator-section-label">${tr('canvas.images') || 'Images'}</div>
        <div class="input-list video-img-list"></div>
        <div class="gen-settings">
            <div class="gen-settings-row">
                <select class="select-lite video-provider" style="flex:1">${videoProviderOptions(node.apiProvider)}</select>
                <select class="select-lite video-model" style="flex:2">${videoModelOptions(node.model, node.apiProvider)}</select>
            </div>
            <div class="gen-settings-row">
                <label class="field" style="flex:1">
                    <div class="setting-title">${tr('canvas.videoDuration')}</div>
                    <input class="setting-input video-duration" type="number" min="1" max="60" step="1" value="${Number(node.duration || 5)}">
                </label>
                <label class="field" style="flex:1">
                    <div class="setting-title">${tr('canvas.videoAspect')}</div>
                    <select class="select-lite video-aspect compact-select">
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                        <option value="4:3">4:3</option>
                        <option value="3:4">3:4</option>
                        <option value="21:9">21:9</option>
                        <option value="9:21">9:21</option>
                        <option value="keep_ratio">keep</option>
                        <option value="adaptive">adapt</option>
                    </select>
                </label>
                <label class="field" style="flex:1">
                    <div class="setting-title">${tr('canvas.videoResolution')}</div>
                    <select class="select-lite video-resolution compact-select">
                        <option value="">Auto</option>
                        <option value="480p">480p</option>
                        <option value="720p">720p</option>
                        <option value="1080p">1080p</option>
                        <option value="780P">780P</option>
                    </select>
                </label>
            </div>
            <div class="gen-settings-row" style="flex-wrap:wrap">
                <button type="button" class="setting-check ${node.enhancePrompt ? 'active' : ''}" data-video-toggle="enhancePrompt"><span class="check-dot"></span>${tr('canvas.videoEnhancePrompt')}</button>
                <button type="button" class="setting-check ${node.enableUpsample ? 'active' : ''}" data-video-toggle="enableUpsample"><span class="check-dot"></span>${tr('canvas.videoUpsample')}</button>
                <button type="button" class="setting-check ${node.watermark ? 'active' : ''}" data-video-toggle="watermark"><span class="check-dot"></span>${tr('canvas.videoWatermark')}</button>
                <button type="button" class="setting-check ${node.cameraFixed ? 'active' : ''}" data-video-toggle="cameraFixed"><span class="check-dot"></span>${tr('canvas.videoCameraFixed')}</button>
                <button type="button" class="setting-check ${node.generateAudio ? 'active' : ''}" data-video-toggle="generateAudio"><span class="check-dot"></span>${tr('canvas.videoGenerateAudio')}</button>
                <button type="button" class="setting-check ${node.useFrameRoles ? 'active' : ''}" data-video-toggle="useFrameRoles"><span class="check-dot"></span>${tr('canvas.videoFirstLastFrames')}</button>
            </div>
        </div>
        <div class="gen-run-row">
            ${hasUpstreamLoop(node.id) ? '' : (() => {
                const videoBtn = agentPendingRunState(node.id, tr('canvas.videoGenerate'), tr('canvas.generating'));
                return agentGenRunActionsHtml(node.id, `<button class="gen-btn ${videoBtn.runningCls}" ${isNodeDisabled(node) ? 'disabled' : ''}><i data-lucide="clapperboard" class="w-4 h-4"></i>${escapeHtml(videoBtn.label)}</button>`);
            })()}
            ${cascadeBtnHtml(node)}
        </div>
        ${retryBarHtml(node)}
    `;
    const providerSelect = wrap.querySelector('.video-provider');
    const modelSelect = wrap.querySelector('.video-model');
    const durationSelect = wrap.querySelector('.video-duration');
    const aspectSelect = wrap.querySelector('.video-aspect');
    const resolutionSelect = wrap.querySelector('.video-resolution');
    providerSelect.value = node.apiProvider;
    durationSelect.value = String(node.duration || 5);
    aspectSelect.value = node.aspectRatio || '16:9';
    resolutionSelect.value = node.resolution || '';
    [providerSelect, modelSelect, durationSelect, aspectSelect, resolutionSelect].forEach(input => {
        input.onmousedown = e => e.stopPropagation();
        input.onclick = e => e.stopPropagation();
    });
    providerSelect.onchange = e => {
        e.stopPropagation();
        node.apiProvider = e.target.value;
        const models = providerVideoModels(node.apiProvider);
        if(!models.includes(node.model)) node.model = models[0] || node.model;
        modelSelect.innerHTML = videoModelOptions(node.model, node.apiProvider);
        scheduleSave();
    };
    modelSelect.onchange = e => { e.stopPropagation(); node.model = e.target.value; scheduleSave(); };
    durationSelect.oninput = e => { e.stopPropagation(); node.duration = Math.max(1, Math.min(60, Number(e.target.value || 5))); scheduleSave(); };
    durationSelect.onblur = e => { e.target.value = String(Math.max(1, Math.min(60, Number(node.duration || 5)))); };
    aspectSelect.onchange = e => { e.stopPropagation(); node.aspectRatio = e.target.value; scheduleSave(); };
    resolutionSelect.onchange = e => { e.stopPropagation(); node.resolution = e.target.value; scheduleSave(); };
    wrap.querySelectorAll('[data-video-toggle]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            const field = btn.dataset.videoToggle;
            node[field] = !node[field];
            render();
            scheduleSave();
        };
    });
    const list = wrap.querySelector('.video-img-list');
    renderVideoImageInputs(list, node, imageInputs);
    renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    const videoGenBtn = wrap.querySelector('.gen-btn');
    if(videoGenBtn) videoGenBtn.onclick = e => { e.stopPropagation(); runCanvasGenerate(node.id); };
    bindCascadeButtons(wrap, node.id);
    return wrap;
}
function renderPromptPreview(container, promptInputs){
    if(!container) return;
    container.innerHTML = promptInputs.length
        ? `<div class="canvas-prompt-preview-label">Prompts</div>${promptInputs.map(src => `<div class="canvas-prompt-preview-item line-clamp-2">${escapeHtml(src.label)}</div>`).join('')}`
        : '';
}
function renderImageInputList(list, node, imageInputs, emptyText=null){
    if(!list) return;
    list.innerHTML = imageInputs.length ? '' : `<div class="text-[11px] text-gray-300 py-2">${escapeHtml(emptyText || tr('canvas.inputImagesEmpty'))}</div>`;
    imageInputs.forEach((src, i) => {
        const item = document.createElement('div');
        item.className = 'input-item';
        item.draggable = true;
        item.dataset.sourceId = src.id;
        const previewHtml = src.preview && !isMissingAssetUrl(src.preview) ? `<img src="${escapeAttr(src.preview)}">` : (src.preview ? missingAssetHtml(src.preview, true) : '<i data-lucide="image" class="w-6 h-6 text-slate-400"></i>');
        item.innerHTML = `<span class="input-index">${i + 1}</span>${previewHtml}<span class="input-label">${escapeHtml(src.label)}</span>`;
        item.ondragstart = e => {
            e.stopPropagation();
            internalDrag = true;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-canvas-input', src.id);
        };
        item.ondragend = () => { internalDrag = false; };
        item.ondragover = e => { e.preventDefault(); e.stopPropagation(); };
        item.ondrop = e => {
            e.preventDefault();
            e.stopPropagation();
            reorderInput(node, e.dataTransfer.getData('application/x-canvas-input'), src.id);
            internalDrag = false;
        };
        list.appendChild(item);
    });
    refreshIcons();
}
function renderVideoImageInputs(list, node, imageInputs){
    if(!list) return;
    list.innerHTML = imageInputs.length ? '' : `<div class="text-[11px] text-gray-300 py-2">${tr('canvas.groupEmpty')}</div>`;
    imageInputs.forEach((src, i) => {
        const item = document.createElement('div');
        item.className = 'input-item video-input-item';
        item.draggable = true;
        item.dataset.sourceId = src.id;
        const frameLabel = node.useFrameRoles && i === 0 ? tr('canvas.videoRoleFirstFrame') : node.useFrameRoles && i === 1 ? tr('canvas.videoRoleLastFrame') : '';
        const previewHtml = src.preview && !isMissingAssetUrl(src.preview) ? `<img src="${escapeAttr(src.preview)}">` : (src.preview ? missingAssetHtml(src.preview, true) : '<i data-lucide="image" class="w-6 h-6 text-slate-400"></i>');
        item.innerHTML = `
            <div class="video-input-thumb">
                <span class="input-index">${i + 1}</span>
                ${previewHtml}
                <span class="input-label">${escapeHtml(src.label)}</span>
            </div>
            ${frameLabel ? `<div class="video-frame-label">${frameLabel}</div>` : ''}
        `;
        item.ondragstart = e => { e.stopPropagation(); internalDrag = true; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-canvas-input', src.id); };
        item.ondragend = () => { internalDrag = false; };
        item.ondragover = e => { e.preventDefault(); e.stopPropagation(); };
        item.ondrop = e => { e.preventDefault(); e.stopPropagation(); reorderInput(node, e.dataTransfer.getData('application/x-canvas-input'), src.id); internalDrag = false; };
        list.appendChild(item);
    });
    refreshIcons();
}
function comfyWorkflowOptions(selected){
    const opts = comfyWorkflows.map(w => `<option value="${escapeHtml(w.name)}" ${w.name === selected ? 'selected' : ''}>${escapeHtml(w.title || w.name.replace('.json',''))}</option>`).join('');
    return opts || `<option value="">${tr('canvas.comfyNoWorkflow')}</option>`;
}
function hasComfyWorkflow(name){
    return !!name && comfyWorkflows.some(w => w.name === name);
}
function validComfyWorkflowName(name){
    return hasComfyWorkflow(name) ? name : (comfyWorkflows[0]?.name || '');
}
function pruneMissingComfyWorkflows(){
    let changed = false;
    nodes.filter(n => n.type === 'comfy').forEach(node => {
        if(node.comfyWorkflow && !hasComfyWorkflow(node.comfyWorkflow)){
            delete comfyWorkflowCache[node.comfyWorkflow];
            node.comfyWorkflow = '';
            changed = true;
        }
    });
    if(changed) scheduleSave();
}
function currentComfyWorkflow(node){
    const selected = validComfyWorkflowName(node.comfyWorkflow || comfyWorkflows[0]?.name || '');
    return comfyWorkflowCache[selected] || null;
}
async function ensureComfyWorkflow(name){
    if(!hasComfyWorkflow(name)) return null;
    if(comfyWorkflowCache[name]) return comfyWorkflowCache[name];
    const res = await apiFetch(`/api/workflows/${encodeURIComponent(name)}`);
    if(!res.ok){
        delete comfyWorkflowCache[name];
        return null;
    }
    const data = await res.json();
    comfyWorkflowCache[name] = data;
    return data;
}
function validRunningHubWorkflowId(workflowId){
    return String(workflowId || '').trim();
}
function currentRunningHubWorkflow(node){
    const workflowId = validRunningHubWorkflowId(node.workflowId || '');
    return runningHubWorkflowCache[workflowId] || null;
}
async function ensureRunningHubWorkflow(workflowId){
    workflowId = validRunningHubWorkflowId(workflowId);
    if(!workflowId) return null;
    if(runningHubWorkflowCache[workflowId]) return runningHubWorkflowCache[workflowId];
    const res = await apiFetch(`/api/runninghub/workflows/${encodeURIComponent(workflowId)}`);
    if(!res.ok){
        delete runningHubWorkflowCache[workflowId];
        return null;
    }
    const data = await res.json();
    runningHubWorkflowCache[workflowId] = data.workflow || null;
    return runningHubWorkflowCache[workflowId];
}
function comfyFieldKind(f){
    if(['image','video','audio'].includes(f?.type)) return f.type;
    const key = `${f.input || ''} ${f.name || ''}`.toLowerCase();
    if(f.type === 'textarea' || /prompt|text|提示词|正向|负向/.test(key)) return 'prompt';
    return 'setting';
}
function comfyFields(node, kind='all'){
    const data = currentComfyWorkflow(node);
    const fields = data?.config?.fields || [];
    return kind === 'all' ? fields : fields.filter(f => comfyFieldKind(f) === kind);
}
function comfyParamValue(node, field){
    node.comfyParams = node.comfyParams || {};
    if(node.comfyParams[field.id] !== undefined) return node.comfyParams[field.id];
    return field.default ?? (field.type === 'boolean' ? false : (field.type === 'number' || field.type === 'slider' ? 0 : ''));
}
function comfyRandomEnabled(field){
    return field?.type === 'number' && field.random_enabled === true;
}
function comfyRandomActive(node, fieldId){
    node.comfyRandomActive = node.comfyRandomActive || {};
    return node.comfyRandomActive[fieldId] !== false;
}
function comfyRandomValue(field){
    const isFloat = Number(field.step) > 0 && Number(field.step) < 1;
    let min = Number.isFinite(Number(field.min)) ? Number(field.min) : null;
    let max = Number.isFinite(Number(field.max)) ? Number(field.max) : null;
    const name = `${field.input || ''} ${field.name || ''}`.toLowerCase();
    const looksSeed = name.includes('seed') || name.includes('noise') || name.includes('随机') || name.includes('噪');
    if(min === null) min = looksSeed ? 1 : 0;
    if(max === null || max <= min) max = looksSeed ? 1000000000000000 : 999999;
    let value = min + Math.random() * (max - min);
    if(isFloat){
        const precision = Math.min(8, Math.max(1, String(field.step).split('.')[1]?.length || 2));
        return Number(value.toFixed(precision));
    }
    return Math.floor(value);
}
function toggleComfyRandom(nodeId, fieldId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    const field = comfyFields(node).find(f => f.id === fieldId);
    if(!comfyRandomEnabled(field)) return;
    node.comfyRandomActive = node.comfyRandomActive || {};
    node.comfyRandomActive[fieldId] = !comfyRandomActive(node, fieldId);
    refreshNodes([node.id]);
    scheduleSave();
}
function renderComfyBody(node){
    const wrap = document.createElement('div');
    wrap.className = 'comfy-body';
    const inputSources = generatorSources(node);
    const ordered = orderedSources(node, inputSources);
    const mediaInputs = ordered.filter(src => src.refs?.length);
    const imageInputs = mediaInputs
        .map(src => ({...src, refs:imageRefsOnly(src.refs || [])}))
        .filter(src => src.refs?.length);
    const promptInputs = ordered.filter(src => src.prompt && !src.refs?.length);
    const mode = node.mode || 'text';
    const imageFieldCount = mode === 'custom' ? comfyFields(node, 'image').length : 0;
    const videoFieldCount = mode === 'custom' ? comfyFields(node, 'video').length : 0;
    const audioFieldCount = mode === 'custom' ? comfyFields(node, 'audio').length : 0;
    const mediaFieldCount = imageFieldCount + videoFieldCount + audioFieldCount;
    if(mode === 'custom'){
        const validWorkflow = validComfyWorkflowName(node.comfyWorkflow);
        if(node.comfyWorkflow && node.comfyWorkflow !== validWorkflow) node.comfyWorkflow = validWorkflow;
        if(!node.comfyWorkflow && validWorkflow) node.comfyWorkflow = validWorkflow;
    }
    wrap.innerHTML = `
        <div class="mode-tabs">
            <button type="button" data-mode="text" class="${mode === 'text' ? 'active' : ''}">${tr('canvas.comfyModeText')}</button>
            <button type="button" data-mode="enhance" class="${mode === 'enhance' ? 'active' : ''}">${tr('canvas.comfyModeEnhance')}</button>
            <button type="button" data-mode="edit" class="${mode === 'edit' ? 'active' : ''}">${tr('canvas.comfyModeEdit')}</button>
            <button type="button" data-mode="custom" class="${mode === 'custom' ? 'active' : ''}">${tr('canvas.comfyModeCustom')}</button>
        </div>
        <div class="comfy-content">
            <div class="prompt-list"></div>
            <div class="comfy-images ${(mode === 'text' || (mode === 'custom' && !mediaFieldCount)) ? 'hidden' : ''}">
                <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest">${mode === 'custom' ? `Media · Images ${imageFieldCount} · Videos ${videoFieldCount} · Audio ${audioFieldCount}` : 'Images'}</div>
                <div class="input-list mt-2"></div>
            </div>
        </div>
        <div class="comfy-controls">
            <div class="gen-settings comfy-settings"></div>
            <div class="gen-run-row">
                ${(() => {
                    const comfyBtn = agentPendingRunState(node.id, tr('canvas.comfyRun'), tr('canvas.comfyRunning'));
                    return agentGenRunActionsHtml(node.id, `<button class="comfy-run ${comfyBtn.runningCls}" ${isNodeDisabled(node) ? 'disabled' : ''}><i data-lucide="zap" class="w-4 h-4"></i>${escapeHtml(comfyBtn.label)}</button>`);
                })()}
                ${cascadeBtnHtml(node)}
            </div>
            ${retryBarHtml(node)}
        </div>
    `;
    wrap.querySelectorAll('[data-mode]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            node.mode = btn.dataset.mode;
            if(node.mode === 'custom' && !hasComfyWorkflow(node.comfyWorkflow) && comfyWorkflows[0]?.name){
                node.comfyWorkflow = comfyWorkflows[0].name;
                ensureComfyWorkflow(node.comfyWorkflow).then(() => render());
            }
            render();
            scheduleSave();
        };
    });
    renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    if(mode !== 'text' && !(mode === 'custom' && !mediaFieldCount)){
        renderComfyImages(wrap.querySelector('.input-list'), node, mode === 'custom' ? mediaInputs : imageInputs);
    }
    renderComfySettings(wrap.querySelector('.comfy-settings'), node);
    wrap.querySelector('.comfy-run').onclick = e => { e.stopPropagation(); runCanvasGenerate(node.id); };
    bindCascadeButtons(wrap, node.id);
    return wrap;
}
function renderComfyImages(list, node, imageInputs){
    list.innerHTML = imageInputs.length ? '' : `<div class="text-[11px] text-gray-300 py-2">${tr('canvas.groupEmpty')}</div>`;
    imageInputs.forEach((src, i) => {
        const item = document.createElement('div');
        item.className = 'input-item';
        item.draggable = true;
        item.dataset.sourceId = src.id;
        const firstRef = (src.refs || [])[0];
        const kind = mediaKindForRef(firstRef || src.preview);
        const icon = kind === 'video' ? 'file-video' : kind === 'audio' ? 'file-audio' : 'image';
        const label = kind === 'image' ? `${tr('canvas.image')} ${i + 1}` : `${nodeTitleForMedia({mediaKind:kind})} ${i + 1}`;
        const previewHtml = kind === 'video' && src.preview && !isMissingAssetUrl(src.preview)
            ? `<video src="${escapeAttr(src.preview)}" muted preload="metadata" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"></video>`
            : kind === 'audio'
                ? `<i data-lucide="${icon}" class="w-6 h-6 text-slate-400"></i>`
                : (src.preview && !isMissingAssetUrl(src.preview) ? `<img src="${escapeAttr(src.preview)}">` : (src.preview ? missingAssetHtml(src.preview, true) : `<i data-lucide="${icon}" class="w-6 h-6 text-slate-400"></i>`));
        item.innerHTML = `<span class="input-index">${i + 1}</span>${previewHtml}<span class="input-label">${escapeHtml(label)}</span>`;
        item.ondragstart = e => {
            e.stopPropagation();
            internalDrag = true;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/x-canvas-input', src.id);
        };
        item.ondragend = () => { internalDrag = false; };
        item.ondragover = e => { e.preventDefault(); e.stopPropagation(); };
        item.ondrop = e => {
            e.preventDefault();
            e.stopPropagation();
            reorderInput(node, e.dataTransfer.getData('application/x-canvas-input'), src.id);
            internalDrag = false;
        };
        list.appendChild(item);
    });
}
const RH_KNOWN_FIELD_OPTIONS = {
    aspectRatio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
    aspect_ratio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3','21:9','9:21'],
    ratio:['1:1','16:9','9:16','4:3','3:4','4:5','5:4','3:2','2:3'],
    resolution:['1k','2k','4k','8k'],
    size:['512','768','1024','1280','1536','2048'],
    mode:['text2img','img2img'],
    quality:['low','medium','high','best'],
    instanceType:['default','plus','pro'],
    instance_type:['default','plus','pro'],
    precision:['fp16','fp32','bf16'],
    scheduler:['normal','karras','exponential','sgm_uniform','simple','ddim_uniform'],
    sampler:['euler','euler_ancestral','heun','dpm_2','dpm_2_ancestral','lms','dpmpp_2m','dpmpp_sde','ddim','uni_pc']
};
function rhParamKey(nodeId, fieldName){
    return `${nodeId ?? ''}::${fieldName ?? ''}`;
}
function rhFieldKind(field){
    const type = String(field?.fieldType || '').trim().toUpperCase();
    if(type === 'IMAGE') return 'image';
    if(type === 'VIDEO') return 'video';
    if(type === 'AUDIO') return 'audio';
    if(['NUMBER','FLOAT','INTEGER','INT'].includes(type)) return 'number';
    if(['BOOLEAN','BOOL'].includes(type)) return 'boolean';
    const key = `${field?.fieldName || ''} ${field?.fieldValue || ''}`.toLowerCase();
    if(/\b(image|img|mask|photo|picture)\b/.test(key) || /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(key)) return 'image';
    if(/\b(video|movie|mp4)\b/.test(key) || /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(key)) return 'video';
    if(/\b(audio|sound|music|voice)\b/.test(key) || /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(key)) return 'audio';
    return 'text';
}
function rhFieldRole(field){
    const kind = rhFieldKind(field);
    if(['image','video','audio','number','boolean'].includes(kind)) return kind;
    const text = `${field?.fieldName || ''} ${field?.label || ''} ${field?.group || ''}`.toLowerCase();
    if(/prompt|positive|negative|text|caption|description|关键词|提示词|正向|负向/.test(text)) return 'prompt';
    return 'text';
}
function rhExtractFieldOptions(field){
    const candidates = [field?.fieldData, field?.options, field?.list, field?.values, field?.enum, field?.choices, field?.items, field?.selectOptions, field?.dropdown];
    for(const candidate of candidates){
        if(!Array.isArray(candidate) || !candidate.length) continue;
        if(candidate.every(x => ['string','number'].includes(typeof x))) return candidate.map(String);
        if(candidate.every(x => x && typeof x === 'object' && ('value' in x || 'label' in x || 'name' in x))){
            return candidate.map(x => x.value ?? x.label ?? x.name).filter(v => v !== undefined && v !== null).map(String);
        }
    }
    const fieldType = String(field?.fieldType || '').toUpperCase();
    if(['LIST','SELECT','DROPDOWN','COMBO','ENUM'].includes(fieldType) && Array.isArray(field?.fieldValue)){
        return field.fieldValue.filter(x => ['string','number'].includes(typeof x)).map(String);
    }
    const name = String(field?.fieldName || '').trim();
    if(name){
        if(RH_KNOWN_FIELD_OPTIONS[name]) return RH_KNOWN_FIELD_OPTIONS[name].map(String);
        const hit = Object.keys(RH_KNOWN_FIELD_OPTIONS).find(k => k.toLowerCase() === name.toLowerCase());
        if(hit) return RH_KNOWN_FIELD_OPTIONS[hit].map(String);
    }
    return null;
}
function rhDefaultValue(field){
    let value = field?.fieldValue;
    if(Array.isArray(value)) value = value[0];
    if(value === undefined || value === null || typeof value === 'object') return '';
    return String(value);
}
function rhRandomEnabled(field){
    return rhFieldKind(field) === 'number' && field?.random_enabled === true;
}
function rhRandomActive(node, key){
    node.rhRandomActive = node.rhRandomActive || {};
    return node.rhRandomActive[key] !== false;
}
function toggleRhRandom(nodeId, key){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    const field = rhActiveFields(node).find(f => rhParamKey(f.nodeId, f.fieldName) === key);
    if(!rhRandomEnabled(field)) return;
    node.rhRandomActive = node.rhRandomActive || {};
    node.rhRandomActive[key] = !rhRandomActive(node, key);
    refreshNodes([node.id]);
    scheduleSave();
}
function rhWorkflowNodeInfoList(data){
    const list = [];
    if(!data || typeof data !== 'object' || Array.isArray(data)) return list;
    Object.entries(data).forEach(([nodeId, nodeContent]) => {
        const inputs = nodeContent?.inputs || {};
        if(!inputs || typeof inputs !== 'object') return;
        Object.entries(inputs).forEach(([fieldName, rawValue]) => {
            if(rhIsWorkflowLinkValue(rawValue)) return;
            let fieldValue = rawValue;
            if(fieldValue !== null && typeof fieldValue === 'object') fieldValue = JSON.stringify(fieldValue);
            else if(fieldValue === undefined || fieldValue === null) fieldValue = '';
            else fieldValue = String(fieldValue);
            list.push({
                nodeId:String(nodeId),
                fieldName:String(fieldName),
                fieldValue,
                fieldType:rhInferWorkflowFieldType(fieldName, fieldValue),
                source:'workflow'
            });
        });
    });
    return list;
}
function rhInferWorkflowFieldType(fieldName, fieldValue){
    const key = `${fieldName || ''} ${fieldValue || ''}`.toLowerCase();
    if(/\b(image|img|mask|photo|picture)\b/.test(key) || /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(key)) return 'IMAGE';
    if(/\b(video|movie|mp4)\b/.test(key) || /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(key)) return 'VIDEO';
    if(/\b(audio|sound|music|voice)\b/.test(key) || /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(key)) return 'AUDIO';
    if(/^(true|false)$/i.test(String(fieldValue || ''))) return 'BOOLEAN';
    if(String(fieldValue || '').trim() !== '' && !Number.isNaN(Number(fieldValue))) return 'NUMBER';
    return 'TEXT';
}
function rhIsWorkflowLinkValue(value){
    return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && Number.isInteger(value[1]);
}
function runningHubProvider(){
    const provider = (apiProviders || []).find(p => p.id === 'runninghub');
    return provider || null;
}
function runningHubEntries(kind){
    const provider = runningHubProvider();
    const key = kind === 'workflow' ? 'rh_workflows' : 'rh_apps';
    return Array.isArray(provider?.[key]) ? provider[key].filter(item => item?.enabled !== false) : [];
}
function runningHubEntryId(entry, kind){
    return String(kind === 'workflow' ? (entry?.workflowId || entry?.id || '') : (entry?.appId || entry?.id || '')).trim();
}
function runningHubEntryLabel(entry, kind){
    const id = runningHubEntryId(entry, kind);
    return entry?.title || entry?.name || (kind === 'workflow' ? `工作流 ${id.slice(-6)}` : `AI 应用 ${id.slice(-6)}`);
}
function runningHubEntryKey(kind, id){
    return `${kind}:${String(id || '').trim()}`;
}
function parseRunningHubEntryKey(value){
    const text = String(value || '').trim();
    const match = text.match(/^(app|workflow):(.+)$/);
    if(match) return {kind:match[1], id:match[2]};
    return null;
}
function runningHubAllEntries(){
    return [
        ...runningHubEntries('app').map(entry => ({kind:'app', id:runningHubEntryId(entry, 'app'), entry})),
        ...runningHubEntries('workflow').map(entry => ({kind:'workflow', id:runningHubEntryId(entry, 'workflow'), entry}))
    ].filter(item => item.id);
}
function rhSelectedEntryRef(node){
    const parsed = parseRunningHubEntryKey(node?.rhConfigKey || '');
    const all = runningHubAllEntries();
    if(parsed){
        const hit = all.find(item => item.kind === parsed.kind && item.id === parsed.id);
        if(hit) return hit;
    }
    const workflowId = validRunningHubWorkflowId(node?.workflowId || '');
    if(workflowId){
        const hit = all.find(item => item.kind === 'workflow' && item.id === workflowId);
        if(hit) return hit;
    }
    const webappId = String(node?.webappId || '').trim();
    if(webappId){
        const hit = all.find(item => item.kind === 'app' && item.id === webappId);
        if(hit) return hit;
    }
    return null;
}
function applyRhEntrySelection(node, ref){
    if(!node || !ref) return;
    node.rhConfigKey = runningHubEntryKey(ref.kind, ref.id);
    node.rhMode = ref.kind;
    if(ref.kind === 'workflow') node.workflowId = ref.id;
    else node.webappId = ref.id;
}
function currentRunningHubAppConfig(node){
    const webappId = String(node?.webappId || '').trim();
    if(!webappId) return null;
    return runningHubEntries('app').find(app => runningHubEntryId(app, 'app') === webappId) || null;
}
function currentRunningHubWorkflowEntry(node){
    const workflowId = validRunningHubWorkflowId(node?.workflowId || '');
    if(!workflowId) return null;
    return runningHubEntries('workflow').find(workflow => runningHubEntryId(workflow, 'workflow') === workflowId) || null;
}
function rhEntryFields(entry){
    return Array.isArray(entry?.fields) ? entry.fields : [];
}
function rhWorkflowJsonFromSources(...sources){
    for(const source of sources){
        if(source && typeof source === 'object' && Object.keys(source).length) return source;
    }
    return {};
}
function rhCurrentEntry(node){
    return rhSelectedEntryRef(node)?.entry || null;
}
function rhCurrentKind(node){
    return rhSelectedEntryRef(node)?.kind || (node?.rhMode === 'workflow' ? 'workflow' : 'app');
}
function ensureRhNodeSelection(node){
    if(!node || node.type !== 'rh') return null;
    node.rhPayment = node.rhPayment || 'free';
    const all = runningHubAllEntries();
    let ref = rhSelectedEntryRef(node);
    if(!ref && all.length) ref = all[0];
    if(ref){
        applyRhEntrySelection(node, ref);
        return ref.entry;
    }
    return null;
}
function rhEntryOptions(selected){
    const apps = runningHubEntries('app');
    const workflows = runningHubEntries('workflow');
    if(!apps.length && !workflows.length) return `<option value="">请先在 API 设置里添加 RH 配置</option>`;
    const group = (kind, entries, label) => entries.length ? `
        <optgroup label="${label}">
            ${entries.map(entry => {
                const id = runningHubEntryId(entry, kind);
                const key = runningHubEntryKey(kind, id);
                return `<option value="${escapeAttr(key)}" ${String(selected || '') === key ? 'selected' : ''}>${escapeHtml(runningHubEntryLabel(entry, kind))}</option>`;
            }).join('')}
        </optgroup>
    ` : '';
    return `${group('app', apps, 'AI 应用')}${group('workflow', workflows, '工作流')}`;
}
function rhPaymentOptions(node){
    const provider = runningHubProvider();
    const selected = node.rhPayment === 'wallet' ? 'wallet' : 'free';
    return `
        <option value="free" ${selected === 'free' ? 'selected' : ''}>免费积分 Key${provider?.has_key ? '' : '（未配置）'}</option>
        <option value="wallet" ${selected === 'wallet' ? 'selected' : ''}>账户余额 Key${provider?.has_wallet_key ? '' : '（未配置）'}</option>
    `;
}
function rhUseWallet(node){
    return node?.rhPayment === 'wallet';
}
function rhActiveFields(node){
    const sortFields = fields => [...(fields || [])].sort((a, b) => {
        const ak = rhFieldKind(a), bk = rhFieldKind(b);
        if(ak === 'image' && bk === 'image'){
            const ao = Number(a.imageOrder) || 9999;
            const bo = Number(b.imageOrder) || 9999;
            if(ao !== bo) return ao - bo;
        }
        if(ak === 'image' && bk !== 'image') return -1;
        if(ak !== 'image' && bk === 'image') return 1;
        return String(a.nodeId || '').localeCompare(String(b.nodeId || ''), undefined, {numeric:true}) || String(a.fieldName || '').localeCompare(String(b.fieldName || ''));
    });
    if(rhCurrentKind(node) === 'workflow') {
        const workflowId = validRunningHubWorkflowId(node.workflowId || '');
        const savedEntry = currentRunningHubWorkflowEntry(node);
        if(Array.isArray(savedEntry?.fields) && savedEntry.fields.length) return sortFields(savedEntry.fields.filter(f => f.enabled === true));
        const saved = workflowId ? runningHubWorkflowCache[workflowId] : null;
        if(Array.isArray(saved?.fields)) return sortFields(saved.fields.filter(f => f.enabled === true));
        return sortFields(node.rhWorkflowInfo?.nodeInfoList || []);
    }
    const savedApp = currentRunningHubAppConfig(node);
    if(Array.isArray(savedApp?.fields) && savedApp.fields.length) return sortFields(savedApp.fields.filter(f => f.enabled === true));
    return sortFields(node.rhAppInfo?.nodeInfoList || []);
}
function currentRunningHubWorkflowConfig(node){
    if(rhCurrentKind(node) !== 'workflow') return null;
    const workflowId = validRunningHubWorkflowId(node.workflowId || '');
    const entry = currentRunningHubWorkflowEntry(node);
    if(entry){
        const cached = workflowId ? runningHubWorkflowCache[workflowId] : null;
        return {
            ...entry,
            ...(cached || {}),
            workflowId:runningHubEntryId(entry, 'workflow') || workflowId,
            title:entry.title || cached?.title || workflowId,
            fields:rhEntryFields(entry).length ? rhEntryFields(entry) : (cached?.fields || []),
            optionalImageMode:entry.optionalImageMode || cached?.optionalImageMode || 'prune-workflow',
            workflowJson:rhWorkflowJsonFromSources(cached?.workflowJson, entry.workflowJson, entry.raw?.workflowJson, entry.raw?.prompt)
        };
    }
    return workflowId ? runningHubWorkflowCache[workflowId] : null;
}
async function ensureRunningHubWorkflowConfigForNode(node){
    if(rhCurrentKind(node) !== 'workflow') return null;
    const workflowId = validRunningHubWorkflowId(node.workflowId || '');
    if(!workflowId) return null;
    if(!runningHubWorkflowCache[workflowId]){
        try { await ensureRunningHubWorkflow(workflowId); } catch(_) {}
    }
    return currentRunningHubWorkflowConfig(node);
}
function rhMediaSources(node, ctx=loopContext){
    const sources = orderedSources(node, generatorSources(node, ctx));
    const refs = sources.flatMap(src => src.refs || []).filter(ref => ref?.url);
    return {
        sources,
        refs,
        image:imageRefsOnly(refs),
        video:videoRefsOnly(refs),
        audio:audioRefsOnly(refs),
        prompt:sources.map(src => src.prompt).filter(Boolean).join('\n\n')
    };
}
function rhFieldIndexes(fields){
    const counters = {image:0, video:0, audio:0};
    const map = {};
    const ordered = [...(fields || [])].sort((a, b) => {
        const ak = rhFieldKind(a), bk = rhFieldKind(b);
        if(ak === 'image' && bk === 'image'){
            return (Number(a.imageOrder) || 9999) - (Number(b.imageOrder) || 9999);
        }
        return 0;
    });
    ordered.forEach(field => {
        const kind = rhFieldKind(field);
        if(['image','video','audio'].includes(kind)){
            map[rhParamKey(field.nodeId, field.fieldName)] = counters[kind]++;
        }
    });
    return map;
}
function rhFieldValue(node, field, media=null){
    node.rhParams = node.rhParams || {};
    const key = rhParamKey(field.nodeId, field.fieldName);
    const kind = rhFieldKind(field);
    const param = node.rhParams[key];
    if(['image','video','audio'].includes(kind)){
        const idx = rhFieldIndexes(rhActiveFields(node))[key] || 0;
        const up = (media || rhMediaSources(node))[kind]?.[idx]?.url || '';
        if(rhCurrentKind(node) === 'workflow' && kind === 'image' && field.required !== true && !up && param?.sourceFromUpstream !== false) return '';
        if(param?.sourceFromUpstream === false) return param.value ?? rhDefaultValue(field);
        return up || param?.value || rhDefaultValue(field);
    }
    if(rhRandomEnabled(field) && rhRandomActive(node, key)){
        node.rhRandomValues = node.rhRandomValues || {};
        if(node.rhRandomValues[key] === undefined){
            node.rhRandomValues[key] = comfyRandomValue({
                input:field.fieldName,
                name:field.label || field.fieldName,
                min:field.min,
                max:field.max,
                step:field.step,
                type:'number'
            });
        }
        return node.rhRandomValues[key];
    }
    if(rhFieldRole(field) === 'prompt'){
        const upstreamPrompt = (media || rhMediaSources(node)).prompt || '';
        return param?.value ?? (upstreamPrompt || rhDefaultValue(field));
    }
    return param?.value ?? rhDefaultValue(field);
}
function rhRequiredLabel(field){
    return field?.label || field?.fieldName || `#${field?.nodeId || ''}`;
}
function rhPruneWorkflowForMissingFields(workflowJson, missingFields){
    if(!workflowJson || typeof workflowJson !== 'object' || !missingFields?.length) return null;
    const workflow = JSON.parse(JSON.stringify(workflowJson));
    const removeIds = new Set();
    missingFields.forEach(field => {
        const node = workflow[String(field.nodeId)];
        if(node?.inputs && Object.prototype.hasOwnProperty.call(node.inputs, field.fieldName)){
            delete node.inputs[field.fieldName];
        }
        if(node && rhWorkflowNodeInfoList({[field.nodeId]: node}).length <= 0){
            removeIds.add(String(field.nodeId));
        }
    });
    removeIds.forEach(id => delete workflow[id]);
    Object.values(workflow).forEach(node => {
        if(!node?.inputs || typeof node.inputs !== 'object') return;
        Object.entries(node.inputs).forEach(([name, value]) => {
            if(rhIsWorkflowLinkValue(value) && removeIds.has(String(value[0]))) delete node.inputs[name];
        });
    });
    return workflow;
}
async function rhBuildWorkflowRequestExtras(node, media, nodeInfoList){
    const config = await ensureRunningHubWorkflowConfigForNode(node);
    if(!config || (config.optionalImageMode || 'prune-workflow') !== 'prune-workflow') return {};
    const fields = rhActiveFields(node);
    const indexes = rhFieldIndexes(fields);
    const missingOptional = [];
    for(const field of fields){
        if(rhFieldKind(field) !== 'image') continue;
        const key = rhParamKey(field.nodeId, field.fieldName);
        const idx = indexes[key] || 0;
        const hasInput = Boolean(media.image?.[idx]?.url);
        if(field.required === true && !hasInput){
            throw new Error(`RunningHub 工作流缺少必选图片：${rhRequiredLabel(field)}`);
        }
        if(field.required !== true && !hasInput){
            missingOptional.push(field);
        }
    }
    if(!missingOptional.length) return {};
    missingOptional.forEach(field => {
        const key = rhParamKey(field.nodeId, field.fieldName);
        const idx = nodeInfoList.findIndex(item => rhParamKey(item.nodeId, item.fieldName) === key);
        if(idx >= 0) nodeInfoList.splice(idx, 1);
    });
    const workflow = rhPruneWorkflowForMissingFields(config.workflowJson || {}, missingOptional);
    return workflow ? {workflow} : {};
}
function rhMediaPreviewHtml(ref, kind){
    const safe = escapeAttr(ref?.url || '');
    if(kind === 'video') return `<video src="${safe}" muted preload="metadata" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"></video>`;
    if(kind === 'audio') return `<i data-lucide="file-audio" class="w-6 h-6 text-slate-400"></i>`;
    return safe && !isMissingAssetUrl(safe) ? `<img src="${safe}">` : `<i data-lucide="image" class="w-6 h-6 text-slate-400"></i>`;
}
function renderRhBody(node){
    // 无进行中 pending 时清掉存档里卡住的「运行中」徽章（按钮可能已是空闲态）
    reconcileAgentRunStateFromPending(node.id);
    const wrap = document.createElement('div');
    wrap.className = 'rh-body';
    node.rhParams = node.rhParams || {};
    const entry = ensureRhNodeSelection(node);
    const selectedRef = rhSelectedEntryRef(node);
    const media = rhMediaSources(node);
    const fields = rhActiveFields(node);
    const mode = selectedRef?.kind || rhCurrentKind(node);
    const selectedId = selectedRef?.id || (mode === 'workflow' ? (node.workflowId || '') : (node.webappId || ''));
    const selectedKey = selectedRef ? runningHubEntryKey(selectedRef.kind, selectedRef.id) : '';
    const entryNote = entry?.note || entry?.description || '';
    wrap.innerHTML = `
        <div class="rh-top">
            <label class="field rh-webapp-field">
                <div class="setting-title">RunningHub 配置</div>
                <select class="select-lite rh-entry-select">${rhEntryOptions(selectedKey)}</select>
            </label>
            <label class="field rh-payment-field">
                <div class="setting-title">Key</div>
                <select class="select-lite rh-payment-select">${rhPaymentOptions(node)}</select>
            </label>
            <label class="field rh-machine-field">
                <div class="setting-title">显存</div>
                <select class="select-lite rh-machine-select">
                    <option value="" ${!node.instanceType ? 'selected' : ''}>24G</option>
                    <option value="plus" ${node.instanceType === 'plus' ? 'selected' : ''}>48G</option>
                </select>
            </label>
        </div>
        <div class="rh-prompt-list"></div>
        <div class="rh-media-section">
            <div class="rh-media-head">
                <span class="generator-section-label" style="margin:0">${tr('canvas.rhInputs')}</span>
                ${(() => {
                    const mf = rhMediaFieldsFromList(fields);
                    if(!mf.length) return '';
                    const img = mf.filter(f => rhFieldRole(f) === 'image').length;
                    const vid = mf.filter(f => rhFieldRole(f) === 'video').length;
                    const aud = mf.filter(f => rhFieldRole(f) === 'audio').length;
                    const parts = [];
                    if(img) parts.push(`图片 ${img}`);
                    if(vid) parts.push(`视频 ${vid}`);
                    if(aud) parts.push(`音频 ${aud}`);
                    return parts.length ? `<span class="rh-media-count">${parts.join(' · ')}</span>` : '';
                })()}
            </div>
            <div class="input-list rh-input-list"></div>
        </div>
        <div class="rh-param-head">
            <span>${mode === 'workflow' ? tr('canvas.rhWorkflowParams') : tr('canvas.rhParams')}</span>
            <span>${fields.length}</span>
        </div>
        <div class="rh-param-list"></div>
        <div class="gen-run-row">
            ${(() => {
                const rhBtn = agentPendingRunState(node.id, tr('canvas.rhRun'), tr('canvas.rhRunning'));
                return agentGenRunActionsHtml(node.id, `<button class="gen-btn rh-run ${rhBtn.runningCls}" ${isNodeDisabled(node) ? 'disabled' : ''}><i data-lucide="workflow" class="w-4 h-4"></i>${escapeHtml(rhBtn.label)}</button>`);
            })()}
            ${cascadeBtnHtml(node)}
        </div>
        ${retryBarHtml(node)}
    `;
    const entrySelect = wrap.querySelector('.rh-entry-select');
    if(entrySelect) entrySelect.onchange = e => {
        const parsed = parseRunningHubEntryKey(e.target.value);
        const ref = parsed ? runningHubAllEntries().find(item => item.kind === parsed.kind && item.id === parsed.id) : null;
        if(ref) applyRhEntrySelection(node, ref);
        node.rhParams = {};
        node.rhRandomValues = {};
        render();
        scheduleSave();
    };
    const paymentSelect = wrap.querySelector('.rh-payment-select');
    if(paymentSelect) paymentSelect.onchange = e => {
        node.rhPayment = e.target.value === 'wallet' ? 'wallet' : 'free';
        scheduleSave();
    };
    const machineSelect = wrap.querySelector('.rh-machine-select');
    if(machineSelect) machineSelect.onchange = e => {
        node.instanceType = e.target.value === 'plus' ? 'plus' : '';
        scheduleSave();
    };
    renderRhPromptFields(wrap.querySelector('.rh-prompt-list'), node, fields);
    renderRhMediaFields(wrap.querySelector('.rh-input-list'), node, fields, media);
    renderRhParams(wrap.querySelector('.rh-param-list'), node, fields, media);
    wrap.querySelector('.rh-run').onclick = e => { e.stopPropagation(); runCanvasGenerate(node.id); };
    bindCascadeButtons(wrap, node.id);
    refreshIcons();
    return wrap;
}
function rhFieldDisplayLabel(field){
    return String(field?.label || field?.fieldName || 'Field').trim();
}
/** 参数名与说明同一行展示，避免说明掉到输入框下方导致错位。 */
function rhFieldTitleHtml(field, label){
    const safeLabel = escapeHtml(label);
    const note = String(field?.note || '').trim();
    const notePart = note && note !== label
        ? `<span class="rh-field-note">${escapeHtml(note)}</span>`
        : '';
    return `<div class="setting-title rh-field-title"><span class="rh-field-label">${safeLabel}</span>${notePart}</div>`;
}
function rhMediaConnectHint(kind){
    if(kind === 'video') return '拖入含视频的 Image 节点并连线';
    if(kind === 'audio') return '拖入含音频的上游节点并连线';
    return '拖入 Image 节点并连线';
}
function rhMediaFieldsFromList(fields){
    return (fields || []).filter(f => ['image','video','audio'].includes(rhFieldRole(f)));
}
function renderRhMediaFields(list, node, fields, media){
    if(!list) return;
    const slots = rhMediaFieldsFromList(fields);
    if(!slots.length) return renderRhInputs(list, node, media);
    list.innerHTML = slots.map(field => {
        const kind = rhFieldRole(field);
        const label = rhFieldDisplayLabel(field);
        const key = rhParamKey(field.nodeId, field.fieldName);
        const idx = rhFieldIndexes(fields)[key] || 0;
        const ref = media?.[kind]?.[idx] || null;
        const url = ref?.url || '';
        const badge = field.required === true ? '必选' : '可选';
        const preview = url
            ? rhMediaPreviewHtml(ref, kind)
            : `<i data-lucide="${kind === 'video' ? 'file-video' : kind === 'audio' ? 'file-audio' : 'image'}" class="w-6 h-6 text-slate-400"></i>`;
        return `<div class="rh-media-slot ${url ? 'has-media' : 'empty'}">
            ${rhFieldTitleHtml(field, label)}
            <div class="rh-media-slot-row">
                <div class="rh-media-slot-preview">${preview}</div>
                <div class="rh-media-slot-meta">
                    <span class="rh-media-slot-badge">${badge}</span>
                    <span class="rh-media-slot-hint">${url ? escapeHtml(ref?.name || '已连接上游素材') : rhMediaConnectHint(kind)}</span>
                </div>
            </div>
        </div>`;
    }).join('');
}
function renderRhInputs(list, node, media){
    if(!list) return;
    const refs = media.refs || [];
    if(!refs.length){
        list.innerHTML = `<div class="rh-media-empty">${langIsEn() ? 'Connect Image nodes (image or video) to the left port' : '将 Image 节点（图片或视频）连线到左侧输入端口'}</div>`;
        return;
    }
    list.innerHTML = '';
    refs.forEach((ref, i) => {
        const kind = mediaKindForRef(ref);
        const item = document.createElement('div');
        item.className = 'input-item rh-input-item';
        item.innerHTML = `<span class="input-index">${i + 1}</span>${rhMediaPreviewHtml(ref, kind)}<span class="input-label">${escapeHtml(nodeTitleForMedia({mediaKind:kind}))}</span>`;
        list.appendChild(item);
    });
}
function renderRhPromptFields(container, node, fields){
    if(!container) return;
    const prompts = (fields || []).filter(field => rhFieldRole(field) === 'prompt');
    if(!prompts.length){
        container.innerHTML = '';
        return;
    }
    container.innerHTML = prompts.map(field => {
        const key = rhParamKey(field.nodeId, field.fieldName);
        const label = rhFieldDisplayLabel(field) || 'Prompt';
        const value = rhFieldValue(node, field, rhMediaSources(node));
        return `<label class="field rh-prompt-field">
            ${rhFieldTitleHtml(field, label)}
            <textarea class="setting-input rh-param-input" data-rh-param="${escapeAttr(key)}" data-rh-role="prompt">${escapeHtml(value)}</textarea>
        </label>`;
    }).join('');
    bindRhParamControls(container, node);
}
function renderRhParams(container, node, fields, media){
    if(!container) return;
    const params = (fields || []).filter(field => {
        const role = rhFieldRole(field);
        return !['image','video','audio','prompt'].includes(role);
    });
    if(!params.length){
        container.innerHTML = `<div class="rh-empty">${tr('canvas.rhNoParams')}</div>`;
        return;
    }
    container.innerHTML = params.map((field, i) => {
        const key = rhParamKey(field.nodeId, field.fieldName);
        const kind = rhFieldRole(field);
        const options = rhExtractFieldOptions(field);
        const value = rhFieldValue(node, field, media);
        const label = rhFieldDisplayLabel(field) || `Field ${i + 1}`;
        const valueText = String(value ?? '');
        const wide = kind === 'text' && (String(label).length > 18 || valueText.length > 28);
        return renderRhSettingField(node, field, key, kind, label, value, options, wide);
    }).join('');
    bindRhParamControls(container, node);
}
function renderRhSettingField(node, field, key, kind, label, value, options, wide=false){
    const titleHtml = rhFieldTitleHtml(field, label);
    if(kind === 'boolean'){
        const active = String(value).toLowerCase() === 'true';
        return `<div class="gen-settings-row rh-param-row ${wide ? 'wide' : ''}">
            <div class="rh-param-field">
                ${titleHtml}
                <button type="button" class="setting-check ${active ? 'active' : ''}" data-rh-param="${escapeAttr(key)}" data-rh-type="boolean"><span class="check-dot"></span>${escapeHtml(active ? '开启' : '关闭')}</button>
            </div>
        </div>`;
    }
    if(options?.length){
        return `<div class="gen-settings-row rh-param-row ${wide ? 'wide' : ''}">
            <label class="field rh-param-field">${titleHtml}<select class="select-lite rh-param-input" data-rh-param="${escapeAttr(key)}" data-rh-type="select" style="width:100%">${options.map(opt => `<option value="${escapeAttr(opt)}" ${String(value) === String(opt) ? 'selected' : ''}>${escapeHtml(opt)}</option>`).join('')}</select></label>
        </div>`;
    }
    if(rhRandomEnabled(field)){
        const active = rhRandomActive(node, key);
        return `<div class="gen-settings-row rh-param-row ${wide ? 'wide' : ''}">
            <div class="comfy-random-field rh-param-field">
                <label class="field">${titleHtml}<input class="setting-input rh-param-input" type="number" data-rh-param="${escapeAttr(key)}" data-rh-type="number" value="${escapeAttr(value)}" ${active ? 'disabled' : ''}></label>
                <button class="tool-btn comfy-random-btn ${active ? 'active' : ''}" type="button" data-rh-random="${escapeAttr(key)}" title="${active ? '随机已开启，点击关闭' : '随机已关闭，点击开启'}"><i data-lucide="dice-5" class="w-4 h-4"></i></button>
            </div>
        </div>`;
    }
    const inputType = kind === 'number' ? 'number' : 'text';
    return `<div class="gen-settings-row rh-param-row ${wide ? 'wide' : ''}">
        <label class="field rh-param-field">${titleHtml}<input class="setting-input rh-param-input" type="${inputType}" data-rh-param="${escapeAttr(key)}" data-rh-type="${escapeAttr(kind)}" value="${escapeAttr(value)}"></label>
    </div>`;
}
function bindRhParamControls(container, node){
    container.querySelectorAll('button[data-rh-param]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            const key = btn.dataset.rhParam;
            node.rhParams = node.rhParams || {};
            const field = rhActiveFields(node).find(f => rhParamKey(f.nodeId, f.fieldName) === key);
            const cur = node.rhParams[key] || {};
            const on = String(rhFieldValue(node, field)).toLowerCase() === 'true';
            node.rhParams[key] = {...cur, value:String(!on)};
            render();
            scheduleSave();
        };
    });
    container.querySelectorAll('input[data-rh-param], select[data-rh-param], textarea[data-rh-param]').forEach(control => {
        control.onmousedown = e => e.stopPropagation();
        control.onclick = e => e.stopPropagation();
        control.oninput = control.onchange = e => {
            const key = control.dataset.rhParam;
            node.rhParams = node.rhParams || {};
            const cur = node.rhParams[key] || {};
            node.rhParams[key] = {...cur, value:e.target.value};
            scheduleSave();
        };
    });
    container.querySelectorAll('[data-rh-random]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            toggleRhRandom(node.id, btn.dataset.rhRandom);
        };
    });
}
async function rhFetchAppInfo(nodeId, showAlert=true){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    if(!String(node.webappId || '').trim()){
        if(showAlert) softAlert(tr('canvas.rhNeedWebappId'));
        return false;
    }
    node.rhFetching = true;
    refreshNodes([node.id]);
    try {
        const res = await apiFetch(`/api/runninghub/app-info?webappId=${encodeURIComponent(node.webappId.trim())}`);
        const data = await res.json();
        if(!res.ok || data.success === false) throw new Error(data.detail || data.error || tr('canvas.rhFailed'));
        node.rhAppInfo = data.data || {};
        node.rhParams = node.rhParams || {};
        (node.rhAppInfo.nodeInfoList || []).forEach(field => {
            const key = rhParamKey(field.nodeId, field.fieldName);
            if(!node.rhParams[key]) node.rhParams[key] = {value:rhDefaultValue(field)};
        });
        node.runStatus = '';
        node.runError = '';
        scheduleSave();
        return true;
    } catch(err) {
        if(showAlert) softAlert(err.message || tr('canvas.rhFailed'));
        return false;
    } finally {
        node.rhFetching = false;
        refreshNodes([node.id]);
    }
}
async function rhFetchWorkflowInfo(nodeId, showAlert=true){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return false;
    if(!String(node.workflowId || '').trim()){
        if(showAlert) softAlert(tr('canvas.rhNeedWorkflowId'));
        return false;
    }
    node.rhFetching = true;
    refreshNodes([node.id]);
    try {
        const saved = await ensureRunningHubWorkflow(node.workflowId.trim());
        const res = await apiFetch(`/api/runninghub/workflow-info?workflowId=${encodeURIComponent(node.workflowId.trim())}`);
        const data = await res.json();
        if(!res.ok || data.success === false) throw new Error(data.detail || data.error || tr('canvas.rhFailed'));
        const info = data.data || {};
        const savedFields = Array.isArray(saved?.fields) ? saved.fields : [];
        const mergedFields = savedFields.length
            ? savedFields
            : Array.isArray(info.nodeInfoList) ? info.nodeInfoList : [];
        node.rhWorkflowInfo = {
            workflowId:node.workflowId.trim(),
            nodeInfoList:mergedFields,
            raw:info.raw || null
        };
        node.rhParams = node.rhParams || {};
        (node.rhWorkflowInfo.nodeInfoList || []).forEach(field => {
            const key = rhParamKey(field.nodeId, field.fieldName);
            if(!node.rhParams[key]) node.rhParams[key] = {value:rhDefaultValue(field)};
        });
        node.runStatus = '';
        node.runError = '';
        scheduleSave();
        return true;
    } catch(err) {
        if(showAlert) softAlert(err.message || tr('canvas.rhFailed'));
        return false;
    } finally {
        node.rhFetching = false;
        refreshNodes([node.id]);
    }
}
async function rhImportWorkflowJson(nodeId, file){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || !file) return;
    try {
        const text = await file.text();
        const json = JSON.parse(text);
        const nodeInfoList = rhWorkflowNodeInfoList(json);
        if(!nodeInfoList.length) throw new Error(tr('canvas.rhWorkflowJsonInvalid'));
        node.rhMode = 'workflow';
        node.rhWorkflowInfo = {fileName:file.name || 'api.json', nodeInfoList};
        node.rhParams = node.rhParams || {};
        nodeInfoList.forEach(field => {
            const key = rhParamKey(field.nodeId, field.fieldName);
            if(!node.rhParams[key]) node.rhParams[key] = {value:rhDefaultValue(field)};
        });
        node.runStatus = '';
        node.runError = '';
        render();
        scheduleSave();
    } catch(err) {
        softAlert(err.message || tr('canvas.rhWorkflowJsonInvalid'));
    }
}
async function rhUploadValueIfNeeded(value, node=null){
    const text = String(value || '').trim();
    if(!text) return '';
    // 画布素材多在 /uploads/…，须先传到 RunningHub 拿 fileName；与 RhLivePreviewPanel.uploadValueIfNeeded 对齐。
    const needsUpload = /^https?:\/\//i.test(text)
        || text.startsWith('/uploads/')
        || text.startsWith('/output/')
        || text.startsWith('/assets/');
    if(!needsUpload) return text;
    const res = await apiFetch('/api/runninghub/upload-asset', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({url:text, useWallet:rhUseWallet(node)})
    });
    const data = await res.json();
    if(!res.ok || data.success === false) throw new Error(data.detail || data.error || tr('canvas.rhUploadFailed'));
    return data.data?.fileName || text;
}
function rhSummarizeTaskFail(raw){
    const text = String(raw || '').trim();
    if(!text) return tr('canvas.rhFailed');
    if(text.startsWith('{') || text.startsWith('[')){
        try {
            const obj = JSON.parse(text);
            const node = String(obj.node_name || obj.nodeName || '').trim();
            const trace = Array.isArray(obj.traceback) ? obj.traceback.join('\n') : String(obj.traceback || '');
            const extra = String(obj.exception_message || obj.exception_type || '').trim();
            const detail = [trace, extra].filter(Boolean).join('\n').trim();
            if(/Invalid video file/i.test(trace) || /VHS_LoadVideo/i.test(node)){
                return 'RunningHub 无法读取视频素材。请确认已连接含视频的上游 Image 节点，并等待素材上传完成后再运行。';
            }
            if(node) return `RunningHub 节点「${node}」执行失败：${detail ? `\n${detail}` : ''}`.trim();
        } catch(_) {}
    }
    return text.length > 320 ? `${text.slice(0, 320)}…` : text;
}
async function rhBuildNodeInfoList(node, media){
    const fields = rhActiveFields(node);
    const result = [];
    const indexes = rhFieldIndexes(fields);
    for(const field of fields){
        const kind = rhFieldKind(field);
        const key = rhParamKey(field.nodeId, field.fieldName);
        if(rhCurrentKind(node) === 'workflow' && field.sourceFromUpstream === false && !['image','video','audio'].includes(kind)) continue;
        if(rhCurrentKind(node) === 'workflow' && kind === 'image'){
            const idx = indexes[key] || 0;
            const hasInput = Boolean(media.image?.[idx]?.url);
            if(field.required !== true && !hasInput) continue;
        }
        let value = rhFieldValue(node, field, media);
        if(['image','video','audio'].includes(kind)) value = await rhUploadValueIfNeeded(value, node);
        if(typeof value === 'string' && /[\r\n]/.test(value)) value = value.split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0] || '';
        result.push({nodeId:field.nodeId, fieldName:field.fieldName, fieldValue:value});
    }
    return result;
}
async function runRhNode(nodeId, opts={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || isNodeDisabled(node)) return;
    ensureRhNodeSelection(node);
    const mode = rhCurrentKind(node);
    node.rhRandomValues = {};
    if(mode === 'workflow' && !String(node.workflowId || '').trim()){ softAlert(tr('canvas.rhNeedWorkflowId')); return; }
    if(mode === 'app' && !String(node.webappId || '').trim()){ softAlert(tr('canvas.rhNeedWebappId')); return; }
    const selectedEntry = rhCurrentEntry(node);
    if(!selectedEntry){
        softAlert(mode === 'workflow' ? '请先在 API 设置里添加 RH 工作流' : '请先在 API 设置里添加 RH 应用');
        return;
    }
    if(mode === 'workflow') await ensureRunningHubWorkflowConfigForNode(node);
    if(!rhActiveFields(node).length){
        softAlert(mode === 'workflow' ? '请先在 API 设置里编辑并保存这个 RH 工作流参数' : '请先在 API 设置里编辑并保存这个 RH 应用参数');
        return;
    }
    const media = rhMediaSources(node);
    let out = outputForNode(node, 500);
    const pendingId = uid('p');
    const run = runSnapshot(node, media.prompt || 'RunningHub', media.refs);
    run.taskLabel = 'RunningHub';
    if(out) out._pending = [...(out._pending || []), makePending(pendingId, run)];
    syncAppendableNodeRunState(node);
    refreshRunNodes(node, out);
    const execute = async () => {
    try {
        const nodeInfoList = await rhBuildNodeInfoList(node, media);
        const workflowExtras = mode === 'workflow' ? await rhBuildWorkflowRequestExtras(node, media, nodeInfoList) : {};
        const endpoint = mode === 'workflow' ? '/api/runninghub/workflow-submit' : '/api/runninghub/submit';
        const body = mode === 'workflow'
            ? {workflowId:node.workflowId.trim(), nodeInfoList, instanceType:node.instanceType || '', useWallet:rhUseWallet(node), ...workflowExtras}
            : {webappId:node.webappId.trim(), nodeInfoList, instanceType:node.instanceType || '', useWallet:rhUseWallet(node)};
        const submit = await fetch(endpoint, {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(body)
        }).then(async r => {
            const data = await r.json();
            if(!r.ok || data.success === false) throw new Error(data.detail || data.error || tr('canvas.rhFailed'));
            return data.data || data;
        });
        const taskId = submit.taskId;
        if(!taskId) throw new Error(tr('canvas.rhNoTaskId'));
        run.request = {task_id:taskId, webappId:node.webappId, workflowId:node.workflowId, backend:'runninghub', mode};
        let result = null;
        for(let i = 0; i < 720; i++){
            if(!isOutputPendingActive(out, pendingId)) return;
            await sleep(2500);
            if(!isOutputPendingActive(out, pendingId)) return;
            const data = await apiFetch(`/api/runninghub/query?taskId=${encodeURIComponent(taskId)}`).then(async r => {
                const json = await r.json();
                if(!r.ok || json.success === false) throw new Error(json.detail || json.error || tr('canvas.rhFailed'));
                return json.data || json;
            });
            if(data.status === 'SUCCESS'){
                result = data;
                break;
            }
            if(data.status === 'FAILED') throw new Error(rhSummarizeTaskFail(data.failReason || data.raw));
        }
        if(!result) throw new Error(tr('canvas.rhTimeout'));
        if(!isOutputPendingActive(out, pendingId)) return;
        const outputs = result.urls || [];
        if(!outputs.length) throw new Error(tr('canvas.rhOutputsEmpty'));
        const meta = collectRunMeta(out, pendingId);
        if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
        appendOutputImages(out, outputs, media.refs[0], [meta]);
        mergeGeneratedOutputs(node, outputs, Boolean(opts.cascade));
        addGenerationLog({run, outputs, runMs:meta.runMs || 0});
        syncAgentRunStatusAfterTask(node, {completed:agentPendingCount(node.id) === 0});
        refreshRunNodes(node, out);
        scheduleSave();
    } catch(err) {
        if(!isOutputPendingActive(out, pendingId)){
            reconcileAgentRunStateFromPending(node.id);
            refreshRunNodes(node, out);
            if(opts.cascade) throw err;
            return;
        }
        const meta = collectRunMeta(out, pendingId);
        addGenerationLog({run, outputs:[], runMs:meta.runMs || 0, error:err.message || String(err)});
        if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
        syncAgentRunStatusAfterTask(node, {failed:agentPendingCount(node.id) === 0, error:err.message || String(err)});
        refreshRunNodes(node, out);
        if(opts.cascade) throw err;
    }
    };
    if(opts.cascade) await execute();
    else void execute();
}
function renderComfySettings(container, node){
    const mode = node.mode || 'text';
    if(mode === 'text'){
        container.innerHTML = `
            <div class="gen-settings-row">
                <label class="field"><div class="setting-title">${tr('canvas.width')}</div><input class="setting-input" data-field="width" type="number" min="64" step="64" value="${Number(node.width || 1024)}"></label>
                <label class="field"><div class="setting-title">${tr('canvas.height')}</div><input class="setting-input" data-field="height" type="number" min="64" step="64" value="${Number(node.height || 1024)}"></label>
            </div>
        `;
    } else if(mode === 'enhance'){
        const strength = Number(node.enhanceStrength ?? 0.5);
        container.innerHTML = `
            <div class="gen-settings-row">
                <label class="field" style="flex:1">
                    <div class="setting-title" style="display:flex;justify-content:space-between">
                        <span>${tr('studio.enhancementStrength')}</span><span class="enhance-strength-val">${strength.toFixed(2)}</span>
                    </div>
                    <input type="range" class="canvas-range enhance-strength-slider" data-field="enhanceStrength" min="0.1" max="1.0" step="0.05" value="${strength}">
                </label>
            </div>
            <div class="gen-settings-row">
                <button type="button" class="setting-check ${node.enhanceUpscale ? 'active' : ''}" data-toggle-field="enhanceUpscale"><span class="check-dot"></span>${tr('studio.superResolution')}</button>
                <select class="select-lite ${node.enhanceUpscale ? '' : 'opacity-40 cursor-not-allowed'}" data-field="enhanceUpscaleRes" ${node.enhanceUpscale ? '' : 'disabled'}><option value="2048">2X (2048)</option><option value="4096">4X (4096)</option></select>
            </div>
        `;
        container.querySelector('[data-field="enhanceUpscaleRes"]').value = String(node.enhanceUpscaleRes || 2048);
    } else if(mode === 'edit'){
        container.innerHTML = `
            <div class="gen-settings-row">
                <button type="button" class="setting-check ${node.editUpscale ? 'active' : ''}" data-toggle-field="editUpscale"><span class="check-dot"></span>${tr('studio.superResolution')}</button>
                <select class="select-lite ${node.editUpscale ? '' : 'opacity-40 cursor-not-allowed'}" data-field="editUpscaleRes" ${node.editUpscale ? '' : 'disabled'}><option value="2048">2X (2048)</option><option value="4096">4X (4096)</option></select>
            </div>
        `;
        container.querySelector('[data-field="editUpscaleRes"]').value = String(node.editUpscaleRes || 2048);
    } else if(mode === 'custom'){
        const selected = validComfyWorkflowName(node.comfyWorkflow || comfyWorkflows[0]?.name || '');
        if(node.comfyWorkflow && node.comfyWorkflow !== selected) node.comfyWorkflow = selected;
        const data = currentComfyWorkflow(node);
        const fields = data?.config?.fields || [];
        const settingFields = fields.filter(f => comfyFieldKind(f) === 'setting');
        container.innerHTML = `
            <div class="gen-settings-row">
                <select class="select-lite comfy-workflow-select" data-field="comfyWorkflow" style="width:100%">${comfyWorkflowOptions(selected)}</select>
            </div>
            ${!selected ? `<div class="text-[11px] text-slate-400">${tr('canvas.comfyNoWorkflow')}</div>` : (!data ? `<div class="text-[11px] text-slate-400">${tr('canvas.comfyLoadingWorkflow')}</div>` : '')}
            ${data ? settingFields.map(f => renderComfyCustomField(node, f)).join('') || `<div class="text-[11px] text-slate-400">${tr('canvas.comfyNoExtraParams')}</div>` : ''}
        `;
        if(selected && !data) ensureComfyWorkflow(selected).then(() => render());
    } else {
        container.innerHTML = '';
    }
    container.querySelectorAll('[data-toggle-field]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            const field = btn.dataset.toggleField;
            node[field] = !node[field];
            render();
            scheduleSave();
        };
    });
    container.querySelectorAll('button[data-comfy-param]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => updateComfyField(node, btn, e);
    });
    container.querySelectorAll('button[data-comfy-random]').forEach(btn => {
        btn.onmousedown = e => e.stopPropagation();
        btn.onclick = e => {
            e.stopPropagation();
            toggleComfyRandom(node.id, btn.dataset.comfyRandom);
        };
    });
    container.querySelectorAll('input, select, textarea').forEach(input => {
        input.onmousedown = e => e.stopPropagation();
        input.onclick = e => e.stopPropagation();
        if(input.classList.contains('model-select')) return;
        input.onchange = e => updateComfyField(node, input, e);
        input.oninput = e => updateComfyField(node, input, e);
    });
}
function renderComfyCustomField(node, f){
    const value = comfyParamValue(node, f);
    const label = escapeHtml(f.name || f.input);
    if(f.type === 'boolean'){
        return `<div class="gen-settings-row">
            <button type="button" class="setting-check ${value ? 'active' : ''}" data-comfy-param="${escapeHtml(f.id)}" data-comfy-type="boolean"><span class="check-dot"></span>${label}</button>
        </div>`;
    }
    if(f.type === 'slider'){
        const min = f.min ?? 0, max = f.max ?? 10, step = f.step ?? 1;
        return `<div class="gen-settings-row">
            <label class="field" style="flex:1">
                <div class="setting-title" style="display:flex;justify-content:space-between"><span>${label}</span><span class="comfy-param-val">${escapeHtml(value)}</span></div>
                <input type="range" class="canvas-range" data-comfy-param="${escapeHtml(f.id)}" data-comfy-type="slider" min="${min}" max="${max}" step="${step}" value="${escapeHtml(value)}">
            </label>
        </div>`;
    }
    if(f.type === 'dropdown'){
        const opts = (f.options || []).map(o => `<option value="${escapeHtml(o)}" ${String(value) === String(o) ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('');
        return `<div class="gen-settings-row">
            <label class="field" style="flex:1"><div class="setting-title">${label}</div><select class="select-lite" data-comfy-param="${escapeHtml(f.id)}" data-comfy-type="dropdown" style="width:100%">${opts || '<option value="">(无选项)</option>'}</select></label>
        </div>`;
    }
    if(f.type === 'textarea'){
        return `<div class="gen-settings-row">
            <label class="field" style="flex:1"><div class="setting-title">${label}</div><textarea class="setting-input" data-comfy-param="${escapeHtml(f.id)}" data-comfy-type="textarea" style="height:66px;padding-top:8px;resize:vertical">${escapeHtml(value)}</textarea></label>
        </div>`;
    }
    const type = f.type === 'number' ? 'number' : 'text';
    if(comfyRandomEnabled(f)){
        const active = comfyRandomActive(node, f.id);
        return `<div class="gen-settings-row">
            <div class="comfy-random-field">
                <label class="field"><div class="setting-title">${label}</div><input class="setting-input" type="number" data-comfy-param="${escapeHtml(f.id)}" data-comfy-type="number" value="${escapeHtml(value)}"></label>
                <button class="tool-btn comfy-random-btn ${active ? 'active' : ''}" type="button" data-comfy-random="${escapeHtml(f.id)}" title="${active ? '随机已开启，点击关闭' : '随机已关闭，点击开启'}" aria-label="${active ? '随机已开启，点击关闭' : '随机已关闭，点击开启'}"><i data-lucide="dice-5" class="w-4 h-4"></i></button>
            </div>
        </div>`;
    }
    return `<div class="gen-settings-row">
        <label class="field" style="flex:1"><div class="setting-title">${label}</div><input class="setting-input" type="${type}" data-comfy-param="${escapeHtml(f.id)}" data-comfy-type="${escapeHtml(f.type || 'text')}" value="${escapeHtml(value)}"></label>
    </div>`;
}
function updateComfyField(node, input, event){
    event?.stopPropagation();
    const paramId = input.dataset.comfyParam;
    if(paramId){
        node.comfyParams = node.comfyParams || {};
        const field = comfyFields(node).find(f => f.id === paramId);
        const type = input.dataset.comfyType || field?.type || 'text';
        if(type === 'boolean') node.comfyParams[paramId] = !Boolean(node.comfyParams[paramId] ?? field?.default ?? false);
        else if(type === 'number' || type === 'slider') node.comfyParams[paramId] = Number(input.value) || 0;
        else node.comfyParams[paramId] = input.value;
        const val = input.closest('.field')?.querySelector('.comfy-param-val');
        if(val) val.textContent = node.comfyParams[paramId];
        if(type === 'boolean') render();
        scheduleSave();
        return;
    }
    const field = input.dataset.field;
    if(!field) return;
    if(field === 'comfyWorkflow'){
        node.comfyWorkflow = validComfyWorkflowName(input.value);
        node.comfyParams = {};
        ensureComfyWorkflow(node.comfyWorkflow).then(() => render());
        scheduleSave();
        return;
    }
    if(input.type === 'checkbox') {
        node[field] = input.checked;
        if(field === 'enhanceUpscale') render();
    }
    else if(field === 'enhanceStrength') {
        node[field] = Number(input.value) || 0.5;
        const val = input.closest('.field')?.querySelector('.enhance-strength-val');
        if(val) val.textContent = node[field].toFixed(2);
    }
    else if(['width','height','enhanceUpscaleRes','editUpscaleRes','count'].includes(field)) node[field] = Number(input.value) || 1;
    else node[field] = input.value;
    scheduleSave();
}

const CANVAS_GENERATOR_TYPES = ['generator','msgen','comfy','ltxDirector','video','rh','replicaAgent','imageRepairAgent'];
const CANVAS_IMAGE_OUTPUT_TYPES = ['generator','msgen','comfy','ltxDirector','rh','replicaAgent','imageRepairAgent'];
const CANVAS_MEDIA_OUTPUT_TYPES = ['generator','msgen','comfy','ltxDirector','video','rh','replicaAgent'];
function hasExplicitOutputConnection(nodeId){
    return connections.some(c => {
        if(c.from !== nodeId) return false;
        const to = nodes.find(n => n.id === c.to);
        return to?.type === 'output';
    });
}
function hasDownstreamGenerator(nodeId){
    return connections.some(c => {
        if(c.from !== nodeId) return false;
        const to = nodes.find(n => n.id === c.to);
        if(!to) return false;
        if(CANVAS_GENERATOR_TYPES.includes(to.type)) return true;
        if(to.type !== 'output') return false;
        return connections.some(cc => {
            if(cc.from !== to.id) return false;
            const next = nodes.find(n => n.id === cc.to);
            return next && CANVAS_GENERATOR_TYPES.includes(next.type);
        });
    });
}
function shouldCreateOutputForNode(node){
    if(!node) return false;
    if(hasExplicitOutputConnection(node.id)) return true;
    return !hasDownstreamGenerator(node.id);
}
function outputForNode(node, dx=460){
    if(!node || !shouldCreateOutputForNode(node)) return null;
    let out = connections
        .filter(c => c.from === node.id)
        .map(c => nodes.find(n => n.id === c.to))
        .find(n => n?.type === 'output');
    if(!out){
        out = {id:uid('out'), type:'output', x:node.x + dx, y:node.y, images:[]};
        nodes.push(out);
        connections.push({id:uid('c'), from:node.id, to:out.id});
    }
    return out;
}
function generatedImageRefs(node){
    const keepGeneratedMedia = ['rh','ltxDirector','video'].includes(node?.type);
    return (node?.generatedOutputs || [])
        .map((item, i) => {
            const url = outputUrlValue(item);
            if(!url) return null;
            const kind = mediaKindForOutputItem(item);
            return {url, name:outputImageName(url) || `${node.type || 'generated'}-${i + 1}`, kind, index:i};
        })
        .filter(Boolean)
        .filter(ref => keepGeneratedMedia || ref.kind === 'image')
        .map(ref => {
            const {index, ...clean} = ref;
            return clean;
        });
}
function mediaRefsFromNode(node){
    if(!node || isNodeDisabled(node)) return [];
    if(node.type === 'image' && node.url){
        const kind = mediaKindForNode(node);
        return [{url:node.url, name:node.name || kind, role:node.role || '', kind}];
    }
    if(node.type === 'group'){
        return (node.items || [])
            .map(id => nodes.find(x => x.id === id))
            .filter(x => isNodeEnabled(x) && x?.type === 'image' && x?.url)
            .map(item => ({url:item.url, name:item.name || mediaKindForNode(item), role:item.role || '', kind:mediaKindForNode(item)}));
    }
    if(node.type === 'output'){
        return (node.images || []).map((item, i) => {
            const url = outputUrlValue(item);
            if(!url) return null;
            const kind = mediaKindForOutputItem(item);
            return {url, name:outputImageName(url) || `output-${i + 1}`, kind};
        }).filter(Boolean);
    }
    if(CANVAS_MEDIA_OUTPUT_TYPES.includes(node.type)) return generatedImageRefs(node);
    return [];
}
function generatorSources(gen, ctx=loopContext){
    const loopCtx = ctx;
    return connections.filter(c => c.to === gen.id).map(c => nodes.find(n => n.id === c.from)).filter(n => isNodeEnabled(n)).map(n => {
        if(n.type === 'output' && (n.images||[]).length){
            // 从 output 节点取最新一张图当作 reference 给下游
            const last = [...n.images].reverse().map(outputUrlValue).find(Boolean);
            if(last) return {id:n.id, type:'outputImage', label:'上游输出', preview:last, refs:[{url:last, name:'output.png'}], prompt:''};
        }
        if(CANVAS_MEDIA_OUTPUT_TYPES.includes(n.type)){
            const refs = generatedImageRefs(n);
            if(refs.length){
                return refs.map((ref, i) => ({
                    id:`${n.id}:generated:${i}:${ref.url}`,
                    type:'generatedImage',
                    label:`上游生成 ${i + 1}`,
                    preview:ref.url,
                    refs:[ref],
                    prompt:''
                }));
            }
        }
        if(isImageStackNode(n) && (n.images || []).length){
            return imageStackGeneratorSources(n);
        }
        if(n.type === 'imageBatch'){
            const items = (n.items || []).map(id => nodes.find(x => x.id === id)).filter(x => isNodeEnabled(x));
            return items.filter(x => x.type === 'image' && x.url).map(img => ({
                id:`${n.id}:${img.id}`,
                type:'batch-image',
                groupId:n.id,
                imageId:img.id,
                label:img.name || mediaKindForNode(img),
                preview:img.url,
                refs:[{url:img.url, name:img.name || mediaKindForNode(img), role:img.role || '', kind:mediaKindForNode(img)}],
                prompt:''
            }));
        }
        if(n.type === 'image' && n.url) {
            const kind = mediaKindForNode(n);
            return {id:n.id, type:kind, label:n.name || kind, preview:n.url, refs:[{url:n.url, name:n.name || kind, role:n.role || '', kind}], prompt:''};
        }
        if(n.type === 'group') {
            const items = (n.items || []).map(id => nodes.find(x => x.id === id)).filter(x => isNodeEnabled(x));
            const sources = items.filter(x => x.type === 'image' && x.url).map(img => ({
                id:`${n.id}:${img.id}`,
                type:`group-${mediaKindForNode(img)}`,
                groupId:n.id,
                imageId:img.id,
                label:img.name || mediaKindForNode(img),
                preview:img.url,
                refs:[{url:img.url, name:img.name || mediaKindForNode(img), role:img.role || '', kind:mediaKindForNode(img)}],
                prompt:''
            }));
            const prompts = items.filter(x => isNodeEnabled(x) && x.type === 'prompt').map(p => p.text || '').filter(Boolean);
            if(prompts.length){
                const combined = prompts.join('\n\n');
                sources.push({
                    id:`${n.id}:prompts`,
                    type:'groupPrompt',
                    groupId:n.id,
                    label:combined.slice(0, 32),
                    refs:[],
                    prompt:combined
                });
            }
            return sources;
        }
        if(n.type === 'prompt') {
            if(!isNodeEnabled(n)) return null;
            return {id:n.id, type:'prompt', label:(n.text || '提示词').slice(0, 32), refs:[], prompt:n.text || ''};
        }
        if(n.type === 'loop') {
            const prompt = renderLoopPrompt(n, loopCtx);
            const refs = loopInputImageRefs(n, loopCtx);
            if(refs.length){
                const currentIndex = Math.max(1, Number(loopCtx?.index || n.loopStart || 1) || 1);
                return refs.map((ref, i) => ({
                    id:`${n.id}:image:${currentIndex + i}:${ref.url}`,
                    type:'loopImage',
                    label:loopImageRefLabel(i + 1),
                    preview:ref.url,
                    refs:[ref],
                    prompt:i === 0 ? prompt : ''
                }));
            }
            return {id:n.id, type:'loop', label:`${tr('canvas.loopNode')} ${loopCount(n)}x`, refs:[], prompt};
        }
        if(n.type === 'promptGroup') {
            const prompts = promptGroupChildTexts(n);
            return {id:n.id, type:'promptGroup', label:`提示词 ${prompts.length} 个`, refs:[], prompt:prompts.join('\n\n')};
        }
        if(n.type === 'llm' && (n.mode || 'node') === 'node' && n.outputText) return {id:n.id, type:'llm', label:(n.outputText || 'LLM').slice(0, 32), refs:[], prompt:n.outputText || ''};
        if(n.type === 'videoReverse' && n.outputText) return {id:n.id, type:'videoReverse', label:(n.outputText || '视频反推').slice(0, 32), refs:[], prompt:n.outputText || ''};
        if(n.type === 'slotsLoopVideoAgent' && n.outputText) return {id:n.id, type:'slotsLoopVideoAgent', label:(n.outputText || 'Slots 循环视频').slice(0, 32), refs:[], prompt:n.outputText || ''};
        return null;
    }).flat().filter(Boolean);
}
function orderedSources(gen, sources){
    gen.inputs = (gen.inputs || []).filter(id => sources.some(s => s.id === id));
    sources.forEach(s => { if(!gen.inputs.includes(s.id)) gen.inputs.push(s.id); });
    return gen.inputs.map(id => sources.find(s => s.id === id)).filter(Boolean);
}
function reorderInput(gen, movedId, targetId){
    if(!movedId || movedId === targetId) return;
    const sources = generatorSources(gen);
    const imageIds = sources.filter(s => s.refs?.length).map(s => s.id);
    if(!imageIds.includes(movedId) || !imageIds.includes(targetId)) return;
    const promptIds = (gen.inputs || []).filter(id => !imageIds.includes(id));
    const ids = (gen.inputs || []).filter(id => imageIds.includes(id));
    const from = ids.indexOf(movedId), to = ids.indexOf(targetId);
    if(from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    gen.inputs = [...ids, ...promptIds];
    render();
    scheduleSave();
}
function isBatchPosterAgentType(type){
    return type === 'batchPosterAgent';
}
function isGeneratorLikeNode(node){
    return node && (CANVAS_GENERATOR_TYPES.includes(node.type) || isBatchPosterAgentType(node.type) || isNineGridAgentType(node.type));
}
function syncGeneratorInputs(){
    syncAllLoopImageBatchSizes();
    nodes.filter(n => isGeneratorLikeNode(n)).forEach(gen => {
        if(gen.type === 'replicaAgent') syncReplicaAgentRoles(gen);
        else orderedSources(gen, generatorSources(gen));
        if(gen.type === 'ltxDirector') ltxSyncConnectedImagesToTimeline(gen);
    });
}
function refreshGeneratorInputViews(){
    nodes.filter(n => isGeneratorLikeNode(n)).forEach(gen => {
        const el = nodesEl.querySelector(`.node[data-id="${gen.id}"]`);
        if(!el) return;
        if(gen.type === 'replicaAgent'){
            renderReplicaAgentRoleMapper(el.querySelector('.replica-role-list'), gen);
            updateReplicaAgentStatusBadges(el, gen);
            return;
        }
        if(gen.type === 'imageRepairAgent'){
            const src = imageRepairAgentSourceImage(gen);
            const badge = el.querySelector('.replica-status-badge');
            if(badge){
                const ok = Boolean(src?.url);
                badge.classList.toggle('ok', ok);
                badge.classList.toggle('warn', !ok);
                const span = badge.querySelector('span');
                if(span) span.textContent = ok ? (langIsEn() ? 'Source image ready' : '已连接待修复图片') : (langIsEn() ? 'Connect source image' : '请连接待修复图片');
            }
            bindReplicaAgentSizeControls(el.querySelector('.image-repair-agent-body'), gen, src?.url || '');
            return;
        }
        if(gen.type === 'batchPosterAgent'){
            const sources = orderedSources(gen, generatorSources(gen));
            const imageInputs = sources
                .map(src => ({...src, refs:imageRefsOnly(src.refs || [])}))
                .filter(src => src.refs?.length);
            renderImageInputList(el.querySelector('.batch-poster-input-list'), gen, imageInputs, langIsEn() ? 'Connect a reference poster image' : '请连接参考海报图');
            bindReplicaAgentSizeControls(el.querySelector('.batch-poster-agent-body'), gen, batchPosterAgentPosterRef(gen)?.url || '');
            void prefetchBatchPosterTitleCopyForNode(gen);
            return;
        }
        if(gen.type === 'nineGridAgent'){
            const sources = orderedSources(gen, generatorSources(gen));
            const imageInputs = sources
                .map(src => ({...src, refs:imageRefsOnly(src.refs || [])}))
                .filter(src => src.refs?.length);
            renderNineGridRefList(el.querySelector('.nine-grid-input-list'), gen, langIsEn() ? 'Connect reference images' : '请连接参考图');
            return;
        }
        const sources = orderedSources(gen, generatorSources(gen));
        const imageInputs = sources
            .map(src => ({...src, refs:imageRefsOnly(src.refs || [])}))
            .filter(src => src.refs?.length);
        renderPromptPreview(el.querySelector('.prompt-list'), sources.filter(src => src.prompt && !src.refs?.length));
        if(gen.type === 'generator') renderImageInputList(el.querySelector('.input-list'), gen, imageInputs);
        if(gen.type === 'msgen') renderImageInputList(el.querySelector('.ms-img-list'), gen, imageInputs);
        if(gen.type === 'comfy') renderComfyImages(el.querySelector('.input-list'), gen, imageInputs);
        if(gen.type === 'ltxDirector'){
            ltxSyncConnectedImagesToTimeline(gen);
            renderComfyImages(el.querySelector('.input-list'), gen, imageInputs);
        }
        if(gen.type === 'video') renderVideoImageInputs(el.querySelector('.video-img-list'), gen, imageInputs);
        if(gen.type === 'rh'){
            const fields = rhActiveFields(gen);
            const media = rhMediaSources(gen);
            renderRhPromptFields(el.querySelector('.rh-prompt-list'), gen, fields);
            renderRhMediaFields(el.querySelector('.rh-input-list'), gen, fields, media);
            renderRhParams(el.querySelector('.rh-param-list'), gen, fields, media);
        }
    });
    refreshLoopImageInputViews();
}
function refreshLoopImageInputViews(){
    nodes.filter(n => n.type === 'loop' && n.imageInput).forEach(loop => {
        const el = nodesEl?.querySelector(`.loop-node[data-id="${CSS.escape(loop.id)}"]`);
        if(!el) return;
        renderLoopImageRefList(el.querySelector('.loop-image-ref-list'), loop);
        const hint = el.querySelector('.loop-image-hint');
        if(hint) hint.textContent = loopImageOutputHint(loop, {index:Math.max(1, Number(loop.loopStart) || 1)});
    });
}
const PER_ITEM_GROUP_IMAGE_TYPES = new Set(['batch-image', 'group-image']);

function perItemGroupImageRefs(sources, loopCtx){
    if(loopCtx) return null;
    const imageSources = (sources || []).filter(s => s.refs?.length);
    if(imageSources.length < 2) return null;
    if(!imageSources.every(s => PER_ITEM_GROUP_IMAGE_TYPES.has(s.type))) return null;
    const groupIds = new Set(imageSources.map(s => s.groupId).filter(Boolean));
    if(groupIds.size !== 1) return null;
    return imageSources.map(s => s.refs[0]).filter(ref => ref?.url);
}
async function buildGeneratorTaskPayload(gen, prompt, refs){
    const rawPrompt = prompt || 'Edit the reference images.';
    const enrichedPrompt = refs?.length
        ? augmentImagePromptWithReferenceCostumeLock(rawPrompt, refs)
        : rawPrompt;
    const payload = {
        prompt: enrichedPrompt,
        provider_id:resolveImageProviderId(gen.apiProvider || 'comfly'),
        model:resolveImageModel(gen.model),
        size:await generatorSizeForRun(gen, refs),
        canvas_resolution: gen.resolution || '1k',
        canvas_ratio: gen.ratio || 'square',
        canvas_custom_ratio: gen.customRatio || '',
        reference_images:refs
    };
    const quality = normalizedImageQuality(gen.quality);
    if(quality) payload.quality = quality;
    if(isMidjourneyV81Model(gen.model)){
        ensureYouchuanNodeDefaults(gen);
        payload.mj_v81 = {
            chaos: gen.mjChaos,
            quality: gen.mjQuality,
            stylize: gen.mjStylize,
            raw: gen.mjRaw,
            hd: gen.mjHd,
            iw: gen.mjIw,
            sw: gen.mjSw,
            sv: gen.mjSv,
        };
    }
    if(isNiji7Model(gen.model)){
        ensureYouchuanNodeDefaults(gen);
        payload.niji7 = {
            chaos: gen.mjChaos,
            stylize: gen.mjStylize,
            weird: gen.mjWeird,
            raw: gen.mjRaw,
            iw: gen.mjIw,
            sw: gen.mjSw,
            sv: gen.mjSv,
        };
    }
    return payload;
}
async function runGeneratorSingle(gen, prompt, refs, opts={}){
    const count = Math.max(1, Math.min(8, Number(gen.count || 1)));
    const out = outputForNode(gen, 460);
    const run = runSnapshot(gen, prompt || 'Edit the reference images.', refs);
    const payload = await buildGeneratorTaskPayload(gen, prompt || 'Edit the reference images.', refs);
    const taskInfos = await Promise.all(Array.from({length:count}, () => createCanvasImageTask(payload)));
    const pendingIds = taskInfos.map(() => uid('p'));
    if(out) out._pending = [
        ...(out._pending || []),
        ...taskInfos.map((task, index) => makePending(pendingIds[index], run, {
            canvasTaskId:task.task_id,
            canvasTaskType:'online-image',
            appendGenerated:Boolean(opts.appendGenerated)
        }))
    ];
    refreshRunNodes(gen, out);
    scheduleSave();
    await saveCanvas();
    const pollAll = () => Promise.all(taskInfos.map(task => pollCanvasImageTask(task.task_id)));
    if(opts.cascade){
        const statuses = await pollAll();
        if(statuses.includes('failed')) throw new Error(gen.runError || tr('canvas.generationFailed'));
    } else {
        syncAppendableNodeRunState(gen);
        void pollAll();
    }
    return out;
}
async function runGeneratorBatchParallel(gen, prompt, perItemRefs, opts={}){
    const out = outputForNode(gen, 460);
    const promptText = prompt || 'Edit the reference images.';
    const count = Math.max(1, Math.min(8, Number(gen.count || 1)));
    const jobs = perItemRefs.flatMap(ref => Array.from({length:count}, () => imageRefsOnly([ref])));
    const totalJobs = jobs.length;
    if(opts.cascade){
        gen.running = true;
        gen.generatedOutputs = [];
    }
    gen._batchProgress = `0/${totalJobs}`;
    refreshRunNodes(gen, out);
    const submitted = await Promise.all(jobs.map(async refs => {
        const run = runSnapshot(gen, promptText, refs);
        const payload = await buildGeneratorTaskPayload(gen, promptText, refs);
        const taskInfo = await createCanvasImageTask(payload);
        return {run, taskInfo, pendingId:uid('p')};
    }));
    if(out) out._pending = [
        ...(out._pending || []),
        ...submitted.map(item => makePending(item.pendingId, item.run, {
            canvasTaskId:item.taskInfo.task_id,
            canvasTaskType:'online-image',
            appendGenerated:true
        }))
    ];
    refreshRunNodes(gen, out);
    scheduleSave();
    await saveCanvas();
    let done = 0;
    const pollAll = async () => {
        const statuses = await Promise.all(submitted.map(item => pollCanvasImageTask(item.taskInfo.task_id).then(status => {
            done += 1;
            if(opts.cascade) gen._batchProgress = `${done}/${totalJobs}`;
            refreshRunNodes(gen, out);
            return status;
        })));
        if(statuses.includes('failed')) throw new Error(gen.runError || tr('canvas.generationFailed'));
    };
    if(opts.cascade) await pollAll();
    else {
        syncAppendableNodeRunState(gen);
        void pollAll().finally(() => {
            delete gen._batchProgress;
            syncAppendableNodeRunState(gen);
            refreshRunNodes(gen, out);
        });
    }
    return out;
}
async function runGenerator(genId, opts={}){
    const gen = nodes.find(n => n.id === genId);
    if(!gen || isNodeDisabled(gen)) return;
    const loopCtx = opts.loopContext !== undefined ? opts.loopContext : loopContext;
    const sources = orderedSources(gen, generatorSources(gen, loopCtx));
    const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
    const refs = imageRefsOnly(sources.flatMap(s => s.refs || []));
    if(!prompt && !refs.length){ softAlert(tr('canvas.needPromptOrImage')); return; }
    if(isYouchuanRhModel(gen.model) && !prompt){ softAlert(tr('canvas.youchuanNeedPrompt')); return; }
    const perItemRefs = perItemGroupImageRefs(sources, loopCtx);
    if(perItemRefs?.length >= 2){
        let out = outputForNode(gen, 460);
        try {
            out = await runGeneratorBatchParallel(gen, prompt, perItemRefs, opts);
            if(opts.cascade){
                gen.runStatus = 'done';
                gen.runError = '';
            }
        } catch(err) {
            const errText = humanizeCanvasGenerationError(err.message || String(err));
            gen.runStatus = 'failed';
            gen.runError = errText;
            gen.running = false;
            delete gen._batchProgress;
            refreshRunNodes(gen, out);
            scheduleSave();
            if(opts.cascade) throw new Error(errText);
            return;
        } finally {
            if(opts.cascade){
                gen.running = false;
                delete gen._batchProgress;
                refreshRunNodes(gen, out);
            }
        }
        return;
    }
    let out = outputForNode(gen, 460);
    try {
        await runGeneratorSingle(gen, prompt || 'Edit the reference images.', refs, {
            appendGenerated:Boolean(opts.cascade),
            cascade:Boolean(opts.cascade)
        });
        if(opts.cascade){
            gen.runStatus = 'done';
            gen.runError = '';
            refreshRunNodes(gen, out);
            scheduleSave();
        }
    } catch(err) {
        const errText = humanizeCanvasGenerationError(err.message || String(err));
        gen.runStatus = 'failed';
        gen.runError = errText;
        gen.running = false;
        refreshRunNodes(gen, out);
        scheduleSave();
        if(opts.cascade) throw new Error(errText);
    }
}
async function runGeneratorLegacy(genId, opts={}){
    const gen = nodes.find(n => n.id === genId);
    if(!gen || isNodeDisabled(gen)) return;
    const loopCtx = opts.loopContext !== undefined ? opts.loopContext : loopContext;
    const sources = orderedSources(gen, generatorSources(gen, loopCtx));
    const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
    const refs = imageRefsOnly(sources.flatMap(s => s.refs || []));
    if(!prompt && !refs.length){ softAlert(tr('canvas.needPromptOrImage')); return; }
    const count = Math.max(1, Math.min(8, Number(gen.count || 1)));
    let out = outputForNode(gen, 460);
    const pendingIds = Array.from({length:count}, () => uid('p'));
    const run = runSnapshot(gen, prompt || 'Edit the reference images.', refs);
    if(out) out._pending = [...(out._pending||[]), ...pendingIds.map(id => makePending(id, run))];
    syncAppendableNodeRunState(gen);
    refreshRunNodes(gen, out);
    const execute = async () => {
    try {
        const rawPrompt = prompt || 'Edit the reference images.';
        const payload = {
            prompt: refs.length ? augmentImagePromptWithReferenceCostumeLock(rawPrompt, refs) : rawPrompt,
            provider_id:resolveImageProviderId(gen.apiProvider || 'comfly'),
            model:resolveImageModel(gen.model),
            size:await generatorSizeForRun(gen, refs),
            canvas_resolution: gen.resolution || '1k',
            canvas_ratio: gen.ratio || 'square',
            canvas_custom_ratio: gen.customRatio || '',
            reference_images:refs
        };
        const quality = normalizedImageQuality(gen.quality);
        if(quality) payload.quality = quality;
        const results = await Promise.all(Array.from({length:count}, () => apiFetch('/api/online-image', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify(payload)
        }).then(async r => { if(!r.ok) throw new Error(await responseErrorMessage(r, tr('canvas.generationFailed'))); return r.json(); })));
        if(!pendingIds.some(id => (out?._pending || []).some(p => p.id === id))){
            reconcileAgentRunStateFromPending(gen.id);
            refreshRunNodes(gen, out);
            return;
        }
        const images = results.flatMap(result => result.images || []);
        const metas = collectRunMetas(out, pendingIds);
        run.request = results[0] ? requestMetaFromResult(results[0]) : {};
        if(out) out._pending = (out._pending||[]).filter(p => !pendingIds.includes(p.id));
        appendOutputImages(out, images, refs[0], metas);
        mergeGeneratedOutputs(gen, images, Boolean(opts.cascade));
        addGenerationLog({run, outputs:images, runMs:Math.max(...metas.map(m => m.runMs || 0), 0)});
        syncAgentRunStatusAfterTask(gen, {completed:agentPendingCount(gen.id) === 0});
        refreshRunNodes(gen, out);
        scheduleSave();
    } catch(err) {
        if(!pendingIds.some(id => (out?._pending || []).some(p => p.id === id))){
            reconcileAgentRunStateFromPending(gen.id);
            refreshRunNodes(gen, out);
            if(opts.cascade) throw err;
            return;
        }
        const metas = collectRunMetas(out, pendingIds);
        addGenerationLog({run, outputs:[], runMs:Math.max(...metas.map(m => m.runMs || 0), 0), error:err.message || String(err)});
        if(out) out._pending = (out._pending||[]).filter(p => !pendingIds.includes(p.id));
        syncAgentRunStatusAfterTask(gen, {failed:agentPendingCount(gen.id) === 0, error:err.message || String(err)});
        refreshRunNodes(gen, out);
        if(opts.cascade) throw err;
        showErrorModal(err.message || tr('canvas.generationFailed'), tr('canvas.apiFailed'));
    }
    };
    if(opts.cascade) await execute();
    else void execute();
}
async function runVideoNode(nodeId, opts={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || isNodeDisabled(node)) return;
    const loopCtx = opts.loopContext !== undefined ? opts.loopContext : loopContext;
    const sources = orderedSources(node, generatorSources(node, loopCtx));
    const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
    const allRefs = sources.flatMap(s => s.refs || []);
    const refs = imageRefsOnly(allRefs);
    const videoRefs = videoRefsOnly(allRefs);
    if(node.useFrameRoles && refs[0]) refs[0] = {...refs[0], role:'first_frame'};
    if(node.useFrameRoles && refs[1]) refs[1] = {...refs[1], role:'last_frame'};
    if(!prompt){ softAlert(tr('canvas.videoNeedsPrompt')); return; }
    let out = outputForNode(node, 460);
    const pendingId = uid('p');
    const run = runSnapshot(node, prompt, refs);
    if(out) out._pending = [...(out._pending || []), makePending(pendingId, run)];
    syncAppendableNodeRunState(node);
    refreshRunNodes(node, out);
    const execute = async () => {
    try {
        const result = await apiFetch('/api/canvas-video', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                prompt,
                provider_id:resolveVideoProviderId(node.apiProvider || 'comfly'),
                model:node.model || 'veo3-fast',
                duration:Number(node.duration || 5),
                aspect_ratio:node.aspectRatio || '16:9',
                resolution:node.resolution || '',
                images:refs,
                videos:videoRefs.map(ref => ref.url),
                enhance_prompt:Boolean(node.enhancePrompt),
                enable_upsample:Boolean(node.enableUpsample),
                watermark:Boolean(node.watermark),
                camerafixed:Boolean(node.cameraFixed),
                generate_audio:Boolean(node.generateAudio)
            })
        }).then(async r => { if(!r.ok) throw new Error(await responseErrorMessage(r, tr('canvas.videoFailed'))); return r.json(); });
        const meta = collectRunMeta(out, pendingId);
        if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
        const outputUrls = resultMediaUrls(result).map(item => {
            const url = outputUrlValue(item);
            return item && typeof item === 'object' ? {...item, url, kind:item.kind || 'video'} : {url, kind:'video'};
        }).filter(item => item.url);
        if(!outputUrls.length) throw new Error(tr('canvas.videoFailed'));
        run.request = requestMetaFromResult(result);
        appendOutputImages(out, outputUrls, refs[0], [{...meta, kind:'video'}]);
        mergeGeneratedOutputs(node, outputUrls, Boolean(opts.cascade));
        addGenerationLog({run, outputs:outputUrls, runMs:meta.runMs || 0});
        syncAgentRunStatusAfterTask(node, {completed:agentPendingCount(node.id) === 0});
        refreshRunNodes(node, out);
        scheduleSave();
    } catch(err) {
        const meta = collectRunMeta(out, pendingId);
        addGenerationLog({run, outputs:[], runMs:meta.runMs || 0, error:err.message || String(err)});
        if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
        syncAgentRunStatusAfterTask(node, {failed:agentPendingCount(node.id) === 0, error:err.message || String(err)});
        refreshRunNodes(node, out);
        if(opts.cascade) throw err;
    }
    };
    if(opts.cascade) await execute();
    else void execute();
}
async function uploadCanvasUrlToComfy(url){
    const blob = await fetch(url).then(r => {
        if(!r.ok) throw new Error(langIsEn() ? 'Image read failed' : '图片读取失败');
        return r.blob();
    });
    const filename = (url || '').split('/').pop()?.split('?')[0] || `canvas_${Date.now()}.png`;
    const form = new FormData();
    form.append('files', blob, filename);
    const data = await apiFetch('/api/upload', {method:'POST', body:form}).then(async r => {
        if(!r.ok) throw new Error(await responseErrorMessage(r, langIsEn() ? 'Image upload to ComfyUI failed' : '图片上传到 ComfyUI 失败'));
        return r.json();
    });
    return data.files?.[0]?.comfy_name || filename;
}
async function comfyNameForRef(ref){
    if(ref.comfy_name) return ref.comfy_name;
    if(!ref.url) throw new Error(langIsEn() ? 'Missing input image' : '缺少输入图片');
    return uploadCanvasUrlToComfy(ref.url);
}
async function runComfyUpscale(imageUrl, resolution){
    if(!imageUrl) throw new Error(actionFailed('studio.superResolution', langIsEn() ? 'missing input image' : '缺少输入图片'));
    const nextInput = await uploadCanvasUrlToComfy(imageUrl);
    const upscale = await apiFetch('/api/generate', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            workflow_json:'upscale.json',
            params:{
                "15": { image:nextInput },
                "172": { seed:Math.floor(Math.random() * 4294967295), resolution:Number(resolution || 2048) }
            },
            type:'enhance',
            client_id:CLIENT_ID
        })
    }).then(async r => { if(!r.ok) throw new Error(await responseErrorMessage(r, actionFailed('studio.superResolution'))); return r.json(); });
    if(upscale.error) throw new Error(actionFailed('studio.superResolution', upscale.error));
    if(!upscale.images?.length) throw new Error(noReturnedImage('studio.superResolution'));
    return upscale.images || [];
}
function comfyResultOutputs(result){
    return resultMediaUrls(result);
}
function resultMediaUrls(result){
    const urls = [];
    const add = value => {
        if(!value) return;
        if(typeof value === 'string'){
            urls.push(value);
            return;
        }
        if(Array.isArray(value)){
            value.forEach(add);
            return;
        }
        if(typeof value === 'object'){
            if(value.url || value.path || value.src || value.uri){
                const url = value.url || value.path || value.src || value.uri;
                if(url) urls.push({url, kind:value.kind || value.type || value.mediaKind || '', name:value.name || value.filename || ''});
            }
            ['outputs','videos','images','urls','data','result'].forEach(key => add(value[key]));
            ['url','path','src','uri','output','output_url','outputUrl','video','video_url','videoUrl','mp4_url','mp4Url','download_url','downloadUrl','preview_url','previewUrl'].forEach(key => add(value[key]));
        }
    };
    ['items','outputs','videos','audios','texts','files','images','urls','data','result','output','url'].forEach(key => add(result?.[key]));
    const seen = new Set();
    return urls.map(item => {
        const url = outputUrlValue(item);
        if(!url) return null;
        return typeof item === 'object' ? item : url;
    }).filter(item => {
        const url = outputUrlValue(item);
        return url && !seen.has(url) && seen.add(url);
    });
}
function ltxDirectorSyncSeconds(node){
    const fps = Math.max(1, Number(node?.frameRate) || 24);
    node.durationSeconds = Math.round((Number(node.durationFrames) || 120) / fps * 1000) / 1000;
}
function ltxParseTimeline(node){
    try {
        const t = JSON.parse(node?.ltxTimelineData || '{}');
        return {
            segments: Array.isArray(t.segments) ? t.segments : [],
            audioSegments: Array.isArray(t.audioSegments) ? t.audioSegments : []
        };
    } catch(e) {
        return {segments: [], audioSegments: []};
    }
}
function ltxRefreshTimelineEditor(node){
    if(!node?._ltxEditor || typeof window.LTXParseInitial !== 'function') return;
    node._ltxEditor.timeline = window.LTXParseInitial(node.ltxTimelineData || '{}');
    node._ltxEditor.loadImages?.();
    node._ltxEditor.commitChanges?.(true);
    node._ltxEditor.render?.();
}
function ltxSyncConnectedImagesToTimeline(node){
    if(!node || node.type !== 'ltxDirector') return;
    const hadTimeline = Boolean(node.ltxTimelineData);
    const sources = orderedSources(node, generatorSources(node));
    const imageInputs = sources.filter(src => imageRefsOnly(src.refs || []).length);
    const timeline = ltxParseTimeline(node);
    const fps = Math.max(1, Number(node.frameRate) || 24);
    const defaultLen = Math.max(6, fps);
    const manual = (timeline.segments || []).filter(s => !s.canvasSourceId);
    const existingAuto = new Map((timeline.segments || []).filter(s => s.canvasSourceId).map(s => [s.canvasSourceId, s]));
    const autoSegs = [];
    let cursor = 0;
    for(const src of imageInputs){
        const ref = imageRefsOnly(src.refs || [])[0];
        const url = ref?.url;
        if(!url) continue;
        let seg = existingAuto.get(src.id);
        if(seg){
            if(seg.imageB64 !== url){
                seg.imageB64 = url;
                seg.imageFile = null;
                delete seg.imgObj;
            }
            if(!seg.length || seg.length < 1) seg.length = defaultLen;
        } else {
            seg = {
                id:uid('ltxseg'),
                start:cursor,
                length:defaultLen,
                prompt:src.prompt || '',
                type:'image',
                imageB64:url,
                canvasSourceId:src.id,
                guideStrength:1
            };
        }
        seg.start = cursor;
        cursor += Math.max(1, Number(seg.length) || defaultLen);
        autoSegs.push(seg);
    }
    let nextStart = cursor;
    const reflowedManual = [...manual].sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
    for(const seg of reflowedManual){
        seg.start = nextStart;
        nextStart += Math.max(1, Number(seg.length) || defaultLen);
    }
    const allSegs = [...autoSegs, ...reflowedManual];
    const maxEnd = allSegs.reduce((m, s) => Math.max(m, (Number(s.start) || 0) + (Number(s.length) || 0)), 0);
    if(maxEnd > (Number(node.durationFrames) || 0)){
        node.durationFrames = Math.ceil(maxEnd);
        ltxDirectorSyncSeconds(node);
    }
    const prevTimeline = node.ltxTimelineData;
    node.ltxTimelineData = JSON.stringify({segments: allSegs, audioSegments: timeline.audioSegments || []});
    ltxRefreshTimelineEditor(node);
    if(hadTimeline && node.ltxTimelineData !== prevTimeline) scheduleSave();
}
function bindLTXParamsRow(container, node){
    const row = container.querySelector('[data-ltx-params]');
    if(!row) return;
    const fps = () => Math.max(1, Number(node.frameRate) || 24);
    const bindNum = (sel, apply) => {
        const inp = row.querySelector(sel);
        if(!inp) return;
        inp.onmousedown = e => e.stopPropagation();
        inp.onclick = e => e.stopPropagation();
        inp.onchange = () => {
            apply(inp);
            ltxDirectorSyncSeconds(node);
            if(node._ltxEditor){
                node._ltxEditor.commitChanges?.(true);
                node._ltxEditor.render?.();
            }
            scheduleSave();
        };
    };
    const sec = row.querySelector('[data-ltx-duration-seconds]');
    const frames = row.querySelector('[data-ltx-duration-frames]');
    const rate = row.querySelector('[data-ltx-frame-rate]');
    const width = row.querySelector('[data-ltx-width]');
    const height = row.querySelector('[data-ltx-height]');
    if(sec) sec.value = Number(node.durationSeconds) || 5;
    if(frames) frames.value = Number(node.durationFrames) || 120;
    if(rate) rate.value = Number(node.frameRate) || 24;
    if(width) width.value = Number(node.customWidth) || 0;
    if(height) height.value = Number(node.customHeight) || 0;
    bindNum('[data-ltx-duration-seconds]', inp => {
        const v = Math.max(0.1, Math.min(1000, parseFloat(inp.value) || node.durationSeconds || 5));
        node.durationSeconds = Math.round(v * 1000) / 1000;
        node.durationFrames = Math.max(1, Math.round(node.durationSeconds * fps()));
        inp.value = node.durationSeconds;
        if(frames) frames.value = node.durationFrames;
    });
    bindNum('[data-ltx-duration-frames]', inp => {
        node.durationFrames = Math.max(1, Math.min(10000, parseInt(inp.value, 10) || 120));
        if(sec) sec.value = Math.round((node.durationFrames / fps()) * 1000) / 1000;
        inp.value = node.durationFrames;
    });
    bindNum('[data-ltx-frame-rate]', inp => {
        node.frameRate = Math.max(1, Math.min(240, parseInt(inp.value, 10) || 24));
        if(sec) sec.value = Math.round((node.durationFrames / fps()) * 1000) / 1000;
    });
    bindNum('[data-ltx-width]', inp => {
        node.customWidth = Math.max(0, Math.min(8192, parseInt(inp.value, 10) || 0));
        inp.value = node.customWidth;
    });
    bindNum('[data-ltx-height]', inp => {
        node.customHeight = Math.max(0, Math.min(8192, parseInt(inp.value, 10) || 0));
        inp.value = node.customHeight;
    });
}
function ltxFlushTimelineToNode(node){
    if(!node || node.type !== 'ltxDirector') return;
    if(node._ltxEditor && typeof node._ltxEditor.commitChanges === 'function'){
        node._ltxEditor.commitChanges(true);
    }
}
function ltxBuildContiguousRelay(node, globalPromptFallback=''){
    ltxFlushTimelineToNode(node);
    const durationFrames = Math.max(1, Number(node.durationFrames) || 120);
    const fallback = (globalPromptFallback || node.globalPrompt || '').trim() || '.';
    let sortedSegments = [];
    try {
        const t = JSON.parse(node.ltxTimelineData || '{}');
        sortedSegments = [...(t.segments || [])].sort((a, b) => (Number(a.start) || 0) - (Number(b.start) || 0));
    } catch(e) {}
    const contiguousLengths = [];
    const contiguousPrompts = [];
    let currentCursor = 0;
    let pendingGap = 0;
    for(const seg of sortedSegments){
        const start = Number(seg.start) || 0;
        const length = Math.max(1, Number(seg.length) || 1);
        if(start >= durationFrames) break;
        if(start > currentCursor){
            const gapLength = Math.min(start, durationFrames) - currentCursor;
            if(contiguousLengths.length > 0) contiguousLengths[contiguousLengths.length - 1] += gapLength;
            else pendingGap += gapLength;
        }
        const clippedEnd = Math.min(start + length, durationFrames);
        const clippedLength = clippedEnd - start;
        contiguousLengths.push(clippedLength + pendingGap);
        const prompt = (seg.prompt || '').trim();
        contiguousPrompts.push(prompt || fallback);
        if(!prompt) seg.prompt = fallback;
        pendingGap = 0;
        currentCursor = start + length;
    }
    const clampedCursor = Math.min(currentCursor, durationFrames);
    if(contiguousLengths.length > 0 && clampedCursor < durationFrames){
        contiguousLengths[contiguousLengths.length - 1] += durationFrames - clampedCursor;
    }
    if(!contiguousLengths.length){
        contiguousLengths.push(durationFrames);
        contiguousPrompts.push(fallback);
    }
    const guideStrength = sortedSegments
        .filter(s => s.type !== 'text')
        .map(s => (s.guideStrength !== undefined ? s.guideStrength : 1.0).toFixed(2))
        .join(',');
    return {
        local_prompts:contiguousPrompts.join(' | '),
        segment_lengths:contiguousLengths.join(','),
        guide_strength:guideStrength,
        sortedSegments
    };
}
async function ltxDirectorBuildTimelinePayload(node, globalPromptFallback=''){
    ltxDirectorSyncSeconds(node);
    let timeline = {segments: [], audioSegments: []};
    try { timeline = JSON.parse(node.ltxTimelineData || '{}'); } catch(e) {}
    const relay = ltxBuildContiguousRelay(node, globalPromptFallback);
    const segments = [...relay.sortedSegments];
    for(const seg of segments){
        if(seg.type === 'image' && !seg.imageFile){
            const url = seg.imageB64 || '';
            if(url){
                const fullUrl = url.startsWith('http') ? url : (location.origin + (url.startsWith('/') ? url : '/' + url));
                seg.imageFile = await uploadCanvasUrlToComfy(fullUrl);
            }
        }
        if(seg.imgObj) delete seg.imgObj;
    }
    const timelineJson = JSON.stringify({segments, audioSegments: timeline.audioSegments || []});
    node.ltxLocalPrompts = relay.local_prompts;
    node.ltxSegmentLengths = relay.segment_lengths;
    node.ltxGuideStrength = relay.guide_strength;
    node.ltxTimelineData = timelineJson;
    return {
        global_prompt:(globalPromptFallback || node.globalPrompt || '').trim(),
        duration_frames:Number(node.durationFrames) || 120,
        duration_seconds:Number(node.durationSeconds) || 5,
        timeline_data:timelineJson,
        local_prompts:relay.local_prompts,
        segment_lengths:relay.segment_lengths,
        guide_strength:relay.guide_strength,
        epsilon:Number(node.epsilon) || 0.001,
        frame_rate:Number(node.frameRate) || 24,
        use_custom_audio:Boolean(node.useCustomAudio),
        display_mode:node.displayMode || 'seconds',
        custom_width:Math.max(0, Number(node.customWidth) || 0),
        custom_height:Math.max(0, Number(node.customHeight) || 0),
        resize_method:'maintain aspect ratio',
        divisible_by:Math.max(1, Number(node.divisibleBy) || 32),
        img_compression:Number(node.imgCompression) ?? 18,
        timeline_ui:''
    };
}
function ltxDirectorTimelineSegments(node){
    ltxFlushTimelineToNode(node);
    if(node?._ltxEditor?.timeline?.segments) return node._ltxEditor.timeline.segments;
    try {
        const t = JSON.parse(node.ltxTimelineData || '{}');
        return t.segments || [];
    } catch(e) {
        return [];
    }
}
function clearStuckGeneratorRunning(node){
    if(!node || !node.running) return;
    if(cascadeRunningIds.has(node.id) || cascadeSerialIds.has(node.id)) return;
    node.running = false;
}
function updateLTXNodeElementSize(node){
    const el = domQuery(`.node[data-id="${CSS.escape(node.id)}"]`);
    if(!el) return;
    if(node.w) el.style.width = `${node.w}px`;
    if(node.h) el.style.height = `${node.h}px`;
    refreshGeometryAfterLayout();
}
function renderLTXDirectorBody(node){
    if(typeof window.ltxMigrateLegacySegments === 'function') window.ltxMigrateLegacySegments(node);
    else if(typeof ltxMigrateLegacySegments === 'function') ltxMigrateLegacySegments(node);
    ltxDirectorSyncSeconds(node);
    if(!node.ltxTimelineData){
        const len = Math.max(1, Number(node.durationFrames) || 120);
        node.ltxTimelineData = JSON.stringify({
            segments:[{id:uid('ltxseg'), start:0, length:len, prompt:'', type:'text'}],
            audioSegments:[]
        });
    }

    const wrap = document.createElement('div');
    wrap.className = 'ltx-director-body';
    const sources = orderedSources(node, generatorSources(node));
    const promptInputs = sources.filter(src => src.prompt && !src.refs?.length);
    const imageInputs = sources
        .map(src => ({...src, refs:imageRefsOnly(src.refs || [])}))
        .filter(src => src.refs?.length);

    wrap.innerHTML = `
        <div class="prompt-list"></div>
        <div class="ltx-params-row" data-ltx-params>
            <label class="field"><span class="setting-title">${tr('canvas.ltxDurationSec')}</span><input class="setting-input" data-ltx-duration-seconds type="number" min="0.1" max="1000" step="0.01"></label>
            <label class="field"><span class="setting-title">${tr('canvas.ltxDurationFrames')}</span><input class="setting-input" data-ltx-duration-frames type="number" min="1" max="10000" step="1"></label>
            <label class="field"><span class="setting-title">${tr('canvas.ltxFps')}</span><input class="setting-input" data-ltx-frame-rate type="number" min="1" max="240" step="1"></label>
            <label class="field"><span class="setting-title">${tr('canvas.width')}</span><input class="setting-input" data-ltx-width type="number" min="0" max="8192" step="32" title="0 = auto"></label>
            <label class="field"><span class="setting-title">${tr('canvas.height')}</span><input class="setting-input" data-ltx-height type="number" min="0" max="8192" step="32" title="0 = auto"></label>
        </div>
        <div class="ltx-director-timeline-host" data-ltx-timeline-host></div>
        <div class="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">${tr('canvas.ltxLinkedImages')} · ${imageInputs.length}</div>
        <div class="input-list mt-1"></div>
        <div class="gen-run-row">
            ${(() => {
                const ltxBtn = agentPendingRunState(node.id, tr('canvas.ltxRun'), tr('canvas.ltxRunning'));
                return agentGenRunActionsHtml(node.id, `<button class="comfy-run ltx-run ${ltxBtn.runningCls}" ${isNodeDisabled(node) ? 'disabled' : ''}><i data-lucide="film" class="w-4 h-4"></i>${escapeHtml(ltxBtn.label)}</button>`);
            })()}
            ${cascadeBtnHtml(node)}
        </div>
        ${retryBarHtml(node)}
    `;

    renderPromptPreview(wrap.querySelector('.prompt-list'), promptInputs);
    bindLTXParamsRow(wrap, node);
    ltxSyncConnectedImagesToTimeline(node);
    renderComfyImages(wrap.querySelector('.input-list'), node, imageInputs);

    const host = wrap.querySelector('[data-ltx-timeline-host]');
    if(host && window.CanvasLTXTimelineEditor){
        if(node._ltxEditor && node._ltxEditor.wrapper){
            host.appendChild(node._ltxEditor.wrapper);
            node._ltxEditor.container = host;
            node._ltxEditor._onCanvasCommit = () => scheduleSave();
            node._ltxEditor._onCanvasResize = () => { updateLTXNodeElementSize(node); scheduleSave(); };
        } else {
            destroyLTXEditor(node);
            try {
                const editor = new window.CanvasLTXTimelineEditor(node, host, null);
                editor._onCanvasCommit = () => scheduleSave();
                editor._onCanvasResize = () => { updateLTXNodeElementSize(node); scheduleSave(); };
                node._ltxEditor = editor;
            } catch(err) {
                console.error('LTX timeline editor init failed', err);
                host.innerHTML = `<div class="text-[11px] text-red-500 p-2">${escapeHtml(tr('canvas.ltxTimelineLoadFailed'))}</div>`;
            }
        }
    } else if(host) {
        host.innerHTML = `<div class="text-[11px] text-red-500 p-2">${escapeHtml(tr('canvas.ltxTimelineScriptMissing'))}</div>`;
    }

    const runBtn = wrap.querySelector('.ltx-run');
    if(runBtn){
        runBtn.onmousedown = e => e.stopPropagation();
        runBtn.onclick = e => {
            e.stopPropagation();
            e.preventDefault();
            runCanvasGenerate(node.id);
        };
    }
    bindCascadeButtons(wrap, node.id);
    return wrap;
}
async function runLTXDirectorNode(nodeId, opts={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.type !== 'ltxDirector' || isNodeDisabled(node)) return;
    clearStuckGeneratorRunning(node);
    ltxFlushTimelineToNode(node);
    const loopCtx = opts.loopContext !== undefined ? opts.loopContext : loopContext;
    const sources = orderedSources(node, generatorSources(node, loopCtx));
    const upstreamPrompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
    const globalPrompt = [node.globalPrompt, upstreamPrompt].filter(Boolean).join('\n\n').trim();
    const segments = ltxDirectorTimelineSegments(node);
    const hasSegPrompt = segments.some(s => (s.prompt || '').trim());
    const hasImageSeg = segments.some(s => s.type === 'image' && (s.imageFile || s.imageB64));
    if(!globalPrompt && !hasSegPrompt && !hasImageSeg){
        const msg = tr('canvas.needPromptOrImage');
        setStatus(msg);
        showErrorModal(msg, tr('canvas.ltxFailed'));
        return;
    }
    if(segments.some(s => s.type === 'image' && !s.imageFile && !s.imageB64)){
        const msg = tr('canvas.ltxImageSegNeedRef');
        setStatus(msg);
        showErrorModal(msg, tr('canvas.ltxFailed'));
        return;
    }
    ltxDirectorSyncSeconds(node);
    let out = outputForNode(node, 520);
    const pendingId = uid('p');
    const refs = sources.flatMap(s => s.refs || []);
    const run = runSnapshot(node, globalPrompt || segments.map(s => s.prompt).join(' | '), refs);
    run.taskLabel = tr('canvas.ltxDirector');
    if(out) out._pending = [...(out._pending || []), makePending(pendingId, run)];
    syncAppendableNodeRunState(node);
    if(!opts.cascade) setStatus(tr('canvas.ltxRunning'));
    refreshRunNodes(node, out);
    const execute = async () => {
    try {
        const directorInputs = await ltxDirectorBuildTimelinePayload(node, globalPrompt);
        const params = {
            [LTX_DIRECTOR_WF_NODE]:directorInputs,
            [LTX_DIRECTOR_SEED_NODE]:{noise_seed:Number(node.noiseSeed ?? 12)}
        };
        const result = await apiFetch('/api/generate', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({
                prompt:globalPrompt,
                workflow_json:LTX_DIRECTOR_WORKFLOW,
                params,
                type:'ltx-director',
                client_id:CLIENT_ID
            })
        }).then(async r => {
            if(!r.ok) throw new Error(await responseErrorMessage(r, tr('canvas.ltxFailed')));
            return r.json();
        });
        run.request = requestMetaFromResult(result);
        if(result.error) throw new Error(result.error);
        const outputs = comfyResultOutputs(result);
        if(!outputs.length) throw new Error(tr('canvas.ltxNoOutput'));
        const meta = collectRunMeta(out, pendingId);
        if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
        appendOutputImages(out, outputs, refs[0], [meta]);
        mergeGeneratedOutputs(node, outputs, Boolean(opts.cascade));
        addGenerationLog({run, outputs, runMs:meta.runMs || 0});
        syncAgentRunStatusAfterTask(node, {completed:agentPendingCount(node.id) === 0});
        refreshRunNodes(node, out);
        scheduleSave();
    } catch(err) {
        const meta = collectRunMeta(out, pendingId);
        if(out) out._pending = (out._pending || []).filter(p => p.id !== pendingId);
        addGenerationLog({run, outputs:[], runMs:meta.runMs || 0, error:err.message || String(err)});
        syncAgentRunStatusAfterTask(node, {failed:agentPendingCount(node.id) === 0, error:err.message || String(err)});
        refreshRunNodes(node, out);
        if(opts.cascade) throw err;
        showErrorModal(err.message || tr('canvas.ltxFailed'), tr('canvas.ltxFailed'));
    }
    };
    if(opts.cascade) await execute();
    else void execute();
}
async function runComfyNode(nodeId, opts={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || isNodeDisabled(node)) return;
    const loopCtx = opts.loopContext !== undefined ? opts.loopContext : loopContext;
    const sources = orderedSources(node, generatorSources(node, loopCtx));
    const prompt = sources.map(s => s.prompt).filter(Boolean).join('\n\n');
    const allRefs = sources.flatMap(s => s.refs || []);
    const refs = imageRefsOnly(allRefs);
    const mode = node.mode || 'text';
    const customImageFields = mode === 'custom' ? comfyFields(node, 'image') : [];
    const customVideoFields = mode === 'custom' ? comfyFields(node, 'video') : [];
    const customAudioFields = mode === 'custom' ? comfyFields(node, 'audio') : [];
    const customPromptFields = mode === 'custom' ? comfyFields(node, 'prompt') : [];
    if((mode === 'text' || (mode === 'custom' && customPromptFields.length)) && !prompt){ softAlert(tr('canvas.needPrompt')); return; }
    if((mode !== 'text' && mode !== 'custom' && !refs.length) || (mode === 'custom' && refs.length < customImageFields.length)){ softAlert(tr('canvas.needImage')); return; }
    if(mode === 'custom' && videoRefsOnly(allRefs).length < customVideoFields.length){ softAlert(langIsEn() ? 'Please connect enough video inputs for this ComfyUI workflow.' : '请为这个 ComfyUI 工作流连接足够的视频输入'); return; }
    if(mode === 'custom' && audioRefsOnly(allRefs).length < customAudioFields.length){ softAlert(langIsEn() ? 'Please connect enough audio inputs for this ComfyUI workflow.' : '请为这个 ComfyUI 工作流连接足够的音频输入'); return; }
    let out = outputForNode(node, 480);
    const pendingId = uid('p');
    const run = runSnapshot(node, prompt, refs);
    run.taskLabel = comfyRunLabel(node);
    if(out) out._pending = [...(out._pending||[]), makePending(pendingId, run)];
    syncAppendableNodeRunState(node);
    refreshRunNodes(node, out);
    const execute = async () => {
    try {
        let images = [];
        if(mode === 'text'){
            run.taskLabel = tr('canvas.comfyText');
            const result = await apiFetch('/api/generate', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    prompt,
                    width:Number(node.width || 1024),
                    height:Number(node.height || 1024),
                    workflow_json:'Z-Image.json',
                    type:'zimage',
                    client_id:CLIENT_ID
                })
            }).then(async r => { if(!r.ok) throw new Error(await responseErrorMessage(r, actionFailed('canvas.comfyText'))); return r.json(); });
            run.request = requestMetaFromResult(result);
            images = comfyResultOutputs(result);
        } else if(mode === 'enhance'){
            run.taskLabel = tr('canvas.comfyEnhance');
            const inputName = await comfyNameForRef(refs[0]);
            const enhance = await apiFetch('/api/generate', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    workflow_json:'Z-Image-Enhance.json',
                    params:{
                        "15": { image:inputName },
                        "204": { value:Number(node.enhanceStrength ?? 0.5) }
                    },
                    type:'enhance',
                    client_id:CLIENT_ID
                })
            }).then(async r => { if(!r.ok) throw new Error(await responseErrorMessage(r, actionFailed('canvas.comfyEnhance'))); return r.json(); });
            run.request = requestMetaFromResult(enhance);
            if(enhance.error) throw new Error(actionFailed('canvas.comfyEnhance', enhance.error));
            if(!enhance.images?.length) throw new Error(noReturnedImage('canvas.comfyEnhance'));
            if(node.enhanceUpscale){
                images = await runComfyUpscale(enhance.images?.[0], node.enhanceUpscaleRes || 2048);
            } else {
                images = enhance.images || [];
            }
        } else if(mode === 'custom'){
            const workflowName = validComfyWorkflowName(node.comfyWorkflow || comfyWorkflows[0]?.name || '');
            run.taskLabel = workflowName || tr('canvas.comfyCustom');
            if(node.comfyWorkflow && node.comfyWorkflow !== workflowName) node.comfyWorkflow = workflowName;
            const wf = await ensureComfyWorkflow(workflowName);
            if(!workflowName || !wf) throw new Error(tr('canvas.comfyNoWorkflow'));
            const fields = wf?.config?.fields || [];
            const params = {};
            const imageFields = fields.filter(f => comfyFieldKind(f) === 'image');
            const videoFields = fields.filter(f => comfyFieldKind(f) === 'video');
            const audioFields = fields.filter(f => comfyFieldKind(f) === 'audio');
            const promptFields = fields.filter(f => comfyFieldKind(f) === 'prompt');
            const settingFields = fields.filter(f => comfyFieldKind(f) === 'setting');
            const assignMediaFields = async (mediaFields, mediaRefs) => {
                const names = [];
                for(const ref of mediaRefs.slice(0, mediaFields.length)) names.push(await comfyNameForRef(ref));
                mediaFields.forEach((f, i) => {
                    if(!f.node || !f.input) return;
                    params[f.node] = params[f.node] || {};
                    params[f.node][f.input] = names[i] || '';
                });
            };
            await assignMediaFields(imageFields, refs);
            await assignMediaFields(videoFields, videoRefsOnly(allRefs));
            await assignMediaFields(audioFields, audioRefsOnly(allRefs));
            promptFields.forEach(f => {
                if(!f.node || !f.input) return;
                params[f.node] = params[f.node] || {};
                params[f.node][f.input] = prompt;
            });
            settingFields.forEach(f => {
                if(!f.node || !f.input) return;
                params[f.node] = params[f.node] || {};
                if(comfyRandomEnabled(f) && comfyRandomActive(node, f.id)){
                    node.comfyParams = node.comfyParams || {};
                    node.comfyParams[f.id] = comfyRandomValue(f);
                }
                params[f.node][f.input] = comfyParamValue(node, f);
            });
            const result = await apiFetch('/api/generate', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    prompt,
                    workflow_json:workflowName,
                    params,
                    type:'workflow-custom',
                    client_id:CLIENT_ID
                })
            }).then(async r => { if(!r.ok) throw new Error(await responseErrorMessage(r, actionFailed('canvas.comfyCustom'))); return r.json(); });
            run.request = requestMetaFromResult(result);
            if(result.error) throw new Error(actionFailed('canvas.comfyCustom', result.error));
            images = comfyResultOutputs(result);
            if(!images.length) throw new Error(noReturnedImage('canvas.comfyCustom'));
        } else {
            run.taskLabel = tr('canvas.comfyEdit');
            const names = [];
            for (const ref of refs.slice(0, 3)) names.push(await comfyNameForRef(ref));
            const result = await apiFetch('/api/generate', {
                method:'POST',
                headers:{'Content-Type':'application/json'},
                body:JSON.stringify({
                    prompt,
                    workflow_json:'Flux2-Klein.json',
                    type:'klein',
                    params:{
                        "168": { text:prompt },
                        "158": { noise_seed:Math.floor(Math.random() * 1000000) },
                        "278": { image:names[0] || "" },
                        "270": { image:names[1] || "" },
                        "292": { image:names[2] || "" },
                        "313": { value:Boolean(names[1]) },
                        "314": { value:Boolean(names[2]) }
                    },
                    client_id:CLIENT_ID
                })
            }).then(async r => { if(!r.ok) throw new Error(await responseErrorMessage(r, actionFailed('canvas.comfyEdit'))); return r.json(); });
            run.request = requestMetaFromResult(result);
            if(result.error) throw new Error(actionFailed('canvas.comfyEdit', result.error));
            if(!result.images?.length) throw new Error(noReturnedImage('canvas.comfyEdit'));
            images = node.editUpscale ? await runComfyUpscale(result.images?.[0], node.editUpscaleRes || 2048) : result.images || [];
        }
        const meta = collectRunMeta(out, pendingId);
        if(out) out._pending = (out._pending||[]).filter(p => p.id !== pendingId);
        appendOutputImages(out, images, refs[0], [meta]);
        mergeGeneratedOutputs(node, images, Boolean(opts.cascade));
        addGenerationLog({run, outputs:images, runMs:meta.runMs || 0});
        syncAgentRunStatusAfterTask(node, {completed:agentPendingCount(node.id) === 0});
        refreshRunNodes(node, out);
        scheduleSave();
    } catch(err) {
        const meta = collectRunMeta(out, pendingId);
        addGenerationLog({run, outputs:[], runMs:meta.runMs || 0, error:err.message || String(err)});
        if(out) out._pending = (out._pending||[]).filter(p => p.id !== pendingId);
        syncAgentRunStatusAfterTask(node, {failed:agentPendingCount(node.id) === 0, error:err.message || String(err)});
        refreshRunNodes(node, out);
        if(opts.cascade) throw err;
    }
    };
    if(opts.cascade) await execute();
    else void execute();
}
async function callCanvasLLM(node, message, messages=[], mediaOpts={}){
    const llmProv = resolveChatProviderId(node.llmProvider || 'comfly');
    const model = resolveChatModel(node.model || node.llmMsModel, llmProv);
    const videos = mediaOpts.videos || (node.type === 'videoReverse' ? videoReverseInputVideos(node) : llmInputVideos(node));
    const images = mediaOpts.images || llmInputImages(node);
    const result = await apiFetch('/api/canvas-llm', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({
            message,
            model: node.type === 'videoReverse' ? (node.model || model) : model,
            ms_model: llmProv === 'modelscope' ? model : '',
            provider: llmProv,
            system_prompt: node.systemPrompt || node.system_prompt || 'You are a helpful assistant.',
            messages,
            images,
            videos,
        })
    }).then(async r => {
        if(!r.ok){
            throw new Error(await responseErrorMessage(r, 'LLM 运行失败'));
        }
        return r.json();
    });
    return result.text || '';
}
async function runLLMNode(nodeId, opts={}){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || (node.running && !opts.cascade)) return;
    const input = llmInputText(node) || node.userInput || '';
    if(!input){
        if(opts.cascade) throw new Error('LLM 缺少提示词输入');
        softAlert(tr('canvas.needPromptToLLM')); return;
    }
    if(!opts.cascade){ node.running = true; refreshNodes([node.id]); }
    try {
        node.outputText = await callCanvasLLM(node, input, []);
        if(!opts.cascade) node.running = false;
        node.runStatus = 'done'; node.runError = '';
        refreshNodes([node.id]);
        scheduleSave();
    } catch(err) {
        if(!opts.cascade) node.running = false;
        node.runStatus = 'failed'; node.runError = err.message || String(err);
        refreshNodes([node.id]);
        if(opts.cascade) throw err;
    }
}
// 判断是不是「链尾」节点：没有下游生成节点（直接相连或经 Output 中转都算）
function isTerminalGenerator(nodeId){
    const GEN_TYPES = canvasRunTypes();
    for(const c of connections.filter(c => c.from === nodeId)){
        const t = nodes.find(n => n.id === c.to);
        if(!t) continue;
        if(GEN_TYPES.includes(t.type)) return false;
        if(t.type === 'output'){
            for(const c2 of connections.filter(cc => cc.from === t.id)){
                const t2 = nodes.find(n => n.id === c2.to);
                if(t2 && GEN_TYPES.includes(t2.type)) return false;
            }
        }
    }
    return true;
}
function findLoopCascadeTarget(loopId){
    const runTypes = canvasRunTypes();
    const seen = new Set();
    const candidates = [];
    const walk = (id, depth=0) => {
        if(seen.has(id)) return;
        seen.add(id);
        connections.filter(c => c.from === id).forEach(c => {
            const next = nodes.find(n => n.id === c.to);
            if(!next) return;
            if(runTypes.includes(next.type)){
                candidates.push({id:next.id, depth:depth + 1, terminal:isTerminalGenerator(next.id)});
            }
            walk(next.id, depth + 1);
        });
    };
    walk(loopId);
    const terminal = candidates.filter(c => c.terminal).sort((a, b) => b.depth - a.depth)[0];
    return (terminal || candidates.sort((a, b) => b.depth - a.depth)[0])?.id || '';
}
function hasUpstreamLoop(nodeId){
    return Boolean(resolveCascadeLoop(nodeId));
}
function loopCascadeButtonLabel(count){
    return trf('canvas.runLoopRounds', {n: Math.max(1, Number(count) || 1)});
}
function cascadeBtnHtml(node){
    // 仅链尾节点显示一键运行
    if(!isTerminalGenerator(node.id)) return '';
    const order = computeCascadeOrder(node.id);
    const loop = resolveCascadeLoop(node.id);
    if(order.length <= 1 && !loop) return '';
    const label = loop ? loopCascadeButtonLabel(loop.count) : trf('canvas.runCascadeWorkflow', {n: order.length});
    // 仅在以串行模式启动的运行中显示停止按钮
    if(cascadeSerialIds.has(node.id)){
        const stopping = cascadeStopIds.has(node.id);
        return `<button class="gen-cascade-btn gen-cascade-stop" type="button" data-cascade-stop="${node.id}" ${stopping ? 'disabled' : ''}><i data-lucide="square" class="w-4 h-4"></i><span>${stopping ? '停止中…' : '停止循环'}</span></button>`;
    }
    return `<button class="gen-cascade-btn" type="button" data-cascade="${node.id}" title="${loop ? tr('canvas.loopHint') : '一键运行整条工作流（追溯所有上游生成节点）'}"><i data-lucide="play-circle" class="w-4 h-4"></i><span>${label}</span></button>`;
}
function retryBarHtml(node){
    if(node.runStatus !== 'failed' || !node.runError) return '';
    const stopBtn = node._cascadeFailed
        ? `<button class="node-stop-btn" type="button" data-stop="${node.id}">停止</button>`
        : '';
    const msg = String(node.runError || tr('canvas.generationFailed'));
    return `<div class="node-retry-bar" data-retry-bar>
        <div class="node-retry-msg">${escapeHtml(msg)}</div>
        <div class="node-retry-actions">
            <button class="node-retry-copy" type="button" data-retry-copy="${node.id}">复制</button>
            <button class="node-retry-btn" type="button" data-retry="${node.id}">重试</button>
            ${stopBtn}
        </div>
    </div>`;
}
function bindCascadeButtons(wrap, nodeId){
    wrap.querySelectorAll(`[data-cascade="${nodeId}"]`).forEach(b => {
        b.onmousedown = e => e.stopPropagation();
        b.onclick = e => { e.stopPropagation(); runNodeCascade(nodeId); };
    });
    wrap.querySelectorAll(`[data-cascade-stop="${nodeId}"]`).forEach(b => {
        b.onmousedown = e => e.stopPropagation();
        b.onclick = e => { e.stopPropagation(); requestCascadeStop(nodeId); };
    });
    wrap.querySelectorAll(`[data-retry="${nodeId}"]`).forEach(b => {
        b.onmousedown = e => e.stopPropagation();
        b.onclick = e => { e.stopPropagation(); void rerunFailedNode(nodeId); };
    });
    wrap.querySelectorAll(`[data-retry-copy="${nodeId}"]`).forEach(b => {
        b.onmousedown = e => e.stopPropagation();
        b.onclick = e => {
            e.stopPropagation();
            const node = nodes.find(n => n.id === nodeId);
            const text = String(node?.runError || '').trim();
            if(!text) return;
            void navigator.clipboard.writeText(text).catch(() => {});
        };
    });
    wrap.querySelectorAll(`[data-stop="${nodeId}"]`).forEach(b => {
        b.onmousedown = e => e.stopPropagation();
        b.onclick = e => { e.stopPropagation(); cancelCascade(nodeId); };
    });
    wrap.querySelectorAll(`[data-stop-all="${nodeId}"]`).forEach(b => {
        b.onmousedown = e => e.stopPropagation();
        b.onclick = e => { e.stopPropagation(); stopAgentGeneration(nodeId); };
    });
}
// —— 一键运行：从目标节点反向追溯到所有上游生成节点，按拓扑顺序串行执行 ——
function runCascadeNodeByType(node, opts={}){
    const runOpts = {cascade:true, ...opts};
    if(node.type === 'generator') return runGenerator(node.id, runOpts);
    if(node.type === 'replicaAgent') return runReplicaAgent(node.id, runOpts);
    if(node.type === 'imageRepairAgent') return runImageRepairAgent(node.id, runOpts);
    if(node.type === 'batchPosterAgent') return runBatchPosterAgent(node.id, runOpts);
    if(node.type === 'nineGridAgent') return runNineGridFull(node.id);
    if(node.type === 'slotsLoopVideoAgent') return runSlotsLoopVideoAgent(node.id, runOpts);
    if(node.type === 'msgen') return runMsGenNode(node.id, runOpts);
    if(node.type === 'comfy') return runComfyNode(node.id, runOpts);
    if(node.type === 'ltxDirector') return runLTXDirectorNode(node.id, runOpts);
    if(node.type === 'llm') return runLLMNode(node.id, runOpts);
    if(node.type === 'video') return runVideoNode(node.id, runOpts);
    if(node.type === 'rh') return runRhNode(node.id, runOpts);
    return Promise.resolve();
}
function runCascadeNodeWithLoopContext(node, ctx, opts={}){
    return runCascadeNodeByType(node, {...opts, cascade:true, loopContext:ctx});
}
function cascadeParallelLimit(order, totalRounds){
    const hasComfy = order.some(id => nodes.find(n => n.id === id)?.type === 'comfy');
    if(hasComfy) return Math.max(1, Math.min(totalRounds, comfyBackendCount || 1));
    return Math.max(1, Math.min(totalRounds, LOOP_PARALLEL_MAX));
}
async function runLimitedCascadeRounds(rounds, limit, runner){
    let next = 0;
    const workers = Array.from({length:Math.max(1, Math.min(limit, rounds.length))}, async () => {
        while(next < rounds.length){
            const round = rounds[next++];
            await runner(round);
        }
    });
    return Promise.allSettled(workers);
}
function canvasRunTypes(){
    return ['generator','msgen','comfy','ltxDirector','llm','video','rh','replicaAgent','imageRepairAgent','batchPosterAgent','nineGridAgent','slotsLoopVideoAgent'];
}
function canvasWorkflowEdges(){
    const runTypes = canvasRunTypes();
    const direct = [];
    connections.forEach(c => {
        const from = nodes.find(n => n.id === c.from);
        const to = nodes.find(n => n.id === c.to);
        if(!from || !to || !runTypes.includes(from.type)) return;
        if(runTypes.includes(to.type)){
            direct.push([from.id, to.id]);
            return;
        }
        if(to.type === 'output'){
            connections.filter(cc => cc.from === to.id).forEach(cc => {
                const next = nodes.find(n => n.id === cc.to);
                if(next && runTypes.includes(next.type)) direct.push([from.id, next.id]);
            });
        }
    });
    return direct;
}
function computeConnectedWorkflowOrder(anchorId){
    const anchor = nodes.find(n => n.id === anchorId);
    const runTypes = canvasRunTypes();
    if(!anchor || !runTypes.includes(anchor.type)) return [];
    const edges = canvasWorkflowEdges();
    const connected = new Set([anchorId]);
    let changed = true;
    while(changed){
        changed = false;
        edges.forEach(([from, to]) => {
            if(connected.has(from) && !connected.has(to)){ connected.add(to); changed = true; }
            if(connected.has(to) && !connected.has(from)){ connected.add(from); changed = true; }
        });
    }
    const order = [];
    const seen = new Set();
    const visit = id => {
        if(seen.has(id)) return;
        seen.add(id);
        edges.filter(([, to]) => to === id).forEach(([from]) => {
            if(connected.has(from)) visit(from);
        });
        if(connected.has(id)) order.push(id);
    };
    nodes.filter(n => connected.has(n.id) && runTypes.includes(n.type)).forEach(n => visit(n.id));
    return order;
}
async function runCanvasGenerate(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || isNodeDisabled(node) || cascadeRunningIds.has(nodeId)) return;
    const order = computeConnectedWorkflowOrder(nodeId);
    if(order.length > 1){
        cascadeRunningIds.add(nodeId);
        refreshNodes(order);
        try {
            await runOneCascadePass(order);
        } finally {
            cascadeRunningIds.delete(nodeId);
            refreshNodes(order);
        }
        return;
    }
    return runCascadeNodeByType(node, {cascade:false});
}
function computeCascadeOrder(targetId){
    const visited = new Set();
    const order = [];
    const GEN_TYPES = canvasRunTypes();
    function dfs(id){
        if(visited.has(id)) return;
        visited.add(id);
        const node = nodes.find(n => n.id === id);
        if(!node) return;
        // 找该节点的上游
        connections.filter(c => c.to === id).forEach(c => {
            const from = nodes.find(n => n.id === c.from);
            if(!from) return;
            if(GEN_TYPES.includes(from.type)){
                dfs(from.id);
            } else if(from.type === 'output'){
                // output 节点的上游是生成器
                connections.filter(cc => cc.to === from.id).forEach(cc => {
                    const ff = nodes.find(n => n.id === cc.from);
                    if(ff && GEN_TYPES.includes(ff.type)) dfs(ff.id);
                });
            }
        });
        if(GEN_TYPES.includes(node.type) && isNodeEnabled(node)) order.push(id);
    }
    dfs(targetId);
    return order;
}
function upstreamNodeIds(targetId){
    const found = new Set();
    const walk = id => {
        connections.filter(c => c.to === id).forEach(c => {
            if(found.has(c.from)) return;
            found.add(c.from);
            walk(c.from);
        });
    };
    walk(targetId);
    return found;
}
function resolveCascadeLoop(targetId){
    const upstream = upstreamNodeIds(targetId);
    const loops = nodes.filter(n => n.type === 'loop' && upstream.has(n.id));
    if(!loops.length) return null;
    const loop = loops[loops.length - 1];
    return {node:loop, count:loopCount(loop), mode:loop.mode === 'parallel' ? 'parallel' : 'serial'};
}
function cascadeUiNodeIds(targetId, order=null){
    const ids = new Set([targetId, ...(order || computeCascadeOrder(targetId))]);
    const loop = resolveCascadeLoop(targetId);
    if(loop?.node?.id) ids.add(loop.node.id);
    return [...ids].filter(Boolean);
}
function requestCascadeStop(targetId){
    if(!targetId) return;
    cascadeStopIds.add(targetId);
    refreshNodes(cascadeUiNodeIds(targetId));
}
async function runNodeCascade(nodeId){
    const target = nodes.find(n => n.id === nodeId);
    if(!target) return;
    if(isNodeDisabled(target)){
        setStatus(tr('canvas.nodeDisabledRunBlocked'));
        return;
    }
    if(cascadeRunningIds.has(nodeId)){
        setStatus(langIsEn() ? 'Workflow is already running…' : '工作流正在运行中…');
        return;
    }
    if(target.running){
        softAlert(langIsEn() ? 'This node is already running' : '当前节点正在运行');
        return;
    }
    cascadeRunningIds.add(nodeId);
    const order = computeCascadeOrder(nodeId);
    refreshNodes(cascadeUiNodeIds(nodeId, order));
    if(!order.length){
        cascadeRunningIds.delete(nodeId);
        softAlert(langIsEn() ? 'No runnable generator nodes' : '没有可运行的生成节点');
        return;
    }
    const loop = resolveCascadeLoop(nodeId);
    const totalRounds = loop?.count || 1;
    const startIdx = Math.max(1, Number(loop?.node?.loopStart) || 1);
    const loopBatchSize = loop?.node?.imageInput ? Math.max(1, Math.min(100, Number(loop?.node?.imageBatchSize) || 1)) : 1;
    const endIdx = startIdx + (totalRounds - 1) * loopBatchSize;
    order.forEach(id => {
        const n = nodes.find(x => x.id === id);
        if(n) n.generatedOutputs = [];
    });
    if(loop?.mode === 'parallel' && totalRounds > 1){
        cascadeSerialIds.add(nodeId);
        order.forEach(id => {
            const n = nodes.find(x => x.id === id);
            if(n){ n.runStatus = 'queued'; n.runError = ''; n._cascadeFailed = false; n._cascadeIdx = `0/${totalRounds}`; }
        });
        refreshNodes(cascadeUiNodeIds(nodeId, order));
        let done = 0;
        const rounds = Array.from({length:totalRounds}, (_, idx) => ({idx, index:startIdx + idx * loopBatchSize}));
        const limit = cascadeParallelLimit(order, totalRounds);
        const results = await runLimitedCascadeRounds(rounds, limit, async ({index}) => {
            if(cascadeStopIds.has(nodeId)) return;
            const ctx = {index, total:endIdx, nodeId:loop.node.id};
            for(let i = 0; i < order.length; i++){
                if(cascadeStopIds.has(nodeId)) return;
                const id = order[i];
                const node = nodes.find(n => n.id === id);
                if(!node) continue;
                node.runStatus = 'running';
                node._cascadeIdx = `${order.indexOf(id)+1}/${order.length} · ${index}/${endIdx}`;
                refreshNodes([id]);
                await runCascadeNodeWithLoopContext(node, ctx);
                node.runStatus = 'done';
                refreshNodes([id]);
            }
            done += 1;
            order.forEach(id => {
                const n = nodes.find(x => x.id === id);
                if(n) n._cascadeIdx = `${done}/${totalRounds}`;
            });
            refreshNodes(order);
        });
        loopContext = null;
        cascadeRunningIds.delete(nodeId);
        cascadeStopIds.delete(nodeId);
        cascadeSerialIds.delete(nodeId);
        refreshNodes(cascadeUiNodeIds(nodeId, order));
        const failed = results.find(r => r.status === 'rejected');
        if(failed){
            const err = failed.reason || new Error('parallel loop failed');
            const node = nodes.find(n => n.id === nodeId) || target;
            const errText = humanizeCanvasGenerationError(err.message || String(err));
            node.runStatus = 'failed';
            node.runError = errText;
            node._cascadeFailed = true;
            refreshNodes(cascadeUiNodeIds(nodeId, order));
            showErrorModal(`${errText}\n\n${tr('canvas.runFailedOutputUnchanged')}`, tr('canvas.generationFailed'));
            return;
        }
        setTimeout(() => {
            order.forEach(id => {
                const n = nodes.find(x => x.id === id);
                if(n && n.runStatus === 'done'){ n.runStatus = ''; n._cascadeIdx = ''; }
            });
            refreshNodes(cascadeUiNodeIds(nodeId, order));
        }, 3000);
        return;
    }
    cascadeSerialIds.add(nodeId);
    refreshNodes(cascadeUiNodeIds(nodeId, order));
    for(let round = 1; round <= totalRounds; round++){
        if(cascadeStopIds.has(nodeId)){
            cascadeStopIds.delete(nodeId);
            cascadeRunningIds.delete(nodeId);
            cascadeSerialIds.delete(nodeId);
            loopContext = null;
            order.forEach(id => { const n = nodes.find(x=>x.id===id); if(n){ n.runStatus=''; n._cascadeIdx=''; } });
            refreshNodes(cascadeUiNodeIds(nodeId, order));
            return;
        }
        const loopIndex = startIdx + (round - 1) * loopBatchSize;
        loopContext = loop ? {index:loopIndex, total:endIdx, nodeId:loop.node.id} : null;
        order.forEach(id => {
            const n = nodes.find(x => x.id === id);
            if(n){ n.runStatus = 'queued'; n.runError = ''; n._cascadeFailed = false; n._cascadeIdx = `${order.indexOf(id)+1}/${order.length}${totalRounds > 1 ? ` · ${loopIndex}/${endIdx}` : ''}`; }
        });
        refreshNodes(cascadeUiNodeIds(nodeId, order));
        for(let i = 0; i < order.length; i++){
            const id = order[i];
            const node = nodes.find(n => n.id === id);
            if(!node) continue;
            node.runStatus = 'running';
            refreshNodes([id]);
            try {
                await runCascadeNodeWithLoopContext(node, loopContext);
                node.runStatus = 'done';
                refreshNodes([id]);
            } catch(err){
                loopContext = null;
                cascadeRunningIds.delete(nodeId);
                cascadeStopIds.delete(nodeId);
                cascadeSerialIds.delete(nodeId);
                node.runStatus = 'failed';
                const errText = humanizeCanvasGenerationError(err.message || String(err));
                node.runError = `${totalRounds > 1 ? `${tr('canvas.loopRound')} ${round}/${totalRounds}: ` : ''}${errText}`;
                node._cascadeFailed = true;
                for(let j = i + 1; j < order.length; j++){
                    const n2 = nodes.find(x => x.id === order[j]);
                    if(n2){ n2.runStatus = ''; n2._cascadeIdx = ''; }
                }
                refreshNodes(cascadeUiNodeIds(nodeId, order.slice(i)));
                showErrorModal(`${errText}\n\n${tr('canvas.runFailedOutputUnchanged')}`, tr('canvas.generationFailed'));
                return;
            }
        }
    }
    loopContext = null;
    cascadeRunningIds.delete(nodeId);
    cascadeStopIds.delete(nodeId);
    cascadeSerialIds.delete(nodeId);
    refreshNodes(cascadeUiNodeIds(nodeId, order));
    // 全部完成：3 秒后清除状态徽章
    setTimeout(() => {
        order.forEach(id => {
            const n = nodes.find(x => x.id === id);
            if(n && n.runStatus === 'done'){ n.runStatus = ''; n._cascadeIdx = ''; }
        });
        refreshNodes(cascadeUiNodeIds(nodeId, order));
    }, 3000);
}
async function runOneCascadePass(order, options={}){
    order.forEach(id => {
        const n = nodes.find(x => x.id === id);
        if(n){ n.runStatus = 'queued'; n.runError = ''; n._cascadeFailed = false; n._cascadeIdx = ''; }
    });
    refreshNodes(order);
    for(let i = 0; i < order.length; i++){
        const id = order[i];
        const node = nodes.find(n => n.id === id);
        if(!node) continue;
        node.runStatus = 'running';
        refreshNodes([id]);
        try {
            // 统一走 runCascadeNodeByType，避免 Agent 节点被静默跳过
            await runCascadeNodeByType(node, {cascade:true, ...options});
            if(node.runStatus === 'failed'){
                node._cascadeFailed = true;
                throw new Error(node.runError || (langIsEn() ? 'Node failed' : '节点失败'));
            }
            node.runStatus = 'done';
            refreshNodes([id]);
        } catch(err) {
            node.runStatus = 'failed';
            node.runError = err.message || String(err);
            node._cascadeFailed = true;
            throw err;
        }
    }
}
// 失败重试：从该节点继续往下游跑
async function rerunFailedNode(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    if(node._cascadeFailed) return retryNodeAndDownstream(nodeId);
    node.runStatus = '';
    node.runError = '';
    node._cascadeFailed = false;
    refreshNodes([nodeId]);
    try { await runCascadeNodeByType(node, {cascade:false}); }
    catch(err) { refreshNodes([nodeId]); }
}
async function retryNodeAndDownstream(nodeId){
    const target = nodes.find(n => n.id === nodeId);
    if(!target) return;
    const order = computeCascadeOrder(nodeId);
    // 只重跑从该节点开始的剩余链
    const idx = order.indexOf(nodeId);
    const remain = idx >= 0 ? order.slice(idx) : [nodeId];
    try { await runOneCascadePass(remain); }
    catch(err) { refreshNodes(remain); return; }
    setTimeout(() => {
        remain.forEach(id => {
            const n = nodes.find(x => x.id === id);
            if(n && n.runStatus === 'done'){ n.runStatus = ''; n._cascadeIdx = ''; }
        });
        refreshNodes(remain);
    }, 3000);
}
function cancelCascade(nodeId){
    // 简单实现：把当前节点和上游 queued/failed 状态清掉（不能 abort 已发出的请求）
    const order = computeCascadeOrder(nodeId);
    order.forEach(id => {
        const n = nodes.find(x => x.id === id);
        if(n && (n.runStatus === 'queued' || n.runStatus === 'failed')){
            n.runStatus = ''; n._cascadeIdx = ''; n.runError = ''; n._cascadeFailed = false;
        }
    });
    refreshNodes(order);
}

async function runLLMChat(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node || node.running) return;
    const message = (node.chatInput || '').trim();
    if(!message) return;
    node.messages = node.messages || [];
    const history = node.messages.slice();
    node.messages.push({role:'user', content:message});
    node.chatInput = '';
    node.running = true;
    refreshNodes([node.id]);
    try {
        const text = await callCanvasLLM(node, message, history);
        node.messages.push({role:'assistant', content:text});
        node.outputText = text;
        node.running = false;
        refreshNodes([node.id]);
        scheduleSave();
    } catch(err) {
        node.running = false;
        node.runStatus = 'failed';
        node.runError = err.message || (langIsEn() ? 'LLM run failed' : 'LLM 运行失败');
        refreshNodes([node.id]);
    }
}

function purgeNodeFromGroups(nodeId){
    if(!nodeId) return;
    nodes.forEach(n => {
        if((n.type === 'group' || n.type === 'promptGroup' || n.type === 'imageBatch') && Array.isArray(n.items) && n.items.includes(nodeId)){
            n.items = n.items.filter(id => id !== nodeId);
        }
    });
}
function deleteNode(id, event){
    event?.stopPropagation();
    if(!nodes.some(n => n.id === id)) return;
    try { pushUndo(); } catch(err) { console.warn('[infinite-canvas] undo snapshot failed', err); }
    purgeNodeFromGroups(id);
    destroyLTXEditor(nodes.find(n => n.id === id));
    nodes = nodes.filter(n => n.id !== id);
    connections = connections.filter(c => c.from !== id && c.to !== id);
    selected.delete(id);
    commitCanvasStructureEdit();
    scheduleSave();
}
function clearNodeContentBeforeDelete(id){
    const node = nodes.find(n => n.id === id);
    if(!node) return false;
    if(node.type === 'image' && node.url){
        pushUndo();
        node.url = '';
        node.mediaKind = 'image';
        node.name = '上传卡片';
        commitCanvasStructureEdit();
        scheduleSave();
        return true;
    }
    if(node.type === 'output' && ((node.images || []).length || (node._pending || []).length)){
        pushUndo();
        node.images = [];
        node._pending = [];
        node.imageComparisons = {};
        refreshNodes([node.id]);
        scheduleSave();
        return true;
    }
    return false;
}
function deleteNodeFromButton(id, event){
    event?.preventDefault();
    event?.stopPropagation();
    if(clearNodeContentBeforeDelete(id)) return;
    deleteNode(id, event);
}
function deleteConnection(id, event){
    event?.preventDefault();
    event?.stopPropagation();
    if(!connections.some(c => c.id === id)) return;
    try { pushUndo(); } catch(err) { console.warn('[infinite-canvas] undo snapshot failed', err); }
    connections = connections.filter(c => c.id !== id);
    if(hoveredConnectionId === id) hoveredConnectionId = '';
    syncGeneratorInputs();
    syncCanvasModelFromState();
    ensureLiveCanvasDom();
    syncLinkDomToConnections();
    render({ force: true });
    refreshGeometryAfterLayout();
    scheduleSave();
}
function outputDownloadName(url){
    const clean = (url || '').split('?')[0];
    const ext = clean.includes('.') ? clean.split('.').pop() : 'png';
    return `canvas-output-${Date.now()}.${ext || 'png'}`;
}
function isVideoUrl(url){
    const clean = (url || '').split('?')[0].toLowerCase();
    return /\.(mp4|webm|mov|m4v)$/.test(clean);
}
function mediaKindForOutputItem(item){
    const explicit = String(item?.kind || item?.mediaKind || '').toLowerCase();
    if(['image','video','audio','text','file'].includes(explicit)) return explicit;
    const url = outputUrlValue(item);
    if(isVideoUrl(url)) return 'video';
    if(isAudioUrl(url)) return 'audio';
    if(isTextUrl(url)) return 'text';
    return 'image';
}
function formatRunDuration(ms){
    const total = Math.max(0, Math.round(Number(ms || 0) / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}
function nowMs(){ return Date.now(); }
function outputUrlValue(item){
    return typeof item === 'string' ? item : item?.url || '';
}
function isMissingAssetUrl(url){
    return Boolean(url && missingAssetUrls.has(url));
}
function missingAssetHtml(url, compact=false){
    return `<div class="missing-asset ${compact ? 'compact' : ''}" title="${escapeAttr(url || '')}"><i data-lucide="image-off" class="${compact ? 'w-4 h-4' : 'w-6 h-6'}"></i><span>${langIsEn() ? 'Missing file' : '文件缺失'}</span></div>`;
}
function outputMetaFor(url, out){
    const item = (out?.images || []).find(x => outputUrlValue(x) === url);
    return item && typeof item === 'object' ? item : {};
}
function runSnapshot(node, prompt, refs=[]){
    const clone = JSON.parse(JSON.stringify(node || {}));
    delete clone.running;
    delete clone.runStatus;
    delete clone.runError;
    delete clone.inputs;
    return {
        nodeType: node?.type || '',
        node: clone,
        prompt: prompt || '',
        refs: (refs || []).map(ref => ({url:ref.url, name:ref.name || 'image'})).filter(ref => ref.url),
    };
}
function comfyRunLabel(node){
    const mode = node?.mode || 'text';
    if(mode === 'text') return tr('canvas.comfyText');
    if(mode === 'enhance') return tr('canvas.comfyEnhance');
    if(mode === 'edit') return tr('canvas.comfyEdit');
    if(mode === 'custom') return node?.comfyWorkflow || tr('canvas.comfyCustom');
    return 'ComfyUI';
}
function runTaskLabel(run){
    const node = run?.node || {};
    if(run?.taskLabel) return run.taskLabel;
    if(run?.nodeType === 'comfy') return comfyRunLabel(node);
    if(run?.nodeType === 'ltxDirector') return tr('canvas.ltxDirector');
    if(run?.nodeType === 'generator') return node.model || 'API Image';
    if(run?.nodeType === 'video') return node.model || 'Video';
    if(run?.nodeType === 'replicaAgent') return '复刻 Agent';
    if(run?.nodeType === 'batchPosterAgent') return 'Batch Poster Agent';
    if(run?.nodeType === 'nineGridAgent') return node.model || 'nano-banana-pro';
    if(run?.nodeType === 'msgen') return node.msCustomModel || node.msgenModel || 'ModelScope';
    return run?.nodeType || 'Generate';
}
function outputImageModelLabel(meta={}){
    if(meta?.model) return String(meta.model);
    if(meta?.run) return runTaskLabel(meta.run);
    return '';
}
function shortenModelLabel(label, max=24){
    const text = String(label || '').trim();
    if(!text) return '';
    if(text.length <= max) return text;
    return `${text.slice(0, Math.max(8, max - 1))}…`;
}
function formatOutputMetaPill(meta={}){
    const model = shortenModelLabel(outputImageModelLabel(meta));
    const duration = meta.runMs ? formatRunDuration(meta.runMs) : '';
    if(!model && !duration) return '';
    const title = [model, duration].filter(Boolean).join(' · ');
    const parts = [];
    if(model) parts.push(`<span class="output-meta-model">${escapeHtml(model)}</span>`);
    if(duration) parts.push(`<span class="output-meta-duration">${escapeHtml(duration)}</span>`);
    return `<span class="output-time-pill" title="${escapeAttr(title)}">${parts.join('<span class="output-meta-sep" aria-hidden="true">·</span>')}</span>`;
}
function requestMetaFromResult(result={}){
    return {
        task_id: result.task_id || result.raw?.task_id || result.raw?.data?.task_id || (Array.isArray(result.raw?.data) ? result.raw.data[0]?.task_id : '') || '',
        request_id: result.request_id || result.id || result.raw?.id || '',
        provider_id: result.provider_id || result.params?.provider_id || '',
        backend: result.backend || '',
        prompt_id: result.prompt_id || '',
        workflow_json: result.workflow_json || '',
        seed: result.seed || '',
    };
}
function runPlatformLabel(run){
    const node = run?.node || {};
    if(run?.nodeType === 'generator') return providerDisplayName(providerById(legacyImageProviderId(node.apiProvider || 'runninghub'))) || 'RunningHub';
    if(run?.nodeType === 'msgen') return 'ModelScope';
    if(run?.nodeType === 'video') return providerById(node.apiProvider || 'comfly')?.name || node.apiProvider || 'Video';
    if(run?.nodeType === 'comfy') return 'ComfyUI';
    if(run?.nodeType === 'ltxDirector') return 'ComfyUI';
    return run?.nodeType || 'Generate';
}
function comfyLabelFromWorkflow(workflow){
    const name = String(workflow || '').toLowerCase();
    if(!name) return '';
    if(name === 'z-image.json') return tr('canvas.comfyText');
    if(name === 'z-image-enhance.json' || name === 'upscale.json') return tr('canvas.comfyEnhance');
    if(name === 'flux2-klein.json') return tr('canvas.comfyEdit');
    return workflow;
}
function logTaskLabel(log){
    const req = log?.request || {};
    if(log?.platform === 'ComfyUI'){
        const byWorkflow = comfyLabelFromWorkflow(req.workflow_json || req.workflow);
        if(byWorkflow) return byWorkflow;
    }
    return log?.model || '-';
}
function addGenerationLog({run, outputs=[], runMs=0, error=''}) {
    if(!canvas) return;
    canvas.logs = canvas.logs || [];
    const entry = {
        id:uid('log'),
        createdAt:Date.now(),
        status:error ? 'failed' : 'success',
        platform:runPlatformLabel(run),
        nodeType:run?.nodeType || '',
        model:run?.taskLabel || runTaskLabel(run),
        request:run?.request || {},
        prompt:run?.prompt || '',
        outputs:(outputs || []).filter(Boolean),
        refs:run?.refs || [],
        runMs:Number(runMs || 0),
        error:error ? String(error) : '',
    };
    canvas.logs = [entry, ...canvas.logs].slice(0, 500);
}
function filteredCanvasLogs(){
    const logs = canvas?.logs || [];
    const q = logSearchQuery.trim().toLowerCase();
    return logs.filter(log => {
        if(logStatusFilter === 'ok' && log.status === 'failed') return false;
        if(logStatusFilter === 'failed' && log.status !== 'failed') return false;
        if(!q) return true;
        const req = log.request || {};
        const hay = [
            log.prompt,
            log.platform,
            log.error,
            logTaskLabel(log),
            req.task_id,
            req.taskId,
            req.request_id,
            req.requestId,
            req.backend,
            req.provider_id,
        ].filter(Boolean).join(' ').toLowerCase();
        return hay.includes(q);
    });
}
function updateLogModalCount(shown, total){
    if(!logModalCount) return;
    if(!total){
        logModalCount.textContent = langIsEn() ? '0 records' : '0 条记录';
        return;
    }
    if(shown === total){
        logModalCount.textContent = langIsEn() ? `${total} records` : `${total} 条记录`;
        return;
    }
    logModalCount.textContent = langIsEn()
        ? `${shown} of ${total} records`
        : `显示 ${shown} / ${total} 条`;
}
function renderCanvasLog(){
    const allLogs = canvas?.logs || [];
    const logs = filteredCanvasLogs();
    updateLogModalCount(logs.length, allLogs.length);
    if(!logList) return;
    logList.innerHTML = logs.length ? logs.map((log, index) => {
        const thumbs = (log.outputs || []).slice(0, 8).map(url => {
            const safe = escapeAttr(url);
            if(isMissingAssetUrl(url)) return `<div class="missing-asset compact" data-url="${safe}"><i data-lucide="image-off" class="w-4 h-4"></i></div>`;
            return isVideoUrl(url) ? `<video src="${safe}" data-url="${safe}" muted playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"></video>` : `<img src="${safe}" data-url="${safe}" alt="output">`;
        }).join('');
        const date = new Date(log.createdAt || Date.now()).toLocaleString(window.StudioI18n?.lang() === 'en' ? 'en-US' : 'zh-CN');
        const req = log.request || {};
        const taskId = req.task_id || req.taskId || req.prompt_id || req.promptId || '';
        const requestId = req.request_id || req.requestId || req.id || '';
        const backend = req.backend || req.provider_id || req.providerId || '';
        const workflow = req.workflow_json || req.workflow || '';
        const taskLabel = logTaskLabel(log);
        const idText = taskId || requestId || '';
        const backendText = workflow || backend || '';
        const subParts = [
            date,
            `${langIsEn() ? 'outputs' : '输出'} ${(log.outputs || []).length}`,
            idText ? `ID ${idText}` : '',
            backendText,
        ].filter(Boolean);
        const errorHtml = log.error ? `
                <div class="log-error-wrap">
                    <div class="log-error" data-log-error="${index}">${escapeHtml(log.error)}</div>
                    <div class="log-error-actions">
                        <button type="button" class="log-inline-btn" data-log-expand="${index}">${langIsEn() ? 'Expand' : '展开报错'}</button>
                        <button type="button" class="log-inline-btn" data-log-copy-error="${escapeAttr(log.error)}">${langIsEn() ? 'Copy error' : '复制报错'}</button>
                    </div>
                </div>` : '';
        return `<div class="log-item ${log.status === 'failed' ? 'failed' : ''}">
            <div class="log-main">
                <div class="log-meta">
                    <span class="log-chip ${log.status === 'failed' ? 'status-failed' : 'status-ok'}">${escapeHtml(log.status === 'failed' ? tr('canvas.failed') : tr('canvas.success'))}</span>
                    <span class="log-chip">${escapeHtml(log.platform || '-')}</span>
                    ${taskLabel ? `<span class="log-chip">${escapeHtml(taskLabel)}</span>` : ''}
                    <span class="log-chip">${escapeHtml(formatRunDuration(log.runMs || 0))}</span>
                </div>
                <div class="log-subline">${subParts.map(part => `<span title="${escapeAttr(part)}">${escapeHtml(part)}</span>`).join('')}</div>
                ${errorHtml}
                <div class="log-prompt" title="${escapeAttr(log.prompt || tr('canvas.noPromptMeta'))}" data-prompt="${escapeAttr(log.prompt || '')}">${escapeHtml(log.prompt || tr('canvas.noPromptMeta'))}</div>
            </div>
            <div class="log-thumbs">${thumbs}</div>
        </div>`;
    }).join('') : `<div class="log-empty">${allLogs.length ? (langIsEn() ? 'No logs match your filters' : '没有符合筛选条件的记录') : tr('canvas.noLogs')}</div>`;
    logList.querySelectorAll('[data-url]').forEach(el => {
        el.onclick = e => {
            e.stopPropagation();
            openOutputLightbox(el.dataset.url, null);
        };
    });
    logList.querySelectorAll('[data-prompt]').forEach(el => {
        el.onclick = e => {
            e.stopPropagation();
            const text = el.dataset.prompt || '';
            if(text) navigator.clipboard?.writeText(text).catch(() => {});
            const oldText = el.textContent;
            el.textContent = tr('canvas.copied');
            el.classList.add('copied');
            setTimeout(() => {
                el.textContent = oldText;
                el.classList.remove('copied');
            }, 900);
        };
    });
    logList.querySelectorAll('[data-log-expand]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const idx = btn.getAttribute('data-log-expand');
            const block = logList.querySelector(`[data-log-error="${idx}"]`);
            if(!block) return;
            const expanded = block.classList.toggle('is-expanded');
            btn.textContent = expanded
                ? (langIsEn() ? 'Collapse' : '收起报错')
                : (langIsEn() ? 'Expand' : '展开报错');
        };
    });
    logList.querySelectorAll('[data-log-copy-error]').forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const text = btn.getAttribute('data-log-copy-error') || '';
            if(text) navigator.clipboard?.writeText(text).catch(() => {});
            const oldText = btn.textContent;
            btn.textContent = langIsEn() ? 'Copied' : '已复制';
            setTimeout(() => { btn.textContent = oldText; }, 900);
        };
    });
    refreshIcons();
}
function syncLogModalHistoryTabs(){
    logModal?.querySelectorAll('.canvas-history-tabs [data-history-tab]').forEach(btn => {
        const active = btn.getAttribute('data-history-tab') === 'logs';
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
}
function openCanvasLog(){
    if(!ensureCanvas()) return;
    closeCanvasGenerationBrowser();
    logClearBar?.setAttribute('hidden', '');
    renderCanvasLog();
    syncStudioFilterChips(logModal, 'data-log-filter', logStatusFilter);
    syncLogModalHistoryTabs();
    logModal.classList.add('open');
    refreshIcons();
}
function closeCanvasLog(){
    logModal.classList.remove('open');
    logClearBar?.setAttribute('hidden', '');
}
function bindStudioModalControls(){
    if(logSearchInput){
        on(logSearchInput, 'input', () => {
            logSearchQuery = String(logSearchInput.value || '');
            renderCanvasLog();
        });
    }
    logModal?.querySelectorAll('[data-log-filter]').forEach(btn => {
        bindClick(btn, () => {
            logStatusFilter = btn.getAttribute('data-log-filter') || 'all';
            syncStudioFilterChips(logModal, 'data-log-filter', logStatusFilter);
            renderCanvasLog();
        });
    });
    logModal?.querySelectorAll('.canvas-history-tabs [data-history-tab]').forEach(btn => {
        bindClick(btn, () => {
            const tab = btn.getAttribute('data-history-tab') || 'logs';
            openCanvasHistoryHub(tab);
        });
    });
    bindClick(logClearBtn, () => {
        if(!canvas?.logs?.length) return;
        logClearBar?.removeAttribute('hidden');
    });
    bindClick(logClearCancel, () => logClearBar?.setAttribute('hidden', ''));
    bindClick(logClearConfirm, () => {
        if(canvas) canvas.logs = [];
        logClearBar?.setAttribute('hidden', '');
        renderCanvasLog();
        setStatus(langIsEn() ? 'Generation logs cleared' : '已清空生成日志');
    });

    if(workflowTemplateSearchInput){
        on(workflowTemplateSearchInput, 'input', () => {
            workflowTemplateSearchQuery = String(workflowTemplateSearchInput.value || '');
            renderWorkflowTemplateLists();
        });
    }
    workflowTemplateModal?.querySelectorAll('[data-wf-filter]').forEach(btn => {
        bindClick(btn, () => {
            workflowTemplateKindFilter = btn.getAttribute('data-wf-filter') || 'all';
            syncStudioFilterChips(workflowTemplateModal, 'data-wf-filter', workflowTemplateKindFilter);
            renderWorkflowTemplateLists();
        });
    });
    bindClick(workflowTemplateSaveCancel, () => closeWorkflowTemplateSaveForm());
    bindClick(workflowTemplateSaveConfirm, () => { void confirmWorkflowTemplateSave(); });
    bindClick(workflowTemplateDeleteCancel, () => hideWorkflowTemplateDeleteConfirm());
    bindClick(workflowTemplateDeleteConfirm, () => {
        if(pendingDeleteTemplateId) void deleteWorkflowTemplate(pendingDeleteTemplateId);
    });
    if(workflowTemplateTitleInput){
        on(workflowTemplateTitleInput, 'keydown', e => {
            if(e.key === 'Enter') { e.preventDefault(); void confirmWorkflowTemplateSave(); }
            if(e.key === 'Escape') closeWorkflowTemplateSaveForm();
        });
    }
}
function makePending(id, run, task={}){
    return {id, startedAt:nowMs(), run, ...task};
}
function agentPendingCount(nodeId){
    if(!nodeId) return 0;
    return nodes.filter(n => n.type === 'output').reduce((sum, out) => {
        return sum + (out._pending || []).filter(p => p.run?.node?.id === nodeId).length;
    }, 0);
}
function clearAgentOutputPending(nodeId){
    if(!nodeId) return;
    nodes.filter(n => n.type === 'output').forEach(out => {
        out._pending = (out._pending || []).filter(p => p.run?.node?.id !== nodeId);
    });
}
function pendingOutputIdsForAgent(nodeId){
    if(!nodeId) return [];
    return nodes
        .filter(n => n.type === 'output' && (n._pending || []).some(p => p.run?.node?.id === nodeId))
        .map(n => n.id);
}
function reconcileAgentRunStateFromPending(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    const pending = agentPendingCount(nodeId);
    node.running = pending > 0;
    if(pending > 0){
        node.runStatus = 'running';
        return;
    }
    delete node._batchProgress;
    if(node.runStatus === 'running') node.runStatus = 'idle';
}
function isOutputPendingActive(out, pendingId){
    return Boolean(pendingId) && (out?._pending || []).some(p => p.id === pendingId);
}
function agentStopAllBtnHtml(nodeId){
    const pendingN = agentPendingCount(nodeId);
    if(pendingN <= 0) return '';
    const label = langIsEn() ? 'Stop' : '停止';
    return `<button class="gen-stop-all-btn" type="button" data-stop-all="${escapeAttr(nodeId)}" title="${escapeAttr(langIsEn() ? `Stop local queue (${pendingN}); in-flight server jobs are cancelled when possible` : `停止本地队列（${pendingN}）；进行中的服务端任务会尽量取消`)}"><i data-lucide="square" class="w-3.5 h-3.5"></i><span>${escapeHtml(label)}</span></button>`;
}
function agentGenRunActionsHtml(nodeId, primaryBtnHtml){
    const stopHtml = agentStopAllBtnHtml(nodeId);
    if(!stopHtml) return primaryBtnHtml;
    return `<div class="gen-run-actions">${primaryBtnHtml}${stopHtml}</div>`;
}
function collectAgentPendingTaskIds(nodeId){
    if(!nodeId) return [];
    const ids = [];
    nodes.filter(n => n.type === 'output').forEach(out => {
        (out._pending || []).forEach(p => {
            if(p?.run?.node?.id !== nodeId) return;
            if(p.canvasTaskId) ids.push({
                taskId:String(p.canvasTaskId),
                type:String(p.canvasTaskType || ''),
            });
        });
    });
    return ids;
}
function cancelAgentServerTasks(taskRefs){
    (taskRefs || []).forEach(({taskId, type}) => {
        if(!taskId) return;
        let url = '';
        if(type === 'replica-agent') url = `/api/canvas/replica-agent-tasks/${encodeURIComponent(taskId)}/cancel`;
        else if(type === 'image-repair-agent') url = `/api/canvas/image-repair-agent-tasks/${encodeURIComponent(taskId)}/cancel`;
        if(!url) return;
        // fire-and-forget：UI 已清队列，取消失败不阻塞
        void apiFetch(url, {method:'POST'}).catch(() => {});
    });
}
function stopAgentGeneration(nodeId){
    if(!nodeId) return;
    const node = nodes.find(n => n.id === nodeId);
    const pendingN = agentPendingCount(nodeId);
    const activeBatch = node?.type === 'batchPosterAgent' ? activeBatchPosterRunCount(node) : 0;
    if(pendingN <= 0 && activeBatch <= 0) return;
    const taskRefs = collectAgentPendingTaskIds(nodeId);
    if(node) node._agentStopRequested = true;
    cancelAgentServerTasks(taskRefs);
    const outIds = pendingOutputIdsForAgent(nodeId);
    clearAgentOutputPending(nodeId);
    if(node?.type === 'batchPosterAgent'){
        node._batchPosterRuns = null;
        syncBatchPosterNodeRunState(node);
    } else {
        reconcileAgentRunStateFromPending(nodeId);
    }
    if(node){
        node.running = false;
        if(node.runStatus === 'running' || node.runStatus === 'queued') node.runStatus = 'idle';
    }
    refreshNodes([nodeId, ...outIds]);
    syncLinkFlowForNodes([nodeId, ...outIds]);
    refreshOutputTimer();
    scheduleSave();
}
function agentPendingRunState(nodeId, defaultLabel, activeLabel){
    const node = nodes.find(n => n.id === nodeId);
    const pendingN = agentPendingCount(nodeId);
    const batch = node?._batchProgress ? String(node._batchProgress) : '';
    const runningCls = pendingN > 0 || Boolean(node?.running) ? 'running' : '';
    let label = defaultLabel;
    if(batch){
        label = langIsEn() ? `Generating ${batch}…` : `生成中 ${batch}…`;
    } else if(pendingN > 0){
        const base = activeLabel || (langIsEn() ? 'Generating' : '生成中');
        label = langIsEn() ? `${base} (${pendingN})…` : `${base} (${pendingN})…`;
    } else if(node?.running){
        label = activeLabel || (langIsEn() ? 'Generating…' : '生成中…');
    }
    return {runningCls, label, pendingN};
}
function syncAppendableNodeRunState(node){
    if(!node) return;
    syncAgentRunStatusAfterTask(node, {});
}
function reconcileBatchPosterAgentRunState(node){
    syncBatchPosterNodeRunState(node);
}
function syncAgentRunStatusAfterTask(gen, {completed=false, failed=false, error=''}={}){
    if(!gen) return;
    const pending = agentPendingCount(gen.id);
    gen.running = pending > 0;
    if(pending > 0){
        gen.runStatus = 'running';
        return;
    }
    if(failed){
        gen.runStatus = 'failed';
        if(error) gen.runError = error;
        return;
    }
    if(completed){
        gen.runStatus = 'done';
        gen.runError = '';
        return;
    }
    // 取消 / 对账：无进行中任务时清掉卡住的「运行中」
    if(gen.runStatus === 'running' || gen.runStatus === 'queued'){
        gen.runStatus = 'idle';
    }
}
/** 重开画布 / 远端同步：JS 轮询已断，清掉不可恢复的 pending 与卡住的运行徽章 */
function resetTransientNodeRunState(){
    const resumable = new Set(['online-image', 'replica-agent', 'image-repair-agent']);
    nodes.filter(n => n.type === 'output').forEach(out => {
        out._pending = (out._pending || []).filter(p =>
            Boolean(p?.canvasTaskId) && resumable.has(String(p.canvasTaskType || ''))
        );
    });
    nodes.forEach(n => {
        // Batch Poster 内存 run 表在重开后不可恢复，必须清掉以免假 running
        if(n._batchPosterRuns) n._batchPosterRuns = null;
        delete n._batchPosterTitlePrefetchBusy;
        delete n.cellEditing;
        delete n._agentStopRequested;
        const pending = agentPendingCount(n.id);
        if(pending > 0){
            n.running = true;
            n.runStatus = 'running';
            return;
        }
        n.running = false;
        delete n._batchProgress;
        delete n.batchProgress;
        if(n.runStatus === 'running' || n.runStatus === 'queued'){
            n.runStatus = 'idle';
        }
    });
}
function agentCountStepperHtml(node, inputClass='gen-count-input', stepAttr='data-step'){
    const count = Math.max(1, Math.min(8, Number(node.count || 1)));
    return `<div class="gen-count-row">
        <div class="gen-stepper">
            <button class="gen-step-btn" ${stepAttr}="-1" type="button" title="${tr('canvas.decrease')}" aria-label="${tr('canvas.decreaseCount')}"><i data-lucide="chevron-left" class="w-3.5 h-3.5"></i></button>
            <input class="${inputClass}" type="text" inputmode="numeric" pattern="[0-9]*" value="${count}">
            <button class="gen-step-btn" ${stepAttr}="1" type="button" title="${tr('canvas.increase')}" aria-label="${tr('canvas.increaseCount')}"><i data-lucide="chevron-right" class="w-3.5 h-3.5"></i></button>
        </div>
    </div>`;
}
function bindAgentCountControls(wrap, node, opts={}){
    if(!wrap || !node) return;
    const inputSelector = opts.inputSelector || '.gen-count-input';
    const stepAttr = opts.stepAttr || 'data-step';
    const countInput = wrap.querySelector(inputSelector);
    if(!countInput) return;
    countInput.onmousedown = e => e.stopPropagation();
    countInput.onclick = e => e.stopPropagation();
    countInput.oninput = e => {
        const value = Math.max(1, Math.min(8, Number(e.target.value) || 1));
        node.count = value;
        scheduleSave();
    };
    countInput.onblur = e => { e.target.value = String(Math.max(1, Math.min(8, Number(node.count || 1)))); };
    wrap.querySelectorAll(`[${stepAttr}]`).forEach(btn => {
        btn.onclick = e => {
            e.stopPropagation();
            const step = Number(btn.getAttribute(stepAttr) || 0);
            const next = Math.max(1, Math.min(8, Number(node.count || 1) + step));
            node.count = next;
            countInput.value = String(next);
            scheduleSave();
        };
    });
}
function mergeGeneratedOutputs(node, outputs, append=false){
    if(!node) return;
    const keepGeneratedMedia = ['rh','ltxDirector','video'].includes(node.type);
    const clean = (outputs || []).map(item => {
        const url = outputUrlValue(item);
        if(!url) return null;
        const kind = node.type === 'video'
            ? 'video'
            : ['rh','ltxDirector'].includes(node.type) && isVideoUrl(url)
                ? 'video'
                : mediaKindForOutputItem(item);
        if(!keepGeneratedMedia && kind !== 'image') return null;
        return kind === 'image' ? url : {url, kind};
    }).filter(Boolean);
    if(!append){
        node.generatedOutputs = clean;
        return;
    }
    const seen = new Set((node.generatedOutputs || []).map(outputUrlValue).filter(Boolean));
    node.generatedOutputs = [...(node.generatedOutputs || []), ...clean.filter(item => {
        const url = outputUrlValue(item);
        return url && !seen.has(url) && seen.add(url);
    })];
}
function pendingById(out, id){
    return (out?._pending || []).find(p => p.id === id) || null;
}
function collectRunMetas(out, ids){
    return (ids || []).map(id => pendingById(out, id)).filter(Boolean).map(p => ({
        runMs: nowMs() - Number(p.startedAt || nowMs()),
        run: p.run || {},
    }));
}
function collectRunMeta(out, id){
    return collectRunMetas(out, [id])[0] || {runMs:0, run:{}};
}
function findOutputByPendingId(pendingId){
    return nodes.find(n => n.type === 'output' && (n._pending || []).some(p => p.id === pendingId));
}
function findPendingTask(taskId){
    for(const out of nodes.filter(n => n.type === 'output')){
        const pending = (out._pending || []).find(p => p.canvasTaskId === taskId);
        if(pending) return {out, pending};
    }
    return null;
}
async function createCanvasImageTask(payload){
    const res = await apiFetch('/api/canvas-image-tasks', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
    });
    if(!res.ok) throw new Error(await responseErrorMessage(res, tr('canvas.generationFailed')));
    return res.json();
}
function sleep(ms){ return new Promise(resolve => setTimeout(resolve, ms)); }
async function pollReplicaAgentTask(taskId){
    if(!taskId) return 'failed';
    if(activeCanvasTaskPolls.has(taskId)) return 'running';
    activeCanvasTaskPolls.add(taskId);
    try {
        while(true){
            const found = findPendingTask(taskId);
            if(!found) return 'missing';
            const res = await apiFetch(`/api/canvas/replica-agent-tasks/${encodeURIComponent(taskId)}`);
            if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Replica Agent poll failed' : '复刻 Agent 任务查询失败'));
            const data = await res.json();
            if(found.pending && data.stage_label){
                found.pending.stageLabel = data.stage_label;
                refreshOutputTimer();
            }
            if(data.status === 'completed'){
                completeReplicaAgentTask(taskId, data);
                return 'completed';
            }
            if(data.status === 'failed' || data.status === 'cancelled'){
                failCanvasImageTask(taskId, data.error || (data.status === 'cancelled'
                    ? (langIsEn() ? 'Cancelled' : '已取消')
                    : (langIsEn() ? 'Replica Agent failed' : '复刻 Agent 失败')));
                return 'failed';
            }
            await sleep(2000);
        }
    } catch(err) {
        failCanvasImageTask(taskId, err.message || String(err));
        return 'failed';
    } finally {
        activeCanvasTaskPolls.delete(taskId);
    }
}
function completeReplicaAgentTask(taskId, data){
    const found = findPendingTask(taskId);
    if(!found) return;
    const {out, pending} = found;
    const meta = {
        runMs: nowMs() - Number(pending.startedAt || nowMs()),
        run: pending.run || {},
    };
    meta.run.request = {
        replica_task_id: taskId,
        reverse_prompt: data.reverse_prompt || '',
        washed_image_url: data.washed_image_url || '',
    };
    const images = data.final_image_url ? [data.final_image_url] : [];
    out._pending = (out._pending || []).filter(p => p.id !== pending.id);
    appendOutputImages(out, images, meta.run?.refs?.[0], [meta]);
    const gen = nodes.find(n => n.id === meta.run?.node?.id);
    if(gen){
        mergeGeneratedOutputs(gen, images, Boolean(pending.appendGenerated));
        syncAgentRunStatusAfterTask(gen, {completed:true});
    }
    addGenerationLog({run:meta.run, outputs:images, runMs:meta.runMs || 0});
    refreshRunNodes(gen, out);
    scheduleSave();
}
function completeImageRepairAgentTask(taskId, data){
    const found = findPendingTask(taskId);
    if(!found) return;
    const {out, pending} = found;
    const meta = {
        runMs: nowMs() - Number(pending.startedAt || nowMs()),
        run: pending.run || {},
    };
    meta.run.request = {
        repair_task_id: taskId,
        reversed_prompt: data.reversed_prompt || '',
        lineart_image_url: data.lineart_image_url || '',
        blur_image_url: data.blur_image_url || '',
    };
    const images = data.final_image_url ? [data.final_image_url] : [];
    out._pending = (out._pending || []).filter(p => p.id !== pending.id);
    appendOutputImages(out, images, meta.run?.refs?.[0], [meta]);
    const gen = nodes.find(n => n.id === meta.run?.node?.id);
    if(gen){
        mergeGeneratedOutputs(gen, images, Boolean(pending.appendGenerated));
        syncAgentRunStatusAfterTask(gen, {completed:true});
    }
    addGenerationLog({run:meta.run, outputs:images, runMs:meta.runMs || 0});
    refreshRunNodes(gen, out);
    scheduleSave();
}
async function pollImageRepairAgentTask(taskId){
    if(!taskId) return 'failed';
    if(activeCanvasTaskPolls.has(taskId)) return 'running';
    activeCanvasTaskPolls.add(taskId);
    try {
        while(true){
            const found = findPendingTask(taskId);
            if(!found) return 'missing';
            const res = await apiFetch(`/api/canvas/image-repair-agent-tasks/${encodeURIComponent(taskId)}`);
            if(!res.ok) throw new Error(await responseErrorMessage(res, langIsEn() ? 'Repair Agent poll failed' : '修图 Agent 任务查询失败'));
            const data = await res.json();
            if(found.pending && data.stage_label){
                found.pending.stageLabel = data.stage_label;
                refreshOutputTimer();
            }
            if(data.status === 'completed'){
                completeImageRepairAgentTask(taskId, data);
                return 'completed';
            }
            if(data.status === 'failed' || data.status === 'cancelled'){
                failCanvasImageTask(taskId, data.error || (data.status === 'cancelled'
                    ? (langIsEn() ? 'Cancelled' : '已取消')
                    : (langIsEn() ? 'Repair Agent failed' : '修图 Agent 失败')));
                return 'failed';
            }
            await sleep(2000);
        }
    } catch(err) {
        failCanvasImageTask(taskId, err.message || String(err));
        return 'failed';
    } finally {
        activeCanvasTaskPolls.delete(taskId);
    }
}
async function pollCanvasImageTask(taskId){
    if(!taskId) return 'failed';
    if(activeCanvasTaskPolls.has(taskId)) return 'running';
    activeCanvasTaskPolls.add(taskId);
    try {
        while(true){
            const found = findPendingTask(taskId);
            if(!found) return 'missing';
            const res = await apiFetch(`/api/canvas-image-tasks/${encodeURIComponent(taskId)}`);
            if(!res.ok) throw new Error(await responseErrorMessage(res, tr('canvas.generationFailed')));
            const data = await res.json();
            if(data.status === 'succeeded'){
                completeCanvasImageTask(taskId, data.result || {});
                return 'succeeded';
            }
            if(data.status === 'failed'){
                failCanvasImageTask(taskId, data.error || tr('canvas.generationFailed'));
                return 'failed';
            }
            await sleep(1800);
        }
    } catch(err) {
        failCanvasImageTask(taskId, err.message || String(err));
        return 'failed';
    } finally {
        activeCanvasTaskPolls.delete(taskId);
    }
}
function completeCanvasImageTask(taskId, result){
    const found = findPendingTask(taskId);
    if(!found) return;
    const {out, pending} = found;
    const meta = {
        runMs: nowMs() - Number(pending.startedAt || nowMs()),
        run: pending.run || {},
    };
    meta.run.request = requestMetaFromResult(result);
    const images = result.images || [];
    out._pending = (out._pending || []).filter(p => p.id !== pending.id);
    appendOutputImages(out, images, meta.run?.refs?.[0], [meta]);
    const gen = nodes.find(n => n.id === meta.run?.node?.id);
    if(gen){
        mergeGeneratedOutputs(gen, images, Boolean(pending.appendGenerated));
        const stillPending = agentPendingCount(gen.id);
        gen.running = stillPending > 0;
        if(stillPending > 0) gen.runStatus = 'running';
        else {
            gen.runStatus = 'done';
            gen.runError = '';
        }
    }
    addGenerationLog({run:meta.run, outputs:images, runMs:meta.runMs || 0});
    refreshRunNodes(gen, out);
    scheduleSave();
}
function failCanvasImageTask(taskId, message){
    const found = findPendingTask(taskId);
    if(!found) return;
    const {out, pending} = found;
    const run = pending.run || {};
    const runMs = nowMs() - Number(pending.startedAt || nowMs());
    out._pending = (out._pending || []).filter(p => p.id !== pending.id);
    const gen = nodes.find(n => n.id === run?.node?.id);
    if(gen){
        syncAgentRunStatusAfterTask(gen, {failed:agentPendingCount(gen.id) === 0, error:message || tr('canvas.generationFailed')});
    }
    addGenerationLog({run, outputs:[], runMs, error:message || tr('canvas.generationFailed')});
    refreshRunNodes(gen, out);
    scheduleSave();
}
function resumeCanvasImageTasks(){
    nodes.filter(n => n.type === 'output').forEach(out => {
        (out._pending || []).forEach(p => {
            if(p.canvasTaskType === 'online-image' && p.canvasTaskId) pollCanvasImageTask(p.canvasTaskId);
            if(p.canvasTaskType === 'replica-agent' && p.canvasTaskId) pollReplicaAgentTask(p.canvasTaskId);
            if(p.canvasTaskType === 'image-repair-agent' && p.canvasTaskId) pollImageRepairAgentTask(p.canvasTaskId);
        });
    });
}
function outputMetaPrompt(meta={}){
    const direct = String(meta?.prompt || '').trim();
    if(direct) return direct;
    return String(meta?.run?.prompt || '').trim();
}
function formatOutputPromptCaption(prompt, opts={}){
    const text = String(prompt || '').trim();
    if(!text) return '';
    const maxLen = Number(opts.maxLen || 140);
    const short = text.length > maxLen ? `${text.slice(0, Math.max(24, maxLen - 1))}…` : text;
    return `<p class="output-media-prompt" title="${escapeAttr(text)}">${escapeHtml(short)}</p>`;
}
function wrapOutputMediaCard(innerHtml, meta, opts={}){
    const prompt = formatOutputPromptCaption(outputMetaPrompt(meta), {maxLen:opts.promptMaxLen});
    if(!prompt && !opts.forceCard) return innerHtml;
    const grid = opts.grid || null;
    const cardStyle = grid
        ? ` style="grid-row:${Number(grid.row || 0) + 1};grid-column:${Number(grid.col || 0) + 1}"`
        : '';
    const cardClass = `output-media-card${opts.useGridLayout ? ' output-media-card--grid' : ''}${prompt ? ' has-prompt' : ''}`;
    return `<div class="${cardClass}"${cardStyle}>${innerHtml}${prompt}</div>`;
}
function renderOutputMedia(item, useGridLayout=false, renderOpts={}){
    const url = outputUrlValue(item);
    const safe = escapeAttr(url);
    const meta = item && typeof item === 'object' ? item : {};
    const kind = mediaKindForOutputItem(item);
    const grid = useGridLayout ? (meta.grid || null) : null;
    const wrapStyle = grid
        ? ` style="aspect-ratio:${Math.max(1, Number(grid.w || 1))}/${Math.max(1, Number(grid.h || 1))}"`
        : '';
    const timePill = formatOutputMetaPill(meta);
    const cardOpts = {useGridLayout, grid, promptMaxLen:useGridLayout ? 96 : 140, forceCard:Boolean(outputMetaPrompt(meta))};
    const favBtn = renderOpts.showFavorite && kind === 'image' ? outputFavoriteBtnHtml(url) : '';
    if(isMissingAssetUrl(url)){
        const inner = `<div class="output-img-wrap" data-output-url="${safe}" data-missing-url="${safe}"${wrapStyle}>${missingAssetHtml(url, true)}${timePill}<button class="output-del" title="${tr('common.delete')}">×</button></div>`;
        return wrapOutputMediaCard(inner, meta, cardOpts);
    }
    if(kind === 'video'){
        const inner = `<div class="output-img-wrap" data-output-url="${safe}"${wrapStyle}><video src="${safe}" data-url="${safe}" preload="metadata" muted playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"></video>${timePill}<div class="output-video-badge"><i data-lucide="play" class="w-3 h-3"></i>VIDEO</div><button class="output-del" title="${tr('common.delete')}">×</button></div>`;
        return wrapOutputMediaCard(inner, meta, cardOpts);
    }
    if(kind === 'audio'){
        const inner = `<div class="output-img-wrap output-audio-wrap" data-output-url="${safe}"${wrapStyle}><div class="output-audio-card"><i data-lucide="file-audio" class="w-7 h-7"></i><span>${escapeHtml(outputImageName(url))}</span><audio src="${safe}" data-url="${safe}" controls preload="metadata"></audio></div>${timePill}<button class="output-del" title="${tr('common.delete')}">×</button></div>`;
        return wrapOutputMediaCard(inner, meta, cardOpts);
    }
    if(kind === 'text' || kind === 'file'){
        const icon = kind === 'text' ? 'file-text' : 'file';
        const label = kind === 'text' ? 'TEXT' : 'FILE';
        const inner = `<div class="output-img-wrap output-file-wrap" data-output-url="${safe}"${wrapStyle}><div class="output-file-card"><i data-lucide="${icon}" class="w-7 h-7"></i><span>${escapeHtml(meta.name || outputImageName(url))}</span><small>${label}</small></div>${timePill}<button class="output-del" title="${tr('common.delete')}">×</button></div>`;
        return wrapOutputMediaCard(inner, meta, cardOpts);
    }
    const inner = `<div class="output-img-wrap" data-output-url="${safe}"${wrapStyle}><img src="${safe}" data-url="${safe}" alt="generated output">${favBtn}${timePill}<button class="output-del" title="${tr('common.delete')}">×</button></div>`;
    return wrapOutputMediaCard(inner, meta, cardOpts);
}
function outputGridLayout(node){
    const images = node?.images || [];
    if(!images.length || node?._pending?.length) return null;
    const layout = node.outputLayout;
    if(!layout || layout.type !== 'grid-split' || !layout.groupId) return null;
    const allMatch = images.every(item => item && typeof item === 'object' && item.grid?.groupId === layout.groupId);
    return allMatch ? layout : null;
}
function chunkOutputImagesForRender(images){
    const chunks = [];
    let gridChunk = null;
    let itemChunk = null;
    (images || []).forEach(item => {
        const grid = item?.grid;
        const groupId = grid?.groupId;
        if(groupId && grid?.type === 'grid-split'){
            itemChunk = null;
            if(gridChunk && gridChunk.groupId === groupId){
                gridChunk.items.push(item);
                return;
            }
            gridChunk = {type:'grid', groupId, cols:grid.cols || 3, items:[item]};
            chunks.push(gridChunk);
            return;
        }
        gridChunk = null;
        if(!itemChunk){
            itemChunk = {type:'items', items:[item]};
            chunks.push(itemChunk);
        } else {
            itemChunk.items.push(item);
        }
    });
    return chunks;
}
function renderOutputGrid(node, pendingHtml=''){
    const chunks = chunkOutputImagesForRender(node.images);
    const hasGridSplit = chunks.some(chunk => chunk.type === 'grid');
    if(!hasGridSplit){
        const itemsHtml = (node.images || []).map(item => renderOutputMedia(item, false, { showFavorite: true })).join('');
        return `<div class="output-grid-stack"><div class="output-grid">${itemsHtml}${pendingHtml}</div></div>`;
    }
    let pendingAttached = false;
    let gridGroupIndex = 0;
    let seenGridGroup = false;
    const body = chunks.map((chunk, idx) => {
        if(chunk.type === 'grid'){
            gridGroupIndex += 1;
            const divider = seenGridGroup ? '<div class="output-grid-group-divider" aria-hidden="true"></div>' : '';
            seenGridGroup = true;
            const cols = Math.max(1, Number(chunk.cols || 3));
            const firstMeta = chunk.items[0] && typeof chunk.items[0] === 'object' ? chunk.items[0] : {};
            const groupModel = shortenModelLabel(firstMeta.model || outputImageModelLabel(firstMeta));
            const groupLabel = langIsEn() ? `Nine-grid set ${gridGroupIndex}` : `第 ${gridGroupIndex} 组九宫格`;
            const groupHead = `<div class="output-grid-group-head"><span class="output-grid-group-label">${escapeHtml(groupLabel)}</span>${groupModel ? `<span class="output-grid-group-model">${escapeHtml(groupModel)}</span>` : ''}</div>`;
            return `${divider}<section class="output-grid-group">${groupHead}<div class="output-grid grid-layout" style="--grid-cols:${cols}">${chunk.items.map(item => renderOutputMedia(item, true, { showFavorite: true })).join('')}</div></section>`;
        }
        const isLastItems = !chunks.slice(idx + 1).some(c => c.type === 'items');
        const tail = isLastItems && pendingHtml ? pendingHtml : '';
        if(tail) pendingAttached = true;
        const chunkDivider = seenGridGroup && idx > 0 ? '<div class="output-grid-group-divider" aria-hidden="true"></div>' : '';
        return `${chunkDivider}<div class="output-grid">${chunk.items.map(item => renderOutputMedia(item, false, { showFavorite: true })).join('')}${tail}</div>`;
    }).join('');
    const pendingBlock = !pendingAttached && pendingHtml ? `<div class="output-grid">${pendingHtml}</div>` : '';
    return `<div class="output-grid-stack">${body || '<div class="output-grid"></div>'}${pendingBlock}</div>`;
}
function outputImageName(url){
    const clean = (url || '').split('?')[0];
    const name = clean.split('/').filter(Boolean).pop();
    return name ? decodeURIComponent(name) : 'output image';
}
function setOutputDragPreview(event, img){
    if(!event.dataTransfer || !img) return;
    const rect = img.getBoundingClientRect();
    const maxW = 172;
    const maxH = 172;
    const scale = Math.min(maxW / Math.max(rect.width, 1), maxH / Math.max(rect.height, 1), 1);
    const w = Math.max(76, Math.round(rect.width * scale));
    const h = Math.max(76, Math.round(rect.height * scale));
    const wrap = document.createElement('div');
    wrap.className = 'output-drag-preview';
    wrap.style.width = `${w}px`;
    wrap.style.height = `${h}px`;
    const clone = img.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.width = '100%';
    clone.style.height = '100%';
    clone.style.objectFit = 'contain';
    wrap.appendChild(clone);
    document.body.appendChild(wrap);
    event.dataTransfer.setDragImage(wrap, Math.round(w / 2), Math.round(h / 2));
    requestAnimationFrame(() => requestAnimationFrame(() => wrap.remove()));
}
function setCanvasOutputDragActive(active){
    canvasRoot?.classList.toggle('canvas-output-drag', active);
    if(!active){
        dropOverlay?.classList.remove('output-copy-drag');
        canvasRoot?.classList.remove('canvas-output-drag-armed');
        outputDragSession = null;
    }
}
const OUTPUT_DRAG_COMMIT_PX = 52;
const OUTPUT_DRAG_LEAVE_MARGIN = 14;
const OUTPUT_DRAG_PROMPT_MIME = 'application/x-canvas-output-prompt';
let outputDragSession = null;
function beginOutputDragSession(event, img, url, prompt=''){
    outputDragSession = {
        url: String(url || ''),
        prompt: String(prompt || '').trim(),
        startX: event.clientX,
        startY: event.clientY,
        sourceEl: img?.closest?.('.node') || null,
        armed: false,
    };
    syncOutputDragArmed(event);
}
function outputDragPointerDistance(event){
    if(!outputDragSession) return 0;
    const dx = event.clientX - outputDragSession.startX;
    const dy = event.clientY - outputDragSession.startY;
    return Math.hypot(dx, dy);
}
function outputDragLeftSource(event){
    const el = outputDragSession?.sourceEl;
    if(!el) return true;
    const rect = el.getBoundingClientRect();
    const m = OUTPUT_DRAG_LEAVE_MARGIN;
    return event.clientX < rect.left - m
        || event.clientX > rect.right + m
        || event.clientY < rect.top - m
        || event.clientY > rect.bottom + m;
}
function shouldCommitOutputDrag(event){
    if(!outputDragSession) return false;
    return outputDragPointerDistance(event) >= OUTPUT_DRAG_COMMIT_PX && outputDragLeftSource(event);
}
function syncOutputDragArmed(event){
    if(!outputDragSession) return false;
    const armed = shouldCommitOutputDrag(event);
    if(outputDragSession.armed !== armed){
        outputDragSession.armed = armed;
        canvasRoot?.classList.toggle('canvas-output-drag-armed', armed);
        if(dropOverlay){
            if(armed){
                dropOverlay.textContent = langIsEn() ? 'Release to copy to canvas' : '松手复制到画布';
            } else if(dropOverlay.dataset.defaultHint){
                dropOverlay.textContent = dropOverlay.dataset.defaultHint;
            }
        }
    }
    return armed;
}
function endOutputDragSession(){
    outputDragSession = null;
    canvasRoot?.classList.remove('canvas-output-drag-armed');
    if(dropOverlay?.dataset.defaultHint) dropOverlay.textContent = dropOverlay.dataset.defaultHint;
}
function isActiveOutputImageDrag(dataTransfer){
    return hasOutputImageDrag(dataTransfer) || Boolean(outputDragSession?.url);
}
function resolveOutputDragUrl(dataTransfer){
    const direct = String(dataTransfer?.getData?.('application/x-canvas-output-image') || '').trim();
    if(direct && direct !== 'undefined') return direct;
    return String(outputDragSession?.url || '').trim();
}
function resolveOutputDragPrompt(dataTransfer){
    const direct = String(dataTransfer?.getData?.(OUTPUT_DRAG_PROMPT_MIME) || '').trim();
    if(direct) return direct;
    return String(outputDragSession?.prompt || '').trim();
}
function resolveOutputImagePrompt(url, sourceOut=null){
    const clean = String(url || '').trim();
    if(!clean) return '';
    if(sourceOut){
        const prompt = outputMetaPrompt(outputMetaFor(clean, sourceOut));
        if(prompt) return prompt;
    }
    for(const n of nodes){
        if(n.type !== 'output' && n.type !== 'frameStack') continue;
        const prompt = outputMetaPrompt(outputMetaFor(clean, n));
        if(prompt) return prompt;
    }
    return '';
}
function createPromptFromOutputInGroup(group, point, promptText){
    if(!group || group.type !== 'promptGroup') return null;
    const gr = nodeRect(group);
    const pad = GROUP_DROP_SNAP_PADDING;
    const nx = Math.max(gr.x + pad, Math.min(point.x - 120, gr.x + gr.w - 260));
    const ny = Math.max(gr.y + groupPanelHeadInset(group), Math.min(point.y - 40, gr.y + gr.h - 140));
    const child = addNode({
        id:uid('prompt'),
        type:'prompt',
        x:nx,
        y:ny,
        text:String(promptText || '').trim(),
    });
    group.items = group.items || [];
    if(!group.items.includes(child.id)){
        group.items.push(child.id);
        syncPromptGroupDownstreamLoops(group);
    }
    updateGroupMembership([child]);
    layoutGroupChildren(group, { resizeGroup: 'auto', layoutAllItems: true, updateDom: true });
    scheduleLinkGeometryRefresh(new Set([group.id, child.id]));
    return child;
}
function findPromptGroupAtScreen(clientX, clientY){
    const hit = document.elementFromPoint(clientX, clientY);
    const nodeEl = hit?.closest?.('.promptGroup-node');
    if(!nodeEl?.dataset?.id) return null;
    const group = nodes.find(n => n.id === nodeEl.dataset.id);
    return group?.type === 'promptGroup' ? group : null;
}
function clearPromptGroupOutputDropHighlights(exceptEl=null){
    nodesEl?.querySelectorAll('.promptGroup-node.prompt-group-output-drop').forEach(nodeEl => {
        if(exceptEl && nodeEl === exceptEl) return;
        nodeEl.classList.remove('group-drop-target', 'prompt-group-output-drop');
    });
}
function handlePromptGroupOutputDrop(e, group){
    const url = resolveOutputDragUrl(e.dataTransfer);
    let prompt = resolveOutputDragPrompt(e.dataTransfer);
    if(!prompt && url) prompt = resolveOutputImagePrompt(url);
    if(!prompt){
        setStatus(tr('canvas.outputDropNoPrompt'));
        setTimeout(() => { if(canvas) setStatus('Ready'); }, 2500);
        endOutputDragSession();
        setCanvasOutputDragActive(false);
        return;
    }
    createPromptFromOutputInGroup(group, screenToWorld(e.clientX, e.clientY), prompt);
    endOutputDragSession();
    setCanvasOutputDragActive(false);
    setStatus(tr('canvas.outputDropPromptCreated'));
    setTimeout(() => { if(canvas) setStatus('Ready'); }, 2000);
}
function bindPromptGroupOutputDrop(group, dropZone){
    const nodeEl = dropZone?.classList?.contains('node') ? dropZone : dropZone?.closest?.('.node');
    if(!nodeEl) return;
    dropZone.ondragover = e => {
        if(!isActiveOutputImageDrag(e.dataTransfer)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
        clearPromptGroupOutputDropHighlights(nodeEl);
        nodeEl.classList.add('group-drop-target', 'prompt-group-output-drop');
        dropOverlay?.classList.remove('active', 'output-copy-drag');
    };
    dropZone.ondragleave = e => {
        if(dropZone.contains(e.relatedTarget)) return;
        nodeEl.classList.remove('group-drop-target', 'prompt-group-output-drop');
    };
    dropZone.ondrop = e => {
        e.preventDefault();
        e.stopPropagation();
        clearPromptGroupOutputDropHighlights();
        dropOverlay?.classList.remove('active', 'output-copy-drag');
        if(!isActiveOutputImageDrag(e.dataTransfer)) return;
        handlePromptGroupOutputDrop(e, group);
    };
}
function findEmptyImageNodeAtScreen(clientX, clientY){
    const hit = document.elementFromPoint(clientX, clientY);
    const nodeEl = hit?.closest?.('.image-node');
    if(!nodeEl?.dataset?.id) return null;
    const node = nodes.find(n => n.id === nodeEl.dataset.id);
    if(!node || node.type !== 'image' || node.url) return null;
    return node;
}
function commitOutputImageToCanvas(url, point, clientX, clientY){
    const clean = String(url || '').trim();
    if(!ensureCanvas() || !clean || clean === 'undefined') return false;
    if(mediaKindForRef(clean) !== 'image') return false;
    const empty = findEmptyImageNodeAtScreen(clientX, clientY);
    if(empty){
        setImageNodeFromOutput(empty.id, clean);
        return true;
    }
    createImageCardFromOutput(clean, point);
    return true;
}
function appendOutputImages(out, images, compareRef, metas=[], layout=null){
    const list = (images || []).filter(Boolean);
    if(!out || !list.length) return;
    if(layout?.type === 'grid-split'){
        const groupId = layout.groupId;
        out.images = (out.images || []).filter(item => {
            if(typeof item !== 'object' || !item.grid?.groupId) return true;
            return item.grid.groupId !== groupId;
        });
        const hasOtherGridGroups = (out.images || []).some(item => item?.grid?.groupId && item.grid.groupId !== groupId);
        if(!hasOtherGridGroups) out.outputLayout = layout;
        else delete out.outputLayout;
    } else if(out.outputLayout) {
        delete out.outputLayout;
    }
    out.images = [...(out.images || []), ...list.map((url, i) => {
        const meta = metas[i] || metas[0] || {};
        const source = url && typeof url === 'object' ? url : {};
        const item = {
            url:outputUrlValue(url),
            viewed:false,
            runMs:meta.runMs || 0,
            run:meta.run || null,
            model:outputImageModelLabel(meta) || '',
        };
        if(source.name) item.name = source.name;
        if(source.kind || source.mediaKind) item.kind = source.kind || source.mediaKind;
        if(meta.kind) item.kind = meta.kind;
        if(meta.grid) item.grid = meta.grid;
        const prompt = outputMetaPrompt(meta);
        if(prompt) item.prompt = prompt;
        return item;
    })];
    if(compareRef?.url){
        out.imageComparisons = out.imageComparisons || {};
        list.forEach(url => {
            out.imageComparisons[url] = {url:compareRef.url, name:compareRef.name || 'input image'};
        });
    }
}
function outputCompareUrlFor(url, out){
    const source = out?.imageComparisons?.[url];
    if(typeof source === 'string' && source) return source;
    if(source?.url) return source.url;
    const meta = outputMetaFor(url, out);
    return meta?.run?.refs?.find(ref => ref?.url)?.url || '';
}
function markOutputViewed(out, url){
    if(!out || !url || !(out.images || []).length) return;
    let changed = false;
    out.images = out.images.map(item => {
        if(typeof item === 'string') return item;
        if(item?.url === url && !item.viewed){
            changed = true;
            return {...item, viewed:true};
        }
        return item;
    });
    if(changed){
        render();
        scheduleSave();
    }
}
function outputLightboxItems(out=null){
    const normalize = (item, sourceOut=null) => {
        const url = outputUrlValue(item);
        if(!url || mediaKindForOutputItem(item) !== 'image') return null;
        return {url, outId:sourceOut?.id || ''};
    };
    const sourceOut = out?.id ? nodes.find(n => n.id === out.id) || out : null;
    if(sourceOut){
        return (sourceOut.images || []).map(item => normalize(item, sourceOut)).filter(Boolean);
    }
    const outputNodeItems = nodes
        .filter(n => n.type === 'output' || n.type === 'frameStack')
        .flatMap(n => (n.images || []).map(item => normalize(item, n)).filter(Boolean));
    if(outputNodeItems.length) return outputNodeItems;
    return (canvas?.logs || [])
        .flatMap(log => (log.outputs || []).map(url => normalize(url, null)).filter(Boolean));
}
function navigateOutputLightbox(direction){
    if(!outputLightbox.classList.contains('open') || !currentOutputLightboxUrl) return false;
    const out = currentOutputLightboxOutId ? nodes.find(n => n.id === currentOutputLightboxOutId) : null;
    const items = outputLightboxItems(out);
    if(items.length < 2) return false;
    let idx = items.findIndex(item => item.url === currentOutputLightboxUrl);
    if(idx < 0) idx = 0;
    const next = items[(idx + direction + items.length) % items.length];
    const nextOut = next.outId ? nodes.find(n => n.id === next.outId) : null;
    openOutputLightbox(next.url, nextOut);
    return true;
}
function createImageCardFromOutput(url, point){
    if(!ensureCanvas() || !url) return;
    if(mediaKindForRef(url) !== 'image') return;
    const p = point || defaultPoint(0, 0);
    const id = uid('img');
    nodes.push({id, type:'image', x:p.x, y:p.y, url, name:outputImageName(url)});
    render();
    const el = nodesEl?.querySelector(`.image-node[data-id="${CSS.escape(id)}"]`);
    if(el){
        el.classList.add('spawn-from-drag');
        el.addEventListener('animationend', () => el.classList.remove('spawn-from-drag'), {once:true});
    }
    scheduleSave();
}
async function downloadUrl(url, filename){
    const res = await fetch(url);
    if(!res.ok) throw new Error('下载失败');
    const blob = await res.blob();
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    canvasRoot.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
function setOutputCompareMode(active){
    outputPreview.classList.toggle('compare-mode', active);
    if(active){
        outputCompareOriginalWrap.style.clipPath = 'inset(0 50% 0 0)';
        outputCompareSlider.style.left = '50%';
    }
}
function outputResolutionText(text, meta=null){
    const parts = [text || '--'];
    const model = outputImageModelLabel(meta || {});
    if(model) parts.push(`<span>${escapeHtml(model)}</span>`);
    if(meta?.runMs) parts.push(`<span>${formatRunDuration(meta.runMs)}</span>`);
    outputResolution.innerHTML = parts.join('<span style="opacity:.38">|</span>');
}
function setupOutputPromptPanel(meta){
    currentOutputMeta = meta || null;
    const prompt = outputMetaPrompt(meta);
    outputPromptPanel.classList.toggle('open', !!prompt || !!meta?.run);
    outputPromptText.textContent = prompt || tr('canvas.noPromptMeta');
    outputCopyPromptBtn.onclick = e => {
        e.stopPropagation();
        if(!prompt) return;
        copyTextToClipboard(prompt);
        const span = outputCopyPromptBtn.querySelector('span');
        const oldText = span?.textContent || tr('canvas.copyPrompt');
        outputCopyPromptBtn.classList.add('copied');
        if(span) span.textContent = tr('canvas.copied');
        clearTimeout(outputCopyPromptBtn._copyTimer);
        outputCopyPromptBtn._copyTimer = setTimeout(() => {
            outputCopyPromptBtn.classList.remove('copied');
            if(span) span.textContent = oldText;
        }, 1200);
    };
    outputRerunBtn.onclick = e => {
        e.stopPropagation();
        rerunFromOutputMeta(currentOutputMeta);
    };
}
function rerunFromOutputMeta(meta){
    if(!ensureCanvas() || !meta?.run?.nodeType) return;
    const base = JSON.parse(JSON.stringify(meta.run.node || {}));
    const p = defaultPoint(180, 40);
    const node = {...base, id:uid(base.type || meta.run.nodeType), type:meta.run.nodeType, x:p.x, y:p.y, inputs:[], running:false};
    nodes.push(node);
    const prompt = meta.run.prompt || '';
    if(prompt){
        const promptNode = {id:uid('pr'), type:'prompt', x:p.x - 340, y:p.y, text:prompt};
        nodes.push(promptNode);
        connections.push({id:uid('c'), from:promptNode.id, to:node.id});
    }
    (meta.run.refs || []).slice(0, 8).forEach((ref, i) => {
        const imgNode = {id:uid('img'), type:'image', x:p.x - 340, y:p.y + 110 + i * 86, url:ref.url, name:ref.name || 'image'};
        nodes.push(imgNode);
        connections.push({id:uid('c'), from:imgNode.id, to:node.id});
    });
    closeOutputLightbox();
    render();
    scheduleSave();
}
function updateOutputCompareSlider(clientX){
    const rect = outputCompareContainer.getBoundingClientRect();
    if(!rect.width) return;
    const percent = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    outputCompareOriginalWrap.style.clipPath = `inset(0 ${100 - percent}% 0 0)`;
    outputCompareSlider.style.left = `${percent}%`;
}
function applyOutputPreviewZoom(){
    const transform = `translate(${outputPreviewPan.x}px, ${outputPreviewPan.y}px) scale(${outputPreviewZoom})`;
    [outputLightboxImg, outputCompareResult, outputCompareOriginal].forEach(img => {
        img.style.transform = transform;
        img.style.transformOrigin = '0 0';
    });
    outputPreview.classList.toggle('zoomed', outputPreviewZoom > 1.001);
}
function resetOutputPreviewZoom(){
    outputPreviewZoom = 1;
    outputPreviewPan = {x: 0, y: 0};
    outputPreviewPanDrag = null;
    outputPreview.classList.remove('panning');
    applyOutputPreviewZoom();
}
function initOutputPreviewZoomEvents(){
    outputPreview.addEventListener('wheel', e => {
        if(outputLightboxVideo.style.display === 'block') return;
        e.preventDefault();
        e.stopPropagation();
        const rect = outputPreview.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;
        const before = {
            x:(localX - outputPreviewPan.x) / outputPreviewZoom,
            y:(localY - outputPreviewPan.y) / outputPreviewZoom
        };
        const factor = e.deltaY > 0 ? .9 : 1.1;
        const nextZoom = Math.max(1, Math.min(6, outputPreviewZoom * factor));
        outputPreviewZoom = nextZoom;
        outputPreviewPan = nextZoom <= 1.001 ? {x: 0, y: 0} : {
            x:localX - before.x * nextZoom,
            y:localY - before.y * nextZoom
        };
        applyOutputPreviewZoom();
    }, {passive:false});
    outputPreview.addEventListener('mousedown', e => {
        if(outputLightboxVideo.style.display === 'block') return;
        if(e.button !== 0 || outputPreviewZoom <= 1.001) return;
        if(e.target.closest('.output-preview-actions, .output-resolution, .output-compare-slider')) return;
        outputPreviewPanDrag = {
            sx:e.clientX,
            sy:e.clientY,
            ox:outputPreviewPan.x,
            oy:outputPreviewPan.y
        };
        outputPreview.classList.add('panning');
        e.preventDefault();
        e.stopPropagation();
    });
    on(window, 'mousemove', e => {
        if(!outputPreviewPanDrag) return;
        outputPreviewPan = {
            x:outputPreviewPanDrag.ox + e.clientX - outputPreviewPanDrag.sx,
            y:outputPreviewPanDrag.oy + e.clientY - outputPreviewPanDrag.sy
        };
        applyOutputPreviewZoom();
    });
    on(window, 'mouseup', () => {
        outputPreviewPanDrag = null;
        outputPreview.classList.remove('panning');
    });
}
function initOutputCompareEvents(){
    if(!outputCompareContainer || !outputCompareSlider) return;
    outputCompareContainer.addEventListener('mousedown', e => {
        outputCompareDrag = true;
        updateOutputCompareSlider(e.clientX);
        e.preventDefault();
        e.stopPropagation();
    });
    outputCompareSlider.addEventListener('mousedown', e => {
        outputCompareDrag = true;
        e.preventDefault();
        e.stopPropagation();
    });
    on(window, 'mousemove', e => {
        if(outputCompareDrag) updateOutputCompareSlider(e.clientX);
    });
    on(window, 'mouseup', () => { outputCompareDrag = false; });
    outputCompareContainer.addEventListener('touchstart', e => {
        outputCompareDrag = true;
        updateOutputCompareSlider(e.touches[0].clientX);
        e.preventDefault();
        e.stopPropagation();
    }, {passive:false});
    on(window, 'touchmove', e => {
        if(outputCompareDrag) {
            updateOutputCompareSlider(e.touches[0].clientX);
            e.preventDefault();
        }
    }, {passive:false});
    on(window, 'touchend', () => { outputCompareDrag = false; });
}
function initOutputLightboxEvents(){
    if(!outputLightbox) return;
    const shell = outputLightbox.querySelector('#outputLightboxShell');
    const closeBtn = outputLightbox.querySelector('#outputLightboxCloseBtn');
    on(outputLightbox, 'click', () => closeOutputLightbox());
    if(shell) on(shell, 'click', e => e.stopPropagation());
    if(closeBtn){
        on(closeBtn, 'click', e => {
            e.stopPropagation();
            closeOutputLightbox();
        });
    }
}
function syncOutputLightboxPortal(open){
    if(!outputLightbox) return;
    const dark = Boolean(canvasRoot?.classList.contains('theme-dark'));
    outputLightbox.classList.toggle('theme-dark', dark);
    if(open){
        if(!outputLightboxAnchor || !outputLightboxAnchor.isConnected){
            outputLightboxAnchor = shell || canvasRoot?.querySelector('#shell') || outputLightbox.parentElement;
        }
        if(outputLightbox.parentElement !== document.body){
            document.body.appendChild(outputLightbox);
        }
        try { document.body.dataset.canvasOutputLightbox = '1'; } catch(_) {}
        return;
    }
    try { delete document.body.dataset.canvasOutputLightbox; } catch(_) {}
    const anchor = outputLightboxAnchor || shell || canvasRoot?.querySelector('#shell');
    if(anchor && outputLightbox.parentElement === document.body){
        anchor.appendChild(outputLightbox);
    }
}
function openOutputLightbox(url, out){
    if(!url) return;
    resetOutputPreviewZoom();
    currentOutputLightboxOutId = out?.id || '';
    currentOutputLightboxUrl = url;
    const meta = outputMetaFor(url, out);
    setupOutputPromptPanel(meta);
    outputResolutionText('--', meta);
    currentOutputCompareUrl = outputCompareUrlFor(url, out);
    setOutputCompareMode(false);
    const videoMode = isVideoUrl(url);
    outputLightboxImg.style.display = videoMode ? 'none' : 'block';
    outputLightboxVideo.style.display = videoMode ? 'block' : 'none';
    outputCompareResult.style.display = videoMode ? 'none' : 'block';
    outputCompareOriginal.style.display = videoMode ? 'none' : 'block';
    if(videoMode){
        outputLightboxImg.src = '';
        outputCompareResult.src = '';
        outputCompareOriginal.src = '';
        outputLightboxVideo.onloadedmetadata = () => {
            outputResolutionText(outputLightboxVideo.videoWidth && outputLightboxVideo.videoHeight
                ? `${outputLightboxVideo.videoWidth} x ${outputLightboxVideo.videoHeight}`
                : 'Video', meta);
        };
        outputLightboxVideo.src = url;
        outputPreview.ondblclick = null;
        outputDownloadBtn.onclick = e => {
            e.stopPropagation();
            downloadUrl(url, outputDownloadName(url)).catch(err => softAlert(err.message || '下载失败'));
        };
        syncOutputLightboxPortal(true);
        outputLightbox.classList.add('open');
        refreshIcons();
        return;
    }
    outputLightboxVideo.pause();
    outputLightboxVideo.src = '';
    outputLightboxImg.draggable = false;
    outputCompareResult.draggable = false;
    outputCompareOriginal.draggable = false;
    outputLightboxImg.onload = () => {
        outputResolutionText(`${outputLightboxImg.naturalWidth} x ${outputLightboxImg.naturalHeight}`, meta);
    };
    outputLightboxImg.src = url;
    outputCompareResult.src = url;
    outputCompareOriginal.src = currentOutputCompareUrl || '';
    outputPreview.ondblclick = e => {
        e.stopPropagation();
        if(!currentOutputCompareUrl) return;
        setOutputCompareMode(!outputPreview.classList.contains('compare-mode'));
    };
    outputDownloadBtn.onclick = e => {
        e.stopPropagation();
        downloadUrl(url, outputDownloadName(url)).catch(err => softAlert(err.message || '下载失败'));
    };
    syncOutputLightboxPortal(true);
    outputLightbox.classList.add('open');
    refreshIcons();
}
function closeOutputLightbox(){
    outputLightbox.classList.remove('open');
    syncOutputLightboxPortal(false);
    setOutputCompareMode(false);
    outputLightboxImg.src = '';
    outputLightboxVideo.pause();
    outputLightboxVideo.src = '';
    outputLightboxVideo.style.display = 'none';
    outputLightboxImg.style.display = 'block';
    outputCompareResult.style.display = 'block';
    outputCompareOriginal.style.display = 'block';
    outputCompareResult.src = '';
    outputCompareOriginal.src = '';
    outputPreview.ondblclick = null;
    resetOutputPreviewZoom();
    currentOutputCompareUrl = '';
    currentOutputMeta = null;
    currentOutputLightboxOutId = '';
    currentOutputLightboxUrl = '';
    setupOutputPromptPanel(null);
}
function isGroupHandoffTarget(groupType, target){
    if(!target) return false;
    if(groupType === 'promptGroup') return target.type === 'loop' || target.type === 'llm' || CANVAS_GENERATOR_TYPES.includes(target.type);
    if(groupType === 'group' || groupType === 'imageBatch') return CANVAS_GENERATOR_TYPES.includes(target.type) || target.type === 'loop';
    return CANVAS_GENERATOR_TYPES.includes(target.type);
}
function syncLoopCountFromPromptGroup(loopNode, promptGroup){
    if(!loopNode || loopNode.type !== 'loop' || !loopNode.showPrompt || !promptGroup || promptGroup.type !== 'promptGroup') return;
    const itemCount = activePromptGroupChildren(promptGroup).length;
    if(!itemCount) return;
    const prevSynced = Number(loopNode._promptGroupItemCount || 0);
    if(prevSynced && loopNode.count === prevSynced) loopNode.count = itemCount;
    else loopNode.count = Math.max(Number(loopNode.count || 1) || 1, itemCount);
    loopNode._promptGroupItemCount = itemCount;
}
function syncLoopCountFromImageBatch(loopNode, imageBatch){
    if(!loopNode || loopNode.type !== 'loop' || !loopNode.imageInput || !imageBatch || imageBatch.type !== 'imageBatch') return;
    const itemCount = imageBatchChildImages(imageBatch).length;
    if(!itemCount) return;
    loopNode.count = Math.max(loopCount(loopNode), itemCount);
}
function imageStackGeneratorSources(n){
    return (n.images || []).map((item, i) => {
        const url = outputUrlValue(item);
        if(!url) return null;
        const name = (item && typeof item === 'object' && item.name) || outputImageName(url);
        return {
            id:`${n.id}:img:${i}`,
            type:'image',
            label:name || `${langIsEn() ? 'Frame' : '帧'} ${i + 1}`,
            preview:url,
            refs:[{url, name:name || outputImageName(url), kind:'image'}],
            prompt:'',
        };
    }).filter(Boolean);
}
function buildImageBatchFromImages(images, anchor){
    const p = anchor || defaultPoint(0, 0);
    const batch = addImageBatchNode({x:p.x - 24, y:p.y - 58});
    batch.items = images.map(img => img.id);
    handoffExistingInputsToGroup(batch, images);
    layoutGroupChildren(batch, { resizeGroup: true, layoutAllItems: true, updateDom: true });
    return batch;
}
function buildPromptGroupFromPrompts(prompts, yOffset=0){
    const box = nodeBounds(prompts.map(n => n.id));
    const promptGroup = addPromptGroupNode({x:box.x - 24, y:box.y - 58 + yOffset});
    promptGroup.items = prompts.map(n => n.id);
    handoffExistingInputsToGroup(promptGroup, prompts);
    layoutGroupChildren(promptGroup, { resizeGroup: true, layoutAllItems: true, updateDom: true });
    return promptGroup;
}
function relayoutGroupsWithMeasuredChrome(groupIds, resizeGroup='auto'){
    (groupIds || []).forEach(id => {
        const g = nodes.find(n => n.id === id);
        if(!g || !['group','imageBatch','promptGroup'].includes(g.type)) return;
        layoutGroupChildren(g, { resizeGroup, layoutAllItems: true, updateDom: true });
    });
}
function finalizeGroupSelection(created){
    selected.clear();
    created.forEach(id => selected.add(id));
    syncGeneratorInputs();
    refreshGeneratorInputViews();
    render();
    relayoutGroupsWithMeasuredChrome(created, 'auto');
    scheduleSave();
}
function mergeSelectedImagesToBatch(){
    if(!ensureCanvas()) return;
    const images = [...selected].map(id => nodes.find(n => n.id === id)).filter(n => n?.type === 'image' && n?.url && mediaKindForNode(n) === 'image');
    if(images.length < 2){
        softAlert(langIsEn() ? 'Select at least 2 image nodes to merge' : '请至少框选 2 张图片节点');
        return;
    }
    pushUndo();
    const batch = buildImageBatchFromImages(images);
    finalizeGroupSelection([batch.id]);
}
function createImageBatchFromSelection(){
    if(!ensureCanvas()) return;
    const images = [...selected].map(id => nodes.find(n => n.id === id)).filter(n => n?.type === 'image');
    pushUndo();
    const batch = images.length
        ? buildImageBatchFromImages(images)
        : addImageBatchNode(defaultPoint(-40, 0));
    finalizeGroupSelection([batch.id]);
}
function createPromptGroupFromSelection(){
    if(!ensureCanvas()) return;
    const prompts = [...selected].map(id => nodes.find(n => n.id === id)).filter(n => n?.type === 'prompt');
    pushUndo();
    const promptGroup = prompts.length
        ? buildPromptGroupFromPrompts(prompts)
        : addPromptGroupNode(defaultPoint(40, 0));
    finalizeGroupSelection([promptGroup.id]);
}
function groupSelectedImages(){
    if(!ensureCanvas()) return;
    const images = [...selected].map(id => nodes.find(n => n.id === id)).filter(n => n?.type === 'image');
    const prompts = [...selected].map(id => nodes.find(n => n.id === id)).filter(n => n?.type === 'prompt');
    if(!images.length && !prompts.length){
        createImageBatchFromSelection();
        return;
    }
    pushUndo();
    const created = [];
    if(images.length) created.push(buildImageBatchFromImages(images).id);
    if(prompts.length){
        const yOff = images.length ? nodeBounds(images.map(n => n.id)).h + 90 + 24 : 0;
        created.push(buildPromptGroupFromPrompts(prompts, yOff).id);
    }
    finalizeGroupSelection(created);
}
function nodeBounds(ids){
    const rects = ids.map(id => {
        const n = nodes.find(item => item.id === id);
        const el = nodesEl.querySelector(`.node[data-id="${id}"]`);
        if(!n) return null;
        return {x:n.x, y:n.y, w:el?.offsetWidth || n.w || 260, h:el?.offsetHeight || n.h || 220};
    }).filter(Boolean);
    const x1 = Math.min(...rects.map(r => r.x));
    const y1 = Math.min(...rects.map(r => r.y));
    const x2 = Math.max(...rects.map(r => r.x + r.w));
    const y2 = Math.max(...rects.map(r => r.y + r.h));
    return {x:x1, y:y1, w:x2 - x1, h:y2 - y1};
}
const FLOW_NODE_ORDER = {image:0, prompt:1, group:2, promptGroup:2, loop:3, llm:4, generator:5, replicaAgent:5, imageRepairAgent:5, videoReverse:5, slotsLoopVideoAgent:5, msgen:5, video:5, rh:5, comfy:5, ltxDirector:5, output:6, frameStack:6, imageBatch:6};
function moveNodeWithChildren(node, newX, newY){
    if(!node) return;
    const dx = newX - Number(node.x || 0);
    const dy = newY - Number(node.y || 0);
    node.x = newX;
    node.y = newY;
    if(node.type === 'group' || node.type === 'promptGroup' || node.type === 'imageBatch'){
        (node.items || []).forEach(id => {
            const child = nodes.find(n => n.id === id);
            if(child){
                child.x = Number(child.x || 0) + dx;
                child.y = Number(child.y || 0) + dy;
            }
        });
    }
}
function assignFlowLayers(nodeIds, edges){
    const layer = new Map(nodeIds.map(id => [id, 0]));
    let changed = true;
    let guard = 0;
    while(changed && guard++ < nodeIds.length * 4){
        changed = false;
        edges.forEach(c => {
            if(!layer.has(c.from) || !layer.has(c.to)) return;
            const next = layer.get(c.from) + 1;
            if(next > layer.get(c.to)){
                layer.set(c.to, next);
                changed = true;
            }
        });
    }
    return layer;
}
function findConnectedComponents(nodeIds, edges){
    const idSet = new Set(nodeIds);
    const adj = new Map([...idSet].map(id => [id, new Set()]));
    edges.forEach(c => {
        if(!adj.has(c.from) || !adj.has(c.to)) return;
        adj.get(c.from).add(c.to);
        adj.get(c.to).add(c.from);
    });
    const visited = new Set();
    const components = [];
    idSet.forEach(id => {
        if(visited.has(id)) return;
        const comp = [];
        const stack = [id];
        while(stack.length){
            const cur = stack.pop();
            if(visited.has(cur)) continue;
            visited.add(cur);
            comp.push(cur);
            adj.get(cur)?.forEach(nb => { if(!visited.has(nb)) stack.push(nb); });
        }
        components.push(comp);
    });
    components.sort((a, b) => {
        const ax = Math.min(...a.map(id => nodes.find(n => n.id === id)?.x ?? 0));
        const bx = Math.min(...b.map(id => nodes.find(n => n.id === id)?.x ?? 0));
        return ax - bx;
    });
    return components;
}
function layoutFlowComponent(nodeIds, startX, startY, internalEdges){
    const idSet = new Set(nodeIds);
    const edges = internalEdges.filter(c => idSet.has(c.from) && idSet.has(c.to));
    const nodesList = nodeIds.map(id => nodes.find(n => n.id === id)).filter(Boolean);
    const layer = assignFlowLayers(nodeIds, edges);
    const layers = new Map();
    nodesList.forEach(n => {
        const l = layer.get(n.id) ?? 0;
        if(!layers.has(l)) layers.set(l, []);
        layers.get(l).push(n);
    });
    const GAP_X = 72;
    const GAP_Y = 40;
    let x = startX;
    let maxRight = startX;
    [...layers.keys()].sort((a, b) => a - b).forEach(layerKey => {
        const row = layers.get(layerKey);
        row.sort((a, b) => {
            const ta = FLOW_NODE_ORDER[a.type] ?? 99;
            const tb = FLOW_NODE_ORDER[b.type] ?? 99;
            if(ta !== tb) return ta - tb;
            return Number(a.y || 0) - Number(b.y || 0);
        });
        let maxW = 0;
        let y = startY;
        row.forEach(n => {
            const r = nodeRect(n);
            moveNodeWithChildren(n, x, y);
            maxW = Math.max(maxW, r.w);
            maxRight = Math.max(maxRight, x + r.w);
            y += r.h + GAP_Y;
        });
        x += maxW + GAP_X;
    });
    return Math.max(GAP_X, maxRight - startX + GAP_X);
}
function organizeSelectedNodes(){
    if(!ensureCanvas()) return;
    const layoutNodes = getSelectedLayoutNodes();
    if(layoutNodes.length < 2) return;
    pushUndo();
    const idSet = new Set(layoutNodes.map(n => n.id));
    const internalEdges = connections.filter(c => idSet.has(c.from) && idSet.has(c.to));
    const components = findConnectedComponents([...idSet], internalEdges);
    let offsetX = Math.min(...layoutNodes.map(n => Number(n.x || 0)));
    const startY = Math.min(...layoutNodes.map(n => Number(n.y || 0)));
    components.forEach(component => {
        const width = layoutFlowComponent(component, offsetX, startY, internalEdges);
        offsetX += width + 96;
    });
    updateGroupMembership(layoutNodes);
    render();
    requestAnimationFrame(() => {
        refreshGeometryAfterLayout();
        if(minimapState) updateMinimapNodePositions();
    });
    scheduleSave();
}

function canvasNodeSearchLabel(node){
    if(!node) return '';
    const typeLabel = {
        image:'Image', prompt:'Prompt', loop:'Loop', promptGroup:'Prompts', group:'Group',
        output:'Output', imageBatch:'Image batch', frameStack:'Frame Stack', llm:'LLM',
        replicaAgent:'Replica Agent', imageRepairAgent:'Repair Agent', batchPosterAgent:'Batch Poster',
        nineGridAgent:'Nine Grid', slotsLoopVideoAgent:'Slots Loop', videoReverse:'Video Reverse',
        comfy:'ComfyUI', ltxDirector:'LTX Director', rh:'RunningHub', msgen:'ModelScope',
        video:'Video', generator:'Generator',
    }[node.type] || node.type || 'Node';
    const name = node.name || node.title || '';
    return name ? `${typeLabel} · ${name}` : typeLabel;
}
function focusCanvasNodeById(nodeId){
    const node = nodes.find(n => n.id === nodeId);
    if(!node) return;
    selected.clear();
    selected.add(node.id);
    const r = estimatedNodeRect(node);
    centerViewportOnWorldPoint({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
    applyViewport();
    render();
}
function closeCanvasNodeSearch(){
    document.getElementById('canvasNodeSearchModal')?.remove();
}
function openCanvasNodeSearch(){
    if(!canvas || !isInfiniteCanvasEditorOpen()) return;
    closeCanvasNodeSearch();
    const root = canvasRoot || document.querySelector('.infinite-canvas-root');
    if(!root) return;
    const modal = document.createElement('div');
    modal.id = 'canvasNodeSearchModal';
    modal.className = 'canvas-node-search-modal';
    modal.innerHTML = `
        <div class="canvas-node-search-panel" role="dialog" aria-label="搜索节点">
            <input class="canvas-node-search-input" type="search" placeholder="搜索节点名称 / 类型…" autocomplete="off" />
            <div class="canvas-node-search-list"></div>
            <div class="canvas-node-search-hint">Enter 定位 · Esc 关闭 · ↑↓ 选择</div>
        </div>
    `;
    const input = modal.querySelector('.canvas-node-search-input');
    const list = modal.querySelector('.canvas-node-search-list');
    let activeIndex = 0;
    let matches = [];
    const renderList = () => {
        const q = String(input.value || '').trim().toLowerCase();
        matches = nodes
            .map(n => ({ node:n, label:canvasNodeSearchLabel(n) }))
            .filter(row => !q || row.label.toLowerCase().includes(q) || String(row.node.type || '').toLowerCase().includes(q) || String(row.node.id || '').toLowerCase().includes(q))
            .slice(0, 40);
        activeIndex = Math.min(activeIndex, Math.max(0, matches.length - 1));
        list.innerHTML = matches.length
            ? matches.map((row, i) => `<button type="button" class="canvas-node-search-item${i === activeIndex ? ' is-active' : ''}" data-idx="${i}"><span>${escapeHtml(row.label)}</span><span class="canvas-node-search-type">${escapeHtml(row.node.type || '')}</span></button>`).join('')
            : `<div class="canvas-node-search-empty">没有匹配的节点</div>`;
        list.querySelectorAll('.canvas-node-search-item').forEach(btn => {
            btn.onmousedown = e => e.preventDefault();
            btn.onclick = () => {
                const idx = Number(btn.dataset.idx);
                const hit = matches[idx];
                if(!hit) return;
                closeCanvasNodeSearch();
                focusCanvasNodeById(hit.node.id);
            };
        });
    };
    modal.addEventListener('mousedown', e => {
        if(e.target === modal) closeCanvasNodeSearch();
    });
    input.addEventListener('input', () => { activeIndex = 0; renderList(); });
    input.addEventListener('keydown', e => {
        if(e.key === 'Escape'){ e.preventDefault(); closeCanvasNodeSearch(); return; }
        if(e.key === 'ArrowDown'){ e.preventDefault(); activeIndex = Math.min(matches.length - 1, activeIndex + 1); renderList(); return; }
        if(e.key === 'ArrowUp'){ e.preventDefault(); activeIndex = Math.max(0, activeIndex - 1); renderList(); return; }
        if(e.key === 'Enter'){
            e.preventDefault();
            const hit = matches[activeIndex];
            if(!hit) return;
            closeCanvasNodeSearch();
            focusCanvasNodeById(hit.node.id);
        }
    });
    root.appendChild(modal);
    renderList();
    requestAnimationFrame(() => input.focus());
}

function startSelection(e){
    e.preventDefault();
    e.stopPropagation();
    if(document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    selectDrag = {sx:e.clientX, sy:e.clientY, x:e.clientX, y:e.clientY};
    withCanvasRootClass(list => list.add('canvas-selecting'));
    selectionBox.style.display = 'block';
    updateSelectionBox(e.clientX, e.clientY);
    window.onmousemove = e2 => updateSelectionBox(e2.clientX, e2.clientY);
    window.onmouseup = finishSelection;
}
function updateSelectionBox(x, y){
    if(!selectDrag) return;
    selectDrag.x = x; selectDrag.y = y;
    const left = Math.min(selectDrag.sx, x);
    const top = Math.min(selectDrag.sy, y);
    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${Math.abs(x - selectDrag.sx)}px`;
    selectionBox.style.height = `${Math.abs(y - selectDrag.sy)}px`;
}
function finishSelection(){
    if(!selectDrag) return;
    const rect = selectionBox.getBoundingClientRect();
    selectionBox.style.display = 'none';
    selected.clear();
    nodesEl.querySelectorAll('.node').forEach(el => {
        const r = el.getBoundingClientRect();
        const overlaps = r.left < rect.right && r.right > rect.left && r.top < rect.bottom && r.bottom > rect.top;
        if(overlaps) selected.add(el.dataset.id);
    });
    selectDrag = null;
    withCanvasRootClass(list => list.remove('canvas-selecting'));
    window.onmousemove = null;
    window.onmouseup = null;
    render();
}
function startSelectionLink(e, kind){
    e.preventDefault();
    e.stopPropagation();
    const p = screenToWorld(e.clientX, e.clientY);
    tempLink = {from:`selection:${kind}`, x1:p.x, y1:p.y, x2:p.x, y2:p.y};
    refreshTempLinkDom();
    const pointerId = e.pointerId ?? null;
    let finished = false;
    const onMove = e2 => {
        if(!tempLink) return;
        if(pointerId != null && e2.pointerId != null && e2.pointerId !== pointerId) return;
        const next = screenToWorld(e2.clientX, e2.clientY);
        tempLink.x2 = next.x;
        tempLink.y2 = next.y;
        refreshTempLinkDom();
    };
    const onFinish = e2 => {
        if(finished || !tempLink) return;
        if(pointerId != null && e2.pointerId != null && e2.pointerId !== pointerId) return;
        finished = true;
        const targetPort = nearestPort(e2.clientX, e2.clientY, 'in');
        const target = targetPort?.closest('.generator-node');
        if(target) connectSelectionToGenerator(kind, target.dataset.id);
        cancelTempLink();
        render();
        scheduleSave();
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('pointerup', onFinish, true);
    document.addEventListener('mouseup', onFinish, true);
    linkDragCleanup = () => {
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('pointerup', onFinish, true);
        document.removeEventListener('mouseup', onFinish, true);
    };
}
function connectSelectionToGenerator(kind, genId){
    const ids = [...selected];
    let source = null;
    if(kind === 'images'){
        const imgs = ids.map(id => nodes.find(n => n.id === id)).filter(n => n?.type === 'image' && n.url);
        if(!imgs.length) return;
        const box = nodeBounds(imgs.map(n => n.id));
        source = {id:uid('grp'), type:'group', x:box.x - 24, y:box.y - 58, w:box.w + 48, h:box.h + 90, items:imgs.map(n => n.id)};
    } else {
        const prompts = ids.map(id => nodes.find(n => n.id === id)).filter(n => n?.type === 'prompt');
        if(!prompts.length) return;
        const box = nodeBounds(prompts.map(n => n.id));
        source = {id:uid('pg'), type:'promptGroup', x:box.x - 24, y:box.y - 58, w:box.w + 48, h:box.h + 90, items:prompts.map(n => n.id)};
    }
    nodes.push(source);
    connections.push({id:uid('c'), from:source.id, to:genId});
    selected.clear();
    selected.add(source.id);
    syncGeneratorInputs();
}

function pushUndo(){
    if(!canvas) return;
    undoStack.push({nodes:JSON.parse(JSON.stringify(serializableCanvasNodes())), connections:JSON.parse(JSON.stringify(connections))});
    if(undoStack.length > UNDO_MAX) undoStack.shift();
    redoStack = [];
}
function snapshotCanvasState(){
    return {nodes:JSON.parse(JSON.stringify(serializableCanvasNodes())), connections:JSON.parse(JSON.stringify(connections))};
}
function applyCanvasHistoryState(state){
    nodes = state.nodes;
    connections = state.connections;
    selected.clear();
    render();
    scheduleSave();
}
function performUndo(){
    if(!canvas || !undoStack.length) return;
    redoStack.push(snapshotCanvasState());
    if(redoStack.length > UNDO_MAX) redoStack.shift();
    const state = undoStack.pop();
    applyCanvasHistoryState(state);
}
function performRedo(){
    if(!canvas || !redoStack.length) return;
    undoStack.push(snapshotCanvasState());
    if(undoStack.length > UNDO_MAX) undoStack.shift();
    const state = redoStack.pop();
    applyCanvasHistoryState(state);
}
function cloneNode(n, dx, dy){
    const copy = JSON.parse(JSON.stringify(serializableCanvasNode(n)));
    copy.id = uid(n.type);
    copy.x = n.x + dx;
    copy.y = n.y + dy;
    copy.running = false;
    return copy;
}
function isGroupNodeType(type){
    return type === 'group' || type === 'promptGroup' || type === 'imageBatch';
}
function collectDuplicateRoots(primaryNode){
    const roots = new Map();
    const addRoot = n => {
        if(!n || roots.has(n.id)) return;
        roots.set(n.id, n);
    };
    if(selected.has(primaryNode.id) && selected.size > 1){
        [...selected].forEach(id => addRoot(nodes.find(x => x.id === id)));
    } else {
        addRoot(primaryNode);
    }
    return [...roots.values()];
}
function expandWithGroupMembers(sourceNodes){
    const expanded = new Map();
    const add = n => {
        if(!n || expanded.has(n.id)) return;
        expanded.set(n.id, n);
        if(isGroupNodeType(n.type)){
            (n.items || []).map(id => nodes.find(x => x.id === id)).forEach(add);
        }
    };
    sourceNodes.forEach(add);
    return [...expanded.values()];
}
function duplicateNodeSet(sourceNodes, dx = 0, dy = 0){
    if(!sourceNodes.length) return { copies: [], idMap: new Map() };
    pushUndo();
    const idMap = new Map();
    const copies = sourceNodes.map(n => {
        const c = cloneNode(n, dx, dy);
        idMap.set(n.id, c.id);
        return c;
    });
    copies.forEach(c => {
        if(isGroupNodeType(c.type) && c.items){
            c.items = c.items.map(id => idMap.get(id) || id);
        }
    });
    nodes.push(...copies);
    const sourceIds = new Set(sourceNodes.map(n => n.id));
    const newConnections = [];
    connections.forEach(conn => {
        if(!sourceIds.has(conn.from) || !sourceIds.has(conn.to)) return;
        const from = idMap.get(conn.from);
        const to = idMap.get(conn.to);
        if(from && to) newConnections.push({ id: uid('c'), from, to });
    });
    if(newConnections.length) connections.push(...newConnections);
    return { copies, idMap };
}
function collectDragChildren(dragTarget){
    const collected = new Map();
    const collect = n => {
        if(!n || collected.has(n.id) || n.id === dragTarget.id) return;
        collected.set(n.id, { node: n, ox: n.x, oy: n.y });
        if(isGroupNodeType(n.type)){
            (n.items || []).map(id => nodes.find(x => x.id === id)).forEach(collect);
        }
    };
    if(isGroupNodeType(dragTarget.type)){
        (dragTarget.items || []).map(id => nodes.find(n => n.id === id)).forEach(collect);
    }
    if(selected.has(dragTarget.id) && selected.size > 1){
        [...selected].forEach(id => collect(nodes.find(n => n.id === id)));
    }
    return [...collected.values()];
}
function wantsAltDuplicate(e){
    return Boolean(e?.altKey || altModifierArmed);
}
function createAltDuplicateDragPayload(primaryNode, sx, sy){
    const roots = collectDuplicateRoots(primaryNode);
    const { idMap } = duplicateNodeSet(expandWithGroupMembers(roots), 0, 0);
    const dragTarget = nodes.find(n => n.id === idMap.get(primaryNode.id));
    if(!dragTarget) return null;
    selected.clear();
    roots.forEach(r => {
        const copyId = idMap.get(r.id);
        if(copyId) selected.add(copyId);
    });
    render();
    refreshSelectionVisuals();
    return {
        node: dragTarget,
        children: collectDragChildren(dragTarget),
        sx,
        sy,
        ox: dragTarget.x,
        oy: dragTarget.y,
        duplicateCreated: true,
    };
}
function copySelectedNodes(){
    if(!canvas || !selected.size) return;
    const el = document.activeElement;
    if(el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')) return;
    const toCopy = [...selected].map(id => nodes.find(n => n.id === id)).filter(Boolean);
    if(!toCopy.length) return;
    clipboard = JSON.parse(JSON.stringify(serializableCanvasNodes(toCopy)));
}
function pasteNodes(){
    if(!canvas || !clipboard?.length) return;
    pushUndo();
    const xs = clipboard.map(n => n.x), ys = clipboard.map(n => n.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const dx = lastMouseBoard.x - cx;
    const dy = lastMouseBoard.y - cy;
    const idMap = new Map();
    const copies = clipboard.map(n => { const c = cloneNode(n, dx, dy); idMap.set(n.id, c.id); return c; });
    copies.forEach(c => {
        if((c.type === 'group' || c.type === 'promptGroup' || c.type === 'imageBatch') && c.items)
            c.items = c.items.map(id => idMap.get(id) || id);
    });
    nodes.push(...copies);
    selected.clear();
    copies.forEach(c => selected.add(c.id));
    render();
    scheduleSave();
}
function clearWindowPointerHandlers(){
    window.onmousemove = null;
    window.onmouseup = null;
}
function onNodePointerMove(e){
    if(pendingNodeDrag){
        if(!pointerMovedEnough(pendingNodeDrag.sx, pendingNodeDrag.sy, e)) return;
        let payload = pendingNodeDrag;
        if(wantsAltDuplicate(e)){
            const duplicated = createAltDuplicateDragPayload(payload.node, payload.sx, payload.sy);
            if(duplicated) payload = duplicated;
        }
        dragNode = {...payload, chromeActive: false};
        pendingNodeDrag = null;
    }
    if(!dragNode) return;
    if(!dragNode.chromeActive){
        dragNode.chromeActive = true;
        withCanvasRootClass(list => list.add('canvas-node-drag'));
    }
    onNodeDrag(e);
}
function onNodePointerUp(e){
    if(pendingNodeDrag){
        pendingNodeDrag = null;
        clearWindowPointerHandlers();
        return;
    }
    endDrag(e);
}
function startNodeDrag(e, node){
    if(e.button !== 0) return;
    if(dragNode || resizeNode || pendingNodeDrag) return;
    if(startKnifeDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    let dragTarget = node;
    let duplicateCreated = false;
    if(wantsAltDuplicate(e)){
        const duplicated = createAltDuplicateDragPayload(node, e.clientX, e.clientY);
        if(!duplicated) return;
        dragTarget = duplicated.node;
        duplicateCreated = true;
    }
    const children = collectDragChildren(dragTarget);
    const payload = {node: dragTarget, children, sx:e.clientX, sy:e.clientY, ox:dragTarget.x, oy:dragTarget.y, duplicateCreated};
    if(duplicateCreated){
        dragNode = {...payload, chromeActive: false};
        pendingNodeDrag = null;
    } else {
        applyNodeSelection(dragTarget.id, e);
        pendingNodeDrag = payload;
        dragNode = null;
    }
    window.onmousemove = onNodePointerMove;
    window.onmouseup = onNodePointerUp;
}
function onNodeDrag(e){
    if(!dragNode) return;
    lastBoardInteractionAt = Date.now();
    lastMouseBoard = screenToWorld(e.clientX, e.clientY);
    const dx = (e.clientX - dragNode.sx) / viewport.scale;
    const dy = (e.clientY - dragNode.sy) / viewport.scale;
    dragNode.node.x = dragNode.ox + dx;
    dragNode.node.y = dragNode.oy + dy;
    const el = nodesEl.querySelector(`.node[data-id="${dragNode.node.id}"]`);
    if(el){
        el.style.left = `${dragNode.node.x}px`;
        el.style.top = `${dragNode.node.y}px`;
    }
    (dragNode.children || []).forEach(childDrag => {
        childDrag.node.x = childDrag.ox + dx;
        childDrag.node.y = childDrag.oy + dy;
        const childEl = nodesEl.querySelector(`.node[data-id="${childDrag.node.id}"]`);
        if(childEl){
            childEl.style.left = `${childDrag.node.x}px`;
            childEl.style.top = `${childDrag.node.y}px`;
        }
    });
    const movingIds = new Set([dragNode.node.id, ...(dragNode.children || []).map(c => c.node.id)]);
    updateGroupDropHighlights([dragNode.node, ...(dragNode.children || []).map(c => c.node)], lastMouseBoard);
    scheduleLinkGeometryRefresh(movingIds);
    scheduleMinimapRender({ positionsOnly: true });
}
function startNodeResize(e, node){
    e.preventDefault();
    e.stopPropagation();
    const el = nodesEl.querySelector(`.node[data-id="${node.id}"]`);
    const rect = el?.getBoundingClientRect();
    resizeNode = {
        node,
        sx:e.clientX,
        sy:e.clientY,
        sw:(rect?.width ? rect.width / viewport.scale : node.w || defaultNodeSize(node.type).w),
        sh:(rect?.height ? rect.height / viewport.scale : node.h || defaultNodeSize(node.type).h || 160),
        chromeActive: false
    };
    window.onmousemove = onNodeResize;
    window.onmouseup = endDrag;
}
function onNodeResize(e){
    if(!resizeNode) return;
    if(!resizeNode.chromeActive){
        if(!pointerMovedEnough(resizeNode.sx, resizeNode.sy, e)) return;
        resizeNode.chromeActive = true;
        withCanvasRootClass(list => list.add('canvas-node-resize'));
    }
    const min = defaultNodeSize(resizeNode.node.type);
    const nextW = Math.max(Math.min(min.w, 220), resizeNode.sw + (e.clientX - resizeNode.sx) / viewport.scale);
    const nextH = Math.max(96, resizeNode.sh + (e.clientY - resizeNode.sy) / viewport.scale);
    const nextWRounded = Math.round(nextW);
    resizeNode.node.w = nextWRounded;
    const autoFitGroupHeight = resizeNode.node.type === 'imageBatch' || resizeNode.node.type === 'promptGroup' || resizeNode.node.type === 'group';
    const el = nodesEl.querySelector(`.node[data-id="${resizeNode.node.id}"]`);
    if(resizeNode.node.type === 'generator'){
        if(el && !resizeNode.node._baseFrameH) resizeNode.node._baseFrameH = measureGeneratorBaseFrame(resizeNode.node, el);
        const baseH = Number(resizeNode.node._baseFrameH || 320);
        resizeNode.node.h = Math.max(96, Math.round(baseH * (nextWRounded / GENERATOR_BASE_W)));
        resizeNode.node._userSized = true;
    } else if(!autoFitGroupHeight){
        resizeNode.node.h = Math.round(nextH);
    }
    if(el){
        el.classList.add('sized');
        el.style.width = `${resizeNode.node.w}px`;
        if(!autoFitGroupHeight) el.style.height = `${resizeNode.node.h}px`;
        if(resizeNode.node.type === 'output' || resizeNode.node.type === 'frameStack'){
            syncOutputNodeThumbVars(el, resizeNode.node);
        }
        if(resizeNode.node.type === 'generator') syncGeneratorNodeScale(resizeNode.node, el);
        if(resizeNode.node.type === 'imageBatch' || resizeNode.node.type === 'promptGroup' || resizeNode.node.type === 'group'){
            layoutGroupChildren(resizeNode.node, { resizeGroup: false, layoutAllItems: true, updateDom: true });
        }
    }
    const resizeChildIds = (resizeNode.node.type === 'imageBatch' || resizeNode.node.type === 'promptGroup' || resizeNode.node.type === 'group')
        ? [resizeNode.node.id, ...(resizeNode.node.items || [])]
        : [resizeNode.node.id];
    scheduleLinkGeometryRefresh(new Set(resizeChildIds));
    scheduleMinimapRender({ positionsOnly: true });
}
function ensureLiveCanvasDom(){
    rebindDomIfStale();
    if((!nodesEl || !linksEl || !linkControlsEl) && canvasRoot) bindDomElements(canvasRoot);
}
function finishTempLink(e){
    if(!tempLink) return;
    if(e?.type === 'mouseup' && e.button !== 0) return;
    if(e?.type === 'pointerup' && e.button !== 0) return;
    const {from: originId, originKind} = tempLink;
    const source = nodes.find(n => n.id === originId);
    cancelTempLink();
    const clientX = e?.clientX ?? 0;
    const clientY = e?.clientY ?? 0;
    const targetKind = originKind === 'out' ? 'in' : 'out';
    const targetPort = nearestPort(clientX, clientY, targetKind);
    const target = targetPort?.closest('.node');
    let needsRender = false;
    if(target){
        const targetId = target.dataset.id;
        const fromId = originKind === 'out' ? originId : targetId;
        const toId = originKind === 'out' ? targetId : originId;
        const fromNode = nodes.find(n => n.id === fromId);
        const toNode = nodes.find(n => n.id === toId);
        if(fromNode && toNode) ensureLoopAcceptsConnection(fromNode, toNode);
        if(canConnect(fromId, toId)){
            if(!connections.some(c => c.from === fromId && c.to === toId)){
                try { pushUndo(); } catch(err) { console.warn('[infinite-canvas] undo snapshot failed', err); }
                connections.push({id:uid('c'), from:fromId, to:toId});
                if(fromNode?.type === 'promptGroup' && toNode?.type === 'loop') syncLoopCountFromPromptGroup(toNode, fromNode);
                if(fromNode?.type === 'imageBatch' && toNode?.type === 'loop') syncLoopCountFromImageBatch(toNode, fromNode);
                if(toNode?.type === 'loop') syncLoopImageBatchSize(toNode);
            }
            syncGeneratorInputs();
            scheduleSave();
            needsRender = true;
        }
    } else if(originKind === 'out'){
        if(source && CANVAS_GENERATOR_TYPES.includes(source.type)){
            const p = screenToWorld(clientX, clientY);
            try { pushUndo(); } catch(err) { console.warn('[infinite-canvas] undo snapshot failed', err); }
            const out = {id:uid('out'), type:'output', x:p.x, y:p.y - 63, images:[]};
            nodes.push(out);
            connections.push({id:uid('c'), from:source.id, to:out.id});
            syncGeneratorInputs();
            scheduleSave();
            needsRender = true;
        } else {
            openLinkCreateMenu(originId, originKind, clientX, clientY);
        }
    } else if(originKind === 'in'){
        openLinkCreateMenu(originId, originKind, clientX, clientY);
    }
    if(needsRender){
        syncCanvasModelFromState();
        render({ force: true });
        syncLinkDomToConnections();
        refreshGeometryAfterLayout();
    } else {
        renderLinks();
    }
}
function startLink(e, originId, originKind){
    e.preventDefault();
    e.stopPropagation();
    cancelTempLink();
    ensureLiveCanvasDom();
    originKind = originKind || 'out';
    const src = portPoint(originId, originKind);
    tempLink = {from:originId, originKind, x1:src.x, y1:src.y, x2:src.x, y2:src.y};
    refreshTempLinkDom();
    const pointerId = e.pointerId ?? null;
    let finished = false;
    const onMove = e2 => {
        if(!tempLink) return;
        if(pointerId != null && e2.pointerId != null && e2.pointerId !== pointerId) return;
        const p = screenToWorld(e2.clientX, e2.clientY);
        tempLink.x2 = p.x;
        tempLink.y2 = p.y;
        refreshTempLinkDom();
    };
    const onFinish = e2 => {
        if(finished || !tempLink) return;
        if(pointerId != null && e2.pointerId != null && e2.pointerId !== pointerId) return;
        if(e2.type === 'mouseup' && e2.button !== 0) return;
        if(e2.type === 'pointerup' && e2.button !== 0) return;
        finished = true;
        finishTempLink(e2);
    };
    const onCancel = () => cancelTempLink();
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('pointerup', onFinish, true);
    document.addEventListener('mouseup', onFinish, true);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('blur', onCancel);
    linkDragCleanup = () => {
        document.removeEventListener('pointermove', onMove, true);
        document.removeEventListener('mousemove', onMove, true);
        document.removeEventListener('pointerup', onFinish, true);
        document.removeEventListener('mouseup', onFinish, true);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('blur', onCancel);
    };
}
function nearestPort(clientX, clientY, kind){
    ensureLiveCanvasDom();
    if(!nodesEl) return null;
    const selector = `.port.${kind}`;
    const hit = document.elementFromPoint(clientX, clientY);
    const direct = hit?.closest?.(selector);
    if(direct) return direct;
    const hoverNode = hit?.closest?.('.node');
    if(hoverNode){
        const port = hoverNode.querySelector(selector);
        if(port) return port;
    }
    let best = null;
    let bestDistance = Infinity;
    nodesEl.querySelectorAll(selector).forEach(port => {
        const r = port.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(clientX - cx, clientY - cy);
        if(d < bestDistance){
            bestDistance = d;
            best = port;
        }
    });
    return bestDistance <= 96 ? best : null;
}
function wouldCreateGeneratorCycle(fromId, toId){
    const seen = new Set();
    const walk = id => {
        if(id === fromId) return true;
        if(seen.has(id)) return false;
        seen.add(id);
        for(const c of connections.filter(x => x.from === id)){
            if(walk(c.to)) return true;
            const next = nodes.find(n => n.id === c.to);
            if(next?.type === 'output' || next?.type === 'frameStack'){
                for(const cc of connections.filter(x => x.from === next.id)){
                    if(walk(cc.to)) return true;
                }
            }
        }
        return false;
    };
    return walk(toId);
}
function ensureLoopAcceptsConnection(from, to){
    if(!from || !to || to.type !== 'loop') return;
    if(['prompt','promptGroup','loop','llm'].includes(from.type) && !to.showPrompt) to.showPrompt = true;
    if(['image','group','output','frameStack','imageBatch'].includes(from.type) && !to.imageInput) to.imageInput = true;
    autoSizeLoopForPanels(to);
}
function loopPromptTextsForBatchInference(node){
    if(!node?.showPrompt) return [];
    const items = loopInputPromptItems(node);
    if(items.length) return items;
    const fixed = String(node.variablePrompt || '').trim();
    return fixed ? [fixed] : [];
}
function maxFigureIndexInLoopPrompts(node){
    let max = 0;
    const re = /图\s*(\d+)/g;
    loopPromptTextsForBatchInference(node).forEach(text => {
        let m;
        const src = String(text || '');
        while((m = re.exec(src))){
            max = Math.max(max, Number(m[1]) || 0);
        }
    });
    return max;
}
function syncLoopImageBatchSize(loopNode){
    if(!loopNode || loopNode.type !== 'loop' || !loopNode.imageInput) return;
    const refCount = loopAllConnectedImageRefs(loopNode).length;
    if(refCount <= 0) return;
    if(refCount === 1){
        if(Number(loopNode.imageBatchSize) !== 1){
            loopNode.imageBatchSize = 1;
            delete loopNode._loopBatchManual;
        }
        return;
    }
    if(loopNode._loopBatchManual) return;
    const promptNeed = maxFigureIndexInLoopPrompts(loopNode);
    const batch = Math.max(1, Math.min(100, Number(loopNode.imageBatchSize) || 1));
    let target = batch;
    if(promptNeed > 1) target = Math.max(batch, Math.min(promptNeed, refCount));
    else if(batch === 1) target = refCount;
    if(target !== batch) loopNode.imageBatchSize = Math.min(100, target);
}
function syncAllLoopImageBatchSizes(){
    nodes.filter(n => n.type === 'loop').forEach(syncLoopImageBatchSize);
}
function canConnect(fromId, toId){
    if(!fromId || !toId || fromId === toId) return false;
    const from = nodes.find(n => n.id === fromId);
    const to = nodes.find(n => n.id === toId);
    if(!from || !to) return false;
    if(to.type === 'replicaAgent'){
        if(['image','prompt','llm','frameStack','imageBatch','output','group','loop'].includes(from.type)) return true;
        return CANVAS_MEDIA_OUTPUT_TYPES.includes(from.type);
    }
    if(to.type === 'batchPosterAgent'){
        if(['image','group','output','frameStack','imageBatch'].includes(from.type)) return true;
        return CANVAS_MEDIA_OUTPUT_TYPES.includes(from.type);
    }
    if(to.type === 'nineGridAgent'){
        if(['prompt','promptGroup','loop','llm'].includes(from.type)) return true;
        if(['image','group','output','frameStack','imageBatch'].includes(from.type)) return true;
        return CANVAS_MEDIA_OUTPUT_TYPES.includes(from.type);
    }
    if(to.type === 'slotsLoopVideoAgent'){
        if(['prompt','promptGroup','loop','llm'].includes(from.type)) return true;
        if(['image','group','output','frameStack','imageBatch'].includes(from.type)) return true;
        return CANVAS_MEDIA_OUTPUT_TYPES.includes(from.type);
    }
    if(to.type === 'videoReverse') return ['image','prompt'].includes(from.type);
    if(to.type === 'frameStack'){
        if(from.type === 'image'){
            if(from.url && mediaKindForNode(from) === 'video') return true;
            if(String(to.sourceVideoId || '') === String(from.id)) return true;
        }
        return false;
    }
    if(from.type === 'frameStack'){
        if(to.type === 'output') return true;
        if(to.type === 'replicaAgent') return true;
        if(to.type === 'llm') return true;
        if(to.type === 'loop') return Boolean(to.imageInput);
        if(CANVAS_GENERATOR_TYPES.includes(to.type)) return !wouldCreateGeneratorCycle(fromId, toId);
        return false;
    }
    if(from.type === 'replicaAgent') return to.type === 'output';
    if(from.type === 'batchPosterAgent') return to.type === 'output';
    if(from.type === 'nineGridAgent') return to.type === 'output' || to.type === 'imageBatch';
    if(from.type === 'slotsLoopVideoAgent') return to.type === 'prompt' || to.type === 'promptGroup' || to.type === 'llm';
    if(from.type === 'videoReverse') return CANVAS_GENERATOR_TYPES.includes(to.type) || to.type === 'llm' || to.type === 'replicaAgent';
    if(CANVAS_GENERATOR_TYPES.includes(from.type)){
        if(to.type === 'output') return true;
        if(CANVAS_MEDIA_OUTPUT_TYPES.includes(from.type) && CANVAS_GENERATOR_TYPES.includes(to.type)){
            return !wouldCreateGeneratorCycle(fromId, toId);
        }
        return false;
    }
    if(to.type === 'loop'){
        const allowImage = Boolean(to.imageInput) && ['image','group','output','frameStack','imageBatch'].includes(from.type);
        const allowPrompt = Boolean(to.showPrompt) && ['prompt','promptGroup','loop','llm'].includes(from.type);
        return allowImage || allowPrompt;
    }
    if(to.type === 'llm') return ['prompt','loop','promptGroup','llm','image','group','output','frameStack','imageBatch'].includes(from.type);
    if(from.type === 'llm') return CANVAS_GENERATOR_TYPES.includes(to.type);
    return CANVAS_GENERATOR_TYPES.includes(to.type) && ['image','prompt','loop','group','promptGroup','output','llm','frameStack','imageBatch'].includes(from.type);
}
function sanitizeConnections(){
    connections = (connections || []).filter(c => canConnect(c.from, c.to));
}
function endDrag(event=null){
    clearBoardPanListeners();
    const panState = dragBoard;
    const nodeState = dragNode;
    const resizeState = resizeNode;
    const boardPanMoved = panState && pointerMovedEnough(panState.sx, panState.sy, event);
    const nodeDragMoved = nodeState && pointerMovedEnough(nodeState.sx, nodeState.sy, event);
    const resizeMoved = resizeState && pointerMovedEnough(resizeState.sx, resizeState.sy, event);
    let deferredMembership = null;
    if(nodeState && nodeDragMoved){
        if(event) lastMouseBoard = screenToWorld(event.clientX, event.clientY);
        const moved = [nodeState.node, ...(nodeState.children || []).map(c => c.node)].filter(Boolean);
        const draggedGroup = moved.some(n => n.type === 'group' || n.type === 'promptGroup' || n.type === 'imageBatch');
        if(!draggedGroup) deferredMembership = moved;
    }
    if(resizeMoved && resizeState?.node) resizeState.node._userSized = true;
    pendingNodeDrag = null;
    dragNode = null;
    dragBoard = null;
    resizeNode = null;
    llmPaneDrag = null;
    knifeActive = false;
    knifePoint = null;
    knifeTrail = [];
    const shouldRenderKnife = knifeNeedsRender;
    knifeChanged = false;
    knifeNeedsRender = false;
    if(!event?.shiftKey) setKnifeMode(false);
    if(textSelectionGuard) textSelectionGuard.active = false;
    requestAnimationFrame(() => {
        withCanvasRootClass(list => list.remove('canvas-node-drag', 'canvas-node-resize', 'canvas-selecting'));
    });
    board?.classList.remove('is-panning');
    cancelTempLink();
    window.onmousemove = null;
    window.onmouseup = null;
    if(shouldRenderKnife) safeRender({ force: true });
    if(boardPanMoved || nodeDragMoved || resizeMoved) lastBoardInteractionAt = Date.now();
    clearGroupDropHighlights();
    if(nodeDragMoved || resizeMoved || nodeState?.duplicateCreated){
        scheduleNodeDragSave();
        requestAnimationFrame(() => {
            refreshGeometryAfterLayout();
            if(minimapState) updateMinimapNodePositions();
            else scheduleMinimapRender({ positionsOnly: true });
            if(deferredMembership){
                const snapped = snapNodesToGroups(deferredMembership, lastMouseBoard);
                if(snapped){
                    scheduleLinkGeometryRefresh(new Set(deferredMembership.map(n => n.id)));
                    if(minimapState) updateMinimapNodePositions();
                    else scheduleMinimapRender({ positionsOnly: true });
                }
                updateGroupMembership(deferredMembership);
            }
        });
    } else if(boardPanMoved) scheduleViewportSave();
}
function nodeRect(n){
    const el = nodesEl.querySelector(`.node[data-id="${n.id}"]`);
    const w = el?.offsetWidth || n.w || 260;
    const h = el?.offsetHeight || n.h || 200;
    return {x:n.x, y:n.y, w, h, cx:n.x + w/2, cy:n.y + h/2};
}
function handoffExistingInputsToGroup(group, children){
    if(!group || !['group','promptGroup','imageBatch'].includes(group.type)) return false;
    const childIds = new Set((children || []).filter(n => {
        if(group.type === 'promptGroup') return n?.type === 'prompt';
        return n?.type === 'image';
    }).map(n => n.id));
    if(!childIds.size) return false;
    const targetIds = new Set();
    connections.forEach(c => {
        if(!childIds.has(c.from)) return;
        const target = nodes.find(n => n.id === c.to);
        if(isGroupHandoffTarget(group.type, target)) targetIds.add(target.id);
    });
    if(!targetIds.size) return false;
    connections = connections.filter(c => !(childIds.has(c.from) && targetIds.has(c.to)));
    targetIds.forEach(targetId => {
        const target = nodes.find(n => n.id === targetId);
        if(group.type === 'promptGroup' && target?.type === 'loop') ensureLoopAcceptsConnection(group, target);
        if(group.type === 'imageBatch' && target?.type === 'loop') ensureLoopAcceptsConnection(group, target);
        if(!connections.some(c => c.from === group.id && c.to === targetId) && canConnect(group.id, targetId)){
            connections.push({id:uid('c'), from:group.id, to:targetId});
        }
        if(group.type === 'promptGroup'){
            const target = nodes.find(n => n.id === targetId);
            syncLoopCountFromPromptGroup(target, group);
        }
        if(group.type === 'imageBatch'){
            const target = nodes.find(n => n.id === targetId);
            syncLoopCountFromImageBatch(target, group);
        }
    });
    return true;
}
const GROUP_MEMBERSHIP_PAIRS = [
    {childType:'image', groupType:'group'},
    {childType:'image', groupType:'imageBatch'},
    {childType:'prompt', groupType:'promptGroup'}
];
function isCenterInGroupRect(childRect, groupRect){
    return childRect.cx >= groupRect.x && childRect.cx <= groupRect.x + groupRect.w
        && childRect.cy >= groupRect.y && childRect.cy <= groupRect.y + groupRect.h;
}
function findGroupByCenter(child, groupType){
    return findGroupForChild(child, groupType, null);
}
function findContainingGroupForChild(child, point=null){
    for(const {childType, groupType} of GROUP_MEMBERSHIP_PAIRS){
        if(child.type !== childType) continue;
        const group = findGroupForChild(child, groupType, point);
        if(group) return group;
    }
    return null;
}
function clearGroupDropHighlights(){
    groupDropHighlightIds.forEach(id => {
        nodesEl.querySelector(`.node[data-id="${CSS.escape(id)}"]`)?.classList.remove('group-drop-target');
    });
    groupDropHighlightIds = new Set();
}
function updateGroupDropHighlights(movingNodes, point=null){
    if(movingNodes.some(n => n?.type === 'group' || n?.type === 'promptGroup' || n?.type === 'imageBatch')){
        clearGroupDropHighlights();
        return;
    }
    const nextIds = new Set();
    movingNodes.forEach(node => {
        const group = findContainingGroupForChild(node, point);
        if(group) nextIds.add(group.id);
    });
    groupDropHighlightIds.forEach(id => {
        if(!nextIds.has(id)){
            nodesEl.querySelector(`.node[data-id="${CSS.escape(id)}"]`)?.classList.remove('group-drop-target');
        }
    });
    nextIds.forEach(id => {
        if(!groupDropHighlightIds.has(id)){
            nodesEl.querySelector(`.node[data-id="${CSS.escape(id)}"]`)?.classList.add('group-drop-target');
        }
    });
    groupDropHighlightIds = nextIds;
}
function snapNodeIntoGroup(node, group){
    const cr = nodeRect(node);
    const gr = nodeRect(group);
    const inZone = (group.type === 'imageBatch' || group.type === 'promptGroup')
        ? isChildDropTargetForGroup(group, node, null)
        : isCenterInGroupRect(cr, gr);
    if(!inZone) return false;
    const pad = GROUP_DROP_SNAP_PADDING;
    const headInset = groupPanelHeadInset(group);
    const handleInset = groupUsesResizeHandleInset(group) ? GROUP_RESIZE_HANDLE_INSET : 0;
    const minX = gr.x + pad;
    const minY = gr.y + headInset;
    const maxX = gr.x + gr.w - cr.w - pad - handleInset;
    const maxY = gr.y + gr.h - cr.h - pad - handleInset;
    let nx = node.x;
    let ny = node.y;
    if(cr.w <= gr.w - pad * 2) nx = Math.max(minX, Math.min(maxX, node.x));
    if(cr.h <= gr.h - headInset - pad) ny = Math.max(minY, Math.min(maxY, node.y));
    if(nx === node.x && ny === node.y) return false;
    node.x = nx;
    node.y = ny;
    const el = nodesEl.querySelector(`.node[data-id="${CSS.escape(node.id)}"]`);
    if(el){
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
    }
    return true;
}
function snapNodesToGroups(movingNodes, point=null){
    if(movingNodes.some(n => n?.type === 'group' || n?.type === 'promptGroup' || n?.type === 'imageBatch')) return false;
    let snapped = false;
    movingNodes.forEach(node => {
        const group = findContainingGroupForChild(node, point);
        if(group && snapNodeIntoGroup(node, group)) snapped = true;
    });
    return snapped;
}
function updateGroupMembership(movedNodes){
    const pairs = GROUP_MEMBERSHIP_PAIRS;
    let changed = false;
    const handoffGroupConnections = (group, child) => {
        if(!group || !['group','promptGroup','imageBatch'].includes(group?.type)) return;
        if(group.type === 'promptGroup' && child?.type !== 'prompt') return;
        if((group.type === 'group' || group.type === 'imageBatch') && child?.type !== 'image') return;
        const directTargets = connections
            .filter(c => c.from === child.id)
            .map(c => nodes.find(n => n.id === c.to))
            .filter(n => isGroupHandoffTarget(group.type, n));
        const groupTargets = connections
            .filter(c => c.from === group.id)
            .map(c => nodes.find(n => n.id === c.to))
            .filter(n => isGroupHandoffTarget(group.type, n));
        const targets = new Map([...directTargets, ...groupTargets].map(n => [n.id, n]));
        targets.forEach(target => {
            if(group.type === 'promptGroup' && target?.type === 'loop') ensureLoopAcceptsConnection(group, target);
            if(group.type === 'imageBatch' && target?.type === 'loop') ensureLoopAcceptsConnection(group, target);
            const before = connections.length;
            connections = connections.filter(c => !(c.from === child.id && c.to === target.id));
            if(connections.length !== before) changed = true;
            if(!connections.some(c => c.from === group.id && c.to === target.id) && canConnect(group.id, target.id)){
                connections.push({id:uid('c'), from:group.id, to:target.id});
                changed = true;
            }
            if(group.type === 'promptGroup') syncLoopCountFromPromptGroup(target, group);
            if(group.type === 'imageBatch') syncLoopCountFromImageBatch(target, group);
        });
    };
    pairs.forEach(({childType, groupType}) => {
        const groups = nodes.filter(n => n.type === groupType);
        const children = movedNodes.filter(n => n?.type === childType);
        if(!children.length || !groups.length) return;
        children.forEach(child => {
            const containing = findGroupForChild(child, groupType, lastMouseBoard);
            groups.forEach(g => {
                if(g === containing) return;
                const idx = (g.items || []).indexOf(child.id);
                if(idx >= 0){
                    g.items.splice(idx, 1);
                    changed = true;
                    if(g.type === 'promptGroup') syncPromptGroupDownstreamLoops(g);
                }
            });
            if(containing){
                containing.items = containing.items || [];
                if(!containing.items.includes(child.id)){ containing.items.push(child.id); changed = true; }
                handoffGroupConnections(containing, child);
            }
        });
    });
    if(changed){
        nodes.filter(n => n.type === 'promptGroup').forEach(g => {
            if(prunePromptGroupItems(g)) syncPromptGroupDownstreamLoops(g);
        });
        reflowGroupsForMovedChildren(movedNodes, 'auto');
        syncGeneratorInputs();
        refreshGeneratorInputViews();
        syncLinkDomToConnections();
        const panelGroupIds = nodes.filter(n => n.type === 'imageBatch' || n.type === 'promptGroup').map(n => n.id);
        if(panelGroupIds.length) refreshNodes(panelGroupIds);
        relayoutGroupsWithMeasuredChrome(panelGroupIds, 'auto');
        requestAnimationFrame(() => {
            relayoutGroupsWithMeasuredChrome(panelGroupIds, 'auto');
            scheduleLinkGeometryRefresh(new Set(panelGroupIds.flatMap(id => {
                const g = nodes.find(n => n.id === id);
                return g ? [g.id, ...(g.items || [])] : [id];
            })));
        });
    }
}

function portPointFromLayout(n, kind, el){
    const { w, h } = nodeLayoutSize(n, el);
    const y = n.y + h / 2;
    if(kind === 'out') return { x: n.x + w + PORT_ANCHOR_DX.out, y };
    return { x: n.x + PORT_ANCHOR_DX.in, y };
}
function portPoint(id, kind){
    ensureLiveCanvasDom();
    const n = nodes.find(x => x.id === id);
    const el = nodesEl?.querySelector(`.node[data-id="${CSS.escape(id)}"]`);
    if(!n || !el) return {x:0, y:0};
    const port = el.querySelector(`.port.${kind}`);
    if(port){
        const r = port.getBoundingClientRect();
        return screenToWorld(r.left + r.width / 2, r.top + r.height / 2);
    }
    return portPointFromLayout(n, kind, el);
}
function linkPathD(x1, y1, x2, y2){
    const dx = Math.max(80, Math.abs(x2 - x1) * .45);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
function linksGeometryStale(){
    if(!linksEl) return true;
    return linksEl.querySelectorAll('path.link-hit[data-connection-id]').length !== connections.length;
}
function pruneOrphanLinkDom(){
    if(!linksEl || !linkControlsEl) return;
    const ids = new Set(connections.map(c => c.id));
    linksEl.querySelectorAll('path[data-connection-id]').forEach(path => {
        if(!ids.has(path.dataset.connectionId)) path.remove();
    });
    linkControlsEl.querySelectorAll('.link-delete[data-connection-id]').forEach(btn => {
        if(!ids.has(btn.dataset.connectionId)) btn.remove();
    });
}
function isNodeLinkFlowing(node){
    return node && !isNodeDisabled(node) && (node.running === true || node.runStatus === 'running');
}
function linkClassForConnection(fromNode, toNode){
    if(isNodeDisabled(fromNode) || isNodeDisabled(toNode)) return 'link link-inactive';
    if(isNodeLinkFlowing(fromNode) || isNodeLinkFlowing(toNode)) return 'link link-flowing';
    return 'link';
}
function syncLinkFlowForNodes(nodeIds){
    if(!linksEl || !nodeIds?.length) return;
    const touch = new Set(nodeIds);
    connections.forEach(c => {
        if(!touch.has(c.from) && !touch.has(c.to)) return;
        const visible = linksEl.querySelector(`path.link[data-connection-id="${CSS.escape(c.id)}"]`);
        if(!visible) return;
        const fromNode = nodes.find(n => n.id === c.from);
        const toNode = nodes.find(n => n.id === c.to);
        const cls = linkClassForConnection(fromNode, toNode);
        if(visible.getAttribute('class') !== cls) visible.setAttribute('class', cls);
    });
}
function ensureConnectionLinkDom(c){
    if(!linksEl || !linkControlsEl || !c) return;
    const a = portPoint(c.from, 'out');
    const b = portPoint(c.to, 'in');
    const d = linkPathD(a.x, a.y, b.x, b.y);
    const fromNode = nodes.find(n => n.id === c.from);
    const toNode = nodes.find(n => n.id === c.to);
    const cls = linkClassForConnection(fromNode, toNode);
    let visible = linksEl.querySelector(`path.link[data-connection-id="${CSS.escape(c.id)}"]`);
    let hit = linksEl.querySelector(`path.link-hit[data-connection-id="${CSS.escape(c.id)}"]`);
    if(!visible){
        visible = pathEl(a.x, a.y, b.x, b.y, cls, c.id);
        linksEl.appendChild(visible);
    } else {
        visible.setAttribute('d', d);
        if(visible.getAttribute('class') !== cls) visible.setAttribute('class', cls);
    }
    if(!hit){
        linksEl.appendChild(linkHitEl(a.x, a.y, b.x, b.y, c.id));
    } else {
        hit.setAttribute('d', d);
    }
    let btn = linkControlsEl.querySelector(`.link-delete[data-connection-id="${CSS.escape(c.id)}"]`);
    if(!btn){
        btn = linkDeleteButton(c, a, b);
        linkControlsEl.appendChild(btn);
    } else {
        btn.style.left = `${(a.x + b.x) / 2}px`;
        btn.style.top = `${(a.y + b.y) / 2}px`;
    }
}
function syncLinkDomToConnections(){
    if(!linksEl || !linkControlsEl) return;
    pruneOrphanLinkDom();
    connections.forEach(c => ensureConnectionLinkDom(c));
    if(tempLink){
        let tempPath = linksEl.querySelector('path.link.temp');
        const d = linkPathD(tempLink.x1, tempLink.y1, tempLink.x2, tempLink.y2);
        if(!tempPath){
            tempPath = pathEl(tempLink.x1, tempLink.y1, tempLink.x2, tempLink.y2, 'link temp');
            linksEl.appendChild(tempPath);
        } else {
            tempPath.setAttribute('d', d);
        }
    }
    if(knifeActive) renderKnifeTrail();
}
function updateLinksGeometry(onlyNodeIds=null){
    if(!linksEl || !linkControlsEl) return;
    const touch = id => !onlyNodeIds || onlyNodeIds.has(id);
    const targetConnections = onlyNodeIds
        ? connections.filter(c => touch(c.from) || touch(c.to))
        : connections;
    if(linksGeometryStale()){
        if(isCanvasInteracting() || Date.now() - lastBoardInteractionAt < CANVAS_INTERACTION_COOLDOWN_MS){
            if(onlyNodeIds){
                targetConnections.forEach(c => ensureConnectionLinkDom(c));
            } else {
                syncLinkDomToConnections();
            }
            refreshGeometryAfterLayout();
            return;
        }
        renderLinks();
        return;
    }
    targetConnections.forEach(c => ensureConnectionLinkDom(c));
    if(tempLink){
        const d = linkPathD(tempLink.x1, tempLink.y1, tempLink.x2, tempLink.y2);
        const tempPath = linksEl.querySelector('path.link.temp');
        if(tempPath) tempPath.setAttribute('d', d);
    }
    if(knifeActive) renderKnifeTrail();
}
function scheduleLinkGeometryRefresh(onlyNodeIds=null){
    if(onlyNodeIds){
        const next = onlyNodeIds instanceof Set ? onlyNodeIds : new Set(onlyNodeIds);
        linkGeomFilter = linkGeomFilter ? new Set([...linkGeomFilter, ...next]) : next;
    }
    if(linkGeomQueued) return;
    linkGeomQueued = true;
    requestAnimationFrame(() => {
        updateLinksGeometry(linkGeomFilter);
        linkGeomFilter = null;
        linkGeomQueued = false;
    });
}
function renderLinks(){
    ensureLiveCanvasDom();
    if(!linksEl || !linkControlsEl) return;
    linksEl.innerHTML = '';
    linkControlsEl.innerHTML = '';
    connections.forEach(c => {
        const a = portPoint(c.from, 'out'), b = portPoint(c.to, 'in');
        const fromNode = nodes.find(n => n.id === c.from);
        const toNode = nodes.find(n => n.id === c.to);
        const line = pathEl(a.x, a.y, b.x, b.y, linkClassForConnection(fromNode, toNode), c.id);
        linksEl.appendChild(line);
        const btn = linkDeleteButton(c, a, b);
        linkControlsEl.appendChild(btn);
        linksEl.appendChild(linkHitEl(a.x, a.y, b.x, b.y, c.id));
    });
    if(tempLink){
        setTempLinkLayerActive(true);
        linksEl.appendChild(pathEl(tempLink.x1, tempLink.y1, tempLink.x2, tempLink.y2, 'link temp'));
    } else {
        setTempLinkLayerActive(false);
    }
    renderKnifeTrail();
}
function renderKnifeTrail(){
    if(!knifeActive || knifeTrail.length < 2) return;
    const poly = document.createElementNS('http://www.w3.org/2000/svg','polyline');
    poly.setAttribute('points', knifeTrail.map(p => `${p.x},${p.y}`).join(' '));
    poly.setAttribute('class', 'link knife-trail');
    linksEl.appendChild(poly);
}
function linkDeleteButton(connection, a, b){
    const btn = document.createElement('button');
    btn.className = `link-delete ${isConnectionSelected(connection) ? 'visible' : ''} ${hoveredConnectionId === connection.id ? 'hover' : ''}`;
    btn.type = 'button';
    btn.title = tr('canvas.deleteLink');
    btn.setAttribute('aria-label', tr('canvas.deleteLink'));
    btn.dataset.connectionId = connection.id;
    btn.style.left = `${(a.x + b.x) / 2}px`;
    btn.style.top = `${(a.y + b.y) / 2}px`;
    btn.textContent = '×';
    btn.onmousedown = e => {
        e.preventDefault();
        e.stopPropagation();
    };
    return btn;
}
function linkHitEl(x1,y1,x2,y2,id){
    const p = pathEl(x1, y1, x2, y2, 'link-hit');
    p.dataset.connectionId = id;
    return p;
}
function setHoveredConnection(id){
    if(hoveredConnectionId === id) return;
    const oldId = hoveredConnectionId;
    hoveredConnectionId = id || '';
    if(oldId){
        const oldBtn = linkControlsEl.querySelector(`[data-connection-id="${CSS.escape(oldId)}"]`);
        if(oldBtn) oldBtn.classList.remove('hover');
    }
    if(hoveredConnectionId){
        const btn = linkControlsEl.querySelector(`[data-connection-id="${CSS.escape(hoveredConnectionId)}"]`);
        if(btn) btn.classList.add('hover');
    }
}
function connectionDistanceToPoint(connection, point, from=null, to=null){
    from = from || portPoint(connection.from, 'out');
    to = to || portPoint(connection.to, 'in');
    let min = Infinity;
    let prev = cubicPoint(from, to, 0);
    for(let i = 1; i <= 28; i++){
        const cur = cubicPoint(from, to, i / 28);
        min = Math.min(min, pointSegmentDistance(point, prev, cur));
        prev = cur;
    }
    return min;
}
function scheduleConnectionHoverUpdate(e){
    connHoverPendingEvent = e;
    if(connHoverRAF) return;
    connHoverRAF = requestAnimationFrame(() => {
        connHoverRAF = 0;
        const event = connHoverPendingEvent;
        connHoverPendingEvent = null;
        if(!event) return;
        const now = Date.now();
        if(now - connHoverLastAt < CONN_HOVER_MIN_MS){
            scheduleConnectionHoverUpdate(event);
            return;
        }
        connHoverLastAt = now;
        updateConnectionHoverFromMouse(event);
    });
}
function updateConnectionHoverFromMouse(e){
    if(!canvas || tempLink || dragNode || dragBoard || resizeNode || knifeActive){
        setHoveredConnection('');
        return;
    }
    const button = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('.link-delete');
    if(button?.dataset.connectionId){
        setHoveredConnection(button.dataset.connectionId);
        return;
    }
    const point = screenToWorld(e.clientX, e.clientY);
    const threshold = Math.max(12, 16 / viewport.scale);
    let bestId = '';
    let best = Infinity;
    connections.forEach(c => {
        const from = portPoint(c.from, 'out');
        const to = portPoint(c.to, 'in');
        const pad = threshold;
        if(point.x < Math.min(from.x, to.x) - pad || point.x > Math.max(from.x, to.x) + pad ||
            point.y < Math.min(from.y, to.y) - pad || point.y > Math.max(from.y, to.y) + pad) return;
        const d = connectionDistanceToPoint(c, point, from, to);
        if(d < best){ best = d; bestId = c.id; }
    });
    setHoveredConnection(best <= threshold ? bestId : '');
}
function isConnectionSelected(connection){
    return selected.has(connection.from) || selected.has(connection.to);
}
function updateLinkSelectionState(){
    if(!linkControlsEl) return;
    linkControlsEl.querySelectorAll('.link-delete').forEach(btn => {
        const conn = connections.find(c => c.id === btn.dataset.connectionId);
        if(conn) btn.classList.toggle('visible', isConnectionSelected(conn));
    });
}
function updateMinimapSelection(){
    if(!minimapContent) return;
    minimapContent.querySelectorAll('.minimap-node[data-node-id]').forEach(el => {
        const should = selected.has(el.dataset.nodeId);
        if(el.classList.contains('selected') !== should) el.classList.toggle('selected', should);
    });
}
function refreshSelectionVisuals(){
    nodesEl.querySelectorAll('.node').forEach(el => {
        const should = selected.has(el.dataset.id);
        if(el.classList.contains('selected') !== should) el.classList.toggle('selected', should);
    });
    updateLinkSelectionState();
    updateMinimapSelection();
}
/** 单击/拖拽前更新选中态（Ctrl/Cmd 多选） */
function applyNodeSelection(nodeId, e){
    if(!nodeId) return false;
    let changed = false;
    if(e?.ctrlKey || e?.metaKey){
        if(selected.has(nodeId)) selected.delete(nodeId);
        else selected.add(nodeId);
        changed = true;
    } else if(!selected.has(nodeId) || selected.size !== 1){
        selected.clear();
        selected.add(nodeId);
        changed = true;
    }
    if(changed) refreshSelectionVisuals();
    return changed;
}
function pathEl(x1,y1,x2,y2,cls, connectionId=null){
    const p = document.createElementNS('http://www.w3.org/2000/svg','path');
    p.setAttribute('d', linkPathD(x1, y1, x2, y2));
    p.setAttribute('class', cls);
    if(connectionId) p.dataset.connectionId = connectionId;
    return p;
}
function pointSegmentDistance(p, a, b){
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    if(!len2) return Math.hypot(p.x - a.x, p.y - a.y);
    const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
    return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
function segmentsIntersect(a, b, c, d){
    const orient = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const onSeg = (p, q, r) => Math.min(p.x, r.x) <= q.x && q.x <= Math.max(p.x, r.x) && Math.min(p.y, r.y) <= q.y && q.y <= Math.max(p.y, r.y);
    const o1 = orient(a, b, c), o2 = orient(a, b, d), o3 = orient(c, d, a), o4 = orient(c, d, b);
    if(o1 === 0 && onSeg(a, c, b)) return true;
    if(o2 === 0 && onSeg(a, d, b)) return true;
    if(o3 === 0 && onSeg(c, a, d)) return true;
    if(o4 === 0 && onSeg(c, b, d)) return true;
    return (o1 > 0) !== (o2 > 0) && (o3 > 0) !== (o4 > 0);
}
function segmentIntersectsRect(a, b, r){
    if(a.x >= r.x && a.x <= r.x + r.w && a.y >= r.y && a.y <= r.y + r.h) return true;
    if(b.x >= r.x && b.x <= r.x + r.w && b.y >= r.y && b.y <= r.y + r.h) return true;
    const p1 = {x:r.x, y:r.y}, p2 = {x:r.x + r.w, y:r.y}, p3 = {x:r.x + r.w, y:r.y + r.h}, p4 = {x:r.x, y:r.y + r.h};
    return segmentsIntersect(a, b, p1, p2) || segmentsIntersect(a, b, p2, p3) || segmentsIntersect(a, b, p3, p4) || segmentsIntersect(a, b, p4, p1);
}
function cubicPoint(a, b, t){
    const dx = Math.max(80, Math.abs(b.x - a.x) * .45);
    const p1 = {x:a.x + dx, y:a.y};
    const p2 = {x:b.x - dx, y:b.y};
    const u = 1 - t;
    return {
        x:u*u*u*a.x + 3*u*u*t*p1.x + 3*u*t*t*p2.x + t*t*t*b.x,
        y:u*u*u*a.y + 3*u*u*t*p1.y + 3*u*t*t*p2.y + t*t*t*b.y
    };
}
function knifeHitsConnection(a, b, connection){
    const from = portPoint(connection.from, 'out');
    const to = portPoint(connection.to, 'in');
    const threshold = Math.max(8, 12 / viewport.scale);
    let prev = cubicPoint(from, to, 0);
    for(let i = 1; i <= 28; i++){
        const cur = cubicPoint(from, to, i / 28);
        if(segmentsIntersect(a, b, prev, cur) || pointSegmentDistance(prev, a, b) <= threshold || pointSegmentDistance(cur, a, b) <= threshold) return true;
        prev = cur;
    }
    return false;
}
function applyKnifeCut(from, to){
    if(!canvas || !connections.length || !from || !to) return;
    const nodeHits = new Set();
    nodes.forEach(n => {
        const el = nodesEl.querySelector(`.node[data-id="${n.id}"]`);
        if(!el) return;
        const r = nodeRect(n);
        if(segmentIntersectsRect(from, to, r)) nodeHits.add(n.id);
    });
    const next = connections.filter(c => !nodeHits.has(c.from) && !nodeHits.has(c.to) && !knifeHitsConnection(from, to, c));
    if(next.length === connections.length) return;
    if(!knifeChanged) pushUndo();
    knifeChanged = true;
    connections = next;
    syncGeneratorInputs();
    refreshGeneratorInputViews();
    knifeNeedsRender = true;
    renderLinks();
    scheduleSave();
}
function setKnifeMode(active){
    withCanvasRootClass(list => list.toggle('canvas-knife', Boolean(active && canvas)));
    if(!active){
        knifeActive = false;
        knifePoint = null;
        knifeTrail = [];
        knifeChanged = false;
        knifeNeedsRender = false;
        renderLinks();
    }
}
function startKnifeDrag(e){
    if(!canvas || e.button !== 0 || !e.shiftKey || isEditableTarget(e.target)) return false;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    closeCreateMenu();
    setKnifeMode(true);
    knifeActive = true;
    knifeChanged = false;
    knifeNeedsRender = false;
    knifePoint = screenToWorld(e.clientX, e.clientY);
    knifeTrail = [knifePoint];
    renderLinks();
    window.onmousemove = continueKnifeDrag;
    window.onmouseup = endDrag;
    return true;
}
function continueKnifeDrag(e){
    if(!canvas || !knifeActive) return;
    if(!e.shiftKey){
        setKnifeMode(false);
        return;
    }
    const point = screenToWorld(e.clientX, e.clientY);
    if(knifePoint) applyKnifeCut(knifePoint, point);
    knifePoint = point;
    knifeTrail.push(point);
    if(knifeTrail.length > 120) knifeTrail = knifeTrail.slice(-120);
    renderLinks();
}
function isEditableTarget(target){
    const tag = target?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable || target?.closest?.('select, option');
}
minimap?.addEventListener('mousedown', e => {
    if(!canvas || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    minimapDrag = true;
    centerViewportOnWorldPoint(minimapEventToWorld(e));
    window.onmousemove = e2 => {
        if(minimapDrag) centerViewportOnWorldPoint(minimapEventToWorld(e2));
    };
    window.onmouseup = () => {
        minimapDrag = false;
        lastBoardInteractionAt = Date.now();
        window.onmousemove = null;
        window.onmouseup = null;
        scheduleViewportSave();
    };
});
function startBoardPan(e, opts={}){
    if(!canvas || !board) return false;
    if(dragBoard) return true;
    const allowOverNodes = Boolean(opts.allowOverNodes);
    if(allowOverNodes ? !canStartForcedPanFromTarget(e.target) : !canStartBoardPanFromTarget(e.target)) return false;
    e.preventDefault();
    e.stopPropagation();
    closeCreateMenu();
    if(document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    dragBoard = {sx:e.clientX, sy:e.clientY, ox:viewport.x, oy:viewport.y, chromeActive: false};
    const pointerId = e.pointerId;
    if(pointerId != null && typeof board.setPointerCapture === 'function'){
        try { board.setPointerCapture(pointerId); } catch(_) {}
    }
    const onPanMove = e2 => {
        if(!dragBoard) return;
        if(!dragBoard.chromeActive){
            if(!pointerMovedEnough(dragBoard.sx, dragBoard.sy, e2)) return;
            dragBoard.chromeActive = true;
            board.classList.add('is-panning');
        }
        lastBoardInteractionAt = Date.now();
        viewport.x = dragBoard.ox + e2.clientX - dragBoard.sx;
        viewport.y = dragBoard.oy + e2.clientY - dragBoard.sy;
        applyViewport();
    };
    const onPanEnd = e2 => {
        clearBoardPanListeners();
        board.classList.remove('is-panning');
        if(pointerId != null && typeof board.releasePointerCapture === 'function'){
            try { board.releasePointerCapture(pointerId); } catch(_) {}
        }
        endDrag(e2);
    };
    clearBoardPanListeners();
    window.addEventListener('mousemove', onPanMove);
    window.addEventListener('mouseup', onPanEnd);
    window.addEventListener('pointermove', onPanMove);
    window.addEventListener('pointerup', onPanEnd);
    window.addEventListener('pointercancel', onPanEnd);
    boardPanCleanup = () => {
        board?.classList.remove('is-panning');
        window.removeEventListener('mousemove', onPanMove);
        window.removeEventListener('mouseup', onPanEnd);
        window.removeEventListener('pointermove', onPanMove);
        window.removeEventListener('pointerup', onPanEnd);
        window.removeEventListener('pointercancel', onPanEnd);
    };
    return true;
}

function wireBoardEvents() {
if(!board || boardEventsWired) return;
boardEventsWired = true;
if(canvasRoot){
    on(canvasRoot, 'pointerdown', e => {
        if(!e.target.closest?.('.node-delete-btn')) return;
        e.stopPropagation();
    }, true);
    on(canvasRoot, 'pointerdown', e => {
        const port = e.target.closest?.('.port');
        if(!port || !canvas || e.button !== 0 || e.shiftKey) return;
        const nodeEl = port.closest('.node');
        const id = nodeEl?.dataset?.id;
        if(!id) return;
        e.preventDefault();
        e.stopPropagation();
        startLink(e, id, port.classList.contains('in') ? 'in' : 'out');
    }, true);
    on(canvasRoot, 'pointerdown', e => {
        if(!e.target.closest?.('.link-delete')) return;
        e.preventDefault();
        e.stopPropagation();
    }, true);
    on(canvasRoot, 'click', e => {
        const linkBtn = e.target.closest?.('.link-delete');
        if(linkBtn && canvas){
            const connId = linkBtn.dataset.connectionId;
            if(connId){
                e.preventDefault();
                e.stopPropagation();
                deleteConnection(connId, e);
                return;
            }
        }
        const btn = e.target.closest?.('.node-delete-btn');
        if(!btn || !canvas) return;
        const nodeEl = btn.closest('.node');
        const id = nodeEl?.dataset?.id;
        if(!id) return;
        e.preventDefault();
        e.stopPropagation();
        deleteNodeFromButton(id, e);
    }, true);
}
on(window, 'mousedown', preventCanvasMiddleMouseDefault, { capture: true });
on(window, 'auxclick', preventCanvasMiddleMouseDefault, { capture: true });
if(canvasRoot){
    on(canvasRoot, 'mousedown', e => {
        if(e.button === 1) e.preventDefault();
    }, { capture: true });
    on(canvasRoot, 'auxclick', e => {
        if(e.button === 1) e.preventDefault();
    }, { capture: true });
}
const onBoardPointerDown = e => {
    if(!canvas) return;
    if(e.button === 1){
        if(startBoardPan(e, {allowOverNodes:true})) return;
    }
};
board.onmousedown = e => {
    if(!canvas) return;
    if(e.button === 1){
        e.preventDefault();
        startBoardPan(e, {allowOverNodes:true});
        return;
    }
    if(e.button !== 0) return;
    if(startKnifeDrag(e)) return;
    closeAllCanvasCustomSelects();
    // Dismiss any open native select dropdown
    if(document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    if(spacePanArmed){
        if(canStartForcedPanFromTarget(e.target)) startBoardPan(e, {allowOverNodes:true});
        return;
    }
    if(!canStartBoardPanFromTarget(e.target)) return;
    closeCreateMenu();
    if(e.ctrlKey || e.metaKey){
        e.preventDefault();
        startSelection(e);
        return;
    }
    if(selected.size){
        selected.clear();
        refreshSelectionVisuals();
    }
    startBoardPan(e);
};
on(board, 'pointerdown', onBoardPointerDown);
on(board, 'mousemove', e => {
    const point = screenToWorld(e.clientX, e.clientY);
    lastMouseBoard = point;
    scheduleConnectionHoverUpdate(e);
    schedulePortMagnetUpdate(e.clientX, e.clientY);
    if(canvas && knifeActive && !isEditableTarget(e.target) && !dragNode && !dragBoard && !resizeNode && !tempLink){
        continueKnifeDrag(e);
    } else if(!e.shiftKey) {
        setKnifeMode(false);
    }
});
on(board, 'mouseleave', () => { setHoveredConnection(''); clearAllPortMagnet(); });
board.ondblclick = null;
on(board, 'contextmenu', e => {
    if(!canvas) return;
    closeSelectionMenu();
    if(selected.size >= 1 && isPointInSelectedRegion(e.clientX, e.clientY)){
        e.preventDefault();
        e.stopPropagation();
        closeCreateMenu();
        openSelectionMenu(e.clientX, e.clientY);
    }
}, true);
board.oncontextmenu = e => {
    if(!canvas) return;
    if(!canStartBoardPanFromTarget(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    closeSelectionMenu();
    openCreateMenu(e.clientX, e.clientY);
};
on(board, 'mousedown', e => {
    if(e.target.closest?.('#createMenu, #linkCreateMenu, #nodeInputMenu, #nodeOutputMenu, #imageNodeMenu, #selectionMenu')) return;
    closeCreateMenu();
    closeSelectionMenu();
});
on(board, 'auxclick', e => {
    if(e.button === 1) e.preventDefault();
});
on(board, "wheel", e => {
    if(!canvas || !board) return;
    if(isOpenScrollableCanvasMenu(e.target)) return;
    if(e.target.closest('.error-message, .node-retry-msg')) return;
    e.preventDefault();
    lastBoardInteractionAt = Date.now();
    const before = screenToWorld(e.clientX, e.clientY);
    viewport.scale = Math.min(3, Math.max(0.08, viewport.scale * (e.deltaY > 0 ? .92 : 1.08)));
    const rect = board.getBoundingClientRect();
    viewport.x = e.clientX - rect.left - before.x * viewport.scale;
    viewport.y = e.clientY - rect.top - before.y * viewport.scale;
    applyViewport();
    scheduleViewportSave();
}, { passive: false });
on(board, 'dragover', e => {
    if(e.target.closest?.('.image-node')){
        dropOverlay.classList.remove('active', 'output-copy-drag');
        return;
    }
    if(e.target.closest?.('.imageBatch-node, .promptGroup-node, .group-node')){
        dropOverlay.classList.remove('active', 'output-copy-drag');
        return;
    }
    if(isCanvasInputDrag(e.dataTransfer)){
        dropOverlay.classList.remove('active');
        return;
    }
    if(hasImageDropData(e.dataTransfer) || isActiveOutputImageDrag(e.dataTransfer)){
        e.preventDefault();
        if(isActiveOutputImageDrag(e.dataTransfer)){
            const pgEl = e.target.closest?.('.promptGroup-node');
            if(pgEl){
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                clearPromptGroupOutputDropHighlights(pgEl);
                pgEl.classList.add('group-drop-target', 'prompt-group-output-drop');
                dropOverlay.classList.remove('active', 'output-copy-drag');
                return;
            }
            clearPromptGroupOutputDropHighlights();
            const armed = syncOutputDragArmed(e);
            e.dataTransfer.dropEffect = armed ? 'copy' : 'none';
            dropOverlay.classList.toggle('active', armed);
            dropOverlay.classList.toggle('output-copy-drag', armed);
            return;
        }
        e.dataTransfer.dropEffect = 'copy';
        dropOverlay.classList.add('active');
        dropOverlay.classList.remove('output-copy-drag');
    }
});
on(document, 'dragover', e => {
    if(!outputDragSession) return;
    syncOutputDragArmed(e);
}, true);
on(board, 'dragleave', e => {
    if(e.target === board || !board.contains(e.relatedTarget)){
        dropOverlay.classList.remove('active', 'output-copy-drag');
    }
});
on(board, 'drop', async e => {
    e.preventDefault();
    const wasOutputDrag = isActiveOutputImageDrag(e.dataTransfer);
    const promptGroup = wasOutputDrag ? findPromptGroupAtScreen(e.clientX, e.clientY) : null;
    const outputCommit = wasOutputDrag && !promptGroup && shouldCommitOutputDrag(e);
    dropOverlay.classList.remove('active', 'output-copy-drag');
    clearPromptGroupOutputDropHighlights();
    if(wasOutputDrag){
        if(promptGroup){
            handlePromptGroupOutputDrop(e, promptGroup);
            return;
        }
        if(!outputCommit){
            setStatus(langIsEn() ? 'Cancelled — drag away from node to copy' : '已取消：请拖离节点后再松手复制');
            setTimeout(() => { if(canvas) setStatus('Ready'); }, 2000);
            endOutputDragSession();
            setCanvasOutputDragActive(false);
            return;
        }
        commitOutputImageToCanvas(
            resolveOutputDragUrl(e.dataTransfer),
            screenToWorld(e.clientX, e.clientY),
            e.clientX,
            e.clientY
        );
        endOutputDragSession();
        setCanvasOutputDragActive(false);
        return;
    }
    setCanvasOutputDragActive(false);
    if(e.target.closest?.('.image-node')) return;
    if(isCanvasInputDrag(e.dataTransfer)) {
        internalDrag = false;
        return;
    }
    const payload = await resolveImageDropPayload(e.dataTransfer);
    if(payload.type === 'none') return;
    try {
        await applyImageDropPayloadToBoard(payload, screenToWorld(e.clientX, e.clientY));
    } catch(err) {
        setStatus('Ready');
        showErrorModal(err.message || (langIsEn() ? 'Image import failed' : '导入图片失败'), langIsEn() ? 'Image import failed' : '导入图片失败');
    }
});
on(window, 'dragend', () => {
    dropOverlay.classList.remove('active', 'output-copy-drag');
    clearPromptGroupOutputDropHighlights();
    endOutputDragSession();
    setCanvasOutputDragActive(false);
});
on(window, 'drop', () => {
    dropOverlay.classList.remove('active', 'output-copy-drag');
    clearPromptGroupOutputDropHighlights();
    endOutputDragSession();
    setCanvasOutputDragActive(false);
});
on(window, 'paste', e => {
    if(!canvas) return;
    const files = [...(e.clipboardData?.items || [])].filter(x => x.kind === 'file' && /^(image|video|audio)\//.test(String(x.type || ''))).map(x => x.getAsFile());
    if(!files.length) return;
    e.preventDefault();
    lastImagePasteAt = Date.now();
    const blank = [...selected].map(id => nodes.find(n => n.id === id)).find(n => n?.type === 'image' && !n.url);
    if(blank) fillImageNode(blank.id, files);
    else if(files.length > 1) uploadImageGroup(files);
    else uploadImages(files);
});
on(window, 'keydown', e => {
    if(!canvas) return;
    if(e.key === 'Alt' && !isEditableTarget(document.activeElement)){
        altModifierArmed = true;
        withCanvasRootClass(list => list.add('canvas-alt-modifier'));
    }
    if(e.code === 'Space' && !isEditableTarget(document.activeElement)){
        e.preventDefault();
        setSpacePanArmed(true);
    }
    if(e.key === 'Shift' && !isEditableTarget(document.activeElement)) setKnifeMode(true);
    if(e.key === 'Escape' && document.getElementById('canvasGenerationBrowser')) { closeCanvasGenerationBrowser(); return; }
    if(e.key === 'Escape' && document.getElementById('canvasNodeSearchModal')) { closeCanvasNodeSearch(); return; }
    if(e.key === 'Escape' && domGet('imageEditModal')?.classList.contains('open')) { closeImageEditor(); return; }
    if(outputLightbox?.classList.contains('open') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')){
        if(navigateOutputLightbox(e.key === 'ArrowRight' ? 1 : -1)){
            e.preventDefault();
            e.stopPropagation();
        }
        return;
    }
    if(e.key === 'Escape' && outputLightbox?.classList.contains('open')) { closeOutputLightbox(); return; }
    if(e.key === 'Escape' && tempLink){ cancelTempLink(); return; }
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') { e.preventDefault(); groupSelectedImages(); }
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
        const tag = document.activeElement?.tagName;
        if(tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        if(!selected.size) return;
        e.preventDefault();
        toggleSelectedNodesDisabled();
    }
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const tag = document.activeElement?.tagName;
        if(tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        const sel = window.getSelection && window.getSelection();
        if(sel && sel.toString().length > 0) return;
        e.preventDefault();
        copySelectedNodes();
    }
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        const tag = document.activeElement?.tagName;
        if(tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        if(clipboard?.length) {
            const pasteRequestedAt = Date.now();
            setTimeout(() => {
                if(!canvas) return;
                if(lastImagePasteAt >= pasteRequestedAt) return;
                pasteNodes();
            }, 90);
        }
    }
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const tag = document.activeElement?.tagName;
        if(tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        e.preventDefault();
        if(e.shiftKey) performRedo();
        else performUndo();
    }
    if((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'y') {
        const tag = document.activeElement?.tagName;
        if(tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        e.preventDefault();
        performRedo();
    }
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        const tag = document.activeElement?.tagName;
        if(tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        if(!isInfiniteCanvasEditorOpen()) return;
        e.preventDefault();
        openCanvasNodeSearch();
    }
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'l') {
        const tag = document.activeElement?.tagName;
        if(tag === 'INPUT' || tag === 'TEXTAREA' || document.activeElement?.isContentEditable) return;
        if(!selected.size) return;
        e.preventDefault();
        organizeSelectedNodes();
    }
    if(e.key === 'Delete' || e.key === 'Backspace') {
        if(!canvas) return;
        if(hoveredConnectionId && !isEditableTarget(document.activeElement)){
            e.preventDefault();
            deleteConnection(hoveredConnectionId, e);
            return;
        }
        if(selected.size === 0) return;
        const active = document.activeElement;
        if(isEditableTarget(active)){
            const nodeEl = active.closest?.('.node');
            const nodeId = nodeEl?.dataset?.id;
            const inSelectedNode = nodeId && selected.has(nodeId);
            const fieldText = String(active.value ?? active.textContent ?? '');
            const fieldEmpty = !fieldText.length;
            if(e.key === 'Delete'){
                if(inSelectedNode || active?.classList?.contains('prompt-group-prefix')) active.blur();
                else return;
            } else if(e.key === 'Backspace'){
                if(inSelectedNode && fieldEmpty) active.blur();
                else if(active?.classList?.contains('prompt-group-prefix') && fieldEmpty) active.blur();
                else return;
            }
        }
        e.preventDefault();
        deleteSelectedNodes();
    }
});
on(window, 'keyup', e => {
    if(e.key === 'Alt'){
        altModifierArmed = false;
        withCanvasRootClass(list => list.remove('canvas-alt-modifier'));
    }
    if(e.code === 'Space'){
        setSpacePanArmed(false);
    }
    if(e.key === 'Shift') setKnifeMode(false);
});
on(window, 'blur', () => {
    setSpacePanArmed(false);
    altModifierArmed = false;
    withCanvasRootClass(list => list.remove('canvas-alt-modifier'));
    setKnifeMode(false);
    clearAllPortMagnet();
});
on(window, 'blur', () => {
    if(selectDrag){
        selectionBox.style.display = 'none';
        selectDrag = null;
        withCanvasRootClass(list => list.remove('canvas-selecting'));
        window.onmousemove = null;
        window.onmouseup = null;
    }
    if(pendingNodeDrag || dragNode || resizeNode){
        resetCanvasInteractionForEdit();
    }
});

}
function deleteSelectedNodes(){
    if(!canvas || selected.size === 0) return;
    try { pushUndo(); } catch(err) { console.warn('[infinite-canvas] undo snapshot failed', err); }
    // 收集所有需要删除的 id（含 group 的 items 一并删除）
    const toDelete = new Set();
    const collect = id => {
        if(toDelete.has(id)) return;
        toDelete.add(id);
        const n = nodes.find(x => x.id === id);
        if(n && (n.type === 'group' || n.type === 'promptGroup' || n.type === 'imageBatch')){
            (n.items || []).forEach(collect);
        }
    };
    selected.forEach(collect);
    toDelete.forEach(id => purgeNodeFromGroups(id));
    toDelete.forEach(id => destroyLTXEditor(nodes.find(n => n.id === id)));
    nodes = nodes.filter(n => !toDelete.has(n.id));
    connections = connections.filter(c => !toDelete.has(c.from) && !toDelete.has(c.to));
    selected.clear();
    commitCanvasStructureEdit();
    scheduleSave();
}
function hasImageFiles(items){
    return [...(items || [])].some(item => {
        const entry = dataTransferItemEntry(item);
        return entry?.isDirectory || (item.kind === 'file' && (/^(image|video|audio)\//.test(String(item.type || '')) || isSupportedUploadFile(item.getAsFile?.())));
    });
}
function isCanvasInputDrag(dataTransfer){
    return internalDrag || [...(dataTransfer?.types || [])].includes('application/x-canvas-input');
}
function hasImageDropData(dataTransfer){
    if(!dataTransfer) return false;
    if(isActiveOutputImageDrag(dataTransfer)) return false;
    if(isCanvasInputDrag(dataTransfer)) return false;
    if(imageFilesFromDataTransfer(dataTransfer).length) return true;
    if(hasImageFiles(dataTransfer.items)) return true;
    const types = dropDataTypes(dataTransfer);
    if(types.some(type => IMAGE_DROP_TYPE_HINT_RE.test(type.toLowerCase()))) return true;
    return imageDropPayload(dataTransfer).type !== 'none';
}
function hasOutputImageDrag(dataTransfer){ return [...(dataTransfer?.types || [])].includes('application/x-canvas-output-image'); }
function escapeHtml(str){ return String(str == null ? '' : str).replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function escapeAttr(str){ return escapeHtml(str); }


let mountedEngineRoot = null;
let mountEnginePromise = null;
let mountEngineSeq = 0;

function isMountGenerationCurrent(seq){
    return seq === mountEngineSeq;
}

function restoreEditorSurface(){
    if(!canvas || !shell) return false;
    setCanvasMode(true);
    if(currentCanvasTitle) currentCanvasTitle.textContent = canvas.title || tr('canvas.untitled');
    if(currentCanvasTime) currentCanvasTime.textContent = formatCanvasTime(canvas.updated_at || canvas.created_at);
    renderCanvasList();
    ensureEditorDomFromModel();
    if(!minimapState) renderMinimap();
    else updateMinimapNodePositions();
    resumeCanvasImageTasks();
    startCanvasRemotePolling();
    refreshIcons();
    return true;
}

function ensureEditorDomFromModel(){
    if(!nodesEl || !linksEl || !canvas) return;
    applyViewport();
    const live = new Map();
    nodesEl.querySelectorAll('.node').forEach(el => {
        if(el.dataset?.id) live.set(el.dataset.id, el);
    });
    nodes.forEach(node => {
        const size = defaultNodeSize(node.type);
        let el = live.get(node.id);
        if(!el){
            el = renderNode(node);
            nodesEl.appendChild(el);
            return;
        }
        el.style.left = `${node.x}px`;
        el.style.top = `${node.y}px`;
        el.style.width = `${node.w || size.w}px`;
        if(node.h || size.h) el.style.height = `${node.h || size.h}px`;
    });
    [...nodesEl.children].forEach(child => {
        if(!nodes.some(n => n.id === child.dataset?.id)) child.remove();
    });
    syncLinkDomToConnections();
}

export function isInfiniteCanvasEngineMountedOn(root){
    return Boolean(root && mountedEngineRoot === root && canvasRoot === root);
}

export async function mountInfiniteCanvasEngine(root) {
  if (mountedEngineRoot === root) {
    return disposeInfiniteCanvasEngine;
  }
  if (mountEnginePromise) {
    await mountEnginePromise;
    if (mountedEngineRoot === root) {
      return disposeInfiniteCanvasEngine;
    }
  }
  mountEnginePromise = mountInfiniteCanvasEngineInner(root);
  try {
    return await mountEnginePromise;
  } finally {
    mountEnginePromise = null;
  }
}

function attachEngineToRoot(root){
  canvasRoot = root;
  bindDomElements(root);
  bindGateCollectionsIntegration();
  if(board && !board.onmousedown) boardEventsWired = false;
  applyTheme('dark');
  applyQuickToolbarState();
  if (window.StudioI18n) window.StudioI18n.apply?.();
  initOutputCompareEvents();
  initOutputPreviewZoomEvents();
  initOutputLightboxEvents();
  applyViewport();
  wireCanvasUiEvents();
  wireBoardEvents();
  wireCustomTooltips(root);
  exposeCanvasGlobals();
  restoreEditorSurface();
  mountedEngineRoot = root;
  syncCanvasPageMarkers();
}

async function mountInfiniteCanvasEngineInner(root) {
  const seq = ++mountEngineSeq;
  const preserveEditor = Boolean(mountedEngineRoot && canvas);
  if (mountedEngineRoot) {
    disposeInfiniteCanvasEngine({ preserveEditor });
  }
  if(!isMountGenerationCurrent(seq)) return disposeInfiniteCanvasEngine;

  if (canvas) {
    attachEngineToRoot(root);
    loadCanvasList(false).catch(e => console.warn('[infinite-canvas] refresh list failed', e));
    if(!isMountGenerationCurrent(seq)) return disposeInfiniteCanvasEngine;
    return disposeInfiniteCanvasEngine;
  }

  canvasRoot = root;
  bindDomElements(root);
  bindGateCollectionsIntegration();
  applyTheme('dark');
  applyQuickToolbarState();
  if (window.StudioI18n) window.StudioI18n.apply?.();
  initOutputCompareEvents();
  initOutputPreviewZoomEvents();
  initOutputLightboxEvents();
  applyViewport();
  wireCanvasUiEvents();
  wireBoardEvents();
  wireCustomTooltips(root);
  exposeCanvasGlobals();

  await loadConfig();
  if(!isMountGenerationCurrent(seq)) return disposeInfiniteCanvasEngine;
  pruneMissingComfyWorkflows();
  await loadCanvasList(false);
  if(!isMountGenerationCurrent(seq)) return disposeInfiniteCanvasEngine;
  const lastId = readLastCanvasId();
  const lastMeta = lastId ? canvases.find(c => c.id === lastId) : null;
  if(!canvas && lastMeta && (lastMeta.kind || 'classic') !== 'smart'){
    try { await openCanvas(lastId); } catch(e) { console.warn('[infinite-canvas] restore last canvas failed', e); }
  } else if(lastId && !canvas) {
    writeLastCanvasId('');
  }
  if(!isMountGenerationCurrent(seq)) return disposeInfiniteCanvasEngine;
  if(readCanvasFavoriteNavigation()?.canvasId){
    await consumeQueuedCanvasFavoriteNavigation();
  }
  if(!canvas) {
    showCanvasGateView({ clearEditor: true });
  }
  mountedEngineRoot = root;
  syncCanvasPageMarkers();
  return disposeInfiniteCanvasEngine;
}

function exposeCanvasGlobals() {
  const map = {
    addImageNode, addPromptNode, addLoopNode, addLLMNode, addGeneratorNode, addReplicaAgentNode, addImageRepairAgentNode, addBatchPosterAgentNode, addNineGridAgentNode, addSlotsLoopVideoAgentNode, addVideoReverseNode, addMsGenNode, addImageBatchNode, runReplicaAgentFromButton, runImageRepairAgentFromButton, runBatchPosterFromButton, runNineGridFromButton, runSlotsLoopVideoFromButton,
    addVideoNode, addRhNode, addComfyNode, addLTXDirectorNode, addOutputNode, addPromptGroupNode, groupSelectedImages, createImageBatchFromSelection, createPromptGroupFromSelection, organizeSelectedNodes,
    openCanvasNodeSearch, performUndo, performRedo,
    openCanvasHistoryHub, openCanvasGenerationBrowser, placeImageUrlOnCanvas, downloadAllCanvasOutputImages,
    exportCanvasWorkflowJson, openCanvasWorkflowImportPicker,
    toggleQuickToolbar, openCanvasLog, closeCanvasLog, closeOutputLightbox, menuAdd, closeImageEditor,
    undoEditDrawing, redoEditDrawing, clearEditDrawing, setBrushTool, setImageEditMode, setCropAspectLock,
    resetImageEditZoom, resetCropBox, applyImageEdit, restoreAnnotationBase, closeErrorModal, copyErrorMessage,
    createCanvas, createSmartCanvas, loadCanvasList, openCanvas, deleteCanvas, returnToCanvasManager,
    deleteNodeFromButton,
    openWorkflowTemplateModal, closeWorkflowTemplateModal, saveCurrentCanvasAsWorkflowTemplate,
    resetCanvasViewportZoom,
    zoomCanvasViewport,
    fitCanvasViewportAll,
  };
  Object.entries(map).forEach(([k, v]) => { if (typeof v === 'function') window[k] = v; });
}

/** 是否正在画布编辑（非「选择画布」门控页） */
export function isInfiniteCanvasEditorOpen() {
  if (!canvasRoot) return false;
  const liveShell = canvasRoot.querySelector('#shell');
  if (!liveShell || liveShell.classList.contains('no-canvas')) return false;
  return Boolean(canvas || canvasRoot.dataset.canvasOpen === '1');
}

export {
  returnToCanvasManager,
  setImageEditMode,
  setCropAspectLock,
  setBrushTool,
  undoEditDrawing,
  redoEditDrawing,
  clearEditDrawing,
  restoreAnnotationBase,
  applyImageEdit,
  closeImageEditor,
  resetCropBox,
  resetImageEditZoom,
  placeImageUrlOnCanvas,
};

/** App 壳层切走（非画布路由）时挂起：避免「选择画布」透过半透明封面闪一下 */
export function setInfiniteCanvasShellSuspended(suspended) {
  if(!canvasRoot) return;
  if(suspended){
    stopCanvasRemotePolling();
    canvasRoot.dataset.shellSuspended = '1';
    canvasRoot.dataset.shellActive = '0';
  } else {
    delete canvasRoot.dataset.shellSuspended;
    canvasRoot.dataset.shellActive = '1';
    rebindDomIfStale();
    if(board && !boardEventsWired) wireBoardEvents();
    requestAnimationFrame(() => {
      refreshInfiniteCanvasLayout();
    });
    if(canvas) startCanvasRemotePolling();
    else if(!trashMode && creatingCanvas) setCreateMode(false);
  }
}

export function disposeInfiniteCanvasEngine({ preserveEditor = false } = {}) {
  hideCustomTooltip();
  clearBoardPanListeners();
  pendingNodeDrag = null;
  endDrag();
  stopCanvasRemotePolling();
  if(outputTimer){
    clearInterval(outputTimer);
    outputTimer = null;
  }
  clearTimeout(saveTimer);
  saveTimer = null;
  clearTimeout(viewportSaveTimer);
  viewportSaveTimer = null;
  clearTimeout(remoteSyncTimer);
  remoteSyncTimer = null;
  disposers.forEach((d) => {
    try { d(); } catch (_) {}
  });
  disposers.length = 0;
  boardEventsWired = false;
  imageEditorUiWired = false;
  setSpacePanArmed(false);
  if (board) {
    board.style.cursor = '';
    board.onmousedown = null;
    board.onwheel = null;
    board.ondblclick = null;
    board.oncontextmenu = null;
    board.onmousemove = null;
    board.onmouseleave = null;
  }
  window.onmousemove = null;
  window.onmouseup = null;
  if(!preserveEditor){
    canvas = null;
    nodes = [];
    connections = [];
    selected.clear();
  }
  canvasRoot = null;
  mountedEngineRoot = null;
  board = null;
  world = null;
  nodesEl = null;
  linksEl = null;
  shell = null;
  minimapState = null;
}
