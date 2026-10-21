import { serializeCanvasContext, visionImageUrlsForTurn } from './contextSerializer';
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
      messages: request.messages.map(({ role, content }) => ({ role, content })),
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
