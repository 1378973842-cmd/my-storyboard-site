import { parseApiResponse } from './http';

export type VoiceKind = 'bug' | 'idea';
export type VoiceSort = 'new' | 'likes';

export type VoicePost = {
  id: string;
  kind: VoiceKind;
  title: string;
  body: string;
  images: string[];
  created_at: string;
  anonymous: boolean;
  author_label: string;
  is_mine: boolean;
  can_delete: boolean;
  like_count: number;
  liked: boolean;
  comment_count: number;
};

export type VoiceComment = {
  id: string;
  post_id: string;
  body: string;
  created_at: string;
  anonymous: boolean;
  author_label: string;
  is_mine: boolean;
  can_delete: boolean;
  like_count: number;
  liked: boolean;
};

async function voiceJson<T>(res: Response): Promise<T> {
  const data = (await parseApiResponse(res)) as T & { error?: string };
  if (!res.ok) throw new Error(data.error || '请求失败');
  return data;
}

export async function fetchVoicePosts(opts?: {
  sort?: VoiceSort;
  kind?: VoiceKind | '';
}): Promise<VoicePost[]> {
  const q = new URLSearchParams();
  if (opts?.sort) q.set('sort', opts.sort);
  if (opts?.kind) q.set('kind', opts.kind);
  const res = await fetch(`/api/voice-posts?${q.toString()}`, { credentials: 'same-origin' });
  const data = await voiceJson<{ posts?: VoicePost[] }>(res);
  return data.posts || [];
}

export async function fetchVoicePost(
  id: string,
): Promise<{ post: VoicePost; comments: VoiceComment[] }> {
  const res = await fetch(`/api/voice-posts/${encodeURIComponent(id)}`, {
    credentials: 'same-origin',
  });
  const data = await voiceJson<{ post?: VoicePost; comments?: VoiceComment[] }>(res);
  if (!data.post) throw new Error('帖子不存在');
  return { post: data.post, comments: data.comments || [] };
}

export async function uploadVoiceImages(files: File[]): Promise<string[]> {
  if (!files.length) return [];
  const fd = new FormData();
  files.forEach((f) => fd.append('files', f));
  const res = await fetch('/api/voice-posts/upload', {
    method: 'POST',
    credentials: 'same-origin',
    body: fd,
  });
  const data = await voiceJson<{ files?: { url: string }[] }>(res);
  return (data.files || []).map((f) => f.url).filter(Boolean);
}

export async function createVoicePost(input: {
  title: string;
  body: string;
  kind: VoiceKind;
  anonymous: boolean;
  images: string[];
}): Promise<VoicePost> {
  const res = await fetch('/api/voice-posts', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const data = await voiceJson<{ post?: VoicePost }>(res);
  if (!data.post) throw new Error('发布失败');
  return data.post;
}

export async function deleteVoicePost(id: string): Promise<void> {
  const res = await fetch(`/api/voice-posts/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  await voiceJson<{ ok?: boolean }>(res);
}

export async function toggleVoicePostLike(
  id: string,
): Promise<{ liked: boolean; like_count: number }> {
  const res = await fetch(`/api/voice-posts/${encodeURIComponent(id)}/like`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  return voiceJson(res);
}

export async function createVoiceComment(
  postId: string,
  body: string,
  anonymous: boolean,
): Promise<VoiceComment> {
  const res = await fetch(`/api/voice-posts/${encodeURIComponent(postId)}/comments`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body, anonymous }),
  });
  const data = await voiceJson<{ comment?: VoiceComment }>(res);
  if (!data.comment) throw new Error('评论失败');
  return data.comment;
}

export async function deleteVoiceComment(id: string): Promise<void> {
  const res = await fetch(`/api/voice-comments/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    credentials: 'same-origin',
  });
  await voiceJson<{ ok?: boolean }>(res);
}

export async function toggleVoiceCommentLike(
  id: string,
): Promise<{ liked: boolean; like_count: number }> {
  const res = await fetch(`/api/voice-comments/${encodeURIComponent(id)}/like`, {
    method: 'POST',
    credentials: 'same-origin',
  });
  return voiceJson(res);
}
