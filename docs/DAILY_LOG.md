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
- 拖入/粘贴图片 blob 占位秒现已上线 v1.0.95；deploy:safe 前置 build:prod 根治版本号偏小
- 扩图修复重开（只用 RunningHub）：扩图只留 gpt-image-2，走 RunningHub i2i 透明通道单图（原图垫大画布+四周透明 alpha=0，单张 PNG 传 imageUrls，透明区=待生成，无需 mask）；nano-banana-pro 从扩图移除（端点无 mask 字段）；删除 comfly 扩图链路；待实测 RunningHub gpt i2i 对透明通道的 outpaint 效果

## 2026-08-21

### 记录 / 说明
- 画布五项检查收尾：视频下载封面修复、视频上传blob占位、历史/素材库/收藏悬停三键已改；打组/创建工作流/模板保存流程已浏览器端到端实测通过；视频台预览播放按钮确认已实现

## 2026-08-24

### 记录 / 说明
- 部署上线 v1.0.102（deploy@3cb0ce6）：画布悬停三键+视频封面下载+视频blob秒现+打组/创建工作流+高清放大+抠图+去拉伸手柄+RH输出预览增强；远端备份 studio-20260824-094135.tar.gz(7.0G)
- 切换项目卡顿优化：返回列表骨架屏(showGateListSkeleton/hideGateListSkeleton + .gate-list-skeleton) + 开板视口外节点分帧渲染(safeRender deferOffViewport → renderOffViewportNodes 每帧≤8ms，offViewportRenderToken 防跨板残留)；node init.mjs 通过，浏览器实测骨架屏→27卡片替换、开板即出编辑器节点跨帧补齐连线完好
- 生产 deploy:safe 上线 v1.0.105（0b01114）：切换项目骨架屏+分帧渲染+切板闪一下修复；OSS 代码已随包但服务器无 OSS_* 密钥未启用；备份 studio-20260824-134108.tar.gz(7.1G)；PM2 online HTTP 200

## 2026-08-26

### 记录 / 说明
- 生图/生视频参考图上传前铺白；扩图仍传 alpha
- Mx-Shell/九宫格参考图一多被底栏挡住：列表改纵向折行可滚，测高带 Agent 宽，栏内滚动底栏常显

## 2026-08-27

### 记录 / 说明
- 图片生成节点编辑生图 RH 上传 504：PNG/大图转 JPEG 再传，504 重试 3 次
- 线上生图不认参考图：/uploads 改 OSS/本地直读再传 RH；图片生成节点去掉默认角色造型锁定
- 生产部署 v1.0.107 a66e2d0：参考图 OSS 直读交 RH、生图不再造型锁定、透明铺白、九宫格参考图折行；Caddy https://dreamgrid.cn HTTP 200

### 今日提交（Git）
- `a66e2d0` fix(canvas): send OSS refs to RunningHub and stop gen-node costume lock

## 2026-08-31

### 记录 / 说明
- 图片动作条重绘双选菜单骨架（蒙版/框选）；AG261 done，AG262/263 待实现
- AG262 蒙版重绘：上下栏+涂蒙版+gpt-image-2 mask edit-form；有 mask 不再丢 RH
- 修蒙版重绘401：uploads绝对URL改本地直读
- 蒙版重绘改走RH透明通道，对齐图片生成STORYBOARD key
- 蒙版重绘完成后羽化贴回原图，锁未涂区域
- 蒙版重绘改走 RH Qwen Edit 工作流(2029197668701970433)：透明PNG作LoadImage mask，去掉整图edit+贴回
- AG263 框选重绘：裁切+Qwen生成+PixelRunner羽化贴回/YUV融合校色(total78/feather16等)
- 框选重绘改回 nano-banana-pro 图片生成API图生图（勿用Qwen工作流）；贴回校色仍保留
- 框选重绘深度对照 PixelRunner：修 contain 透明留白+合成 alpha；仍缺 stretch/local-mesh
- 框选重绘根因：坐标用了画布 _thumb naturalWidth，裁切按原图像素→左上角白边；nano 发明错脸。已改 keep 原图尺寸 + crop 换算。
- 蒙版重绘灯箱同管道 compare baseline（edit-compare-baseline）
- 新视角：动作条入口+箭头公式+gpt/nano 走图片生成 API
- 灯箱对比以结果图 contain 框铺原图，消尺寸不同假偏移
- 新视角飞出双选：箭头指向保留；3D机位=立板环绕预览，提交干净原图+数值机位提示词
- 灯箱对比改裁切窗口：左边不再透出结果图
- 灯箱对比：单击按钮开关；滑杆随缩放层走，去掉放大后线旁多边
- 3D机位预览改深度立板（Depth Anything）并修焦段对消；生成仍走干净原图
- 3D机位深度改走服务端 Depth Anything；HUD 显示模型名，失败写出原因

