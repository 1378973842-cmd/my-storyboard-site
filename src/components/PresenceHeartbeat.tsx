import { useEffect } from 'react';
import { startPresenceHeartbeat } from '../lib/authSession';
import { useAuthStore } from '../stores/authStore';

/** 登录后全局 presence 心跳（60s + 标签可见性变化） */
export function PresenceHeartbeat() {
  const user = useAuthStore((s) => s.user);

  useEffect(() => {
    if (!user) return;
    return startPresenceHeartbeat();
  }, [user?.id]);

  return null;
}
