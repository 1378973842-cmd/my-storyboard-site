import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ImagePlus, Loader2, Trash2 } from 'lucide-react';
import {
  fetchHomeCarousel,
  publishHomeCarousel,
  uploadHomeCarouselImages,
} from '../lib/homeCarouselApi';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type DraftItem = {
  key: string;
  previewUrl: string;
  /** 已发布或已上传的站点路径；本地新文件为空 */
  remoteUrl: string | null;
  file: File | null;
};

export const AdminHomeCarouselPage = memo(function AdminHomeCarouselPage({
  shellActive,
}: {
  shellActive: boolean;
}) {
  const addNotice = useStore((s) => s.addNotice);
  const [draft, setDraft] = useState<DraftItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const blobUrlsRef = useRef<string[]>([]);

  const revokeBlobs = useCallback(() => {
    for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    blobUrlsRef.current = [];
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const items = await fetchHomeCarousel();
      revokeBlobs();
      setDraft(
        items.map((item) => ({
          key: item.id,
          previewUrl: item.image_url,
          remoteUrl: item.image_url,
          file: null,
        })),
      );
    } catch (e) {
      addNotice(e instanceof Error ? e.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [addNotice, revokeBlobs]);

  useEffect(() => {
    if (shellActive) void load();
  }, [shellActive, load]);

  useEffect(() => () => revokeBlobs(), [revokeBlobs]);

  const appendFiles = useCallback((files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setDraft((prev) => {
      const next = [...prev];
      for (const file of list) {
        const previewUrl = URL.createObjectURL(file);
        blobUrlsRef.current.push(previewUrl);
        next.push({
          key: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          previewUrl,
          remoteUrl: null,
          file,
        });
      }
      return next;
    });
  }, []);

  const removeAt = useCallback((key: string) => {
    setDraft((prev) => {
      const target = prev.find((d) => d.key === key);
      if (target?.file && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
        blobUrlsRef.current = blobUrlsRef.current.filter((u) => u !== target.previewUrl);
      }
      return prev.filter((d) => d.key !== key);
    });
  }, []);

  const onPublish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const urls: string[] = [];
      const pendingFiles = draft.filter((d) => d.file).map((d) => d.file!) ;
      let uploaded: string[] = [];
      if (pendingFiles.length) {
        uploaded = await uploadHomeCarouselImages(pendingFiles);
      }
      let uploadIdx = 0;
      for (const item of draft) {
        if (item.remoteUrl) urls.push(item.remoteUrl);
        else if (item.file) {
          const next = uploaded[uploadIdx++];
          if (next) urls.push(next);
        }
      }
      const items = await publishHomeCarousel(urls);
      revokeBlobs();
      setDraft(
        items.map((item) => ({
          key: item.id,
          previewUrl: item.image_url,
          remoteUrl: item.image_url,
          file: null,
        })),
      );
      addNotice(urls.length ? '主页轮播已更新' : '已清空主页轮播', 'success');
    } catch (e) {
      addNotice(e instanceof Error ? e.message : '更新失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const dirtyHint = useMemo(() => {
    const pending = draft.filter((d) => d.file).length;
    return pending ? `${pending} 张待上传` : '拖入图片后点「更新」发布到主页';
  }, [draft]);

  if (!shellActive) return null;

  return (
    <div className="fixed inset-0 z-[62] min-h-[100dvh] overflow-y-auto overscroll-y-auto bg-[#0e0e0e] text-[#e5e2e1] custom-scrollbar">
      <main className="mx-auto max-w-4xl px-6 pb-10 pt-[5.5rem] md:px-10 md:pt-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <span className="font-label text-[10px] font-semibold uppercase tracking-[0.28em] text-primary/80">
            Admin
          </span>
          <h1 className="mt-3 font-headline text-3xl tracking-[-0.02em] text-on-surface md:text-[2.15rem]">
            主页轮播
          </h1>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-[#e5e2e1]/55">
            拖入图片到下方区域，调整列表后点「更新」。主页按 16:9、每页三张顺序循环播放（任意原图比例都会裁切为 16:9）。
          </p>

          <div
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
            }}
            onClick={() => inputRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              setDragOver(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              if (e.dataTransfer.files?.length) appendFiles(e.dataTransfer.files);
            }}
            className={cn(
              'mt-8 flex min-h-[160px] cursor-pointer flex-col items-center justify-center gap-3 rounded-[1.5rem] bg-[#131313]/9 px-6 py-10 text-center transition-colors',
              dragOver ? 'bg-[#1c1b1b]' : 'hover:bg-[#161616]',
            )}
            style={{ outline: '0.5px solid rgba(69,70,77,0.28)', outlineOffset: '-0.5px' }}
          >
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[#ffb866]/14 text-[#ffb866]">
              <ImagePlus className="h-5 w-5" />
            </span>
            <p className="text-[14px] font-medium text-[#e5e2e1]/85">拖拽图片到这里，或点击选择</p>
            <p className="text-[12px] text-[#e5e2e1]/4">JPG / PNG / WebP，可多选</p>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) appendFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-[#e5e2e1]/45">{dirtyHint}</p>
            <button
              type="button"
              disabled={busy || loading}
              onClick={() => void onPublish()}
              className="rounded-full bg-[#ffb866] px-6 py-2.5 text-[13px] font-semibold text-[#1a1410] disabled:opacity-45"
            >
              {busy ? '更新中…' : '更新'}
            </button>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {loading ? (
              <div className="col-span-full flex items-center gap-2 text-[13px] text-[#e5e2e1]/45">
                <Loader2 className="h-4 w-4 animate-spin" />
                加载中…
              </div>
            ) : draft.length === 0 ? (
              <p className="col-span-full text-[13px] text-[#e5e2e1]/4">暂无图片，拖入后点更新即可在主页轮播</p>
            ) : (
              draft.map((item, index) => (
                <div
                  key={item.key}
                  className="group relative overflow-hidden rounded-2xl bg-[#131313]"
                  style={{ outline: '0.5px solid rgba(69,70,77,0.2)', outlineOffset: '-0.5px' }}
                >
                  <div className="aspect-video w-full overflow-hidden bg-[#1c1b1b]">
                    <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="flex items-center justify-between gap-2 px-3 py-2">
                    <span className="text-[11px] text-[#e5e2e1]/45">#{index + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeAt(item.key)}
                      disabled={busy}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-full text-[#fca5a5] transition-colors hover:bg-white/[0.05] disabled:opacity-40"
                      aria-label="移除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
});
