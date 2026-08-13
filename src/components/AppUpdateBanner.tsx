import React, { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { RefreshCw, Sparkles, X } from 'lucide-react';
import { fetchAppVersionInfo } from '../lib/appVersion';

const POLL_MS = 3 * 60 * 1000;
const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

export function AppUpdateBanner() {
  const runningVersionRef = useRef<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV) return;
    let cancelled = false;

    async function check() {
      const info = await fetchAppVersionInfo();
      if (cancelled || !info) return;
      if (runningVersionRef.current === null) {
        runningVersionRef.current = info.version;
        return;
      }
      if (info.version !== runningVersionRef.current) setVisible(true);
    }

    void check();
    const timer = window.setInterval(() => void check(), POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  const show = visible;

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          key="app-update-banner"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={spring}
          className="pointer-events-none fixed inset-x-0 bottom-5 z-[240] flex justify-center px-4"
        >
          <div
            className="pointer-events-auto flex max-w-[min(92vw,520px)] items-center gap-3 rounded-2xl bg-[#1c1b1b]/88 px-4 py-3 backdrop-blur-[28px] shadow-[0_24px_64px_-28px_rgba(0,0,0,0.82)] outline outline-[0.5px] outline-white/10"
            data-theme-preserve="dark"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-[#ffb866]" aria-hidden="true" />
            <p className="flex-1 text-[13px] leading-snug text-[#e5e2e1]">
              发现新版本，刷新后即可使用最新功能
            </p>
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#ffb866] px-3.5 py-1.5 text-[12px] font-semibold text-[#2b1700] transition-[filter,transform] hover:brightness-105"
              onClick={() => window.location.reload()}
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              刷新更新
            </button>
            <button
              type="button"
              className="shrink-0 rounded-lg p-1.5 text-[#e5e2e1]/55 transition-colors hover:text-[#e5e2e1]"
              aria-label="稍后提醒"
              onClick={() => setVisible(false)}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
