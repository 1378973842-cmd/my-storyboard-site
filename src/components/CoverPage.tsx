import React from 'react';
import { Hero } from './Hero';
import { HomeTools } from './HomeTools';
import { Footer } from './Footer';

interface CoverPageProps {
  onStart: () => void;
  onOpenImageEditor: () => void;
  onOpenNineGrid: () => void;
  onOpenDirectorWorkbench?: () => void;
  onOpenInfiniteCanvas?: () => void;
}

export const CoverPage: React.FC<CoverPageProps> = ({
  onStart,
  onOpenImageEditor,
  onOpenNineGrid,
  onOpenDirectorWorkbench,
  onOpenInfiniteCanvas,
}) => {
  return (
    <div className="min-h-screen text-on-surface" data-ui-root data-cover-page>
      <main>
        <Hero />
        <HomeTools
          onStart={onStart}
          onOpenImageEditor={onOpenImageEditor}
          onOpenNineGrid={onOpenNineGrid}
          onOpenDirectorWorkbench={onOpenDirectorWorkbench}
          onOpenInfiniteCanvas={onOpenInfiniteCanvas}
        />
      </main>
      <Footer />
    </div>
  );
};
