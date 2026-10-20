import type {
  CanvasContextPayload,
  CanvasNodeSnapshot,
  CanvasSnapshot,
} from '../types';
import { downstreamImpactPaths } from './invalidation';
import { mentionCandidates, nodeLifecycle, rebuildCount } from './operatingModel';

const ASSET_LIST_CAP = 20;

function presentAvailableAssets(list: CanvasSnapshot['availableAssets'] | undefined) {
  if (!list) return {};
  const shown = list.slice(0, ASSET_LIST_CAP);
  const hidden = list.length - shown.length;
  return {
    availableAssets: shown,
    ...(hidden > 0 ? { availableAssetsOmission: `[素材库还有 ${hidden} 条未列出]` } : {}),
  };
}

const TEXT_KEYS = [
  'name',
  'title',
  'prompt',
  'text',
  'outputText',
  'story',
  'scene',
  'intent',
  'model',
  'ratio',
  'aspect',
  'aspectRatio',
  'resolution',
  'style',
  'cameraMove',
  'camera_move',
] as const;
const URL_KEYS = ['url', 'coverUrl', 'imageUrl', 'videoUrl', 'audioUrl'] as const;
const MAX_TEXT = 900;
export const CANVAS_AGENT_CONTEXT_MAX = 14_000;
const MAX_CONTEXT = CANVAS_AGENT_CONTEXT_MAX;
const UPSTREAM_TEXT_MAX = 200;
const SOURCE_PROMPT_OMISSION = '…[正文已截断]';
const SUMMARY_PREVIEW_MAX = 80;
const ROLE_CAP = 16;

function compactText(value: unknown, max = MAX_TEXT): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function mediaUrls(node: CanvasNodeSnapshot): string[] {
  const urls = new Set<string>();
  for (const key of URL_KEYS) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) urls.add(value.trim());
  }
  for (const key of ['previewRoundUrls', 'history', 'generatedOutputs']) {
    const value = node[key];
    if (!Array.isArray(value)) continue;
    for (const item of value.slice(-6)) {
      const url = typeof item === 'string' ? item : String(item?.url || item?.image_url || '');
      if (url.trim()) urls.add(url.trim());
    }
  }
  return [...urls].slice(0, 8);
}

function compactNode(node: CanvasNodeSnapshot, textMax = MAX_TEXT): Record<string, unknown> {
  const output: Record<string, unknown> = { id: node.id, type: node.type };
  for (const key of TEXT_KEYS) {
    const value = node[key];
    if (typeof value === 'string' && value.trim()) output[key] = compactText(value, textMax);
    else if (typeof value === 'number' || typeof value === 'boolean') output[key] = value;
  }
  const urls = mediaUrls(node);
  if (urls.length) output.assets = urls;
  // 摘要和角色表不走 TEXT_KEYS，也不走 mediaUrls。全文留在节点字段上。
  Object.assign(output, presentRefLooksSummary(node), presentPlanBTitleCopySummary(node), presentRoles(node));
  return output;
}

function shotRows(node: CanvasNodeSnapshot): Array<{ n: number; prompt: string }> | null {
  if (!Array.isArray(node.shots) || !node.shots.length) return null;
  return node.shots.map((item, index) => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      n: Number(record.n ?? index + 1),
      prompt: String(record.prompt ?? ''),
    };
  });
}

// shots 归截断层，因为它是正文。它安全是因为产出侧已经钳在 250，12288 和正常路径的总长兜底都碰不到。
// 不走 compactText：上游那一刀是 200，会把 250 字的格子再切短。
// cap 为 0 时丢掉整个 shots，只留 shotsOmitted。9 条空描述会被读成「分镜是空的」；宁可不给，不给残缺。
function presentShots(node: CanvasNodeSnapshot, sourcePromptMax?: number): Record<string, unknown> {
  const rows = shotRows(node);
  if (!rows) return {};
  if (sourcePromptMax == null) return { shots: rows };
  if (sourcePromptMax === 0) return { shotsOmitted: true };
  return {
    shots: rows.map((row) => (
      row.prompt.length <= sourcePromptMax
        ? row
        : { n: row.n, prompt: `${row.prompt.slice(0, sourcePromptMax)}${SOURCE_PROMPT_OMISSION}` }
    )),
  };
}

function previewField(value: unknown): string {
  const text = String(value || '');
  return text.length > SUMMARY_PREVIEW_MAX ? `${text.slice(0, SUMMARY_PREVIEW_MAX)}…` : text;
}

