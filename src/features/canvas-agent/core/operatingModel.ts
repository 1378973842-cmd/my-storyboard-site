import type { CanvasAction, CanvasNodeSnapshot, CanvasSnapshot } from '../types';
import { downstreamImpactPaths, nodeHasGeneratedOutput } from './invalidation';

export const MAX_REBUILDS = 3;

export type NodeLifecycle = 'created' | 'effective' | 'discarded';
export type IntakeMode = 'direct' | 'production';
export type ImpactChoice = { nodeId: string; label: string; failed: boolean };
export type MentionCandidate = {
  kind: 'node' | 'model';
  id: string;
  type: string;
  label: string;
  lifecycle?: NodeLifecycle;
  thumb?: string;
  preview?: string;
  media?: 'image' | 'video';
  group?: string;
};

const MODEL_LABELS: Record<string, string> = {
  'hailuo-h3': '海螺 H3',
  'seedance-2.0': 'Seedance 2.0',
};

const COPY_KEYS = [
  'name', 'title', 'prompt', 'text', 'story', 'scene', 'intent', 'model', 'ratio',
  'aspect', 'aspectRatio', 'resolution', 'style', 'cameraMove', 'camera_move', 'duration', 'fidelity',
] as const;

const LIFECYCLE_LABEL: Record<NodeLifecycle, string> = {
  created: '已创建',
  effective: '已生效',
  discarded: '已废弃',
};

export function lifecycleLabel(lifecycle: NodeLifecycle): string {
  return LIFECYCLE_LABEL[lifecycle];
}

export function classifyIntake(message: string): IntakeMode {
  const text = message.trim();
  // production 分支已停用。它声明的阶段顺序没有实体支撑
  // （系统里没有阶段类型），唯一能生效的部分
  // Never run the whole piece in one proposal
  // 阻止了用户明确要求的动作——第十五次真实验收实证：
  // 用户说「建好之后直接执行全部三个」，模型没提执行。
  // 正则本身保留，将来做阶段实体时用它做判据：
  // 判据从「猜文本意图」换成「阶段实体是否存在」。
  // 见 operatingPrompt 上方那条注释。
  const productionCue = /多镜头|分镜表|分镜|短片|角色一致|同角色|锚点|完整成片|走流程|一支/.test(text)
    || (/一条\s*\d+\s*秒/.test(text) && /角色|镜头|讲/.test(text));
  void productionCue;
  return 'direct';
}

// production 的阶段词已删。
// 依赖就绪由 assertAgentActionContent 的代码检查强制，
// 先后顺序由拓扑排序强制，
// 一次跑多少由用户要求决定。
// 这三件事都不需要阶段提示词。
export function operatingPrompt(message: string, playbookText?: string): string {
  void message;
  const intake = 'INTAKE direct: answer or propose one small change. Do not open a storyboard ledger or anchor set. If the user explicitly asks to run or execute, include both the structural actions and the execution in one proposal.';
  const loaded = typeof playbookText === 'string' ? playbookText.trim() : '';
  const books = loaded || 'none';
  return `${intake}
NODE LIFECYCLE is created, effective, or discarded. Never execute a discarded or failed node. Replace it with a new node whose initialParams.replacesNodeId is the old id. Rebuilding the same output stops after ${MAX_REBUILDS} new nodes.
Do not rerun downstream after an upstream change. The user chooses redo on the original node or a new replacement.
Tokens like {{node-id}} in the user message are real node references. Repeat each one in the prompt and explain its role. Prose such as "same as the previous shot" is not a reference.
A phrase "使用模型 <id>" names a real canvas model id. Put that exact id in initialParams.model or the update patch model. It is not a node reference.
Playbooks loaded: ${books}. Do not invent playbooks, web search, memory, a 3D director stage, or a multi-track editor.`;
}

export function settleAgentStaleAfterExecution(
  node: Record<string, unknown> | undefined,
  succeeded: boolean,
  message?: string,
): void {
  if (!node) return;
  if (!succeeded) {
    const text = String(message || '').trim();
    if (!text) return;
    node.agentLastError = { message: text, at: Date.now() };
    return;
  }
  delete node.agentStale;
  delete node.agentStaleReason;
  delete node.agentImpactPath;
  delete node.agentLastError;
}

