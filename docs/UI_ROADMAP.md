# UI 升级任务书（画布 + 主页）

> 本文档是 2026-07-08 画布/主页 UI 审计后的执行计划，供任何 Agent/模型按序施工。
> 每个任务标注：目标、涉及文件、具体改法、验收标准。**按 Phase 顺序做，每个 Phase 内的任务可独立提交。**

---

## 零、全局铁律（每个任务开工前必读）

1. **改前必须用工具读源码**，禁止凭选择器名猜测上下文。文中行号是 2026-07-08 快照，会漂移，**以选择器/函数名搜索定位为准**。
2. 每完成一个任务运行 `node init.mjs`，通过后才算完成。
3. 视觉规范（来自 `DESIGN.md` / `CLAUDE.md`）：
   - **禁止 1px 及以上实线 border 划分区域**。替代方案二选一：色调偏移（背景亮一阶）或幽灵边框 `outline:0.5px solid` + 低透明度（暗色用 `rgba(255,184,102,.1~.2)` 琥珀或 `rgba(255,255,255,.1~.14)` 白）。
   - 文字禁纯白 `#fff`，用 `#e5e2e1`（暖白场景可用 `#fff6ea`/`#ffe4e6` 等有色变体）。
   - 暗色强调色只有一个：**琥珀 `#ffb866`**，主按钮渐变 `linear-gradient(135deg, rgba(255,184,102,.96), rgba(183,113,0,.88))` + 深字 `#1a1410`。电蓝 `#8dcdff` 仅用于「数据/链接/激活指示」。
   - 阴影要大而淡（blur 40–80px 负 spread，透明度 ≤ 0.5），禁止 `0 1px 3px` 类硬阴影。
   - 动效禁 linear（连续循环如 spinner/虚线流动除外），过渡用 `cubic-bezier(.22,1,.36,1)` 或项目内 `--spring`。
4. **一次不要重写超过 100 行**；能 `StrReplace` 局部替换就不要整段重排。
5. 完成后更新 `docs/HANDOFF.md` 与 `docs/feature_list.json`（对应 task 置 done），提醒导演 commit。

涉及的核心文件：

| 文件 | 说明 |
|------|------|
| `src/components/InfiniteCanvas/infinite-canvas.css` | 画布全部样式，~4000 行，`:root` 浅色 + `.theme-dark` 覆盖 |
| `src/lib/infiniteCanvas/canvasEngine.js` | 画布引擎，~19000 行，模板字符串生成 DOM |
| `src/components/InfiniteCanvas/InfiniteCanvasShell.tsx` | 画布静态壳层 HTML |
| `src/components/HomeTools.tsx`、`src/components/Hero.tsx`、`src/index.css` | 主页 |

CSS 变量现状（`infinite-canvas.css` 第 5–6 行）：浅色 `--line:#e8edf3; --strong:#111827` 等；暗色 `--line:rgba(255,184,102,.12); --strong:#ffb866; --text:#e5e2e1`。

---

## Phase A — 画布 CSS 合规清扫（纯 CSS，低风险）

### A1. 消灭浅色主题节点/表单区的 1px 实线（重灾区）

- **现状**：约 100 处 `border:1px solid`，集中在 900–1500 行的节点内表单：`.prompt-node textarea`（硬编码 `#edf2f7`）、`.gen-settings`、`.setting-input`、`.select-lite`、`.mode-tabs`、`.loop-count-row`、`.loop-toggle`、`.loop-image-panel`、`.media-card`、`.blank-image`、`.output-grid img`、`.llm-mode`、`.llm-system`、`.llm-bubble.assistant`、`.input-item`、`.video-frame-label`、`.replica-*`、`.node` 本体（629 行 `border:1px solid var(--line)`）与 `.node-head`（655 行 `border-bottom`）。
- **做法**（模式化替换，逐个选择器处理）：
  1. `border:1px solid X` → `border:none; outline:0.5px solid <X 的 40% 透明版>; outline-offset:-0.5px;` 同时把控件背景比容器亮一阶（浅色用 `#fff` vs `#f8fafc` 的层级差）。
  2. 虚线 border（`.blank-image`、`.loop-image-panel` 等 drop 区）**保留虚线语义**，但改为 `outline:1px dashed` + 降低对比（浅色 `rgba(148,163,184,.5)`）。
  3. `.node` 本体浅色：`border:none; outline:0.5px solid rgba(148,163,184,.35);`，hover/selected 已有 outline 逻辑不动。
  4. 暗色 `.theme-dark` 已有覆盖的选择器（如 597 行表单批量覆盖）不要动，只处理无 dark 前缀的基础规则。
