/**
 * RunningHub 自定义工作流 / AI 应用管理页共用类型与纯函数（供 AdminRunningHubWorkflowsPage 及后续
 * 图形编辑器/字段编辑器/实时预览子组件复用）。逻辑对齐旧版 canvas_source/static/js/api-settings.js。
 */

export type RhFieldType = "TEXT" | "NUMBER" | "BOOLEAN" | "SELECT" | "IMAGE" | "VIDEO" | "AUDIO";

export type RhField = {
  id: string;
  nodeId: string;
  fieldName: string;
  fieldValue: string;
  fieldType: string;
  label: string;
  enabled: boolean;
  sourceFromUpstream: boolean;
  group: string;
  note: string;
  options: string[];
  random_enabled: boolean;
  min: string | number;
  max: string | number;
  step: string | number;
  imageOrder: number;
  required: boolean;
  /** 测试面板里用户可拖拽自定义的显示顺序，越小越靠前；未设置时按字段原始顺序展示。 */
  order: number;
};

export type RhWorkflowSummary = {
  workflowId: string;
  title: string;
  description: string;
  fieldCount: number;
  updatedAt: number;
};

export type RhAppSummary = {
  appId: string;
  title: string;
  description: string;
  fieldCount: number;
  updatedAt: number;
};

export type RhWorkflowConfig = {
  workflowId: string;
  title: string;
  description: string;
  fields: RhField[];
  workflowJson: Record<string, unknown>;
  optionalImageMode: string;
  raw: unknown;
  updatedAt: number;
};

export type RhAppConfig = {
  appId: string;
  title: string;
  description: string;
  fields: RhField[];
  raw: unknown;
  updatedAt: number;
};

/** RunningHub/ComfyUI 原始字段类型里数字常以 FLOAT/INT/INTEGER 出现，统一归到 NUMBER，对齐旧版 rhWorkflowFieldKind。 */
export function rhWorkflowFieldKind(field: Pick<RhField, "fieldType">): string {
  const type = String(field?.fieldType || "").toUpperCase();
  if (type === "FLOAT" || type === "INT" || type === "INTEGER") return "NUMBER";
  if (type === "STRING" || type === "PROMPT") return "TEXT";
  return type;
}

export function rhWorkflowFieldKey(field: Pick<RhField, "nodeId" | "fieldName">): string {
  return `${field?.nodeId || ""}::${field?.fieldName || ""}`;
}

/** RunningHub / 本站 API 的 error、msg、failReason 有时是嵌套对象，统一压成可读字符串，避免 UI 弹出 [object Object]。 */
export function formatRhApiError(value: unknown, fallback = '操作失败'): string {
  if (value == null || value === '') return fallback;
  if (typeof value === 'string') {
    const text = value.trim();
    return text || fallback;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return value.message.trim() || fallback;
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    for (const key of ['errorMessage', 'error_message', 'message', 'msg', 'error', 'failReason', 'failedReason', 'detail', 'reason']) {
      if (obj[key] != null) {
        // 空对象 {} 不当成有效错误文案
        if (typeof obj[key] === 'object' && !Array.isArray(obj[key]) && !Object.keys(obj[key] as object).length) {
          continue;
        }
        const nested = formatRhApiError(obj[key], '');
        if (nested && nested !== '{}' && nested !== '[]') return nested;
      }
    }
    const code = obj.errorCode ?? obj.error_code ?? obj.code;
    if (code != null && String(code).trim()) {
      return `错误码 ${String(code).trim()}`;
    }
    try {
      const json = JSON.stringify(value);
      return json.length > 320 ? `${json.slice(0, 320)}…` : json;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

/** 提交 RunningHub 时 fieldValue 必须是字符串；数字/布尔也要显式转成文本。 */
export function rhSubmitFieldValue(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

function extractComfyErrorObj(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (obj.node_name || obj.nodeName) return obj;
  }
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text.startsWith('{')) return null;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (parsed?.node_name || parsed?.nodeName) return parsed;
    } catch {
      return null;
    }
  }
  return null;
}

