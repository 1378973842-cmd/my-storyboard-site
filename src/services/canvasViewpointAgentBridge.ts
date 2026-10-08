import type { Express, Request, RequestHandler } from "express";
import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  augmentChatCompletionsBody,
  extractTextLlmMessageContent,
  normalizeOpenAiApiBase,
  postTextLlm,
  stripBearerKey,
} from "./canvasTextLlmBridge.js";
import { uploadsToDataUrl } from "./ossStore.js";

export type ViewpointAgentBody = {
  /** 用户对视角的简短意向 */
  intent?: string;
  imageUrls?: string[];
  model?: string;
};

export type ViewpointAgentResult = {
  display_text: string;
  english_prompt: string;
  spatial_notes: string;
  sections: Array<{ title: string; body: string }>;
  has_refs?: boolean;
  ref_count?: number;
};

const FIELD_MIN_TOTAL = 4;
const FIELD_MAX = 8000;
const REF_MAX = 4;

const DEFAULT_MODEL = "google/gemini-3.7-flash";
const DEFAULT_LLM_BASE = "https://llm.runninghub.ai";

function normalizeField(value: unknown, max = FIELD_MAX): string {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, max);
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

function loadViewpointSystemPrompt(projectRoot: string): string {
  const p = path.join(projectRoot, "prompts", "viewpoint-agent", "SYSTEM.md");
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  throw new Error("缺少 prompts/viewpoint-agent/SYSTEM.md");
}

export function resolveViewpointAgentLlmEnv(): { apiBase: string; apiKey: string; model: string } {
  const model =
    String(process.env.VIEWPOINT_AGENT_MODEL || "").trim() ||
    String(process.env.RUNNINGHUB_LLM_MODEL || "").trim() ||
    DEFAULT_MODEL;
  const apiBase = normalizeOpenAiApiBase(
    String(process.env.VIEWPOINT_AGENT_LLM_API_BASE || "").trim() ||
      String(process.env.RUNNINGHUB_LLM_API_BASE || "").trim() ||
      DEFAULT_LLM_BASE
  );
  const apiKey = stripBearerKey(
    String(process.env.VIEWPOINT_AGENT_LLM_API_KEY || "").trim() ||
      String(process.env.RUNNINGHUB_LLM_API_KEY || "").trim() ||
      String(process.env.STORYBOARD_IMAGE_API_KEY || "").trim()
  );
  return { apiBase, apiKey, model };
}

export function viewpointAgentConfigError(): string {
  return "缺少视角 Agent LLM 配置。请在 .env 中设置 VIEWPOINT_AGENT_LLM_API_KEY（或 RUNNINGHUB_LLM_API_KEY / STORYBOARD_IMAGE_API_KEY），可选 VIEWPOINT_AGENT_LLM_API_BASE=https://llm.runninghub.ai 与 VIEWPOINT_AGENT_MODEL=google/gemini-3.7-flash。";
}

export function buildViewpointUserMessage(opts: {
  intent: string;
  refCount: number;
}): string {
  const imageNames =
    opts.refCount > 0
      ? Array.from({ length: opts.refCount }, (_, i) => `【图${i + 1}】/ Image ${i + 1}`).join("、")
      : "";
  const lines = [
    opts.refCount > 0
      ? `【参考图】：已按发送顺序附上 ${opts.refCount} 张，依次为 ${imageNames}。请严格继承画风、光影与资产。`
      : "【参考图】：未提供；请仅依据文字视角意向生成，并在提示词中说明无参考图时的合理假设。",
    `【视角意向】：${opts.intent}`,
    "",
    "用户只给了简短意向。必须先写 Part 1 物理空间推演看板，再写 Part 2 的 ```text 代码块。不要 JSON。",
  ];
  return lines.join("\n");
}

function extractFencedPrompt(raw: string): string {
  const match = /```(?:text|txt)?\s*\n?([\s\S]*?)```/i.exec(raw);
  return match ? match[1].trim() : "";
}

