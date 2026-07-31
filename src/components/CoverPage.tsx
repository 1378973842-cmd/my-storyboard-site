import React from 'react';
import { Hero } from './Hero';

interface CoverPageProps {
  onStart: () => void;
  onOpenImageEditor: () => void;
  onOpenNineGrid: () => void;
  onOpenDirectorWorkbench?: () => void;
  onOpenInfiniteCanvas?: () => void;
}

/** 封面主页；工具卡片入口已收起，旧 HomeTools 保留供后续复用 */
export const CoverPage: React.FC<CoverPageProps> = () => {
  return (
    <div className="min-h-screen text-on-surface" data-ui-root data-cover-page>
      <main>
        <Hero />
      </main>
    </div>
  );
};
