import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Bell,
  CheckCheck,
  ChevronDown,
  Heart,
  Image as ImageIcon,
  Megaphone,
  MessageCircle,
  UserPlus,
  X,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../lib/utils';
import {
  fetchAnnouncements,
  formatAnnouncementTime,
  markAllAnnouncementsRead,
  markAnnouncementRead,
  type StudioAnnouncement,
} from '../lib/studioAnnouncementsApi';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type TabId = 'official' | 'replies' | 'model' | 'likes' | 'follows';
type ListFilter = 'all' | 'unread';

const TABS: Array<{
  id: TabId;
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  ready: boolean;
}> = [
  { id: 'official', label: '官方通知', icon: Megaphone, ready: true },
  { id: 'replies', label: '回复我的', icon: MessageCircle, ready: false },
  { id: 'model', label: '模型返图', icon: ImageIcon, ready: false },
  { id: 'likes', label: '收到的赞', icon: Heart, ready: false },
  { id: 'follows', label: '关注我的', icon: UserPlus, ready: false },
];

type StudioAnnouncementsBellProps = {
  /** @deprecated 发布已迁至头像菜单；保留以免调用方报错 */
  isAdmin?: boolean;
  heroTone?: boolean;
};

export const StudioAnnouncementsBell: React.FC<StudioAnnouncementsBellProps> = () => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<TabId>('official');
  const [listFilter, setListFilter] = useState<ListFilter>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [items, setItems] = useState<StudioAnnouncement[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

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
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const visibleItems = useMemo(() => {
    if (tab !== 'official') return [] as StudioAnnouncement[];
    if (listFilter === 'unread') return items.filter((x) => !x.read);
    return items;
  }, [items, listFilter, tab]);

  const onOpenItem = useCallback(async (item: StudioAnnouncement) => {
    setExpandedId((id) => (id === item.id ? null : item.id));
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

  const onMarkAll = useCallback(async () => {
    try {
      await markAllAnnouncementsRead();
      setItems((prev) => prev.map((row) => ({ ...row, read: true })));
      setUnreadCount(0);
    } catch (err) {
      setError(err instanceof Error ? err.message : '全部已读失败');
    }
  }, []);

  const activeTab = TABS.find((t) => t.id === tab) || TABS[0];

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
          setOpen((v) => !v);
          setFilterOpen(false);
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
                <div className="fixed inset-0 z-[220] flex items-center justify-center p-3 sm:p-5">
                  <motion.button
                    type="button"
                    aria-label="关闭"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
                    onClick={() => setOpen(false)}
                  />
                  <motion.div
                    role="dialog"
                    aria-modal="true"
                    aria-label="通知"
                    initial={{ opacity: 0, y: 18, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.98 }}
                    transition={spring}
                    className="relative z-10 flex h-[min(720px,88dvh)] w-full max-w-[920px] overflow-hidden rounded-[22px] bg-[#141414] shadow-[0_40px_96px_-40px_rgba(0,0,0,0.75)]"
                    style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      className="absolute right-3 top-3 z-20 flex h-9 w-9 items-center justify-center rounded-full bg-[#2a2a2a] text-[#e5e2e1] hover:bg-[#333]"
                      style={{ outline: '0.5px solid rgba(229,226,225,0.35)', outlineOffset: '-0.5px' }}
                      aria-label="关闭"
                    >
                      <X className="h-4 w-4" strokeWidth={2} />
                    </button>

                    {/* 左侧分类 */}
                    <aside className="flex w-[220px] shrink-0 flex-col bg-[#1a1919] md:w-[240px]">
                      <div className="px-5 pb-3 pt-5">
                        <h2 className="text-[20px] font-semibold tracking-[-0.02em] text-[#e5e2e1]">
                          通知
                        </h2>
                      </div>
                      <nav className="flex flex-1 flex-col gap-1 px-3 pb-3" aria-label="通知分类">
                        {TABS.map((item) => {
                          const Icon = item.icon;
                          const active = tab === item.id;
                          const badge =
                            item.id === 'official' && unreadCount > 0 ? unreadCount : 0;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setTab(item.id)}
                              className={cn(
                                'flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13.5px] font-medium transition-colors',
                                active
                                  ? 'bg-[#ffb866]/14 text-[#ffb866]'
                                  : 'text-[#e5e2e1]/65 hover:bg-white/[0.04] hover:text-[#e5e2e1]',
                              )}
                            >
                              <Icon
                                className={cn('h-4 w-4 shrink-0', active ? 'text-[#ffb866]' : 'text-[#e5e2e1]/45')}
                                strokeWidth={1.75}
                              />
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              {badge > 0 ? (
                                <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#ff5a6a] px-1.5 text-[11px] font-semibold text-white">
                                  {badge > 99 ? '99+' : badge}
                                </span>
                              ) : null}
                            </button>
                          );
                        })}
                      </nav>
                      <div className="px-3 pb-4">
                        <button
                          type="button"
                          onClick={() => void onMarkAll()}
                          disabled={unreadCount === 0}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-[#242424] px-3 py-2.5 text-[13px] font-medium text-[#e5e2e1]/75 transition-colors hover:bg-[#2c2c2c] hover:text-[#e5e2e1] disabled:opacity-35"
                        >
                          <CheckCheck className="h-4 w-4" strokeWidth={1.75} />
                          一键已读
                        </button>
                      </div>
                    </aside>

                    {/* 右侧列表 */}
                    <section className="flex min-w-0 flex-1 flex-col bg-[#121212]">
                      <div className="flex items-center justify-end px-5 pb-2 pt-5 pr-14">
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setFilterOpen((v) => !v)}
                            className="inline-flex items-center gap-1 rounded-full bg-[#1c1b1b] px-3 py-1.5 text-[12.5px] font-medium text-[#e5e2e1]/75 hover:text-[#e5e2e1]"
                            style={{ outline: '0.5px solid rgba(255,255,255,0.08)', outlineOffset: '-0.5px' }}
                          >
                            {listFilter === 'all' ? '全部通知' : '未读通知'}
                            <ChevronDown className="h-3.5 w-3.5" />
                          </button>
                          {filterOpen ? (
                            <div
                              className="absolute right-0 top-full z-10 mt-1.5 min-w-[120px] overflow-hidden rounded-xl bg-[#1a1919] py-1 shadow-[0_16px_40px_-20px_rgba(0,0,0,0.8)]"
                              style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
                            >
                              {(
                                [
                                  ['all', '全部通知'],
                                  ['unread', '未读通知'],
                                ] as const
                              ).map(([id, label]) => (
                                <button
                                  key={id}
                                  type="button"
                                  onClick={() => {
                                    setListFilter(id);
                                    setFilterOpen(false);
                                  }}
                                  className={cn(
                                    'block w-full px-3 py-2 text-left text-[12.5px]',
                                    listFilter === id
                                      ? 'text-[#ffb866]'
                                      : 'text-[#e5e2e1]/7 hover:bg-white/[0.04]',
                                  )}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>

                      <div className="shell-slim-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-5 md:px-5">
                        {!activeTab.ready ? (
                          <div className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-center">
                            <p className="text-[14px] font-medium text-[#e5e2e1]/55">
                              {activeTab.label}即将开放
                            </p>
                            <p className="text-[12.5px] text-[#e5e2e1]/35">先看看官方通知吧</p>
                          </div>
                        ) : loading && !items.length ? (
                          <p className="px-2 py-16 text-center text-[13px] text-[#e5e2e1]/4">加载中…</p>
                        ) : error ? (
                          <p className="px-2 py-10 text-center text-[13px] text-red-400/90">{error}</p>
                        ) : visibleItems.length === 0 ? (
                          <p className="px-2 py-16 text-center text-[13px] text-[#e5e2e1]/4">
                            {listFilter === 'unread' ? '没有未读通知' : '暂无官方通知'}
                          </p>
                        ) : (
                          <ul className="space-y-2.5">
                            {visibleItems.map((item) => {
                              const expanded = expandedId === item.id;
                              return (
                                <li key={item.id}>
                                  <button
                                    type="button"
                                    onClick={() => void onOpenItem(item)}
                                    className="relative w-full rounded-2xl bg-[#1a1919] px-4 py-3.5 text-left transition-colors hover:bg-[#1f1e1e]"
                                    style={{ outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }}
                                  >
                                    {!item.read ? (
                                      <span className="absolute right-3.5 top-3.5 h-2 w-2 rounded-full bg-[#ff5a6a]" />
                                    ) : null}
                                    <span
                                      className={cn(
                                        'block pr-5 text-[14px] font-semibold leading-snug',
                                        item.read ? 'text-[#e5e2e1]/55' : 'text-[#e5e2e1]',
                                      )}
                                    >
                                      {item.title}
                                    </span>
                                    <span className="mt-1.5 block text-[12px] text-[#e5e2e1]/4">
                                      {formatAnnouncementTime(item.created_at)}
                                    </span>
                                    {expanded ? (
                                      <span className="mt-3 block whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[#e5e2e1]/72">
                                        {item.body}
                                      </span>
                                    ) : (
                                      <span className="mt-2 block line-clamp-2 text-[12.5px] leading-relaxed text-[#e5e2e1]/45">
                                        {item.body}
                                      </span>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                      </div>
                    </section>
                  </motion.div>
                </div>
              ) : null}
            </AnimatePresence>,
            document.body,
          )
        : null}
    </div>
  );
};
