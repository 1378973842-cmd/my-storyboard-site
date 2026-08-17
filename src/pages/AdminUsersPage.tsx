import React, { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { ChevronDown, KeyRound, Loader2, UserPlus } from 'lucide-react';
import { cn } from '../lib/utils';

type PresenceStatus = 'online' | 'away' | 'offline';

type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'user';
  disabled: number;
  created_at: string;
  last_login_at: string | null;
  last_seen_at: string | null;
  status: PresenceStatus;
  current_page: string | null;
};

type PresenceSummary = {
  online: number;
  away: number;
  total: number;
};

type LoginEvent = {
  id: string;
  created_at: string | null;
};

type StatusFilter = 'all' | PresenceStatus;

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };
const POLL_MS = 15_000;

function formatRelativeTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return '刚刚';
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)} 小时前`;
  if (diff < 7 * 86400_000) return `${Math.floor(diff / 86400_000)} 天前`;
  return new Date(ms).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusLabel(status: PresenceStatus): string {
  if (status === 'online') return '在线';
  if (status === 'away') return '离开';
  return '离线';
}

function statusSubline(user: AdminUser): string {
  if (user.disabled) return '已停用';
  if (user.status === 'online') {
    return user.current_page ? `${user.current_page} · 刚刚活跃` : '刚刚活跃';
  }
  if (user.status === 'away') {
    const page = user.current_page ? `${user.current_page} · ` : '';
    return `${page}${formatRelativeTime(user.last_seen_at)}`;
  }
  if (user.last_login_at) {
    return `上次登录 ${formatRelativeTime(user.last_login_at)}`;
  }
  return '尚未登录';
}

function PresenceDot({ status, disabled }: { status: PresenceStatus; disabled: boolean }) {
  if (disabled) {
    return <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-[#e5e2e1]/20" aria-hidden />;
  }
  return (
    <span
      className={cn(
        'h-2.5 w-2.5 shrink-0 rounded-full',
        status === 'online' && 'bg-[#7dffb0] shadow-[0_0_10px_rgba(125,255,176,0.45)]',
        status === 'away' && 'bg-[#ffb866] shadow-[0_0_8px_rgba(255,184,102,0.35)]',
        status === 'offline' && 'bg-[#e5e2e1]/25'
      )}
      title={statusLabel(status)}
      aria-hidden
    />
  );
}

export const AdminUsersPage = memo(function AdminUsersPage({ shellActive }: { shellActive: boolean }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [summary, setSummary] = useState<PresenceSummary>({ online: 0, away: 0, total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdHint, setCreatedHint] = useState<string | null>(null);
  const [resetUserId, setResetUserId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetHint, setResetHint] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [historyUserId, setHistoryUserId] = useState<string | null>(null);
  const [loginEvents, setLoginEvents] = useState<LoginEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const loadUsers = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    if (!silent) setError(null);
    try {
      const res = await fetch('/api/admin/users', { credentials: 'same-origin' });
      const data = (await res.json()) as {
        users?: AdminUser[];
        summary?: PresenceSummary;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error || '加载失败');
      setUsers(Array.isArray(data.users) ? data.users : []);
      if (data.summary) {
        setSummary(data.summary);
      } else {
        const list = Array.isArray(data.users) ? data.users : [];
        setSummary({
          online: list.filter((u) => !u.disabled && u.status === 'online').length,
          away: list.filter((u) => !u.disabled && u.status === 'away').length,
          total: list.length,
        });
      }
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  const loadLoginHistory = useCallback(async (userId: string) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}/login-events?limit=20`, {
        credentials: 'same-origin',
      });
      const data = (await res.json()) as { events?: LoginEvent[]; error?: string };
      if (!res.ok) throw new Error(data.error || '加载登录记录失败');
      setLoginEvents(Array.isArray(data.events) ? data.events : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载登录记录失败');
      setLoginEvents([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!shellActive) return;
    void loadUsers();
    const id = window.setInterval(() => void loadUsers(true), POLL_MS);
    return () => window.clearInterval(id);
  }, [shellActive, loadUsers]);

  const filteredUsers = useMemo(() => {
    if (statusFilter === 'all') return users;
    return users.filter((u) => !u.disabled && u.status === statusFilter);
  }, [users, statusFilter]);

  const filterPills: { id: StatusFilter; label: string }[] = [
    { id: 'all', label: '全部' },
    { id: 'online', label: '在线' },
    { id: 'away', label: '离开' },
    { id: 'offline', label: '离线' },
  ];

  const toggleHistory = (userId: string) => {
    if (historyUserId === userId) {
      setHistoryUserId(null);
      setLoginEvents([]);
      return;
    }
    setHistoryUserId(userId);
    void loadLoginHistory(userId);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setCreatedHint(null);
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          email: email.trim(),
          display_name: displayName.trim(),
          password: password.trim(),
          role: 'user',
        }),
      });
      const data = (await res.json()) as { user?: AdminUser; error?: string };
      if (!res.ok) throw new Error(data.error || '创建失败');
      setCreatedHint(`已为 ${data.user?.email || email} 创建账号，请将初始密码私下发给同事。`);
      setEmail('');
      setDisplayName('');
      setPassword('');
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleDisabled = async (user: AdminUser) => {
    setError(null);
    setResetHint(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ disabled: !user.disabled }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || '更新失败');
      await loadUsers();
    } catch (e) {
      setError(e instanceof Error ? e.message : '更新失败');
    }
  };

  const openReset = (user: AdminUser) => {
    setError(null);
    setResetHint(null);
    setResetUserId(user.id);
    setResetPassword('');
  };

  const cancelReset = () => {
    setResetUserId(null);
    setResetPassword('');
  };

  const handleResetPassword = async (user: AdminUser) => {
    const next = resetPassword.trim();
    if (next.length < 8) {
      setError('新密码至少 8 位');
      return;
    }
    setResetSubmitting(true);
    setError(null);
    setResetHint(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ password: next }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error || '重置失败');
      setResetHint(`已为 ${user.email} 重置密码，请将新密码私下发给对方。其画布与项目不受影响。`);
      cancelReset();
    } catch (e) {
      setError(e instanceof Error ? e.message : '重置失败');
    } finally {
      setResetSubmitting(false);
    }
  };

  if (!shellActive) return null;

  return (
    <div className="fixed inset-0 z-[62] min-h-[100dvh] overflow-y-auto overscroll-y-auto bg-[#0e0e0e] text-[#e5e2e1] custom-scrollbar">
      <main className="mx-auto max-w-3xl px-6 pb-10 pt-[5.5rem] md:px-10 md:pt-24">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
          <h1
            className="font-serif text-3xl tracking-[-0.02em]"
            style={{ fontFamily: '"Noto Serif", ui-serif, Georgia, serif' }}
          >
            账号管理
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-[#e5e2e1]/65">
            仅管理员可见。创建账号或将重置后的新密码私下发给同事即可；原密码无法查看，重置不会影响其画布与项目。
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...spring, delay: 0.04 }}
          className="mt-8 rounded-[1.25rem] bg-[#131313]/75 px-5 py-4 outline outline-[0.5px] outline-[#45464d]/18"
        >
          <p className="text-xs uppercase tracking-[0.14em] text-[#e5e2e1]/45">实时概览</p>
          <p className="mt-2 font-serif text-2xl tracking-[-0.02em] text-[#e5e2e1]">
            <span className="text-[#7dffb0]">{summary.online}</span>
            <span className="mx-2 text-[#e5e2e1]/35">·</span>
            <span className="text-[#ffb866]">{summary.away}</span>
            <span className="mx-2 text-[#e5e2e1]/35">·</span>
            <span className="text-[#e5e2e1]/70">{summary.total}</span>
          </p>
          <p className="mt-1 text-xs text-[#e5e2e1]/45">
            在线 · 离开 · 共 {summary.total} 位成员（每 15 秒刷新）
          </p>
        </motion.div>

        <form
          onSubmit={handleCreate}
          className="mt-10 space-y-4 rounded-[1.5rem] bg-[#131313]/80 p-6 outline outline-[0.5px] outline-[#45464d]/20"
        >
          <h2 className="text-sm font-medium text-[#ffb866]/90">创建同事账号</h2>
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.12em] text-[#e5e2e1]/45">同事邮箱</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              required
              className="w-full rounded-2xl bg-[#1c1b1b]/85 px-4 py-3 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.12em] text-[#e5e2e1]/45">显示名称</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="可选，默认使用邮箱前缀"
              className="w-full rounded-2xl bg-[#1c1b1b]/85 px-4 py-3 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
            />
          </label>
          <label className="block">
            <span className="mb-2 block text-xs uppercase tracking-[0.12em] text-[#e5e2e1]/45">初始密码</span>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 8 位"
              required
              minLength={8}
              className="w-full rounded-2xl bg-[#1c1b1b]/85 px-4 py-3 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
            />
          </label>
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[#ffb866] to-[#b77100] px-5 py-2.5 text-sm font-medium text-[#1a1208] disabled:opacity-60"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            创建账号
          </button>
          {createdHint ? <p className="text-sm text-[#8fd5ff]/85">{createdHint}</p> : null}
        </form>

        {error ? (
          <p className="mt-6 text-sm text-red-400/95" role="alert">
            {error}
          </p>
        ) : null}
        {resetHint ? <p className="mt-4 text-sm text-[#8fd5ff]/85">{resetHint}</p> : null}

        <section className="mt-10">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
            <h2 className="text-sm font-medium text-[#e5e2e1]/70">团队成员</h2>
            <div className="flex flex-wrap gap-2">
              {filterPills.map((pill) => (
                <button
                  key={pill.id}
                  type="button"
                  onClick={() => setStatusFilter(pill.id)}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs transition-colors duration-200',
                    statusFilter === pill.id
                      ? 'bg-[#ffb866]/15 text-[#ffb866]'
                      : 'bg-[#1c1b1b]/80 text-[#e5e2e1]/50 hover:text-[#e5e2e1]/75'
                  )}
                >
                  {pill.label}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div className="flex justify-center py-10 text-[#e5e2e1]/50">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
          ) : filteredUsers.length === 0 ? (
            <p className="py-10 text-center text-sm text-[#e5e2e1]/50">
              {users.length === 0 ? '还没有其他团队成员，创建第一个账号吧。' : '当前筛选下没有成员。'}
            </p>
          ) : (
            <ul className="space-y-3">
              {filteredUsers.map((user) => (
                <li
                  key={user.id}
                  className={cn(
                    'rounded-2xl bg-[#131313]/70 px-4 py-3 outline outline-[0.5px] outline-[#45464d]/15 transition-colors duration-200 hover:bg-[#171716]',
                    user.disabled && 'opacity-55'
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="relative shrink-0">
                        <span
                          className={cn(
                            'flex h-9 w-9 items-center justify-center rounded-full text-xs font-medium uppercase',
                            user.role === 'admin'
                              ? 'bg-[#ffb866]/20 text-[#ffb866]'
                              : 'bg-[#1c1b1b] text-[#e5e2e1]/60'
                          )}
                        >
                          {(user.display_name || user.email || '?').slice(0, 1)}
                        </span>
                        <span className="absolute -bottom-0.5 -right-0.5">
                          <PresenceDot status={user.status} disabled={Boolean(user.disabled)} />
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm text-[#e5e2e1]">{user.display_name}</p>
                        <p className="text-xs text-[#e5e2e1]/50">{user.email}</p>
                        <p className="mt-0.5 text-xs text-[#e5e2e1]/40">{statusSubline(user)}</p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {!user.disabled ? (
                        <span
                          className={cn(
                            'rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.12em]',
                            user.status === 'online' && 'bg-[#7dffb0]/10 text-[#7dffb0]',
                            user.status === 'away' && 'bg-[#ffb866]/12 text-[#ffb866]',
                            user.status === 'offline' && 'bg-[#1c1b1b] text-[#e5e2e1]/40'
                          )}
                        >
                          {statusLabel(user.status)}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'rounded-full px-2.5 py-1 text-[11px] uppercase tracking-[0.12em]',
                          user.role === 'admin'
                            ? 'bg-[#ffb866]/15 text-[#ffb866]'
                            : 'bg-[#1c1b1b] text-[#e5e2e1]/45'
                        )}
                      >
                        {user.role === 'admin' ? '管理员' : '成员'}
                      </span>
                      {user.disabled ? (
                        <span className="rounded-full bg-red-400/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.12em] text-red-300/80">
                          已停用
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => toggleHistory(user.id)}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs',
                          historyUserId === user.id
                            ? 'bg-[#8fd5ff]/12 text-[#8fd5ff]'
                            : 'bg-[#1c1b1b] text-[#e5e2e1]/60 hover:text-[#e5e2e1]'
                        )}
                      >
                        <ChevronDown
                          className={cn('h-3 w-3 transition-transform', historyUserId === user.id && 'rotate-180')}
                        />
                        登录记录
                      </button>
                      <button
                        type="button"
                        onClick={() => (resetUserId === user.id ? cancelReset() : openReset(user))}
                        className={cn(
                          'inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs',
                          resetUserId === user.id
                            ? 'bg-[#ffb866]/15 text-[#ffb866]'
                            : 'bg-[#1c1b1b] text-[#e5e2e1]/60 hover:text-[#e5e2e1]'
                        )}
                      >
                        <KeyRound className="h-3 w-3" />
                        {resetUserId === user.id ? '取消' : '重置密码'}
                      </button>
                      {user.role !== 'admin' ? (
                        <button
                          type="button"
                          onClick={() => void toggleDisabled(user)}
                          className={cn(
                            'rounded-full px-3 py-1.5 text-xs',
                            user.disabled
                              ? 'bg-[#ffb866]/15 text-[#ffb866]'
                              : 'bg-[#1c1b1b] text-[#e5e2e1]/60 hover:text-[#e5e2e1]'
                          )}
                        >
                          {user.disabled ? '启用' : '停用'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {historyUserId === user.id ? (
                    <div className="mt-4 rounded-2xl bg-[#1c1b1b]/45 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.12em] text-[#e5e2e1]/45">最近登录</p>
                      {historyLoading ? (
                        <div className="flex justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin text-[#e5e2e1]/40" />
                        </div>
                      ) : loginEvents.length === 0 ? (
                        <p className="mt-2 text-sm text-[#e5e2e1]/45">暂无登录记录</p>
                      ) : (
                        <ul className="mt-2 space-y-1.5">
                          {loginEvents.map((ev) => (
                            <li key={ev.id} className="text-sm text-[#e5e2e1]/65">
                              {formatDateTime(ev.created_at)}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  ) : null}
                  {resetUserId === user.id ? (
                    <form
                      className="mt-4 space-y-3 rounded-2xl bg-[#1c1b1b]/50 p-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleResetPassword(user);
                      }}
                    >
                      <label className="block">
                        <span className="mb-2 block text-xs text-[#e5e2e1]/50">新密码（至少 8 位）</span>
                        <input
                          type="text"
                          value={resetPassword}
                          onChange={(e) => setResetPassword(e.target.value)}
                          placeholder="输入新密码"
                          required
                          minLength={8}
                          autoFocus
                          className="w-full rounded-2xl bg-[#131313]/85 px-4 py-2.5 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
                        />
                      </label>
                      <button
                        type="submit"
                        disabled={resetSubmitting}
                        className="inline-flex items-center gap-2 rounded-full bg-gradient-to-br from-[#ffb866] to-[#b77100] px-4 py-2.5 text-xs font-medium text-[#1a1208] disabled:opacity-60"
                      >
                        {resetSubmitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                        确认重置
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
});
