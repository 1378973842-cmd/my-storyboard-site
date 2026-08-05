import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Plus, Search, Star } from 'lucide-react';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';
import { GALLERY_FILTER_CATEGORIES } from '../lib/galleryCategories';
import {
  fetchGalleryWorks,
  toggleGalleryFavorite,
  type GalleryWork,
} from '../lib/galleryWorksApi';
import { PublishWorkModal } from '../components/PublishWorkModal';
import { GalleryWorkDetailModal } from '../components/GalleryWorkDetailModal';

type FeedTab = 'featured' | 'following' | 'hot' | 'latest';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

const FEED_TABS: { id: FeedTab; label: string }[] = [
  { id: 'featured', label: '编辑精选' },
  { id: 'following', label: '关注' },
  { id: 'hot', label: '热门推荐' },
  { id: 'latest', label: '最新发布' },
];

function ownerHandle(name?: string): string {
  const raw = String(name || '同事').trim() || '同事';
  return `@${raw.replace(/\s+/g, '_')}`;
}

export const GalleryPage = memo(function GalleryPage({ shellActive }: { shellActive: boolean }) {
  const addNotice = useStore((s) => s.addNotice);
  const [items, setItems] = useState<GalleryWork[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [detail, setDetail] = useState<GalleryWork | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [feedTab, setFeedTab] = useState<FeedTab>('featured');
  const [category, setCategory] = useState('all');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await fetchGalleryWorks());
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!shellActive) return;
    void load();
  }, [shellActive, load]);

  const onToggleFavorite = useCallback(
    async (item: GalleryWork, e?: React.MouseEvent) => {
      e?.stopPropagation();
      e?.preventDefault();
      if (String(item.id).startsWith('legacy:')) {
        addNotice('旧分享条目暂不支持收藏', 'info');
        return;
      }
      try {
        const result = await toggleGalleryFavorite(item.id);
        setItems((prev) =>
          prev.map((x) =>
            x.id === item.id
              ? {
                  ...x,
                  ...result.item,
                  favorited: result.favorited,
                  favorite_count: result.favorite_count,
                }
              : x,
          ),
        );
        setDetail((cur) =>
          cur?.id === item.id
            ? {
                ...cur,
                ...result.item,
                favorited: result.favorited,
                favorite_count: result.favorite_count,
              }
            : cur,
        );
        addNotice(result.favorited ? '已加入个人空间「画廊收藏」' : '已取消收藏', 'success');
      } catch (err) {
        addNotice(err instanceof Error ? err.message : '收藏失败', 'error');
      }
    },
    [addNotice],
  );

  const visible = useMemo(() => {
    if (feedTab === 'following') return [];

    let list = [...items];
    if (feedTab === 'latest') {
      list.sort((a, b) => {
        const ta = Date.parse(a.published_at || a.created_at) || 0;
        const tb = Date.parse(b.published_at || b.created_at) || 0;
        return tb - ta;
      });
    } else if (feedTab === 'hot') {
      list.sort((a, b) => {
        const score = (x: GalleryWork) =>
          (Number(x.favorite_count) || 0) * 1e12 +
          (Date.parse(x.published_at || x.created_at) || 0);
        return score(b) - score(a);
      });
    }

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter((item) => {
        const hay = `${item.title} ${item.description} ${item.owner_name || ''} ${item.category}`.toLowerCase();
        return hay.includes(q);
      });
    }

    if (category !== 'all') {
      list = list.filter((item) => item.category === category);
    }

    return list;
  }, [items, feedTab, query, category]);

  if (!shellActive) return null;

  return (
    <div className="shell-slim-scrollbar fixed inset-0 z-[62] min-h-[100dvh] overflow-y-auto overscroll-y-auto bg-[#0e0e0e] text-[#e5e2e1]">
      <main className="mx-auto w-full max-w-[1520px] px-5 pb-20 pt-[5.75rem] md:px-8 md:pt-24 lg:px-10">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="flex flex-col gap-5 md:gap-6"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="flex flex-wrap items-end gap-6 md:gap-8" role="tablist" aria-label="画廊信息流">
              {FEED_TABS.map((tab) => {
                const active = feedTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setFeedTab(tab.id)}
                    className={cn(
                      'relative pb-2.5 text-[15px] font-medium tracking-[-0.01em] transition-colors',
                      active ? 'text-[#e5e2e1]' : 'text-[#e5e2e1]/42 hover:text-[#e5e2e1]/72',
                    )}
                  >
                    {tab.label}
                    {active ? (
                      <motion.span
                        layoutId="gallery-feed-underline"
                        className="absolute inset-x-0 bottom-0 h-[2px] rounded-full bg-[#e5e2e1]"
                        transition={spring}
                      />
                    ) : null}
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <label className="relative min-w-[200px] flex-1 sm:max-w-[260px] sm:flex-none">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#e5e2e1]/40"
                  strokeWidth={1.75}
                  aria-hidden
                />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索作品、作者或分类"
                  className="h-10 w-full rounded-full bg-[#1c1b1b] pl-10 pr-4 text-[13.5px] text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 outline-none transition-[background] focus:bg-[#222221]"
                  style={{ outline: '0.5px solid rgba(255,255,255,0.08)', outlineOffset: '-0.5px' }}
                />
              </label>
              <button
                type="button"
                onClick={() => setPublishOpen(true)}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#e5e2e1] px-4 text-[13.5px] font-medium text-[#141414] transition-[transform,background] hover:bg-white active:scale-[0.98]"
              >
                <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
                发布作品
              </button>
            </div>
          </div>

          <div
            className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            role="tablist"
            aria-label="作品分类"
          >
            {GALLERY_FILTER_CATEGORIES.map((cat) => {
              const active = category === cat.id;
              return (
                <button
                  key={cat.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setCategory(cat.id)}
                  className={cn(
                    'shrink-0 rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors',
                    active
                      ? 'bg-[#2a2a2a] text-[#e5e2e1] outline outline-[0.5px] outline-offset-[-0.5px] outline-white/22'
                      : 'text-[#e5e2e1]/48 hover:text-[#e5e2e1]/8',
                  )}
                >
                  {cat.label}
                </button>
              );
            })}
          </div>

          {error ? (
            <p className="text-sm text-red-400/95" role="alert">
              {error}
            </p>
          ) : null}

          {loading ? (
            <div className="flex min-h-[280px] items-center justify-center text-[#e5e2e1]/55">
              <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
            </div>
          ) : feedTab === 'following' ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-[22px] bg-[#1c1b1b]/55 px-6 py-16 text-center">
              <p className="text-[15px] font-medium text-[#e5e2e1]/75">关注功能即将开放</p>
              <p className="max-w-sm text-[13px] leading-relaxed text-[#e5e2e1]/40">
                之后可以在这里看你关注的作者新作。
              </p>
            </div>
          ) : visible.length === 0 ? (
            <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 rounded-[22px] bg-[#1c1b1b]/55 px-6 py-16 text-center">
              <p className="text-[15px] font-medium text-[#e5e2e1]/75">
                {items.length === 0 ? '画廊还是空的' : '没有符合筛选的作品'}
              </p>
              <p className="max-w-md text-[13px] leading-relaxed text-[#e5e2e1]/40">
                {items.length === 0
                  ? '点击右上角「发布作品」投稿到公共画廊。'
                  : '试试换个分类，或清空搜索关键词。'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 md:grid-cols-3 md:gap-4 lg:grid-cols-4 xl:grid-cols-5">
              {visible.map((item) => {
                const src = item.thumbnail_path || item.preview_path || item.image_path;
                const starred = Boolean(item.favorited);
                return (
                  <motion.article
                    key={item.id}
                    initial={{ opacity: 0, y: 14 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={spring}
                    className="group relative overflow-hidden rounded-[18px] bg-[#161616] md:rounded-[20px]"
                  >
                    <button
                      type="button"
                      className="relative block aspect-[4/3] w-full cursor-zoom-in overflow-hidden text-left"
                      onClick={() => setDetail(item)}
                      aria-label={`查看 ${item.title}`}
                    >
                      <img
                        src={src}
                        alt=""
                        className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                        loading="lazy"
                        draggable={false}
                      />
                    </button>
                    {/*
                      毛玻璃挂在卡片层（勿塞进带 overflow 的 button）：
                      backdrop-filter + 双重裁切会在右/底露出发丝缝。
                      左右底各外扩 1px，由卡片 overflow 裁齐圆角。
                    */}
                    <div
                      className="pointer-events-none absolute z-[1] bg-black/50 px-3.5 pt-3 backdrop-blur-[28px]"
                      style={{
                        left: -1,
                        right: -1,
                        bottom: -1,
                        paddingBottom: 'calc(0.875rem + 1px)',
                        WebkitBackdropFilter: 'blur(28px)',
                      }}
                      aria-hidden
                    >
                      <span className="block truncate text-[11.5px] text-white/70">
                        {ownerHandle(item.owner_name)}
                      </span>
                      <span className="mt-0.5 block truncate pr-14 text-[14px] font-semibold tracking-[-0.01em] text-[#f2efee]">
                        {item.title || '未命名作品'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => void onToggleFavorite(item, e)}
                      className={cn(
                        'absolute bottom-3 right-3 z-[2] inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] tabular-nums backdrop-blur-[20px] transition-colors',
                        starred
                          ? 'bg-[#ffb866]/22 text-[#ffb866]'
                          : 'bg-white/10 text-white/88 hover:bg-white/16',
                      )}
                      style={{ outline: '0.5px solid rgba(255,255,255,0.18)', outlineOffset: '-0.5px' }}
                      aria-label={starred ? '取消收藏' : '收藏作品'}
                    >
                      <Star
                        className="h-3.5 w-3.5"
                        strokeWidth={1.75}
                        fill={starred ? 'currentColor' : 'none'}
                      />
                      {item.favorite_count ?? 0}
                    </button>
                  </motion.article>
                );
              })}
            </div>
          )}
        </motion.div>
      </main>

      <PublishWorkModal
        open={publishOpen}
        onClose={() => setPublishOpen(false)}
        onSaved={(work) => {
          setItems((prev) => [work, ...prev.filter((x) => x.id !== work.id)]);
          addNotice('已发布到公共画廊', 'success');
        }}
      />
      <GalleryWorkDetailModal
        work={detail}
        onClose={() => setDetail(null)}
        onToggleFavorite={(work) => void onToggleFavorite(work)}
      />
    </div>
  );
});
