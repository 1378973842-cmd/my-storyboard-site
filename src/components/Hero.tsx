import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '../lib/utils';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

/** 将视频放到 public/ 下，留空字符串则仅使用图片 */
export const COVER_HERO_VIDEO = '';
/** 可选 WebM，体积通常更小 */
export const COVER_HERO_VIDEO_WEBM = '';
/** 视频加载前的封面帧；也可作为 prefers-reduced-motion 时的静态背景 */
export const COVER_HERO_POSTER = '/cover-hero.jpg';
/** 视频不可用时的静态图回退 */
export const COVER_HERO_BG = '/cover-hero.jpg';

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  return reduced;
}

function HeroBackground() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const useVideo = Boolean(COVER_HERO_VIDEO) && !prefersReducedMotion && !videoFailed;
  const poster = COVER_HERO_POSTER || COVER_HERO_BG;
  const showImage = !useVideo && !imageFailed && Boolean(COVER_HERO_BG);

  return (
    <>
      <div className="cover-hero-bg absolute inset-0 z-0" aria-hidden />

      {useVideo && (
        <video
          className="cover-hero-media absolute inset-0 z-[1] h-full w-full object-cover object-[42%_38%]"
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          poster={poster || undefined}
          aria-hidden
          onError={() => setVideoFailed(true)}
        >
          {COVER_HERO_VIDEO_WEBM ? (
            <source src={COVER_HERO_VIDEO_WEBM} type="video/webm" />
          ) : null}
          <source src={COVER_HERO_VIDEO} type="video/mp4" />
        </video>
      )}

      {showImage && (
        <img
          src={prefersReducedMotion && poster ? poster : COVER_HERO_BG}
          alt=""
          className="cover-hero-media absolute inset-0 z-[1] h-full w-full object-cover object-[42%_38%]"
          onError={() => setImageFailed(true)}
        />
      )}

      <div className="cover-hero-overlay absolute inset-0 z-[2] pointer-events-none" aria-hidden />
      <div className="cover-hero-vignette absolute inset-0 z-[2] pointer-events-none" aria-hidden />
    </>
  );
}

interface HeroProps {
  onStart?: () => void;
}

export const Hero: React.FC<HeroProps> = ({ onStart }) => {
  return (
    <section className="cover-hero relative h-[100dvh] min-h-[640px] w-full flex items-center overflow-hidden">
      <HeroBackground />

      <div className="relative z-10 w-full max-w-[1280px] mx-auto px-6 md:px-10 lg:px-14 pt-24 md:pt-28">
        <div className="max-w-[640px] space-y-6 md:space-y-8">
          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.06 }}
            className="cover-hero-title text-[2.75rem] sm:text-[3.25rem] md:text-[3.75rem] lg:text-[4.25rem] tracking-[-0.03em] leading-[1.02]"
          >
            LHZ&apos;s Studio
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.12 }}
            className="cover-hero-tagline text-xl md:text-2xl font-medium tracking-[-0.02em]"
          >
            为分镜叙事而生。
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.18 }}
            className="cover-hero-body text-[15px] md:text-[17px] leading-[1.7] max-w-[520px]"
          >
            从剧本拆解到批量生图，从九宫格预览到节点画布编排——在同一间 Studio 里，把故事变成画面。
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.24 }}
            className="flex flex-wrap items-center gap-5 md:gap-8 pt-2"
          >
            <button
              type="button"
              onClick={onStart}
              disabled={!onStart}
              className={cn(
                'cover-hero-cta rounded-full px-8 md:px-10 py-3.5 md:py-4',
                'text-[15px] font-semibold tracking-[-0.01em]',
                'cursor-pointer disabled:opacity-50 disabled:pointer-events-none',
              )}
            >
              进入分镜工作台
            </button>
            <a href="#tools" className="cover-hero-link text-[15px] font-medium tracking-[-0.01em]">
              浏览全部工具
            </a>
          </motion.div>
        </div>
      </div>
    </section>
  );
};
