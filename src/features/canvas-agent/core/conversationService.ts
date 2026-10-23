import type { EffectedNode } from './effectLedger';
import type { AgentConversation, AgentStoredMessage } from '../types';
import type { ProposalDiskOutcome } from './proposalPersistence';

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`);
  return data;
}

export async function listAgentConversations(canvasId: string): Promise<AgentConversation[]> {
  const data = await requestJson<{ conversations: AgentConversation[] }>(
    `/api/canvas-agent/conversations?canvas_id=${encodeURIComponent(canvasId)}`,
  );
  return Array.isArray(data.conversations) ? data.conversations : [];
}

export async function createAgentConversation(
  canvasId: string,
  title = '探索创作方向',
): Promise<AgentConversation> {
  const data = await requestJson<{ conversation: AgentConversation }>(
    '/api/canvas-agent/conversations',
    {
      method: 'POST',
      body: JSON.stringify({ canvas_id: canvasId, title }),
    },
  );
  return data.conversation;
}

export async function loadAgentConversation(
  conversationId: string,
): Promise<{ conversation: AgentConversation; messages: AgentStoredMessage[]; citedNodes?: string[]; effectedNodes?: EffectedNode[] }> {
  return requestJson(`/api/canvas-agent/conversations/${encodeURIComponent(conversationId)}/messages`);
}

export async function renameAgentConversation(
  conversationId: string,
  title: string,
): Promise<AgentConversation> {
  const data = await requestJson<{ conversation: AgentConversation }>(
    `/api/canvas-agent/conversations/${encodeURIComponent(conversationId)}`,
    { method: 'PATCH', body: JSON.stringify({ title }) },
  );
  return data.conversation;
}

export async function persistProposalOutcome(
  proposalId: string,
  outcome: ProposalDiskOutcome & {
    playbookId?: string;
    stage?: number;
    effectedNodes?: EffectedNode[];
    changelog?: string;
  },
): Promise<number> {
  const data = await requestJson<{ updated: number }>(
    `/api/canvas-agent/proposals/${encodeURIComponent(proposalId)}`,
    { method: 'PATCH', body: JSON.stringify(outcome) },
  );
  return Number(data.updated) || 0;
}

export async function deleteAgentConversation(conversationId: string): Promise<void> {
  await requestJson(`/api/canvas-agent/conversations/${encodeURIComponent(conversationId)}`, {
    method: 'DELETE',
  });
}

/** 回滚一份提案（只还原它碰过的节点/连线）。dryRun 先给差异。 */
export async function rollbackProposal(
  proposalId: string,
  dryRun: boolean,
): Promise<{
  summary: {
    removedNodes: string[];
    restoredNodes: string[];
    removedEdges: number;
    restoredEdges: number;
    conflicts: string[];
  };
}> {
  return requestJson(`/api/canvas-agent/proposals/${encodeURIComponent(proposalId)}/rollback`, {
    method: 'POST',
    body: JSON.stringify({ dryRun }),
  });
}

/**
 * 把「我批了 / 跑完了 / 取消」写回服务端作业。
 * 这是给下一阶段（关页可恢复）铺的路，现在失败也不该影响画布操作。
 */
export async function ackAgentJob(
  jobId: string,
  event: 'execute' | 'finish' | 'cancel',
  patch: { result?: Record<string, unknown>; error?: string; stepTotal?: number } = {},
): Promise<void> {
  if (!jobId) return;
  await requestJson(`/api/canvas-agent/jobs/${encodeURIComponent(jobId)}/events`, {
    method: 'POST',
    body: JSON.stringify({ event, ...patch }),
  });
}

export type AgentJobView = {
  id: string;
  status: 'queued' | 'running' | 'waiting_approval' | 'executing' | 'done' | 'failed' | 'cancelled';
  step: number;
  step_total: number;
  request?: Record<string, unknown>;
  result?: Record<string, unknown>;
  observations?: Array<Record<string, unknown>>;
  error?: string;
  created_at: number;
  updated_at: number;
  heartbeat_at: number;
  finished_at: number | null;
};

/** 打开面板时找“这轮还没结束”的作业：关页、断网、切标签页之后靠它接上。 */
export async function listAgentJobs(
  conversationId: string,
  options: { activeOnly?: boolean } = {},
): Promise<AgentJobView[]> {
  if (!conversationId) return [];
  const query = `conversation_id=${encodeURIComponent(conversationId)}${options.activeOnly ? '&active=1' : ''}`;
  const data = await requestJson<{ jobs: AgentJobView[] }>(`/api/canvas-agent/jobs?${query}`);
  return Array.isArray(data.jobs) ? data.jobs : [];
}

/** 一步执行完的观察结果。下一步规划（C）和服务端续跑（B）都读它。 */
export async function postAgentJobObservation(
  jobId: string,
  observation: {
    proposalId?: string;
    nodeId?: string;
    outcome: 'applied' | 'failed' | 'discarded';
    effected?: number;
    error?: string;
  },
): Promise<void> {
  if (!jobId) return;
  await requestJson(`/api/canvas-agent/jobs/${encodeURIComponent(jobId)}/observations`, {
    method: 'POST',
    body: JSON.stringify(observation),
  });
}
