import React, { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle2, Info, AlertTriangle, X } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';
import { SystemNotice } from '../types';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type Props = {
  onNoticeClick?: (notice: SystemNotice) => void;
};

export const GlobalNoticeCenter: React.FC<Props> = ({ onNoticeClick }) => {
  const notices = useStore((s) => s.notices);
  const removeNotice = useStore((s) => s.removeNotice);

  useEffect(() => {
    if (notices.length === 0) return;
    const timers = notices.map((n) =>
      window.setTimeout(() => {
        removeNotice(n.id);
      }, 4200),
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [notices, removeNotice]);

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[220] flex w-[min(92vw,360px)] flex-col gap-2">
      <AnimatePresence initial={false}>
        {notices.map((n) => (
          <motion.div
            key={n.id}
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.985 }}
            transition={spring}
            className={cn(
              'pointer-events-auto rounded-2xl px-3.5 py-3 backdrop-blur-[24px] shadow-[0_24px_56px_-38px_rgba(0,0,0,0.75)]',
              'outline outline-[0.5px]',
              n.level === 'success'
                ? 'bg-emerald-500/12 outline-emerald-300/20'
                : n.level === 'error'
                  ? 'bg-red-500/14 outline-red-300/20'
                  : 'bg-surface-container-high/80 outline-white/10',
            )}
            data-theme-preserve="dark"
            role={n.action ? 'button' : 'status'}
            tabIndex={n.action ? 0 : -1}
            onClick={() => {
              if (!n.action || !onNoticeClick) return;
              onNoticeClick(n);
              removeNotice(n.id);
            }}
            onKeyDown={(e) => {
              if (!n.action || !onNoticeClick) return;
              if (e.key !== 'Enter' && e.key !== ' ') return;
              e.preventDefault();
              onNoticeClick(n);
              removeNotice(n.id);
            }}
          >
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 shrink-0">
                {n.level === 'success' ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-300" />
                ) : n.level === 'error' ? (
                  <AlertTriangle className="h-4 w-4 text-red-300" />
                ) : (
                  <Info className="h-4 w-4 text-white/80" />
                )}
              </div>
              <p className="flex-1 text-[12px] leading-relaxed text-white/92">{n.message}</p>
              <button
                type="button"
                className="shrink-0 rounded-md p-1 text-white/65 transition-colors hover:text-white cursor-pointer"
                onClick={() => removeNotice(n.id)}
                aria-label="关闭提示"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

