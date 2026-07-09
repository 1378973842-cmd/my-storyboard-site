import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Bell, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import {
  createAnnouncement,
  fetchAnnouncements,
  formatAnnouncementTime,
  markAnnouncementRead,
  type StudioAnnouncement,
} from '../lib/studioAnnouncementsApi';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type StudioAnnouncementsBellProps = {
  isAdmin: boolean;
  /** @deprecated 触发器已统一为封面玻璃胶囊，保留以免调用方报错 */
  heroTone?: boolean;
};

export const StudioAnnouncementsBell: React.FC<StudioAnnouncementsBellProps> = ({
  isAdmin,
}) => {
  const [open, setOpen] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [menuPos, setMenuPos] = useState({ top: 0, right: 16 });
  const [items, setItems] = useState<StudioAnnouncement[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const syncMenuPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setMenuPos({ top: rect.bottom + 8, right: Math.max(16, window.innerWidth - rect.right) });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await fetchAnnouncements();
      setItems(data.announcements);
      setUnreadCount(data.unreadCount);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 60_000);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    syncMenuPos();
    const onLayout = () => syncMenuPos();
    window.addEventListener('resize', onLayout);
    window.addEventListener('scroll', onLayout, true);
    return () => {
      window.removeEventListener('resize', onLayout);
      window.removeEventListener('scroll', onLayout, true);
    };
  }, [open, syncMenuPos]);

  useEffect(() => {
    let attached = false;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setOpen(false);
      setComposeOpen(false);
    };
    const id = window.setTimeout(() => {
      attached = true;
      document.addEventListener('click', onDoc);
    }, 0);
    return () => {
      window.clearTimeout(id);
      if (attached) document.removeEventListener('click', onDoc);
    };
  }, []);

  const onOpenItem = useCallback(async (item: StudioAnnouncement) => {
    if (item.read) return;
    try {
      await markAnnouncementRead(item.id);
      setItems((prev) =>
        prev.map((row) => (row.id === item.id ? { ...row, read: true } : row)),
      );
      setUnreadCount((n) => Math.max(0, n - 1));
    } catch {
      /* ignore */
    }
  }, []);

  const onPost = useCallback(async () => {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b || posting) return;
    setPosting(true);
    setError('');
    try {
      const created = await createAnnouncement(t, b);
      setItems((prev) => [created, ...prev]);
      setUnreadCount((n) => n + 1);
      setTitle('');
      setBody('');
      setComposeOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    } finally {
      setPosting(false);
    }
  }, [body, posting, title]);

  const btnClass = cn(
    'cover-nav-icon-btn cover-nav-icon-btn-muted relative inline-flex h-9 w-9 items-center justify-center rounded-full',
    open && 'cover-nav-icon-btn-active',
  );

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        className={btnClass}
        title="站内公告"
        aria-label={unreadCount > 0 ? `公告，${unreadCount} 条未读` : '公告'}
        onClick={(e) => {
          e.stopPropagation();
          if (!open) syncMenuPos();
          setOpen((v) => !v);
          setComposeOpen(false);
        }}
      >
        <Bell className="h-4 w-4" aria-hidden />
        {unreadCount > 0 ? (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#ff6b6b] shadow-[0_0_6px_rgba(255,107,107,.65)]" />
        ) : null}
      </button>

      {typeof document !== 'undefined'
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <motion.div
                  key="studio-announcements"
                  ref={menuRef}
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 8, scale: 0.98 }}
                  transition={spring}
                  className="fixed z-[200] w-[min(360px,calc(100vw-2rem))] overflow-hidden rounded-[20px] bg-[#1c1b1b]/92 backdrop-blur-[28px] shadow-[0_24px_64px_rgba(0,0,0,.45)]"
                  style={{
                    top: menuPos.top,
                    right: menuPos.right,
                    outline: '0.5px solid rgba(255,184,102,.14)',
                    outlineOffset: '-0.5px',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="font-serif text-[15px] tracking-[-0.02em] text-[#e5e2e1]">站内公告</span>
              {isAdmin ? (
                <button
                  type="button"
                  onClick={() => setComposeOpen((v) => !v)}
                  className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold text-[#ffb866] transition-colors hover:bg-[#ffb866]/10"
                >
                  <Plus className="h-3.5 w-3.5" />
                  发布公告
                </button>
              ) : null}
            </div>

            {composeOpen && isAdmin ? (
              <div className="space-y-2 border-t border-white/[0.06] px-4 py-3">
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="标题（例如：RH 工作流已更新）"
                  className="w-full rounded-xl bg-[#131313]/80 px-3 py-2 text-[12px] text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 focus:outline-none"
                  style={{ outline: '0.5px solid rgba(255,255,255,.08)', outlineOffset: '-0.5px' }}
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="写给同事看的更新说明…"
                  rows={4}
                  className="w-full resize-none rounded-xl bg-[#131313]/80 px-3 py-2 text-[12px] leading-relaxed text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 focus:outline-none"
                  style={{ outline: '0.5px solid rgba(255,255,255,.08)', outlineOffset: '-0.5px' }}
                />
                <div className="flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setComposeOpen(false)}
                    className="rounded-full px-3 py-1.5 text-[11px] font-bold text-[#e5e2e1]/55 hover:text-[#e5e2e1]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    disabled={posting || !title.trim() || !body.trim()}
                    onClick={() => void onPost()}
                    className="rounded-full bg-[#ffb866] px-3.5 py-1.5 text-[11px] font-bold text-[#1a1410] disabled:opacity-45"
                  >
                    {posting ? '发布中…' : '发布'}
                  </button>
                </div>
              </div>
            ) : null}

            <div className="max-h-[min(360px,50vh)] overflow-y-auto border-t border-white/[0.06]">
              {loading && !items.length ? (
                <p className="px-4 py-6 text-center text-[12px] text-[#e5e2e1]/45">加载中…</p>
              ) : null}
              {error ? (
                <p className="px-4 py-4 text-[12px] text-[#fca5a5]">{error}</p>
              ) : null}
              {!loading && !items.length && !error ? (
                <p className="px-4 py-8 text-center text-[12px] text-[#e5e2e1]/40">暂无公告</p>
              ) : null}
              {items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void onOpenItem(item)}
                  className={cn(
                    'w-full px-4 py-3 text-left transition-colors hover:bg-white/[0.04]',
                    !item.read && 'bg-[#ffb866]/[0.04]',
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span
                      className={cn(
                        'text-[13px] font-bold leading-snug',
                        item.read ? 'text-[#e5e2e1]/42' : 'text-[#e5e2e1]',
                      )}
                    >
                      {item.title}
                    </span>
                    {!item.read ? (
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff6b6b]" />
                    ) : null}
                  </div>
                  <p
                    className={cn(
                      'mt-1 line-clamp-3 text-[11px] leading-relaxed',
                      item.read ? 'text-[#e5e2e1]/32' : 'text-[#e5e2e1]/68',
                    )}
                  >
                    {item.body}
                  </p>
                  <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-[#e5e2e1]/30">
                    {item.author_name} · {formatAnnouncementTime(item.created_at)}
                  </p>
                </button>
              ))}
            </div>
                </motion.div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
};
