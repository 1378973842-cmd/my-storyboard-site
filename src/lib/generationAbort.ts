/** 判断 fetch 是否因 AbortController.abort() 而中断 */
export function isFetchAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}
