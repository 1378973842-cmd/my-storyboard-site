import React from 'react';
import { cn } from '../lib/utils';

type StudioBrandVariant = 'nav' | 'hero' | 'footer' | 'mark';

interface StudioBrandProps {
  variant?: StudioBrandVariant;
  className?: string;
  /** 主页/叠层导航用：白字描边 */
  heroTone?: boolean;
}

export const BRAND_NAME = 'DreamGrid';
export const BRAND_LOGO_SRC = '/brand-logo.png';

/** 顶栏共用：logo 图；主页可附 DreamGrid 字标 */
export function StudioBrandMark({
  className,
  heroTone = false,
  menuOpen = false,
  showName = true,
}: {
  className?: string;
  heroTone?: boolean;
  menuOpen?: boolean;
  /** 画布顶栏只留图标，不显示 DreamGrid */
  showName?: boolean;
}) {
  return (
    <span
      className={cn('studio-brand-mark', !showName && 'studio-brand-mark-icon-only', className)}
      aria-label={BRAND_NAME}
    >
      <img
        src={BRAND_LOGO_SRC}
        alt=""
        width={32}
        height={32}
        className="studio-brand-mark-logo"
        draggable={false}
      />
      {showName ? (
        <span
          className={cn(
            'cover-nav-brand transition-colors duration-150',
            heroTone ? 'cover-nav-brand-hero' : 'text-on-surface',
            menuOpen && 'text-[#ffb866]',
          )}
        >
          {BRAND_NAME}
        </span>
      ) : null}
    </span>
  );
}

export const StudioBrand: React.FC<StudioBrandProps> = ({
  variant = 'nav',
  className,
  heroTone = false,
}) => {
  if (variant === 'mark') {
    return <StudioBrandMark className={className} heroTone={heroTone} />;
  }

  if (variant === 'hero') {
    return (
      <div className={cn('select-none space-y-3', className)} aria-label={BRAND_NAME}>
        <span className="cover-meta block text-[11px] tracking-[0.38em]">LHZ</span>
        <h1 className="cover-brand-display text-[clamp(3.5rem,12.5vw,7.75rem)]">
          {BRAND_NAME}
        </h1>
      </div>
    );
  }

  if (variant === 'footer') {
    return (
      <span
        className={cn('inline-flex items-center gap-2.5', className)}
        aria-label={BRAND_NAME}
      >
        <img
          src={BRAND_LOGO_SRC}
          alt=""
          width={28}
          height={28}
          className="studio-brand-mark-logo"
          draggable={false}
        />
        <span className="cover-display text-[1.125rem] tracking-[-0.03em]">
          {BRAND_NAME}
        </span>
      </span>
    );
  }

  return <StudioBrandMark className={className} heroTone={heroTone} />;
};
