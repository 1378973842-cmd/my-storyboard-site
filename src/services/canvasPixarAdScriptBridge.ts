import type { Express, RequestHandler } from "express";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { pinyin } from "pinyin-pro";
import {
  augmentChatCompletionsBody,
  extractTextLlmErrorMessage,
  extractTextLlmMessageContent,
  parseTextLlmResponseBody,
  postTextLlm,
  resolveTextLlmEnv,
  textLlmConfigError,
} from "./canvasTextLlmBridge.js";

export type StoryAnimMode = "asset_prompts" | "story_script";

export type StoryImageBinding = {
  index?: number;
  name?: string;
  kind?: string;
};

export type StoryAnimBody = {
  mode?: string;
  story?: string;
  raw_script?: string;
  style_description?: string;
  duration_sec?: number;
  durationSec?: number;
  model?: string;
  imageUrls?: string[];
  imageBindings?: StoryImageBinding[];
  missing_kinds?: string[];
};

export type StoryAssetPrompt = {
  kind: "character" | "prop" | "scene" | string;
  name: string;
  prompt: string;
  node_key?: string;
};

export type StorySketchSheet = {
  sheet_index: number;
  grid_count: 4 | 6 | 9 | number;
  shot_from: number;
  shot_to: number;
  prompt: string;
};

export type StoryVideoSegment = {
  segment_index: number;
  duration_sec?: number;
  prompt: string;
};

export type StoryAnimResult = {
  mode: StoryAnimMode;
  duration_sec: number;
  sheet_count?: number;
  node_keys?: Record<string, string>;
  asset_prompts?: StoryAssetPrompt[];
  global_config_md?: string;
  storyboard_table_md?: string;
  sketch_sheets?: StorySketchSheet[];
  video_segments?: StoryVideoSegment[];
  audio_config?: Record<string, unknown>;
  display_text: string;
};

const LINE_ART_LOCK =
  /铅笔线稿|纯素描|不上颜色|不上灰度|只有黑白线条|黑白线条/;

const ALLOWED_GRIDS = new Set([4, 6, 9]);

const ASSET_API_CONSTRAINT = `
---

## API 输出约束（mode=asset_prompts）

只返回合法 JSON（无 Markdown 围栏）：
{
  "mode": "asset_prompts",
  "asset_prompts": [
    {
      "kind": "character|prop|scene",
      "name": "中文名",
      "prompt": "可直接生图的皮克斯彩图提示词",
      "node_key": "anchor_char_xxx 或 anchor_prop_xxx 或 anchor_scene_xxx"
    }
  ]
}

要求：只生成用户声明缺失的 kind；每条 prompt ≥ 80 字；角色须含「无尾巴、无翅膀、无宠物、肩上无附着物」。
`.trim();

const SCRIPT_API_CONSTRAINT = `
---

## API 输出约束（mode=story_script）

只返回合法 JSON（无 Markdown 围栏）：
{
  "mode": "story_script",
  "duration_sec": 30,
  "sheet_count": 2,
  "node_keys": { "char_a": "anchor_char_...", "scene_a": "anchor_scene_..." },
  "global_config_md": "锚点清单 Markdown（无品牌）",
  "storyboard_table_md": "含故事梗概 + 按张分镜 Markdown 表；表头：编号 | 视频内容片段（拍什么） | 引用锚点 | 镜头描述",
  "sketch_sheets": [
    {
      "sheet_index": 1,
      "grid_count": 9,
      "shot_from": 1,
      "shot_to": 9,
      "prompt": "完整线稿分镜提示词（含图N映射与线稿锁定硬句）"
    }
  ],
  "video_segments": [
    {
      "segment_index": 1,
      "duration_sec": 15,
      "prompt": "Seedance 提示词，含【画面渲染】【对话】【音效】"
    }
  ],
  "audio_config": { "bgm": "", "videoVolume": 1.0, "audioVolume": 0.4, "audioDb": -12, "lyrics": "" }
}

要求：
1. 无品牌/Logo。duration_sec 与用户一致。sheet_count ≥ ceil(duration/15)；≤15s 可为 1。
2. **第 1 张 grid_count 必须为 9**；后续张 ∈ {4,6,9}。镜号全局连续（第2张不得从镜1/Panel1 重数）；每段视频 ≤15s。
3. 分镜表引用锚点仅中文代号；镜头描述以景别开头且 ≥24 字。
4. 每条 sketch prompt 必须含线稿锁定：铅笔线稿 / 不上颜色 / 不上灰度 / 只有黑白线条。
5. 每条 sketch prompt **一律**写约定图N；并含中文结构：\`场景：\`、\`本段剧情：\`、表演夸张浮夸/迪士尼四肢、大特写与近景交替、禁止连续相同景别、禁止荷兰角倾斜构图、运镜图表；镜头号按 shot_from–shot_to 连续标注。禁止英文 Panel 重启编号。
6. 非最后一张必须写：本张非最后一张 + 最后一格动作进行中 + 禁止任何收尾信号；下张首格「承接上一段动作」。最后一段可有【结尾】但无 Logo。
`.trim();

