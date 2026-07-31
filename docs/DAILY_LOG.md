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
- AG19-21: C pending宿主 / A图台拖出 / B轻量GenConsole不自动Output+结果台
- 产品决策：完整Gen Console推广不做ltx/comfy；试点msgen→video→RH摘要dock
- AG22 msgen Gen Console 试点：无框图台+浮动 dock；ltx/comfy 不迁
- AG22b 菜单隐藏 msgen；AG23 video Gen Console（无框舞台+浮动 dock）
- AG24 RH Gen Console：无框结果台 + 摘要浮动 dock（配置/媒体/参数）
- 产品：RH 不做完整 Gen Console，撤回 AG24，恢复节点内原 UI
- 修节点复制/Alt复制：图台不抢拖动；C/V展开组员并复制连线
- 图片节点点X改为直接删节点（不再先清空图留空壳）
- 连线X去掉1/scale反缩放，随画布一起缩放
- 生成中连线改为实线+琥珀能量点流动（去掉虚线）
- 点生成不再自动打开节点结果面板
- 图片生成参考图：指针拖拽换位（跟手+让位，局部刷新）

## 2026-07-15

### 记录 / 说明
- 参考图拖拽限左右；悬停轻微放大
- 连线X沿线跟鼠标出现；避开端口；控制台不再被X叠住
- 修连线X闪动：忽略自命中+离开滞回+去掉opacity过渡
- 节点结果改为图台内2x2网格（角标展开/收起，下载/设主图）
- AG27: 多图网格/叠卡；右键展开为独立生成节点
- AG27纠正: 叠卡展开=拆成独立图片节点并上游扇出(图1→图2)
- AG27: 角标=网格查看；右键展开所有节点=拆成生成节点
- AG28: 角标合并；拖线自选节点；gen→gen仅参考不级联
- 拖线选节点时保留预览连线
- 去掉AI生成角标；网格仅保留缩小的下载/设主图或收起
- 生成控制台画布缩放时反缩放保持屏幕尺寸
- 修生成控制台双挂载/点不动；滚轮改平移、Ctrl+滚轮缩放
- 尺寸面板 portal 到 board，修复比例/分辨率点不动
- 比例/分辨率改为与模型同款下拉，去掉挡点击的弹层
- 生成预览收起宽度对齐上游参考图；取消叠卡55%缩小
- 图片组逐张生成支持额外共享参考图：每项 [item,...shared] + 同一提示词
- 控制台：图片组逐张与共享参考分列展示，避免混成同一队列序号
- 大图页：生成节点方向键切 history；保留提示词；增加收藏；连点换模型可并发 append
- 生成中：已出图不压灰；pending 以网格占位格填入空位
- 画布尺寸：最长边260归一，9:16/16:9只差方向；生成台对齐参考最长边
- 画布媒体最长边 260→520，对标43%缩放下竞品体量
- 画布媒体最长边 520→680，对比竞品43%体量再放大一档
- Ctrl+滚轮：board 捕获阶段 preventDefault，避免生成节点/控制台触发浏览器页缩放
- 上游图片生成节点主图作为下游参考；连线后刷新控制台参考列表
- 生成展开网格：主图固定连线锚点格，设为主图时互换；点画布空白收起叠卡
- 失败条：修 dock patchNodeRetryBar 挂载点 + 加关闭按钮
- 比例下拉：nano/稳定按图1十项；gpt-image-2按图2十五项
- 展开结果右键高优先：绑格子 + 主图/预览/收藏/复制/下载/删其它
- 选中操作菜单：仅多选弹出，避免单选右键误触
- 加入图片组：展开结果选图打勾 → 下游 imageBatch 自动连线；图片组补左口
- 新建画布命名态 UI：kicker + 输入 + 取消/创建，去掉杂乱加号布局
- 连线删除X固定中点+扩大命中，修点击不准
- 图片组右端口拉线漏imageBatch，补linkCreateOptions

## 2026-07-16

### 记录 / 说明
- 图片组内双击灯箱放大，同组可翻页
- 修mousemove连线能量卡顿：悬停节流+去掉filter动画
- 修拉线/新建生图节点时图台与控制台初始重叠
- 深修mousemove冻住连线能量：去filter+禁强制布局+路径不重复写
- 完成 Pixar 30 秒 3D 动画广告脚本 Skill 与画布 Agent；静态验证通过，待登录后真实生成手测。
- 故事动画分镜 Agent：去品牌、双模式、弹性时长/宫格、线稿锁定与画布双按钮
- 故事动画分镜：三步流程，资产图不必回连 Agent
- 线稿提示词对齐：场景/本段剧情/首张9宫格/连续镜号与运镜

