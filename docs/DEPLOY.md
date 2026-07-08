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

## 本手册已与代码核对（2026-06-26）

以下条目已对照 `package.json`、`ecosystem.config.cjs`、`server.ts`、`userAuth.ts` 验证：

| 操作 | 结论 |
|------|------|
| `npm run build:prod` | ✅ 同时产出 `dist/` + `dist-server/server.mjs` |
| `pm2 start ecosystem.config.cjs` | ✅ 进程名 `gemini-deploy`，`cwd` 为仓库根 |
| 生产读 `.env` | ✅ 从仓库根加载（与 `dist-server/` 无关） |
| `NODE_ENV=production` | ✅ PM2 已设；`.env` 勿写 `development` |
| 生产登录 | ✅ 邮箱 + 密码（`SESSION_SECRET` + `ADMIN_EMAIL` + `ADMIN_PASSWORD`） |
| 生产 APIMart（大陆 ECS） | ✅ 建议 `APIMART_API_BASE=https://api.apib.ai`（见第六节） |
| 重启后数据 | ✅ 在磁盘；见下方「持久化路径」 |
| `git reset --hard` 更新 | ✅ 不删未跟踪的 `uploads/`；**勿**再跟踪 `projects.db` / `data/` |

> **已废弃：** 旧版全站暗号 `ACCESS_CODE`（`siteAccessGate.ts`）**不再用于主线服务**。`.env.example` 里若仍注释提及，可忽略；上线以邮箱登录为准。

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

## 二点六、SSH 密钥免密部署（推荐，Agent 可自动部署）

本机生成密钥（仅需一次）：

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519" -N '""' -C "lhz-gemini-deploy"
```

**最后一次**用密码把公钥和 RunningHub 变量写入服务器（密钥勿提交 Git）：

```powershell
cd "D:\刘恒志\代码\gemini-deploy"
$env:DEPLOY_SSH_PASS = '你的服务器密码'
$env:RUNNINGHUB_API_KEY = '你的 RunningHub Key'
node scripts/setup-ssh-and-env.mjs
```

成功后本机可免密：

```powershell
ssh root@8.163.127.198
```

日常部署（无需密码）：

```powershell
git push origin deploy
npm run build:prod
node scripts/deploy-remote-once.mjs
```

`deploy-remote-once.mjs` 会优先读 `~/.ssh/id_ed25519`；仅在没有密钥时才回退 `DEPLOY_SSH_PASS`。

---

## 二点五、服务器 `.env` 配置（首次上线 / 损坏恢复）

`.env` **只存在于服务器**，Git 不会同步。推荐流程：

### A. 从本地拷贝 API Key（与本机一致）

在本机 **新开 PowerShell**：

```powershell
scp "D:\刘恒志\代码\gemini-deploy\.env" root@8.163.127.198:/var/www/my-storyboard-site/.env
```

### B. 在服务器上单独补生产专用项

SSH 里**一行一行**执行（勿整段粘贴）：

```bash
cd /var/www/my-storyboard-site
sed -i '/^\.env:/d' .env
sed -i '/^ACCESS_CODE=/d' .env
sed -i 's/^PORT=.*/PORT=3000/' .env
```

用 `nano .env` 确认或追加（**首次上线必填**）：

```env
PORT=3000
SESSION_SECRET=至少32位随机字符串
ADMIN_EMAIL=admin@your-studio.com
ADMIN_PASSWORD=至少8位强密码

# 大陆 ECS 必填：gemini-3.5-flash / 九宫格 Phase A 走 APIMart 兼容网关
APIMART_API_BASE="https://api.apib.ai"
APIMART_API_KEY="sk-……"
APIMART_DNS_FIX="0"

