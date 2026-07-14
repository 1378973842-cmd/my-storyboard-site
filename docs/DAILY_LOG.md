# 每日工作记录（Daily Log）

本文件由 `scripts/daily-log.mjs` 维护，用于记录「每天做了什么 / 做完了什么」。

- **自动**：运行 `npm run hooks:install` 后，每次 `git commit` 会自动追加一条提交摘要；也可随时运行 `npm run log:daily` 补全「今天 0 点起」尚未写入的提交。
- **半自动（Cursor Agent）**：会话结束前执行 `npm run log:daily -- --note "……"`，补充 Git 难以表达的结论（例如「已跑通 init.mjs」「待办：xxx」）。
- **与 PM 文档同步**：`docs/feature_list.json` 标记功能完成；`docs/HANDOFF.md` 写当前焦点与 Blockers（由 Agent 在收尾时更新）。

---

## 2026-07-08

### 记录 / 说明
- F006：完成 A1-A3/B1-B4/D1-D2（画布合规、失败反馈、连线流动、缩放控件、bento、导航 pill）

## 2026-07-09

### 记录 / 说明
- 导演台 F008：关键帧删除/时长/草稿/场景树/缓动/分镜互通/路径 Bake
- 导演台深化：关键帧拖动、贝塞尔手柄、运镜回写分镜、备注侧栏
- 导演台：3D可编辑样条 + 口语调机位 API/UI
- 导演台：人偶姿势关键帧（骨骼+比例时间轴插值）
- 第1波审美统一：弹窗/顶栏/分镜/项目管理向封面靠齐，待导演视觉确认
- 第2波：主页只推画布；顶栏收藏画廊铃铛头像玻璃化；收藏/画廊空态；画布门厅琥珀点缀
- 第3波画布提效：Redo、generator/rh增量刷新、Ctrl+K搜索、视口裁剪、Ctrl+L排布
- 第4波：历史生成浏览、批量导出Output、工作流JSON导入导出、素材库点击放置、alert改softAlert
- Mx-Shell 提示词 Agent（AG4）按 skill 落地独立画布节点，待手测；DeepWhite 仍分开
- DeepWhite AG5: skill 100% 对齐 + Agent/View 节点 + /api/canvas/deepwhite-shot

## 2026-07-10

### 记录 / 说明
- AG6: textOutput 统一下游 + Agent 控制台化 + 修复制条遮挡
- textOutput 大屏阅读弹层 + 折叠按钮合并；DeepWhite 导演倾向说明
- Mx-Shell AG7: camera-moves dictionary + four-part assert + intensity UI
- DeepWhite P0-P3: quality gates, still prompts, refs, ninegrid/seedance export, screenwriting agent
- AG12 九宫格自动切格可选收尾：Phase B 可只出整板；DeepWhite 推送默认不切；取消覆盖确认后一键全流程不再继续
- AG12 九宫格自动切格可选收尾：Phase B 可只出整板；DeepWhite 推送默认不切；防 Phase A 误覆盖
- Mx-Shell skill：画面内容增加空间逻辑门（立场面→运镜、同平面禁垂直找人、禁向右拉焦）；未改节点代码
- 排查：DeepWhite 因空词门「电影感」连跪；Mx-Shell skill 已加载但空间规则未进 user/校验。已热修空词误杀+重试与 Mx-Shell 空间要求
- Mx-Shell：回退空间逻辑门 skill/校验，恢复原视频提示词写法（保留四件套与重试回灌）

## 2026-07-13

### 记录 / 说明
- AG13 unified Gen Console: stage+dock for generator; image selection floating dock; Output dual-write
- AG13: Image card + floating wide dock (fig2 two-piece)
- Generator bare-media: no frame/title; softer floating dock
- AG13纠偏：image无框纯图仅右端口、点选无dock；仅generator外挂控制台+上图台
- AG14: Generator no auto Output; preview on stage; right port = current image
- AG15: Generator history badge toggles top thumb strip; cap 24
- AG16: Generator history library panel with prompt/model metadata
- AG17: rename node results; fix send btn text; stage busy anim; link-delete hit

## 2026-07-14

### 记录 / 说明
- AG18: Gen Console周边适配 批量导出/封面/收藏定位/工作流剥离history