// 这两处产出侧上限补不了（会伤本地功能或造成时序不一致），
// 序列化侧不能切（会毁掉造型锚点和逐字文案），
// 所以它们只以摘要进上下文。
// agent 需要的是「有这份分析、几条、大致什么」，不是全文。
// 需要全文的场景目前不存在。
// 将来真需要时，做的是「选中时展开」，不是把全文塞进摘要。
// 不进总长那刀：first / headline 各封在 80 字，条数只进数字，体积恒定。
// 挂进二分搜索只会多遍历一类字段、增加出错面。
function presentRefLooksSummary(node: CanvasNodeSnapshot): Record<string, unknown> {
  if (!Array.isArray(node.refLooks) || !node.refLooks.length) return {};
  const first = node.refLooks[0] && typeof node.refLooks[0] === 'object'
    ? node.refLooks[0] as Record<string, unknown>
    : {};
  return {
    refLooksSummary: {
      count: node.refLooks.length,
      first: previewField(first.face_hair),
    },
  };
}

function presentPlanBTitleCopySummary(node: CanvasNodeSnapshot): Record<string, unknown> {
  const raw = node.planBTitleCopy;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const copy = raw as Record<string, unknown>;
  const blocks = Array.isArray(copy.blocks) ? copy.blocks : [];
  const headline = String(copy.headline || '');
  if (!blocks.length && !headline) return {};
  return {
    planBTitleCopySummary: {
      blocks: blocks.length,
      headline: previewField(headline),
    },
  };
}

function shortenRoleKey(key: string): string {
  const matched = /^(.*):ref:(\d+):.+$/.exec(key);
  if (!matched) return key;
  return `${matched[1]}:ref:${matched[2]}`;
}

// roles 是结构不是正文，所以不共用摘要规则，也不进 sourcePromptMax。
// 它封顶是因为条数和键长都不为零。总长兜底不砍它。
function presentRoles(node: CanvasNodeSnapshot): Record<string, unknown> {
  const raw = node.roles;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const roles: Record<string, string> = {};
  let omitted = 0;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const short = shortenRoleKey(key);
    if (Object.prototype.hasOwnProperty.call(roles, short) || Object.keys(roles).length >= ROLE_CAP) {
      omitted += 1;
      continue;
    }
    roles[short] = String(value ?? '');
  }
  if (!Object.keys(roles).length && omitted === 0) return {};
  return {
    ...(Object.keys(roles).length ? { roles } : {}),
    ...(omitted > 0 ? { rolesOmitted: omitted } : {}),
  };
}

function upstreamNodes(snapshot: CanvasSnapshot, selectedIds: string[]): CanvasNodeSnapshot[] {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const seen = new Set(selectedIds);
  const queue = [...selectedIds];
  const result: CanvasNodeSnapshot[] = [];
  while (queue.length && result.length < 24) {
    const target = queue.shift()!;
    for (const edge of snapshot.connections) {
      if (edge.to !== target || seen.has(edge.from)) continue;
      seen.add(edge.from);
      queue.push(edge.from);
      const node = byId.get(edge.from);
      if (node) result.push(node);
    }
  }
  return result;
}

