import {
  CANVAS_GENERATOR_TYPES,
  applyCanvasAgentActions,
  executeCanvasAgentNodeSkill,
  flattenCanvasAgentParameters,
  getCanvasAgentSnapshot,
  discardCanvasAgentOutputHost,
  flushCanvasAgentSave,
  canvasAgentBatchTimeoutMs,
  takeCanvasAgentOutputHost,
  withCanvasAgentNode,
  type CanvasAgentEngineAction,
} from '../../../lib/infiniteCanvas/canvasEngine.js';

export { CANVAS_GENERATOR_TYPES };
import type {
  CanvasAction,
  CanvasSnapshot,
  CreateNodeAction,
  ExecuteNodeSkillAction,
} from '../types';
import { AGENT_CREATABLE_NODE_TYPES } from '../types';
import { changelogFromActions, effectedFromApply } from './effectLedger';
import { citationsForApply, droppedConnectCount, settleReferenceActions } from './referencePrompt';
import { rejectUnknownCanvasParamKeys } from '../tools/skillRegistry';
import { normalizeCanvasActions, openBatchProgress } from './proposal';
import { assertNoExecutionCycle, sortBatchExecutions } from './executionOrder';
import { invalidationActions } from './invalidation';
import {
  applyRebuildGuards,
  assertAgentActionContent,
  assertAgentCanExecute,
  assertCanvasVideoShotTimelines,
  downstreamChoices,
  settleAgentStaleAfterExecution,
  type ImpactChoice,
} from './operatingModel';

const creatableTypes = new Set<string>(AGENT_CREATABLE_NODE_TYPES);

function assertCreatableType(type: string): void {
  if (!creatableTypes.has(type)) {
    throw new Error(`不支持创建节点类型：${type}。合法类型：${[...creatableTypes].join('、')}。请改成其中之一。`);
  }
}

function overlaps(snapshot: CanvasSnapshot, x: number, y: number): boolean {
  return snapshot.nodes.some((node) => {
    const nx = Number(node.x) || 0;
    const ny = Number(node.y) || 0;
    const w = Number(node.w) || 300;
    const h = Number(node.h) || 240;
    return x < nx + w + 48 && x + 300 > nx - 48 && y < ny + h + 48 && y + 240 > ny - 48;
  });
}

function nextSafePosition(
  snapshot: CanvasSnapshot,
  index = 0,
  explicit?: { x: number; y: number },
): { x: number; y: number } {
  if (explicit && Number.isFinite(explicit.x) && Number.isFinite(explicit.y)) return explicit;
  const selectedId = snapshot.selectedNodeIds.at(-1);
  const active = snapshot.nodes.find((node) => node.id === selectedId);
  let x = active
    ? (Number(active.x) || 0) + Math.max(350, (Number(active.w) || 270) + 80)
    : snapshot.viewportCenter.x;
  let y = active ? Number(active.y) || 0 : snapshot.viewportCenter.y;
  x += index * 350;
  let guard = 0;
  while (overlaps(snapshot, x, y) && guard < 20) {
    x += 350;
    guard += 1;
  }
  return { x, y };
}

function withResolvedPositions(actions: CanvasAction[], snapshot: CanvasSnapshot): CanvasAction[] {
  let createIndex = 0;
  return actions.map((action) => {
    if (action.type !== 'create_node') return action;
    assertCreatableType(action.nodeType);
    assertAgentActionContent(action, snapshot);
    const position = nextSafePosition(snapshot, createIndex, action.position);
    createIndex += 1;
    snapshot.nodes.push({
      id: action.tempId || `proposal-${createIndex}`,
      type: action.nodeType,
      x: position.x,
      y: position.y,
      ...(action.initialParams || {}),
    });
    return { ...action, position };
  });
}

export function getCanvasSnapshot(): CanvasSnapshot {
  return getCanvasAgentSnapshot() as CanvasSnapshot;
}

/** 卡片上给用户看的节点名。id 对用户没意义，只在节点找不到时兜底。 */
export function nodeLabelsFor(ids: readonly string[]): Record<string, string> {
  const wanted = new Set(ids.filter(Boolean));
  if (!wanted.size) return {};
  const labels: Record<string, string> = {};
  for (const node of getCanvasSnapshot().nodes) {
    if (!wanted.has(node.id)) continue;
    const title = String(node.title || node.name || '').trim();
    const prompt = String(node.prompt || node.text || '').trim();
    labels[node.id] = title || (prompt ? prompt.slice(0, 14) : '') || String(node.type || node.id);
  }
  return labels;
}

export function createNode(
  type: string,
  initialParams: Record<string, any>,
  position?: { x: number; y: number },
): string {
  assertCreatableType(type);
  const snapshot = getCanvasSnapshot();
  const action: CreateNodeAction = {
    type: 'create_node',
    nodeType: type,
    initialParams,
    position: nextSafePosition(snapshot, 0, position),
  };
  assertAgentActionContent(action, snapshot);
  const result = applyCanvasAgentActions([action]);
  const id = result.createdNodeIds[0];
  if (!id) throw new Error(`节点创建失败：type=${type}，initialParams 键=${Object.keys(initialParams || {}).join('、') || '（空）'}。检查必填参数和节点类型后重试。`);
  return id;
}

