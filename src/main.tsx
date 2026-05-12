import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// 清理历史版本写入的持久化键，避免占配额与脏数据
const LEGACY_LOCAL_STORAGE_KEYS = [
  'storyboard-app-state-v1',
  'standalone-image-editor-draft-v1',
  'storyboard-ui-theme',
];
try {
  if (typeof localStorage !== 'undefined') {
    LEGACY_LOCAL_STORAGE_KEYS.forEach((k) => localStorage.removeItem(k));
  }
} catch {
  /* ignore：隐私模式/禁用存储时可能抛错 */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