function canvasBounds(nodes: CanvasNodeSnapshot[]): Record<string, number> {
  if (!nodes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const left = Math.min(...nodes.map((node) => Number(node.x) || 0));
  const top = Math.min(...nodes.map((node) => Number(node.y) || 0));
  const right = Math.max(...nodes.map((node) => (Number(node.x) || 0) + (Number(node.w) || 300)));
  const bottom = Math.max(...nodes.map((node) => (Number(node.y) || 0) + (Number(node.h) || 240)));
  return { x: left, y: top, width: right - left, height: bottom - top };
}

function isNodeEnabled(node: CanvasNodeSnapshot): boolean {
  return Boolean(node) && !Boolean(node.disabled);
}

function compactAgentLastError(node: CanvasNodeSnapshot): { message: string; at?: number } | null {
  const raw = node.agentLastError;
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as { message?: unknown; at?: unknown };
  const message = compactText(record.message, 200);
  if (!message) return null;
  const at = Number(record.at);
  return Number.isFinite(at) ? { message, at } : { message };
}

function presentAgentSources(
  node: CanvasNodeSnapshot,
  sourcePromptMax?: number,
): Record<string, unknown> {
  if (!Array.isArray(node.agentSources)) return {};
  if (sourcePromptMax == null) return { agentSources: node.agentSources };
  return {
    agentSources: node.agentSources.map((source) => {
      if (!source || typeof source !== 'object') return source;
      const prompt = typeof source.prompt === 'string' ? source.prompt : '';
      if (prompt.length <= sourcePromptMax) return source;
      return { ...source, prompt: `${prompt.slice(0, sourcePromptMax)}${SOURCE_PROMPT_OMISSION}` };
    }),
  };
}

// 上界是走这刀的字段里最长的那一个：agentSources.prompt 和 shots[].prompt。
// 不是固定 12288。摘要和 roles 体积恒定或不按正文截，不含在这里。
function longestSourcePrompt(nodes: CanvasNodeSnapshot[]): number {
  let max = 0;
  const bump = (value: unknown) => {
    if (typeof value === 'string' && value.length > max) max = value.length;
  };
  for (const node of nodes) {
    if (Array.isArray(node.agentSources)) {
      for (const source of node.agentSources) {
        bump(source && typeof source === 'object' ? (source as { prompt?: unknown }).prompt : '');
      }
    }
    for (const row of shotRows(node) || []) bump(row.prompt);
  }
  return max;
}

function compactSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const keep = ['style', 'globalStyle', 'aspectRatio', 'aspect_ratio', 'ratio', 'theme'];
  return Object.fromEntries(
    keep
      .filter((key) => settings[key] !== undefined)
      .map((key) => [key, settings[key]]),
  );
}

export function collectCanvasContext(
  snapshot: CanvasSnapshot,
  opts?: { upstream?: CanvasNodeSnapshot[]; upstreamTextMax?: number; sourcePromptMax?: number },
): CanvasContextPayload {
  const selected = snapshot.nodes.filter((node) => snapshot.selectedNodeIds.includes(node.id));
  const lineage = opts?.upstream || upstreamNodes(snapshot, snapshot.selectedNodeIds);
  const upstreamTextMax = opts?.upstreamTextMax ?? UPSTREAM_TEXT_MAX;
  const sourcePromptMax = opts?.sourcePromptMax;
  const compactWithFreshness = (node: CanvasNodeSnapshot, textMax = MAX_TEXT) => {
    const lastError = compactAgentLastError(node);
    return {
      ...compactNode(node, textMax),
      ...presentShots(node, sourcePromptMax),
      ...presentAgentSources(node, sourcePromptMax),
      lifecycle: nodeLifecycle(node),
      ...(rebuildCount(node) ? { rebuildCount: rebuildCount(node) } : {}),
      ...(node.agentStale
        ? {
            stale: true,
            staleReason: compactText(node.agentStaleReason),
            impactPath: node.agentImpactPath,
          }
        : {}),
      ...(lastError ? { agentLastError: lastError } : {}),
      ...(Array.isArray(node.agentParamClamped) && node.agentParamClamped.length
        ? { agentParamClamped: node.agentParamClamped }
        : {}),
    };
  };
  const impacts = downstreamImpactPaths(snapshot, snapshot.selectedNodeIds);
  return {
    activeSelectedNodes: selected.map((node) => compactWithFreshness(node)),
    upstreamLineage: lineage.map((node) => ({
      ...compactWithFreshness(node, upstreamTextMax),
      enabled: isNodeEnabled(node),
    })),
    canvasSummary: {
      canvasId: snapshot.canvasId,
      nodeCount: snapshot.nodes.length,
      edgeCount: snapshot.connections.length,
      viewport: snapshot.viewport,
      viewportCenter: snapshot.viewportCenter,
      bounds: canvasBounds(snapshot.nodes),
      settings: compactSettings(snapshot.settings),
      staleNodeCount: snapshot.nodes.filter((node) => node.agentStale).length,
      mediaRefs: mentionCandidates(snapshot).slice(0, 16),
      selectedImpactPaths: impacts.slice(0, 24),
    },
    connections: snapshot.connections.map((edge) => [edge.from, edge.to] as [string, string]),
    ...(snapshot.availableModels ? { availableModels: snapshot.availableModels } : {}),
    ...presentAvailableAssets(snapshot.availableAssets),
  };
}

