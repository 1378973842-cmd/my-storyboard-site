/**
 * 会话压缩：只保留最近 N 轮原文，更早的折成一行一条摘要。
 * 不调模型——摘要只记「谁说了什么」，不编造内容。
 */
export type HistoryTurn = { role: 'user' | 'assistant'; content: string };

export type CompactedHistory = {
  kept: HistoryTurn[];
  digest: string;
};

const DIGEST_ITEM_MAX = 60;
const DIGEST_MAX = 1600;

function clip(text: string, max: number): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

export function compactHistory(
  turns: readonly HistoryTurn[],
  keepLast = 10,
): CompactedHistory {
  const keep = Math.max(1, Math.floor(Number(keepLast) || 10));
  if (turns.length <= keep) return { kept: [...turns], digest: "" };
  const older = turns.slice(0, turns.length - keep);
  const kept = turns.slice(turns.length - keep);
  const lines = older.map((turn) => (
    `- ${turn.role === 'user' ? '用户' : '助手'}：${clip(turn.content, DIGEST_ITEM_MAX)}`
  ));
  let digest = `更早的对话（${older.length} 条）：\n${lines.join('\n')}`;
  if (digest.length > DIGEST_MAX) {
    digest = `${digest.slice(0, DIGEST_MAX)}…（更早的略）`;
  }
  return { kept, digest };
}
