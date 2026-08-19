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

## 2026-08-03

### 记录 / 说明
- 图片组顶栏二次放大（标题/meta/操作钮）
- 图片组去掉张数提示、上传/整理钮、整组禁用开关
- 画布媒体改最短边归一：1:1边长对齐9:16最短边
- 左下工具栏去掉缩放±，加小地图显隐
- ca2aeab 已 deploy:safe 上线
- 图片组顶栏再放大约2.5倍
- 视频生成 dock 对齐图片 Gen Console 芯片底栏
- 视频反推对齐 RH 壳与默认 2.5× 缩放
- 视频反推：挂 rh-node 防底栏裁切；左侧改为上传/预览视频井
- RH/视频反推外轮廓圆角32px+井区18px；agent不全量改RH壳
- Agent Premium Chrome：呼吸间距+炭灰玻璃壳+加宽；重启本地站
- AG96：Premium Agent（复刻/修图/海报/九宫格/Slots/Mx/DeepWhite/编剧/皮克斯）默认视觉 2.5×，与 RH 同 scale 壳
- AG97：Premium Agent 横向两栏壳（左主内容|右参数|底运行）
- AG98: fix node select flash (spring overshoot + drag/selected shadow mismatch + agent-result glow)
- AG99: Agent select ring match RH (literal white stroke + ::after + 32px radius)
- AG100: imageBatch/group/promptGroup select ring (split ring/selected rules + ::after)
- AG101: imageBatch/agent outer radius 40px (softer, closer to gen-stage feel)
- AG102: imageBatch top gap — head inset measured (~52) instead of legacy 144 fallback
- AG103: gen grid per-result aspect stamp (pending/history); old tiles natural backfill; console ratio no longer rewrites existing tiles
- AG104: link energy flow only when target node is running (not source)
- AG105: gen node context menu Set as primary
- AG106: wheel zoom step slightly higher (.90/1.11)
- AG107: video dock remove max-width 560 so long model names don't overflow shell

## 2026-08-04

### 记录 / 说明
- HOME5: cover home stage depth — tonal lift, prompt/card shadows, new-project dashed slot
- HOME5: personal space UI — portfolio/favorites tabs, featured empty, publish card
- HOME6 个人空间顶部可换背景（cover_url + /api/auth/cover）
- HOME7 公共画廊按参考稿重做（信息流/搜索/分类 pill/叠字卡片）
- HOME8 发布作品：gallery_works + 弹窗投稿/分类/个人空间可编辑
- 发布弹窗：有图去掉上传遮罩、收藏导入对比度、支持最多9张多图
- HOME9 画廊点星收藏：我的创作/画廊收藏分类，展示描述与来源
- 已部署上线 c2b29d1（个人空间/画廊发布与收藏）
- HOME10: 成片+可选创作过程时间线（后端 process_steps_json、发布弹窗、详情时间线）本地完成未部署
- HOME11: 创作过程减负——成片一键排过程 + 从收藏导入步骤（提示词进说明）
- HOME12: 最近画布生成一键排过程 + 从画布历史勾选；过程步骤可引用未收藏的本人生成图
- HOME10 横向多图步骤时间线 + HOME11 保存草稿（as_draft）本地完成未部署
- HOME12: 铃铛改为通知中心；发布公告迁至头像菜单

## 2026-08-05

### 记录 / 说明
- HOME13: 个人空间背景上传前裁切
- HOME14: 管理员公告管理（列表/编辑/删除）
- 生产 deploy:safe 上线 b5e4e58；备份 studio-20260805-144924.tar.gz；PM2 online HTTP 200
- AG111：视频节点接入 RunningHub hailuo-h3（multimodal-to-video）
- 修文本节点：mousedown 被 bindScrollableText 吞掉导致单击无控制台/双击无编辑；底栏改 gen-dock 壳

## 2026-08-06

