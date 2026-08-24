/**
 * 远端业务数据备份：SSH 打包 projects.db / data / uploads / .env。
 * 用法：npm run backup:remote
 * 拉回本机：npm run backup:remote -- --pull
 * 环境变量与 deploy-remote-once.mjs 相同（DEPLOY_SSH_HOST / KEY / PASS 等）。
 */
import { mkdirSync, existsSync, readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { Client } from 'ssh2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HOST = process.env.DEPLOY_SSH_HOST || '8.163.127.198';
const USER = process.env.DEPLOY_SSH_USER || 'root';
const PASS = process.env.DEPLOY_SSH_PASS || '';
const REMOTE = process.env.DEPLOY_REMOTE_DIR || '/var/www/my-storyboard-site';
const KEY_PATH = process.env.DEPLOY_SSH_KEY || path.join(homedir(), '.ssh', 'id_ed25519');
const BACKUP_REMOTE_DIR = process.env.BACKUP_REMOTE_DIR || '/root/studio-backups';
const BACKUP_KEEP = Number(process.env.BACKUP_KEEP || 3);
const PULL =
  process.argv.includes('--pull') ||
  process.env.BACKUP_PULL === '1' ||
  process.env.BACKUP_PULL === 'true';
const LOCAL_DIR =
  process.env.BACKUP_LOCAL_DIR ||
  path.join(homedir(), 'lhz-studio-backups');

function connect() {
  const opts = { host: HOST, port: 22, username: USER, readyTimeout: 20000 };
  if (existsSync(KEY_PATH)) {
    opts.privateKey = readFileSync(KEY_PATH);
    console.log(`>>> 使用 SSH 密钥：${KEY_PATH}`);
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

function sftpGet(sftp, remotePath, localPath) {
  return new Promise((resolve, reject) => {
    sftp.fastGet(remotePath, localPath, (err) => (err ? reject(err) : resolve()));
  });
}

async function main() {
  const conn = await connect();
  console.log('>>> SSH 已连接，打包业务数据…');

  const backupScript = `
set -e
mkdir -p ${BACKUP_REMOTE_DIR}
cd ${REMOTE}
STAMP=$(date +%Y%m%d-%H%M%S)
TAR=${BACKUP_REMOTE_DIR}/studio-$STAMP.tar.gz
ITEMS=""
test -f projects.db && ITEMS="$ITEMS projects.db"
test -d data && ITEMS="$ITEMS data"
test -d public/uploads && ITEMS="$ITEMS public/uploads"
test -f .env && ITEMS="$ITEMS .env"
if [ -z "$ITEMS" ]; then
  echo ">>> 没有可备份文件（projects.db / data / uploads / .env 均不存在）"
  exit 1
fi
# 线上 uploads 持续写入时，tar 会报 file changed as we read it 并以 exit 1 结束，包通常仍可用
set +e
tar czf "$TAR" $ITEMS
TAR_CODE=$?
set -e
if [ "$TAR_CODE" -ne 0 ]; then
  if [ "$TAR_CODE" -eq 1 ] && [ -s "$TAR" ]; then
    echo ">>> tar 警告：打包时有文件变化（常见于 uploads），备份包仍保留"
  else
    echo ">>> tar 失败 exit $TAR_CODE"
    exit "$TAR_CODE"
  fi
fi
BYTES=$(stat -c %s "$TAR")
ls -lh "$TAR"
ls -1t ${BACKUP_REMOTE_DIR}/studio-*.tar.gz 2>/dev/null | tail -n +$(( ${BACKUP_KEEP} + 1 )) | xargs -r rm -f
echo BACKUP_BYTES=$BYTES
echo BACKUP_PATH=$TAR
`.trim();

  const out = await sshExec(conn, backupScript);
  const match = out.match(/BACKUP_PATH=(.+)/);
  const remoteTar = match?.[1]?.trim();
  const bytesMatch = out.match(/BACKUP_BYTES=(\d+)/);
  const remoteBytes = bytesMatch ? Number(bytesMatch[1]) : 0;
  if (!remoteTar) throw new Error('未获取到备份文件路径');

  if (PULL) {
    mkdirSync(LOCAL_DIR, { recursive: true });
    const localName = path.basename(remoteTar);
    const localPath = path.join(LOCAL_DIR, localName);
    const sftp = await new Promise((resolve, reject) => {
      conn.sftp((err, s) => (err ? reject(err) : resolve(s)));
    });
    console.log(`>>> 拉回本机：${localPath}`);
    await sftpGet(sftp, remoteTar, localPath);
    const localBytes = statSync(localPath).size;
    if (remoteBytes > 0 && localBytes !== remoteBytes) {
      throw new Error(`本机文件大小不一致（远端 ${remoteBytes}，本机 ${localBytes}），请重试 --pull`);
    }
    console.log(`>>> 本机备份：${localPath} (${(localBytes / 1024 / 1024).toFixed(1)} MB)`);
  }

  conn.end();
  console.log(`>>> 远端备份完成：${remoteTar}`);
  if (!PULL) {
    console.log('>>> 提示：加 --pull 可拉回本机，例如 npm run backup:remote -- --pull');
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
