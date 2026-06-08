import React from 'react';
import { cn } from '../lib/utils';

type StudioBrandVariant = 'nav' | 'hero' | 'footer';

interface StudioBrandProps {
  variant?: StudioBrandVariant;
  className?: string;
}

export const StudioBrand: React.FC<StudioBrandProps> = ({ variant = 'nav', className }) => {
  if (variant === 'hero') {
    return (
      <div className={cn('select-none space-y-3', className)} aria-label="LHZ's Studio">
        <span className="cover-meta block text-[11px] tracking-[0.38em]">LHZ&apos;S</span>
        <h1 className="cover-brand-display text-[clamp(3.5rem,12.5vw,7.75rem)]">
          Studio
        </h1>
      </div>
    );
  }

  if (variant === 'footer') {
    return (
      <span
        className={cn('cover-display text-[1.125rem] tracking-[-0.03em]', className)}
        aria-label="LHZ's Studio"
      >
        LHZ&apos;s <span className="cover-brand-accent">Studio</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        'font-headline text-[1.05rem] md:text-[1.12rem] tracking-[-0.035em] text-on-surface shrink-0',
        className,
      )}
      aria-label="LHZ's Studio"
    >
      <span className="font-label text-[8px] tracking-[0.34em] uppercase text-on-surface/35 block leading-none mb-1">
        LHZ
      </span>
      <span className="leading-none">Studio</span>
    </span>
  );
};
