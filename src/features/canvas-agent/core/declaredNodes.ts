/**
 * 账本里声明的节点 id 只有一种可信状态：画布上真实存在。
 * 三处调用同一个解析/比对，避免规则多份实现后漏一处。
 */
export type CanvasNodeLike = {
  id?: unknown;
  type?: unknown;
};

export function declaredNodeIds(artifactText: string): string[] {
  const ids = [...String(artifactText || '').matchAll(/节点[：:]\s*([A-Za-z0-9_-]+)/g)]
    .map((match) => String(match[1] || '').trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

export function missingDeclaredNodes(
  artifactText: string,
  canvasNodes: CanvasNodeLike[],
): string[] {
  const declared = declaredNodeIds(artifactText);
  const existing = new Set(
    (Array.isArray(canvasNodes) ? canvasNodes : [])
      .filter((node) => node.type === 'generator' || node.type === 'image')
      .map((node) => String(node.id || ''))
      .filter(Boolean),
  );
  return declared.filter((id) => !existing.has(id));
}

export function missingNodeIds(
  nodeIds: string[],
  canvasNodes: CanvasNodeLike[],
): string[] {
  const existing = new Set(
    (Array.isArray(canvasNodes) ? canvasNodes : [])
      .filter((node) => node.type === 'generator' || node.type === 'image')
      .map((node) => String(node.id || ''))
      .filter(Boolean),
  );
  return [...new Set(nodeIds.map(String).filter(Boolean))].filter((id) => !existing.has(id));
}