export function nodeLifecycle(node: CanvasNodeSnapshot | undefined): NodeLifecycle {
  if (!node) return 'created';
  if (String(node.runStatus || '') === 'failed' || String(node.runError || '').trim()) return 'discarded';
  if (node.agentLifecycle === 'discarded') return 'discarded';
  if (nodeHasGeneratedOutput(node) && !node.agentStale) return 'effective';
  return 'created';
}

export function rebuildCount(node: CanvasNodeSnapshot | undefined): number {
  const count = Number(node?.agentRebuildCount);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export function nodeLabel(node: CanvasNodeSnapshot): string {
  for (const key of ['name', 'title', 'prompt', 'text'] as const) {
    const value = String(node[key] || '').trim();
    if (value) return value.slice(0, 24);
  }
  return node.type;
}

function isContentUpdate(action: CanvasAction): action is CanvasAction & { type: 'update_node_params' } {
  return action.type === 'update_node_params'
    && Object.keys(action.patch).some((key) => !key.startsWith('agent'));
}

export function downstreamChoices(snapshot: CanvasSnapshot, actions: CanvasAction[]): ImpactChoice[] {
  if (actions.some((action) => action.type === 'execute_node_skill')) return [];
  if (actions.some((action) => action.type === 'create_node' && action.initialParams?.replacesNodeId)) {
    return [];
  }
  const roots = new Set<string>();
  for (const action of actions) {
    if (isContentUpdate(action)) roots.add(action.nodeId);
    if (action.type === 'connect_nodes') roots.add(action.targetNodeId);
  }
  if (!roots.size) return [];
  return downstreamImpactPaths(snapshot, [...roots])
    .filter((item) => item.hasGeneratedOutput)
    .map((item) => {
      const node = snapshot.nodes.find((entry) => entry.id === item.nodeId);
      return {
        nodeId: item.nodeId,
        label: node ? nodeLabel(node) : item.nodeId,
        failed: node ? nodeLifecycle(node) === 'discarded' : false,
      };
    });
}

export function assertAgentCanExecute(snapshot: CanvasSnapshot, nodeId: string): void {
  const node = snapshot.nodes.find((item) => item.id === nodeId);
  if (!node) return;
  if (nodeLifecycle(node) === 'discarded') {
    throw new Error(`节点 ${nodeLabel(node)} 已失败或废弃，不能在原节点重试。请新建替换。`);
  }
}

/** prompt 画面和上游取值读 text；generator / video 的内容键是 prompt。其他类型不要求。 */
const REQUIRED_CREATE_PARAM: Record<string, string> = {
  prompt: 'text',
  generator: 'prompt',
  video: 'prompt',
};

function agentNodeHasContent(node: CanvasNodeSnapshot): boolean {
  if (nodeHasGeneratedOutput(node)) return true;
  // 九宫格的内容在 story。一行判据，不另建类型表。
  if (node.type === 'nineGridAgent' && String(node.story || '').trim()) return true;
  return String(node.prompt || '').trim().length > 0;
}

export function assertAgentActionContent(
  action: CanvasAction,
  snapshot: CanvasSnapshot,
  generatorTypes: readonly string[] = [],
): void {
  if (action.type === 'create_node') {
    const key = REQUIRED_CREATE_PARAM[action.nodeType];
    if (!key) return;
    const params = action.initialParams;
    if (!params || !Object.hasOwn(params, key)) {
      const label = String(action.tempId || action.nodeType);
      throw new Error(
        `节点 ${label}（类型 ${action.nodeType}）缺少必填参数 ${key}。\n请在 initialParams 里填上内容；\n如果这是一个等用户手动填写的空节点，\n请显式传 initialParams.${key} = ""。`,
      );
    }
    return;
  }
  if (action.type !== 'execute_node_skill') return;
  // 名单由调用方传入已导出的 CANVAS_GENERATOR_TYPES，这里不另抄一份。
  const ready = new Set(generatorTypes);
  for (const edge of snapshot.connections) {
    if (edge.to !== action.nodeId) continue;
    const upstream = snapshot.nodes.find((item) => item.id === edge.from);
    if (!upstream || !ready.has(upstream.type) || nodeHasGeneratedOutput(upstream)) continue;
    const error = new Error(`节点 ${action.nodeId} 引用的上游 ${upstream.id} 还没有产出，无法执行。`) as Error & {
      reason?: string;
    };
    error.reason = 'dependency_not_ready';
    throw error;
  }
  const node = snapshot.nodes.find((item) => item.id === action.nodeId);
  // image 不可执行。空内容门禁会先抛「没有内容」，盖住后面的类型说明。
  if (!node || node.type === 'image' || agentNodeHasContent(node)) return;
  throw new Error(
    `节点 ${action.nodeId} 没有内容，无法执行。如果它应该承载提示词，请在 initialParams 里填上；如果它是等用户手动填写的空节点，请不要在同一批 actions 里执行它。`,
  );
}

function shotSeconds(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return String(rounded);
}

function shotLabel(index: string, start: number, end: number): string {
  return `分镜${index}（${shotSeconds(start)}-${shotSeconds(end)}s）`;
}

function sameSecond(left: number, right: number): boolean {
  return Math.abs(left - right) < 1e-6;
}

function finiteDuration(value: unknown): number | null {
  if (value == null || value === '') return null;
  const duration = Number(value);
  return Number.isFinite(duration) ? duration : null;
}

function shotTime(line: string): { start: number; end: number } | null {
  const time = line.match(/(\d+(?:\.\d+)?)\s*[-~～—–－]\s*(\d+(?:\.\d+)?)\s*(?:s|S|秒)/)
    || line.match(/(\d+(?:\.\d+)?)\s*[-~～—–－]\s*(\d+(?:\.\d+)?)/);
  if (!time) return null;
  return { start: Number(time[1]), end: Number(time[2]) };
}

// 时间可以在分镜行的任意一栏。认 0-3、0-3s、0.0-3.0s、0-3秒。
// 引用记号换成名字时会把换行收成空格，所以不能按换行切开。
// 一段都读不出时只提示格式，不拿重叠去判。没有分镜标记就跳过。
export function assertVideoShotTimeline(prompt: string, duration: number | null): void {
  const marks = [...prompt.matchAll(/分镜\s*(\d+)\s*丨/g)];
  const lines = marks.map((mark, index) => {
    const start = mark.index ?? 0;
    const end = marks[index + 1]?.index ?? prompt.length;
    return { index: mark[1], time: shotTime(prompt.slice(start, end)) };
  });
  if (!lines.length) return;
  if (lines.some((line) => !line.time)) {
    throw new Error('解析不出时间段，请写成 X-Ys 形式');
  }
  const rows = lines.map((line) => ({
    index: line.index,
    start: line.time?.start || 0,
    end: line.time?.end || 0,
  }));
  if (duration == null) throw new Error('有分镜时间段，但没有节点时长，无法核对');
  for (const row of rows) {
    if (row.end < row.start) {
      throw new Error(`${shotLabel(row.index, row.start, row.end)}结束早于开始`);
    }
  }
  if (!sameSecond(rows[0].start, 0)) {
    throw new Error(`${shotLabel(rows[0].index, rows[0].start, rows[0].end)}没有从 0s 接上`);
  }
  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const next = rows[i];
    const overlapEnd = Math.min(prev.end, next.end);
    if (next.start < prev.end - 1e-6) {
      throw new Error(`分镜${prev.index} 和分镜${next.index} 在 ${shotSeconds(next.start)}-${shotSeconds(overlapEnd)}s 重叠`);
    }
    if (next.start > prev.end + 1e-6) {
      throw new Error(`${shotLabel(prev.index, prev.start, prev.end)}与${shotLabel(next.index, next.start, next.end)}留了空档`);
    }
  }
  const total = rows.reduce((sum, row) => sum + (row.end - row.start), 0);
  if (!sameSecond(total, duration)) {
    throw new Error(`分镜时长合计 ${shotSeconds(total)} 秒，节点时长是 ${shotSeconds(duration)} 秒`);
  }
}

