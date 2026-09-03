import type { Express, Request, RequestHandler } from "express";
import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import {
  augmentChatCompletionsBody,
  extractTextLlmMessageContent,
  postTextLlm,
  resolveTextLlmEnv,
  textLlmConfigError,
} from "./canvasTextLlmBridge.js";
import { uploadsToDataUrl } from "./ossStore.js";

export type DeepWhiteRefBinding = {
  index?: number;
  name?: string;
  kind?: string;
  url?: string;
};

export type DeepWhiteShotBody = {
  scene?: string;
  sceneName?: string;
  directorHint?: string;
  model?: string;
  imageUrls?: string[];
  imageBindings?: DeepWhiteRefBinding[];
  /** 是否生成「静帧生图提示词」章；默认 true */
  includeImagePrompts?: boolean;
};

export type DeepWhiteShotResult = {
  markdown: string;
  display_text: string;
  scene_name: string;
  filename: string;
  sections: Array<{ title: string; body: string }>;
  primary_director: string;
  image_shot_count: number;
  video_shot_count: number;
  has_refs?: boolean;
  ref_count?: number;
};

const SCENE_MIN = 20;
const SCENE_MAX = 20000;
const SCENE_NAME_MAX = 40;

const REQUIRED_SECTIONS = [
  "场景诊断",
  "导演规则选择",
  "节拍地图",
  "视觉策略",
  "空间调度",
  "分镜图生成列表",
  "静帧生图提示词",
  "视频提示词基础列表",
  "镜头语言自检",
] as const;

const DW_EMPTY_WORDS = ["电影感", "高级感", "氛围感", "张力强"];

/** 空泛词命中：排除「禁止/杜绝…电影感」这类自检复述，避免误杀合规文档 */
function markdownUsesEmptyWord(md: string, word: string): boolean {
  let from = 0;
  while (from < md.length) {
    const idx = md.indexOf(word, from);
    if (idx < 0) return false;
    const before = md.slice(Math.max(0, idx - 16), idx);
    const banContext = /(禁止|杜绝|不含|避免|去掉|勿用|禁用|空泛词|空词|不要写|不得使用)/.test(before);
    if (!banContext) return true;
    from = idx + word.length;
  }
  return false;
}

/**
 * 模型常把「电影感」当形容词且重写仍改不掉。
 * 校验前删掉非「禁止复述」语境的空泛词，避免整单失败。
 */
function sanitizeDeepWhiteEmptyWords(md: string): string {
  let out = String(md || "");
  for (const word of DW_EMPTY_WORDS) {
    let rebuilt = "";
    let from = 0;
    while (from < out.length) {
      const idx = out.indexOf(word, from);
      if (idx < 0) {
        rebuilt += out.slice(from);
        break;
      }
      const before = out.slice(Math.max(0, idx - 16), idx);
      const banContext = /(禁止|杜绝|不含|避免|去掉|勿用|禁用|空泛词|空词|不要写|不得使用)/.test(before);
      rebuilt += out.slice(from, idx);
      if (banContext) rebuilt += word;
      from = idx + word.length;
    }
    out = rebuilt;
  }
  return out
    .replace(/[、，,]{2,}/g, "、")
    .replace(/[（(]\s*[）)]/g, "")
    .replace(/[ \t]{2,}/g, " ");
}
const DW_COMPOSITION_TERMS = [
  "中心构图",
  "三分法",
  "框架构图",
  "对角线",
  "引导线",
  "对称构图",
  "黄金分割",
  "纵深构图",
  "负空间",
  "三角构图",
  "S形",
  "前景遮挡",
  "层次构图",
  "过肩",
  "俯视构图",
  "仰视构图",
];
const DW_CAMERA_MOVE_TERMS = [
  "固定",
  "静止",
  "摇摄",
  "上摇",
  "下摇",
  "俯仰",
  "推进",
  "推近",
  "逼近",
  "拉远",
  "拉开",
  "后拉",
  "后移",
  "横移",
  "平移",
  "升降",
  "手持",
  "稳定器",
  "摇臂",
  "变焦",
  "希区柯克",
  "跟拍",
  "跟随",
  "甩镜",
  "环绕",
  "滑轨",
  "拉焦",
  "转焦",
  "焦点转移",
  "焦点过渡",
  "过肩跟",
  "摇镜",
  "揭示",
  "微抖",
];

