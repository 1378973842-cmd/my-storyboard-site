import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Box, Palette, Edit3 } from 'lucide-react';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

const features = [
  {
    icon: Sparkles,
    title: 'God Ray Synthesis',
    description:
      'Synthesize volumetric lighting that behaves according to physical optics, giving your storyboards a high-budget theatrical feel.',
    color: 'text-primary',
  },
  {
    icon: Box,
    title: 'Anamorphic Grids',
    description:
      'Compose with professional aspect ratios and lens distortion previews used by top-tier animation studios.',
    color: 'text-amber-200',
  },
  {
    icon: Palette,
    title: 'Emotional Palettes',
    description:
      'Upload a reference image or song to extract a color script that informs the entire scene lighting mood.',
    color: 'text-orange-300',
  },
  {
    icon: Edit3,
    title: 'Live Redlining',
    description:
      'Collaborate in real-time. Draw directly over frames to provide spatial notes that the AI understands as constraints.',
    color: 'text-on-surface',
  },
];

export const Features = () => {
  return (
    <div id="features" className="bg-surface scroll-mt-24">
      <section
        id="storyboard"
        className="relative py-24 md:py-40 px-6 md:px-12 max-w-[1400px] mx-auto overflow-x-clip pb-20 md:pb-28"
      >
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-x-16 lg:gap-y-16 items-center">
          <div className="lg:col-span-5 space-y-8">
            <div className="w-20 h-1 rounded-full bg-primary/35 mb-8" aria-hidden />
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={spring}
              className="font-headline text-4xl md:text-5xl lg:text-6xl leading-[1.1] text-on-surface tracking-[-0.02em]"
            >
              Editorial Precision <br />
              <span className="italic text-on-surface/60">meets</span> Generative Soul.
            </motion.h2>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ ...spring, delay: 0.08 }}
              className="font-body text-on-surface/50 leading-relaxed text-sm md:text-base font-light max-w-md"
            >
              Alchemist AI isn&apos;t just a generator. It&apos;s a professional drafting tool designed for directors who
              demand pixel-perfect emotional resonance. Control light, shadow, and silhouette with the precision of a
              master cinematographer.
            </motion.p>
          </div>

          <div className="hidden lg:block lg:col-span-2" aria-hidden />

          <div className="lg:col-span-5 relative group">
            <div className="rounded-2xl bg-surface-container-low p-1 shadow-[0_48px_100px_-40px_rgba(0,0,0,0.65)]">
              <div className="aspect-[16/9] w-full overflow-hidden rounded-[0.9rem] bg-surface-container-highest relative">
                <img
                  src="https://lh3.googleusercontent.com/aida-public/AB6AXuBAXjFfaemFNZIL8fzFxDU8asspXlOQi6qCNVSNU0uSJKOXlvRCgTLSnt_Qjl6iiV5GDdyojGjYw4EzH9DZdGkwYgWTS5s6581HmNcSOVDyqMgK2ekKmqNz0grAXYahM8TjFHMLYDiYCEmj-jc3RXV810w-MpgiZ-be6KVBzmO885BGC26V9nJ6l-Pqlcf55hl8hWg7YQmZHU6E00pCqg6EQ7ccibA23tNw_oobxQyDb6CKNrfR8PYrerSD8FvWW1fy8BhNprzivK_s"
                  alt="Abstract cinematic light patterns"
                  className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-1000"
                  referrerPolicy="no-referrer"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent opacity-80" />
              </div>
            </div>
            <div className="absolute -bottom-6 -left-6 md:-bottom-8 md:-left-8 rounded-xl bg-surface-container-low/90 backdrop-blur-xl p-4 md:p-6 shadow-[0_40px_80px_-36px_rgba(0,0,0,0.6)] outline outline-[0.5px] outline-outline-variant/20">
              <span className="font-label text-[9px] md:text-[10px] tracking-[0.2em] uppercase text-primary flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                STORYBOARD_LAYER_01 // ACTIVE
              </span>
            </div>
          </div>
        </div>
      </section>

      <section id="craft" className="bg-surface-container-lowest py-28 md:py-44 px-6 md:px-12 scroll-mt-24">
        <div id="assets" className="max-w-[1400px] mx-auto scroll-mt-24">
          <div className="mb-16 md:mb-24 flex flex-col md:flex-row md:items-end justify-between gap-8 md:gap-16">
            <h3 className="font-headline text-4xl md:text-6xl italic font-light text-on-surface tracking-[-0.02em] md:max-w-[55%]">
              The Craft
            </h3>
            <span className="font-label text-[10px] tracking-[0.3em] text-on-surface/30 uppercase md:pb-1 md:text-right md:min-w-[12rem]">
              ENGINE_SPEC_R4
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-10 md:gap-x-8 md:gap-y-16">
            {features.map((feature, index) => {
              const layouts = [
                'md:col-span-5 md:col-start-1',
                'md:col-span-6 md:col-start-7',
                'md:col-span-6 md:col-start-1 md:row-start-2',
                'md:col-span-5 md:col-start-8 md:row-start-2',
              ];
              return (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ ...spring, delay: index * 0.06 }}
                  className={`space-y-6 group p-6 md:p-8 rounded-2xl bg-surface-container-low hover:bg-surface-container-high transition-colors duration-500 ${layouts[index]}`}
                >
                  <div
                    className={`w-12 h-12 rounded-full bg-surface-container-highest flex items-center justify-center group-hover:scale-110 transition-transform duration-500 ${feature.color}`}
                  >
                    <feature.icon className="w-5 h-5" />
                  </div>
                  <h4 className="font-headline text-xl text-on-surface">{feature.title}</h4>
                  <p className="font-body text-sm text-on-surface/50 leading-relaxed font-light">{feature.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
};
