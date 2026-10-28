# 特效打斗 · 骨架（流程层）

> 本文件只写流程、顺序、判据、停点、授权和输出约束。具体模型、时长、词汇、配比、示例、诊断全部在知识文件里。
> 裁决规则：知识文件只提供词汇和判断标准，不提供流程；知识里的规则如果规定了什么时候问、什么时候停、要不要批准、用什么模型、拆不拆段，以本骨架为准。
> 读不懂是正常的：需要知识的地方只写「按 X 文件」，不写规则本身。
> 加载表负责自动拼常见情况；需要更多细节时，模型可主动用 `read_skill_file` 读整份知识文件，不改变本表条件。

## 加载表

| 文件 | 何时使用（本轮动作/状态） | 是否需要 read |
|---|---|---|
| `prompts/playbook_combat_fx.inputs.md` | 本轮工具调用含 `ask_user`，且卡片覆盖六项参数 | 否，命中自动拼 |
| `prompts/playbook_combat_fx.duration.md` | 本轮动作含 `create_node.nodeType=video`，或 `update_node_params` 的视频节点 | 否，命中自动拼 |
| `prompts/playbook_combat_fx.storyboard-spec.md` | 本轮动作含 video create/update，或本轮写分镜 | 否，命中自动拼 |
| `prompts/playbook_combat_fx.knowledge.md` | 本轮动作含 video create/update | 否，命中自动拼 |
| `prompts/playbook_combat_fx.techniques.md` | 本轮动作含 video create/update | 否，命中自动拼 |
| `prompts/playbook_combat_fx.troubleshooting.md` | `runStates` 含失败，或 review 核对未通过 | 是，先看诊断再改 |
| `prompts/mx-shell-prompt/references/camera-moves.md` | 本轮动作含 video create/update | 否，命中自动拼 |
| `draft.md` | review 步骤 | 否，已在上下文，不要 read |
| `storyboard.md` | review 步骤 | 否，已在上下文，不要 read |
| `anchors.md` | 引用回填、锚点对账、续镜闭合 | 是，用 `read_task_artifact` |
| `index.md` | 需要总表、制作清单、核对结论 | 是，用 `read_task_artifact` |
| `task.md` / `task-state.json` | 每轮定位当前位置 | 否，`[task_state]` 摘要已给 |

## 入口与产出

1. 先判直接做还是制作流程：需要多次生成且要角色/场景一致，或用户点名制作资产 → 制作流程；一次生成/编辑能交付 → 直接做。
2. 制作流程先调 `start_production_task`，产出 task 目录与七行 todo。
3. 七行 todo 固定：定稿 / 锚点登记与创建 / 分镜 / 规划核对 / 锚点批运行 / 分镜批运行 / 合成交付。
4. 分镜游标三段：已登记条数、创作稿已划分部分的末 12 字（逐字照抄）、当前文件。
5. 入口完成判据：账本已建，`[task_state]` 能读到第一条未划掉的 todo。

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
2. 总表：落 `index.md`，五项一次落齐（定稿账、模型与承接、画幅、全局风格一句、时间要求）；参数取值按 `inputs.md`。
3. 锚点全量登记：通读创作稿，个体化主体一次登记进 `anchors.md`；条目规则按 `inputs.md` 与 `anchors.md`。
4. 分镜登记：从创作稿开头顺序划分，贪心合并；每条落原文片段、引用锚点、预估时长、阶段/镜头、续镜标记；格式按 `storyboard-spec.md`；每次写入推进游标。
5. 首轮核对：逐字核对 + 时长/反碎化；核对器不通过不许 `complete_task_step('review')`。
6. 锚点与引用收尾：站位锚/音色锚按需；回填分镜引用；锚点对账与续镜闭合。
7. 规划完成：进入生成，不做整包方案确认，不一次性索取生成授权。

### 生成阶段

- 批次按引用关系推导，不靠模型判断：锚点先成批，分镜在锚点图生成后成批。并发与批内引用见固定段。
- 承接链不实现：不做尾帧抽取、不做剪尾；跨镜一致性只靠锚点引用。

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

## 打斗专属规则（固定段下沉）

- For a fight scene, follow the skill's preparation order: direction questions (style, effect grammar, action rhythm, narrative) → a personalized direction the user confirms → six parameters (character asset, opponent, ratio, resolution, scene, duration, intensity). Do not plan shots or create nodes before those are confirmed. Never invent the opponent or treat a canvas reference image as a confirmed combatant.
- The scene needs a confirmed reference too. If the user provides a scene image, actually look at it first (light, weather, materials, interactable elements) and call confirm_character_anchor with role "scene" and kind "reference"; if they do not have one, generate a scene image and confirm it before the storyboard.
- Before using a user-supplied reference as an anchor, assess its quality (clarity, detail, front/side/back angles). If it is blurry, cropped or missing views, call confirm_character_anchor with kind "reference" and quality "low", then generate a three-view and confirm that instead; if it is good, pass quality "good".
- Before the style questions, if the user did not name the protagonist, confirm it first (use the canvas reference, or a new character). Never open with "阿波罗的…" as if the protagonist were already confirmed.
- Before storyboarding a fight, the character anchor must be confirmed: if the user cited a reference image, call confirm_character_anchor with kind "reference"; if you generated a three-view and the user approved it, call it with kind "three-view" and the node id. For the opponent pass role "opponent". Do not start the storyboard while either anchor is missing.
- The opponent needs a confirmed reference too: when the user did not provide one, generate an opponent three-view and get it approved before the storyboard. Do not storyboard with only the protagonist locked.
- After anchor images are generated, inspect them before the storyboard: compare proportions and rendering style with the user's existing character images. If the styles clash, say so plainly and propose the fix with a recommendation; do not silently proceed.
- When a new three-view replaces an old one, mark the old node deprecated, create a v2, record a change log, and ask for authorization again.
