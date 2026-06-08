export function mountInfiniteCanvasEngine(root: HTMLElement): Promise<() => void>;
export function disposeInfiniteCanvasEngine(options?: { preserveEditor?: boolean }): void;
export function setInfiniteCanvasShellSuspended(suspended: boolean): void;
export function isInfiniteCanvasEngineMountedOn(root: HTMLElement): boolean;
export function isInfiniteCanvasEditorOpen(): boolean;
