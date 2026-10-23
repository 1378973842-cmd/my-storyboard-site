import type { AgentMemoryRow } from '../server/agentMemoryStore';

/**
 * 项目记忆进 prompt 的形状。只带最近的事实，不做语义检索：
 * 先让「跨会话记得住」成立，再谈 embedding。
 */
export function memoryPromptPrefix(
  facts: ReadonlyArray<Pick<AgentMemoryRow, 'kind' | 'key' | 'value'>>,
  limit = 12,
): string {
  const rows = facts
    .map((item) => ({
      kind: item.kind === 'preference' ? '偏好' : '事实',
      key: String(item.key || '').trim(),
      value: String(item.value || '').trim(),
    }))
    .filter((item) => item.key && item.value)
    .slice(0, Math.max(0, limit));
  if (!rows.length) return '';
  return `\n\n[project_memory]\n${rows.map((item) => `- ${item.kind}｜${item.key}：${item.value}`).join('\n')}`;
}

/**
 * 关键词命中：中文不切词，按整段和分片两种方式匹配。
 * 先做能解释的检索，不做 embedding。
 */
export function searchMemoryHits(
  facts: ReadonlyArray<Pick<AgentMemoryRow, 'kind' | 'key' | 'value'>>,
  query: string,
  limit = 5,
): Array<Pick<AgentMemoryRow, 'kind' | 'key' | 'value'>> {
  const text = String(query || '').trim();
  if (!text) return [];
  const tokens = new Set<string>();
  text.split(/[\s,，。；;、:：!！?？()（）\[\]【】]+/).forEach((part) => {
    const token = part.trim();
    if (token.length >= 2) tokens.add(token);
  });
  if (text.length >= 2 && text.length <= 24) tokens.add(text);
  if (!tokens.size) return [];
  const scored = facts
    .map((item) => {
      const haystack = `${item.key} ${item.value}`;
      let score = 0;
      tokens.forEach((token) => {
        if (haystack.includes(token)) score += 1;
      });
      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.item);
}

export function memoryHitsPrompt(
  hits: ReadonlyArray<Pick<AgentMemoryRow, 'kind' | 'key' | 'value'>>,
): string {
  if (!hits.length) return '';
  return `\n\n[memory_hits]\n${hits
    .map((item) => `- ${item.kind === 'preference' ? '偏好' : '事实'}｜${item.key}：${item.value}`)
    .join('\n')}`;
}
