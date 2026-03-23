import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Box, Palette, Edit3 } from 'lucide-react';

const features = [
  {
    icon: Sparkles,
    title: "God Ray Synthesis",
    description: "Synthesize volumetric lighting that behaves according to physical optics, giving your storyboards a high-budget theatrical feel.",
    color: "text-primary"
  },
  {
    icon: Box,
    title: "Anamorphic Grids",
    description: "Compose with professional aspect ratios and lens distortion previews used by top-tier animation studios.",
    color: "text-amber-200"
  },
  {
    icon: Palette,
    title: "Emotional Palettes",
    description: "Upload a reference image or song to extract a color script that informs the entire scene's lighting mood.",
    color: "text-orange-300"
  },
  {
    icon: Edit3,
    title: "Live Redlining",
    description: "Collaborate in real-time. Draw directly over frames to provide spatial notes that the AI understands as constraints.",
    color: "text-white"
  }
];

export const Features = () => {
  return (
    <div id="features" className="bg-[#131313]">
      {/* Narrative Section: Asymmetric Grid */}
      <section className="relative py-24 md:py-40 px-6 md:px-12 max-w-[1400px] mx-auto overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-24 items-center">
          <div className="lg:col-span-5 space-y-8">
            <div className="w-12 h-[1px] bg-primary mb-8"></div>
            <motion.h2 
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              className="font-headline text-4xl md:text-5xl lg:text-6xl leading-[1.1] text-white"
            >
              Editorial Precision <br/><span className="italic text-white/60">meets</span> Generative Soul.
            </motion.h2>
            <motion.p 
              initial={{ opacity: 0, x: -20 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="font-sans text-white/50 leading-relaxed text-sm md:text-base font-light max-w-md"
            >
              Alchemist AI isn't just a generator. It's a professional drafting tool designed for directors who demand pixel-perfect emotional resonance. Control light, shadow, and silhouette with the precision of a master cinematographer.
            </motion.p>
          </div>
          
          <div className="lg:col-span-7 relative group">
            <div className="aspect-[16/9] w-full overflow-hidden rounded-2xl border border-white/10 shadow-[0_0_50px_rgba(0,0,0,0.5)] relative">
              <img 
                src="https://lh3.googleusercontent.com/aida-public/AB6AXuBAXjFfaemFNZIL8fzFxDU8asspXlOQi6qCNVSNU0uSJKOXlvRCgTLSnt_Qjl6iiV5GDdyojGjYw4EzH9DZdGkwYgWTS5s6581HmNcSOVDyqMgK2ekKmqNz0grAXYahM8TjFHMLYDiYCEmj-jc3RXV810w-MpgiZ-be6KVBzmO885BGC26V9nJ6l-Pqlcf55hl8hWg7YQmZHU6E00pCqg6EQ7ccibA23tNw_oobxQyDb6CKNrfR8PYrerSD8FvWW1fy8BhNprzivK_s" 
                alt="Abstract cinematic light patterns" 
                className="w-full h-full object-cover opacity-80 group-hover:scale-105 transition-transform duration-1000"
                referrerPolicy="no-referrer"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-[#131313] via-transparent to-transparent opacity-80"></div>
            </div>
            {/* Technical Metadata Overlays */}
            <div className="absolute -bottom-6 -left-6 md:-bottom-8 md:-left-8 bg-[#1a1a1a] border border-white/10 p-4 md:p-6 rounded-xl shadow-2xl backdrop-blur-xl">
              <span className="font-mono text-[9px] md:text-[10px] tracking-[0.2em] uppercase text-primary flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse"></span>
                STORYBOARD_LAYER_01 // ACTIVE
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Features: Tonal Shift without Borders */}
      <section className="bg-[#0a0a0a] py-24 md:py-40 px-6 md:px-12 border-t border-white/5">
        <div className="max-w-[1400px] mx-auto">
          <div className="mb-16 md:mb-24 flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
            <h3 className="font-headline text-4xl md:text-6xl italic font-light text-white">The Craft</h3>
            <span className="font-mono text-[10px] tracking-[0.3em] text-white/30 uppercase">ENGINE_SPEC_R4</span>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 md:gap-12">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.1 }}
                className="space-y-6 group p-6 md:p-8 rounded-2xl bg-white/[0.02] border border-white/5 hover:bg-white/[0.04] hover:border-white/10 transition-all duration-500"
              >
                <div className={`w-12 h-12 rounded-full bg-white/5 flex items-center justify-center border border-white/10 group-hover:scale-110 transition-transform duration-500 ${feature.color}`}>
                  <feature.icon className="w-5 h-5" />
                </div>
                <h4 className="font-headline text-xl text-white">{feature.title}</h4>
                <p className="font-sans text-sm text-white/50 leading-relaxed font-light">
                  {feature.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
};

