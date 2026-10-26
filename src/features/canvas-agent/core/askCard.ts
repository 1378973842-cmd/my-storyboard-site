// 提问走卡片。答案是结构化字段，不进用户消息正文。
// 审批卡只在跑节点前出现，选项固定两个，一次批准只放行列出的节点各一次。

export const ASK_MODES = ['single', 'multiple', 'approve_run_node'] as const;
export type AskMode = (typeof ASK_MODES)[number];

export type AskOption =
  | { type: 'text'; label: string }
  | { type: 'input'; placeholder?: string };

export type AskCard = {
  id: string;
  mode: AskMode;
  question: string;
  options: AskOption[];
  node_key?: string;
  node_keys?: string[];
};

export type AskAnswer = {
  cardId: string;
  mode: AskMode;
  question?: string;
  selected: string[];
  input?: string;
};

const APPROVE = '批准';
const REJECT = '拒绝';
export const ASK_DEFAULT = '用默认';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function optionList(value: unknown): AskOption[] {
  if (!Array.isArray(value)) return [];
  const options: AskOption[] = [];
  for (const item of value) {
    const raw = record(item);
    const type = String(raw.type || '').trim();
    if (type === 'input') {
      const placeholder = String(raw.placeholder || '').trim();
      options.push(placeholder ? { type: 'input', placeholder } : { type: 'input' });
    } else if (type === 'text') {
      const label = String(raw.label || raw.value || '').trim();
      if (label) options.push({ type: 'text', label });
    }
  }
  return options;
}

function oneCard(value: unknown, index: number): AskCard | null {
  const raw = record(value);
  const mode = String(raw.mode || '').trim();
  if (mode !== 'single' && mode !== 'multiple' && mode !== 'approve_run_node') return null;
  const question = String(raw.question || '').trim()
    // 方案/方向/分镜在卡片上方，模型常误写成「以下方案」。
    .replace(/以下(?=[^。！？]*(?:方案|方向|分镜))/, '以上');
  if (!question) return null;
  const nodeKey = String(raw.node_key || '').trim();
  const nodeKeys = Array.isArray(raw.node_keys)
    ? [...new Set(raw.node_keys.map((item) => String(item || '').trim()).filter(Boolean))]
    : [];
  if (mode === 'approve_run_node') {
    if (!nodeKeys.length) return null;
    return {
      id: String(raw.id || `ask-run-${index}`).trim() || `ask-run-${index}`,
      mode,
      question,
      options: [
        { type: 'text', label: APPROVE },
        { type: 'text', label: REJECT },
      ],
      node_keys: nodeKeys,
      ...(nodeKey ? { node_key: nodeKey } : {}),
    };
  }
  const options = optionList(raw.options);
  if (!options.some((item) => item.type === 'input')) options.push({ type: 'input', placeholder: '自己写' });
  return {
    id: String(raw.id || `ask-${index}`).trim() || `ask-${index}`,
    mode,
    question,
    options,
    ...(nodeKey ? { node_key: nodeKey } : {}),
    ...(nodeKeys.length ? { node_keys: nodeKeys } : {}),
  };
}

export function normalizeAskCards(input: unknown): AskCard[] {  const raw = record(input);
  const list = Array.isArray(input)
    ? input
    : Array.isArray(raw.cards)
      ? raw.cards
      : Array.isArray(raw.asks)
        ? raw.asks
        : input && typeof input === 'object'
          ? [input]
          : [];
  const cards: AskCard[] = [];
  list.forEach((item, index) => {
    const card = oneCard(item, index);
    if (card) cards.push(card);
  });
  return cards;
}

/**
 * 模型有时不走原生 tool call，而是把 {"actions":[{"type":"ask_user",...}]}
 * 当正文吐出来。这里把它捞成卡片，避免用户看到一屏 JSON。
 */
