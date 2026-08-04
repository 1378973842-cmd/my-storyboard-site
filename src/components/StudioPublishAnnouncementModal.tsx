import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Megaphone, X } from 'lucide-react';
import { createAnnouncement } from '../lib/studioAnnouncementsApi';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type Props = {
  open: boolean;
  onClose: () => void;
  onPublished?: () => void;
};

export function StudioPublishAnnouncementModal({ open, onClose, onPublished }: Props) {
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setTitle('');
    setBody('');
    setError('');
  }, [open]);

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
      await createAnnouncement(t, b);
      onPublished?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    } finally {
      setPosting(false);
    }
  }, [body, onClose, onPublished, posting, title]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[230] flex items-center justify-center p-4">
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
            className="relative z-10 w-full max-w-[480px] rounded-[22px] bg-[#1a1919] p-5 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.75)] md:p-6"
            style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={onClose}
              className="absolute right-3 top-3 flex h-9 w-9 items-center justify-center rounded-full text-[#e5e2e1]/55 hover:bg-white/5 hover:text-[#e5e2e1]"
              aria-label="关闭"
            >
              <X className="h-4 w-4" />
            </button>
            <div className="flex items-center gap-2 pr-8">
              <Megaphone className="h-5 w-5 text-[#ffb866]" strokeWidth={1.75} />
              <h2
                id="publish-announcement-title"
                className="text-[18px] font-semibold tracking-[-0.02em] text-[#e5e2e1]"
              >
                发布公告
              </h2>
            </div>
            <p className="mt-1.5 text-[12.5px] text-[#e5e2e1]/45">将出现在所有成员的「官方通知」里</p>

            <div className="mt-5 space-y-3">
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 120))}
                placeholder="公告标题"
                className="h-11 w-full rounded-xl bg-[#121212] px-3.5 text-[14px] text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 outline-none"
                style={{ outline: '0.5px solid rgba(255,255,255,0.08)', outlineOffset: '-0.5px' }}
              />
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value.slice(0, 4000))}
                placeholder="公告内容…"
                rows={6}
                className="w-full resize-none rounded-xl bg-[#121212] px-3.5 py-3 text-[14px] leading-relaxed text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 outline-none"
                style={{ outline: '0.5px solid rgba(255,255,255,0.08)', outlineOffset: '-0.5px' }}
              />
              {error ? (
                <p className="text-[13px] text-red-400/95" role="alert">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="mt-5 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={onClose}
                className="h-10 rounded-full bg-[#2a2a2a] px-5 text-[13.5px] font-medium text-[#e5e2e1]/85 hover:bg-[#333]"
              >
                取消
              </button>
              <button
                type="button"
                disabled={posting || !title.trim() || !body.trim()}
                onClick={() => void onPost()}
                className="h-10 rounded-full bg-[#e5e2e1] px-5 text-[13.5px] font-medium text-[#141414] disabled:opacity-45 hover:bg-white"
              >
                {posting ? '发布中…' : '发布公告'}
              </button>
            </div>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
