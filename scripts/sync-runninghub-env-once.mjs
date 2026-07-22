/**
 * 把本地 .env 的 RunningHub / Storyboard Image 变量同步到线上（不提交 Git）。
 * 用法：node scripts/sync-runninghub-env-once.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'ssh2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOST = process.env.DEPLOY_SSH_HOST || '8.163.127.198';
const USER = process.env.DEPLOY_SSH_USER || 'root';
const REMOTE = process.env.DEPLOY_REMOTE_DIR || '/var/www/my-storyboard-site';
const KEY_PATH = process.env.DEPLOY_SSH_KEY || path.join(homedir(), '.ssh', 'id_ed25519');

const KEYS = [
  'RUNNINGHUB_API_KEY',
  'RUNNINGHUB_API_BASE',
  'STORYBOARD_IMAGE_API_KEY',
  'STORYBOARD_IMAGE_API_BASE',
];

function parseEnvFile(filePath) {
  const out = {};
  if (!existsSync(filePath)) return out;
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function mask(v) {
  const s = String(v || '');
  if (s.startsWith('http')) return s;
  if (s.length <= 8) return '***';
  return `${s.slice(0, 4)}…${s.slice(-4)} (len=${s.length})`;
}

function sshExec(conn, cmd) {
  return new Promise((resolve, reject) => {
    conn.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let out = '';
      let errOut = '';
      stream.on('close', (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`exit ${code}: ${errOut || out}`));
      });
      stream.on('data', (d) => {
        out += d;
        process.stdout.write(d);
      });
      stream.stderr.on('data', (d) => {
        errOut += d;
        process.stderr.write(d);
      });
    });
  });
}

async function main() {
  const local = parseEnvFile(path.join(ROOT, '.env'));
  const pairs = {};
  for (const k of KEYS) {
    const v = String(local[k] || '').trim();
    if (!v) throw new Error(`本地 .env 缺少 ${k}`);
    pairs[k] = v;
    console.log(`>>> local ${k}=${mask(v)}`);
  }
  if (!existsSync(KEY_PATH)) throw new Error(`缺少 SSH 密钥：${KEY_PATH}`);

  const conn = await new Promise((resolve, reject) => {
    const c = new Client();
    c.on('ready', () => resolve(c)).on('error', reject).connect({
      host: HOST,
      port: 22,
      username: USER,
      privateKey: readFileSync(KEY_PATH),
      readyTimeout: 20000,
    });
  });

  const grepExclude = KEYS.map((k) => `grep -v '^${k}='`).join(' | ');
  const appendLines = KEYS.map((k) => `echo ${k}=${shellQuote(pairs[k])} >> .env`).join('\n');
  const showSafe = KEYS.map((k) => {
    if (k.endsWith('_BASE')) return `grep -E '^${k}=' .env || true`;
    return `grep -E '^${k}=' .env | sed -E 's/=(.{4}).*(.{4})$/=\\1…\\2/' || true`;
  }).join('\n');

  console.log('>>> 写入远端 .env …');
  await sshExec(
    conn,
    `
set -e
cd ${REMOTE}
cp .env .env.bak.rh.$(date +%Y%m%d%H%M) 2>/dev/null || true
${grepExclude} .env > .env.tmp || true
mv .env.tmp .env
${appendLines}
echo '--- remote (masked) ---'
${showSafe}
`
  );

  conn.end();
  console.log('>>> RunningHub 环境变量已同步（需随后 pm2 --update-env）');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
