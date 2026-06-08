/** 与 LoginGate 共用：本机 UI 放行标记（勿写入 main.tsx 的 LEGACY 清理列表） */
export const GATE_LS_KEY = 'storyboard_gate_ok_v1';

export const GATE_AUTH_REQUIRED_EVENT = 'storyboard-gate-auth-required';

export function isStoredAuthorized(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const v = localStorage.getItem(GATE_LS_KEY);
    return v === '1' || v === 'true';
  } catch {
    return false;
  }
}

export function isGateAuthError(status: number, error?: unknown): boolean {
  if (status !== 401) return false;
  const msg = typeof error === 'string' ? error : '';
  return msg.includes('暗号');
}

/** 生图等接口返回未校验时，清除本机标记并通知 LoginGate 重新展示暗号层 */
export function notifyGateAuthRequired(): void {
  try {
    localStorage.removeItem(GATE_LS_KEY);
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(GATE_AUTH_REQUIRED_EVENT));
  }
}
