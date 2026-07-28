export type AssetLibraryItem = {
  id: string;
  name: string;
  url: string;
  created_at: number;
};

export type AssetLibraryCategory = {
  id: string;
  name: string;
  type: string;
  parent_id?: string | null;
  items: AssetLibraryItem[];
};

export type AssetLibraryDoc = {
  categories: AssetLibraryCategory[];
  updated_at: number;
};

async function parseJson(res: Response) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(String((data as { error?: string; detail?: string }).error || (data as { detail?: string }).detail || '请求失败'));
  }
  return data;
}

export async function fetchAssetLibrary(): Promise<AssetLibraryDoc> {
  const res = await fetch('/api/asset-library', { credentials: 'include' });
  const data = await parseJson(res);
  return data.library as AssetLibraryDoc;
}

export async function createAssetCategory(name: string, parentId?: string | null) {
  const res = await fetch('/api/asset-library/categories', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, parent_id: parentId || null }),
  });
  return parseJson(res);
}

export async function renameAssetCategory(id: string, name: string) {
  const res = await fetch(`/api/asset-library/categories/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJson(res);
}

export async function deleteAssetCategory(id: string) {
  const res = await fetch(`/api/asset-library/categories/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return parseJson(res);
}

export async function duplicateAssetCategory(id: string) {
  const res = await fetch(`/api/asset-library/categories/${encodeURIComponent(id)}/duplicate`, {
    method: 'POST',
    credentials: 'include',
  });
  return parseJson(res);
}

export async function addAssetItem(categoryId: string, url: string, name?: string) {
  const res = await fetch('/api/asset-library/items', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_id: categoryId, url, name }),
  });
  return parseJson(res);
}

export async function uploadAssetItem(categoryId: string, file: File) {
  const form = new FormData();
  form.append('category_id', categoryId);
  form.append('file', file);
  const res = await fetch('/api/asset-library/upload', {
    method: 'POST',
    credentials: 'include',
    body: form,
  });
  return parseJson(res);
}

export async function renameAssetItem(id: string, name: string) {
  const res = await fetch(`/api/asset-library/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return parseJson(res);
}

export async function moveAssetItem(id: string, categoryId: string) {
  const res = await fetch(`/api/asset-library/items/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_id: categoryId }),
  });
  return parseJson(res);
}

export async function deleteAssetItem(id: string) {
  const res = await fetch(`/api/asset-library/items/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  return parseJson(res);
}
