/**
 * 会话压缩：只保留最近 N 轮原文；更早的只压「用户答应过什么」：
 * 已确认决定、已约定偏好、关键取舍。
 * 节点状态/游标/todo 不压：它们在账本文件与 [task_state] 里，压进历史会重复且过期。
 */
export type HistoryTurn = { role: 'user' | 'assistant' | 'system'; content: string };

export type CompactedHistory = {
  kept: HistoryTurn[];
  digest: string;
};

const DIGEST_ITEM_MAX = 120;
const DIGEST_MAX = 1800;
const DEFAULT_KEEP_LAST = 16;

function clip(text: string, max: number): string {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function pushUnique(list: string[], value: string, limit = 10): void {
  const text = clip(value, DIGEST_ITEM_MAX);
  if (!text || list.includes(text) || list.length >= limit) return;
  list.push(text);
}

const DECISION_CUES = /确认|就用|用.{0,6}档|砍掉|保留|改成|定稿|同意|可以|按这个|没问题|授权|直接重做|采用|选/;
const PREFERENCE_CUES = /称呼|语言|回答风格|别问|直接说|简短|详细|中文|英文/;
const TRADEOFF_CUES = /因为|理由|取舍|为了|宁可不|原因|所以砍/;

export function compactHistory(
  turns: readonly HistoryTurn[],
  keepLast = DEFAULT_KEEP_LAST,
): CompactedHistory {
  const keep = Math.max(1, Math.floor(Number(keepLast) || DEFAULT_KEEP_LAST));
  if (turns.length <= keep) return { kept: [...turns], digest: '' };
  const older = turns.slice(0, turns.length - keep);
  const kept = turns.slice(turns.length - keep);
  const decisions: string[] = [];
  const preferences: string[] = [];
  const tradeoffs: string[] = [];
  for (const turn of older) {
    if (turn.role !== 'user') continue;
    const text = clip(turn.content, 400);
    if (TRADEOFF_CUES.test(text)) pushUnique(tradeoffs, text, 6);
    else if (PREFERENCE_CUES.test(text)) pushUnique(preferences, text, 6);
    else if (DECISION_CUES.test(text)) pushUnique(decisions, text, 10);
  }
  if (!decisions.length && !preferences.length && !tradeoffs.length) {
    // 没有明确决定时，保留最早与最近的用户发言，避免整段历史凭空消失。
    const users = older.filter((turn) => turn.role === 'user');
    for (const turn of [users[0], users[users.length - 1]].filter(Boolean)) {
      pushUnique(decisions, turn.content, 2);
    }
  }
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const lines = [
    `[history_summary] 本块记录截至 ${now} 的已确认决定。`,
    '如果它和更晚的消息、工具结果或账本文件冲突，以更晚的为准。',
    '',
  ];
  if (decisions.length) lines.push('已确认决定：', ...decisions.map((item) => `- ${item}`), '');
  if (preferences.length) lines.push('已约定偏好：', ...preferences.map((item) => `- ${item}`), '');
  if (tradeoffs.length) lines.push('关键取舍：', ...tradeoffs.map((item) => `- ${item}`), '');
  let digest = lines.join('\n').trim();
  if (digest.length > DIGEST_MAX) digest = `${digest.slice(0, DIGEST_MAX)}…（更早的略）`;
  return { kept, digest };
}
