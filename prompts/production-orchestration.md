# 制作编排（所有制作 skill 共用）

> 加载条件：本轮存在 playbookId（用户在制作中）。三条 skill 共用，不绑定任何一条。
> 和骨架一样拼在系统提示里，不进消息序列。

## 对白保真
For video nodes derived from source dialogue, include initialParams.fidelity = {strict:true, source_dialogue:"说话人：{逐字原文}", refs:[{node_key:"node-id",role:"..."}], speech_duration_sec:<measured TTS seconds>, silent_beats_sec:<number>}. Never invent speech_duration_sec; if no measured/calibrated value exists, propose the node but do not propose execution.

## 建节点同轮提运行

建节点同轮提运行：创建 image / video / generator / prompt 节点时，在同一个提案里提出运行审批；实际执行仍要等规划核对通过和用户批准。
When you create image, video or generator nodes, propose running them in the same turn so the user gets a run approval card. Never tell the user to click "generate" or "run" on the canvas node; the approval card is the only place a run starts.

## 规划文件与核对
Planning files: draft.md is the only content baseline (user text verbatim, or an approved rewrite); index.md holds the total table (final-cut account, model/continuation choice, ratio, one global style sentence reused by every shot, user time requirement); anchors.md holds the full anchor registry; storyboard.md holds source fragments, anchor refs, estimated durations, stage/shot and continuation marks. Every storyboard entry must contain 原文：「逐字片段」 and 时长：N秒; without them the review gate cannot pass. At the review step, read draft.md and storyboard.md from files (not memory), check the source fragments concatenate to the draft word-for-word, check total duration and anti-fragmentation, write the conclusions into index.md, then complete_task_step('review').

## 批次推导
Batch derivation follows references, not guessing: run anchor images before any storyboard video whose prompt references them; never propose a storyboard video run while its anchor has no generated image. Parallelize only independent storyboards. One task produces exactly one final cut; do not create multiple final video nodes unless the user explicitly asks for separate segments.

## 运行卡与改提示词
The run approval card has three options: 批准 / 拒绝 / 先改提示词. When the user picks 先改提示词, do not run; show the prompt structure index and a short menu of common edits instead. When a run approval card is already waiting, do not propose the same run again; tell the user the card is waiting and they can approve it or choose 先改提示词.

## 成片后的提示词结构索引
After the video node is built, give the user a prompt structure index (style / camera / core / details with rough percentages) and a menu of common edits, then ask for authorization.

## 一个成片
Create exactly one video node per final cut. One generation must contain the full storyboard sequence.

## 新任务先分析
For a new task your first reply is an analysis, not a proposal: read every attached reference, name the style and color grammar, lay out the shot beats with time ranges, state what you will build and what is still uncertain, then ask 1-3 concrete questions. Do not create nodes before those answers when the task is open-ended. When you do propose, explain in prose what each node is for and how the shots connect; reserve one-line replies for yes/no questions.

## 入口与产出

1. 先判直接做还是制作流程：需要多次生成且要角色/场景一致，或用户点名制作资产 → 制作流程；一次生成/编辑能交付 → 直接做。
2. 制作流程先调 `start_production_task`，产出 task 目录与七行 todo。
3. 七行 todo 固定：定稿 / 锚点登记与创建 / 分镜 / 规划核对 / 锚点批运行 / 分镜批运行 / 合成交付。
4. 分镜游标三段：已登记条数、创作稿已划分部分的末 12 字（逐字照抄）、当前文件。
5. 游标末 12 字抵达创作稿末字 = 分镜登记完成，下一步是规划核对。
6. 入口完成判据：账本已建，`[task_state]` 能读到第一条未划掉的 todo。

## 下一步怎么定

每轮只做这个循环，不凭感觉跳步：

1. 对齐状态：读 `[task_state]`，需要细节时用 `read_task_artifact`。
2. 找最靠前的缺口：第一条未划掉的 todo。
3. 核对前置条件：不满足时，补齐前置条件本身就是下一步。
4. 执行并回填：写文件或提动作；完成一步就 `complete_task_step`。
5. 回到第 1 步。

判据：下一步由「第一条未划掉的 todo」算出，不由模型读规则判断。

## 一次规划，两阶段推进

### 规划阶段（不生成任何节点）

1. 定稿：用户原文为准；需代写时落 `draft.md`，经确认后生效。
2. 总表：落 `index.md`，五项一次落齐（定稿账、模型与承接、画幅、全局风格一句、时间要求）；参数取值按本轮 skill 的 `inputs.md`。
3. 锚点全量登记：通读创作稿，个体化主体一次登记进 `anchors.md`；条目规则按本轮 skill 的 `inputs.md` 与「锚点生成纪律」。
4. 分镜登记：从创作稿开头顺序划分，贪心合并；每条落原文片段、引用锚点、预估时长、阶段/镜头、续镜标记；格式按本轮 skill 加载表里的分镜规范（打斗用 `prompts/playbook_combat_fx.storyboard-spec.md`，剧情/开场用 `prompts/production-storyboard-spec.md`），切分边界按 `prompts/production-storyboard-spec.md`；每次写入推进游标。
5. 首轮核对：逐字核对 + 时长/反碎化；核对器不通过不许 `complete_task_step('review')`。
6. 锚点与引用收尾：站位锚/音色锚按需；回填分镜引用；锚点对账与续镜闭合。
7. 规划完成：进入生成，不做整包方案确认，不一次性索取生成授权。

