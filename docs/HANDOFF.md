# 跨会话交接报告 (Handoff)

- **当前进度**：
  0. **新视角·3D机位双参考（本次，未部署）**：提交第一张干净原图（身份）+ 第二张 3D 预览截帧（构图/机位，藏网格）。提示词要求跟第二张透视，且不抄纸片拉伸。截帧长边≤1536 JPEG。深度仍是 Depth Anything Small 相对立板，不是真 3D。自检 `node scripts/check-novel-view-orbit.mjs`。
  0. **新视角·深度立板（未部署）**：3D 机位深度改走服务端 `POST /api/canvas/novel-view-depth`（Depth Anything Small，缓存 `data/hf-cache`）。浏览器 HUD 成功显示 **Depth Anything**；失败显示原因（不再只写「平面预览」）。底栏 gpt-image-2 仍是出图模型。自检 `node scripts/check-novel-view-orbit.mjs`。
  0. **灯箱对比按钮/线（未部署）**：对比按钮点击已接回（上次误只绑了双击）。滑杆移进缩放层，裁切用整数像素，放大后再拖线应对齐、不出现旁边多一条边。自检 `node scripts/check-output-compare-layout.mjs`。
  0. **灯箱对比左右都是结果图（未部署）**：原图用裁切窗口，不透明底；只操作 `body` 上打开的灯箱；角标「原图 / 结果」。
  0. **新视角·3D机位（未部署）**：动作条「新视角」改为飞出双选（箭头指向 / 3D机位）。3D 把图当立板、相机绕转（拖=偏航/俯仰，滚轮推拉，滑条调焦段，双击复位）；提交**干净原图** + 数值机位提示词，走同一套 `createCanvasImageTask`（默认 gpt-image-2）。箭头模式仍烙红箭头。自检 `node scripts/check-novel-view-orbit.mjs`。
  0. **新视角（未部署）**：图片节点 / 图片生成节点动作条加「新视角」。图上拖红箭头（尾=机位、尖=拍摄方向；长短=16–200mm 焦段；粗细/滚轮=光圈档；左键纵深推进、右键朝前退出），视角指令按宁工作室公式自动生成；把箭头烙进 PNG 后走图片生成节点同一套 `createCanvasImageTask`（默认 gpt-image-2，可切 nano-banana-pro）。结果落到右侧新图并连线。自检 `node scripts/check-novel-view.mjs`。
  0. **蒙版重绘输入对齐 Qwen LoadImage（未部署）**：查清约定=透明区编辑（Comfy MASK=1−α）；`/api/runninghub/upload-asset` **不** flatten（与扩图 alpha 保留同语义，但扩图走 edit-image/`flattenAlpha:false`，蒙版走 upload-asset 二进制）。**已修两处错配**：(1) LoadImage 改传 RH `fileName`（`rhUploadValueIfNeeded(...,'2')`），勿用 `download_url`（那是标准模型/Topaz；URL 拉取还可能 jpeg 丢 alpha）；(2) 导出改软 alpha（笔刷强度→透明度），去掉 `ma>8` 硬打洞。不恢复客户端贴回。自检 `check-image-repaint-menu.mjs`。
  0. **蒙版灯箱假偏移（未部署）**：结果落地后 `POST /api/canvas/edit-compare-baseline`（sharp rotate→PNG）写入 `_editSourceUrl`；灯箱不再用原 JPEG 对比。
  0. **框选裁错人/贴左上角（未部署）**：坐标只用 keep（原图）natural；crop 带 coordSpace 缩略→原图换算。自检 `check-box-repaint.mjs`。
  0. **框外「像素偏移」真因（未部署）**：灯箱对比假象；服务端 sharp 贴选区 + `compareUrl`。
  0. **框选缝/对齐（未部署）**：默认关几何对齐、stretch 铺满、softstep 羽化 20。
  0. **蒙版重绘改走 Qwen Edit 工作流（未部署）**：RH `workflow/2029197668701970433`；透明 PNG → LoadImage MASK；已去掉整图 gpt edit 与羽化贴回。
  0. **图片重绘入口（未部署）**：动作条「重绘」→ 蒙版重绘 / 框选重绘 均已接。
  0. **图台收回控制台闪/硬隐（未部署）**：收回时控制台先向上淡出，翻牌结束仍选中再淡入贴底；点空白取消选中则跟退场动画卸掉。动作条等翻完再挂。自检 `node scripts/check-video-stage-flip.mjs`。
  0. **线上生图不认参考图（已上线 v1.0.107）**：OSS 启用后拖入图只在私有桶、不在本地盘；服务器把站内 `/uploads` 当成公网地址交给 RunningHub，RH 无登录态拿不到像素，nano 当文生图成功返回。已改：`/uploads` 一律读盘或 OSS 直读再上传 RH；拖入 `/api/ai/upload` 双写本地；图片生成节点不再注入「角色造型锁定」（九宫格仍锁）。自检 `npx tsx scripts/uploads-ref-to-rh-check.ts`。
  0. **Mx-Shell / 九宫格参考图被挡住（已上线 v1.0.107）**：参考图一多就被底栏/右栏裁掉。九宫格 `.input-list` 横排 overflow 改为纵向折行+区内滚动；测高探针补 `--rh-base-w`（600/640，不再按 RH 默认 820 少折行导致壳偏矮）；Premium Agent 左栏可滚、底栏常显；连图后 `scheduleFitRhNodeFrame`。
  0. **透明参考图铺白（已上线 v1.0.107）**：扩图仍传 alpha（透明=待生成）。图片生成节点 / 视频生成节点 / MJ·niji 参考图在上传 RunningHub 前用 sharp 检测 `hasAlpha`，有则铺白底 PNG 再传，避免 gpt-image-2 把透明当 mask、nano-banana 把透明当空图。画布上的抠图 PNG 不改。`expand_outpaint` 显式 `flattenAlpha: false`。自检 `npx tsx scripts/flatten-alpha-ref-check.ts`。待导演用抠图结果连生图/生视频实测。
  0. **阿里云 OSS 素材私有存储（已上线并启用）**：Bucket `dreamgrid-media` @ `oss-cn-guangzhou` 私有读；服务器 `.env` 已写入 `OSS_*`。本地仍不配 OSS，继续走 `public/uploads`。启用后新上传/生图会双写 OSS，读取鉴权通过后 302 到签名 URL。AccessKey 曾出现在对话中，建议导演稍后在 RAM 轮换密钥。
  0. **切换项目卡顿优化（已随 v1.0.105 上线）**：骨架屏 + 开板分帧渲染视口外节点。
  1. **画布五项 / 高清放大 / 抠图 / RH 输出预览（已随此前版本上线，非本次）**：悬停三键、视频 blob 占位上传、打组/工作流、高清放大、抠图、RH 输出内联播放与收藏。高清放大/抠图仍待导演实测 RunningHub 真实返回。
  5. **线上**：`deploy` @ `a66e2d0`（v1.0.107）。用户入口 `https://dreamgrid.cn`（Caddy 反代 127.0.0.1:3000；INPUT 对公网丢弃 :3000）。
  6. **拖入/粘贴占位（已上线）**：图片拖入/粘贴先用 `URL.createObjectURL` 本地占位立即显示，原图后台上传完再换真实 URL 落盘；`serializableCanvasNode` 拦截 `blob:` 不落盘防死链。
  7. **部署版本号（已上线）**：`dist/version.json` 为 `v1.0.{git 提交总数}`（线上 `v1.0.107`），附 `revision` + `builtAt`。
  8. **扩图已重开（只用 RunningHub）**：gpt-image-2 透明通道单图方案；nano 已移除；比例对齐已修复（吸附预设比例）。⚠️ 仍待实测 gpt i2i 对透明通道的生成式边界。
  9. 远端备份：最新 `/root/studio-backups/studio-20260827-181055.tar.gz`（7.1G）；策略留 3 份。备份脚本已兼容 uploads 打包中途被写入（tar exit 1 仍保留包）。