// ponytail: 同一批对同一节点改两次时，后一次的时长只看自己的 patch，没有才看本次创建或画布上的原值。
// 升级路径是先把同一节点的 patch 折成一份再核对。
export function assertCanvasVideoShotTimelines(
  actions: CanvasAction[],
  nodes: CanvasNodeSnapshot[],
): void {
  const created = new Map<string, { type: string; duration: number | null }>();
  for (const action of actions) {
    if (action.type !== 'create_node' || !action.tempId) continue;
    created.set(action.tempId, {
      type: action.nodeType,
      duration: finiteDuration(action.initialParams?.duration),
    });
  }
  for (const action of actions) {
    if (action.type === 'create_node') {
      if (action.nodeType !== 'video') continue;
      const prompt = action.initialParams?.prompt;
      if (typeof prompt !== 'string') continue;
      assertVideoShotTimeline(prompt, finiteDuration(action.initialParams?.duration));
      continue;
    }
    if (action.type !== 'update_node_params') continue;
    const prompt = action.patch?.prompt;
    if (typeof prompt !== 'string') continue;
    const made = created.get(action.nodeId);
    const live = nodes.find((node) => node.id === action.nodeId);
    const type = made?.type || live?.type;
    if (type !== 'video') continue;
    const duration = finiteDuration(action.patch?.duration)
      ?? made?.duration
      ?? finiteDuration(live?.duration);
    assertVideoShotTimeline(prompt, duration);
  }
}

