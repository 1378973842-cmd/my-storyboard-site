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
  durationTarget: number | null;
  productionSegments: number[];
  capacityModel: string | null;
  capacityMax: number | null;
  reason: string;
  detail: string;
};

export type ModelCapacity = { model: string; min: number; max: number };

export function parseModelCapacities(text: string): ModelCapacity[] {
  const rows: ModelCapacity[] = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const table = line.match(/^\|\s*([^|]+?)\s*\|\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\|\s*(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*\|/i);
    if (table && !/^\s*(模型|model)\s*$/i.test(table[1])) {
      // duration.md 表形状：| 模型 | 上限 | 下限 |
      rows.push({ model: table[1].trim(), max: Number(table[2]), min: Number(table[3]) });
      continue;
    }
    const bullet = line.match(/(?:^|\s)([^：:]{2,30})[：:]\s*单次\s*(\d+(?:\.\d+)?)\s*[-–~]\s*(\d+(?:\.\d+)?)\s*(?:s|秒)/i);
    if (bullet) rows.push({ model: bullet[1].trim(), min: Number(bullet[2]), max: Number(bullet[3]) });
  }
  return rows;
}

function resolveCapacity(indexText: string, capacityText: string): ModelCapacity | null {
  const capacities = parseModelCapacities(capacityText);
  if (!capacities.length) return null;
  const modelMatch = String(indexText || '').match(/(?:选定模型|模型)\s*[:：]\s*([^\n|]+)/i);
  const model = modelMatch ? modelMatch[1].trim() : '';
  if (model) {
    const matched = capacities.find((item) => model.includes(item.model) || item.model.includes(model));
    if (matched) return matched;
  }
  return capacities.reduce((best, item) => (item.max > best.max ? item : best), capacities[0]);
}

function parseDurationTarget(indexText: string): number | null {
  const match = String(indexText || '').match(/(?:用户要求时长|要求时长|目标时长)\s*[:：]\s*(\d+(?:\.\d+)?)\s*(?:秒|s)?/i);
  return match ? Number(match[1]) : null;
}

function parseProductionSegments(indexText: string): number[] {
  const text = String(indexText || '');
  const start = text.search(/制作清单/);
  if (start < 0) return [];
  const block = text.slice(start).split(/\r?\n/).slice(1);
  const durations: number[] = [];
  for (const line of block) {
    if (/^#{1,3}\s/.test(line)) break;
    const match = line.match(/(\d+(?:\.\d+)?)\s*(?:秒|s)/i);
    if (match) durations.push(Number(match[1]));
  }
  return durations;
}

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

export function checkStoryboardAgainstDraft(
  draft: string,
  storyboard: string,
  indexText = '',
  capacityText = '',
): PlanCheckResult {
  const draftText = normalize(draft);
  const fragments = parseStoryboardFragments(storyboard);
  const joined = normalize(fragments.map((item) => item.source).join(''));
  const totalDuration = fragments.reduce((sum, item) => sum + (item.duration || 0), 0);
  const durationLine = fragments.some((item) => item.duration !== undefined);
  const durationTarget = parseDurationTarget(indexText);
  const productionSegments = parseProductionSegments(indexText);
  const capacity = resolveCapacity(indexText, capacityText);
  const allCapacities = parseModelCapacities(capacityText);
  const base = {
    fragments: fragments.length,
    entries: fragments.length,
    draftChars: draftText.length,
    storyboardChars: joined.length,
    totalDuration,
    durationTarget,
    productionSegments,
    capacityModel: capacity?.model || null,
    capacityMax: capacity?.max ?? null,
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
  if (durationTarget !== null) {
    const capacityMax = capacity?.max ?? null;
    if (capacityMax !== null && durationTarget > capacityMax && !productionSegments.length) {
      const alternative = allCapacities.find((item) => item.max >= durationTarget && item.model !== capacity?.model);
      if (alternative) {
        return {
          ...base,
          ok: false,
          reason: '目标时长超过当前模型上限，先换模型',
          detail: `用户要求 ${durationTarget} 秒，${capacity?.model || '当前模型'} 上限 ${capacityMax} 秒；可换 ${alternative.model}（上限 ${alternative.max} 秒）。先改总表模型，再重新核对。`,
        };
      }
      return {
        ...base,
        ok: false,
        reason: '目标时长超过单次容量，但 total 表没有制作清单',
        detail: `用户要求 ${durationTarget} 秒，${capacity?.model || '所选模型'} 单次上限 ${capacityMax} 秒；先在 index.md 写「制作清单」（每段时长），再重新核对。`,
      };
    }
    const planned = productionSegments.length
      ? productionSegments.reduce((sum, value) => sum + value, 0)
      : totalDuration;
    if (Math.abs(planned - durationTarget) > 0.01) {
      return {
        ...base,
        ok: false,
        reason: productionSegments.length ? '制作清单总时长与用户要求不一致' : '分镜总时长与用户要求不一致',
        detail: `用户要求 ${durationTarget} 秒，${productionSegments.length ? `制作清单合计 ${planned} 秒` : `分镜合计 ${totalDuration} 秒`}。改时长或改制作清单后重新核对。`,
      };
    }
    if (productionSegments.length && Math.abs(totalDuration - durationTarget) > 0.01) {
      return {
        ...base,
        ok: false,
        reason: '制作清单与分镜总时长不一致',
        detail: `制作清单 ${durationTarget} 秒，分镜 ${totalDuration} 秒；两边对齐后再核对。`,
      };
    }
  }
  return {
    ...base,
    ok: true,
    reason: '逐字核对通过',
    detail: `${fragments.length} 条片段 / ${draftText.length} 字，总时长 ${totalDuration} 秒`,
  };
}
