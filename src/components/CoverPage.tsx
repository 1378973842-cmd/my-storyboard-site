import React from 'react';
import { Navbar } from './Navbar';
import { Hero } from './Hero';
import { Features } from './Features';
import { Footer } from './Footer';

interface CoverPageProps {
  onStart: () => void;
}

export const CoverPage: React.FC<CoverPageProps> = ({ onStart }) => {
  return (
    <div className="min-h-screen bg-surface">
      <Navbar />
      <main>
        <Hero onStart={onStart} />
        <Features />
      </main>
      <Footer />
    </div>
  );
};

