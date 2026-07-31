import { readJsonResponse } from './readJsonResponse';

export type HomeCarouselItem = {
  id: string;
  image_url: string;
  sort: number;
  created_at: string;
};

export async function fetchHomeCarousel(): Promise<HomeCarouselItem[]> {
  const res = await fetch('/api/home-carousel', { credentials: 'same-origin' });
  const data = await readJsonResponse<{ items?: HomeCarouselItem[]; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || '加载轮播失败');
  return Array.isArray(data.items) ? data.items : [];
}

export async function uploadHomeCarouselImages(files: File[]): Promise<string[]> {
  if (!files.length) return [];
  const body = new FormData();
  for (const file of files) body.append('images', file);
  const res = await fetch('/api/admin/home-carousel/upload', {
    method: 'POST',
    credentials: 'same-origin',
    body,
  });
  const data = await readJsonResponse<{ urls?: string[]; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || '上传失败');
  return Array.isArray(data.urls) ? data.urls : [];
}

/** 整表发布：更新后主页立即按新列表轮播 */
export async function publishHomeCarousel(imageUrls: string[]): Promise<HomeCarouselItem[]> {
  const res = await fetch('/api/admin/home-carousel', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_urls: imageUrls }),
  });
  const data = await readJsonResponse<{ items?: HomeCarouselItem[]; error?: string }>(res);
  if (!res.ok) throw new Error(data.error || '更新失败');
  return Array.isArray(data.items) ? data.items : [];
}

export async function addHomeCarouselItem(imageUrl: string): Promise<HomeCarouselItem> {
  const res = await fetch('/api/admin/home-carousel', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image_url: imageUrl }),
  });
  const data = await readJsonResponse<{ item?: HomeCarouselItem; error?: string }>(res);
  if (!res.ok || !data.item) throw new Error(data.error || '添加失败');
  return data.item;
}

export async function deleteHomeCarouselItem(id: string): Promise<void> {
  const res = await fetch(`/api/admin/home-carousel/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  const data = await readJsonResponse<{ error?: string }>(res);
  if (!res.ok) throw new Error(data.error || '删除失败');
}
