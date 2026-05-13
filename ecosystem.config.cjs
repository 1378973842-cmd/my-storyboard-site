/**
 * PM2 常驻部署（Ubuntu 无图形界面）
 *
 * 首次部署建议：
 *   npm ci
 *   npm run build:prod
 *   在仓库根放置 .env（勿提交），按需设置 PORT
 *   pm2 start ecosystem.config.cjs
 *
 * 若 better-sqlite3 与本机架构不一致：在目标机上执行 npm rebuild better-sqlite3
 */
const path = require("path");

module.exports = {
  apps: [
    {
      name: "gemini-deploy",
      cwd: __dirname,
      script: path.join("dist-server", "server.mjs"),
      interpreter: "node",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "800M",
      merge_logs: true,
      time: true,
      error_file: path.join("logs", "pm2-error.log"),
      out_file: path.join("logs", "pm2-out.log"),
      env: {
        NODE_ENV: "production",
      },
      env_production: {
        NODE_ENV: "production",
      },
    },
  ],
};
