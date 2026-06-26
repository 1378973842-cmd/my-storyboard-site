export const CANVAS_FAVORITE_NAV_KEY = 'gemini-canvas-favorite-nav-target';

export type CanvasFavoriteNavTarget = {
  canvasId: string;
  nodeId: string;
  imageUrl: string;
};

export function queueCanvasFavoriteNavigation(target: CanvasFavoriteNavTarget): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(CANVAS_FAVORITE_NAV_KEY, JSON.stringify(target));
  } catch {
    /* ignore */
  }
}

export function readCanvasFavoriteNavigation(): CanvasFavoriteNavTarget | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(CANVAS_FAVORITE_NAV_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<CanvasFavoriteNavTarget>;
    const canvasId = String(data.canvasId || '').trim();
    if (!canvasId) return null;
    return {
      canvasId,
      nodeId: String(data.nodeId || '').trim(),
      imageUrl: String(data.imageUrl || '').trim(),
    };
  } catch {
    return null;
  }
}

export function clearCanvasFavoriteNavigation(): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.removeItem(CANVAS_FAVORITE_NAV_KEY);
  } catch {
    /* ignore */
  }
}

export const CANVAS_FAVORITE_NAV_EVENT = 'studio-canvas-favorite-nav';

export function dispatchCanvasFavoriteNavigation(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(CANVAS_FAVORITE_NAV_EVENT));
}
