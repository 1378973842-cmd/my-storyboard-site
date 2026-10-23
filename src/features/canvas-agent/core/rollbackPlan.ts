import type { CanvasAction } from '../types';

export type CanvasNodeRecord = Record<string, unknown> & { id: string };
export type CanvasEdgeRecord = { id: string; from: string; to: string };

export type RollbackInput = {
  before: { nodes: CanvasNodeRecord[]; connections: CanvasEdgeRecord[] };
  current: { nodes: CanvasNodeRecord[]; connections: CanvasEdgeRecord[] };
  actions: CanvasAction[];
  /** 这份提案真正创建出来的节点 id（apply 后由 effectedNodes 记下） */
  createdNodeIds: string[];
};

export type RollbackPlan = {
  nodes: CanvasNodeRecord[];
  connections: CanvasEdgeRecord[];
  summary: {
    removedNodes: string[];
    restoredNodes: string[];
    removedEdges: number;
    restoredEdges: number;
  };
};

function edgeKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/**
 * 只回滚这份提案碰过的东西：
 * - 它建的节点删掉；
 * - 它改过/跑过的节点恢复成 apply 前的版本（位置也一起回去）；
 * - 它连的边删掉，apply 前就有的边补回来。
 * 没碰过的节点和边原样保留，之后的其它编辑不会被整布覆盖。
 */
export function rollbackCanvasPlan(input: RollbackInput): RollbackPlan {
  const created = new Set(input.createdNodeIds.filter(Boolean));
  const touchedNodes = new Set<string>();
  const touchedEdges = new Set<string>();
  input.actions.forEach((action) => {
    if (action.type === 'create_node' && action.tempId) created.add(action.tempId);
    if (action.type === 'update_node_params' || action.type === 'execute_node_skill') {
      touchedNodes.add(action.nodeId);
    }
    if (action.type === 'connect_nodes') {
      touchedNodes.add(action.sourceNodeId);
      touchedNodes.add(action.targetNodeId);
      touchedEdges.add(edgeKey(action.sourceNodeId, action.targetNodeId));
    }
  });

  const beforeNodes = new Map(input.before.nodes.map((node) => [node.id, node]));
  const currentIds = new Set(input.current.nodes.map((node) => node.id));
  const removedNodes: string[] = [];
  const restoredNodes: string[] = [];

  const nodes: CanvasNodeRecord[] = [];
  input.current.nodes.forEach((node) => {
    if (created.has(node.id)) {
      removedNodes.push(node.id);
      return;
    }
    const previous = beforeNodes.get(node.id);
    if (previous && touchedNodes.has(node.id)) {
      nodes.push(previous);
      restoredNodes.push(node.id);
      return;
    }
    nodes.push(node);
  });
  // apply 时删掉、但快照里存在的、且这份提案碰过的节点：补回来
  beforeNodes.forEach((node, id) => {
    if (currentIds.has(id) || created.has(id)) return;
    if (!touchedNodes.has(id)) return;
    nodes.push(node);
    restoredNodes.push(id);
  });

  const beforeEdges = new Map(
    input.before.connections.map((edge) => [edgeKey(edge.from, edge.to), edge]),
  );
  const removedNodeSet = new Set(removedNodes);
  const kept: CanvasEdgeRecord[] = [];
  let removedEdges = 0;
  input.current.connections.forEach((edge) => {
    const key = edgeKey(edge.from, edge.to);
    if (removedNodeSet.has(edge.from) || removedNodeSet.has(edge.to)) {
      removedEdges += 1;
      return;
    }
    // 这份提案连的、apply 前不存在的边：删掉
    if (touchedEdges.has(key) && !beforeEdges.has(key)) {
      removedEdges += 1;
      return;
    }
    kept.push(edge);
  });
  const keptKeys = new Set(kept.map((edge) => edgeKey(edge.from, edge.to)));
  let restoredEdges = 0;
  input.before.connections.forEach((edge) => {
    const key = edgeKey(edge.from, edge.to);
    if (keptKeys.has(key)) return;
    if (!touchedEdges.has(key)) return;
    kept.push(edge);
    keptKeys.add(key);
    restoredEdges += 1;
  });

  return {
    nodes,
    connections: kept,
    summary: { removedNodes, restoredNodes, removedEdges, restoredEdges },
  };
}
