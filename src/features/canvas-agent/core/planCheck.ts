/**
 * 规划核对：把分镜表里的「原文」片段拼起来，和创作稿逐字比对。
 * 只做确定性检查，不调用模型；核对不过就不允许完成 review 步骤。
 */
export type StoryboardFragment = {
  source: string;
  duration?: number;
  line: number;
};

export type PlanCheckResult = {
  ok: boolean;
  fragments: number;
  entries: number;
  draftChars: number;
  storyboardChars: number;
  totalDuration: number;
  reason: string;
  detail: string;
};

function normalize(text: string): string {
  return String(text || '').replace(/\s+/g, '');
}

function stripQuotes(value: string): string {
  const text = String(value || '').trim();
  const pairs: Array<[string, string]> = [
    ['「', '」'],
    ['“', '”'],
    ['"', '"'],
    ['\'', '\''],
    ['`', '`'],
  ];
  for (const [left, right] of pairs) {
    if (text.startsWith(left) && text.endsWith(right) && text.length >= left.length + right.length) {
      return text.slice(left.length, text.length - right.length).trim();
    }
  }
  return text;
}

export function parseStoryboardFragments(storyboard: string): StoryboardFragment[] {
  const fragments: StoryboardFragment[] = [];
  const lines = String(storyboard || '').split(/\r?\n/);
  lines.forEach((line, index) => {
    const match = line.match(/(?:原文|source)\s*[:：]\s*(.+)$/i);
    if (!match) return;
    const source = stripQuotes(match[1]);
    if (!source) return;
    let duration: number | undefined;
    for (let offset = index; offset <= Math.min(index + 6, lines.length - 1); offset += 1) {
      const durationMatch = lines[offset].match(/(?:时长|duration)\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?/i);
      if (!durationMatch) continue;
      duration = Number(durationMatch[1]);
      break;
    }
    fragments.push({ source, duration, line: index + 1 });
  });
  return fragments;
}

function mismatchDetail(draft: string, joined: string): string {
  if (!joined) return '分镜表没有可核对的原文片段';
  if (draft.startsWith(joined)) return `分镜只写到创作稿的 ${joined.length}/${draft.length} 字，后面还有内容没登记`;
  if (joined.startsWith(draft)) return `分镜比创作稿多出 ${joined.length - draft.length} 字`;
  let index = 0;
  while (index < draft.length && index < joined.length && draft[index] === joined[index]) index += 1;
  const from = Math.max(0, index - 12);
  return `第 ${index + 1} 字开始不一致：创作稿「${draft.slice(from, index + 24)}」/ 分镜「${joined.slice(from, index + 24)}」`;
}

export function checkStoryboardAgainstDraft(draft: string, storyboard: string): PlanCheckResult {
  const draftText = normalize(draft);
  const fragments = parseStoryboardFragments(storyboard);
  const joined = normalize(fragments.map((item) => item.source).join(''));
  const totalDuration = fragments.reduce((sum, item) => sum + (item.duration || 0), 0);
  const durationLine = fragments.some((item) => item.duration !== undefined);
  const base = {
    fragments: fragments.length,
    entries: fragments.length,
    draftChars: draftText.length,
    storyboardChars: joined.length,
    totalDuration,
  };
  if (!draftText) {
    return { ...base, ok: false, reason: '创作稿为空', detail: '先写 draft.md，再核对' };
  }
  if (!fragments.length) {
    return { ...base, ok: false, reason: '分镜表缺少「原文：」片段', detail: '每条分镜用「原文：「…」」逐字写，才能核对' };
  }
  if (joined !== draftText) {
    return { ...base, ok: false, reason: '分镜原文片段拼起来不等于创作稿', detail: mismatchDetail(draftText, joined) };
  }
  if (!durationLine) {
    return { ...base, ok: false, reason: '分镜表缺少时长', detail: '每条分镜写「时长：N秒」，才能核对总时长与反碎化' };
  }
  const tooShort = fragments.filter((item) => (item.duration || 0) > 0 && (item.duration || 0) < 2);
  const shortNote = tooShort.length
    ? `；注意第 ${tooShort.map((item) => item.line).join('、')} 行短于 2 秒`
    : '';
  return {
    ...base,
    ok: true,
    reason: '逐字核对通过',
    detail: `${fragments.length} 条片段 / ${draftText.length} 字，总时长 ${totalDuration} 秒${shortNote}`,
  };
}
