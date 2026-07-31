import React, { memo } from 'react';
import { motion } from 'motion/react';
import { useShellNavigation } from '../shell/ShellNavigation';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

export const PersonalSpacePage = memo(function PersonalSpacePage({
  shellActive,
}: {
  shellActive: boolean;
}) {
  const { openCover } = useShellNavigation();

  if (!shellActive) return null;

  return (
    <div className="fixed inset-0 z-[62] min-h-[100dvh] overflow-y-auto overscroll-y-auto bg-[#0e0e0e] text-[#e5e2e1] custom-scrollbar">
      <main className="mx-auto flex min-h-[100dvh] max-w-3xl flex-col justify-center px-6 pb-16 pt-[5.5rem] md:px-10 md:pt-24">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={spring}
          className="rounded-[1.75rem] bg-[#131313]/85 px-8 py-12 text-center shadow-[0_40px_80px_rgba(0,0,0,0.35)] backdrop-blur-[28px]"
          style={{ outline: '0.5px solid rgba(69,70,77,0.2)', outlineOffset: '-0.5px' }}
        >
          <span className="font-label text-[10px] font-semibold uppercase tracking-[0.28em] text-primary/80">
            Personal
          </span>
          <h1 className="mt-3 font-headline text-3xl tracking-[-0.02em] text-on-surface md:text-[2.15rem]">
            个人空间
          </h1>
          <p className="mx-auto mt-4 max-w-md text-[15px] leading-relaxed text-[#e5e2e1]/55">
            即将开放。收藏、作品与个人资产会集中在这里。
          </p>
          <button
            type="button"
            onClick={openCover}
            className="cover-hero-cta-pill mt-8 inline-flex text-[14px] font-medium tracking-[-0.01em]"
          >
            返回主页
          </button>
        </motion.div>
      </main>
    </div>
  );
});
