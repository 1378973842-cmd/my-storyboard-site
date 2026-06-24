import React, { useEffect, useLayoutEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Lock, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  GATE_AUTH_REQUIRED_EVENT,
  GATE_LS_KEY,
  isStoredAuthorized,
} from '../lib/gateAuth';

export { GATE_LS_KEY };

/**
 * 专业门禁：琥珀 + 毛玻璃 + spring 动效；暗号由服务端 .env ACCESS_CODE 校验（开发缺省 liu888，生产须设强暗号）。
 */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const [authorized, setAuthorized] = useState(false);
  /** 本会话曾通过暗号后保持 App 挂载，避免门禁弹层时卸载导致页面状态（如无限画布）丢失 */
  const [sessionUnlocked, setSessionUnlocked] = useState(() => isStoredAuthorized());
  const [checking, setChecking] = useState(true);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useLayoutEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/status', { credentials: 'same-origin' });
        const data = (await res.json()) as { ok?: boolean };
        if (cancelled) return;
        if (data.ok) {
          try {
            localStorage.setItem(GATE_LS_KEY, '1');
          } catch {
            /* ignore */
          }
          setSessionUnlocked(true);
          setAuthorized(true);
        } else {
          try {
            localStorage.removeItem(GATE_LS_KEY);
          } catch {
            /* ignore */
          }
          setAuthorized(false);
        }
      } catch {
        if (cancelled) return;
        // 无法确认服务端 Cookie 时，不信任仅 localStorage 的放行（避免「能进站但不能生图」）
        if (isStoredAuthorized()) {
          try {
            localStorage.removeItem(GATE_LS_KEY);
          } catch {
            /* ignore */
          }
        }
        setAuthorized(false);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const onRequired = () => {
      try {
        localStorage.removeItem(GATE_LS_KEY);
      } catch {
        /* ignore */
      }
      setAuthorized(false);
    };
    window.addEventListener(GATE_AUTH_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(GATE_AUTH_REQUIRED_EVENT, onRequired);
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
      setSessionUnlocked(true);
      setAuthorized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '校验失败');
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
        className="fixed inset-0 z-[2147483647] flex min-h-[100dvh] items-center justify-center bg-[#0e0e0e] text-sm text-[#e5e2e1]/80"
        aria-busy="true"
        aria-label="正在校验访问权限"
      >
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
          className="h-9 w-9 rounded-full border-2 border-[#ffb866]/30 border-t-[#ffb866]"
          aria-hidden
        />
      </motion.div>
    );
  }

  const gateOverlay = !authorized ? (
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
  ) : null;

  if (!sessionUnlocked) {
    return gateOverlay;
  }

  return (
    <>
      {children}
      {gateOverlay}
    </>
  );
}
