<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# 分镜网站（Storyboard）本地运行指南

这个项目包含一套完整的本地启动与部署所需配置。

在线预览（AI Studio）：https://ai.studio/apps/deedd0d0-c9f2-49f5-a208-d24d0f900b9e

## 本地运行

### 前置条件
- Node.js（建议使用当前 LTS）

### 1. 安装依赖
在项目根目录（`package.json` 同级）执行：
```sh
npm install
```

### 2. 配置环境变量
复制示例文件并创建 `.env`：
```powershell
copy .env.example .env
```

然后在 `.env` 中填写：
- `THIRD_PARTY_API_BASE`：第三方 OpenAI 兼容网关地址（可带或不带 `/v1`）
- `THIRD_PARTY_API_KEY`：你的 API Key（只填 `sk-...`；不要加 `Bearer ` 前缀）
- `TEXT_MODEL`：文本生成模型 ID（必须与供应商后台一致）
- `IMAGE_MODEL`：生图模型 ID（必须与供应商后台一致）

可选项（当你的网关要求 `image` 字段必须是完整 data URL 时使用）：
- `IMAGE_GEN_REFERENCE_MODE`：
  - `base64`（默认）：从 `data:image/...;base64,...` 中仅传 base64 正文
  - `data_url`：传完整 data URL

完成后重启开发服务。

### 3. 启动
```sh
npm run dev
```

服务启动后打开：
- http://localhost:3000

## 常用命令
```sh
npm run dev      # 开发模式
npm run build    # 构建 dist
npm run preview  # 预览 dist
npm run lint     # TypeScript 检查
```

## 重要说明
- 项目根目录会生成/使用 `projects.db`（SQLite），用于保存本地分镜项目数据。
- `.env` 已在 `.gitignore` 中忽略，请不要提交密钥到仓库。
