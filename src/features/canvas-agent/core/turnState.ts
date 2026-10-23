/** 每轮注入系统提示的会话事实：取消留痕、没答的提问卡。两条都只讲事实，不替用户做决定。 */
export function turnStatePrefix(input: {
  cancelled: boolean;
  pendingAsks: readonly string[];
}): string {
  const blocks: string[] = [];
  if (input.cancelled) {
    blocks.push('[user_cancelled]\n上一轮用户取消了，不要默默续跑原计划；把下一条消息当新指示。');
  }
  const questions = input.pendingAsks.map((item) => String(item || '').trim()).filter(Boolean);
  if (questions.length) {
    blocks.push(
      `[unanswered_asks]\n上一轮的提问卡还没有答复：${questions.map((item) => `「${item}」`).join('、')}。`
      + '没答不等于同意，不要替用户按默认值继续，也不要重复问同一件事。',
    );
  }
  return blocks.length ? `\n\n${blocks.join('\n\n')}` : '';
}
