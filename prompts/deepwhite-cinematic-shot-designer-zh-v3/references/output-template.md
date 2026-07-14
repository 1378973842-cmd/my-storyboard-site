# 输出模板

Use this exact Markdown document structure unless the user asks for another format. The final deliverable must be a complete `.md` document.

Recommended filename:

```text
DeepWhite_导演分镜_<场景名或日期>_v3.md
```

# DeepWhite 导演分镜文档｜<场景名>

> 版本：DeepWhite Cinematic Shot Designer ZH v3  
> 用途：分镜图生成 + Seedance 视频提示词基础表  
> 日期：<生成日期>  
> 备注：本文件为 Markdown 分镜文档，可继续交给图片生成、视频提示词整理或网页排版流程使用。

## 场景诊断

- 戏剧引擎：
- 信息关系：
- 权力流向：
- 空间问题：
- 这场戏不能普通拍的原因：

## 导演规则选择

- 主规则：
- 辅助规则：
- 不采用的规则：
- 选择理由：

## 节拍地图

| 节拍 | 内容 | 信息/权力/情绪变化 | 视觉机会 |
|---|---|---|---|

## 视觉策略

| 视觉装置 | 使用位置 | 观众效果 | 为什么不是装饰 |
|---|---|---|---|

## 空间调度

Describe characters, key objects, doors/windows/table/screens/thresholds, foreground/midground/background layers, eye lines, left/right relation, who controls center, who is blocked, and who crosses boundaries.

## 分镜图生成列表

This list is for still image/storyboard generation. Keep it visual and static-frame friendly.

| 镜号 | 镜头功能 | 构图 | 画面描述 | 景别 | 机位 | 镜头角度 | 焦段感 | 运镜 | 视觉规则 |
|---|---|---|---|---|---|---|---|---|---|

Field rules:

- `镜号`: match the video foundation list exactly. Use plain identifiers only, such as `镜头1`, `镜头2`, `镜头3`; do not append `必拍`, `可删减`, `覆盖镜头`, or any equivalent priority label.
- `构图`: use photographic/aesthetic composition terms only. Recommended terms: 中心构图、三分法构图、框架构图、对角线构图、引导线构图、对称构图、黄金分割构图、纵深构图、负空间构图、三角构图、S形构图、前景遮挡构图、层次构图、开放式构图、封闭式构图. If needed, combine terms briefly, such as `三分法构图 + 前景遮挡构图`.
- `画面描述`: describe visible subjects, pose, objects, environment, light, and spatial relation.
- `景别`: 远景、全景、中景、中近景、近景、特写、大特写、插入特写.
- `机位`: camera position, such as 门缝外、桌面低位、角色背后左侧、正上方、走廊尽头.
- `镜头角度`: 平视、俯视、仰视、侧面、背面、斜角、极端低角度、正上方.
- `焦段感`: 广角、标准、长焦、微距; write feeling rather than exact lens if uncertain.
- `运镜`: static-frame generation may still record intended movement: 静止、缓慢推进、横移揭示、拉远、跟拍、摇镜.

## 静帧生图提示词

为分镜图列表每个镜号输出双语静帧生图 prompt（供图片模型，非视频）：

### 镜头N
**English Prompt**
[Subject + Action] + [Location] + [Composition] + [Lighting] + [Style] + [Camera/Lens] + [Color Grading]

**中文提示词**
[同上意图的中文可粘贴提示词]

Rules:
- 禁止时长、运镜时间轴、音效、对白时间码。
- 有参考图时保留 `{@图N}`。
- 镜号必须与分镜图列表一致。

## 视频提示词基础列表

This list preserves the same shot identities and expresses every shot as Seedance-style video prompt material in table form. It is not a single merged copyable prompt block, but each row should read like prompt-ready content.

| 镜号 | 时长 | 构图 | 画面描述 | 景别 | 机位 | 运镜 | 台词 | 动作 | 节奏 | 音效 |
|---|---|---|---|---|---|---|---|---|---|---|

Field rules:

- `镜号`: must match the image storyboard list exactly and remain a plain identifier only.
- `时长`: estimated duration for this shot, such as `1.5秒`, `3秒`, `6-8秒`; use timing that matches the dramatic beat and camera movement.
- `构图/画面描述/景别/机位/运镜` must be consistent with the image list.
- `构图`: use the same photographic/aesthetic composition term as the image list unless the motion meaning requires a clearly stated variant.
- `画面描述`: write concrete Seedance-friendly visual content: visible characters, spatial relation, lighting, props, background activity, and no abstract directing theory.
- `台词`: keep speaker and spoken line in one cell. Required format: `角色名（说话语气）：“台词内容”`. If there are multiple speakers in one shot, list them in speaking order inside the same cell, separated with `<br>`. If the line is offscreen, write `角色名（画外、说话语气）：“台词内容”`. If there is no dialogue, write `无对白`.
- `动作`: visible body/object movement in time order; include performance behavior through visible action rather than separate emotion or micro-expression fields.
- `节奏`: Seedance-oriented timing and motion rhythm, such as `先静止0.5秒后缓慢推进`, `对白中段短暂停顿`, `动作突然打断`, `缓慢揭示`.
- `音效`: diegetic sound only, such as environment sound, footsteps, breath, door, phone vibration, fabric friction, object impact. Do not write BGM unless the user explicitly asks.
- Do not include columns named `听者反应`, `情绪`, `微表情`, `情绪变化`, `剪辑点`, or `声音`.
- Dialogue coverage is mandatory: every source dialogue line must appear in one and only one `台词` cell unless the user explicitly requests compression.

## 镜头语言自检

- 每个镜头是否改变信息、权力、情绪或空间理解：
- 是否存在可删除的漂亮空镜：
- 是否至少 50% 镜头使用明确视觉装置：
- 是否避免默认正反打：
- 分镜图列表和视频基础列表是否镜号一致：
- 视频提示词基础列表是否每个镜头都有时长：
- 原剧本每一句对白是否都进入某个 `台词` 格，并标注说话人和语气：
- 多人对话镜头是否按说话顺序保留所有发言人：
- 镜号是否只显示编号、没有必拍/可删减/覆盖镜头等标签：
- 构图列是否使用摄影美学构图名词，而不是长段画面描述：
- 视频提示词基础列表是否删除了 `听者反应`、`情绪`、`微表情`、`情绪变化`、`剪辑点` 字段，并使用 `音效` 而不是 `声音`：
- 视频提示词基础列表是否符合 Seedance 书写习惯，避免抽象导演理论：
- 最终交付是否已经形成完整 Markdown 文档：
- 哪个镜头最能体现本场戏：
- 下一版可强化方向：
