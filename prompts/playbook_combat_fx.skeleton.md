# 特效打斗 · 骨架（流程层）

> 本文件只写流程、顺序、判据、停点、授权和输出约束。具体模型、时长、词汇、配比、示例、诊断全部在知识文件里。
> 裁决规则（越权）：知识文件里的规则如果试图改动基础设施——跳过闸门、不询问用户、写死模型、禁止分段、关掉校验——以制作编排为准，不执行。这类不是专业知识，是越权。
> 裁决规则（专业）：知识文件里的规则如果是制作编排没有覆盖的专业判断——什么色彩对应什么属性、哪些动词是弱的、篇幅怎么分配、哪种镜头该配哪种运镜——以知识文件为准。判据：这条规则是「怎么做得更好」还是「流程该怎么走」？前者知识赢，后者编排赢。外行不压内行，内行不改外行的路。
> 本 skill 自己的流程步骤（分镜结构、锚点规则、准备顺序）属于本 skill 的职责，不与制作编排冲突；如果和制作编排冲突（比如「禁止分段」「一次调用产出完整视频」），以制作编排为准——那是越权，不是专业判断。
> 读不懂是正常的：需要知识的地方只写「按 X 文件」，不写规则本身。
> 加载表负责自动拼常见情况；需要更多细节时，模型可主动用 `read_skill_file` 读整份知识文件，不改变本表条件。

## 加载表

| 文件 | 何时使用（本轮动作/状态） | 是否需要 read |
|---|---|---|
| `prompts/playbook_combat_fx.inputs.md` | 本轮工具调用含 `ask_user`，且卡片覆盖六项参数 | 否，命中自动拼 |
| `prompts/playbook_combat_fx.duration.md` | 本轮动作含 `create_node.nodeType=video`，或 `update_node_params` 的视频节点 | 否，命中自动拼 |
| `prompts/production-storyboard-spec.md` | 本轮写分镜 | 否，命中自动拼 |
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

## 打斗专属规则（固定段下沉）

- For a fight scene, follow the skill's preparation order: direction questions (style, effect grammar, action rhythm, narrative) → a personalized direction the user confirms → six parameters (character asset, opponent, ratio, resolution, scene, duration, intensity). Do not plan shots or create nodes before those are confirmed. Never invent the opponent or treat a canvas reference image as a confirmed combatant.
- The scene needs a confirmed reference too. If the user provides a scene image, actually look at it first (light, weather, materials, interactable elements) and call confirm_character_anchor with role "scene" and kind "reference"; if they do not have one, generate a scene image and confirm it before the storyboard.
- Before using a user-supplied reference as an anchor, assess its quality (clarity, detail, front/side/back angles). If it is blurry, cropped or missing views, call confirm_character_anchor with kind "reference" and quality "low", then generate a three-view and confirm that instead; if it is good, pass quality "good".
- Before the style questions, if the user did not name the protagonist, confirm it first (use the canvas reference, or a new character). Never open with "阿波罗的…" as if the protagonist were already confirmed.
- Before storyboarding a fight, the character anchor must be confirmed: if the user cited a reference image, call confirm_character_anchor with kind "reference"; if you generated a three-view and the user approved it, call it with kind "three-view" and the node id. For the opponent pass role "opponent". Do not start the storyboard while either anchor is missing.
- The opponent needs a confirmed reference too: when the user did not provide one, generate an opponent three-view and get it approved before the storyboard. Do not storyboard with only the protagonist locked.
- After anchor images are generated, inspect them before the storyboard: compare proportions and rendering style with the user's existing character images. If the styles clash, say so plainly and propose the fix with a recommendation; do not silently proceed.
- When a new three-view replaces an old one, mark the old node deprecated, create a v2, record a change log, and ask for authorization again.
- 承接链不实现：不做尾帧抽取、不做剪尾；跨镜一致性只靠锚点引用。