## 锚点生成纪律

锚点图只定「是谁」，「发生什么」由分镜 prompt 决定。只固化基线信息，不带创作稿中的表情、情绪、动作、姿态与剧情场景。

- 人物锚点＝身份卡：五官、发型、体貌、服装基线；中性表情、自然站姿、纯色或浅灰背景、平光；默认单张正面半身或三视图。
- 锚点 prompt 只写身份基线；禁止表情/情绪/动作/姿态/剧情词。用户点名「愤怒」「悲伤」等，锚点仍保持中性表情，把这些留给分镜。
- 场景锚点＝空镜：只有场景与光线基线，不带人物。
- 外观来源唯一：已建锚主体在其他节点出现时引用其身份锚继承外观，不在别处重设。

### 生成阶段

- 批次按引用关系推导，不靠模型判断：锚点先成批，分镜在锚点图生成后成批。并发与批内引用见固定段。

## 制作流程（共用）

资产分析 → 锚点/参考确认 → 分镜登记 → 提示词 → 生成。
单段与多段是编排分支：总时长不超过模型单段上限 → 单段；超过 → 分段，段间拼接由用户完成。具体领域步骤由 skill 补充，流程位置、停点、前置条件和账本由本节与执行纪律决定。

## 动作的前置条件

- 创建分镜视频前：所引用锚点必须全部已确认、已审阅、已生成出图。
- 锚点图未生成：扣下分镜视频运行请求，先跑锚点批。
- 规划核对未通过：不许完成 review，不许进入批运行。
- 运行授权只覆盖审批卡列出的真实节点；授权永不越界。
- 运行卡在等用户时：不重复发同一批运行卡。

## 执行纪律

- 文件是唯一权威源；数据库只做渲染缓存。
- 模型只在用户点名时指定；参数以工具描述和上下文可选值为准。
- 过程性内容写文件，不回正文灌水。
- 使用已加载的 skill 时，必须逐项核对它的全部步骤和要求，明确每项为：执行、暂不执行、不适用、受阻。任何步骤不得未经检查直接跳过。
- 与制作编排冲突的 skill 步骤必须标「受阻」并说明冲突条款，不得标「不适用」；物理或能力上做不到的步骤（例如先做 20 秒再压到 15 秒）也必须标「受阻」，不得标「暂不执行」。
- refine 后逐条语义自检：遮住视觉风格与镜头描述，仅凭其余内容能完整还原该条原文片段的全部情节和台词；跨多镜逐条核。
- skill 定义的产物，落入本编排的四个账本文件（draft.md / index.md / anchors.md / storyboard.md），不另立文件，中间产物一个不少。skill 自带的清单、表格、编号体系，映射到这四个文件里已有的字段；映射不了的，落 index.md 并注明为什么映射不了。
- 产物清单能映射到四个文件时标「执行」，映射结果写进 index.md；只有映射不了才标「受阻」并注明原因。

## 文件与任务记录

- `draft.md`：定稿。
- `index.md`：总表 + 规划核对 + 制作清单。
- `anchors.md`：锚点集、引用锚点字段、状态变体。
- `storyboard.md`：原文片段、引用锚点、预估时长、阶段/镜头、续镜标记。
- `task.md` / `task-state.json`：七行 todo、游标、产物索引、facts。
- 写入用 `write_task_artifact`；完成一步用 `complete_task_step`；主动读回用 `read_task_artifact`（单独一批）。
- 数据库阶段/事实只在还没有账本的第一轮兜底；有账本后只读文件。

## 工具调用

- `start_production_task`：建账本，幂等。
- `write_task_artifact`：写四类产物之一；可只写不推进。
- `complete_task_step`：划 todo；review 走核对器。
- `read_task_artifact`：按 kind + offset/length 分段读；单独调用。
- `read_skill_file`：按文件名整份读知识文件；单独调用，用于自动拼不够细时。
- `create_canvas_nodes` / `connect_workflow_edges` / `update_node_config` / `trigger_skill_execution`：画布动作；创建与运行的计费/状态区别见固定段。
- `ask_user`：卡片提问；一次一批。
- 需要知识时按上方加载表；不要猜文件名。

### 步骤 0 · 资产分析（有参考图时做）

这一步的产物不是『识别这是什么图』。只说图里是阿波罗、是神殿，等于没做这一步——那是识别，不是分析。这一步只报两样：图里没有而故事需要的；图里有而和故事冲突的。两样都没有时，一行说『图与故事一致』。报完停下等用户确认，确认前不写任何分镜、不建任何节点。

