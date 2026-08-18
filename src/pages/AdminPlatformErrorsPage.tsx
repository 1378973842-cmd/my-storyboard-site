import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { AlertTriangle, Copy, Loader2, Search } from 'lucide-react';
import { fetchAdminPlatformErrors, type PlatformErrorItem } from '../lib/platformErrorsApi';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

function formatWhen(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function userLabel(item: PlatformErrorItem): string {
  return item.user_display_name || item.user_email || item.user_id.slice(0, 8);
}

export const AdminPlatformErrorsPage = memo(function AdminPlatformErrorsPage({
  shellActive,
}: {
  shellActive: boolean;
}) {
  const addNotice = useStore((s) => s.addNotice);
  const [items, setItems] = useState<PlatformErrorItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(t);
  }, [query]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchAdminPlatformErrors(debouncedQuery));
    } catch (e) {
      addNotice(e instanceof Error ? e.message : '加载报错记录失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [addNotice, debouncedQuery]);

  useEffect(() => {
    if (shellActive) void load();
  }, [shellActive, load]);

  const totalLabel = useMemo(() => `${items.length} 条`, [items.length]);

  const copyError = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addNotice('已复制报错', 'success');
    } catch {
      addNotice('复制失败', 'error');
    }
  };

  if (!shellActive) return null;

  return (
    <div className="fixed inset-0 z-[62] min-h-[100dvh] overflow-y-auto overscroll-y-auto bg-[#0e0e0e] text-[#e5e2e1] custom-scrollbar">
      <main className="mx-auto max-w-4xl px-6 pb-10 pt-[5.5rem] md:px-10 md:pt-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1
                className="font-serif text-3xl tracking-[-0.02em]"
                style={{ fontFamily: '"Noto Serif", ui-serif, Georgia, serif' }}
              >
                报错日志
              </h1>
              <p className="mt-2 text-sm text-[#e5e2e1]/45">全站生成失败记录，仅管理员可见</p>
            </div>
            <span className="rounded-full bg-[#1c1b1b] px-3 py-1 text-xs font-semibold text-[#e5e2e1]/55">
              {totalLabel}
            </span>
          </div>

          <label className="mt-8 flex items-center gap-2 rounded-2xl bg-[#131313] px-4 py-3">
            <Search className="h-4 w-4 shrink-0 text-[#e5e2e1]/35" aria-hidden />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索报错、用户、画布、模型…"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#e5e2e1] placeholder:text-[#e5e2e1]/30 focus:outline-none"
            />
          </label>

          <div className="mt-6 space-y-3">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-[#e5e2e1]/45">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                加载中…
              </div>
            ) : items.length ? (
              items.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl bg-[#131313] px-4 py-4 md:px-5"
                  style={{ outline: '0.5px solid rgba(69,70,77,.22)', outlineOffset: '-0.5px' }}
                >
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#e5e2e1]/45">
                    <span className="inline-flex items-center gap-1 text-[#fca5a5]">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
                      失败
                    </span>
                    <span>{formatWhen(item.created_at)}</span>
                    <span>{userLabel(item)}</span>
                    {item.platform ? <span>{item.platform}</span> : null}
                    {item.model ? <span>{item.model}</span> : null}
                  </div>
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#e5e2e1]/88">
                    {item.error_message}
                  </p>
                  {item.prompt ? (
                    <p className="mt-2 line-clamp-2 text-xs text-[#e5e2e1]/42" title={item.prompt}>
                      提示词：{item.prompt}
                    </p>
                  ) : null}
                  <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-[#e5e2e1]/40">
                    {item.canvas_id ? <span>画布 {item.canvas_id.slice(0, 8)}…</span> : null}
                    {item.run_ms ? <span>用时 {Math.round(item.run_ms / 1000)}s</span> : null}
                    <button
                      type="button"
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-1',
                        'text-[#e5e2e1]/55 transition-colors hover:bg-white/[0.04] hover:text-[#e5e2e1]',
                      )}
                      onClick={() => void copyError(item.error_message)}
                    >
                      <Copy className="h-3 w-3" aria-hidden />
                      复制报错
                    </button>
                  </div>
                </article>
              ))
            ) : (
              <div className="rounded-2xl bg-[#131313] px-5 py-16 text-center text-sm text-[#e5e2e1]/42">
                暂无报错记录
              </div>
            )}
          </div>
        </motion.div>
      </main>
    </div>
  );
});
