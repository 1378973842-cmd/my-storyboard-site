import type { GalleryWorkCategoryId } from './galleryCategories';

export type GalleryWork = {
  id: string;
  title: string;
  description: string;
  category: string;
  image_path: string;
  images: string[];
  preview_path: string;
  thumbnail_path: string;
  source_favorite_id: string | null;
  published: boolean;
  owner_name?: string;
  user_id: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
  favorited?: boolean;
  favorite_count?: number;
  prompt?: string;
  model?: string;
  shared_at?: string | null;
};

export type FavoritePick = {
  id: string;
  thumbnail_path: string;
  preview_path?: string;
  prompt: string;
};

export type UpsertGalleryWorkInput = {
  title: string;
  description: string;
  category: GalleryWorkCategoryId;
  files?: File[];
  favoriteIds?: string[];
  keepPaths?: string[];
};

async function readWorkResponse(res: Response): Promise<GalleryWork> {
  const data = (await res.json()) as { item?: GalleryWork; error?: string };
  if (!res.ok) throw new Error(data.error || '请求失败');
  if (!data.item) throw new Error('请求失败');
  return data.item;
}

function appendUpsertForm(form: FormData, input: UpsertGalleryWorkInput): void {
  form.append('title', input.title);
  form.append('description', input.description);
  form.append('category', input.category);
  form.append('keep_paths', JSON.stringify(input.keepPaths || []));
  form.append('favorite_ids', JSON.stringify(input.favoriteIds || []));
  for (const file of input.files || []) {
    form.append('images', file);
  }
}

export async function fetchGalleryWorks(): Promise<GalleryWork[]> {
  const res = await fetch('/api/gallery', { credentials: 'same-origin' });
  const data = (await res.json()) as { items?: GalleryWork[]; error?: string };
  if (!res.ok) throw new Error(data.error || '加载失败');
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchMyWorks(): Promise<GalleryWork[]> {
  const res = await fetch('/api/my-works', { credentials: 'same-origin' });
  const data = (await res.json()) as { items?: GalleryWork[]; error?: string };
  if (!res.ok) throw new Error(data.error || '加载失败');
  return Array.isArray(data.items) ? data.items : [];
}

export async function fetchMyFavoritesForPicker(): Promise<FavoritePick[]> {
  const res = await fetch('/api/my-favorites', { credentials: 'same-origin' });
  const data = (await res.json()) as { items?: FavoritePick[]; error?: string };
  if (!res.ok) throw new Error(data.error || '加载收藏失败');
  return Array.isArray(data.items) ? data.items : [];
}

export async function createGalleryWork(input: UpsertGalleryWorkInput): Promise<GalleryWork> {
  const form = new FormData();
  appendUpsertForm(form, input);
  const res = await fetch('/api/gallery/works', {
    method: 'POST',
    credentials: 'same-origin',
    body: form,
  });
  return readWorkResponse(res);
}

export async function updateGalleryWork(
  id: string,
  input: UpsertGalleryWorkInput,
): Promise<GalleryWork> {
  const form = new FormData();
  appendUpsertForm(form, input);
  const res = await fetch(`/api/gallery/works/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    credentials: 'same-origin',
    body: form,
  });
  return readWorkResponse(res);
}

export async function toggleGalleryFavorite(
  workId: string,
): Promise<{ favorited: boolean; favorite_count: number; item?: GalleryWork }> {
  const res = await fetch(`/api/gallery/works/${encodeURIComponent(workId)}/favorite`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  const data = (await res.json()) as {
    favorited?: boolean;
    favorite_count?: number;
    item?: GalleryWork;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error || '收藏失败');
  return {
    favorited: Boolean(data.favorited),
    favorite_count: Number(data.favorite_count || 0),
    item: data.item,
  };
}

export async function fetchMyGalleryFavorites(): Promise<GalleryWork[]> {
  const res = await fetch('/api/my-gallery-favorites', { credentials: 'same-origin' });
  const data = (await res.json()) as { items?: GalleryWork[]; error?: string };
  if (!res.ok) throw new Error(data.error || '加载画廊收藏失败');
  return Array.isArray(data.items) ? data.items : [];
}