/** 把 RunningHub/ComfyUI 任务失败返回的 JSON 错误压成导演能看懂的一行摘要。 */
export function summarizeRhTaskError(raw: unknown): string {
  const obj = extractComfyErrorObj(raw);
  if (obj) {
    const node = String(obj.node_name || obj.nodeName || '').trim();
    const inputs = obj.current_inputs ?? obj.currentInputs;
    const inputsEmpty =
      inputs == null ||
      inputs === '' ||
      inputs === '{}' ||
      (typeof inputs === 'object' && !Array.isArray(inputs) && !Object.keys(inputs as object).length);
    if (inputsEmpty) {
      return `RunningHub 节点「${node}」没有收到输入。请确认测试面板里所有图片/视频都已上传完成，且左侧对应参数已勾选启用。`;
    }
    const type = String(obj.exception_type || obj.exceptionType || 'Error').trim();
    return `RunningHub 节点「${node}」执行失败（${type}）。`;
  }
  const text = formatRhApiError(raw, '');
  return text || 'RunningHub 任务失败';
}

/** 对齐旧版 rhPreviewRandomValue：种子类字段默认走大范围整数，其余字段走 min/max（或 0-999999）。 */
export function rhPreviewRandomValue(field: Pick<RhField, "fieldName" | "label" | "min" | "max" | "step">): number {
  const step = Number(field.step);
  const isFloat = step > 0 && step < 1;
  let min = Number.isFinite(Number(field.min)) ? Number(field.min) : null;
  let max = Number.isFinite(Number(field.max)) ? Number(field.max) : null;
  const name = `${field.fieldName || ""} ${field.label || ""}`.toLowerCase();
  const looksSeed = name.includes("seed") || name.includes("noise") || name.includes("随机") || name.includes("种子");
  if (min === null) min = looksSeed ? 1 : 0;
  if (max === null || max <= min) max = looksSeed ? 1_000_000_000_000_000 : 999_999;
  const value = min + Math.random() * (max - min);
  if (isFloat) {
    const precision = Math.min(8, Math.max(1, String(field.step).split(".")[1]?.length || 2));
    return Number(value.toFixed(precision));
  }
  return Math.floor(value);
}

/** 粘贴 /run/ai-app/xxx、/run/workflow/xxx 或纯数字 workflowId 时自动识别类型 */
export function parseRunningHubRunRef(value: string): { type: "app" | "workflow"; id: string } | null {
  const text = String(value || "").trim();
  const match = /\/run\/(ai-app|workflow)\/([0-9A-Za-z_-]+)/i.exec(text);
  if (match) return { type: match[1].toLowerCase() === "ai-app" ? "app" : "workflow", id: match[2] };
  if (/^[0-9]{6,}$/.test(text)) return { type: "workflow", id: text };
  if (/^[0-9A-Za-z_-]{6,}$/.test(text)) return { type: "app", id: text };
  return null;
}

export function emptyRhField(overrides: Partial<RhField> = {}): RhField {
  return {
    id: "",
    nodeId: "",
    fieldName: "",
    fieldValue: "",
    fieldType: "TEXT",
    label: "",
    enabled: true,
    sourceFromUpstream: true,
    group: "",
    note: "",
    options: [],
    random_enabled: false,
    min: "",
    max: "",
    step: "",
    imageOrder: 0,
    required: false,
    order: 0,
    ...overrides,
  };
}

