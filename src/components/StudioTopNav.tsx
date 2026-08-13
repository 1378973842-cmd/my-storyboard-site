import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  Home,
  Image as ImageIcon,
  Images,
  Layers2,
  Loader2,
  Pencil,
  Plus,
  Search,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useShellNavigation } from '../shell/ShellNavigation';
import { useAuthStore } from '../stores/authStore';
import { StudioAnnouncementsBell } from './StudioAnnouncementsBell';
import { StudioUserMenu } from './StudioUserMenu';
import {
  getCurrentCanvasId,
  isInfiniteCanvasEditorOpen,
  returnToCanvasManager,
  updateCurrentCanvasTitle,
} from '../lib/infiniteCanvas/canvasEngine.js';
import { StudioBackgroundRevealControl } from './StudioBackgroundRevealControl';
import { StudioBrandMark, BRAND_NAME } from './StudioBrand';
import { cn } from '../lib/utils';

type CanvasListItem = {
  id: string;
  title: string;
  kind?: string;
  preview_url?: string;
  created_at?: number;
  updated_at?: number;
};

function formatCanvasParenDate(value?: number) {
  if (!value) return '';
  const time = value < 10000000000 ? value * 1000 : value;
  const date = new Date(time);
  if (Number.isNaN(date.getTime())) return '';
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `(${m}${d})`;
}

/** 顶栏切换列表缓存：打开时先出缓存，后台静默刷新 */
let canvasSwitcherCache: CanvasListItem[] = [];
let canvasSwitcherCacheAt = 0;
let canvasSwitcherInflight: Promise<CanvasListItem[]> | null = null;
const CANVAS_SWITCHER_TTL_MS = 20_000;

function normalizeCanvasList(rows: unknown[]): CanvasListItem[] {
  return rows
    .filter((raw): raw is CanvasListItem => {
      const item = raw as CanvasListItem;
      return Boolean(item?.id) && item.kind !== 'smart';
    })
    .map(item => ({
      id: String(item.id),
      title: String(item.title || 'Untitled'),
      kind: item.kind,
      preview_url: item.preview_url ? String(item.preview_url) : undefined,
      created_at: Number(item.created_at || 0) || undefined,
      updated_at: Number(item.updated_at || 0) || undefined,
    }));
}

async function fetchCanvasSwitcherList(force = false): Promise<CanvasListItem[]> {
  const now = Date.now();
  if (
    !force
    && canvasSwitcherCache.length
    && now - canvasSwitcherCacheAt < CANVAS_SWITCHER_TTL_MS
  ) {
    return canvasSwitcherCache;
  }
  if (canvasSwitcherInflight) return canvasSwitcherInflight;
  canvasSwitcherInflight = (async () => {
    const res = await fetch('/api/canvases', { credentials: 'same-origin' });
    if (!res.ok) throw new Error('load failed');
    const data = await res.json();
    const rows = Array.isArray(data?.canvases) ? data.canvases : [];
    canvasSwitcherCache = normalizeCanvasList(rows);
    canvasSwitcherCacheAt = Date.now();
    return canvasSwitcherCache;
  })().finally(() => {
    canvasSwitcherInflight = null;
  });
  return canvasSwitcherInflight;
}

function invalidateCanvasSwitcherCache() {
  canvasSwitcherCacheAt = 0;
}

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

/** 主页 / 工作空间 / 个人 / 画廊：左上品牌锚点统一（对齐工作空间） */
const OVERLAY_BRAND_CLASS =
  'pointer-events-auto z-[2] absolute left-3 top-5 md:left-5 md:top-6 max-w-[min(560px,calc(100vw-1.5rem))]';

/** 主页四栏：品牌与中栏/右栏共用同一顶距与行高，保证视觉平齐 */
const COVER_HOME_BRAND_CLASS =
  'pointer-events-auto z-[3] absolute left-3 top-3 md:left-5 md:top-3.5 flex h-10 items-center max-w-[min(560px,calc(100vw-1.5rem))]';

const COVER_HOME_NAV_CLASS =
  'pointer-events-none !absolute inset-x-0 top-0 z-[2] flex items-center justify-between px-3 pt-3 md:px-5 md:pt-3.5';

export type StudioNavId = 'cover' | 'storyboard' | 'canvas' | 'grid' | 'editor' | 'director';

type NavItem = {
  id: Exclude<StudioNavId, 'cover'>;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
};

