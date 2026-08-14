import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Bug,
  EyeOff,
  Heart,
  ImagePlus,
  Lightbulb,
  MessageCircle,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { cn, uniqueRefItemId } from '../lib/utils';
import { formatAnnouncementRelativeTime } from '../lib/studioAnnouncementsApi';
import {
  createVoiceComment,
  createVoicePost,
  deleteVoiceComment,
  deleteVoicePost,
  fetchVoicePost,
  fetchVoicePosts,
  toggleVoiceCommentLike,
  toggleVoicePostLike,
  uploadVoiceImages,
  type VoiceComment,
  type VoiceKind,
  type VoicePost,
  type VoiceSort,
} from '../lib/studioVoiceBoardApi';
import { ReferenceImageLightbox } from './ReferenceImageLightbox';
import { VoiceMarkupEditor } from './VoiceMarkupEditor';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type DraftImg = { id: string; preview: string; file: File };

function KindChip({ kind, compact }: { kind: VoiceKind; compact?: boolean }) {
  const idea = kind === 'idea';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-medium',
        compact ? 'px-2 py-0.5 text-[11px]' : 'px-2.5 py-1 text-[12px]',
        idea ? 'bg-[#ffb866]/14 text-[#ffb866]' : 'bg-[#ff5a6a]/12 text-[#ff8a96]',
      )}
    >
      {idea ? <Lightbulb className="h-3 w-3" /> : <Bug className="h-3 w-3" />}
      {idea ? '建议' : 'Bug'}
    </span>
  );
}

function LikeBtn({
  liked,
  count,
  onClick,
}: {
  liked: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] transition-colors',
        liked ? 'text-[#ff8a96]' : 'text-[#e5e2e1]/45 hover:text-[#e5e2e1]/75',
      )}
    >
      <Heart className={cn('h-3.5 w-3.5', liked && 'fill-current')} strokeWidth={1.8} />
      {count}
    </button>
  );
}