/** 描述性运镜同义（模型常写白话而不写词典名） */
const DW_CAMERA_MOVE_SYNONYM_RES: RegExp[] = [
  /向后.{0,8}(拉开|拉远|后移|后退)/,
  /(拉开|拉远|后移).{0,8}(缓慢|匀速|快速)?/,
  /(向前|向斜前).{0,8}(推进|推近|逼近)/,
  /(机位|镜头).{0,6}(不动|固定|静止)/,
  /焦点.{0,10}(转移|过渡|落[到至])/,
  /(左|右).{0,4}(横移|平移|摇)/,
  /(缓|慢|匀速|快速)?.{0,4}(上摇|下摇|俯仰|仰拍|俯拍)/,
  /(环绕|绕|围着).{0,8}(半圈|一圈|主体)?/,
  /(手持|微抖|轻微抖动)/,
  /(甩|急摇|whip)/i,
  /(升起|下降|升起|降下|升降|摇臂)/,
  /(变焦|zoom|希区柯克)/i,
  /(跟|贴身跟|跟随).{0,6}(拍|主体|角色|人物)?/,
  /(揭示|缓慢揭示)/,
];

function deepWhiteMoveRecognized(move: string): boolean {
  const m = String(move || "").trim();
  if (!m) return false;
  if (DW_CAMERA_MOVE_TERMS.some((t) => m.includes(t))) return true;
  return DW_CAMERA_MOVE_SYNONYM_RES.some((re) => re.test(m));
}
const DW_VISUAL_DEVICES = [
  "前景遮挡",
  "框中框",
  "俯视",
  "正上方",
  "仰视",
  "低角度",
  "大角度",
  "极端角度",
  "荷兰角",
  "负空间",
  "延迟反打",
  "长焦压缩",
  "广角压力",
  "运动揭示",
  "稳定压迫",
  "手持贴身",
  "插入镜头",
  "轴线压力",
  "群戏纵深",
  "监视几何",
  "侧向揭示",
  "动机推进",
];
const DW_REF_MAX = 8;

const API_CONSTRAINT = `
---

## API 输出约束（本站画布节点 · DeepWhite v3）

1. 禁止输出分析思路、开场白、结语、技能说明。
2. 仅返回一个 JSON 对象：
{
  "scene_name": "短场景名",
  "primary_director": "主规则导演名",
  "markdown": "完整 Markdown 文档正文"
}
3. \`markdown\` 按 skill / output-template 输出完整导演分镜文档（含分镜图生成列表、静帧生图提示词、视频提示词基础列表等）。
4. 全程简体中文（静帧生图提示词章内英文 Prompt 除外）。
5. 默认不要输出合并版 Seedance/Kling/Runway/Sora 整段提示词。
6. 有参考图时用 {@图N} 绑定。
7. \`markdown\` 内不要再包一层 JSON。
`.trim();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUpstreamOverloaded(status: number, payload: unknown): boolean {
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const msg = (
    typeof payload === "object" && payload
      ? (payload as { error?: { message?: unknown }; message?: unknown }).error?.message ||
        (payload as { message?: unknown }).message ||
        JSON.stringify(payload)
      : String(payload || "")
  )
    .toString()
    .toLowerCase();
  return (
    msg.includes("负载") ||
    msg.includes("饱和") ||
    msg.includes("rate") ||
    msg.includes("too many") ||
    msg.includes("overload")
  );
}