### 记录 / 说明
- 修画布重命名：title/icon 元数据 PUT 跳过 409，避免与自动保存并发失败
- AG115: 文本连生图/生视频时上游文本进控制台+条芯片，本地textarea可补充
- AG116: 修生图删除其他图片未同步_stageSlots导致展开又出现
- AG117: 旋转镜像工具栏；裁剪/画笔/旋转保存连出新图片节点
- 编辑保存后视口缩回；新图按展示宽落在源右侧平齐
- 结果图左上角裁剪/画笔/旋转说明标签，随节点移动
- AG118：裁剪/画笔/旋转结果图说明移到图框上方左对齐（不叠画面）
- AG119：图片生成节点框上浮标「图片节点 N」
- AG120：文本/视频节点框上浮标（图标适配）
- 工具栏抬高避开框上浮标
- 连线能量：固定3段、描边更细
- AG122：用户主动删空画布可落盘，避免删图刷新回潮
- AG123：侧栏节点搜索入口 + 分类面板
- AG124：修复拖入图片中文文件名乱码
- 导入图片/视频左上浮标显示文件名
- AG126 顶栏画布胶囊：名称下拉切换+保存态图标
- AG126.1 画布下拉去延迟+缓存预取，打开更丝滑
- 线上部署 6962a4e：build:prod + deploy:safe，PM2 online HTTP 200
- AG127 旋转90预览：外框对调宽高，消除黑边
- AG128 连线能量随距离变长，像素速度减速
- AG128 能量亮段随连线长短缓变（仍 3 段）
- AG128.1 能量层对齐亮度+bloom轻微辉光
- AG130 文本节点：背景色/分割线/展开面板/素材库
- AG131: 右键图片节点/生图图台增加保存到素材库

## 2026-08-07

### 记录 / 说明
- AG132: 右键图片节点创建副本（下方+上游连线）
- AG132: 右键图片/生图/生视频图台创建副本（正下方+上游连线）
- AG133: 连线在节点下，拖动节点抬高
- AG134: 画布Logo下拉增加个人空间/公共画廊
- AG136: 视频图台播放器（静音/收藏+底栏进度）
- AG137: 视频控制台补生成数量 UI，runVideoNode 按 count 并发
- AG138: 视频图台底栏加粗加大
- AG139: 视频图台展开角标改数字+条
- AG140: 视频图台展开改为单列竖排
- AG141: 视频展开格按真实比例，修9:16横条
- AG142: 视频节点上方动作条
- AG143: 视频图台改回与图片同款√n方阵
- AG144: 视频图台展开收起FLIP对齐图片
- AG145: 截帧菜单当前/首/尾，截完连出图片节点
- AG146: 视频剪辑底栏（胶片条选区+裁剪同款动效；确认 MediaRecorder 导出连出节点）
- AG147: 截帧连出图对齐源视频台尺寸，避免 496 标准边放大
- AG148: 拖入视频落成无控制台的 video 节点
- AG149: 生图/生视频右键去掉按时间顺序整理
- AG150: 生图/生视频右键改为复制节点
- AG151: 视频右键去加入图片组；删除其它视频
- AG152: 剪辑预览锁定白色选区播放
- AG153: 截帧/剪辑新节点右侧间距加大到 160
- AG154: 删下游截帧/剪辑不再刷新上游视频台（消闪）
- AG155: 截帧/剪辑派生节点浮标截帧N·剪辑N
- AG156: 视频控制台与视频台对齐（morph/ResizeObserver/双rAF）
- AG157: 视频生成初始比例（画布16:9 / 从图拉出跟图 / 手动改覆盖）
- AG158: 视频生成中仅右上角展开可点
- AG159: 改生图模型空台往上跳（frame锚底+比例未变不morph）
- AG160: 生图count≥2只出一张（同步dock数量+多张append）
- AG161: 从图片生成台拉出视频跟图台比例（含generator上游）
- AG162: 拉出视频去掉morph，避免视频台比例抖动
- AG163: 视频count≥2串行提交，避免并发只剩1条
- AG164: 生成历史分类图片/视频/音频，音频暂未开放
- AG163回退: 视频count改回并发，保留失败提示
- AG165: 历史面板切tab壳层定高不抖
- AG166: 视频异步taskId+刷新续查
- AG167: 视频台同task二次落板去重
- 生产 deploy:safe 上线 2763ccb；备份 studio-20260807-181416.tar.gz；PM2 online HTTP 200
- AG168: 图片节点右键去掉编辑图片入口
- AG169: 左键框选+多选工具栏（打组/素材库/下载）
- AG170: 框选降卡；打组三选 图片组/提示词组/框组
- AG171: 图片组子图与边缘留 32px 边距便于拖拽
- AG172: 框组无字；工具栏下载/解组/创建工作流/背景色
- AG172: 图片组子图间距56px，避免浮标压邻图
- AG173: 图片组子图间距56px（修正编号，原误写 AG172）

