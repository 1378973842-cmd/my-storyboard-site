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
export const RUN_EDIT_FIRST = '先改提示词';
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
    const placeholder = String(raw.placeholder || '').trim();
    if (type === 'input') {
      options.push(placeholder ? { type: 'input', placeholder } : { type: 'input' });
      continue;
    }
    // 有的模型不写 type，只给 label/value；有 label/text 就当选项文案。
    const label = String(raw.label || raw.text || '').trim()
      || (type === 'text' ? String(raw.value || '').trim() : '');
    if (label) {
      options.push({ type: 'text', label });
    } else if (placeholder) {
      options.push({ type: 'input', placeholder });
    }
  }
  return options;
}

function oneCard(value: unknown, index: number): AskCard | null {
  const raw = record(value);
  const mode = String(raw.mode || '').trim();
  if (mode !== 'single' && mode !== 'multiple' && mode !== 'approve_run_node') return null;
  // 有的模型把问题写在 title 而不是 question。
  const question = String(raw.question || raw.title || '').trim()
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
        // 参考平台的第三选项：先别生成，给我看提示词结构/先改一版。
        { type: 'text', label: RUN_EDIT_FIRST },
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
 * 模型内联工具调用的信封字段一直在变：arguments / payload / input / parameters / data。
 * 统一扒一层，认不出就退回 action 本体。
 */
const ENVELOPE_KEYS = ['arguments', 'payload', 'input', 'parameters', 'data'] as const;

function actionArguments(action: Record<string, unknown>): Record<string, unknown> {
  for (const key of ENVELOPE_KEYS) {
    let value = action[key];
    if (typeof value === 'string') {
      try {
        value = JSON.parse(value);
      } catch {
        continue;
      }
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return action;
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
    const argsRecord = actionArguments(action);
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
      { type: 'text', label: RUN_EDIT_FIRST },
    ],
    node_keys: keys,
  };
}

/** 模型自己写的审批卡丢掉。即将运行的节点由这一侧列全，选项固定三个。 */
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
    if (selected.length !== 1
      || (selected[0] !== APPROVE && selected[0] !== REJECT && selected[0] !== RUN_EDIT_FIRST)
      || input) return null;
    return { cardId, mode, selected, ...(question ? { question } : {}) };
  }
  if (mode === 'single' && selected.length > 1) return null;
  if (!selected.length && !input) return null;
  return { cardId, mode, selected, ...(question ? { question } : {}), ...(input ? { input } : {}) };
}

export function isRunApproved(answer: AskAnswer | null | undefined): boolean {
  return answer?.mode === 'approve_run_node' && answer.selected[0] === APPROVE;
}
