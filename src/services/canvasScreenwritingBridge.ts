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

export type ScreenwritingMode = "from_scratch" | "diagnose" | "rewrite" | "scene";

export type ScreenwritingBody = {
  mode?: string;
  brief?: string;
  material?: string;
  durationHint?: string;
  model?: string;
};

export type ScreenwritingResult = {
  mode: ScreenwritingMode;
  mode_label: string;
  markdown: string;
  display_text: string;
  title: string;
};

const BRIEF_MIN = 8;
const MATERIAL_MAX = 24000;

const API_CONSTRAINT = `
---

## API 输出约束（画布编剧节点）

你运行在 API 一次性模式（跳过逐步「通过/修改/自检」等待）：

1. 仅返回 JSON：
{
  "title": "短标题",
  "mode": "from_scratch|diagnose|rewrite|scene",
  "markdown": "完整中文 Markdown 正文"
}
2. 只用简体中文；不写 Hollywood 格式；不写双语台词。
3. 只写可拍可见可听内容；禁止心理描写、说教独白、AI 腔。
4. from_scratch：输出梗概 + 人物 + 分场大纲 + 至少一场完整场景正文。
5. diagnose：输出诊断报告（问题清单 + 分数维度 + 修改优先级），可附改写建议，不擅自整本重写。
6. rewrite：在保留用户意图下改写指定材料，标明改了什么。
7. scene：把材料压成一场可拍场景正文（动作+对白）。
8. markdown 内不要再包 JSON。
`.trim();

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

export function normalizeScreenwritingMode(value: unknown): ScreenwritingMode {
  const raw = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (raw === "diagnose" || raw.includes("诊断") || raw.includes("评分")) return "diagnose";
  if (raw === "rewrite" || raw.includes("改写") || raw.includes("修改")) return "rewrite";
  if (raw === "scene" || raw.includes("场景") || raw.includes("分场")) return "scene";
  return "from_scratch";
}

export function screenwritingModeLabel(mode: ScreenwritingMode): string {
  if (mode === "diagnose") return "诊断评分";
  if (mode === "rewrite") return "改写";
  if (mode === "scene") return "场景正文";
  return "从零创作";
}

function skillRoot(projectRoot: string): string {
  const dir = path.join(projectRoot, "prompts", "deepwhite-screenwriting-v1");
  if (!existsSync(path.join(dir, "SKILL.md"))) {
    throw new Error("缺少编剧 skill：prompts/deepwhite-screenwriting-v1/SKILL.md");
  }
  return dir;
}

function loadScreenwritingSystemPrompt(projectRoot: string, mode: ScreenwritingMode): string {
  const root = skillRoot(projectRoot);
  const skill = readFileSync(path.join(root, "SKILL.md"), "utf8").trim();
  const refs: string[] = [];
  const pick = (name: string) => {
    const p = path.join(root, "references", name);
    if (existsSync(p)) refs.push(`\n\n===== references/${name} =====\n${readFileSync(p, "utf8").trim()}`);
  };
  if (mode === "diagnose") {
    pick("scorecards.md");
    pick("screenwriter-engine.md");
    pick("shanyin-engine.md");
  } else if (mode === "rewrite" || mode === "scene") {
    pick("shanyin-engine.md");
    pick("screenwriter-engine.md");
  } else {
    pick("shanyin-engine.md");
    pick("screenwriter-engine.md");
  }
  return [skill, ...refs, `\n\n${API_CONSTRAINT}`].join("\n");
}

function buildUserMessage(opts: {
  mode: ScreenwritingMode;
  brief: string;
  material: string;
  durationHint: string;
}): string {
  const lines = [
    `模式：${screenwritingModeLabel(opts.mode)}（mode=${opts.mode}）`,
    opts.durationHint ? `体量提示：${opts.durationHint}` : "体量提示：未指定（可按 1-3 分钟概念片默认）",
    "",
    "【创作简报 / 需求】",
    opts.brief || "（无）",
  ];
  if (opts.material) {
    lines.push("", "【已有材料】", opts.material);
  }
  lines.push("", "按 DeepWhite 中文影视编剧 v1 执行，一次性输出完整 markdown（API 模式）。");
  return lines.join("\n");
}

