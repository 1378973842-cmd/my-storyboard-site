import React, { memo, useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Loader2, UserPlus } from 'lucide-react';
import { cn } from '../lib/utils';

type AdminUser = {
  id: string;
  email: string;
  display_name: string;
  role: 'admin' | 'user';
  disabled: number;
  created_at: string;
};

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

export const AdminUsersPage = memo(function AdminUsersPage({ shellActive }: { shellActive: boolean }) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [createdHint, setCreatedHint] = useState<string | null>(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/users', { credentials: 'same-origin' });
      const data = (await res.json()) as { users?: AdminUser[]; error?: string };
      if (!res.ok) throw new Error(data.error || '加载失败');
      setUsers(Array.isArray(data.users) ? data.users : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (shellActive) void loadUsers();
  }, [shellActive, loadUsers]);

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
            仅管理员可见。为同事创建账号后，将邮箱与初始密码私下发送给对方即可登录。
          </p>
        </motion.div>

        <form
          onSubmit={handleCreate}
          className="mt-10 space-y-4 rounded-[1.5rem] bg-[#131313]/80 p-6 outline outline-[0.5px] outline-[#45464d]/20"
        >
          <h2 className="text-sm font-medium text-[#ffb866]/90">创建同事账号</h2>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="同事邮箱"
            required
            className="w-full rounded-2xl bg-[#1c1b1b]/85 px-4 py-3 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
          />
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="显示名称（可选）"
            className="w-full rounded-2xl bg-[#1c1b1b]/85 px-4 py-3 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
          />
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="初始密码（至少 8 位）"
            required
            minLength={8}
            className="w-full rounded-2xl bg-[#1c1b1b]/85 px-4 py-3 text-sm outline-none focus:shadow-[0_0_0_3px_rgba(255,184,102,0.18)]"
          />
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

        <section className="mt-10">
          <h2 className="mb-4 text-sm font-medium text-[#e5e2e1]/70">团队成员</h2>
          {loading ? (
            <div className="flex justify-center py-10 text-[#e5e2e1]/50">
              <Loader2 className="h-7 w-7 animate-spin" />
            </div>
          ) : (
            <ul className="space-y-3">
              {users.map((user) => (
                <li
                  key={user.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-[#131313]/70 px-4 py-3 outline outline-[0.5px] outline-[#45464d]/15"
                >
                  <div>
                    <p className="text-sm text-[#e5e2e1]">{user.display_name}</p>
                    <p className="text-xs text-[#e5e2e1]/50">{user.email}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[11px] uppercase tracking-[0.12em] text-[#e5e2e1]/40">
                      {user.role === 'admin' ? '管理员' : '成员'}
                    </span>
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
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
});