## 2026-07-17

### 记录 / 说明
- 线上部署 65c9470 + RunningHub Key 同步；PM2 已重启
- 故事动画分镜：分镜脚本沿用 lastAssetPrompts，锚点名/造型与资产提示词对齐校验已落地
- 故事动画P0-P2：镜头描述加厚+节拍装置+表→线稿→视频统一校验
- 故事动画线稿逐格改为静帧改编，禁视频运动句；视频仍按分镜表
- 故事动画每格融入DeepWhite构图名词词库并校验
- 故事动画线稿提示词去掉本段剧情，避免与逐格静帧争抢
- 视频段本段剧情改名为本段镜头串联，切断线稿同名串味
- 展开结果右键：按时间整理 + 修复菜单被 gen-dock 切开
- 故事动画线稿去掉运镜图表，格上仅镜号

## 2026-07-20

### 记录 / 说明
- 图片组：子图自然尺寸落地后防抖重排扩容
- 图片组/一次多张：点生成即展开结果网格
- 图片组：右键禁用/恢复单张，不参与生图
- 加入图片组：可选已连线/已有组，不必总新建
- 图片组整组禁用级联全部子图；恢复则全部启用
- 图片组共享参考图N：UI 从 图2 起编并对齐提示
- 生图结果默认时间序追加，禁止锚点跳格
- Mx-Shell 多机位对齐示例B：节拍标题四段结构+校验+user锚点
- Mx-Shell 一镜到底对齐示例A：角度/按秒分段校验+修正范文矛盾运镜
- Mx-Shell 润色 Agent 独立节点：task=polish，原生成节点不变

## 2026-07-21

### 记录 / 说明
- AG25a: image/gen top action bar (crop/fav/download/enlarge)
- AG25a: save-to-library modal (not favorites) on image action bar
- 图片下拉新增 gpt-image-2-稳定，走 rhart-image-g-2-official/image-to-image
- 修复画笔颜色：React value 无 onChange 导致只读，改为 defaultValue
- 加固画布保存：生图完成立刻落盘 + 离开页 keepalive flush；素材库本地路径失败回退上传

## 2026-07-22

### 记录 / 说明
- 完成回调：task ledger + pending丢失仍落板并强制保存
- RH 节点：独立 API Key 选择行；query 跟随 useWallet
- RH 测试：前端下拉明文挂 API Key（rh_api_keys）
- 防关机：脏画布8s强制保存；孤儿uploads扫描脚本（约150张待导演确认贴回）
- 已部署线上 adfc6b8：8s脏保存心跳 + 原子写画布
- 已部署 5a91cfb：dock/gate/素材库拖拽/报错条
- ECS Caddy HTTPS: dreamgrid.cn + www 反代 3000；AUTH_COOKIE_SECURE=1 / TRUST_PROXY=1；验证 HTTP/2 200
- 加速：OSS+CDN/升带宽暂缓不花钱；SSH22暂缓；可后续只做免费缩略图
- 存盘加固：409合并/日志合并/打开禁存/成片库meta；准备部署
- 画布刷新慢：历史嵌入整节点快照致百兆JSON；已瘦身并部署2eace69

## 2026-07-23

### 记录 / 说明
- 修提示词/模型回弹(HMR草稿+远程软同步)与gpt误走nano路由；本地未部署
- 修并发生图结果槽位序：按提交位原地填充，不再按完成先后乱序
- 修图片组只出一张：几何补items、忽略残留loopContext、控制台显示并行张数
- 修：设为主图按 URL 钉住收起叠卡封面（AG40）
- 修复裁剪/画笔编辑态残留导致画布整页叠乱；硬刷后验证布局
- 裁剪/画笔弹簧放大防闪黑；画笔T文字与序号标注拆分
- 裁剪/画笔改为挂在原画布节点上，只浮工具条
- 修：暗色模态底盖住画布内联裁剪导致整屏空白
- AG45: 暗色 image-edit-panel 盖黑已透明；裁剪/画笔独占 chrome，取消或点空白退出
- AG46: 裁剪/画笔先挂层再弹簧放大，去掉壳层抬升，杜绝闪进新页
- AG47: 动作条/控制台改为炭灰灰，与画布拉开层次

