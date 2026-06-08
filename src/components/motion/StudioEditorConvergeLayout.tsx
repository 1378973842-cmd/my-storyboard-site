import React from 'react';
import { cn } from '../../lib/utils';
import { StudioConvergePiece } from './StudioConverge';

const WORKSPACE_GRID =
  'ai-editor-workspace flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.38fr)_minmax(340px,440px)] xl:grid-cols-[minmax(0,1.42fr)_minmax(380px,480px)] 2xl:grid-cols-[minmax(0,1.48fr)_minmax(400px,520px)] gap-4 lg:gap-5 xl:gap-6';

type StudioEditorConvergeLayoutProps = {
  enterKey: number;
  header: React.ReactNode;
  left: React.ReactNode;
  right: React.ReactNode;
  leftClassName?: string;
  rightClassName?: string;
  workspaceClassName?: string;
  contentClassName?: string;
};

/** 与修图页一致：标题自上汇入，主画布自左、侧栏自右 */
export function StudioEditorConvergeLayout({
  enterKey,
  header,
  left,
  right,
  leftClassName,
  rightClassName,
  workspaceClassName,
  contentClassName,
}: StudioEditorConvergeLayoutProps) {
  return (
    <div
      className={cn(
        'studio-page-content ai-editor-layout relative z-10 flex flex-col flex-1 min-h-0 w-full mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pb-4 md:pb-5',
        contentClassName,
      )}
    >
      <StudioConvergePiece origin="top" enterKey={enterKey} delay={0.03}>
        {header}
      </StudioConvergePiece>

      <div className={cn(WORKSPACE_GRID, workspaceClassName)}>
        <StudioConvergePiece
          origin="left"
          enterKey={enterKey}
          delay={0.07}
          className={cn(
            'relative rounded-[1.15rem] overflow-hidden ai-editor-canvas min-h-[220px] lg:min-h-0 h-full',
            leftClassName,
          )}
        >
          {left}
        </StudioConvergePiece>

        <StudioConvergePiece
          origin="right"
          enterKey={enterKey}
          delay={0.11}
          className={cn('ai-editor-sidebar min-h-0 h-full lg:max-h-none', rightClassName)}
        >
          {right}
        </StudioConvergePiece>
      </div>
    </div>
  );
}
