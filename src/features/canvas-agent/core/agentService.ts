import { serializeCanvasContext, visionImageUrlsForTurn } from './contextSerializer';
import { mediaRunState } from './effectLedger';
import type {
  AgentChatMessage,
  CanvasAgentStreamEvent,
  CanvasSnapshot,
} from '../types';

export type AgentStreamRequest = {
  message: string;
  messages: AgentChatMessage[];
  snapshot: CanvasSnapshot;
  model?: string;
  conversationId?: string;
  playbookId?: string;
  citedNodeIds?: readonly string[];
  askAnswer?: AgentChatMessage['askAnswer'];
  askAnswers?: AgentChatMessage['askAnswers'];
  continueJobId?: string;
  regenerate?: boolean;
  signal?: AbortSignal;
  onEvent: (event: CanvasAgentStreamEvent) => void;
};

function parseEvent(raw: string): CanvasAgentStreamEvent | null {
  try {
    return JSON.parse(raw) as CanvasAgentStreamEvent;
  } catch {
    return null;
  }
}

export async function streamCanvasAgent(request: AgentStreamRequest): Promise<void> {
  const response = await fetch('/api/canvas-agent/chat', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({
      message: request.message,
      model: request.model,
      canvasId: request.snapshot.canvasId,
      conversationId: request.conversationId,
      playbookId: request.playbookId,
      context: serializeCanvasContext(request.snapshot),
      visionImages: visionImageUrlsForTurn(request.snapshot, request.message, request.citedNodeIds),
      runStates: Object.fromEntries(request.snapshot.nodes.map((node) => [node.id, mediaRunState(node)])),
      messages: request.messages.map(({ role, content, askAnswer, askAnswers }) => ({
        role,
        content: askAnswer || askAnswers?.length ? '' : content,
        ...(askAnswers?.length ? { askAnswers } : askAnswer ? { askAnswer } : {}),
      })),
      ...(request.askAnswers?.length
        ? { askAnswers: request.askAnswers }
        : request.askAnswer ? { askAnswer: request.askAnswer } : {}),
      ...(request.continueJobId ? { continueJobId: request.continueJobId } : {}),
      ...(request.regenerate ? { regenerate: true } : {}),
    }),
    signal: request.signal,
  });
  if (!response.ok || !response.body) {
    let error = `Agent 请求失败 (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) error = data.error;
    } catch {
      // Keep the status fallback.
    }
    throw new Error(error);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || '';
    for (const block of blocks) {
      const data = block
        .split(/\r?\n/)
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      const event = parseEvent(data);
      if (event) request.onEvent(event);
    }
    if (done) break;
  }
  if (buffer.trim()) {
    const data = buffer.replace(/^data:\s*/gm, '').trim();
    const event = parseEvent(data);
    if (event) request.onEvent(event);
  }
}

/** 用户主动取消这一轮。走显式接口，不能用连接断开代替：刷新、断网也会断连接。 */
export async function cancelAgentTurn(conversationId: string): Promise<void> {
  if (!conversationId) return;
  const response = await fetch(`/api/canvas-agent/conversations/${encodeURIComponent(conversationId)}/cancel`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`取消留痕失败 (${response.status})`);
  }
}
