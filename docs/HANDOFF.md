# 跨会话交接报告 (Handoff)

- **当前进度**：
  1. **拖拽排序 + 保存交互二次优化**（本次）：用户反馈拖拽换位仍不丝滑、判定有问题，保存按钮缺乏反馈。
     - 拖拽：改为「拖动中只改本地 orderIds，松手再一次性写回」——拖动过程不再触发父组件重渲染，浮动镖片跟手与网格 FLIP 动画不再互相打架。落位判定从包围盒碰撞改为「各卡片左右边缘锚点 + 最近距离」插入索引，宽卡片（col-span-2）也不会误判；被拖占位加 `pointer-events-none`，目标卡片有琥珀色内描边提示。
     - 保存：新增 `dirty` 未保存状态（改标题/参数/排序/重新拉取均标记）；保存按钮文案随状态变化（保存 / 保存更改 / 保存中… / 已保存），未保存时右上角琥珀圆点 + 外发光，成功后 2.6s 变绿勾 + 右上角全局 Toast「RunningHub 配置已保存」，失败 Toast 报错。
  2. **画布与 RunningHub 编辑器体验修复**（本次，本地未 push）：用户用真实 API Key 联调后反馈的一整批 UI/UX 问题，已全部修复：
     - 画布页：点击 logo →「返回主页」不再弹「确定退出无限画布」确认框，直接返回（`App.tsx` 的 `handleCanvasExitHome`）。
     - 画布页：侧边工具栏（素材库/历史记录）垂直位置修复——根因是 `InfiniteCanvasShell.tsx` 里 `motion.div` 的 `animate={{x, opacity}}` 会整体接管 `transform`，把 CSS `.canvas-side-dock` 的 `translateY(-50%)` 覆盖掉，导致栏目偏下；修复为在 `animate` 里显式带上 `y: '-50%'`。
     - RunningHub 编辑器页：布局从居中 `max-w-6xl`（两侧大片留白）改为 `max-w-[1680px]` + 左栏 420px，右侧参数列表从纵向单列改为响应式网格（`lg:grid-cols-2 xl:grid-cols-3`），节点图高度 340→420px。
     - RunningHub 字段含义：确认了 RunningHub `apiCallDemo` 原始返回的 `nodeInfoList[].description` 才是作者填写的真实中文参数说明（如"角色1（替换视频左边的角色）"），之前只存进了未展示的 `note`，`label` 仍用内部变量名（image/value/text）。现已在 `lib/runningHubAdmin.ts` 的 `normalizeFetchedAppField` 里把 `description` 提到 `label` 优先级；`rhWorkflowFieldKind` 增加 `STRING→TEXT` 归一（此前遗漏，导致文本字段徽标显示成裸的 "STRING"）。
     - RunningHub 测试面板：字段卡片新增指针拖拽自定义排序——`RhLivePreviewPanel.tsx` 用原生 Pointer Events + 卡片包围盒碰撞检测识别拖拽目标，配合 `motion/react` 的 `layout` 做磁吸式平滑重排；新排序写入每个字段的 `order` 数值，随「保存」一并持久化。卡片同时展示 `note`（技术含义，如 `nodeName · fieldName`）作为小字说明。
  3. **拖拽排序重构**：用户反馈"拖拽互换位置有 bug、动画不够丝滑"。根因是旧实现把"跟手位移"直接叠加在数组重排后的 grid 新槛位上——换位瞬间两者叠加导致卡片瞬间跳飘。重写为「浮动镖片」方案：`RhLivePreviewPanel.tsx` 拖拽时用 `createPortal` 弹出一张 `position:fixed` 的浮动卡片，靠 ref 直接改 `transform` 跟手（不经过 React state，避免每像素一次重渲染），被拖的卡片本体只留透明占位继续参与 `layout` 动画——跟手位移与网格重排完全解耦，不会再互相叠加出现跳跳。同时把 spring 参数统一成项目规范的 `stiffness:300 damping:30`，`layout` 从有条件改成始终开启（之前误设了 `layoutDependency={length}`，导致纯换位时压根不触发 FLIP 动画），并加了 140ms 换位节流防止兄弟卡片还在飘的时候被连续触发抖动。
  4. 上一轮：RunningHub 自定义工作流/AI 应用功能从 Python 完整迁移到 Node/TS + 新管理页（详见 F004，已验证 `node init.mjs` 通过）。
- **验证状态**：`node init.mjs` 通过（lint + typecheck + build），HMR 全程无报错。dev server 运行于 `:3005`。
- **明日焦点**：
  1. 浏览器里用真实工作流/AI 应用过一遍新的测试面板拖拽排序体验，看看碰撞检测阈值/磁吸手感是否需要微调。
  2. 视觉复核加宽后的编辑器页在超宽屏（>1920px）下是否还需要更大的 `max-w`。
  3. commit + push。
- **Blockers**：无。
