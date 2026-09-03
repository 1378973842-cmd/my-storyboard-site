import type { Express, Request, RequestHandler } from "express";
import { existsSync, readFileSync } from "fs";
import path from "path";
import { uploadsToDataUrl } from "./ossStore.js";
import {
  augmentChatCompletionsBody,
  extractTextLlmMessageContent,
  postTextLlm,
  resolveTextLlmEnv,
  textLlmConfigError,
} from "./canvasTextLlmBridge.js";

export type SlotsLoopVideoPromptBody = {
  imageUrl?: string;
  durationSec?: number;
  creativeIdea?: string;
  model?: string;
};

export type SlotsLoopVideoSegment = {
  from: number;
  to: number;
  prompt: string;
};

export type SlotsLoopVideoResult = {
  theme: string;
  theme_label: string;
  locked_ui: string[];
  duration_sec: number;
  phases: { t1: number; t2: number };
  segments: SlotsLoopVideoSegment[];
  display_text: string;
  full_prompt: string;
};

const SLOTS_LOOP_VIDEO_DURATION_MIN = 3;
const SLOTS_LOOP_VIDEO_DURATION_MAX = 15;
const SLOTS_LOOP_VIDEO_DURATION_DEFAULT = 5;

const SLOTS_LOOP_VIDEO_SYSTEM = `# Role: Slots 游戏视频提示词专家 (Seedance 2.0 - 终极完美闭环版)

你是一位精通 Seedance 2.0 视频生成模型、且深谙手机游戏商店 Slots 推广视频设计逻辑的提示词专家。你的任务是根据用户上传的 Slots 静态图片（【@素材1】）、**自定义时长 [X] 秒** 以及**用户给出的极简创意想法（如果有）**，分析图片题材，为其生成风格契合、画面丰富、固定机位、且能实现首尾像素 100% 对齐的无缝闭环视频提示词。

---

## 核心设计准则（必须严格遵守）

### 1. 核心创意自动补全原则 (Creative Auto-Completion)
* **核心动作主导**：如果用户给出了任何动效想法，必须将其作为核心主导动作，并在合适的时间段里作为高潮呈现。
* **环境与细节自动丰富**：**禁止只描写用户提到的那一处动效**。你必须根据图片的题材，自动补全并丰富画面中所有其他该题材应有的环境动效（如符合主题的风/沙/水/雾、天空中流动的云、前景宝石堆的闪烁、背景元素的微弱呼吸感等），使画面饱满 spectacular。

### 2. 题材与特效深度适配原则 (Theme Adaptation)
在自动丰富画面时，必须分析【@素材1】的视觉风格，匹配**最符合该题材**的特效。禁止出现违和特效。
* **水/海洋题材**：自动补全气泡、水流波动、水下折射光斑、发光水母微粒。
* **复古/经典拉斯维加斯题材**：自动补全霓虹灯交替闪烁、跑马灯流动、金属边框高亮扫光。
* **古埃及/沙漠题材**：自动补全风沙微粒、金色沙尘暴、闪烁的象形文字能量、热空气热浪。
* **魔法/奇幻题材**：自动补全魔法粒子（Mana dust）、漂浮的光球、符文发光、神秘迷雾。
* **冰雪/极地题材**：自动补全寒气、冰霜电弧、冰晶、飘落的雪花。
* **糖果/卡通题材**：自动补全彩虹光晕、糖果纸闪光、粉色/彩色气泡。

### 3. 严格的 Slots 卷轴与高亮逻辑 (Visual Hierarchy)
* **卷轴内部（和硬币/符号图标）**：只让画面中明显处于**高亮激活 (Highlighted/Active)** 状态的特殊图标做动态特效。**所有未高亮、变暗的普通卷轴符号和数字，必须保持 100% 绝对静止**。
* **卷轴外部（环境与氛围元素）**：不受高亮限制。尽情发挥，自动补全符合该题材的专属特效，越精彩越好。

### 4. 绝对的 UI 与文字锁定 (Anti-Warping)
* 所有提示词段落中必须使用强硬的 \`【重点锁定：...绝对静止，严禁扭曲或数字乱变】\` 指令，锁死画面中的 JACKPOT 数字、赔率文本、LOGO 和所有静态 UI，防止文字产生任何形变。
* locked_ui 数组须逐字照抄截图可见 UI 文案（常为英文/数字，保持原语言，不要翻译）。

### 5. 黄金闭环收尾机制 (Seamless Loop Ending - 实测最强规则)
* 视频必须使用固定机位（\`[Static Shot]\` 和 \`[Seamless Loop]\`）。
* **在视频的最后一个阶段 (T2 - [X]s)，必须严格执行强制刹车和状态对齐**：使用指令让所有运动物体与特效完全静止悬停在【@素材1】原本的初始坐标，无任何余速和抖动。让风雪、火焰、粒子密度平滑消退，在 [X]s 时完全还原并锁定在 00 秒的第一帧画面状态，确保首尾像素和速度 100% 对齐，实现毫无卡顿的无缝闭环。

---

## 动态时间段划分规则

请根据用户要求的 **[X] 秒** 总时长与用户消息中给定的 T1、T2，将提示词划分为以下三个阶段：
1. **启动爆发期 (00 - T1 s)**：静态启动，锁定文字，主导创意动作起势，符合题材的自动补全特效（如微风、火星等）开始活跃。
2. **高潮渲染期 (T1 - T2 s)**：主导创意动作完全爆发。同时，符合题材的自动补全粒子漫天飞舞狂飙，前景宝石和金币堆产生大面积动态折射强光，视觉张力达到最高。
3. **黄金闭环收尾期 (T2 - [X]s)**：**完美闭环关键**。主导创意动作收尾，强制执行无余速刹车，所有运动元素在最后一秒完全还原到【@素材1】的初始坐标和状态。

---

## 每段提示词写作模板（segments 正文须遵循此结构，用简体中文撰写）

**(00 - T1 s):** [Static Shot] [Seamless Loop] 画面在【@素材1】的基础上启动。**【重点锁定：锁死的 UI 与数字/文字内容绝对保持静止，严禁任何扭曲、闪烁或数字跳变；卷轴内未高亮的背景符号完全静止】**。核心创意动作起势（如用户有要求），同时自动补全符合该图片风格的专属环境大范围动态渲染（详细描述符合题材的风/沙/水/雾/光影变化）。

**(T1 - T2 s):** [Static Shot] **【重点锁定：所有 UI 面板、文字与数字继续保持完全冻结，严禁产生形变】**。核心创意动作完全爆发（细节拉满）。同时，自动丰富符合题材的专属粒子特效在画面中飞舞，前景宝石和金币堆产生大面积动态折射强光，整体视觉张力达到最高。

**(T2 - [X]s):** 最后瞬间 [Static Shot] **【重点锁定：画面中的所有 UI 文字与数字始终无任何像素变动】**。核心创意动作与所有丰富/补全的运动物体、特效完全静止悬停在【@素材1】原本的初始悬浮坐标状态，无任何余速和抖动。环境、粒子、光影及特效密度平滑消退，在 [X]s 时完全还原并锁定在 00 秒的第一帧画面状态，确保首尾像素和速度 100% 对齐，实现毫无卡顿、极具视觉张力的无缝闭环循环。

---

## 输出约束（API 模式，必须遵守）
* 禁止输出分析思路、开场白、结语、Markdown 代码块或任何非 JSON 内容。
* **所有 segments 的 prompt 与 full_prompt 必须用简体中文撰写**（画面描述、动效、环境氛围均为中文）。
* 技术机位标记可保留英文方括号标签：[Static Shot]、[Seamless Loop]（其余正文一律中文）。
* 仅返回一个 JSON 对象，结构如下：
{
  "theme": "theme_key_snake_case",
  "theme_label": "中文题材名",
  "locked_ui": ["逐字 UI 文案1", "..."],
  "segments": [
    {"from": 0, "to": T1, "prompt": "按上述模板撰写的简体中文 Seedance 提示词"},
    {"from": T1, "to": T2, "prompt": "..."},
    {"from": T2, "to": X, "prompt": "..."}
  ],
  "full_prompt": "将三段合并为一条连贯的简体中文提示词，段间用换行分隔，供 Seedance 直接使用"
}
segments 必须恰好 3 段，时间戳 from/to 必须与用户给定的 T1、T2、X 完全一致。`;

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
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i.exec(s);
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

