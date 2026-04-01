import React from 'react';
import { ThemeToggle } from './ThemeToggle';

type NavbarProps = {
  /** 与 Hero「进入工作台」一致：导航栏主 CTA */
  onLaunchStudio?: () => void;
};

export const Navbar: React.FC<NavbarProps> = ({ onLaunchStudio }) => {
  return (
    <nav
      className="fixed top-6 left-[5%] md:left-[6%] right-auto z-50 w-[min(90vw,1320px)] max-w-[1400px] rounded-full px-6 md:px-10 py-3 md:py-4
        bg-surface-container-lowest/60 backdrop-blur-[30px]
        outline outline-[0.5px] outline-outline-variant/20
        shadow-[0_40px_80px_-24px_rgba(0,0,0,0.55)]
        flex justify-between items-center gap-6 transition-colors duration-500"
    >
      <div className="text-lg md:text-xl font-headline italic tracking-widest text-on-surface shrink-0 flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary to-amber-200 opacity-80" />
        ALCHEMIST<span className="text-primary ml-1">AI</span>
      </div>

      <div className="hidden lg:flex items-center gap-10">
        <a href="#storyboard" className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface/50 hover:text-on-surface transition-colors duration-300">
          Storyboard
        </a>
        <a href="#craft" className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface/50 hover:text-on-surface transition-colors duration-300">
          Craft
        </a>
        <a href="#assets" className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface/50 hover:text-on-surface transition-colors duration-300">
          Features
        </a>
        <a href="#footer" className="font-label text-[10px] tracking-[0.2em] uppercase text-on-surface/50 hover:text-on-surface transition-colors duration-300">
          Export
        </a>
      </div>

      <div className="flex items-center gap-3 md:gap-5 shrink-0">
        <ThemeToggle />
        <button
          type="button"
          onClick={onLaunchStudio}
          disabled={!onLaunchStudio}
          className="rounded-full px-5 md:px-7 py-2 md:py-2.5 text-[10px] md:text-xs font-label font-semibold tracking-[0.2em] uppercase whitespace-nowrap
            bg-gradient-to-br from-primary to-[#b77100] text-black shadow-[0_0_24px_rgba(255,184,102,0.22)]
            hover:shadow-[0_0_36px_rgba(255,184,102,0.35)] active:scale-95 transition-all duration-300
            disabled:opacity-50 disabled:pointer-events-none"
        >
          Get Started
        </button>
      </div>
    </nav>
  );
};