export function normalizeRhField(raw: unknown): RhField {
  const src = (raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const rawOptions = src.options;
  const options = Array.isArray(rawOptions)
    ? rawOptions.map((o) => String(o ?? "").trim()).filter(Boolean)
    : String(rawOptions || "")
        .split(/\r?\n|,/)
        .map((o) => o.trim())
        .filter(Boolean);
  const fieldName = String(src.fieldName || "");
  let fieldType = String(src.fieldType || (options.length ? "SELECT" : "TEXT"));
  // 治愈：prompt 类字段曾被默认值文案误判成 IMAGE/VIDEO/AUDIO
  if (isLikelyTextFieldName(fieldName) && ["IMAGE", "VIDEO", "AUDIO"].includes(fieldType.toUpperCase())) {
    fieldType = "TEXT";
  }
  // 有选项列表时按 SELECT 暴露（避免管理台已填选项仍显示成文本）
  if (options.length && ["TEXT", "STRING", "PROMPT", ""].includes(fieldType.toUpperCase())) {
    fieldType = "SELECT";
  }
  return emptyRhField({
    id: String(src.id || `${src.nodeId || ""}::${fieldName}`),
    nodeId: String(src.nodeId || ""),
    fieldName,
    fieldValue: src.fieldValue == null ? "" : String(src.fieldValue),
    fieldType,
    label: String(src.label || src.fieldName || ""),
    enabled: src.enabled === true,
    sourceFromUpstream: src.sourceFromUpstream !== false,
    group: String(src.group || ""),
    note: String(src.note || ""),
    options,
    random_enabled: src.random_enabled === true,
    min: (src.min ?? "") as string | number,
    max: (src.max ?? "") as string | number,
    step: (src.step ?? "") as string | number,
    imageOrder: Number(src.imageOrder || 0) || 0,
    required: src.required === true,
    order: Number(src.order ?? 0) || 0,
  });
}

/** AI 应用 app-info 原始返回结构五花八门，按已知字段名依次尝试取出参数列表 */
function rhAppFieldSourceList(raw: unknown): unknown[] {
  const data = (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)
    ? (raw as Record<string, unknown>).data
    : raw) as Record<string, unknown> | undefined;
  const candidates = [
    data?.nodeInfoList,
    data?.fields,
    data?.inputs,
    data?.inputList,
    data?.formItems,
    data?.forms,
    data?.params,
    data?.parameters,
    data?.apiParams,
    (data?.config as Record<string, unknown> | undefined)?.fields,
    (data?.webapp as Record<string, unknown> | undefined)?.fields,
    (data?.webapp as Record<string, unknown> | undefined)?.inputs,
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
    if (candidate && typeof candidate === "object" && Object.keys(candidate).length) {
      return Object.entries(candidate).map(([key, value]) => ({ fieldName: key, fieldValue: value }));
    }
  }
  return [];
}

function extractRhFieldOptions(field: Record<string, unknown>): string[] {
  const candidates = [
    field?.options,
    field?.optionList,
    field?.values,
    field?.enum,
    field?.choices,
    field?.items,
    field?.list,
    field?.selectOptions,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate) || !candidate.length) continue;
    return candidate
      .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>).value ?? (item as Record<string, unknown>).label ?? (item as Record<string, unknown>).name : item))
      .filter((item) => item !== undefined && item !== null)
      .map(String);
  }
  return [];
}

function isLikelyTextFieldName(fieldName: string): boolean {
  const name = String(fieldName || "").trim().toLowerCase();
  if (!name) return false;
  if (/^(prompt|text|string|negative|positive|caption|description|content|query|instruction|system|user|note|msg|message)$/.test(name)) {
    return true;
  }
  if (/(^|_)(prompt|text|caption|description|content)(_|$)/.test(name)) return true;
  if (/提示词|文案|描述|内容|文本/.test(String(fieldName || ""))) return true;
  return false;
}

function isPlainNumberValue(fieldValue: string): boolean {
  const value = String(fieldValue || "").trim();
  return Boolean(value) && value.length <= 12 && /^-?\d+(\.\d+)?$/.test(value) && !Number.isNaN(Number(value));
}

function inferFieldTypeFromNameValue(fieldName: string, fieldValue: string): RhFieldType {
  const value = String(fieldValue || "").trim();
  if (isLikelyTextFieldName(fieldName)) {
    if (/^(true|false)$/i.test(value)) return "BOOLEAN";
    if (isPlainNumberValue(value)) return "NUMBER";
    return "TEXT";
  }
  const name = String(fieldName || "").toLowerCase();
  if (/\b(image|img|mask|photo|picture)\b/.test(name) || /\.(png|jpe?g|webp|gif|bmp)(\?|$)/i.test(value)) return "IMAGE";
  if (/\b(video|movie|mp4)\b/.test(name) || /\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(value)) return "VIDEO";
  if (/\b(audio|sound|music|voice)\b/.test(name) || /\.(mp3|wav|ogg|m4a|flac|aac)(\?|$)/i.test(value)) return "AUDIO";
  if (/^(true|false)$/i.test(value)) return "BOOLEAN";
  if (isPlainNumberValue(value)) return "NUMBER";
  return "TEXT";
}

