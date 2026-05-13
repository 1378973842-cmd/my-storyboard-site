import { StrictMode, lazy, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { LoginGate } from './components/LoginGate.tsx';
import './index.css';

/** 延迟加载主应用，避免首屏被大包阻塞导致「看不到暗号层」；通过暗号后再拉取 App 分包 */
const App = lazy(() => import('./App.tsx'));

// 仅清理旧版遗留键；切勿包含 storyboard_gate_ok_v1（门禁标记由 LoginGate 独占）
const LEGACY_LOCAL_STORAGE_KEYS = [
  'storyboard-app-state-v1',
  'standalone-image-editor-draft-v1',
  'storyboard-ui-theme',
];

function AppLoadingFallback() {
  return (
    <div className="fixed inset-0 z-[2147483646] flex items-center justify-center bg-[#0e0e0e] text-sm text-[#e5e2e1]/80">
      <div className="flex flex-col items-center gap-3">
        <div className="h-9 w-9 animate-spin rounded-full border-2 border-[#ffb866]/30 border-t-[#ffb866]" aria-hidden />
        <span>加载工作台…</span>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LoginGate>
      <Suspense fallback={<AppLoadingFallback />}>
        <App />
      </Suspense>
    </LoginGate>
  </StrictMode>,
);

try {
  if (typeof localStorage !== 'undefined') {
    LEGACY_LOCAL_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
  }
} catch {
  /* ignore：隐私模式/禁用存储时可能抛错 */
}