function assertScreenwritingMarkdown(markdown: string, mode: ScreenwritingMode): void {
  const md = String(markdown || "").trim();
  if (md.length < 80) throw new Error("编剧输出过短");
  if (/Hollywood|FADE IN:|INT\./i.test(md)) throw new Error("禁止 Hollywood 格式");
  if (mode === "diagnose" && !/(问题|诊断|评分|分)/.test(md)) {
    throw new Error("诊断模式须包含问题/评分内容");
  }
  if ((mode === "from_scratch" || mode === "scene") && !/(场景|分场|对白|说)/.test(md)) {
    throw new Error("创作/场景模式须包含可拍场景或对白");
  }
}

async function callLlm(opts: {
  systemPrompt: string;
  userMessage: string;
  model: string;
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
    max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 12288),
    temperature: 0.7,
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

function parseResponse(raw: string, mode: ScreenwritingMode): ScreenwritingResult {
  const text = String(raw || "").trim();
  if (!text) throw new Error("模型返回空内容");
  const parsed = extractJson(text) as Record<string, unknown> | null;
  let markdown = "";
  let title = "未命名剧本";
  let resolvedMode = mode;
  if (parsed && typeof parsed === "object") {
    markdown = String(parsed.markdown || parsed.display_text || "").trim();
    if (parsed.title) title = String(parsed.title).trim().slice(0, 60) || title;
    if (parsed.mode) resolvedMode = normalizeScreenwritingMode(parsed.mode);
  } else if (text.length > 80) {
    markdown = stripFence(text);
  }
  if (!markdown) throw new Error("编剧 JSON 缺少 markdown");
  assertScreenwritingMarkdown(markdown, resolvedMode);
  return {
    mode: resolvedMode,
    mode_label: screenwritingModeLabel(resolvedMode),
    markdown,
    display_text: markdown,
    title,
  };
}

export async function generateScreenwritingOnServer(
  projectRoot: string,
  body: ScreenwritingBody
): Promise<ScreenwritingResult> {
  const mode = normalizeScreenwritingMode(body.mode);
  const brief = String(body.brief || "").trim().slice(0, 4000);
  const material = String(body.material || "").trim().slice(0, MATERIAL_MAX);
  const durationHint = String(body.durationHint || "").trim().slice(0, 80);
  if (mode === "from_scratch" && brief.length < BRIEF_MIN && material.length < BRIEF_MIN) {
    throw new Error(`请提供创作简报（至少 ${BRIEF_MIN} 字）或已有材料`);
  }
  if ((mode === "diagnose" || mode === "rewrite" || mode === "scene") && material.length < BRIEF_MIN) {
    throw new Error("诊断/改写/场景模式需要粘贴已有材料");
  }
  const model =
    String(body.model || "").trim() ||
    (process.env.TEXT_MODEL || "").trim() ||
    "gemini-3.5-flash";
  const systemPrompt = loadScreenwritingSystemPrompt(projectRoot, mode);
  const baseUser = buildUserMessage({ mode, brief, material, durationHint });

  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const userMessage =
        attempt === 0
          ? baseUser
          : `${baseUser}\n\n上次失败：${lastError}。请整份重写合法 JSON。`;
      const text = await callLlm({ systemPrompt, userMessage, model });
      return parseResponse(text, mode);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      await sleep(900 * (attempt + 1));
    }
  }
  throw new Error(lastError || "编剧生成失败");
}

export function registerCanvasScreenwritingRoutes(
  app: Express,
  projectRoot: string,
  gate?: RequestHandler
) {
  app.post("/api/canvas/screenwriting", ...(gate ? [gate] : []), async (req, res) => {
    try {
      const result = await generateScreenwritingOnServer(projectRoot, req.body || {});
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[screenwriting] failed:", msg);
      return res.status(502).json({ error: msg });
    }
  });
}
