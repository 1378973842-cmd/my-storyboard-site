import React from 'react';
import { motion } from 'motion/react';
import {
  Camera,
  Clapperboard,
  Grid3x3,
  ImageIcon,
  Workflow,
  type LucideIcon,
} from 'lucide-react';
import { useShellNavigation } from '../shell/ShellNavigation';
import { ThemeToggle } from './ThemeToggle';
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
};

function NavBrand({ onHome, heroTone }: { onHome: () => void; heroTone?: boolean }) {
  return (
    <button
      type="button"
      onClick={onHome}
      className="group flex items-center shrink-0 min-w-0 cursor-pointer"
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
}) => {
  const {
    openCover,
    openStudio,
    openImageEditor,
    openNineGrid,
    openDirectorWorkbench,
    openInfiniteCanvas,
  } = useShellNavigation();

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
          'fixed inset-x-0 top-0 z-[70] px-6 pt-5 md:px-10 md:pt-7 lg:px-14 pointer-events-none',
        variant === 'embedded' &&
          'shrink-0 z-50 px-4 py-3 md:px-6 md:py-4 bg-surface-container-lowest/55 backdrop-blur-[24px]',
        className,
      )}
    >
      <nav
        className={cn(
          'pointer-events-auto mx-auto flex w-full max-w-[1400px] items-center',
          !isCoverHomeNav && 'gap-3 md:gap-4',
        )}
        aria-label="LHZ's Studio navigation"
      >
        <NavBrand onHome={handleHome} heroTone={isOverlayNav} />

        <div
          className={cn(
            'ml-auto flex min-w-0 items-center',
            isCoverHomeNav ? 'gap-8 md:gap-10 lg:gap-12' : 'gap-2 md:gap-3 flex-1 justify-end',
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

            <ThemeToggle heroTone={isOverlayNav} />
          </div>
        </div>
      </nav>
    </header>
  );
};