export function serializeCanvasContext(snapshot: CanvasSnapshot): string {
  // 猜错的后果是产出质量差一档，用户看得见、能重跑。
  // 和 stale 不清、时序断裂、DOM 覆盖那类静默坏产出不同，所以不升级成门禁。
  // 如果真实验收发现模型仍然瞎猜，升级路径是加 ambiguous: true 字段，不是加提示词。
  const direction = 'connections 为 [from, to] 对，from 是上游产出节点，to 是消费该产出的下游节点。生成时 to 节点读取 from 节点的产出。agentSources 是该节点生成时会用到的来源摘要，顺序即消费顺序，视频节点的首尾帧按此顺序取。upstreamLineage 包含所有连到选中节点的上游，包括已禁用的。enabled 为 false 的上游不会参与生成，agentSources 里不会出现它们。agentLastError 表示该节点上一次执行失败。后台任务可能仍在运行并稍后写回产出。不要因为这个字段重建节点；如需确认，检查它的产出。如果一个节点同时满足：lifecycle 为 created、有产出、且带 agentLastError——那是上次执行超时后后台把产出写回来了。这个节点的产出是新的，不要重建，也不要因为它是 created 就重跑。agentLastError 里如果出现「可选值见上下文的 availableModels」，说明该节点上次因模型值无效被拒绝。换一个 availableModels 里列出的值重新提交即可，不需要重建节点。availableModels 是当前配置的可选模型清单，按 image / chat / video 分组。填 model 时只能用对应分组的值；不在清单里的图片/文本模型会被拒绝，视频模型由服务端判断。availableAssets 是用户素材库的内容，带可直接使用的 url。要用某个素材当参考图：建一个 image 节点、把 url 填进 initialParams.url、再连到生成节点。不要把 url 写进生成节点的 initialParams——生成节点运行时不读节点上的 reference_images，参考图只从已连接的上游节点来。当有多个候选、而上下文信息不足以区分用户指的是哪一个时，先问用户，不要猜。适用于：availableAssets 里 name 和 category 相同的多条素材；roles 里有多张图片、而用户没有指明哪张是构图参考时。或者您可以描述一下您想复刻的那张图的主体，我来帮您判断该标成 background 还是 character。agentParamClamped 表示某个参数被供应商取值范围改掉了。原值不是模型填错，是目标模型不支持该值。需要更短的时长或别的分辨率时，换一个支持该值的模型，或向用户说明参数会随之变化。';
  const upstream = upstreamNodes(snapshot, snapshot.selectedNodeIds);
  let kept = upstream.slice();
  let omitted = 0;
  let sourcePromptMax: number | undefined;
  const pack = (upstreamTextMax: number) => {
    const marker = omitted > 0 ? `\n[已省略 ${omitted} 个未展开的节点，需要时用工具查询]` : '';
    const header = `## Current canvas context\n${direction}\n\`\`\`json\n`;
    const footer = `\n\`\`\`${marker}`;
    const json = JSON.stringify(
      collectCanvasContext(snapshot, { upstream: kept, upstreamTextMax, sourcePromptMax }),
    );
    return { text: `${header}${json}${footer}`, json };
  };
  let packed = pack(MAX_TEXT);
  // 优先级：上游正文 900 → 200 → 截断 agentSources.prompt 和 shots[].prompt（留结构，超长正文改成带省略标记；cap 为 0 时丢掉 shots）→ 仍超再从末尾丢上游节点。
  // connections、availableModels、availableAssets、来源结构、refLooksSummary、planBTitleCopySummary、roles 不截。选中节点自己的来源正文不在上游节点上，先丢节点砍不到它。
  if (packed.text.length > MAX_CONTEXT) packed = pack(UPSTREAM_TEXT_MAX);
  if (packed.text.length > MAX_CONTEXT) {
    const selected = snapshot.nodes.filter((node) => snapshot.selectedNodeIds.includes(node.id));
    let lo = 0;
    let hi = longestSourcePrompt([...selected, ...kept]);
    let bestMax = 0;
    sourcePromptMax = 0;
    let best = pack(UPSTREAM_TEXT_MAX);
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      sourcePromptMax = mid;
      const trial = pack(UPSTREAM_TEXT_MAX);
      if (trial.text.length <= MAX_CONTEXT) {
        best = trial;
        bestMax = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    sourcePromptMax = bestMax;
    packed = best;
  }
  while (packed.text.length > MAX_CONTEXT && kept.length) {
    kept = kept.slice(0, -1);
    omitted += 1;
    packed = pack(UPSTREAM_TEXT_MAX);
  }
  return packed.text;
}
