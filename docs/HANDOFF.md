# 跨会话交接报告 (Handoff)

- **当前进度**：
  1. **线上**：`deploy` @ `a78040b`（拖入/粘贴图片本地 blob 占位，秒现）。
  2. **拖入/粘贴占位（已上线）**：图片拖入/粘贴/填入空白节点/加入图片组，先用 `URL.createObjectURL` 本地占位立即显示，原图后台上传完再换真实 URL 落盘；`serializableCanvasNode` 拦截 `blob:` 不落盘防死链。根治「拖入要等很久/要拖两次出两张」。
  3. **部署版本号（已上线）**：`dist/version.json` 为 `v1.0.{git 提交总数}`（线上 `v1.0.95`），附 `revision` + `builtAt`；头像菜单底部显示；`version.json` 设 `no-cache`。
  4. **⚠️ 部署流程已根治**：`deploy:safe` 现在先 `npm run build:prod` 再备份+部署，`version.json` 永远基于当前 HEAD 生成，不再出现「先 build 后 commit 导致版本号偏小」。
  5. **画布缩略图（已上线）**：画布图片节点/生成图台/叠卡 peek/历史缩略卡走 WebP 缩略图（`/uploads/gallery/*_thumb.webp`，1024px），放大/编辑/下载读原图。
  6. **放大查看（已上线）**：先缩略图占位、原图后台加载完再换高清；关闭复用解码位图。
  7. **gzip + 缓存（已上线）**：`compression` + `dist/assets` immutable 一年 + 部署清旧 assets。
  8. **扩图暂关**：`IMAGE_EXPAND_ENABLED = false`（恢复改 true）。
  9. 远端备份：`/root/studio-backups/studio-20260819-154042.tar.gz`（约 6.5G）；策略留 3 份。
- **验证状态**：`node init.mjs`（typecheck + build）✅；生产 PM2 online；健康检查 HTTP 200；线上 `version.json` = `v1.0.95`（2026-08-19）。
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
线上 deploy @ a78040b。拖入/粘贴 blob 占位 + 版本号 v1.0.95 + 缩略图/gzip 已上线；扩图入口仍关；gate 选择页仍是深色。
按导演下一条继续。
```
