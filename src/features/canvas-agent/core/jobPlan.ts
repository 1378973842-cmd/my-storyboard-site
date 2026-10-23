import type { CanvasAction } from '../types';

/** 提案里要跑的节点，按出现顺序去重。这就是这轮作业的步数。 */
export function runNodeIdsOf(actions: readonly CanvasAction[]): string[] {
  const ids: string[] = [];
  for (const action of actions) {
    if (action.type !== 'execute_node_skill') continue;
    const id = String(action.nodeId || '').trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

export function observedNodeIds(
  observations: ReadonlyArray<Record<string, unknown>> | undefined,
): Set<string> {
  const done = new Set<string>();
  for (const item of observations || []) {
    const nodeId = String(item?.nodeId || '').trim();
    if (!nodeId) continue;
    // 失败的节点也算「走过一步」：不重跑，交给用户判断。
    if (item?.outcome === 'applied' || item?.outcome === 'failed') done.add(nodeId);
  }
  return done;
}

/** 关页或中断之后，从第几步继续。 */
export function remainingRunNodes(
  runNodeIds: readonly string[],
  observations: ReadonlyArray<Record<string, unknown>> | undefined,
): string[] {
  const done = observedNodeIds(observations);
  return runNodeIds.filter((id) => !done.has(id));
}
