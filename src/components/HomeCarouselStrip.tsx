import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fetchHomeCarousel, type HomeCarouselItem } from '../lib/homeCarouselApi';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };
const VISIBLE = 3;
const GAP_PX = 14;
const STEP_MS = 4000;
const SLIDE_MS = 560;

export function HomeCarouselStrip() {
  const [items, setItems] = useState<HomeCarouselItem[]>([]);
  const [index, setIndex] = useState(0);
  const [animate, setAnimate] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [cardW, setCardW] = useState(0);
  const timerRef = useRef<number | null>(null);
  const indexRef = useRef(0);

  useEffect(() => {
    indexRef.current = index;
  }, [index]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void fetchHomeCarousel()
        .then((list) => {
          if (!cancelled) {
            setItems(list);
            setIndex(0);
            setAnimate(true);
          }
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
    };
    load();
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, []);

  const trackItems = useMemo(() => {
    if (!items.length) return [];
    const clones = Array.from({ length: VISIBLE }, (_, i) => items[i % items.length]);
    return [...items, ...clones];
  }, [items]);

  const measure = useCallback(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    // 用精确内容宽，避免亚像素导致「三张装不满」
    const w = vp.getBoundingClientRect().width;
    if (w <= 0) return;
    const next = Math.floor(((w - GAP_PX * (VISIBLE - 1)) / VISIBLE) * 100) / 100;
    setCardW(next);
  }, []);

  useLayoutEffect(() => {
    measure();
  }, [measure, trackItems.length]);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(vp);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure]);

  const stepPx = cardW > 0 ? cardW + GAP_PX : 0;

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const armTimer = useCallback(() => {
    clearTimer();
    if (reducedMotion || items.length <= 1 || stepPx <= 0) return;
    timerRef.current = window.setInterval(() => {
      setAnimate(true);
      setIndex((i) => i + 1);
    }, STEP_MS);
  }, [items.length, reducedMotion, stepPx]);

  useEffect(() => {
    armTimer();
    return clearTimer;
  }, [armTimer]);

  const go = (delta: number) => {
    if (!items.length || stepPx <= 0) return;
    setAnimate(true);
    setIndex((i) => {
      if (delta < 0 && i <= 0) return 0;
      return i + delta;
    });
    armTimer();
  };

  const onTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName !== 'transform') return;
    if (indexRef.current < items.length) return;
    setAnimate(false);
    setIndex(0);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setAnimate(true));
    });
  };

  if (!items.length) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="cover-home-carousel mt-auto w-full pb-8 pt-4 md:pb-10"
      aria-label="精选推荐"
    >
      <div className="cover-home-carousel-shell">
        <div className="mb-3 flex items-end justify-between md:mb-4">
          <h2 className="font-headline text-[1.05rem] tracking-[-0.02em] text-[#e5e2e1]/9 md:text-[1.2rem]">
            精选推荐
          </h2>
        </div>

        <div className="cover-home-carousel-frame">
          <button
            type="button"
            className="cover-home-carousel-nav is-prev"
            aria-label="上一张"
            onClick={() => go(-1)}
            disabled={index <= 0}
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.75} />
          </button>
          <button
            type="button"
            className="cover-home-carousel-nav is-next"
            aria-label="下一张"
            onClick={() => go(1)}
          >
            <ChevronRight className="h-5 w-5" strokeWidth={1.75} />
          </button>

          <div ref={viewportRef} className="cover-home-carousel-viewport">
            {cardW > 0 ? (
              <div
                className="cover-home-carousel-track"
                style={{
                  gap: GAP_PX,
                  transform: `translate3d(${-index * stepPx}px, 0, 0)`,
                  transitionProperty: 'transform',
                  transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)',
                  transitionDuration: animate && !reducedMotion ? `${SLIDE_MS}ms` : '0ms',
                }}
                onTransitionEnd={onTransitionEnd}
              >
                {trackItems.map((item, i) => (
                  <div
                    key={`${item.id}-${i}`}
                    className="cover-home-carousel-card"
                    style={{ width: cardW, flex: `0 0 ${cardW}px` }}
                  >
                    <img
                      src={item.image_url}
                      alt=""
                      className="h-full w-full object-cover"
                      draggable={false}
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </motion.section>
  );
}
