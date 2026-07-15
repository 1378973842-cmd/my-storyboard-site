/** Auto-generated from canvas.html — re-run scripts/html-to-jsx-shell.mjs */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { History, Keyboard } from 'lucide-react';

const dockSpring = { type: 'spring' as const, stiffness: 300, damping: 30 };
import {
  applyImageEdit,
  clearEditDrawing,
  closeImageEditor,
  redoEditDrawing,
  resetCropBox,
  resetImageEditZoom,
  restoreAnnotationBase,
  setBrushTool,
  setCropAspectLock,
  setImageEditMode,
  undoEditDrawing,
} from '../../lib/infiniteCanvas/canvasEngine.js';

const canvasWin = window as unknown as Record<string, (...args: unknown[]) => void>;

function assignRootRef(rootRef: Ref<HTMLDivElement>, node: HTMLDivElement | null) {
  if (typeof rootRef === 'function') rootRef(node);
  else if (rootRef && 'current' in rootRef) rootRef.current = node;
}

/** 首帧保持 gate 可见；shell 默认 no-canvas，避免编辑器顶栏在引擎就绪前闪现 */
function seedCanvasRootMarkers(node: HTMLDivElement) {
  if (node.dataset.editorSession == null) node.dataset.editorSession = '0';
  if (node.dataset.canvasOpen == null) node.dataset.canvasOpen = '0';
  const shell = node.querySelector('#shell');
  if (shell && !shell.classList.contains('no-canvas')) {
    shell.classList.add('no-canvas');
  }
}

type Props = {
  rootRef: Ref<HTMLDivElement>;
  materialLibraryOpen?: boolean;
  onMaterialLibraryOpenChange?: (open: boolean) => void;
};

type FlyoutItem = {
  icon: string;
  label: string;
  action: () => void;
};

type FlyoutGroup = {
  heading?: string;
  items: FlyoutItem[];
};

const AGENT_FLYOUT_GROUPS: FlyoutGroup[] = [
  {
    heading: 'Agent',
    items: [
      { icon: 'bot', label: '复刻 Agent', action: () => canvasWin['addReplicaAgentNode']?.() },
      { icon: 'wand-sparkles', label: '修图 Agent', action: () => canvasWin['addImageRepairAgentNode']?.() },
      { icon: 'layout-grid', label: 'Poster Agent', action: () => canvasWin['addBatchPosterAgentNode']?.() },
      { icon: 'grid-3x3', label: '九宫格 Agent', action: () => canvasWin['addNineGridAgentNode']?.() },
      { icon: 'repeat-2', label: 'Slots 循环视频 Agent', action: () => canvasWin['addSlotsLoopVideoAgentNode']?.() },
      { icon: 'film', label: 'Mx-Shell 提示词 Agent', action: () => canvasWin['addMxShellPromptAgentNode']?.() },
      { icon: 'file-text', label: 'Mx-Shell 提示词展示', action: () => canvasWin['addMxShellPromptViewNode']?.() },
      { icon: 'clapperboard', label: 'DeepWhite 导演分镜 Agent', action: () => canvasWin['addDeepWhiteShotAgentNode']?.() },
      { icon: 'book-open', label: 'DeepWhite 分镜文档', action: () => canvasWin['addDeepWhiteShotViewNode']?.() },
    ],
  },
];

const NODE_FLYOUT_GROUPS: FlyoutGroup[] = [
  {
    heading: '基础',
    items: [
      { icon: 'image-plus', label: '图片', action: () => canvasWin['addImageNode']?.() },
      { icon: 'text-cursor-input', label: '提示词', action: () => canvasWin['addPromptNode']?.() },
      { icon: 'repeat-2', label: '循环', action: () => canvasWin['addLoopNode']?.() },
    ],
  },
  {
    heading: '生成',
    items: [
      { icon: 'message-square-text', label: 'LLM', action: () => canvasWin['addLLMNode']?.() },
      { icon: 'wand-sparkles', label: '图片生成', action: () => canvasWin['addGeneratorNode']?.() },
      { icon: 'scan-search', label: '反推', action: () => canvasWin['addVideoReverseNode']?.() },
    ],
  },
  {
    heading: '整理',
    items: [
      { icon: 'circle-dot', label: 'Output', action: () => canvasWin['addOutputNode']?.() },
      { icon: 'images', label: '图片组', action: () => canvasWin['createImageBatchFromSelection']?.() },
      { icon: 'layers', label: '提示词组', action: () => canvasWin['createPromptGroupFromSelection']?.() },
    ],
  },
];

type ShortcutRow = { label: string; keys: string[] };
type ShortcutGroup = { title: string; rows: ShortcutRow[] };

// 与 canvasEngine.js 中实际绑定的交互保持一致，不臆造未实现的快捷键
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '编辑',
    rows: [
      { label: '成组选中图片', keys: ['Ctrl', 'G'] },
      { label: '复制节点', keys: ['Ctrl', 'C'] },
      { label: '粘贴节点', keys: ['Ctrl', 'V'] },
      { label: '启用 / 禁用节点', keys: ['Ctrl', 'B'] },
      { label: '撤销', keys: ['Ctrl', 'Z'] },
      { label: '重做', keys: ['Ctrl', 'Shift', 'Z'] },
      { label: '重做', keys: ['Ctrl', 'Y'] },
      { label: '自动排布选中', keys: ['Ctrl', 'L'] },
      { label: '搜索节点', keys: ['Ctrl', 'K'] },
      { label: '删除选中 / 连线', keys: ['Delete'] },
      { label: '拖动节点时创建副本', keys: ['Alt', '拖动节点'] },
    ],
  },
  {
    title: '选择与连线',
    rows: [
      { label: '多选节点', keys: ['Ctrl', '点击节点'] },
      { label: '框选节点', keys: ['Ctrl', '拖动空白处'] },
      { label: '剪断连线', keys: ['Shift', '划过连线'] },
      { label: '拉出新连线', keys: ['拖动端口圆点'] },
    ],
  },
  {
    title: '缩放',
    rows: [
      { label: '放大 / 缩小画布', keys: ['鼠标滚轮'] },
      { label: '放大 / 缩小画布', keys: ['触控板双指滑动'] },
    ],
  },
  {
    title: '移动画布',
    rows: [
      { label: '平移画布（空白处）', keys: ['拖动空白处'] },
      { label: '平移画布（含节点上）', keys: ['Space', '拖动'] },
      { label: '平移画布（含节点上）', keys: ['鼠标中键拖动'] },
      { label: '快速定位视图', keys: ['拖动小地图'] },
    ],
  },
  {
    title: '其他',
    rows: [
      { label: '取消拉线 / 关闭弹窗', keys: ['Esc'] },
      { label: '大图预览上一张 / 下一张', keys: ['←', '→'] },
    ],
  },
];

