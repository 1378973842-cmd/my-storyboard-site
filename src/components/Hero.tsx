import React, { useEffect, useRef, useState } from 'react';
import { motion, useMotionValue } from 'framer-motion';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };
const LENS_EASE = [0.22, 1, 0.36, 1] as const;

/** 将视频放到 public/ 下，留空字符串则仅使用图片 */
export const COVER_HERO_VIDEO = '';
/** 可选 WebM，体积通常更小 */
export const COVER_HERO_VIDEO_WEBM = '';
/** 视频加载前的封面帧；也可作为 prefers-reduced-motion 时的静态背景 */
export const COVER_HERO_POSTER = '/cover-hero-option-1.jpg';
/** 视频不可用时的静态图回退 */
export const COVER_HERO_BG = '/cover-hero-option-1.jpg';

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

function HeroBackground({ reducedMotion }: { reducedMotion: boolean }) {
  const [videoFailed, setVideoFailed] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);

  const useVideo = Boolean(COVER_HERO_VIDEO) && !reducedMotion && !videoFailed;
  const poster = COVER_HERO_POSTER || COVER_HERO_BG;
  const showImage = !useVideo && !imageFailed && Boolean(COVER_HERO_BG);

  return (
    <>
      <div className="cover-hero-bg absolute inset-0 z-0" aria-hidden />

      {/* 对焦进场：媒体层由虚到实、由微推到就位，模拟镜头拉焦 */}
      <motion.div
        className="absolute inset-0 z-[1] overflow-hidden"
        initial={reducedMotion ? false : { scale: 1.06, filter: 'blur(14px)', opacity: 0.4 }}
        animate={{ scale: 1, filter: 'blur(0px)', opacity: 1 }}
        transition={{ duration: 1.4, ease: LENS_EASE }}
      >
        {useVideo && (
          <video
            className="cover-hero-media absolute inset-0 h-full w-full object-cover object-[42%_38%]"
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
            src={reducedMotion && poster ? poster : COVER_HERO_BG}
            alt=""
            className="cover-hero-media absolute inset-0 h-full w-full object-cover object-[42%_38%]"
            onError={() => setImageFailed(true)}
          />
        )}
      </motion.div>

      <div className="cover-hero-lightshaft absolute inset-0 z-[2] pointer-events-none" aria-hidden />
      <div className="cover-hero-overlay absolute inset-0 z-[2] pointer-events-none" aria-hidden />
      <div className="cover-hero-vignette absolute inset-0 z-[2] pointer-events-none" aria-hidden />
    </>
  );
}

const TITLE_WORDS = ["LHZ's", 'Studio'];

export const Hero: React.FC = () => {
  const prefersReducedMotion = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLElement | null>(null);
  const textOpacity = useMotionValue(1);
  const textY = useMotionValue(0);

  /* 滚动退场：封面在 CoverPageTransition 的内部滚动容器里滚动（非 window），
     向下滚时文字块淡出上移，像镜头摇离前景字幕。 */
  useEffect(() => {
    if (prefersReducedMotion) return;
    const section = sectionRef.current;
    if (!section) return;
    let scroller: HTMLElement | null = section.parentElement;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    if (!scroller) return;
    const target = scroller;
    let raf = 0;
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const t = Math.min(1, target.scrollTop / (section.clientHeight * 0.6));
        textOpacity.set(1 - t * 0.95);
        textY.set(t * -44);
      });
    };
    target.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      target.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(raf);
    };
  }, [prefersReducedMotion, textOpacity, textY]);

  return (
    <section
      ref={sectionRef}
      className="cover-hero relative h-[100dvh] min-h-[640px] w-full flex items-center overflow-hidden"
    >
      <HeroBackground reducedMotion={prefersReducedMotion} />

      <div className="relative z-10 w-full max-w-[1280px] mx-auto px-6 md:px-10 lg:px-14 pt-24 md:pt-28">
        <motion.div
          className="max-w-[680px] space-y-5 md:space-y-7"
          style={prefersReducedMotion ? undefined : { opacity: textOpacity, y: textY }}
        >
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8, ease: LENS_EASE, delay: 0.5 }}
            className="cover-hero-meta"
          >
            Shot 01&ensp;·&ensp;Studio Gate&ensp;·&ensp;24 FPS
          </motion.p>

          <h1 className="cover-hero-title text-[3rem] sm:text-[3.6rem] md:text-[4.3rem] lg:text-[5rem] leading-[1.02]">
            {TITLE_WORDS.map((word, i) => (
              <motion.span
                key={word}
                className="inline-block whitespace-pre"
                initial={{ opacity: 0, y: 34 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...spring, delay: 0.1 + i * 0.09 }}
              >
                {word}
                {i < TITLE_WORDS.length - 1 ? ' ' : ''}
              </motion.span>
            ))}
          </h1>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.24 }}
            className="cover-hero-tagline text-xl md:text-2xl font-medium tracking-[-0.02em]"
          >
            为分镜叙事而生。
          </motion.p>

          <motion.p
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.3 }}
            className="cover-hero-body text-[15px] md:text-[17px] leading-[1.7] max-w-[520px]"
          >
            从剧本拆解到批量生图，从九宫格预览到节点画布编排——在同一间 Studio 里，把故事变成画面。
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.38 }}
            className="pt-2"
          >
            <a href="#tools" className="cover-hero-cta-pill text-[14px] font-medium tracking-[-0.01em]">
              浏览全部工具
              <span aria-hidden className="cover-hero-cta-arrow">↓</span>
            </a>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
};
