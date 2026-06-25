import React, { memo, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { CopyablePromptText } from '../components/CopyablePromptText';

type GalleryItem = {
  id: string;
  thumbnail_path: string;
  prompt: string;
  model: string;
  params: Record<string, unknown>;
  owner_name?: string;
  shared_at: string | null;
  created_at: string;
};

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

export const GalleryPage = memo(function GalleryPage({ shellActive }: { shellActive: boolean }) {
  const [items, setItems] = useState<GalleryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shellActive) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/gallery', { credentials: 'same-origin' });
        const data = (await res.json()) as { items?: GalleryItem[]; error?: string };
        if (!res.ok) throw new Error(data.error || '加载失败');
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [shellActive]);

  if (!shellActive) return null;

  return (
    <div className="fixed inset-0 z-[62] min-h-[100dvh] overflow-y-auto overscroll-y-auto bg-[#0e0e0e] text-[#e5e2e1] custom-scrollbar">
      <main className="mx-auto max-w-6xl px-6 pb-10 pt-[5.5rem] md:px-10 md:pt-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <h1
            className="font-serif text-3xl tracking-[-0.02em] text-[#e5e2e1]"
            style={{ fontFamily: '"Noto Serif", ui-serif, Georgia, serif' }}
          >
            公共画廊
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-[#e5e2e1]/65">
            同事主动分享的优秀案例。可学习 Prompt 与模型参数，激发创作灵感。
          </p>
        </motion.div>

        {error ? (
          <p className="mt-6 text-sm text-red-400/95" role="alert">
            {error}
          </p>
        ) : null}

        {loading ? (
          <div className="mt-16 flex justify-center text-[#e5e2e1]/60">
            <Loader2 className="h-8 w-8 animate-spin" aria-hidden />
          </div>
        ) : items.length === 0 ? (
          <p className="mt-16 text-center text-sm text-[#e5e2e1]/50">还没有同事分享作品。</p>
        ) : (
          <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((item) => (
              <motion.article
                key={item.id}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={spring}
                className="overflow-hidden rounded-[1.5rem] bg-[#131313]/80 outline outline-[0.5px] outline-[#45464d]/20"
              >
                <div className="aspect-[4/3] bg-[#1c1b1b]">
                  <img
                    src={item.thumbnail_path}
                    alt=""
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                </div>
                <div className="space-y-3 p-5">
                  <p className="text-xs uppercase tracking-[0.14em] text-[#ffb866]/75">
                    {item.owner_name || '同事'}
                  </p>
                  <CopyablePromptText text={item.prompt} lineClamp={5} />
                  <p className="text-xs uppercase tracking-[0.12em] text-[#e5e2e1]/45">
                    {item.model || '未知模型'}
                  </p>
                  {Object.keys(item.params || {}).length > 0 ? (
                    <pre className="max-h-28 overflow-auto rounded-xl bg-[#1c1b1b]/85 p-3 text-[11px] leading-relaxed text-[#e5e2e1]/55">
                      {JSON.stringify(item.params, null, 2)}
                    </pre>
                  ) : null}
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </main>
    </div>
  );
});
