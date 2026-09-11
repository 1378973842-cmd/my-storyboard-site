/**
 * 远端部署：优先 SSH 密钥（~/.ssh/id_ed25519），回退 DEPLOY_SSH_PASS。
 * 用法：npm run build:prod && node scripts/deploy-remote-once.mjs
 */
import { readFileSync, existsSync, createReadStream, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'ssh2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const HOST = process.env.DEPLOY_SSH_HOST || '8.163.127.198';
const USER = process.env.DEPLOY_SSH_USER || 'root';
const PASS = process.env.DEPLOY_SSH_PASS || '';
const REMOTE = process.env.DEPLOY_REMOTE_DIR || '/var/www/my-storyboard-site';
const KEY_PATH = process.env.DEPLOY_SSH_KEY || path.join(homedir(), '.ssh', 'id_ed25519');

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

function sftpMkdir(sftp, dir) {
  return new Promise((resolve, reject) => {
    sftp.mkdir(dir, (err) => {
      if (err && err.code !== 4) return reject(err);
      resolve();
    });
  });
}

async function sftpUploadDir(sftp, localDir, remoteDir) {
  await sftpMkdir(sftp, remoteDir);
  for (const name of readdirSync(localDir)) {
    const lp = path.join(localDir, name);
    const rp = `${remoteDir}/${name}`;
    if (statSync(lp).isDirectory()) await sftpUploadDir(sftp, lp, rp);
    else await sftpUploadFile(sftp, lp, rp);
  }
}

function sftpUploadFile(sftp, localPath, remotePath) {
  return new Promise((resolve, reject) => {
    const parts = remotePath.split('/');
    const dir = parts.slice(0, -1).join('/') || '/';
    sftp.mkdir(dir, () => {
      const rs = createReadStream(localPath);
      const ws = sftp.createWriteStream(remotePath);
      ws.on('close', resolve);
      ws.on('error', reject);
      rs.on('error', reject);
      rs.pipe(ws);
    });
  });
}

function connect() {
  const opts = { host: HOST, port: 22, username: USER, readyTimeout: 20000 };
  if (existsSync(KEY_PATH)) {
    opts.privateKey = readFileSync(KEY_PATH);
    if (existsSync(`${KEY_PATH}.pub`)) console.log(`>>> 使用 SSH 密钥：${KEY_PATH}`);
    else console.log(`>>> 使用 SSH 私钥：${KEY_PATH}`);
  } else if (PASS) {
    opts.password = PASS;
    console.log('>>> 使用密码登录（建议先运行 setup-ssh-and-env.mjs 配置密钥）');
  } else {
    throw new Error('未找到 SSH 密钥且未设置 DEPLOY_SSH_PASS');
  }
  return new Promise((resolve, reject) => {
    const conn = new Client();
    conn.on('ready', () => resolve(conn)).on('error', reject).connect(opts);
  });
}

async function main() {
  const conn = await connect();
  console.log('>>> SSH 已连接，拉取代码并安装依赖…');
  await sshExec(
    conn,
    // 2G ECS：不要装 transformers/onnxruntime（GitHub 302 + OOM）。从 package.json/lock 卸掉再装其余依赖。
    `cd ${REMOTE} && git fetch origin deploy && git reset --hard origin/deploy && npm uninstall @huggingface/transformers --save --no-audit --no-fund && npm install --no-audit --no-fund && npm rebuild better-sqlite3`
  );

  const sftp = await new Promise((resolve, reject) => {
    conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
  });

  console.log('>>> 清理远端旧 dist/assets（hash 产物，删除后全量重传）…');
  await sshExec(conn, `cd ${REMOTE} && rm -rf dist/assets`);

  console.log('>>> 上传 dist/assets …');
  await sftpUploadDir(sftp, path.join(ROOT, 'dist', 'assets'), `${REMOTE}/dist/assets`);
  console.log('>>> 上传 dist/canvas …');
  await sftpUploadDir(sftp, path.join(ROOT, 'dist', 'canvas'), `${REMOTE}/dist/canvas`);
  console.log('>>> 上传 dist/index.html …');
  await sftpUploadFile(sftp, path.join(ROOT, 'dist', 'index.html'), `${REMOTE}/dist/index.html`);
  const versionJson = path.join(ROOT, 'dist', 'version.json');
  if (existsSync(versionJson)) {
    console.log('>>> 上传 dist/version.json …');
    await sftpUploadFile(sftp, versionJson, `${REMOTE}/dist/version.json`);
  }

  for (const name of readdirSync(path.join(ROOT, 'dist'))) {
    if (/\.(png|glb)$/i.test(name)) {
      console.log(`>>> 上传 dist/${name} …`);
      await sftpUploadFile(sftp, path.join(ROOT, 'dist', name), `${REMOTE}/dist/${name}`);
    }
  }

  console.log('>>> 上传 dist-server …');
  await sftpUploadDir(sftp, path.join(ROOT, 'dist-server'), `${REMOTE}/dist-server`);

  console.log('>>> 重启 PM2 …');
  await sshExec(
    conn,
    `cd ${REMOTE} && (pm2 describe gemini-deploy >/dev/null 2>&1 && pm2 restart gemini-deploy --update-env || pm2 start ecosystem.config.cjs --env production) && pm2 save && sleep 3 && curl -s -o /dev/null -w "%{http_code}\\n" http://127.0.0.1:3000`
  );

  conn.end();
  console.log('>>> 部署完成');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
