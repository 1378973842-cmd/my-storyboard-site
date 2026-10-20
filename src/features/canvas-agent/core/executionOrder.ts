import type { CanvasAction, CanvasSnapshot, ExecuteNodeSkillAction } from '../types';

function resolvedExecutionIds(
  executions: ExecuteNodeSkillAction[],
  resolveId: (nodeId: string) => string,
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const action of executions) {
    const id = resolveId(action.nodeId);
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function executionPrecedenceEdges(
  executions: ExecuteNodeSkillAction[],
  snapshot: CanvasSnapshot,
  guarded: CanvasAction[],
  resolveId: (nodeId: string) => string,
): Array<[string, string]> {
  const members = new Set(resolvedExecutionIds(executions, resolveId));
  const edges: Array<[string, string]> = [];
  const seen = new Set<string>();
  const add = (fromRaw: string, toRaw: string) => {
    const from = resolveId(String(fromRaw || ''));
    const to = resolveId(String(toRaw || ''));
    if (!members.has(from) || !members.has(to)) return;
    const key = `${from}\0${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push([from, to]);
  };
  for (const edge of snapshot.connections) add(edge.from, edge.to);
  for (const action of guarded) {
    if (action.type !== 'connect_nodes') continue;
    add(action.sourceNodeId, action.targetNodeId);
  }
  return edges;
}

function findExecutionCycle(memberIds: string[], edges: Array<[string, string]>): string[] | null {
  const adjacent = new Map<string, string[]>();
  for (const id of memberIds) adjacent.set(id, []);
  for (const [from, to] of edges) adjacent.get(from)?.push(to);
  const color = new Map<string, number>();
  const stack: string[] = [];
  const visit = (id: string): string[] | null => {
    const state = color.get(id) || 0;
    if (state === 2) return null;
    if (state === 1) {
      const start = stack.indexOf(id);
      return [...stack.slice(start < 0 ? 0 : start), id];
    }
    color.set(id, 1);
    stack.push(id);
    for (const next of adjacent.get(id) || []) {
      const found = visit(next);
      if (found) return found;
    }
    stack.pop();
    color.set(id, 2);
    return null;
  };
  for (const id of memberIds) {
    if (color.get(id)) continue;
    const found = visit(id);
    if (found) return found;
  }
  return null;
}

export function assertNoExecutionCycle(
  executions: ExecuteNodeSkillAction[],
  snapshot: CanvasSnapshot,
  guarded: CanvasAction[],
): void {
  const identity = (nodeId: string) => nodeId;
  const cycle = findExecutionCycle(
    resolvedExecutionIds(executions, identity),
    executionPrecedenceEdges(executions, snapshot, guarded, identity),
  );
  if (!cycle) return;
  throw new Error(`执行成环：${cycle.join(' → ')}。请修正后重新提交。`);
}

// cascade 不会重跑 gen→gen。上游还没有预览时 mediaRefsFromNode 为空，这是静默坏状态。
// 本批执行顺序由这个排序保证。依赖图必须包含 8-1 翻译出来的边。
export function sortBatchExecutions(
  executions: ExecuteNodeSkillAction[],
  snapshot: CanvasSnapshot,
  guarded: CanvasAction[],
  resolveId: (nodeId: string) => string,
): ExecuteNodeSkillAction[] {
  if (executions.length < 2) return executions.slice();
  const ids = executions.map((action) => resolveId(action.nodeId));
  const indexes = new Map<string, number[]>();
  ids.forEach((id, index) => {
    const list = indexes.get(id) || [];
    list.push(index);
    indexes.set(id, list);
  });
  const indegree = executions.map(() => 0);
  const next: number[][] = executions.map(() => []);
  for (const [from, to] of executionPrecedenceEdges(executions, snapshot, guarded, resolveId)) {
    if (from === to) continue;
    for (const source of indexes.get(from) || []) {
      for (const target of indexes.get(to) || []) {
        if (source === target) continue;
        next[source].push(target);
        indegree[target] += 1;
      }
    }
  }
  const ready: number[] = [];
  const queued = new Set<number>();
  indegree.forEach((degree, index) => {
    if (degree === 0) {
      ready.push(index);
      queued.add(index);
    }
  });
  const ordered: number[] = [];
  const placed = new Set<number>();
  while (ready.length) {
    const index = ready.shift() as number;
    ordered.push(index);
    placed.add(index);
    for (const target of next[index]) {
      indegree[target] -= 1;
      if (indegree[target] === 0 && !placed.has(target) && !queued.has(target)) {
        queued.add(target);
        const at = ready.findIndex((item) => item > target);
        if (at === -1) ready.push(target);
        else ready.splice(at, 0, target);
      }
    }
  }
  executions.forEach((_, index) => {
    if (!placed.has(index)) ordered.push(index);
  });
  return ordered.map((index) => executions[index]);
}