export function StudioVoiceBoard({ toolbarEnd }: { toolbarEnd?: React.ReactNode }) {
  const [sort, setSort] = useState<VoiceSort>('new');
  const [kind, setKind] = useState<VoiceKind | ''>('');
  const [posts, setPosts] = useState<VoicePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [compose, setCompose] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPosts(await fetchVoicePosts({ sort, kind }));
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, [kind, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  const onLikePost = async (id: string) => {
    try {
      const r = await toggleVoicePostLike(id);
      setPosts((prev) =>
        prev.map((p) => (p.id === id ? { ...p, liked: r.liked, like_count: r.like_count } : p)),
      );
    } catch {
      /* ignore */
    }
  };

  const onDeletePost = async (id: string) => {
    try {
      await deleteVoicePost(id);
      if (detailId === id) setDetailId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 px-1 pb-3 pt-5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex rounded-full bg-[#1c1b1b] p-0.5">
            {(['new', 'likes'] as const).map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setSort(id)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[12.5px] font-medium',
                  sort === id ? 'bg-[#ffb866]/16 text-[#ffb866]' : 'text-[#e5e2e1]/50 hover:text-[#e5e2e1]',
                )}
              >
                {id === 'new' ? '最新' : '最热'}
              </button>
            ))}
          </div>
          <div className="flex rounded-full bg-[#1c1b1b] p-0.5">
            {(['', 'bug', 'idea'] as const).map((id) => (
              <button
                key={id || 'all'}
                type="button"
                onClick={() => setKind(id)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-[12.5px] font-medium',
                  kind === id ? 'bg-[#ffb866]/16 text-[#ffb866]' : 'text-[#e5e2e1]/50 hover:text-[#e5e2e1]',
                )}
              >
                {id === '' ? '全部' : id === 'bug' ? 'Bug' : '建议'}
              </button>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => setCompose(true)}
          className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-[#e5e2e1] px-3 text-[12.5px] font-medium text-[#141414] hover:bg-white"
        >
          <span className="inline-flex items-center gap-[3px] pt-[3px] leading-none">
            <Plus className="size-[1em] shrink-0" strokeWidth={2.5} aria-hidden />
            <span>我要发声</span>
          </span>
        </button>
        {toolbarEnd}
      </div>

      <div className="shell-slim-scrollbar min-h-0 flex-1 overflow-y-auto pr-1">
        {loading && !posts.length ? (
          <p className="px-2 py-16 text-center text-[13px] text-[#e5e2e1]/40">加载中…</p>
        ) : error ? (
          <p className="px-2 py-10 text-center text-[13px] text-red-400/90">{error}</p>
        ) : posts.length === 0 ? (
          <div className="flex min-h-[240px] flex-col items-center justify-center gap-2 text-center">
            <p className="text-[14px] font-medium text-[#e5e2e1]/55">还没有人发声</p>
            <p className="text-[12.5px] text-[#e5e2e1]/35">遇到 Bug 或有建议，写出来让大家看见</p>
          </div>
        ) : (
          <ul className="space-y-2.5">
            {posts.map((item) => (
              <li key={item.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setDetailId(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDetailId(item.id);
                    }
                  }}
                  className="flex w-full cursor-pointer flex-col gap-2 rounded-2xl bg-[#1a1919] px-3.5 py-3.5 text-left transition-colors hover:bg-[#1f1e1e]"
                  style={{ outline: '0.5px solid rgba(255,255,255,0.06)', outlineOffset: '-0.5px' }}
                >
                  <span className="flex items-center gap-2">
                    <KindChip kind={item.kind} compact />
                    <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[#e5e2e1]">
                      {item.title}
                    </span>
                  </span>
                  <span className="line-clamp-2 text-[12.5px] leading-relaxed text-[#e5e2e1]/45">
                    {item.body.replace(/\s+/g, ' ').trim()}
                  </span>
                  {item.images[0] ? (
                    <img
                      src={item.images[0]}
                      alt=""
                      className="mt-0.5 h-16 w-24 rounded-lg object-cover"
                    />
                  ) : null}
                  <span className="flex items-center gap-3 text-[12px] text-[#e5e2e1]/38">
                    <span className="inline-flex items-center gap-1">
                      {item.anonymous ? <EyeOff className="h-3 w-3" /> : null}
                      {item.author_label}
                    </span>
                    <span>{formatAnnouncementRelativeTime(item.created_at)}</span>
                    <span className="ml-auto inline-flex items-center">
                      <LikeBtn
                        liked={item.liked}
                        count={item.like_count}
                        onClick={() => void onLikePost(item.id)}
                      />
                      <span className="inline-flex items-center gap-1 px-2 text-[#e5e2e1]/45">
                        <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
                        {item.comment_count}
                      </span>
                      {item.can_delete ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onDeletePost(item.id);
                          }}
                          className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-[#e5e2e1]/70 hover:text-[#ff8a96]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </button>
                      ) : null}
                    </span>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <VoiceComposer
        open={compose}
        onClose={() => setCompose(false)}
        onCreated={() => {
          setCompose(false);
          void load();
        }}
      />
      <VoiceDetail
        id={detailId}
        onClose={() => setDetailId(null)}
        onChanged={() => void load()}
      />
    </div>
  );
}

function VoiceComposer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<VoiceKind>('bug');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [images, setImages] = useState<DraftImg[]>([]);
  const [markupId, setMarkupId] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState('');
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const wasOpenRef = useRef(false);

  useEffect(() => {
    const justOpened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    if (justOpened) {
      setKind('bug');
      setTitle('');
      setBody('');
      setAnonymous(false);
      setError('');
      setPosting(false);
      return;
    }
    if (open) return;
    setMarkupId(null);
    imagesRef.current.forEach((img) => URL.revokeObjectURL(img.preview));
    imagesRef.current = [];
    setImages([]);
  }, [open]);

  useEffect(() => {
    return () => {
      imagesRef.current.forEach((img) => URL.revokeObjectURL(img.preview));
    };
  }, []);

  const markupSrc = images.find((x) => x.id === markupId)?.preview || null;

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const next: DraftImg[] = Array.from(list)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 6 - images.length)
      .map((file) => ({
        id: uniqueRefItemId('voice'),
        preview: URL.createObjectURL(file),
        file,
      }));
    setImages((prev) => [...prev, ...next].slice(0, 6));
  };

  const onSubmit = async () => {
    if (posting) return;
    const t = title.trim();
    const b = body.trim();
    if (!t || !b) {
      setError(!t ? '请写一个标题' : '请描述一下问题和建议');
      return;
    }
    setPosting(true);
    setError('');
    try {
      const urls = await uploadVoiceImages(images.map((x) => x.file));
      await createVoicePost({ title: t, body: b, kind, anonymous, images: urls });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '发布失败');
    } finally {
      setPosting(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <AnimatePresence>
        {open ? (
          <div className="fixed inset-0 z-[240] flex items-center justify-center p-3 sm:p-5">
            <motion.button
              type="button"
              aria-label="关闭"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-0 bg-black/55 backdrop-blur-[2px]"
              onClick={onClose}
            />
            <motion.div
              role="dialog"
              aria-label="我要发声"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={spring}
              className="relative z-10 flex max-h-[min(820px,90dvh)] w-full max-w-[560px] flex-col overflow-hidden rounded-[22px] bg-[#1a1919] shadow-[0_40px_90px_-36px_rgba(0,0,0,0.8)]"
              style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex shrink-0 items-center justify-between px-5 pt-4 md:px-6">
                <h2 className="text-[16px] font-semibold tracking-[-0.02em] text-[#e5e2e1]">我要发声</h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#e5e2e1]/55 hover:bg-white/5 hover:text-[#e5e2e1]"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="shell-slim-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-3 md:px-6">
                <div className="flex gap-2">
                  {(['bug', 'idea'] as const).map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setKind(id)}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-[12.5px] font-medium',
                        kind === id ? 'bg-[#ffb866]/16 text-[#ffb866]' : 'bg-[#242424] text-[#e5e2e1]/60',
                      )}
                    >
                      {id === 'bug' ? '报 Bug' : '提建议'}
                    </button>
                  ))}
                </div>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={80}
                  placeholder="一句话说明问题"
                  className="w-full rounded-xl bg-[#242424] px-3.5 py-2.5 text-[14px] text-[#e5e2e1] outline-none placeholder:text-[#e5e2e1]/30"
                />
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  maxLength={4000}
                  rows={5}
                  placeholder="复现步骤、期望结果，或你的建议。截图能让别人更快看懂。"
                  className="w-full resize-none rounded-xl bg-[#242424] px-3.5 py-2.5 text-[13.5px] leading-relaxed text-[#e5e2e1] outline-none placeholder:text-[#e5e2e1]/30"
                />
                <div className="flex flex-wrap gap-2">
                  {images.map((img) => (
                    <div key={img.id} className="relative">
                      <img src={img.preview} alt="" className="h-16 w-20 rounded-lg object-cover" />
                      <button
                        type="button"
                        title="标注"
                        onClick={() => setMarkupId(img.id)}
                        className="absolute bottom-1 left-1 rounded-full bg-black/55 p-1 text-white"
                      >
                        <Pencil className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        title="移除"
                        onClick={() =>
                          setImages((prev) => {
                            const hit = prev.find((x) => x.id === img.id);
                            if (hit) URL.revokeObjectURL(hit.preview);
                            return prev.filter((x) => x.id !== img.id);
                          })
                        }
                        className="absolute right-1 top-1 rounded-full bg-black/55 p-1 text-white"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  {images.length < 6 ? (
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="flex h-16 w-20 flex-col items-center justify-center gap-1 rounded-lg bg-[#242424] text-[11px] text-[#e5e2e1]/45"
                    >
                      <ImagePlus className="h-4 w-4" />
                      截图
                    </button>
                  ) : null}
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(e) => {
                    addFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => setAnonymous((v) => !v)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12.5px]',
                    anonymous ? 'bg-[#ffb866]/16 text-[#ffb866]' : 'bg-[#242424] text-[#e5e2e1]/55',
                  )}
                >
                  <EyeOff className="h-3.5 w-3.5" />
                  {anonymous ? '匿名发声（别人看不到你的名字）' : '匿名发声'}
                </button>
              </div>
              <footer className="relative z-20 flex shrink-0 flex-col items-end gap-2 px-5 py-4 md:px-6">
                {error ? <p className="w-full text-right text-[12.5px] text-red-400/90">{error}</p> : null}
                <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="h-10 rounded-full bg-[#242424] px-4 text-[13px] text-[#e5e2e1]"
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={posting}
                  onClick={() => void onSubmit()}
                  className="h-10 rounded-full bg-[#e5e2e1] px-5 text-[13.5px] font-medium text-[#141414] hover:bg-white disabled:opacity-50"
                >
                  {posting ? '发布中…' : '发布'}
                </button>
                </div>
              </footer>
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
      <VoiceMarkupEditor
        src={markupSrc}
        onCancel={() => setMarkupId(null)}
        onDone={(blob) => {
          const id = markupId;
          setMarkupId(null);
          if (!id) return;
          const file = new File([blob], `voice_${Date.now()}.png`, { type: 'image/png' });
          const preview = URL.createObjectURL(file);
          setImages((prev) =>
            prev.map((x) => {
              if (x.id !== id) return x;
              URL.revokeObjectURL(x.preview);
              return { ...x, file, preview };
            }),
          );
        }}
      />
    </>,
    document.body,
  );
}

