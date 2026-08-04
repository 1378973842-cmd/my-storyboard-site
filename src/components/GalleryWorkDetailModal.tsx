import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Star, X } from 'lucide-react';
import { cn } from '../lib/utils';
import { galleryCategoryLabel } from '../lib/galleryCategories';
import { processStepImages, type GalleryWork } from '../lib/galleryWorksApi';
import { CopyablePromptText } from './CopyablePromptText';
import { ZoomableLightboxImage } from './ZoomableLightboxImage';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type Props = {
  work: GalleryWork | null;
  onClose: () => void;
  /** 个人空间打开自己的作品时：详情里也可编辑再发布 */
  onEdit?: (work: GalleryWork) => void;
  onToggleFavorite?: (work: GalleryWork) => void;
};

type ViewMode = 'detail' | 'process';

export function GalleryWorkDetailModal({ work, onClose, onEdit, onToggleFavorite }: Props) {
  const [mounted, setMounted] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [view, setView] = useState<ViewMode>('detail');
  useEffect(() => setMounted(true), []);

  const images = useMemo(() => {
    if (!work) return [] as string[];
    const list = (work.images?.length ? work.images : [work.preview_path || work.thumbnail_path || work.image_path])
      .filter(Boolean);
    return Array.from(new Set(list));
  }, [work]);

  const processSteps = useMemo(() => {
    if (!work || !Array.isArray(work.process_steps)) return [];
    return work.process_steps.filter((s) => processStepImages(s).length > 0);
  }, [work]);

  useEffect(() => {
    setActiveIdx(0);
    setView('detail');
  }, [work?.id]);

  useEffect(() => {
    if (!work) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view === 'process') {
          setView('detail');
          return;
        }
        onClose();
        return;
      }
      if (view !== 'detail') return;
      if (e.key === 'ArrowRight' && images.length > 1) {
        setActiveIdx((i) => (i + 1) % images.length);
      }
      if (e.key === 'ArrowLeft' && images.length > 1) {
        setActiveIdx((i) => (i - 1 + images.length) % images.length);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [work, onClose, images.length, view]);

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
            className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
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
            className={cn(
              'relative z-10 flex w-full overflow-hidden rounded-[22px] bg-[#141414]',
              view === 'detail'
                ? 'max-h-[min(94dvh,960px)] max-w-[1100px] flex-col md:flex-row'
                : 'max-h-[min(96dvh,980px)] max-w-[min(96vw,1440px)] flex-col',
            )}
            style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 z-30 flex h-10 w-10 items-center justify-center rounded-full bg-[#2a2a2a] text-[#e5e2e1] shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-md hover:bg-[#3a3a3a] hover:text-white"
              style={{ outline: '0.5px solid rgba(229,226,225,0.45)', outlineOffset: '-0.5px' }}
              aria-label="关闭"
            >
              <X className="h-5 w-5" strokeWidth={2} />
            </button>

            {view === 'detail' ? (
              <>
                <div className="relative flex min-h-[240px] min-w-0 flex-1 flex-col overflow-hidden bg-black/40 md:min-h-[420px]">
                  <ZoomableLightboxImage
                    key={src}
                    url={src}
                    className="h-full min-h-0 min-w-0 w-full flex-1"
                    imgClassName="max-h-full max-w-full rounded-none"
                  />
                  {images.length > 1 ? (
                    <div className="flex shrink-0 gap-2 overflow-x-auto px-3 py-3">
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
                    {processSteps.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setView('process')}
                        className="inline-flex h-10 items-center justify-center rounded-full bg-[#2a2a2a] px-4 text-[13.5px] font-medium text-[#ffb866] transition-colors hover:bg-[#333]"
                        style={{ outline: '0.5px solid rgba(255,184,102,0.28)', outlineOffset: '-0.5px' }}
                      >
                        查看创作过程
                      </button>
                    ) : null}
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
                        {work.published === false ? '继续编辑草稿' : '编辑再发布'}
                      </button>
                    ) : null}
                  </div>
                </aside>
              </>
            ) : (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <div className="flex shrink-0 items-center gap-3 px-5 pb-3 pt-5 pr-14 md:px-7 md:pt-6">
                  <button
                    type="button"
                    onClick={() => setView('detail')}
                    className="inline-flex h-9 items-center justify-center rounded-full bg-[#2a2a2a] px-3.5 text-[13px] font-medium text-[#e5e2e1]/88 hover:bg-[#333]"
                  >
                    返回作品预览
                  </button>
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium text-[#e5e2e1]/85">
                      {work.title || '未命名作品'}
                      <span className="ml-2 text-[12px] font-normal text-[#e5e2e1]/45">
                        创作过程 · {processSteps.length} 步 · 从左到右滑动
                      </span>
                    </p>
                  </div>
                </div>

                <div className="custom-scrollbar min-h-0 flex-1 overflow-x-auto overflow-y-auto px-5 pb-6 md:px-7">
                  {/* items-stretch + 固定图区高度 → 各步「提示词」顶边对齐 */}
                  <ol className="flex w-max items-stretch gap-0 pb-2">
                    {processSteps.map((step, idx) => {
                      const imgs = processStepImages(step);
                      return (
                        <li key={`${step.image_path}_${idx}`} className="flex items-stretch">
                          <div className="flex w-[300px] shrink-0 flex-col sm:w-[320px]">
                            <div className="mb-2.5 flex items-baseline gap-2">
                              <span className="text-[13px] font-medium tabular-nums text-[#ffb866]">
                                步骤 {idx + 1}
                              </span>
                              {imgs.length > 1 ? (
                                <span className="text-[12px] text-[#e5e2e1]/4">
                                  {imgs.length} 张图
                                </span>
                              ) : null}
                            </div>

                            <div className="flex h-[300px] w-full flex-col gap-2 overflow-hidden">
                              {imgs.length === 1 ? (
                                <div className="flex h-full w-full items-center justify-center">
                                  <img
                                    src={imgs[0]}
                                    alt=""
                                    className="max-h-full max-w-full object-contain"
                                  />
                                </div>
                              ) : (
                                imgs.map((url, i) => (
                                  <div
                                    key={`${url}_${i}`}
                                    className="min-h-0 flex-1 overflow-hidden"
                                  >
                                    <img
                                      src={url}
                                      alt=""
                                      className="h-full w-full object-contain"
                                    />
                                  </div>
                                ))
                              )}
                            </div>

                            <div className="mt-3 flex min-h-0 flex-1 flex-col">
                              <p className="mb-1.5 text-[11px] font-medium tracking-wide text-[#e5e2e1]/55">
                                提示词
                              </p>
                              <CopyablePromptText
                                text={step.note || ''}
                                emptyLabel="未填写提示词"
                                lineClamp="none"
                                className="text-[13px]"
                              />
                            </div>
                          </div>

                          {idx < processSteps.length - 1 ? (
                            <div
                              className="mx-3 flex w-8 shrink-0 items-center self-center"
                              style={{ marginTop: '-40px' }}
                              aria-hidden
                            >
                              <div className="h-px flex-1 bg-gradient-to-r from-white/25 to-[#ffb866]/35" />
                              <ChevronRight className="-ml-1 h-3.5 w-3.5 text-[#ffb866]/55" />
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