# RunningHub 工作流 / AI 应用
RUNNINGHUB_API_KEY="你的-runninghub-api-key"
RUNNINGHUB_API_BASE="https://www.runninghub.cn"
```

也可用 `node scripts/setup-ssh-and-env.mjs` 自动写入（见 **二点六**）。

自检：

```bash
grep -E '^(PORT|SESSION_SECRET|ADMIN_EMAIL|APIMART_API_BASE|APIMART_API_KEY)=' .env
```

| 变量 | 本地 | 线上 |
|------|------|------|
| API Key 等 | 与 `.env` 相同 | scp 拷贝后按上表补全 |
| `SESSION_SECRET` / `ADMIN_*` | 开发可缺省或用弱默认值 | **必填**；勿用 `admin123456` |
| `APIMART_API_BASE` | 可用默认 `api.apimart.ai` | **大陆 ECS 建议 `https://api.apib.ai`** |
| `PORT` | 可能是 `3005` | **固定 `3000`**（与安全组一致） |
| `RUNNINGHUB_API_KEY` | 本地 `.env` | 线上必填才能用 RH 工作流测试 |
| `ACCESS_CODE` | 已废弃 | **删除**；勿再配置 |

**不要**在服务器 `.env` 写 `NODE_ENV=development`（PM2 已是 `production`）。

### C. 启动后自检

```bash
pm2 restart gemini-deploy --update-env
pm2 logs gemini-deploy --lines 8 --nostream
```

成功标志：

- `injecting env (15)` 或更多（若只有 `(2)` 说明 `.env` 被粘贴命令弄坏，重新 scp）
- `Server running on http://localhost:3000`
- 无 `[auth] 生产环境必须在 .env 设置 SESSION_SECRET` 等启动报错
- 浏览器打开站点出现**邮箱登录**页（不是旧版暗号输入框）

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
PORT=3000
SESSION_SECRET=至少32位随机字符串
ADMIN_EMAIL=admin@your-studio.com
ADMIN_PASSWORD=至少8位强密码

THIRD_PARTY_API_BASE=...
THIRD_PARTY_API_KEY=...
APIMART_API_BASE="https://api.apib.ai"
APIMART_API_KEY=...
APIMART_DNS_FIX="0"
STORYBOARD_IMAGE_API_KEY=...
```

其余见 `.env.example`。**不必**在 `.env` 写 `NODE_ENV`（PM2 已设为 `production`）。首次启动会用 `ADMIN_*` 创建管理员；之后在站内「用户管理」为同事建号。

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

> **2G 内存 ECS（当前 8.163.127.198）推荐流程：** 本地 build + scp 产物；**不要在服务器跑 `npm run build:prod`**（易 OOM、SSH 卡死）。  
> **切勿 `scp -r dist`**：`dist/uploads/` 是本地开发机落盘的图片（约 8GB+），与线上 `public/uploads/` 无关，传了会极慢且污染线上。

### 4.1 推荐流程（本地 build + 只传代码产物）

**第 1 步 — 本地推送代码**

```powershell
cd "D:\刘恒志\代码\gemini-deploy"
git push origin deploy
npm run build:prod
```

**第 2 步 — 服务器拉代码（SSH）**

```bash
cd /var/www/my-storyboard-site
git fetch origin deploy
git reset --hard origin/deploy
npm ci
npm rebuild better-sqlite3
```

**第 3 步 — 本地上传 build 产物（PowerShell，分 3 条；每条输完密码等结束）**

```powershell
cd "D:\刘恒志\代码\gemini-deploy"

# 只传 JS/CSS/canvas 脚本，不传 uploads
scp -r dist/assets dist/canvas root@8.163.127.198:/var/www/my-storyboard-site/dist/

