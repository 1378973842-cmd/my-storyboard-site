import React from 'react';

export const Footer = () => {
  return (
    <footer className="bg-[#050505] py-12 md:py-20 px-6 md:px-12 border-t border-white/5">
      <div className="max-w-[1400px] mx-auto flex flex-col md:flex-row justify-between items-center gap-8">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 rounded-full bg-gradient-to-br from-primary to-amber-200 opacity-80"></div>
          <span className="font-headline text-lg tracking-widest text-white">ALCHEMIST</span>
        </div>
        
        <div className="flex flex-wrap justify-center gap-8 font-mono text-[10px] tracking-[0.2em] uppercase text-white/40">
          <a href="#" className="hover:text-primary transition-colors duration-300">Privacy</a>
          <a href="#" className="hover:text-primary transition-colors duration-300">Terms</a>
          <a href="#" className="hover:text-primary transition-colors duration-300">Studio Access</a>
          <a href="#" className="hover:text-primary transition-colors duration-300">Documentation</a>
        </div>
        
        <div className="font-mono text-[10px] tracking-[0.2em] text-white/20 uppercase">
          © {new Date().getFullYear()} Alchemist AI. Engineered for Storytellers.
        </div>
      </div>
    </footer>
  );
};

