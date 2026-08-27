# 跨会话交接报告 (Handoff)

- **当前进度**：
  0. **线上生图不认参考图（本次会话，未部署）**：OSS 启用后拖入图只在私有桶、不在本地盘；服务器把站内 `/uploads` 当成公网地址交给 RunningHub，RH 无登录态拿不到像素，nano 当文生图成功返回。已改：`/uploads` 一律读盘或 OSS 直读再上传 RH；拖入 `/api/ai/upload` 双写本地；图片生成节点不再注入「角色造型锁定」（九宫格仍锁）。自检 `npx tsx scripts/uploads-ref-to-rh-check.ts`。
  0. **Mx-Shell / 九宫格参考图被挡住（本次会话，未部署）**：参考图一多就被底栏/右栏裁掉。九宫格 `.input-list` 横排 overflow 改为纵向折行+区内滚动；测高探针补 `--rh-base-w`（600/640，不再按 RH 默认 820 少折行导致壳偏矮）；Premium Agent 左栏可滚、底栏常显；连图后 `scheduleFitRhNodeFrame`。
  0. **透明参考图铺白（本次会话，未部署）**：扩图仍传 alpha（透明=待生成）。图片生成节点 / 视频生成节点 / MJ·niji 参考图在上传 RunningHub 前用 sharp 检测 `hasAlpha`，有则铺白底 PNG 再传，避免 gpt-image-2 把透明当 mask、nano-banana 把透明当空图。画布上的抠图 PNG 不改。`expand_outpaint` 显式 `flattenAlpha: false`。自检 `npx tsx scripts/flatten-alpha-ref-check.ts`。
  0. **阿里云 OSS 素材私有存储（已上线并启用）**：Bucket `dreamgrid-media` @ `oss-cn-guangzhou` 私有读；服务器 `.env` 已写入 `OSS_*` 并 `pm2 restart --update-env`（HTTP 200）。本地仍不配 OSS，继续走 `public/uploads`。启用后新上传/生图会双写 OSS，读取鉴权通过后 302 到签名 URL。AccessKey 曾出现在对话中，建议导演稍后在 RAM 轮换密钥。
     - **新增 `src/services/ossStore.ts`**：统一 OSS 客户端（`ali-oss`，仅 `OSS_BUCKET/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET` 时启用）。提供 `isOssEnabled`/`mapUploadsPathToKey`/`keyToUploadsPath`/`uploadBufferToOss`/`ensureOssObjectUploaded`（懒迁移）/`signUploadsUrl`/`signUrl`/`ossConfigSummary`。`/uploads/...` 站内相对路径 ↔ OSS key（可选 `OSS_PREFIX`）映射，路径穿越防护。
     - **四类落盘改 OSS 优先 + 本地兜底（双写）**：`server.ts` `persistAiImageToLocalStorage`（AI 生图）；`canvasVideoBridge.ts` `persistRemoteVideo`（上游视频）；`infiniteCanvasRoutes.ts` `/api/ai/upload` 与 `/api/asset-library/upload`；`assetLibraryStore.ts` `addAssetItem`/`addAssetItemFromBuffer`（素材库）。均：OSS 启用→优先上传 OSS，仍返回 `/uploads/...` 站内路径（不改前端 `<img>`/`<video>` src）。
     - **读取走签名 URL**：`protectedUploads.ts` `serveProtectedUpload` 鉴权通过后，若 OSS 启用且对象存在（含从本地懒迁移补传）→ `302` 重定向到私有签名 URL（`signUploadsUrl`），浏览器直连 OSS 省服务器带宽；否则本地 `sendFile` 兜底（未配 OSS 行为完全不变）。
     - **懒迁移**：旧 `public/uploads` 文件首次被请求时自动补传 OSS（`ensureOssObjectUploaded` 先 `head` 判断再上传）。
     - 验证：`tsc --noEmit` ✅；`node init.mjs`（含 build）✅；未配 OSS 时服务正常启动+页面正常挂载（本地兜底路径验证）；`ossStore` 纯逻辑自检通过（路径映射/穿越防护/未启用兜底）。
     - ⚠️ 需导演提供 `OSS_REGION/OSS_BUCKET/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET` 写入服务器 `.env` 才真正启用；未填则全链路自动回退本地。
  0. **切换项目卡顿优化（已随 v1.0.105 上线）**：经排查，切换项目「强烈卡顿延迟感」不是等当前画布渲染完，而是两类主线程阻塞——(a) 返回列表时 `loadCanvasList`(含 `loadCanvasCollections`) 网络往返后才全量建卡片 DOM；(b) `openCanvas` 里 `safeRender({ force:true })` 同步 `nodes.forEach(renderNode)` 全量建所有节点 DOM + 算全部连线。已做两处优化：**骨架屏**——`loadCanvasList` 期间先 `showGateListSkeleton()` 填 8 个 `.gate-list-skeleton` 占位（返回列表不再闪现空白/卡死），`renderCanvasList` 再 `hideGateListSkeleton()`；**开板分帧**——`safeRender({ force:true, deferOffViewport:true })` 首帧只渲染视口内节点，其余交 `renderOffViewportNodes` 按每帧 ≤8ms 分帧补齐（`offViewportRenderToken` 防跨板残留，非 defer 全量 render 会 `++` 取消未完成的补帧）。连线几何不依赖节点 DOM（`nodeLayoutSizeForPort` 用缓存 `_layoutW/H`，缺失回退 `n.w/size.w`），故分帧补齐不影响连线定位。验证：`node init.mjs` 通过；浏览器实测返回列表 `is-loading`+8 骨架→27 卡片正常替换，开板即出编辑器、节点跨帧补齐，连接线(24条)完好。
  1. **画布五项检查（本次会话，已实测/未部署）**：
     1. **视频下载封面修复**：`resolveImageActionBarTarget` 对视频节点优先 `coverUrl`，忽略 `_lightboxFocusUrl`，多视频时上方下载=封面视频。
     2. **打组/创建工作流（已实测通过）**：图片生成+视频生成节点可「新建组」（框组）打组成功；选中组出「创建工作流」→ 填模板名称/说明 → 「保存模板」成功落库（`group.items` 保留成员、`history`/`previewRoundUrls`/`url` 剥离、创建/保存按钮无冲突）。已浏览器端到端跑通并核对保存后的模板 JSON。
     3. **线上视频上传慢**：拖入视频改本地 blob 占位秒现 + 后台上传完换真实 URL（`uploadedVideoNodeUrls`/`revokeVideoNodeBlobUrls`/`replaceUploadedVideoNodeUrl`；`serializableCanvasNode` 拦截 `history`/`previewRoundUrls` 的 `blob:`）。
     4. **视频台预览播放**：已确认实现（`genStageVideoPlayerHtml` + `bindGenStageVideoPlayers`：播放/暂停 + 进度条 + 时长 + 静音 + 收藏 + 放大），无需新增。
     5. **历史/素材库/收藏悬停三键**：缩略图悬停显示「查看/使用/下载」（`openCanvasLightboxForUrl`/`downloadCanvasMediaUrl` + `CanvasMaterialLibrary.renderMediaHoverActions` + `.media-hover-actions` CSS）。
  1. **高清放大（本次会话新增，未部署）**：图片生成节点/图片节点上方工具栏在「抠图」旁新增「高清放大」按钮（zoom-in 图标）。点击后像抠图一样进入聚焦面板：原图居中放大，底部浮出工具栏（关闭 + 模型/倍数/主体三个下拉 + 生成按钮），沿用扩图 dock 视觉与开场弹簧动效。点生成后：上传原图到 RunningHub v2 超分应用（appId `2080628963772297217`，走 `POST /openapi/v2/run/ai-app`；图片 `4/image`，模型/倍数/主体 `5/model`/`5/scale`/`5/subject_detection`）→ 新后端 `/api/runninghub/v2/run-ai-app` 提交拿 taskId → `pollRunningHubTask` 轮询（`/api/runninghub/query?version=2` → `/openapi/v2/query`）→ 结果生成一张**新图片节点**（插原图下方并自动连线，框上方带「高清放大」徽标）；失败原位标红。涉及：`canvasEngine.js`（常量 `RUNNINGHUB_UPSCALE_*`、状态 `imageUpscaleState/El/UiWired`、`openImageUpscale`/`closeImageUpscale`/`buildImageUpscaleHtml`/`bindImageUpscaleChrome`/`positionImageUpscaleOverlay`/`runImageUpscaleFromPanel`/`runImageUpscaleJob`/`spawnUpscalePendingImageNode`；`imageActionBarHtmlForTarget` 加按钮、`bindImageActionBar` 加绑定；`applyCompletedRhOutputs`/`failRunningHubTask` 增 `upscale` 分支；`viewportTargetForNodeFocus` 增 `upscale` 分支；`normalizeImageEditOrigin`/`imageEditOriginLabel` 增 `upscale`；`pollRunningHubTask` 传 `version=2`）、`runningHubWorkflows.ts`（新增 `/api/runninghub/v2/run-ai-app` + `/api/runninghub/query` 支持 `version=2`）。⚠️ v2 query 返回结构按 `runningHubStoryboardImage.ts` 既有 `/openapi/v2/query` 约定实现，待实测。
  2. **生成式节点去拉伸手柄（本次会话，未部署）**：生图/生视频（Gen Console）+ 图片节点右下角不再挂 resize-handle（`renderNode` 跳过 `!isGenConsoleNode(node) && node.type !== 'image'`）。`node init.mjs` 已过，尚未 commit。
  3. **抠图（本次会话新增，未部署）**：图片生成节点上方工具栏在「扩图」旁新增「抠图」按钮（魔棒图标）。点击后像扩图一样进入聚焦面板：原图居中放大，底部浮出工具栏（关闭 + 「抠出」提示词输入框 + 生成按钮），沿用扩图 dock 视觉与开场弹簧动效（`is-opening`/`is-open` + `prepareImageEditCanvasFocus` 聚焦）。点生成后：上传原图到 RunningHub 抠图应用（appId `1957864327736913921`，图片字段 `122/image`、提示词字段 `399/text`）→ `/api/runninghub/submit` 提交拿 taskId → `pollRunningHubTask` 轮询 → 透明底结果生成一张**新图片节点**（插原图下方并自动连线，框上方带「抠图」徽标）；失败在原位标红提示。复用现有 RunningHub 后端封装（submit/upload-asset/query），未另起 v2 接口。涉及：`canvasEngine.js`（常量 `RUNNINGHUB_CUTOUT_*`；状态 `imageCutoutState/El/UiWired`；`openImageCutout`/`closeImageCutout`/`buildImageCutoutHtml`/`bindImageCutoutChrome`/`positionImageCutoutOverlay`/`runImageCutoutFromPanel`/`runImageCutoutJob`/`spawnCutoutPendingImageNode`；`imageActionBarHtmlForTarget` 加按钮、`bindImageActionBar` 加绑定；`applyCompletedRhOutputs`/`failRunningHubTask` 增图片节点宿主分支；`viewportTargetForNodeFocus` 增 `cutout` 分支；`positionImageExpandDock`/`clearImageExpandDockPosition` 参数化 hostEl；`normalizeImageEditOrigin`/`imageEditOriginLabel` 增 `cutout`）。
  4. **RH 输出预览增强（上次会话，未部署）**：
     - **视频内联播放**：RH 输出区视频结果直接内嵌播放器（静音/播放/进度/时长/放大），无需再点进灯箱；图片结果仍点击开灯箱。
     - **收藏星**：图片与视频输出左上角均有收藏星，视频也能收藏。
     - **查看全部**：输出结果 >1 时工具栏出现「查看全部」网格切换（2 列可滚），每格可收藏/点击放大；可切回单图视图。
     - **收藏回显提示词**：收藏时把当次 `prompt`/`model`/`media_kind`/`run_ms` 一并写入 `canvas_generations`；「我的收藏」页视频直接内联播放、并回显当时提示词与模型。
     - 涉及：`canvasEngine.js`（`mergeGeneratedOutputs`/`generatedImageRefs`/`outputMetaFor`/`applyCompletedRhOutputs` 补 prompt+model；新增 `rhOutputMediaHtml`/`rhOutputGridHtml`/`bindRhOutputFavoriteButtons`/`bindRhOutputVideoShell`；`rhRenderOutputPane` 重构；`bindOutputLightboxFavorite` 放开视频）、`infinite-canvas.css`（网格/播放器/收藏星样式）、`MyFavoritesPage.tsx`（`isVideoUrl`/`isVideoFavorite` + 视频内联渲染）。
  5. **线上**：`deploy` @ `0b01114`（v1.0.105：切换项目骨架屏+分帧渲染+切板闪一下修复；OSS 代码已随包上线但未配密钥所以仍走本地盘）。
  6. **拖入/粘贴占位（已上线）**：图片拖入/粘贴先用 `URL.createObjectURL` 本地占位立即显示，原图后台上传完再换真实 URL 落盘；`serializableCanvasNode` 拦截 `blob:` 不落盘防死链。
  7. **部署版本号（已上线）**：`dist/version.json` 为 `v1.0.{git 提交总数}`（线上 `v1.0.105`），附 `revision` + `builtAt`。
  8. **扩图已重开（只用 RunningHub）**：gpt-image-2 透明通道单图方案；nano 已移除；比例对齐已修复（吸附预设比例）。⚠️ 仍待实测 gpt i2i 对透明通道的生成式边界。
  9. 远端备份：最新 `/root/studio-backups/studio-20260824-134108.tar.gz`（7.1G）；策略留 3 份。备份脚本已兼容 uploads 打包中途被写入（tar exit 1 仍保留包）。
