/* eslint-disable */
/** 画布选择页：合集分类、拖拽、右键菜单 */

/** @typedef {import('./canvasGateCollections.types').GateCollectionsHost} GateCollectionsHost */

/** @type {GateCollectionsHost | null} */
let host = null;

/** @type {{ x: number; y: number; kind: 'canvas' | 'collection'; canvasId?: string; collectionId?: string } | null} */
let gateContextMenu = null;

/** @type {{ mode: 'create' | 'rename' | 'delete'; collectionId?: string; canvasIds?: string[]; defaultName?: string } | null} */
let pendingCollectionModal = null;

/** @type {string | null} */
let pendingDeleteCollectionId = null;

/** @type {string | null} */
let openBrowseCollectionId = null;

/** @type {string | null} 从合集进入画布后，点顶栏返回应回到该合集弹层 */
let returnToCollectionId = null;

/** @type {{ canvasId: string; overCanvasId?: string; overCollectionId?: string } | null} */
let gateDragState = null;

export function bindGateCollectionsHost(next) {
  host = next;
}

function h() {
  if (!host) throw new Error('gate collections host not bound');
  return host;
}

export async function loadCanvasCollections() {
  const { apiFetch } = h();
  try {
    const res = await apiFetch('/api/canvas-collections');
    if (!res.ok) {
      const ct = (res.headers.get('content-type') || '').toLowerCase();
      if (!ct.includes('application/json') && (res.status === 404 || res.status === 500)) {
        console.warn('[canvas-gate] collections API unavailable — restart npm run dev');
        h().setCollections([]);
        return;
      }
      throw new Error('加载合集失败');
    }
    const data = await res.json();
    h().setCollections(Array.isArray(data.collections) ? data.collections : []);
  } catch (err) {
    console.warn('[canvas-gate] load collections failed', err);
    h().setCollections([]);
  }
}

function canvasMap() {
  return new Map(h().getCanvases().map((c) => [c.id, c]));
}

function collectionCanvasItems(collection) {
  const map = canvasMap();
  return (collection.canvas_ids || []).map((id) => map.get(id)).filter(Boolean);
}

function uncategorizedCanvases() {
  const inCol = new Set();
  for (const col of h().getCollections()) {
    for (const id of col.canvas_ids || []) inCol.add(id);
  }
  return h().getCanvases().filter((c) => !inCol.has(c.id));
}

function findCollectionForCanvas(canvasId) {
  return h().getCollections().find((col) => (col.canvas_ids || []).includes(canvasId)) || null;
}

