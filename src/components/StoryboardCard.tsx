import React, { useMemo, useState, useRef, useEffect } from 'react';
import { 
  Copy, 
  Check, 
  Image as ImageIcon, 
  Loader2, 
  AlertCircle, 
  Sparkles, 
  RefreshCw, 
  Download, 
  X,
  Maximize2,
  History,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  FileText,
  PenTool,
  Plus,
  MessageSquare,
  Camera,
  Sun,
  Move,
  Trash2,
  Palette as PaletteIcon,
  X as XIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon
} from 'lucide-react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Storyboard, ImageSize, AspectRatio } from '../types';
import { SIZES, RATIOS, STORYBOARD_TEXT_MODEL } from '../constants';
import { cn, uniqueRefItemId } from '../lib/utils';
import { useStore } from '../store/useStore';
import { ConfirmationModal } from './ConfirmationModal';
import { parseApiResponse } from '../lib/http';
import { useRefThumbPreview } from '../hooks/useRefThumbPreview';
import { ReferenceImageLightbox } from './ReferenceImageLightbox';
import { ZoomableLightboxImage } from './ZoomableLightboxImage';

interface Props {
  shot: Storyboard;
}

export const StoryboardCard: React.FC<Props> = ({ shot }) => {
  const { 
    updateStoryboardImage, 
    setStoryboardLoading, 
    updateStoryboardPrompt,
    updateStoryboardParams,
    switchStoryboardImage,
    updateStoryboard,
    removeStoryboard,
    addNotice,
    references,
    script,
    context,
    selectedStyle
  } = useStore();
  const [error, setError] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [isHoveringImage, setIsHoveringImage] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'default' | 'edit'>('default');
  const [editPrompt, setEditPrompt] = useState('');
  const [isEditingImage, setIsEditingImage] = useState(false);
  const [editProgress, setEditProgress] = useState(0);
  const [editImageSize, setEditImageSize] = useState<ImageSize>(shot.image_size || '2K');
  const [editAspectRatio, setEditAspectRatio] = useState<AspectRatio>(shot.aspect_ratio || '16:9');
  const [editResultImage, setEditResultImage] = useState<string | null>(null);
  const [editHistory, setEditHistory] = useState<Array<{ url: string; prompt: string }>>([]);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const editTargetInputRef = useRef<HTMLInputElement>(null);
  const [editRefs, setEditRefs] = useState<{ id: string; url: string }[]>([]);
  const { previewUrl: refQueuePreviewUrl, setPreviewUrl: setRefQueuePreviewUrl, handlersFor: refThumbHandlers } =
    useRefThumbPreview();

  useEffect(() => {
    if (!isPreviewOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsPreviewOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPreviewOpen]);

  const unifiedHistory = useMemo(() => {
    const seen = new Set<string>();
    const merged = [...editHistory.map((h) => h.url), ...((shot.image_history || []).slice().reverse())];
    return merged.filter((u) => {
      if (!u || seen.has(u)) return false;
      seen.add(u);
      return true;
    });
  }, [editHistory, shot.image_history]);

  const resolvePromptForUrl = (url?: string | null) => {
    if (!url) return '';
    const hit = editHistory.find((h) => h.url === url);
    if (hit) return hit.prompt || '';
    return shot.image_prompt || '';
  };

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('读取参考图失败'));
      reader.onloadend = () => resolve(reader.result as string);
      reader.readAsDataURL(file);
    });

  const handleRegenerateShot = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isRegenerating) return;
    
    setIsRegenerating(true);
    setError(null);
    
    try {
      const res = await fetch('/api/regenerate-shot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          script,
          context,
          style: selectedStyle,
          references: references.map((r, index) => ({
            index: index + 1,
            name: r.name,
            type: r.type
          })),
          shot_summary: shot.summary,
          shot_number: shot.shot_number,
          textModel: STORYBOARD_TEXT_MODEL,
        })
      });
      
      if (!res.ok) throw new Error('重新生成失败');
      
      const newShot = await parseApiResponse(res);
      if (!res.ok) throw new Error(newShot.error || '重新生成失败');
      updateStoryboard(shot.shot_number, newShot);
      addNotice(`分镜 ${shot.shot_number}：提示词重写成功（点击前往）`, 'success', {
        type: 'open-shot',
        shotNumber: shot.shot_number,
      });
    } catch (err) {
      console.error('Regenerate error:', err);
      setError('重新生成失败');
    } finally {
      setIsRegenerating(false);
    }
  };

  const handleDeleteShot = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsDeleteModalOpen(true);
  };

  const confirmDeleteShot = () => {
    removeStoryboard(shot.shot_number);
    setIsDeleteModalOpen(false);
  };

  const handleOpenPreview = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    setPreviewUrl(url);
    setIsPreviewOpen(true);
  };

  const handlePrevPreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!shot.image_history || !previewUrl) return;
    const idx = shot.image_history.indexOf(previewUrl);
    if (idx > 0) {
      setPreviewUrl(shot.image_history[idx - 1]);
    }
  };

  const handleNextPreview = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!shot.image_history || !previewUrl) return;
    const idx = shot.image_history.indexOf(previewUrl);
    if (idx < shot.image_history.length - 1) {
      setPreviewUrl(shot.image_history[idx + 1]);
    }
  };

  const handleGenerateImage = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (shot.is_loading_image) {
      addNotice(`分镜 ${shot.shot_number}：正在生成中，请稍候`, 'info');
      return;
    }

    setStoryboardLoading(shot.shot_number, true);
    setError(null);
    setGenerationProgress(0);

    const progressInterval = setInterval(() => {
      setGenerationProgress(prev => {
        if (prev >= 95) return prev;
        return prev + Math.random() * 5;
      });
    }, 500);

    try {
      const imgPrompt = shot.image_prompt ?? '';
      if (!imgPrompt.trim()) {
        const msg = `分镜 ${shot.shot_number}：缺少生图提示词。请在右侧 Image Prompt 中填写内容，或点 REWRITE 重新生成。`;
        setError(msg);
        addNotice(msg, 'error');
        setStoryboardLoading(shot.shot_number, false);
        return;
      }

      const pixarPrefix = "迪士尼皮克斯 3D 风格，8k 分辨率，极致细节，电影感照明，虚幻引擎 5 渲染质感，电影级调色。";
      const finalPrompt = selectedStyle === 'Pixar' && !imgPrompt.includes('迪士尼皮克斯')
        ? `${pixarPrefix}${imgPrompt}`
        : imgPrompt;

      // 传完整 references，由服务端按提示词中的「图N / @图N」下标挑选附件；
      // 若前端先 filter 再传，会导致「图2」对应下标 1 在长度为 1 的数组中越界，参考图永远挂不上。

      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: finalPrompt,
          image_size: shot.image_size,
          aspect_ratio: shot.aspect_ratio,
          references,
        }),
      });

      const data = await parseApiResponse(res);

      if (!res.ok) {
        throw new Error(data.error || `生图失败 (${res.status})`);
      }

      updateStoryboardImage(shot.shot_number, data.url);
      setGenerationProgress(100);
      addNotice(`分镜 ${shot.shot_number}：生图完成（点击前往）`, 'success', {
        type: 'open-shot',
        shotNumber: shot.shot_number,
      });
    } catch (err) {
      console.error('Image generation error:', err);
      setError(err instanceof Error ? err.message : '生成失败');
      setStoryboardLoading(shot.shot_number, false);
    } finally {
      clearInterval(progressInterval);
    }
  };

  const handleDownload = async (e: React.MouseEvent, url?: string) => {
    e.stopPropagation();
    const targetUrl = url || shot.image_url;
    if (!targetUrl) return;
    
    try {
      const response = await fetch(targetUrl);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `shot_${shot.shot_number.padStart(2, '0')}_${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      console.error('Download failed', err);
    }
  };

  const handleRunEdit = async () => {
    if (editRefs.length === 0) {
      setError('请先上传或拖拽至少一张图片（图1、图2…仅为顺序，关系写在提示词里）');
      return;
    }
    if (!editPrompt.trim()) {
      setError('请先输入修改描述词（prompt）');
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

      const res = await fetch('/api/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: editPrompt,
          images: editRefs.map((r) => r.url),
          image_size: editImageSize,
          aspect_ratio: editAspectRatio,
        }),
      });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || `编辑失败 (${res.status})`);
      if (!data?.url) {
        throw new Error(
          typeof data?.error === 'string' && data.error
            ? data.error
            : '编辑完成但未返回图片地址（请确认 .env 中 API 与模型权限，或查看服务端日志）',
        );
      }
      updateStoryboardImage(shot.shot_number, data.url);
      setEditResultImage(data.url);
      setEditHistory((prev) => [
        { url: data.url, prompt: editPrompt },
        ...prev.filter((h) => h.url !== data.url),
      ]);
      setEditProgress(100);
      addNotice(`分镜 ${shot.shot_number}：编辑完成（点击前往）`, 'success', {
        type: 'open-shot',
        shotNumber: shot.shot_number,
      });
      if (progressInterval) clearInterval(progressInterval);
    } catch (err) {
      console.error('Image edit error:', err);
      setError(err instanceof Error ? err.message : '编辑失败');
      setEditProgress(0);
      if (progressInterval) clearInterval(progressInterval);
    } finally {
      setIsEditingImage(false);
    }
  };

  const handleUploadEditTarget = async (files: FileList | null) => {
    if (!files?.length) return;
    const imgs = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 12);
    if (imgs.length === 0) return;

    const urls = await Promise.all(imgs.map(readFileAsDataUrl));
    setEditResultImage(null);

    setEditRefs((prev) => [
      ...prev,
      ...urls.map((u) => ({
        id: uniqueRefItemId('ref'),
        url: u,
      })),
    ]);
  };

  const activeDisplayUrl = viewMode === 'edit' ? editResultImage : shot.image_url;
  const activeDisplayPrompt = resolvePromptForUrl(activeDisplayUrl);
  const activeDisplayIsEdit = !!activeDisplayUrl && editHistory.some((h) => h.url === activeDisplayUrl);

  return (
    <>
      <motion.article
        className="mb-12 group"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        whileHover={{ y: -6, scale: 1.005 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        <div className="flex gap-4 mb-3 items-end">
          <span className="ai-editor-stat text-[2rem] sm:text-[2.25rem] tracking-[-0.03em] opacity-70 group-hover:opacity-90 transition-opacity">
            {shot.shot_number.toString().padStart(2, '0')}
          </span>
          <div className="flex items-center gap-2 ml-2 flex-wrap">
            <span className="px-2.5 py-1 ai-editor-panel rounded-full text-[11px] font-medium text-[var(--cover-fg-warm)]">
              镜头 {shot.shot_number}
            </span>
            <span className="px-2.5 py-1 ai-editor-panel rounded-full text-[11px] font-medium text-[var(--cover-fg-warm-muted)] line-clamp-1 max-w-[12rem]">
              {shot.summary || '场景描述'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-1 rounded-[1.15rem] overflow-hidden ai-editor-panel p-1.5 outline outline-[0.5px] outline-white/10">
          {/* Frame Preview */}
          <div 
            className="col-span-7 relative aspect-video bg-black/20 group/preview overflow-hidden flex items-center justify-center rounded-xl"
            onMouseEnter={() => setIsHoveringImage(true)}
            onMouseLeave={() => setIsHoveringImage(false)}
          >
          {viewMode === 'edit' ? (
            editResultImage ? (
              <img
                src={editResultImage}
                alt={shot.summary}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-90 group-hover/preview:scale-105 transition-transform duration-1000"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-[var(--cover-fg-warm-muted)] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/5 to-transparent">
                <Camera className="w-16 h-16 mb-4 opacity-20" />
                <span className="text-[10px] font-medium tracking-[0.12em] uppercase text-[var(--cover-fg-warm-muted)]">等待编辑结果</span>
              </div>
            )
          ) : shot.image_url ? (
            <img
              src={shot.image_url}
              alt={shot.summary}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover opacity-90 group-hover/preview:scale-105 transition-transform duration-1000"
            />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-[var(--cover-fg-warm-muted)] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white/5 to-transparent">
              <Camera className="w-16 h-16 mb-4 opacity-20" />
              <span className="text-[10px] font-medium tracking-[0.12em] uppercase text-[var(--cover-fg-warm-muted)]">暂无图片</span>
            </div>
          )}
            
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />

            <AnimatePresence>
              {isHoveringImage && activeDisplayUrl && activeDisplayPrompt && (
                <motion.div
                  initial={{ opacity: 0, y: 16, scale: 0.985 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: 10, scale: 0.99 }}
                  transition={{ type: "spring", stiffness: 300, damping: 30 }}
                  whileHover={{ y: -1, scale: 1.003 }}
                  className={cn(
                    "absolute top-4 left-4 z-20",
                    // Default view has top-right action buttons; reserve space to avoid overlap.
                    viewMode === 'edit' ? "w-[min(92%,42rem)]" : "w-[min(64%,34rem)]"
                  )}
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

            {/* Floating Controls Overlay */}
            {viewMode !== 'edit' && (
            <div className="absolute bottom-6 left-6 flex items-center gap-3 translate-y-0 opacity-90 sm:translate-y-2 sm:opacity-0 sm:group-hover/preview:translate-y-0 sm:group-hover/preview:opacity-100 transition-all duration-500">
              <button 
                type="button"
                onClick={handleGenerateImage}
                disabled={shot.is_loading_image}
                className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel border border-white/10 text-[9px] font-label tracking-widest text-on-surface hover:bg-white/10 hover:border-primary/30 transition-all cursor-pointer group/btn"
              >
                <RefreshCw className={cn("w-3.5 h-3.5 group-hover/btn:text-primary transition-colors", shot.is_loading_image && "animate-spin")} />
                {shot.is_loading_image ? 'GENERATING...' : 'GENERATE'}
              </button>
            </div>
            )}

            {viewMode !== 'edit' && (
            <div className="absolute top-6 right-6 flex gap-2 opacity-90 sm:opacity-0 sm:group-hover/preview:opacity-100 transition-opacity duration-500">
              <button
                onClick={() => {
                  setViewMode('edit');
                  setError(null);
                  setEditProgress(0);
                  setIsEditingImage(false);
                  setEditResultImage(null);
                  setEditRefs(
                    shot.image_url
                      ? [{ id: uniqueRefItemId('ref'), url: shot.image_url }]
                      : [],
                  );
                }}
                className="w-10 h-10 rounded-full glass-panel ghost-border flex items-center justify-center text-on-surface hover:text-primary transition-all cursor-pointer"
                title="编辑"
              >
                <PenTool className="w-5 h-5" />
              </button>
              <button
                onClick={(e) => handleDownload(e, shot.image_url!)}
                className="w-10 h-10 rounded-full glass-panel ghost-border flex items-center justify-center text-on-surface hover:text-primary transition-all cursor-pointer"
                title="下载图片"
              >
                <Download className="w-5 h-5" />
              </button>
              <button 
                onClick={(e) => handleOpenPreview(e, shot.image_url!)}
                className="w-10 h-10 rounded-full glass-panel ghost-border flex items-center justify-center text-on-surface hover:text-primary transition-all cursor-pointer"
                title="放大预览"
              >
                <Maximize2 className="w-5 h-5" />
              </button>
            </div>
            )}

            {/* Loading Overlay */}
            {shot.is_loading_image && viewMode !== 'edit' && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6">
                <div className="w-full max-w-[160px] h-1.5 bg-slate-800 rounded-full overflow-hidden mb-4">
                  <div 
                    className="h-full bg-primary transition-all duration-500 ease-out accent-focus-glow" 
                    style={{ width: `${generationProgress}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono tracking-[0.2em] uppercase accent-focus font-bold">
                  GENERATING... {Math.round(generationProgress)}%
                </span>
              </div>
            )}
          </div>

          {/* Sidebar Panel */}
          <div className="col-span-5 flex flex-col gap-1 rounded-xl p-1 bg-black/10">
            {/* Header / Actions */}
            <div className="p-4 flex justify-between items-center ai-editor-panel rounded-lg">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setViewMode('default');
                    setEditResultImage(null);
                    setEditRefs([]);
                    setEditProgress(0);
                    setError(null);
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded text-[9px] font-label tracking-widest ghost-border transition-all cursor-pointer flex items-center gap-2 group/btn',
                    viewMode === 'default'
                      ? 'bg-white/10 accent-focus'
                      : 'bg-surface-container-highest text-slate-300 hover:bg-white/5 hover:text-primary'
                  )}
                >
                  <Camera className={cn('w-3 h-3 transition-colors', viewMode === 'default' ? 'accent-focus' : 'text-slate-300 group-hover/btn:text-primary')} />
                  SHOT_VIEW
                </button>
                <button
                  onClick={() => {
                    setViewMode('edit');
                    setError(null);
                    setEditProgress(0);
                    setEditResultImage(null);
                    setEditRefs(
                      shot.image_url
                        ? [{ id: uniqueRefItemId('ref'), url: shot.image_url }]
                        : [],
                    );
                  }}
                  className={cn(
                    'px-3 py-1.5 rounded text-[9px] font-label tracking-widest ghost-border transition-all cursor-pointer flex items-center gap-2 group/btn',
                    viewMode === 'edit'
                      ? 'bg-white/10 accent-focus'
                      : 'bg-surface-container-highest text-slate-300 hover:bg-white/5 hover:text-primary'
                  )}
                >
                  <PenTool className={cn('w-3 h-3 transition-colors', viewMode === 'edit' ? 'accent-focus' : 'text-slate-300 group-hover/btn:text-primary')} />
                  IMAGE_EDIT
                </button>
              </div>
              <button 
                onClick={handleDeleteShot}
                className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors cursor-pointer"
                title="Delete Shot"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {error && (
              <div className="mx-1 px-3 py-2.5 rounded-2xl bg-red-500/10 outline outline-[0.5px] outline-red-500/20 text-red-200 text-xs leading-relaxed">
                {error}
              </div>
            )}

            {viewMode === 'edit' && (
              <div className="p-4 bg-surface-container-low rounded-[0.8rem] space-y-3">
                {isEditingImage && (
                  <div className="w-full rounded-2xl bg-white/[0.03] outline outline-[0.5px] outline-white/10 p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[9px] font-label tracking-[0.18em] uppercase accent-focus">Editing</span>
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

                <div className="space-y-2">
                  <div className="text-[9px] font-label tracking-[0.18em] uppercase text-slate-300">
                    上传图片（从左到右图1、图2…；谁参考谁、改哪张，写在提示词里）
                  </div>
                  <div
                    className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] min-h-[132px] p-2"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={async (e) => {
                      e.preventDefault();
                      const files = e.dataTransfer.files;
                      await handleUploadEditTarget(files);
                    }}
                  >
                    <div className="flex gap-2 overflow-x-auto custom-scrollbar">
                      <Reorder.Group as="div" axis="x" values={editRefs} onReorder={setEditRefs} className="flex gap-2 flex-none shrink-0">
                        {editRefs.map((ref, idx) => (
                          <Reorder.Item
                            as="div"
                            key={ref.id}
                            value={ref}
                            className="relative shrink-0 h-24 min-w-[84px] max-w-[180px] rounded-xl overflow-hidden cursor-grab active:cursor-grabbing bg-transparent flex items-center justify-center px-1 cursor-zoom-in outline outline-[0.5px] outline-white/20"
                            whileDrag={{ scale: 1.04, zIndex: 20 }}
                            transition={{ layout: { type: 'spring', stiffness: 300, damping: 30 } }}
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
                                setEditRefs((prev) => prev.filter((x) => x.id !== id));
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
                        className="shrink-0 w-24 h-24 rounded-xl border border-dashed border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-slate-300 hover:text-primary transition-colors flex flex-col items-center justify-center gap-1 cursor-pointer"
                        title="上传图片"
                      >
                        <Plus className="w-4 h-4" />
                        <span className="text-[9px] font-black uppercase tracking-widest">Upload</span>
                      </button>
                    </div>
                    {editRefs.length === 0 && (
                      <div className="h-20 flex items-center justify-center text-slate-400 text-[10px] uppercase tracking-widest">
                        拖拽上传图片到这个框（从左到右为图1、图2…）
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

                <textarea
                  value={editPrompt}
                  onChange={(e) => setEditPrompt(e.target.value)}
                  placeholder="输入修改描述词（prompt）"
                  className="w-full min-h-[72px] bg-surface-container-high rounded-lg p-3 text-[10px] font-body text-white focus:outline-none focus:ring-1 accent-focus-ring transition-all resize-none custom-scrollbar"
                />

                <div className="flex items-center gap-3">
                  <select
                    value={editImageSize}
                    onChange={(e) => setEditImageSize(e.target.value as ImageSize)}
                    className="bg-surface-container-high text-white text-[10px] font-mono rounded-md px-2.5 py-1.5 border border-white/10 focus:outline-none focus:border-primary/40"
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
                    className="bg-surface-container-high text-white text-[10px] font-mono rounded-md px-2.5 py-1.5 border border-white/10 focus:outline-none focus:border-primary/40"
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
                      'ml-auto px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all cursor-pointer',
                      isEditingImage ? 'bg-slate-800 accent-focus' : 'accent-focus-bg hover:opacity-90'
                    )}
                  >
                    {isEditingImage ? '编辑中...' : '开始编辑'}
                  </button>
                </div>

              </div>
            )}

            {viewMode === 'default' && (
              <>
            {/* Narrative Context */}
            <div className="p-4 bg-surface-container-low rounded-[0.8rem]">
              <h3 className="text-[9px] font-label tracking-[0.2em] text-slate-300 uppercase mb-2">Narrative Context</h3>
              <p className="text-xs text-slate-300 leading-relaxed font-body line-clamp-2">
                {shot.director_notes || 'No notes available for this shot.'}
              </p>
            </div>

            {/* Prompts */}
            <div className="p-4 flex-1 flex flex-col gap-4 bg-surface-container-low rounded-[0.8rem]">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <div className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-300">Resolution_Spec</div>
                  <div className="flex items-center rounded-2xl bg-surface-container-high/70 p-1 outline outline-[0.5px] outline-white/10">
                    {SIZES.map((size) => (
                      <button
                        key={size}
                        onClick={() => updateStoryboardParams(shot.shot_number, { image_size: size })}
                        className={cn(
                          "flex-1 px-2 py-1.5 rounded-xl text-[10px] font-mono font-black transition-all cursor-pointer",
                          shot.image_size === size
                            ? "segmented-active-bg segmented-active-text accent-focus-glow"
                            : "text-slate-400 hover:text-slate-200"
                        )}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <div className="text-[8px] font-black uppercase tracking-[0.2em] text-slate-300">Aspect_Ratio</div>
                  <div className="rounded-2xl bg-surface-container-high/70 p-1 outline outline-[0.5px] outline-white/10">
                    <select
                      value={shot.aspect_ratio}
                      onChange={(e) => updateStoryboardParams(shot.shot_number, { aspect_ratio: e.target.value as AspectRatio })}
                      className="w-full bg-transparent text-slate-100 text-[11px] font-mono font-bold rounded-xl px-3 py-1.5 focus:outline-none"
                    >
                      {RATIOS.map((ratio) => (
                        <option key={ratio} value={ratio} className="bg-surface text-slate-100">
                          {ratio}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="space-y-2 flex-1 flex flex-col">
                <div className="flex justify-between items-center">
                <span className="text-[9px] font-label tracking-widest accent-focus uppercase">Image Prompt</span>
                  <button 
                    onClick={handleRegenerateShot}
                    disabled={isRegenerating}
                    className="flex items-center gap-1 text-[8px] font-label tracking-widest text-slate-300 uppercase hover:text-primary cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={cn("w-3 h-3", isRegenerating && "animate-spin")} />
                    {isRegenerating ? 'REWRITING...' : 'REWRITE'}
                  </button>
                </div>
                <textarea 
                  value={shot.image_prompt}
                  onChange={(e) => updateStoryboardPrompt(shot.shot_number, 'image', e.target.value)}
                  className="w-full flex-1 min-h-[80px] bg-surface-container-high rounded-lg p-3 text-[10px] font-body text-white focus:outline-none focus:ring-1 accent-focus-ring transition-all resize-none custom-scrollbar"
                />
              </div>
              
              <div className="space-y-2 flex-1 flex flex-col">
                <span className="text-[9px] font-label tracking-widest accent-info uppercase">Video Prompt</span>
                <textarea 
                  value={shot.video_prompt}
                  onChange={(e) => updateStoryboardPrompt(shot.shot_number, 'video', e.target.value)}
                  className="w-full flex-1 min-h-[80px] bg-surface-container-high rounded-lg p-3 text-[10px] font-body text-white focus:outline-none focus:ring-1 focus:ring-secondary/30 transition-all resize-none custom-scrollbar"
                />
              </div>
            </div>
              </>
            )}

            <div className="p-4 bg-surface-container-low rounded-[0.8rem] space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-label tracking-[0.18em] uppercase accent-focus">统一历史浏览</span>
                <span className="text-[9px] text-slate-400">{unifiedHistory.length}_ITEMS</span>
              </div>
              {unifiedHistory.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto custom-scrollbar">
                  {unifiedHistory.map((url, idx) => (
                    <button
                      key={`${url}_${idx}`}
                      onClick={() => {
                        if (viewMode === 'edit') setEditResultImage(url);
                        else switchStoryboardImage(shot.shot_number, url);
                      }}
                      data-theme-preserve="dark"
                      className={cn(
                        "relative shrink-0 w-20 h-20 rounded-xl overflow-hidden outline outline-[0.5px] transition-all cursor-pointer",
                        (viewMode === 'edit' ? editResultImage === url : shot.image_url === url)
                          ? "outline-primary/80"
                          : "outline-white/15 hover:outline-white/35"
                      )}
                      title={`历史 ${idx + 1}`}
                    >
                      <img src={url} className="w-full h-full object-cover" />
                      <span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-black/90 text-white text-[8px] font-black tracking-widest outline outline-[0.5px] outline-white/20">
                        H{idx + 1}
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="text-[10px] text-slate-400">暂无历史结果</div>
              )}
            </div>
          </div>
        </div>
      </motion.article>

      {/* Lightbox Preview */}
      {isPreviewOpen && previewUrl && (
        <div className="fixed inset-0 z-[100] animate-in fade-in duration-300" data-theme-preserve="dark">
          <button
            type="button"
            className="absolute inset-0 bg-black/95 backdrop-blur-xl cursor-zoom-out"
            onClick={() => setIsPreviewOpen(false)}
            aria-label="关闭预览"
          />
          <div className="pointer-events-none absolute inset-0">
            <div className="pointer-events-auto absolute right-4 top-4 z-[120] sm:right-6 sm:top-6">
              <button
                type="button"
                className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-high/55 text-white/90 outline outline-[0.5px] outline-outline-variant/20 backdrop-blur-[30px] shadow-[0_24px_48px_-28px_rgba(0,0,0,0.55)] transition-colors hover:text-white cursor-pointer"
                onClick={() => setIsPreviewOpen(false)}
                title="关闭 (Esc)"
                aria-label="关闭"
              >
                <XIcon className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>

            {shot.image_history && shot.image_history.length > 1 && (
              <>
                <button
                  type="button"
                  className="pointer-events-auto absolute left-3 top-1/2 z-[120] -translate-y-1/2 rounded-full bg-white/5 p-4 text-white transition-all hover:bg-white/10 disabled:opacity-20 sm:left-6 cursor-pointer"
                  onClick={handlePrevPreview}
                  disabled={shot.image_history.indexOf(previewUrl) === 0}
                >
                  <ChevronLeftIcon className="h-8 w-8" />
                </button>
                <button
                  type="button"
                  className="pointer-events-auto absolute right-3 top-1/2 z-[120] -translate-y-1/2 rounded-full bg-white/5 p-4 text-white transition-all hover:bg-white/10 disabled:opacity-20 sm:right-6 cursor-pointer"
                  onClick={handleNextPreview}
                  disabled={shot.image_history.indexOf(previewUrl) === shot.image_history.length - 1}
                >
                  <ChevronRightIcon className="h-8 w-8" />
                </button>
              </>
            )}

            <div className="pointer-events-auto absolute inset-x-10 top-14 bottom-40 min-h-0 sm:inset-x-16 sm:top-16">
              <ZoomableLightboxImage
                url={previewUrl}
                resetKey={previewUrl}
                className="h-full w-full"
                imgClassName="rounded-lg shadow-2xl outline outline-[0.5px] outline-white/15"
              />
            </div>

            <div className="pointer-events-auto absolute bottom-4 left-1/2 z-[120] max-w-2xl -translate-x-1/2 rounded-2xl bg-black/60 px-6 py-3 text-center outline outline-[0.5px] outline-white/10 backdrop-blur-md flex flex-col items-center gap-3">
              <div>
                <p className="text-white font-medium mb-1">{shot.summary}</p>
                <div className="flex flex-col items-center justify-center gap-1">
                  <span className="text-[9px] text-white/45 font-label tracking-widest uppercase">
                    滚轮缩放 · 中键拖拽平移
                  </span>
                  <div className="flex items-center justify-center gap-2">
                  <span className="text-primary text-[10px] font-bold uppercase tracking-widest">
                    IMAGE {shot.image_history?.indexOf(previewUrl)! + 1} / {shot.image_history?.length}
                  </span>
                  {previewUrl === shot.image_url && (
                    <span className="bg-primary text-black text-[8px] px-1.5 py-0.5 rounded font-bold uppercase flex items-center gap-1">
                      <CheckCircle2 className="w-2 h-2" />
                      Current
                    </span>
                  )}
                </div>
                </div>
              </div>

              {previewUrl !== shot.image_url && (
                <button 
                  onClick={(e) => { e.stopPropagation(); switchStoryboardImage(shot.shot_number, previewUrl); }}
                  className="px-4 py-2 accent-focus-bg hover:opacity-90 rounded-xl text-xs font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer flex items-center gap-2"
                >
                  <RefreshCw className="w-3 h-3" />
                  设为当前分镜
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <ReferenceImageLightbox
        url={refQueuePreviewUrl}
        onClose={() => setRefQueuePreviewUrl(null)}
        zIndexClass="z-[105]"
      />

      <ConfirmationModal
        isOpen={isDeleteModalOpen}
        title="删除镜头"
        message={`确定要删除镜头 ${shot.shot_number} 吗？此操作无法撤销。`}
        confirmLabel="删除"
        variant="danger"
        onConfirm={confirmDeleteShot}
        onCancel={() => setIsDeleteModalOpen(false)}
      />
    </>
  );
};