/** ponytail: naive title split; upgrade path = structured JSON from model */
export function splitViewpointAgentSections(text: string): Array<{ title: string; body: string }> {
  const raw = String(text || "").trim();
  if (!raw) return [];

  const fence = /```(?:text|txt)?\s*\n?([\s\S]*?)```/i.exec(raw);
  const zhMatch = /(?:^|\n)\s*(?:#{1,3}\s*)?(?:Part\s*2\s*[:：]\s*)?(?:\*?\*?空间映射速记\*?\*?)/i.exec(raw);
  if (fence) {
    const english = fence[1].trim();
    const prompt = { title: "一键复制提示词", body: english };
    let before = raw.slice(0, fence.index).replace(/\n*#{0,3}\s*Part\s*2[^\n]*$/i, "").trim();
    before = before.replace(/^#{0,3}\s*Part\s*1[^\n]*\n?/i, "").trim();
    const afterSpatial =
      zhMatch && zhMatch.index > fence.index
        ? raw.slice(zhMatch.index + zhMatch[0].length).replace(/^[^\n]*\n?/, "").trim()
        : "";
    if (before) return [{ title: "物理空间推演看板", body: before }, prompt];
    if (afterSpatial) return [prompt, { title: "空间映射速记", body: afterSpatial }];
    return [prompt];
  }

  const enMatch = /(?:^|\n)\s*(?:1\.\s*)?\*?\*?English Prompt\*?\*?\s*[:：]?\s*/i.exec(raw);
  if (enMatch && zhMatch && zhMatch.index > enMatch.index) {
    const english = raw.slice(enMatch.index + enMatch[0].length, zhMatch.index).trim();
    const notes = raw.slice(zhMatch.index + zhMatch[0].length).trim();
    return [
      { title: "English Prompt", body: english },
      { title: "空间映射速记", body: notes },
    ];
  }

  return [{ title: "输出", body: raw }];
}

export function parseViewpointAgentResponse(text: string): ViewpointAgentResult {
  const display_text = String(text || "").trim();
  if (!display_text) throw new Error("模型返回为空");
  const sections = splitViewpointAgentSections(display_text);
  const english =
    sections.find((s) => /english prompt|一键复制/i.test(s.title))?.body ||
    extractFencedPrompt(display_text) ||
    sections[0]?.body ||
    display_text;
  const spatial =
    sections.find((s) => /空间映射|物理空间|看板/.test(s.title))?.body ||
    "";
  if (!english.trim()) throw new Error("未能解析 English Prompt");
  return {
    display_text,
    english_prompt: english.trim(),
    spatial_notes: spatial.trim(),
    sections,
  };
}

function normalizeImageUrls(urls: unknown): string[] {
  if (!Array.isArray(urls)) return [];
  const out: string[] = [];
  for (const item of urls) {
    const u = String(item || "").trim();
    if (!u) continue;
    out.push(u);
    if (out.length >= REF_MAX) break;
  }
  return out;
}

async function callViewpointLlm(opts: {
  systemPrompt: string;
  userMessage: string;
  imageDataUrls: string[];
  model: string;
  apiBase: string;
  apiKey: string;
}): Promise<string> {
  const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 300000);
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
    max_tokens: Number(process.env.VIEWPOINT_AGENT_MAX_TOKENS || 2048),
    temperature: 1,
    top_p: 1,
    presence_penalty: 0,
    frequency_penalty: 0,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await postTextLlm(opts.model, opts.apiBase, opts.apiKey, requestBody, {
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
  } finally {
    clearTimeout(timer);
  }
}

export async function generateViewpointAgentOnServer(
  req: Request,
  projectRoot: string,
  body: ViewpointAgentBody
): Promise<ViewpointAgentResult> {
  const intent = normalizeField(body.intent);
  if (intent.length < FIELD_MIN_TOTAL) {
    throw new Error(`视角意向过短（至少 ${FIELD_MIN_TOTAL} 字）`);
  }

  const { apiBase, apiKey, model: envModel } = resolveViewpointAgentLlmEnv();
  if (!apiBase || !apiKey) throw new Error(viewpointAgentConfigError());
  const model = String(body.model || "").trim() || envModel;

  const imageUrls = normalizeImageUrls(body.imageUrls);
  const imageDataUrls = (
    await Promise.all(imageUrls.map((url) => resolveImageForVision(req, projectRoot, url)))
  ).filter(Boolean);

  const systemPrompt = loadViewpointSystemPrompt(projectRoot);
  const userMessage = buildViewpointUserMessage({
    intent,
    refCount: imageDataUrls.length,
  });

  const text = await callViewpointLlm({
    systemPrompt,
    userMessage,
    imageDataUrls,
    model,
    apiBase,
    apiKey,
  });

  const result = parseViewpointAgentResponse(text);
  result.has_refs = imageDataUrls.length > 0;
  result.ref_count = imageDataUrls.length;
  return result;
}

export function registerCanvasViewpointAgentRoutes(
  app: Express,
  projectRoot: string,
  gate?: RequestHandler
) {
  app.post("/api/canvas/viewpoint-agent", ...(gate ? [gate] : []), async (req, res) => {
    try {
      const result = await generateViewpointAgentOnServer(req, projectRoot, req.body || {});
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[viewpoint-agent] failed:", msg);
      return res.status(502).json({ error: msg });
    }
  });
}