function escapeAttr(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function isPreviewableCanvas(item) {
  const url = String(item?.preview_url || item?.previewUrl || '').trim();
  return Boolean(url) && !/\.(mp4|webm|mov|m4v|mp3|wav|ogg)(\?|$)/i.test(url);
}

function buildCollectionPreviewHtml(items) {
  const previews = items.filter(isPreviewableCanvas).slice(0, 4);
  if (!previews.length) {
    return `
      <div class="gate-collection-preview-empty" aria-hidden="true">
        <i data-lucide="folder" class="w-7 h-7"></i>
      </div>`;
  }
  const cells = previews
    .map(
      (item) =>
        `<div class="gate-collection-preview-cell"><img src="${escapeAttr(item.preview_url || item.previewUrl)}" alt="" loading="lazy" draggable="false"></div>`
    )
    .join('');
  return `<div class="gate-collection-preview-grid gate-collection-preview-grid-${Math.min(previews.length, 4)}" aria-hidden="true">${cells}</div>`;
}

async function refreshCollectionsAndList() {
  await loadCanvasCollections();
  await h().loadCanvasList(false);
  h().renderCanvasList();
  if (openBrowseCollectionId) renderCollectionBrowseModal();
}

function syncCollectionBrowseOpenState(open) {
  const root = h().getCanvasRoot?.();
  if (!root) return;
  root.classList.toggle('gate-collection-browse-open', Boolean(open));
  root.dataset.collectionBrowseOpen = open ? '1' : '0';
}

function closeCollectionBrowseModal({ clearReturnTarget = true } = {}) {
  openBrowseCollectionId = null;
  if (clearReturnTarget) returnToCollectionId = null;
  const modal = h().gateCollectionBrowseModalEl;
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  syncCollectionBrowseOpenState(false);
}

export function clearGateReturnCollection() {
  returnToCollectionId = null;
}

export function resumeCollectionBrowseAfterGate() {
  beginCollectionBrowseResume();
}

export function beginCollectionBrowseResume() {
  if (!returnToCollectionId) return;
  openBrowseCollectionId = returnToCollectionId;
  syncCollectionBrowseOpenState(true);
  renderCollectionBrowseModal();
}

export function refreshOpenCollectionBrowseIfOpen() {
  if (openBrowseCollectionId) renderCollectionBrowseModal();
}

function openCanvasFromCollectionBrowse(canvasId, collectionId) {
  returnToCollectionId = collectionId;
  openBrowseCollectionId = null;
  const modal = h().gateCollectionBrowseModalEl;
  if (modal) {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  }
  syncCollectionBrowseOpenState(false);
  void h().openCanvas(canvasId, { fromCollectionBrowse: true });
}

function openCollectionBrowseModal(collectionId) {
  openBrowseCollectionId = collectionId;
  renderCollectionBrowseModal();
}

function renderCollectionBrowseModal() {
  const modal = h().gateCollectionBrowseModalEl;
  const listEl = h().gateCollectionBrowseListEl;
  const titleEl = h().gateCollectionBrowseTitleEl;
  const countEl = h().gateCollectionBrowseCountEl;
  if (!modal || !listEl || !titleEl || !countEl || !openBrowseCollectionId) return;
  const col = h().getCollections().find((c) => c.id === openBrowseCollectionId);
  if (!col) {
    closeCollectionBrowseModal();
    return;
  }
  const items = collectionCanvasItems(col);
  titleEl.textContent = col.name;
  countEl.textContent = `${items.length} 张画布`;
  listEl.innerHTML = '';
  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'gate-collection-browse-empty';
    empty.innerHTML = `<i data-lucide="folder-open" class="w-6 h-6"></i><span>合集内还没有画布</span><span class="gate-collection-browse-empty-hint">拖动画布到合集卡片，或使用右键菜单加入</span>`;
    listEl.appendChild(empty);
  } else {
    items.forEach((item) => {
      const row = h().buildCanvasItemElement(item, { collectionId: col.id });
      bindCanvasDrag(row, item.id);
      row.addEventListener('contextmenu', (e) => openCanvasContextMenu(e, item.id, col.id));
      const openEl = row.querySelector('.canvas-open');
      if (openEl) {
        openEl.onclick = (e) => {
          e.preventDefault();
          e.stopPropagation();
          openCanvasFromCollectionBrowse(item.id, col.id);
        };
      }
      listEl.appendChild(row);
    });
  }
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  syncCollectionBrowseOpenState(true);
  h().refreshIcons(modal);
}

async function parseGateApiError(res, fallback) {
  const ct = (res.headers.get('content-type') || '').toLowerCase();
  if (!ct.includes('application/json')) {
    if (res.status === 404 || res.status === 500) {
      throw new Error('合集 API 未生效，请停止并重新运行 npm run dev（或 npm run build:prod 后重启服务）');
    }
    throw new Error(`${fallback}（HTTP ${res.status}）`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = typeof data.detail === 'string' ? data.detail : data.error;
    throw new Error(detail || fallback);
  }
  return data;
}

async function apiCreateCollection(name, canvasIds = []) {
  const res = await h().apiFetch('/api/canvas-collections', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, canvas_ids: canvasIds }),
  });
  const data = await parseGateApiError(res, '创建合集失败');
  return data.collection;
}

async function apiRenameCollection(id, name) {
  const res = await h().apiFetch(`/api/canvas-collections/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  const data = await parseGateApiError(res, '重命名失败');
  return data.collection;
}

async function apiDeleteCollection(id) {
  const res = await h().apiFetch(`/api/canvas-collections/${id}`, { method: 'DELETE' });
  await parseGateApiError(res, '删除合集失败');
}

async function apiAddCanvasToCollection(collectionId, canvasId) {
  const res = await h().apiFetch(`/api/canvas-collections/${collectionId}/canvases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ canvas_id: canvasId }),
  });
  const data = await parseGateApiError(res, '加入合集失败');
  return data.collection;
}

async function apiRemoveCanvasFromCollection(collectionId, canvasId) {
  const res = await h().apiFetch(`/api/canvas-collections/${collectionId}/canvases/${canvasId}`, {
    method: 'DELETE',
  });
  const data = await parseGateApiError(res, '移出合集失败');
  return data.collection;
}

