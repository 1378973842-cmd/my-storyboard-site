import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Images, Lock, Loader2, Plus, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../stores/authStore';
import { readJsonResponse } from '../lib/readJsonResponse';
import { uploadCover } from '../lib/profileApi';
import { galleryCategoryLabel } from '../lib/galleryCategories';
import {
  fetchMyGalleryFavorites,
  fetchMyWorks,
  type GalleryWork,
} from '../lib/galleryWorksApi';
import { CopyablePromptText } from '../components/CopyablePromptText';
import { ReferenceImageLightbox } from '../components/ReferenceImageLightbox';
import { PublishWorkModal } from '../components/PublishWorkModal';
import { GalleryWorkDetailModal } from '../components/GalleryWorkDetailModal';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type SpaceTab = 'portfolio' | 'favorites';
type WorkSubTab = 'works' | 'series';
type FavFilter = 'all' | 'mine' | 'gallery';

type FavoriteItem = {
  id: string;
  thumbnail_path: string;
  preview_path?: string;
  prompt: string;
  model?: string;
};

function FeaturedEmptyIcon() {
  return (
    <svg
      width="72"
      height="56"
      viewBox="0 0 72 56"
      fill="none"
      aria-hidden
      className="text-[#e5e2e1]/28"
    >
      <rect
        x="8"
        y="10"
        width="40"
        height="32"
        rx="6"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="rgba(255,255,255,0.03)"
      />
      <rect
        x="24"
        y="18"
        width="40"
        height="32"
        rx="6"
        stroke="currentColor"
        strokeWidth="1.5"
        fill="rgba(28,27,27,0.92)"
      />
      <circle cx="36" cy="30" r="4" fill="currentColor" opacity="0.35" />
      <path
        d="M28 44h28l-7.5-9-5 5.5-4-4.5L28 44z"
        fill="currentColor"
        opacity="0.22"
      />
    </svg>
  );
}