export function connectNodes(sourceNodeId: string, targetNodeId: string): void {
  applyCanvasAgentActions([{ type: 'connect_nodes', sourceNodeId, targetNodeId }]);
}

export function updateNodeParams(nodeId: string, patch: Record<string, any>): void {
  const snapshot = getCanvasSnapshot();
  const action = { type: 'update_node_params' as const, nodeId, patch };
  applyCanvasAgentActions([action, ...invalidationActions(snapshot, [action])]);
}

async function executeAndSettle(nodeId: string): Promise<any> {
  try {
    const result = await executeCanvasAgentNodeSkill(nodeId);
    // 这是 D3 那一类的兜底：runner 不抛错、
    // 但节点上留下了失败标记时，外层不能当成成功。
    // 它覆盖修图那种「等待盖得住、失败被消化」的路径，
    // 也覆盖将来任何新增 runner 忘了接上
    // rejectCanvasAgentPrecondition 的情况。
    // 清掉 runStatus 是为了保持 created——
    // 一次临时故障不该造成永久不可重跑。
    // executeAndSettle 只有 Agent 路径进，
    // 人类路径走 runCanvasGenerate 那条链，
    // 所以这里的清理不会影响人类的失败条。
    // 如果将来人类路径也接进来，这个兜底要加 cascade 判断。
    withCanvasAgentNode(nodeId, (node) => {
      const message = String(node.runError || '').trim()
        || (node.runStatus === 'failed' ? '生成失败' : '');
      if (!message) return;
      delete node.runStatus;
      delete node.runError;
      throw new Error(message);
    });
    withCanvasAgentNode(nodeId, (node) => settleAgentStaleAfterExecution(node, true));
    const hostId = takeCanvasAgentOutputHost(nodeId);
    if (hostId && hostId !== nodeId) {
      withCanvasAgentNode(hostId, (node) => settleAgentStaleAfterExecution(node, true));
    }
    flushCanvasAgentSave();
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || '');
    withCanvasAgentNode(nodeId, (node) => settleAgentStaleAfterExecution(node, false, message));
    discardCanvasAgentOutputHost(nodeId);
    flushCanvasAgentSave();
    throw err;
  }
}

function rejectActionContent(action: CanvasAction, snapshot: CanvasSnapshot, nodeId?: string): void {
  try {
    assertAgentActionContent(action, snapshot, CANVAS_GENERATOR_TYPES);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err || '');
    if (nodeId) {
      withCanvasAgentNode(nodeId, (node) => settleAgentStaleAfterExecution(node, false, message));
      flushCanvasAgentSave();
    }
    throw err;
  }
}

export async function executeNodeSkill(nodeId: string): Promise<any> {
  const snapshot = getCanvasSnapshot();
  assertAgentCanExecute(snapshot, nodeId);
  rejectActionContent({ type: 'execute_node_skill', nodeId }, snapshot, nodeId);
  return executeAndSettle(nodeId);
}

// 翻译发生在任何节点被创建之前，所以失败走 failed
// （画布无变化），不可能是 exec_failed。
// 「请修正后重新提交」对这类失败是真话：
// 确实什么都没应用。
// 本步产生的边不计入 actionsForTool 的 40 条上限
// （那是工具调用层的收口，这里是结构层），
// 上限由本批 create_node 的 20 个封顶间接约束。
export function translateReferenceTokens(
  actions: CanvasAction[],
  snapshot: CanvasSnapshot,
  userMessage?: string,
  conversationId?: string,
  sessionCitedNodes?: readonly string[],
): CanvasAction[] {
  return settleReferenceActions(
    actions,
    snapshot.nodes,
    CANVAS_GENERATOR_TYPES,
    citationsForApply(userMessage, sessionCitedNodes),
    snapshot.connections,
    conversationId,
  );
}

function asParamRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function flattenModelParamKeys(actions: CanvasAction[]): CanvasAction[] {
  return actions.map((action) => {
    if (action.type === 'create_node') {
      const initialParams = asParamRecord(flattenCanvasAgentParameters(action.initialParams));
      return initialParams ? { ...action, initialParams } : action;
    }
    if (action.type === 'update_node_params') {
      const patch = asParamRecord(flattenCanvasAgentParameters(action.patch));
      return patch ? { ...action, patch } : action;
    }
    return action;
  });
}

export type BatchStepEvent = {
  nodeId: string;
  status: 'done' | 'failed' | 'skipped';
  message?: string;
};

