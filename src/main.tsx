import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LoginGate } from './components/LoginGate.tsx';
import { AppUpdateBanner } from './components/AppUpdateBanner.tsx';
import { ShellNavigationProvider } from './shell/ShellNavigation.tsx';
import App from './App.tsx';
import './store/useStudioBackgroundStore.ts';
import './index.css';
import './components/InfiniteCanvas/infinite-canvas.css';

// 仅清理旧版遗留键；切勿包含 storyboard_gate_ok_v1（门禁标记由 LoginGate 独占）
const LEGACY_LOCAL_STORAGE_KEYS = [
  'storyboard-app-state-v1',
  'standalone-image-editor-draft-v1',
  'storyboard-ui-theme',
];

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LoginGate>
      <ShellNavigationProvider>
        <App />
        <AppUpdateBanner />
      </ShellNavigationProvider>
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