async function resolveSlotsImageForVision(req: Request, projectRoot: string, rawUrl: string): Promise<string> {
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

export function normalizeSlotsLoopDuration(value: unknown): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return SLOTS_LOOP_VIDEO_DURATION_DEFAULT;
  return Math.max(SLOTS_LOOP_VIDEO_DURATION_MIN, Math.min(SLOTS_LOOP_VIDEO_DURATION_MAX, n));
}

export function computeSlotsLoopPhases(durationSec: number): { total: number; t1: number; t2: number } {
  const total = normalizeSlotsLoopDuration(durationSec);
  const t1 = Math.max(1, Math.round(total * 0.3));
  const t2 = Math.max(t1 + 1, Math.round(total * 0.7));
  return { total, t1, t2 };
}

function formatSegmentLabel(from: number, to: number): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `（${pad(from)} - ${to} 秒）：`;
}

export function formatSlotsLoopDisplayText(
  segments: SlotsLoopVideoSegment[],
  fullPrompt: string
): string {
  const blocks = segments.map((seg) => `${formatSegmentLabel(seg.from, seg.to)}\n${seg.prompt.trim()}`);
  const merged = String(fullPrompt || "").trim();
  if (!merged) return blocks.join("\n\n");
  return `${blocks.join("\n\n")}\n\n---\n【合并版 · 可直接用于 Seedance】\n${merged}`;
}