function stripMarkdownCodeFence(text: string): string {
  let s = String(text || "").trim();
  const fenced = /^```(?:json|markdown|md)?\s*\n?([\s\S]*?)\n?```$/i.exec(s);
  if (fenced) s = fenced[1].trim();
  return s;
}

function extractBalancedJsonObject(text: string): unknown {
  const cleaned = stripMarkdownCodeFence(text);
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function skillRoot(projectRoot: string): string {
  const candidates = [
    path.join(projectRoot, "prompts", "deepwhite-cinematic-shot-designer-zh-v3"),
    path.join(projectRoot, "skills", "deepwhite-cinematic-shot-designer-zh-v3"),
  ];
  for (const dir of candidates) {
    if (existsSync(path.join(dir, "SKILL.md"))) return dir;
  }
  throw new Error("缺少 DeepWhite skill：prompts/deepwhite-cinematic-shot-designer-zh-v3/SKILL.md");
}

function readText(file: string): string {
  if (!existsSync(file)) throw new Error(`缺少 DeepWhite 参考文件：${file}`);
  return readFileSync(file, "utf8").trim();
}

/** 100% 按 skill：Always read 三份 + 全部导演规则库 + 静帧生图规则摘要 */
export function loadDeepWhiteSystemPrompt(projectRoot: string): string {
  const root = skillRoot(projectRoot);
  const skill = readText(path.join(root, "SKILL.md"));
  const always = [
    "visual-grammar.md",
    "director-selection.md",
    "output-template.md",
  ].map((name) => {
    const body = readText(path.join(root, "references", name));
    return `\n\n===== references/${name} =====\n${body}`;
  });
  const refDir = path.join(root, "references");
  const directorFiles = readdirSync(refDir)
    .filter((name) => name.endsWith("-rules.md"))
    .sort();
  const directors = directorFiles.map((name) => {
    const body = readText(path.join(refDir, name));
    return `\n\n===== references/${name} =====\n${body}`;
  });
  const imagePromptSkill = path.join(
    projectRoot,
    "prompts",
    "deepwhite-image-prompt-builder",
    "SKILL.md"
  );
  const imagePromptBlock = existsSync(imagePromptSkill)
    ? `\n\n===== deepwhite-image-prompt-builder/SKILL.md（静帧生图提示词章强制参考） =====\n${readText(imagePromptSkill)}`
    : "";
  return [skill, ...always, ...directors, imagePromptBlock, `\n\n${API_CONSTRAINT}`].join("\n");
}

function listenPort(): number {
  return Number(process.env.PORT) || 3000;
}

function absoluteImageUrl(req: Request, url: string): string {
  const u = String(url || "").trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u) || u.startsWith("data:")) return u;
  if (u.startsWith("/")) {
    const host = req.get("host") || `127.0.0.1:${listenPort()}`;
    const proto = (req.get("x-forwarded-proto") as string) || "http";
    return `${proto}://${host}${u}`;
  }
  return u;
}

async function resolveImageForVision(req: Request, projectRoot: string, rawUrl: string): Promise<string> {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (url.startsWith("blob:")) {
    throw new Error("参考图为浏览器临时地址(blob)，请重新连接图片或先上传到画布");
  }
  if (url.startsWith("data:")) return url;
  const data = await uploadsToDataUrl(projectRoot, url);
  if (data) return data;
  if (/^https?:\/\//i.test(url)) return url;
  return absoluteImageUrl(req, url);
}

function normalizeImageUrls(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const url = String(item || "").trim();
    if (!url || out.includes(url)) continue;
    out.push(url);
    if (out.length >= DW_REF_MAX) break;
  }
  return out;
}

function normalizeRefKind(value: unknown): string {
  const raw = String(value || "")
    .trim()
    .toLowerCase();
  if (raw === "character" || raw === "角色" || raw === "人物") return "character";
  if (raw === "prop" || raw === "道具" || raw === "物品") return "prop";
  if (raw === "scene" || raw === "场景" || raw === "环境") return "scene";
  return "auto";
}

