import type { ActionProposal, CanvasAction } from '../types';

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** 分母是本批全部执行节点，含第 13 个及以后。12 只决定那些节点被跳过，不把分母收成 12。 */
export function openBatchProgress(
  total: number,
  onProgress?: (done: number, total: number) => void,
): () => void {
  let seen = 0;
  return () => {
    seen += 1;
    onProgress?.(seen, total);
  };
}

export function normalizeCanvasActions(input: unknown, limit = 60): CanvasAction[] {
  if (!Array.isArray(input)) return [];
  const actions: CanvasAction[] = [];
  for (const raw of input.slice(0, limit)) {
    const item = record(raw);
    if (item.type === 'create_node') {
      const nodeType = String(item.nodeType || '').trim();
      if (!nodeType) continue;
      const position = record(item.position);
      actions.push({
        type: 'create_node',
        tempId: String(item.tempId || '').trim() || undefined,
        nodeType,
        initialParams: record(item.initialParams),
        ...(Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y))
          ? { position: { x: Number(position.x), y: Number(position.y) } }
          : {}),
      });
      continue;
    }
    if (item.type === 'connect_nodes') {
      const sourceNodeId = String(item.sourceNodeId || '').trim();
      const targetNodeId = String(item.targetNodeId || '').trim();
      if (sourceNodeId && targetNodeId) {
        actions.push({ type: 'connect_nodes', sourceNodeId, targetNodeId });
      }
      continue;
    }
    if (item.type === 'update_node_params') {
      const nodeId = String(item.nodeId || '').trim();
      if (nodeId) actions.push({ type: 'update_node_params', nodeId, patch: record(item.patch) });
      continue;
    }
    if (item.type === 'execute_node_skill') {
      const nodeId = String(item.nodeId || '').trim();
      if (nodeId) actions.push({ type: 'execute_node_skill', nodeId });
    }
  }
  return actions;
}

export function listedRecords(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)) as Record<string, unknown>[];
  }
  if (value && typeof value === 'object') return [value as Record<string, unknown>];
  return [];
}

export function listedNodeIds(args: Record<string, unknown>): string[] {
  const raw = Array.isArray(args.nodeIds)
    ? args.nodeIds
    : typeof args.nodeIds === 'string'
      ? [args.nodeIds]
      : [];
  const ids = raw.map((item) => String(item || '').trim()).filter(Boolean);
  const single = String(args.nodeId || '').trim();
  if (single && !ids.includes(single)) ids.unshift(single);
  return ids;
}

export function actionReasonText(action: CanvasAction): string {
  const raw = action.type === 'create_node'
    ? action.initialParams?.reason
    : action.type === 'update_node_params'
      ? action.patch?.reason
      : '';
  return typeof raw === 'string' ? raw.trim() : '';
}

function createdHandle(action: Extract<CanvasAction, { type: 'create_node' }>): string {
  const title = String(action.initialParams?.name || action.initialParams?.title || '').trim();
  // 提案阶段节点还不存在。卡片用标题，没有标题就用 tempId；真实 id 只在应用时由 idMap 换上。
  return title || String(action.tempId || '').trim() || action.nodeType;
}

export function actionDisplayLabel(action: CanvasAction, actions: CanvasAction[] = []): string {
  if (action.type === 'create_node') return `新增 ${createdHandle(action)}`;
  if (action.type === 'connect_nodes') return `连接 ${action.sourceNodeId} → ${action.targetNodeId}`;
  if (action.type === 'update_node_params') return `更新 ${action.nodeId}`;
  const created = actions.find((item) => item.type === 'create_node' && String(item.tempId || '') === action.nodeId);
  const handle = created && created.type === 'create_node' ? createdHandle(created) : action.nodeId;
  return `运行 ${handle}`;
}

export type InterpretedCanvasText = {
  actions: CanvasAction[];
  summary: string;
  prose: string;
  unknownTypes: string[];
};

const INTERNAL_ACTION_TYPES = ['create_node', 'connect_nodes', 'update_node_params', 'execute_node_skill'] as const;

/** 键是已注册工具的 function.name，值是内部动作名。只做精确查表。 */
export const CANVAS_ACTION_TYPE_ALIASES = {
  create_canvas_nodes: 'create_node',
  connect_workflow_edges: 'connect_nodes',
  update_node_config: 'update_node_params',
  trigger_skill_execution: 'execute_node_skill',
} as const;