function parseSlotsLoopVideoResponse(
  raw: string,
  phases: { total: number; t1: number; t2: number }
): SlotsLoopVideoResult {
  const text = String(raw || "").trim();
  if (!text) throw new Error("模型返回了空内容");
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(stripMarkdownCodeFence(text));
  } catch {
    parsed = extractBalancedJsonObject(text);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`模型返回的不是合法 JSON：${text.slice(0, 240)}`);
  }
  const obj = parsed as Record<string, unknown>;
  const locked_ui = Array.isArray(obj.locked_ui)
    ? obj.locked_ui.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const rawSegments = Array.isArray(obj.segments) ? obj.segments : [];
  const segments: SlotsLoopVideoSegment[] = rawSegments
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as Record<string, unknown>;
      const from = Number(row.from);
      const to = Number(row.to);
      const prompt = String(row.prompt || "").trim();
      if (!Number.isFinite(from) || !Number.isFinite(to) || !prompt) return null;
      return { from, to, prompt };
    })
    .filter(Boolean) as SlotsLoopVideoSegment[];
  if (segments.length < 3) {
    throw new Error("模型 JSON 须包含 3 段 segments");
  }
  const full_prompt = String(obj.full_prompt || "").trim();
  if (!full_prompt) throw new Error("模型 JSON 缺少 full_prompt");
  return {
    theme: String(obj.theme || "slots").trim() || "slots",
    theme_label: String(obj.theme_label || "").trim() || "Slots",
    locked_ui,
    duration_sec: phases.total,
    phases: { t1: phases.t1, t2: phases.t2 },
    segments: segments.slice(0, 3),
    display_text: formatSlotsLoopDisplayText(segments.slice(0, 3), full_prompt),
    full_prompt,
  };
}

function buildSlotsLoopUserMessage(
  phases: { total: number; t1: number; t2: number },
  creativeIdea: string
): string {
  const idea = String(creativeIdea || "").trim();
  const ideaBlock = idea
    ? `用户核心创意（必须作为主导动作）：${idea}`
    : "用户未提供额外创意，请根据素材1题材自动构思一个符合 Slots 买量风格的精彩主导动作。";
  return [
    "附件图片即为【@素材1】（Slots 静态截图）。",
    `总时长 [X] = ${phases.total} 秒。`,
    `三段时间划分（必须严格使用，并应用【实测黄金收尾闭环指令】）：`,
    `- 启动爆发期：00 - ${phases.t1}s`,
    `- 高潮渲染期：${phases.t1} - ${phases.t2}s`,
    `- 黄金闭环收尾期：${phases.t2} - ${phases.total}s`,
    ideaBlock,
    "请分析【@素材1】题材，提取 locked_ui，按每段写作模板生成三段简体中文提示词，仅输出 JSON（无其他文字）。",
  ].join("\n");
}

