import type { CanvasAction, CanvasNodeSnapshot } from '../types';
import { actionReasonText } from './proposal';

// 本会话落板后还在的节点。语义名按 title、floatTitle、name，文件名不算。
// 都没有才用提案 reason。再没有就只留类型和 id，不编名字。
export type EffectedNode = {
  id: string;
  nodeType: string;
  label?: string;
};

const MEDIA_OUTPUT_KEYS = ['url', 'imageUrl', 'videoUrl', 'generatedOutputs', 'history'] as const;

function readable(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || /\.(jpe?g|png|webp|gif|bmp|mp4|webm|mov|m4v|mkv)$/i.test(text)) return '';
  return text;
}

export function semanticEffectLabel(
  node: Record<string, unknown> | undefined,
  reason?: string,
): string {
  const label = readable(node?.title) || readable(node?.floatTitle) || readable(node?.name) || readable(reason);
  return label.slice(0, 80);
}

export function parseEffectedNodes(raw: unknown): EffectedNode[] {
  const list = typeof raw === 'string' ? (() => {
    try { return JSON.parse(raw); } catch { return []; }
  })() : raw;
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const nodes: EffectedNode[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const record = item as { id?: unknown; nodeType?: unknown; label?: unknown };
    const id = String(record.id || '').trim();
    const nodeType = String(record.nodeType || '').trim();
    if (!id || !nodeType || seen.has(id)) continue;
    seen.add(id);
    const label = semanticEffectLabel(undefined, typeof record.label === 'string' ? record.label : '');
    nodes.push({ id, nodeType, ...(label ? { label } : {}) });
  }
  return nodes;
}

export function mergeEffectedNodes(current: readonly EffectedNode[], incoming: readonly EffectedNode[]): EffectedNode[] {
  const map = new Map(current.map((node) => [node.id, node]));
  for (const node of incoming) {
    if (!node.id || !node.nodeType) continue;
    const prev = map.get(node.id);
    const label = node.label || prev?.label;
    map.set(node.id, { id: node.id, nodeType: node.nodeType, ...(label ? { label } : {}) });
  }
  return [...map.values()];
}

/** 清单每格一行：id | 类型 | 状态 | 名字。状态由浏览器按 mediaRunState 现算后随请求带来，和气泡标签同一个来源。 */
export function effectedLine(
  nodes: readonly EffectedNode[],
  states: Readonly<Record<string, MediaRunState>> = {},
): string {
  if (!nodes.length) return '';
  const rows = nodes.map((node) => [node.id, node.nodeType, ledgerStateLabel(node.nodeType, states[node.id]), node.label]
    .filter(Boolean)
    .join(' | '));
  return ['已生效清单：', ...rows].join('\n');
}

export function ledgerStateLabel(nodeType: string, state: MediaRunState | undefined): string {
  if (!state) return '不在画布上';
  if (isSavedTextNode(nodeType)) return '已保存';
  if (state === 'failed') return '执行失败';
  return state === 'generated' ? '已生成' : '已创建（未生成）';
}

/** 请求体里的三态表。只收已知的三种值，id 截断，最多 400 条。 */
export function parseRunStates(raw: unknown): Record<string, MediaRunState> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Record<string, MediaRunState> = {};
  for (const [id, value] of Object.entries(raw).slice(0, 400)) {
    if (value === 'created' || value === 'generated' || value === 'failed') out[id.slice(0, 120)] = value;
  }
  return out;
}

function resolveId(id: string, idMap: Record<string, string>): string {
  const key = id.trim();
  return idMap[key] || key;
}

export function effectedFromApply(
  actions: readonly CanvasAction[],
  idMap: Record<string, string>,
  nodes: readonly CanvasNodeSnapshot[],
): EffectedNode[] {
  const incoming: EffectedNode[] = [];
  for (const action of actions) {
    if (action.type !== 'create_node') continue;
    const id = resolveId(String(action.tempId || ''), idMap);
    if (!id) continue;
    const node = nodes.find((item) => item.id === id);
    const label = semanticEffectLabel(
      node || {
        title: action.initialParams?.title,
        floatTitle: action.initialParams?.floatTitle,
        name: action.initialParams?.name,
      },
      actionReasonText(action),
    );
    incoming.push({ id, nodeType: action.nodeType, ...(label ? { label } : {}) });
  }
  return mergeEffectedNodes([], incoming);
}

export function changelogFromActions(actions: readonly CanvasAction[], idMap: Record<string, string>): string {
  const lines: string[] = [];
  for (const action of actions) {
    if (action.type === 'create_node') {
      lines.push(`createNode: ${resolveId(String(action.tempId || ''), idMap)}（${action.nodeType}）`);
    } else if (action.type === 'update_node_params') {
      lines.push(`updateNode: ${resolveId(action.nodeId, idMap)}`);
    } else if (action.type === 'execute_node_skill') {
      lines.push(`executeNode: ${resolveId(action.nodeId, idMap)}`);
    }
  }
  const connects = actions.filter((action) => action.type === 'connect_nodes');
  if (connects.length) {
    const detail = connects.map((action) => (
      action.type === 'connect_nodes'
        ? `${resolveId(action.sourceNodeId, idMap)} → ${resolveId(action.targetNodeId, idMap)}`
        : ''
    )).filter(Boolean).join(', ');
    lines.push(`connectNodes: ${connects.length} 条（${detail}）`);
  }
  return lines.join('\n');
}

export function isSavedTextNode(nodeType: string): boolean {
  return nodeType === 'text' || nodeType === 'prompt';
}

export function mediaOutputUrls(node: CanvasNodeSnapshot | undefined): string[] {
  if (!node) return [];
  const values: string[] = [];
  for (const key of MEDIA_OUTPUT_KEYS) {
    const value = node[key];
    const push = (raw: unknown) => {
      const text = typeof raw === 'string' ? raw.trim() : '';
      if (text && !text.startsWith('blob:')) values.push(text);
    };
    if (typeof value === 'string') push(value);
    if (Array.isArray(value)) {
      for (const item of value) {
        push(typeof item === 'string' ? item : (item as { url?: unknown; image_url?: unknown; video_url?: unknown } | null)?.url
          || (item as { image_url?: unknown } | null)?.image_url
          || (item as { video_url?: unknown } | null)?.video_url);
      }
    }
  }
  return [...new Set(values)];
}

export type MediaRunState = 'created' | 'generated' | 'failed';

export function mediaRunState(node: CanvasNodeSnapshot | undefined): MediaRunState {
  if (!node) return 'created';
  const raw = node.agentLastError;
  const message = raw && typeof raw === 'object'
    ? String((raw as { message?: unknown }).message || '').trim()
    : '';
  if (message || String(node.runError || '').trim()) return 'failed';
  if (mediaOutputUrls(node).length) return 'generated';
  return 'created';
}

export function mediaStatusLabel(nodeType: string, state: MediaRunState): string {
  if (isSavedTextNode(nodeType)) return '创作文本已保存';
  if (state === 'failed') return '执行失败';
  if (nodeType === 'video') return state === 'generated' ? '视频已生成' : '视频节点已创建';
  return state === 'generated' ? '图片已生成' : '图片节点已创建';
}

export function turnLabelCollapsed(kind: 'thinking' | 'tools' | 'media' | 'asked' | 'file' | 'failed'): boolean {
  return kind === 'thinking' || kind === 'tools';
}