## 2026-09-01

### 记录 / 说明
- 3D机位改为原图+预览双参考；Depth Anything Small 仍是相对立板
- 生产 v1.0.108 @ 2ed3562 已上线；备份 studio-20260901-141650.tar.gz；2G 未装 transformers
- 全景图 360：动作条入口 + RH v2 AI 应用 + 结果节点 VR 预览（截图/重置/全屏）
- 全景图入场：先聚焦再淡入，修左下角缩略幽灵

## 2026-09-03

### 记录 / 说明
- 生产部署 v1.0.109 @ 6cbf802；备份 studio-20260903-154633.tar.gz
- 生产 v1.0.110 @ 1733dd5 已上线：OSS 同源代理，画笔/裁剪/旋转不再因 302 跨域失败；备份 studio-20260903-173033.tar.gz
- 生产 v1.0.111 @ 8357197 已上线：应用画笔/裁剪/旋转立刻出图；备份 studio-20260903-181957.tar.gz
- 生产 v1.0.113 @ d7436d5 已上线：灯箱 OSS 直链、画笔 JPEG 预览、拖入直传；备份 studio-20260903-192508.tar.gz

## 2026-09-04

### 记录 / 说明
- 画笔裁到图内：笔迹层按 world scale 换算，禁止从图外灰底起笔
- 旋转与镜像取消入场放大，避免 90 度超出图台
- 旋转与镜像取消入场放大，避免 90° 超出图台
- 工具栏应用后新节点贴原图右侧，不再甩远

## 2026-09-08

### 记录 / 说明
- 线上封面/Output 慢刷：漏接缩略图，原图经 2G 代理；本地已改 thumb+OSS 直链未上线
- 复制/下载改 OSS 直链；拖入/粘贴上传完不再 refresh 板上图
- 生产 v1.0.115 @ cd273c4 已上线；备份 studio-20260908-183436.tar.gz（10G）；PM2 HTTP 200

## 2026-09-09

### 记录 / 说明
- 复制/下载改走正式原图，不再误用工具栏缩小 JPEG 预览
- 生产 v1.0.116 @ 56d1d19 已上线；备份 studio-20260909-140909.tar.gz（11G）；PM2 HTTP 200
- 视频节点接入 Seedance 2.0（sparkvideo-2.0），未提交未部署
- Seedance 提示词 @ 参考选择器，未提交未部署

## 2026-09-10

### 记录 / 说明
- 本地接入图片节点 gpt-image-2.5（RunningHub sunburst/image-to-image），未部署

## 2026-09-11

### 记录 / 说明
- 生产 v1.0.119 @ 0a23f7e 已上线；备份 studio-20260911-100330.tar.gz（11G）；PM2 HTTP 200

## 2026-09-14

### 记录 / 说明
- 九宫格 Agent nano 对齐图片生成节点 nano-banana-pro（不再默认 稳定）

## 2026-09-16

### 记录 / 说明
- 灯箱对比多参考：底部图1/图2缩略图切换，滑块一次仍只跟一张比