function skillRoot(projectRoot: string): string {
  const file = path.join(projectRoot, "prompts", "pixar-ad-execution-script", "SKILL.md");
  if (!existsSync(file)) {
    throw new Error("缺少故事动画 skill：prompts/pixar-ad-execution-script/SKILL.md");
  }
  return file;
}

function loadSystemPrompt(projectRoot: string, mode: StoryAnimMode): string {
  const skill = readFileSync(skillRoot(projectRoot), "utf8").trim();
  return `${skill}\n\n${mode === "asset_prompts" ? ASSET_API_CONSTRAINT : SCRIPT_API_CONSTRAINT}`;
}

export function toNodeKeySuffix(value: unknown): string {
  const source = String(value || "").trim();
  const romanized = pinyin(source, { toneType: "none", type: "array" }).join("");
  const safe = romanized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return safe || "asset";
}

export function normalizeDurationSec(raw: unknown): number {
  const n = Math.round(Number(raw) || 0);
  if (![15, 20, 25, 30].includes(n) && (n < 31 || n > 180)) {
    throw new Error("时长须为 15/20/25/30，或 31–180 的自定义秒数");
  }
  return n;
}

export function minSheetCount(durationSec: number): number {
  return Math.max(1, Math.ceil(durationSec / 15));
}

function stripFence(text: string): string {
  const source = String(text || "").trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(source);
  return fenced ? fenced[1].trim() : source;
}