const ACTION_TYPE_TABLE = new Map<string, typeof INTERNAL_ACTION_TYPES[number]>([
  ...INTERNAL_ACTION_TYPES.map((type) => [type, type] as const),
  ...Object.entries(CANVAS_ACTION_TYPE_ALIASES),
]);

export function unknownCanvasActionMessage(names: string[]): string {
  return `这些动作类型不在允许名单里：${names.join('、')}。请只使用 ${INTERNAL_ACTION_TYPES.join('、')}。不要重复无法识别的 type。`;
}

function locateCanvasJson(text: string): { json: string; prose: string } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return { json: fenced[1].trim(), prose: text.replace(fenced[0], '').trim() };
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return { json: trimmed, prose: '' };
  return null;
}

function expandListedAction(item: Record<string, unknown>, type: string): unknown[] {
  const internal = ACTION_TYPE_TABLE.get(type);
  if (!internal) return [];
  if (type === 'create_canvas_nodes' || (internal === 'create_node' && Array.isArray(item.nodes))) {
    return listedRecords(item.nodes).map((node) => ({
      type: 'create_node',
      tempId: node.tempId,
      nodeType: node.nodeType,
      position: node.position,
      initialParams: node.initialParams,
    }));
  }
  if (type === 'trigger_skill_execution') {
    return listedNodeIds(item).map((nodeId) => ({ type: 'execute_node_skill', nodeId }));
  }
  if (type === 'update_node_config') {
    const updates = listedRecords(item.updates).length ? listedRecords(item.updates) : [item];
    return updates.map((update) => ({
      type: 'update_node_params',
      nodeId: update.nodeId,
      patch: update.patch,
    }));
  }
  if (type === 'connect_workflow_edges') {
    return listedRecords(item.edges).map((edge) => ({
      type: 'connect_nodes',
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
    }));
  }
  return [{ ...item, type: internal }];
}

/**
 * 正文里的工具形 JSON（create_canvas_nodes / trigger_skill_execution）转成内部动作。
 * rationale 只在没有 summary、且和 reason 不是同一句时，升成卡片摘要。reason 留在动作上。
 */
export function interpretCanvasProposalText(text: string): InterpretedCanvasText | null {
  const located = locateCanvasJson(text);
  if (!located) return null;
  let value: unknown;
  try {
    value = JSON.parse(located.json);
  } catch {
    return null;
  }
  const root = record(value);
  if (!Array.isArray(root.actions)) return null;
  const unknownTypes = [...new Set(root.actions.flatMap((item) => {
    const type = String(record(item).type || '').trim();
    return ACTION_TYPE_TABLE.has(type) ? [] : [type || '（空）'];
  }))];
  if (unknownTypes.length) return { actions: [], summary: '', prose: located.prose, unknownTypes };
  const actions = normalizeCanvasActions(root.actions.flatMap((item) => expandListedAction(record(item), String(record(item).type || '').trim())));
  if (!actions.length) return null;
  const reasons = new Set(actions.map(actionReasonText).filter(Boolean));
  const rationales = root.actions.flatMap((item) => {
    const rationale = record(item).rationale;
    return typeof rationale === 'string' && rationale.trim() ? [rationale.trim()] : [];
  });
  let summary = typeof root.summary === 'string' ? root.summary.trim() : '';
  if (summary && reasons.has(summary)) summary = '';
  if (!summary) summary = rationales.find((item) => !reasons.has(item)) || '';
  return { actions, summary, prose: located.prose, unknownTypes: [] };
}

/** 手动确认始终等点击。自动模式只自动落「没有更新、也没有执行」的结构。更新和执行点过才算已应用。 */
export function proposalWaitsForClick(
  mode: 'confirm' | 'auto',
  proposal: Pick<ActionProposal, 'generative' | 'actions'>,
): boolean {
  if (mode !== 'auto') return true;
  if (proposal.generative) return true;
  return proposal.actions.some((action) =>
    action.type === 'update_node_params' || action.type === 'execute_node_skill',
  );
}

export function actionProposalNeedsApproval(actions: CanvasAction[]): boolean {
  return actions.some((action) =>
    ['create_node', 'connect_nodes', 'update_node_params', 'execute_node_skill'].includes(action.type),
  );
}