## 2026-09-17

### 记录 / 说明
- gpt-image-2.5 无参考改走 sunburst/text-to-image；有参考仍走 image-to-image

## 2026-10-08

### 记录 / 说明
- 诊断：画布图走同源缩略图且生成中要等建任务接口返回，未改代码
- 点生成立刻占位；画布图走 OSS 直链并异步解码
- 切画布只加载视口内缩略图，并一次批量签名
- 登录说明不再拆开分镜；淡字改为可读；窄屏和画布顶栏保留通知与头像
- 已上线 v1.0.122 @ 72d7c16：淡字可读，登录不拆分镜，窄屏和画布右上角有通知与头像
- 已上线 v1.0.123 @ 0924a9e：视角 Agent，以及视口内缩略图一次批量签名
- 本地：新视角菜单的 3D机位改为自定义视角（写角度后内部走视角 Agent + nano-banana-pro）。未提交、未上线。
- 本地：自定义视角底栏可选择分辨率 1K/2K/4K（默认 2K）和张数 1-4。未提交、未上线。
- 本地：箭头指向改为尾部物体定机位前后、尖端定看向；视角 Agent 看标注，生图只用干净原图。未提交、未上线。
- 本地：箭头指向的体块图由程序按视角 Agent 的布局绘制，作为生图第二张参考。未提交、未上线。

## 2026-10-09

### 记录 / 说明
- 本地：箭头指向的生图提示词改为图1原图、图2灰块，Agent 英文不再写图号。未提交、未上线。
- 本地：箭头指向可选手前景/中景/背景，层次写入灰块和生图提示词。未提交、未上线。
- 本地：箭头指向可选生成 1-4 张，分析和灰块只做一次。未提交、未上线。
- 本地：箭头尖端改为脸朝方向，镜头背后的原图内容可以不出现。未提交、未上线。
- 本机新建 viewpoint-local，用圣诞夜景跑通相对远近和元素前后。未进网站仓库，未上线。
- 本机视角分析加了浏览器界面，双击 viewpoint-local 的打开界面.bat。未进网站仓库。

## 2026-10-12

### 今日提交（Git）
- `40343cf` feat(canvas): route nano-banana-2.1 image generation through RunningHub
- `3c35227` feat(canvas): teach arrow aim to face the tip and drop the viewpoint agent menu
- `88e1c2b` feat(canvas): add custom viewpoint and remove the panorama tool

### 记录 / 说明
- 箭头指向、自定义视角和删除全景图已接回画布引擎。检查与 node init.mjs 通过。未 push、未上线。
- 已上线 v1.0.127 @ da06336：自定义视角、箭头指向、去掉全景图、nano-banana-2.1。备份 studio-20261012-132635.tar.gz（17G）。PM2 HTTP 200。

## 2026-10-13

### 记录 / 说明
- 本地：箭头指向和自定义视角底栏可选 nano-banana-2.1，默认仍是 nano-banana-pro。未提交、未上线。
- 本地：箭头指向和自定义视角遇到 blob 参考图会先用已落盘地址或先上传，不再报浏览器临时地址。未提交、未上线。
- Canvas Agent 端到端本地实现完成：上下文/工具/Proposal 审批/Facade 原子落板与隔离浮层已接入；构建和 init 通过，真实账号浏览器与上游 tool call 待实测。
- Canvas Agent 可靠性升级完成：Fake Provider 与 9 项关键验收门、SQLite 任务/binding 跨标签换设备续查、canonical params hash/运行审计、上游 stale 影响路径、逐字台词/说话人/引用/真实 TTS 时长保真门；node init.mjs 通过。真实账号 LLM tool call 与 TTS 时长回填仍待联调。
- Canvas Agent 会话历史与遮挡修复完成：SQLite 按用户+画布持久化消息，支持新建/切换/重命名/删除；历史 Proposal 恢复后强制过期；小地图/Pin Hub 让位、图片编辑隐藏 Agent、移动端全屏抽屉。check:critical 10/10 与 node init.mjs 通过。
- Canvas Agent 浮窗完成：展开态保留 72px 顶部安全区；新增切换为浮窗/停靠在右侧按钮，标题栏可拖动且位置限制在画布内；移动端保持全屏抽屉。node init.mjs 与 check:critical 10/10 通过。
- Canvas Agent 浮窗拖动优化：pointermove 改为 rAF DOM translate、松手才提交 React；自动避让生成 Dock/动作栏/文本栏/视频剪辑栏/Pin Hub/小地图，空间不足时自动收短。node init.mjs 与 check:critical 10/10 通过。
- Canvas Agent 操作规范：两种接法、节点三态、失败另建最多 3 次、下游重做或替换、@ 引用。编排规范只留空位。本地未提交、未上线。
- Canvas Agent 的 @ 菜单补上节点缩略图，并可引用本站图片模型与海螺 H3、Seedance 2.0。

