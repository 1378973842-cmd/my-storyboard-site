import React from 'react';
import { motion } from 'motion/react';
import {
  ArrowLeft,
  Camera,
  Clapperboard,
  Grid3x3,
  ImageIcon,
  LogOut,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useShellNavigation } from '../shell/ShellNavigation';
import { logoutSession } from '../lib/authSession';
import { useAuthStore } from '../stores/authStore';
import { StudioBackgroundRevealControl } from './StudioBackgroundRevealControl';
import { cn } from '../lib/utils';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

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
  subPage?: 'my-favorites' | 'gallery' | 'admin-users';
  /** 画布编辑页：在品牌右侧挂载返回/标题条 */
  showCanvasTopbarSlot?: boolean;
};

const SUB_PAGE_TITLES: Record<NonNullable<StudioTopNavProps['subPage']>, string> = {
  'my-favorites': '我的收藏',
  gallery: '公共画廊',
  'admin-users': '用户管理',
};

/** 画布引擎 topbar 挂载点（与 InfiniteCanvas 内 portal 对应） */
export const CANVAS_TOPBAR_SLOT_ID = 'canvas-topbar-slot';

function NavBrand({
  onHome,
  heroTone,
  className,
}: {
  onHome: () => void;
  heroTone?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onHome}
      className={cn('group flex items-center shrink-0 min-w-0 cursor-pointer', className)}
      aria-label="LHZ's Studio — 返回首页"
    >
      <span
        className={cn(
          'cover-nav-brand',
          heroTone ? 'cover-nav-brand-hero' : 'text-on-surface',
        )}
      >
        LHZ&apos;s Studio
      </span>
    </button>
  );
}

function NavTextLink({
  item,
  active,
  heroTone = false,
}: {
  item: NavItem;
  active: StudioNavId;
  heroTone?: boolean;
}) {
  const isActive = active === item.id;

  return (
    <button
      type="button"
      onClick={item.onClick}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'cover-nav-text-link shrink-0 cursor-pointer',
        heroTone
          ? isActive
            ? 'cover-nav-text-link-active'
            : 'cover-nav-text-link-muted'
          : isActive
            ? 'text-on-surface transition-colors duration-150'
            : 'text-on-surface/52 hover:text-on-surface transition-colors duration-150',
      )}
    >
      {item.label}
    </button>
  );
}