type StudioTopNavProps = {
  active: StudioNavId;
  variant?: 'overlay' | 'embedded';
  className?: string;
  onHome?: () => void;
  /** 功能页隐藏分镜/画布/九宫格等栏目，仅保留品牌返回 */
  hideFeatureNav?: boolean;
  /** 次级页：顶栏显示返回与标题 */
  subPage?:
    | 'my-favorites'
    | 'personal'
    | 'gallery'
    | 'admin-users'
    | 'admin-rh-workflows'
    | 'admin-home-carousel'
    | 'admin-announcements';
  /** 画布页：Logo 下拉导航 */
  showCanvasBrandMenu?: boolean;
};

const CANVAS_BRAND_MENU = [
  { id: 'home', label: '返回主页', icon: Home },
  { id: 'gate', label: '返回选择画布', icon: ArrowLeft },
  { id: 'personal', label: '个人空间', icon: UserRound },
  { id: 'gallery', label: '公共画廊', icon: Images },
  { id: 'rename', label: '重命名', icon: Pencil },
] as const;

const SUB_PAGE_TITLES: Record<NonNullable<StudioTopNavProps['subPage']>, string> = {
  'my-favorites': '我的收藏',
  personal: '个人空间',
  gallery: '公共画廊',
  'admin-users': '用户管理',
  'admin-rh-workflows': 'RunningHub 工作流',
  'admin-home-carousel': '主页轮播',
  'admin-announcements': '公告管理',
};

type CoverCenterNavId = 'home' | 'workspace' | 'personal' | 'gallery';

type CoverCenterNavItem = {
  id: CoverCenterNavId;
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  active: boolean;
};

