import { readJsonResponse } from './readJsonResponse';
import {
  isInfiniteCanvasEditorOpen,
  requestCanvasGateView,
  returnToCanvasManager,
} from './infiniteCanvas/canvasEngine.js';

type CanvasListItem = {
  id: string;
  title?: string;
  kind?: string;
  preview_url?: string;
  updated_at?: number;
  created_at?: number;
  icon?: string;
};

declare global {
  interface Window {
    openCanvas?: (id: string, options?: Record<string, unknown>) => Promise<unknown>;
    returnToCanvasManager?: () => Promise<void>;
  }
}

function defaultCanvasTitle(): string {
  return 'Untitled';
}

export async function fetchRecentCanvases(limit = 3): Promise<CanvasListItem[]> {
  const res = await fetch('/api/canvases', { credentials: 'same-origin' });
  const data = await readJsonResponse<{ canvases?: CanvasListItem[]; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || '加载画布失败');
  const list = Array.isArray(data.canvases) ? data.canvases : [];
  return list
    .filter((c) => (c.kind || 'classic') !== 'smart')
    .sort((a, b) => Number(b.updated_at || b.created_at || 0) - Number(a.updated_at || a.created_at || 0))
    .slice(0, limit);
}

export async function waitForOpenCanvas(timeoutMs = 12000): Promise<(id: string) => Promise<unknown>> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (typeof window.openCanvas === 'function') {
      return window.openCanvas.bind(window);
    }
    await new Promise((r) => window.setTimeout(r, 50));
  }
  throw new Error('画布引擎未就绪，请稍后重试');
}

export async function createAndOpenCanvas(opts: {
  warmInfiniteCanvas: () => void;
  openInfiniteCanvas: () => void;
}): Promise<string> {
  const title = defaultCanvasTitle();
  const res = await fetch('/api/canvases', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, icon: '🧩', kind: 'classic' }),
  });
  const data = await readJsonResponse<{
    canvas?: { id?: string };
    error?: string;
    detail?: string;
  }>(res);
  if (!res.ok) {
    throw new Error(data.detail || data.error || '创建画布失败');
  }
  const id = String(data.canvas?.id || '').trim();
  if (!id) throw new Error('创建画布失败：缺少画布 ID');

  opts.warmInfiniteCanvas();
  opts.openInfiniteCanvas();
  const open = await waitForOpenCanvas();
  await open(id);
  return id;
}

export async function openExistingCanvas(
  id: string,
  opts: {
    warmInfiniteCanvas: () => void;
    openInfiniteCanvas: () => void;
  },
): Promise<void> {
  opts.warmInfiniteCanvas();
  opts.openInfiniteCanvas();
  const open = await waitForOpenCanvas();
  await open(id);
}

/** 工作空间：进入选择画布闸门（不恢复上次编辑中的画布） */
export async function openCanvasSelectionGate(opts: {
  warmInfiniteCanvas: () => void;
  openInfiniteCanvas: () => void;
}): Promise<void> {
  requestCanvasGateView();
  opts.warmInfiniteCanvas();
  opts.openInfiniteCanvas();
  const started = Date.now();
  while (Date.now() - started < 15000) {
    // 引擎已在编辑态（keep-alive）：立刻退回选择画布
    if (isInfiniteCanvasEditorOpen()) {
      await returnToCanvasManager();
      return;
    }
    // 首次挂载：requestCanvasGateView 会在 mount 里跳过恢复并显示闸门
    if (typeof window.returnToCanvasManager === 'function' && typeof window.openCanvas === 'function') {
      // 再等一拍，让 mount 吃掉 preferCanvasGateView，避免中途抢跑
      await new Promise((r) => window.setTimeout(r, 120));
      if (isInfiniteCanvasEditorOpen()) {
        await returnToCanvasManager();
      }
      return;
    }
    await new Promise((r) => window.setTimeout(r, 50));
  }
  throw new Error('画布选择页未就绪，请稍后重试');
}

export type { CanvasListItem };
