import React, { useEffect } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';
import { ZoomableLightboxImage } from './ZoomableLightboxImage';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type Props = {
  url: string | null;
  onClose: () => void;
  /** 嵌套在 Modal（z-120）内时用更高层级 */
  zIndexClass?: string;
};

export const ReferenceImageLightbox: React.FC<Props> = ({
  url,
  onClose,
  zIndexClass = 'z-[96]',
}) => {
  useEffect(() => {
    if (!url) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [url, onClose]);

  if (!url) return null;

  return (
    <motion.div
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={spring}
      className={cn('fixed inset-0', zIndexClass)}
    >
      <button
        type="button"
        className="absolute inset-0 bg-black/85 backdrop-blur-md cursor-zoom-out"
        onClick={onClose}
        aria-label="关闭预览"
      />
      <div className="pointer-events-none absolute inset-0 flex flex-col p-3 sm:p-4">
        <div className="pointer-events-auto absolute right-3 top-3 z-20 sm:right-4 sm:top-4">
          <button
            type="button"
            onClick={onClose}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-high/55 text-white/90 outline outline-[0.5px] outline-outline-variant/20 backdrop-blur-[30px] shadow-[0_24px_48px_-28px_rgba(0,0,0,0.55)] transition-colors hover:text-white cursor-pointer"
            title="关闭 (Esc)"
            aria-label="关闭"
          >
            <X className="h-5 w-5" strokeWidth={1.75} />
          </button>
        </div>
        <div className="min-h-0 min-w-0 flex flex-1 flex-col pt-12">
          <div className="pointer-events-auto min-h-0 min-w-0 flex-1">
            <ZoomableLightboxImage
              url={url}
              className="h-full w-full"
              imgClassName="rounded-xl outline outline-[0.5px] outline-white/20 shadow-[0_48px_120px_-40px_rgba(0,0,0,0.85)]"
            />
          </div>
          <p className="pointer-events-none shrink-0 pt-2 text-center text-[10px] font-label tracking-[0.14em] text-white/40 uppercase">
            滚轮缩放 · 中键拖拽 · 点空白或 ✕ 关闭
          </p>
        </div>
      </div>
    </motion.div>
  );
};
