/**
 * 把 OSS_* 写入线上 .env 并做一次连通探测（不提交 Git）。
 * 用法（PowerShell）：
 *   $env:OSS_REGION='oss-cn-guangzhou'
 *   $env:OSS_BUCKET='dreamgrid-media'
 *   $env:OSS_ACCESS_KEY_ID='...'
 *   $env:OSS_ACCESS_KEY_SECRET='...'
 *   node scripts/sync-oss-env-once.mjs
 */
import { readFileSync, existsSync } from 'fs';
import { homedir } from 'os';
import path from 'path';
import OSS from 'ali-oss';
import { Client } from 'ssh2';

const HOST = process.env.DEPLOY_SSH_HOST || '8.163.127.198';
const USER = process.env.DEPLOY_SSH_USER || 'root';
const REMOTE = process.env.DEPLOY_REMOTE_DIR || '/var/www/my-storyboard-site';
const KEY_PATH = process.env.DEPLOY_SSH_KEY || path.join(homedir(), '.ssh', 'id_ed25519');

const KEYS = ['OSS_REGION', 'OSS_BUCKET', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET'];

function shellQuote(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`;
}

function mask(v) {
  const s = String(v || '');
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

function ossErr(e) {
  return e?.code || e?.name || e?.message || String(e);
}

async function ensureBucket(region, bucket, accessKeyId, accessKeySecret) {
  const base = { accessKeyId, accessKeySecret, secure: true, timeout: 20000 };
  const probe = new OSS({ ...base, region });
  let useRegion = region;
  try {
    const listed = await probe.listBuckets({ prefix: bucket, 'max-keys': 100 });
    const found = (listed.buckets || []).find((b) => b.name === bucket);
    if (found?.region) {
      useRegion = String(found.region).replace(/^oss-/, 'oss-').startsWith('oss-')
        ? found.region
        : `oss-${found.region}`;
      if (useRegion !== region) {
        console.log(`>>> Bucket 已存在，地域=${useRegion}（请求地域=${region}）`);
      } else {
        console.log(`>>> Bucket 已存在：${bucket} @ ${useRegion}`);
      }
    } else {
      console.log(`>>> 创建 Bucket ${bucket} @ ${region}（私有）…`);
      await probe.putBucket(bucket, { acl: 'private', storageClass: 'Standard' });
      useRegion = region;
    }
  } catch (e) {
    throw new Error(`列出/创建 Bucket 失败：${ossErr(e)}。请给 RAM 用户 dreamgrid-oss 添加 AliyunOSSFullAccess（或该桶的读写权限）`);
  }

  const client = new OSS({ ...base, region: useRegion, bucket });
  try {
    await client.putBucketACL(bucket, 'private');
  } catch (e) {
    console.warn('>>> 设置私有 ACL 跳过：', ossErr(e));
  }
  try {
    await client.putBucketCORS(bucket, [
      {
        allowedOrigin: ['*'],
        allowedMethod: ['GET', 'HEAD'],
        allowedHeader: ['*'],
        exposeHeader: ['ETag', 'Content-Length', 'Content-Type'],
        maxAgeSeconds: 600,
      },
    ]);
  } catch (e) {
    console.warn('>>> 设置 CORS 跳过：', ossErr(e));
  }

  const key = `_dreamgrid_probe/${Date.now()}.txt`;
  await client.put(key, Buffer.from('ok'), { mime: 'text/plain' });
  await client.head(key);
  const signed = client.signatureUrl(key, { expires: 120 });
  await client.delete(key);
  if (!signed.startsWith('http')) throw new Error('签名 URL 异常');
  console.log('>>> OSS 连通探测通过（put/head/sign/delete）');
  return useRegion;
}

async function main() {
  const pairs = {};
  for (const k of KEYS) {
    const v = String(process.env[k] || '').trim();
    if (!v) throw new Error(`缺少环境变量 ${k}`);
    pairs[k] = v;
    console.log(`>>> ${k}=${k.includes('SECRET') ? '***' : mask(v)}`);
  }
  if (!existsSync(KEY_PATH)) throw new Error(`缺少 SSH 密钥：${KEY_PATH}`);

  const resolvedRegion = await ensureBucket(
    pairs.OSS_REGION,
    pairs.OSS_BUCKET,
    pairs.OSS_ACCESS_KEY_ID,
    pairs.OSS_ACCESS_KEY_SECRET
  );
  pairs.OSS_REGION = resolvedRegion;

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

  const grepExclude = `grep -vE '^(${KEYS.join('|')})='`;
  const appendLines = KEYS.map((k) => `echo ${k}=${shellQuote(pairs[k])} >> .env`).join('\n');

  console.log('>>> 写入远端 .env 并重启 PM2 …');
  await sshExec(
    conn,
    `
set -e
cd ${REMOTE}
cp .env .env.bak.oss.$(date +%Y%m%d%H%M) 2>/dev/null || true
${grepExclude} .env > .env.tmp || true
mv .env.tmp .env
${appendLines}
echo '--- remote OSS keys (names only) ---'
grep -E '^OSS_' .env | sed -E 's/=.*$/=***/'
pm2 restart gemini-deploy --update-env
sleep 3
curl -s -o /dev/null -w "http=%{http_code}\\n" http://127.0.0.1:3000/
`
  );
  conn.end();
  console.log('>>> OSS 已写入线上并重启');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