function extractJson(text: string): Record<string, unknown> | null {
  const clean = stripFence(text);
  try {
    return JSON.parse(clean) as Record<string, unknown>;
  } catch {
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return JSON.parse(clean.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function requiredText(value: unknown, field: string, min = 20): string {
  const text = String(value || "").trim();
  if (text.length < min) throw new Error(`${field} 缺失或过短`);
  return text;
}

function humanizeStoryboardAnchors(text: string): string {
  return String(text || "")
    .replace(/anchor_char_[a-z0-9_\-\[\]]+/gi, "角色锚点")
    .replace(/anchor_prop_[a-z0-9_\-\[\]]+/gi, "道具锚点")
    .replace(/anchor_scene_[a-z0-9_\-\[\]]+/gi, "场景锚点")
    .replace(/\|\s*镜头\s*\|/g, "| 镜头描述 |");
}

function markdownTableCells(line: string): string[] {
  let value = String(line || "").trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split("|").map((cell) => cell.trim());
}

function assertDetailedStoryboard(markdown: string, expectedShots: number): void {
  const rows = String(markdown || "")
    .split(/\r?\n/)
    .filter((line) => /^\|\s*\d+\s*\|/.test(line.trim()))
    .map(markdownTableCells);
  const byNumber = new Map(rows.map((row) => [Number(row[0]), row]));
  if (byNumber.size < expectedShots) {
    throw new Error(`分镜表至少需要 ${expectedShots} 行镜头（当前 ${byNumber.size}）`);
  }
  for (let number = 1; number <= expectedShots; number += 1) {
    const row = byNumber.get(number);
    if (!row) throw new Error(`分镜表缺少编号 ${number}`);
    const summary = String(row[1] || "").trim();
    const anchors = String(row[2] || "").trim();
    const shot = String(row[3] || "").trim();
    if (summary.length < 4) throw new Error(`分镜${number}的视频内容片段过短`);
    if (!anchors || /anchor_(?:char|prop|scene)_/i.test(anchors)) {
      throw new Error(`分镜${number}的引用锚点必须使用中文代号`);
    }
    if (!/^(?:大特写|特写|近景|中近景|中景|全景|远景|定格画面)/.test(shot)) {
      throw new Error(`分镜${number}的镜头描述必须以景别开头`);
    }
    if (shot.replace(/\s/g, "").length < 24) {
      throw new Error(`分镜${number}的镜头描述过短，须详细描述怎么拍`);
    }
  }
}

function formatBindingLines(bindings: StoryImageBinding[]): string {
  if (!bindings.length) return "（无上传参考图）";
  return bindings
    .map((b, i) => {
      const index = Number(b.index || i + 1);
      const kind = String(b.kind || "auto");
      const name = String(b.name || "").trim() || `资产${index}`;
      return `图${index} = ${kind}「${name}」→ 提示词中写 图${index} / {@图${index}}`;
    })
    .join("\n");
}

function parseAssetResult(raw: string): StoryAnimResult {
  const parsed = extractJson(raw);
  if (!parsed) throw new Error("模型未返回合法 JSON");
  const list = Array.isArray(parsed.asset_prompts) ? parsed.asset_prompts : [];
  if (!list.length) throw new Error("asset_prompts 为空");
  const asset_prompts: StoryAssetPrompt[] = list.map((item, i) => {
    const row = (item || {}) as Record<string, unknown>;
    const kind = String(row.kind || "").trim() || "character";
    const name = requiredText(row.name, `asset_prompts[${i}].name`, 1);
    const prompt = requiredText(row.prompt, `asset_prompts[${i}].prompt`, 80);
    const prefix = kind.startsWith("prop") ? "prop" : kind.startsWith("scene") ? "scene" : "char";
    const node_key =
      String(row.node_key || "").trim() || `anchor_${prefix}_${toNodeKeySuffix(name)}`;
    return { kind, name, prompt, node_key };
  });
  const display_text = asset_prompts
    .map((a, i) => `## 资产 ${i + 1} · ${a.kind} · ${a.name}\n\n${a.prompt}`)
    .join("\n\n");
  return {
    mode: "asset_prompts",
    duration_sec: 0,
    asset_prompts,
    display_text,
  };
}

function parseScriptResult(raw: string, durationSec: number, _hasImages = false): StoryAnimResult {
  const parsed = extractJson(raw);
  if (!parsed) throw new Error("模型未返回合法 JSON");
  const minSheets = minSheetCount(durationSec);
  const sketchRaw = Array.isArray(parsed.sketch_sheets) ? parsed.sketch_sheets : [];
  if (sketchRaw.length < minSheets) throw new Error(`sketch_sheets 至少 ${minSheets} 张`);
  const sheetCount = Math.max(minSheets, Number(parsed.sheet_count) || sketchRaw.length);

  const sketch_sheets: StorySketchSheet[] = sketchRaw.map((item, i) => {
    const row = (item || {}) as Record<string, unknown>;
    const grid = Number(row.grid_count);
    if (!ALLOWED_GRIDS.has(grid)) throw new Error(`第${i + 1}张宫格数必须是 4/6/9`);
    if (i === 0 && grid !== 9) throw new Error("第1张分镜必须是 9 宫格");
    const prompt = requiredText(row.prompt, `sketch_sheets[${i}].prompt`, 80);
    if (!LINE_ART_LOCK.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词缺少铅笔线稿/不上颜色/不上灰度约束`);
    }
    if (!/图\s*\d+\s*=/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词须约定图N=…（供稍后接入生图节点）`);
    }
    if (!/场景\s*[:：]/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词缺少「场景：」`);
    }
    if (!/本段剧情\s*[:：]/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词缺少「本段剧情：」`);
    }
    if (!/(极度夸张|浮夸)/.test(prompt) || !/迪士尼/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词缺少夸张浮夸/迪士尼表演风格句`);
    }
    if (!/禁止连续相同景别/.test(prompt) || !/(大特写|特写).{0,12}(近景|中近景)|景别/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词缺少景别交替或「禁止连续相同景别」`);
    }
    if (!/禁止荷兰角/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词须写「禁止荷兰角倾斜构图」`);
    }
    if (!/运镜/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词缺少每格运镜标注要求`);
    }
    if (/Panel\s*\d+/i.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词禁止使用英文 Panel 编号，请用全局连续镜号`);
    }
    const isLast = i === sketchRaw.length - 1;
    if (!isLast) {
      if (!/非最后一张/.test(prompt) || !/动作进行中/.test(prompt) || !/收尾/.test(prompt)) {
        throw new Error(`第${i + 1}张（非末张）须写：非最后一张 + 动作进行中 + 禁止收尾信号`);
      }
    }
    const shotFrom = Number(row.shot_from) || 0;
    const shotTo = Number(row.shot_to) || 0;
    if (shotFrom < 1 || shotTo < shotFrom || shotTo - shotFrom + 1 !== grid) {
      throw new Error(`第${i + 1}张镜号区间须与宫格数一致且全局连续`);
    }
    if (i > 0) {
      const prev = sketchRaw[i - 1] as Record<string, unknown>;
      const prevTo = Number(prev?.shot_to) || 0;
      if (shotFrom !== prevTo + 1) {
        throw new Error(`第${i + 1}张镜号须承接上一张（期望从 ${prevTo + 1} 起）`);
      }
    } else if (shotFrom !== 1) {
      throw new Error("第1张镜号必须从 1 开始");
    }
    return {
      sheet_index: Number(row.sheet_index) || i + 1,
      grid_count: grid,
      shot_from: shotFrom,
      shot_to: shotTo,
      prompt,
    };
  });

  const expectedShots = sketch_sheets.reduce((sum, s) => sum + Number(s.grid_count || 0), 0);
  if (expectedShots < 4) throw new Error("总镜数过少");

  const storyboard = humanizeStoryboardAnchors(
    requiredText(parsed.storyboard_table_md, "storyboard_table_md", 200)
  );
  assertDetailedStoryboard(storyboard, expectedShots);

  const videoRaw = Array.isArray(parsed.video_segments) ? parsed.video_segments : [];
  if (videoRaw.length < minSheets) throw new Error(`video_segments 至少 ${minSheets} 段`);
  const video_segments: StoryVideoSegment[] = videoRaw.map((item, i) => {
    const row = (item || {}) as Record<string, unknown>;
    const prompt = requiredText(row.prompt, `video_segments[${i}].prompt`, 80);
    for (const marker of ["【画面渲染】", "【对话】", "【音效】"]) {
      if (!prompt.includes(marker)) throw new Error(`视频段${i + 1}缺少 ${marker}`);
    }
    const dur = Number(row.duration_sec) || Math.ceil(durationSec / videoRaw.length);
    if (dur > 15) throw new Error(`视频段${i + 1}时长不得超过 15 秒`);
    return {
      segment_index: Number(row.segment_index) || i + 1,
      duration_sec: dur,
      prompt,
    };
  });

  const node_keys =
    parsed.node_keys && typeof parsed.node_keys === "object"
      ? (parsed.node_keys as Record<string, string>)
      : {};

  const audio_config = {
    bgm: "",
    videoVolume: 1,
    audioVolume: 0.4,
    audioDb: -12,
    lyrics: "",
    ...(parsed.audio_config && typeof parsed.audio_config === "object"
      ? (parsed.audio_config as Record<string, unknown>)
      : {}),
  };

  const global_config_md = requiredText(parsed.global_config_md, "global_config_md", 80);
  const lastVideo = video_segments[video_segments.length - 1]?.prompt || "";
  if (/Logo徽标|品牌Logo|品牌名：/i.test(lastVideo + global_config_md)) {
    throw new Error("禁止品牌 Logo / 品牌名收尾；请改为故事收束");
  }

  const display_text = [
    global_config_md,
    storyboard,
    "## 分镜线稿提示词",
    ...sketch_sheets.map(
      (s) =>
        `### 第${s.sheet_index}张（${s.grid_count}宫格 · 镜${s.shot_from}-${s.shot_to}）\n\n${s.prompt}`
    ),
    "## 视频提示词",
    ...video_segments.map((v) => `### 视频段${v.segment_index}\n\n${v.prompt}`),
    "## 配乐建议",
    `* BGM：${String(audio_config.bgm || "")}`,
    `* 混音：videoVolume ${audio_config.videoVolume} / audioVolume ${audio_config.audioVolume}`,
  ].join("\n\n");

  return {
    mode: "story_script",
    duration_sec: durationSec,
    sheet_count: sheetCount,
    node_keys,
    global_config_md,
    storyboard_table_md: storyboard,
    sketch_sheets,
    video_segments,
    audio_config,
    display_text,
  };
}

