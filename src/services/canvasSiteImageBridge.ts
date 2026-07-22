import type { Express, Request, Response, RequestHandler } from "express";
import { v4 as uuidv4 } from "uuid";
import { augmentImagePromptWithReferenceCostumeLock } from "../lib/nineGrid/nineGridCore.js";
import {
  getNineGridG2Path,
  getStoryboardImageEnv,
  isMidjourneyV81Model,
  isNiji7Model,
  RUNNINGHUB_G2_OFFICIAL_I2I_PATH,
  RUNNINGHUB_G2_RATIOS,
  runStoryboardRunningHubG2Job,
  runStoryboardRunningHubGenerateJob,
  runStoryboardRunningHubJob,
  runStoryboardRunningHubMjV81Job,
  runStoryboardRunningHubNiji7Job,
} from "./runningHubStoryboardImage.js";

/** 与画布引擎 POST /api/canvas-image-tasks 请求体一致 */
export type CanvasOnlineImagePayload = {
  prompt?: string;
  model?: string;
  provider_id?: string;
  size?: string;
  /** 画布节点 resolution：1k | 2k | 4k */
  canvas_resolution?: string;
  /** 画布节点 ratio：square | wide | story | … */
  canvas_ratio?: string;
  canvas_custom_ratio?: string;
  quality?: string;
  reference_images?: Array<{ url?: string; name?: string; role?: string; kind?: string }>;
  mj_v81?: {
    chaos?: number;
    quality?: string;
    stylize?: number;
    raw?: boolean;
    hd?: boolean;
    iw?: number;
    sw?: number;
    sv?: number;
  };
  niji7?: {
    chaos?: number;
    stylize?: number;
    weird?: number;
    raw?: boolean;
    iw?: number;
    sw?: number;
    sv?: number;
  };
  /** 九宫格 Agent 生图任务：gpt-image-2 走官方渠道 */
  nine_grid_agent?: boolean;
  /** 写入成片库 / 归属用 */
  canvas_id?: string;
  node_id?: string;
};

type CanvasImageTask = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  created_at: number;
  updated_at: number;
  result: { images: string[]; url?: string; model?: string } | null;
  error: string;
};

const tasks = new Map<string, CanvasImageTask>();

const CANVAS_RATIO_TO_ASPECT: Record<string, string> = {
  square: "1:1",
  portrait: "2:3",
  landscape: "3:2",
  portrait43: "3:4",
  landscape43: "4:3",
  story: "9:16",
  wide: "16:9",
};

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

function isGptImage2(model?: string): boolean {
  return /^gpt-image-2(-稳定)?$/i.test(String(model || "").trim());
}

function isGptImage2Stable(model?: string): boolean {
  return /^gpt-image-2-稳定$/i.test(String(model || "").trim());
}

/** gpt-image-2-稳定 / 九宫格 Agent → 官方 G2 图生图 */
function resolveG2I2IPath(model?: string, nineGridAgent?: boolean): string | undefined {
  if (nineGridAgent || isGptImage2Stable(model)) {
    return getNineGridG2Path() || RUNNINGHUB_G2_OFFICIAL_I2I_PATH;
  }
  return undefined;
}

function canvasResolutionToImageSize(res?: string): "1K" | "2K" | "4K" {
  const raw = String(res || "2k").trim().toLowerCase();
  if (raw === "1k") return "1K";
  if (raw === "4k") return "4K";
  return "2K";
}

function canvasRatioToAspectRatio(payload: CanvasOnlineImagePayload): string {
  const key = String(payload.canvas_ratio || "square").trim();
  if (/^\d+:\d+$/.test(key)) return key;
  if (key === "custom" && payload.canvas_custom_ratio) {
    const raw = String(payload.canvas_custom_ratio).trim();
    if (raw.includes(":")) return raw;
    const m = raw.match(/^(\d+)\s*x\s*(\d+)$/i);
    if (m) {
      const w = Number(m[1]);
      const h = Number(m[2]);
      const candidates = [
        [1, 1],
        [16, 9],
        [9, 16],
        [3, 2],
        [2, 3],
        [4, 3],
        [3, 4],
      ];
      let best = "1:1";
      let bestD = Infinity;
      for (const [a, b] of candidates) {
        const d = Math.abs(w / h - a / b);
        if (d < bestD) {
          bestD = d;
          best = `${a}:${b}`;
        }
      }
      return best;
    }
  }
  return CANVAS_RATIO_TO_ASPECT[key] || "1:1";
}

