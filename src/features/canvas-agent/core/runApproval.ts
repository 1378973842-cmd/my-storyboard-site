import type { CanvasEdgeSnapshot, CanvasNodeSnapshot } from '../types';

/**
 * 审批卡发出去那一刻，用户看到的节点内容。
 * 位置、选中、运行态、保存态都不进指纹：它们变了不代表「要跑的东西」变了。
 * 产物字段（url 这类）不在目标节点的指纹里：后台写回产出会让等待中的卡瞬间失效。
 */
const CONTENT_KEYS = ['prompt', 'text', 'model', 'duration', 'references', 'fidelity', 'shots'] as const;
/** 上游节点的产出也决定这次跑出来什么，所以上游多算几个产物字段。 */
const UPSTREAM_OUTPUT_KEYS = ['url', 'imageUrl', 'videoUrl'] as const;

export type RunScope = {
  nodeIds: string[];
  digest: string;
};

function contentOf(
  node: CanvasNodeSnapshot | undefined,
  extraKeys: readonly string[] = [],
): Record<string, unknown> | null {
  if (!node) return null;
  const content: Record<string, unknown> = {};
  for (const key of [...CONTENT_KEYS, ...extraKeys]) {
    if (node[key] !== undefined) content[key] = node[key];
  }
  return content;
}

/** 缺节点写 null：这张卡指向的节点还没落板，落板后要重新记一次。 */
export function runScopeDigest(
  nodes: readonly CanvasNodeSnapshot[],
  nodeIds: readonly string[],
  connections: readonly CanvasEdgeSnapshot[] = [],
): string {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parts = [...nodeIds].sort().map((id) => {
    const node = byId.get(id);
    const parents = connections
      .filter((edge) => edge.to === id)
      .map((edge) => edge.from)
      .sort()
      .map((parentId) => [
        parentId,
        byId.get(parentId)?.type || '',
        contentOf(byId.get(parentId), UPSTREAM_OUTPUT_KEYS),
      ]);
    return [id, node ? node.type : '', contentOf(node), parents];
  });
  return JSON.stringify(parts);
}

/**
 * 只有节点集一致、目标内容没变、上游也没变，这张卡才还代表用户当时看到的内容。
 * 刷新后内存里没有这份记录，旧卡自然不成立。
 */
export function runScopeMatches(
  scope: RunScope | undefined,
  nodes: readonly CanvasNodeSnapshot[],
  nodeIds: readonly string[],
  connections: readonly CanvasEdgeSnapshot[] = [],
): boolean {
  if (!scope) return false;
  const expected = [...scope.nodeIds].sort();
  const actual = [...nodeIds].sort();
  if (expected.length !== actual.length) return false;
  if (expected.some((id, index) => id !== actual[index])) return false;
  return scope.digest === runScopeDigest(nodes, scope.nodeIds, connections);
}

/** 没有放行就只留结构动作；有放行也只跑卡上列出的那些节点。 */
export function actionsReleasedForApproval<T extends { type: string; nodeId?: string }>(
  actions: readonly T[],
  released: ReadonlySet<string>,
): T[] {
  return actions.filter((action) => (
    action.type !== 'execute_node_skill'
    || Boolean(action.nodeId && released.has(action.nodeId))
  ));
}
