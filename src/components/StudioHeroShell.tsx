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
 * 画布壳层进入时 opacity 必须瞬时满不透明，否则会透出 body 浅色底（闪白）。
 */
export function StudioHeroShell({ active, children, className }: StudioHeroShellProps) {
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const isCanvasShell = Boolean(className?.includes('studio-shell-canvas'));

  if (reduceMotion) {
    if (!active) return null;
    return (
      <div
        className={cn(
          'fixed inset-0 z-[65] flex flex-col min-h-0 min-w-0 pointer-events-auto',
          isCanvasShell && 'bg-transparent',
          className,
        )}
      >
        {children}
      </div>
    );
  }

  const canvasEnter = isCanvasShell && active;

  return (
    <motion.div
      className={cn(
        'fixed inset-0 flex flex-col min-h-0 min-w-0 overflow-hidden',
        isCanvasShell && 'bg-transparent',
        !active && '[&_*]:pointer-events-none',
        className,
      )}
      data-shell-active={active ? '1' : '0'}
      initial={false}
      animate={
        active
          ? { opacity: 1, scale: 1 }
          : { opacity: 0, scale: isCanvasShell ? 1 : 0.986 }
      }
      transition={{
        opacity: {
          duration: canvasEnter ? 0 : active ? 0.01 : 0.42,
          ease: SHELL_EASE,
        },
        scale: {
          /* 画布页禁止 scale：缩小 fixed 全屏层会在四边露出 body 浅色底（边缘闪白） */
          duration: isCanvasShell ? 0 : active ? 0.01 : 0.42,
          ease: SHELL_EASE,
        },
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
