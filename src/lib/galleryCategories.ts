/** 公共画廊投稿分类（前后端共用） */
export const GALLERY_WORK_CATEGORIES = [
  { id: 'anim', label: '动画' },
  { id: 'creative', label: '创意' },
  { id: 'tutorial', label: '教程' },
  { id: 'original', label: '原画' },
  { id: 'market', label: '市场' },
] as const;

export type GalleryWorkCategoryId = (typeof GALLERY_WORK_CATEGORIES)[number]['id'];

export const GALLERY_FILTER_CATEGORIES = [
  { id: 'all', label: '全部' },
  ...GALLERY_WORK_CATEGORIES,
] as const;

export function isGalleryWorkCategory(raw: unknown): raw is GalleryWorkCategoryId {
  return GALLERY_WORK_CATEGORIES.some((c) => c.id === raw);
}

export function galleryCategoryLabel(id: string | null | undefined): string {
  const hit = GALLERY_WORK_CATEGORIES.find((c) => c.id === id);
  return hit?.label || '未分类';
}