async function callSlotsLoopVisionLlm(
  imageDataUrl: string,
  userMessage: string,
  model: string
): Promise<string> {
  const { apiBase, apiKey } = resolveTextLlmEnv(model);
  if (!apiBase || !apiKey) {
    throw new Error(textLlmConfigError(model));
  }
  const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 300000);
  const maxRetries = 4;
  const baseDelayMs = 2000;
  let lastError = "";

  const requestBody = augmentChatCompletionsBody(model, {
    model,
    stream: false,
    messages: [
      { role: "system", content: SLOTS_LOOP_VIDEO_SYSTEM },
      {
        role: "user",
        content: [
          { type: "text", text: userMessage },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ],
      },
    ],
    max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 4096),
    temperature: 0.85,
  });

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await postTextLlm(model, apiBase, apiKey, requestBody, { signal: ctrl.signal });
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
          const delay = Math.min(12000, baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 260));
          console.warn("[slots-loop-video] upstream overloaded, retrying...", { attempt, delay });
          await sleep(delay);
          lastError = errMsg;
          continue;
        }
        throw new Error(errMsg);
      }
      return extractTextLlmMessageContent(model, data).trim();
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        isUpstreamOverloaded(0, msg) || /fetch failed|network|econnreset|aborted/i.test(msg);
      if (retryable && attempt < maxRetries) {
        const delay = Math.min(12000, baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 260));
        console.warn("[slots-loop-video] transient error, retrying...", { attempt, delay, msg });
        await sleep(delay);
        lastError = msg;
        continue;
      }
      throw err instanceof Error ? err : new Error(msg);
    }
  }
  throw new Error(lastError || "Slots 循环视频提示词生成失败");
}

export async function generateSlotsLoopVideoPromptOnServer(
  req: Request,
  projectRoot: string,
  body: SlotsLoopVideoPromptBody
): Promise<SlotsLoopVideoResult> {
  const imageUrl = String(body.imageUrl || "").trim();
  if (!imageUrl) throw new Error("缺少 imageUrl");
  const imageDataUrl = await resolveSlotsImageForVision(req, projectRoot, imageUrl);
  if (!imageDataUrl) throw new Error("无法读取 Slots 静态图");
  const phases = computeSlotsLoopPhases(body.durationSec);
  const creativeIdea = String(body.creativeIdea || "").trim().slice(0, 500);
  const model =
    String(body.model || "").trim() ||
    (process.env.TEXT_MODEL || "").trim() ||
    "gemini-3.5-flash";
  const userMessage = buildSlotsLoopUserMessage(phases, creativeIdea);
  const maxAttempts = 3;
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const text = await callSlotsLoopVisionLlm(imageDataUrl, userMessage, model);
      return parseSlotsLoopVideoResponse(text, phases);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn("[slots-loop-video] parse/generate failed:", { attempt, lastError });
      if (isUpstreamOverloaded(0, lastError) && attempt < maxAttempts - 1) {
        await sleep(Math.min(8000, 1500 * Math.pow(2, attempt)));
      }
    }
  }
  throw new Error(lastError || "Slots 循环视频提示词生成失败");
}

export function registerCanvasSlotsLoopVideoRoutes(
  app: Express,
  projectRoot: string,
  gate?: RequestHandler
) {
  app.post("/api/canvas/slots-loop-video-prompt", ...(gate ? [gate] : []), async (req, res) => {
    try {
      const result = await generateSlotsLoopVideoPromptOnServer(req, projectRoot, req.body || {});
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[slots-loop-video-prompt] failed:", msg);
      return res.status(502).json({ error: msg });
    }
  });
}
