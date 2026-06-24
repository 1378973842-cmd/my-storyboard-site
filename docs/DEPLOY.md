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
git reset ComfyTV-main
git status
```

确认 **`ComfyTV-main/` 不在待提交列表**（该目录与本站无关，已加入 `.gitignore`）。

```powershell
git commit -m "简述改动"
git push origin deploy
```

**勿提交：** `.env`、`public/uploads/*` 真实图片、`projects.db`、`data/canvases/*.json`（已在 `.gitignore`）。

---

## 二点五、服务器 `.env` 配置（首次上线 / 损坏恢复）

`.env` **只存在于服务器**，Git 不会同步。推荐流程：

### A. 从本地拷贝 API Key（与本机一致）

在本机 **新开 PowerShell**：

```powershell
scp "D:\刘恒志\代码\gemini-deploy\.env" root@8.163.127.198:/var/www/my-storyboard-site/.env
```

### B. 在服务器上单独补生产专用项

SSH 里**一行一行**执行：

```bash
cd /var/www/my-storyboard-site
sed -i '/^\.env:/d' .env
sed -i '/^ACCESS_CODE=/d' .env
sed -i 's/^PORT=.*/PORT=3000/' .env
echo 'ACCESS_CODE=你的强暗号至少8位' >> .env
grep -E '^(PORT|ACCESS_CODE|APIMART_API_KEY)=' .env
```

| 变量 | 本地 | 线上 |
|------|------|------|
| API Key 等 | 与 `.env` 相同 | scp 拷贝 |
| `ACCESS_CODE` | 可缺省（默认 `liu888`） | **必填 ≥8 位，不能是 `liu888`** |
| `PORT` | 可能是 `3005` | **建议固定 `3000`**（与旧站、安全组一致） |

**不要**在服务器 `.env` 写 `NODE_ENV=development`（PM2 已是 `production`）。

### C. 启动后自检

```bash
pm2 restart gemini-deploy --update-env
pm2 logs gemini-deploy --lines 8 --nostream
```

成功标志：

- `injecting env (15)` 或更多（若只有 `(2)` 说明 `.env` 被粘贴命令弄坏，重新 scp）
- `Server running on http://localhost:3000`
- 无 `[site-gate]` 报错

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/
```

应返回 **`200`**。

---

## SSH 操作提醒

- **不要用鼠标**点 nano；`Ctrl+O` 保存 → 回车 → `Ctrl+X` 退出。
- **不要一次粘贴多行** bash 命令，容易粘乱（例如 `--nostream1~grep`）。
- 日志用 `pm2 logs gemini-deploy --lines 10 --nostream`（`--nostream` 后不要加别的字符）。

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

日志若反复出现 `[site-gate]`，且 `injecting env (2)` 远少于正常条数：

1. `.env` 可能已被粘贴命令损坏（出现 `.env:ACCESS_CODE=...` 等非法行）。
2. 按上文 **「二点五、服务器 .env 配置」** 重新 `scp` 并修复。
3. `pm2 restart gemini-deploy --update-env`

### 3000 打不开但 3005 能开

本地 `.env` 若 `PORT=3005`，scp 后服务会监听 3005。线上请：

```bash
sed -i 's/^PORT=.*/PORT=3000/' .env
pm2 restart gemini-deploy --update-env
```

浏览器与安全组均使用 **3000**。

### `.env` 损坏快速修复

```bash
cd /var/www/my-storyboard-site
cp .env .env.bak.$(date +%Y%m%d)
sed -i '/^\.env:/d' .env
grep -E '^(PORT|ACCESS_CODE)=' .env
```

若 API Key 行大量缺失，从本机重新 `scp .env` 后再补 `ACCESS_CODE` 与 `PORT=3000`。

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
- `git add .` 前确认不含 `ComfyTV-main/`（`git reset ComfyTV-main`）。

---

## 九、首次上线检查清单（2026-06 实测）

- [ ] 本地 `git push origin deploy` 成功
- [ ] 服务器 `git reset --hard origin/deploy` + `npm run build:prod`
- [ ] `scp` 本地 `.env` 到服务器，并设 `ACCESS_CODE` + `PORT=3000`
- [ ] `pm2 logs` 出现 `Server running on http://localhost:3000`
- [ ] `curl 127.0.0.1:3000` 返回 200
- [ ] 浏览器 `http://8.163.127.198:3000` 可进，暗号用服务器 `.env` 里的值
- [ ] `pm2 save` 已执行
