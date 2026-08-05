import React, { memo, useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { StudioPublishAnnouncementModal } from '../components/StudioPublishAnnouncementModal';
import {
  deleteAnnouncement,
  fetchAdminAnnouncements,
  formatAnnouncementTime,
  type AdminAnnouncement,
} from '../lib/studioAnnouncementsApi';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

export const AdminAnnouncementsPage = memo(function AdminAnnouncementsPage({
  shellActive,
}: {
  shellActive: boolean;
}) {
  const addNotice = useStore((s) => s.addNotice);
  const [items, setItems] = useState<AdminAnnouncement[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<AdminAnnouncement | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await fetchAdminAnnouncements());
    } catch (e) {
      addNotice(e instanceof Error ? e.message : '加载公告失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [addNotice]);

  useEffect(() => {
    if (shellActive) void load();
  }, [shellActive, load]);

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };

  const openEdit = (item: AdminAnnouncement) => {
    setEditing(item);
    setEditorOpen(true);
  };

  const onDelete = async (item: AdminAnnouncement) => {
    if (busyId) return;
    const ok = window.confirm(`确定删除公告「${item.title}」？成员通知中心将不再显示。`);
    if (!ok) return;
    setBusyId(item.id);
    try {
      await deleteAnnouncement(item.id);
      setItems((prev) => prev.filter((x) => x.id !== item.id));
      addNotice('公告已删除', 'success');
    } catch (e) {
      addNotice(e instanceof Error ? e.message : '删除失败', 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (!shellActive) return null;

  return (
    <div className="fixed inset-0 z-[62] min-h-[100dvh] overflow-y-auto overscroll-y-auto bg-[#0e0e0e] text-[#e5e2e1] custom-scrollbar">
      <main className="mx-auto max-w-3xl px-6 pb-10 pt-[5.5rem] md:px-10 md:pt-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1
                className="font-serif text-3xl tracking-[-0.02em]"
                style={{ fontFamily: '"Noto Serif", ui-serif, Georgia, serif' }}
              >
                公告管理
              </h1>
              <p className="mt-2 text-[13.5px] text-[#e5e2e1]/45">
                发布、编辑或删除官方通知，成员可在铃铛里查看。
              </p>
            </div>
            <button
              type="button"
              onClick={openCreate}
              className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#e5e2e1] px-4 text-[13.5px] font-medium text-[#141414] transition-colors hover:bg-white"
            >
              <Plus className="h-4 w-4" strokeWidth={2} aria-hidden />
              发布公告
            </button>
          </div>

          <div className="mt-8 space-y-2.5">
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-20 text-[13px] text-[#e5e2e1]/45">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                加载中…
              </div>
            ) : items.length === 0 ? (
              <div
                className="rounded-2xl bg-[#161616] px-5 py-14 text-center"
                style={{ outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }}
              >
                <p className="text-[14px] text-[#e5e2e1]/55">还没有公告</p>
                <p className="mt-1.5 text-[12.5px] text-[#e5e2e1]/35">点击右上角「发布公告」写第一条</p>
              </div>
            ) : (
              items.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl bg-[#161616] px-4 py-4 md:px-5"
                  style={{ outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-[15px] font-semibold tracking-[-0.01em] text-[#e5e2e1]">
                        {item.title}
                      </h2>
                      <p className="mt-1 text-[12px] text-[#e5e2e1]/4">
                        {formatAnnouncementTime(item.created_at)}
                        <span className="mx-1.5 text-[#e5e2e1]/2">·</span>
                        {item.author_name || '管理员'}
                        <span className="mx-1.5 text-[#e5e2e1]/2">·</span>
                        {Number(item.read_count) || 0} 人已读
                      </p>
                      <p className="mt-2.5 line-clamp-2 text-[13px] leading-relaxed text-[#e5e2e1]/55">
                        {item.body}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(item)}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#e5e2e1]/55 transition-colors hover:bg-white/5 hover:text-[#e5e2e1]"
                        aria-label={`编辑 ${item.title}`}
                      >
                        <Pencil className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        disabled={busyId === item.id}
                        onClick={() => void onDelete(item)}
                        className={cn(
                          'inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors',
                          'text-[#e5e2e1]/45 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-45',
                        )}
                        aria-label={`删除 ${item.title}`}
                      >
                        {busyId === item.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" strokeWidth={1.75} />
                        )}
                      </button>
                    </div>
                  </div>
                </article>
              ))
            )}
          </div>
        </motion.div>
      </main>

      <StudioPublishAnnouncementModal
        open={editorOpen}
        editing={editing}
        onClose={() => {
          setEditorOpen(false);
          setEditing(null);
        }}
        onPublished={() => {
          void load();
          addNotice(editing ? '公告已更新' : '公告已发布', 'success');
        }}
      />
    </div>
  );
});
