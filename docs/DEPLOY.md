# LHZ Studio 部署与维护手册 V2.0

> 适用：广州阿里云 ECS · Ubuntu 22.04 · 仓库 `my-storyboard-site` · 分支 `deploy`  
> 原则：**只部署代码；线上数据从零开始，与本地开发机互不同步**

---

## 基础信息

| 项 | 值 |
|----|-----|
| 公网 IP | `8.163.127.198` |
| 默认端口 | `3000`（服务器 `.env` 可设 `PORT`） |
| SSH | `ssh root@8.163.127.198`（建议使用密钥登录，勿在文档中保存密码） |
| 服务器目录 | `/var/www/my-storyboard-site` |
| GitHub | `1378973842-cmd/my-storyboard-site` |
| 分支 | `deploy` |
| PM2 进程名 | **`gemini-deploy`** |
| 访问 | `http://8.163.127.198:3000` |

---

## 本手册已与代码核对（2026-06）

以下条目已对照 `package.json`、`ecosystem.config.cjs`、`server.ts`、`siteAccessGate.ts` 验证：

| 操作 | 结论 |
|------|------|
| `npm run build:prod` | ✅ 同时产出 `dist/` + `dist-server/server.mjs` |
| `pm2 start ecosystem.config.cjs` | ✅ 进程名 `gemini-deploy`，`cwd` 为仓库根 |
| 生产读 `.env` | ✅ 从仓库根加载（与 `dist-server/` 无关） |
| `NODE_ENV=production` | ✅ PM2 已设；`.env` 勿写 `development` |
| 生产 `ACCESS_CODE` | ✅ 必填 ≥8 位，且不得为 `liu888`，否则进程 `exit(1)` |
| 重启后数据 | ✅ 在磁盘；见下方「持久化路径」 |
| `git reset --hard` 更新 | ✅ 不删未跟踪的 `uploads/`；**勿**再跟踪 `projects.db` / `data/` |

---

## 线上持久化路径（PM2 重启 / 服务器 reboot 不丢）

| 路径 | 内容 |
|------|------|
| `projects.db` | 分镜项目、生图元数据 |
| `data/canvases/` | 无限画布 JSON |
| `data/canvas-workflow-templates/` | 用户工作流模板 |
| `public/uploads/` | 上传与 AI 落盘图片 |

---

## 一、本地开发

```powershell
cd <你的仓库路径>
npx kill-port 3000   # 端口按本地 .env 的 PORT 调整
npm run dev
```

本地验证通过后再 `git push`。可选：`npm run build:prod`（比 `node init.mjs` 更贴近生产；`init.mjs` 仅跑前端 build，不含 server bundle）。

---

## 二、推送代码

```powershell
git add .
git commit -m "简述改动"
git push origin deploy
```

**勿提交：** `.env`、`public/uploads/*` 真实图片、`projects.db`、`data/canvases/*.json`（已在 `.gitignore`）。

---

## 三、首次上线（空白线上环境）

```bash
apt update && apt install -y git curl
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm i -g pm2

mkdir -p /var/www && cd /var/www
git clone -b deploy https://github.com/1378973842-cmd/my-storyboard-site.git my-storyboard-site
cd /var/www/my-storyboard-site

cp .env.example .env
nano .env
```

`.env` 最少配置：

```env
ACCESS_CODE=至少8位的强暗号
PORT=3000

THIRD_PARTY_API_BASE=...
THIRD_PARTY_API_KEY=...
APIMART_API_KEY=...
STORYBOARD_IMAGE_API_KEY=...
```

其余见 `.env.example`。**不必**在 `.env` 写 `NODE_ENV`（PM2 已设为 `production`）。

```bash
npm ci
npm rebuild better-sqlite3
npm run build:prod

# 确保业务目录存在（首次为空）
mkdir -p data/canvases public/uploads data/canvas-workflow-templates

pm2 start ecosystem.config.cjs --env production
pm2 save
pm2 startup    # 按提示执行一行 sudo 命令

pm2 status
pm2 logs gemini-deploy --lines 30
```

阿里云安全组放行 **TCP 3000**（或你的 `PORT`）。

---

## 四、日常更新（保留线上已有数据）

```bash
cd /var/www/my-storyboard-site
git fetch origin deploy
git reset --hard origin/deploy

npm ci
npm rebuild better-sqlite3
npm run build:prod

pm2 restart gemini-deploy --update-env
pm2 save
```

**不要**在更新时删除 `projects.db`、`data/`、`public/uploads/`，除非故意清空线上。

---

## 五、备份（线上有数据后）

```bash
cd /var/www/my-storyboard-site
tar czf ~/backup-$(date +%Y%m%d).tar.gz \
  projects.db data/ public/uploads/ .env
```

建议同步到 OSS 或本机硬盘；ECS 系统盘可开自动快照。

---

## 六、故障排查

### 502 / 进程不存在

ECS 重启后若报 `storyboard not found` 或找不到进程：旧手册进程名已废弃，应使用 **`gemini-deploy`**。

```bash
cd /var/www/my-storyboard-site
pm2 start ecosystem.config.cjs --env production
pm2 save
```

### 改了暗号或 API Key 不生效

```bash
nano /var/www/my-storyboard-site/.env
pm2 restart gemini-deploy --update-env
```

### `npm run build:prod` 被 Killed（2G 内存）

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
npm run build:prod
```

### 启动即退出：ACCESS_CODE

生产环境必须设置 ≥8 位且非 `liu888` 的 `ACCESS_CODE`，见 `src/services/siteAccessGate.ts`。

### better-sqlite3 报错

```bash
npm rebuild better-sqlite3
pm2 restart gemini-deploy
```

---

## 七、与 V1.0 手册差异速查

| V1.0 | V2.0 |
|------|------|
| `pm2 restart storyboard` | `pm2 restart gemini-deploy --update-env` |
| `npm run build` | `npm run build:prod` |
| 手册内明文 SSH 密码 | **禁止**；请改密码并用密钥 |
| 默认以为线上=本地数据 | **线上独立空白**；数据只在服务器磁盘增长 |
| 只备份 `projects.db` | 备份 `projects.db` + `data/` + `uploads/` + `.env` |

---

## 八、站长备忘

- 本地与线上**两套数据**，部署时不拷贝本地图片/画布。
- `.env` **只存在于服务器**，Git 不同步。
- 40G 系统盘够起步；图片主要在 `public/uploads/` 增长。
- ECS 控制台「重启实例」后若 502，执行 `pm2 start` + `pm2 save`。