export function parseStoryAnimAssetResult(raw: string): StoryAnimResult {
  return parseAssetResult(raw);
}

export function parseStoryAnimScriptResult(
  raw: string,
  durationSec = 30,
  hasImages = false
): StoryAnimResult {
  return parseScriptResult(raw, durationSec, hasImages);
}

/** @deprecated use parseStoryAnimScriptResult */
export function parsePixarAdScriptResult(raw: string, _characterName?: string): StoryAnimResult {
  return parseScriptResult(raw, 30, false);
}

async function callLlm(systemPrompt: string, userMessage: string, model: string): Promise<string> {
  const { apiBase, apiKey } = resolveTextLlmEnv(model);
  if (!apiBase || !apiKey) throw new Error(textLlmConfigError(model));
  const body = augmentChatCompletionsBody(model, {
    model,
    stream: false,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ],
    max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 16384),
    temperature: 0.55,
    ...(model.toLowerCase().startsWith("gpt-") ? { response_format: { type: "json_object" } } : {}),
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Number(process.env.TEXT_API_TIMEOUT_MS || 300000));
  try {
    const response = await postTextLlm(model, apiBase, apiKey, body, { signal: ctrl.signal });
    const raw = await response.text();
    const data = parseTextLlmResponseBody(raw);
    if (!response.ok) {
      throw new Error(extractTextLlmErrorMessage(data, response.status, raw.slice(0, 400)));
    }
    return extractTextLlmMessageContent(model, data).trim();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMode(value: unknown): StoryAnimMode {
  return String(value || "").trim() === "asset_prompts" ? "asset_prompts" : "story_script";
}

export async function generatePixarAdScriptOnServer(
  projectRoot: string,
  body: StoryAnimBody
): Promise<StoryAnimResult> {
  const mode = normalizeMode(body.mode);
  const story = String(body.story || body.raw_script || "").trim().slice(0, 24000);
  const styleDescription =
    String(body.style_description || "").trim().slice(0, 500) || "迪士尼皮克斯3D动画风格";
  if (story.length < 20) throw new Error("请提供至少 20 字的故事创意或剧本");

  const model =
    String(body.model || "").trim() || String(process.env.TEXT_MODEL || "").trim() || "gemini-3.5-flash";
  const imageUrls = Array.isArray(body.imageUrls) ? body.imageUrls.map(String).filter(Boolean) : [];
  const imageBindings = Array.isArray(body.imageBindings) ? body.imageBindings : [];
  const missing = Array.isArray(body.missing_kinds)
    ? body.missing_kinds.map((k) => String(k || "").trim()).filter(Boolean)
    : [];

  const systemPrompt = loadSystemPrompt(projectRoot, mode);
  let baseMessage = "";

  if (mode === "asset_prompts") {
    const kinds = missing.length ? missing.join("、") : "character、prop、scene（按故事推断必要项）";
    baseMessage = [
      `mode：asset_prompts`,
      `画面风格：${styleDescription}`,
      `需要生成的资产类型：${kinds}`,
      "",
      "【故事】",
      story,
      "",
      "只输出缺失资产的皮克斯彩图生图提示词 JSON。资产阶段到此结束，无需要求用户把图连回 Agent。",
    ].join("\n");
  } else {
    const durationSec = normalizeDurationSec(body.duration_sec ?? body.durationSec ?? 30);
    baseMessage = [
      `mode：story_script`,
      `总时长：${durationSec} 秒`,
      `最少分镜张数：${minSheetCount(durationSec)}（每张≤15s；第1张必须9宫格，后续4/6/9）`,
      `画面风格：${styleDescription}`,
      "",
      "【画布流程】资产彩图不必连回本 Agent。线稿提示词约定 图1/图2…；导演稍后把线稿提示词+资产图一起接到生图节点。",
      "",
      "【可选参考图】（有则对齐约定顺序，无则仍写约定图N + 造型关键词）",
      formatBindingLines(imageBindings),
      imageUrls.length ? `当前已连参考图：${imageUrls.length} 张` : "当前未连参考图（正常）",
      "",
      "【故事】",
      story,
      "",
      "输出无品牌故事动画完整 JSON。线稿提示词必须用中文结构：场景： / 本段剧情： / 非末张写动作进行中与禁止收尾 / 夸张浮夸迪士尼四肢 / 大特写与近景交替 / 禁止连续相同景别 / 禁止荷兰角倾斜构图 / 全局连续镜号与每格运镜图表；禁止英文 Panel 编号；锁定黑白铅笔线稿。",
    ].join("\n");
  }

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const userMessage =
        attempt === 0
          ? baseMessage
          : `${baseMessage}\n\n上次输出校验失败：${lastError}。请整份重写为合法、完整 JSON。`;
      const text = await callLlm(systemPrompt, userMessage, model);
      if (mode === "asset_prompts") return parseAssetResult(text);
      const durationSec = normalizeDurationSec(body.duration_sec ?? body.durationSec ?? 30);
      return parseScriptResult(text, durationSec, imageUrls.length > 0);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 900 * (attempt + 1)));
    }
  }
  throw new Error(lastError || "故事动画脚本生成失败");
}

export function registerCanvasPixarAdScriptRoutes(
  app: Express,
  projectRoot: string,
  gate?: RequestHandler
) {
  const handler = async (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => {
    try {
      return res.json(await generatePixarAdScriptOnServer(projectRoot, req.body || {}));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[story-anim-script] failed:", message);
      return res.status(502).json({ error: message });
    }
  };
  app.post("/api/canvas/pixar-ad-script", ...(gate ? [gate] : []), handler);
  app.post("/api/canvas/story-anim-script", ...(gate ? [gate] : []), handler);
}