- **验证状态**：本会话 `node scripts/check-novel-view-orbit.mjs` + `node init.mjs` 通过。生产仍为 v1.0.107 / `a66e2d0`（本次未部署）。
- **本地网站**：`http://localhost:3005`。硬刷新后：新视角 → 3D机位，等 Depth Anything 后再转相机发送；出图会带预览构图参考。
- **访问**：`https://dreamgrid.cn`（IP 直连 `:3000` 已被防火墙 DROP，勿再用 `http://8.163.127.198:3000` 测外网）。
- **流程**：每次生产部署成功后，必须写一份 DreamGrid「系统消息」体例更新报告；默认只给文案，导演点头后再发站内公告。
- **待办**：导演硬刷新后实测框选「表情改为悲伤」是否裁到本人脸并贴回正确位置；日间选中色是否改钴蓝待拍板；高清放大/抠图仍待实测。
- **已知未覆盖（需导演决定是否继续）**：
  1. 画布「选择画布」入口页（`.canvas-gate`）仍是炭黑。
  2. Loop 节点内部少数浅色文字白底下略淡。
  3. 历史用户无 `login_events` 回填（仅新登录起有记录）。
  4. 旧画布 JSON 里的本板 logs 不再展示；新失败从本次改动起才进管理员报错日志。
  5. 大板仍无视口虚拟化；缩略图已上线，图极多时切板后新板首屏仍可能顿一下。
  6. 框选融合：未移植 PixelRunner **非等比 stretch** 与 **local-mesh**（PR 默认开）；大角度/局部错位时可能不如 PS 插件。若实测仍有色差/缝，优先考虑 stretch 或 mesh。
- **Blockers**：视频剪辑无服务端 ffmpeg；关标签后任务归属仍依赖 sessionStorage（见 AG223）；扩图剩余待实测 gpt i2i 生成式边界；抠图待实测 RunningHub 抠图工作流真实返回；高清放大待实测；蒙版/框选重绘待导演实测。OSS 已在生产启用。

## 新对话开场白（复制给 Agent）

```
继续 gemini-deploy。先读 docs/HANDOFF.md。
线上仍为 v1.0.107（deploy @ a66e2d0）。
本地未部署：3D机位已交原图+预览双参考；深度仍是 Small 立板。框选仍缺 stretch/local-mesh。
按导演下一条继续。
```
