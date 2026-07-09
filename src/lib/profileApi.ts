import type { AuthUser } from '../stores/authStore';

export async function updateProfile(displayName: string): Promise<AuthUser> {
  const res = await fetch('/api/auth/profile', {
    method: 'PATCH',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ display_name: displayName }),
  });
  const data = (await res.json()) as { user?: AuthUser; error?: string };
  if (!res.ok) throw new Error(data.error || '保存失败');
  if (!data.user) throw new Error('保存失败');
  return data.user;
}

export async function uploadAvatar(file: File): Promise<AuthUser> {
  const form = new FormData();
  form.append('avatar', file);
  const res = await fetch('/api/auth/avatar', {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
  });
  const data = (await res.json()) as { user?: AuthUser; error?: string };
  if (!res.ok) throw new Error(data.error || '上传头像失败');
  if (!data.user) throw new Error('上传头像失败');
  return data.user;
}
