import React from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

const SHELL_EASE = [0.22, 1, 0.36, 1] as const;

type StudioHeroShellProps = {
  /** 当前功能页处于前台（非封面） */
  active: boolean;
  children: React.ReactNode;
  className?: string;
};

/**
 * 功能页壳层：进入时立即就位；回封面时淡出+轻缩放。
 * 不用 filter——会破坏子树 backdrop-filter（选择画布毛玻璃会突然糊一下）。
 */
export function StudioHeroShell({ active, children, className }: StudioHeroShellProps) {
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) {
    if (!active) return null;
    return (
      <div
        className={cn(
          'fixed inset-0 z-[65] flex flex-col min-h-0 min-w-0 pointer-events-auto',
          className,
        )}
      >
        {children}
      </div>
    );
  }

  return (
    <motion.div
      className={cn('fixed inset-0 flex flex-col min-h-0 min-w-0', className)}
      initial={false}
      animate={
        active
          ? { opacity: 1, scale: 1 }
          : { opacity: 0, scale: 0.986 }
      }
      transition={{
        opacity: { duration: active ? 0.01 : 0.42, ease: SHELL_EASE },
        scale: { duration: active ? 0.01 : 0.42, ease: SHELL_EASE },
      }}
      style={{
        zIndex: active ? 65 : 55,
        pointerEvents: active ? 'auto' : 'none',
      }}
      aria-hidden={!active}
    >
      {children}
    </motion.div>
  );
}
