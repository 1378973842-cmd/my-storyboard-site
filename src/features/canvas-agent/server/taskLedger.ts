import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { checkStoryboardAgainstDraft } from '../core/planCheck.js';

/**
 * 制作任务账本：文件是权威源，数据库只做渲染缓存。
 * 目录：data/agent-tasks/<conversationId>/
 *   task.md / task-state.json / draft.md / index.md / anchors.md / storyboard.md
 */
export type TaskStep =
  | 'draft'
  | 'anchors'
  | 'storyboard'
  | 'review'
  | 'anchor_runs'
  | 'storyboard_runs'
  | 'compose';

export type TaskArtifactKind = 'draft' | 'index' | 'anchors' | 'storyboard';

export type TaskTodo = {
  step: TaskStep;
  label: string;
  done: boolean;
  at?: number;
};

export type TaskState = {
  id: string;
  conversationId: string;
  title: string;
  goal: string;
  skill: string;
  createdAt: number;
  updatedAt: number;
  todos: TaskTodo[];
  /** 自动建账本时的准备态：只给状态依据，不暗示下一步写 draft。 */
  preparing?: boolean;
  /** 上一轮落账的下一步计划；跨轮存活，不依赖 thinking。 */
  nextAction?: {
    /** 这份计划所属的 todo；current 变了就失效。 */
    step: TaskStep;
    /** advance = 推进制作；answer = 回答用户。 */
    intent: 'advance' | 'answer';
    params: Record<string, unknown>;
    nodeIds: string[];
    at: number;
  };
  current: TaskStep;
  facts: Record<string, unknown>;
  artifacts: Partial<Record<TaskArtifactKind, { path: string; chars: number; updatedAt: number }>>;
  cursor?: {
    lastLine: string;
    registered: number;
    file: string;
    at: number;
  };
};

export const TASK_STEPS: Array<{ step: TaskStep; label: string }> = [
  { step: 'draft', label: '定稿' },
  { step: 'anchors', label: '锚点登记与创建' },
  { step: 'storyboard', label: '分镜' },
  { step: 'review', label: '规划核对' },
  { step: 'anchor_runs', label: '锚点批运行' },
  { step: 'storyboard_runs', label: '分镜批运行' },
  { step: 'compose', label: '合成交付' },
];

const ARTIFACT_FILES: Record<TaskArtifactKind, string> = {
  draft: 'draft.md',
  index: 'index.md',
  anchors: 'anchors.md',
  storyboard: 'storyboard.md',
};

const ARTIFACT_MAX_CHARS = 200_000;

function tasksRoot(): string {
  const configured = String(process.env.CANVAS_AGENT_TASK_DIR || '').trim();
  return configured || path.join(process.cwd(), 'data', 'agent-tasks');
}

function safeConversationId(value: string): string {
  const id = String(value || '').trim();
  if (!/^[a-zA-Z0-9_-]{6,80}$/.test(id)) throw new Error('会话 id 不合法');
  return id;
}

function taskDir(conversationId: string): string {
  return path.join(tasksRoot(), safeConversationId(conversationId));
}

function statePath(conversationId: string): string {
  return path.join(taskDir(conversationId), 'task-state.json');
}

function atomicWrite(filePath: string, content: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, content, 'utf8');
  renameSync(tmp, filePath);
}

function currentOf(todos: TaskTodo[]): TaskStep {
  return (todos.find((item) => !item.done) || todos[todos.length - 1]).step;
}

function renderTaskMarkdown(state: TaskState): string {
  const lines = [
    `# ${state.title}`,
    '',
    `- 目标：${state.goal || '（未填写）'}`,
    `- 技能：${state.skill || '（未指定）'}`,
    `- 当前：${TASK_STEPS.find((item) => item.step === state.current)?.label || state.current}`,
    '',
    '## todo',
    '',
    ...state.todos.map((item) => `- [${item.done ? 'x' : ' '}] ${item.label}`),
    '',
    ...(state.cursor
      ? [
        '## 分镜游标',
        '',
        `- 已登记：${state.cursor.registered} 条`,
        `- 原文位置（末 12 字）：${state.cursor.lastLine}`,
        `- 当前文件：${state.cursor.file}`,
        '',
      ]
      : []),
  ];
  return `${lines.join('\n')}\n`;
}

export const TASK_STAGE: Record<TaskStep, string> = {
  draft: 'direction',
  anchors: 'params',
  storyboard: 'storyboard',
  review: 'storyboard',
  anchor_runs: 'production',
  storyboard_runs: 'production',
  compose: 'production',
};