# 首页 + dist 根目录静态资源（png/glb 等）
scp dist/index.html dist/*.png dist/*.glb root@8.163.127.198:/var/www/my-storyboard-site/dist/

# 服务端 bundle
scp -r dist-server root@8.163.127.198:/var/www/my-storyboard-site/
```

**禁止上传：**

| 路径 | 原因 |
|------|------|
| `dist/uploads/` | 本地 AI 落盘图，与线上数据无关，体积巨大 |
| `public/uploads/` | 线上自有上传，勿覆盖 |
| `projects.db`、`data/` | 线上业务数据 |

若误传了 `dist/uploads/`，SSH 里删除即可（不影响 `public/uploads/`）：

```bash
rm -rf /var/www/my-storyboard-site/dist/uploads
```

**第 4 步 — 服务器重启 PM2（SSH）**

```bash
cd /var/www/my-storyboard-site
ls dist/index.html dist/assets dist/canvas dist-server/server.mjs
pm2 restart gemini-deploy --update-env
pm2 save
pm2 list
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000
```

浏览器打开 http://8.163.127.198:3000 ，**Ctrl+Shift+R** 强刷。

**ECS 整机重启后：** `pm2 list` 为空时改用 `pm2 start ecosystem.config.cjs --env production`（不是 `restart`），再 `pm2 save`。

### 4.2 备选：在服务器 build（仅 4G+ 内存或已加 swap）

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

2G 无 swap 时见第六节「build 被 Killed / SSH 无响应」。

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

### 改了 `.env`（登录、APIMart、API Key）不生效

```bash
nano /var/www/my-storyboard-site/.env
pm2 restart gemini-deploy --update-env
```

### `npm run build:prod` 被 Killed / SSH 无响应（2G 内存）

**现象：** 服务器 build 卡在 `transforming … three-mesh-bvh`；SSH 空白无输出、或 `Connection closed` / `banner exchange timeout`；网站 3000 超时。

**原因：** 2G 内存无 swap，Vite 生产 build 占满内存，sshd 无法响应。

**推荐修复（不必 VNC）：** 阿里云控制台或 App **重启实例** → 恢复 SSH 后按 **第四节 4.1** 本地 build + scp，**不要在服务器再 build**。

**若必须在服务器 build：** 先加 swap 再 build：

```bash
fallocate -l 2G /swapfile && chmod 600 /swapfile
mkswap /swapfile && swapon /swapfile
npm run build:prod
```

仍建议长期改用 **4.1 本地 build + scp**。

### 启动即退出：登录配置（SESSION_SECRET / ADMIN）

生产环境 `NODE_ENV=production` 时，`validateAuthForDeploy()` 要求：

- `SESSION_SECRET` ≥ 32 位
- `ADMIN_EMAIL` + `ADMIN_PASSWORD`（≥ 8 位）

日志若出现 `[auth] 生产环境必须在 .env 设置 SESSION_SECRET` 或管理员相关报错：

1. 按 **「二点五、服务器 .env 配置」** 补全上述变量。
2. `pm2 restart gemini-deploy --update-env`

若 `injecting env (2)` 远少于正常条数，说明 `.env` 被粘贴命令损坏（可能出现 `.env:SESSION_SECRET=...` 等非法行），请重新 `scp` 并 `sed -i '/^\.env:/d' .env`。

### 九宫格 / Gemini 文本：`fetch failed`（大陆 ECS · APIMart）

**现象：** 浏览器 Network 里 `POST /api/generate-9grid` 返回 500，响应类似：

```json
{ "error": "分镜提示词生成失败: fetch failed", "meta": { "status": 0, "attempt": 4 } }
```

**原因：** 广州/大陆阿里云 ECS 往往**无法稳定访问**默认 `https://api.apimart.ai`（DNS 或出站网络），导致 Phase A 文本 LLM 请求在 TCP 层失败（`status: 0` 不是 401/502）。

**修复（已在 8.163.127.198 实测）：** 服务器 `.env` 改用兼容网关：

```env
APIMART_API_BASE="https://api.apib.ai"
APIMART_API_KEY="你的 APIMart Key"
APIMART_DNS_FIX="0"
```

保存后：

```bash
pm2 restart gemini-deploy --update-env
```

**验证出站网络：**

```bash
curl -I --connect-timeout 10 https://api.apib.ai
curl -I --connect-timeout 10 https://api.apimart.ai   # 大陆机房常失败，属预期
```

- `api.apib.ai` 通、应用仍失败 → 查 Key 是否有效、`pm2 logs` 具体报错。
- 两者都不通 → 查 ECS **出站 443** 与安全组/防火墙。

**说明：** 本地开发机（Windows）可能仍能用默认 `api.apimart.ai`；**线上与本地 APIMART_API_BASE 可以不同**，以各自网络实测为准。

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
sed -i '/^ACCESS_CODE=/d' .env
grep -E '^(PORT|SESSION_SECRET|ADMIN_EMAIL|APIMART_API_BASE)=' .env
```

若 API Key 行大量缺失，从本机重新 `scp .env` 后再补 `SESSION_SECRET`、`ADMIN_*`、`PORT=3000` 与 APIMart 镜像地址。

### better-sqlite3 报错

```bash
npm rebuild better-sqlite3
pm2 restart gemini-deploy
```

### 无限画布节点全消失（logs 仍在）

**现象：** 打开某张画布后节点/图片全空，但生成记录（logs）还在；`data/canvases/<id>.json` 里 `nodes: []`。

**优先顺序：**

1. 看同目录 `<id>.json.bak` 是否仍有节点（防护代码上线后，`.bak` 会保留最后一次「有节点」的版本）。
2. 若 `.bak` 也空，但 `logs[]` 里有大量 `status: "success"` 且带 `outputs`，用仓库脚本**恢复 Output 画廊**（生成器/连线/布局无法还原）。

**本地：**

```powershell
cd <你的仓库路径>
npm run recover:canvas-output -- <canvasId> --dry-run
npm run recover:canvas-output -- <canvasId>
```

**线上（SSH 进服务器后，在仓库根目录）：**

```bash
cd /var/www/my-storyboard-site
node scripts/recover-canvas-output-from-logs.mjs <canvasId> --dry-run
node scripts/recover-canvas-output-from-logs.mjs <canvasId>
pm2 restart gemini-deploy
```

- `<canvasId>` 为文件名去掉 `.json`，例如 `78068d3de1f0454e93d50f1b15acf8b2`。
- 脚本会先备份为 `<id>.json.pre-recover`，再写入 1 个 Output 节点。
- 若画布上**已有节点**且仍要覆盖，加 `--force`（慎用）。
- 恢复后在浏览器**硬刷新**并重新打开该画布。

**预防：** 部署含「拒绝空 nodes 覆盖」的 `infiniteCanvasStore.ts` 与 `canvasEngine.js` 后再观察；服务端日志可见 `[canvas-store] blocked empty nodes overwrite`。

### API 需登录（2026-06 起）

以下接口未登录会返回 `401`，需先通过 `/api/auth/login` 获取 `sb_session_v1` Cookie：

- `/api/projects/*`、 `/api/canvases/*`、 `/api/canvas-workflow-templates/*`
- `/api/config`、 `/api/generate-*`、 `/api/edit-image`、画布 Agent 等

生产环境务必配置 `.env` 中的 `SESSION_SECRET`（≥32 位）、`ADMIN_EMAIL`、`ADMIN_PASSWORD`；建议尽快上 HTTPS 并设 `AUTH_COOKIE_SECURE=1`、`TRUST_PROXY=1`（见下方 **HTTPS 反代**）。

**数据隔离（2026-06）：**

- 新建画布 / 分镜项目会绑定当前登录用户；管理员可见全部。
- 无 `owner_id` / `user_id` 的旧数据：任一已登录用户可读写（团队 legacy 池）。
- `/uploads/*` 需登录；文件归属见 `file_ownership`，公共画廊已分享图全员可读。

---

## 七、与 V1.0 手册差异速查

| V1.0 | V2.0 |
|------|------|
| `pm2 restart storyboard` | `pm2 restart gemini-deploy --update-env` |
| `npm run build` | `npm run build:prod` |
| 全站暗号 `ACCESS_CODE` | 邮箱登录 + `SESSION_SECRET` / `ADMIN_*` |
| 默认 `api.apimart.ai`（大陆 ECS） | 建议 `APIMART_API_BASE=https://api.apib.ai` |
| 手册内明文 SSH 密码 | **禁止**；请改密码并用密钥 |
| 默认以为线上=本地数据 | **线上独立空白**；数据只在服务器磁盘增长 |
| 只备份 `projects.db` | 备份 `projects.db` + `data/` + `uploads/` + `.env` |

---

## 八、站长备忘

- 本地与线上**两套数据**，部署时不拷贝本地图片/画布。
- **`scp -r dist` 会带上 `dist/uploads/`（本地图，8GB+）— 禁止。** 只 scp `dist/assets`、`dist/canvas`、`dist/index.html`、`dist/*.png`、`dist/*.glb`、`dist-server`（见 **4.1**）。
- `.env` **只存在于服务器**，Git 不同步。
- 40G 系统盘够起步；图片主要在 **`public/uploads/`**（线上）增长，不在 `dist/uploads/`。
- ECS 控制台「重启实例」后若 502 或 `pm2 list` 为空，执行 `pm2 start ecosystem.config.cjs --env production` + `pm2 save`。
- `git add .` 前确认不含 `ComfyTV-main/`（`git reset ComfyTV-main`）。

---

## 九、HTTPS 反代（推荐）

当前 ECS 若直接用 `http://IP:3000`，登录 Cookie 明文传输，存在被嗅探风险。建议用 **Caddy** 或 Nginx 终结 TLS，Node 仍监听 `3000`。

### Caddy 示例（域名 `studio.example.com`）

```bash
apt install -y caddy
cat >/etc/caddy/Caddyfile <<'EOF'
studio.example.com {
    reverse_proxy 127.0.0.1:3000
}
EOF
systemctl reload caddy
```

服务器 `.env` 追加：

```bash
TRUST_PROXY=1
AUTH_COOKIE_SECURE=1
PORT=3000
```

然后 `pm2 restart gemini-deploy --update-env`。浏览器访问 `https://studio.example.com`。

阿里云安全组放行 **443**；可关闭公网 **3000** 直连，仅本机 `127.0.0.1:3000` 供反代使用。

---

## 十、日常更新检查清单（2026-07-02）

- [ ] 本地 `git push origin deploy` + `npm run build:prod` 成功
- [ ] 服务器 `git reset --hard origin/deploy` + `npm ci` + `npm rebuild better-sqlite3`
- [ ] 本地 scp **仅** `dist/assets`、`dist/canvas`、`dist/index.html`、`dist/*.png`、`dist/*.glb`、`dist-server`（**未** scp `dist/uploads`）
- [ ] `pm2 restart gemini-deploy --update-env`（重启后若进程为空则 `pm2 start`）+ `pm2 save`
- [ ] `curl 127.0.0.1:3000` 返回 200；浏览器强刷可登录

## 十一、首次上线检查清单（2026-06-26）

- [ ] 本地 `git push origin deploy` 成功
- [ ] 服务器 `git reset --hard origin/deploy`；build 见 **4.1**（2G 机器本地 build + scp）或 **4.2**（大内存服务器 build）
- [ ] `scp` 本地 `.env` 到服务器；删除 `ACCESS_CODE`；设 `PORT=3000`
- [ ] 服务器 `.env` 含 `SESSION_SECRET`（≥32 位）、`ADMIN_EMAIL`、`ADMIN_PASSWORD`（≥8 位）
- [ ] 大陆 ECS：`APIMART_API_BASE=https://api.apib.ai` 且 `APIMART_DNS_FIX=0`
- [ ] `pm2 logs` 出现 `Server running on http://localhost:3000`；env 注入条数 ≥ 15
- [ ] `curl 127.0.0.1:3000` 返回 200
- [ ] 浏览器 `http://8.163.127.198:3000` 可进，用 `ADMIN_EMAIL` / `ADMIN_PASSWORD` 登录
- [ ] 九宫格或画布 gemini-3.5-flash 试跑无 `fetch failed`
- [ ] `pm2 save` 已执行