function NavAction({
  item,
  active,
  compact = false,
  heroTone = false,
}: {
  item: NavItem;
  active: StudioNavId;
  compact?: boolean;
  heroTone?: boolean;
}) {
  const Icon = item.icon;
  const isActive = active === item.id;

  return (
    <motion.button
      type="button"
      onClick={item.onClick}
      whileHover={heroTone || isActive ? undefined : { y: -1 }}
      whileTap={{ scale: 0.98 }}
      transition={heroTone ? { duration: 0.12 } : spring}
      title={item.label}
      aria-current={isActive ? 'page' : undefined}
      aria-label={compact ? item.label : undefined}
      className={cn(
        'group relative flex items-center justify-center gap-2 rounded-full cursor-pointer',
        compact ? 'h-9 w-9 md:h-10 md:w-10' : 'px-3.5 py-2',
        heroTone
          ? isActive
            ? 'cover-nav-icon-btn cover-nav-icon-btn-active'
            : 'cover-nav-icon-btn cover-nav-icon-btn-muted'
          : [
              'transition-all duration-150',
              isActive
                ? 'bg-surface-container-high/80 text-on-surface shadow-[0_18px_36px_-28px_rgba(0,0,0,0.55)]'
                : 'text-on-surface/52 hover:text-on-surface hover:bg-surface-container-high/45',
            ],
      )}
    >
      <Icon className={cn('shrink-0', compact ? 'w-4 h-4' : 'w-3.5 h-3.5')} strokeWidth={1.75} />
      {!compact && (
        <span className="font-medium text-[12px] md:text-[13px] tracking-[0.02em] whitespace-nowrap">
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
  showCanvasTopbarSlot = false,
}) => {
  const {
    openCover,
    openStudio,
    openImageEditor,
    openNineGrid,
    openDirectorWorkbench,
    openInfiniteCanvas,
    openMyFavorites,
    openGallery,
    openAdminUsers,
    goBack,
  } = useShellNavigation();
  const user = useAuthStore((s) => s.user);
  const isAdmin = useAuthStore((s) => s.isAdmin());

  const navItems: NavItem[] = [
    { id: 'storyboard', label: '分镜', icon: Clapperboard, onClick: openStudio },
    { id: 'canvas', label: '画布', icon: Workflow, onClick: openInfiniteCanvas },
    { id: 'grid', label: '九宫格', icon: Grid3x3, onClick: openNineGrid },
    { id: 'editor', label: '修图', icon: ImageIcon, onClick: openImageEditor },
    { id: 'director', label: '导演', icon: Camera, onClick: openDirectorWorkbench },
  ];

  const handleHome = () => {
    if (onHome) {
      onHome();
      return;
    }
    if (active === 'cover') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    openCover();
  };

  const isOverlayNav = variant === 'overlay';
  /** 与功能页共用同一套图标顶栏，避免封面↔分镜切换时顶栏布局跳动 */
  const isCoverHomeNav = false;

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
      {showCanvasTopbarSlot ? (
        <div
          className={cn(
            'pointer-events-auto z-[2] flex min-w-0 items-center gap-3',
            isOverlayNav
              ? 'absolute left-6 top-5 md:left-10 md:top-7 lg:left-14 max-w-[min(560px,calc(100vw-2rem))]'
              : 'shrink-0',
          )}
        >
          <NavBrand onHome={handleHome} heroTone={isOverlayNav} />
          <div id={CANVAS_TOPBAR_SLOT_ID} className="min-w-0 flex-1" />
        </div>
      ) : (
        <NavBrand
          onHome={handleHome}
          heroTone={isOverlayNav}
          className={cn(
            'pointer-events-auto z-[2]',
            isOverlayNav
              ? 'absolute left-6 top-5 md:left-10 md:top-7 lg:left-14'
              : 'shrink-0',
          )}
        />
      )}

      {subPage ? (
        <div
          className={cn(
            'pointer-events-auto z-[2] flex min-w-0 flex-1 items-center justify-end gap-3',
            isOverlayNav ? 'px-6 pt-5 md:px-10 md:pt-7 lg:px-14' : '',
          )}
        >
          <button
            type="button"
            onClick={goBack}
            className="inline-flex items-center gap-2 rounded-full bg-[#131313]/75 px-3 py-1.5 text-[13px] text-[#e5e2e1]/75 transition-colors hover:bg-[#1c1b1b] hover:text-[#e5e2e1]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            返回
          </button>
          <span className="hidden text-sm text-[#e5e2e1]/55 sm:inline">
            {SUB_PAGE_TITLES[subPage]}
          </span>
        </div>
      ) : null}

      {!hideFeatureNav ? (
      <nav
        className={cn(
          'pointer-events-auto flex w-full items-center',
          isOverlayNav
            ? 'justify-end gap-2 px-6 pt-5 md:gap-3 md:px-10 md:pt-7 lg:px-14'
            : 'justify-end gap-2 md:gap-3 flex-1 min-w-0',
        )}
        aria-label="LHZ's Studio navigation"
      >
        <div
          className={cn(
            'flex min-w-0 items-center',
            isCoverHomeNav ? 'gap-8 md:gap-10 lg:gap-12' : 'gap-2 md:gap-3',
          )}
        >
          <div
            className={cn(
              'hidden min-w-0 items-center',
              isCoverHomeNav ? 'lg:flex gap-7 xl:gap-9' : 'md:flex gap-1.5',
            )}
          >
            {navItems.map((item) =>
              isCoverHomeNav ? (
                <NavTextLink key={item.id} item={item} active={active} heroTone />
              ) : (
                <NavAction key={item.id} item={item} active={active} heroTone={isOverlayNav} />
              ),
            )}
          </div>

          <div
            className={cn(
              'flex min-w-0 items-center',
              isCoverHomeNav ? 'gap-5 md:gap-6 lg:gap-7' : 'gap-1.5 overflow-x-auto custom-scrollbar',
            )}
          >
            <div className={cn('flex items-center', isCoverHomeNav ? 'lg:hidden gap-3' : 'md:hidden gap-1.5')}>
              {navItems.map((item) => (
                <NavAction key={item.id} item={item} active={active} compact heroTone={isOverlayNav} />
              ))}
            </div>

            {isCoverHomeNav ? (
              <>
                <a href="#tools" className="cover-nav-text-link cover-nav-text-link-muted hidden sm:inline-flex">
                  工具
                </a>
                <button
                  type="button"
                  onClick={openStudio}
                  className="cover-nav-auth-pill hidden md:inline-flex items-center px-5 py-2 text-[13px] font-medium cursor-pointer"
                >
                  进入 Studio
                </button>
              </>
            ) : null}

            {!isCoverHomeNav && isOverlayNav ? (
              <StudioBackgroundRevealControl heroTone />
            ) : null}

            <button
              type="button"
              onClick={openMyFavorites}
              className="hidden rounded-full px-3 py-2 text-[12px] text-[#e5e2e1]/60 transition-colors hover:bg-[#1c1b1b]/70 hover:text-[#e5e2e1] md:inline-flex"
            >
              我的收藏
            </button>
            <button
              type="button"
              onClick={openGallery}
              className="hidden rounded-full px-3 py-2 text-[12px] text-[#e5e2e1]/60 transition-colors hover:bg-[#1c1b1b]/70 hover:text-[#e5e2e1] md:inline-flex"
            >
              公共画廊
            </button>
            {isAdmin ? (
              <button
                type="button"
                onClick={openAdminUsers}
                className="hidden rounded-full px-3 py-2 text-[12px] text-[#e5e2e1]/60 transition-colors hover:bg-[#1c1b1b]/70 hover:text-[#e5e2e1] md:inline-flex"
              >
                用户管理
              </button>
            ) : null}

            {user ? (
              <div className="hidden items-center gap-2 md:flex">
                <span className="max-w-[140px] truncate text-[11px] uppercase tracking-[0.08em] text-[#e5e2e1]/45">
                  {user.display_name || user.email}
                </span>
                <button
                  type="button"
                  title="退出登录"
                  onClick={() => void logoutSession().then(() => window.location.reload())}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#e5e2e1]/50 transition-colors hover:bg-[#1c1b1b]/70 hover:text-[#e5e2e1]"
                >
                  <LogOut className="h-4 w-4" aria-hidden />
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </nav>
      ) : null}
    </header>
  );
};
