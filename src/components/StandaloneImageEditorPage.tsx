import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, Reorder } from 'motion/react';
import { Copy, Check, Camera, Loader2, X, Plus } from 'lucide-react';
import { useStore } from '../store/useStore';
import { parseApiResponse } from '../lib/http';
import { cn } from '../lib/utils';
import { SIZES, RATIOS } from '../constants';
import { AspectRatio, ImageSize, GenerationResponse } from '../types';

type EditRef = { id: string; url: string };
type EditHistoryItem = { url: string; prompt: string };

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

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

  const [editTargetImage, setEditTargetImage] = useState<string | null>(null);
  const [editResultImage, setEditResultImage] = useState<string | null>(null);
  const [editRefs, setEditRefs] = useState<EditRef[]>([]);
  const [editHistory, setEditHistory] = useState<EditHistoryItem[]>([]);

  const [copiedPrompt, setCopiedPrompt] = useState(false);

  const editTargetInputRef = useRef<HTMLInputElement>(null);

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
    const urls: string[] = [];

    // Edited results
    urls.push(...editHistory.map((h) => h.url));

    // Generated images from project
    const gen = data as GenerationResponse | null;
    if (gen) {
      gen.storyboards.forEach((shot) => {
        if (shot.image_url) urls.push(shot.image_url);
        (shot.image_history || []).forEach((u) => urls.push(u));
      });
      gen.global_assets?.scenes?.forEach((scene) => {
        if (scene.image_url) urls.push(scene.image_url);
        (scene.image_history || []).forEach((u) => urls.push(u));
      });
    }

    // Also include any app references (so user can browse)
    references.forEach((r) => {
      if (r.url) urls.push(r.url);
    });

    const seen = new Set<string>();
    return urls
      .filter((u) => u && !seen.has(u) && (seen.add(u), true))
      .slice(0, 24);
  }, [data, editHistory, references]);

  const resolvePromptForUrl = (url?: string | null) => {
    if (!url) return '';
    const hit = editHistory.find((h) => h.url === url);
    if (hit) return hit.prompt || '';
    return urlToOriginalPrompt.get(url) || '';
  };

  const activeDisplayUrl = editResultImage;
  const activeDisplayPrompt = resolvePromptForUrl(activeDisplayUrl);
  const activeDisplayIsEdit = !!activeDisplayUrl && editHistory.some((h) => h.url === activeDisplayUrl);

  const handleUploadEditTarget = async (files: FileList | null) => {
    if (!files?.length) return;
    const imgs = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 12);
    if (imgs.length === 0) return;

    const urls = await Promise.all(imgs.map(readFileAsDataUrl));
    setEditResultImage(null);

    if (!editTargetImage) {
      setEditTargetImage(urls[0]);
      setEditRefs(
        urls.slice(1).map((u, i) => ({
          id: uid('ref'),
          url: u,
        })),
      );
      return;
    }

    setEditRefs((prev) => [
      ...prev,
      ...urls.map((u) => ({
        id: uid('ref'),
        url: u,
      })),
    ]);
  };

  const handleRunEdit = async () => {
    if (!editTargetImage) {
      setError('请先上传或拖拽一张需要编辑的图');
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

      const mappingHint =
        `【图片顺序说明】图1=待编辑主图；图2及以后=参考图（按下方队列从左到右的顺序）。\n`;
      const finalPrompt = `${mappingHint}${editPrompt}`;

      const res = await fetch('/api/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          target_image: editTargetImage,
          prompt: finalPrompt,
          references: editRefs.map((r) => ({ url: r.url })),
          image_size: editImageSize,
          aspect_ratio: editAspectRatio,
        }),
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
    setEditResultImage(url);
    setEditHistory((prev) => [{ url, prompt: editPrompt }, ...prev.filter((h) => h.url !== url)]);
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

    setEditResultImage(null);
    if (!editTargetImage) {
      setEditTargetImage(url);
      return;
    }

    setEditRefs((prev) => [...prev, { id: uid('ref'), url }]);
  };

  return (
    <div className="min-h-screen bg-surface text-slate-100 font-sans overflow-hidden" data-ui-root>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-primary transition-colors cursor-pointer text-[10px] font-label tracking-widest uppercase"
          >
            返回起始页
          </button>
          <div className="text-[10px] font-label tracking-[0.18em] uppercase text-slate-400">
            IMAGE_EDITOR_STUDIO
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-7 relative rounded-[1.25rem] overflow-hidden bg-surface-container-low p-1 shadow-[0_45px_80px_-42px_rgba(0,0,0,0.58)]">
            <div
              className="relative aspect-video bg-surface-container-highest group/preview overflow-hidden flex items-center justify-center rounded-[1rem]"
              onMouseEnter={() => setIsHoveringImage(true)}
              onMouseLeave={() => setIsHoveringImage(false)}
            >
              {editResultImage ? (
                <img
                  src={editResultImage}
                  alt="edit result"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover opacity-90 group-hover/preview:scale-105 transition-transform duration-1000"
                />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-700 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-800/20 to-transparent">
                  <Camera className="w-16 h-16 mb-4 opacity-10" />
                  <span className="text-[10px] font-bold tracking-[0.3em] uppercase text-slate-400">
                    EDIT_RESULT_HERE
                  </span>
                </div>
              )}

              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-60" />

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
          </div>

          <div className="col-span-5 flex flex-col gap-4">
            <div className="bg-surface-container-low rounded-[1.25rem] p-4 outline outline-[0.5px] outline-white/5">
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

              <div className="space-y-2">
                <div className="text-[9px] font-label tracking-[0.18em] uppercase text-slate-400">
                  上传图片（单框：图1主图 + 图2+参考）
                </div>

                <div
                  className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] min-h-[132px] p-2"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleUnifiedDrop}
                >
                  <div className="flex gap-2 overflow-x-auto custom-scrollbar">
                    {editTargetImage && (
                      <div
                        className="relative shrink-0 h-24 min-w-[84px] max-w-[180px] rounded-xl overflow-hidden outline outline-[0.5px] outline-primary/70 bg-transparent flex items-center justify-center px-1"
                        data-theme-preserve="dark"
                      >
                        <img src={editTargetImage} className="h-full w-auto max-w-[172px] object-contain" draggable={false} />
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-black/80 text-white text-[9px] font-black tracking-widest outline outline-[0.5px] outline-white/20">
                          #1
                        </div>
                        <button
                          onClick={() => {
                            setEditTargetImage(null);
                            setEditResultImage(null);
                            setEditRefs([]);
                          }}
                          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/80 text-white flex items-center justify-center outline outline-[0.5px] outline-white/20"
                          title="移除主图"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    <Reorder.Group axis="x" values={editRefs} onReorder={setEditRefs} className="contents">
                      {editRefs.map((ref, idx) => (
                        <Reorder.Item
                          key={ref.id}
                          value={ref}
                          className="relative shrink-0 h-24 min-w-[84px] max-w-[180px] rounded-xl overflow-hidden outline outline-[0.5px] outline-white/20 cursor-grab active:cursor-grabbing bg-transparent flex items-center justify-center px-1"
                          whileDrag={{ scale: 1.04, zIndex: 20 }}
                          transition={spring}
                          data-theme-preserve="dark"
                        >
                          <img src={ref.url} className="h-full w-auto max-w-[172px] object-contain" draggable={false} />
                          <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-black/80 text-white text-[9px] font-black tracking-widest outline outline-[0.5px] outline-white/20">
                            #{idx + 2}
                          </div>
                          <button
                            onClick={() => setEditRefs((prev) => prev.filter((x) => x.id !== ref.id))}
                            className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/80 text-white flex items-center justify-center outline outline-[0.5px] outline-white/20"
                            title="移除图片"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </Reorder.Item>
                      ))}
                    </Reorder.Group>

                    <button
                      onClick={() => editTargetInputRef.current?.click()}
                      className="shrink-0 w-24 h-24 rounded-xl border border-dashed border-white/20 bg-white/[0.03] hover:bg-white/[0.06] text-slate-300 hover:text-primary transition-colors flex flex-col items-center justify-center gap-1 cursor-pointer"
                      title="上传图片"
                    >
                      <Plus className="w-4 h-4" />
                      <span className="text-[9px] font-black uppercase tracking-widest">Upload</span>
                    </button>
                  </div>

                  {!editTargetImage && editRefs.length === 0 && (
                    <div className="h-20 flex items-center justify-center text-slate-500 text-[10px] uppercase tracking-widest">
                      拖拽上传图片到这个框
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

              <div className="flex items-center gap-3 mt-3">
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
                    isEditingImage ? 'bg-slate-800 accent-focus' : 'accent-focus-bg hover:opacity-90',
                  )}
                >
                  {isEditingImage ? (
                    <span className="inline-flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      编辑中...
                    </span>
                  ) : (
                    '开始编辑'
                  )}
                </button>
              </div>
            </div>

            <div className="bg-surface-container-lowest rounded-[1.25rem] p-4 outline outline-[0.5px] outline-white/5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[9px] font-label tracking-[0.18em] uppercase accent-focus">统一历史浏览</span>
                <span className="text-[9px] text-slate-400">{unifiedHistory.length}_ITEMS</span>
              </div>

              {unifiedHistory.length > 0 ? (
                <div className="flex gap-2 overflow-x-auto custom-scrollbar">
                  {unifiedHistory.map((url, idx) => {
                    const isEdited = editHistory.some((h) => h.url === url);
                    return (
                      <button
                        key={`${url}_${idx}`}
                        type="button"
                        draggable
                        onDragStart={(e) => {
                          e.dataTransfer.setData('text/plain', url);
                          e.dataTransfer.effectAllowed = 'copy';
                        }}
                        onClick={() => {
                          setEditResultImage(url);
                        }}
                        data-theme-preserve="dark"
                        className={cn(
                          'relative shrink-0 w-20 h-20 rounded-xl overflow-hidden outline outline-[0.5px] transition-all cursor-pointer',
                          editResultImage === url ? 'outline-primary/80' : 'outline-white/15 hover:outline-white/35',
                        )}
                        title={isEdited ? `编辑历史 ${idx + 1}` : `生成历史 ${idx + 1}`}
                      >
                        <img src={url} className="w-full h-full object-cover" />
                        <span className="absolute top-1 left-1 px-1 py-0.5 rounded bg-black/90 text-white text-[8px] font-black tracking-widest outline outline-[0.5px] outline-white/20">
                          H{idx + 1}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="text-[10px] text-slate-400">暂无历史结果</div>
              )}
              <div className="mt-3 text-[10px] text-slate-500">
                提示：可把历史缩略图拖到上方框里，作为图1主图/图2+参考图再次编辑。
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

