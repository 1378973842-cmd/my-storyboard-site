export function mountInfiniteCanvasEngine(root: HTMLElement): Promise<() => void>;
export function disposeInfiniteCanvasEngine(options?: { preserveEditor?: boolean }): void;
export function setInfiniteCanvasShellSuspended(suspended: boolean): void;
export function isInfiniteCanvasEngineMountedOn(root: HTMLElement): boolean;
export function isInfiniteCanvasEditorOpen(): boolean;
export function getCurrentCanvasId(): string;
export function readLastCanvasId(): string;
export function consumeQueuedCanvasFavoriteNavigation(): Promise<{
  ok: boolean;
  reason?: string;
  message?: string;
}>;

export function getCanvasBoardBackground(): string;
export function getCanvasThemeMode(): 'dark' | 'light';
export function setCanvasThemeMode(mode: 'dark' | 'light'): 'dark' | 'light';
export function getCanvasViewportScale(): number;
export function subscribeCanvasViewportScale(listener: (scale: number) => void): () => void;
export function resetCanvasViewportZoom(): void;
export function zoomCanvasViewport(factor: number): void;
export function fitCanvasViewportAll(): void;
export function isCanvasMinimapVisible(): boolean;
export function setCanvasMinimapVisible(visible: boolean): boolean;
export function toggleCanvasMinimapVisible(): boolean;
export function refreshInfiniteCanvasLayout(): void;
export function syncCanvasTopbarDom(): void;
export function setCanvasBoardBackground(color: string): void;
export function returnToCanvasManager(): Promise<void>;
/** 下次进入画布壳时强制显示选择画布页（不恢复上次画布） */
export function requestCanvasGateView(): void;
export function renameCurrentCanvas(): Promise<void>;
export function updateCurrentCanvasTitle(title: string): Promise<boolean>;

export function setImageEditMode(mode: string, userTouched?: boolean): void;
export function setCropAspectLock(lock: string): void;
export function toggleCropAspectMenu(): void;
export function setCropAspectMenuOpen(open: boolean): void;
export function setBrushTool(tool: string): void;
export function undoEditDrawing(): void;
export function redoEditDrawing(): void;
export function clearEditDrawing(clearOnly?: boolean): void;
export function restoreAnnotationBase(): Promise<void>;
export function applyImageEdit(): void;
export function rotateImageEditBy90(): void;
export function toggleImageEditFlip(axis?: 'h' | 'v'): void;
export function closeImageEditor(): void;
export function resetCropBox(): void;
export function resetImageEditZoom(): void;
export function placeImageUrlOnCanvas(url: string, name?: string): unknown;
export function openCanvasLightboxForUrl(url: string): void;
export function downloadCanvasMediaUrl(url: string, filename?: string): Promise<void>;

export type CanvasAgentEngineAction =
  | {
      type: 'create_node';
      tempId?: string;
      nodeType: string;
      initialParams?: Record<string, unknown>;
      position?: { x: number; y: number };
    }
  | {
      type: 'connect_nodes';
      sourceNodeId: string;
      targetNodeId: string;
    }
  | {
      type: 'update_node_params';
      nodeId: string;
      patch: Record<string, unknown>;
    };

export type CanvasAgentEngineSnapshot = {
  canvasId: string;
  nodes: Array<Record<string, unknown> & { id: string; type: string; x?: number; y?: number }>;
  connections: Array<{ id: string; from: string; to: string }>;
  selectedNodeIds: string[];
  viewport: { x: number; y: number; scale: number };
  viewportCenter: { x: number; y: number };
  settings: Record<string, unknown>;
};

export const CANVAS_GENERATOR_TYPES: readonly string[];
export function getCanvasAgentSnapshot(): CanvasAgentEngineSnapshot;
export function flattenCanvasAgentParameters(raw: unknown): unknown;
export function applyCanvasAgentActions(
  actions: CanvasAgentEngineAction[],
  session?: { conversationId?: string },
): {
  createdNodeIds: string[];
  idMap: Record<string, string>;
};
export function executeCanvasAgentNodeSkill(nodeId: string): Promise<unknown>;
export function withCanvasAgentNode(
  nodeId: string,
  mutate: (node: Record<string, unknown> & { id: string }) => void,
): void;
export function flushCanvasAgentSave(): void;
export function canvasAgentExecutionTimeoutMs(node: { type?: string; count?: number; batch_count?: number } | null | undefined): number;
export function canvasAgentBatchTimeoutMs(nodes: Array<{ type?: string; count?: number; batch_count?: number } | null | undefined>): number;
export function takeCanvasAgentOutputHost(nodeId: string): string;
export function discardCanvasAgentOutputHost(nodeId: string): void;
