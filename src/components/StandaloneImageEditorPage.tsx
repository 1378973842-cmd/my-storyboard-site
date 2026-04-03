import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Copy, Check, Camera, Loader2, X, Plus, Download, Maximize2, ArrowLeft } from 'lucide-react';
import { useStore } from '../store/useStore';
import { parseApiResponse } from '../lib/http';
import { cn, uniqueRefItemId } from '../lib/utils';
import { SIZES, RATIOS } from '../constants';
import { AspectRatio, ImageSize, GenerationResponse } from '../types';
import { useRefThumbPreview } from '../hooks/useRefThumbPreview';
import { ReferenceImageLightbox } from './ReferenceImageLightbox';
import { ZoomableLightboxImage } from './ZoomableLightboxImage';

type EditRef = { id: string; url: string };
type EditHistoryItem = { url: string; prompt: string };
type UnifiedHistoryItem = { url: string; mode: 'edit' | 'generate' | 'source' };

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
  onBack: () => void;
};

export const StandaloneImageEditorPage: React.FC<Props> = ({ onBack }) => {
  const { data, references } = useStore();

  const [isHoveringImage, setIsHoveringImage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [editProgress, setEditProgress] = useState(0);

  const [editPrompt, setEditPrompt] = useState('');
  const [editImageSize, setEditImageSize] = useState<ImageSize>('2K');
  const [editAspectRatio, setEditAspectRatio] = useState<AspectRatio>('16:9');

  const [editResultImageEdit, setEditResultImageEdit] = useState<string | null>(null);
  const [editResultImageGenerate, setEditResultImageGenerate] = useState<string | null>(null);
  const [editRefsEdit, setEditRefsEdit] = useState<EditRef[]>([]);
  const [editRefsGenerate, setEditRefsGenerate] = useState<EditRef[]>([]);
  const [editHistoryEdit, setEditHistoryEdit] = useState<EditHistoryItem[]>([]);
  const [editHistoryGenerate, setEditHistoryGenerate] = useState<EditHistoryItem[]>([]);

  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [runMode, setRunMode] = useState<'edit' | 'generate'>('edit');

  const editResultImage = runMode === 'edit' ? editResultImageEdit : editResultImageGenerate;
  const editRefs = runMode === 'edit' ? editRefsEdit : editRefsGenerate;
  const editHistory = runMode === 'edit' ? editHistoryEdit : editHistoryGenerate;
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

  const unifiedHistory = useMemo(() => {
    const items: UnifiedHistoryItem[] = [];

    // Edited results
    items.push(...editHistoryEdit.map((h) => ({ url: h.url, mode: 'edit' as const })));
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
      .filter((item) => item.url && !seen.has(item.url) && (seen.add(item.url), true))
      .slice(0, 24);
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
    if (runMode === 'edit') setEditResultImageEdit(null);
    else setEditResultImageGenerate(null);

    if (runMode === 'edit') {
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
    if (runMode === 'edit' && editRefsEdit.length === 0) {
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

      const res = await fetch(runMode === 'edit' ? '/api/edit-image' : '/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          runMode === 'edit'
            ? {
                prompt: editPrompt,
                images: editRefsEdit.map((r) => r.url),
                image_size: editImageSize,
                aspect_ratio: editAspectRatio,
              }
            : {
                prompt: editPrompt,
                references: editRefsGenerate.map((r) => ({ url: r.url })),
                image_size: editImageSize,
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
    if (runMode === 'edit') {
      setEditResultImageEdit(url);
      setEditHistoryEdit((prev) => [{ url, prompt: editPrompt }, ...prev.filter((h) => h.url !== url)]);
      return;
    }
    setEditResultImageGenerate(url);
    setEditHistoryGenerate((prev) => [{ url, prompt: editPrompt }, ...prev.filter((h) => h.url !== url)]);
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

    if (runMode === 'edit') setEditResultImageEdit(null);
    else setEditResultImageGenerate(null);

    if (runMode === 'edit') {
      setEditRefsEdit((prev) => [...prev, { id: uniqueRefItemId('ref'), url }]);
      return;
    }
    setEditRefsGenerate((prev) => [...prev, { id: uniqueRefItemId('ref'), url }]);
  };

  return (
    <div className="min-h-screen bg-surface text-on-background font-sans overflow-hidden relative ai-editor-page" data-ui-root>
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.72] ai-editor-atmosphere" aria-hidden>
        <div className="absolute -top-40 -left-32 h-[min(52vw,520px)] w-[min(68vw,640px)] rounded-full bg-primary/[0.08] blur-[110px]" />
        <div className="absolute top-[28%] -right-24 h-[380px] w-[min(55vw,480px)] rounded-full bg-secondary/[0.07] blur-[100px]" />
        <div className="absolute bottom-[-8%] left-[18%] h-[320px] w-[min(90vw,760px)] rounded-full bg-primary/[0.05] blur-[90px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        className="relative z-10 p-6 md:p-8 lg:p-10 max-w-[1680px] mx-auto"
      >
        <div className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between mb-8 lg:mb-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
            <button
              type="button"
              onClick={onBack}
              className="group/bak inline-flex w-fit items-center gap-2.5 px-5 py-2.5 rounded-full ai-editor-glass text-on-surface/75 hover:text-primary transition-colors cursor-pointer text-[10px] font-label tracking-widest uppercase shadow-[0_40px_80px_-50px_rgba(0,0,0,0.75)]"
            >
              <ArrowLeft className="w-4 h-4 opacity-65 group-hover/bak:-translate-x-0.5 transition-transform duration-300" />
              返回起始页
            </button>
            <div>
              <h1 className="font-headline text-2xl sm:text-3xl md:text-[2.15rem] tracking-[-0.02em] text-on-surface italic leading-tight">
                Premium AI Image Editor
              </h1>
              <p className="mt-2 font-label text-[9px] tracking-[0.28em] uppercase text-on-surface/38">
                Advanced · Aesthetic · Reveal
              </p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <span className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 ai-editor-glass font-label text-[9px] tracking-[0.22em] uppercase text-on-surface/45">
              <span className="h-1 w-1 rounded-full bg-primary/80 shadow-[0_0_12px_rgba(255,184,102,0.45)]" />
              Image Edit Studio
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.88fr)] gap-8 lg:gap-10 xl:gap-12">
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.04 }}
            className="relative rounded-[1.5rem] overflow-hidden ai-editor-panel p-1.5 shadow-[0_56px_100px_-48px_rgba(0,0,0,0.78)]"
          >
            <div
              className="relative min-h-[280px] h-[min(75vh,720px)] max-h-[min(75vh,720px)] ai-editor-canvas group/preview overflow-hidden flex items-center justify-center rounded-[1.15rem] p-3 shadow-[inset_0_0_80px_rgba(0,0,0,0.35)]"
              onMouseEnter={() => setIsHoveringImage(true)}
              onMouseLeave={() => setIsHoveringImage(false)}
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
                      className="max-w-full max-h-[min(72vh,680px)] w-auto h-auto object-contain opacity-95 group-hover/preview:opacity-100 transition-opacity duration-300"
                    />
                  </button>
                  <div className="absolute top-3 right-3 z-30 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setImagePreviewOpen(true);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/55 backdrop-blur-md text-white text-[10px] font-semibold outline outline-[0.5px] outline-white/20 hover:text-primary transition-colors cursor-pointer shadow-[0_12px_40px_-20px_rgba(0,0,0,0.9)]"
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
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full accent-focus-bg text-white text-[10px] font-black outline outline-[0.5px] outline-white/25 hover:opacity-90 transition-all cursor-pointer shadow-[0_12px_40px_-20px_rgba(0,0,0,0.9)]"
                      title="下载当前图"
                    >
                      <Download className="w-3.5 h-3.5" />
                      下载
                    </button>
                  </div>
                </>
              ) : (
                <div className="w-full h-full min-h-[240px] flex flex-col items-center justify-center text-on-surface/25 bg-[radial-gradient(ellipse_at_50%_40%,rgba(255,184,102,0.06),transparent_55%),radial-gradient(circle_at_center,rgba(255,255,255,0.04),transparent_70%)]">
                  <Camera className="w-14 h-14 mb-5 opacity-[0.12]" />
                  <span className="font-headline text-lg italic tracking-[-0.02em] text-on-surface/30">
                    静候成片
                  </span>
                  <span className="mt-2 text-[9px] font-label tracking-[0.28em] uppercase text-on-surface/25">
                    Awaiting render
                  </span>
                </div>
              )}

              {editResultImage && (
                <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 via-black/20 to-transparent pointer-events-none opacity-80" />
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
                        <div className="shrink-0 mt-0.5 px-2 py-1 rounded-full chip-accent-focus text-[8px] font-black tracking-[0.16em]">
                          {activeDisplayIsEdit ? 'EDIT_PROMPT' : 'IMAGE_PROMPT'}
                        </div>
                        <p
                          className="flex-1 text-[10px] text-white/92 leading-relaxed line-clamp-3"
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
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6">
                  <div className="w-full max-w-[160px] h-1.5 bg-slate-800 rounded-full overflow-hidden mb-4">
                    <div
                      className="h-full bg-primary transition-all duration-500 ease-out shadow-[0_0_10px_rgba(255,184,102,0.5)]"
                      style={{ width: `${Math.min(100, Math.max(0, editProgress))}%` }}
                    />
                  </div>
                  <span className="text-[11px] font-mono tracking-[0.2em] uppercase text-primary font-bold">
                    EDITING... {Math.round(editProgress)}%
                  </span>
                  {error && (
                    <div className="mt-3 text-xs text-red-200 bg-red-500/10 outline outline-[0.5px] outline-red-500/20 px-3 py-2 rounded-2xl">
                      {error}
                    </div>
                  )}
                </div>
              )}
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.1 }}
            className="flex flex-col gap-6"
          >
            <div className="ai-editor-panel rounded-[1.35rem] p-5 md:p-6 shadow-[0_40px_72px_-52px_rgba(0,0,0,0.65)]">
              {error && !isEditingImage && (
                <div className="px-3 py-2 rounded-2xl bg-red-500/10 outline outline-[0.5px] outline-red-500/20 text-red-200 text-xs mb-3">
                  {error}
                </div>
              )}

              {isEditingImage && (
                <div className="w-full rounded-2xl bg-white/[0.03] outline outline-[0.5px] outline-white/10 p-3 mb-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[9px] font-label tracking-[0.18em] uppercase text-primary">Editing</span>
                    <span className="text-[10px] font-mono text-white/60">{Math.round(editProgress)}%</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-200"
                      style={{ width: `${Math.min(100, Math.max(0, editProgress))}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-3">
                <div className="flex items-center gap-2 rounded-full bg-surface-container-high/45 p-1.5 outline outline-[0.5px] outline-white/10 w-fit">
                  <button
                    type="button"
                    onClick={() => setRunMode('edit')}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-[9px] font-label tracking-[0.14em] uppercase transition-all cursor-pointer',
                      runMode === 'edit'
                        ? 'segmented-active-bg segmented-active-text shadow-[0_10px_20px_-12px_rgba(0,0,0,0.45)]'
                        : 'text-on-surface/45 hover:text-on-surface/75',
                    )}
                  >
                    编辑模式
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRunMode('generate');
                    }}
                    className={cn(
                      'px-3 py-1.5 rounded-full text-[9px] font-label tracking-[0.14em] uppercase transition-all cursor-pointer',
                      runMode === 'generate'
                        ? 'segmented-active-bg segmented-active-text shadow-[0_10px_20px_-12px_rgba(0,0,0,0.45)]'
                        : 'text-on-surface/45 hover:text-on-surface/75',
                    )}
                  >
                    生图模式
                  </button>
                </div>
                <div className="flex items-end gap-3">
                  <span className="text-[9px] font-label tracking-[0.22em] uppercase text-on-surface/42 shrink-0">
                    素材队列
                  </span>
                  <span className="h-px flex-1 mb-1 bg-gradient-to-r from-white/14 to-transparent" />
                </div>
                <p className="text-[10px] text-on-surface/45 leading-relaxed -mt-1">
                  {runMode === 'edit'
                    ? '从左到右依次为图1、图2…（仅表示顺序）。谁在提示词里是「要改的」、谁是「参考」，由你自己写清楚，例如「参考图1修改图2」。支持拖拽排序与拖入历史。'
                    : '从左到右为图1、图2…（可为空，仅凭 prompt 生图）。支持拖拽排序。'}
                </p>

                <div
                  className="rounded-2xl outline outline-dashed outline-[0.5px] outline-white/14 bg-surface-container-highest/25 min-h-[140px] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleUnifiedDrop}
                >
                  <div className="flex gap-2 overflow-x-auto custom-scrollbar">
                    <Reorder.Group
                      as="div"
                      axis="x"
                      values={editRefs}
                      onReorder={runMode === 'edit' ? setEditRefsEdit : setEditRefsGenerate}
                      className="flex gap-2 flex-none shrink-0"
                    >
                      {editRefs.map((ref, idx) => (
                        <Reorder.Item
                          as="div"
                          key={ref.id}
                          value={ref}
                          className="relative shrink-0 h-24 min-w-[84px] max-w-[180px] rounded-xl overflow-hidden cursor-grab active:cursor-grabbing bg-transparent flex items-center justify-center px-1 outline outline-[0.5px] outline-white/20"
                          whileDrag={{ scale: 1.04, zIndex: 20 }}
                          transition={spring}
                          data-theme-preserve="dark"
                          {...refThumbHandlers(ref.url)}
                        >
                          <img src={ref.url} className="h-full w-auto max-w-[172px] object-contain pointer-events-none" draggable={false} />
                          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-black/80 text-white text-[9px] font-black tracking-widest outline outline-[0.5px] outline-white/20 pointer-events-none">
                            #{idx + 1}
                          </div>
                          <button
                            data-ref-preview-ignore
                            onClick={(e) => {
                              e.stopPropagation();
                              const id = ref.id;
                              if (runMode === 'edit') {
                                setEditRefsEdit((prev) => prev.filter((x) => x.id !== id));
                              } else {
                                setEditRefsGenerate((prev) => prev.filter((x) => x.id !== id));
                              }
                            }}
                            className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/80 text-white flex items-center justify-center outline outline-[0.5px] outline-white/20"
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
                      className="shrink-0 w-24 h-24 rounded-xl outline outline-dashed outline-[0.5px] outline-white/18 bg-white/[0.04] hover:bg-white/[0.08] text-on-surface/55 hover:text-primary transition-all flex flex-col items-center justify-center gap-1 cursor-pointer shadow-[0_20px_40px_-28px_rgba(0,0,0,0.55)]"
                      title="上传图片"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="text-[9px] font-black uppercase tracking-widest">Upload</span>
                    </button>
                  </div>

                  {editRefs.length === 0 && (
                    <div className="h-20 flex flex-col items-center justify-center gap-1 text-on-surface/40 text-[10px] font-label uppercase tracking-[0.2em]">
                      <span>{runMode === 'edit' ? '拖放图片到此处（从左到右为图1、图2…）' : '可直接开始生图（可选参考图）'}</span>
                      <span className="text-[9px] normal-case tracking-normal text-on-surface/30">
                        {runMode === 'edit' ? '或点击右侧 +' : '也可先上传参考图再生成'}
                      </span>
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

              <div className="mt-5 flex items-end gap-3">
                <span className="text-[9px] font-label tracking-[0.2em] uppercase text-on-surface/40 shrink-0">
                  修改指令
                </span>
                <span className="h-px flex-1 mb-1 bg-gradient-to-r from-white/12 to-transparent" />
              </div>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                placeholder="描述你希望如何改变画面：光线、构图、角色、材质…"
                className="mt-2 w-full min-h-[88px] ai-editor-input rounded-2xl p-4 text-[11px] font-body text-white focus:outline-none focus-visible:ring-2 accent-focus-ring transition-all resize-none custom-scrollbar"
              />

              <div className="flex flex-wrap items-center gap-3 mt-4">
                <select
                  value={editImageSize}
                  onChange={(e) => setEditImageSize(e.target.value as ImageSize)}
                  className="ai-editor-select text-white text-[10px] font-mono rounded-full px-3.5 py-2 focus:outline-none focus-visible:ring-2 accent-focus-ring cursor-pointer"
                >
                  {SIZES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <select
                  value={editAspectRatio}
                  onChange={(e) => setEditAspectRatio(e.target.value as AspectRatio)}
                  className="ai-editor-select text-white text-[10px] font-mono rounded-full px-3.5 py-2 focus:outline-none focus-visible:ring-2 accent-focus-ring cursor-pointer"
                >
                  {RATIOS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleRunEdit}
                  disabled={isEditingImage}
                  className={cn(
                    'ml-auto px-5 py-2.5 rounded-full text-[10px] font-label font-bold uppercase tracking-[0.18em] transition-all cursor-pointer ai-editor-generate',
                    isEditingImage
                      ? 'bg-surface-container-high text-on-surface/45 cursor-wait'
                      : 'text-on-primary-fixed hover:opacity-95 accent-focus-glow',
                  )}
                >
                  {isEditingImage ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      {runMode === 'edit' ? '编辑中...' : '生图中...'}
                    </span>
                  ) : (
                    runMode === 'edit' ? '开始编辑' : '开始生图'
                  )}
                </button>
              </div>
            </div>

            <div className="ai-editor-panel rounded-[1.35rem] p-5 md:p-6 shadow-[0_36px_64px_-48px_rgba(0,0,0,0.7)]">
              <div className="flex items-center justify-between mb-4 gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-8 w-px rounded-full bg-gradient-to-b from-primary/50 to-transparent shrink-0" />
                  <span className="text-[9px] font-label tracking-[0.2em] uppercase accent-focus truncate">
                    时间轴胶片
                  </span>
                </div>
                <span className="font-mono text-[9px] text-on-surface/38 tabular-nums shrink-0">
                  {String(unifiedHistory.length).padStart(2, '0')} / 24
                </span>
              </div>

              {unifiedHistory.length > 0 ? (
                <div className="flex gap-2.5 overflow-x-auto custom-scrollbar pb-1">
                  {unifiedHistory.map((item, idx) => {
                    const { url, mode } = item;
                    const isEdited = mode === 'edit' || mode === 'generate';
                    return (
                      <motion.button
                        key={`${url}_${idx}`}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', url);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => {
                          if (runMode === 'edit') setEditResultImageEdit(url);
                          else setEditResultImageGenerate(url);
                        }}
                        data-theme-preserve="dark"
                        whileHover={{ y: -3, scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        transition={spring}
                        className={cn(
                          'relative shrink-0 w-[5.25rem] h-[5.25rem] rounded-[0.85rem] overflow-hidden outline outline-[0.5px] transition-shadow cursor-pointer shadow-[0_22px_40px_-28px_rgba(0,0,0,0.75)]',
                          editResultImage === url
                            ? 'outline-primary/75 ring-2 ring-primary/25'
                            : 'outline-white/12 hover:outline-white/28',
                        )}
                        title={
                          mode === 'edit'
                            ? `编辑模式历史 ${idx + 1}`
                            : mode === 'generate'
                              ? `生图模式历史 ${idx + 1}`
                              : `来源历史 ${idx + 1}`
                        }
                      >
                        <img src={url} className="w-full h-full object-contain bg-black/20" />
                        <span className="absolute top-1 left-1 px-1 py-0.5 rounded-md bg-black/88 text-white text-[8px] font-black tracking-widest outline outline-[0.5px] outline-white/18">
                          H{idx + 1}
                        </span>
                        <span
                          className={cn(
                            'absolute bottom-1 right-1 px-1 py-0.5 rounded-md text-[8px] font-black tracking-widest outline outline-[0.5px]',
                            mode === 'edit'
                              ? 'bg-primary/90 text-black outline-white/25'
                              : mode === 'generate'
                                ? 'bg-secondary/90 text-black outline-white/25'
                                : 'bg-black/72 text-white/85 outline-white/20',
                          )}
                        >
                          {mode === 'edit' ? 'E' : mode === 'generate' ? 'G' : 'S'}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-2xl bg-surface-container-high/40 py-8 text-center text-[10px] font-label tracking-widest uppercase text-on-surface/35">
                  尚无帧可回放
                </div>
              )}
              <div className="mt-4 text-[10px] text-on-surface/40 leading-relaxed">
                将缩略图拖入上方队列，按顺序插入为图1、图2…
              </div>
            </div>
          </motion.div>
        </div>
      </motion.div>

      <ReferenceImageLightbox url={refThumbPreviewUrl} onClose={() => setRefThumbPreviewUrl(null)} zIndexClass="z-[97]" />

      {imagePreviewOpen && editResultImage && (
        <motion.div
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={spring}
          className="fixed inset-0 z-[95]"
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
                className="inline-flex items-center gap-2 rounded-full glass-panel ghost-border px-4 py-2.5 text-on-surface shadow-[0_28px_56px_-32px_rgba(0,0,0,0.9)] transition-colors cursor-pointer text-[10px] font-label font-bold uppercase tracking-widest hover:text-primary"
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
              <p className="pointer-events-none shrink-0 pt-2 text-center text-[10px] font-label tracking-[0.14em] text-white/40 uppercase">
                滚轮缩放 · 中键拖拽 · 点空白或 ✕ 关闭
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