function normalizeFetchedAppField(fieldRaw: unknown, index = 0): RhField {
  const field = (fieldRaw && typeof fieldRaw === "object" ? (fieldRaw as Record<string, unknown>) : {}) as Record<string, unknown>;
  const name = String(field.fieldName || field.inputName || field.name || field.key || field.paramName || field.id || `field_${index + 1}`);
  const nodeId = String(field.nodeId || field.node_id || field.groupId || "app");
  let value = field.fieldValue;
  if (value === undefined) value = field.defaultValue;
  if (value === undefined) value = field.value;
  if (value === undefined) value = field.default;
  if (value === undefined || value === null) value = "";
  if (typeof value === "object") value = JSON.stringify(value);
  const options = extractRhFieldOptions(field);
  const fieldValue = String(value);
  // apiCallDemo 里每个字段自带作者填写的中文 description（如"角色1（替换视频左边的角色）"），
  // 这才是用户真正需要看到的参数含义，优先级高于内部变量名 fieldName/name。
  const description = String(field.description || field.descriptionCn || field.descriptionEn || "").trim();
  const nodeName = String(field.nodeName || field.node_name || "");
  return normalizeRhField({
    id: field.id || `${nodeId}::${name}`,
    nodeId,
    fieldName: name,
    fieldValue,
    fieldType: field.fieldType || field.type || field.valueType || (options.length ? "SELECT" : inferFieldTypeFromNameValue(name, fieldValue)),
    label: field.label || field.title || description || name,
    enabled: true,
    group: field.group || field.category || field.title || "AI 应用参数",
    note: field.note || (nodeName ? `${nodeName} · ${name}` : ""),
    options,
    min: field.min ?? "",
    max: field.max ?? "",
    step: field.step ?? "",
    order: index,
  });
}

/** 把 /api/runninghub/app-info 的原始返回，解析成可编辑的字段列表 */
export function fieldsFromAppInfoRaw(raw: unknown): RhField[] {
  return rhAppFieldSourceList(raw).map((f, i) => normalizeFetchedAppField(f, i));
}

function hasRhScalar(value: string | number | undefined | null): boolean {
  return value !== undefined && value !== null && String(value).trim() !== "";
}

/**
 * 「重新拉取」时合并字段：结构以远端为准（新增/删除节点输入），
 * 但本站已调过的显示名/类型/默认值/启停/排序/说明等一律保留，避免每次重配从零再调。
 * 对齐键：优先 id，其次 nodeId::fieldName。
 */
export function mergeRhFieldsOnRefetch(fetched: RhField[], previous: RhField[]): RhField[] {
  const byId = new Map<string, RhField>();
  const byKey = new Map<string, RhField>();
  for (const raw of previous || []) {
    const field = normalizeRhField(raw);
    if (field.id) byId.set(field.id, field);
    byKey.set(rhWorkflowFieldKey(field), field);
  }
  return (fetched || []).map((raw) => {
    const base = normalizeRhField(raw);
    const existing = byId.get(base.id) || byKey.get(rhWorkflowFieldKey(base));
    if (!existing) return base;
    return {
      ...base,
      enabled: existing.enabled,
      label: existing.label || base.label,
      note: existing.note || base.note,
      fieldType: existing.fieldType || base.fieldType,
      fieldValue: existing.fieldValue,
      order: Number.isFinite(Number(existing.order)) ? Number(existing.order) : base.order,
      options: existing.options.length ? existing.options : base.options,
      group: existing.group || base.group,
      sourceFromUpstream: existing.sourceFromUpstream,
      random_enabled: existing.random_enabled,
      min: hasRhScalar(existing.min) ? existing.min : base.min,
      max: hasRhScalar(existing.max) ? existing.max : base.max,
      step: hasRhScalar(existing.step) ? existing.step : base.step,
      imageOrder: existing.imageOrder || base.imageOrder,
      required: existing.required,
    };
  });
}