## 2026-08-10

### 记录 / 说明
- AG175: 框选松手改 refreshSelectionVisuals，避免后续节点因整板 render 闪一下
- AG176: 悬停不刷连线几何+顶栏去 backdrop-filter，避免上方节点闪
- AG177: 框组顶边包浮标+更灰底；框组/图片组名改左上浮标
- AG178: 组浮标纯文字新建组；拖组壳低于子图防消失模糊
- AG179: 组壳小手/抓取光标；子图默认箭头；新建组更透明
- AG180：多张图片拖入默认成图片组（upload + localPaths）
- AG181：带浮标节点双击左上角名字原地重命名
- AG182：框选中按住 Space 可平移选框
- AG182：多选外框可左键拖动整组已选节点
- AG183：修多选外框单击黏鼠标（mousedown + pointerup 兜底）
- AG184：图片组/新建组悬停光标改为张开手掌 grab
- AG185：图片组工具栏（解组/禁用所有/背景色圆点+竖条色板）
- AG186：修图片组背景色/创建位移；文本与新建组统一竖条色板
- AG187: 快捷键菜单对齐真实绑定（空白框选/滚轮平移/Ctrl+滚轮缩放）
- AG188: 右键图片/生图/生视频图台不唤出控制台
- AG189: 右键菜单统一创建副本，并补复制图片到剪贴板
- AG190: Ctrl+Z 强制 force render，防刷新后节点/线消失
- AG191: RH 显式 TEXT 不再被猜成图片上传槽
- AG192: RH 视频输出保留 kind/魔数嗅探，避免当成图片
- AG193: RH prompt 字段误判为图片已修——列表右侧类型下拉 + 加载治愈
- AG194: RH 输出视频点不开——预览点击开灯箱 + VIDEO 角标
- AG195: RH SELECT/ratio 被误判成提示词文本已修
- AG196: RH 结果追加历史可切换；图片/视频写入成片库与本板日志
- AG197: RH 生图/生视频记录用时（输出角标/成片库/本板日志）
- AG198: RH 输出布局——历史切换不盖视频、去 VIDEO 角标、输入跟比例、去重复标题
- AG199：RH 去掉顶部重复预览；输入/输出有图去井框；prompt 长高消滚动条

## 2026-08-11

### 记录 / 说明
- 生产 deploy:safe 上线 9beb178；备份 studio-20260811-100733.tar.gz；PM2 online HTTP 200
- AG200: 悬停/选中连线端点真正贴边，去掉 port-dot will-change 减轻对端图台闪
- AG201: RH SUCCESS 字符串产物解析 + UNKNOWN 不再空转 + 失败 softAlert/输出区明示
- AG202: RH 输入去浮标/title 提示；输出完整预览不再 3/4 裁切
- AG203 画布 Pin：工具栏取色/右上角色点/顶栏 Hub（定位·改名·下载全部·移出全部），随画布保存
- AG204: 新建组先抬成员层+框组沉底，结构同步免深拷贝，缓解闪黑/卡顿
- AG205: 框选建图片组展开组内子图+卸旧归属+壳沉底，修复只进一张
- AG206: 编辑聚焦防远程打回视口+开窗防误关+弹簧加速
- AG208: RH重新拉取保留手调参数(类型/默认值/排序/启停/说明/选项)
- AG209: RH节点布局-提示词横跨至参数右缘、运行钮移输出下、输入输出顶对齐
- AG210: RH输入输出顶边对齐-保留输出标题、工具条移出媒体井
- AG211: RH高级设置展开壳高下延，不再往上挤主区

