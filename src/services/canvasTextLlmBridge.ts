import { Resolver } from "node:dns/promises";
import { Agent, fetch as undiciFetch } from "undici";

/** RunningHub OpenAI-compatible text LLM (e.g. glm-5.1); supports multimodal via image_url content parts */
export const RUNNINGHUB_LLM_DEFAULT_BASE = "https://llm.runninghub.cn";

/** APIMart OpenAI Chat Completions（gemini-3.5-flash 等多模态 Gemini） */
export const APIMART_DEFAULT_BASE = "https://api.apimart.ai";

export function stripBearerKey(key: string): string {
  let k = String(key || "").trim();
  if (/^bearer\s+/i.test(k)) k = k.replace(/^bearer\s+/i, "").trim();
  return k;
}

export function isRunningHubChatModel(model: string): boolean {
  const m = String(model || "").trim().toLowerCase();
  if (!m) return false;
  return m === "glm-5.1" || m.startsWith("glm-");
}

/** 仅 gemini-3.5-flash 走 APIMart Chat Completions；/v1/responses 仅支持 GPT 系列多模态 */
export function isApimartGeminiFlashModel(model: string): boolean {
  return String(model || "").trim().toLowerCase() === "gemini-3.5-flash";
}

export function normalizeOpenAiApiBase(apiBase: string): string {
  let cleanBase = String(apiBase || "").trim().replace(/\/+$/, "");
  if (!cleanBase) return "";
  if (!cleanBase.startsWith("http://") && !cleanBase.startsWith("https://")) {
    cleanBase = `https://${cleanBase}`;
  }
  if (!cleanBase.endsWith("/v1") && !cleanBase.includes("/v1/")) {
    cleanBase = `${cleanBase}/v1`;
  }
  return cleanBase;
}

export function chatCompletionsUrl(apiBase: string): string {
  const base = normalizeOpenAiApiBase(apiBase);
  if (!base) return "";
  return base.endsWith("/v1") ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

export function responsesApiUrl(apiBase: string): string {
  const base = normalizeOpenAiApiBase(apiBase);
  if (!base) return "";
  return base.endsWith("/v1") ? `${base}/responses` : `${base}/v1/responses`;
}

export function textLlmEndpointUrl(_model: string, apiBase: string): string {
  return chatCompletionsUrl(apiBase);
}

export function buildTextLlmRequestBody(
  model: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  return augmentChatCompletionsBody(model, body);
}

/** Route text LLM: glm-* → RunningHub; gemini-3.5-flash → APIMart; others → NINE_GRID_TEXT_* / THIRD_PARTY_* */
export function resolveTextLlmEnv(model?: string): { apiBase: string; apiKey: string } {
  const m = String(model || "").trim();
  if (isRunningHubChatModel(m)) {
    const apiBase = normalizeOpenAiApiBase(
      (process.env.RUNNINGHUB_LLM_API_BASE || "").trim() || RUNNINGHUB_LLM_DEFAULT_BASE
    );
    const apiKey = stripBearerKey(
      (process.env.RUNNINGHUB_LLM_API_KEY || "").trim() ||
        (process.env.STORYBOARD_IMAGE_API_KEY || "").trim() ||
        (process.env.NINE_GRID_TEXT_API_KEY || "").trim() ||
        (process.env.THIRD_PARTY_API_KEY || "").trim()
    );
    return { apiBase, apiKey };
  }
  if (isApimartGeminiFlashModel(m)) {
    const apiBase = normalizeOpenAiApiBase(
      (process.env.APIMART_API_BASE || "").trim() || APIMART_DEFAULT_BASE
    );
    const apiKey = stripBearerKey((process.env.APIMART_API_KEY || "").trim());
    return { apiBase, apiKey };
  }
  const base =
    (process.env.NINE_GRID_TEXT_API_BASE || "").trim() ||
    (process.env.THIRD_PARTY_API_BASE || "").trim();
  const apiKey = stripBearerKey(
    (process.env.NINE_GRID_TEXT_API_KEY || "").trim() ||
      (process.env.THIRD_PARTY_API_KEY || "").trim()
  );
  return { apiBase: normalizeOpenAiApiBase(base), apiKey };
}

/** RunningHub glm chat/completions extra fields per vendor docs */
export function augmentChatCompletionsBody(
  model: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...body };
  // APIMart（含 api.apib.ai 大陆入口）默认 SSE 流式；服务端需完整 JSON 响应
  if (isApimartGeminiFlashModel(model) && out.stream === undefined) {
    out.stream = false;
  }
  if (!isRunningHubChatModel(model)) return out;
  const effort =
    String(process.env.RUNNINGHUB_LLM_REASONING_EFFORT || "none").trim() || "none";
  Object.assign(out, {
    top_p: body.top_p !== undefined ? body.top_p : 1,
    presence_penalty: body.presence_penalty !== undefined ? body.presence_penalty : 0,
    frequency_penalty: body.frequency_penalty !== undefined ? body.frequency_penalty : 0,
    reasoning_effort: body.reasoning_effort !== undefined ? body.reasoning_effort : effort,
  });
  if (body.temperature === undefined) out.temperature = 1;
  return out;
}

