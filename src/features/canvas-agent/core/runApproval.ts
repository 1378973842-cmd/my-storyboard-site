import type { CanvasNodeSnapshot } from '../types';

/**
 * 审批卡发出去那一刻，用户看到的节点内容。
 * 位置、选中、运行态、保存态都不进指纹：它们变了不代表「要跑的东西」变了。
 */
const CONTENT_KEYS = ['prompt', 'text', 'model', 'url', 'duration', 'references', 'fidelity', 'shots'] as const;

export type RunScope = {
  nodeIds: string[];
  digest: string;
};

function contentOf(node: CanvasNodeSnapshot | undefined): Record<string, unknown> | null {
  if (!node) return null;
  const content: Record<string, unknown> = {};
  for (const key of CONTENT_KEYS) {
    if (node[key] !== undefined) content[key] = node[key];
  }
  return content;
}

/** 缺节点写 null：这张卡指向的节点还没落板，落板后要重新记一次。 */
export function runScopeDigest(
  nodes: readonly CanvasNodeSnapshot[],
  nodeIds: readonly string[],
): string {
  const parts = [...nodeIds].sort().map((id) => {
    const node = nodes.find((item) => item.id === id);
    return [id, node ? node.type : '', contentOf(node)];
  });
  return JSON.stringify(parts);
}

/**
 * 只有节点集一致、且每个节点的生成输入没变过，这张卡才还代表用户当时看到的内容。
 * 刷新后内存里没有这份记录，旧卡自然不成立。
 */
export function runScopeMatches(
  scope: RunScope | undefined,
  nodes: readonly CanvasNodeSnapshot[],
  nodeIds: readonly string[],
): boolean {
  if (!scope) return false;
  const expected = [...scope.nodeIds].sort();
  const actual = [...nodeIds].sort();
  if (expected.length !== actual.length) return false;
  if (expected.some((id, index) => id !== actual[index])) return false;
  return scope.digest === runScopeDigest(nodes, scope.nodeIds);
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
