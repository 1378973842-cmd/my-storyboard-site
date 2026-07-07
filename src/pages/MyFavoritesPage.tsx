import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, MapPin, Share2, StarOff } from 'lucide-react';
import { cn } from '../lib/utils';
import { readJsonResponse } from '../lib/readJsonResponse';
import { CopyablePromptText } from '../components/CopyablePromptText';
import { ReferenceImageLightbox } from '../components/ReferenceImageLightbox';
import { useShellNavigation } from '../shell/ShellNavigation';
import {
  queueCanvasFavoriteNavigation,
} from '../lib/canvasFavoriteNavigation';

type FavoriteItem = {
  id: string;
  thumbnail_path: string;
  preview_path?: string;
  prompt: string;
  model: string;
  params: Record<string, unknown>;
  canvas_id?: string;
  node_id?: string;
  shared_at: string | null;
  favorited_at: string | null;
  created_at: string;
};

type ContextMenuState = {
  item: FavoriteItem;
  x: number;
  y: number;
};

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

export const MyFavoritesPage = memo(function MyFavoritesPage({
  shellActive,
}: {
  shellActive: boolean;
}) {
  const { openInfiniteCanvas } = useShellNavigation();
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [shareError, setShareError] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/my-favorites', { credentials: 'same-origin' });
      const data = await readJsonResponse<{ items?: FavoriteItem[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || '加载失败');
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (shellActive) void loadItems();
  }, [shellActive, loadItems]);

  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setContextMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', close, true);
    };
  }, [contextMenu]);

  const toggleShare = async (item: FavoriteItem) => {
    setBusyId(item.id);
    setShareError(null);
    try {
      const path = item.shared_at
        ? `/api/my-favorites/${item.id}/unshare`
        : `/api/my-favorites/${item.id}/share`;
      const res = await fetch(path, { method: 'POST', credentials: 'same-origin' });
      const data = await readJsonResponse<{ item?: FavoriteItem; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || '操作失败');
      if (data.item) {
        setItems((prev) => prev.map((row) => (row.id === data.item!.id ? data.item! : row)));
      } else {
        await loadItems();
      }
    } catch (e) {
      setShareError(e instanceof Error ? e.message : '操作失败');
    } finally {
      setBusyId(null);
    }
  };

  const removeFavorite = async (item: FavoriteItem) => {
    setBusyId(item.id);
    setShareError(null);
    try {
      const res = await fetch(`/api/my-favorites/${item.id}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || '取消收藏失败');
      setItems((prev) => prev.filter((row) => row.id !== item.id));
    } catch (e) {
      setShareError(e instanceof Error ? e.message : '取消收藏失败');
    } finally {
      setBusyId(null);
    }
  };

  const locateOnCanvas = (item: FavoriteItem) => {
    const canvasId = String(item.canvas_id || '').trim();
    if (!canvasId) {
      setShareError('该收藏缺少画布定位信息。请在画布中重新收藏此图片后再试。');
      return;
    }
    setShareError(null);
    queueCanvasFavoriteNavigation({
      canvasId,
      nodeId: String(item.node_id || '').trim(),
      imageUrl: item.thumbnail_path,
    });
    setContextMenu(null);
    openInfiniteCanvas();
  };

  const openImageContextMenu = (event: React.MouseEvent, item: FavoriteItem) => {
    event.preventDefault();
    event.stopPropagation();
    setContextMenu({ item, x: event.clientX, y: event.clientY });
  };

  if (!shellActive) return null;

  return (
    <div className="fixed inset-0 z-[62] min-h-[100dvh] overflow-y-auto overscroll-y-auto bg-[#0e0e0e] text-[#e5e2e1] custom-scrollbar">
      <main className="mx-auto max-w-6xl px-6 pb-10 pt-[5.5rem] md:px-10 md:pt-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <h1
            className="font-serif text-3xl tracking-[-0.02em] text-[#e5e2e1]"
            style={{ fontFamily: '"Noto Serif", ui-serif, Georgia, serif' }}
          >
            我的收藏
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#e5e2e1]/65">
            在画布 Output 图片右上角点星标收藏。点击图片可放大查看；右键图片可回到画布中的原始位置；满意的作品可分享到公共画廊。
          </p>
        </motion.div>

        {error ? (
          <p className="mt-6 text-sm text-red-400/95" role="alert">
            {error}
          </p>
        ) : null}

        {shareError ? (
          <p className="mt-4 text-sm text-red-400/95" role="alert">
            {shareError}
          </p>
        ) : null}

        {loading ? (
          <div className="mt-16 flex justify-center text-[#e5e2e1]/60">
            <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
          </div>
        ) : items.length === 0 ? (
          <p className="mt-16 text-center text-sm text-[#e5e2e1]/50">
            还没有收藏。在无限画布生成图片后，点右上角星标即可收藏到这里。
          </p>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -4 }}
                transition={spring}
                className="overflow-hidden rounded-[1.5rem] bg-[#131313]/80 outline outline-[0.5px] outline-[#45464d]/20 transition-shadow duration-300 hover:shadow-[0_48px_96px_-56px_rgba(0,0,0,0.6)]"
              >
                <button
                  type="button"
                  className="group relative block aspect-[4/3] w-full cursor-zoom-in bg-[#1c1b1b] text-left"
                  onClick={() => setPreviewUrl(item.preview_path || item.thumbnail_path)}
                  onContextMenu={(event) => openImageContextMenu(event, item)}
                  aria-label="放大查看图片"
                >
                  <img
                    src={item.thumbnail_path}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    loading="lazy"
                    draggable={false}
                  />
                </button>
                <div className="space-y-3 p-5">
                  <CopyablePromptText text={item.prompt} />
                  <p className="text-xs uppercase tracking-[0.12em] text-[#e5e2e1]/45">
                    {item.model || '未知模型'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleShare(item);
                      }}
                      className={cn(
                        'relative z-[1] inline-flex cursor-pointer items-center gap-2 rounded-full px-4 py-2 text-[13px] font-medium transition-colors',
                        item.shared_at
                          ? 'bg-[#1c1b1b] text-[#ffb866]/90 hover:bg-[#252525]'
                          : 'bg-gradient-to-br from-[#ffb866] to-[#b77100] text-[#1a1208] hover:brightness-105'
                      )}
                    >
                      {busyId === item.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : item.shared_at ? (
                        <Share2 className="h-4 w-4 rotate-180" />
                      ) : (
                        <Share2 className="h-4 w-4" />
                      )}
                      {item.shared_at ? '取消分享' : '分享到画廊'}
                    </button>
                    <button
                      type="button"
                      disabled={busyId === item.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        void removeFavorite(item);
                      }}
                      className="relative z-[1] inline-flex cursor-pointer items-center gap-2 rounded-full bg-[#1c1b1b] px-4 py-2 text-[13px] text-[#e5e2e1]/60 transition-colors hover:bg-[#252525] hover:text-[#e5e2e1]"
                    >
                      <StarOff className="h-4 w-4" />
                      取消收藏
                    </button>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </main>

      {contextMenu ? (
        <div
          ref={menuRef}
          className="fixed z-[80] min-w-[240px] overflow-hidden rounded-2xl bg-[#1c1b1b]/95 p-1.5 shadow-[0_24px_64px_rgba(0,0,0,0.45)] backdrop-blur-xl outline outline-[0.5px] outline-[#45464d]/20"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            disabled={!String(contextMenu.item.canvas_id || '').trim()}
            onClick={() => locateOnCanvas(contextMenu.item)}
            className={cn(
              'flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-[13px] transition-colors',
              String(contextMenu.item.canvas_id || '').trim()
                ? 'text-[#e5e2e1] hover:bg-[#252525]'
                : 'cursor-not-allowed text-[#e5e2e1]/35'
            )}
          >
            <MapPin className="h-4 w-4 shrink-0 text-[#ffb866]" />
            回到该图片所在画布的位置
          </button>
          {!String(contextMenu.item.canvas_id || '').trim() ? (
            <p className="px-3 pb-2 text-[11px] leading-relaxed text-[#e5e2e1]/45">
              旧收藏无定位信息，请在画布中重新收藏。
            </p>
          ) : null}
        </div>
      ) : null}

      <ReferenceImageLightbox url={previewUrl} onClose={() => setPreviewUrl(null)} />
    </div>
  );
});
