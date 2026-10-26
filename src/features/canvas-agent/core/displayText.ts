/**
 * 聊天正文里如果模型写了 {{node-id}}，显示时换成人能读的名字。
 * 生成提示词里的 token 不动，只处理展示层。
 */
export function replaceNodeTokens(
  text: string,
  nodes: ReadonlyArray<Record<string, unknown> & { id: string; type?: string }>,
): string {
  if (!text.includes('{{')) return text;
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  return text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (raw, id: string) => {
    const node = byId.get(String(id));
    if (!node) return raw;
    const title = String((node as { title?: unknown }).title || '').trim();
    if (title) return title;
    const name = String((node as { name?: unknown }).name || '').trim();
    if (name) return name;
    if (node.type === 'image') return '参考图';
    if (node.type === 'video') return '视频';
    if (node.type === 'audio') return '音频';
    return '节点';
  });
}