export function applyRebuildGuards(actions: CanvasAction[], snapshot: CanvasSnapshot): CanvasAction[] {
  const discards: CanvasAction[] = [];
  const next = actions.map((action) => {
    if (action.type === 'execute_node_skill') {
      assertAgentCanExecute(snapshot, action.nodeId);
      return action;
    }
    if (action.type !== 'create_node') return action;
    const replaces = String(action.initialParams?.replacesNodeId || '').trim();
    if (!replaces) return action;
    const source = snapshot.nodes.find((node) => node.id === replaces);
    if (!source) throw new Error(`找不到要替换的节点：${replaces}`);
    const count = rebuildCount(source) + 1;
    if (count > MAX_REBUILDS) {
      throw new Error(`「${nodeLabel(source)}」已重建 ${MAX_REBUILDS} 次，停止继续替换。`);
    }
    discards.push({
      type: 'update_node_params',
      nodeId: replaces,
      patch: {
        agentLifecycle: 'discarded',
        agentStale: true,
        agentStaleReason: '已由新节点替换，不再复用',
      },
    });
    return {
      ...action,
      initialParams: {
        ...(action.initialParams || {}),
        agentLifecycle: 'created',
        agentRebuildCount: count,
        agentReplaces: replaces,
      },
    };
  });
  return [...next, ...discards];
}

export function choiceActions(
  snapshot: CanvasSnapshot,
  choices: ImpactChoice[],
  kind: 'redo' | 'replace',
): CanvasAction[] {
  if (kind === 'redo') {
    const runnable = choices.filter((choice) => !choice.failed);
    if (!runnable.length) throw new Error('这些节点已失败或废弃，不能在原节点重做。请新建替换。');
    return runnable.map((choice) => ({ type: 'execute_node_skill', nodeId: choice.nodeId }));
  }
  const actions: CanvasAction[] = [];
  for (const choice of choices) {
    const node = snapshot.nodes.find((item) => item.id === choice.nodeId);
    if (!node) continue;
    const tempId = `replace-${choice.nodeId}`;
    const initialParams: Record<string, unknown> = { replacesNodeId: choice.nodeId };
    for (const key of COPY_KEYS) {
      if (node[key] !== undefined) initialParams[key] = node[key];
    }
    actions.push({
      type: 'create_node',
      tempId,
      nodeType: node.type,
      initialParams,
      position: {
        x: (Number(node.x) || 0) + 48,
        y: (Number(node.y) || 0) + (Number(node.h) || 240) + 48,
      },
    });
    for (const edge of snapshot.connections) {
      if (edge.to === choice.nodeId) {
        actions.push({ type: 'connect_nodes', sourceNodeId: edge.from, targetNodeId: tempId });
      }
    }
  }
  if (!actions.length) throw new Error('没有可替换的下游节点');
  return actions;
}

function previewUrl(node: CanvasNodeSnapshot): string {
  const direct = ['url', 'imageUrl', 'coverUrl', 'videoUrl', 'audioUrl']
    .map((key) => String(node[key] || '').trim())
    .find((value) => value && !value.startsWith('blob:'));
  if (direct) return direct;
  for (const key of ['previewRoundUrls', 'history', 'generatedOutputs']) {
    const value = node[key];
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      const url = String(typeof item === 'string' ? item : item?.url || item?.image_url || '').trim();
      if (url && !url.startsWith('blob:')) return url;
    }
  }
  return '';
}