function VoiceDetail({
  id,
  onClose,
  onChanged,
}: {
  id: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [post, setPost] = useState<VoicePost | null>(null);
  const [comments, setComments] = useState<VoiceComment[]>([]);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [anon, setAnon] = useState(false);
  const [sending, setSending] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const load = useCallback(async (postId: string) => {
    setError('');
    try {
      const data = await fetchVoicePost(postId);
      setPost(data.post);
      setComments(data.comments);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    }
  }, []);

  useEffect(() => {
    if (!id) {
      setPost(null);
      setComments([]);
      setDraft('');
      return;
    }
    void load(id);
  }, [id, load]);

  const onLike = async () => {
    if (!post) return;
    const r = await toggleVoicePostLike(post.id);
    setPost({ ...post, liked: r.liked, like_count: r.like_count });
    onChanged();
  };

  const onSend = async () => {
    if (!post || sending || !draft.trim()) return;
    setSending(true);
    try {
      const c = await createVoiceComment(post.id, draft.trim(), anon);
      setComments((prev) => [...prev, c]);
      setDraft('');
      setPost({ ...post, comment_count: post.comment_count + 1 });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '评论失败');
    } finally {
      setSending(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <AnimatePresence>
        {id ? (
          <div className="fixed inset-0 z-[240] flex items-center justify-center p-3 sm:p-5">
            <motion.button
              type="button"
              aria-label="关闭"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
              onClick={onClose}
            />
            <motion.div
              role="dialog"
              aria-modal="true"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={spring}
              className="relative z-10 flex max-h-[min(860px,90dvh)] w-full max-w-[600px] flex-col overflow-hidden rounded-[22px] bg-[#1a1919] shadow-[0_40px_90px_-36px_rgba(0,0,0,0.8)]"
              style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
              onClick={(e) => e.stopPropagation()}
            >
              <header className="flex shrink-0 items-center justify-between px-5 pt-4 md:px-6">
                <h2 className="text-[16px] font-semibold text-[#e5e2e1]">发声</h2>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-[#e5e2e1]/55 hover:bg-white/5"
                  aria-label="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </header>
              <div className="shell-slim-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-3 md:px-6">
                {error && !post ? <p className="py-10 text-center text-[13px] text-red-400/90">{error}</p> : null}
                {post ? (
                  <>
                    <KindChip kind={post.kind} />
                    <h3 className="mt-2 text-[20px] font-semibold leading-snug tracking-[-0.02em] text-[#e5e2e1]">
                      {post.title}
                    </h3>
                    <p className="mt-1.5 text-[12.5px] text-[#e5e2e1]/42">
                      {post.anonymous ? <EyeOff className="mr-1 inline h-3 w-3" /> : null}
                      {post.author_label}
                      <span className="mx-1.5 text-[#e5e2e1]/22">·</span>
                      {formatAnnouncementRelativeTime(post.created_at)}
                    </p>
                    <p className="mt-4 whitespace-pre-wrap break-words text-[14px] leading-[1.7] text-[#e5e2e1]/78">
                      {post.body}
                    </p>
                    {post.images.length ? (
                      <div className="mt-4 flex flex-wrap gap-2">
                        {post.images.map((url) => (
                          <button key={url} type="button" onClick={() => setPreview(url)}>
                            <img src={url} alt="" className="h-28 w-36 rounded-xl object-cover" />
                          </button>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-4 flex items-center gap-2">
                      <LikeBtn liked={post.liked} count={post.like_count} onClick={() => void onLike()} />
                      {post.can_delete ? (
                        <button
                          type="button"
                          onClick={async () => {
                            await deleteVoicePost(post.id);
                            onChanged();
                            onClose();
                          }}
                          className="ml-auto inline-flex items-center gap-1 rounded-full px-2 py-1 text-[12px] text-[#e5e2e1]/70 hover:text-[#ff8a96]"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </button>
                      ) : null}
                    </div>
                    <div className="mt-6">
                      <p className="text-[13px] font-medium text-[#e5e2e1]/70">评论 {comments.length}</p>
                      <ul className="mt-3 space-y-3">
                        {comments.map((c) => (
                          <li key={c.id} className="rounded-xl bg-[#242424] px-3.5 py-3">
                            <p className="text-[12px] text-[#e5e2e1]/42">
                              {c.anonymous ? <EyeOff className="mr-1 inline h-3 w-3" /> : null}
                              {c.author_label}
                              <span className="mx-1.5 text-[#e5e2e1]/22">·</span>
                              {formatAnnouncementRelativeTime(c.created_at)}
                            </p>
                            <p className="mt-1.5 whitespace-pre-wrap break-words text-[13.5px] leading-relaxed text-[#e5e2e1]/80">
                              {c.body}
                            </p>
                            <div className="mt-1 flex items-center">
                              <LikeBtn
                                liked={c.liked}
                                count={c.like_count}
                                onClick={async () => {
                                  const r = await toggleVoiceCommentLike(c.id);
                                  setComments((prev) =>
                                    prev.map((x) =>
                                      x.id === c.id ? { ...x, liked: r.liked, like_count: r.like_count } : x,
                                    ),
                                  );
                                }}
                              />
                              {c.can_delete ? (
                                <button
                                  type="button"
                                  onClick={async () => {
                                    await deleteVoiceComment(c.id);
                                    setComments((prev) => prev.filter((x) => x.id !== c.id));
                                    if (post) setPost({ ...post, comment_count: Math.max(0, post.comment_count - 1) });
                                    onChanged();
                                  }}
                                  className="ml-auto text-[12px] text-[#e5e2e1]/70 hover:text-[#ff8a96]"
                                >
                                  删除
                                </button>
                              ) : null}
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </>
                ) : null}
              </div>
              {post ? (
                <footer className="shrink-0 space-y-2 px-5 py-3 md:px-6 md:pb-5">
                  {error ? <p className="text-[12.5px] text-red-400/90">{error}</p> : null}
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    maxLength={1000}
                    rows={2}
                    placeholder="写下你的评论…"
                    className="w-full resize-none rounded-xl bg-[#242424] px-3.5 py-2.5 text-[13.5px] text-[#e5e2e1] outline-none placeholder:text-[#e5e2e1]/30"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setAnon((v) => !v)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px]',
                        anon ? 'bg-[#ffb866]/16 text-[#ffb866]' : 'text-[#e5e2e1]/45 hover:text-[#e5e2e1]',
                      )}
                    >
                      <EyeOff className="h-3.5 w-3.5" />
                      匿名评论
                    </button>
                    <button
                      type="button"
                      disabled={sending || !draft.trim()}
                      onClick={() => void onSend()}
                      className="ml-auto h-9 rounded-full bg-[#e5e2e1] px-4 text-[13px] font-medium text-[#141414] disabled:opacity-40"
                    >
                      {sending ? '发送中…' : '发送'}
                    </button>
                  </div>
                </footer>
              ) : null}
            </motion.div>
          </div>
        ) : null}
      </AnimatePresence>
      <ReferenceImageLightbox url={preview} onClose={() => setPreview(null)} zIndexClass="z-[260]" />
    </>,
    document.body,
  );
}
