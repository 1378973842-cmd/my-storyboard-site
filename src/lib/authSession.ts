/** 与 LoginGate 共用：本机 UI 放行标记 */
export const AUTH_LS_KEY = 'storyboard_auth_ok_v1';

/** 浏览器标签 presence 会话键（多标签去重在线人数） */
export const PRESENCE_SESSION_KEY = 'storyboard_presence_session_v1';

export const AUTH_REQUIRED_EVENT = 'storyboard-auth-required';

const PRESENCE_INTERVAL_MS = 60_000;

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

export function getOrCreatePresenceSessionKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    let key = localStorage.getItem(PRESENCE_SESSION_KEY);
    if (!key) {
      key =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `ps_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(PRESENCE_SESSION_KEY, key);
    }
    return key;
  } catch {
    return '';
  }
}

export function clearPresenceSessionKey(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(PRESENCE_SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** 将 pathname 映射为管理员可读页面标签 */
export function presencePageFromLocation(): string {
  if (typeof window === 'undefined') return '未知';
  const path = window.location.pathname.toLowerCase();
  const hash = window.location.hash.toLowerCase();
  if (path.includes('canvas') || hash.includes('canvas')) return '画布';
  if (path.includes('director')) return '导演台';
  if (hash.includes('admin-users')) return '用户管理';
  if (hash.includes('admin')) return '管理后台';
  if (hash.includes('profile') || hash.includes('space')) return '个人空间';
  if (hash.includes('gallery')) return '公共画廊';
  if (hash.includes('workspace')) return '工作空间';
  return '主页';
}

export async function postPresencePing(): Promise<void> {
  const sessionKey = getOrCreatePresenceSessionKey();
  if (!sessionKey) return;
  const visible = typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
  await fetch('/api/auth/presence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({
      session_key: sessionKey,
      page: presencePageFromLocation(),
      visible,
    }),
  });
}

/** 登录后启动；返回 cleanup */
export function startPresenceHeartbeat(): () => void {
  if (typeof window === 'undefined') return () => {};

  getOrCreatePresenceSessionKey();
  void postPresencePing();

  const intervalId = window.setInterval(() => {
    void postPresencePing();
  }, PRESENCE_INTERVAL_MS);

  const onVisibility = () => {
    void postPresencePing();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return () => {
    window.clearInterval(intervalId);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

export async function logoutSession(): Promise<void> {
  const sessionKey = getOrCreatePresenceSessionKey();
  await fetch('/api/auth/logout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ session_key: sessionKey }),
  });
  try {
    localStorage.removeItem(AUTH_LS_KEY);
  } catch {
    /* ignore */
  }
  clearPresenceSessionKey();
  clearCanvasLastSessionId();
}