export function parseInlineAskCards(text: string): AskCard[] {
  const source = String(text || '').trim();
  if (!source.includes('"ask_user"')) return [];
  const start = source.indexOf('{');
  const end = source.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(source.slice(start, end + 1));
  } catch {
    return [];
  }
  const actions = Array.isArray(record(parsed).actions) ? record(parsed).actions as unknown[] : [];
  const cards: AskCard[] = [];
  actions.forEach((item, index) => {
    const action = record(item);
    // 两种形态都认：{type:'ask_user',question,...} 和
    // {name:'ask_user',arguments:{cards:[...]}}（OpenAI function-call 形状）
    const name = String(action.type || action.name || '');
    if (name !== 'ask_user') return;
    let args: unknown = action.arguments ?? action;
    if (typeof args === 'string') {
      try {
        args = JSON.parse(args);
      } catch {
        return;
      }
    }
    const argsRecord = record(args);
    const list = Array.isArray(argsRecord.cards)
      ? argsRecord.cards
      : Array.isArray(argsRecord.asks)
        ? argsRecord.asks
        : [argsRecord];
    list.forEach((entry, offset) => {
      const raw = record(entry);
      const card = oneCard({ ...raw, mode: raw.mode || 'single' }, index + offset);
      if (card) cards.push(card);
    });
  });
  return cards;
}

export function approveRunCard(nodeKeys: string[]): AskCard | null {
  const keys = [...new Set(nodeKeys.map((item) => item.trim()).filter(Boolean))];
  if (!keys.length) return null;
  return {
    id: 'ask-run',
    mode: 'approve_run_node',
    question: '批准运行这些节点？',
    options: [
      { type: 'text', label: APPROVE },
      { type: 'text', label: REJECT },
    ],
    node_keys: keys,
  };
}

/** 模型自己写的审批卡丢掉。即将运行的节点由这一侧列全，选项固定两个。 */
export function withRunApproval(cards: AskCard[], executeNodeIds: string[]): AskCard[] {
  const rest = cards.filter((card) => card.mode !== 'approve_run_node');
  const run = approveRunCard(executeNodeIds);
  return run ? [...rest, run] : rest;
}

function asksFromProse(text: string): AskCard[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];
  try {
    return normalizeAskCards(JSON.parse(text.slice(start, end + 1)));
  } catch {
    return [];
  }
}

export function collectAskCards(toolAsks: unknown[], prose: string, executeNodeIds: string[]): AskCard[] {
  const fromTools = toolAsks.flatMap((item) => normalizeAskCards(item));
  const cards = fromTools.length ? fromTools : asksFromProse(prose);
  return withRunApproval(cards, executeNodeIds);
}

export function defaultAskAnswer(card: AskCard): AskAnswer {
  return {
    cardId: card.id,
    mode: card.mode,
    question: card.question,
    selected: [ASK_DEFAULT],
  };
}

export function parseAskAnswers(value: unknown): AskAnswer[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const answer = parseAskAnswer(item);
    return answer ? [answer] : [];
  });
}

export function parseAskAnswer(value: unknown): AskAnswer | null {
  const raw = record(value);
  const cardId = String(raw.cardId || '').trim();
  const mode = String(raw.mode || '').trim();
  if (!cardId || (mode !== 'single' && mode !== 'multiple' && mode !== 'approve_run_node')) return null;
  const selected = Array.isArray(raw.selected)
    ? raw.selected.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const input = String(raw.input || '').trim();
  const question = String(raw.question || '').trim();
  if (mode === 'approve_run_node') {
    if (selected.length !== 1 || (selected[0] !== APPROVE && selected[0] !== REJECT) || input) return null;
    return { cardId, mode, selected, ...(question ? { question } : {}) };
  }
  if (mode === 'single' && selected.length > 1) return null;
  if (!selected.length && !input) return null;
  return { cardId, mode, selected, ...(question ? { question } : {}), ...(input ? { input } : {}) };
}

export function isRunApproved(answer: AskAnswer | null | undefined): boolean {
  return answer?.mode === 'approve_run_node' && answer.selected[0] === APPROVE;
}
