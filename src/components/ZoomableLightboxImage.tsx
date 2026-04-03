import React, { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '../lib/utils';

const MIN_SCALE = 0.2;
const MAX_SCALE = 8;

type Props = {
  url: string;
  /** 与 url 不同时也可传，用于同一 url 下强制重置（少见） */
  resetKey?: string;
  className?: string;
  imgClassName?: string;
};

/**
 * 大图预览：滚轮缩放、鼠标中键拖拽平移（便于对准局部放大查看）。
 */
export function ZoomableLightboxImage({ url, resetKey, className, imgClassName }: Props) {
  const key = resetKey ?? url;
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const [isPanning, setIsPanning] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const posRef = useRef({ tx: 0, ty: 0 });
  const panDragRef = useRef<{
    startX: number;
    startY: number;
    origTx: number;
    origTy: number;
  } | null>(null);

  useEffect(() => {
    posRef.current = { tx, ty };
  }, [tx, ty]);

  useEffect(() => {
    setScale(1);
    setTx(0);
    setTy(0);
    posRef.current = { tx: 0, ty: 0 };
    panDragRef.current = null;
    setIsPanning(false);
  }, [key]);

  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s * factor)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [key]);

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    const { tx: curTx, ty: curTy } = posRef.current;
    panDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origTx: curTx,
      origTy: curTy,
    };
    setIsPanning(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = panDragRef.current;
    if (!drag) return;
    setTx(drag.origTx + (e.clientX - drag.startX));
    setTy(drag.origTy + (e.clientY - drag.startY));
  }, []);

  const endPan = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!panDragRef.current) return;
    if (e.type === 'pointerup' && e.button !== 1) return;
    panDragRef.current = null;
    setIsPanning(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* released */
    }
  }, []);

  const onLostPointerCapture = useCallback(() => {
    panDragRef.current = null;
    setIsPanning(false);
  }, []);

  useEffect(() => {
    const onBlur = () => {
      panDragRef.current = null;
      setIsPanning(false);
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [key]);

  return (
    <div
      ref={viewportRef}
      className={cn(
        'flex min-h-0 min-w-0 items-center justify-center overflow-hidden touch-none select-none',
        isPanning ? 'cursor-grabbing' : 'cursor-default',
        className,
      )}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onLostPointerCapture={onLostPointerCapture}
      onAuxClick={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
    >
      <img
        src={url}
        alt=""
        referrerPolicy="no-referrer"
        draggable={false}
        className={cn('max-h-full max-w-full h-auto w-auto object-contain pointer-events-none', imgClassName)}
        style={{
          transform: `translate(${tx}px, ${ty}px) scale(${scale})`,
          transformOrigin: 'center center',
        }}
      />
    </div>
  );
}
