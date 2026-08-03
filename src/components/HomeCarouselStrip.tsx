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
  const [reducedMotion, setReducedMotion] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [cardW, setCardW] = useState(0);
  const timerRef = useRef<number | null>(null);
  const indexRef = useRef(0);
  /** 循环跳回原点期间禁止过渡，避免「向右滑回去」的反向动画 */
  const suppressTransitionRef = useRef(false);
  const wrappingRef = useRef(false);

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
    const load = (opts?: { resetIndex?: boolean }) => {
      void fetchHomeCarousel()
        .then((list) => {
          if (cancelled) return;
          setItems(list);
          // 重新拉取时禁止带动画跳回 0，否则会突然反向滑
          if (opts?.resetIndex) {
            suppressTransitionRef.current = true;
            setIndex(0);
            requestAnimationFrame(() => {
              suppressTransitionRef.current = false;
            });
          }
        })
        .catch(() => {
          if (!cancelled) setItems([]);
        });
    };
    load({ resetIndex: true });
    const onFocus = () => load({ resetIndex: false });
    window.addEventListener('focus', onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', onFocus);
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

  const applyTransform = useCallback(
    (nextIndex: number, withTransition: boolean) => {
      const el = trackRef.current;
      if (!el || stepPx <= 0) return;
      const enable =
        withTransition && !suppressTransitionRef.current && !reducedMotion && !wrappingRef.current;
      el.style.transitionProperty = 'transform';
      el.style.transitionTimingFunction = 'cubic-bezier(0.22, 1, 0.36, 1)';
      el.style.transitionDuration = enable ? `${SLIDE_MS}ms` : '0ms';
      el.style.transform = `translate3d(${-nextIndex * stepPx}px, 0, 0)`;
    },
    [reducedMotion, stepPx],
  );

  // index / step 变化时同步位移；循环复位走 0ms
  useLayoutEffect(() => {
    if (stepPx <= 0) return;
    const withTransition = !suppressTransitionRef.current && !wrappingRef.current;
    applyTransform(index, withTransition);
  }, [applyTransform, index, stepPx]);

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
      if (wrappingRef.current) return;
      setIndex((i) => i + 1);
    }, STEP_MS);
  }, [items.length, reducedMotion, stepPx]);

  useEffect(() => {
    armTimer();
    return clearTimer;
  }, [armTimer]);

  const snapLoopToStart = useCallback(() => {
    if (wrappingRef.current) return;
    wrappingRef.current = true;
    suppressTransitionRef.current = true;

    const el = trackRef.current;
    if (el) {
      el.style.transitionDuration = '0ms';
      el.style.transform = 'translate3d(0, 0, 0)';
      // 强制重绘，确保浏览器吃掉 0ms 跳变，不会带着旧 transition 反向滑
      void el.offsetHeight;
    }

    setIndex(0);
    indexRef.current = 0;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wrappingRef.current = false;
        suppressTransitionRef.current = false;
      });
    });
  }, []);

  const onTransitionEnd = (e: React.TransitionEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.propertyName !== 'transform') return;
    if (wrappingRef.current) return;
    // 滑进克隆区后，无动画跳回真实起点（视觉上仍是左滑循环）
    if (indexRef.current >= items.length) {
      snapLoopToStart();
    }
  };

  const go = (delta: number) => {
    if (!items.length || stepPx <= 0 || wrappingRef.current) return;
    if (delta < 0) {
      // 从 0 再往左：先无动画跳到克隆尾，再左滑一格，避免反向
      if (indexRef.current <= 0) {
        wrappingRef.current = true;
        suppressTransitionRef.current = true;
        const el = trackRef.current;
        const tail = items.length;
        if (el) {
          el.style.transitionDuration = '0ms';
          el.style.transform = `translate3d(${-tail * stepPx}px, 0, 0)`;
          void el.offsetHeight;
        }
        indexRef.current = tail;
        setIndex(tail);
        requestAnimationFrame(() => {
          wrappingRef.current = false;
          suppressTransitionRef.current = false;
          setIndex(tail - 1);
          indexRef.current = tail - 1;
        });
        armTimer();
        return;
      }
      setIndex((i) => i - 1);
      armTimer();
      return;
    }
    setIndex((i) => i + 1);
    armTimer();
  };

  if (!items.length) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={spring}
      className="cover-home-carousel mt-auto w-full pt-5 pb-0"
      aria-label="精选推荐"
    >
      <div className="cover-home-carousel-shell">
        <div className="mb-3 flex items-end justify-between md:mb-3.5">
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
                ref={trackRef}
                className="cover-home-carousel-track"
                style={{ gap: GAP_PX }}
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