- **注意**：`.node-head` 圆角 `21px` 是配合 1px border 的补偿值，去 border 后改回 `22px 22px 0 0`。
- **验收**：浅色主题下打开画布，肉眼无「细黑框」；全文件 `border:1px solid`（非 dashed、非 focus 态）剩余 < 10 处且均有豁免理由；`node init.mjs` 通过。

### A2. 模态层暗色化改造（model-panel / image-edit / lightbox / log / error）

- **现状**：约 1682–1950 行整段是浅色 Slate 风（`#fff` 底、`#edf2f7` 边框、`rgba(15,23,42,*)` 硬阴影），`.theme-dark` 补丁零散且不全（1878+ 行）。
- **做法**：
  1. 先审 `.theme-dark` 已覆盖哪些子选择器（搜 `theme-dark .model-panel`、`theme-dark .image-edit`、`theme-dark .output-preview`、`theme-dark .log-panel`、`theme-dark .error-panel`）。
  2. 缺失的补齐，统一模板：面板底 `rgba(28,24,20,.96)` + `backdrop-filter:blur(24px)` + `outline:0.5px solid rgba(255,184,102,.14)` + 阴影 `0 24px 64px -24px rgba(0,0,0,.6)`；标题 `#e5e2e1`；次要文字 `rgba(229,226,225,.72)`；主按钮琥珀渐变（见铁律 3）；次按钮 `rgba(255,255,255,.06)` + 白幽灵 outline。
  3. 浅色基础规则里的硬阴影（如 lightbox `0 30px 90px rgba(15,23,42,.22)`）降不透明度到 ≤ .14。
- **验收**：暗色主题下打开「模型管理、图片编辑、输出灯箱、日志、错误」五个弹层，无浅色残留、无 1px 实线；浅色主题不回归（仍可用）。

### A3. 设计 token 收敛（为后续维护铺路）

- **现状**：圆角 6/9/10/12/14/16/18/22/24/999 并存；字号 9–13.5 散落；字重 650–900 混用；强调色仍有 `#f97316` focus 残留（第 11 行 `button:focus-visible outline rgba(249,115,22,.55)`、第 8 行 selection `rgba(249,115,22,.22)`）。
- **做法**（**只加变量 + 替换引用，不改视觉结果**，除明确列出的两处）：
  1. 在 `.infinite-canvas-root` 上补充：`--radius-node:22px; --radius-panel:16px; --radius-ctl:10px; --radius-pill:999px;`，然后把出现频次最高的圆角值替换为变量（用 grep 统计，一次替换一组，避免误伤）。
  2. 明确改掉的两处不一致：第 8 行浅色 selection 改 `rgba(183,113,0,.2)`；第 11 行 focus-visible 改 `rgba(183,113,0,.55)`（暗色第 12 行已是琥珀，不动）。
  3. 字号/字重本轮**只记录不改**（写进 HANDOFF 备忘），避免 diff 爆炸。
- **验收**：`node init.mjs` 通过；暗浅两主题肉眼无差异（除 selection/focus 两处颜色）。

---

## Phase B — 画布交互与反馈统一（CSS + engine JS，中风险）

### B1. 失败反馈统一：干掉 alert()

- **现状**：单节点运行失败走 `alert()`（`canvasEngine.js` 搜 `alert(`，节点头部注释「仅级联失败显示 failed 徽章」，约 7797 行）；级联失败走 `.node-retry-bar`；三种反馈路径并存。
- **做法**：
  1. 单节点失败改为：设置 `node.runStatus='failed'` + 渲染已有的 `.node-retry-bar`（复用级联失败的 DOM 与重试逻辑，重试按钮改为重跑该节点）。
  2. `alert()` 全部移除或降级为 console.warn；错误详情已有 `.error-modal` 可复用（点击 retry-bar 的消息文本打开）。
  3. 兼顾 `_cascadeFailed` 原路径不回归。
