# 跨会话交接报告 (Handoff)

- **当前进度**：
  1. **线上**：`deploy` @ `37ea8d0`（版本号功能 + version.json no-cache 修复）。
  2. **部署版本号（已上线）**：`dist/version.json` 现为 `v1.0.{git 提交总数}`（如 `v1.0.91`），并附 `revision`（短哈希）+ `builtAt`；头像菜单底部显示版本号；部署报告带上版本号；`version.json` 已设 `no-cache`（否则客户端 1 天缓存会拖慢新版本检测）。
  3. **画布缩略图（已上线）**：画布图片节点/生成图台/叠卡 peek/历史缩略卡走 WebP 缩略图（`/uploads/gallery/*_thumb.webp`，1024px），AI 落盘与上传时同步生成；放大/编辑/下载仍读原图。存量图已跑 `node scripts/build-upload-thumbnails.mjs` 补齐（2742 张 → 363M，0 失败）。
  4. **放大查看（已上线）**：点开先用缩略图占位、原图后台加载完再无缝换高清；关闭不清空已解码位图，再次打开同一张秒开。
  5. **gzip + 缓存（已上线）**：`compression` 中间件 gzip 压缩 JS/CSS；带 hash 的 `dist/assets/*` 设 `immutable` 一年，`index.html` `no-cache`，其余静态资源 1 天；部署脚本每次自动清旧 `dist/assets`（107M → 3.7M）。
  6. **扩图暂关**：`IMAGE_EXPAND_ENABLED = false`（恢复改 true）。
  7. 远端备份：`/root/studio-backups/studio-20260819-142158.tar.gz`（约 6.4G）；策略留 3 份。
- **⚠️ 部署顺序**：版本号取自 `git rev-list --count HEAD`，**必须先 commit 再 build 再 deploy**，否则线上版本号会比实际少 1（本次已踩坑：先 build 后 commit 导致线上 90，重构建补成 91）。
- **验证状态**：`node init.mjs`（typecheck + build）✅；生产 PM2 online；健康检查 HTTP 200；线上 `version.json` = `v1.0.91`（2026-08-19）。
- **本地网站**：`http://localhost:3005`。
- **访问**：`http://8.163.127.198:3000`
- **流程**：每次生产部署成功后，必须写一份 DreamGrid「系统消息」体例更新报告；默认只给文案，导演点头后再发站内公告。
- **待办**：日间选中色是否改钴蓝待导演拍板。
- **已知未覆盖（需导演决定是否继续）**：
  1. 画布「选择画布」入口页（`.canvas-gate`）仍是炭黑。
  2. Loop 节点内部少数浅色文字白底下略淡。
  3. 历史用户无 `login_events` 回填（仅新登录起有记录）。
  4. 旧画布 JSON 里的本板 logs 不再展示；新失败从本次改动起才进管理员报错日志。
  5. 大板仍无视口虚拟化；缩略图已上线，图极多时切板后新板首屏仍可能顿一下。
- **Blockers**：视频剪辑无服务端 ffmpeg；关标签后任务归属仍依赖 sessionStorage（见 AG223）。

## 新对话开场白（复制给 Agent）

```
继续 gemini-deploy。先读 docs/HANDOFF.md。
线上 deploy @ 37ea8d0。版本号 v1.0.N + 缩略图/放大查看/gzip 已上线；扩图入口仍关；gate 选择页仍是深色。
按导演下一条继续。
```
