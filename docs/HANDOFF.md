# 跨会话交接报告 (Handoff)

- **当前进度**：
  1. **抠图（本次会话新增，未部署）**：图片生成节点上方工具栏在「扩图」旁新增「抠图」按钮（魔棒图标）。点击后像扩图一样进入聚焦面板：原图居中放大，底部浮出工具栏（关闭 + 「抠出」提示词输入框 + 生成按钮），沿用扩图 dock 视觉与开场弹簧动效（`is-opening`/`is-open` + `prepareImageEditCanvasFocus` 聚焦）。点生成后：上传原图到 RunningHub 抠图应用（appId `1957864327736913921`，图片字段 `122/image`、提示词字段 `399/text`）→ `/api/runninghub/submit` 提交拿 taskId → `pollRunningHubTask` 轮询 → 透明底结果生成一张**新图片节点**（插原图下方并自动连线，框上方带「抠图」徽标）；失败在原位标红提示。复用现有 RunningHub 后端封装（submit/upload-asset/query），未另起 v2 接口。涉及：`canvasEngine.js`（常量 `RUNNINGHUB_CUTOUT_*`；状态 `imageCutoutState/El/UiWired`；`openImageCutout`/`closeImageCutout`/`buildImageCutoutHtml`/`bindImageCutoutChrome`/`positionImageCutoutOverlay`/`runImageCutoutFromPanel`/`runImageCutoutJob`/`spawnCutoutPendingImageNode`；`imageActionBarHtmlForTarget` 加按钮、`bindImageActionBar` 加绑定；`applyCompletedRhOutputs`/`failRunningHubTask` 增图片节点宿主分支；`viewportTargetForNodeFocus` 增 `cutout` 分支；`positionImageExpandDock`/`clearImageExpandDockPosition` 参数化 hostEl；`normalizeImageEditOrigin`/`imageEditOriginLabel` 增 `cutout`）。
  2. **RH 输出预览增强（上次会话，未部署）**：
     - **视频内联播放**：RH 输出区视频结果直接内嵌播放器（静音/播放/进度/时长/放大），无需再点进灯箱；图片结果仍点击开灯箱。
     - **收藏星**：图片与视频输出左上角均有收藏星，视频也能收藏。
     - **查看全部**：输出结果 >1 时工具栏出现「查看全部」网格切换（2 列可滚），每格可收藏/点击放大；可切回单图视图。
     - **收藏回显提示词**：收藏时把当次 `prompt`/`model`/`media_kind`/`run_ms` 一并写入 `canvas_generations`；「我的收藏」页视频直接内联播放、并回显当时提示词与模型。
     - 涉及：`canvasEngine.js`（`mergeGeneratedOutputs`/`generatedImageRefs`/`outputMetaFor`/`applyCompletedRhOutputs` 补 prompt+model；新增 `rhOutputMediaHtml`/`rhOutputGridHtml`/`bindRhOutputFavoriteButtons`/`bindRhOutputVideoShell`；`rhRenderOutputPane` 重构；`bindOutputLightboxFavorite` 放开视频）、`infinite-canvas.css`（网格/播放器/收藏星样式）、`MyFavoritesPage.tsx`（`isVideoUrl`/`isVideoFavorite` + 视频内联渲染）。
  3. **线上**：`deploy` @ `a78040b`（拖入/粘贴图片本地 blob 占位，秒现）。
  4. **拖入/粘贴占位（已上线）**：图片拖入/粘贴先用 `URL.createObjectURL` 本地占位立即显示，原图后台上传完再换真实 URL 落盘；`serializableCanvasNode` 拦截 `blob:` 不落盘防死链。
  5. **部署版本号（已上线）**：`dist/version.json` 为 `v1.0.{git 提交总数}`（线上 `v1.0.95`），附 `revision` + `builtAt`。
  6. **扩图已重开（只用 RunningHub）**：gpt-image-2 透明通道单图方案；nano 已移除；比例对齐已修复（吸附预设比例）。⚠️ 仍待实测 gpt i2i 对透明通道的生成式边界。
  7. 远端备份：`/root/studio-backups/studio-20260819-154042.tar.gz`（约 6.5G）；策略留 3 份。
- **验证状态**：`node init.mjs`（typecheck + build）✅（本次抠图改动已通过）；生产 PM2 online；健康检查 HTTP 200。
- **本地网站**：`http://localhost:3005`。
- **访问**：`http://8.163.127.198:3000`
- **流程**：每次生产部署成功后，必须写一份 DreamGrid「系统消息」体例更新报告；默认只给文案，导演点头后再发站内公告。
- **待办**：日间选中色是否改钴蓝待导演拍板；本次抠图 + RH 输出改动**尚未 Git Commit / 未部署**。
- **已知未覆盖（需导演决定是否继续）**：
  1. 画布「选择画布」入口页（`.canvas-gate`）仍是炭黑。
  2. Loop 节点内部少数浅色文字白底下略淡。
  3. 历史用户无 `login_events` 回填（仅新登录起有记录）。
  4. 旧画布 JSON 里的本板 logs 不再展示；新失败从本次改动起才进管理员报错日志。
  5. 大板仍无视口虚拟化；缩略图已上线，图极多时切板后新板首屏仍可能顿一下。
- **Blockers**：视频剪辑无服务端 ffmpeg；关标签后任务归属仍依赖 sessionStorage（见 AG223）；扩图剩余待实测 gpt i2i 生成式边界；抠图待实测 RunningHub 抠图工作流真实返回（透明底 PNG 落板）。

## 新对话开场白（复制给 Agent）

```
继续 gemini-deploy。先读 docs/HANDOFF.md。
本次已新增：图片节点「抠图」按钮（RunningHub app 1957864327736913921，上传→提交→轮询→新节点透明底结果）；RH 输出视频内联播放 + 图片/视频收藏星 + 「查看全部」网格 + 收藏回显 prompt/model；node init.mjs 已过，但尚未 commit/部署。
扩图已修复重开（只用 RunningHub：gpt-image-2 透明通道单图，不传 mask）。
线上 deploy @ a78040b；gate 选择页仍是深色。
按导演下一条继续。
```