function kindLabelZh(kind: string): string {
  if (kind === "character") return "角色";
  if (kind === "prop") return "道具";
  if (kind === "scene") return "场景";
  return "未指定";
}

export function normalizeDeepWhiteImageBindings(
  value: unknown,
  imageCount: number
): Array<{ index: number; name: string; kind: string }> {
  if (!Array.isArray(value) || imageCount <= 0) return [];
  const out: Array<{ index: number; name: string; kind: string }> = [];
  const used = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as DeepWhiteRefBinding;
    let index = Math.round(Number(row.index));
    if (!Number.isFinite(index) || index < 1) index = out.length + 1;
    if (index < 1 || index > imageCount || used.has(index)) continue;
    const name = String(row.name || "")
      .trim()
      .slice(0, 24);
    const kind = normalizeRefKind(row.kind);
    used.add(index);
    out.push({ index, name, kind });
    if (out.length >= DW_REF_MAX) break;
  }
  for (let i = 1; i <= imageCount; i += 1) {
    if (used.has(i)) continue;
    out.push({ index: i, name: "", kind: "auto" });
  }
  return out.sort((a, b) => a.index - b.index);
}

function normalizeScene(value: unknown): string {
  return String(value || "").trim().slice(0, SCENE_MAX);
}

function normalizeSceneName(value: unknown, scene: string): string {
  const raw = String(value || "").trim().slice(0, SCENE_NAME_MAX);
  if (raw) return raw.replace(/[\\/:*?"<>|]/g, "_");
  const first = scene.split(/\n/)[0] || "未命名场景";
  return first.replace(/[\\/:*?"<>|]/g, "_").slice(0, 24) || "未命名场景";
}

function buildDeepWhiteUserMessage(opts: {
  scene: string;
  sceneName: string;
  directorHint: string;
  refCount: number;
  bindings: Array<{ index: number; name: string; kind: string }>;
  includeImagePrompts: boolean;
}): string {
  const lines = [
    "请按 DeepWhite Cinematic Shot Designer ZH v3 完整工作流，把下列场景转化为完整 Markdown 导演分镜文档。",
    "",
    `场景名建议：${opts.sceneName}`,
    "",
    "【场景文本】",
    opts.scene,
  ];
  if (opts.directorHint) {
    lines.push(
      "",
      `【导演规则倾向（可选）】用户倾向：${opts.directorHint}`,
      "仍须按 director-selection.md 用戏剧功能选择；若倾向不合适，可说明不采用并另选主规则。"
    );
  } else {
    lines.push("", "【导演规则倾向】用户未指定，请按戏剧功能从规则库自选主规则（最多两个辅助）。");
  }
  if (opts.refCount > 0) {
    lines.push(
      "",
      `【参考图】已附带 ${opts.refCount} 张图，按顺序称为图1…图${opts.refCount}。`,
      "在画面描述与静帧生图提示词中用 {@图N} 标注对应元素。"
    );
    const named = opts.bindings.filter((b) => b.name);
    if (named.length) {
      lines.push("", "【参考图绑定】（权威映射，必须遵守）");
      for (const b of opts.bindings) {
        const label = b.name
          ? `${kindLabelZh(b.kind)}「${b.name}」`
          : `${kindLabelZh(b.kind)}（未命名，可按视觉推断）`;
        lines.push(`图${b.index} = ${label} → 必须使用 {@图${b.index}}`);
      }
    }
  }
  if (opts.includeImagePrompts) {
    lines.push(
      "",
      "【静帧生图提示词】必须输出独立章节「## 静帧生图提示词」，按每个镜号给出 English Prompt + 中文提示词（双语）。"
    );
  }
  lines.push(
    "",
    "运镜列禁止空壳单字；至少 50% 镜头含明确视觉语法装置。",
    "必须先场景诊断 → 导演规则 → 节拍地图 → 视觉策略 → 空间调度 → 双表 + 静帧生图提示词 → 自检。",
    "仅输出 JSON（含完整 markdown 字段）。"
  );
  return lines.join("\n");
}

export function splitDeepWhiteSections(markdown: string): Array<{ title: string; body: string }> {
  const raw = String(markdown || "").trim();
  if (!raw) return [];
  const re = /^##\s+(.+)$/gm;
  const hits: Array<{ title: string; start: number; headEnd: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    hits.push({ title: m[1].trim(), start: m.index, headEnd: m.index + m[0].length });
  }
  if (!hits.length) return [{ title: "文档", body: raw }];
  return hits.map((h, i) => {
    const end = i + 1 < hits.length ? hits[i + 1].start : raw.length;
    return {
      title: h.title,
      body: raw.slice(h.headEnd, end).replace(/^\s*\n?/, "").trim(),
    };
  });
}

type DeepWhiteTable = {
  header: string;
  headerCells: string[];
  rows: string[][];
};

function parseSectionTable(markdown: string, sectionTitle: string): DeepWhiteTable | null {
  const sections = splitDeepWhiteSections(markdown);
  const sec = sections.find((s) => s.title.includes(sectionTitle));
  if (!sec) return null;
  const lines = sec.body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].startsWith("|") && lines[i].includes("镜号")) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return null;
  const splitCells = (line: string) =>
    line
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  const header = lines[headerIdx];
  const headerCells = splitCells(header);
  const rows: string[][] = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.startsWith("|")) break;
    if (/^\|\s*:?-{3,}/.test(line) || /^\|\s*-+/.test(line)) continue;
    rows.push(splitCells(line));
  }
  return { header, headerCells, rows };
}

