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
): Promise<{ conversation: AgentConversation; messages: AgentStoredMessage[]; citedNodes?: string[] }> {
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
  outcome: ProposalDiskOutcome & { playbookId?: string; stage?: number },
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
