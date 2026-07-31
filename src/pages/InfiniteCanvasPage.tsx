import { memo } from 'react';
import { InfiniteCanvas } from '../components/InfiniteCanvas/InfiniteCanvas';
import { StudioConvergePiece } from '../components/motion/StudioConverge';

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
        <StudioConvergePiece
          origin="center"
          enterKey={enterKey}
          delay={0.05}
          fade={false}
          preserveChildren
          className="flex flex-1 flex-col min-h-0 w-full"
        >
          <main className="flex flex-1 flex-col min-h-0 w-full">
            <InfiniteCanvas shellActive={shellActive} />
          </main>
        </StudioConvergePiece>
      </div>
    </div>
  );
});
