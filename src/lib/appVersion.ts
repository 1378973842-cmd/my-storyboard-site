export type AppVersionInfo = {
  version: string;
  revision?: string;
  builtAt?: string;
};

export async function fetchAppVersionInfo(): Promise<AppVersionInfo | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<AppVersionInfo>;
    const version = String(data?.version || '').trim();
    if (!version) return null;
    return {
      version,
      revision: data?.revision ? String(data.revision) : undefined,
      builtAt: data?.builtAt ? String(data.builtAt) : undefined,
    };
  } catch {
    return null;
  }
}
