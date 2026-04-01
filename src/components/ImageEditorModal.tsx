import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, Sparkles, Loader2, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { ReferenceImage } from '../types';
import { parseApiResponse } from '../lib/http';

type Target =
  | { kind: 'reference'; id: string; url: string; title?: string }
  | { kind: 'shot'; shotNumber: string; url: string; title?: string }
  | { kind: 'scene'; sceneIndex: number; url: string; title?: string };

type Props = {
  isOpen: boolean;
  target: Target | null;
  appReferences: ReferenceImage[];
  onClose: () => void;
  onApply: (url: string) => void;
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

export const ImageEditorModal: React.FC<Props> = ({ isOpen, target, appReferences, onClose, onApply }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState('');
  const [localRefs, setLocalRefs] = useState<string[]>([]);
  const [selectedRefIds, setSelectedRefIds] = useState<Set<string>>(new Set());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAppRefs = useMemo(() => {
    if (!selectedRefIds.size) return [];
    return appReferences
      .filter((r) => selectedRefIds.has(r.id))
      .map((r) => r.url)
      .filter((u) => typeof u === 'string' && u.length > 0);
  }, [appReferences, selectedRefIds]);

  const allRefs = useMemo(() => [...selectedAppRefs, ...localRefs], [selectedAppRefs, localRefs]);

  const title = target?.title || '图片编辑台';

  const handlePickFiles = () => fileRef.current?.click();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    try {
      const next = await Promise.all(Array.from(files).slice(0, 8).map(readFileAsDataUrl));
      setLocalRefs((prev) => [...prev, ...next]);
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败');
    }
  };

  const handleSubmit = async () => {
    if (!target?.url) return;
    if (!prompt.trim()) {
      setError('请先写一句修改描述（prompt）');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          target_image: target.url,
          references: allRefs.map((url) => ({ url })),
        }),
      });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || `编辑失败 (${res.status})`);
      onApply(data.url);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '编辑失败');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && target && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 md:p-10 bg-black/80 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
          data-theme-preserve="dark"
        >
          <motion.div
            className={cn(
              'w-full max-w-[1050px] rounded-3xl overflow-hidden',
              'bg-surface-container-low/80 backdrop-blur-2xl',
              'outline outline-[0.5px] outline-outline-variant/20',
              'shadow-[0_60px_120px_-78px_rgba(0,0,0,0.8)]'
            )}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 flex items-center justify-between bg-white/[0.03]">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-[0.2em] text-primary">Image.Edit</div>
                <div className="text-sm font-semibold text-white truncate">{title}</div>
              </div>
              <button
                className="w-10 h-10 rounded-full flex items-center justify-center bg-white/5 hover:bg-white/10 text-white/90 hover:text-white transition-colors outline outline-[0.5px] outline-white/10 cursor-pointer"
                onClick={onClose}
                title="关闭"
              >
                <X className="w-5 h-5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-0">
              {/* Left: target preview */}
              <div className="p-6 border-r border-white/5">
                <div className="text-[9px] font-bold uppercase tracking-widest text-white/60 mb-2">Target</div>
                <div className="relative aspect-square rounded-2xl overflow-hidden outline outline-[0.5px] outline-white/10 bg-black/40">
                  <img src={target.url} className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                </div>
                <div className="mt-4 text-[10px] text-white/60 font-mono">
                  {target.kind === 'reference' && '来源：参考图'}
                  {target.kind === 'shot' && `来源：分镜 ${target.shotNumber}`}
                  {target.kind === 'scene' && `来源：场景 ${target.sceneIndex + 1}`}
                </div>
              </div>

              {/* Right: controls */}
              <div className="p-6 space-y-5">
                {error && (
                  <div className="px-4 py-3 rounded-2xl bg-red-500/10 outline outline-[0.5px] outline-red-500/20 text-red-200 text-xs">
                    {error}
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-white/70">Prompt</div>
                    <div className="text-[9px] font-mono text-white/40">{prompt.length}</div>
                  </div>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="例如：把氛围调成更电影感，光比更强，人物更靠近镜头，背景更干净..."
                    className={cn(
                      'w-full min-h-[120px] rounded-2xl p-4 text-xs leading-relaxed',
                      'bg-white/[0.03] outline outline-[0.5px] outline-white/10',
                      'text-white placeholder:text-white/35 focus:outline-none focus:outline-primary/30'
                    )}
                  />
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[9px] font-bold uppercase tracking-widest text-white/70">References</div>
                    <button
                      onClick={handlePickFiles}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-colors outline outline-[0.5px] outline-white/10 cursor-pointer text-[10px] font-semibold"
                    >
                      <Upload className="w-4 h-4" />
                      上传参考图
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={(e) => handleFiles(e.target.files)}
                    />
                  </div>

                  {/* pick from app references */}
                  {appReferences.length > 0 && (
                    <div className="rounded-2xl bg-white/[0.02] outline outline-[0.5px] outline-white/10 p-3">
                      <div className="text-[9px] font-bold uppercase tracking-widest text-white/50 mb-2">From Asset Library</div>
                      <div className="grid grid-cols-6 gap-2">
                        {appReferences.slice(0, 18).map((r) => {
                          const active = selectedRefIds.has(r.id);
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() =>
                                setSelectedRefIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(r.id)) next.delete(r.id);
                                  else next.add(r.id);
                                  return next;
                                })
                              }
                              className={cn(
                                'relative aspect-square rounded-xl overflow-hidden cursor-pointer transition-all',
                                'outline outline-[0.5px]',
                                active ? 'outline-primary/70 shadow-[0_0_0_3px_rgba(255,184,102,0.18)]' : 'outline-white/10 hover:outline-white/20'
                              )}
                              title={r.name}
                            >
                              <img src={r.url} className="w-full h-full object-cover" />
                              {active && (
                                <div className="absolute inset-0 bg-primary/18 flex items-center justify-center">
                                  <div className="w-7 h-7 rounded-full bg-primary text-black flex items-center justify-center shadow-lg">
                                    <Plus className="w-4 h-4" />
                                  </div>
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                      <div className="mt-2 text-[10px] text-white/40">
                        已选 {selectedRefIds.size} 张（另上传 {localRefs.length} 张）
                      </div>
                    </div>
                  )}

                  {/* thumbnails for local refs */}
                  {localRefs.length > 0 && (
                    <div className="grid grid-cols-8 gap-2">
                      {localRefs.map((u, i) => (
                        <div
                          key={`${u.slice(0, 24)}_${i}`}
                          className="relative aspect-square rounded-xl overflow-hidden outline outline-[0.5px] outline-white/10"
                        >
                          <img src={u} className="w-full h-full object-cover" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2 flex items-center justify-end gap-3">
                  <button
                    onClick={onClose}
                    className="px-5 py-3 rounded-2xl bg-white/5 hover:bg-white/10 text-white/80 hover:text-white transition-colors outline outline-[0.5px] outline-white/10 cursor-pointer text-xs font-semibold"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className={cn(
                      'px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-[0.18em] transition-all cursor-pointer',
                      isSubmitting
                        ? 'bg-slate-800 text-primary outline outline-[0.5px] outline-outline-variant/20 cursor-not-allowed'
                        : 'bg-primary text-black hover:bg-amber-400 shadow-[0_0_26px_rgba(255,184,102,0.25)]'
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {isSubmitting ? 'EDITING...' : 'EDIT IMAGE'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

