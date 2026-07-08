import React, { useLayoutEffect, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { CoverPage } from '../CoverPage';
import { StudioCoverEnter } from './StudioCoverEnter';

const COVER_EASE = [0.22, 1, 0.36, 1] as const;

type CoverPageTransitionProps = {
  show: boolean;
  /** 进入画布等功能页时封面瞬时收起，避免与画布层交叉淡出露出 body 浅色底 */
  instantExit?: boolean;
  enterKey: number;
  onStart: () => void;
  onOpenImageEditor: () => void;
  onOpenNineGrid: () => void;
  onOpenDirectorWorkbench?: () => void;
  onOpenInfiniteCanvas?: () => void;
};

/** 封面层：不透明底 + 淡入，避免透视到底层画布；勿用 filter（会破坏子树 backdrop-filter） */
export function CoverPageTransition({
  show,
  instantExit = false,
  enterKey,
  onStart,
  onOpenImageEditor,
  onOpenNineGrid,
  onOpenDirectorWorkbench,
  onOpenInfiniteCanvas,
}: CoverPageTransitionProps) {
  const [mounted, setMounted] = useState(show);
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useLayoutEffect(() => {
    if (show) {
      setMounted(true);
    }
  }, [show]);

  if (!mounted) {
    return null;
  }

  if (reduceMotion) {
    if (!show) {
      return null;
    }
    return (
      <div className="fixed inset-0 z-[60] h-dvh max-h-dvh overflow-x-hidden overflow-y-auto overscroll-y-auto custom-scrollbar bg-[#0e0e0e] pointer-events-auto" data-cover-scroll-root="">
        <CoverPage
          onStart={onStart}
          onOpenImageEditor={onOpenImageEditor}
          onOpenNineGrid={onOpenNineGrid}
          onOpenDirectorWorkbench={onOpenDirectorWorkbench}
          onOpenInfiniteCanvas={onOpenInfiniteCanvas}
        />
      </div>
    );
  }

  return (
    <motion.div
      data-cover-scroll-root=""
      className={cn(
        'fixed inset-0 overflow-x-hidden bg-[#0e0e0e]',
        'h-dvh max-h-dvh overflow-y-auto overscroll-y-auto custom-scrollbar',
      )}
      initial={false}
      animate={{
        opacity: show ? 1 : 0,
        scale: show ? 1 : instantExit ? 1 : 0.985,
      }}
      transition={{
        duration: show ? 0.36 : instantExit ? 0 : 0.34,
        ease: COVER_EASE,
      }}
      style={{
        zIndex: show ? 60 : 50,
        pointerEvents: show ? 'auto' : 'none',
      }}
      aria-hidden={!show}
      onAnimationComplete={() => {
        if (!show) {
          setMounted(false);
        }
      }}
    >
      <StudioCoverEnter enterKey={enterKey}>
        <CoverPage
          onStart={onStart}
          onOpenImageEditor={onOpenImageEditor}
          onOpenNineGrid={onOpenNineGrid}
          onOpenDirectorWorkbench={onOpenDirectorWorkbench}
          onOpenInfiniteCanvas={onOpenInfiniteCanvas}
        />
      </StudioCoverEnter>
    </motion.div>
  );
}