function closeGateContextMenu() {
  gateContextMenu = null;
  const el = h().gateContextMenuEl;
  if (el) {
    el.hidden = true;
    el.innerHTML = '';
  }
}

function openGateContextMenu(x, y, menuItems) {
  const el = h().gateContextMenuEl;
  if (!el) return;
  gateContextMenu = { x, y };
  el.innerHTML = menuItems
    .map((item) => {
      if (item.separator) return '<div class="gate-context-sep" role="separator"></div>';
      const disabled = item.disabled ? ' disabled' : '';
      return `<button type="button" class="gate-context-item${disabled}" data-action="${item.action}"${item.disabled ? ' disabled' : ''}>${item.label}</button>`;
    })
    .join('');
  el.hidden = false;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.querySelectorAll('.gate-context-item:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.getAttribute('data-action');
      closeGateContextMenu();
      const item = menuItems.find((m) => m.action === action);
      if (item?.onClick) await item.onClick();
    });
  });
  h().refreshIcons(el);
}

function openCanvasContextMenu(event, canvasId, collectionId = '') {
  event.preventDefault();
  event.stopPropagation();
  const collections = h().getCollections();
  const inCollection = collectionId || findCollectionForCanvas(canvasId)?.id || '';
  const submenu = collections.length
    ? collections.map((col) => ({
        action: `add:${col.id}`,
        label: `加入「${col.name}」`,
        onClick: async () => {
          try {
            await apiAddCanvasToCollection(col.id, canvasId);
            h().setStatus(`已加入「${col.name}」`);
            await refreshCollectionsAndList();
          } catch (err) {
            h().showErrorModal(err instanceof Error ? err.message : String(err), '加入合集');
          }
        },
      }))
    : [];
  openGateContextMenu(event.clientX, event.clientY, [
    {
      action: 'create-collection',
      label: '创建合集…',
      onClick: () => openCollectionModal({ mode: 'create', canvasIds: [canvasId], defaultName: '' }),
    },
    ...submenu,
    ...(inCollection
      ? [
          { separator: true },
          {
            action: 'remove-from-collection',
            label: '从合集中移出',
            onClick: async () => {
              try {
                await apiRemoveCanvasFromCollection(inCollection, canvasId);
                h().setStatus('已从合集中移出');
                await refreshCollectionsAndList();
              } catch (err) {
                h().showErrorModal(err instanceof Error ? err.message : String(err), '移出合集');
              }
            },
          },
        ]
      : []),
  ]);
}

function openCollectionHeaderContextMenu(event, collectionId) {
  event.preventDefault();
  event.stopPropagation();
  const col = h().getCollections().find((c) => c.id === collectionId);
  if (!col) return;
  openGateContextMenu(event.clientX, event.clientY, [
    {
      action: 'rename-collection',
      label: '重命名合集…',
      onClick: () => openCollectionModal({ mode: 'rename', collectionId, defaultName: col.name }),
    },
    {
      action: 'delete-collection',
      label: '删除合集…',
      onClick: () => {
        pendingDeleteCollectionId = collectionId;
        h().renderCanvasList();
      },
    },
  ]);
}

function openCollectionModal(spec) {
  pendingCollectionModal = spec;
  const modal = h().gateCollectionModalEl;
  const input = h().gateCollectionNameInputEl;
  const title = h().gateCollectionModalTitleEl;
  if (!modal || !input || !title) return;
  if (spec.mode === 'rename') title.textContent = '重命名合集';
  else if (spec.mode === 'create') title.textContent = spec.canvasIds?.length > 1 ? '创建合集（包含 2 张画布）' : '创建合集';
  else title.textContent = '创建合集';
  input.value = spec.defaultName || '';
  modal.classList.add('open');
  input.focus();
  input.select();
}

export function closeCollectionModal() {
  pendingCollectionModal = null;
  h().gateCollectionModalEl?.classList.remove('open');
}

