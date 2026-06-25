export async function readJsonResponse<T extends Record<string, unknown>>(
  res: Response
): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    if (!res.ok) {
      throw new Error(`请求失败 (${res.status})，服务可能未启动或需重启`);
    }
    return {} as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`服务返回异常 (${res.status})，请刷新或重启开发服务器`);
  }
}
