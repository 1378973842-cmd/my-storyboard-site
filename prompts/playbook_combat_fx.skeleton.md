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
