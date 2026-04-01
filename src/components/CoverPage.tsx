import React from 'react';
import { Navbar } from './Navbar';
import { Hero } from './Hero';
import { Features } from './Features';
import { Footer } from './Footer';

interface CoverPageProps {
  onStart: () => void;
  onOpenImageEditor: () => void;
  onOpenNineGrid: () => void;
}

export const CoverPage: React.FC<CoverPageProps> = ({ onStart, onOpenImageEditor, onOpenNineGrid }) => {
  return (
    <div className="min-h-screen bg-surface">
      {/* data-ui-root：日间 slate/white 工具类映射；Hero 大图区单独保持白字，故放在外 */}
      <div data-ui-root>
        <Navbar onLaunchStudio={onStart} />
      </div>
      <main>
        <Hero onStart={onStart} onOpenImageEditor={onOpenImageEditor} onOpenNineGrid={onOpenNineGrid} />
        <div data-ui-root>
          <Features />
        </div>
      </main>
      <div data-ui-root>
        <Footer />
      </div>
    </div>
  );
};

