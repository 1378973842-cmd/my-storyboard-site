/** Auto-generated from canvas.html — re-run scripts/html-to-jsx-shell.mjs */
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { History, Keyboard, Plus, Search } from 'lucide-react';

const dockSpring = { type: 'spring' as const, stiffness: 300, damping: 30 };
import {
  applyImageEdit,
  closeImageEditor,
  readLastCanvasId,
  redoEditDrawing,
  resetCropBox,
  resetImageEditZoom,
  restoreAnnotationBase,
  rotateImageEditBy90,
  setBrushTool,
  setCropAspectLock,
  setImageEditMode,
  toggleCropAspectMenu,
  toggleImageEditFlip,
  undoEditDrawing,
} from '../../lib/infiniteCanvas/canvasEngine.js';

const canvasWin = window as unknown as Record<string, (...args: unknown[]) => void>;

function assignRootRef(rootRef: Ref<HTMLDivElement>, node: HTMLDivElement | null) {
  if (typeof rootRef === 'function') rootRef(node);
  else if (rootRef && 'current' in rootRef) rootRef.current = node;
}

/**
 * 首帧标记：
 * - 有上次画布 id → 直接进编辑器态（藏 gate），避免刷新闪选画布页
 * - 否则 → no-canvas 显示 gate，避免空顶栏闪一下
 */
function seedCanvasRootMarkers(node: HTMLDivElement) {
  const resumeEditor = Boolean(readLastCanvasId());
  if (node.dataset.editorSession == null) node.dataset.editorSession = resumeEditor ? '1' : '0';
  if (node.dataset.canvasOpen == null) node.dataset.canvasOpen = resumeEditor ? '1' : '0';
  node.classList.toggle('is-editor', resumeEditor);
  // 裁剪/画笔内联编辑会挂 html.canvas-image-edit-open；HMR 中断时先清，避免壳层叠乱
  try { document.documentElement.classList.remove('canvas-image-edit-open'); } catch { /* ignore */ }
  const shell = node.querySelector('#shell');
  if (!shell) return;
  if (!shell.classList.contains('shell')) shell.classList.add('shell');
  if (resumeEditor) shell.classList.remove('no-canvas');
  else if (!shell.classList.contains('no-canvas')) shell.classList.add('no-canvas');
}

type Props = {
  rootRef: Ref<HTMLDivElement>;
  materialLibraryOpen?: boolean;
  onMaterialLibraryOpenChange?: (open: boolean) => void;
};

type FlyoutItem = {
  icon: string;
  label: string;
  desc?: string;
  badge?: string;
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
      { icon: 'bot', label: '复刻 Agent', desc: '角色一致性复刻', action: () => canvasWin['addReplicaAgentNode']?.() },
      { icon: 'wand-sparkles', label: '修图 Agent', desc: '局部修复与润色', action: () => canvasWin['addImageRepairAgentNode']?.() },
      { icon: 'layout-grid', label: 'Poster Agent', desc: '批量海报编排', action: () => canvasWin['addBatchPosterAgentNode']?.() },
      { icon: 'grid-3x3', label: '九宫格 Agent', desc: '分镜九宫格生成', action: () => canvasWin['addNineGridAgentNode']?.() },
      { icon: 'repeat-2', label: 'Slots 循环视频', desc: '槽位循环成片', action: () => canvasWin['addSlotsLoopVideoAgentNode']?.() },
      { icon: 'film', label: 'Mx-Shell 提示词', desc: '影壳提示词编排', action: () => canvasWin['addMxShellPromptAgentNode']?.() },
      { icon: 'file-text', label: 'Mx-Shell 展示', desc: '提示词结果展示', action: () => canvasWin['addMxShellPromptViewNode']?.() },
      { icon: 'clapperboard', label: 'DeepWhite 分镜', desc: '导演分镜 Agent', action: () => canvasWin['addDeepWhiteShotAgentNode']?.() },
      { icon: 'book-open', label: 'DeepWhite 文档', desc: '分镜文档输出', action: () => canvasWin['addDeepWhiteShotViewNode']?.() },
    ],
  },
];

