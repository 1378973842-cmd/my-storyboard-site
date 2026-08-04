import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Check, ImagePlus, Loader2, Plus, Upload, X } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  GALLERY_WORK_CATEGORIES,
  type GalleryWorkCategoryId,
} from '../lib/galleryCategories';
import {
  createGalleryWork,
  fetchMyFavoritesForPicker,
  updateGalleryWork,
  type FavoritePick,
  type GalleryWork,
} from '../lib/galleryWorksApi';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };
const TITLE_MAX = 80;
const DESC_MAX = 500;
const MAX_IMAGES = 9;

type DraftImage = {
  key: string;
  preview: string;
  file?: File;
  path?: string;
  favoriteId?: string;
  revoke?: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  onSaved: (work: GalleryWork) => void;
  editing?: GalleryWork | null;
};

function newKey(): string {
  return `img_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function PublishWorkModal({ open, onClose, onSaved, editing = null }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState<GalleryWorkCategoryId>('original');
  const [drafts, setDrafts] = useState<DraftImage[]>([]);
  const [favorites, setFavorites] = useState<FavoritePick[]>([]);
  const [showFavPicker, setShowFavPicker] = useState(false);
  const [favLoading, setFavLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const revokeDrafts = (list: DraftImage[]) => {
    for (const d of list) {
      if (d.revoke && d.preview.startsWith('blob:')) URL.revokeObjectURL(d.preview);
    }
  };

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title || '');
    setDescription(editing?.description || '');
    setCategory(
      (GALLERY_WORK_CATEGORIES.some((c) => c.id === editing?.category)
        ? editing!.category
        : 'original') as GalleryWorkCategoryId,
    );
    const existing = (editing?.images?.length ? editing.images : editing?.image_path ? [editing.image_path] : [])
      .filter(Boolean)
      .slice(0, MAX_IMAGES)
      .map((path) => ({
        key: newKey(),
        preview: path,
        path,
      }));
    setDrafts((prev) => {
      revokeDrafts(prev);
      return existing;
    });
    setShowFavPicker(false);
    setError(null);
  }, [open, editing]);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  useEffect(() => {
    return () => revokeDrafts(draftsRef.current);
  }, []);

  const loadFavorites = useCallback(async () => {
    setFavLoading(true);
    try {
      setFavorites(await fetchMyFavoritesForPicker());
    } catch {
      setFavorites([]);
    } finally {
      setFavLoading(false);
    }
  }, []);

  const addFiles = (fileList: FileList | File[] | null | undefined) => {
    const incoming = Array.from(fileList || []).filter((f) => f.type.startsWith('image/'));
    if (!incoming.length) {
      setError('请选择图片文件');
      return;
    }
    setError(null);
    setDrafts((prev) => {
      const room = MAX_IMAGES - prev.length;
      if (room <= 0) {
        setError(`最多上传 ${MAX_IMAGES} 张图片`);
        return prev;
      }
      const nextFiles = incoming.slice(0, room);
      if (incoming.length > room) setError(`最多 ${MAX_IMAGES} 张，已加入 ${room} 张`);
      const added: DraftImage[] = nextFiles.map((file) => ({
        key: newKey(),
        preview: URL.createObjectURL(file),
        file,
        revoke: true,
      }));
      return [...prev, ...added];
    });
  };

  const toggleFavorite = (fav: FavoritePick) => {
    setDrafts((prev) => {
      const exists = prev.find((d) => d.favoriteId === fav.id);
      if (exists) {
        return prev.filter((d) => d.favoriteId !== fav.id);
      }
      if (prev.length >= MAX_IMAGES) {
        setError(`最多上传 ${MAX_IMAGES} 张图片`);
        return prev;
      }
      setError(null);
      const src = fav.preview_path || fav.thumbnail_path;
      // 收藏提示词只进描述，不写入作品名称
      if (!description.trim() && fav.prompt) {
        setDescription(fav.prompt.trim().slice(0, DESC_MAX));
      }
      return [
        ...prev,
        {
          key: newKey(),
          preview: src,
          favoriteId: fav.id,
          path: fav.thumbnail_path,
        },
      ];
    });
  };

  const removeDraft = (key: string) => {
    setDrafts((prev) => {
      const hit = prev.find((d) => d.key === key);
      if (hit?.revoke && hit.preview.startsWith('blob:')) URL.revokeObjectURL(hit.preview);
      return prev.filter((d) => d.key !== key);
    });
  };

  const canSubmit = useMemo(() => {
    if (!title.trim() || !category) return false;
    return drafts.length > 0;
  }, [title, category, drafts.length]);

  const submit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const keepPaths = drafts
        .filter((d) => d.path && !d.file && !d.favoriteId)
        .map((d) => d.path!);
      const favoriteIds = drafts.filter((d) => d.favoriteId).map((d) => d.favoriteId!);
      const files = drafts.filter((d) => d.file).map((d) => d.file!);
      const payload = {
        title: title.trim(),
        description: description.trim(),
        category,
        files,
        favoriteIds,
        keepPaths,
      };

      const item = editing
        ? await updateGalleryWork(editing.id, payload)
        : await createGalleryWork(payload);
      onSaved(item);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '发布失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (typeof document === 'undefined') return null;

  const selectedFavIds = new Set(drafts.map((d) => d.favoriteId).filter(Boolean));

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[220] flex items-center justify-center p-4">
          <motion.button
            type="button"
            aria-label="关闭"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-work-title"
            initial={{ opacity: 0, y: 20, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={spring}
            className="relative z-10 flex max-h-[min(90dvh,860px)] w-full max-w-[920px] flex-col overflow-hidden rounded-[24px] bg-[#1a1919] shadow-[0_48px_96px_-48px_rgba(0,0,0,0.75)]"
            style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
            data-theme-preserve="dark"
          >
            <div className="flex items-start justify-between gap-4 px-6 pb-2 pt-6 md:px-8 md:pt-7">
              <div>
                <h2
                  id="publish-work-title"
                  className="text-[22px] font-semibold tracking-[-0.02em] text-[#e5e2e1] md:text-[24px]"
                >
                  {editing ? '编辑并重新发布' : '发布作品到公共画廊'}
                </h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#e5e2e1]/45">
                  最多 {MAX_IMAGES} 张图。可本地上传，也可从收藏多选导入。
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#e5e2e1]/55 transition-colors hover:bg-white/5 hover:text-[#e5e2e1]"
                aria-label="关闭"
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="shell-slim-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-4 md:px-8">
              <div className="grid gap-6 md:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] md:gap-8">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[13.5px] font-medium text-[#e5e2e1]/85">
                      上传作品<span className="text-[#ffb866]">*</span>
                      <span className="ml-2 text-[12px] font-normal text-[#e5e2e1]/40">
                        {drafts.length}/{MAX_IMAGES}
                      </span>
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setShowFavPicker((v) => !v);
                        if (!showFavPicker) void loadFavorites();
                      }}
                      className="rounded-full bg-[#2a2a2a] px-3 py-1 text-[12.5px] font-medium text-[#ffb866] transition-colors hover:bg-[#333]"
                    >
                      {showFavPicker ? '收起收藏' : '从我的收藏导入'}
                    </button>
                  </div>

                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    className="sr-only"
                    onChange={(e) => {
                      addFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />

                  {drafts.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        addFiles(e.dataTransfer.files);
                      }}
                      className="relative flex min-h-[220px] flex-col items-center justify-center gap-3 overflow-hidden rounded-[18px] bg-[#121212] px-4 py-8 text-center transition-colors hover:bg-[#161616] md:min-h-[260px]"
                      style={{ outline: '0.5px solid rgba(255,255,255,0.16)', outlineOffset: '-0.5px' }}
                    >
                      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-[#2a2a2a] text-[#e5e2e1]">
                        <Upload className="h-5 w-5" strokeWidth={1.75} />
                      </span>
                      <span className="text-[14px] font-medium text-[#e5e2e1]">点击或拖拽上传</span>
                      <span className="text-[12px] text-[#e5e2e1]/45">支持多选，JPG / PNG / WebP / GIF</span>
                    </button>
                  ) : (
                    <div
                      className="rounded-[18px] bg-[#121212] p-3"
                      style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.preventDefault();
                        addFiles(e.dataTransfer.files);
                      }}
                    >
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {drafts.map((d, idx) => (
                          <div
                            key={d.key}
                            className="group relative aspect-square overflow-hidden rounded-xl bg-[#1c1b1b]"
                          >
                            <img
                              src={d.preview}
                              alt=""
                              className="h-full w-full object-cover"
                              draggable={false}
                            />
                            {idx === 0 ? (
                              <span className="absolute left-1.5 top-1.5 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-[#e5e2e1]">
                                封面
                              </span>
                            ) : null}
                            <button
                              type="button"
                              onClick={() => removeDraft(d.key)}
                              className="absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/65 text-[#e5e2e1] opacity-90 hover:bg-black/80"
                              aria-label="移除图片"
                            >
                              <X className="h-3.5 w-3.5" strokeWidth={2} />
                            </button>
                          </div>
                        ))}
                        {drafts.length < MAX_IMAGES ? (
                          <button
                            type="button"
                            onClick={() => fileRef.current?.click()}
                            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl bg-[#1c1b1b] text-[#e5e2e1]/7 transition-colors hover:bg-[#242424] hover:text-[#e5e2e1]"
                            style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
                          >
                            <Plus className="h-5 w-5" strokeWidth={1.75} />
                            <span className="text-[11px]">继续添加</span>
                          </button>
                        ) : null}
                      </div>
                      <p className="mt-2.5 text-[11.5px] text-[#e5e2e1]/42">
                        第一张为封面。可继续拖拽或点击添加。
                      </p>
                    </div>
                  )}

                  {showFavPicker ? (
                    <div
                      className="rounded-[16px] bg-[#242322] p-3.5"
                      style={{ outline: '0.5px solid rgba(255,184,102,0.28)', outlineOffset: '-0.5px' }}
                    >
                      <div className="mb-2.5 flex items-center justify-between gap-2">
                        <p className="text-[13px] font-medium text-[#e5e2e1]">
                          从收藏多选导入
                        </p>
                        <p className="text-[11.5px] text-[#ffb866]/90">
                          已选 {selectedFavIds.size} 张
                        </p>
                      </div>
                      {favLoading ? (
                        <div className="flex justify-center py-6 text-[#e5e2e1]/65">
                          <Loader2 className="h-5 w-5 animate-spin" />
                        </div>
                      ) : favorites.length === 0 ? (
                        <p className="py-5 text-center text-[13px] text-[#e5e2e1]/55">
                          收藏还是空的，先去画布点星标吧
                        </p>
                      ) : (
                        <div className="grid max-h-48 grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5">
                          {favorites.map((fav) => {
                            const src = fav.preview_path || fav.thumbnail_path;
                            const active = selectedFavIds.has(fav.id);
                            return (
                              <button
                                key={fav.id}
                                type="button"
                                onClick={() => toggleFavorite(fav)}
                                className={cn(
                                  'relative aspect-square overflow-hidden rounded-lg bg-[#1c1b1b]',
                                  active
                                    ? 'ring-2 ring-[#ffb866]'
                                    : 'ring-1 ring-white/10 hover:ring-white/25',
                                )}
                              >
                                <img
                                  src={fav.thumbnail_path || src}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                                {active ? (
                                  <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[#ffb866] text-[#141414]">
                                    <Check className="h-3 w-3" strokeWidth={2.5} />
                                  </span>
                                ) : null}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-col gap-4">
                  <div>
                    <label className="text-[13.5px] font-medium text-[#e5e2e1]/85">
                      作品名称<span className="text-[#ffb866]">*</span>
                    </label>
                    <div className="relative mt-2">
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value.slice(0, TITLE_MAX))}
                        placeholder="请输入作品名称"
                        className="h-11 w-full rounded-xl bg-[#121212] px-3.5 pr-14 text-[14px] text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 outline-none"
                        style={{ outline: '0.5px solid rgba(255,255,255,0.08)', outlineOffset: '-0.5px' }}
                      />
                      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] text-[#e5e2e1]/35">
                        {title.length}/{TITLE_MAX}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[13.5px] font-medium text-[#e5e2e1]/85">作品描述</label>
                    <div className="relative mt-2">
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value.slice(0, DESC_MAX))}
                        placeholder="请输入作品描述"
                        rows={5}
                        className="w-full resize-none rounded-xl bg-[#121212] px-3.5 py-3 pb-8 text-[14px] leading-relaxed text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 outline-none"
                        style={{ outline: '0.5px solid rgba(255,255,255,0.08)', outlineOffset: '-0.5px' }}
                      />
                      <span className="pointer-events-none absolute bottom-2.5 right-3 text-[11px] text-[#e5e2e1]/35">
                        {description.length}/{DESC_MAX}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label className="text-[13.5px] font-medium text-[#e5e2e1]/85">
                      上传分类<span className="text-[#ffb866]">*</span>
                    </label>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {GALLERY_WORK_CATEGORIES.map((cat) => {
                        const active = category === cat.id;
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => setCategory(cat.id)}
                            className={cn(
                              'rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                              active
                                ? 'bg-[#d8d4d2] text-[#141414]'
                                : 'bg-[#121212] text-[#e5e2e1]/55 hover:text-[#e5e2e1]/85',
                            )}
                          >
                            {cat.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {error ? (
                    <p className="text-[13px] text-red-400/95" role="alert">
                      {error}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 px-6 py-4 md:px-8">
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-full bg-[#2a2a2a] px-5 text-[13.5px] font-medium text-[#e5e2e1]/85 transition-colors hover:bg-[#333]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!canSubmit || submitting}
                onClick={() => void submit()}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#e5e2e1] px-5 text-[13.5px] font-medium text-[#141414] transition-[opacity,transform] hover:bg-white disabled:opacity-45 active:scale-[0.98]"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                {editing ? '保存并发布' : '发布并投稿'}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
