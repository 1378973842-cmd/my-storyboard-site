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
  type CanvasAccessContext,
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
import {
  addCanvasToCollection,
  createCanvasCollection,
  deleteCanvasCollection,
  initCanvasCollectionsStore,
  listCanvasCollections,
  pruneCanvasFromAllCollections,
  removeCanvasFromCollection,
  updateCanvasCollection,
} from "./canvasCollectionsStore.js";
import { requireSiteGate } from "./siteAccessGate.js";
import { recordFileOwnership } from "./canvasGenerations.js";
import type Database from "better-sqlite3";

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
  const code =
    e.status === 403 ? 403 : e.status === 401 ? 401 : /不存在/.test(msg) ? 404 : 400;
  return res.status(code).json({ error: msg, detail: msg });
}

function canvasAccessCtx(req: Request): CanvasAccessContext | null {
  const u = req.authUser;
  if (!u) return null;
  return { userId: u.id, isAdmin: u.role === "admin" };
}

export type PersistImageMeta = { userId?: string };

export type InfiniteCanvasRouteDeps = {
  persistImage: (url: string, meta?: PersistImageMeta) => Promise<string>;
  /** 与生图/LLM 共用的登录 Cookie 校验；缺省 requireSiteGate（仅独立画布服务） */
  requireGate?: RequestHandler;
  db?: InstanceType<typeof Database>;
};

export function registerInfiniteCanvasRoutes(
  app: Express,
  projectRoot: string,
  deps?: InfiniteCanvasRouteDeps
) {
  initInfiniteCanvasStore(projectRoot);
  initCanvasWorkflowTemplatesStore(projectRoot);
  initCanvasCollectionsStore(projectRoot);
  const gate = deps?.requireGate ?? requireSiteGate;
  console.log(
    "[infinite-canvas] routes ready: /api/canvases, /api/canvas-collections, /api/canvas-workflow-templates, /api/config (login required)"
  );
  const uploadsDir = path.join(projectRoot, "public", "uploads", "canvas");
  mkdirSync(uploadsDir, { recursive: true });

  app.get("/api/canvases", gate, (req, res) => {
    res.json({ canvases: listCanvases(canvasAccessCtx(req)) });
  });

  app.get("/api/canvases/trash", gate, (req, res) => {
    res.json({ canvases: listDeletedCanvases(canvasAccessCtx(req)), retention_days: 30 });
  });

  app.post("/api/canvases", gate, (req, res) => {
    try {
      const body = req.body || {};
      const canvas = createCanvas(
        {
          title: body.title,
          icon: body.icon,
          kind: body.kind,
        },
        canvasAccessCtx(req)
      );
      res.json({ canvas });
    } catch (err) {
      canvasError(res, err, "创建画布失败");
    }
  });

  app.get("/api/canvases/:id/meta", gate, (req, res) => {
    try {
      res.json(getCanvasMeta(req.params.id, canvasAccessCtx(req)));
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.get("/api/canvases/:id", gate, (req, res) => {
    try {
      res.json({ canvas: getCanvas(req.params.id, false, canvasAccessCtx(req)) });
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.put("/api/canvases/:id", gate, (req, res) => {
    try {
      const body = req.body || {};
      const canvas = saveCanvas(
        req.params.id,
        {
          title: body.title,
          icon: body.icon,
          nodes: body.nodes,
          connections: body.connections,
          viewport: body.viewport,
          logs: body.logs,
          settings: body.settings,
          base_updated_at: body.base_updated_at,
        },
        canvasAccessCtx(req)
      );
      res.json({ canvas });
    } catch (err) {
      canvasError(res, err, "保存画布失败");
    }
  });

  app.delete("/api/canvases/:id", gate, (req, res) => {
    try {
      const result = softDeleteCanvas(req.params.id, canvasAccessCtx(req));
      pruneCanvasFromAllCollections(req.params.id, canvasAccessCtx(req));
      res.json(result);
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.post("/api/canvases/:id/restore", gate, (req, res) => {
    try {
      res.json({ canvas: restoreCanvas(req.params.id, canvasAccessCtx(req)) });
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.delete("/api/canvases/:id/purge", gate, (req, res) => {
    try {
      const result = purgeCanvas(req.params.id, canvasAccessCtx(req));
      pruneCanvasFromAllCollections(req.params.id, canvasAccessCtx(req));
      res.json(result);
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.get("/api/canvas-collections", gate, (req, res) => {
    try {
      res.json({ collections: listCanvasCollections(canvasAccessCtx(req)) });
    } catch (err) {
      canvasError(res, err, "加载合集失败");
    }
  });

  app.post("/api/canvas-collections", gate, (req, res) => {
    try {
      const body = req.body || {};
      const collection = createCanvasCollection(
        { name: body.name, canvas_ids: body.canvas_ids },
        canvasAccessCtx(req)
      );
      res.status(201).json({ collection });
    } catch (err) {
      canvasError(res, err, "创建合集失败");
    }
  });

  app.patch("/api/canvas-collections/:id", gate, (req, res) => {
    try {
      const body = req.body || {};
      const collection = updateCanvasCollection(
        req.params.id,
        { name: body.name, canvas_ids: body.canvas_ids },
        canvasAccessCtx(req)
      );
      res.json({ collection });
    } catch (err) {
      canvasError(res, err, "更新合集失败");
    }
  });

  app.delete("/api/canvas-collections/:id", gate, (req, res) => {
    try {
      res.json(deleteCanvasCollection(req.params.id, canvasAccessCtx(req)));
    } catch (err) {
      canvasError(res, err, "删除合集失败");
    }
  });

  app.post("/api/canvas-collections/:id/canvases", gate, (req, res) => {
    try {
      const canvasId = String((req.body || {}).canvas_id || "");
      const collection = addCanvasToCollection(req.params.id, canvasId, canvasAccessCtx(req));
      res.json({ collection });
    } catch (err) {
      canvasError(res, err, "加入合集失败");
    }
  });

  app.delete("/api/canvas-collections/:id/canvases/:canvasId", gate, (req, res) => {
    try {
      const collection = removeCanvasFromCollection(
        req.params.id,
        req.params.canvasId,
        canvasAccessCtx(req)
      );
      res.json({ collection });
    } catch (err) {
      canvasError(res, err, "移出合集失败");
    }
  });

  app.get("/api/canvas-workflow-templates", gate, (_req, res) => {
    res.json({ templates: listWorkflowTemplates() });
  });

  app.get("/api/canvas-workflow-templates/:id", gate, (req, res) => {
    try {
      res.json({ template: getWorkflowTemplate(req.params.id) });
    } catch (err) {
      canvasError(res, err);
    }
  });

  app.post("/api/canvas-workflow-templates", gate, (req, res) => {
    try {
      const template = saveUserWorkflowTemplate(req.body || {});
      res.json({ template });
    } catch (err) {
      canvasError(res, err, "保存工作流模板失败");
    }
  });

  app.delete("/api/canvas-workflow-templates/:id", gate, (req, res) => {
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
  app.get("/api/config", gate, (_req, res) => {
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

  app.get("/api/workflows", gate, (_req, res) => {
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
    const userId = req.authUser?.id;
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
      const url = `/uploads/canvas/${filename}`;
      if (userId && deps?.db) recordFileOwnership(deps.db, url, userId);
      uploaded.push({
        url,
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