export async function confirmCollectionModal() {
  const spec = pendingCollectionModal;
  const input = h().gateCollectionNameInputEl;
  if (!spec || !input) return;
  const name = String(input.value || '').trim();
  if (!name) {
    h().setStatus('请输入合集名称');
    return;
  }
  try {
    if (spec.mode === 'rename' && spec.collectionId) {
      await apiRenameCollection(spec.collectionId, name);
      h().setStatus('合集已重命名');
    } else {
      await apiCreateCollection(name, spec.canvasIds || []);
      h().setStatus(`已创建合集「${name}」`);
    }
    closeCollectionModal();
    await refreshCollectionsAndList();
  } catch (err) {
    h().showErrorModal(err instanceof Error ? err.message : String(err), '合集');
  }
}

function bindCollectionDropTarget(el, collectionId) {
  el.addEventListener('dragover', (e) => {
    if (!gateDragState?.canvasId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('is-drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('is-drop-target'));
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    el.classList.remove('is-drop-target');
    const canvasId = gateDragState?.canvasId || e.dataTransfer.getData('text/canvas-id');
    gateDragState = null;
    if (!canvasId) return;
    try {
      const col = h().getCollections().find((c) => c.id === collectionId);
      await apiAddCanvasToCollection(collectionId, canvasId);
      h().setStatus(col ? `已加入「${col.name}」` : '已加入合集');
      await refreshCollectionsAndList();
    } catch (err) {
      h().showErrorModal(err instanceof Error ? err.message : String(err), '加入合集');
    }
  });
}

function bindCanvasDrag(row, canvasId) {
  row.draggable = true;
  row.dataset.canvasId = canvasId;
  row.addEventListener('dragstart', (e) => {
    gateDragState = { canvasId };
    row.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/canvas-id', canvasId);
  });
  row.addEventListener('dragend', () => {
    row.classList.remove('is-dragging');
    gateDragState = null;
    document.querySelectorAll('.is-drop-target,.is-merge-target').forEach((el) => {
      el.classList.remove('is-drop-target');
      el.classList.remove('is-merge-target');
    });
  });
  row.addEventListener('dragover', (e) => {
    if (!gateDragState?.canvasId || gateDragState.canvasId === canvasId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    row.classList.add('is-merge-target');
  });
  row.addEventListener('dragleave', () => row.classList.remove('is-merge-target'));
  row.addEventListener('drop', async (e) => {
    e.preventDefault();
    row.classList.remove('is-merge-target');
    const sourceId = gateDragState?.canvasId || e.dataTransfer.getData('text/canvas-id');
    const targetId = canvasId;
    gateDragState = null;
    if (!sourceId || sourceId === targetId) return;
    openCollectionModal({ mode: 'create', canvasIds: [sourceId, targetId], defaultName: '' });
  });
}

function renderCollectionSection(root, collection) {
  const items = collectionCanvasItems(collection);
  const section = document.createElement('section');
  section.className = 'gate-collection';
  section.dataset.collectionId = collection.id;
  const countLabel = `${items.length} 张画布`;
  section.innerHTML = `
    <div class="gate-collection-head canvas-item gate-collection-card" data-collection-id="${collection.id}" role="button" tabindex="0" aria-label="打开合集 ${h().escapeHtml(collection.name)}">
      <div class="gate-collection-card-shell">
        <div class="canvas-card-preview gate-collection-preview">
          ${buildCollectionPreviewHtml(items)}
          <span class="gate-collection-folder-mark" aria-hidden="true">
            <i data-lucide="folder" class="w-4 h-4"></i>
          </span>
          <span class="gate-collection-drop-hint">拖到此处加入</span>
        </div>
        <div class="canvas-card-body gate-collection-card-body">
          <div class="gate-collection-name">${h().escapeHtml(collection.name)}</div>
          <div class="gate-collection-count">${countLabel}</div>
        </div>
      </div>
    </div>
    ${pendingDeleteCollectionId === collection.id ? `
      <div class="gate-collection-delete-confirm">
        <div class="canvas-delete-box">
          <div class="canvas-delete-title">确定删除合集「${h().escapeHtml(collection.name)}」？画布本身不会被删除。</div>
          <div class="canvas-delete-actions">
            <button type="button" class="canvas-confirm-btn gate-collection-delete-yes">确定删除</button>
            <button type="button" class="canvas-cancel-btn gate-collection-delete-no">取消</button>
          </div>
        </div>
      </div>` : ''}
  `;
  const head = section.querySelector('.gate-collection-head');
  head?.addEventListener('click', (e) => {
    if (e.target.closest('.gate-collection-delete-confirm')) return;
    if (gateDragState?.canvasId) return;
    openCollectionBrowseModal(collection.id);
  });
  head?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openCollectionBrowseModal(collection.id);
    }
  });
  head?.addEventListener('contextmenu', (e) => openCollectionHeaderContextMenu(e, collection.id));
  bindCollectionDropTarget(head, collection.id);
  section.querySelector('.gate-collection-delete-yes')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await apiDeleteCollection(collection.id);
      pendingDeleteCollectionId = null;
      if (returnToCollectionId === collection.id) returnToCollectionId = null;
      if (openBrowseCollectionId === collection.id) closeCollectionBrowseModal();
      h().setStatus('合集已删除');
      await refreshCollectionsAndList();
    } catch (err) {
      h().showErrorModal(err instanceof Error ? err.message : String(err), '删除合集');
    }
  });
  section.querySelector('.gate-collection-delete-no')?.addEventListener('click', (e) => {
    e.stopPropagation();
    pendingDeleteCollectionId = null;
    h().renderCanvasList();
  });
  root.appendChild(section);
}

