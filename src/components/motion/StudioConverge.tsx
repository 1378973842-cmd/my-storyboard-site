import React, { useLayoutEffect, useRef } from 'react';
import { motion, useAnimation, type Transition } from 'motion/react';
import { cn } from '../../lib/utils';

const CONVERGE_TRANSFORM_SPRING = {
  type: 'spring' as const,
  stiffness: 220,
  damping: 26,
  mass: 0.95,
};

function convergeTransition(
  delay: number,
  withOpacity: boolean,
  withRotate: boolean,
): Transition {
  const base = { ...CONVERGE_TRANSFORM_SPRING, delay };
  const transition: Transition = {
    x: base,
    y: base,
    scale: base,
  };
  if (withRotate) {
    transition.rotate = base;
  }
  if (withOpacity) {
    transition.opacity = {
      type: 'tween',
      duration: 0.38,
      ease: [0.22, 1, 0.36, 1],
      delay,
    };
  }
  return transition;
}

/** @deprecated */
export const CONVERGE_SPRING: Transition = CONVERGE_TRANSFORM_SPRING;

/** 勿用于 position:fixed 的子树（会破坏顶栏定位） */
export type ConvergeOrigin = 'top' | 'left' | 'right' | 'bottom' | 'center';

type MotionTarget = {
  from: Record<string, number>;
  to: Record<string, number>;
  /** 标题等非玻璃区块可淡入；左右玻璃面板仅位移+缩放+微旋转 */
  withOpacity?: boolean;
  withRotate?: boolean;
};

const ORIGIN_MOTION: Record<ConvergeOrigin, MotionTarget> = {
  top: {
    from: { y: -28, scale: 0.96 },
    to: { y: 0, scale: 1 },
    withOpacity: true,
  },
  left: {
    from: { x: -56, y: 12, scale: 0.92, rotate: -1.2 },
    to: { x: 0, y: 0, scale: 1, rotate: 0 },
    withRotate: true,
  },
  right: {
    from: { x: 56, y: 12, scale: 0.92, rotate: 1.2 },
    to: { x: 0, y: 0, scale: 1, rotate: 0 },
    withRotate: true,
  },
  bottom: {
    from: { y: 30, scale: 0.95 },
    to: { y: 0, scale: 1 },
    withOpacity: true,
  },
  center: {
    from: { y: 16, scale: 0.92 },
    to: { y: 0, scale: 1 },
    withOpacity: true,
  },
};

type StudioConvergePieceProps = {
  origin: ConvergeOrigin;
  /** 每次进入功能页时递增，触发汇聚 */
  enterKey: number;
  delay?: number;
  /** 默认跟随 origin；设为 false 时仅位移/缩放（适合画布 gate 等实色面板） */
  fade?: boolean;
  /** 为 true 时不 remount 子树（画布引擎等需保持挂载） */
  preserveChildren?: boolean;
  className?: string;
  children: React.ReactNode;
};

function buildMotionTargets(
  motionSet: MotionTarget,
  fade: boolean,
): { from: Record<string, number>; to: Record<string, number> } {
  const useOpacity = fade && Boolean(motionSet.withOpacity);
  return {
    from: useOpacity ? { ...motionSet.from, opacity: 0 } : motionSet.from,
    to: useOpacity ? { ...motionSet.to, opacity: 1 } : motionSet.to,
  };
}

export function StudioConvergePiece({
  origin,
  enterKey,
  delay = 0,
  fade,
  preserveChildren = false,
  className,
  children,
}: StudioConvergePieceProps) {
  const motionSet = ORIGIN_MOTION[origin];
  const useFade = fade ?? Boolean(motionSet.withOpacity);
  const useRotate = Boolean(motionSet.withRotate);
  const { from, to } = buildMotionTargets(motionSet, useFade);
  const controls = useAnimation();
  const lastPlayedKeyRef = useRef(0);
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useLayoutEffect(() => {
    if (!preserveChildren) return;
    if (reduceMotion || enterKey < 1) {
      void controls.set(to);
      return;
    }
    if (lastPlayedKeyRef.current === enterKey) {
      void controls.set(to);
      return;
    }
    lastPlayedKeyRef.current = enterKey;

    void controls.set(from);
    void controls.start({
      ...to,
      transition: convergeTransition(delay, useFade, useRotate),
    });
  }, [enterKey, origin, delay, reduceMotion, preserveChildren, controls, from, to, useFade, useRotate]);

  if (reduceMotion) {
    return <div className={className}>{children}</div>;
  }

  if (enterKey < 1) {
    return (
      <motion.div className={className} initial={false} animate={to}>
        {children}
      </motion.div>
    );
  }

  if (preserveChildren) {
    return (
      <motion.div
        className={cn('will-change-transform', className)}
        initial={false}
        animate={controls}
      >
        {children}
      </motion.div>
    );
  }

  return (
    <motion.div
      key={`converge-${origin}-${enterKey}`}
      className={cn('will-change-transform', className)}
      initial={from}
      animate={to}
      transition={convergeTransition(delay, useFade, useRotate)}
    >
      {children}
    </motion.div>
  );
}
