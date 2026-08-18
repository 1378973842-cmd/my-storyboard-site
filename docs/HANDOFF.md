# 跨会话交接报告 (Handoff)

- **当前进度**：
  1. **线上**：`deploy` @ `e2d15d3`（AG236 生成历史 + HOME17 管理员报错日志）。
  2. **本机未提交**：
     - **AG237**：大板图片还在慢慢出来时切项目会卡住。切板先 `abortCanvasMediaLoads`（掐 src、作废 onload、停几何刷新）；出图 `onload` 改尺寸改为每帧合并；切板不再空等整板保存（后台按 `savedId` 落盘）。
     - **扩图暂关**：`IMAGE_EXPAND_ENABLED = false`（恢复改 true）。
  3. 远端备份：`/root/studio-backups/studio-20260817-122749.tar.gz`（约 5.0G）；策略留 3 份。
- **验证状态**：`node init.mjs` ✅（tsc + lint + vite build 通过，2026-08-18）。
- **本地网站**：`http://localhost:3005`。
- **待办**：日间选中色是否改钴蓝待导演拍板。
- **已知未覆盖（需导演决定是否继续）**：
  1. 画布「选择画布」入口页（`.canvas-gate`）仍是炭黑。
  2. Loop 节点内部少数浅色文字白底下略淡。
  3. 历史用户无 `login_events` 回填（仅新登录起有记录）。
  4. 旧画布 JSON 里的本板 logs 不再展示；新失败从本次改动起才进管理员报错日志。
  5. 大板仍无视口虚拟化 / 缩略图；图极多时切板后新板首屏仍可能顿一下。
- **Blockers**：视频剪辑无服务端 ffmpeg；关标签后任务归属仍依赖 sessionStorage（见 AG223）。

## 新对话开场白（复制给 Agent）

```
继续 gemini-deploy。先读 docs/HANDOFF.md。
线上 deploy @ e2d15d3。本机未提交 AG237：切板中止旧图解码。
扩图入口仍关；gate 选择页仍是深色。
按导演下一条继续。
```
