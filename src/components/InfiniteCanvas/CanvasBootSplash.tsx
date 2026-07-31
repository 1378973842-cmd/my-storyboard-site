import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { BRAND_LOGO_SRC, BRAND_NAME } from '../StudioBrand';

export const BRAND_BOOT_SPLASH_SRC = '/brand-boot-splash.mp4';

/** 原片约 4.1s → 压到刷新感；过高倍速部分浏览器会抽帧像卡住 */
const TARGET_MS = 1100;
const MAX_RATE = 3.4;
const fadeOut = { duration: 0.42, ease: [0.22, 1, 0.36, 1] as const };

/**
 * 画布开屏：portal 到 body；视频图标尺寸居中。
 * 播完即揭开（不再等画布图片就绪）。
 */
export function CanvasBootSplash({
  visible,
  onCanDismiss,
}: {
  visible: boolean;
  onCanDismiss: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [useFallback, setUseFallback] = useState(false);
  const dismissedRef = useRef(false);

  const dismiss = () => {
    if (dismissedRef.current) return;
    dismissedRef.current = true;
    onCanDismiss();
  };

  const applyRate = (el: HTMLVideoElement) => {
    const dur = Number(el.duration);
    el.playbackRate =
      Number.isFinite(dur) && dur > 0
        ? Math.min(MAX_RATE, Math.max(1.8, dur / (TARGET_MS / 1000)))
        : 2.4;
  };

  const kickPlay = (el: HTMLVideoElement) => {
    el.muted = true;
    el.defaultMuted = true;
    el.playsInline = true;
    applyRate(el);
    const run = () => {
      const p = el.play();
      if (p && typeof p.catch === 'function') {
        p.catch(() => {
          window.setTimeout(() => {
            const retry = el.play();
            if (retry && typeof retry.catch === 'function') {
              retry.catch(() => setUseFallback(true));
            }
          }, 40);
        });
      }
    };
    if (el.readyState >= 2) run();
    else {
      const onCanPlay = () => {
        el.removeEventListener('canplay', onCanPlay);
        run();
      };
      el.addEventListener('canplay', onCanPlay);
      el.load();
    }
  };

  useEffect(() => {
    if (!visible) {
      setUseFallback(false);
      dismissedRef.current = false;
      return;
    }
    dismissedRef.current = false;
    setUseFallback(false);

    const el = videoRef.current;
    if (!el) return;

    const onMeta = () => applyRate(el);
    el.addEventListener('loadedmetadata', onMeta);
    try {
      el.pause();
      el.currentTime = 0;
    } catch {
      /* ignore */
    }
    kickPlay(el);

    return () => {
      el.removeEventListener('loadedmetadata', onMeta);
    };
  }, [visible]);

  // 静态回退：短展示后揭开
  useEffect(() => {
    if (!visible || !useFallback) return;
    const t = window.setTimeout(dismiss, 600);
    return () => window.clearTimeout(t);
  }, [visible, useFallback, onCanDismiss]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence mode="sync">
      {visible ? (
        <motion.div
          key="canvas-boot-splash"
          className="canvas-boot-splash"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fadeOut}
          role="status"
          aria-live="polite"
          aria-label={`${BRAND_NAME} 加载中`}
        >
          {useFallback ? (
            <motion.img
              src={BRAND_LOGO_SRC}
              alt=""
              width={96}
              height={96}
              draggable={false}
              className="canvas-boot-splash-logo"
              initial={{ opacity: 0.7, scale: 0.94 }}
              animate={{ opacity: [0.7, 1, 0.7], scale: [0.94, 1, 0.94] }}
              transition={{
                duration: 1.1,
                ease: [0.45, 0, 0.55, 1],
                repeat: Infinity,
              }}
            />
          ) : (
            <video
              ref={videoRef}
              className="canvas-boot-splash-video"
              src={BRAND_BOOT_SPLASH_SRC}
              muted
              playsInline
              autoPlay
              preload="auto"
              disablePictureInPicture
              onEnded={() => {
                videoRef.current?.pause();
                dismiss();
              }}
              onError={() => setUseFallback(true)}
            />
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
