import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Home,
  Images,
  Layers2,
  Pencil,
  UserRound,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useShellNavigation } from '../shell/ShellNavigation';
import { useAuthStore } from '../stores/authStore';
import { StudioAnnouncementsBell } from './StudioAnnouncementsBell';
import { StudioUserMenu } from './StudioUserMenu';
import {
  isInfiniteCanvasEditorOpen,
  returnToCanvasManager,
  updateCurrentCanvasTitle,
} from '../lib/infiniteCanvas/canvasEngine.js';
import { StudioBackgroundRevealControl } from './StudioBackgroundRevealControl';
import { StudioBrandMark, BRAND_NAME } from './StudioBrand';
import { cn } from '../lib/utils';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

/** 主页 / 工作空间 / 个人 / 画廊：左上品牌锚点统一（对齐工作空间） */
const OVERLAY_BRAND_CLASS =
  'pointer-events-auto z-[2] absolute left-3 top-5 md:left-5 md:top-6 max-w-[min(560px,calc(100vw-1.5rem))]';

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const [meta, setMeta] = useState<{
    title: string;
    date: string;
    status: string;
    statusKind: string;
  } | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const menuRef = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const renameBusyRef = useRef(false);

  const syncMeta = useCallback(() => {
    if (!isInfiniteCanvasEditorOpen()) {
      setMeta(null);
      setEditing(false);
      return;
    }
    const titleEl = document.getElementById('currentCanvasTitle');
    const timeEl = document.getElementById('currentCanvasTime');
    const saveEl = document.getElementById('saveState');
    if (!titleEl || !saveEl) {
      setMeta(null);
      return;
    }
    setMeta(prev => {
      const next = {
        title: titleEl.textContent?.trim() || 'Untitled',
        date: timeEl?.dataset?.shortDate?.trim() || '',
        status: saveEl.textContent?.trim() || '已保存到云端',
        statusKind: saveEl.dataset.kind || '',
      };
      if (
        prev?.title === next.title
        && prev?.date === next.date
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
    const timeEl = document.getElementById('currentCanvasTime');
    const saveEl = document.getElementById('saveState');
    if (titleEl) obs.observe(titleEl, { childList: true, characterData: true, subtree: true });
    if (timeEl) {
      obs.observe(timeEl, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-short-date'],
      });
    }
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

  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (menuRef.current?.contains(target) || btnRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    document.addEventListener('click', onDoc);
    return () => document.removeEventListener('click', onDoc);
  }, [menuOpen]);

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  const startRename = useCallback(() => {
    closeMenu();
    if (!meta) return;
    setDraft(meta.title);
    setEditing(true);
  }, [closeMenu, meta]);

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
    closeMenu();
    if (id === 'home') {
      onHome();
      return;
    }
    if (id === 'gate') {
      await returnToCanvasManager();
    }
  }, [closeMenu, onHome, startRename]);

  const items = CANVAS_BRAND_MENU.filter(item => item.id === 'home' || editorOpen);

  return (
    <div className={cn('studio-canvas-header-cluster', className)}>
      <div className="studio-canvas-header-row">
        <button
          ref={btnRef}
          type="button"
          onClick={e => {
            e.stopPropagation();
            setMenuOpen(prev => !prev);
          }}
          className="studio-canvas-header-logo group flex shrink-0 min-w-0 cursor-pointer"
          aria-label={`${BRAND_NAME} 导航`}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
        >
          <StudioBrandMark heroTone={heroTone} menuOpen={menuOpen} showName={false} />
        </button>

        {meta ? (
          <div
            className={cn('studio-canvas-meta', editing && 'is-editing')}
            aria-label={`当前画布：${meta.title}`}
          >
            <div className="studio-canvas-meta-topline">
              {editing ? (
                <input
                  ref={inputRef}
                  type="text"
                  maxLength={80}
                  value={draft}
                  className="studio-canvas-meta-input"
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
                <div
                  className="studio-canvas-meta-title"
                  title="双击重命名"
                  onDoubleClick={e => {
                    e.stopPropagation();
                    startRename();
                  }}
                >
                  {meta.title}
                </div>
              )}
              {meta.date ? <div className="studio-canvas-meta-date">{meta.date}</div> : null}
            </div>
            <div
              className={cn(
                'studio-canvas-meta-status',
                meta.statusKind === 'saving' && 'is-saving',
                meta.statusKind === 'saved' && 'is-saved',
                meta.statusKind === 'error' && 'is-error',
              )}
            >
              {meta.status}
            </div>
          </div>
        ) : null}
      </div>

      {menuOpen && (
        <div ref={menuRef} className="studio-brand-menu studio-brand-menu-below" role="menu">
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
            isOverlayNav ? OVERLAY_BRAND_CLASS : 'pointer-events-auto shrink-0',
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
            className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-[#131313]/75 px-3 py-1.5 text-[13px] text-[#e5e2e1]/75 transition-colors hover:bg-[#1c1b1b] hover:text-[#e5e2e1]"
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
          className={cn(
            'pointer-events-none absolute inset-x-0 top-0 flex items-center justify-between px-3 pt-5 md:px-5 md:pt-6',
          )}
          aria-label={`${BRAND_NAME} navigation`}
        >
          <div
            className={cn(
              'pointer-events-auto absolute left-1/2 top-5 z-[3] hidden -translate-x-1/2 items-center gap-5 md:top-6 md:flex md:gap-6 lg:gap-7',
              coverNavGlass && 'cover-glass-nav cover-hero-nav-pill !px-4 !py-2',
            )}
          >
            {coverCenterItems.map((item) => (
              <CoverCenterLink key={item.id} item={item} />
            ))}
          </div>

          <div className="pointer-events-auto ml-auto flex items-center gap-1.5">
            <div className="flex items-center gap-2.5 overflow-x-auto custom-scrollbar md:hidden">
              {coverCenterItems.map((item) => (
                <CoverCenterLink key={item.id} item={item} />
              ))}
            </div>
            {user ? (
              <div className="hidden shrink-0 items-center gap-1.5 md:flex">
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