## 2026-10-19

### 记录 / 说明
- 生成后失败：Agent 兜底不再把残留失败标记记成成功；cascade 不留失败条。未提交。
- @ 模型菜单改为从 availableModels 派生，删掉写死的 8 条。未提交。
- 参数键允许名单、initialParams 展平、未知键整批拒绝已在本地 stub 通过，未提交。
- 整批进度写在提案卡片上，不落盘；刷新会丢掉未跑完的整批循环，已登记的生图和视频重开后能续上。未提交。
- 海报三处和九宫格两处生图拿到 task_id 后登记账本。类型闸不扩，重开不重建占位。九宫格完成路径写 generatedOutputs，不写 gridUrl。
- 九宫格重开后，大图地址还是空的才写进 gridUrl。单格编辑不改，已有大图不覆盖。
- 视频成片编排只接通读盘。不含正文时 operatingPrompt 是 999 字。正文源文件不在仓库，三处【填】未填。
- 视频成片正文写入 prompts/playbook_video_content.md。进系统提示后不含画布上下文 7066 字，未截。
- 选中编排没有请求字段。真实组装处选中和不选都是 7056 字，正文都在。读盘基准与 server.ts 相同。未修。
- 编排改为按 playbookId 选中才读正文。带 id 7056，不带或不存在 3045。不接受 path。init 12/12。

## 2026-10-20

