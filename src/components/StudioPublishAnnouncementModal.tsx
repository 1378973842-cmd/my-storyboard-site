import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Megaphone, X } from 'lucide-react';
import {
  createAnnouncement,
  updateAnnouncement,
  type StudioAnnouncement,
} from '../lib/studioAnnouncementsApi';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type Props = {
  open: boolean;
  onClose: () => void;
  onPublished?: () => void;
  /** 传入则进入编辑模式 */
  editing?: StudioAnnouncement | null;
};

export function StudioPublishAnnouncementModal({
  open,
  onClose,
  onPublished,
  editing = null,
}: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const isEdit = Boolean(editing?.id);

  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title || '');
    setBody(editing?.body || '');
    setError('');
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const onPost = useCallback(async () => {
    const t = title.trim();
    const b = body.trim();
    if (!t || !b || posting) return;
    setPosting(true);
    setError('');
    try {
      if (isEdit && editing?.id) await updateAnnouncement(editing.id, t, b);
      else await createAnnouncement(t, b);
      onPublished?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : isEdit ? '更新失败' : '发布失败');
    } finally {
      setPosting(false);
    }
  }, [body, editing?.id, isEdit, onClose, onPublished, posting, title]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[230] flex items-center justify-center p-3 sm:p-5">
          <motion.button
            type="button"
            aria-label="关闭"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="publish-announcement-title"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10 }}
            transition={spring}
            className="relative z-10 flex max-h-[min(860px,92dvh)] w-full max-w-[720px] flex-col rounded-[24px] bg-[#1a1919] p-6 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.75)] md:p-8"
            style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3.5 top-3.5 flex h-10 w-10 items-center justify-center rounded-full text-[#e5e2e1]/55 hover:bg-white/5 hover:text-[#e5e2e1]"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex shrink-0 items-center gap-2.5 pr-10">
              <Megaphone className="h-5 w-5 text-[#ffb866]" strokeWidth={1.75} />
              <h2
                id="publish-announcement-title"
                className="text-[20px] font-semibold tracking-[-0.02em] text-[#e5e2e1]"
              >
                {isEdit ? '编辑公告' : '发布公告'}
              </h2>
            </div>
            <p className="mt-2 shrink-0 text-[13px] text-[#e5e2e1]/45">
              {isEdit ? '修改后成员打开通知即可看到最新内容' : '将出现在所有成员的「官方通知」里'}
            </p>

            <div className="mt-6 flex min-h-0 flex-1 flex-col gap-3.5">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 120))}
                placeholder="公告标题"
                className="h-12 w-full shrink-0 rounded-xl bg-[#121212] px-4 text-[15px] text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 outline-none"
                style={{ outline: '0.5px solid rgba(255,255,255,0.08)', outlineOffset: '-0.5px' }}
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, 4000))}
                placeholder="公告内容…"
                rows={14}
                className="shell-slim-scrollbar min-h-[280px] w-full flex-1 resize-none rounded-xl bg-[#121212] px-4 py-3.5 text-[15px] leading-relaxed text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 outline-none md:min-h-[340px]"
                style={{ outline: '0.5px solid rgba(255,255,255,0.08)', outlineOffset: '-0.5px' }}
              />
              {error ? (
                <p className="shrink-0 text-[13px] text-red-400/95" role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="mt-6 flex shrink-0 justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="h-11 rounded-full bg-[#2a2a2a] px-6 text-[14px] font-medium text-[#e5e2e1]/85 hover:bg-[#333]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={posting || !title.trim() || !body.trim()}
                onClick={() => void onPost()}
                className="h-11 rounded-full bg-[#e5e2e1] px-6 text-[14px] font-medium text-[#141414] disabled:opacity-45 hover:bg-white"
              >
                {posting ? (isEdit ? '保存中…' : '发布中…') : isEdit ? '保存修改' : '发布公告'}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
