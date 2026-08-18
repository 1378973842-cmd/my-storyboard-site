export type PlatformErrorItem = {
  id: string;
  user_id: string;
  user_email: string;
  user_display_name: string;
  canvas_id: string;
  platform: string;
  model: string;
  prompt: string;
  error_message: string;
  request: Record<string, unknown>;
  run_ms: number;
  created_at: string;
};

export async function fetchAdminPlatformErrors(q = ''): Promise<PlatformErrorItem[]> {
  const params = new URLSearchParams({ limit: '120' });
  if (q.trim()) params.set('q', q.trim());
  const res = await fetch(`/api/admin/platform-errors?${params}`, { credentials: 'same-origin' });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || '加载报错记录失败');
  }
  const data = (await res.json()) as { items?: PlatformErrorItem[] };
  return Array.isArray(data.items) ? data.items : [];
}
