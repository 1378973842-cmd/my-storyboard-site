import type {
  CanvasAction,
  CanvasNodeSnapshot,
  CanvasSnapshot,
  UpdateNodeParamsAction,
} from "../types";

// ponytail: output.images 不进这里。它是容器，不能按 url 判断；升级路径是单独看 output 节点。previewRoundUrls 只服务旧画布，加进来会把旧节点全部算成已生效。
const OUTPUT_KEYS = ["url", "imageUrl", "videoUrl", "audioUrl", "generatedOutputs", "history", "text", "outputText"];

export type ImpactPath = {
  nodeId: string;
  path: string[];
  hasGeneratedOutput: boolean;
};

export function upstreamDigest(snapshot: CanvasSnapshot, nodeId: string): string {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const upstream = snapshot.connections
    .filter((edge) => edge.to === nodeId)
    .sort((a, b) => `${a.from}:${a.id}`.localeCompare(`${b.from}:${b.id}`))
    .map((edge) => {
      const node = byId.get(edge.from);
      return {
        edge: edge.id,
        nodeId: edge.from,
        type: node?.type || "",
        outputs: nodeOutputIdentity(node),
      };
    });
  return fnv1a64(stableStringify(upstream));
}

export function downstreamImpactPaths(
  snapshot: CanvasSnapshot,
  rootIds: string[]
): ImpactPath[] {
  const byId = new Map(snapshot.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, string[]>();
  for (const edge of snapshot.connections) {
    const list = outgoing.get(edge.from) || [];
    if (!list.includes(edge.to)) list.push(edge.to);
    outgoing.set(edge.from, list);
  }
  const shortest = new Map<string, string[]>();
  const queue = rootIds.map((id) => [id]);
  while (queue.length) {
    const path = queue.shift()!;
    const current = path.at(-1)!;
    for (const next of outgoing.get(current) || []) {
      if (path.includes(next)) continue;
      const nextPath = [...path, next];
      if (shortest.has(next)) continue;
      shortest.set(next, nextPath);
      queue.push(nextPath);
    }
  }
  return [...shortest.entries()]
    .filter(([nodeId]) => !rootIds.includes(nodeId))
    .map(([nodeId, path]) => ({
      nodeId,
      path,
        hasGeneratedOutput: nodeHasGeneratedOutput(byId.get(nodeId)),
    }));
}

export function invalidationActions(
  snapshot: CanvasSnapshot,
  actions: CanvasAction[]
): UpdateNodeParamsAction[] {
  const createdTempIds = new Set(
    actions.flatMap((action) => (
      action.type === "create_node" && action.tempId ? [action.tempId] : []
    )),
  );
  const roots = new Set<string>();
  for (const action of actions) {
    if (action.type === "update_node_params") roots.add(action.nodeId);
    if (action.type !== "connect_nodes" || createdTempIds.has(action.targetNodeId)) continue;
    const target = snapshot.nodes.find((node) => node.id === action.targetNodeId);
    if (target && nodeHasGeneratedOutput(target)) roots.add(action.targetNodeId);
  }
  const impacts: ImpactPath[] = [
    ...[...roots]
      .filter((nodeId) => snapshot.nodes.some((node) => node.id === nodeId))
      .map((nodeId) => ({
        nodeId,
        path: [nodeId],
        hasGeneratedOutput: nodeHasGeneratedOutput(snapshot.nodes.find((node) => node.id === nodeId)),
      })),
    ...downstreamImpactPaths(snapshot, [...roots]),
  ];
  return impacts.map((impact) => ({
    type: "update_node_params",
    nodeId: impact.nodeId,
    patch: {
      agentStale: true,
      agentStaleReason: impact.path.length > 1
        ? `上游已变更：${impact.path.join(" → ")}`
        : "节点参数或输入引用已变更",
      agentImpactPath: impact.path,
    },
  }));
}

export function nodeHasGeneratedOutput(node: CanvasNodeSnapshot | undefined): boolean {
  return nodeOutputIdentity(node).length > 0;
}

function nodeOutputIdentity(node: CanvasNodeSnapshot | undefined): string[] {
  if (!node) return [];
  const values: string[] = [];
  for (const key of OUTPUT_KEYS) {
    const value = node[key];
    if (typeof value === "string" && value.trim()) values.push(value.trim());
    if (Array.isArray(value)) {
      for (const item of value) {
        const text = typeof item === "string"
          ? item
          : String(item?.url || item?.image_url || item?.video_url || "");
        if (text.trim()) values.push(text.trim());
      }
    }
  }
  return [...new Set(values)].sort();
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}