type ChatMessage = { role?: string; content?: unknown };

function convertContentToResponsesBlocks(content: unknown): Array<Record<string, string>> {
  if (typeof content === "string") {
    const text = content.trim();
    return text ? [{ type: "input_text", text }] : [];
  }
  if (!Array.isArray(content)) return [];
  const blocks: Array<Record<string, string>> = [];
  for (const part of content) {
    if (typeof part === "string") {
      const text = part.trim();
      if (text) blocks.push({ type: "input_text", text });
      continue;
    }
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    if (p.type === "text" && typeof p.text === "string" && p.text.trim()) {
      blocks.push({ type: "input_text", text: p.text });
      continue;
    }
    const imageUrl =
      p.type === "image_url" && p.image_url && typeof p.image_url === "object"
        ? String((p.image_url as { url?: unknown }).url || "").trim()
        : "";
    if (imageUrl) blocks.push({ type: "input_image", image_url: imageUrl });
  }
  return blocks;
}

function convertMessagesToResponsesInput(
  messages: ChatMessage[]
): Array<{ role: string; content: Array<Record<string, string>> }> {
  const out: Array<{ role: string; content: Array<Record<string, string>> }> = [];
  for (const msg of messages) {
    const role = String(msg?.role || "user").trim() || "user";
    const blocks = convertContentToResponsesBlocks(msg?.content);
    if (!blocks.length && typeof msg?.content === "string" && msg.content.trim()) {
      blocks.push({ type: "input_text", text: msg.content.trim() });
    }
    if (!blocks.length) continue;
    out.push({ role, content: blocks });
  }
  return out;
}

/** chat/completions 请求体 → APIMart /v1/responses 请求体 */
export function buildApimartResponsesBody(
  model: string,
  body: Record<string, unknown>
): Record<string, unknown> {
  const messages = Array.isArray(body.messages) ? (body.messages as ChatMessage[]) : [];
  const input = convertMessagesToResponsesInput(messages);
  const out: Record<string, unknown> = {
    model: String(body.model || model || "gemini-3.5-flash").trim() || "gemini-3.5-flash",
    input,
    stream: body.stream ?? false,
  };
  if (body.max_tokens !== undefined) out.max_tokens = body.max_tokens;
  if (body.temperature !== undefined) out.temperature = body.temperature;
  if (body.top_p !== undefined) out.top_p = body.top_p;
  return out;
}

export function unwrapTextLlmResponseData(raw: Record<string, unknown>): Record<string, unknown> {
  const wrapped = raw.data;
  if (wrapped && typeof wrapped === "object" && !Array.isArray(wrapped)) {
    return wrapped as Record<string, unknown>;
  }
  return raw;
}

export function textFromChatResponse(raw: Record<string, unknown>): string {
  const choices = raw.choices;
  if (!Array.isArray(choices) || !choices.length) return "";
  const first = choices[0] as { message?: { content?: unknown } };
  const content = first?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: unknown }).text || "");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

