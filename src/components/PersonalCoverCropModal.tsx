import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

/** 与个人空间壁纸 height: clamp(200px, 28vw, 300px) 中段一致：宽/高 ≈ 100/28 */
export const PERSONAL_COVER_ASPECT = 100 / 28;

type Rect = { x: number; y: number; w: number; h: number };

type Props = {
  open: boolean;
  file: File | null;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (cropped: File) => void;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function initialCrop(nw: number, nh: number, aspect: number): Rect {
  let w = nw;
  let h = w / aspect;
  if (h > nh) {
    h = nh;
    w = h * aspect;
  }
  // 略缩小一点，方便拖动选区
  w *= 0.92;
  h = w / aspect;
  return {
    x: (nw - w) / 2,
    y: (nh - h) / 2,
    w,
    h,
  };
}

async function cropFileToBlob(img: HTMLImageElement, crop: Rect, fileName: string): Promise<File> {
  const outW = Math.max(1, Math.round(crop.w));
  const outH = Math.max(1, Math.round(crop.h));
  // 导出上限：宽边约 2400，够视网膜横幅
  const maxW = 2400;
  const scale = outW > maxW ? maxW / outW : 1;
  const cw = Math.max(1, Math.round(outW * scale));
  const ch = Math.max(1, Math.round(outH * scale));

  const canvas = document.createElement('canvas');
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法裁切图片');
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, cw, ch);

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('裁切失败'))),
      'image/jpeg',
      0.92,
    );
  });
  const base = fileName.replace(/\.[^.]+$/, '') || 'cover';
  return new File([blob], `${base}-cover.jpg`, { type: 'image/jpeg' });
}