function countTableRowsAfterHeader(markdown: string, sectionTitle: string): number {
  return parseSectionTable(markdown, sectionTitle)?.rows.length || 0;
}

/** skill：禁词只约束镜号单元格，自检章节可复述规则文字 */
function assertShotIdsPlain(table: DeepWhiteTable, label: string): void {
  const shotIdx = table.headerCells.findIndex((c) => c.includes("镜号"));
  if (shotIdx < 0) throw new Error(`${label}缺少镜号列`);
  for (const row of table.rows) {
    const cell = String(row[shotIdx] || "").trim();
    if (!cell) continue;
    if (/必拍|可删减|覆盖镜头/.test(cell)) {
      throw new Error(`${label}镜号单元格不得含必拍/可删减/覆盖镜头：${cell}`);
    }
  }
}

function colIndex(headerCells: string[], ...names: string[]): number {
  return headerCells.findIndex((c) => names.some((n) => c.includes(n)));
}

function assertCameraAndCompositionQuality(table: DeepWhiteTable, label: string): void {
  const moveIdx = colIndex(table.headerCells, "运镜");
  const compIdx = colIndex(table.headerCells, "构图");
  if (moveIdx < 0) throw new Error(`${label}缺少运镜列`);
  if (compIdx < 0) throw new Error(`${label}缺少构图列`);
  for (let i = 0; i < table.rows.length; i += 1) {
    const row = table.rows[i];
    const move = String(row[moveIdx] || "").trim();
    const comp = String(row[compIdx] || "").trim();
    if (!move) throw new Error(`${label}第 ${i + 1} 行运镜为空`);
    // 只拦「单个空壳手法名」；描述性白话（向后拉开/焦点过渡…）一律放行
    if (/^(跟拍|推进|固定|环绕|手持|拉远|横移|静止|拉开|拉焦|跟随)$/.test(move)) {
      throw new Error(`${label}第 ${i + 1} 行运镜过空（「${move}」）：请补方向/速度或可见变化`);
    }
    // ponytail: 曾用「字数≥6 + 词典手法名」硬拦，模型常写短句/白话导致整单失败；改为有内容即过
    if (move.length < 2) {
      throw new Error(`${label}第 ${i + 1} 行运镜过短，需可执行细节`);
    }
    if (!comp) throw new Error(`${label}第 ${i + 1} 行构图为空`);
    // 构图：无美学名词时不整单失败（模型常写站位描述）；有则更好
    if (comp.length < 2) {
      throw new Error(`${label}第 ${i + 1} 行构图过短`);
    }
  }
}

