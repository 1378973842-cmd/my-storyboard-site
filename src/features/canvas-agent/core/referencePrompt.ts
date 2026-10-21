import type { CanvasAction, CanvasNodeSnapshot } from '../types';

function plain(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readableName(value: unknown): string {
  const text = plain(value);
  if (!text || /\.(jpe?g|png|webp|gif|bmp|mp4|webm|mov|m4v|mkv)$/i.test(text)) return '';
  return text;
}

function standInLabel(
  name: string,
  actions: CanvasAction[],
  nodes: CanvasNodeSnapshot[],
  seen: Map<string, string>,
  fallbackCount: { n: number },
): string {
  const cached = seen.get(name);
  if (cached) return cached;
  const created = actions.find((action) => (
    action.type === 'create_node' && String(action.tempId || '').trim() === name
  ));
  const params = created && created.type === 'create_node' ? created.initialParams : undefined;
  const createdLabel = readableName(params?.name) || readableName(params?.title);
  const node = nodes.find((item) => item.id === name) as Record<string, unknown> | undefined;
  const canvasLabel = readableName(node?.name) || readableName(node?.title) || readableName(node?.floatTitle);
  const label = createdLabel || canvasLabel || `参考图${fallbackCount.n += 1}`;
  seen.set(name, label);
  return label;
}

// {{}} 是内部记号，不能留在用户看得见的 prompt 里。
// 换成节点名；没有名字就按出现顺序用参考图N。只删不换会留下「参考 与 的」这种残句。
// 文件名不是节点名。name 是 canvas-output-xxx.jpg 时按没有名字处理，避免把文件名写进 prompt。
function referenceLabels(
  prompt: string,
  actions: CanvasAction[],
  nodes: CanvasNodeSnapshot[],
): Map<string, string> {
  const seen = new Map<string, string>();
  const fallbackCount = { n: 0 };
  for (const match of prompt.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    const name = String(match[1] || '').trim();
    if (name) standInLabel(name, actions, nodes, seen, fallbackCount);
  }
  return seen;
}

function withFidelityNames(
  params: Record<string, unknown>,
  originalPrompt: string,
  actions: CanvasAction[],
  nodes: CanvasNodeSnapshot[],
): Record<string, unknown> {
  const fidelity = params.fidelity;
  if (!fidelity || typeof fidelity !== 'object' || Array.isArray(fidelity)) return params;
  const refs = (fidelity as { refs?: unknown }).refs;
  if (!Array.isArray(refs)) return params;
  const labels = referenceLabels(originalPrompt, actions, nodes);
  return {
    ...params,
    fidelity: {
      ...(fidelity as Record<string, unknown>),
      refs: refs.map((ref) => {
        if (!ref || typeof ref !== 'object') return ref;
        const record = ref as { node_key?: string; nodeId?: string; id?: string; name?: string };
        const key = String(record.node_key || record.nodeId || record.id || '').trim();
        const name = key ? labels.get(key) || '' : '';
        if (!name || record.name) return ref;
        return { ...record, name };
      }),
    },
  };
}

export function readableReferencePrompt(
  prompt: string,
  actions: CanvasAction[],
  nodes: CanvasNodeSnapshot[],
): string {
  const seen = new Map<string, string>();
  const fallbackCount = { n: 0 };
  return prompt
    .replace(/\{\{\s*([^{}]*?)\s*\}\}/g, (_match, raw: string) => {
      const name = String(raw || '').trim();
      if (!name) return '';
      return standInLabel(name, actions, nodes, seen, fallbackCount);
    })
    .replace(/\s+/g, ' ')
    .replace(/(?:\s*,\s*)+/g, ', ')
    .trim()
    .replace(/^,\s*/, '')
    .replace(/,\s*$/, '')
    .trim();
}

export type UserCitations = {
  nodes: Set<string>;
  models: Set<string>;
};

// 点名只认消息里的 @ 记号：{{节点id}}、使用模型 <id>。
// {{canvas:id}} 和 {{id}} 是同一个节点。只留带前缀的那份，会对不上画布 id。
// 口头答「要」不算。确认这两个字本身不是点名。
// 节点 id 一旦出现在本会话的用户消息里，就留在会话行上，后面没有记号的消息仍认这些 id。
// 使用模型 仍只认这一条消息。模型自己写进提案的 id 不会进这一列。
function addCitedNode(nodes: Set<string>, raw: string): void {
  const name = raw.trim();
  if (!name) return;
  nodes.add(name);
  if (name.startsWith('canvas:')) {
    const bare = name.slice('canvas:'.length).trim();
    if (bare) nodes.add(bare);
  }
}

export function citationsInUserMessage(message: string): UserCitations {
  const nodes = new Set<string>();
  const models = new Set<string>();
  const text = String(message || '');
  for (const match of text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    addCitedNode(nodes, String(match[1] || ''));
  }
  for (const match of text.matchAll(/使用模型\s+(\S+)/g)) {
    const id = String(match[1] || '').replace(/[，。,.、；;:：]+$/u, '').trim();
    if (id) models.add(id);
  }
  return { nodes, models };
}

/** 落板认本条消息的 {{}}，再并上会话行里已经点过名的节点。没有用户消息时不拦（重做/替换）。 */
export function citationsForApply(
  userMessage: string | undefined,
  sessionCitedNodes: readonly string[] = [],
): UserCitations | null {
  if (typeof userMessage !== 'string') return null;
  const citations = citationsInUserMessage(userMessage);
  for (const raw of sessionCitedNodes) addCitedNode(citations.nodes, String(raw || ''));
  return citations;
}

function referenceTokenNames(prompt: string): string[] {
  const names: string[] = [];
  for (const match of prompt.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)) {
    const name = String(match[1] || '').trim();
    if (name) names.push(name);
  }
  return names;
}

