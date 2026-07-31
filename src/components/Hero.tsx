import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { CoverHomeWorkspace } from './CoverHomeWorkspace';

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

/** 封面单屏：背景 + TapNow 式工作台（输入 / 新建 / 最近 / 轮播） */
export const Hero: React.FC = () => {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <section className="cover-hero relative min-h-[100dvh] w-full overflow-hidden">
      <HeroBackground reducedMotion={prefersReducedMotion} />
      <CoverHomeWorkspace />
    </section>
  );
};
