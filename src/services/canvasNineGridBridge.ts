import type { Request } from "express";
import { uploadsToDataUrl } from "./ossStore.js";
import {
  augmentChatCompletionsBody,
  extractTextLlmMessageContent,
  parseTextLlmResponseBody,
  postTextLlm,
  resolveTextLlmEnv,
} from "./canvasTextLlmBridge.js";

export type NineGridRefLook = {
  index: number;
  name: string;
  face_hair: string;
  costume: string;
  accessories: string;
  body_type: string;
  style_notes: string;
  /** true when vision LLM failed — prompts must rely on uploaded reference pixels */
  visionFailed?: boolean;
};

const NINE_GRID_REF_VISION_FALLBACK_NOTE =
  "（视觉锚点未自动提取：分镜与出图必须以实际上传的该张参考图为准，禁止编造服装、发型或配饰）";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function fallbackRefLook(index: number, name: string): NineGridRefLook {
  const note = NINE_GRID_REF_VISION_FALLBACK_NOTE;
  return {
    index,
    name,
    face_hair: note,
    costume: note,
    accessories: "无",
    body_type: note,
    style_notes: note,
    visionFailed: true,
  };
}

const NINE_GRID_REF_VISION_SYSTEM = `你是角色造型分析师。根据用户上传的参考图，提取该角色的可视化锚点，用于九宫格分镜与图生图的一致性锁定。
重点：costume（服装）与 face_hair 同等重要；即使镜头主要是面部特写，也必须完整描述参考图中的上装/下装/鞋子/外套/配饰与颜色。
只输出一个合法 JSON 对象（不要 Markdown），字段全部为中文描述字符串：
{
  "face_hair": "脸型、瞳色、发型、发色、年龄段、五官气质",
  "costume": "上装/下装/鞋子/外套的品类、颜色、材质、图案与版型，务必具体到可复现",
  "accessories": "眼镜、首饰、帽子、包、道具等；无则写「无」",
  "body_type": "体型、身高感、常见姿态",
  "style_notes": "画风、光影、整体气质"
}`;

function listenPort(): number {
  return Number(process.env.PORT) || 3005;
}