const NODE_FLYOUT_GROUPS: FlyoutGroup[] = [
  {
    heading: '添加节点',
    items: [
      { icon: 'align-left', label: '文本', desc: '可编辑文本，LLM 写入图台，可作生图/生视频提示词', action: () => canvasWin['addPromptNode']?.() },
      { icon: 'circle-play', label: '视频生成', desc: '文生视频 / 图生视频', action: () => canvasWin['addVideoNode']?.() },
      { icon: 'repeat-2', label: '循环', desc: '批量循环执行', action: () => canvasWin['addLoopNode']?.() },
    ],
  },
  {
    heading: '生成',
    items: [
      { icon: 'wand-sparkles', label: '图片生成', desc: 'API 生图', action: () => canvasWin['addGeneratorNode']?.() },
      { icon: 'workflow', label: 'RH 生成', desc: 'RunningHub 工作流', action: () => canvasWin['addRhNode']?.() },
      { icon: 'scan-search', label: '视频反推', desc: '从视频反推提示词', action: () => canvasWin['addVideoReverseNode']?.() },
    ],
  },
  {
    heading: '整理',
    items: [
      { icon: 'images', label: '图片组', desc: '多图集合整理', action: () => canvasWin['createImageBatchFromSelection']?.() },
      { icon: 'layers', label: '提示词组', desc: '多提示词成组', action: () => canvasWin['createPromptGroupFromSelection']?.() },
      { icon: 'file-output', label: '文本输出', desc: '长文本阅读输出', action: () => canvasWin['addTextOutputNode']?.() },
    ],
  },
];
type ShortcutRow = { label: string; keys: string[]; joiner?: '+' | '/' };
type ShortcutGroup = { title: string; rows: ShortcutRow[] };

