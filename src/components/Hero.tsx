import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useStore } from '../store/useStore';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

interface HeroProps {
  onStart?: () => void;
  onOpenImageEditor?: () => void;
  onOpenNineGrid?: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onStart, onOpenImageEditor, onOpenNineGrid }) => {
  const uiTheme = useStore((s) => s.uiTheme);
  const isDark = uiTheme === 'dark';

  const bgSrc = isDark
    ? 'https://lh3.googleusercontent.com/aida-public/AB6AXuAUFk-K9rgy9CePzk0ifBf30XluZCV_8r-GPFkUSfIBYwBY_MFXC91T9zZ6XshM9UAazNCMMhy-2r29za_4JfxDYN3HmvPBL34VgBFMSFZrA61xbdmDABszWvQuBZdJzP_nq2gf__jmk4UPyMKn9uSrnPnxFZiRlFLzdZpoL-f9_Ez3MX7LEC4lJyb3qX9655x1Qw-K_gg35O8oEHxMUtRl6q6pzMD_RNqD9bst4uyn3O0kL69FnxlBgBuMoh9ULck3EIitO1MJGVtk'
    : 'https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=2400&auto=format&fit=crop&q=80';

  return (
    <section className="relative min-h-screen w-full flex items-center justify-center overflow-hidden pt-24 pb-16 md:pt-28 md:pb-20">
      <div className="absolute inset-0 z-0">
        <AnimatePresence mode="wait" initial={false}>
          <motion.img
            key={uiTheme}
            src={bgSrc}
            alt={isDark ? 'Night studio scene' : 'Daylight studio scene'}
            className="w-full h-full object-cover scale-105"
            referrerPolicy="no-referrer"
            initial={{
              opacity: 0,
              filter: isDark ? 'brightness(0.9) saturate(1.05)' : 'brightness(1.06) saturate(1.03)',
            }}
            animate={{
              opacity: 0.88,
              filter: isDark ? 'brightness(0.9) saturate(1.05)' : 'brightness(1.06) saturate(1.03)',
            }}
            exit={{
              opacity: 0,
              filter: isDark ? 'brightness(0.9) saturate(1.05)' : 'brightness(1.06) saturate(1.03)',
            }}
            transition={{ type: 'spring', stiffness: 220, damping: 34 }}
          />
        </AnimatePresence>

        <div
          className={
            isDark
              ? 'absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-[#131313]'
              : 'absolute inset-0 bg-gradient-to-b from-black/15 via-transparent to-[#fffdf9]'
          }
        />
        <div
          className={
            isDark
              ? 'absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,#131313_100%)] opacity-80'
              : 'absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_0%,rgba(255,253,249,0.92)_100%)] opacity-70'
          }
        />
      </div>

      {/* 精简起始页装饰性角标，避免与内容争夺注意力 */}

      <div className="relative z-10 w-full max-w-[1400px] px-6 md:px-12 grid grid-cols-12 gap-8 md:gap-10">
        <div className="col-span-12 md:col-span-10 lg:col-span-7">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.05 }}
            className="inline-flex items-center gap-3 mb-6 md:mb-8 px-4 py-2 rounded-full bg-black/35 backdrop-blur-md"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <span className="font-label text-[9px] md:text-[10px] uppercase tracking-[0.3em] text-white/90">
              The Future of Animation Orchestration
            </span>
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.12 }}
            className="font-headline text-5xl sm:text-6xl md:text-7xl lg:text-[7.5rem] leading-[1.05] md:leading-[0.95] tracking-[-0.02em] text-white mb-8 md:mb-12"
          >
            Transform <br />
            <span className="italic font-light text-white/85">Imagination</span> <br />
            <span className="ml-0 md:ml-16 lg:ml-24">
              into{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-amber-200 glow-text">
                Cinematic Magic
              </span>
            </span>
          </motion.h1>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.22 }}
            className="flex flex-col sm:flex-row items-start sm:items-center gap-8 md:gap-12 mt-8 md:mt-12"
          >
            <button
              type="button"
              onClick={onStart}
              className="group relative px-8 md:px-12 py-4 md:py-5 rounded-full overflow-hidden cursor-pointer shrink-0
                bg-gradient-to-br from-primary to-[#b77100] text-black shadow-[0_0_32px_rgba(255,184,102,0.28)]
                hover:shadow-[0_0_48px_rgba(255,184,102,0.4)] transition-shadow duration-500"
            >
              <span className="relative z-10 font-label text-[10px] md:text-xs tracking-[0.2em] uppercase font-semibold group-hover:opacity-90 transition-opacity">
                Launch Studio
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenImageEditor}
              disabled={!onOpenImageEditor}
              className="group relative px-8 md:px-12 py-4 md:py-5 rounded-full overflow-hidden cursor-pointer shrink-0
                bg-white/5 text-on-surface hover:bg-white/10 transition-colors duration-300
                outline outline-[0.5px] outline-outline-variant/20 disabled:opacity-50 disabled:pointer-events-none"
            >
              <span className="relative z-10 font-label text-[10px] md:text-xs tracking-[0.2em] uppercase font-semibold group-hover:opacity-90 transition-opacity">
                IMAGE_EDITOR
              </span>
            </button>
            <button
              type="button"
              onClick={onOpenNineGrid}
              disabled={!onOpenNineGrid}
              className="group relative px-8 md:px-12 py-4 md:py-5 rounded-full overflow-hidden cursor-pointer shrink-0
                bg-white/5 text-on-surface hover:bg-white/10 transition-colors duration-300
                outline outline-[0.5px] outline-outline-variant/20 disabled:opacity-50 disabled:pointer-events-none"
            >
              <span className="relative z-10 font-label text-[10px] md:text-xs tracking-[0.2em] uppercase font-semibold group-hover:opacity-90 transition-opacity">
                9_GRID
              </span>
            </button>
            <div className="max-w-sm flex gap-5 pl-0 sm:pl-2">
              <div className="w-1 shrink-0 rounded-full bg-white/35 min-h-[3rem]" aria-hidden />
              <p className="font-body text-[9px] leading-relaxed tracking-[0.12em] text-white/50 uppercase py-1">
                Engine leverages neural lighting paths to render compositions in real-time. No pre-rendering required.
              </p>
            </div>
          </motion.div>
        </div>
        <div className="hidden lg:block lg:col-span-5" aria-hidden />
      </div>
    </section>
  );
};
