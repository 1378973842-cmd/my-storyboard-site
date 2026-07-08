/**
 * 一次性服务器初始化：用密码登录，写入本机 SSH 公钥 + RunningHub 环境变量。
 * 用法（PowerShell，勿把密钥写进仓库）：
 *   $env:DEPLOY_SSH_PASS='...'
 *   $env:RUNNINGHUB_API_KEY='...'
 *   node scripts/setup-ssh-and-env.mjs
 */
import { readFileSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { Client } from 'ssh2';

const HOST = process.env.DEPLOY_SSH_HOST || '8.163.127.198';
const USER = process.env.DEPLOY_SSH_USER || 'root';
const PASS = process.env.DEPLOY_SSH_PASS || '';
const REMOTE = process.env.DEPLOY_REMOTE_DIR || '/var/www/my-storyboard-site';
const RH_KEY = String(process.env.RUNNINGHUB_API_KEY || '').trim();
const RH_BASE = String(process.env.RUNNINGHUB_API_BASE || 'https://www.runninghub.cn').trim();

const PUB = path.join(homedir(), '.ssh', 'id_ed25519.pub');

if (!PASS) {
  console.error('缺少 DEPLOY_SSH_PASS（最后一次用密码登录）');
  process.exit(1);
}
if (!RH_KEY) {
  console.error('缺少 RUNNINGHUB_API_KEY');
  process.exit(1);
}

function sshExec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let errOut = '';
      stream.on('close', (code) => (code === 0 ? resolve() : reject(new Error(errOut || `exit ${code}`))));
      stream.on('data', (d) => process.stdout.write(d));
      stream.stderr.on('data', (d) => {
        errOut += d;
        process.stderr.write(d);
      });
    });
  });
}

function connectPassword() {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn)).on('error', reject).connect({
      host: HOST,
      port: 22,
      username: USER,
      password: PASS,
      readyTimeout: 20000,
    });
  });
}

function connectKey() {
  const keyPath = path.join(homedir(), '.ssh', 'id_ed25519');
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn)).on('error', reject).connect({
      host: HOST,
      port: 22,
      username: USER,
      privateKey: readFileSync(keyPath),
      readyTimeout: 20000,
    });
  });
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

async function main() {
  const pub = readFileSync(PUB, 'utf8').trim();
  console.log('>>> 用密码连接，安装 SSH 公钥…');
  const conn = await connectPassword();
  await sshExec(
    conn,
    `mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF ${shellQuote(pub)} ~/.ssh/authorized_keys || echo ${shellQuote(pub)} >> ~/.ssh/authorized_keys`
  );

  console.log('>>> 写入 RunningHub 环境变量…');
  const envScript = `
cd ${REMOTE}
cp .env .env.bak.$(date +%Y%m%d%H%M) 2>/dev/null || true
grep -v '^RUNNINGHUB_API_KEY=' .env | grep -v '^RUNNINGHUB_API_BASE=' > .env.tmp || true
mv .env.tmp .env
echo RUNNINGHUB_API_KEY=${shellQuote(RH_KEY)} >> .env
echo RUNNINGHUB_API_BASE=${shellQuote(RH_BASE)} >> .env
grep -E '^(RUNNINGHUB_API_KEY|RUNNINGHUB_API_BASE)=' .env
pm2 restart gemini-deploy --update-env
sleep 3
curl -s -o /dev/null -w "http=%{http_code}\\n" http://127.0.0.1:3000/
`;
  await sshExec(conn, envScript);
  conn.end();

  console.log('>>> 验证免密 SSH…');
  const conn2 = await connectKey();
  await sshExec(conn2, 'echo key_login_ok && hostname');
  conn2.end();
  console.log('>>> 完成：以后可用 SSH 密钥免密部署');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
