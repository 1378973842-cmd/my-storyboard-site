export type CanvasAgentAsset = {
  id: string;
  name: string;
  url: string;
  category: string;
  uploadedAt: number;
};

type AssetCache = {
  ownerKey: string;
  assets: CanvasAgentAsset[];
  fetchedAt: number;
};

// 死链（缓存旧、素材已删）不会静默丢参考：
// readUploadsBytes 返回 null 时抛「图片不存在」，
// 整次任务失败，错误经 runError → cascade → agentLastError 可见。
// 多张参考图里有一张不存在，整次失败，不会少一张继续跑。
// 所以缓存不做 apply 时 url 校验（那要网络请求）。
// 登出（storyboard-auth-required）先把这里清成空。空缓存读不到任何人的素材。
// ownerKey 比对是第二道：刷新时身份变了就丢掉旧列表再拉。
let cache: AssetCache = { ownerKey: '', assets: [], fetchedAt: 0 };
let inflight: Promise<void> | null = null;
let boundTarget: EventTarget | null = null;

type AssetFetch = (url: string, init?: RequestInit) => Promise<Response>;

function defaultFetch(url: string, init?: RequestInit): Promise<Response> {
  return fetch(url, { credentials: 'same-origin', ...init });
}

function emptyCache(): AssetCache {
  return { ownerKey: '', assets: [], fetchedAt: Date.now() };
}

export function clearCanvasAgentAssetCache(): void {
  cache = emptyCache();
}

export function readCanvasAgentAssets(): CanvasAgentAsset[] {
  return cache.assets.map((item) => ({ ...item }));
}

export function peekCanvasAgentAssetCache(): AssetCache {
  return { ownerKey: cache.ownerKey, assets: readCanvasAgentAssets(), fetchedAt: cache.fetchedAt };
}

type LibraryItem = { id?: string; name?: string; url?: string; created_at?: number };
type LibraryCategory = { name?: string; items?: LibraryItem[] };

// 每条有 created_at。store 的 sortItems 只在单个分类内按它倒序，分类之间没有全局时间序。
// 有时间戳就跨分类按 created_at 倒序；全部没有时间戳时，按文档出现顺序倒序。
export function flattenAssetLibrary(library: { categories?: LibraryCategory[] } | null | undefined): CanvasAgentAsset[] {
  const categories = Array.isArray(library?.categories) ? library.categories : [];
  const rows: Array<{ id: string; name: string; url: string; category: string; created_at: number }> = [];
  for (const cat of categories) {
    const category = String(cat?.name || '').trim() || '未命名文件夹';
    const items = Array.isArray(cat?.items) ? cat.items : [];
    for (const item of items) {
      const url = String(item?.url || '').trim();
      if (!url) continue;
      rows.push({
        id: String(item?.id || ''),
        name: String(item?.name || ''),
        url,
        category,
        created_at: Number(item?.created_at) || 0,
      });
    }
  }
  if (rows.some((row) => row.created_at > 0)) rows.sort((a, b) => b.created_at - a.created_at);
  else rows.reverse();
  // uploadedAt 用条目的 created_at。addAssetItem / addAssetItemFromBuffer 写入时已经记下。
  // 缺时间戳的是 0，排在有时间的后面；全部没有时仍按文档出现顺序倒序。
  return rows.map(({ id, name, url, category, created_at }) => ({
    id,
    name,
    url,
    category,
    uploadedAt: created_at,
  }));
}

async function pull(fetchImpl: AssetFetch): Promise<void> {
  let statusRes: Response;
  try {
    statusRes = await fetchImpl('/api/auth/status', { credentials: 'same-origin' });
  } catch {
    clearCanvasAgentAssetCache();
    return;
  }
  if (!statusRes.ok) {
    clearCanvasAgentAssetCache();
    return;
  }
  let status: { ok?: boolean; user?: { id?: string } } = {};
  try {
    status = await statusRes.json();
  } catch {
    clearCanvasAgentAssetCache();
    return;
  }
  if (!status?.ok || !status.user?.id) {
    clearCanvasAgentAssetCache();
    return;
  }
  const ownerKey = String(status.user.id);
  if (ownerKey !== cache.ownerKey) {
    cache = { ownerKey, assets: [], fetchedAt: Date.now() };
  }
  let libRes: Response;
  try {
    libRes = await fetchImpl('/api/asset-library', { credentials: 'same-origin' });
  } catch {
    cache = { ownerKey, assets: [], fetchedAt: Date.now() };
    return;
  }
  if (!libRes.ok) {
    cache = { ownerKey, assets: [], fetchedAt: Date.now() };
    return;
  }
  try {
    const data = await libRes.json() as { library?: { categories?: LibraryCategory[] } };
    cache = { ownerKey, assets: flattenAssetLibrary(data?.library), fetchedAt: Date.now() };
  } catch {
    cache = { ownerKey, assets: [], fetchedAt: Date.now() };
  }
}

export function refreshCanvasAgentAssets(fetchImpl?: AssetFetch): Promise<void> {
  if (inflight) return inflight;
  const job = pull(fetchImpl || defaultFetch).finally(() => {
    if (inflight === job) inflight = null;
  });
  inflight = job;
  return job;
}

export function bindCanvasAgentAssetCache(target: EventTarget = window): void {
  if (boundTarget === target) return;
  boundTarget = target;
  target.addEventListener('canvas-asset-library-changed', () => {
    void refreshCanvasAgentAssets();
  });
  target.addEventListener('storyboard-auth-required', () => {
    clearCanvasAgentAssetCache();
  });
}