export function readTaskState(conversationId: string): TaskState | null {
  try {
    const file = statePath(conversationId);
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as TaskState;
    if (!parsed || !Array.isArray(parsed.todos) || !parsed.todos.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function ensureTask(
  conversationId: string,
  input: { title?: string; goal?: string; skill?: string; preparing?: boolean },
): TaskState {
  const existing = readTaskState(conversationId);
  if (existing) return existing;
  const id = `task-${Date.now().toString(36)}`;
  const now = Date.now();
  const state: TaskState = {
    id,
    conversationId: safeConversationId(conversationId),
    title: String(input.title || '制作任务').trim().slice(0, 80) || '制作任务',
    goal: String(input.goal || '').trim().slice(0, 2000),
    skill: String(input.skill || '').trim().slice(0, 80),
    createdAt: now,
    updatedAt: now,
    todos: TASK_STEPS.map((item) => ({ ...item, done: false })),
    preparing: Boolean(input.preparing),
    current: 'draft',
    facts: {},
    artifacts: {},
  };
  mkdirSync(taskDir(conversationId), { recursive: true });
  atomicWrite(statePath(conversationId), JSON.stringify(state, null, 2));
  atomicWrite(path.join(taskDir(conversationId), 'task.md'), renderTaskMarkdown(state));
  return state;
}

function applyNextActionForCurrent(state: TaskState): void {
  const action = nextActionForStep(state.current);
  const nodeIds = [state.facts?.character_anchor, state.facts?.opponent_anchor, state.facts?.scene_anchor]
    .map((value) => String(value || '').split(':').pop() || '')
    .filter(Boolean);
  state.nextAction = {
    step: state.current,
    intent: 'advance',
    params: action.params,
    nodeIds,
    at: Date.now(),
  };
}

export function writeTaskArtifact(
  conversationId: string,
  kind: TaskArtifactKind,
  content: string,
  append = false,
): { state: TaskState; chars: number } {
  if (!ARTIFACT_FILES[kind]) throw new Error('未知的产物类型');
  const state = ensureTask(conversationId, {});
  const file = path.join(taskDir(conversationId), ARTIFACT_FILES[kind]);
  const nextText = append && existsSync(file)
    ? `${readFileSync(file, 'utf8')}\n${String(content || '')}`
    : String(content || '');
  const clipped = nextText.slice(0, ARTIFACT_MAX_CHARS);
  atomicWrite(file, clipped);
  state.artifacts[kind] = {
    path: ARTIFACT_FILES[kind],
    chars: clipped.length,
    updatedAt: Date.now(),
  };
  applyNextActionForCurrent(state);
  state.updatedAt = Date.now();
  atomicWrite(statePath(conversationId), JSON.stringify(state, null, 2));
  atomicWrite(path.join(taskDir(conversationId), 'task.md'), renderTaskMarkdown(state));
  return { state, chars: clipped.length };
}

export function readTaskArtifact(
  conversationId: string,
  kind: TaskArtifactKind,
): string {
  const state = readTaskState(conversationId);
  if (!state) return '';
  try {
    return readFileSync(path.join(taskDir(conversationId), ARTIFACT_FILES[kind]), 'utf8');
  } catch {
    return '';
  }
}

export type TaskArtifactSlice = {
  kind: TaskArtifactKind;
  offset: number;
  length: number;
  total: number;
  content: string;
  truncated: boolean;
  nextOffset: number;
};

/** 通用读回：模型主动读账本产物，支持偏移+长度分段。失败时报字段、合法值、怎么改。 */
export function readTaskArtifactSlice(
  conversationId: string,
  kindInput: string,
  offsetInput: unknown = 0,
  lengthInput: unknown = 8000,
): TaskArtifactSlice {
  const kind = String(kindInput || '').trim() as TaskArtifactKind;
  if (!ARTIFACT_FILES[kind]) {
    throw new Error(
      `read_task_artifact 的 kind 不合法：${kind || '（空）'}。合法值：draft、index、anchors、storyboard。请改成其中之一。`,
    );
  }
  const state = readTaskState(conversationId);
  if (!state) {
    throw new Error('当前会话还没有账本。先调用 start_production_task 建账本，再读产物。');
  }
  const file = path.join(taskDir(conversationId), ARTIFACT_FILES[kind]);
  if (!existsSync(file)) {
    throw new Error(`还没有 ${ARTIFACT_FILES[kind]}。先用 write_task_artifact 写 ${kind}，再读。`);
  }
  const raw = readFileSync(file, 'utf8');
  const offset = Number(offsetInput ?? 0);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error(`read_task_artifact 的 offset 必须是 >=0 的整数（收到 ${String(offsetInput)}）。从 0 开始按字符计。`);
  }
  const length = Number(lengthInput ?? 8000);
  if (!Number.isInteger(length) || length < 1 || length > 20_000) {
    throw new Error(`read_task_artifact 的 length 必须是 1..20000 的整数（收到 ${String(lengthInput)}）。不传时默认 8000。`);
  }
  const content = raw.slice(offset, offset + length);
  const nextOffset = offset + content.length;
  return {
    kind,
    offset,
    length,
    total: raw.length,
    content,
    truncated: nextOffset < raw.length,
    nextOffset,
  };
}

export function setTaskPreparing(conversationId: string, preparing: boolean): TaskState {
  const state = ensureTask(conversationId, {});
  if (state.preparing === preparing) return state;
  state.preparing = preparing;
  state.updatedAt = Date.now();
  atomicWrite(statePath(conversationId), JSON.stringify(state, null, 2));
  atomicWrite(path.join(taskDir(conversationId), 'task.md'), renderTaskMarkdown(state));
  return state;
}

export function nextActionForStep(step: TaskStep): { actionType: string; params: Record<string, unknown> } {
  const actions: Record<TaskStep, { actionType: string; params: Record<string, unknown> }> = {
    draft: { actionType: 'write_task_artifact', params: { kind: 'draft' } },
    anchors: { actionType: 'create_node', params: { todo: 'anchors', nodeType: 'generator' } },
    storyboard: { actionType: 'write_task_artifact', params: { kind: 'storyboard' } },
    review: { actionType: 'none', params: { todo: 'review' } },
    anchor_runs: { actionType: 'execute_node_skill', params: { todo: 'anchor_runs' } },
    storyboard_runs: { actionType: 'create_node', params: { todo: 'storyboard_runs', nodeType: 'video' } },
    compose: { actionType: 'none', params: { todo: 'compose' } },
  };
  return actions[step];
}

export function setTaskNextAction(
  conversationId: string,
  params: Record<string, unknown>,
  nodeIds: string[],
  intent: 'advance' | 'answer' = 'advance',
): TaskState {
  const state = ensureTask(conversationId, {});
  state.nextAction = {
    step: state.current,
    intent: intent === 'answer' ? 'answer' : 'advance',
    params: params && typeof params === 'object' ? params : {},
    nodeIds: nodeIds.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 40),
    at: Date.now(),
  };
  state.updatedAt = Date.now();
  atomicWrite(statePath(conversationId), JSON.stringify(state, null, 2));
  atomicWrite(path.join(taskDir(conversationId), 'task.md'), renderTaskMarkdown(state));
  return state;
}

export function completeTaskStep(
  conversationId: string,
  step: TaskStep,
): TaskState {
  const state = ensureTask(conversationId, {});
  const target = state.todos.find((item) => item.step === step);
  if (!target) throw new Error('未知的步骤');
  // 推进的前置条件是「该步的产物文件已写入」。
  // 不用「上次写入失败」标记：标记会被后续成功写、重启、换写者绕过；
  // 文件是否存在/非空才是实际状态，也是四步循环「先回填文件」的判据。
  const required: Partial<Record<TaskStep, TaskArtifactKind>> = {
    draft: 'draft',
    anchors: 'anchors',
    storyboard: 'storyboard',
    review: 'storyboard',
    anchor_runs: 'anchors',
    storyboard_runs: 'storyboard',
  };
  const artifactKind = required[step];
  if (artifactKind) {
    const text = readTaskArtifact(conversationId, artifactKind);
    if (!text.trim()) {
      const file = ARTIFACT_FILES[artifactKind];
      throw new Error(`不能完成「${target.label}」：${file} 还没写入或为空。先 write_task_artifact 写 ${artifactKind}，再 complete_task_step('${step}')。`);
    }
  }
  target.done = true;
  target.at = target.at || Date.now();
  state.preparing = false;
  state.current = currentOf(state.todos);
  applyNextActionForCurrent(state);
  state.updatedAt = Date.now();
  atomicWrite(statePath(conversationId), JSON.stringify(state, null, 2));
  atomicWrite(path.join(taskDir(conversationId), 'task.md'), renderTaskMarkdown(state));
  return state;
}

export function setTaskCursor(
  conversationId: string,
  cursor: { lastLine?: string; registered?: number; file?: string },
): TaskState {
  const state = ensureTask(conversationId, {});
  state.cursor = {
    lastLine: String(cursor.lastLine || state.cursor?.lastLine || '').trim().slice(-48),
    registered: Math.max(0, Math.floor(Number(cursor.registered ?? state.cursor?.registered ?? 0))),
    file: String(cursor.file || state.cursor?.file || ARTIFACT_FILES.storyboard).trim(),
    at: Date.now(),
  };
  state.updatedAt = Date.now();
  atomicWrite(statePath(conversationId), JSON.stringify(state, null, 2));
  atomicWrite(path.join(taskDir(conversationId), 'task.md'), renderTaskMarkdown(state));
  return state;
}

export function updateTaskFacts(
  conversationId: string,
  patch: Record<string, unknown>,
): TaskState | null {
  const state = readTaskState(conversationId);
  if (!state) return null;
  state.facts = { ...(state.facts || {}), ...patch };
  state.updatedAt = Date.now();
  atomicWrite(statePath(conversationId), JSON.stringify(state, null, 2));
  return state;
}

export function taskStatePrompt(state: TaskState | null): string {
  if (!state) return '';
  const todo = state.todos.map((item) => `${item.done ? '[x]' : '[ ]'} ${item.label}`).join(' / ');
  const artifacts = (Object.entries(state.artifacts) as Array<[TaskArtifactKind, { chars: number; path: string }]>)
    .map(([kind, info]) => `${kind}:${info.chars}字(${info.path})`)
    .join('；');
  const cursor = state.cursor
    ? `\n- 分镜游标：已登记 ${state.cursor.registered} 条；原文末 12 字「${state.cursor.lastLine}」；文件 ${state.cursor.file}`
    : '';
  // 规划核对必须回读文件：把创作稿与分镜表原文附在提示里，不能凭记忆核对。
  const reviewCheck = state.current === 'review'
    ? checkStoryboardAgainstDraft(
      readTaskArtifact(state.conversationId, 'draft'),
      readTaskArtifact(state.conversationId, 'storyboard'),
      readTaskArtifact(state.conversationId, 'index'),
      '',
      { requireCapacity: false },
    )
    : null;
  const reviewStatus = reviewCheck
    ? `\n- 核对器：${reviewCheck.ok ? '通过' : '未通过'}（${reviewCheck.reason}；${reviewCheck.detail}）`
    : '';
  const reviewFiles = state.current === 'review'
    ? `\n\n[review_files]\n<draft>\n${readTaskArtifact(state.conversationId, 'draft').slice(0, 20_000)}\n</draft>\n<storyboard>\n${readTaskArtifact(state.conversationId, 'storyboard').slice(0, 20_000)}\n</storyboard>\n逐字核对：分镜的原文片段拼起来是否等于创作稿全文；再核对总时长与反碎化。结论写进 index.md 的「规划核对」分节，再 complete_task_step('review')。`
    : '';
  const position = state.preparing
    ? '准备阶段（尚未进入定稿；先确认参数，不要预设下一步）'
    : (TASK_STEPS.find((item) => item.step === state.current)?.label || state.current);
  const action = nextActionForStep(state.current);
  const currentPlan = state.nextAction?.step === state.current ? state.nextAction : null;
  const nextAction = currentPlan
    ? `\n- 下一步动作（由 current 推）：${action.actionType}\n- 下一步计划（上一轮落账）：intent=${currentPlan.intent} ${JSON.stringify(currentPlan.params)} 依赖:${currentPlan.nodeIds.join('、') || '无'}`
    : `\n- 下一步动作（由 current 推）：${action.actionType}\n- 下一步计划（上一轮落账）：（上一轮计划属于旧阶段，已忽略）`;
  return `\n\n[task_state]\n- 任务：${state.title}（${state.id}）\n- 当前位置：${position}\n- todo：${todo}${cursor}${nextAction}\n- 产物：${artifacts || '（尚未写入）'}${reviewStatus}\n- 文件是唯一权威源：写产物用 write_task_artifact，完成一步用 complete_task_step，主动读回用 read_task_artifact（kind + offset/length，单独一批调用）；核对所需的创作稿/分镜会自动附上，不要凭记忆推进。${reviewFiles}`;
}