## 2026-08-12

### 记录 / 说明
- AG217：画布侧栏+顶栏 logo 毛玻璃半透明
- AG218：小地图结构变更 rAF 全量刷新，拖动仍轻量跟手
- AG219：上层图片盖住端口时磁吸不再抢拉线光标
- AG220：展开生图网格单击不再进灯箱

## 2026-08-13

### 记录 / 说明
- AG221 画笔文字工具：空框输入、IME、拉伸打字、Esc/Delete 误触

## 2026-08-14

### 记录 / 说明
- 云盘备份从14份改为留3份；远端已删3份旧包，剩余14G
- AG224 左下小地图按钮改为地图+定位针图标
- deploy:safe 上线 7675368（AG224 小地图图标）
- AG225 画布白底适配：data-board-tone 标纸面明暗，浅底改深墨/浅玻璃
- 画布主题改「夜间/日间」两档（AG225，全局+localStorage 记忆，左下取色器瘦身为两档），node init.mjs 已过，待验证日间可读性后 deploy:safe 上线

## 2026-08-17

### 记录 / 说明
- AG226：日间主题深色 chrome 翻浅——gen-dock/图片动作条/文本格式栏/小地图/节点选中环/左下图标统一，并补齐 studio-modal·text-expand·gen-browser·历史库·日志·打组菜单·背景色板等弹层浅色覆盖；node init.mjs 通过
- AG226 增补：图片动作条/文本格式栏加浮起投影（与背景拉开层次）；素材库主面板+保存弹窗、节点搜索面板补齐日间浅色覆盖
- AG227：生成历史成片库/本板日志收进同一行分段控件，切日志时隐藏媒体分类
- AG228：左下工具栏主题圆点描边改为与图标同墨色
- AG229：日间翻浅补齐左上 logo/项目名胶囊和 Pin 面板
- AG231：日间图类节点选中环改画在图台上（3px 琥珀），node init.mjs 通过
- AG232：选中连线改细芯+琥珀软光晕，node init.mjs 通过
- AG233：选中环外发光，node init.mjs 通过
- deploy:safe 上线 3d9faaf（日间/夜间主题+选中光晕）；备份 studio-20260817-122749.tar.gz；PM2 online HTTP 200
- AG234：日间选中环/连线改钴蓝 #2563eb，node init.mjs 通过
- AG234：日间选中改钢蓝 #4578a8（降饱和），node init.mjs 通过
- AG234：日间选中改赛博电青 #00a8ff，node init.mjs 通过
- AG234：日间选中改靛灰蓝 #5e74a8（与琥珀互补），node init.mjs 通过
- AG234：日间选中改为墨色细环+琥珀外光，node init.mjs 通过
- AG234：图片/生图动作条扩图（外框+gpt-image-2），node init.mjs 通过
- AG235 扩图：开场视口弹簧、外框可平移、分辨率/质量下拉、圆形发送、去掉 GPT Image2 左侧图标

## 2026-08-19

### 记录 / 说明
- 性能优化已上线并验证：画布缩略图 2742 张生成(363M)、gzip/immutable 缓存生效、旧 dist/assets 107M→3.7M
- 画布修复上线：图片组子图挂载、图台小图缩略图、放大查看先占位再换原图+复用缓存
- 版本号功能上线 v1.0.91：git 提交总数自动递增 + 头像菜单展示 + version.json no-cache；注意先 commit 再 build 再 deploy 顺序
