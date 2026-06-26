/** 与 LoginGate 共用：本机 UI 放行标记 */
export const AUTH_LS_KEY = 'storyboard_auth_ok_v1';

export const AUTH_REQUIRED_EVENT = 'storyboard-auth-required';

export function isStoredAuthenticated(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = localStorage.getItem(AUTH_LS_KEY);
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

export function isAuthError(status: number, error?: unknown): boolean {
  if (status !== 401) return false;
  const msg = typeof error === 'string' ? error : '';
  return msg.includes('登录') || msg.includes('暗号');
}

export function notifyAuthRequired(): void {
  try {
    localStorage.removeItem(AUTH_LS_KEY);
  } catch {
    /* ignore */
  }
  clearCanvasLastSessionId();
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
  }
}

export async function fetchAuthStatus(): Promise<{ ok: boolean; user?: import('../stores/authStore').AuthUser }> {
  const res = await fetch('/api/auth/status', { credentials: 'same-origin' });
  const data = (await res.json()) as { ok?: boolean; user?: import('../stores/authStore').AuthUser };
  return { ok: Boolean(data.ok), user: data.user };
}

/** 与 infiniteCanvas/canvasEngine.js 的 LAST_CANVAS_ID_KEY 保持一致 */
export const CANVAS_LAST_ID_SESSION_KEY = 'gemini-infinite-canvas-last-id';

export function clearCanvasLastSessionId(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CANVAS_LAST_ID_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

export async function logoutSession(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' });
  try {
    localStorage.removeItem(AUTH_LS_KEY);
  } catch {
    /* ignore */
  }
  clearCanvasLastSessionId();
}
