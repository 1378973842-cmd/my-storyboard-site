#!/usr/bin/env node
/**
 * 在 .git/hooks/post-commit 写入调用 daily-log（需 Git 使用 sh 执行 hooks，Git for Windows 默认支持）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const hookPath = path.join(ROOT, '.git', 'hooks', 'post-commit');

const hookBody = `#!/bin/sh
# 由 scripts/install-git-hooks.mjs 生成：每次 commit 后追加一行到 docs/DAILY_LOG.md
cd "$(dirname "$0")/../.." || exit 0
node scripts/daily-log.mjs --hook 2>/dev/null || true
exit 0
`;

const dir = path.dirname(hookPath);
if (!fs.existsSync(dir)) {
  console.error('[hooks] 未找到 .git/hooks。请在已执行 git init 的仓库根目录运行: npm run hooks:install');
  process.exit(1);
}

fs.writeFileSync(hookPath, hookBody.replace(/\r\n/g, '\n'), 'utf8');
try {
  fs.chmodSync(hookPath, 0o755);
} catch {
  /* Windows 可能忽略 chmod */
}
console.log('[hooks] 已写入', path.relative(ROOT, hookPath));
console.log('[hooks] 之后每次 git commit 会自动更新 docs/DAILY_LOG.md');
