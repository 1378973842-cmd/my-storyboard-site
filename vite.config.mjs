import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  loadEnv(mode, '.', '');
  /** 与 Express（server.ts）的 process.env.PORT 一致，便于 middleware 模式下 HMR/资源 URL 指向当前页端口 */
  const devHttpPort = Number(process.env.PORT) || 3005;
  return {
    plugins: [react(), tailwindcss()],
    define: {},
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      origin: `http://localhost:${devHttpPort}`,
      hmr:
        process.env.DISABLE_HMR === 'true'
          ? false
          : { host: 'localhost', port: 24679 },
      /** 画布 JSON 存于 data/，保存/删除时不触发整页 reload */
      watch: {
        ignored: ['**/data/**'],
      },
      /** 无限画布 API 仍走原版 FastAPI（默认 canvas_source 启动在 3000） */
      proxy: {
        '/api': {
          target: process.env.CANVAS_API_ORIGIN || 'http://127.0.0.1:3000',
          changeOrigin: true,
        },
      },
    },
  };
});
