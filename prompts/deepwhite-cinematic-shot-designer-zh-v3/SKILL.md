---
name: deepwhite-cinematic-shot-designer-zh-v3
description: Chinese director-level shot design for screenplays, short dramas, films, and storyboard planning. Use when the user asks for cinematic shot breakdowns, director thinking, filming-oriented storyboards, image storyboard shot lists, Seedance-style video prompt shot tables, camera angles, composition, blocking, visual grammar, Markdown shot-design documents, or wants to improve flat/ordinary shotlists using a library of about ten director rule systems. Output a complete Markdown document with structured shot tables rather than a single merged video prompt unless the user explicitly asks for final platform-specific prompt blocks.
---

# DeepWhite Cinematic Shot Designer ZH v3

Use this skill to convert a screenplay scene into two director-level deliverables:

1. **分镜图生成列表**: still-image/storyboard-oriented shot list.
2. **视频提示词基础列表**: Seedance-style shot table that expresses each shot as video-generation prompt material.

The skill designs filming logic first, then expresses each shot in a Seedance-friendly table format. The final deliverable is a complete Markdown document. It does not output one merged copyable platform prompt by default.

## Non-Negotiables

- Write in Simplified Chinese.
- Do not output one merged final Seedance/Kling/Runway/Sora prompt block unless the user explicitly asks. The default video deliverable is a Seedance-style per-shot table.
- Do not use director names as style filters. Use them as rule systems tied to dramatic function.
- Do not default to neutral mid-shot / reverse-shot coverage.
- Do not write empty phrases such as "电影感", "高级感", "氛围感", "张力强". Replace them with visible composition, blocking, lens, angle, movement, sound, and performance decisions.
- Every shot must answer: why this shot exists, what it changes for the audience, and what ordinary coverage would lose.
- Shot numbers must be plain identifiers such as `镜头1`, `镜头2`, `镜头3`. Do not append `必拍`, `可删减`, `覆盖镜头`, or any equivalent production-priority label after the shot number.
- In the output tables, the `构图` column must use photographic/aesthetic composition terms, such as 中心构图、三分法构图、框架构图、对角线构图、引导线构图、对称构图、黄金分割构图、纵深构图、负空间构图、三角构图、S形构图、前景遮挡构图、层次构图. Put detailed subject placement, foreground/midground/background relation, and obstruction details in `画面描述`, not in `构图`.
- In the video prompt table, speaker and dialogue must be in the same `台词` cell. Always mark the speaker and speaking tone, for example `李燃（压低声音、试探）：“你到底看见了什么？”`.
- Preserve all dialogue from the source scene. For multi-person dialogue inside one shot, list every speaker in order inside the same `台词` cell; do not omit a character's line because the shot is summarized as a beat.
- The video prompt table must not contain columns named `听者反应`, `情绪`, `微表情`, `情绪变化`, or `剪辑点`.
- Use `音效`, not `声音`.
- Write the video prompt table in Seedance-friendly language: concrete visible subjects, camera, movement, action, spoken lines, diegetic sound effects, and generation-safe constraints. Avoid director-theory explanations inside the table cells.
- The final output must be a complete Markdown document, not loose notes. If file writing is available, save the result as a `.md` file; otherwise output the complete Markdown document body in chat.
- Default Markdown filename: `DeepWhite_导演分镜_<场景名或日期>_v3.md`. Use a safe short scene name when available.
- If no scene text is provided, ask for the scene before designing shots.

## Reference Loading

Always read:

- `references/visual-grammar.md`
- `references/director-selection.md`
- `references/output-template.md`

Then read only the relevant director files:

- `references/spielberg-rules.md`: discovery, wonder, family emotion, emotional identification.
- `references/nolan-rules.md`: time pressure, parallel action, information systems, scale.
- `references/fincher-rules.md`: lies, investigation, surveillance, control, repression.
- `references/hitchcock-rules.md`: suspense, danger known to audience, voyeurism, delayed reveal.
- `references/kurosawa-rules.md`: group blocking, weather, moral conflict, power movement.
- `references/ozu-rules.md`: family order, silence, restraint, low static camera.
- `references/wong-kar-wai-rules.md`: longing, missed timing, obstruction, fragmented intimacy.
- `references/park-chan-wook-rules.md`: symmetrical control, desire, revenge, ornate psychological framing.
- `references/kubrick-rules.md`: axial symmetry, ritual, institutional dread, cold geometry.
- `references/villeneuve-rules.md`: scale, silence, negative space, mystery, existential pressure.