function hasReferenceToken(value: string): boolean {
  return /\{\{[^{}]*\}\}/.test(value);
}

function mergedReferenceNames(prompt: string, references: unknown): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const name = raw.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  };
  for (const name of referenceTokenNames(prompt)) add(name);
  if (Array.isArray(references)) {
    for (const item of references) {
      if (typeof item === 'string') add(item);
    }
  }
  return names;
}

function withoutUnnamedModel(params: Record<string, unknown>, citations: UserCitations): Record<string, unknown> {
  const next = { ...params };
  const model = typeof next.model === 'string' ? next.model.trim() : '';
  if (model && !citations.models.has(model)) delete next.model;
  return next;
}

// 这些 id 的执行分支会把参考图送出去。依据是 canvasSiteImageBridge 的路由，不是显示名。
// niji7 走 imageUrl + sref。model14、图片模型 V1 不在 availableModels 里，不在这张表上。
// midjourneyV8.1 的任务体也带 imageUrl，但路径是 text-to-image，带参考边时上游回 [1013]。
// 导演确认它没有参考生图能力，所以不在表里。
const REFERENCE_CAPABLE_IMAGE_MODELS = [
  'gpt-image-2',
  'gpt-image-2-稳定',
  'gpt-image-2.5',
  'nano-banana-pro',
  'nano-banana-pro-稳定',
  'nano-banana-2',
  'nano-banana-2.1',
  'niji7',
];

export const REFERENCE_IMAGE_FALLBACK_MODEL = 'nano-banana-pro';

export function imageModelAcceptsReferenceInput(model: string): boolean {
  const id = model.trim().toLowerCase();
  return REFERENCE_CAPABLE_IMAGE_MODELS.some((item) => item.toLowerCase() === id);
}

