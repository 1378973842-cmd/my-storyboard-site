import { memo } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';

const CONVERGE_EASE = [0.22, 1, 0.36, 1] as const;

type Props = {
  rect: DOMRect | null;
};

/** 工具卡汇聚退场时的琥珀光斑（portal 到 body，不挡画布 instantExit） */
export const ToolConvergeOverlay = memo(function ToolConvergeOverlay({ rect }: Props) {
  if (typeof document === 'undefined' || !rect) return null;

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  return createPortal(
    <AnimatePresence>
      {rect ? (
        <motion.div
          key="tool-converge-bloom"
          className="pointer-events-none fixed inset-0 z-[62]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.42, ease: CONVERGE_EASE }}
          aria-hidden
        >
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle min(520px, 72vw) at ${cx}px ${cy}px, rgba(255,184,102,0.28) 0%, rgba(255,184,102,0.1) 32%, transparent 68%)`,
            }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
});