## Workflow

1. **Scene diagnosis**
   - Identify dramatic engine: discovery, concealment, pursuit, interrogation, seduction, betrayal, countdown, confession, power transfer, moral choice, emotional collapse, family silence, ritual, or existential pressure.
   - Identify audience knowledge: audience knows more, less, or learns with the character.
   - Identify power flow: who controls the scene at the start, when control shifts, and who ends with control.
   - Identify spatial problem: cramped, exposed, watched, divided, maze-like, ritualized, public/private overlap, threshold crossing, vast/empty, or domestic order.

2. **Director rule selection**
   - Choose one primary director rule system and at most two secondary systems.
   - Explain why each selected system fits the scene.
   - State one tempting but rejected system when useful.

3. **Beat map**
   - Split the scene into 3-8 dramatic beats.
   - Each beat must change information, power, danger, intimacy, emotion, or spatial understanding.
   - Map every source dialogue line to a beat before designing shots. This can be internal unless the user asks to see the dialogue coverage.

4. **Visual strategy**
   - Select 4-8 visual devices from `visual-grammar.md`.
   - Include at least three non-neutral devices unless the scene intentionally requires still austerity.
   - Recommended devices include foreground obstruction, frame-within-frame, overhead, high/low angle, extreme angle, negative space, withheld reverse, long-lens compression, wide-angle pressure, motivated push-in, lateral reveal, surveillance geometry, insert-as-clue, axis pressure, and group depth.

5. **Spatial blocking**
   - Describe positions before shots: doors, windows, table, key props, character distances, eye lines, left/right power relation, foreground/midground/background layers.
   - If characters move, state who crosses a boundary, who is blocked/revealed, who controls the center, and who loses space.

6. **Shot design**
   - Design shots from beats and visual strategy, not by mechanically cutting after every dialogue line.
   - Do not lose dialogue while designing by beat. Every source dialogue line must be assigned to a shot's `台词` cell.
   - Use plain shot numbers only. Do not mark shots as `必拍`, `可删减`, or `覆盖镜头`.
   - Keep each shot visually distinct unless repetition is intentional.

7. **Dual deliverables + still image prompts**
   - First output `分镜图生成列表`: still-frame oriented, with 镜号、构图、画面描述、景别、机位、运镜.
   - Then output `静帧生图提示词`: bilingual still-image prompts per shot (English + 中文), no duration/audio/timeline.
   - Then output `视频提示词基础列表`: preserve the same shot identity and visual fields, and add 时长、台词、动作、节奏、音效.

8. **Markdown document assembly**
   - Assemble all sections into one complete Markdown document using `references/output-template.md`.
   - Include a clear title, document metadata, scene diagnosis, director rule selection, beat map, visual strategy, spatial blocking, both shot tables, still image prompts, and self-audit.
   - If working in an environment with file access and the user expects an artifact, save the Markdown document as a `.md` file.

9. **Self-audit**
   - Confirm every shot changes information, power, emotion, or spatial understanding.
   - Confirm at least 50% of shots use deliberate visual grammar.
   - Remove decorative shots that do not alter audience experience.
   - Replace vague emotions with visible body behavior.
   - Confirm every video foundation row has a duration.
   - Confirm every source dialogue line appears in a `台词` cell with speaker and tone.
   - Confirm shot numbers do not contain `必拍`, `可删减`, or `覆盖镜头`.
   - Confirm the video prompt table does not contain `听者反应`, `情绪`, `微表情`, `情绪变化`, `剪辑点`, or `声音` columns.
   - Confirm still-image prompts exist for each shot and contain no video timeline/audio.
   - Confirm the final deliverable is a coherent Markdown document and, when file output is possible, saved as `.md`.
   - Check whether default reverse-shot coverage would produce the same result; if yes, redesign.

## Output Order

1. `场景诊断`
2. `导演规则选择`
3. `节拍地图`
4. `视觉策略`
5. `空间调度`
6. `分镜图生成列表`
7. `静帧生图提示词`
8. `视频提示词基础列表`
9. `镜头语言自检`

Wrap these sections in a complete Markdown document. Do not include a general explanation of the skill in task output. Focus on the user's scene.
