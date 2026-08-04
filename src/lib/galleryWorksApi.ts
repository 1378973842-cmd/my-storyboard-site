import type { GalleryWorkCategoryId } from './galleryCategories';

export type GalleryProcessStep = {
  image_path: string;
  images?: string[];
  note: string;
};

export type GalleryWork = {
  id: string;
  title: string;
  description: string;
  category: string;
  image_path: string;
  images: string[];
  process_steps?: GalleryProcessStep[];
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

export type ProcessStepImageInput = {
  file?: File | null;
  path?: string | null;
  favoriteId?: string | null;
};

export type ProcessStepInput = {
  note: string;
  images: ProcessStepImageInput[];
};

export type UpsertGalleryWorkInput = {
  title: string;
  description: string;
  category: GalleryWorkCategoryId;
  files?: File[];
  favoriteIds?: string[];
  keepPaths?: string[];
  processSteps?: ProcessStepInput[];
  /** true = 仅存个人空间，不进公共画廊 */
  asDraft?: boolean;
};

export function processStepImages(step: GalleryProcessStep): string[] {
  if (Array.isArray(step.images) && step.images.length) return step.images.filter(Boolean);
  return step.image_path ? [step.image_path] : [];
}

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
  form.append('as_draft', input.asDraft ? '1' : '0');
  for (const file of input.files || []) {
    form.append('images', file);
  }

  const stepSpecs: Array<{
    note: string;
    images: Array<{ path?: string; favorite_id?: string; file?: boolean }>;
  }> = [];
  for (const step of input.processSteps || []) {
    const images: Array<{ path?: string; favorite_id?: string; file?: boolean }> = [];
    for (const img of step.images || []) {
      if (img.file) {
        form.append('step_images', img.file);
        images.push({ file: true });
      } else if (img.favoriteId) {
        images.push({ favorite_id: img.favoriteId });
      } else if (img.path) {
        images.push({ path: img.path });
      }
    }
    if (images.length) stepSpecs.push({ note: step.note, images });
  }
  form.append('process_steps', JSON.stringify(stepSpecs));
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

export async function deleteGalleryWork(id: string): Promise<void> {
  const res = await fetch(`/api/gallery/works/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  const data = (await res.json()) as { error?: string };
  if (!res.ok) throw new Error(data.error || '删除失败');
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