// 空模型留给节点默认值（图片模型 V2）。有入边且所选模型不在白名单时，写成 V2。
// 用户点名也盖不过这条：判据是边上有没有参考图，不是措辞。
export function coerceReferenceImageModel(model: string, hasReferenceEdge: boolean): string {
  const current = model.trim();
  if (!hasReferenceEdge || !current || imageModelAcceptsReferenceInput(current)) return current;
  return REFERENCE_IMAGE_FALLBACK_MODEL;
}

function sourceIsImage(
  id: string,
  nodes: CanvasNodeSnapshot[],
  actions: CanvasAction[],
): boolean {
  const node = nodes.find((item) => item.id === id);
  if (node) return node.type === 'image';
  const created = actions.find((action) => action.type === 'create_node' && String(action.tempId || '').trim() === id);
  return Boolean(created && created.type === 'create_node' && created.nodeType === 'image');
}

function hasReferenceEdge(
  targetId: string,
  nodes: CanvasNodeSnapshot[],
  connections: Array<{ from?: string; to?: string }>,
  actions: CanvasAction[],
): boolean {
  if (!targetId) return false;
  for (const edge of connections) {
    if (edge.to === targetId && sourceIsImage(String(edge.from || ''), nodes, actions)) return true;
  }
  return actions.some((action) => (
    action.type === 'connect_nodes'
    && action.targetNodeId === targetId
    && sourceIsImage(action.sourceNodeId, nodes, actions)
  ));
}

const NAMED_REFERENCE_CLAMP_REASON = '该模型不能带参考图';

function namedModelClamp(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  citations: UserCitations | null,
): { from: string; to: string; reason: string } | null {
  const from = typeof before?.model === 'string' ? before.model.trim() : '';
  const to = typeof after.model === 'string' ? after.model.trim() : '';
  if (!citations || !from || !to || from === to || !citations.models.has(from)) return null;
  return { from, to, reason: NAMED_REFERENCE_CLAMP_REASON };
}

function withNamedModelClamp(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown>,
  citations: UserCitations | null,
): { params: Record<string, unknown>; clamp: { from: string; to: string; reason: string } | null } {
  const clamp = namedModelClamp(before, after, citations);
  if (!clamp) return { params: after, clamp: null };
  return {
    clamp,
    params: {
      ...after,
      agentParamClamped: [{ key: 'model', from: clamp.from, to: clamp.to, reason: clamp.reason }],
    },
  };
}

function withReferenceCapableModel(
  params: Record<string, unknown>,
  fallbackModel: string,
  hasEdge: boolean,
): Record<string, unknown> {
  const current = typeof params.model === 'string' ? params.model : fallbackModel;
  const nextModel = coerceReferenceImageModel(current, hasEdge);
  if (!nextModel || nextModel === current) return params;
  return { ...params, model: nextModel };
}

function sessionCreatedSource(
  sourceId: string,
  nodes: CanvasNodeSnapshot[],
  conversationId: string,
): boolean {
  const id = conversationId.trim();
  if (!id) return false;
  const mark = nodes.find((item) => item.id === sourceId)?.agentConversationId;
  return typeof mark === 'string' && mark === id;
}

/** 落板前有、落板后没有的 connect_nodes。{{}} 新补上的边不算被拿掉。 */
export function droppedConnectCount(before: CanvasAction[], after: CanvasAction[]): number {
  const kept = new Set(
    after.flatMap((action) => (
      action.type === 'connect_nodes' ? [`${action.sourceNodeId}\0${action.targetNodeId}`] : []
    )),
  );
  return before.filter((action) => (
    action.type === 'connect_nodes' && !kept.has(`${action.sourceNodeId}\0${action.targetNodeId}`)
  )).length;
}

