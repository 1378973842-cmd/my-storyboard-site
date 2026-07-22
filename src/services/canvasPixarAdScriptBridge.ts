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
  /** 画布上已生成的资产生图提示词；story_script 时用于锁定锚点造型 */
  asset_prompts?: StoryAssetPrompt[];
  prior_asset_prompts?: StoryAssetPrompt[];
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
  "storyboard_table_md": "须含节拍地图+视觉策略；故事梗概；按张拆分多表（### 分镜1-9 / ### 分镜10-N…）。镜头描述=唯一事实源（视频向：景别+角度+运镜四件套+动作/光影）；线稿对其做静帧改编，视频按表串联",
  "sketch_sheets": [
    {
      "sheet_index": 1,
      "grid_count": 9,
      "shot_from": 1,
      "shot_to": 9,
      "prompt": "线稿提示词：图N+线稿锁定+逐格静帧改编（禁机位运动过程句）"
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
3. 分镜表必须按张拆表：每张一个 \`### 分镜X-Y（对应视频段K，≤15s）\` 标题 + 独立表。须含节拍地图与视觉策略。引用锚点仅中文代号；镜头描述=事实源：景别开头+角度+构图名词（三分法构图/框架构图等词库之一）+运镜手法名（四件套）+动作/表情/空间/光影，去空白≥40字；禁止空词；禁止荷兰角。写「前景遮挡构图」须点名前景物与纵深/虚化/窥视层次（电影构图义，非遮挡身体）。
4. 视频段用 \`本段镜头串联：\` 按分镜表镜头描述串联（勿写废弃名「本段剧情」）；禁止另起动作链与空词。线稿逐格须**静帧改编**，禁止机位运动过程句；**禁止**线稿写「本段剧情」「本段镜头串联」。
5. 每条 sketch prompt 必须含线稿锁定：铅笔线稿 / 不上颜色 / 不上灰度 / 只有黑白线条。
6. 每条 sketch prompt **一律**写约定图N；并含：\`场景：\`、\`静帧改编\`、表演夸张浮夸/迪士尼四肢、大特写与近景交替、禁止连续相同景别、禁止荷兰角倾斜构图、\`镜头号从…连续标注\`（仅镜号；**禁止**「运镜图表」/运镜箭头标注）。禁止英文 Panel 重启编号。
7. 非最后一张必须写：本张非最后一张 + 最后一格动作进行中 + 禁止任何收尾信号；下张首格「承接上一段动作」。最后一段可有【结尾】但无 Logo。
`.trim();

const EMPTY_SHOT_WORDS =
  /电影感|高级感|氛围感|张力强|运镜自然流畅|高级电影感运镜/;

const CAMERA_MOVE_NAME =
  /固定镜头|摇摄|俯仰|推进|拉远|横移|升降|手持|跟拍|过肩|滑轨|变焦|环绕/;

const VISUAL_DEVICE =
  /前景遮挡|框中框|负空间|插入特写|延迟反应|侧面揭示|过肩|纵深|门框|虚化前景|肩后/;

/** 每格镜头描述须含其一（DeepWhite 构图词库） */
const COMPOSITION_TERM =
  /中心构图|三分法构图|框架构图|对角线构图|引导线构图|对称构图|黄金分割构图|纵深构图|负空间构图|三角构图|S形构图|前景遮挡构图|层次构图|开放式构图|封闭式构图/;

/** 线稿静帧禁写的视频运动过程句 */
const SKETCH_VIDEO_MOTION =
  /机位自.{0,12}向|快速变焦|匀速前移|匀速靠近|匀速横移|口型对齐|动机是|机位沿|机位升高|机位后移|短距滑移/;

/** 线稿若误带叙事摘要栏（旧名本段剧情 / 视频名本段镜头串联）：剥掉后放行 */
function stripSketchPlotSummary(prompt: string): string {
  return String(prompt || "")
    .replace(
      /(?:本段剧情|本段镜头串联)\s*[:：][\s\S]*?(?=(?:\n(?:本张|表演风格|景别|镜头号|逐格镜头|【非末张】|【末张】|参考\s|角色造型|场景\s*[:：]|与上一张)|$))/u,
      ""
    )
    .replace(/(?:本段剧情|本段镜头串联)\s*[:：][^\n]*/g, "")
    .replace(/本段剧情|本段镜头串联/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 视频段：把废弃名「本段剧情」规范成「本段镜头串联」 */
function normalizeVideoPlotLabel(prompt: string): string {
  return String(prompt || "").replace(/本段剧情\s*[:：]/g, "本段镜头串联：");
}

function skillRoot(projectRoot: string): string {
  const file = path.join(projectRoot, "prompts", "pixar-ad-execution-script", "SKILL.md");
  if (!existsSync(file)) {
    throw new Error("缺少故事动画 skill：prompts/pixar-ad-execution-script/SKILL.md");
  }
  return file;
}

function loadShotLanguageRef(projectRoot: string): string {
  const file = path.join(
    projectRoot,
    "prompts",
    "pixar-ad-execution-script",
    "references",
    "shot-language.md"
  );
  if (!existsSync(file)) return "";
  return readFileSync(file, "utf8").trim();
}

function loadSystemPrompt(projectRoot: string, mode: StoryAnimMode): string {
  const skill = readFileSync(skillRoot(projectRoot), "utf8").trim();
  const shotLang = mode === "story_script" ? loadShotLanguageRef(projectRoot) : "";
  const refBlock = shotLang ? `\n\n---\n\n# 镜头语言参考（强制）\n\n${shotLang}` : "";
  return `${skill}${refBlock}\n\n${mode === "asset_prompts" ? ASSET_API_CONSTRAINT : SCRIPT_API_CONSTRAINT}`;
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

/** 允许「全景镜头」「特写：」等常见写法；去掉行首「镜N：」后再判景别 */
function normalizeShotDescriptionLead(raw: string): string {
  return String(raw || "")
    .trim()
    .replace(/^镜\s*\d+\s*[：:.\-、]\s*/u, "")
    .replace(/^第?\s*\d+\s*格\s*[：:.\-、]\s*/u, "");
}

function shotStartsWithScale(shot: string): boolean {
  // Skill：必须以景别开头。模型常写「全景镜头 / 特写：…」，比严格「全景」更常见。
  return /^(?:大特写|特写|近景|中近景|中景|全景|远景|大远景|中全景|定格画面)(?:镜头)?(?:\s|[，,：:、]|$)/u.test(
    normalizeShotDescriptionLead(shot)
  );
}

function assertStoryboardSheetHeadings(
  markdown: string,
  sheets: Array<{ shot_from: number; shot_to: number; sheet_index: number }>
): void {
  const text = String(markdown || "");
  for (const sheet of sheets) {
    const from = Number(sheet.shot_from);
    const to = Number(sheet.shot_to);
    const re = new RegExp(
      `分镜\\s*${from}\\s*[-–—~～到至]\\s*${to}|分镜${from}-${to}|第${sheet.sheet_index}张`
    );
    if (!re.test(text)) {
      throw new Error(
        `分镜表须按张拆分，缺少标题「分镜${from}-${to}」（对应第${sheet.sheet_index}张）；禁止合成一张大表`
      );
    }
  }
}

function assertStoryboardDesignPreamble(markdown: string): void {
  const text = String(markdown || "");
  if (!/节拍|Beat\s*\d/i.test(text)) {
    throw new Error("分镜表前须输出节拍地图（节拍/Beat1…）");
  }
  if (!/视觉策略|前景遮挡|框中框|插入特写|负空间|延迟反应/.test(text)) {
    throw new Error("分镜表前须输出视觉策略（选用装置并标明镜号）");
  }
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
  let deviceHits = 0;
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
    if (!shotStartsWithScale(shot)) {
      throw new Error(
        `分镜${number}的镜头描述必须以景别开头（大特写/特写/近景/中近景/中景/全景/远景/定格画面，可带「镜头」）`
      );
    }
    if (shot.replace(/\s/g, "").length < 40) {
      throw new Error(`分镜${number}的镜头描述过短，须含角度/运镜四件套/动作/光影等（≥40字）`);
    }
    if (EMPTY_SHOT_WORDS.test(shot)) {
      throw new Error(`分镜${number}的镜头描述含空词（电影感/运镜自然流畅等），请改成可执行描述`);
    }
    // 允许「禁止荷兰角」合规句；去掉后再查是否真的在用荷兰角
    const shotSansDutchBan = shot.replace(/禁止荷兰角(?:倾斜构图)?/g, "");
    if (/荷兰角|斜角构图|地平线倾斜/.test(shotSansDutchBan)) {
      throw new Error(`分镜${number}禁止使用荷兰角/斜角构图（可写「禁止荷兰角」，勿写倾斜机位）`);
    }
    if (!COMPOSITION_TERM.test(shot)) {
      throw new Error(
        `分镜${number}的镜头描述须含构图名词（如三分法构图/框架构图/负空间构图/前景遮挡构图…）`
      );
    }
    if (/前景遮挡/.test(shot)) {
      // 电影义：点名前景物 + 纵深/虚化/窥视层次；剥掉构图名词后再查
      const body = shot
        .replace(/前景遮挡构图/g, "")
        .replace(/前景遮挡(?=[，。；、\s]|$)/g, "");
      const namedFg =
        /(?:虚化)?前景[^，。；\n]{0,16}(门框|窗框|树叶|枝|芭蕉|栏杆|桌沿|杯沿|蒸汽|雾|肩|围裙|窗帘|车窗|书架|灌木|花)/.test(
          body
        ) ||
        /(门框|窗框|树叶|枝|芭蕉|栏杆|桌沿|杯沿|蒸汽|雾|肩|围裙|窗帘|车窗|书架|灌木|花)[^，。；\n]{0,12}(前景|虚化|压|窥)/.test(
          body
        ) ||
        /隔着[^，。；\n]{1,12}(门框|窗|肩|叶|栏杆|玻璃)/.test(body) ||
        /过肩/.test(body);
      const depthCue =
        /虚化前景|纵深|窥视|压在画面|画面左缘|画面右缘|贴近镜头|形成.*层|前景层/.test(body) ||
        namedFg;
      if (!namedFg || !depthCue) {
        throw new Error(
          `分镜${number}写了前景遮挡构图，须点名前景物并写出纵深/虚化/窥视层次（如「虚化前景树叶压在画面左缘」；电影构图义，勿理解成遮挡身体）`
        );
      }
    }
    if (!CAMERA_MOVE_NAME.test(shot)) {
      throw new Error(
        `分镜${number}的镜头描述须含可识别运镜手法名（如推进/固定镜头/横移/跟拍…）`
      );
    }
    if (VISUAL_DEVICE.test(shot)) deviceHits += 1;
  }
  const minDevices = Math.max(2, Math.ceil(expectedShots * 0.3));
  if (deviceHits < minDevices) {
    throw new Error(
      `视觉装置不足：至少约 30% 格子须含前景遮挡/框中框/插入特写/负空间/过肩等可见元素（当前 ${deviceHits}/${expectedShots}）`
    );
  }
}

function assertVideoFollowsStoryboard(prompt: string, segmentIndex: number): void {
  if (EMPTY_SHOT_WORDS.test(prompt)) {
    throw new Error(`视频段${segmentIndex}含空词（电影感/运镜自然流畅等），须按分镜表改写`);
  }
  if (!/按分镜|分镜表|镜头描述|本段镜头串联/.test(prompt)) {
    throw new Error(`视频段${segmentIndex}须含「本段镜头串联」或按分镜表/镜头描述表述，禁止另起镜头`);
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

function normalizePriorAssetPrompts(raw: unknown): StoryAssetPrompt[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, i) => {
      const row = (item || {}) as Record<string, unknown>;
      const name = String(row.name || "").trim();
      const prompt = String(row.prompt || "").trim();
      if (!name || prompt.length < 20) return null;
      return {
        kind: String(row.kind || "character").trim() || "character",
        name,
        prompt: prompt.slice(0, 4000),
        node_key: String(row.node_key || "").trim() || undefined,
        index: i,
      } as StoryAssetPrompt;
    })
    .filter(Boolean) as StoryAssetPrompt[];
}

function formatPriorAssetPromptBlock(assets: StoryAssetPrompt[]): string {
  if (!assets.length) return "";
  return assets
    .map((a, i) => {
      const kind = String(a.kind || "character");
      return [
        `### 已锁定资产 ${i + 1} · ${kind} · ${a.name}`,
        a.node_key ? `Node Key：${a.node_key}` : "",
        "生图提示词（锚点「造型关键词」必须由此压缩提炼，名称/外形不得另起一套）：",
        a.prompt,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");
}

function assertAnchorsAlignWithAssets(globalMd: string, assets: StoryAssetPrompt[]): void {
  if (!assets.length) return;
  const text = String(globalMd || "");
  for (const asset of assets) {
    if (!text.includes(asset.name)) {
      throw new Error(
        `锚点清单须包含已生成资产「${asset.name}」，且造型关键词须与该资产生图提示词一致（勿另起一套外形）`
      );
    }
  }
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

function parseScriptResult(
  raw: string,
  durationSec: number,
  _hasImages = false,
  priorAssets: StoryAssetPrompt[] = []
): StoryAnimResult {
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
    const prompt = stripSketchPlotSummary(
      requiredText(row.prompt, `sketch_sheets[${i}].prompt`, 80)
    );
    if (!LINE_ART_LOCK.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词缺少铅笔线稿/不上颜色/不上灰度约束`);
    }
    if (!/图\s*\d+\s*=/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词须约定图N=…（供稍后接入生图节点）`);
    }
    if (!/场景\s*[:：]/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词缺少「场景：」`);
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
    if (!/静帧改编/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词须标明「静帧改编」（逐格从分镜表提炼定格画面，勿粘贴视频运镜）`);
    }
    if (!/镜头号从/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词须写「镜头号从…连续标注」`);
    }
    if (/标注运镜图表/.test(prompt)) {
      throw new Error(`第${i + 1}张线稿提示词禁止「标注运镜图表」（运镜只在分镜表/视频段；格上仅镜号）`);
    }
    if (SKETCH_VIDEO_MOTION.test(prompt)) {
      throw new Error(
        `第${i + 1}张线稿含视频运动句（机位自×向×/快速变焦/匀速前移/口型对齐/动机是…），请改为静帧改编`
      );
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
  assertStoryboardDesignPreamble(storyboard);
  assertDetailedStoryboard(storyboard, expectedShots);
  assertStoryboardSheetHeadings(storyboard, sketch_sheets);

  const videoRaw = Array.isArray(parsed.video_segments) ? parsed.video_segments : [];
  if (videoRaw.length < minSheets) throw new Error(`video_segments 至少 ${minSheets} 段`);
  const video_segments: StoryVideoSegment[] = videoRaw.map((item, i) => {
    const row = (item || {}) as Record<string, unknown>;
    const prompt = normalizeVideoPlotLabel(
      requiredText(row.prompt, `video_segments[${i}].prompt`, 80)
    );
    for (const marker of ["【画面渲染】", "【对话】", "【音效】"]) {
      if (!prompt.includes(marker)) throw new Error(`视频段${i + 1}缺少 ${marker}`);
    }
    assertVideoFollowsStoryboard(prompt, i + 1);
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
  assertAnchorsAlignWithAssets(global_config_md, priorAssets);
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
  hasImages = false,
  priorAssets: StoryAssetPrompt[] = []
): StoryAnimResult {
  return parseScriptResult(raw, durationSec, hasImages, priorAssets);
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
  const priorAssets = normalizePriorAssetPrompts(body.asset_prompts ?? body.prior_asset_prompts);

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
    const assetLockBlock = formatPriorAssetPromptBlock(priorAssets);
    baseMessage = [
      `mode：story_script`,
      `总时长：${durationSec} 秒`,
      `最少分镜张数：${minSheetCount(durationSec)}（每张≤15s；第1张必须9宫格，后续4/6/9）`,
      `画面风格：${styleDescription}`,
      "",
      "【画布流程】资产彩图不必连回本 Agent。线稿提示词约定 图1/图2…；导演稍后把线稿提示词+资产图一起接到生图节点。",
      "",
      priorAssets.length
        ? [
            "【已锁定资产生图提示词】（来自画布「资产提示词」按钮；必须遵守）",
            "1. 锚点清单中的角色/道具/场景名称须与下列资产 name 一致。",
            "2. 各锚点「造型关键词」必须由下列生图提示词压缩提炼，禁止另起一套外形/服装/材质。",
            "3. 线稿提示词中的 图1=/图2= 命名与顺序：角色→道具→场景，与下列资产一致。",
            "",
            assetLockBlock,
          ].join("\n")
        : "【已锁定资产生图提示词】无（导演尚未生成资产提示词；可自行写造型关键词，并在锚点中注明待资产对齐）",
      "",
      "【可选参考图】（有则对齐约定顺序，无则仍写约定图N + 造型关键词）",
      formatBindingLines(imageBindings),
      imageUrls.length ? `当前已连参考图：${imageUrls.length} 张` : "当前未连参考图（正常）",
      "",
      "【故事】",
      story,
      "",
      "输出无品牌故事动画完整 JSON。严格按 Skill：锚点→节拍地图+视觉策略→按张拆分分镜表→线稿仅逐格静帧（禁止本段剧情/本段镜头串联）→视频段用「本段镜头串联：」（勿写废弃名本段剧情）按表串联→配乐。命名隔离，避免线稿串味。",
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
      return parseScriptResult(text, durationSec, imageUrls.length > 0, priorAssets);
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