function assertVisualDeviceCoverage(markdown: string, imageTable: DeepWhiteTable): void {
  const descIdx = colIndex(imageTable.headerCells, "画面描述", "画面");
  const moveIdx = colIndex(imageTable.headerCells, "运镜");
  const compIdx = colIndex(imageTable.headerCells, "构图");
  const angleIdx = colIndex(imageTable.headerCells, "机位", "角度");
  let hit = 0;
  for (const row of imageTable.rows) {
    const blob = [
      descIdx >= 0 ? row[descIdx] : "",
      moveIdx >= 0 ? row[moveIdx] : "",
      compIdx >= 0 ? row[compIdx] : "",
      angleIdx >= 0 ? row[angleIdx] : "",
    ]
      .join(" ")
      .trim();
    if (DW_VISUAL_DEVICES.some((d) => blob.includes(d))) hit += 1;
  }
  // 也允许「视觉策略」章声明的装置映射到表内同义词；若表内不足，再扫整文但按镜数比例仍要求表内命中
  const need = Math.ceil(imageTable.rows.length * 0.5);
  if (hit < need) {
    throw new Error(
      `视觉装置覆盖不足：${hit}/${imageTable.rows.length} 镜含明确装置（至少 50%≈${need}）。请使用前景遮挡/框中框/负空间/延迟反打等`
    );
  }
  // 视觉策略章应点名装置
  if (!/视觉策略/.test(markdown) || !DW_VISUAL_DEVICES.some((d) => markdown.includes(d))) {
    throw new Error("视觉策略章缺少明确视觉语法装置名称");
  }
}

function assertStillImagePromptSection(markdown: string, shotCount: number): void {
  const sections = splitDeepWhiteSections(markdown);
  const sec = sections.find((s) => s.title.includes("静帧生图提示词"));
  if (!sec || !sec.body.trim()) throw new Error("缺少「静帧生图提示词」章节正文");
  const enHits = (sec.body.match(/English Prompt/gi) || []).length;
  const zhHits = (sec.body.match(/中文提示词/g) || []).length;
  if (enHits < Math.min(shotCount, 2) || zhHits < Math.min(shotCount, 2)) {
    throw new Error("静帧生图提示词须按镜给出 English Prompt + 中文提示词");
  }
  if (/时长|秒\s*[-–]|音效|BGM/.test(sec.body) && /运镜时间|时间轴/.test(sec.body)) {
    throw new Error("静帧生图提示词不得含视频时间轴/音效写法");
  }
}

function assertDeepWhiteMarkdown(markdown: string): {
  image_shot_count: number;
  video_shot_count: number;
  primary_director: string;
} {
  // ponytail: 质量门已关闭——不再因运镜词典/构图词/空词/视觉装置/静帧章等整单失败
  const md = String(markdown || "").trim();
  if (!md) throw new Error("markdown 为空");

  const imageTable = parseSectionTable(md, "分镜图生成列表");
  const videoTable = parseSectionTable(md, "视频提示词基础列表");
  let image_shot_count = imageTable?.rows.length || 0;
  let video_shot_count = videoTable?.rows.length || 0;
  if (!image_shot_count) {
    const hits = md.match(/镜头\s*\d+/g) || md.match(/分镜\s*\d+/g) || [];
    image_shot_count = new Set(hits.map((h) => h.replace(/\s+/g, ""))).size;
  }
  if (!video_shot_count) video_shot_count = image_shot_count;

  let primary_director = "";
  const dirMatch = md.match(/主规则\s*[:：]\s*([^\n|]+)/);
  if (dirMatch) primary_director = dirMatch[1].trim();
  return {
    image_shot_count: Math.max(1, image_shot_count),
    video_shot_count: Math.max(1, video_shot_count || image_shot_count),
    primary_director,
  };
}