export const PersonalSpacePage = memo(function PersonalSpacePage({
  shellActive,
}: {
  shellActive: boolean;
}) {
  const addNotice = useStore((s) => s.addNotice);
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const pageScrollRef = useRef<HTMLDivElement>(null);
  const [spaceTab, setSpaceTab] = useState<SpaceTab>('portfolio');
  const [workTab, setWorkTab] = useState<WorkSubTab>('works');
  const [favorites, setFavorites] = useState<FavoriteItem[]>([]);
  const [galleryFavorites, setGalleryFavorites] = useState<GalleryWork[]>([]);
  const [favFilter, setFavFilter] = useState<FavFilter>('all');
  const [favLoading, setFavLoading] = useState(false);
  const [works, setWorks] = useState<GalleryWork[]>([]);
  const [worksLoading, setWorksLoading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [detail, setDetail] = useState<GalleryWork | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [editing, setEditing] = useState<GalleryWork | null>(null);
  const [coverUploading, setCoverUploading] = useState(false);
  const [coverVersion, setCoverVersion] = useState(0);

  const loadFavorites = useCallback(async () => {
    setFavLoading(true);
    try {
      const [mineRes, galleryItems] = await Promise.all([
        fetch('/api/my-favorites', { credentials: 'same-origin' }).then((res) =>
          readJsonResponse<{ items?: FavoriteItem[]; error?: string }>(res).then((data) => {
            if (!res.ok) throw new Error(data.error || '加载失败');
            return Array.isArray(data.items) ? data.items : [];
          }),
        ),
        fetchMyGalleryFavorites(),
      ]);
      setFavorites(mineRes);
      setGalleryFavorites(galleryItems);
    } catch {
      setFavorites([]);
      setGalleryFavorites([]);
    } finally {
      setFavLoading(false);
    }
  }, []);

  const loadWorks = useCallback(async () => {
    setWorksLoading(true);
    try {
      setWorks(await fetchMyWorks());
    } catch {
      setWorks([]);
    } finally {
      setWorksLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!shellActive) return;
    if (spaceTab === 'favorites') void loadFavorites();
    if (spaceTab === 'portfolio') void loadWorks();
  }, [shellActive, spaceTab, loadFavorites, loadWorks]);

  const openPublish = (work?: GalleryWork | null) => {
    setEditing(work && !String(work.id).startsWith('legacy:') ? work : null);
    setPublishOpen(true);
  };

  const switchFavFilter = useCallback((next: FavFilter) => {
    const scroller = pageScrollRef.current;
    const top = scroller?.scrollTop ?? 0;
    setFavFilter(next);
    // 列表高度变化时锁住滚动，避免整页突然往下跳
    requestAnimationFrame(() => {
      if (scroller) scroller.scrollTop = top;
    });
  }, []);

  const onPickCover = useCallback(
    async (file: File | undefined) => {
      if (!file || coverUploading) return;
      if (!file.type.startsWith('image/')) {
        addNotice('请选择图片文件', 'error');
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        addNotice('背景图请小于 8MB', 'error');
        return;
      }
      setCoverUploading(true);
      try {
        const next = await uploadCover(file);
        setUser(next);
        setCoverVersion((v) => v + 1);
        addNotice('背景已更新', 'success');
      } catch (e) {
        addNotice(e instanceof Error ? e.message : '上传背景失败', 'error');
      } finally {
        setCoverUploading(false);
        if (coverInputRef.current) coverInputRef.current.value = '';
      }
    },
    [addNotice, coverUploading, setUser],
  );

  if (!shellActive) return null;

  const soon = (msg: string) => addNotice(msg, 'info');
  const coverSrc =
    user?.cover_url != null && user.cover_url !== ''
      ? coverVersion > 0
        ? `${user.cover_url}?v=${coverVersion}`
        : user.cover_url
      : null;

  return (
    <div
      ref={pageScrollRef}
      className="shell-slim-scrollbar fixed inset-0 z-[62] min-h-[100dvh] overflow-y-auto overscroll-y-auto bg-[#0e0e0e] text-[#e5e2e1] [overflow-anchor:none]"
    >
      {/* 全宽可更换背景 */}
      <section
        className="relative w-full overflow-hidden"
        style={{ height: 'clamp(200px, 28vw, 300px)' }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, #12141a 0%, #0e0e0e 55%, #0e0e0e 100%)',
          }}
        />
        {coverSrc ? (
          <img
            src={coverSrc}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
          />
        ) : null}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(180deg, rgba(14,14,14,0.28) 0%, rgba(14,14,14,0.12) 45%, rgba(14,14,14,0.72) 100%)',
          }}
        />

        <input
          ref={coverInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="sr-only"
          onChange={(e) => void onPickCover(e.target.files?.[0])}
        />

        <div className="relative z-[1] flex h-full items-center justify-center pt-14 md:pt-16">
          <button
            type="button"
            disabled={coverUploading}
            onClick={() => coverInputRef.current?.click()}
            className="group flex flex-col items-center gap-2.5 rounded-2xl px-6 py-4 transition-opacity disabled:opacity-60"
            aria-label="更换背景图片"
          >
            <span
              className="flex h-11 w-11 items-center justify-center rounded-full bg-black/35 text-[#e5e2e1]/88 backdrop-blur-[20px] transition-[background,transform] group-hover:bg-black/45 group-hover:scale-[1.03]"
              style={{ outline: '0.5px solid rgba(255,255,255,0.14)', outlineOffset: '-0.5px' }}
            >
              {coverUploading ? (
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="h-5 w-5" strokeWidth={1.75} aria-hidden />
              )}
            </span>
            <span className="text-[13.5px] font-medium tracking-[-0.01em] text-[#e5e2e1]/88 drop-shadow-[0_1px_8px_rgba(0,0,0,0.55)]">
              {coverUploading ? '上传中…' : '更换背景图片'}
            </span>
          </button>
        </div>
      </section>

      <main className="relative z-[1] mx-auto w-full max-w-[1400px] px-5 pb-20 pt-7 md:px-8 md:pt-9 lg:px-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="flex flex-col gap-8 md:gap-10"
        >
          {/* 顶栏：我的作品集 / 我的收藏 */}
          <div className="flex items-end gap-7 md:gap-9" role="tablist" aria-label="个人空间">
            <button
              type="button"
              role="tab"
              aria-selected={spaceTab === 'portfolio'}
              onClick={() => setSpaceTab('portfolio')}
              className={cn(
                'relative pb-2.5 text-[15px] font-medium tracking-[-0.01em] transition-colors',
                spaceTab === 'portfolio' ? 'text-[#e5e2e1]' : 'text-[#e5e2e1]/42 hover:text-[#e5e2e1]/72',
              )}
            >
              我的作品集
              {spaceTab === 'portfolio' ? (
                <motion.span
                  layoutId="personal-space-top-underline"
                  className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[#e5e2e1]"
                  transition={spring}
                />
              ) : null}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={spaceTab === 'favorites'}
              onClick={() => setSpaceTab('favorites')}
              className={cn(
                'relative inline-flex items-center gap-1.5 pb-2.5 text-[15px] font-medium tracking-[-0.01em] transition-colors',
                spaceTab === 'favorites' ? 'text-[#e5e2e1]' : 'text-[#e5e2e1]/42 hover:text-[#e5e2e1]/72',
              )}
            >
              我的收藏
              <Lock className="h-3.5 w-3.5 opacity-70" strokeWidth={2} aria-hidden />
              {spaceTab === 'favorites' ? (
                <motion.span
                  layoutId="personal-space-top-underline"
                  className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[#e5e2e1]"
                  transition={spring}
                />
              ) : null}
            </button>
          </div>

          <AnimatePresence mode="wait">
            {spaceTab === 'portfolio' ? (
              <motion.div
                key="portfolio"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={spring}
                className="flex flex-col gap-9 md:gap-11"
              >
                {/* 代表作：三格横排铺满宽度 */}
                <section className="flex flex-col gap-3.5">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <h2 className="text-[15px] font-medium tracking-[-0.01em] text-[#e5e2e1]/88">
                      代表作{' '}
                      <span className="text-[#e5e2e1]/45">(0/3)</span>
                    </h2>
                    <p className="text-[12.5px] text-[#e5e2e1]/38">
                      向全世界展示你最得意的创作
                    </p>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-3.5 md:gap-4">
                    {[0, 1, 2].map((slot) => (
                      <button
                        key={slot}
                        type="button"
                        onClick={() => soon('代表作挑选即将开放')}
                        className="group flex aspect-[16/10] flex-col items-center justify-center gap-2 rounded-[18px] bg-[#1c1b1b] transition-[background,transform] hover:bg-[#222221] active:scale-[0.99] md:rounded-[20px]"
                        style={{ outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }}
                      >
                        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2a2a2a] text-[#e5e2e1]/55 transition-colors group-hover:text-[#e5e2e1]/85">
                          <Plus className="h-4 w-4" strokeWidth={1.75} aria-hidden />
                        </span>
                        <span className="text-[13px] font-medium text-[#e5e2e1]/45 group-hover:text-[#e5e2e1]/75">
                          添加代表作
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                {/* 作品 / 系列 */}
                <section className="flex flex-col gap-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div
                      className="inline-flex items-center gap-1 rounded-full bg-[#161616] p-1"
                      role="tablist"
                      aria-label="作品分类"
                    >
                      {(
                        [
                          ['works', '作品', works.length],
                          ['series', '系列', 0],
                        ] as const
                      ).map(([id, label, count]) => {
                        const active = workTab === id;
                        return (
                          <button
                            key={id}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => setWorkTab(id)}
                            className={cn(
                              'relative rounded-full px-3.5 py-1.5 text-[13.5px] font-medium transition-colors',
                              active ? 'text-[#e5e2e1]' : 'text-[#e5e2e1]/42 hover:text-[#e5e2e1]/7',
                            )}
                          >
                            {active ? (
                              <motion.span
                                layoutId="personal-work-subtab"
                                className="absolute inset-0 rounded-full bg-[#2a2a2a]"
                                transition={spring}
                                style={{ outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }}
                              />
                            ) : null}
                            <span className="relative z-[1]">
                              {label} ({count})
                            </span>
                          </button>
                        );
                      })}
                    </div>

                    <button
                      type="button"
                      onClick={() => soon('筛选即将开放')}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[13px] text-[#e5e2e1]/55 transition-colors hover:text-[#e5e2e1]/85"
                    >
                      全部
                      <ChevronDown className="h-3.5 w-3.5 opacity-80" strokeWidth={2} aria-hidden />
                    </button>
                  </div>

                  {workTab === 'works' ? (
                    worksLoading ? (
                      <div className="flex min-h-[180px] items-center justify-center text-[#e5e2e1]/5">
                        <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4 xl:grid-cols-4">
                        <button
                          type="button"
                          onClick={() => openPublish(null)}
                          className="group flex aspect-[16/10] flex-col items-center justify-center gap-2 rounded-[18px] bg-[#1c1b1b] transition-[background,transform] hover:bg-[#222221] active:scale-[0.99] md:rounded-[20px]"
                          style={{ outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }}
                        >
                          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#2a2a2a] text-[#e5e2e1]/75 transition-colors group-hover:text-[#e5e2e1]">
                            <Plus className="h-5 w-5" strokeWidth={1.75} aria-hidden />
                          </span>
                          <span className="text-[13.5px] font-medium text-[#e5e2e1]/55 group-hover:text-[#e5e2e1]/8">
                            发布作品
                          </span>
                        </button>
                        {works.map((work) => {
                          const src = work.thumbnail_path || work.preview_path || work.image_path;
                          return (
                            <article
                              key={work.id}
                              className="group relative aspect-[16/10] overflow-hidden rounded-[18px] bg-[#1c1b1b] md:rounded-[20px]"
                              style={{ outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }}
                            >
                              <button
                                type="button"
                                onClick={() => setDetail(work)}
                                className="absolute inset-0 block w-full text-left"
                                aria-label={`查看 ${work.title}`}
                              >
                                <img
                                  src={src}
                                  alt=""
                                  className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                                  loading="lazy"
                                  draggable={false}
                                />
                                <span className="pointer-events-none absolute inset-x-0 bottom-0 h-[55%] bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
                                <span className="absolute inset-x-0 bottom-0 px-3.5 pb-3.5 pr-24">
                                  <span className="block truncate text-[13px] font-semibold text-[#f2efee]">
                                    {work.title}
                                  </span>
                                  <span className="mt-0.5 block text-[11px] text-white/60">
                                    {galleryCategoryLabel(work.category)}
                                  </span>
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openPublish(work)}
                                className="absolute bottom-3 right-3 z-[1] rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-medium text-[#e5e2e1]/92 backdrop-blur-[16px] transition-colors hover:bg-black/65 hover:text-[#e5e2e1]"
                                style={{ outline: '0.5px solid rgba(255,255,255,0.18)', outlineOffset: '-0.5px' }}
                              >
                                编辑
                              </button>
                            </article>
                          );
                        })}
                      </div>
                    )
                  ) : (
                    <div
                      className="flex min-h-[180px] flex-col items-center justify-center gap-3 rounded-[22px] bg-[#1c1b1b]/70 px-6 py-12"
                      style={{ outline: '0.5px solid rgba(255,255,255,0.05)', outlineOffset: '-0.5px' }}
                    >
                      <Images className="h-7 w-7 text-[#e5e2e1]/28" strokeWidth={1.5} aria-hidden />
                      <p className="text-[13.5px] text-[#e5e2e1]/42">还没有系列</p>
                      <button
                        type="button"
                        onClick={() => soon('系列功能即将开放')}
                        className="text-[13px] font-medium text-[#ffb866]/85 hover:text-[#ffb866]"
                      >
                        + 创建系列
                      </button>
                    </div>
                  )}
                </section>
              </motion.div>
            ) : (
              <motion.div
                key="favorites"
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                transition={spring}
                className="flex flex-col gap-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2 text-[13px] text-[#e5e2e1]/45">
                    <Lock className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                    仅自己可见
                  </div>
                  <div
                    className="inline-flex items-center gap-1 rounded-full bg-[#161616] p-1"
                    role="tablist"
                    aria-label="收藏分类"
                  >
                    {(
                      [
                        ['all', '全部', favorites.length + galleryFavorites.length],
                        ['mine', '我的创作', favorites.length],
                        ['gallery', '画廊收藏', galleryFavorites.length],
                      ] as const
                    ).map(([id, label, count]) => {
                      const active = favFilter === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          role="tab"
                          aria-selected={active}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => switchFavFilter(id)}
                          className={cn(
                            'rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors',
                            active
                              ? 'bg-[#2a2a2a] text-[#e5e2e1]'
                              : 'text-[#e5e2e1]/42 hover:text-[#e5e2e1]/7',
                          )}
                          style={
                            active
                              ? { outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }
                              : undefined
                          }
                        >
                          {label} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>

                {favLoading ? (
                  <div className="flex min-h-[240px] items-center justify-center text-[#e5e2e1]/5">
                    <Loader2 className="h-7 w-7 animate-spin" aria-hidden />
                  </div>
                ) : favorites.length === 0 && galleryFavorites.length === 0 ? (
                  <div
                    className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-[22px] bg-[#1c1b1b] px-6 py-14 md:rounded-[28px]"
                    style={{ outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }}
                  >
                    <FeaturedEmptyIcon />
                    <p className="text-[14px] text-[#e5e2e1]/45">收藏还是空的</p>
                    <p className="max-w-md text-center text-[13px] leading-relaxed text-[#e5e2e1]/32">
                      画布点星会出现在「我的创作」；公共画廊点星会出现在「画廊收藏」。
                    </p>
                  </div>
                ) : (
                  <div className="grid min-h-[240px] grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5 xl:grid-cols-4">
                    {(favFilter === 'all' || favFilter === 'gallery') &&
                      galleryFavorites.map((item) => {
                        const src = item.preview_path || item.thumbnail_path || item.image_path;
                        return (
                          <article
                            key={`g_${item.id}`}
                            className="overflow-hidden rounded-[18px] bg-[#1c1b1b] md:rounded-[20px]"
                            style={{ outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }}
                          >
                            <button
                              type="button"
                              onClick={() => setDetail(item)}
                              className="group relative block aspect-[4/3] w-full cursor-zoom-in bg-[#161616] text-left"
                              aria-label={`查看 ${item.title}`}
                            >
                              <img
                                src={item.thumbnail_path || src}
                                alt=""
                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                                loading="lazy"
                                draggable={false}
                              />
                            </button>
                            <div className="space-y-2 px-4 py-3.5">
                              <p className="truncate text-[14px] font-semibold tracking-[-0.01em] text-[#e5e2e1]">
                                {item.title || '未命名作品'}
                              </p>
                              <p className="line-clamp-3 text-[13px] leading-relaxed text-[#e5e2e1]/55">
                                {item.description?.trim() || '作者未填写描述'}
                              </p>
                              <p className="text-[12px] text-[#ffb866]/85">
                                来自 {`@${String(item.owner_name || '同事').replace(/\s+/g, '_')}`}
                              </p>
                            </div>
                          </article>
                        );
                      })}

                    {(favFilter === 'all' || favFilter === 'mine') &&
                      favorites.map((item) => {
                        const src = item.preview_path || item.thumbnail_path;
                        return (
                          <article
                            key={`m_${item.id}`}
                            className="overflow-hidden rounded-[18px] bg-[#1c1b1b] md:rounded-[20px]"
                            style={{ outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }}
                          >
                            <button
                              type="button"
                              onClick={() => setPreviewUrl(src)}
                              className="group relative block aspect-[4/3] w-full cursor-zoom-in bg-[#161616] text-left"
                              aria-label="放大查看图片"
                            >
                              <img
                                src={item.thumbnail_path || src}
                                alt=""
                                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.02]"
                                loading="lazy"
                                draggable={false}
                              />
                            </button>
                            <div className="space-y-2.5 px-4 py-3.5">
                              <CopyablePromptText text={item.prompt || ''} />
                              <div className="flex items-center justify-between gap-2">
                                <p className="font-[Manrope,sans-serif] text-[10px] font-semibold uppercase tracking-[0.12em] text-[#e5e2e1]/42">
                                  {item.model || '未知模型'}
                                </p>
                                <p className="text-[11.5px] text-[#e5e2e1]/4">来自 我的创作</p>
                              </div>
                            </div>
                          </article>
                        );
                      })}

                    {((favFilter === 'mine' && favorites.length === 0) ||
                      (favFilter === 'gallery' && galleryFavorites.length === 0)) && (
                      <div className="col-span-full flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-[18px] bg-[#1c1b1b]/55 px-6 py-10 text-center">
                        <p className="text-[14px] text-[#e5e2e1]/55">这一类还没有收藏</p>
                        <p className="text-[12.5px] text-[#e5e2e1]/35">
                          {favFilter === 'gallery'
                            ? '去公共画廊点星，作品会出现在这里。'
                            : '在画布结果里点星，会出现在「我的创作」。'}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </main>

      {previewUrl ? (
        <ReferenceImageLightbox
          url={previewUrl}
          onClose={() => setPreviewUrl(null)}
        />
      ) : null}

      <PublishWorkModal
        open={publishOpen}
        editing={editing}
        onClose={() => {
          setPublishOpen(false);
          setEditing(null);
        }}
        onSaved={(work) => {
          setWorks((prev) => [work, ...prev.filter((x) => x.id !== work.id)]);
          addNotice(editing ? '作品已更新并发布' : '已发布到公共画廊', 'success');
        }}
      />
      <GalleryWorkDetailModal
        work={detail}
        onClose={() => setDetail(null)}
        onEdit={
          detail && user && detail.user_id === user.id
            ? (work) => openPublish(work)
            : undefined
        }
      />
    </div>
  );
});