// citations 为 null：不拦点名（重做/替换没有用户消息）。
// 有 citations：没被 @ 到的 model 删掉。
// 引用边留下两种：用户点了名，或来源节点标着本会话 id。
// 没这个标记的图（素材库、旧节点）仍然拿掉。
// 参考图能力在点名之后另算：节点有参考图入边，且模型不在白名单，就写成图片模型 V2。
// prompt 里的 {{}} 仍换成读得通的说法，避免「参考 与」。
export function settleReferenceActions(
  actions: CanvasAction[],
  nodes: CanvasNodeSnapshot[],
  generatorTypes: readonly string[],
  citations: UserCitations | null,
  connections: Array<{ from?: string; to?: string }> = [],
  conversationId = '',
): CanvasAction[] {
  const kept = citations
    ? actions.filter((action) => (
      action.type !== 'connect_nodes'
      || citations.nodes.has(action.sourceNodeId)
      || sessionCreatedSource(action.sourceNodeId, nodes, conversationId)
    ))
    : actions;
  const batchTempIds = kept.flatMap((action) => (
    action.type === 'create_node' && String(action.tempId || '').trim()
      ? [String(action.tempId).trim()]
      : []
  ));
  const batchTempIdSet = new Set(batchTempIds);
  const canvasIds = nodes.map((node) => node.id);
  const canvasIdSet = new Set(canvasIds);
  const shownCanvasIds = canvasIds.slice(0, 20);
  const hiddenCanvasCount = canvasIds.length - shownCanvasIds.length;
  const occupied = new Set(
    kept.flatMap((action) => (
      action.type === 'connect_nodes' ? [`${action.sourceNodeId}\0${action.targetNodeId}`] : []
    )),
  );
  const edges: CanvasAction[] = [];
  const next = kept.map((action) => {
    if (citations && action.type === 'update_node_params') {
      return { ...action, patch: withoutUnnamedModel(action.patch, citations) };
    }
    if (action.type !== 'create_node') return action;
    const params = citations
      ? withoutUnnamedModel({ ...(action.initialParams || {}) }, citations)
      : { ...(action.initialParams || {}) };
    const hadReferences = Object.prototype.hasOwnProperty.call(action.initialParams || {}, 'references');
    const prompt = typeof params.prompt === 'string' ? params.prompt : '';
    const text = typeof params.text === 'string' ? params.text : '';
    const names = mergedReferenceNames(prompt, params.references);
    const mentioned = hasReferenceToken(prompt) || hasReferenceToken(text) || names.length > 0;
    if (!generatorTypes.includes(action.nodeType)) {
      if (mentioned) {
        const tokens = [...new Set([
          ...referenceTokenNames(prompt),
          ...referenceTokenNames(text),
        ])].map((name) => `{{${name}}}`);
        const extra = names.filter((name) => !tokens.some((token) => token.includes(name)));
        const shown = [...tokens, ...extra].join('、') || '引用';
        throw new Error(`节点类型 ${action.nodeType} 不在生成类型名单里，所以正文里的引用被拒：${shown}。`);
      }
      if (!hadReferences) return { ...action, initialParams: params };
      delete params.references;
      return { ...action, initialParams: params };
    }
    const edgeNames = citations
      ? names.filter((name) => citations.nodes.has(name) || sessionCreatedSource(name, nodes, conversationId))
      : names;
    const tempId = String(action.tempId || '').trim();
    if (edgeNames.length && !tempId) throw new Error(`节点 ${action.nodeType} 没有 tempId，无法建立引用。`);
    const label = tempId || action.nodeType;
    for (const name of edgeNames) {
      if (name === tempId) throw new Error(`节点 ${tempId} 不能引用自己。`);
      const source = batchTempIdSet.has(name) ? name : canvasIdSet.has(name) ? name : '';
      if (!source) {
        const hidden = hiddenCanvasCount > 0 ? `。还有 ${hiddenCanvasCount} 个未列出` : '';
        throw new Error([
          `节点 ${label} 引用了 ${name}，但它不存在。`,
          `本批可引用：${batchTempIds.join(', ')}。`,
          `画布可引用：${shownCanvasIds.join(', ')}${hidden}。`,
        ].join('\n'));
      }
      const key = `${source}\0${tempId}`;
      if (occupied.has(key)) continue;
      occupied.add(key);
      edges.push({ type: 'connect_nodes', sourceNodeId: source, targetNodeId: tempId });
    }
    if (hasReferenceToken(prompt)) {
      const cleaned = readableReferencePrompt(prompt, kept, nodes);
      if (!cleaned) throw new Error('删掉引用后 prompt 为空，请补上实际的提示词。');
      params.prompt = cleaned;
    }
    const named = withFidelityNames(params, prompt, kept, nodes);
    if (!hadReferences && !hasReferenceToken(prompt)) return { ...action, initialParams: named };
    delete named.references;
    return { ...action, initialParams: named };
  });
  const settled = edges.length ? [...next, ...edges] : next;
  return settled.map((action) => {
    if (action.type === 'update_node_params') {
      const node = nodes.find((item) => item.id === action.nodeId);
      const existing = typeof node?.model === 'string' ? node.model : '';
      const patch = withReferenceCapableModel(
        { ...action.patch },
        existing,
        hasReferenceEdge(action.nodeId, nodes, connections, settled),
      );
      const stamped = withNamedModelClamp(action.patch, patch, citations);
      if (!stamped.clamp && stamped.params.model === action.patch.model) return action;
      return { ...action, patch: stamped.params, ...(stamped.clamp ? { modelClamp: stamped.clamp } : {}) };
    }
    if (action.type !== 'create_node' || !generatorTypes.includes(action.nodeType)) return action;
    const tempId = String(action.tempId || '').trim();
    const params = withReferenceCapableModel(
      { ...(action.initialParams || {}) },
      '',
      hasReferenceEdge(tempId, nodes, connections, settled),
    );
    const stamped = withNamedModelClamp(action.initialParams, params, citations);
    if (!stamped.clamp && stamped.params.model === action.initialParams?.model) return action;
    return { ...action, initialParams: stamped.params, ...(stamped.clamp ? { modelClamp: stamped.clamp } : {}) };
  });
}