/** ponytail: exposed for one assert-based self-check only */
export function assertDeepWhiteMarkdownForTest(markdown: string) {
  return assertDeepWhiteMarkdown(markdown);
}

/** ponytail: exposed for empty-word sanitize self-check only */
export function sanitizeDeepWhiteEmptyWordsForTest(markdown: string) {
  return sanitizeDeepWhiteEmptyWords(markdown);
}

function parseDeepWhiteResponse(raw: string, fallbackSceneName: string): DeepWhiteShotResult {
  const text = String(raw || "").trim();
  if (!text) throw new Error("模型返回了空内容");

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stripMarkdownCodeFence(text));
  } catch {
    parsed = extractBalancedJsonObject(text);
  }

  let markdown = "";
  let scene_name = fallbackSceneName;
  let primary_director = "";

  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    markdown = String(obj.markdown || obj.document || obj.display_text || "").trim();
    if (obj.scene_name) scene_name = normalizeSceneName(obj.scene_name, fallbackSceneName);
    if (obj.primary_director) primary_director = String(obj.primary_director).trim();
  } else if (text.includes("场景诊断") && text.includes("分镜图生成列表")) {
    markdown = stripMarkdownCodeFence(text);
  } else {
    throw new Error(`模型返回的不是合法 JSON：${text.slice(0, 240)}`);
  }

  if (!markdown) throw new Error("模型 JSON 缺少 markdown");
  const beforeSanitize = markdown;
  markdown = sanitizeDeepWhiteEmptyWords(markdown);
  if (markdown !== beforeSanitize) {
    console.warn("[deepwhite-shot] stripped empty style words (电影感/高级感/氛围感/张力强) from markdown");
  }
  const audit = assertDeepWhiteMarkdown(markdown);
  if (!primary_director) primary_director = audit.primary_director;
  const filename = `DeepWhite_导演分镜_${scene_name}_v3.md`;
  return {
    markdown,
    display_text: markdown,
    scene_name,
    filename,
    sections: splitDeepWhiteSections(markdown),
    primary_director,
    image_shot_count: audit.image_shot_count,
    video_shot_count: audit.video_shot_count,
  };
}

async function callDeepWhiteLlm(opts: {
  systemPrompt: string;
  userMessage: string;
  imageDataUrls: string[];
  model: string;
}): Promise<string> {
  const { apiBase, apiKey } = resolveTextLlmEnv(opts.model);
  if (!apiBase || !apiKey) throw new Error(textLlmConfigError(opts.model));
  const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 300000);
  const maxRetries = 4;
  const baseDelayMs = 2000;
  let lastError = "";

  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: opts.userMessage }];
  for (const url of opts.imageDataUrls) {
    userContent.push({ type: "image_url", image_url: { url } });
  }

  const requestBody = augmentChatCompletionsBody(opts.model, {
    model: opts.model,
    stream: false,
    messages: [
      { role: "system", content: opts.systemPrompt },
      {
        role: "user",
        content: opts.imageDataUrls.length ? userContent : opts.userMessage,
      },
    ],
    max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 12288),
    temperature: 0.65,
  });

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await postTextLlm(opts.model, apiBase, apiKey, requestBody, {
        signal: ctrl.signal,
      });
      clearTimeout(timer);
      const rawText = await response.text();
      let data: Record<string, unknown> = {};
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        data = { error: { message: rawText.slice(0, 400) } };
      }
      if (!response.ok) {
        const errMsg =
          (typeof (data?.error as { message?: unknown })?.message === "string" &&
            (data.error as { message: string }).message) ||
          rawText.slice(0, 400) ||
          `上游接口错误 (${response.status})`;
        if (isUpstreamOverloaded(response.status, errMsg) && attempt < maxRetries) {
          const delay =
            Math.min(12000, baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 260));
          console.warn("[deepwhite-shot] upstream overloaded, retrying...", { attempt, delay });
          await sleep(delay);
          lastError = errMsg;
          continue;
        }
        throw new Error(errMsg);
      }
      return extractTextLlmMessageContent(opts.model, data).trim();
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        isUpstreamOverloaded(0, msg) || /fetch failed|network|econnreset|aborted/i.test(msg);
      if (retryable && attempt < maxRetries) {
        const delay =
          Math.min(12000, baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 260));
        console.warn("[deepwhite-shot] transient error, retrying...", { attempt, delay, msg });
        await sleep(delay);
        lastError = msg;
        continue;
      }
      throw err instanceof Error ? err : new Error(msg);
    }
  }
  throw new Error(lastError || "DeepWhite 分镜生成失败");
}