### 记录 / 说明
- 剧情动画改显示名，新增开场动画。组装处 7054 / 5720 / 不选 3045。注册表仍是硬编码数组。
- 技能点击只存 id。组装处剧情动画 7049、开场动画 5715、不选 3045。胶囊与输入同一行，高度 122px。
- 两处旧文案改成技能：注册表注释，以及空列表按钮「技能稍后接入」。
- 锚点连线已建，提示词里的引用记号被删掉；默认模型没有「图片模型 V2」这个 id，未改。
- 引用记号删掉时换成节点名或参考图编号。模型字段和画幅双写只查未改。
- 聊天提案只认消息里的 @ 记号。没点名就删掉 model、不建引用边。口头确认先不修。
- reason 只在提案卡片展示，不进闸门也不写节点。@ 模型和 @ 节点改成技能同款胶囊。诸葛亮停点原句重放不再因 reason 打回，model 因消息里的使用模型 nano-banana-pro 留下。停点验证：已过段数算法、停点1、闸门 fallback；未验停点2、停点3九宫格不当9段、停点6改分镜先报重跑成本，重跑重点看3和6。
- 更新路径也会剥未点名的 model。{{canvas:id}} 与裸 id 视为同一节点。有图片入边且模型不在参考生图白名单时写成 nano-banana-pro。诸葛亮这条更新重放后 model 是 nano-banana-pro。停点：已过段数算法、停点1、创建路径闸门 fallback；停点2提议见过但样本污染不计入；未验停点2干净跑通、停点3、停点6。
- 用户点名的模型因参考图边被改成 nano-banana-pro 时，提案卡片先写「模型从 A 改为 B」，节点留 agentParamClamped。画布 67fdec92 的诸葛亮锚点未删，重跑前应删整个锚点而不是只断边。
- 12:03 诸葛亮锚点仍是旧节点 gen_b851bf3a8293f8_1792461877566。提案没有 connect_nodes。删节点的保存被存储守卫拦住，两条旧边还在。未改代码。
- 删除被拦的是 8 节点整板被 5 节点、0 连线的稿覆盖。缩水和空连线两条判据都中。只删锚点试过：节点能写上，空连线被拒。文件已写回。未改代码。
- 删节点会级联摘边。指向已不存在节点的边不再被空连线判据留下。显式删除带 intentional_delete，整板重放不带。试删诸葛亮锚点后已把画布写回。
- 更新加执行的提案不再在自动模式下直接标成已应用。卡片渲染覆盖更新和执行。工具日志默认收起。同一句未在登录页后重跑。
- 12:49 裸 JSON 是正文里的工具名没转成内部动作。tempId 在卡片上显示，真实 id 仍在应用时替换。登录页挡着，同一句没重发。
- 动作 type 按四个已注册工具名查表。名单外回给模型重试，不把 JSON 露出来。同一句是本地重放。
- 13:15 九宫格提案 failed：nineGridAgent 带锚点引用，整批没落板。画布上没有九宫格，锚点没有出边。
- nineGridAgent 加入生成类型名单。用户只写确认时，锚点到九宫格的边仍被 @ 闸门拿掉。
- 本会话创建的节点写下 agentConversationId 后，确认不再拿掉指向它的引用边；已有锚点没有这个字段，仍然连不上。九宫格出边只到 Output 或图片组。出图上传 10，视频参考图 9，每格不少于 150 字。
- 九宫格 9 条正文只在该节点被选中或作为选中节点上游时进入上下文。agent 一次执行是同一节点上 Phase A 然后 Phase B，停点在执行前。已删无标记旧锚点 gen_002cc96bfe77f8。
- 图片组接不住九宫格切格，agent 也填不进格子。九宫格 story 提案写不了，Phase A 读上游 prompt 的 text。Phase A 失败留空 shots，反馈要求改完再执行。
- story 不在参数名单里是没列进去，不是人手专属禁令。上一轮落板的 prompt 连九宫格，闸门留得住。video 不审分镜行，时长有上下限，参考图最多 9 张。
- story 已进入创建和更新参数名单。保真检查在视频提交时读已替换的 prompt；这次库里没有 video 提案，也没有 fidelity。
- 保真 refs 改为认落地后的节点名。画布没有配音节点。strict false 会关掉台词逐字。story 里的双括号不建边也不换名。
- 剧情动画正文整份替换。进系统提示后不含画布上下文 8262 字，超过 8000，正文未截。
- 剧情动画正文砍掉四处重复。进系统提示后不含画布上下文 7988 字，余量 12。
- 剧情动画删掉使用示例整节。进系统提示后不含画布上下文 7480 字，余量 520。
- 九宫格执行被「没有内容」拦住：门禁只认 prompt，不认 story。同批顺序不是原因。未改代码。
- 九宫格执行门认 story。重试提示改为修正这颗节点的 story 后再执行。本地重放通过，Phase A 未开始，画布仍是一颗。页面再发停在登录墙。
- 步骤 3 两段视频只连了角色锚点。九宫格连 video 会整批回滚，报类型组合不被允许。
- 剧情动画步骤 1 和原则 2 补上场景锚点。进系统提示后不含画布上下文 7606 字，余量 394。
- 剧情动画步骤 3 补上先报重跑成本和禁止台词进 prompt。进系统提示后不含画布上下文 7755 字，余量 245。
- 16:10 的九宫格 id 是模型把真节点的随机段配上锚点时间戳。本画布只有一颗九宫格，不是重叠，也不是跨画布。
- 缝合 id 格式合法、画布上没有时，端点不存在的报错附上同前缀真实节点 id。16:10 那条错的九宫格 id 重放后，错误里列出 ngrid_d0a2d991072fe8_1792483805955。和动作名白名单分开，记 AG367。未改开场动画正文。
- 开场动画删掉配乐步骤和示例 B，补不含台词原则。组装后 6011 字，余量 1989。image 连 video 合法，未改这条正文。
- 开场动画镜头节奏改由运镜强度和模式决定。组装后 6222 字，余量 1778。
- playbook 不读 camera-moves.md。Mx-Shell 把整份词典拼进系统提示。运镜强度是选词档，不是按秒切镜。
- 两条 playbook 读完正文后拼入运镜词典。正文仍按 4955 卡，词典不计入。加上词典后剧情动画组装 10454、开场动画 8931。生成后校验仍只跑 Mx-Shell。
- 剧情动画放回使用示例 507 字。运镜强度改成克制/标准/炫技，不再按秒数定镜头。不设 8000。加上词典后剧情动画组装 11048，开场动画 8918。校验仍只跑 Mx-Shell。
- 开场动画原则 2 拆开：时长必须问，镜头节奏由克制/标准/炫技决定。本地提交这批画布 Agent 与 playbook 改动。

