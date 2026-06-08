import { isGateAuthError, notifyGateAuthRequired } from './gateAuth';

export async function parseApiResponse(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) {
    if (isGateAuthError(response.status)) notifyGateAuthRequired();
    return {};
  }
  try {
    const data = JSON.parse(text);
    if (isGateAuthError(response.status, data?.error)) notifyGateAuthRequired();
    return data;
  } catch {
    const data = { error: text.slice(0, 500) };
    if (isGateAuthError(response.status, data.error)) notifyGateAuthRequired();
    return data;
  }
}