// 与 canvasEngine.js 中实际绑定保持一致（空白拖=框选；滚轮=平移；Ctrl+滚轮=缩放）
const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '编辑',
    rows: [
      { label: '打组（多选时选类型）', keys: ['Ctrl', 'G'] },
      { label: '复制节点', keys: ['Ctrl', 'C'] },
      { label: '粘贴节点', keys: ['Ctrl', 'V'] },
      { label: '启用 / 禁用节点', keys: ['Ctrl', 'B'] },
      { label: '撤销', keys: ['Ctrl', 'Z'] },
      { label: '重做', keys: ['Ctrl', 'Shift', 'Z'] },
      { label: '重做', keys: ['Ctrl', 'Y'] },
      { label: '自动排布选中', keys: ['Ctrl', 'L'] },
      { label: '搜索节点', keys: ['Ctrl', 'K'] },
      { label: '删除选中 / 悬停连线', keys: ['Delete', 'Backspace'], joiner: '/' },
      { label: '拖动节点时创建副本', keys: ['Alt', '拖动节点'] },
      { label: '双击浮标重命名', keys: ['双击浮标名'] },
    ],
  },
  {
    title: '选择与连线',
    rows: [
      { label: '多选节点', keys: ['Ctrl', '点击节点'] },
      { label: '框选节点', keys: ['拖动空白处'] },
      { label: '拖动多选外框', keys: ['拖动选区框'] },
      { label: '剪断连线', keys: ['Shift', '划过连线'] },
      { label: '拉出新连线', keys: ['拖动端口圆点'] },
    ],
  },
  {
    title: '缩放与平移',
    rows: [
      { label: '平移画布', keys: ['鼠标滚轮'] },
      { label: '平移画布', keys: ['触控板双指滑动'] },
      { label: '放大 / 缩小画布', keys: ['Ctrl', '滚轮'] },
      { label: '平移画布（含节点上）', keys: ['Space', '拖动'] },
      { label: '平移画布（含节点上）', keys: ['鼠标中键拖动'] },
      { label: '快速定位视图', keys: ['拖动小地图'] },
    ],
  },
  {
    title: '其他',
    rows: [
      { label: '取消拉线 / 关闭弹窗', keys: ['Esc'] },
      { label: '大图预览上一张 / 下一张', keys: ['←', '→'], joiner: '/' },
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
                            {ki > 0 ? (
                              <span className="shortcut-plus">{row.joiner === '/' ? '/' : '+'}</span>
                            ) : null}
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
  const openRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ left: 0, top: 0 });
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const root = document.querySelector('.infinite-canvas-root');
    setPortalRoot(root instanceof HTMLElement ? root : null);
  }, []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

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
    const lucide = (window as unknown as {
      lucide?: { createIcons?: (opts?: { root?: HTMLElement }) => void };
    }).lucide;
    // 只刷菜单内图标，避免重绘触发器上的「+」打断旋转动画
    const root = menuRef.current ?? undefined;
    if (root) lucide?.createIcons?.({ root });
    else lucide?.createIcons?.();
  }, []);

  const openMenu = useCallback(() => {
    if (closeTimerRef.current != null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    // 已打开时只取消关闭；勿重算定位——离开「+」后 hover scale 回弹会改 getBoundingClientRect，菜单会抖一下
    if (openRef.current) return;
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
                onClick={() => {
                  setOpen(false);
                  item.action();
                }}
              >
                <span className="toolbar-flyout-item-icon" aria-hidden="true">
                  <i data-lucide={item.icon} className="w-4 h-4"></i>
                </span>
                <span className="toolbar-flyout-item-copy">
                  <span className="toolbar-flyout-item-title">
                    <span className="toolbar-flyout-item-label">{item.label}</span>
                    {item.badge ? <span className="toolbar-flyout-item-badge">{item.badge}</span> : null}
                  </span>
                  {item.desc ? <span className="toolbar-flyout-item-desc">{item.desc}</span> : null}
                </span>
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
          <span
            className={
              triggerClassName?.includes('toolbar-flyout-trigger-primary')
                ? 'toolbar-flyout-trigger-spin'
                : 'toolbar-flyout-trigger-spin dock-icon-anim dock-icon-anim--bot'
            }
            aria-hidden="true"
          >
            <i data-lucide={triggerIcon} className="w-4 h-4"></i>
          </span>
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
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(() => {
    try { return localStorage.getItem('canvas_theme') === 'light' ? 'light' : 'dark'; } catch { return 'dark'; }
  });
  useEffect(() => {
    const onTheme = (e: Event) => {
      const mode = (e as CustomEvent<{ mode?: string }>).detail?.mode;
      if (mode === 'light' || mode === 'dark') setThemeMode(mode);
    };
    window.addEventListener('canvas-theme-change', onTheme);
    return () => window.removeEventListener('canvas-theme-change', onTheme);
  }, []);
  const mergedRef = useCallback(
    (node: HTMLDivElement | null) => {
      assignRootRef(rootRef, node);
      if (node) seedCanvasRootMarkers(node);
    },
    [rootRef],
  );

  return (
    <div ref={mergedRef} className={`infinite-canvas-root${themeMode === 'dark' ? ' theme-dark' : ''}${materialLibraryOpen ? ' material-library-open' : ''}`}>
      {/* #shell 禁止写 className，由 canvasEngine 独占 no-canvas / theme-dark */}
      <div id="shell">
              <div className="topbar editor-only">
                  <div className="panel canvas-topbar-compact">
                      <div className="canvas-topbar-nav">
                          <button id="backToManagerBtn" className="tool-btn tool-btn-back" type="button" title="返回画布管理" aria-label="返回画布管理" data-i18n-title="canvas.backToManager"><i data-lucide="arrow-left" className="w-4 h-4"></i></button>
                          <div className="canvas-nav-meta">
                              <div id="currentCanvasTitle" className="current-canvas-title">Untitled</div>
                              <div id="saveState" className="current-canvas-save">--</div>
                              <div id="currentCanvasTime" className="current-canvas-time" hidden aria-hidden="true">--</div>
                          </div>
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
                      <span className="dock-icon-anim dock-icon-anim--library" aria-hidden="true">
                        {/* 自定义书架：右侧书脊可倾倒叠到左侧书上 */}
                        <svg
                          className="dock-lib-svg"
                          viewBox="0 0 24 24"
                          width="18"
                          height="18"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path className="dock-lib-book" d="M4 4v16" />
                          <path className="dock-lib-book" d="M8 8v12" />
                          <path className="dock-lib-book dock-lib-book--mid" d="M12 6v14" />
                          {/* 稍靠右，倒下后书脚仍在邻书右侧，书脊靠上去而非底边重叠 */}
                          <path className="dock-lib-book dock-lib-book--tip" d="M17.5 6v14" />
                        </svg>
                      </span>
                      <span data-i18n="canvas.materialLibrary">素材库</span>
                  </button>
                  <span className="canvas-side-dock-sep" aria-hidden="true" />
                  <button
                    id="canvasNodeSearchBtn"
                    type="button"
                    className="tool-btn tool-btn-ghost tool-btn-icon-only"
                    title="搜索节点"
                    aria-label="搜索节点"
                    aria-pressed="false"
                    onClick={() => canvasWin["openCanvasNodeSearch"]?.()}
                  >
                      <span className="dock-icon-anim dock-icon-anim--search" aria-hidden="true">
                        <Search className="w-4 h-4" aria-hidden />
                      </span>
                      <span>搜索</span>
                  </button>
                  <button
                    type="button"
                    className="tool-btn tool-btn-ghost tool-btn-icon-only"
                    title="生成历史（成片库）"
                    aria-label="历史"
                    onClick={() => canvasWin["openCanvasHistoryHub"]?.()}
                  >
                      <span className="dock-icon-anim dock-icon-anim--history" aria-hidden="true">
                        <History className="w-4 h-4" aria-hidden />
                      </span>
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
                      <span className="dock-icon-anim dock-icon-anim--keyboard" aria-hidden="true">
                        <Keyboard className="w-4 h-4" aria-hidden />
                      </span>
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
                                  <i data-lucide="search" className="w-4 h-4"></i>
                                  <input id="gateSearchInput" type="search" placeholder="搜索" autoComplete="off" />
                              </label>
                              <div className="gate-toolbar-filter-wrap">
                                  <button id="gateFilterBtn" type="button" className="gate-toolbar-filter">
                                      <span id="gateFilterLabel">显示全部</span>
                                      <i data-lucide="chevron-down" className="w-4 h-4"></i>
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
                                      <i data-lucide="grip" className="w-4 h-4"></i>
                                  </button>
                                  <button id="gateViewListBtn" type="button" className="gate-toolbar-view-btn" aria-pressed="false" title="列表视图" aria-label="列表视图">
                                      <i data-lucide="list" className="w-4 h-4"></i>
                                  </button>
                              </div>
                              <span className="gate-toolbar-sep" aria-hidden="true" />
                              <button id="gateCreateCollectionBtn" className="gate-toolbar-icon-btn" type="button" title="新建合集" aria-label="新建合集">
                                  <i data-lucide="folder-plus" className="w-4 h-4"></i>
                              </button>
                              <button id="gateCreateBtn" className="gate-toolbar-create-btn" type="button">
                                  {/* 用 React 图标，避免 data-lucide createIcons 误替换成刷新符号 */}
                                  <Plus className="w-4 h-4" strokeWidth={2.25} aria-hidden />
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
                  <div id="createMenu" className="create-menu create-menu-nodes">
                      <div className="create-menu-header">添加节点</div>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('prompt')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="align-left" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title" data-i18n="canvas.prompt">文本</span>
                              <span className="menu-btn-desc" data-i18n="canvas.textNodeDesc">可编辑文本，LLM 写入图台，可作生图/生视频提示词</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('imageBatch')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="images" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title" data-i18n="canvas.imageBatchNode">图片组</span>
                              <span className="menu-btn-desc">多图集合整理</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('loop')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="repeat-2" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title" data-i18n="canvas.loopNode">循环节点</span>
                              <span className="menu-btn-desc">批量循环执行</span>
                          </span>
                      </button>
                      <div className="menu-section-title">生成</div>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('generator')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="wand-sparkles" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title" data-i18n="canvas.apiGenerate">图片生成</span>
                              <span className="menu-btn-desc">API 生图</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('video')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="circle-play" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title" data-i18n="canvas.videoGenerateNode">视频生成</span>
                              <span className="menu-btn-desc">文生视频 / 图生视频</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('rh')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="workflow" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title" data-i18n="canvas.rhGenerate">RH生成</span>
                              <span className="menu-btn-desc">RunningHub 工作流</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('videoReverse')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="scan-search" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title">视频反推</span>
                              <span className="menu-btn-desc">从视频反推提示词</span>
                          </span>
                      </button>
                      <div className="menu-section-title">Agent</div>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('replicaAgent')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="bot" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title">复刻 Agent</span>
                              <span className="menu-btn-desc">角色一致性复刻</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('imageRepairAgent')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="wand-sparkles" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title">修图 Agent</span>
                              <span className="menu-btn-desc">局部修复与润色</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('batchPosterAgent')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="layout-grid" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title">Batch Poster Agent</span>
                              <span className="menu-btn-desc">批量海报编排</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('nineGridAgent')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="grid-3x3" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title">九宫格 Agent</span>
                              <span className="menu-btn-desc">分镜九宫格生成</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('slotsLoopVideoAgent')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="repeat-2" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title">Slots 循环视频 Agent</span>
                              <span className="menu-btn-desc">槽位循环成片</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('mxShellPromptAgent')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="film" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title">Mx-Shell 提示词 Agent</span>
                              <span className="menu-btn-desc">影壳提示词编排</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('mxShellPolishAgent')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="wand-sparkles" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title">Mx-Shell 润色 Agent</span>
                              <span className="menu-btn-desc">提示词润色优化</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('deepWhiteShotAgent')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="clapperboard" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title">DeepWhite 导演分镜 Agent</span>
                              <span className="menu-btn-desc">导演分镜编排</span>
                          </span>
                      </button>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('pixarAdScriptAgent')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="sparkles" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title">故事动画分镜 Agent</span>
                              <span className="menu-btn-desc">故事动画分镜脚本</span>
                          </span>
                      </button>
                      <div className="menu-section-title">输出</div>
                      <button className="menu-btn" type="button" onClick={() => canvasWin["menuAdd"]?.('textOutput')}>
                          <span className="menu-btn-icon" aria-hidden="true"><i data-lucide="file-output" className="w-4 h-4"></i></span>
                          <span className="menu-btn-copy">
                              <span className="menu-btn-title">文本输出</span>
                              <span className="menu-btn-desc">长文本阅读输出</span>
                          </span>
                      </button>
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
              <div className="hint editor-only" data-i18n="canvas.hint">空白处拖拽框选；空格/中键拖动画布；滚轮平移；Ctrl+滚轮缩放。Ctrl+点击多选；拖动选区框可整组移动。</div>
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
                              <button id="outputCompareBtn" className="preview-icon-btn output-lightbox-compare" type="button" title="对比" aria-label="对比" aria-pressed="false" hidden><i data-lucide="columns-2" className="w-4 h-4"></i></button>
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
                      <aside className="workflow-template-nav" aria-label="模板分类">
                          <button type="button" className="workflow-template-nav-item" data-wf-filter="recent">
                              <i data-lucide="clock-3" className="w-4 h-4" aria-hidden />
                              <span data-i18n="canvas.wfNavRecent">最近使用</span>
                          </button>
                          <button type="button" className="workflow-template-nav-item" data-wf-filter="mine">
                              <i data-lucide="folder" className="w-4 h-4" aria-hidden />
                              <span data-i18n="canvas.wfNavMine">我的模板</span>
                          </button>
                          <div className="workflow-template-nav-group">
                              <button type="button" className="workflow-template-nav-item workflow-template-nav-public is-active" data-wf-filter="public" data-wf-public-toggle="1" aria-expanded="true">
                                  <i data-lucide="chevron-down" className="w-3.5 h-3.5 workflow-template-nav-chevron" aria-hidden />
                                  <span data-i18n="canvas.wfNavPublic">公开</span>
                              </button>
                              <div id="workflowTemplatePublicCats" className="workflow-template-nav-sub is-open" />
                          </div>
                      </aside>
                      <div className="workflow-template-main">
                          <div className="workflow-template-main-head">
                              <div id="workflowTemplateViewTitle" className="workflow-template-view-title">全部</div>
                              <button className="studio-modal-close preview-icon-btn workflow-template-close" type="button" onClick={() => canvasWin["closeWorkflowTemplateModal"]?.()} title="关闭" data-i18n-title="common.close" aria-label="关闭">
                                  <i data-lucide="x" className="w-4 h-4"></i>
                              </button>
                          </div>
                          <div className="workflow-template-toolbar">
                              <label className="workflow-template-search">
                                  <input id="workflowTemplateSearchInput" type="search" placeholder="搜索 场景/平台/模型…" data-i18n-placeholder="canvas.wfSearchPlaceholder" autoComplete="off" />
                              </label>
                              <button id="workflowTemplateSearchBtn" className="workflow-template-tool-btn" type="button" title="搜索" aria-label="搜索">
                                  <i data-lucide="search" className="w-4 h-4" aria-hidden />
                              </button>
                              <button id="saveWorkflowTemplateBtn" className="workflow-template-create-btn" type="button" onClick={() => canvasWin["saveCurrentCanvasAsWorkflowTemplate"]?.()}>
                                  <span data-i18n="canvas.wfCreate">创建</span>
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
              </div>
              <div id="logModal" className="log-modal studio-modal-backdrop history-hub-modal" onClick={() => canvasWin["closeCanvasLog"]?.()}>
                  <div className="log-panel studio-modal-panel history-hub-panel" onClick={(e) => e.stopPropagation()}>
                      <div className="studio-modal-head log-head">
                          <div className="studio-modal-head-text">
                              <div id="historyHubTitle" className="studio-modal-title log-title history-hub-title">
                                  <i data-lucide="images" className="history-hub-title-icon" aria-hidden />
                                  <span id="historyHubTitleText">生成历史</span>
                              </div>
                              <div id="logModalCount" className="studio-modal-sub">跨画布与当前项目的成片记录</div>
                          </div>
                          <div className="history-hub-head-actions">
                              <div id="historyLibraryControls" className="history-library-controls" data-history-controls="library">
                                  <div className="history-library-zoom" title="缩略图大小">
                                      <i data-lucide="minus" className="w-3.5 h-3.5" aria-hidden />
                                      <input id="historyLibraryZoom" type="range" min="72" max="180" step="4" defaultValue="112" aria-label="缩略图大小" />
                                      <i data-lucide="plus" className="w-3.5 h-3.5" aria-hidden />
                                  </div>
                                  <button id="historyLibrarySortBtn" type="button" className="preview-icon-btn history-library-sort-btn" title="切换排序" aria-label="切换排序">
                                      <i data-lucide="arrow-up-down" className="w-4 h-4" />
                                  </button>
                              </div>
                              <button className="studio-modal-close preview-icon-btn" type="button" onClick={() => canvasWin["closeCanvasLog"]?.()} title="关闭" data-i18n-title="common.close" aria-label="关闭">
                                  <i data-lucide="x" className="w-4 h-4"></i>
                              </button>
                          </div>
                      </div>
                      <div id="historyLibraryPane" className="history-hub-pane" data-history-pane="library">
                          <div className="history-library-scope-row">
                              <div className="history-scope-tabs" role="tablist" aria-label="成片库范围">
                                  <button type="button" className="history-scope-tab is-active" data-history-scope="all" role="tab" aria-selected="true">所有项目</button>
                                  <button type="button" className="history-scope-tab" data-history-scope="current" role="tab" aria-selected="false">当前项目</button>
                              </div>
                          </div>
                          <div className="studio-modal-toolbar history-library-toolbar">
                              <label className="studio-modal-search">
                                  <i data-lucide="search" className="w-3.5 h-3.5" aria-hidden />
                                  <input id="historyLibrarySearch" type="search" placeholder="搜索提示词 / 模型…" autoComplete="off" />
                              </label>
                          </div>
                          <div className="history-library-kind-row">
                              <div className="history-kind-tabs" role="tablist" aria-label="生成历史分类">
                                  <button type="button" className="history-kind-tab is-active" data-history-kind="image" role="tab" aria-selected="true">
                                      图片历史<span className="history-kind-tab-count">(0)</span>
                                  </button>
                                  <button type="button" className="history-kind-tab" data-history-kind="video" role="tab" aria-selected="false">
                                      视频历史<span className="history-kind-tab-count">(0)</span>
                                  </button>
                                  <button type="button" className="history-kind-tab" data-history-kind="audio" role="tab" aria-selected="false" title="暂未开放">
                                      音频历史<span className="history-kind-tab-count">(0)</span>
                                  </button>
                              </div>
                          </div>
                          <div id="historyLibraryList" className="history-library-list">
                              <div className="history-library-empty">加载中…</div>
                          </div>
                      </div>
                  </div>
              </div>
              <div
                id="imageEditModal"
                className="image-edit-modal"
                onClick={(e) => {
                  if (e.target !== e.currentTarget) return;
                  if (e.currentTarget.classList.contains('is-canvas-inline')) return;
                  closeImageEditor();
                }}
              >
                  <div className="image-edit-panel" onClick={(e) => e.stopPropagation()}>
                      <div className="image-edit-head image-edit-head-legacy">
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
                      <div id="imageCropTools" className="image-edit-tools image-edit-tools-legacy active">
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
                      <div id="imageBrushTools" className="image-edit-tools image-edit-tools-legacy">
                          <button className="image-edit-btn primary" type="button" data-brush-tool="free" onClick={(e) => { e.stopPropagation(); setBrushTool('free'); }} title="自由画笔"><i data-lucide="paintbrush" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" data-brush-tool="rect" onClick={(e) => { e.stopPropagation(); setBrushTool('rect'); }} title="矩形"><i data-lucide="square" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" data-brush-tool="ellipse" onClick={(e) => { e.stopPropagation(); setBrushTool('ellipse'); }} title="椭圆"><i data-lucide="circle" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" data-brush-tool="text" onClick={(e) => { e.stopPropagation(); setBrushTool('text'); }} title="文字"><i data-lucide="type" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" data-brush-tool="label" onClick={(e) => { e.stopPropagation(); setBrushTool('label'); }} title="标注序号"><i data-lucide="list-ordered" className="w-4 h-4"></i></button>
                          <label><span data-i18n="canvas.color">颜色</span> <input id="paintBrushColor" type="color" defaultValue="#ff2d55" /></label>
                          <label><span data-i18n="canvas.brushSize">笔刷</span> <input id="paintBrushSize" type="range" min={1} max={80} step={1} defaultValue={48} /></label>
                          <button id="brushUndoBtn" className="image-edit-btn secondary" type="button" onClick={(e) => { e.stopPropagation(); undoEditDrawing(); }} title="撤销"><i data-lucide="undo-2" className="w-4 h-4"></i></button>
                          <button id="brushRedoBtn" className="image-edit-btn secondary" type="button" onClick={(e) => { e.stopPropagation(); redoEditDrawing(); }} title="恢复"><i data-lucide="redo-2" className="w-4 h-4"></i></button>
                          <button className="image-edit-btn secondary" type="button" data-brush-tool="eraser" onClick={(e) => { e.stopPropagation(); setBrushTool('eraser'); }} title="橡皮"><i data-lucide="eraser" className="w-4 h-4"></i><span data-i18n="canvas.eraser">橡皮</span></button>
                          <div id="annotationLabelPick" className="annotation-label-pick" style={{ display: "none" }} />
                          <button id="annotationRestoreBtn" className="image-edit-btn secondary" type="button" onClick={(e) => { e.stopPropagation(); restoreAnnotationBase(); }} title="恢复标注前的原图"><i data-lucide="rotate-ccw" className="w-4 h-4"></i><span>恢复原图</span></button>
                      </div>

                      {/* 画笔：图片上方工具栏（图3） */}
                      <div id="imageEditBrushDock" className="image-edit-brush-dock" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="image-edit-dock-icon" onClick={() => closeImageEditor()} title="关闭" aria-label="close"><i data-lucide="x" className="w-4 h-4"></i></button>
                          <div className="image-edit-brush-tools" id="imageBrushToolsInline">
                              <button type="button" className="image-edit-dock-tool active" data-brush-tool="free" onClick={() => setBrushTool('free')} title="自由画笔"><i data-lucide="paintbrush" className="w-4 h-4"></i></button>
                              <button type="button" className="image-edit-dock-tool" data-brush-tool="rect" onClick={() => setBrushTool('rect')} title="矩形"><i data-lucide="square" className="w-4 h-4"></i></button>
                              <button type="button" className="image-edit-dock-tool" data-brush-tool="ellipse" onClick={() => setBrushTool('ellipse')} title="椭圆"><i data-lucide="circle" className="w-4 h-4"></i></button>
                              <button type="button" className="image-edit-dock-tool" data-brush-tool="eraser" onClick={() => setBrushTool('eraser')} title="橡皮"><i data-lucide="eraser" className="w-4 h-4"></i></button>
                              <button type="button" className="image-edit-dock-tool" data-brush-tool="text" onClick={() => setBrushTool('text')} title="文字"><i data-lucide="type" className="w-4 h-4"></i></button>
                              <button type="button" className="image-edit-dock-tool" data-brush-tool="label" onClick={() => setBrushTool('label')} title="标注序号"><i data-lucide="list-ordered" className="w-4 h-4"></i></button>
                              <div id="brushTextFieldWrap" className="brush-text-field-wrap" hidden>
                                  <input id="brushTextInput" className="brush-text-input" type="text" maxLength={80} placeholder="输入文字后点画布放置" autoComplete="off" />
                              </div>
                              <div id="annotationLabelPickInline" className="annotation-label-pick annotation-label-pick-inline" hidden />
                              <label className="image-edit-dock-color" title="颜色"><input id="paintBrushColorInline" type="color" defaultValue="#ff2d55" onChange={(e) => { const m = document.getElementById('paintBrushColor') as HTMLInputElement | null; if (m) { m.value = e.target.value; m.dispatchEvent(new Event('input', { bubbles: true })); } }} /></label>
                              <label className="image-edit-dock-size" title="笔刷大小"><input id="paintBrushSizeInline" type="range" min={1} max={80} step={1} defaultValue={48} onChange={(e) => { const m = document.getElementById('paintBrushSize') as HTMLInputElement | null; if (m) { m.value = e.target.value; m.dispatchEvent(new Event('input', { bubbles: true })); } }} /></label>
                              <button type="button" className="image-edit-dock-tool" onClick={() => undoEditDrawing()} title="撤销"><i data-lucide="undo-2" className="w-4 h-4"></i></button>
                              <button type="button" className="image-edit-dock-tool" onClick={() => redoEditDrawing()} title="恢复"><i data-lucide="redo-2" className="w-4 h-4"></i></button>
                              <button id="annotationRestoreBtnInline" className="image-edit-dock-tool" type="button" onClick={() => restoreAnnotationBase()} title="恢复原图"><i data-lucide="rotate-ccw" className="w-4 h-4"></i></button>
                          </div>
                          <button id="imageEditBrushSaveBtn" type="button" className="image-edit-dock-save" onClick={() => applyImageEdit()}><i data-lucide="save" className="w-4 h-4"></i><span>Save</span></button>
                      </div>

                      {/* 旋转与镜像：图片上方工具栏（图2） */}
                      <div id="imageEditRotateDock" className="image-edit-rotate-dock" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="image-edit-dock-icon" onClick={() => closeImageEditor()} title="关闭" aria-label="close"><i data-lucide="x" className="w-4 h-4"></i></button>
                          <span className="image-edit-rotate-title">旋转与镜像</span>
                          <span className="image-edit-dock-sep" aria-hidden="true" />
                          <span className="image-edit-rotate-angle" title="当前角度">
                              <i data-lucide="rotate-ccw" className="w-3.5 h-3.5"></i>
                              <span id="imageEditRotateAngle">0°</span>
                          </span>
                          <span className="image-edit-dock-sep" aria-hidden="true" />
                          <button type="button" className="image-edit-dock-tool" onClick={() => rotateImageEditBy90()} title="旋转 90°" aria-label="rotate-90"><i data-lucide="rotate-cw" className="w-4 h-4"></i></button>
                          <button type="button" className="image-edit-dock-tool" data-rotate-flip="h" onClick={() => toggleImageEditFlip('h')} title="水平镜像" aria-label="flip-h"><i data-lucide="flip-horizontal" className="w-4 h-4"></i></button>
                          <button type="button" className="image-edit-dock-tool" data-rotate-flip="v" onClick={() => toggleImageEditFlip('v')} title="垂直镜像" aria-label="flip-v"><i data-lucide="flip-vertical" className="w-4 h-4"></i></button>
                          <button id="imageEditRotateSaveBtn" type="button" className="image-edit-dock-save" onClick={() => applyImageEdit()}><span>保存</span></button>
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

                      {/* 裁剪：底部工具条（图1）+ 宽高比菜单（图2） */}
                      <div id="imageEditCropDock" className="image-edit-crop-dock active" onClick={(e) => e.stopPropagation()}>
                          <button type="button" className="image-edit-dock-icon" onClick={() => closeImageEditor()} title="取消" aria-label="cancel"><i data-lucide="x" className="w-4 h-4"></i></button>
                          <div className="image-edit-crop-aspect-wrap">
                              <button id="cropAspectToggle" type="button" className="image-edit-crop-aspect-btn" aria-expanded="false" onClick={() => toggleCropAspectMenu()}>
                                  <i data-lucide="rectangle-horizontal" className="w-4 h-4"></i>
                                  <span>宽高比</span>
                              </button>
                              <div id="cropAspectMenu" className="crop-aspect-menu" hidden>
                                  <button type="button" className="crop-aspect-menu-item active" data-crop-aspect="original" onClick={() => setCropAspectLock('original')}>原图比例</button>
                                  <button type="button" className="crop-aspect-menu-item" data-crop-aspect="1:1" onClick={() => setCropAspectLock('1:1')}>1 : 1</button>
                                  <button type="button" className="crop-aspect-menu-item" data-crop-aspect="4:3" onClick={() => setCropAspectLock('4:3')}>4 : 3</button>
                                  <button type="button" className="crop-aspect-menu-item" data-crop-aspect="3:4" onClick={() => setCropAspectLock('3:4')}>3 : 4</button>
                                  <button type="button" className="crop-aspect-menu-item" data-crop-aspect="16:9" onClick={() => setCropAspectLock('16:9')}>16 : 9</button>
                                  <button type="button" className="crop-aspect-menu-item" data-crop-aspect="9:16" onClick={() => setCropAspectLock('9:16')}>9 : 16</button>
                                  <button type="button" className="crop-aspect-menu-item" data-crop-aspect="21:9" onClick={() => setCropAspectLock('21:9')}>21 : 9</button>
                                  <div className="crop-aspect-menu-sep" />
                                  <button type="button" className="crop-aspect-menu-item" data-crop-aspect="free" onClick={() => setCropAspectLock('free')}>自定义…</button>
                              </div>
                          </div>
                          <button id="imageEditApplyBtn" type="button" className="image-edit-crop-confirm" onClick={() => applyImageEdit()}>
                              <i data-lucide="check" className="w-4 h-4"></i>
                              <span>确认裁剪</span>
                          </button>
                      </div>

                      <div className="image-edit-actions image-edit-actions-legacy">
                          <span id="imageEditZoomLabel" style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, padding: "0 4px", marginRight: "auto", cursor: "pointer", userSelect: "none" }} title="双击重置缩放" onDoubleClick={() => resetImageEditZoom()}>100%</span>
                          <button className="image-edit-btn secondary" type="button" onClick={() => resetCropBox()}><i data-lucide="rotate-ccw" className="w-4 h-4"></i><span data-i18n="canvas.reset">重置</span></button>
                          <button className="image-edit-btn secondary" type="button" onClick={() => closeImageEditor()} data-i18n="common.cancel">取消</button>
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