function mentionThumb(node: CanvasNodeSnapshot, url: string): Pick<MentionCandidate, 'thumb' | 'preview' | 'media'> {
  const clean = url.split('?')[0];
  const video = node.type === 'video' || /\.(mp4|webm|mov|m4v|mkv)$/i.test(clean);
  if (video) return { preview: url, media: 'video' };
  if (clean.startsWith('/uploads/') && !clean.includes('/gallery/') && /\.[a-z0-9]+$/i.test(clean)) {
    const name = clean.replace(/^\/uploads\//, '').replace(/\.[a-z0-9]+$/i, '').split('/').pop();
    if (name) return { thumb: `/uploads/gallery/${name}_thumb.webp`, preview: url, media: 'image' };
  }
  return { preview: url, media: 'image' };
}

function mentionNodeLabel(node: CanvasNodeSnapshot): string {
  const custom = String(node.floatTitle || node.name || node.title || '').trim();
  if (custom) return custom.slice(0, 32);
  const file = String(node.url || '').split('/').pop()?.split('?')[0] || '';
  if (node.type === 'image' && file && !file.startsWith('blob:')) return file.slice(0, 32);
  const index = Number(node.floatTitleIndex) || 0;
  if (node.type === 'generator') return index ? `图片节点 ${index}` : '图片节点';
  if (node.type === 'video') return index ? `视频节点 ${index}` : '视频节点';
  return nodeLabel(node);
}

export function mentionCandidates(snapshot: CanvasSnapshot): MentionCandidate[] {
  return snapshot.nodes
    .filter((node) => (
      node.type === 'image' || node.type === 'generator' || node.type === 'video' || node.type === 'audio'
      || nodeHasGeneratedOutput(node)
    ))
    .slice(0, 20)
    .map((node) => {
      const preview = previewUrl(node);
      return {
        kind: 'node' as const,
        id: node.id,
        type: node.type,
        label: mentionNodeLabel(node),
        lifecycle: nodeLifecycle(node),
        ...(preview ? mentionThumb(node, preview) : {}),
      };
    });
}

function modelsInGroup(ids: string[] | undefined, type: string, group: string): MentionCandidate[] {
  const seen = new Set<string>();
  const rows: MentionCandidate[] = [];
  for (const raw of ids || []) {
    const id = String(raw || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    rows.push({ kind: 'model', id, type, label: MODEL_LABELS[id] || id, group });
  }
  return rows;
}

export function mentionModelCandidates(available?: CanvasSnapshot['availableModels']): MentionCandidate[] {
  if (!available) return [];
  const imageIds = (available.image || []).flatMap((provider) => provider?.models || []);
  const chatIds = (available.chat || []).flatMap((provider) => provider?.models || []);
  const seen = new Set<string>();
  return [
    ...modelsInGroup(imageIds, 'image', '图片'),
    ...modelsInGroup(chatIds, 'chat', '文本'),
    ...modelsInGroup(available.video, 'video', '视频'),
  ].filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function mentionQueryAt(value: string, cursor: number): string | null {
  const match = value.slice(0, cursor).match(/@([^\s@{}]*)$/);
  return match ? match[1] : null;
}

export function insertMention(
  value: string,
  cursor: number,
  mention: string | Pick<MentionCandidate, 'kind' | 'id'>,
): string {
  const token = typeof mention === 'string' || mention.kind !== 'model'
    ? `{{${typeof mention === 'string' ? mention : mention.id}}} `
    : `使用模型 ${mention.id} `;
  const before = value.slice(0, cursor).replace(/@([^\s@{}]*)$/, token);
  return `${before}${value.slice(cursor)}`;
}

export function mentionChipToken(mention: Pick<MentionCandidate, 'kind' | 'id'>): string {
  return mention.kind === 'model' ? `使用模型 ${mention.id}` : `{{${mention.id}}}`;
}

export function stripMentionQuery(value: string, cursor: number): string {
  const before = value.slice(0, cursor).replace(/@([^\s@{}]*)$/, '');
  return `${before}${value.slice(cursor)}`;
}