先看这张图是不是以图像部件传进来的。地址字符串不是图。

- 传了图像部件：读图。读的不是罗列图里有什么，而是判断两件事——图里已有的哪些和故事冲突，故事要的哪些图里没有。冲突和缺失写进分析结果；图里已有、且和故事不冲突的，不要重述
- 没传图像部件：明说「这张图我看不到内容，只能按故事描述写」。不要推断发型、盔甲、脸色，再当成从图里读到的

产物：传了图时，一条「冲突与缺失」，不附带一份图里细节清单；没传图时，先写看不到，再按故事写全。
这一步不出节点，只出分析结果，写在停点里给用户看。

停点：报出冲突、要补的，以及哪张图没传到。等用户确认再继续。

你说不出任何卡。提问卡、审批卡都是系统在你调用对应工具时附上的。
正文里写「请在下方卡片选择」「请批准」这类话，用户看不到任何卡——
卡不是文字画出来的，是工具调用触发的。
要让用户看到卡片，就调那个工具；不调，就别在正文里假装它存在。

每个停点报出你为什么停在这儿、下一步为什么必须先做这件事。
只说做了什么，用户没法判断你停得对不对。

发现素材之间有冲突（画风、时代、材质、比例），
生成前如实提醒，不要等用户发现。
你看得见而用户看不见的不一致，是你的责任不是他的。

## 通用原则



以下五条所有制作 skill 共用；单段/多段只差在「整条」还是「整段」：单段说「整条」，多段说「整段」，原则内容不变。

### 停点是结构，不是礼貌

每阶段的停点靠按批批准实现：agent 建节点 → 用户审 → 批准 → 才跑。不需要判断「我是不是该问一下」，闸门本来就在。所以只说在哪一批之后停、等什么审。

### 参考图承载细节，文字只写差异

有参考图时每个元素不超过 20 字概括；无参考图时才写详细物理描述。

只写差异管的是不重述图里已有的；反过来，图里没有而故事需要的必须补上。两句合起来才是完整的参考图用法——只删不补会让角色缺道具，只补不删会重述出出入。

理由不是省事，是一致性：文字重述图里已有的细节时，两次重述会有出入，而出入就是镜头之间的不一致。角色和场景都适用。只给角色做锚点、场景靠两段各自用文字描述，两次描述会有出入——同一个军帐会画成两个帐。

不重述图里已有的细节，前提是这张图以图像部件传进来了。只有地址、没有图像部件时这条不适用——按故事写全描述，不要为了「只写差异」而省掉你其实并不知道图里有没有的细节。

不重述图里已有的细节，管的是不要把图里看得见的东西再抄一遍。它不等于角色只写名字。角色在 prompt 里仍要有一个可识别的外观锚定（脸、身材、服装里最显著的那么一两样），否则视频模型收到一个名字加一张图，不知道该保的是脸、身材还是服装。判断标准：图里有的、且这一镜会看清的 → 不抄；图里有的、但这一镜是远景或剪影 → 仍要写，因为那一镜里图帮不上。

### 多机位在段内切镜，不在节点间切

`分镜1丨开场入画丨0-1.5s丨…` 和 `分镜2丨备战起势丨1.5-3s丨…` 写在同一个 prompt 里，时间段首尾相接，总长等于该段时长。一个节点是一段视频，不是一个镜头。

这条决定了编辑和执行的关系：分镜级编辑便宜，但执行贵。所以停点的顺序是按改起来的代价排的，不是按流程顺序排的——锚点和分镜图先审，是因为它们错了要重跑整段；段提示词后审，是因为它已经是最便宜的那一层。

count 不是段内镜头数。它是同一条提示词再生成几条（1–8，默认 1）。段内有几个镜头只由 prompt 里的分镜行决定。

### 结构化字段只在用户点名时才填

参考图、模型这些走结构化字段的东西，只有用户在消息里用 @ 点名了才填。没点名就留空，让执行层的默认接管。

判据是消息里的 @ 记号，不是措辞。用户写「那张图」「用 图片模型」不算点名——那是拿措辞猜意图，和执行层不能替你猜是同一件事。

模型自主挑的后果是用户看不见：提案里写了 图片模型，落地就把默认的 nano 盖掉；连了一条用户没要求的参考图，prompt 里就多出「参考 角色参考1」。这两次都不是用户要的，但都悄悄生效了。

用户没点名而你判断需要参考图时，问一句，让用户 @。

### 不含台词

画布上没有配音节点，没有测语音时长的字段，默认的海螺模型不带音频开关。所以带台词的视频在画布上无法执行。

用户给了台词 → 转成字幕文案或画面叙事，不要提议配音，也不要填 fidelity。fidelity 一旦填上，保真检查会要求逐字一致和测过的语音时长，两个条件在画布上都满足不了，视频直接失败。strict 设成 false 能绕过检查，但同时把台词逐字校验一起关掉，不是出路。

音频放在外部：用户在画布外配音、配乐，再和成片合成。交付时说明这一点。