function executionFeedbackContent(proposal: ActionProposal): string {
  if (proposal.status === 'exec_failed' && proposal.reason === 'dependency_not_ready') {
    const matched = String(proposal.error || '').match(/节点 (.+) 引用的上游 (.+) 还没有产出/);
    const nodeId = matched?.[1] || '';
    const upstreamId = matched?.[2] || '';
    return [
      `节点 ${nodeId} 引用的上游 ${upstreamId} 还没有产出，无法执行。`,
      `这不是 ${nodeId} 的参数问题，不要改 ${nodeId}、不要重建 ${nodeId}。`,
      `请把 ${upstreamId} 也加进这一批执行——八-2 会把 ${upstreamId} 排到 ${nodeId} 前面，${upstreamId} 出图后 ${nodeId} 自然能跑；或先单独执行 ${upstreamId} 再执行 ${nodeId}。`,
    ].join('\n');
  }
  if (proposal.status === 'exec_failed') {
    const raw = String(proposal.error || '');
    const createVoice = '如果它应该承载提示词，请在 initialParams 里填上；如果它是等用户手动填写的空节点，请不要在同一批 actions 里执行它。';
    const storyRetry = raw.includes(createVoice);
    const shown = storyRetry
      ? raw.replace(createVoice, '修正它的 story 字段后，只提交对该节点的执行。')
      : raw;
    const lines = [
      `[系统反馈] 上一轮的结构操作已应用，但执行失败：${shown}`,
      '节点已留在画布上。不要重新创建该节点；',
      ...(storyRetry ? [] : ['修正它的参数后，只提交对该节点的执行。']),
      '这是执行结果，不是用户诉求。',
    ];
    const skipped = Math.max(0, Math.floor(Number(proposal.partialSkipped) || 0));
    if (skipped > 0) lines.push(`${skipped} 个节点因上一条执行失败而未执行。`);
    return lines.join('\n');
  }
  if (proposal.status === 'partial') {
    // ponytail: 已执行数从 error 里的「N 个节点已执行」读，跳过数用 partialSkipped。B 写入这两处。
    const skipped = Math.max(0, Math.floor(Number(proposal.partialSkipped) || 0));
    const matched = String(proposal.error || '').match(/(\d+)\s*个节点已执行/);
    const executed = matched ? Number(matched[1]) : 0;
    return [
      '[系统反馈] 上一轮提交的操作部分完成：',
      `${executed} 个节点已执行，${skipped} 个节点因超时或超出批次数上限被跳过。`,
      '被跳过的节点没有产出，也没有失败记录。',
      '这是执行结果，不是用户诉求。',
      '如需执行被跳过的节点，请单独提交。',
    ].join('\n');
  }
  return [
    `[系统反馈] 上一轮提交的操作未能应用：${proposal.error || ''}`,
    '这是执行结果，不是用户诉求。请修正后重新提交。',
  ].join('\n');
}

export function partialBatchUpdate(
  executionCount: number,
  skippedCount: number,
): { status: 'applied' } | { status: 'partial'; error: string; partialSkipped: number } {
  if (skippedCount <= 0) return { status: 'applied' };
  const executed = Math.max(0, executionCount - skippedCount);
  return {
    status: 'partial',
    error: `${executed} 个节点已执行，${skippedCount} 个节点因超时或超出批次数上限被跳过。被跳过的节点没有产出。`,
    partialSkipped: skippedCount,
  };
}

export function settleBatchProposal(
  executionCount: number,
  skippedCount: number,
  failedExecution?: { nodeId: string; message: string; reason?: string },
): { status: 'applied' } | { status: 'partial'; error: string; partialSkipped: number } | { status: 'exec_failed'; error: string; partialSkipped?: number; reason?: string } {
  if (failedExecution) {
    const reason = failedExecution.reason === 'dependency_not_ready' ? failedExecution.reason : undefined;
    return skippedCount > 0
      ? { status: 'exec_failed', error: failedExecution.message, partialSkipped: skippedCount, ...(reason ? { reason } : {}) }
      : { status: 'exec_failed', error: failedExecution.message, ...(reason ? { reason } : {}) };
  }
  return partialBatchUpdate(executionCount, skippedCount);
}

/** 最近一条尚未送达的 failed / partial / exec_failed。expired 和其他状态不进下一轮。 */
export function pendingExecutionFeedback(
  proposals: ActionProposal[],
): { id: string; content: string } | null {
  let latest: ActionProposal | null = null;
  for (const proposal of proposals) {
    if (proposal.status !== 'failed' && proposal.status !== 'partial' && proposal.status !== 'exec_failed') continue;
    if (proposal.feedbackDeliveredAt !== undefined) continue;
    if (!latest || proposal.createdAt >= latest.createdAt) latest = proposal;
  }
  if (!latest) return null;
  return { id: latest.id, content: executionFeedbackContent(latest) };
}