export function openCreateCollectionModal(canvasIds = []) {
  openCollectionModal({ mode: 'create', canvasIds, defaultName: '' });
}

export function renderGateLibrary() {
  const { gateCollectionsRoot, gateCanvasList, gateUncategorizedSection } = h();
  if (!gateCollectionsRoot || !gateCanvasList) return;
  h().refreshGateViewControls();
  const collections = h().getCollections();
  const allCanvases = h().getCanvases();
  gateCollectionsRoot.innerHTML = '';
  collections.forEach((col) => renderCollectionSection(gateCollectionsRoot, col));

  if (gateUncategorizedSection) {
    const sectionHead = gateUncategorizedSection.querySelector('.gate-section-head');
    if (sectionHead) sectionHead.hidden = collections.length === 0;
    gateUncategorizedSection.hidden = false;
  }

  gateCanvasList.innerHTML = '';
  const uncategorized = collections.length ? uncategorizedCanvases() : allCanvases;

  if (!uncategorized.length && !allCanvases.length) {
    const empty = document.createElement('div');
    empty.className = 'gate-list-empty';
    empty.innerHTML = `<div class="gate-list-empty-icon"><i data-lucide="layout-grid" class="w-6 h-6"></i></div>${h().tr('canvas.noCanvas')}<br>${h().tr('canvas.startWithNewCanvas')}`;
    gateCanvasList.appendChild(empty);
    h().refreshIcons(gateCanvasList);
    return;
  }
  if (!uncategorized.length) {
    const empty = document.createElement('div');
    empty.className = 'gate-list-empty gate-list-empty-compact';
    empty.textContent = collections.length ? '全部画布已收入合集' : '暂无未分类画布';
    gateCanvasList.appendChild(empty);
  } else {
    uncategorized.forEach((item) => {
      const row = h().buildCanvasItemElement(item, { collectionId: '' });
      bindCanvasDrag(row, item.id);
      row.addEventListener('contextmenu', (e) => openCanvasContextMenu(e, item.id, ''));
      gateCanvasList.appendChild(row);
    });
  }
  h().refreshIcons(gateCollectionsRoot);
  h().refreshIcons(gateCanvasList);
}

export function wireGateCollectionUi() {
  document.addEventListener('mousedown', (e) => {
    if (!h().gateContextMenuEl?.contains(e.target)) closeGateContextMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeGateContextMenu();
      closeCollectionModal();
      closeCollectionBrowseModal();
      pendingDeleteCollectionId = null;
    }
  });
  h().gateCollectionModalConfirmEl?.addEventListener('click', () => void confirmCollectionModal());
  h().gateCollectionModalCancelEl?.addEventListener('click', () => closeCollectionModal());
  h().gateCollectionNameInputEl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void confirmCollectionModal();
    if (e.key === 'Escape') closeCollectionModal();
  });
  h().gateCollectionBrowseCloseEl?.addEventListener('click', () => closeCollectionBrowseModal());
  h().gateCollectionBrowseModalEl?.addEventListener('click', (e) => {
    if (e.target === h().gateCollectionBrowseModalEl) closeCollectionBrowseModal();
  });
}

export function renderGateTrashList(listEl) {
  h().renderCanvasListInto(listEl);
}
