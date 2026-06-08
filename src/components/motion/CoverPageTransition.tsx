import React, { useLayoutEffect, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '../../lib/utils';
import { CoverPage } from '../CoverPage';
import { StudioCoverEnter } from './StudioCoverEnter';

const COVER_EASE = [0.22, 1, 0.36, 1] as const;

type CoverPageTransitionProps = {
  show: boolean;
  enterKey: number;
  onStart: () => void;
  onOpenImageEditor: () => void;
  onOpenNineGrid: () => void;
  onOpenDirectorWorkbench?: () => void;
  onOpenInfiniteCanvas?: () => void;
};

/** 封面层：不透明底 + 淡入，避免透视到底层画布；内容轻抬进场 */
export function CoverPageTransition({
  show,
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
      <div className="fixed inset-0 z-[60] h-dvh max-h-dvh overflow-x-hidden overflow-y-auto overscroll-y-auto custom-scrollbar bg-[#0e0e0e] pointer-events-auto">
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
      className={cn(
        'fixed inset-0 overflow-x-hidden bg-[#0e0e0e]',
        'h-dvh max-h-dvh overflow-y-auto overscroll-y-auto custom-scrollbar',
      )}
      initial={false}
      animate={{
        opacity: show ? 1 : 0,
        scale: show ? 1 : 0.96,
        filter: show ? 'blur(0px)' : 'blur(10px)',
      }}
      transition={{ duration: 0.44, ease: COVER_EASE }}
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