function absoluteRefUrl(req: Request, url: string): string {
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

export async function resolveNineGridRefImageForVision(
  req: Request,
  projectRoot: string,
  rawUrl: string
): Promise<string> {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (url.startsWith("data:")) return url;
  const data = await uploadsToDataUrl(projectRoot, url);
  if (data) return data;
  if (/^https?:\/\//i.test(url)) return url;
  return absoluteRefUrl(req, url);
}

function stripMarkdownFence(text: string): string {
  return String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractBalancedJsonObject(text: string): unknown {
  const cleaned = stripMarkdownFence(text);
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

function textFromChatResponse(data: Record<string, unknown>): string {
  const choice = (data?.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "object" && part && "text" in part ? String((part as { text?: string }).text || "") : ""))
      .join("\n");
  }
  return "";
}

function normalizeRefLook(raw: unknown, index: number, name: string): NineGridRefLook {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const pick = (key: string) => String(o[key] || "").trim();
  return {
    index,
    name,
    face_hair: pick("face_hair"),
    costume: pick("costume"),
    accessories: pick("accessories") || "无",
    body_type: pick("body_type"),
    style_notes: pick("style_notes"),
  };
}

async function callNineGridRefVisionLlm(
  imageDataUrl: string,
  refName: string,
  model: string,
  apiBase: string,
  apiKey: string
): Promise<NineGridRefLook> {
  const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 120000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const response = await postTextLlm(
      model,
      apiBase,
      apiKey,
      augmentChatCompletionsBody(model, {
        model,
        messages: [
          { role: "system", content: NINE_GRID_REF_VISION_SYSTEM },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `参考图角色名称：${refName}。请分析这张参考图中的角色造型，输出 JSON。`,
              },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
        max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 2048),
        temperature: 0,
        stream: false,
      }),
      { signal: ctrl.signal }
    );
    clearTimeout(timer);
    const rawText = await response.text();
    const data = parseTextLlmResponseBody(rawText);
    if (!response.ok) {
      const errMsg =
        (typeof (data?.error as { message?: unknown })?.message === "string" &&
          (data.error as { message: string }).message) ||
        rawText.slice(0, 400) ||
        `视觉分析失败 (${response.status})`;
      throw new Error(errMsg);
    }
    const text = extractTextLlmMessageContent(model, data);
    const parsed = extractBalancedJsonObject(text);
    if (!parsed) throw new Error("视觉分析返回无法解析的 JSON");
    return normalizeRefLook(parsed, 0, refName);
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

export function formatNineGridRefLooksForPhaseA(looks: NineGridRefLook[]): string {
  if (!looks.length) return "";
  const lines = looks.map((look) => {
    const label = `图${look.index}（${look.name}）`;
    if (look.visionFailed) {
      return (
        `${label}：\n` +
        `  - 【重要】视觉模型未能读取此参考图细节，但用户已上传图${look.index}。` +
        `分镜与出图必须严格以用户上传的图${look.index}中人物的完整造型为准（发型、五官、体型与全套服装/配饰/颜色），` +
        `禁止只参考面部而臆造或改写服装。`
      );
    }
    const parts = [
      look.face_hair ? `发型五官：${look.face_hair}` : "",
      look.costume ? `服装造型：${look.costume}` : "",
      look.accessories ? `配饰：${look.accessories}` : "",
      look.body_type ? `体型：${look.body_type}` : "",
      look.style_notes ? `气质画风：${look.style_notes}` : "",
    ].filter(Boolean);
    return `${label}：\n${parts.map((p) => `  - ${p}`).join("\n")}`;
  });
  return (
    `【参考图视觉锚点（由视觉模型从上传参考图提取，九格分镜必须严格遵守）】\n` +
    `${lines.join("\n\n")}\n\n` +
    `造型锁定规则：除非某一镜头剧本明确写出「换装/更衣/洗澡后换衣/换上××」等情节，否则全部 9 格 prompt 必须沿用以上参考造型（服装颜色、品类、发型、配饰禁止擅自更改）。若剧本与参考造型冲突，以参考造型为准，用动作与表情推进剧情。`
  );
}

export async function analyzeNineGridReferenceLooks(
  req: Request,
  projectRoot: string,
  refs: Array<{ url: string; name: string }>,
  opts: { model: string; apiBase: string; apiKey: string }
): Promise<NineGridRefLook[]> {
  if (!refs.length) return [];
  const out: NineGridRefLook[] = [];
  // Sequential + retry: parallel vision calls often rate-limit and silently drop 图2+
  for (let idx = 0; idx < refs.length; idx += 1) {
    const ref = refs[idx];
    const index = idx + 1;
    const name = String(ref.name || "").trim() || `角色${String(index).padStart(2, "0")}`;
    const imageDataUrl = await resolveNineGridRefImageForVision(req, projectRoot, ref.url);
    if (!imageDataUrl) {
      console.warn("[9grid] ref vision skipped: empty image url", { index, name });
      out.push(fallbackRefLook(index, name));
      continue;
    }
    let resolved: NineGridRefLook | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const look = await callNineGridRefVisionLlm(imageDataUrl, name, opts.model, opts.apiBase, opts.apiKey);
        resolved = { ...look, index, name, visionFailed: false };
        break;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt === 0) {
          console.warn("[9grid] ref vision retry", { index, name, err: msg.slice(0, 200) });
          await sleep(900);
        } else {
          console.warn("[9grid] ref vision failed", { index, name, err: msg.slice(0, 200) });
          resolved = fallbackRefLook(index, name);
        }
      }
    }
    if (resolved) out.push(resolved);
  }
  return out;
}
