import { memo, useLayoutEffect, useRef } from 'react';
import { motion, useAnimation } from 'motion/react';
import { InfiniteCanvas } from '../components/InfiniteCanvas/InfiniteCanvas';

/** 与主页 CoverHomeWorkspace / 个人空间相同的进场弹簧 */
const HOME_ENTER_SPRING = { type: 'spring' as const, stiffness: 300, damping: 30 };

type Props = {
  onBack?: () => void;
  enterKey?: number;
  /** 画布层是否在台前（离开封面且 screen 为 infinite-canvas） */
  shellActive?: boolean;
};

export const InfiniteCanvasPage = memo(function InfiniteCanvasPage({
  enterKey = 0,
  shellActive = false,
}: Props) {
  const controls = useAnimation();
  const lastPlayedKeyRef = useRef(0);
  const reduceMotion =
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useLayoutEffect(() => {
    if (reduceMotion || enterKey < 1) {
      void controls.set({ opacity: 1, y: 0 });
      return;
    }
    if (lastPlayedKeyRef.current === enterKey) {
      void controls.set({ opacity: 1, y: 0 });
      return;
    }
    lastPlayedKeyRef.current = enterKey;
    void controls.set({ opacity: 0, y: 20 });
    void controls.start({
      opacity: 1,
      y: 0,
      transition: HOME_ENTER_SPRING,
    });
  }, [enterKey, reduceMotion, controls]);

  return (
    <div
      className="canvas-page studio-page-shell h-full w-full overflow-hidden relative flex flex-col"
      data-ui-root
      data-cover-page
      data-studio-page
    >
      <div className="studio-page-bg pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="studio-page-scrim pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="studio-page-glow pointer-events-none fixed inset-0 z-0 cover-ambient" aria-hidden />

      <div className="studio-page-content canvas-page-content relative z-10 flex flex-col flex-1 min-h-0 w-full">
        <motion.div
          className="flex flex-1 flex-col min-h-0 w-full will-change-transform"
          initial={false}
          animate={controls}
        >
          <main className="flex flex-1 flex-col min-h-0 w-full">
            <InfiniteCanvas shellActive={shellActive} />
          </main>
        </motion.div>
      </div>
    </div>
  );
});
