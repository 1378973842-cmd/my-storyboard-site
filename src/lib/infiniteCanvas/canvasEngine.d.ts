export function mountInfiniteCanvasEngine(root: HTMLElement): Promise<() => void>;
export function disposeInfiniteCanvasEngine(options?: { preserveEditor?: boolean }): void;
export function setInfiniteCanvasShellSuspended(suspended: boolean): void;
export function isInfiniteCanvasEngineMountedOn(root: HTMLElement): boolean;
export function isInfiniteCanvasEditorOpen(): boolean;
export function readLastCanvasId(): string;
export function consumeQueuedCanvasFavoriteNavigation(): Promise<{
  ok: boolean;
  reason?: string;
  message?: string;
}>;

export function getCanvasBoardBackground(): string;
export function getCanvasViewportScale(): number;
export function subscribeCanvasViewportScale(listener: (scale: number) => void): () => void;
export function resetCanvasViewportZoom(): void;
export function zoomCanvasViewport(factor: number): void;
export function fitCanvasViewportAll(): void;
export function refreshInfiniteCanvasLayout(): void;
export function syncCanvasTopbarDom(): void;
export function setCanvasBoardBackground(color: string): void;
export function returnToCanvasManager(): Promise<void>;
export function renameCurrentCanvas(): Promise<void>;
export function updateCurrentCanvasTitle(title: string): Promise<boolean>;

export function setImageEditMode(mode: string, userTouched?: boolean): void;
export function setCropAspectLock(lock: string): void;
export function setBrushTool(tool: string): void;
export function undoEditDrawing(): void;
export function redoEditDrawing(): void;
export function clearEditDrawing(clearOnly?: boolean): void;
export function restoreAnnotationBase(): Promise<void>;
export function applyImageEdit(): void;
export function closeImageEditor(): void;
export function resetCropBox(): void;
export function resetImageEditZoom(): void;
export function placeImageUrlOnCanvas(url: string, name?: string): unknown;
