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
    setMenuPos({ top: rect.bottom + 10, right: Math.max(12, window.innerWidth - rect.right) });
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

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        className={cn(
          'relative inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#242424] text-[#e5e2e1]/75 transition-colors',
          'outline outline-0.5 outline-white/10',
          open ? 'bg-[#2c2c2c] text-[#e5e2e1] outline-[#ffb866]/35' : 'hover:bg-[#2c2c2c] hover:text-[#e5e2e1]',
        )}
        title="消息"
        aria-label={unreadCount > 0 ? `消息，${unreadCount} 条未读` : '消息'}
        onClick={(e) => {
          e.stopPropagation();
          if (!open) syncMenuPos();
          setOpen((v) => !v);
          setComposeOpen(false);
        }}
      >
        <Bell className="h-4 w-4" strokeWidth={1.7} aria-hidden />
        {unreadCount > 0 ? (
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-[#ff6b6b]" />
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
                  exit={{ opacity: 0, y: 6, scale: 0.98 }}
                  transition={spring}
                  className="fixed z-[200] w-[min(300px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-[#1a1a1a] shadow-[0_20px_56px_-16px_rgba(0,0,0,.7)]"
                  style={{
                    top: menuPos.top,
                    right: menuPos.right,
                    outline: '0.5px solid rgba(69,70,77,.28)',
                    outlineOffset: '-0.5px',
                  }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between gap-3 px-4 pt-4 pb-3">
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-[#e5e2e1]">消息</p>
                      <p className="mt-0.5 text-[12px] text-[#e5e2e1]/40">
                        {unreadCount > 0 ? `${unreadCount} 条未读` : '暂无未读'}
                      </p>
                    </div>
                    {isAdmin ? (
                      <button
                        type="button"
                        onClick={() => setComposeOpen((v) => !v)}
                        className="inline-flex items-center gap-1 text-[13px] font-medium text-[#ffb866] transition-opacity hover:opacity-80"
                      >
                        <Plus className="h-4 w-4" strokeWidth={1.75} />
                        {composeOpen ? '收起' : '发布'}
                      </button>
                    ) : null}
                  </div>

                  {composeOpen && isAdmin ? (
                    <div className="mx-3 mb-2 space-y-2.5 rounded-xl bg-[#242424] px-3.5 py-3">
                      <input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="标题"
                        className="w-full rounded-lg bg-[#1a1a1a] px-3 py-2 text-[12px] text-[#e5e2e1] placeholder:text-[#e5e2e1]/30 focus:outline-none"
                        style={{ outline: '0.5px solid rgba(69,70,77,.35)', outlineOffset: '-0.5px' }}
                      />
                      <textarea
                        value={body}
                        onChange={(e) => setBody(e.target.value)}
                        placeholder="公告内容…"
                        rows={3}
                        className="w-full resize-none rounded-lg bg-[#1a1a1a] px-3 py-2 text-[12px] leading-relaxed text-[#e5e2e1] placeholder:text-[#e5e2e1]/30 focus:outline-none"
                        style={{ outline: '0.5px solid rgba(69,70,77,.35)', outlineOffset: '-0.5px' }}
                      />
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setComposeOpen(false)}
                          className="rounded-lg px-2.5 py-1.5 text-[11px] text-[#e5e2e1]/45 hover:text-[#e5e2e1]"
                        >
                          取消
                        </button>
                        <button
                          type="button"
                          disabled={posting || !title.trim() || !body.trim()}
                          onClick={() => void onPost()}
                          className="rounded-lg bg-[#ffb866] px-3 py-1.5 text-[11px] font-semibold text-[#1a1410] disabled:opacity-45"
                        >
                          {posting ? '发布中…' : '发布'}
                        </button>
                      </div>
                    </div>
                  ) : null}

                  <div className="mx-3 h-px bg-white/[0.07]" />

                  <div className="max-h-[min(320px,46vh)] overflow-y-auto py-1.5">
                    {loading && !items.length ? (
                      <p className="px-4 py-8 text-center text-[12px] text-[#e5e2e1]/40">加载中…</p>
                    ) : null}
                    {error ? <p className="px-4 py-4 text-[12px] text-[#fca5a5]">{error}</p> : null}
                    {!loading && !items.length && !error ? (
                      <p className="px-4 py-10 text-center text-[12px] text-[#e5e2e1]/40">暂无消息</p>
                    ) : null}
                    {items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => void onOpenItem(item)}
                        className="flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
                      >
                        <span
                          className={cn(
                            'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                            item.read ? 'bg-transparent' : 'bg-[#ffb866]',
                          )}
                          aria-hidden
                        />
                        <span className="min-w-0 flex-1">
                          <span
                            className={cn(
                              'block text-[13px] font-medium leading-snug',
                              item.read ? 'text-[#e5e2e1]/45' : 'text-[#e5e2e1]',
                            )}
                          >
                            {item.title}
                          </span>
                          <span
                            className={cn(
                              'mt-1 block line-clamp-2 text-[12px] leading-relaxed',
                              item.read ? 'text-[#e5e2e1]/28' : 'text-[#e5e2e1]/55',
                            )}
                          >
                            {item.body}
                          </span>
                          <span className="mt-1.5 block text-[11px] text-[#e5e2e1]/28">
                            {item.author_name} · {formatAnnouncementTime(item.created_at)}
                          </span>
                        </span>
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
