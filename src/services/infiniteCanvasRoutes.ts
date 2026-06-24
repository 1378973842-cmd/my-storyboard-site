import type { Express, Request, Response, RequestHandler } from "express";
import multer from "multer";
import path from "path";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import {
  createCanvas,
  getCanvas,
  getCanvasMeta,
  initInfiniteCanvasStore,
  listCanvases,
  listDeletedCanvases,
  purgeCanvas,
  restoreCanvas,
  saveCanvas,
  softDeleteCanvas,
} from "./infiniteCanvasStore.js";
import { registerCanvasSiteImageRoutes } from "./canvasSiteImageBridge.js";
import { registerCanvasLlmRoutes } from "./canvasLlmBridge.js";
import { registerCanvasBatchPosterRoutes } from "./canvasBatchPosterBridge.js";
import { registerCanvasReplicaAgentRoutes } from "./canvasReplicaAgentBridge.js";
import { registerCanvasImageRepairAgentRoutes } from "./canvasImageRepairAgentBridge.js";
import {
  deleteUserWorkflowTemplate,
  getWorkflowTemplate,
  initCanvasWorkflowTemplatesStore,
  listWorkflowTemplates,
  saveUserWorkflowTemplate,
} from "./canvasWorkflowTemplates.js";
import { requireSiteGate } from "./siteAccessGate.js";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 80 * 1024 * 1024 } });

function canvasError(res: Response, err: unknown, fallback = "操作失败") {
  const e = err as Error & { status?: number; canvas?: unknown; updated_at?: number };
  if (e.status === 409) {
    return res.status(409).json({
      detail: {
        message: e.message,
        canvas: e.canvas,
        updated_at: e.updated_at,
      },
    });
  }
  const msg = e?.message || fallback;
  const code = /不存在/.test(msg) ? 404 : 400;
  return res.status(code).json({ error: msg, detail: msg });
}

export type InfiniteCanvasRouteDeps = {
  persistImage: (url: string) => Promise<string>;
  /** 与生图/LLM 共用的暗号 Cookie 校验；缺省 requireSiteGate */
  requireGate?: RequestHandler;
};

