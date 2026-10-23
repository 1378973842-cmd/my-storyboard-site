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
