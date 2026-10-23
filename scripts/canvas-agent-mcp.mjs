#!/usr/bin/env node
/**
 * DreamGrid Canvas Agent 的 MCP 服务（stdio）。
 *
 * 外部 Agent 不直接碰画布，只建作业、查作业、读项目记忆；
 * 真正的编排留在服务端，和浏览器入口走同一套接口与权限。
 *
 * 环境变量：
 *   CANVAS_AGENT_BASE_URL  默认 http://127.0.0.1:3005
 *   CANVAS_AGENT_KEY       Agent Key（网页 /api/canvas-agent/keys 生成）
 */
import { createInterface } from "node:readline";

const BASE = String(process.env.CANVAS_AGENT_BASE_URL || "http://127.0.0.1:3005").replace(/\/+$/, "");
const KEY = String(process.env.CANVAS_AGENT_KEY || "").trim();

const TOOLS = [
  {
    name: "canvas_agent_job_create",
    description:
      "Create one canvas-agent job for a conversation. Returns a job id you can poll. "
      + "The browser tab is not required; execution steps are acknowledged by a client later.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        message: { type: "string" },
      },
      required: ["conversationId"],
      additionalProperties: false,
    },
  },
  {
    name: "canvas_agent_job_status",
    description: "Read one job: status, step/step_total, observations, error.",
    inputSchema: {
      type: "object",
      properties: { jobId: { type: "string" } },
      required: ["jobId"],
      additionalProperties: false,
    },
  },
  {
    name: "canvas_agent_jobs_list",
    description: "List jobs for a conversation, optionally only the unfinished ones.",
    inputSchema: {
      type: "object",
      properties: {
        conversationId: { type: "string" },
        activeOnly: { type: "boolean" },
      },
      required: ["conversationId"],
      additionalProperties: false,
    },
  },
  {
    name: "canvas_agent_memory_list",
    description: "List project memory (facts and preferences) for a canvas.",
    inputSchema: {
      type: "object",
      properties: { canvasId: { type: "string" }, limit: { type: "number" } },
      required: ["canvasId"],
      additionalProperties: false,
    },
  },
];

async function callApi(path, init = {}) {
  if (!KEY) throw new Error("缺少 CANVAS_AGENT_KEY");
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${KEY}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  if (!response.ok) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

async function runTool(name, args) {
  if (name === "canvas_agent_job_create") {
    return callApi("/api/canvas-agent/jobs", {
      method: "POST",
      body: JSON.stringify({
        conversationId: args?.conversationId,
        message: args?.message || "",
        source: "mcp",
      }),
    });
  }
  if (name === "canvas_agent_job_status") {
    return callApi(`/api/canvas-agent/jobs/${encodeURIComponent(args?.jobId || "")}`);
  }
  if (name === "canvas_agent_jobs_list") {
    const query = `conversation_id=${encodeURIComponent(args?.conversationId || "")}${args?.activeOnly ? "&active=1" : ""}`;
    return callApi(`/api/canvas-agent/jobs?${query}`);
  }
  if (name === "canvas_agent_memory_list") {
    const query = `canvas_id=${encodeURIComponent(args?.canvasId || "")}&limit=${Number(args?.limit) || 20}`;
    return callApi(`/api/canvas-agent/memory?${query}`);
  }
  throw new Error(`未知工具：${name}`);
}

function send(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function handle(message) {
  const { id, method, params } = message;
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "dreamgrid-canvas-agent", version: "1.0.0" },
      },
    };
  }
  if (method === "notifications/initialized" || method === "initialized") return null;
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    try {
      const result = await runTool(params?.name, params?.arguments || {});
      return {
        jsonrpc: "2.0",
        id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      };
    } catch (error) {
      return {
        jsonrpc: "2.0",
        id,
        result: {
          content: [{ type: "text", text: `错误：${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        },
      };
    }
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let message = null;
  try {
    message = JSON.parse(trimmed);
  } catch {
    send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const response = await handle(message);
  if (response) send(response);
});
