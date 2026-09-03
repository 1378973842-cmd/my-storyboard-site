import type { Express, Request, RequestHandler } from "express";
import { parseUploadsPath, readUploadsBytes } from "./ossStore.js";
import {
  augmentChatCompletionsBody,
  extractTextLlmMessageContent,
  postTextLlm,
  resolveTextLlmEnv,
  textLlmConfigError,
} from "./canvasTextLlmBridge.js";

export type CanvasLLMRequestBody = {
  message?: string;
  model?: string;
  system_prompt?: string;
  messages?: Array<{ role?: string; content?: string }>;
  images?: string[];
  videos?: string[];
  temperature?: number;
};

const MAX_LOCAL_VIDEO_BYTES = Number(process.env.CANVAS_LLM_MAX_VIDEO_BYTES || 20 * 1024 * 1024);

function listenPort(): number {
  return Number(process.env.PORT) || 3000;
}

function absoluteUrl(req: Request, url: string): string {
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

/** /uploads 转 data URL（本地盘或 OSS）；视频超限仍给站内绝对地址。 */
async function resolveMediaUrlForUpstream(
  req: Request,
  projectRoot: string,
  rawUrl: string
): Promise<string> {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (url.startsWith("data:")) return url;
  const internal = parseUploadsPath(url);
  if (internal) {
    const got = await readUploadsBytes(projectRoot, internal);
    if (got?.buffer?.length) {
      if (got.mime.startsWith("video/") && got.buffer.length > MAX_LOCAL_VIDEO_BYTES) {
        console.warn("[canvas-llm] video too large for inline upload, using absolute URL", {
          url: internal,
          bytes: got.buffer.length,
          max: MAX_LOCAL_VIDEO_BYTES,
        });
        return absoluteUrl(req, internal);
      }
      return `data:${got.mime};base64,${got.buffer.toString("base64")}`;
    }
    return absoluteUrl(req, internal);
  }
  if (/^https?:\/\//i.test(url)) return url;
  return absoluteUrl(req, url);
}

export function registerCanvasLlmRoutes(app: Express, projectRoot: string, gate?: RequestHandler) {
  app.post("/api/canvas-llm", ...(gate ? [gate] : []), async (req, res) => {
    const payload = (req.body || {}) as CanvasLLMRequestBody;
    const message = String(payload.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "缺少 message（反推提示词）" });
    }

    const model =
      String(payload.model || "").trim() ||
      (process.env.TEXT_MODEL || "").trim() ||
      "gemini-3.1-pro-preview";

    const { apiBase, apiKey } = resolveTextLlmEnv(model);
    if (!apiBase || !apiKey) {
      return res.status(503).json({
        error: textLlmConfigError(model),
      });
    }

    const imageUrls = (Array.isArray(payload.images) ? payload.images : [])
      .map((u) => String(u || "").trim())
      .filter(Boolean);
    const videoUrls = (Array.isArray(payload.videos) ? payload.videos : [])
      .map((u) => String(u || "").trim())
      .filter(Boolean);
    const mediaUrls = [...videoUrls, ...imageUrls];

    const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [
      { type: "text", text: message },
    ];

    for (const raw of mediaUrls.slice(0, 8)) {
      const resolved = await resolveMediaUrlForUpstream(req, projectRoot, raw);
      if (!resolved) continue;
      contentParts.push({ type: "image_url", image_url: { url: resolved } });
    }

    const upstreamMessages: Array<{ role: string; content: unknown }> = [];
    const systemPrompt = String(payload.system_prompt || "").trim();
    if (systemPrompt) {
      upstreamMessages.push({ role: "system", content: systemPrompt });
    }

    for (const item of (payload.messages || []).slice(-20)) {
      const role = String(item?.role || "").trim();
      const content = String(item?.content || "").trim();
      if ((role === "user" || role === "assistant") && content) {
        upstreamMessages.push({ role, content });
      }
    }

    upstreamMessages.push({
      role: "user",
      content: contentParts.length > 1 ? contentParts : message,
    });

    const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 300000);
    const temperatureRaw = Number(payload.temperature);
    const temperature = Number.isFinite(temperatureRaw) ? Math.max(0, Math.min(2, temperatureRaw)) : undefined;

    try {
      console.log("[canvas-llm]", {
        model,
        messageLen: message.length,
        videos: videoUrls.length,
        images: imageUrls.length,
        temperature,
      });

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const upstreamBody = augmentChatCompletionsBody(model, {
        model,
        messages: upstreamMessages,
        max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 4096),
        stream: false,
        ...(temperature !== undefined ? { temperature } : {}),
      });
      const response = await postTextLlm(model, apiBase, apiKey, upstreamBody, { signal: ctrl.signal });
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
        return res.status(response.status >= 400 ? response.status : 502).json({ error: errMsg });
      }

      const text = extractTextLlmMessageContent(model, data).trim() || "接口返回了空回复。";
      return res.json({
        text,
        model,
        raw_usage: (data.usage as Record<string, unknown>) || {},
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[canvas-llm] failed:", msg);
      return res.status(502).json({ error: `请求上游 LLM 失败：${msg}` });
    }
  });
}
