import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";

export type WorkflowTemplateRecord = {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: string;
  builtin: boolean;
  created_at: number;
  updated_at: number;
  nodes: unknown[];
  connections: Array<{ from: string; to: string }>;
  roleTemplate?: Record<string, "background" | "character">;
};

let templatesDir = "";

const BUILTIN_TEMPLATES: WorkflowTemplateRecord[] = [
  {
    id: "replica-batch-parallel",
    title: "批量复刻（并发）",
    description: "图集 → 循环(并发) → 复刻 Agent → Output，另接角色参考图。适合多关键帧 + 固定角色。",
    icon: "bot",
    category: "replica",
    builtin: true,
    created_at: 0,
    updated_at: 0,
    roleTemplate: { character: "character" },
    nodes: [
      {
        id: "tk_group",
        templateKey: "keyframes",
        type: "group",
        x: 80,
        y: 120,
        w: 300,
        h: 220,
        items: [],
      },
      {
        id: "tk_loop",
        templateKey: "loop",
        type: "loop",
        x: 460,
        y: 120,
        count: 5,
        mode: "parallel",
        showPrompt: false,
        imageInput: true,
        imageBatchSize: 1,
        loopStart: 1,
        variablePrompt: "",
        fixedPrompt: "",
      },
      {
        id: "tk_char",
        templateKey: "character",
        type: "image",
        x: 460,
        y: 420,
        url: "",
        name: "角色参考图",
      },
      {
        id: "tk_agent",
        templateKey: "agent",
        type: "replicaAgent",
        x: 860,
        y: 120,
        w: 320,
        h: 480,
        style_prompt: "",
        ratio: "story",
        resolution: "2k",
        customRatio: "",
        customRatioWidth: "",
        customRatioHeight: "",
        roles: {},
        inputs: [],
        runStatus: "idle",
      },
      {
        id: "tk_out",
        templateKey: "output",
        type: "output",
        x: 1260,
        y: 120,
        images: [],
      },
    ],
    connections: [
      { from: "tk_group", to: "tk_loop" },
      { from: "tk_loop", to: "tk_agent" },
      { from: "tk_char", to: "tk_agent" },
      { from: "tk_agent", to: "tk_out" },
    ],
  },
  {
    id: "replica-batch-serial",
    title: "批量复刻（串行）",
    description: "与并发版相同，但循环为串行排队，适合 API 限流或逐帧排查。",
    icon: "repeat-2",
    category: "replica",
    builtin: true,
    created_at: 0,
    updated_at: 0,
    roleTemplate: { character: "character" },
    nodes: [
      {
        id: "tk_group",
        templateKey: "keyframes",
        type: "group",
        x: 80,
        y: 120,
        w: 300,
        h: 220,
        items: [],
      },
      {
        id: "tk_loop",
        templateKey: "loop",
        type: "loop",
        x: 460,
        y: 120,
        count: 5,
        mode: "serial",
        showPrompt: false,
        imageInput: true,
        imageBatchSize: 1,
        loopStart: 1,
        variablePrompt: "",
        fixedPrompt: "",
      },
      {
        id: "tk_char",
        templateKey: "character",
        type: "image",
        x: 460,
        y: 420,
        url: "",
        name: "角色参考图",
      },
      {
        id: "tk_agent",
        templateKey: "agent",
        type: "replicaAgent",
        x: 860,
        y: 120,
        w: 320,
        h: 480,
        style_prompt: "",
        ratio: "story",
        resolution: "2k",
        customRatio: "",
        customRatioWidth: "",
        customRatioHeight: "",
        roles: {},
        inputs: [],
        runStatus: "idle",
      },
      {
        id: "tk_out",
        templateKey: "output",
        type: "output",
        x: 1260,
        y: 120,
        images: [],
      },
    ],
    connections: [
      { from: "tk_group", to: "tk_loop" },
      { from: "tk_loop", to: "tk_agent" },
      { from: "tk_char", to: "tk_agent" },
      { from: "tk_agent", to: "tk_out" },
    ],
  },
  {
    id: "replica-video-batch-parallel",
    title: "视频截帧 → 批量复刻（并发）",
    description:
      "上传视频 → 截帧集 → 循环(并发) → 复刻 Agent → Output，另接角色参考图。上传视频后在视频卡片里点「截取当前帧」收集关键帧。",
    icon: "clapperboard",
    category: "replica",
    builtin: true,
    created_at: 0,
    updated_at: 0,
    roleTemplate: { character: "character" },
    nodes: [
      {
        id: "tk_video",
        templateKey: "video",
        type: "image",
        x: 40,
        y: 140,
        url: "",
        name: "上传视频",
      },
      {
        id: "tk_stack",
        templateKey: "frames",
        type: "frameStack",
        x: 360,
        y: 140,
        images: [],
        sourceVideoId: "tk_video",
      },
      {
        id: "tk_loop",
        templateKey: "loop",
        type: "loop",
        x: 720,
        y: 140,
        count: 5,
        mode: "parallel",
        showPrompt: false,
        imageInput: true,
        imageBatchSize: 1,
        loopStart: 1,
        variablePrompt: "",
        fixedPrompt: "",
      },
      {
        id: "tk_char",
        templateKey: "character",
        type: "image",
        x: 720,
        y: 430,
        url: "",
        name: "角色参考图",
      },
      {
        id: "tk_agent",
        templateKey: "agent",
        type: "replicaAgent",
        x: 1080,
        y: 140,
        w: 320,
        h: 480,
        style_prompt: "",
        ratio: "story",
        resolution: "2k",
        customRatio: "",
        customRatioWidth: "",
        customRatioHeight: "",
        roles: {},
        inputs: [],
        runStatus: "idle",
      },
      {
        id: "tk_out",
        templateKey: "output",
        type: "output",
        x: 1460,
        y: 140,
        images: [],
      },
    ],
    connections: [
      { from: "tk_video", to: "tk_stack" },
      { from: "tk_stack", to: "tk_loop" },
      { from: "tk_loop", to: "tk_agent" },
      { from: "tk_char", to: "tk_agent" },
      { from: "tk_agent", to: "tk_out" },
    ],
  },
  {
    id: "replica-single",
    title: "单帧复刻",
    description: "一张关键帧 + 可选角色参考 → 复刻 Agent → Output。",
    icon: "image",
    category: "replica",
    builtin: true,
    created_at: 0,
    updated_at: 0,
    roleTemplate: { keyframe: "background", character: "character" },
    nodes: [
      {
        id: "tk_key",
        templateKey: "keyframe",
        type: "image",
        x: 120,
        y: 160,
        url: "",
        name: "关键帧",
      },
      {
        id: "tk_char",
        templateKey: "character",
        type: "image",
        x: 120,
        y: 420,
        url: "",
        name: "角色参考图",
      },
      {
        id: "tk_agent",
        templateKey: "agent",
        type: "replicaAgent",
        x: 520,
        y: 160,
        w: 320,
        h: 480,
        style_prompt: "",
        ratio: "story",
        resolution: "2k",
        customRatio: "",
        customRatioWidth: "",
        customRatioHeight: "",
        roles: {},
        inputs: [],
        runStatus: "idle",
      },
      {
        id: "tk_out",
        templateKey: "output",
        type: "output",
        x: 920,
        y: 160,
        images: [],
      },
    ],
    connections: [
      { from: "tk_key", to: "tk_agent" },
      { from: "tk_char", to: "tk_agent" },
      { from: "tk_agent", to: "tk_out" },
    ],
  },
];

