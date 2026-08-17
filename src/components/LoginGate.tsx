import React, { useEffect, useLayoutEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Lock, Loader2, ArrowRight } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  AUTH_LS_KEY,
  AUTH_REQUIRED_EVENT,
  clearCanvasLastSessionId,
  fetchAuthStatus,
  isStoredAuthenticated,
} from '../lib/authSession';
import { useAuthStore } from '../stores/authStore';
import { PresenceHeartbeat } from './PresenceHeartbeat';

export { AUTH_LS_KEY as GATE_LS_KEY };

/**
 * 邮箱登录门禁；Session Cookie 由服务端 userAuth 签发。
 */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const setUser = useAuthStore((s) => s.setUser);
  const setChecked = useAuthStore((s) => s.setChecked);
  const [authorized, setAuthorized] = useState(false);
  const [sessionUnlocked, setSessionUnlocked] = useState(() => isStoredAuthenticated());
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useLayoutEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchAuthStatus();
        if (cancelled) return;
        if (data.ok && data.user) {
          try {
            localStorage.setItem(AUTH_LS_KEY, '1');
          } catch {
            /* ignore */
          }
          setUser(data.user);
          setSessionUnlocked(true);
          setAuthorized(true);
        } else {
          try {
            localStorage.removeItem(AUTH_LS_KEY);
          } catch {
            /* ignore */
          }
          setUser(null);
          setSessionUnlocked(false);
          setAuthorized(false);
        }
      } catch {
        if (cancelled) return;
        if (isStoredAuthenticated()) {
          try {
            localStorage.removeItem(AUTH_LS_KEY);
          } catch {
            /* ignore */
          }
        }
        setUser(null);
        setSessionUnlocked(false);
        setAuthorized(false);
      } finally {
        if (!cancelled) {
          setChecking(false);
          setChecked(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [setUser, setChecked]);

  useEffect(() => {
    const onRequired = () => {
      try {
        localStorage.removeItem(AUTH_LS_KEY);
      } catch {
        /* ignore */
      }
      setUser(null);
      setAuthorized(false);
    };
    window.addEventListener(AUTH_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onRequired);
  }, [setUser]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError('请输入邮箱与密码');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email: trimmedEmail, password }),
      });
      let data: { error?: string; user?: import('../stores/authStore').AuthUser } = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }
      if (!res.ok) {
        throw new Error(typeof data?.error === 'string' ? data.error : '登录失败');
      }
      try {
        localStorage.setItem(AUTH_LS_KEY, '1');
      } catch {
        /* ignore */
      }
      if (data.user) setUser(data.user);
      clearCanvasLastSessionId();
      setSessionUnlocked(true);
      setAuthorized(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
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
        aria-label="正在校验登录状态"
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
          'shadow-[0_48px_100px_-36px_rgba(0,0,0,0.55)] backdrop-blur-[32px]',
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
            登录 DreamGrid
          </h1>
          <p className="max-w-[300px] text-sm leading-relaxed text-[#e5e2e1]/68">
            使用管理员分配的邮箱与密码登录，即可使用分镜、画布与生图等功能。
          </p>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className="sr-only" htmlFor="login-email">
            邮箱
          </label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="邮箱"
            className="w-full rounded-2xl bg-[#1c1b1b]/85 px-5 py-3.5 text-[15px] text-[#e5e2e1] placeholder:text-[#e5e2e1]/35 outline-none transition-shadow focus:shadow-[0_0_0_3px_rgba(255,184,102,0.2)]"
          />
          <label className="sr-only" htmlFor="login-password">
            密码
          </label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="密码"
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
              'shadow-[0_20px_48px_-14px_rgba(255,184,102,0.38)] disabled:opacity-60',
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
      <PresenceHeartbeat />
      {children}
      {gateOverlay}
    </>
  );
}