export function extractTextLlmMessageContent(model: string, raw: Record<string, unknown>): string {
  const data = unwrapTextLlmResponseData(raw);
  const fromChoices = textFromChatResponse(data);
  if (fromChoices.trim()) return fromChoices.trim();
  if (isApimartGeminiFlashModel(model)) {
    const output = data.output;
    if (Array.isArray(output)) {
      const chunks: string[] = [];
      for (const item of output) {
        if (!item || typeof item !== "object") continue;
        const content = (item as { content?: unknown }).content;
        if (typeof content === "string" && content.trim()) {
          chunks.push(content.trim());
          continue;
        }
        if (Array.isArray(content)) {
          for (const part of content) {
            if (part && typeof part === "object" && "text" in part) {
              const t = String((part as { text?: unknown }).text || "").trim();
              if (t) chunks.push(t);
            }
          }
        }
      }
      if (chunks.length) return chunks.join("\n");
    }
  }
  return "";
}

export function extractTextLlmErrorMessage(
  raw: Record<string, unknown>,
  status: number,
  fallback: string
): string {
  const err = raw.error;
  if (err && typeof err === "object") {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
  }
  if (typeof raw.message === "string" && raw.message.trim()) return raw.message.trim();
  return fallback || `上游接口错误 (${status})`;
}

let apimartIpCache: { host: string; ip: string; at: number } | null = null;
const APIMART_IP_CACHE_MS = 5 * 60 * 1000;

function isApimartHost(url: string): boolean {
  try {
    return /apimart\.ai$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function resolveApimartConnectIp(hostname: string): Promise<string> {
  const manual = String(process.env.APIMART_RESOLVE_IP || "").trim();
  if (manual) return manual;
  if (String(process.env.APIMART_DNS_FIX || "1").trim() === "0") return "";

  const now = Date.now();
  if (
    apimartIpCache &&
    apimartIpCache.host === hostname &&
    now - apimartIpCache.at < APIMART_IP_CACHE_MS
  ) {
    return apimartIpCache.ip;
  }

  try {
    const resolver = new Resolver();
    resolver.setServers(
      String(process.env.APIMART_DNS_SERVERS || "1.1.1.1,8.8.8.8")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    const addrs = await resolver.resolve4(hostname);
    const ip = addrs[0] || "";
    if (ip) apimartIpCache = { host: hostname, ip, at: now };
    return ip;
  } catch {
    return "";
  }
}

async function fetchApimartWithDnsFix(url: string, init: RequestInit): Promise<Response> {
  const parsed = new URL(url);
  const ip = await resolveApimartConnectIp(parsed.hostname);
  if (!ip) return fetch(url, init);

  type LookupCallback = (
    err: NodeJS.ErrnoException | null,
    address: string | Array<{ address: string; family: number }>,
    family?: number
  ) => void;
  const lookup = (_hostname: string, _options: unknown, callback: LookupCallback) => {
    callback(null, [{ address: ip, family: 4 }]);
  };

  const dispatcher = new Agent({
    connect: { lookup, servername: parsed.hostname },
  });
  return undiciFetch(url, { ...(init as Record<string, unknown>), dispatcher }) as Promise<Response>;
}

export async function postTextLlm(
  model: string,
  apiBase: string,
  apiKey: string,
  body: Record<string, unknown>,
  init?: RequestInit
): Promise<Response> {
  const url = textLlmEndpointUrl(model, apiBase);
  const payload = buildTextLlmRequestBody(model, body);
  const requestInit: RequestInit = {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: `Bearer ${apiKey}`,
      ...(init?.headers as Record<string, string> | undefined),
    },
    body: JSON.stringify(payload),
    signal: init?.signal,
  };
  if (isApimartHost(url)) return fetchApimartWithDnsFix(url, requestInit);
  return fetch(url, requestInit);
}

export function textLlmConfigError(model?: string): string {
  if (isRunningHubChatModel(model || "")) {
    return "缺少 RunningHub 文本 LLM 配置。请在 .env 中设置 RUNNINGHUB_LLM_API_KEY（或复用 STORYBOARD_IMAGE_API_KEY），保存后重启 npm run dev。";
  }
  if (isApimartGeminiFlashModel(model || "")) {
    return "缺少 APIMart 配置。请在 .env 中设置 APIMART_API_KEY（可选 APIMART_API_BASE），保存后重启 npm run dev。";
  }
  return "缺少文本 API 配置。请在 .env 中设置 NINE_GRID_TEXT_API_BASE（可选）与 NINE_GRID_TEXT_API_KEY，或设置 THIRD_PARTY_API_BASE 与 THIRD_PARTY_API_KEY，保存后重启 npm run dev。";
}
