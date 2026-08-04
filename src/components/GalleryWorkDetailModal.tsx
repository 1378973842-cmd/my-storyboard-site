import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Star, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { galleryCategoryLabel } from '../lib/galleryCategories';
import type { GalleryWork } from '../lib/galleryWorksApi';
import { LIGHTBOX_IMAGE_MAX_CLASS } from './ReferenceImageLightbox';
import { ZoomableLightboxImage } from './ZoomableLightboxImage';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type Props = {
  work: GalleryWork | null;
  onClose: () => void;
  /** 个人空间打开自己的作品时：详情里也可编辑再发布 */
  onEdit?: (work: GalleryWork) => void;
  onToggleFavorite?: (work: GalleryWork) => void;
};

export function GalleryWorkDetailModal({ work, onClose, onEdit, onToggleFavorite }: Props) {
  const [mounted, setMounted] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => setMounted(true), []);

  const images = useMemo(() => {
    if (!work) return [] as string[];
    const list = (work.images?.length ? work.images : [work.preview_path || work.thumbnail_path || work.image_path])
      .filter(Boolean);
    return Array.from(new Set(list));
  }, [work]);

  useEffect(() => {
    setActiveIdx(0);
  }, [work?.id]);

  useEffect(() => {
    if (!work) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && images.length > 1) {
        setActiveIdx((i) => (i + 1) % images.length);
      }
      if (e.key === 'ArrowLeft' && images.length > 1) {
        setActiveIdx((i) => (i - 1 + images.length) % images.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [work, onClose, images.length]);

  if (!mounted) return null;

  const src = images[activeIdx] || null;

  return createPortal(
    <AnimatePresence>
      {work && src ? (
        <motion.div
          className="fixed inset-0 z-[210] flex items-center justify-center p-3 sm:p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={spring}
        >
          <button
            type="button"
            className="absolute inset-0 bg-black/85 backdrop-blur-md"
            aria-label="关闭"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={work.title}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            transition={spring}
            className="relative z-10 flex max-h-[min(92dvh,920px)] w-full max-w-[1100px] flex-col overflow-hidden rounded-[22px] bg-[#141414] md:flex-row"
            style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-black/45 text-[#e5e2e1]/9 backdrop-blur-md hover:bg-black/55"
              aria-label="关闭"
            >
              <X className="h-5 w-5" strokeWidth={1.75} />
            </button>

            <div className="relative flex min-h-[240px] flex-1 flex-col bg-black/40 md:min-h-[420px]">
              <ZoomableLightboxImage
                key={src}
                url={src}
                className="h-full min-h-[240px] w-full flex-1 md:min-h-[380px]"
                imgClassName={`${LIGHTBOX_IMAGE_MAX_CLASS} rounded-none`}
              />
              {images.length > 1 ? (
                <div className="flex gap-2 overflow-x-auto px-3 py-3">
                  {images.map((url, idx) => (
                    <button
                      key={`${url}_${idx}`}
                      type="button"
                      onClick={() => setActiveIdx(idx)}
                      className={cn(
                        'h-14 w-14 shrink-0 overflow-hidden rounded-lg',
                        idx === activeIdx ? 'ring-2 ring-[#ffb866]' : 'opacity-70 hover:opacity-100',
                      )}
                    >
                      <img src={url} alt="" className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <aside className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto px-5 py-5 md:w-[320px] md:px-6 md:py-7 lg:w-[360px]">
              <div>
                <p className="text-[12px] text-[#e5e2e1]/45">
                  @{String(work.owner_name || '同事').replace(/\s+/g, '_')}
                </p>
                <h3 className="mt-1 text-[20px] font-semibold tracking-[-0.02em] text-[#e5e2e1]">
                  {work.title || '未命名作品'}
                </h3>
                {work.category ? (
                  <span className="mt-3 inline-flex rounded-full bg-[#2a2a2a] px-2.5 py-1 text-[11.5px] font-medium text-[#e5e2e1]/75">
                    {galleryCategoryLabel(work.category)}
                  </span>
                ) : null}
                {images.length > 1 ? (
                  <p className="mt-2 text-[12px] text-[#e5e2e1]/4">
                    {activeIdx + 1} / {images.length}
                  </p>
                ) : null}
              </div>
              <div className="min-h-0 flex-1">
                <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-[#e5e2e1]/35">
                  作品描述
                </p>
                <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-[#e5e2e1]/72">
                  {work.description?.trim() || '作者未填写描述。'}
                </p>
              </div>
              <div className="mt-auto flex flex-col gap-2">
                {onToggleFavorite && !String(work.id).startsWith('legacy:') ? (
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(work)}
                    className={cn(
                      'inline-flex h-10 items-center justify-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium transition-colors',
                      work.favorited
                        ? 'bg-[#ffb866]/18 text-[#ffb866]'
                        : 'bg-[#2a2a2a] text-[#e5e2e1]/88 hover:bg-[#333]',
                    )}
                  >
                    <Star
                      className="h-4 w-4"
                      strokeWidth={1.75}
                      fill={work.favorited ? 'currentColor' : 'none'}
                    />
                    {work.favorited ? '已收藏' : '收藏到个人空间'}
                    <span className="tabular-nums text-[12px] opacity-70">
                      {work.favorite_count ?? 0}
                    </span>
                  </button>
                ) : null}
                {onEdit ? (
                  <button
                    type="button"
                    onClick={() => {
                      onEdit(work);
                      onClose();
                    }}
                    className="inline-flex h-10 items-center justify-center rounded-full bg-[#e5e2e1] px-4 text-[13.5px] font-medium text-[#141414] transition-colors hover:bg-white"
                  >
                    编辑再发布
                  </button>
                ) : null}
              </div>
            </aside>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
