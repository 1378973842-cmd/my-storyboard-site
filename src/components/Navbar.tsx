import React from 'react';

export const Navbar = () => {
  return (
    <nav className="fixed top-6 left-1/2 -translate-x-1/2 w-[92%] max-w-[1400px] rounded-full px-6 md:px-8 py-3 md:py-4 bg-[#0a0a0a]/60 backdrop-blur-xl border border-white/10 shadow-[0_8px_32px_rgba(0,0,0,0.4)] flex justify-between items-center z-50 transition-all duration-500">
      <div className="text-lg md:text-xl font-headline italic tracking-widest text-white shrink-0 flex items-center gap-2">
        <div className="w-5 h-5 rounded-full bg-gradient-to-br from-primary to-amber-200 opacity-80"></div>
        ALCHEMIST<span className="text-primary ml-1">AI</span>
      </div>
      
      <div className="hidden lg:flex items-center gap-10">
        <a href="#storyboard" className="font-mono tracking-[0.2em] text-[10px] uppercase text-white/50 hover:text-white transition-colors duration-300">Storyboard</a>
        <a href="#timeline" className="font-mono tracking-[0.2em] text-[10px] uppercase text-white/50 hover:text-white transition-colors duration-300">Timeline</a>
        <a href="#assets" className="font-mono tracking-[0.2em] text-[10px] uppercase text-white/50 hover:text-white transition-colors duration-300">Assets</a>
        <a href="#export" className="font-mono tracking-[0.2em] text-[10px] uppercase text-white/50 hover:text-white transition-colors duration-300">Export</a>
      </div>
      
      <div className="flex items-center gap-4 md:gap-6">
        <button className="hidden sm:block font-mono tracking-[0.2em] text-[10px] uppercase text-white/50 hover:text-white transition-colors duration-300">Sign In</button>
        <button className="bg-white text-black hover:bg-primary hover:text-black transition-all duration-300 px-5 md:px-7 py-2 md:py-2.5 rounded-full text-[10px] md:text-xs font-bold tracking-[0.2em] uppercase active:scale-95 whitespace-nowrap">
          Get Started
        </button>
      </div>
    </nav>
  );
};

