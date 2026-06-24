import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Copy, Check, Loader2, X, Plus, Download, Maximize2, ImageDown, ClipboardCopy } from 'lucide-react';
import { useStore } from '../store/useStore';
import { parseApiResponse } from '../lib/http';
import { cn, uniqueRefItemId } from '../lib/utils';
import { SIZES, RATIOS, RUNNINGHUB_G2_RATIOS } from '../constants';
import { AspectRatio, ImageSize, RunningHubG2AspectRatio, GenerationResponse } from '../types';
import { useRefThumbPreview } from '../hooks/useRefThumbPreview';
import { ReferenceImageLightbox } from './ReferenceImageLightbox';
import { ZoomableLightboxImage } from './ZoomableLightboxImage';
import { StudioConvergePiece } from './motion/StudioConverge';

type EditRef = { id: string; url: string };
type EditRunMode = 'edit' | 'edit_gpt2' | 'generate';
type EditHistoryItem = { url: string; prompt: string; refs?: string[]; mode: 'edit' | 'edit_gpt2' | 'generate' };
type UnifiedHistoryItem = { url: string; mode: EditRunMode | 'source' };
type ContextMenuState = {
  open: boolean;
  x: number;
  y: number;
  url: string | null;
  mode: EditRunMode | 'source';
};

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取图片失败'));
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

type Props = {
  onBack?: () => void;
  /** 从封面进入时由 App 递增，触发汇聚进场 */
  enterKey?: number;
};

