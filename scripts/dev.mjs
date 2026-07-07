/**
 * 开发：server.ts 变更时自动重新 bundle，并重启 Node 进程（避免新增 API 路由后仍 404）。
 */
import * as esbuild from 'esbuild';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const outfile = path.join(projectRoot, '.dev-server.mjs');

let child = null;
let restartTimer = null;
let serverStarted = false;
let starting = false;

/**
 * 等待旧进程退出，避免端口仍占用导致新路由永远起不来。
 * Windows 上 spawn 用了 shell:true，proc 实际是 cmd.exe 外壳；对它 kill('SIGTERM') 只会
 * 杀掉外壳本身并立刻触发 'exit'，真正的 node.exe（.dev-server.mjs）会变成孤儿进程继续占用端口。
 * 所以 Windows 必须直接按 pid 做进程树 taskkill，不能指望 SIGTERM 传导。
 */
function stopNode() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    const proc = child;
    const pid = proc.pid;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      child = null;
      resolve();
    };
    proc.once('exit', done);
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/PID', String(pid), '/F', '/T'], { shell: true, stdio: 'ignore' });
      } catch (_) {
        /* ignore */
      }
    } else {
      proc.kill('SIGTERM');
    }
    setTimeout(() => {
      if (!settled && pid) {
        try {
          if (process.platform === 'win32') {
            spawn('taskkill', ['/PID', String(pid), '/F', '/T'], { shell: true, stdio: 'ignore' });
          } else {
            proc.kill('SIGKILL');
          }
        } catch (_) {
          /* ignore */
        }
        setTimeout(done, 400);
      }
    }, 1200);
  });
}

async function startNode() {
  if (starting) return;
  starting = true;
  await stopNode();
  const proc = spawn('node', ['--import', 'dotenv/config', outfile], {
    cwd: projectRoot,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  child = proc;
  proc.on('exit', (code, signal) => {
    if (signal !== 'SIGTERM' && signal !== 'SIGINT') {
      if (child === proc) child = null;
      if (code && code !== 0) process.exitCode = code;
    }
  });
  starting = false;
}

function scheduleRestart() {
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    console.log('[dev] restarting server…');
    void startNode();
  }, 200);
}

const ctx = await esbuild.context({
  entryPoints: [path.join(projectRoot, 'server.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  packages: 'external',
  outfile,
  plugins: [
    {
      name: 'restart-on-rebuild',
      setup(build) {
        build.onEnd((result) => {
          if (result.errors.length === 0) {
            if (!serverStarted) {
              serverStarted = true;
              console.log('[dev] server bundle ready:', outfile);
              startNode();
            } else {
              scheduleRestart();
            }
          }
        });
      },
    },
  ],
});

await ctx.watch();
await ctx.rebuild();

process.on('SIGINT', () => {
  void stopNode().then(() => ctx.dispose().then(() => process.exit(0)));
});
