import type { PointerEvent as ReactPointerEvent } from 'react';
import { useCallback, useRef, useState } from 'react';

/**
 * 缩略图「点按放大」：与 Reorder 拖拽共存——位移超过阈值视为拖拽，不打开预览。
 * 需在删除按钮等控件上加 data-ref-preview-ignore。
 */
export function useRefThumbPreview() {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const startRef = useRef({ x: 0, y: 0 });

  const handlersFor = useCallback((url: string) => {
    return {
      onPointerDownCapture: (e: ReactPointerEvent) => {
        if ((e.target as HTMLElement).closest('[data-ref-preview-ignore]')) return;
        startRef.current = { x: e.clientX, y: e.clientY };
      },
      onPointerUpCapture: (e: ReactPointerEvent) => {
        if ((e.target as HTMLElement).closest('[data-ref-preview-ignore]')) return;
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const s = startRef.current;
        if (Math.abs(e.clientX - s.x) > 12 || Math.abs(e.clientY - s.y) > 12) return;
        setPreviewUrl(url);
      },
    };
  }, []);

  return { previewUrl, setPreviewUrl, handlersFor };
}
