import type { Express, RequestHandler } from "express";
import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  augmentChatCompletionsBody,
  extractTextLlmMessageContent,
  postTextLlm,
  resolveTextLlmEnv,
  textLlmConfigError,
} from "./canvasTextLlmBridge.js";
import { splitDeepWhiteSections } from "./canvasDeepWhiteShotBridge.js";

type ExportBody = {
  markdown?: string;
  styleHint?: string;
  model?: string;
};

const NINE_GRID_MIN_CHARS = 80;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripFence(text: string): string {
  let s = String(text || "").trim();
  const fenced = /^```(?:json|markdown|md)?\s*\n?([\s\S]*?)\n?```$/i.exec(s);
  if (fenced) s = fenced[1].trim();
  return s;
}

function extractJson(text: string): unknown {
  const cleaned = stripFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function readOptional(projectRoot: string, rel: string): string {
  const abs = path.join(projectRoot, rel);
  if (!existsSync(abs)) return "";
  return readFileSync(abs, "utf8").trim();
}

async function callTextLlm(opts: {
  systemPrompt: string;
  userMessage: string;
  model: string;
  maxTokens?: number;
}): Promise<string> {
  const { apiBase, apiKey } = resolveTextLlmEnv(opts.model);
  if (!apiBase || !apiKey) throw new Error(textLlmConfigError(opts.model));
  const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 300000);
  const requestBody = augmentChatCompletionsBody(opts.model, {
    model: opts.model,
    stream: false,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: opts.userMessage },
    ],
    max_tokens: opts.maxTokens || Number(process.env.CANVAS_LLM_MAX_TOKENS || 8192),
    temperature: 0.55,
  });
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
      throw new Error(errMsg);
    }
    return extractTextLlmMessageContent(opts.model, data).trim();
  } catch (err) {
    clearTimeout(timer);
    throw err instanceof Error ? err : new Error(String(err));
  }
}

function assertNineGridShots(shots: unknown): Array<{ n: number; prompt: string }> {
  if (!Array.isArray(shots) || shots.length !== 9) {
    throw new Error("九宫格改写必须返回恰好 9 条 shots");
  }
  const out: Array<{ n: number; prompt: string }> = [];
  for (let i = 0; i < 9; i += 1) {
    const row = shots[i] as { n?: unknown; prompt?: unknown };
    const prompt = String(row?.prompt || "").trim();
    if (prompt.length < NINE_GRID_MIN_CHARS) {
      throw new Error(`第 ${i + 1} 格中文提示词过短（至少 ${NINE_GRID_MIN_CHARS} 字）`);
    }
    if (/\d+\s*[-–~]\s*\d+\s*s|时长|音效|BGM/i.test(prompt) && /运镜时间轴/.test(prompt)) {
      throw new Error(`第 ${i + 1} 格含视频时间轴写法，九宫格只要静帧`);
    }
    out.push({ n: i + 1, prompt });
  }
  return out;
}

/** DeepWhite Markdown → 九宫格 9 条静帧 image prompt（跳过 Phase A 剧本重写） */
export async function rewriteDeepWhiteToNineGrid(
  projectRoot: string,
  body: ExportBody
): Promise<{ shots: Array<{ n: number; prompt: string }>; display_text: string }> {
  const markdown = String(body.markdown || "").trim();
  if (markdown.length < 80) throw new Error("DeepWhite 文档过短，无法改写为九宫格");
  const model =
    String(body.model || "").trim() ||
    (process.env.TEXT_MODEL || "").trim() ||
    "gemini-3.5-flash";
  const imagePromptSkill = readOptional(
    projectRoot,
    "prompts/deepwhite-image-prompt-builder/SKILL.md"
  );
  const sections = splitDeepWhiteSections(markdown);
  const stillSec = sections.find((s) => s.title.includes("静帧生图提示词"));
  const imageSec = sections.find((s) => s.title.includes("分镜图生成列表"));
  const systemPrompt = `
你是 DeepWhite→九宫格改写器。把导演分镜文档改写成恰好 9 条中文静帧生图提示词，供九宫格 Phase B 使用。

规则：
1. 只输出 JSON：{"shots":[{"n":1,"prompt":"..."}, ...共9条]}
2. 每条 prompt 为中文静帧描述，≥${NINE_GRID_MIN_CHARS} 字；结构：主体动作+场景+构图+光+风格+镜头+调色。
3. 禁止时长、运镜时间轴、音效、对白时间码。
4. 优先使用「静帧生图提示词」章的中文提示词；不足 9 条则从分镜图表补全/合并/拆分到恰好 9。
5. 超过 9 镜时选戏剧功能最强的 9 个静帧，保持叙事顺序。
6. 保留 {@图N} 绑定若原文有。
${imagePromptSkill ? `\n参考 skill：\n${imagePromptSkill.slice(0, 6000)}` : ""}
`.trim();

  const userMessage = [
    "【静帧生图提示词章】",
    stillSec?.body || "（无）",
    "",
    "【分镜图生成列表】",
    imageSec?.body || markdown.slice(0, 8000),
    "",
    body.styleHint ? `【风格偏好】${body.styleHint}` : "",
    "请输出恰好 9 条 shots JSON。",
  ]
    .filter(Boolean)
    .join("\n");

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const text = await callTextLlm({
        systemPrompt,
        userMessage:
          attempt === 0
            ? userMessage
            : `${userMessage}\n\n上次失败：${lastError}。请整份重写为合法 9 条 JSON。`,
        model,
      });
      const parsed = extractJson(text) as { shots?: unknown } | null;
      const shots = assertNineGridShots(parsed?.shots);
      const display_text = shots.map((s) => `【格${s.n}】\n${s.prompt}`).join("\n\n");
      return { shots, display_text };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(800 * (attempt + 1));
    }
  }
  throw new Error(lastError || "DeepWhite→九宫格改写失败");
}