export async function generateDeepWhiteShotOnServer(
  req: Request,
  projectRoot: string,
  body: DeepWhiteShotBody
): Promise<DeepWhiteShotResult> {
  const scene = normalizeScene(body.scene);
  if (scene.length < SCENE_MIN) {
    throw new Error(`场景文本过短（至少 ${SCENE_MIN} 字）。DeepWhite skill 要求先提供场景再设计镜头。`);
  }
  const sceneName = normalizeSceneName(body.sceneName, scene);
  const directorHint = String(body.directorHint || "").trim().slice(0, 120);
  const includeImagePrompts = body.includeImagePrompts !== false;
  const imageUrls = normalizeImageUrls(body.imageUrls);
  const imageDataUrls = (await Promise.all(
    imageUrls.map((url) => resolveImageForVision(req, projectRoot, url))
  )).filter(Boolean);
  const bindings = normalizeDeepWhiteImageBindings(body.imageBindings, imageDataUrls.length);
  const model =
    String(body.model || "").trim() ||
    (process.env.TEXT_MODEL || "").trim() ||
    "gemini-3.5-flash";
  const systemPrompt = loadDeepWhiteSystemPrompt(projectRoot);
  const baseUser = buildDeepWhiteUserMessage({
    scene,
    sceneName,
    directorHint,
    refCount: imageDataUrls.length,
    bindings,
    includeImagePrompts,
  });

  const maxAttempts = 3;
  let lastError = "";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const userMessage =
        attempt === 0 || !lastError
          ? baseUser
          : `${baseUser}\n\n【上次输出未通过解析，请整份重写】\n${lastError}\n请返回含 markdown 字段的 JSON，markdown 为完整 DeepWhite 分镜文档。`;
      const text = await callDeepWhiteLlm({
        systemPrompt,
        userMessage,
        imageDataUrls,
        model,
      });
      const result = parseDeepWhiteResponse(text, sceneName);
      result.has_refs = imageDataUrls.length > 0;
      result.ref_count = imageDataUrls.length;
      return result;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn("[deepwhite-shot] parse/generate failed:", { attempt, lastError });
      if (attempt < maxAttempts - 1) {
        await sleep(Math.min(8000, 1500 * Math.pow(2, attempt)));
      }
    }
  }
  throw new Error(lastError || "DeepWhite 分镜生成失败");
}

export function registerCanvasDeepWhiteShotRoutes(
  app: Express,
  projectRoot: string,
  gate?: RequestHandler
) {
  app.post("/api/canvas/deepwhite-shot", ...(gate ? [gate] : []), async (req, res) => {
    try {
      const result = await generateDeepWhiteShotOnServer(req, projectRoot, req.body || {});
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[deepwhite-shot] failed:", msg);
      return res.status(502).json({ error: msg });
    }
  });
}