- **验证状态**：`node init.mjs`（typecheck + build）✅；生产 PM2 online；健康检查 HTTP 200；本次已部署上线 v1.0.105（`0b01114`）。
- **本地网站**：`http://localhost:3005`。
- **访问**：`http://8.163.127.198:3000`
- **流程**：每次生产部署成功后，必须写一份 DreamGrid「系统消息」体例更新报告；默认只给文案，导演点头后再发站内公告。
- **待办**：日间选中色是否改钴蓝待导演拍板；高清放大/抠图仍待导演实测 RunningHub 真实返回（透明底 PNG / v2 query 结构）；透明参考图铺白待导演用抠图连生图/生视频实测。
- **已知未覆盖（需导演决定是否继续）**：
  1. 画布「选择画布」入口页（`.canvas-gate`）仍是炭黑。
  2. Loop 节点内部少数浅色文字白底下略淡。
  3. 历史用户无 `login_events` 回填（仅新登录起有记录）。
  4. 旧画布 JSON 里的本板 logs 不再展示；新失败从本次改动起才进管理员报错日志。
  5. 大板仍无视口虚拟化；缩略图已上线，图极多时切板后新板首屏仍可能顿一下。
- **Blockers**：视频剪辑无服务端 ffmpeg；关标签后任务归属仍依赖 sessionStorage（见 AG223）；扩图剩余待实测 gpt i2i 生成式边界；抠图待实测 RunningHub 抠图工作流真实返回（透明底 PNG 落板）；高清放大待实测 RunningHub v2 提交/查询（`/openapi/v2/run/ai-app` + `/openapi/v2/query`）真实返回结构与 `fieldData` 兼容性。透明参考图铺白（生图/生视频）待连抠图实测。**OSS 集成**：需导演提供阿里云 OSS 密钥（`OSS_REGION/OSS_BUCKET/OSS_ACCESS_KEY_ID/OSS_ACCESS_KEY_SECRET`）写入服务器 `.env` 才能真正启用；未填则自动回退本地（当前验证均基于未启用路径）。

## 新对话开场白（复制给 Agent）

```
继续 gemini-deploy。先读 docs/HANDOFF.md。
本次已部署上线 v1.0.105（deploy @ 0b01114）。本地未部署：透明参考图在生图/生视频上传前铺白；扩图仍传 alpha。
高清放大/抠图仍待导演实测 RunningHub 真实返回。
gate 选择页仍是深色。
按导演下一条继续。
```