function CanvasHeaderCluster({
  onHome,
  heroTone,
  className,
}: {
  onHome: () => void;
  heroTone?: boolean;
  className?: string;
}) {
  const { openPersonal, openGallery } = useShellNavigation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [meta, setMeta] = useState<{
    title: string;
    canvasId: string;
    status: string;
    statusKind: string;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [canvasList, setCanvasList] = useState<CanvasListItem[]>(() => canvasSwitcherCache);
  const [listLoading, setListLoading] = useState(false);
  const [listQuery, setListQuery] = useState('');
  const [switchBusy, setSwitchBusy] = useState(false);
  const clusterRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const titleBtnRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const renameBusyRef = useRef(false);

  const syncMeta = useCallback(() => {
    if (!isInfiniteCanvasEditorOpen()) {
      setMeta(null);
      setEditing(false);
      setSwitcherOpen(false);
      return;
    }
    const titleEl = document.getElementById('currentCanvasTitle');
    const saveEl = document.getElementById('saveState');
    if (!titleEl || !saveEl) {
      setMeta(null);
      return;
    }
    setMeta(prev => {
      const next = {
        title: titleEl.textContent?.trim() || 'Untitled',
        canvasId: getCurrentCanvasId(),
        status: saveEl.textContent?.trim() || '已保存到云端',
        statusKind: saveEl.dataset.kind || '',
      };
      if (
        prev?.title === next.title
        && prev?.canvasId === next.canvasId
        && prev?.status === next.status
        && prev?.statusKind === next.statusKind
      ) return prev;
      return next;
    });
  }, []);

  useEffect(() => {
    const syncEditor = () => setEditorOpen(isInfiniteCanvasEditorOpen());
    syncEditor();
    syncMeta();
    const obs = new MutationObserver(() => {
      syncEditor();
      syncMeta();
    });
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-infinite-canvas-editor', 'data-canvas-open'],
    });
    const titleEl = document.getElementById('currentCanvasTitle');
    const saveEl = document.getElementById('saveState');
    if (titleEl) obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    // 镜像隐藏顶栏 #saveState：保存中 / 已保存到云端 写在这里，可见顶栏必须跟着变
    if (saveEl) {
      obs.observe(saveEl, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-kind', 'class', 'hidden'],
      });
    }
    window.addEventListener('canvas-board-bg-change', syncMeta);
    return () => {
      obs.disconnect();
      window.removeEventListener('canvas-board-bg-change', syncMeta);
    };
  }, [syncMeta]);

  const loadCanvasList = useCallback(async (opts?: { force?: boolean; silent?: boolean }) => {
    const force = Boolean(opts?.force);
    const hasCache = canvasSwitcherCache.length > 0;
    if (hasCache) setCanvasList(canvasSwitcherCache);
    // 有缓存时不闪「加载中」，后台刷新即可
    if (!opts?.silent && !hasCache) setListLoading(true);
    try {
      const rows = await fetchCanvasSwitcherList(force);
      setCanvasList(rows);
    } catch {
      if (!hasCache) setCanvasList([]);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!switcherOpen) return;
    // 有模块缓存则静默刷新，避免「加载中」闪一下
    void loadCanvasList({ silent: canvasSwitcherCache.length > 0 });
  }, [switcherOpen, loadCanvasList]);

  const prefetchCanvasList = useCallback(() => {
    if (canvasSwitcherInflight) return;
    if (canvasSwitcherCache.length && Date.now() - canvasSwitcherCacheAt < CANVAS_SWITCHER_TTL_MS) return;
    void fetchCanvasSwitcherList(false).then(rows => setCanvasList(rows)).catch(() => {});
  }, []);

  useEffect(() => {
    if (!menuOpen && !switcherOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (clusterRef.current?.contains(target)) return;
      setMenuOpen(false);
      setSwitcherOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [menuOpen, switcherOpen]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const closeMenus = useCallback(() => {
    setMenuOpen(false);
    setSwitcherOpen(false);
  }, []);

  const startRename = useCallback(() => {
    closeMenus();
    if (!meta) return;
    setDraft(meta.title);
    setEditing(true);
  }, [closeMenus, meta]);

  const cancelRename = useCallback(() => {
    setEditing(false);
    setDraft(meta?.title || '');
  }, [meta?.title]);

  const commitRename = useCallback(async () => {
    if (renameBusyRef.current) return;
    const trimmed = draft.trim();
    if (!trimmed || trimmed === meta?.title) {
      cancelRename();
      return;
    }
    renameBusyRef.current = true;
    setEditing(false);
    try {
      await updateCurrentCanvasTitle(trimmed);
      invalidateCanvasSwitcherCache();
      syncMeta();
    } finally {
      renameBusyRef.current = false;
    }
  }, [cancelRename, draft, meta?.title, syncMeta]);

  const runAction = useCallback(async (id: (typeof CANVAS_BRAND_MENU)[number]['id']) => {
    if (id === 'rename') {
      startRename();
      return;
    }
    closeMenus();
    if (id === 'home') {
      onHome();
      return;
    }
    if (id === 'gate') {
      await returnToCanvasManager();
      return;
    }
    if (id === 'personal') {
      openPersonal();
      return;
    }
    if (id === 'gallery') {
      openGallery();
    }
  }, [closeMenus, onHome, openGallery, openPersonal, startRename]);

  const openCanvasById = useCallback(async (id: string) => {
    if (!id || id === meta?.canvasId || switchBusy) {
      setSwitcherOpen(false);
      return;
    }
    setSwitchBusy(true);
    try {
      const openFn = (window as unknown as { openCanvas?: (canvasId: string) => Promise<void> }).openCanvas;
      if (typeof openFn === 'function') await openFn(id);
      setSwitcherOpen(false);
      syncMeta();
    } finally {
      setSwitchBusy(false);
    }
  }, [meta?.canvasId, switchBusy, syncMeta]);

  const createNewCanvas = useCallback(async () => {
    if (switchBusy) return;
    setSwitchBusy(true);
    try {
      const createFn = (window as unknown as {
        createCanvas?: (opts?: { skipNamePrompt?: boolean }) => Promise<void>;
      }).createCanvas;
      if (typeof createFn === 'function') await createFn({ skipNamePrompt: true });
      invalidateCanvasSwitcherCache();
      setSwitcherOpen(false);
      syncMeta();
    } finally {
      setSwitchBusy(false);
    }
  }, [switchBusy, syncMeta]);

  const onTitleClick = useCallback((e: React.MouseEvent) => {
    if (editing || switchBusy) return;
    // detail>1 是双击的后续 click，避免先关面板再重命名
    if (e.detail > 1) return;
    setMenuOpen(false);
    setSwitcherOpen(prev => !prev);
  }, [editing, switchBusy]);

  const onTitleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startRename();
  }, [startRename]);

  const items = CANVAS_BRAND_MENU.filter(item => item.id === 'home' || editorOpen);
  const q = listQuery.trim().toLowerCase();
  const filteredList = q
    ? canvasList.filter(item => item.title.toLowerCase().includes(q))
    : canvasList;
  const statusKind = meta?.statusKind || '';
  const statusTitle = meta?.status || '';

  return (
    <div ref={clusterRef} className={cn('studio-canvas-header-cluster', className)}>
      <div className={cn('studio-canvas-header-pill', meta && 'has-meta')}>
        <button
          ref={btnRef}
          type="button"
          onClick={e => {
            e.stopPropagation();
            setSwitcherOpen(false);
            setMenuOpen(prev => !prev);
          }}
          className="studio-canvas-pill-seg studio-canvas-pill-logo"
          aria-label={`${BRAND_NAME} 导航`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <StudioBrandMark heroTone={heroTone} menuOpen={menuOpen} showName={false} />
          <ChevronDown
            className={cn('studio-canvas-pill-chevron', menuOpen && 'is-open')}
            strokeWidth={2}
            aria-hidden
          />
        </button>

        {meta ? (
          <>
            <span className="studio-canvas-pill-sep" aria-hidden />
            <div className={cn('studio-canvas-pill-title-wrap', editing && 'is-editing')}>
              {editing ? (
                <input
                  ref={inputRef}
                  type="text"
                  maxLength={80}
                  value={draft}
                  className="studio-canvas-meta-input"
                  aria-label="重命名画布"
                  onChange={e => setDraft(e.target.value)}
                  onBlur={() => void commitRename()}
                  onKeyDown={e => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void commitRename();
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  onMouseDown={e => e.stopPropagation()}
                  onClick={e => e.stopPropagation()}
                />
              ) : (
                <button
                  ref={titleBtnRef}
                  type="button"
                  className="studio-canvas-pill-seg studio-canvas-pill-title"
                  aria-label={`当前画布：${meta.title}，打开画布列表`}
                  aria-expanded={switcherOpen}
                  aria-haspopup="listbox"
                  title="单击切换画布 · 双击重命名"
                  onPointerEnter={prefetchCanvasList}
                  onClick={e => {
                    e.stopPropagation();
                    onTitleClick(e);
                  }}
                  onDoubleClick={onTitleDoubleClick}
                >
                  <span className="studio-canvas-pill-title-text">{meta.title}</span>
                  <ChevronDown
                    className={cn('studio-canvas-pill-chevron', switcherOpen && 'is-open')}
                    strokeWidth={2}
                    aria-hidden
                  />
                </button>
              )}
            </div>
            <span className="studio-canvas-pill-sep" aria-hidden />
            <div
              className={cn(
                'studio-canvas-pill-status',
                statusKind === 'saving' && 'is-saving',
                statusKind === 'saved' && 'is-saved',
                statusKind === 'error' && 'is-error',
              )}
              title={statusTitle}
              aria-label={statusTitle}
            >
              {statusKind === 'saving' ? (
                <Loader2 className="studio-canvas-pill-status-icon is-spin" strokeWidth={2.25} aria-hidden />
              ) : statusKind === 'error' ? (
                <AlertCircle className="studio-canvas-pill-status-icon" strokeWidth={2.25} aria-hidden />
              ) : (
                <Check className="studio-canvas-pill-status-icon" strokeWidth={2.5} aria-hidden />
              )}
            </div>
          </>
        ) : null}
      </div>

      {menuOpen && (
        <div className="studio-brand-menu studio-canvas-header-dropdown" role="menu">
          {items.map(item => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              className="studio-brand-menu-item"
              onClick={e => {
                e.stopPropagation();
                void runAction(item.id);
              }}
            >
              <item.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
      )}

      <AnimatePresence>
        {switcherOpen && meta ? (
          <motion.div
            key="canvas-switcher"
            className="studio-canvas-switcher"
            role="listbox"
            aria-label="画布列表"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={spring}
          >
            <div className="studio-canvas-switcher-search">
              <Search className="studio-canvas-switcher-search-icon" strokeWidth={1.75} aria-hidden />
              <input
                ref={searchRef}
                type="search"
                value={listQuery}
                onChange={e => setListQuery(e.target.value)}
                placeholder="搜索画布"
                className="studio-canvas-switcher-search-input"
                onClick={e => e.stopPropagation()}
                onKeyDown={e => e.stopPropagation()}
              />
            </div>
            <div className="studio-canvas-switcher-list">
              {listLoading && filteredList.length === 0 ? (
                <div className="studio-canvas-switcher-empty">加载中…</div>
              ) : filteredList.length === 0 ? (
                <div className="studio-canvas-switcher-empty">没有匹配的画布</div>
              ) : (
                filteredList.map(item => {
                  const active = item.id === meta.canvasId;
                  const paren = formatCanvasParenDate(item.created_at || item.updated_at);
                  const preview = String(item.preview_url || '').trim();
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="option"
                      aria-selected={active}
                      className={cn('studio-canvas-switcher-item', active && 'is-active')}
                      disabled={switchBusy}
                      onClick={e => {
                        e.stopPropagation();
                        void openCanvasById(item.id);
                      }}
                    >
                      <span className={cn('studio-canvas-switcher-thumb', !preview && 'is-icon')}>
                        {preview ? (
                          <img src={preview} alt="" loading="lazy" decoding="async" draggable={false} />
                        ) : (
                          <ImageIcon strokeWidth={1.6} aria-hidden />
                        )}
                      </span>
                      <span className="studio-canvas-switcher-name">
                        <span className="studio-canvas-switcher-title">{item.title}</span>
                        {paren ? <span className="studio-canvas-switcher-date">{paren}</span> : null}
                      </span>
                      {active ? (
                        <Check className="studio-canvas-switcher-check" strokeWidth={2.5} aria-hidden />
                      ) : (
                        <span className="studio-canvas-switcher-check-spacer" aria-hidden />
                      )}
                    </button>
                  );
                })
              )}
            </div>
            <div className="studio-canvas-switcher-foot">
              <button
                type="button"
                className="studio-canvas-switcher-new"
                disabled={switchBusy}
                onClick={e => {
                  e.stopPropagation();
                  void createNewCanvas();
                }}
              >
                <Plus className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                <span>新建画布</span>
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function NavBrand({
  onHome,
  heroTone,
  className,
  showName = true,
}: {
  onHome: () => void;
  heroTone?: boolean;
  className?: string;
  showName?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onHome}
      className={cn(
        'studio-top-brand-hit group flex items-center shrink-0 min-w-0 cursor-pointer',
        className,
      )}
      aria-label={`${BRAND_NAME} — 返回首页`}
    >
      <StudioBrandMark heroTone={heroTone} showName={showName} />
    </button>
  );
}

function CoverCenterLink({ item }: { item: CoverCenterNavItem }) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      onClick={item.onClick}
      aria-current={item.active ? 'page' : undefined}
      className={cn(
        'cover-nav-text-link shrink-0 cursor-pointer',
        item.active ? 'cover-nav-text-link-active' : 'cover-nav-text-link-muted',
      )}
    >
      {/* 默认透明；悬停/聚焦时才显半透明玻璃胶囊 */}
      <span className="cover-nav-glass-pill" aria-hidden />
      <Icon className="cover-nav-text-link-icon relative z-[1]" strokeWidth={1.9} aria-hidden />
      <span className="cover-nav-text-link-label relative z-[1]">{item.label}</span>
    </button>
  );
}

function NavAction({
  item,
  active,
  compact = false,
}: {
  item: NavItem;
  active: StudioNavId;
  compact?: boolean;
}) {
  const Icon = item.icon;
  const isActive = active === item.id;

  return (
    <motion.button
      type="button"
      onClick={item.onClick}
      whileHover={isActive ? undefined : { y: -1 }}
      whileTap={{ scale: 0.98 }}
      transition={spring}
      title={item.label}
      aria-current={isActive ? 'page' : undefined}
      aria-label={compact ? item.label : undefined}
      className={cn(
        'group relative flex items-center justify-center gap-2 rounded-full cursor-pointer',
        compact ? 'h-9 w-9 md:h-10 md:w-10' : 'px-3.5 py-2',
        // 嵌入式与封面共用玻璃胶囊，避免进分镜后「换皮」
        isActive
          ? 'cover-nav-icon-btn cover-nav-icon-btn-active'
          : 'cover-nav-icon-btn cover-nav-icon-btn-muted opacity-70 hover:opacity-100',
      )}
    >
      <Icon className={cn('shrink-0', compact ? 'w-4 h-4' : 'w-3.5 h-3.5')} strokeWidth={1.75} />
      {!compact && (
        <span className="font-label text-[12px] md:text-[13px] tracking-[0.04em] whitespace-nowrap">
          {item.label}
        </span>
      )}
    </motion.button>
  );
}

export const StudioTopNav: React.FC<StudioTopNavProps> = ({
  active,
  variant = 'embedded',
  className,
  onHome,
  hideFeatureNav = false,
  subPage,
  showCanvasBrandMenu = false,
}) => {
  const {
    screen,
    openCover,
    openInfiniteCanvas,
    openCanvasWorkspace,
    openPersonal,
    openGallery,
    openAdminUsers,
    openAdminRhWorkflows,
    openAdminHomeCarousel,
    openAdminAnnouncements,
    goBack,
  } = useShellNavigation();
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin());
  const [coverNavGlass, setCoverNavGlass] = useState(false);
  /** 已打开具体画布板时隐藏四链，选画布闸门仍保留 */
  const [canvasBoardOpen, setCanvasBoardOpen] = useState(() => isInfiniteCanvasEditorOpen());

  const isOverlayNav = variant === 'overlay';
  useEffect(() => {
    const sync = () => setCanvasBoardOpen(isInfiniteCanvasEditorOpen());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.body, {
      attributes: true,
      attributeFilter: ['data-infinite-canvas-editor', 'data-canvas-open'],
    });
    window.addEventListener('focus', sync);
    return () => {
      obs.disconnect();
      window.removeEventListener('focus', sync);
    };
  }, []);

  /** 主页/工作空间/个人/画廊共用四链；进板后只留左上 logo */
  const isFourTabShell =
    (screen === 'cover' ||
      screen === 'personal' ||
      screen === 'gallery' ||
      screen === 'infinite-canvas') &&
    !(screen === 'infinite-canvas' && canvasBoardOpen);
  const isCoverHomeNav = isOverlayNav && isFourTabShell && !subPage && !hideFeatureNav;

  useEffect(() => {
    if (!isCoverHomeNav) {
      setCoverNavGlass(false);
      return;
    }
    const scroller = document.querySelector('[data-cover-scroll-root]');
    if (!scroller) return;
    const onScroll = () => {
      setCoverNavGlass(scroller.scrollTop > window.innerHeight * 0.35);
    };
    onScroll();
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [isCoverHomeNav]);

  // 非封面：保留画布快捷入口（分镜/九宫格等暂不露出）
  const navItems: NavItem[] = [
    { id: 'canvas', label: '画布', icon: Workflow, onClick: openInfiniteCanvas },
  ];

  const coverCenterItems: CoverCenterNavItem[] = [
    {
      id: 'home',
      label: '主页',
      icon: Home,
      onClick: () => {
        openCover();
        const scroller = document.querySelector('[data-cover-scroll-root]');
        scroller?.scrollTo({ top: 0, behavior: 'smooth' });
      },
      active: screen === 'cover',
    },
    {
      id: 'workspace',
      label: '工作空间',
      icon: Layers2,
      onClick: openCanvasWorkspace,
      active: screen === 'infinite-canvas',
    },
    {
      id: 'personal',
      label: '个人空间',
      icon: UserRound,
      onClick: openPersonal,
      active: screen === 'personal',
    },
    {
      id: 'gallery',
      label: '公共画廊',
      icon: Images,
      onClick: openGallery,
      active: screen === 'gallery',
    },
  ];

  const handleHome = () => {
    if (onHome) {
      onHome();
      return;
    }
    if (screen === 'cover') {
      const scroller = document.querySelector('[data-cover-scroll-root]');
      scroller?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    openCover();
  };

  return (
    <header
      className={cn(
        'cover-hero-nav-bar',
        isOverlayNav &&
          'fixed inset-x-0 top-0 z-[70] pointer-events-none',
        variant === 'embedded' &&
          'flex items-center shrink-0 z-50 px-4 py-3 md:px-6 md:py-4 bg-surface-container-lowest/55 backdrop-blur-[24px]',
        className,
      )}
    >
      {/* 工作空间闸门：点 logo 直接回主页，不弹下拉；进板后仍用画布菜单（无品牌名） */}
      {showCanvasBrandMenu && canvasBoardOpen ? (
        <CanvasHeaderCluster
          onHome={handleHome}
          heroTone={isOverlayNav}
          className={cn(isOverlayNav ? OVERLAY_BRAND_CLASS : 'pointer-events-auto shrink-0')}
        />
      ) : (
        <NavBrand
          onHome={handleHome}
          heroTone={isOverlayNav}
          showName
          className={cn(
            isCoverHomeNav
              ? COVER_HOME_BRAND_CLASS
              : isOverlayNav
                ? OVERLAY_BRAND_CLASS
                : 'pointer-events-auto shrink-0',
            subPage && 'z-[4]',
          )}
        />
      )}

      {subPage ? (
        <div
          className={cn(
            'pointer-events-none z-[2] flex min-w-0 flex-1 items-center justify-end gap-3',
            isOverlayNav ? 'px-6 pt-5 md:px-10 md:pt-7 lg:px-14' : '',
          )}
        >
          <button
            type="button"
            onClick={goBack}
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-[#131313]/75 px-3 py-1.5 text-[13px] text-white/90 transition-colors hover:bg-[#1c1b1b] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            返回
          </button>
          <span className="hidden text-sm text-[#e5e2e1]/55 sm:inline">
            {SUB_PAGE_TITLES[subPage]}
          </span>
        </div>
      ) : null}

      {isCoverHomeNav ? (
        <nav
          className={COVER_HOME_NAV_CLASS}
          aria-label={`${BRAND_NAME} navigation`}
        >
          {/* 左占位：与品牌同宽区，避免右栏被挤；品牌仍绝对定位叠在上面 */}
          <div className="h-10 w-[min(200px,28vw)] shrink-0" aria-hidden />

          <div
            className={cn(
              'pointer-events-auto absolute left-1/2 top-3 z-[3] hidden h-10 -translate-x-1/2 items-center gap-5 md:top-3.5 md:flex md:gap-6 lg:gap-7',
              coverNavGlass && 'cover-glass-nav cover-hero-nav-pill !px-4 !py-0',
            )}
          >
            {coverCenterItems.map((item) => (
              <CoverCenterLink key={item.id} item={item} />
            ))}
          </div>

          <div className="pointer-events-auto ml-auto flex h-10 items-center gap-1.5">
            <div className="flex h-10 items-center gap-2.5 overflow-x-auto custom-scrollbar md:hidden">
              {coverCenterItems.map((item) => (
                <CoverCenterLink key={item.id} item={item} />
              ))}
            </div>
            {user ? (
              <div className="hidden h-10 shrink-0 items-center gap-1.5 md:flex">
                <StudioAnnouncementsBell isAdmin={isAdmin} heroTone />
                <StudioUserMenu
                  user={user}
                  isAdmin={isAdmin}
                  heroTone
                  onPersonal={openPersonal}
                  onAdminUsers={openAdminUsers}
                  onAdminRhWorkflows={openAdminRhWorkflows}
                  onAdminHomeCarousel={openAdminHomeCarousel}
                  onAdminAnnouncements={openAdminAnnouncements}
                />
              </div>
            ) : null}
          </div>
        </nav>
      ) : null}

      {!hideFeatureNav && !isCoverHomeNav && !(screen === 'infinite-canvas' && canvasBoardOpen) ? (
      <nav
        className={cn(
          'pointer-events-auto flex w-full items-center transition-[background,box-shadow,outline-color,padding] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
          isOverlayNav
            ? 'justify-end gap-2 px-6 pt-5 md:gap-3 md:px-10 md:pt-7 lg:px-14'
            : 'justify-end gap-2 md:gap-3 flex-1 min-w-0',
        )}
        aria-label={`${BRAND_NAME} navigation`}
      >
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <div className="hidden min-w-0 items-center gap-1.5 md:flex">
            {navItems.map((item) => (
              <NavAction key={item.id} item={item} active={active} />
            ))}
          </div>

          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto custom-scrollbar">
            <div className="flex items-center gap-1.5 md:hidden">
              {navItems.map((item) => (
                <NavAction key={item.id} item={item} active={active} compact />
              ))}
            </div>

            {isOverlayNav ? <StudioBackgroundRevealControl heroTone /> : null}
          </div>

          {user ? (
            <div className="hidden shrink-0 items-center gap-1.5 md:flex">
              <StudioAnnouncementsBell isAdmin={isAdmin} heroTone={isOverlayNav} />
              <StudioUserMenu
                user={user}
                isAdmin={isAdmin}
                heroTone={isOverlayNav}
                onPersonal={openPersonal}
                onAdminUsers={openAdminUsers}
                onAdminRhWorkflows={openAdminRhWorkflows}
                onAdminHomeCarousel={openAdminHomeCarousel}
                onAdminAnnouncements={openAdminAnnouncements}
              />
            </div>
          ) : null}
        </div>
      </nav>
      ) : null}
    </header>
  );
};
