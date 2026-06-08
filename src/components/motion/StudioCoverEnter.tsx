import React from 'react';
import { motion } from 'motion/react';

const COVER_EASE = [0.22, 1, 0.36, 1] as const;

type StudioCoverEnterProps = {
  /** 从功能页回到封面时递增 */
  enterKey: number;
  children: React.ReactNode;
};

/** 封面内容轻抬淡入（封面无玻璃叠乘问题，可用 opacity） */
export function StudioCoverEnter({ enterKey, children }: StudioCoverEnterProps) {
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) {
    return <>{children}</>;
  }

  return (
    <motion.div
      key={`cover-enter-${enterKey}`}
      initial={enterKey > 0 ? { opacity: 0, y: 18 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.52,
        ease: COVER_EASE,
        delay: enterKey > 0 ? 0.1 : 0,
      }}
    >
      {children}
    </motion.div>
  );
}
