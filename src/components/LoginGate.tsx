import React, { useLayoutEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Lock, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';

/** 与后端 Cookie 门禁并行：本机 UI 放行标记（勿写入 main.tsx 的 LEGACY 清理列表） */
export const GATE_LS_KEY = 'storyboard_gate_ok_v1';

function isStoredAuthorized(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = localStorage.getItem(GATE_LS_KEY);
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

/**
 * 专业门禁：琥珀 + 毛玻璃 + spring 动效；暗号由服务端 .env ACCESS_CODE 校验（默认 liu888）。
 */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState(false);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useLayoutEffect(() => {
    if (isStoredAuthorized()) setAuthorized(true);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setError('请输入访问暗号');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: trimmed }),
      });
      let data: { error?: string } = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '校验失败');
      }
      try {
        localStorage.setItem(GATE_LS_KEY, '1');
      } catch {
        /* 隐私模式：仅本会话放行 */
      }
      setAuthorized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '校验失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (authorized) {
    return <>{children}</>;
  }

  return (
    <div
      className="fixed inset-0 z-[2147483647] flex min-h-[100dvh] flex-col items-center justify-center bg-[#0e0e0e] px-6 py-12 text-[#e5e2e1]"
      data-login-gate
      role="dialog"
      aria-modal="true"
      aria-labelledby="login-gate-title"
      style={{ opacity: 1, visibility: 'visible' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_28%_18%,rgba(255,184,102,0.14),transparent_52%),radial-gradient(ellipse_at_82%_88%,rgba(141,205,255,0.08),transparent_48%)]"
      />
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className={cn(
          'relative w-full max-w-md rounded-[2rem] bg-[#131313]/60 p-10',
          'outline outline-[0.5px] outline-[#45464d]/20',
          'shadow-[0_48px_100px_-36px_rgba(0,0,0,0.55)] backdrop-blur-[32px]'
        )}
      >
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 320, damping: 28, delay: 0.05 }}
            className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#1c1b1b]/90 shadow-[0_24px_56px_-20px_rgba(0,0,0,0.5)]"
          >
            <Lock className="h-7 w-7 text-[#ffb866]" strokeWidth={1.75} aria-hidden />
          </motion.div>
          <h1
            id="login-gate-title"
            className="font-serif text-2xl tracking-[-0.02em] text-[#e5e2e1]"
            style={{ fontFamily: '"Noto Serif", ui-serif, Georgia, serif' }}
          >
            访问暗号
          </h1>
          <p className="max-w-[300px] text-sm leading-relaxed text-[#e5e2e1]/68">
            请输入管理员提供的访问暗号。验证通过后可使用工作台与生图等功能。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <label className="sr-only" htmlFor="access-code">
            访问暗号
          </label>
          <input
            id="access-code"
            type="password"
            name="access-code"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="输入暗号"
            className="w-full rounded-2xl bg-[#1c1b1b]/85 px-5 py-3.5 text-[15px] text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(255,184,102,0.2)]"
          />
          {error ? (
            <p className="text-center text-sm text-red-400/95" role="alert">
              {error}
            </p>
          ) : null}

          <motion.button
            type="submit"
            disabled={submitting}
            whileHover={{ scale: submitting ? 1 : 1.02 }}
            whileTap={{ scale: submitting ? 1 : 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 28 }}
            className={cn(
              'flex w-full items-center justify-center gap-2 rounded-full bg-gradient-to-br from-[#ffb866] to-[#b77100] py-3.5 text-[15px] font-medium text-[#1a1208]',
              'shadow-[0_20px_48px_-14px_rgba(255,184,102,0.38)] disabled:opacity-60'
            )}
          >
            {submitting ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : (
              <>
                进入工作台
                <ArrowRight className="h-4 w-4" aria-hidden />
              </>
            )}
          </motion.button>
        </form>
      </motion.div>
    </div>
  );
}