export const StandaloneImageEditorPage: React.FC<Props> = ({ enterKey = 0 }) => {
  const { data, references } = useStore();
  const addNotice = useStore((s) => s.addNotice);

  const [isHoveringImage, setIsHoveringImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [editProgress, setEditProgress] = useState(0);

  const [editPrompt, setEditPrompt] = useState('');
  const [editImageSize, setEditImageSize] = useState<ImageSize>('2K');
  const [gptEditResolution, setGptEditResolution] = useState<ImageSize>('2K');
  const [gptEditAspectRatio, setGptEditAspectRatio] = useState<RunningHubG2AspectRatio>('16:9');
  const [editAspectRatio, setEditAspectRatio] = useState<AspectRatio>('16:9');

  const [editResultImageEdit, setEditResultImageEdit] = useState<string | null>(null);
  const [editResultImageGenerate, setEditResultImageGenerate] = useState<string | null>(null);
  const [editRefsEdit, setEditRefsEdit] = useState<EditRef[]>([]);
  const [editRefsGenerate, setEditRefsGenerate] = useState<EditRef[]>([]);
  const [editHistoryEdit, setEditHistoryEdit] = useState<EditHistoryItem[]>([]);
  const [editHistoryGenerate, setEditHistoryGenerate] = useState<EditHistoryItem[]>([]);

  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [runMode, setRunMode] = useState<EditRunMode>('edit');
  const [contextMenu, setContextMenu] = useState<ContextMenuState>({
    open: false,
    x: 0,
    y: 0,
    url: null,
    mode: 'source',
  });
  const isEditLikeMode = runMode === 'edit' || runMode === 'edit_gpt2';
  const editResultImage = runMode === 'generate' ? editResultImageGenerate : editResultImageEdit;
  const editRefs = runMode === 'generate' ? editRefsGenerate : editRefsEdit;
  const editHistory = runMode === 'generate' ? editHistoryGenerate : editHistoryEdit;
  const allModeHistory = [...editHistoryEdit, ...editHistoryGenerate];

  const editTargetInputRef = useRef<HTMLInputElement>(null);
  const { previewUrl: refThumbPreviewUrl, setPreviewUrl: setRefThumbPreviewUrl, handlersFor: refThumbHandlers } =
    useRefThumbPreview();

  useEffect(() => {
    if (!imagePreviewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImagePreviewOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imagePreviewOpen]);

  useEffect(() => {
    if (!contextMenu.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setContextMenu((s) => ({ ...s, open: false }));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contextMenu.open]);

  const downloadImageUrl = async (url: string, baseName = 'image_edit') => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      const ext = blob.type.includes('png') ? 'png' : blob.type.includes('webp') ? 'webp' : 'png';
      a.download = `${baseName}_${Date.now()}.${ext}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      setError('下载失败，请稍后重试');
    }
  };

  const copyImageToClipboard = async (url: string) => {
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      // Some browsers block image clipboard without secure context; fallback to text copy.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ClipboardItemCtor = (window as any).ClipboardItem as any;
      if (ClipboardItemCtor && navigator.clipboard?.write) {
        await navigator.clipboard.write([new ClipboardItemCtor({ [blob.type || 'image/png']: blob })]);
        return;
      }
      await navigator.clipboard.writeText(url);
    } catch {
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        setError('复制失败（浏览器权限限制）');
      }
    }
  };

  const urlToOriginalPrompt = useMemo(() => {
    const map = new Map<string, string>();
    const gen = data as GenerationResponse | null;
    if (!gen) return map;

    const add = (url: string | undefined, prompt: string | undefined) => {
      if (!url || !prompt) return;
      map.set(url, prompt);
    };

    gen.storyboards.forEach((shot) => {
      add(shot.image_url, shot.image_prompt);
      (shot.image_history || []).forEach((u) => add(u, shot.image_prompt));
    });

    gen.global_assets?.scenes?.forEach((scene) => {
      // Scene doesn't provide image_prompt, use description as a best-effort prompt source.
      (scene.image_history || []).forEach((u) => add(u, scene.description));
      add(scene.image_url, scene.description);
    });

    return map;
  }, [data]);

  const urlToHistoryRefs = useMemo(() => {
    const map = new Map<string, { mode: EditRunMode; refs: string[] }>();
    editHistoryEdit.forEach((h) => {
      if (!h.url || !h.refs?.length) return;
      map.set(h.url, { mode: h.mode, refs: h.refs });
    });
    editHistoryGenerate.forEach((h) => {
      if (!h.url || !h.refs?.length) return;
      map.set(h.url, { mode: 'generate', refs: h.refs });
    });
    return map;
  }, [editHistoryEdit, editHistoryGenerate]);

  const unifiedHistory = useMemo(() => {
    const items: UnifiedHistoryItem[] = [];

    // Edited results
    items.push(...editHistoryEdit.map((h) => ({ url: h.url, mode: h.mode })));
    items.push(...editHistoryGenerate.map((h) => ({ url: h.url, mode: 'generate' as const })));

    // Generated images from project
    const gen = data as GenerationResponse | null;
    if (gen) {
      gen.storyboards.forEach((shot) => {
        if (shot.image_url) items.push({ url: shot.image_url, mode: 'source' });
        (shot.image_history || []).forEach((u) => items.push({ url: u, mode: 'source' }));
      });
      gen.global_assets?.scenes?.forEach((scene) => {
        if (scene.image_url) items.push({ url: scene.image_url, mode: 'source' });
        (scene.image_history || []).forEach((u) => items.push({ url: u, mode: 'source' }));
      });
    }

    // Also include any app references (so user can browse)
    references.forEach((r) => {
      if (r.url) items.push({ url: r.url, mode: 'source' });
    });

    const seen = new Set<string>();
    return items
      .filter((item) => item.url && !seen.has(item.url) && (seen.add(item.url), true));
  }, [data, editHistoryEdit, editHistoryGenerate, references]);

  const resolvePromptForUrl = (url?: string | null) => {
    if (!url) return '';
    const hit = allModeHistory.find((h) => h.url === url);
    if (hit) return hit.prompt || '';
    return urlToOriginalPrompt.get(url) || '';
  };

  const activeDisplayUrl = editResultImage;
  const activeDisplayPrompt = resolvePromptForUrl(activeDisplayUrl);
  const activeDisplayIsEdit = !!activeDisplayUrl && allModeHistory.some((h) => h.url === activeDisplayUrl);

  const handleUploadEditTarget = async (files: FileList | null) => {
    if (!files?.length) return;
    const imgs = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 12);
    if (imgs.length === 0) return;

    const urls = await Promise.all(imgs.map(readFileAsDataUrl));
    if (runMode === 'generate') setEditResultImageGenerate(null);
    else setEditResultImageEdit(null);

    if (runMode !== 'generate') {
      setEditRefsEdit((prev) => [
        ...prev,
        ...urls.map((u) => ({
          id: uniqueRefItemId('ref'),
          url: u,
        })),
      ]);
      return;
    }

    setEditRefsGenerate((prev) => [
      ...prev,
      ...urls.map((u) => ({
        id: uniqueRefItemId('ref'),
        url: u,
      })),
    ]);
  };

  const handleRunEdit = async () => {
    if (!editPrompt.trim()) {
      setError('请先输入修改描述词（prompt）');
      return;
    }
    if (isEditLikeMode && editRefsEdit.length === 0) {
      setError('编辑模式下请至少上传一张图片（可多张；图1、图2…仅为顺序，关系由你在提示词里说明）');
      return;
    }

    setIsEditingImage(true);
    setEditProgress(0);
    setError(null);

    let progressInterval: any = null;

    try {
      progressInterval = setInterval(() => {
        setEditProgress((prev) => {
          if (prev >= 90) return prev;
          return prev + Math.random() * 7;
        });
      }, 350);

      const res = await fetch(runMode === 'generate' ? '/api/generate-image' : '/api/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          runMode === 'generate'
            ? {
                scope: 'storyboard',
                prompt: editPrompt,
                references: editRefsGenerate.map((r) => ({ url: r.url })),
                image_size: editImageSize,
                aspect_ratio: editAspectRatio,
              }
            : runMode === 'edit_gpt2'
            ? {
                prompt: editPrompt,
                images: editRefsEdit.map((r) => r.url),
                model: 'gpt-image-2',
                image_size: gptEditResolution,
                aspect_ratio: gptEditAspectRatio,
              }
            : {
                prompt: editPrompt,
                image_size: editImageSize,
                images: editRefsEdit.map((r) => r.url),
                aspect_ratio: editAspectRatio,
              },
        ),
      });

      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || `编辑失败 (${res.status})`);
      if (!data?.url) throw new Error('未返回图片 URL');

      updateOnSuccess(data.url as string);
      setEditProgress(100);
    } catch (err) {
      console.error('Image edit error:', err);
      setError(err instanceof Error ? err.message : '编辑失败');
      setEditProgress(0);
    } finally {
      if (progressInterval) clearInterval(progressInterval);
      setIsEditingImage(false);
    }
  };

  const updateOnSuccess = (url: string) => {
    if (runMode !== 'generate') {
      setEditResultImageEdit(url);
      setEditHistoryEdit((prev) => [
        {
          url,
          prompt: editPrompt,
          refs: editRefsEdit.map((r) => r.url).filter(Boolean),
          mode: runMode === 'edit_gpt2' ? 'edit_gpt2' : 'edit',
        },
        ...prev.filter((h) => h.url !== url),
      ]);
      addNotice(runMode === 'edit_gpt2' ? 'GPT 编辑模式：图片生成成功（点击前往）' : '编辑模式：图片生成成功（点击前往）', 'success', { type: 'open-editor' });
      return;
    }
    setEditResultImageGenerate(url);
    setEditHistoryGenerate((prev) => [
      { url, prompt: editPrompt, refs: editRefsGenerate.map((r) => r.url).filter(Boolean), mode: 'generate' },
      ...prev.filter((h) => h.url !== url),
    ]);
    addNotice('生图模式：图片生成成功（点击前往）', 'success', { type: 'open-editor' });
  };

  const openContextMenu = (e: React.MouseEvent, url: string | null, mode: EditRunMode | 'source') => {
    e.preventDefault();
    if (!url) return;
    setContextMenu({
      open: true,
      x: Math.min(window.innerWidth - 260, Math.max(12, e.clientX)),
      y: Math.min(window.innerHeight - 210, Math.max(12, e.clientY)),
      url,
      mode,
    });
  };

  const applyHistoryRefs = (url: string) => {
    const hit = urlToHistoryRefs.get(url);
    if (!hit?.refs?.length) {
      setError('该历史图片没有记录可复用的参考图');
      return;
    }
    setError(null);
    setRunMode(hit.mode);
    const refs = hit.refs
      .filter(Boolean)
      .slice(0, 12)
      .map((u) => ({ id: uniqueRefItemId('ref'), url: u }));
    if (hit.mode === 'generate') setEditRefsGenerate(refs);
    else setEditRefsEdit(refs);
  };

  const handleUnifiedDrop = async (e: React.DragEvent) => {
    e.preventDefault();

    const files = e.dataTransfer.files;
    if (files?.length) {
      await handleUploadEditTarget(files);
      return;
    }

    const url = e.dataTransfer.getData('text/plain');
    if (!url) return;

    if (runMode === 'generate') setEditResultImageGenerate(null);
    else setEditResultImageEdit(null);

    if (runMode !== 'generate') {
      setEditRefsEdit((prev) => [...prev, { id: uniqueRefItemId('ref'), url }]);
      return;
    }
    setEditRefsGenerate((prev) => [...prev, { id: uniqueRefItemId('ref'), url }]);
  };

  return (
    <div
      className="h-[100dvh] overflow-y-auto lg:overflow-hidden relative ai-editor-page studio-page-shell flex flex-col"
      data-ui-root
      data-cover-page
      data-studio-page
    >
      <div className="studio-page-bg pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="studio-page-scrim pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="studio-page-glow pointer-events-none fixed inset-0 z-0 cover-ambient" aria-hidden />

      <div className="studio-page-content ai-editor-layout relative z-10 flex flex-col flex-1 min-h-0 w-full mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pb-4 md:pb-5">
        <StudioConvergePiece origin="top" enterKey={enterKey} delay={0.03}>
          <header className="shrink-0 mb-4 lg:mb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
            <div>
              <h1 className="cover-tools-headline text-[1.75rem] sm:text-[2rem] lg:text-[2.15rem] tracking-[-0.035em] leading-[1.08]">
                图片编辑
              </h1>
              <p className="cover-tools-subhead mt-1 text-[14px] sm:text-[15px] leading-snug">
                精修、局部重绘与参考图编排。
              </p>
            </div>
          </header>
        </StudioConvergePiece>

        <div className="ai-editor-workspace flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.38fr)_minmax(340px,440px)] xl:grid-cols-[minmax(0,1.42fr)_minmax(380px,480px)] 2xl:grid-cols-[minmax(0,1.48fr)_minmax(400px,520px)] gap-4 lg:gap-5 xl:gap-6">
          <StudioConvergePiece
            origin="left"
            enterKey={enterKey}
            delay={0.07}
            className="relative rounded-[1.15rem] overflow-hidden ai-editor-canvas min-h-[220px] lg:min-h-0 h-full"
          >
            <div
              className="relative h-full min-h-[220px] lg:min-h-0 group/preview overflow-hidden flex items-center justify-center p-3 md:p-4"
              onMouseEnter={() => setIsHoveringImage(true)}
              onMouseLeave={() => setIsHoveringImage(false)}
              onContextMenu={(e) => openContextMenu(e, editResultImage, runMode)}
            >
              {editResultImage ? (
                <>
                  <button
                    type="button"
                    onClick={() => setImagePreviewOpen(true)}
                    className="relative max-w-full max-h-full flex items-center justify-center cursor-zoom-in outline-none focus-visible:ring-2 accent-focus-ring rounded-lg"
                    title="点击放大查看"
                  >
                    <img
                      src={editResultImage}
                      alt="edit result"
                      referrerPolicy="no-referrer"
                      className="max-w-full max-h-full w-auto h-auto object-contain opacity-95 group-hover/preview:opacity-100 transition-opacity duration-300"
                    />
                  </button>
                  <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setImagePreviewOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-black/50 backdrop-blur-md text-white text-[12px] font-medium outline outline-[0.5px] outline-white/15 hover:bg-black/60 transition-colors cursor-pointer"
                      title="放大"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                      放大
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void downloadImageUrl(editResultImage, 'edit_result');
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/90 text-[#1d1d1f] text-[12px] font-medium outline outline-[0.5px] outline-white/30 hover:bg-white transition-colors cursor-pointer"
                      title="下载当前图"
                    >
                      <Download className="w-3.5 h-3.5" />
                      下载
                    </button>
                  </div>
                </>
              ) : (
                <div className="w-full h-full min-h-[240px] flex flex-col items-center justify-center ai-editor-empty gap-2">
                  <span className="cover-tools-subhead text-[15px] md:text-[17px]">静候成片</span>
                  <span className="ai-editor-stat text-[13px]">上传参考图或输入指令后开始</span>
                </div>
              )}

              {editResultImage && (
                <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/50 to-transparent pointer-events-none" />
              )}

              <AnimatePresence>
                {isHoveringImage && activeDisplayUrl && activeDisplayPrompt && (
                  <motion.div
                    initial={{ opacity: 0, y: 16, scale: 0.985 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.99 }}
                    transition={spring}
                    whileHover={{ y: -1, scale: 1.003 }}
                    className="absolute top-4 left-4 z-20 w-[min(64%,34rem)]"
                  >
                    <div className="rounded-2xl px-3 py-2.5 bg-black/45 backdrop-blur-[26px] outline outline-[0.5px] outline-white/20 shadow-[0_26px_56px_-38px_rgba(0,0,0,0.8)]">
                      <div className="flex items-start gap-2.5">
                        <div className="shrink-0 mt-0.5 px-2 py-1 rounded-full bg-white/12 text-[10px] font-medium tracking-[0.04em] text-white/90">
                          {activeDisplayIsEdit ? '编辑' : '生图'}
                        </div>
                        <p
                          className="flex-1 text-[12px] text-white/88 leading-relaxed line-clamp-3"
                          style={{
                            maskImage: 'linear-gradient(180deg, #000 70%, transparent 100%)',
                            WebkitMaskImage: 'linear-gradient(180deg, #000 70%, transparent 100%)',
                          }}
                        >
                          {activeDisplayPrompt}
                        </p>
                        <button
                          type="button"
                          onClick={async (e) => {
                            e.stopPropagation();
                            try {
                              await navigator.clipboard.writeText(activeDisplayPrompt);
                              setCopiedPrompt(true);
                              setTimeout(() => setCopiedPrompt(false), 1200);
                            } catch {
                              /* ignore */
                            }
                          }}
                          className="shrink-0 p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer outline outline-[0.5px] outline-white/15"
                          title="复制提示词"
                        >
                          {copiedPrompt ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {isEditingImage && (
                <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] z-30 flex flex-col items-center justify-center p-6">
                  <div className="w-full max-w-[180px] h-1 rounded-full overflow-hidden mb-4 bg-white/10">
                    <div
                      className="h-full bg-white/85 transition-all duration-500 ease-out"
                      style={{ width: `${Math.min(100, Math.max(0, editProgress))}%` }}
                    />
                  </div>
                  <span className="text-[13px] font-medium text-white/92 tabular-nums">
                    {isEditLikeMode ? '编辑中' : '生图中'} · {Math.round(editProgress)}%
                  </span>
                  {error && (
                    <div className="mt-3 text-xs text-red-200 bg-red-500/10 outline outline-[0.5px] outline-red-500/20 px-3 py-2 rounded-2xl">
                      {error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </StudioConvergePiece>

          <StudioConvergePiece
            origin="right"
            enterKey={enterKey}
            delay={0.11}
            className="ai-editor-sidebar min-h-0 h-full lg:max-h-none"
          >
            <div className="ai-editor-panel ai-editor-sidebar-panel rounded-[1.15rem] p-4 md:p-5 h-full min-h-0 flex flex-col gap-3 overflow-hidden">
              {error && !isEditingImage && (
                <div className="shrink-0 px-3 py-2 rounded-xl bg-red-500/10 outline outline-[0.5px] outline-red-500/20 text-red-200 text-xs">
                  {error}
                </div>
              )}

              {isEditingImage && (
                <div className="shrink-0 w-full rounded-xl bg-white/[0.04] p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="cover-section-label">处理中</span>
                    <span className="ai-editor-stat text-[13px]">{Math.round(editProgress)}%</span>
                  </div>
                  <div className="w-full h-1 rounded-full overflow-hidden bg-white/[0.08]">
                    <div
                      className="h-full bg-white/80 transition-all duration-200"
                      style={{ width: `${Math.min(100, Math.max(0, editProgress))}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="shrink-0 space-y-2.5">
                <div className="ai-editor-mode-switch">
                  <button
                    type="button"
                    onClick={() => setRunMode('edit')}
                    className={cn('ai-editor-mode-btn', runMode === 'edit' && 'ai-editor-mode-btn--active')}
                  >
                    编辑模式
                  </button>
                  <button
                    type="button"
                    onClick={() => setRunMode('edit_gpt2')}
                    className={cn('ai-editor-mode-btn', runMode === 'edit_gpt2' && 'ai-editor-mode-btn--active')}
                  >
                    GPT编辑
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRunMode('generate');
                    }}
                    className={cn('ai-editor-mode-btn', runMode === 'generate' && 'ai-editor-mode-btn--active')}
                  >
                    生图模式
                  </button>
                </div>
                <div className="cover-section-label">素材队列</div>
                <p className="ai-editor-body -mt-1 line-clamp-2">
                  {isEditLikeMode
                    ? '图1、图2… 表示顺序；在 prompt 里说明谁参考、谁被改。支持拖拽排序与从历史拖入。'
                    : '可选参考图，从左到右为图1、图2…；也可仅凭 prompt 生图。'}
                </p>

                <div
                  className="ai-editor-dropzone ai-editor-dropzone--compact"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleUnifiedDrop}
                >
                  <div className="flex gap-2 overflow-x-auto custom-scrollbar">
                    <Reorder.Group
                      as="div"
                      axis="x"
                      values={editRefs}
                      onReorder={runMode === 'generate' ? setEditRefsGenerate : setEditRefsEdit}
                      className="flex gap-2 flex-none shrink-0"
                    >
                      {editRefs.map((ref, idx) => (
                        <Reorder.Item
                          as="div"
                          key={ref.id}
                          value={ref}
                          className="relative shrink-0 h-[4.5rem] min-w-[72px] max-w-[160px] rounded-xl overflow-hidden cursor-grab active:cursor-grabbing bg-transparent flex items-center justify-center px-1 ai-editor-ref-tile"
                          whileDrag={{ scale: 1.04, zIndex: 20 }}
                          transition={spring}
                          data-theme-preserve="dark"
                          {...refThumbHandlers(ref.url)}
                        >
                          <img src={ref.url} className="h-full w-auto max-w-[172px] object-contain pointer-events-none" draggable={false} />
                          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-medium pointer-events-none">
                            {idx + 1}
                          </div>
                          <button
                            data-ref-preview-ignore
                            onClick={(e) => {
                              e.stopPropagation();
                              const id = ref.id;
                              if (runMode !== 'generate') {
                                setEditRefsEdit((prev) => prev.filter((x) => x.id !== id));
                              } else {
                                setEditRefsGenerate((prev) => prev.filter((x) => x.id !== id));
                              }
                            }}
                            className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center"
                            title="移除图片"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Reorder.Item>
                      ))}
                    </Reorder.Group>

                    <button
                      data-ref-preview-ignore
                      onClick={() => editTargetInputRef.current?.click()}
                      className="ai-editor-upload-tile shrink-0"
                      title="上传图片"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="text-[12px] font-medium">添加</span>
                    </button>
                  </div>

                  {editRefs.length === 0 && (
                    <div className="h-14 flex items-center justify-center ai-editor-body text-center px-3 text-[13px]">
                      {isEditLikeMode ? '拖放图片到此处，或点击添加' : '可选参考图，也可直接生图'}
                    </div>
                  )}
                </div>

                <input
                  ref={editTargetInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => handleUploadEditTarget(e.target.files)}
                />
              </div>

              <div className="shrink-0 mt-1">
                <div className="cover-section-label">修改指令</div>
                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="描述你希望如何改变画面：光线、构图、角色、材质…"
                  className="mt-2 w-full min-h-[68px] max-h-[88px] ai-editor-input rounded-xl p-3 text-[14px] leading-relaxed focus:outline-none focus-visible:ring-2 accent-focus-ring resize-none custom-scrollbar"
                />

                <div className="flex flex-wrap items-center gap-2.5 mt-3">
                <select
                  value={runMode === 'edit_gpt2' ? gptEditResolution : editImageSize}
                  onChange={(e) => {
                    if (runMode === 'edit_gpt2') setGptEditResolution(e.target.value as ImageSize);
                    else setEditImageSize(e.target.value as ImageSize);
                  }}
                  className="ai-editor-select text-[13px] rounded-full px-4 py-2 focus:outline-none focus-visible:ring-2 accent-focus-ring cursor-pointer"
                  title={runMode === 'edit_gpt2' ? '分辨率（映射为 RunningHub 1k/2k/4k）' : undefined}
                >
                  {SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={runMode === 'edit_gpt2' ? gptEditAspectRatio : editAspectRatio}
                  onChange={(e) => {
                    if (runMode === 'edit_gpt2') setGptEditAspectRatio(e.target.value as RunningHubG2AspectRatio);
                    else setEditAspectRatio(e.target.value as AspectRatio);
                  }}
                  className="ai-editor-select text-[13px] rounded-full px-4 py-2 focus:outline-none focus-visible:ring-2 accent-focus-ring cursor-pointer"
                  title={runMode === 'edit_gpt2' ? 'RunningHub G-2 宽高比' : undefined}
                >
                  {(runMode === 'edit_gpt2' ? RUNNINGHUB_G2_RATIOS : RATIOS).map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleRunEdit}
                  disabled={isEditingImage}
                  className={cn(
                    'ml-auto px-6 py-2.5 rounded-full text-[13px] font-medium tracking-[-0.01em] transition-all cursor-pointer',
                    isEditingImage
                      ? 'text-[var(--cover-fg-warm)] cursor-wait outline outline-[0.5px] outline-white/14 bg-white/[0.1]'
                      : 'cover-hero-cta',
                  )}
                >
                  {isEditingImage ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {isEditLikeMode ? '编辑中...' : '生图中...'}
                    </span>
                  ) : (
                    isEditLikeMode ? '开始编辑' : '开始生图'
                  )}
                </button>
              </div>
              </div>

              <div className="ai-editor-history-section shrink-0 min-h-0 flex flex-col pt-3 mt-auto">
                <div className="flex items-center justify-between mb-2 gap-3">
                  <div className="cover-section-label mb-0">历史</div>
                  <span className="ai-editor-stat text-[13px] shrink-0">
                    {unifiedHistory.length} 张
                  </span>
                </div>

                {unifiedHistory.length > 0 ? (
                  <div
                    className="ai-editor-timeline-rail ai-editor-timeline-rail--compact custom-scrollbar"
                  style={{ touchAction: 'pan-x' }}
                  onWheelCapture={(e) => {
                    // Lock wheel to horizontal scrolling inside timeline only.
                    // Capture-phase prevents parent/page vertical scrolling.
                    const target = e.currentTarget;
                    const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
                    if (!raw) return;
                    const step = raw * 0.8; // finer control
                    e.preventDefault();
                    e.stopPropagation();
                    target.scrollLeft += step;
                  }}
                >
                  {unifiedHistory.map((item, idx) => {
                    const { url, mode } = item;
                    return (
                      <motion.button
                        key={`${url}_${idx}`}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          const de = e as unknown as React.DragEvent;
                          de.dataTransfer.setData('text/plain', url);
                          de.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => {
                          if (runMode === 'generate') setEditResultImageGenerate(url);
                          else setEditResultImageEdit(url);
                        }}
                        onContextMenu={(e) => openContextMenu(e, url, mode)}
                        data-theme-preserve="dark"
                        whileHover={{ y: -3, scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={spring}
                        className={cn(
                          'ai-editor-history-chip ai-editor-history-chip--compact',
                          editResultImage === url && 'ai-editor-history-chip--active',
                        )}
                        title={
                          mode === 'edit'
                            ? `编辑模式历史 ${idx + 1}`
                            : mode === 'edit_gpt2'
                              ? `GPT编辑历史 ${idx + 1}`
                            : mode === 'generate'
                              ? `生图模式历史 ${idx + 1}`
                              : `来源历史 ${idx + 1}`
                        }
                      >
                        <img src={url} className="w-full h-full object-contain bg-black/20" />
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-medium">
                          {idx + 1}
                        </span>
                        <span
                          className={cn(
                            'absolute bottom-1 right-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium',
                            mode === 'edit'
                              ? 'bg-white/90 text-[#1d1d1f]'
                              : mode === 'edit_gpt2'
                                ? 'bg-white/80 text-[#1d1d1f]'
                              : mode === 'generate'
                                ? 'bg-white/75 text-[#1d1d1f]'
                                : 'bg-black/60 text-white/85',
                          )}
                        >
                          {mode === 'edit' ? '编辑' : mode === 'edit_gpt2' ? 'GPT' : mode === 'generate' ? '生图' : '源'}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
                ) : (
                  <div className="ai-editor-timeline-empty ai-editor-timeline-empty--compact">
                    尚无历史记录
                  </div>
                )}
              </div>
            </div>
          </StudioConvergePiece>
        </div>
      </div>

      <ReferenceImageLightbox url={refThumbPreviewUrl} onClose={() => setRefThumbPreviewUrl(null)} zIndexClass="z-[97]" />

      {contextMenu.open && contextMenu.url && (
        <div className="fixed inset-0 z-[110]" role="presentation" onMouseDown={() => setContextMenu((s) => ({ ...s, open: false }))}>
          <div
            className="pointer-events-auto fixed min-w-[220px] rounded-xl ai-editor-glass backdrop-blur-[28px] shadow-[0_24px_56px_-40px_rgba(0,0,0,0.85)] overflow-hidden"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="w-full px-4 py-3 flex items-center gap-3 text-left text-[13px] text-[var(--cover-fg-warm)] hover:bg-white/[0.06] transition-colors cursor-pointer"
              onClick={() => {
                setContextMenu((s) => ({ ...s, open: false }));
                void downloadImageUrl(contextMenu.url!, 'image');
              }}
            >
              <ImageDown className="h-4 w-4 opacity-70" />
              下载图片
            </button>
            <button
              type="button"
              className="w-full px-4 py-3 flex items-center gap-3 text-left text-[13px] text-[var(--cover-fg-warm)] hover:bg-white/[0.06] transition-colors cursor-pointer"
              onClick={() => {
                setContextMenu((s) => ({ ...s, open: false }));
                void copyImageToClipboard(contextMenu.url!);
              }}
            >
              <ClipboardCopy className="h-4 w-4 opacity-70" />
              复制图片
            </button>
            <button
              type="button"
              className={cn(
                'w-full px-4 py-3 flex items-center gap-3 text-left text-[13px] transition-colors cursor-pointer',
                urlToHistoryRefs.has(contextMenu.url)
                  ? 'text-[var(--cover-fg-warm)] hover:bg-white/[0.06]'
                  : 'ai-editor-copy-muted opacity-50 cursor-not-allowed',
              )}
              disabled={!urlToHistoryRefs.has(contextMenu.url)}
              onClick={() => {
                const url = contextMenu.url!;
                setContextMenu((s) => ({ ...s, open: false }));
                applyHistoryRefs(url);
              }}
              title={urlToHistoryRefs.has(contextMenu.url) ? '使用该历史图当时的参考图' : '该图片没有记录参考图（仅编辑页历史支持）'}
            >
              <Plus className="h-4 w-4" />
              用作参考图
            </button>
          </div>
        </div>
      )}

      {imagePreviewOpen && editResultImage && (
        <motion.div
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={spring}
          className="fixed inset-0 z-[95]"
          data-theme-preserve="dark"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-zoom-out bg-black/88 backdrop-blur-[28px]"
            onClick={() => setImagePreviewOpen(false)}
            aria-label="关闭预览"
          />
          <div className="pointer-events-none absolute inset-0 flex flex-col p-3 sm:p-4">
            <div className="pointer-events-auto absolute right-3 top-3 z-20 flex items-center gap-2 sm:right-4 sm:top-4">
              <button
                type="button"
                onClick={() => void downloadImageUrl(editResultImage, 'edit_result')}
                className="inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-md px-4 py-2.5 text-white text-[13px] font-medium outline outline-[0.5px] outline-white/15 hover:bg-white/16 transition-colors cursor-pointer"
              >
                <Download className="h-4 w-4" />
                下载
              </button>
              <button
                type="button"
                onClick={() => setImagePreviewOpen(false)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-high/55 text-white/90 outline outline-[0.5px] outline-outline-variant/20 backdrop-blur-[30px] transition-colors hover:text-white cursor-pointer"
                title="关闭 (Esc)"
                aria-label="关闭"
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col pt-12">
              <motion.div
                initial={{ opacity: 0, y: 16, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={spring}
                className="pointer-events-auto min-h-0 min-w-0 flex-1"
              >
                <ZoomableLightboxImage
                  url={editResultImage}
                  className="h-full w-full"
                  imgClassName="rounded-2xl outline outline-[0.5px] outline-white/18 shadow-[0_48px_120px_-40px_rgba(0,0,0,0.88)]"
                />
              </motion.div>
              <p className="pointer-events-none shrink-0 pt-2 text-center text-[12px] text-white/55">
                滚轮缩放 · 中键拖拽 · 点空白或 ✕ 关闭
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