export async function batchApplyChanges(
  actions: CanvasAction[],
  onProgress?: (done: number, total: number) => void,
  userMessage?: string,
  conversationId?: string,
  sessionCitedNodes?: readonly string[],
  onStep?: (step: BatchStepEvent) => void,
): Promise<{
  choices: ImpactChoice[];
  skippedCount: number;
  failedExecution?: { nodeId: string; message: string; reason?: string };
  droppedConnects: number;
  idMap: Record<string, string>;
  effected: ReturnType<typeof effectedFromApply>;
  changelog: string;
}> {
  const snapshot = getCanvasSnapshot();
  const normalized = normalizeCanvasActions(actions);
  // 只检查模型交来的动作。先揭掉 parameters / initialParams，再整批拒绝未知键。
  // 标脏和废弃补丁在后面的 applyRebuildGuards、invalidationActions 里才出现。
  const readable = flattenModelParamKeys(normalized);
  rejectUnknownCanvasParamKeys(readable);
  const choices = downstreamChoices(snapshot, readable);
  const prepared = applyRebuildGuards(readable, snapshot);
  const translated = translateReferenceTokens(
    prepared,
    snapshot,
    userMessage,
    conversationId,
    sessionCitedNodes,
  );
  const droppedConnects = droppedConnectCount(prepared, translated);
  const guarded = withResolvedPositions(translated, snapshot);
  if (!guarded.length) throw new Error('建议中没有可执行的画布操作');
  const structural = guarded.filter(
    (action): action is Exclude<CanvasAction, ExecuteNodeSkillAction> =>
      action.type !== 'execute_node_skill',
  );
  structural.push(...invalidationActions(snapshot, structural));
  const executions = guarded.filter(
    (action): action is ExecuteNodeSkillAction => action.type === 'execute_node_skill',
  );
  assertNoExecutionCycle(executions, snapshot, guarded);
  const result = structural.length
    ? applyCanvasAgentActions(
      structural as CanvasAgentEngineAction[],
      conversationId ? { conversationId } : undefined,
    )
    : { idMap: {} as Record<string, string> };
  const resolveExecutionId = (nodeId: string) => result.idMap[nodeId] || nodeId;
  const ordered = sortBatchExecutions(executions, snapshot, guarded, resolveExecutionId);
  const runnable = ordered.slice(0, 12);
  const overflow = ordered.slice(12);
  const budgetNodes = runnable.map((action) => {
    const nodeId = resolveExecutionId(action.nodeId);
    return getCanvasSnapshot().nodes.find((node) => node.id === nodeId) || { id: nodeId, type: action.nodeId };
  });
  const deadline = Date.now() + canvasAgentBatchTimeoutMs(budgetNodes);
  let skippedCount = 0;
  let failedExecution: { nodeId: string; message: string; reason?: string } | undefined;
  const skipExecution = (nodeId: string, message: string) => {
    skippedCount += 1;
    withCanvasAgentNode(nodeId, (node) => settleAgentStaleAfterExecution(node, false, message));
    flushCanvasAgentSave();
    onStep?.({ nodeId, status: 'skipped', message });
  };
  // 进度写在提案卡片上。apply 已经在改这份 React state，卡片看得见，保存态也不会来抢。
  // 不要走 setStatus：它写的是 display:none 的节点，而唯一可见的 #saveState 被保存指示器占用。
  const markProgress = openBatchProgress(ordered.length, onProgress);
  for (const action of runnable) {
    markProgress();
    const nodeId = resolveExecutionId(action.nodeId);
    if (failedExecution) {
      skipExecution(nodeId, `因上一条执行失败而未执行：节点 ${nodeId} 未执行`);
      continue;
    }
    if (Date.now() >= deadline) {
      skipExecution(nodeId, `本批执行已达到总超时，节点 ${nodeId} 未执行。不要重建该节点，稍后检查其产出。`);
      continue;
    }
    try {
      assertAgentCanExecute(getCanvasSnapshot(), nodeId);
      rejectActionContent(
        { type: 'execute_node_skill', nodeId },
        getCanvasSnapshot(),
        nodeId,
      );
      await executeAndSettle(nodeId);
      onStep?.({ nodeId, status: 'done' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err || '');
      const rawReason = err && typeof err === 'object' && 'reason' in err ? err.reason : undefined;
      const reason = typeof rawReason === 'string' ? rawReason : undefined;
      failedExecution = { nodeId, message, reason };
      onStep?.({ nodeId, status: 'failed', message });
    }
  }
  for (const action of overflow) {
    markProgress();
    const nodeId = resolveExecutionId(action.nodeId);
    skipExecution(nodeId, `本批最多连续执行 12 个节点，节点 ${nodeId} 未执行。不要重建该节点。`);
  }
  const landed = getCanvasSnapshot();
  const effected = effectedFromApply(guarded, result.idMap, landed.nodes);
  const changelog = changelogFromActions(guarded, result.idMap);
  return failedExecution
    ? { choices, skippedCount, failedExecution, droppedConnects, idMap: result.idMap, effected, changelog }
    : { choices, skippedCount, droppedConnects, idMap: result.idMap, effected, changelog };
}

export const canvasFacade = {
  getSnapshot: getCanvasSnapshot,
  createNode,
  connectNodes,
  updateNodeParams,
  executeNodeSkill,
  batchApplyChanges,
};
