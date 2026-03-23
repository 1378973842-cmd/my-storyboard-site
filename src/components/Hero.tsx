import React from 'react';
import { motion } from 'framer-motion';

interface HeroProps {
  onStart?: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onStart }) => {
  return (
    <section className="relative min-h-screen w-full flex items-center justify-center overflow-hidden pt-20 pb-12">
      {/* Background Asset */}
      <div className="absolute inset-0 z-0">
        <img 
          src="https://lh3.googleusercontent.com/aida-public/AB6AXuAUFk-K9rgy9CePzk0ifBf30XluZCV_8r-GPFkUSfIBYwBY_MFXC91T9zZ6XshM9UAazNCMMhy-2r29za_4JfxDYN3HmvPBL34VgBFMSFZrA61xbdmDABszWvQuBZdJzP_nq2gf__jmk4UPyMKn9uSrnPnxFZiRlFLzdZpoL-f9_Ez3MX7LEC4lJyb3qX9655x1Qw-K_gg35O8oEHxMUtRl6q6pzMD_RNqD9bst4uyn3O0kL69FnxlBgBuMoh9ULck3EIitO1MJGVtk" 
          alt="Cinematic Pixar style lighting scene" 
          className="w-full h-full object-cover scale-105 opacity-80"
          referrerPolicy="no-referrer"
        />
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-[#131313]"></div>
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#131313_100%)] opacity-80"></div>
      </div>

      {/* Micro Decorations / Technical Data */}
      <div className="hidden lg:block absolute top-32 left-12 font-mono text-[10px] tracking-[0.2em] text-white/30 uppercase">
        FPS: 24.000 // RED_LOG_C
      </div>
      <div className="hidden lg:block absolute top-32 right-12 font-mono text-[10px] tracking-[0.2em] text-white/30 uppercase">
        LENS: 35MM ANAMORPHIC
      </div>
      <div className="hidden lg:flex absolute bottom-12 left-12 font-mono text-[10px] tracking-[0.2em] text-white/30 uppercase flex-col gap-1">
        <span>X: 12.4491</span>
        <span>Y: 88.0023</span>
      </div>
      <div className="hidden lg:block absolute bottom-12 right-12 font-mono text-[10px] tracking-[0.2em] text-white/30 uppercase text-right">
        ALCHEMIST CORE V4.2<br/>STABLE_DIFFUSION_XL
      </div>

      {/* Hero Content */}
      <div className="relative z-10 w-full max-w-[1400px] px-6 md:px-12 grid grid-cols-12 gap-8">
        <div className="col-span-12 md:col-span-10 lg:col-span-9">
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1 }}
            className="inline-flex items-center gap-3 mb-6 md:mb-8 px-4 py-2 rounded-full border border-white/10 bg-white/5 backdrop-blur-md"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
            <span className="font-label text-[9px] md:text-[10px] uppercase tracking-[0.3em] text-white/80">
              The Future of Animation Orchestration
            </span>
          </motion.div>
          
          <motion.h1 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1.2, delay: 0.2 }}
            className="font-headline text-5xl sm:text-6xl md:text-7xl lg:text-[7.5rem] leading-[1.05] md:leading-[0.95] tracking-[-0.02em] text-white mb-8 md:mb-12"
          >
            Transform <br/>
            <span className="italic font-light text-white/80">Imagination</span> <br/>
            <span className="ml-0 md:ml-16 lg:ml-24">into <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-amber-200 glow-text">Cinematic Magic</span></span>
          </motion.h1>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1, delay: 0.5 }}
            className="flex flex-col sm:flex-row items-start sm:items-center gap-6 md:gap-10 mt-8 md:mt-12"
          >
            <button 
              onClick={onStart}
              className="group relative px-8 md:px-12 py-4 md:py-5 rounded-full bg-white/10 border border-white/20 backdrop-blur-md hover:bg-white/20 hover:border-white/40 transition-all duration-500 overflow-hidden cursor-pointer shrink-0"
            >
              <span className="relative z-10 font-label text-[10px] md:text-xs tracking-[0.2em] uppercase text-white group-hover:text-primary transition-colors">Launch Studio</span>
            </button>
            <div className="max-w-sm border-l border-white/10 pl-6 py-2">
              <p className="font-mono text-[9px] leading-relaxed tracking-[0.1em] text-white/40 uppercase">
                // ENGINE LEVERAGES NEURAL LIGHTING PATHS TO RENDER COMPOSITIONS IN REAL-TIME. NO PRE-RENDERING REQUIRED.
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