/** DeepWhite 视频表 → Seedance 生产向逐镜提示词（跳过 shotlist 交互闸门） */
export async function exportDeepWhiteSeedance(
  projectRoot: string,
  body: ExportBody
): Promise<{ prompt: string; display_text: string; shot_count: number }> {
  const markdown = String(body.markdown || "").trim();
  if (markdown.length < 80) throw new Error("DeepWhite 文档过短，无法导出 Seedance");
  const model =
    String(body.model || "").trim() ||
    (process.env.TEXT_MODEL || "").trim() ||
    "gemini-3.5-flash";
  const styleBlock = readOptional(
    projectRoot,
    "prompts/deepwhite-shotlist-builder-zh-user/reference/STYLE_BLOCK.md"
  );
  const shotlistSkill = readOptional(
    projectRoot,
    "prompts/deepwhite-shotlist-builder-zh-user/SKILL.md"
  );
  const sections = splitDeepWhiteSections(markdown);
  const videoSec = sections.find((s) => s.title.includes("视频提示词基础列表"));
  const systemPrompt = `
你是 DeepWhite→Seedance 导出器（API 模式，跳过人工确认闸门）。

把「视频提示词基础列表」改写成可直接粘贴 Seedance 2.0 的中文逐镜提示词。

强制：
1. 只输出 JSON：{"prompt":"完整纯文本","shot_count":N}
2. 每镜一段，含：【全局画质】【人物材质】【灯光与风格】【核心特效】四段控制 + 句柄/构图/机位/动作/音效。
3. 单镜叙事时长建议 ≤15 秒；写清可见动作，禁止文学空词。
4. 不要 HTML；不要开场白。
5. 风格来自用户 styleHint / 文档视觉策略 / 剧本推断。
${styleBlock ? `\nSTYLE_BLOCK：\n${styleBlock.slice(0, 5000)}` : ""}
${shotlistSkill ? `\nSHOTLIST skill 摘要：\n${shotlistSkill.slice(0, 4000)}` : ""}
`.trim();

  const userMessage = [
    "【视频提示词基础列表】",
    videoSec?.body || markdown.slice(0, 10000),
    "",
    body.styleHint ? `【风格偏好】${body.styleHint}` : "【风格】从文档推断，写实电影摄影优先。",
    "输出 JSON。",
  ].join("\n");

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const text = await callTextLlm({
        systemPrompt,
        userMessage:
          attempt === 0
            ? userMessage
            : `${userMessage}\n\n上次失败：${lastError}。请重写。`,
        model,
        maxTokens: 12288,
      });
      const parsed = extractJson(text) as {
        prompt?: unknown;
        shot_count?: unknown;
        display_text?: unknown;
      } | null;
      const prompt = String(parsed?.prompt || parsed?.display_text || "").trim();
      if (!prompt || !prompt.includes("【全局画质】")) {
        throw new Error("Seedance 导出缺少四段画风控制（【全局画质】等）");
      }
      const shot_count = Math.max(
        1,
        Number(parsed?.shot_count) || (prompt.match(/镜头\s*\d+|分镜\s*\d+|【镜/g) || []).length || 1
      );
      return { prompt, display_text: prompt, shot_count };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(800 * (attempt + 1));
    }
  }
  throw new Error(lastError || "DeepWhite→Seedance 导出失败");
}

export function registerCanvasDeepWhiteExportRoutes(
  app: Express,
  projectRoot: string,
  gate?: RequestHandler
) {
  app.post("/api/canvas/deepwhite-to-ninegrid", ...(gate ? [gate] : []), async (req, res) => {
    try {
      const result = await rewriteDeepWhiteToNineGrid(projectRoot, req.body || {});
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[deepwhite-to-ninegrid] failed:", msg);
      return res.status(502).json({ error: msg });
    }
  });

  app.post("/api/canvas/deepwhite-seedance", ...(gate ? [gate] : []), async (req, res) => {
    try {
      const result = await exportDeepWhiteSeedance(projectRoot, req.body || {});
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[deepwhite-seedance] failed:", msg);
      return res.status(502).json({ error: msg });
    }
  });
}