export function referenceModelClampLabel(clamp: { from: string; to: string; reason: string }): string {
  return `模型从 ${clamp.from} 改为 ${clamp.to}：${clamp.reason}`;
}

function sameActionTarget(left: CanvasAction, right: CanvasAction): boolean {
  if (left.type !== right.type) return false;
  if (left.type === 'create_node' && right.type === 'create_node') {
    return left.tempId === right.tempId && left.nodeType === right.nodeType;
  }
  if (left.type === 'update_node_params' && right.type === 'update_node_params') return left.nodeId === right.nodeId;
  if (left.type === 'execute_node_skill' && right.type === 'execute_node_skill') return left.nodeId === right.nodeId;
  if (left.type === 'connect_nodes' && right.type === 'connect_nodes') {
    return left.sourceNodeId === right.sourceNodeId && left.targetNodeId === right.targetNodeId;
  }
  return false;
}

// 跟批准时同一条结算。用户点了名、落地又被改掉，才有这句话。没点名的回落不报。
export function referenceClampLabels(
  actions: CanvasAction[],
  nodes: CanvasNodeSnapshot[],
  generatorTypes: readonly string[],
  userMessage: string | undefined,
  connections: Array<{ from?: string; to?: string }> = [],
  conversationId = '',
  sessionCitedNodes: readonly string[] = [],
): string[] {
  const citations = citationsForApply(userMessage, sessionCitedNodes);
  const settled = settleReferenceActions(actions, nodes, generatorTypes, citations, connections, conversationId);
  const used = new Set<number>();
  return actions.map((action) => {
    const index = settled.findIndex((item, itemIndex) => !used.has(itemIndex) && sameActionTarget(action, item));
    if (index < 0) return '';
    used.add(index);
    const match = settled[index];
    return (match.type === 'create_node' || match.type === 'update_node_params') && match.modelClamp
      ? referenceModelClampLabel(match.modelClamp)
      : '';
  });
}