## 2026-10-21

### 记录 / 说明
- 35a51c3 已推 origin/deploy。点名扩到本会话，文件名不再写进 video prompt，同一条消息那句正文已删。自动模式遇到执行停住是停点，不记待办。用户打确认不触发执行。
- 两份正文把步骤 0 和步骤 1 改成闸门。剧情 6111，开场 4111，开场组装 9881。未提交。
- 不重述不等于角色只写名字。剧情 6289，开场 4289，开场组装 10059。未提交。
- 分镜行怎么写加在写 prompt 那一步、产物之前。剧情 7078，开场 5078，开场组装 10848。未提交。
- 分镜行末句去掉「和原则 2 的关系」前缀。剧情 7067、开场 5067、开场组装 10837。未提交。
- 核对：这次开场消息是纯文本 {{id}}，点名已写入会话，但请求没带 visionImages，图没进模型。未改代码。
- 第40个缺陷：visionImages 接进正常请求。输入框 @ 两张图，日志 5286KB→113KB、2034KB→120KB。未提交。
- 核对：availableModels 只有模型 id。图片没有显示名表。视频名字两处各写一遍。缝合 id 报错附的是节点 id。未改。
- 图片 @ 胶囊带 16px 缩略图，输入框和已发出的用户消息都没有叉；技能胶囊也去掉叉。未提交。
- 两个 video 只核对：第一条提案没有连线，第二条才带边。参考参考图1 是模型写的参考加引用记号，落板换成参考图N。未改。
- 短句肯定在没有待批准提案时不新建。连线句挪到建 video 那一步。文件名不再换成参考图N。未提交。

## 2026-10-22

