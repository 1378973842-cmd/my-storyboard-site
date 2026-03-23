import React, { useState, useRef } from 'react';
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
  Settings2,
  PenTool,
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
import { motion, AnimatePresence } from 'motion/react';
import { Storyboard, ImageSize, AspectRatio } from '../types';
import { SIZES, RATIOS } from '../constants';
import { cn } from '../lib/utils';
import { useStore } from '../store/useStore';
import { ConfirmationModal } from './ConfirmationModal';

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
    setSelectedShotNumber,
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
          shot_number: shot.shot_number
        })
      });
      
      if (!res.ok) throw new Error('重新生成失败');
      
      const newShot = await res.json();
      updateStoryboard(shot.shot_number, newShot);
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
    if (shot.is_loading_image) return;

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
      const pixarPrefix = "迪士尼皮克斯 3D 风格，8k 分辨率，极致细节，电影感照明，虚幻引擎 5 渲染质感，电影级调色。";
      const finalPrompt = selectedStyle === 'Pixar' && !shot.image_prompt.includes('迪士尼皮克斯')
        ? `${pixarPrefix}${shot.image_prompt}`
        : shot.image_prompt;

      const mentionedRefIndices = new Set<number>();
      const matches = finalPrompt.match(/[图@](?:资产)?\s*(\d+)/g);
      if (matches) {
        matches.forEach(match => {
          const numMatch = match.match(/\d+/);
          if (numMatch) {
            const num = parseInt(numMatch[0]);
            if (!isNaN(num) && num > 0 && num <= references.length) {
              mentionedRefIndices.add(num - 1);
            }
          }
        });
      }
      
      // 与 App 全局资产生图一致：提示词里若未出现「图N」引用，则仍传入全部参考图，避免模型未写编号时完全不参考上传图
      const filteredReferences =
        mentionedRefIndices.size > 0
          ? references.filter((_, idx) => mentionedRefIndices.has(idx))
          : references;

      const res = await fetch('/api/generate-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: finalPrompt,
          image_size: shot.image_size,
          aspect_ratio: shot.aspect_ratio,
          references: filteredReferences
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || `生图失败 (${res.status})`);
      }

      updateStoryboardImage(shot.shot_number, data.url);
      setGenerationProgress(100);
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

  return (
    <>
      <div className="mb-10 group">
        <div className="flex gap-4 mb-3 items-end">
          <span className="font-headline italic text-4xl text-slate-800 group-hover:text-primary/20 transition-colors">
            {shot.shot_number.toString().padStart(2, '0')}
          </span>
          <div className="flex items-center gap-3 ml-2">
            <span className="px-3 py-1 bg-surface-container-high rounded text-[9px] font-label tracking-[0.15em] text-slate-400 ghost-border uppercase">
              Shot A-{shot.shot_number}
            </span>
            <span className="px-3 py-1 bg-surface-container-high rounded text-[9px] font-label tracking-[0.15em] text-slate-400 ghost-border uppercase">
              {shot.summary || 'Interior - The Lab'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-12 gap-0.5 rounded-xl overflow-hidden shadow-2xl bg-surface-container-low border border-white/5">
          {/* Frame Preview */}
          <div 
            className="col-span-7 relative aspect-video bg-surface-container-highest group/preview overflow-hidden flex items-center justify-center border-r border-white/5"
            onMouseEnter={() => setIsHoveringImage(true)}
            onMouseLeave={() => setIsHoveringImage(false)}
          >
            {shot.image_url ? (
              <img 
                src={shot.image_url} 
                alt={shot.summary}
                referrerPolicy="no-referrer"
                className="w-full h-full object-cover opacity-90 group-hover/preview:scale-105 transition-transform duration-1000"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-700 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-800/20 to-transparent">
                <Camera className="w-16 h-16 mb-4 opacity-10" />
                <span className="text-[10px] font-bold tracking-[0.3em] uppercase text-slate-500">No Image Generated</span>
              </div>
            )}
            
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />

            {/* Floating Controls Overlay */}
            <div className="absolute bottom-6 left-6 flex items-center gap-3 translate-y-2 opacity-0 group-hover/preview:translate-y-0 group-hover/preview:opacity-100 transition-all duration-500">
              <button 
                onClick={handleGenerateImage}
                disabled={shot.is_loading_image}
                className="flex items-center gap-2 px-4 py-2 rounded-full glass-panel border border-white/10 text-[9px] font-label tracking-widest text-on-surface hover:bg-white/10 hover:border-primary/30 transition-all cursor-pointer group/btn"
              >
                <RefreshCw className={cn("w-3.5 h-3.5 group-hover/btn:text-primary transition-colors", shot.is_loading_image && "animate-spin")} />
                {shot.is_loading_image ? 'GENERATING...' : 'GENERATE'}
              </button>
            </div>

            <div className="absolute top-6 right-6 flex gap-2 opacity-0 group-hover/preview:opacity-100 transition-opacity duration-500">
              <button 
                onClick={(e) => handleOpenPreview(e, shot.image_url!)}
                className="w-10 h-10 rounded-full glass-panel border border-white/10 flex items-center justify-center text-on-surface hover:text-primary hover:border-primary/30 transition-all cursor-pointer"
              >
                <Maximize2 className="w-5 h-5" />
              </button>
            </div>

            {/* Loading Overlay */}
            {shot.is_loading_image && (
              <div className="absolute inset-0 bg-black/60 backdrop-blur-sm z-30 flex flex-col items-center justify-center p-6">
                <div className="w-full max-w-[160px] h-1.5 bg-slate-800 rounded-full overflow-hidden mb-4">
                  <div 
                    className="h-full bg-primary transition-all duration-500 ease-out shadow-[0_0_10px_rgba(255,184,102,0.5)]" 
                    style={{ width: `${generationProgress}%` }}
                  />
                </div>
                <span className="text-[11px] font-mono tracking-[0.2em] uppercase text-primary font-bold">
                  GENERATING... {Math.round(generationProgress)}%
                </span>
              </div>
            )}
          </div>

          {/* Sidebar Panel */}
          <div className="col-span-5 flex flex-col divide-y divide-outline-variant/10 bg-surface-container-low">
            {/* Header / Actions */}
            <div className="p-4 flex justify-between items-center bg-surface-container-lowest">
              <div className="flex items-center gap-2">
                <button 
                  onClick={() => setSelectedShotNumber(shot.shot_number)}
                  className="px-3 py-1.5 bg-surface-container-highest rounded text-[9px] font-label tracking-widest text-on-surface ghost-border hover:bg-white/5 transition-all cursor-pointer flex items-center gap-2 group/btn"
                >
                  <Settings2 className="w-3 h-3 text-primary group-hover/btn:text-white transition-colors" />
                  SHOT_SETTINGS
                </button>
              </div>
              <button 
                onClick={handleDeleteShot}
                className="p-1.5 text-slate-500 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors cursor-pointer"
                title="Delete Shot"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>

            {/* Narrative Context */}
            <div className="p-4">
              <h3 className="text-[9px] font-label tracking-[0.2em] text-slate-500 uppercase mb-2">Narrative Context</h3>
              <p className="text-xs text-slate-300 leading-relaxed font-body line-clamp-2">
                {shot.director_notes || 'No notes available for this shot.'}
              </p>
            </div>

            {/* Prompts */}
            <div className="p-4 flex-1 flex flex-col gap-4">
              <div className="space-y-2 flex-1 flex flex-col">
                <div className="flex justify-between items-center">
                  <span className="text-[9px] font-label tracking-widest text-primary uppercase">Image Prompt</span>
                  <button 
                    onClick={handleRegenerateShot}
                    disabled={isRegenerating}
                    className="flex items-center gap-1 text-[8px] font-label tracking-widest text-slate-400 uppercase hover:text-primary cursor-pointer disabled:opacity-50 transition-colors"
                  >
                    <RefreshCw className={cn("w-3 h-3", isRegenerating && "animate-spin")} />
                    {isRegenerating ? 'REWRITING...' : 'REWRITE'}
                  </button>
                </div>
                <textarea 
                  value={shot.image_prompt}
                  onChange={(e) => updateStoryboardPrompt(shot.shot_number, 'image', e.target.value)}
                  className="w-full flex-1 min-h-[80px] bg-surface-container-lowest border border-outline-variant/10 rounded-lg p-3 text-[10px] font-mono text-slate-300 focus:outline-none focus:border-primary/30 transition-all resize-none custom-scrollbar"
                />
              </div>
              
              <div className="space-y-2 flex-1 flex flex-col">
                <span className="text-[9px] font-label tracking-widest text-secondary uppercase">Video Prompt</span>
                <textarea 
                  value={shot.video_prompt}
                  onChange={(e) => updateStoryboardPrompt(shot.shot_number, 'video', e.target.value)}
                  className="w-full flex-1 min-h-[80px] bg-surface-container-lowest border border-outline-variant/10 rounded-lg p-3 text-[10px] font-mono text-slate-300 focus:outline-none focus:border-secondary/30 transition-all resize-none custom-scrollbar"
                />
              </div>
            </div>

            {/* Settings */}
            <div className="px-4 py-3 border-t border-outline-variant/10 flex flex-wrap items-center justify-between gap-4 bg-surface-container-lowest/30">
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-label tracking-widest text-slate-500 uppercase">Res</span>
                <div className="flex items-center gap-0.5 bg-surface-container-lowest p-0.5 rounded-md border border-outline-variant/10">
                  {SIZES.map(size => (
                    <button
                      key={size}
                      onClick={() => updateStoryboardParams(shot.shot_number, { image_size: size })}
                      className={cn(
                        "px-2 py-1 rounded text-[9px] font-mono transition-all cursor-pointer",
                        shot.image_size === size 
                          ? "bg-primary/20 text-primary font-medium" 
                          : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
                      )}
                    >
                      {size}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[9px] font-label tracking-widest text-slate-500 uppercase">Ratio</span>
                <div className="flex items-center gap-0.5 bg-surface-container-lowest p-0.5 rounded-md border border-outline-variant/10">
                  {RATIOS.map(ratio => (
                    <button
                      key={ratio}
                      onClick={() => updateStoryboardParams(shot.shot_number, { aspect_ratio: ratio })}
                      className={cn(
                        "px-2 py-1 rounded text-[9px] font-mono transition-all cursor-pointer",
                        shot.aspect_ratio === ratio 
                          ? "bg-primary/20 text-primary font-medium" 
                          : "text-slate-500 hover:text-slate-300 hover:bg-white/5"
                      )}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Lightbox Preview */}
      {isPreviewOpen && previewUrl && (
        <div 
          className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-xl flex items-center justify-center p-4 md:p-12 animate-in fade-in duration-300"
          onClick={(e) => { e.stopPropagation(); setIsPreviewOpen(false); }}
        >
          <button 
            className="absolute top-6 right-6 p-3 bg-white/10 hover:bg-white/20 rounded-full text-white transition-all z-[110] cursor-pointer"
            onClick={(e) => { e.stopPropagation(); setIsPreviewOpen(false); }}
          >
            <XIcon className="w-6 h-6" />
          </button>

          {/* Navigation Buttons */}
          {shot.image_history && shot.image_history.length > 1 && (
            <>
              <button 
                className="absolute left-6 top-1/2 -translate-y-1/2 p-4 bg-white/5 hover:bg-white/10 rounded-full text-white transition-all z-[110] cursor-pointer disabled:opacity-20"
                onClick={handlePrevPreview}
                disabled={shot.image_history.indexOf(previewUrl) === 0}
              >
                <ChevronLeftIcon className="w-8 h-8" />
              </button>
              <button 
                className="absolute right-6 top-1/2 -translate-y-1/2 p-4 bg-white/5 hover:bg-white/10 rounded-full text-white transition-all z-[110] cursor-pointer disabled:opacity-20"
                onClick={handleNextPreview}
                disabled={shot.image_history.indexOf(previewUrl) === shot.image_history.length - 1}
              >
                <ChevronRightIcon className="w-8 h-8" />
              </button>
            </>
          )}
          
          <div className="relative max-w-full max-h-full flex items-center justify-center">
            <img 
              src={previewUrl} 
              alt={shot.summary}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl animate-in zoom-in-95 duration-300 cursor-zoom-out"
              onClick={(e) => e.stopPropagation()}
            />
            
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-md border border-white/10 px-6 py-3 rounded-2xl text-center max-w-2xl flex flex-col items-center gap-3">
              <div>
                <p className="text-white font-medium mb-1">{shot.summary}</p>
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

              {previewUrl !== shot.image_url && (
                <button 
                  onClick={(e) => { e.stopPropagation(); switchStoryboardImage(shot.shot_number, previewUrl); }}
                  className="px-4 py-2 bg-primary hover:bg-amber-400 text-black rounded-xl text-xs font-bold transition-all shadow-lg shadow-primary/20 cursor-pointer flex items-center gap-2"
                >
                  <RefreshCw className="w-3 h-3" />
                  设为当前分镜
                </button>
              )}
            </div>
          </div>
        </div>
      )}

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