## 2026-07-24

### 记录 / 说明
- AG48: 裁剪框默认内缩；底栏锚图片下方居中
- AG49: 生图防串板——错画布停泊、切板先落盘、save 钉 canvasId
- AG50: 裁剪/画笔态锁定画布缩放与平移
- AG51: 图片组拖出降卡顿；落板补回端口圆点
- AG52: 修复导航地图点击无效（canvasRoot 委托绑定）
- AG53: 空白左键不再平移；中键/Space 平移；加大端口命中
- AG54: 端口磁吸十字中心 + 选中环加强 + 手型/抓取光标
- AG55: 端口磁吸/命中改为朝外半圆
- AG58: 拖动生图节点时收起控制台，松手再展开

## 2026-07-27

### 记录 / 说明
- AG59: 生成中UI去掉整图模糊，改底部琥珀状态条
- AG60: 预览放大对齐封面；左右键按预览列表顺序
- AG61: 网格稳列/生成不收起/点哪看哪/上限120
- AG62: 拉线去双倍render；草稿延后+session节流；undo structuredClone
- AG63: 修生图 Invalid string length（runSnapshot 瘦快照+scrub历史）

## 2026-07-28

### 记录 / 说明
- AG65: commitStructureDomPatch 局部DOM挂载，init通过
- AG66: 粘贴图片落到鼠标画布坐标
- AG67: 历史弹层统一壳 + 成片库按日大图
- AG67: 成片库对齐图片历史方图网格+缩放排序
- AG68: 素材库主/子文件夹 + 行内编辑去 prompt
- AG69: 主页收藏迁入素材库顶部

## 2026-07-29

### 记录 / 说明
- 已部署 b965ec9 到线上：顶栏保存态 + 拖节点立刻落盘
- RH 节点改为三栏 satin：输入/参数/输出 + Run 光晕进度条 + Advanced 收纳配置
- AG70 预览对比按钮：有图1显示、一键擦除、generatorSources 回退；init 通过
- AG71 生图叠卡展开铺开/收起叠合 FLIP 动画
- RH 等比例拉伸：--rh-ui-scale 整块 UI 放大

## 2026-07-30

### 记录 / 说明
- AG73 RH共用壳：高工作流三栏内滚+底栏常显，不再裁切字段
- AG74 工作流模版库：侧栏+封面网格对齐导演稿
- RH素材格：去掉与底栏重复的「拖入或上传」文案
- RH素材格：操作说明提到网格底部统一显示
- RH换配置：原地重建+离屏测高，消除闪屏
- 补全工作流模版库 i18n key（最近/我的/公开/创建）
- AG75 炭灰玻璃：节点壳/分组/Loop/选画布新建/九宫格pill/项目管理统一冷炭灰
- AG76 移除上传卡片创建入口，保留拖放/粘贴/图片组

## 2026-07-31

### 记录 / 说明
- 端口：默认隐藏贴边；hover/选中弹出；选中连线加亮；环/加号约4.5px
- 拉线预览：青蓝多层能量段流动
- AG79: 保存到素材库等面板琥珀改冷炭灰
- 修：图片历史/本板日志 theme-dark.log-panel 琥珀壳盖掉炭灰
- AG80: gen-stage cover fav; tile fav+download left / set-primary right collapses; left-click dismisses result context menu
- AG81: fix gen-dock ref xx unlink — map synthetic source id (nodeId:preview) to real connection.from
- AG82: unlink ref thumb refreshes immediately — do not treat button focus as text editing skip
- AG83: add nano-banana-2 (RH rhart-image-n-g31-flash i2i/t2i), same UI caps as nano-banana-pro
- AG84: restore amber flowing waves on collapsed gen-stage busy overlay
- AG84: gen-stage busy = blur cover + amber flowing waves + status bar
- 选参考边缘流光：改 transform 扫光，去掉 @property/drop-shadow 卡顿
- 已部署线上 19c26fd：nano-banana-2 + 生成中/选参考流光
- 主页 TapNow 改版：四导航、新建进画布、个人空间占位、管理员轮播
- 已部署 969ed07：主页 TapNow 改版上线
- 画布冷启动黑底 logo 开屏已实现（CanvasBootSplash），本地 init 通过，未 commit