export function initCanvasWorkflowTemplatesStore(projectRoot: string) {
  templatesDir = path.join(projectRoot, "data", "canvas-workflow-templates");
  mkdirSync(templatesDir, { recursive: true });
}

function sanitizeTemplateId(id: string) {
  const cleaned = String(id || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!cleaned) throw new Error("无效的模板 ID");
  return cleaned;
}

function templatePath(id: string) {
  return path.join(templatesDir, `${sanitizeTemplateId(id)}.json`);
}

function readUserTemplate(id: string): WorkflowTemplateRecord | null {
  const fp = templatePath(id);
  if (!existsSync(fp)) return null;
  try {
    return JSON.parse(readFileSync(fp, "utf8")) as WorkflowTemplateRecord;
  } catch {
    return null;
  }
}

function writeUserTemplate(doc: WorkflowTemplateRecord) {
  writeFileSync(templatePath(doc.id), JSON.stringify(doc, null, 2), "utf8");
}

function toListItem(doc: WorkflowTemplateRecord) {
  return {
    id: doc.id,
    title: doc.title,
    description: doc.description,
    icon: doc.icon || "workflow",
    category: doc.category || "custom",
    builtin: Boolean(doc.builtin),
    created_at: doc.created_at || 0,
    updated_at: doc.updated_at || 0,
    node_count: Array.isArray(doc.nodes) ? doc.nodes.length : 0,
    connection_count: Array.isArray(doc.connections) ? doc.connections.length : 0,
  };
}

export function listWorkflowTemplates() {
  const builtin = BUILTIN_TEMPLATES.map(toListItem);
  const user: ReturnType<typeof toListItem>[] = [];
  if (!templatesDir || !existsSync(templatesDir)) return [...builtin, ...user];
  for (const name of readdirSync(templatesDir)) {
    if (!name.endsWith(".json")) continue;
    const doc = readUserTemplate(name.replace(/\.json$/, ""));
    if (!doc || doc.builtin) continue;
    user.push(toListItem(doc));
  }
  return [...builtin, ...user.sort((a, b) => b.updated_at - a.updated_at)];
}

export function getWorkflowTemplate(id: string): WorkflowTemplateRecord {
  const builtin = BUILTIN_TEMPLATES.find((t) => t.id === id);
  if (builtin) return JSON.parse(JSON.stringify(builtin)) as WorkflowTemplateRecord;
  const user = readUserTemplate(id);
  if (!user) throw new Error("工作流模板不存在");
  return user;
}

export function saveUserWorkflowTemplate(payload: {
  title?: string;
  description?: string;
  icon?: string;
  nodes?: unknown[];
  connections?: Array<{ from: string; to: string }>;
  roleTemplate?: Record<string, "background" | "character">;
}) {
  const now = Date.now();
  const id = `wf_${uuidv4().replace(/-/g, "").slice(0, 12)}`;
  const doc: WorkflowTemplateRecord = {
    id,
    title: String(payload.title || "我的工作流").slice(0, 80),
    description: String(payload.description || "").slice(0, 240),
    icon: String(payload.icon || "workflow").slice(0, 32),
    category: "custom",
    builtin: false,
    created_at: now,
    updated_at: now,
    nodes: Array.isArray(payload.nodes) ? payload.nodes : [],
    connections: Array.isArray(payload.connections) ? payload.connections : [],
    roleTemplate: payload.roleTemplate,
  };
  writeUserTemplate(doc);
  return doc;
}

export function deleteUserWorkflowTemplate(id: string) {
  if (BUILTIN_TEMPLATES.some((t) => t.id === id)) throw new Error("内置模板不可删除");
  const fp = templatePath(id);
  if (!existsSync(fp)) throw new Error("工作流模板不存在");
  unlinkSync(fp);
  return { ok: true as const };
}