### 记录 / 说明
- 确认后是同一颗 video 的更新加两条边，不是新建。连线在第二次提案才补上。未改。
- video 连上参考图后不再被图片回落改成 nano-banana-pro。这颗节点上的错模型还在。连线仍是两拍，正文未改。
- 视觉漏接会话点名：下一拍没有 {{}} 仍附上已点名的图。同一批做完那句先不加。节点 model 仍要手动改回 seedance-2.0。
- 视频 prompt 仍存 {{id}}。控制台画成缩略图加语义名，没有名字时按连线顺序显示参考图N。
- 图片生成节点 prompt 用同一套胶囊。@ 图片没有语义名时在胶囊里起名，写入 title，文件名不写入。
- 图片和视频控制台的提示词不再把控制台撑宽，多出来的字在底栏宽度里滚动。
- 助手回复按 markdown 排版。落板卡片标题从实际动作派生，连线被拿掉时写明 0 条。截图超时，层级已在页面上核对。
- 出片失败只核对：节点是 hailuo-h3，本站任务已失败 fetch failed，没有上游 taskId。未改代码。
- 视频参考图接上复刻压缩。同一颗海螺节点重提：113KB 和 120KB，424 秒出片。上游 taskId 已落库。video 等待改为 10 分钟。
- 一镜到底写成一段。正文剧情 7504、开场 5504、开场组装 11274。新会话提案是一整段，没有分镜2，没有甩镜。已应用，没有出片。未提交。
- 一镜到底样本已落盘并出片。347秒，1.9MB。第一拍看得见图仍不写 connect。同一批做完已写入。正文剧情 7601、开场 5601、开场组装 11371。未提交。
- prompt 引用三种形态只核对：10秒存 {{id}} 画成胶囊，6秒创建时被换成标题。没有 @阿波罗。未改。
- 编号按这颗节点的入边顺序现算，不进存储。分两拍补边时号跟连线次序，语义仍贴在记号上。正文未改。
- create 落板留下 {{img}}。验收节点 vid_7778026b6446a8 磁盘仍是记号，胶囊画阿波罗，语义在胶囊外。送下游不另剥记号。
- 发送时才把 {{id}} 换成语义名。vid_7778026b6446a8 磁盘仍是记号，送出是与 阿波罗（金发白袍）。没有出片。未提交。
- 英文 prompt 是模型写进提案的，落盘逐字相同。剥离不翻译。词典英文列这次原样对应 0 条。正文未改。
- 分镜行末尾要求用用户消息的语言写。正文剧情 7678、开场 5678、开场组装 11448。英文节点 vid_e4a04155917b9 已删。未提交。
- 语言措辞一次过。502 是说明那次文本请求，APIMart 回 502，不是视频。第三处原文是由 {{神殿}} 建立的。正文未改。
- 分镜行加了引用只能做附加信息、不要把记号放进句子主干。剧情 7824、开场 5824、开场组装 11594。init 13/13。未提交。
- 提问改走卡片。点选答案进 askAnswer，消息正文为空。开场只给素材弹出 4 张单选卡。init 13/13。未提交。
- 短句禁令旁加了批准只在审批卡上点。审批卡这轮没出现：模型给了更新，没有运行。
- 提问卡改成一屏一题。忽略记成用默认。标签时间线等 changelog，没做。
- 已生效格、changelog、标签已落。新会话建了 vid_69034963f8b71，标签是视频节点已创建。符合预期后模型又提案一颗，没点应用。

## 2026-10-23

### 记录 / 说明
- 已生效清单写成防重复约束。符合预期这轮没有新建，也没有更新卡，回复点名了上一轮那颗 id。第四节那句没加。剧情 8241、开场 6241、开场组装 12352。
- 开场步骤1到步骤2没有「认可 prompt 之后提交生成审批」。审批卡只挂在 execute 提案上。措辞未写，禁令未动。
- 认可 prompt 之后下一拍必须提交运行。符合预期这轮是执行已有 video，审批卡批准/拒绝，没有新建。没点批准。剧情 8392、开场 6392、开场组装 12503。
- 助手正文不再折进思考过程。卡片未出现是第1种：消息 86a65d39 的 meta 是空的，没有 ask_user。措辞未写。
- 卡是工具调用触发的。缺模式和强度时出了两张提问卡，正文是空的，没有思考过程。剧情 8512、开场 6512、开场组装 12623。没点选项。
- 提问卡换成参考图的列表样式（编号行、N/M 同行、继续实心胶囊），审批卡不动。init 13/13。
- 建连改自动落板，只有运行走审批卡；清单带状态位；短句判据改成未点的审批卡。符合预期出审批卡不新建，没卡时好的不新建不跑。剧情 8566、开场 6566、开场组装 12733。
- 清单原文抓到：已创建（未生成）进了真实提示。手动确认开关和13:24旧节点已删。发现自动落板节点被另一页旧稿覆盖（409本地结构为准），vid_2356已丢，待定修法。