export function sortRhFields(fields: RhField[]): RhField[] {
  return [...(fields || [])].sort((a, b) => {
    const ak = rhWorkflowFieldKind(a);
    const bk = rhWorkflowFieldKind(b);
    if (ak === "IMAGE" && bk === "IMAGE") {
      const ao = Number(a.imageOrder) || 9999;
      const bo = Number(b.imageOrder) || 9999;
      if (ao !== bo) return ao - bo;
    }
    if (ak === "IMAGE" && bk !== "IMAGE") return -1;
    if (ak !== "IMAGE" && bk === "IMAGE") return 1;
    return (
      String(a.nodeId || "").localeCompare(String(b.nodeId || ""), undefined, { numeric: true }) ||
      String(a.fieldName || "").localeCompare(String(b.fieldName || ""))
    );
  });
}

// ---------------------------------------------------------------------------
// DAG 节点图：拓扑分层自动布局（移植自 canvas_source/static/js/api-settings.js 的
// computeRhWorkflowEditorLayers / renderRhWorkflowEditorGraph）
// ---------------------------------------------------------------------------

export function workflowNodeTitle(node: unknown): string {
  const n = (node && typeof node === "object" ? (node as Record<string, unknown>) : {}) as Record<string, unknown>;
  const meta = n._meta as Record<string, unknown> | undefined;
  return String((meta && meta.title) || n.class_type || n._class || n.type || "Node");
}

export function workflowNodeClass(node: unknown): string {
  const n = (node && typeof node === "object" ? (node as Record<string, unknown>) : {}) as Record<string, unknown>;
  return String(n.class_type || n._class || n.type || "");
}

export type RhNodeCategory = "prompt" | "lora" | "sampler" | "image" | "video" | "audio" | "misc";

export function workflowNodeCategory(node: unknown): RhNodeCategory {
  const text = `${workflowNodeTitle(node)} ${workflowNodeClass(node)}`.toLowerCase();
  if (/text|prompt|clip/.test(text)) return "prompt";
  if (/lora/.test(text)) return "lora";
  if (/ksampler|k sampler|sampler|scheduler|guid|cfg/.test(text)) return "sampler";
  if (/video|movie|mp4|webm|frame/.test(text)) return "video";
  if (/audio|sound|voice|music|wav|mp3/.test(text)) return "audio";
  if (/image|mask|resize|scale|crop|photo|picture|preview|save/.test(text)) return "image";
  return "misc";
}

export const RH_NODE_CATEGORY_COLORS: Record<RhNodeCategory, { fill: string; accent: string }> = {
  prompt: { fill: "#3a3315", accent: "#eab308" },
  lora: { fill: "#3a2a10", accent: "#fbbf24" },
  sampler: { fill: "#2a1e44", accent: "#a78bfa" },
  image: { fill: "#0f3825", accent: "#34d399" },
  video: { fill: "#3a2413", accent: "#fb923c" },
  audio: { fill: "#1a2845", accent: "#60a5fa" },
  misc: { fill: "#1c1b1b", accent: "#6b7280" },
};

export type RhGraphNode = {
  id: string;
  x: number;
  y: number;
  title: string;
  klass: string;
  category: RhNodeCategory;
  exposedCount: number;
};

export type RhGraphEdge = { from: string; to: string; x1: number; y1: number; x2: number; y2: number };

export type RhGraphLayout = {
  nodes: RhGraphNode[];
  edges: RhGraphEdge[];
  width: number;
  height: number;
  nodeW: number;
  nodeH: number;
};

function workflowLinkSource(value: unknown, workflowJson: Record<string, unknown>): string | null {
  if (Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && workflowJson[value[0]]) {
    return value[0];
  }
  return null;
}