export function PersonalCoverCropModal({ open, file, busy = false, onClose, onConfirm }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const dragRef = useRef<{
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    origin: Rect;
  } | null>(null);

  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [crop, setCrop] = useState<Rect | null>(null);
  const [stageSize, setStageSize] = useState({ w: 0, h: 0 });
  const [error, setError] = useState('');
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open || !file) {
      setObjectUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
      setNatural(null);
      setCrop(null);
      setError('');
      setConfirming(false);
      return;
    }
    const url = URL.createObjectURL(file);
    setObjectUrl(url);
    setNatural(null);
    setCrop(null);
    setError('');
    return () => URL.revokeObjectURL(url);
  }, [open, file]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy && !confirming) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, busy, confirming]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el || !open) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setStageSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    setStageSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [open, objectUrl]);

  const display = useMemo(() => {
    if (!natural || stageSize.w <= 0 || stageSize.h <= 0) return null;
    const scale = Math.min(stageSize.w / natural.w, stageSize.h / natural.h);
    const dw = natural.w * scale;
    const dh = natural.h * scale;
    const left = (stageSize.w - dw) / 2;
    const top = (stageSize.h - dh) / 2;
    return { scale, dw, dh, left, top };
  }, [natural, stageSize]);

  const cropCss = useMemo(() => {
    if (!crop || !display) return null;
    return {
      left: display.left + crop.x * display.scale,
      top: display.top + crop.y * display.scale,
      width: crop.w * display.scale,
      height: crop.h * display.scale,
    };
  }, [crop, display]);

  const onImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const nw = img.naturalWidth;
    const nh = img.naturalHeight;
    if (!nw || !nh) {
      setError('无法读取图片尺寸');
      return;
    }
    setNatural({ w: nw, h: nh });
    setCrop(initialCrop(nw, nh, PERSONAL_COVER_ASPECT));
  };

  const clampCrop = useCallback(
    (next: Rect): Rect => {
      if (!natural) return next;
      let w = clamp(next.w, Math.min(natural.w, natural.h * PERSONAL_COVER_ASPECT) * 0.25, natural.w);
      let h = w / PERSONAL_COVER_ASPECT;
      if (h > natural.h) {
        h = natural.h;
        w = h * PERSONAL_COVER_ASPECT;
      }
      const x = clamp(next.x, 0, Math.max(0, natural.w - w));
      const y = clamp(next.y, 0, Math.max(0, natural.h - h));
      return { x, y, w, h };
    },
    [natural],
  );

  const onPointerDownMove = (e: React.PointerEvent) => {
    if (!crop || busy || confirming) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: 'move',
      startX: e.clientX,
      startY: e.clientY,
      origin: crop,
    };
  };

  const onPointerDownResize = (e: React.PointerEvent) => {
    if (!crop || busy || confirming) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: 'resize',
      startX: e.clientX,
      startY: e.clientY,
      origin: crop,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag || !display) return;
    const dx = (e.clientX - drag.startX) / display.scale;
    const dy = (e.clientY - drag.startY) / display.scale;
    if (drag.mode === 'move') {
      setCrop(clampCrop({ ...drag.origin, x: drag.origin.x + dx, y: drag.origin.y + dy }));
      return;
    }
    // 右下角等比缩放
    const nextW = drag.origin.w + dx;
    setCrop(clampCrop({ ...drag.origin, w: nextW, h: nextW / PERSONAL_COVER_ASPECT }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    dragRef.current = null;
  };

  const onDone = async () => {
    if (!crop || !objectUrl || confirming || busy) return;
    const img = imgRef.current;
    if (!img?.complete) {
      setError('图片尚未加载完成');
      return;
    }
    setConfirming(true);
    setError('');
    try {
      const cropped = await cropFileToBlob(img, crop, file?.name || 'cover.jpg');
      onConfirm(cropped);
    } catch (err) {
      setError(err instanceof Error ? err.message : '裁切失败');
      setConfirming(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && file ? (
        <div className="fixed inset-0 z-[230] flex items-center justify-center p-3 sm:p-5">
          <motion.button
            type="button"
            aria-label="关闭"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
            disabled={busy || confirming}
            onClick={() => {
              if (!busy && !confirming) onClose();
            }}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="cover-crop-title"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            transition={spring}
            className="relative z-10 flex max-h-[min(860px,92dvh)] w-full max-w-[720px] flex-col overflow-hidden rounded-[22px] bg-[#1a1919] shadow-[0_40px_80px_-40px_rgba(0,0,0,0.75)]"
            style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 pb-3 pt-4 md:px-6 md:pt-5">
              <h2
                id="cover-crop-title"
                className="text-[18px] font-semibold tracking-[-0.02em] text-[#e5e2e1]"
              >
                更换背景
              </h2>
              <button
                type="button"
                onClick={onClose}
                disabled={busy || confirming}
                className="flex h-9 w-9 items-center justify-center rounded-full text-[#e5e2e1]/55 hover:bg-white/5 hover:text-[#e5e2e1] disabled:opacity-40"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="min-h-0 flex-1 px-4 pb-3 md:px-5">
              <div
                ref={stageRef}
                className="relative h-[min(420px,52dvh)] w-full overflow-hidden rounded-2xl bg-[#0e0e0e]"
              >
                {objectUrl ? (
                  <img
                    ref={imgRef}
                    src={objectUrl}
                    alt=""
                    draggable={false}
                    onLoad={onImgLoad}
                    className="pointer-events-none absolute inset-0 h-full w-full object-contain select-none"
                  />
                ) : null}

                {/* 暗角遮罩：四块矩形避开选区 */}
                {cropCss ? (
                  <>
                    <div
                      className="pointer-events-none absolute inset-x-0 top-0 bg-black/55"
                      style={{ height: Math.max(0, cropCss.top) }}
                    />
                    <div
                      className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/55"
                      style={{
                        height: Math.max(0, stageSize.h - cropCss.top - cropCss.height),
                      }}
                    />
                    <div
                      className="pointer-events-none absolute bg-black/55"
                      style={{
                        top: cropCss.top,
                        left: 0,
                        width: Math.max(0, cropCss.left),
                        height: cropCss.height,
                      }}
                    />
                    <div
                      className="pointer-events-none absolute bg-black/55"
                      style={{
                        top: cropCss.top,
                        left: cropCss.left + cropCss.width,
                        right: 0,
                        height: cropCss.height,
                      }}
                    />

                    <div
                      className={cn(
                        'absolute cursor-move touch-none rounded-xl',
                        'outline outline-[1.5px] outline-white/90 outline-offset-[-1px]',
                      )}
                      style={{
                        left: cropCss.left,
                        top: cropCss.top,
                        width: cropCss.width,
                        height: cropCss.height,
                      }}
                      onPointerDown={onPointerDownMove}
                      onPointerMove={onPointerMove}
                      onPointerUp={onPointerUp}
                      onPointerCancel={onPointerUp}
                    >
                      <span
                        className="absolute bottom-1 right-1 h-4 w-4 cursor-nwse-resize rounded-sm bg-white/90"
                        style={{ boxShadow: '0 0 0 1px rgba(0,0,0,0.25)' }}
                        onPointerDown={onPointerDownResize}
                        aria-hidden
                      />
                    </div>
                  </>
                ) : null}
              </div>
              <p className="mt-2.5 text-[12px] text-[#e5e2e1]/4">
                拖动选区调整位置，右下角可缩放。比例与个人主页横幅一致。
              </p>
              {error ? (
                <p className="mt-1.5 text-[13px] text-red-400/95" role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="flex justify-end gap-2.5 px-5 pb-5 pt-1 md:px-6">
              <button
                type="button"
                disabled={busy || confirming}
                onClick={onClose}
                className="h-10 rounded-full bg-[#2a2a2a] px-5 text-[13.5px] font-medium text-[#e5e2e1]/85 hover:bg-[#333] disabled:opacity-45"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!crop || busy || confirming}
                onClick={() => void onDone()}
                className="h-10 rounded-full bg-[#e5e2e1] px-5 text-[13.5px] font-medium text-[#141414] disabled:opacity-45 hover:bg-white"
              >
                {busy || confirming ? '处理中…' : '完成'}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
