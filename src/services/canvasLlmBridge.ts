import type { Express, Request } from "express";
import { existsSync, readFileSync } from "fs";
import path from "path";

export type CanvasLLMRequestBody = {
  message?: string;
  model?: string;
  system_prompt?: string;
  messages?: Array<{ role?: string; content?: string }>;
  images?: string[];
  videos?: string[];
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

function guessMimeFromPath(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".m4v") return "video/x-m4v";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

/** 本地 /uploads 资源：图片转 data URL；视频在体积限制内也转 data URL，便于 Comfly/Gemini 读取 */
function resolveMediaUrlForUpstream(req: Request, projectRoot: string, rawUrl: string): string {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (url.startsWith("data:") || /^https?:\/\//i.test(url)) return url;

  if (url.startsWith("/uploads/")) {
    const rel = url.replace(/^\/uploads\//, "").replace(/\\/g, "/");
    const abs = path.join(projectRoot, "public", "uploads", rel);
    if (!existsSync(abs)) return absoluteUrl(req, url);
    const buf = readFileSync(abs);
    const mime = guessMimeFromPath(abs);
    if (mime.startsWith("video/") && buf.length > MAX_LOCAL_VIDEO_BYTES) {
      console.warn("[canvas-llm] video too large for inline upload, using absolute URL", {
        url,
        bytes: buf.length,
        max: MAX_LOCAL_VIDEO_BYTES,
      });
      return absoluteUrl(req, url);
    }
    return `data:${mime};base64,${buf.toString("base64")}`;
  }

  return absoluteUrl(req, url);
}

function textFromChatResponse(raw: Record<string, unknown>): string {
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

export function registerCanvasLlmRoutes(app: Express, projectRoot: string) {
  app.post("/api/canvas-llm", async (req, res) => {
    const apiBase = (process.env.THIRD_PARTY_API_BASE || "").trim().replace(/\/$/, "");
    const apiKey = (process.env.THIRD_PARTY_API_KEY || "").trim();
    if (!apiBase || !apiKey) {
      return res.status(503).json({
        error:
          "缺少 LLM API 配置。请在 .env 中设置 THIRD_PARTY_API_BASE 与 THIRD_PARTY_API_KEY，保存后重启服务。",
      });
    }

    const payload = (req.body || {}) as CanvasLLMRequestBody;
    const message = String(payload.message || "").trim();
    if (!message) {
      return res.status(400).json({ error: "缺少 message（反推提示词）" });
    }

    const model =
      String(payload.model || "").trim() ||
      (process.env.TEXT_MODEL || "").trim() ||
      "gemini-3.1-pro-preview";

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
      const resolved = resolveMediaUrlForUpstream(req, projectRoot, raw);
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

    try {
      console.log("[canvas-llm]", {
        model,
        messageLen: message.length,
        videos: videoUrls.length,
        images: imageUrls.length,
      });

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      const response = await fetch(`${apiBase}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: upstreamMessages,
          max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 4096),
          stream: false,
        }),
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
        return res.status(response.status >= 400 ? response.status : 502).json({ error: errMsg });
      }

      const text = textFromChatResponse(data).trim() || "接口返回了空回复。";
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
