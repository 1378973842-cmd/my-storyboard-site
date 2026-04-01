import React from 'react';

export const Footer = () => {
  return (
    <footer
      id="footer"
      className="bg-surface-container-lowest py-16 md:py-24 px-6 md:px-12 md:pl-14 md:pr-20 scroll-mt-24"
    >
      <div className="max-w-[1400px] mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-start">
        <div className="lg:col-span-4 flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-amber-200 opacity-80" />
          <span className="font-headline text-lg tracking-widest text-on-surface">ALCHEMIST</span>
        </div>

        <nav
          className="lg:col-span-5 lg:col-start-6 flex flex-wrap gap-x-10 gap-y-4 font-label text-[10px] tracking-[0.2em] uppercase text-on-surface/40 justify-start lg:justify-center"
          aria-label="Footer"
        >
          <a href="#" className="hover:text-primary transition-colors duration-300">
            Privacy
          </a>
          <a href="#" className="hover:text-primary transition-colors duration-300">
            Terms
          </a>
          <a href="#" className="hover:text-primary transition-colors duration-300">
            Studio Access
          </a>
          <a href="#" className="hover:text-primary transition-colors duration-300">
            Documentation
          </a>
        </nav>

        <div className="lg:col-span-3 lg:col-start-10 font-label text-[10px] tracking-[0.2em] text-on-surface/25 uppercase lg:text-right leading-relaxed">
          © {new Date().getFullYear()} Alchemist AI. Engineered for Storytellers.
        </div>
      </div>
    </footer>
  );
};