export function registerInfiniteCanvasRoutes(
  app: Express,
  projectRoot: string,
  deps?: InfiniteCanvasRouteDeps
) {
  initInfiniteCanvasStore(projectRoot);
  initCanvasWorkflowTemplatesStore(projectRoot);
  const gate = deps?.requireGate ?? requireSiteGate;
  console.log(
    "[infinite-canvas] routes ready: /api/canvases, /api/canvas-workflow-templates, /api/canvas-image-tasks, /api/canvas-llm, /api/canvas/batch-poster-brainstorm, /api/canvas/replica-agent-run, /api/canvas/image-repair-agent-run, /api/config (P0 gated)"
  );
  const uploadsDir = path.join(projectRoot, "public", "uploads", "canvas");
  mkdirSync(uploadsDir, { recursive: true });

  app.get("/api/canvases", (_req, res) => {
    res.json({ canvases: listCanvases() });
  });

  app.get("/api/canvases/trash", (_req, res) => {
    res.json({ canvases: listDeletedCanvases(), retention_days: 30 });
  });

  app.post("/api/canvases", (req, res) => {
    try {
      const body = req.body || {};
      const canvas = createCanvas({
        title: body.title,
        icon: body.icon,
        kind: body.kind,
      });
      res.json({ canvas });
    } catch (err) {
      canvasError(res, err, "创建画布失败");
    }
  });

  app.get("/api/canvases/:id/meta", (req, res) => {
    try {
      res.json(getCanvasMeta(req.params.id));
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.get("/api/canvases/:id", (req, res) => {
    try {
      res.json({ canvas: getCanvas(req.params.id) });
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.put("/api/canvases/:id", (req, res) => {
    try {
      const body = req.body || {};
      const canvas = saveCanvas(req.params.id, {
        title: body.title,
        icon: body.icon,
        nodes: body.nodes,
        connections: body.connections,
        viewport: body.viewport,
        logs: body.logs,
        settings: body.settings,
        base_updated_at: body.base_updated_at,
      });
      res.json({ canvas });
    } catch (err) {
      canvasError(res, err, "保存画布失败");
    }
  });

  app.delete("/api/canvases/:id", (req, res) => {
    try {
      res.json(softDeleteCanvas(req.params.id));
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.post("/api/canvases/:id/restore", (req, res) => {
    try {
      res.json({ canvas: restoreCanvas(req.params.id) });
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.delete("/api/canvases/:id/purge", (req, res) => {
    try {
      res.json(purgeCanvas(req.params.id));
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.get("/api/canvas-workflow-templates", (_req, res) => {
    res.json({ templates: listWorkflowTemplates() });
  });

  app.get("/api/canvas-workflow-templates/:id", (req, res) => {
    try {
      res.json({ template: getWorkflowTemplate(req.params.id) });
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.post("/api/canvas-workflow-templates", (req, res) => {
    try {
      const template = saveUserWorkflowTemplate(req.body || {});
      res.json({ template });
    } catch (err) {
      canvasError(res, err, "保存工作流模板失败");
    }
  });

  app.delete("/api/canvas-workflow-templates/:id", (req, res) => {
    try {
      res.json(deleteUserWorkflowTemplate(req.params.id));
    } catch (err) {
      canvasError(res, err);
    }
  });

  /** 画布 API 生成：与主页图片编辑（编辑模式 / GPT 编辑）同一套 /api/edit-image + RunningHub */
  if (deps?.persistImage) {
    registerCanvasSiteImageRoutes(app, { projectRoot, persistImage: deps.persistImage, requireGate: gate });
  } else {
    registerCanvasSiteImageRoutes(app, {
      projectRoot,
      persistImage: async (url) => url,
      requireGate: gate,
    });
  }

  registerCanvasLlmRoutes(app, projectRoot, gate);
  registerCanvasBatchPosterRoutes(app, projectRoot, gate);

  if (deps?.persistImage) {
    registerCanvasReplicaAgentRoutes(app, { projectRoot, persistImage: deps.persistImage, requireGate: gate });
    registerCanvasImageRepairAgentRoutes(app, { projectRoot, persistImage: deps.persistImage, requireGate: gate });
  } else {
    registerCanvasReplicaAgentRoutes(app, {
      projectRoot,
      persistImage: async (url) => url,
      requireGate: gate,
    });
    registerCanvasImageRepairAgentRoutes(app, {
      projectRoot,
      persistImage: async (url) => url,
      requireGate: gate,
    });
  }

  /** 画布前端 loadConfig（模型列表与 .env 一致） */
  app.get("/api/config", (_req, res) => {
    const defaultImage = (process.env.IMAGE_MODEL || "nano-banana-pro-稳定").trim();
    const editModel = (process.env.IMAGE_EDIT_MODEL || "").trim();
    const imageModels = Array.from(
      new Set([defaultImage, editModel, "gpt-image-2", "nano-banana-pro", "nano-banana-pro-稳定", "midjourneyV8.1", "niji7"].filter(Boolean))
    );
    const chatModels = Array.from(
      new Set(
        [
          (process.env.TEXT_MODEL || "").trim(),
          "gemini-3.5-flash",
          "glm-5.1",
          "gemini-3.1-pro-preview",
          "gemini-1.5-pro-preview-05-08",
          "gpt-4o-mini",
        ].filter(Boolean)
      )
    );
    res.json({
      base_url: process.env.THIRD_PARTY_API_BASE || "",
      chat_model: chatModels[0],
      image_model: imageModels[0],
      chat_models: chatModels,
      image_models: imageModels,
      video_models: [],
      comfy_instances: [],
      api_providers: [
        {
          id: "runninghub",
          name: "RunningHub",
          label: "RunningHub",
          image_models: imageModels,
        },
      ],
      has_api_key: Boolean(
        process.env.STORYBOARD_IMAGE_API_KEY?.trim() || process.env.THIRD_PARTY_API_KEY?.trim()
      ),
      ms_chat_models: [],
      has_ms_key: false,
    });
  });

  app.get("/api/workflows", (_req, res) => {
    res.json({ workflows: [] });
  });

  app.post("/api/canvas-assets/check", gate, (req, res) => {
    const urls: string[] = Array.isArray(req.body?.urls) ? req.body.urls : [];
    const exists: Record<string, boolean> = {};
    for (const url of urls.slice(0, 3000)) {
      const text = String(url || "").trim();
      if (!text) continue;
      if (text.startsWith("/uploads/")) {
        const rel = text.replace(/^\/uploads\//, "").replace(/\\/g, "/");
        exists[text] = existsSync(path.join(projectRoot, "public", "uploads", rel));
      } else {
        exists[text] = true;
      }
    }
    res.json({ exists });
  });

  app.post("/api/ai/upload", gate, upload.array("files"), (req, res) => {
    const files = (req.files as Express.Multer.File[]) || [];
    const uploaded: { url: string; name: string; kind: string }[] = [];
    for (const file of files) {
      if (!file?.buffer?.length) continue;
      const mime = (file.mimetype || "").toLowerCase();
      let kind = "image";
      let ext = path.extname(file.originalname || "").toLowerCase();
      if (mime.startsWith("video/") || [".mp4", ".webm", ".mov", ".m4v"].includes(ext)) {
        kind = "video";
        if (!ext) ext = ".mp4";
      } else if (mime.startsWith("audio/") || [".mp3", ".wav", ".m4a", ".aac", ".ogg"].includes(ext)) {
        kind = "audio";
        if (!ext) ext = ".mp3";
      } else {
        if (!ext || ![".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) ext = ".png";
      }
      const filename = `canvas_${uuidv4().replace(/-/g, "").slice(0, 12)}${ext}`;
      const abs = path.join(uploadsDir, filename);
      writeFileSync(abs, file.buffer);
      uploaded.push({
        url: `/uploads/canvas/${filename}`,
        name: file.originalname || filename,
        kind,
      });
    }
    res.json({ files: uploaded });
  });

  /** 视频 / Comfy / LLM 等：尚未接入本站 */
  const aiStub = (_req: Request, res: Response) => {
    res.status(501).json({
      error: "该节点 API 尚未接入本站后端，可在 .env 配置 CANVAS_API_ORIGIN 转发到原 Python 服务。",
    });
  };
  app.post("/api/canvas-video", gate, aiStub);
  app.post("/api/generate", gate, aiStub);
  app.post("/api/upload", gate, aiStub);
}