function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.querySelector('.infinite-canvas-root');
    setPortalRoot(root instanceof HTMLElement ? root : null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const lucide = (window as unknown as { lucide?: { createIcons?: () => void } }).lucide;
    lucide?.createIcons?.();
  }, [open]);

  if (!portalRoot) return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div
          className="shortcuts-modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className="shortcuts-modal"
            role="dialog"
            aria-modal="true"
            aria-label="快捷键"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1, transition: dockSpring }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.14, ease: [0.4, 0, 1, 1] } }}
          >
            <div className="shortcuts-modal-head">
              <span>快捷键</span>
              <button type="button" className="shortcuts-modal-close" aria-label="关闭" onClick={onClose}>
                <i data-lucide="x" className="w-4 h-4"></i>
              </button>
            </div>
            <div className="shortcuts-columns">
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.title} className="shortcuts-group">
                  <div className="shortcuts-group-title">{group.title}</div>
                  {group.rows.map((row, ri) => (
                    <div key={`${row.label}-${ri}`} className="shortcuts-row">
                      <span className="shortcuts-row-label">{row.label}</span>
                      <span className="shortcuts-keys">
                        {row.keys.map((k, ki) => (
                          <span key={ki} className="shortcut-key-group">
                            {ki > 0 ? <span className="shortcut-plus">+</span> : null}
                            <span className="shortcut-key">{k}</span>
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    portalRoot,
  );
}

function ToolbarFlyout({
  triggerIcon,
  triggerLabel,
  triggerClassName,
  ariaLabel,
  menuClassName,
  groups,
  showTooltip = true,
}: {
  triggerIcon: string;
  triggerLabel: string;
  triggerClassName?: string;
  ariaLabel: string;
  menuClassName?: string;
  groups: FlyoutGroup[];
  showTooltip?: boolean;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0 });
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.querySelector('.infinite-canvas-root');
    setPortalRoot(root instanceof HTMLElement ? root : null);
  }, []);

  const syncMenuPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({ left: rect.right + 10, top: rect.top });
  }, []);

  // Once the menu has actually rendered we know its real height — nudge it
  // back on screen if the sidebar trigger sits too close to the bottom edge.
  useLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const maxTop = window.innerHeight - rect.height - 12;
    if (rect.top > maxTop) {
      setMenuPos((prev) => ({ ...prev, top: Math.max(12, maxTop) }));
    }
  }, [open, groups]);

  const refreshFlyoutIcons = useCallback(() => {
    const lucide = (window as unknown as { lucide?: { createIcons?: () => void } }).lucide;
    lucide?.createIcons?.();
  }, []);

  const openMenu = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    syncMenuPos();
    setOpen(true);
  }, [syncMenuPos]);

  const scheduleClose = useCallback(() => {
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 140);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onLayout = () => syncMenuPos();
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [open, syncMenuPos]);

  // Icons must be rendered *after* the portal menu actually commits to the DOM —
  // refreshing at click/hover time races React's render and can leave icons blank
  // until something re-triggers it (e.g. moving the mouse onto the menu).
  useEffect(() => {
    if (open) refreshFlyoutIcons();
  }, [open, refreshFlyoutIcons]);

  useEffect(() => () => {
    if (closeTimerRef.current != null) window.clearTimeout(closeTimerRef.current);
  }, []);

  const menu = open && portalRoot ? createPortal(
    <div
      ref={menuRef}
      className={`toolbar-flyout-menu toolbar-flyout-menu-portal${menuClassName ? ` ${menuClassName}` : ''} is-open`}
      role="menu"
      aria-label={ariaLabel}
      style={{ left: `${menuPos.left}px`, top: `${menuPos.top}px` }}
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
    >
      {groups.map((group, gi) => (
        <div key={group.heading ?? gi} className="toolbar-flyout-section">
          {group.heading ? <div className="toolbar-flyout-heading">{group.heading}</div> : null}
          <div className="toolbar-flyout-list">
            {group.items.map((item) => (
              <button
                key={item.label}
                type="button"
                className="toolbar-flyout-item"
                role="menuitem"
                title={item.label}
                onClick={() => {
                  setOpen(false);
                  item.action();
                }}
              >
                <i data-lucide={item.icon} className="w-4 h-4"></i>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>,
    portalRoot,
  ) : null;

  return (
    <>
      <div
        className={`toolbar-flyout${open ? ' is-open' : ''}`}
        onMouseEnter={openMenu}
        onMouseLeave={scheduleClose}
      >
        <button
          ref={triggerRef}
          type="button"
          className={`tool-btn tool-btn-ghost tool-btn-icon-only toolbar-flyout-trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
          title={showTooltip ? triggerLabel : undefined}
          aria-label={triggerLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => {
            syncMenuPos();
            setOpen((value) => !value);
          }}
        >
          <i data-lucide={triggerIcon} className="w-4 h-4"></i>
          <span>{triggerLabel}</span>
        </button>
      </div>
      {menu}
    </>
  );
}

function ToolbarAgentFlyout() {
  return (
    <ToolbarFlyout
      triggerIcon="bot"
      triggerLabel="Agent"
      ariaLabel="Agent nodes"
      menuClassName="toolbar-flyout-menu-agents"
      groups={AGENT_FLYOUT_GROUPS}
      showTooltip={false}
    />
  );
}

function ToolbarNodeFlyout() {
  return (
    <ToolbarFlyout
      triggerIcon="plus"
      triggerLabel="节点"
      triggerClassName="toolbar-flyout-trigger-primary"
      ariaLabel="添加节点"
      menuClassName="toolbar-flyout-menu-nodes"
      groups={NODE_FLYOUT_GROUPS}
      showTooltip={false}
    />
  );
}

export const InfiniteCanvasShell = memo(function InfiniteCanvasShell({
  rootRef,
  materialLibraryOpen = false,
  onMaterialLibraryOpenChange,
}: Props) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      assignRootRef(rootRef, node);
      if (node) seedCanvasRootMarkers(node);
    },
    [rootRef],
  );

  return (
    <div ref={mergedRef} className={`infinite-canvas-root theme-dark${materialLibraryOpen ? ' material-library-open' : ''}`}>
      {/* #shell 禁止写 className，由 canvasEngine 独占 no-canvas / theme-dark */}
      <div id="shell">
              <div className="topbar editor-only">
                  <div className="panel canvas-topbar-compact">
                      <div className="canvas-topbar-nav">
                          <button id="backToManagerBtn" className="tool-btn tool-btn-back" type="button" title="返回画布管理" aria-label="返回画布管理" data-i18n-title="canvas.backToManager"><i data-lucide="arrow-left" className="w-4 h-4"></i></button>
                          <div className="canvas-nav-meta">
                              <div id="currentCanvasTitle" className="current-canvas-title">未命名画布</div>
                              <div id="currentCanvasTime" className="current-canvas-time">--</div>
                          </div>
                          <p id="saveState" style={{ display: "none" }} data-i18n="canvas.chooseFirst">请选择或新建画布</p>
                      </div>
                  </div>
              </div>

              <motion.div
                id="quickToolbar"
                className="canvas-side-dock bottombar panel editor-only"
                animate={{ x: materialLibraryOpen ? -16 : 0, y: '-50%', opacity: materialLibraryOpen ? 0 : 1 }}
                transition={dockSpring}
                style={{ pointerEvents: materialLibraryOpen ? 'none' : 'auto' }}
              >
                  <ToolbarNodeFlyout />
                  <ToolbarAgentFlyout />
                  <button
                    type="button"
                    className={`tool-btn tool-btn-ghost tool-btn-icon-only${materialLibraryOpen ? ' is-active' : ''}`}
                    title="素材库"
                    aria-label="素材库"
                    aria-pressed={materialLibraryOpen}
                    onClick={() => onMaterialLibraryOpenChange?.(!materialLibraryOpen)}
                  >
                      <i data-lucide="library" className="w-4 h-4"></i>
                      <span data-i18n="canvas.materialLibrary">素材库</span>
                  </button>
                  <span className="canvas-side-dock-sep" aria-hidden="true" />
                  <button
                    type="button"
                    className="tool-btn tool-btn-ghost tool-btn-icon-only"
                    title="历史（成片库 / 本板日志）"
                    aria-label="历史"
                    onClick={() => canvasWin["openCanvasHistoryHub"]?.()}
                  >
                      <History className="w-4 h-4" aria-hidden />
                      <span>历史</span>
                  </button>
                  <button
                    type="button"
                    className={`tool-btn tool-btn-ghost tool-btn-icon-only${shortcutsOpen ? ' is-active' : ''}`}
                    title="快捷键"
                    aria-label="快捷键"
                    aria-pressed={shortcutsOpen}
                    onClick={() => setShortcutsOpen((value) => !value)}
                  >
                      <Keyboard className="w-4 h-4" aria-hidden />
                      <span>快捷键</span>
                  </button>
              </motion.div>
              <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      
              <div id="canvasGate" className="canvas-gate">
                  <div className="gate-panel">
                      <div className="gate-head gate-head-trash">
                          <button id="gateBackBtn" className="gate-back-link" type="button"><i data-lucide="arrow-left" className="w-3.5 h-3.5"></i><span data-i18n="canvas.backToList">返回画布列表</span></button>
                          <div id="gateSubtitle" className="gate-subtitle" hidden></div>
                      </div>

                      <div className="gate-topbar">
                          <div className="gate-scope-tabs" role="tablist" aria-label="画布范围">
                              <button type="button" className="gate-scope-tab is-active" data-gate-scope="personal" role="tab" aria-selected="true">个人</button>
                              <button type="button" className="gate-scope-tab" data-gate-scope="team" role="tab" aria-selected="false" disabled title="即将上线">团队项目</button>
                          </div>
                          <div id="gateToolbar" className="gate-toolbar">
                              <label className="gate-toolbar-search">
                                  <i data-lucide="search" className="w-3.5 h-3.5"></i>
                                  <input id="gateSearchInput" type="search" placeholder="搜索" autoComplete="off" />
                              </label>
                              <div className="gate-toolbar-filter-wrap">
                                  <button id="gateFilterBtn" type="button" className="gate-toolbar-filter">
                                      <span id="gateFilterLabel">显示全部</span>
                                      <i data-lucide="chevron-down" className="w-3.5 h-3.5"></i>
                                  </button>
                                  <div id="gateFilterMenu" className="gate-filter-menu" hidden role="menu">
                                      <div className="gate-filter-section">
                                          <div className="gate-filter-section-label">筛选</div>
                                          <button type="button" role="menuitemradio" className="is-active" data-gate-filter-type="all" aria-checked="true">
                                              <span>显示全部</span>
                                              <i data-lucide="check" className="gate-filter-check w-3.5 h-3.5" aria-hidden="true" />
                                          </button>
                                          <button type="button" role="menuitemradio" data-gate-filter-type="folders" aria-checked="false">
                                              <span>仅文件夹</span>
                                              <i data-lucide="check" className="gate-filter-check w-3.5 h-3.5" aria-hidden="true" />
                                          </button>
                                          <button type="button" role="menuitemradio" data-gate-filter-type="projects" aria-checked="false">
                                              <span>仅项目</span>
                                              <i data-lucide="check" className="gate-filter-check w-3.5 h-3.5" aria-hidden="true" />
                                          </button>
                                      </div>
                                      <div className="gate-filter-divider" aria-hidden="true" />
                                      <div className="gate-filter-section">
                                          <div className="gate-filter-section-label">排序方式</div>
                                          <button type="button" role="menuitemradio" className="is-active" data-gate-sort-by="updated" aria-checked="true">
                                              <span>按最近修改</span>
                                              <i data-lucide="check" className="gate-filter-check w-3.5 h-3.5" aria-hidden="true" />
                                          </button>
                                          <button type="button" role="menuitemradio" data-gate-sort-by="created" aria-checked="false">
                                              <span>按创建日期</span>
                                              <i data-lucide="check" className="gate-filter-check w-3.5 h-3.5" aria-hidden="true" />
                                          </button>
                                      </div>
                                      <div className="gate-filter-divider" aria-hidden="true" />
                                      <div className="gate-filter-section">
                                          <div className="gate-filter-section-label">顺序</div>
                                          <button type="button" role="menuitemradio" className="is-active" data-gate-sort-order="desc" aria-checked="true">
                                              <span>最新优先</span>
                                              <i data-lucide="check" className="gate-filter-check w-3.5 h-3.5" aria-hidden="true" />
                                          </button>
                                          <button type="button" role="menuitemradio" data-gate-sort-order="asc" aria-checked="false">
                                              <span>最早优先</span>
                                              <i data-lucide="check" className="gate-filter-check w-3.5 h-3.5" aria-hidden="true" />
                                          </button>
                                      </div>
                                  </div>
                              </div>
                              <div className="gate-toolbar-view" role="group" aria-label="视图切换">
                                  <button id="gateViewGridBtn" type="button" className="gate-toolbar-view-btn is-active" aria-pressed="true" title="网格视图" aria-label="网格视图">
                                      <i data-lucide="layout-grid" className="w-3.5 h-3.5"></i>
                                  </button>
                                  <button id="gateViewListBtn" type="button" className="gate-toolbar-view-btn" aria-pressed="false" title="列表视图" aria-label="列表视图">
                                      <i data-lucide="list" className="w-3.5 h-3.5"></i>
                                  </button>
                              </div>
                              <button id="gateCreateCollectionBtn" className="gate-toolbar-icon-btn" type="button" title="新建合集" aria-label="新建合集">
                                  <i data-lucide="folder-plus" className="w-4 h-4"></i>
                              </button>
                              <button id="gateCreateBtn" className="gate-toolbar-create-btn" type="button">
                                  <i data-lucide="plus" className="w-4 h-4"></i>
                                  <span>新建项目</span>
                              </button>
                              <button id="gateRefreshBtn" className="gate-toolbar-icon-btn gate-toolbar-ghost" type="button" title="刷新列表" aria-label="刷新列表" data-i18n-title="canvas.refresh" hidden>
                                  <i data-lucide="refresh-cw" className="w-4 h-4"></i>
                              </button>
                              <button id="gateTrashBtn" className="gate-toolbar-icon-btn gate-toolbar-ghost gate-trash-entry" type="button" title="打开回收站" aria-label="打开回收站" data-i18n-title="canvas.openTrash" hidden>
                                  <i data-lucide="trash-2" className="w-4 h-4"></i>
                                  <span id="gateTrashCount" className="gate-trash-badge">0</span>
                              </button>
                              <button id="gateCreateSmartBtn" className="smart-create-btn" type="button" hidden><i data-lucide="sparkles" className="w-4 h-4"></i><span data-i18n="canvas.newSmartCanvas">新建智能画布</span></button>
                          </div>
                      </div>

                      <div id="gateStatus" className="gate-status" data-i18n="canvas.loadingCanvases" hidden>正在加载画布列表...</div>
                      <div className="gate-create-row" hidden aria-hidden="true">
                          <input id="gateTitleInput" className="gate-name-input" type="text" maxLength={80} placeholder="新画布名称（可留空使用默认）" data-i18n-placeholder="canvas.newCanvasPlaceholder" tabIndex={-1} />
                          <button id="gateConfirmBtn" className="create-confirm" type="button" hidden tabIndex={-1} aria-hidden="true"><i data-lucide="check" className="w-4 h-4"></i></button>
                          <button id="gateCancelBtn" className="create-cancel" type="button" hidden tabIndex={-1} aria-hidden="true"><i data-lucide="x" className="w-4 h-4"></i></button>
                      </div>
                      <div className="trash-note"><i data-lucide="info" className="w-3.5 h-3.5 inline-block align-text-bottom mr-1"></i><span data-i18n="canvas.trashNote">回收站中的画布会在 30 天后自动清理。</span></div>
                      <div id="gateLibraryRoot" className="gate-library">
                          <div id="gateCollectionsRoot" className="gate-collections" hidden aria-hidden="true"></div>
                          <div id="gateUncategorizedSection" className="gate-canvas-section gate-uncategorized-section">
                              <div id="gateBoardShell" className="gate-board-shell">
                                  <div id="gateListTableHead" className="gate-list-table-head" hidden aria-hidden="true">
                                      <span className="gate-list-col gate-list-col-preview">预览</span>
                                      <span className="gate-list-col gate-list-col-name">名称</span>
                                      <span className="gate-list-col gate-list-col-type">类型</span>
                                      <span className="gate-list-col gate-list-col-content">内容</span>
                                      <span className="gate-list-col gate-list-col-created">创建时间</span>
                                      <span className="gate-list-col gate-list-col-updated">最近更新</span>
                                  </div>
                                  <div id="gateCanvasList" className="gate-list gate-board-grid"></div>
                              </div>
                          </div>
                      </div>
                  </div>
              </div>

              <div id="gateContextMenu" className="gate-context-menu" hidden role="menu" />

              <div id="gateCollectionModal" className="gate-collection-modal" aria-hidden="true">
                  <div className="gate-collection-modal-panel" role="dialog" aria-modal="true" aria-labelledby="gateCollectionModalTitle">
                      <div id="gateCollectionModalTitle" className="gate-collection-modal-title">创建合集</div>
                      <input id="gateCollectionNameInput" className="gate-name-input gate-collection-name-input" type="text" maxLength={40} placeholder="合集名称" />
                      <div className="gate-collection-modal-actions">
                          <button id="gateCollectionModalCancel" type="button" className="canvas-cancel-btn">取消</button>
                          <button id="gateCollectionModalConfirm" type="button" className="canvas-confirm-btn">确定</button>
                      </div>
                  </div>
              </div>

              <div id="gateCollectionBrowseModal" className="gate-collection-browse-modal" aria-hidden="true">
                  <div className="gate-collection-browse-panel" role="dialog" aria-modal="true" aria-labelledby="gateCollectionBrowseTitle">
                      <div className="gate-collection-browse-head">
                          <div className="gate-collection-browse-head-text">
                              <div id="gateCollectionBrowseTitle" className="gate-collection-browse-title">合集</div>
                              <div id="gateCollectionBrowseCount" className="gate-collection-browse-count">0 张画布</div>
                          </div>
                          <button id="gateCollectionBrowseClose" type="button" className="gate-icon-btn gate-collection-browse-close" aria-label="关闭">
                              <i data-lucide="x" className="w-4 h-4" />
                          </button>
                      </div>
                      <div id="gateCollectionBrowseList" className="gate-list gate-collection-browse-list" />
                  </div>
              </div>
      
              <div id="board" className="board editor-only">
                  <div id="dropOverlay" className="drop-overlay" data-i18n="canvas.dropImage">拖放图片到画布</div>
                  <div className="output-drag-hint editor-only" aria-live="polite">
                      <span data-i18n="canvas.outputDragHint">拖离节点后再松手，即可复制到画布</span>
                  </div>
                  <div id="selectionBox" className="selection-box"></div>
                  <div id="createMenu" className="create-menu">
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('image')}><i data-lucide="image-plus" className="w-4 h-4"></i><span data-i18n="canvas.imageCard">图片卡片</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('imageBatch')}><i data-lucide="images" className="w-4 h-4"></i><span data-i18n="canvas.imageBatchNode">图片组</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('prompt')}><i data-lucide="text-cursor-input" className="w-4 h-4"></i><span data-i18n="canvas.prompt">提示词</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('loop')}><i data-lucide="repeat-2" className="w-4 h-4"></i><span data-i18n="canvas.loopNode">循环节点</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('llm')}><i data-lucide="message-square-text" className="w-4 h-4"></i><span data-i18n="canvas.llmNode">LLM 节点</span></button>
                      <div className="menu-section-title">生成</div>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('generator')}><i data-lucide="wand-sparkles" className="w-4 h-4"></i><span data-i18n="canvas.apiGenerate">图片生成</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('video')}><i data-lucide="clapperboard" className="w-4 h-4"></i><span data-i18n="canvas.videoGenerateNode">视频生成</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('rh')}><i data-lucide="workflow" className="w-4 h-4"></i><span data-i18n="canvas.rhGenerate">RH生成</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('videoReverse')}><i data-lucide="scan-search" className="w-4 h-4"></i><span>视频反推</span></button>
                      <div className="menu-section-title">Agent</div>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('replicaAgent')}><i data-lucide="bot" className="w-4 h-4"></i><span>复刻 Agent</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('imageRepairAgent')}><i data-lucide="wand-sparkles" className="w-4 h-4"></i><span>修图 Agent</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('batchPosterAgent')}><i data-lucide="layout-grid" className="w-4 h-4"></i><span>Batch Poster Agent</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('nineGridAgent')}><i data-lucide="grid-3x3" className="w-4 h-4"></i><span>九宫格 Agent</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('slotsLoopVideoAgent')}><i data-lucide="repeat-2" className="w-4 h-4"></i><span>Slots 循环视频 Agent</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('mxShellPromptAgent')}><i data-lucide="film" className="w-4 h-4"></i><span>Mx-Shell 提示词 Agent</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('deepWhiteShotAgent')}><i data-lucide="clapperboard" className="w-4 h-4"></i><span>DeepWhite 导演分镜 Agent</span></button>
                      <div className="menu-section-title">输出</div>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('output')}><i data-lucide="circle-dot" className="w-4 h-4"></i><span>Output</span></button>
                      <button className="menu-btn" onClick={() => canvasWin["menuAdd"]?.('textOutput')}><i data-lucide="file-output" className="w-4 h-4"></i><span>文本输出</span></button>
                  </div>
                  <div id="linkCreateMenu" className="create-menu"></div>
                  <div id="nodeInputMenu" className="create-menu"></div>
                  <div id="nodeOutputMenu" className="create-menu"></div>
                  <div id="imageNodeMenu" className="create-menu"></div>
                  <div id="selectionMenu" className="create-menu selection-menu"></div>
                  <div id="world" className="world">
                      <svg id="links" className="links"></svg>
                      <div id="linkControls" className="link-controls"></div>
                      <div id="nodes"></div>
                  </div>
                  <div id="minimap" className="minimap" title="导航地图">
                      <div id="minimapContent" className="minimap-content">
                          <div id="minimapViewport" className="minimap-viewport"></div>
                      </div>
                  </div>
              </div>
              <div className="hint editor-only" data-i18n="canvas.hint">拖拽空白处或按住空格拖动画布；滚轮平移；Ctrl + 滚轮缩放；中键平移。Ctrl 框选多选，拖动节点标题栏可移动节点。</div>
              <div id="outputLightbox" className="output-lightbox">
                  <div id="outputLightboxShell" className="output-lightbox-shell">
                  <div id="outputPreview" className="output-preview">
                      <div id="outputCompareContainer" className="output-compare">
                          <img id="outputCompareResult" alt="result image" />
                          <div id="outputCompareOriginalWrap" className="output-compare-original-wrap">
                              <img id="outputCompareOriginal" alt="input image" />
                          </div>
                          <div id="outputCompareSlider" className="output-compare-slider">
                              <div className="output-compare-handle"><i data-lucide="move-horizontal" className="w-4 h-4"></i></div>
                          </div>
                      </div>
                      <img id="outputLightboxImg" className="output-single-img" src="" alt="output preview" />
                      <video id="outputLightboxVideo" className="output-single-video" src="" controls playsInline disablePictureInPicture controlsList="nodownload noplaybackrate noremoteplayback" style={{ display: "none" }}></video>
                      <div className="output-preview-bar">
                          <div id="outputResolution" className="output-resolution">--</div>
                          <div className="output-preview-actions">
                              <button id="outputFavoriteBtn" className="preview-icon-btn output-lightbox-fav" type="button" title="收藏" aria-label="收藏" aria-pressed="false"><i data-lucide="star" className="w-4 h-4"></i></button>
                              <button id="outputDownloadBtn" className="preview-icon-btn" type="button" title="下载" aria-label="下载" data-i18n-title="canvas.download"><i data-lucide="download" className="w-4 h-4"></i></button>
                              <button id="outputLightboxCloseBtn" className="preview-icon-btn" type="button" title="关闭" aria-label="关闭" data-i18n-title="common.close"><i data-lucide="x" className="w-4 h-4"></i></button>
                          </div>
                      </div>
                  </div>
                  <div id="outputPromptPanel" className="output-prompt-panel">
                      <div id="outputPromptText" className="output-prompt-text"></div>
                      <div className="output-prompt-actions">
                          <button id="outputCopyPromptBtn" className="preview-text-btn secondary" type="button"><i data-lucide="copy" className="w-3.5 h-3.5"></i><span data-i18n="canvas.copyPrompt">复制提示词</span></button>
                          <button id="outputRerunBtn" className="preview-text-btn" type="button"><i data-lucide="refresh-cw" className="w-3.5 h-3.5"></i><span data-i18n="canvas.rerun">再次运行</span></button>
                      </div>
                  </div>
                  </div>
              </div>
              <div id="textOutputReader" className="text-output-reader">
                  <div className="text-output-reader-panel" onClick={(e) => e.stopPropagation()}>
                      <div className="text-output-reader-head">
                          <div className="text-output-reader-head-text">
                              <div id="textOutputReaderTitle" className="text-output-reader-title">文本输出</div>
                              <div id="textOutputReaderMeta" className="text-output-reader-meta"></div>
                          </div>
                          <div className="text-output-reader-head-actions">
                              <button id="textOutputReaderCopyBtn" className="text-output-reader-icon-btn" type="button" title="复制全文" aria-label="复制全文"><i data-lucide="copy" className="w-3.5 h-3.5"></i></button>
                              <button id="textOutputReaderCloseBtn" className="text-output-reader-icon-btn" type="button" title="关闭" aria-label="关闭"><i data-lucide="x" className="w-3.5 h-3.5"></i></button>
                          </div>
                      </div>
                      <div className="text-output-reader-body">
                          <nav id="textOutputReaderToc" className="text-output-reader-toc" aria-label="章节目录"></nav>
                          <div id="textOutputReaderContent" className="text-output-reader-content"></div>
                      </div>
                  </div>
              </div>
              <div id="workflowTemplateModal" className="workflow-template-modal studio-modal-backdrop" onClick={() => canvasWin["closeWorkflowTemplateModal"]?.()}>
                  <div className="workflow-template-panel studio-modal-panel" onClick={(e) => e.stopPropagation()}>
                      <div className="studio-modal-head workflow-template-head">
                          <div className="studio-modal-head-text">
                              <div className="studio-modal-title workflow-template-title" data-i18n="canvas.workflowTemplates">工作流模板</div>
                              <div className="studio-modal-sub workflow-template-sub" data-i18n="canvas.workflowModalHint">点击卡片插入当前画布；可保存当前连线为模板</div>
                          </div>
                          <button className="studio-modal-close preview-icon-btn" type="button" onClick={() => canvasWin["closeWorkflowTemplateModal"]?.()} title="关闭" data-i18n-title="common.close" aria-label="关闭">
                              <i data-lucide="x" className="w-4 h-4"></i>
                          </button>
                      </div>
                      <div className="studio-modal-toolbar workflow-template-toolbar">
                          <label className="studio-modal-search">
                              <i data-lucide="search" className="w-3.5 h-3.5" aria-hidden />
                              <input id="workflowTemplateSearchInput" type="search" placeholder="搜索模板名称或说明…" data-i18n-placeholder="canvas.wfSearchPlaceholder" autoComplete="off" />
                          </label>
                          <div className="studio-modal-filters" role="group" aria-label="模板筛选">
                              <button type="button" className="studio-filter-chip is-active" data-wf-filter="all" data-i18n="canvas.wfFilterAll">全部</button>
                              <button type="button" className="studio-filter-chip" data-wf-filter="builtin" data-i18n="canvas.wfFilterBuiltin">内置</button>
                              <button type="button" className="studio-filter-chip" data-wf-filter="custom" data-i18n="canvas.wfFilterCustom">自定义</button>
                          </div>
                          <button id="saveWorkflowTemplateBtn" className="studio-modal-primary-btn" type="button" onClick={() => canvasWin["saveCurrentCanvasAsWorkflowTemplate"]?.()}>
                              <i data-lucide="bookmark-plus" className="w-4 h-4" aria-hidden />
                              <span data-i18n="canvas.saveWorkflowTemplate">保存当前为模板</span>
                          </button>
                      </div>
                      <div id="workflowTemplateSaveForm" className="workflow-template-save-form" hidden>
                          <div className="workflow-template-save-grid">
                              <label className="studio-modal-field">
                                  <span data-i18n="canvas.wfTemplateName">模板名称</span>
                                  <input id="workflowTemplateTitleInput" type="text" maxLength={80} placeholder="例如：九宫格批量复刻" data-i18n-placeholder="canvas.wfTemplateNamePlaceholder" />
                              </label>
                              <label className="studio-modal-field">
                                  <span data-i18n="canvas.wfTemplateDesc">模板说明</span>
                                  <textarea id="workflowTemplateDescInput" rows={3} maxLength={240} placeholder="写给同事看的用途说明（可选）" data-i18n-placeholder="canvas.wfTemplateDescPlaceholder" />
                              </label>
                          </div>
                          <div className="workflow-template-save-actions">
                              <button id="workflowTemplateSaveCancel" type="button" className="studio-modal-ghost-btn" data-i18n="common.cancel">取消</button>
                              <button id="workflowTemplateSaveConfirm" type="button" className="studio-modal-primary-btn" data-i18n="canvas.wfSave">保存模板</button>
                          </div>
                      </div>
                      <div id="workflowTemplateDeleteBar" className="studio-modal-inline-confirm" hidden>
                          <span id="workflowTemplateDeleteLabel" className="studio-modal-inline-confirm-text">确定删除该模板？</span>
                          <div className="studio-modal-inline-confirm-actions">
                              <button id="workflowTemplateDeleteCancel" type="button" className="studio-modal-ghost-btn" data-i18n="common.cancel">取消</button>
                              <button id="workflowTemplateDeleteConfirm" type="button" className="studio-modal-danger-btn" data-i18n="common.delete">删除</button>
                          </div>
                      </div>
                      <div id="workflowTemplateList" className="workflow-template-list" />
                  </div>
              </div>
              <div id="logModal" className="log-modal studio-modal-backdrop" onClick={() => canvasWin["closeCanvasLog"]?.()}>
                  <div className="log-panel studio-modal-panel" onClick={(e) => e.stopPropagation()}>
                      <div className="studio-modal-head log-head">
                          <div className="studio-modal-head-text">
                              <div className="studio-modal-title log-title" data-i18n="canvas.generationLogs">本板日志</div>
                              <div id="logModalCount" className="studio-modal-sub">0 条记录</div>
                          </div>
                          <button className="studio-modal-close preview-icon-btn" type="button" onClick={() => canvasWin["closeCanvasLog"]?.()} title="关闭" data-i18n-title="common.close" aria-label="关闭">
                              <i data-lucide="x" className="w-4 h-4"></i>
                          </button>
                      </div>
                      <div className="canvas-history-tabs in-log-modal" role="tablist" aria-label="历史切换">
                          <button type="button" className="canvas-history-tab" data-history-tab="library" role="tab" aria-selected="false">成片库</button>
                          <button type="button" className="canvas-history-tab is-active" data-history-tab="logs" role="tab" aria-selected="true">本板日志</button>
                      </div>
                      <div className="studio-modal-toolbar log-toolbar">
                          <label className="studio-modal-search">
                              <i data-lucide="search" className="w-3.5 h-3.5" aria-hidden />
                              <input id="logSearchInput" type="search" placeholder="搜索提示词、平台、任务 ID…" data-i18n-placeholder="canvas.logSearchPlaceholder" autoComplete="off" />
                          </label>
                          <div className="studio-modal-filters" role="group" aria-label="日志筛选">
                              <button type="button" className="studio-filter-chip is-active" data-log-filter="all" data-i18n="canvas.logFilterAll">全部</button>
                              <button type="button" className="studio-filter-chip" data-log-filter="ok" data-i18n="canvas.logFilterSuccess">成功</button>
                              <button type="button" className="studio-filter-chip" data-log-filter="failed" data-i18n="canvas.logFilterFailed">失败</button>
                          </div>
                          <button id="logClearBtn" type="button" className="studio-modal-ghost-btn" data-i18n="canvas.logClear">清空</button>
                      </div>
                      <div id="logClearBar" className="studio-modal-inline-confirm" hidden>
                          <span className="studio-modal-inline-confirm-text" data-i18n="canvas.logClearConfirm">确定清空全部生成记录？此操作不可撤销。</span>
                          <div className="studio-modal-inline-confirm-actions">
                              <button id="logClearCancel" type="button" className="studio-modal-ghost-btn" data-i18n="common.cancel">取消</button>
                              <button id="logClearConfirm" type="button" className="studio-modal-danger-btn" data-i18n="canvas.logClear">清空</button>
                          </div>
                      </div>
                      <div id="logList" className="log-list"></div>
                  </div>
              </div>
              <div id="imageEditModal" className="image-edit-modal" onClick={() => closeImageEditor()}>
                  <div className="image-edit-panel" onClick={(e) => e.stopPropagation()}>
                      <div className="image-edit-head">
                          <div>
                              <div id="imageEditTitle" className="image-edit-title" data-i18n="canvas.editImage">编辑图片</div>
                              <div id="imageEditSub" className="image-edit-sub" data-i18n="canvas.editImageSub">选择裁剪或画笔模式</div>
                          </div>
                          <div className="image-edit-mode">
                              <button type="button" data-image-edit-mode="crop" className="active" onClick={(e) => { e.stopPropagation(); setImageEditMode('crop', true); }}><i data-lucide="crop" className="w-3.5 h-3.5"></i><span data-i18n="canvas.modeCrop">裁剪</span></button>
                              <button type="button" data-image-edit-mode="brush" onClick={(e) => { e.stopPropagation(); setImageEditMode('brush', true); }}><i data-lucide="paintbrush" className="w-3.5 h-3.5"></i><span data-i18n="canvas.modeBrush">画笔</span></button>
                          </div>
                          <button className="preview-icon-btn" type="button" onClick={() => closeImageEditor()} title="关闭" data-i18n-title="common.close"><i data-lucide="x" className="w-4 h-4"></i></button>
                      </div>
                      <div id="imageCropTools" className="image-edit-tools active">
                          <span className="image-edit-sub" data-i18n="canvas.cropAspect">裁剪比例</span>
                          <button type="button" className="crop-aspect-btn active" data-crop-aspect="original" data-i18n="canvas.cropAspectOriginal" onClick={(e) => { e.stopPropagation(); setCropAspectLock('original'); }}>原图比例</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="free" data-i18n="canvas.cropAspectFree" onClick={(e) => { e.stopPropagation(); setCropAspectLock('free'); }}>自由</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="1:1" onClick={(e) => { e.stopPropagation(); setCropAspectLock('1:1'); }}>1:1</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="9:16" onClick={(e) => { e.stopPropagation(); setCropAspectLock('9:16'); }}>9:16</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="16:9" onClick={(e) => { e.stopPropagation(); setCropAspectLock('16:9'); }}>16:9</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="4:3" onClick={(e) => { e.stopPropagation(); setCropAspectLock('4:3'); }}>4:3</button>
                          <button type="button" className="crop-aspect-btn" data-crop-aspect="3:4" onClick={(e) => { e.stopPropagation(); setCropAspectLock('3:4'); }}>3:4</button>
                          <span id="cropAspectHint" className="image-edit-sub"></span>
                      </div>
                      <div id="imageBrushTools" className="image-edit-tools">
                          <button className="image-edit-btn primary" type="button" data-brush-tool="free" onClick={(e) => { e.stopPropagation(); setBrushTool('free'); }} title="自由画笔"><i data-lucide="paintbrush" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" data-brush-tool="rect" onClick={(e) => { e.stopPropagation(); setBrushTool('rect'); }} title="矩形"><i data-lucide="square" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" data-brush-tool="ellipse" onClick={(e) => { e.stopPropagation(); setBrushTool('ellipse'); }} title="椭圆"><i data-lucide="circle" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" data-brush-tool="label" onClick={(e) => { e.stopPropagation(); setBrushTool('label'); }} title="角色编号标注"><i data-lucide="list-ordered" className="w-4 h-4"></i></button>
                          <label><span data-i18n="canvas.color">颜色</span> <input id="paintBrushColor" type="color" value="#ff2d55" /></label>
                          <label><span data-i18n="canvas.brushSize">笔刷</span> <input id="paintBrushSize" type="range" min={2} max={80} value={14} /></label>
                          <button id="brushUndoBtn" className="image-edit-btn secondary" type="button" onClick={(e) => { e.stopPropagation(); undoEditDrawing(); }} title="撤销"><i data-lucide="undo-2" className="w-4 h-4"></i></button>
                          <button id="brushRedoBtn" className="image-edit-btn secondary" type="button" onClick={(e) => { e.stopPropagation(); redoEditDrawing(); }} title="恢复"><i data-lucide="redo-2" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" onClick={(e) => { e.stopPropagation(); clearEditDrawing(); }}><i data-lucide="eraser" className="w-4 h-4"></i><span data-i18n="canvas.clear">清空</span></button>
                          <div id="annotationLabelPick" className="annotation-label-pick" style={{ display: "none" }} />
                          <button id="annotationRestoreBtn" className="image-edit-btn secondary" type="button" onClick={(e) => { e.stopPropagation(); restoreAnnotationBase(); }} title="恢复标注前的原图"><i data-lucide="rotate-ccw" className="w-4 h-4"></i><span>恢复原图</span></button>
                      </div>
                      <div id="imageEditStage" className="image-edit-stage">
                          <div className="image-edit-stage-inner">
                              <div id="cropCanvas" className="crop-canvas">
                                  <img id="cropImage" alt="crop source" />
                                  <canvas id="editDrawCanvas" className="edit-draw-canvas"></canvas>
                                  <div id="cropBox" className="crop-box">
                                      <div id="cropHandle" className="crop-handle"></div>
                                  </div>
                              </div>
                          </div>
                      </div>
                      <div className="image-edit-actions">
                          <span id="imageEditZoomLabel" style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, padding: "0 4px", marginRight: "auto", cursor: "pointer", userSelect: "none" }} title="双击重置缩放" onDoubleClick={() => resetImageEditZoom()}>100%</span>
                          <button className="image-edit-btn secondary" type="button" onClick={() => resetCropBox()}><i data-lucide="rotate-ccw" className="w-4 h-4"></i><span data-i18n="canvas.reset">重置</span></button>
                          <button className="image-edit-btn secondary" type="button" onClick={() => closeImageEditor()} data-i18n="common.cancel">取消</button>
                          <button id="imageEditApplyBtn" className="image-edit-btn primary" type="button" onClick={() => applyImageEdit()}><i data-lucide="crop" className="w-4 h-4"></i><span data-i18n="canvas.applyCrop">应用裁剪</span></button>
                      </div>
                  </div>
              </div>
              <div id="errorModal" className="error-modal" onClick={() => canvasWin["closeErrorModal"]?.()}>
                  <div className="error-panel" onClick={(e) => e.stopPropagation()}>
                      <div className="error-head">
                          <div id="errorTitle" className="error-title" data-i18n="canvas.generationFailed">生成失败</div>
                          <button className="preview-icon-btn" type="button" title="关闭" aria-label="关闭" onClick={() => canvasWin["closeErrorModal"]?.()}><i data-lucide="x" className="w-4 h-4"></i></button>
                      </div>
                      <div id="errorMessage" className="error-message"></div>
                      <div className="error-actions">
                          <button className="error-btn" type="button" onClick={() => canvasWin["copyErrorMessage"]?.()}><i data-lucide="copy" className="w-4 h-4"></i><span>复制</span></button>
                          <button className="error-btn primary" type="button" onClick={() => canvasWin["closeErrorModal"]?.()}>关闭</button>
                      </div>
                  </div>
              </div>
          </div>
      
          
    </div>
  );
});