export function computeWorkflowGraphLayout(workflowJson: Record<string, unknown>, enabledFields: RhField[]): RhGraphLayout {
  const ids = Object.keys(workflowJson || {});
  const NODE_W = 136;
  const NODE_H = 52;
  const X_GAP = 42;
  const Y_GAP = 16;
  if (!ids.length) return { nodes: [], edges: [], width: 0, height: 0, nodeW: NODE_W, nodeH: NODE_H };

  const incoming: Record<string, Set<string>> = {};
  const outgoing: Record<string, Set<string>> = {};
  ids.forEach((id) => {
    incoming[id] = new Set();
    outgoing[id] = new Set();
  });
  ids.forEach((id) => {
    const inputs = ((workflowJson[id] as Record<string, unknown>)?.inputs || {}) as Record<string, unknown>;
    Object.values(inputs).forEach((value) => {
      const from = workflowLinkSource(value, workflowJson);
      if (from) {
        incoming[id].add(from);
        outgoing[from].add(id);
      }
    });
  });

  const layer: Record<string, number> = {};
  const visiting = new Set<string>();
  function dfs(id: string, lv: number) {
    if (visiting.has(id)) return;
    layer[id] = Math.max(layer[id] || 0, lv);
    visiting.add(id);
    outgoing[id].forEach((child) => dfs(child, lv + 1));
    visiting.delete(id);
  }
  ids.forEach((id) => {
    if (incoming[id].size === 0) dfs(id, 0);
  });
  ids.forEach((id) => {
    if (!(id in layer)) layer[id] = 0;
  });

  const buckets: Record<number, string[]> = {};
  ids.forEach((id) => {
    (buckets[layer[id]] = buckets[layer[id]] || []).push(id);
  });
  const levels = Object.keys(buckets)
    .map(Number)
    .sort((a, b) => a - b);

  const positions: Record<string, { x: number; y: number }> = {};
  let maxRows = 0;
  levels.forEach((lv) => {
    const levelIds = buckets[lv].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    levelIds.forEach((id, idx) => {
      positions[id] = { x: lv * (NODE_W + X_GAP) + 18, y: idx * (NODE_H + Y_GAP) + 18 };
    });
    maxRows = Math.max(maxRows, levelIds.length);
  });

  const edges: RhGraphEdge[] = [];
  ids.forEach((toId) => {
    const seen = new Set<string>();
    const inputs = ((workflowJson[toId] as Record<string, unknown>)?.inputs || {}) as Record<string, unknown>;
    Object.values(inputs).forEach((value) => {
      const fromId = workflowLinkSource(value, workflowJson);
      if (!fromId || seen.has(fromId)) return;
      seen.add(fromId);
      const from = positions[fromId];
      const to = positions[toId];
      if (!from || !to) return;
      edges.push({ from: fromId, to: toId, x1: from.x + NODE_W, y1: from.y + NODE_H / 2, x2: to.x, y2: to.y + NODE_H / 2 });
    });
  });

  const exposedByNode = new Map<string, number>();
  for (const field of enabledFields) {
    if (!field.enabled) continue;
    const key = String(field.nodeId);
    exposedByNode.set(key, (exposedByNode.get(key) || 0) + 1);
  }

  const nodes: RhGraphNode[] = ids.map((id) => {
    const node = workflowJson[id];
    const pos = positions[id];
    return {
      id,
      x: pos.x,
      y: pos.y,
      title: workflowNodeTitle(node),
      klass: workflowNodeClass(node),
      category: workflowNodeCategory(node),
      exposedCount: exposedByNode.get(id) || 0,
    };
  });

  return {
    nodes,
    edges,
    width: levels.length * (NODE_W + X_GAP) + 18,
    height: maxRows * (NODE_H + Y_GAP) + 18,
    nodeW: NODE_W,
    nodeH: NODE_H,
  };
}

export const RH_FIELD_TYPE_LABELS: Record<string, string> = {
  TEXT: "文本",
  NUMBER: "数字",
  BOOLEAN: "开关",
  SELECT: "下拉选项",
  IMAGE: "图片",
  VIDEO: "视频",
  AUDIO: "音频",
};