- **验收**：断网/错误 Key 触发单节点失败，节点头出现红色 failed 徽章 + 卡片内 retry 条，无浏览器 alert 弹窗；级联失败行为不变。

### B2. selectionHub 死代码清理

- **现状**：`InfiniteCanvasShell.tsx` 有 `#selectionHub` 占位（约 631 行）；`canvasEngine.js` 的 `renderSelectionHub()` 永远清空、从未 open（约 17115 行）；CSS `.selection-hub` 若干规则。
- **做法**：三处一并删除（Shell DOM、engine 函数及调用点、CSS 规则）。搜 `selectionHub` / `selection-hub` 确认无其他引用。
- **验收**：全局搜索 0 引用；框选/右键选区菜单功能不受影响（`#selectionMenu` 是另一个东西，别删错）。

### B3. 连线常态视觉升级（可选增强）

- **现状**：永久连线是静态蓝 `rgba(141,205,255,.45)`；仅拖拽临时线有流动（2026-07-08 已加 `linkDashFlow`）。
- **做法**：
  1. 「运行中」的链路加流动：engine 里节点 running 时给相关 `path.link` 加 class `link-flowing`（找 `refreshNodes`/`renderLinks` 里状态同步点），CSS：`stroke-dasharray:6 10; animation:linkDashFlow 1.2s linear infinite;` 颜色提到 `rgba(141,205,255,.7)`。
  2. **不要**给所有连线常开动画（几十条线常驻动画伤性能）。
  3. `prefers-reduced-motion` 关闭。
- **验收**：运行一个生成节点，其上游→下游连线出现流动；空闲画布连线静止；100 节点画布拖动无明显掉帧。

### B4. 缩放控件补全

- **现状**：只有左侧 dock 显示缩放百分比，无 +/− 按钮、无「适配全部」。
- **做法**：在左 dock（`CanvasBoardColorPicker.tsx` 挂载区，搜 `缩放` 或 zoom%）加三个小按钮：放大、缩小、fit-all。engine 已有 viewport 逻辑（`applyViewport`、scale 范围 0.08–3），fit-all 需计算所有节点包围盒后设置 viewport（engine 里搜是否已有 `fitView`/`organizeSelectedNodes` 可参考的包围盒代码）。样式复用 `.tool-btn`。
- **验收**：三按钮可用，fit-all 后所有节点入画且留 10% 边距；快捷键不冲突。

---

## Phase C — 画布性能（engine JS，高风险，须逐步验证）

### C1. generator / rh 节点增量刷新

- **现状**：`refreshNodes()` 对每个 id 整节点 `replaceWith(fresh)`，会摧毁 textarea 焦点/滚动位置；只有 output 节点有增量路径 `refreshOutputNodeContent()`（约 8265 行，参考实现）。RH 改 entry 时甚至全画布 `render()`（约 13112 行）。
- **做法**：
  1. 仿照 `refreshOutputNodeContent` 给 generator 写 `refreshGeneratorNodeContent(node)`：只 patch 运行按钮文案/running class、`.node-run-status` 徽章、`.input-list` 缩略图，不重建 `.gen-settings` 表单。
  2. rh 节点同理，重点保 `.rh-prompt-list` 的 textarea 不被重建。
  3. `refreshNodes` 里按 type 分流，patch 失败（结构不匹配）时回退整节点重建。
  4. **一次只改一个节点类型并手测**，禁止一口气改完所有类型。
- **验收**：generator 运行中在其 textarea 打字不丢焦点；RH 切换 entry 不闪烁整个画布；输出图正常出现。

### C2. 视口裁剪（虚拟化-lite）

- **现状**：所有节点常驻 DOM，屏外节点照常参与渲染与连线计算。
- **做法**：`applyViewport()` 后用 rAF 批量给视口外节点（包围盒与视口无交集，外扩 300px 缓冲）加 `visibility:hidden`（**不要 display:none**，避免尺寸丢失导致连线端点错位）；连线几何计算可跳过两端都不可见的线。
- **验收**：造 150 节点画布（可写临时脚本生成），平移/缩放帧率明显改善；截图对比连线端点无错位；含 video 的节点不黑屏。