function gcdInt(a: number, b: number): number {
  a = Math.abs(Math.round(a));
  b = Math.abs(Math.round(b));
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a || 1;
}

function aspectRatioFromWxH(size: unknown): string | null {
  const m = /^(\d+)\s*x\s*(\d+)$/i.exec(String(size || "").trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (w <= 0 || h <= 0) return null;
  const g = gcdInt(w, h);
  return `${Math.round(w / g)}:${Math.round(h / g)}`;
}

/** gpt-image-2：优先用画布已算好的 WxH 推导比例，避免 resolution 档位覆盖 aspectRatio */
function gpt2AspectRatioFromPayload(payload: CanvasOnlineImagePayload): string {
  const fromWxH = aspectRatioFromWxH(payload.size);
  if (fromWxH) return nearestG2AspectRatio(fromWxH);
  return nearestG2AspectRatio(canvasRatioToAspectRatio(payload));
}

function gpt2ImageSizeFromPayload(payload: CanvasOnlineImagePayload): string {
  const explicit = String(payload.size || "").trim();
  if (/^\d+\s*x\s*\d+$/i.test(explicit)) return explicit;
  return canvasResolutionToImageSize(payload.canvas_resolution);
}

function nearestG2AspectRatio(ratio: string): string {
  const target = ratio.trim();
  if ((RUNNINGHUB_G2_RATIOS as readonly string[]).includes(target)) return target;
  const m = /^(\d+):(\d+)$/.exec(target);
  if (!m) return "1:1";
  const tr = Number(m[1]) / Number(m[2]);
  let best: string = "1:1";
  let bestScore = Infinity;
  for (const cand of RUNNINGHUB_G2_RATIOS) {
    const [a, b] = cand.split(":").map(Number);
    const score = Math.abs(Math.log(tr / (a / b)));
    if (score < bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

/** 与 StandaloneImageEditorPage 的 edit / edit_gpt2 请求体一致 */
export function mapCanvasToEditorRequest(
  req: Request,
  payload: CanvasOnlineImagePayload
): { path: "/api/edit-image"; body: Record<string, unknown> } {
  const refItems = (payload.reference_images || [])
    .map((r) => ({
      url: String(r?.url || "").trim(),
      name: String(r?.name || "").trim(),
    }))
    .filter((r) => r.url);
  const prompt = refItems.length
    ? augmentImagePromptWithReferenceCostumeLock(
        String(payload.prompt || "").trim() || "Edit the reference images.",
        refItems
      )
    : String(payload.prompt || "").trim() || "Edit the reference images.";
  const model = String(payload.model || "").trim();
  const images = refItems.map((r) => absoluteUrl(req, r.url)).filter(Boolean);
  const aspect_ratio = isGptImage2(model)
    ? gpt2AspectRatioFromPayload(payload)
    : canvasRatioToAspectRatio(payload);
  const image_size = isGptImage2(model)
    ? gpt2ImageSizeFromPayload(payload)
    : canvasResolutionToImageSize(payload.canvas_resolution);

  if (isGptImage2(model)) {
    return {
      path: "/api/edit-image",
      body: {
        prompt,
        images,
        model: "gpt-image-2",
        image_size,
        aspect_ratio,
      },
    };
  }

  return {
    path: "/api/edit-image",
    body: {
      prompt,
      images,
      image_size,
      aspect_ratio,
    },
  };
}

export type CanvasImageBridgeDeps = {
  projectRoot: string;
  persistImage: (
    url: string,
    meta?: {
      userId?: string;
      prompt?: string;
      model?: string;
      canvasId?: string;
      nodeId?: string;
      params?: Record<string, unknown>;
    }
  ) => Promise<string>;
  requireGate?: RequestHandler;
};

async function callSiteEditImage(
  req: Request,
  body: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const port = listenPort();
  const cookie = req.headers.cookie;
  const res = await fetch(`http://127.0.0.1:${port}/api/edit-image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: String(cookie) } : {}),
    },
    body: JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = { error: await res.text().catch(() => `HTTP ${res.status}`) };
  }
  return { ok: res.ok, status: res.status, data };
}

/**
 * 无限画布 API 生成：有参考图时与主页「编辑模式 / GPT 编辑」相同（/api/edit-image + RunningHub）。
 * 仅无图纯文案时走文生图（/api/generate-image）。
 */
function persistMetaFromPayload(req: Request, payload: CanvasOnlineImagePayload) {
  return {
    userId: req.authUser?.id,
    prompt: String(payload.prompt || "").trim(),
    model: String(payload.model || "").trim(),
    canvasId: String(payload.canvas_id || "").trim(),
    nodeId: String(payload.node_id || "").trim(),
    params: {
      size: payload.size,
      canvas_resolution: payload.canvas_resolution,
      canvas_ratio: payload.canvas_ratio,
      quality: payload.quality,
      provider_id: payload.provider_id,
    },
  };
}

async function executeCanvasGeneration(
  req: Request,
  payload: CanvasOnlineImagePayload,
  deps: CanvasImageBridgeDeps
): Promise<{ images: string[]; url: string }> {
  const prompt = String(payload.prompt || "").trim() || "Edit the reference images.";
  const model = String(payload.model || "").trim();
  const persistMeta = persistMetaFromPayload(req, payload);
  const refItems = (payload.reference_images || [])
    .map((r) => ({
      url: String(r?.url || "").trim(),
      name: String(r?.name || "").trim(),
    }))
    .filter((r) => r.url);
  const imageUrls = refItems.map((r) => absoluteUrl(req, r.url)).filter(Boolean);
  const enrichedPrompt = refItems.length
    ? augmentImagePromptWithReferenceCostumeLock(prompt, refItems)
    : prompt;
  const image_size = canvasResolutionToImageSize(payload.canvas_resolution);
  const aspect_ratio = isGptImage2(model)
    ? gpt2AspectRatioFromPayload(payload)
    : canvasRatioToAspectRatio(payload);
  const rhEnv = getStoryboardImageEnv();

  if (isNiji7Model(model)) {
    if (!rhEnv) throw new Error("未配置 STORYBOARD_IMAGE_API_KEY，无法使用 niji7");
    const niji = payload.niji7 || {};
    console.log("[canvas-image/niji7]", {
      aspect_ratio,
      weird: niji.weird,
      sv: niji.sv,
      images: imageUrls.length,
    });
    const upstreamUrl = await runStoryboardRunningHubNiji7Job({
      prompt,
      aspect_ratio,
      chaos: niji.chaos,
      stylize: niji.stylize,
      weird: niji.weird,
      raw: niji.raw,
      iw: niji.iw,
      sw: niji.sw,
      sv: niji.sv,
      imageUrl: imageUrls[0] || null,
      sref: imageUrls[1] || null,
      projectRoot: deps.projectRoot,
    });
    const localUrl = await deps.persistImage(upstreamUrl, persistMeta);
    return { images: [localUrl], url: localUrl };
  }

  if (isMidjourneyV81Model(model)) {
    if (!rhEnv) throw new Error("未配置 STORYBOARD_IMAGE_API_KEY，无法使用 midjourneyV8.1");
    const mj = payload.mj_v81 || {};
    console.log("[canvas-image/mj-v81]", {
      aspect_ratio,
      hd: mj.hd,
      quality: mj.quality,
      images: imageUrls.length,
    });
    const upstreamUrl = await runStoryboardRunningHubMjV81Job({
      prompt,
      aspect_ratio,
      chaos: mj.chaos,
      quality: mj.quality,
      stylize: mj.stylize,
      raw: mj.raw,
      hd: mj.hd,
      iw: mj.iw,
      sw: mj.sw,
      sv: mj.sv,
      imageUrl: imageUrls[0] || null,
      sref: imageUrls[1] || null,
      projectRoot: deps.projectRoot,
    });
    const localUrl = await deps.persistImage(upstreamUrl, persistMeta);
    return { images: [localUrl], url: localUrl };
  }

  if (imageUrls.length > 0) {
    let upstreamUrl: string;
    if (rhEnv) {
      if (isGptImage2(model)) {
        const g2Path = resolveG2I2IPath(model, payload.nine_grid_agent);
        console.log("[canvas-image/runninghub-g2]", {
          resolution: image_size,
          aspect_ratio,
          size: payload.size,
          canvas_ratio: payload.canvas_ratio,
          quality: payload.quality,
          images: imageUrls.length,
          model,
          nine_grid_agent: Boolean(payload.nine_grid_agent),
          g2_path: g2Path || rhEnv.gptPath,
        });
        upstreamUrl = await runStoryboardRunningHubG2Job({
          prompt: enrichedPrompt,
          images: imageUrls,
          image_size: gpt2ImageSizeFromPayload(payload),
          aspect_ratio,
          quality: payload.quality,
          projectRoot: deps.projectRoot,
          pathOverride: g2Path,
        });
      } else {
        console.log("[canvas-image/runninghub]", { resolution: image_size, aspect_ratio, images: imageUrls.length });
        upstreamUrl = await runStoryboardRunningHubJob({
          prompt: enrichedPrompt,
          images: imageUrls,
          image_size,
          aspect_ratio,
          projectRoot: deps.projectRoot,
        });
      }
    } else {
      const { body } = mapCanvasToEditorRequest(req, payload);
      const upstream = await callSiteEditImage(req, body);
      if (!upstream.ok) {
        throw new Error(
          typeof upstream.data.error === "string" ? upstream.data.error : `编辑失败 (${upstream.status})`
        );
      }
      upstreamUrl = typeof upstream.data.url === "string" ? upstream.data.url : "";
      if (!upstreamUrl) throw new Error("接口未返回图片 URL");
      return { images: [upstreamUrl], url: upstreamUrl };
    }
    console.log("[canvas-image] persist upstream", {
      model,
      nine_grid_agent: Boolean(payload.nine_grid_agent),
      url: upstreamUrl.slice(0, 160),
    });
    const localUrl = await deps.persistImage(upstreamUrl, persistMeta);
    return { images: [localUrl], url: localUrl };
  }

  if (rhEnv) {
    const upstreamUrl = await runStoryboardRunningHubGenerateJob({
      prompt,
      image_size,
      aspect_ratio,
      references: [],
      projectRoot: deps.projectRoot,
    });
    const localUrl = await deps.persistImage(upstreamUrl, persistMeta);
    return { images: [localUrl], url: localUrl };
  }

  const port = listenPort();
  const cookie = req.headers.cookie;
  const res = await fetch(`http://127.0.0.1:${port}/api/generate-image`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: String(cookie) } : {}),
    },
    body: JSON.stringify({
      scope: "storyboard",
      prompt,
      image_size,
      aspect_ratio,
      references: [],
    }),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof data.error === "string" ? data.error : `生图失败 (${res.status})`);
  }
  const url = typeof data.url === "string" ? data.url : "";
  if (!url) throw new Error("接口未返回图片 URL");
  return { images: [url], url };
}

async function runCanvasImageTask(
  taskId: string,
  req: Request,
  payload: CanvasOnlineImagePayload,
  deps: CanvasImageBridgeDeps
) {
  const task = tasks.get(taskId);
  if (!task) return;
  task.status = "running";
  task.updated_at = Date.now();

  try {
    const result = await executeCanvasGeneration(req, payload, deps);
    task.status = "succeeded";
    task.result = { ...result, model: String(payload.model || "") };
    task.error = "";
    task.updated_at = Date.now();
  } catch (e) {
    task.status = "failed";
    task.error = e instanceof Error ? e.message : String(e);
    task.updated_at = Date.now();
  }
}

export function registerCanvasSiteImageRoutes(app: Express, deps: CanvasImageBridgeDeps) {
  const gate = deps.requireGate;
  app.post("/api/canvas-image-tasks", ...(gate ? [gate] : []), (req, res) => {
    const payload = (req.body || {}) as CanvasOnlineImagePayload;
    const taskId = `canvas_img_${uuidv4().replace(/-/g, "")}`;
    const now = Date.now();
    tasks.set(taskId, {
      id: taskId,
      status: "queued",
      created_at: now,
      updated_at: now,
      result: null,
      error: "",
    });
    void runCanvasImageTask(taskId, req, payload, deps);
    res.json({ task_id: taskId, status: "queued" });
  });

  app.get("/api/canvas-image-tasks/:taskId", ...(gate ? [gate] : []), (req, res) => {
    const task = tasks.get(req.params.taskId);
    if (!task) {
      return res.status(404).json({
        error: "画布任务不存在，可能服务已重启或任务已过期",
        status: "failed",
      });
    }
    return res.json({
      id: task.id,
      status: task.status,
      result: task.status === "succeeded" ? task.result : null,
      error: task.error || undefined,
      updated_at: task.updated_at,
    });
  });

  app.post("/api/online-image", ...(gate ? [gate] : []), async (req, res) => {
    try {
      const payload = (req.body || {}) as CanvasOnlineImagePayload;
      const result = await executeCanvasGeneration(req, payload, deps);
      return res.json({ images: result.images, url: result.url, model: payload.model });
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : "生图失败" });
    }
  });
}