---

## Phase D — 主页 Phase 2/3 剩余项（此前规划的延续）

### D1. 工具区非对称 bento 布局

- **现状**：`HomeTools.tsx` 五张卡等宽横排（仅 featured 更高）。
- **做法**：桌面端（lg+）改 CSS grid 不规则布局，比例接近 40/20/40：无限画布占宽列、分镜工作台 featured 居右大块、九宫格/图片编辑/导演台填充；移动端保持现有横向滚动条带。已有 3D tilt 的 `ToolCard` 组件复用，只改容器与卡片尺寸类。
- **验收**：1440px 宽下布局非对称且无溢出；768px 下回落横滑；tilt/扫光不回归。

### D2. 滚动驱动的导航变形

- **现状**：`StudioTopNav` 在封面上是 overlay 白字，无滚动响应。
- **做法**：监听封面滚动容器（参考 `Hero.tsx` 里找 scroller 的写法），>50vh 后给 nav 加玻璃 pill 态（复用 `.cover-glass-nav`），过渡 0.3s。注意封面滚动发生在 `CoverPageTransition` 内部容器而非 window。
- **验收**：Hero 内导航透明、滚到工具区后导航变玻璃 pill，往回滚还原，无闪烁。

### D3. 点击工具卡 → 汇聚过渡

- **现状**：点击卡片直接切页（`CoverPageTransition` instantExit + `StudioHeroShell` 淡入）；项目已有 `StudioConvergePiece`（`src/components/motion/StudioConverge.tsx`）。
- **做法**：先读 `StudioConverge` 现有用法（App.tsx 搜 `StudioConvergePiece`），把点击的卡片作为汇聚源：卡片放大淡出 → 琥珀光斑过渡 → 功能页淡入。若现有组件不支持，做减法：仅给被点卡片加 `scale:1.12 → opacity:0` 的退场，同时页面过渡照旧。
- **验收**：点击「分镜工作台」有从卡片出发的连贯过渡感，无白闪（注意画布页的 instantExit 特殊路径不要破坏，见 `CoverPageTransition.tsx` 注释）。

### D4. Hero 视频背景（导演暂缓，最后做）

- 素材：手动从 livewallpapers4free / desktophut / moewalls 下载 BR2049 循环 mp4（链接见 2026-07-08 HANDOFF），ffmpeg 压缩：`ffmpeg -i in.mp4 -vf scale=1920:-2 -c:v libx264 -crf 28 -an -movflags +faststart public/cover-hero.mp4`（目标 ≤ 8MB）。
- 代码位已就绪：填 `Hero.tsx` 的 `COVER_HERO_VIDEO = '/cover-hero.mp4'` 即可，img 的 Ken Burns 不会作用于 video。
- 验收：视频自动循环播放、reduced-motion 显示静态图、加载失败回退图片。

---

## 建议施工顺序与粒度

| 顺序 | 任务 | 预估规模 | 独立提交 |
|------|------|----------|----------|
| 1 | A1 浅色消线 | 大（机械） | ✅ |
| 2 | A2 模态暗色化 | 中 | ✅ |
| 3 | B2 selectionHub 清理 | 小 | 可并入 2 |
| 4 | A3 token 收敛 | 中（机械） | ✅ |
| 5 | B1 失败反馈统一 | 中（碰 JS） | ✅ |
| 6 | B4 缩放控件 | 小 | ✅ |
| 7 | B3 运行链路流动线 | 小 | 可并入 6 |
| 8 | D1 bento 布局 | 中 | ✅ |
| 9 | D2 导航变形 | 小 | ✅ |
| 10 | D3 汇聚过渡 | 中 | ✅ |
| 11 | C1 增量刷新 | 大（高风险） | ✅ 分节点类型多次提交 |
| 12 | C2 视口裁剪 | 中（高风险） | ✅ |
| 13 | D4 视频背景 | 小（等素材） | ✅ |

每步完成后：`node init.mjs` → 更新 `feature_list.json` 对应 task → 更新 `HANDOFF.md` → 提醒导演 commit。
