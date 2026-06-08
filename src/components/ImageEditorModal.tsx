import React, { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, Sparkles, Loader2, Plus, Maximize2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { ReferenceImage } from '../types';
import { parseApiResponse } from '../lib/http';
import { useRefThumbPreview } from '../hooks/useRefThumbPreview';
import { ReferenceImageLightbox } from './ReferenceImageLightbox';

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
  const { previewUrl: refModalPreviewUrl, setPreviewUrl: setRefModalPreviewUrl, handlersFor: refThumbHandlers } =
    useRefThumbPreview();

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
          images: [target.url, ...allRefs],
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
    <>
    <AnimatePresence>
      {isOpen && target && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4 md:p-10 ai-editor-modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={onClose}
        >
          <motion.div
            className="w-full max-w-[1050px] rounded-3xl overflow-hidden ai-editor-modal-shell"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.98 }}
            transition={spring}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-4 flex items-center justify-between ai-editor-modal-header">
              <div className="min-w-0">
                <div className="text-[10px] font-label uppercase tracking-[0.2em] text-primary">图片编辑</div>
                <div className="text-sm font-semibold text-on-surface truncate">{title}</div>
              </div>
              <button
                className="w-10 h-10 rounded-full flex items-center justify-center bg-surface-container-high hover:bg-surface-container-highest text-on-surface/80 hover:text-on-surface transition-colors outline outline-[0.5px] outline-outline-variant/18 cursor-pointer"
                onClick={onClose}
                title="关闭"
              >
                <X className="w-5 h-5" strokeWidth={1.75} />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-0">
              {/* Left: target preview */}
              <div className="p-6 lg:border-r lg:border-outline-variant/10">
                <div className="text-[9px] font-label uppercase tracking-widest text-on-surface/55 mb-2">目标图</div>
                <div className="relative aspect-square rounded-2xl overflow-hidden ai-editor-modal-well">
                  <img src={target.url} className="w-full h-full object-cover" alt="" />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
                </div>
                <div className="mt-4 text-[10px] text-on-surface/52 font-mono">
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
                    <div className="text-[9px] font-label uppercase tracking-widest text-on-surface/58">修改描述</div>
                    <div className="text-[9px] font-mono text-on-surface/40">{prompt.length}</div>
                  </div>
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="例如：参考图1的光线，把图2里的人挪到画面中央…（图1、图2 与下方图片从左到右顺序一致）"
                    className={cn(
                      'w-full min-h-[120px] rounded-2xl p-4 text-xs leading-relaxed ai-editor-modal-input',
                      'focus:outline-none focus-visible:ring-2 accent-focus-ring',
                    )}
                  />
                </div>

                <div className="space-y-3">
                  <p className="text-[10px] text-on-surface/52 leading-relaxed">
                    左侧 Target 为图1，其余参考依次为图2、图3…；不固定「谁必须被改」，在上方 Prompt 里写清关系即可。
                  </p>
                  <div className="flex items-center justify-between">
                    <div className="text-[9px] font-label uppercase tracking-widest text-on-surface/58">参考图</div>
                    <button
                      data-ref-preview-ignore
                      onClick={handlePickFiles}
                      className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-surface-container-high hover:bg-surface-container-highest text-on-surface/72 hover:text-on-surface transition-colors outline outline-[0.5px] outline-outline-variant/18 cursor-pointer text-[10px] font-semibold"
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
                    <div className="rounded-2xl ai-editor-modal-well p-3">
                      <div className="text-[9px] font-label uppercase tracking-widest text-on-surface/48 mb-2">从素材库选择</div>
                      <div className="grid grid-cols-6 gap-2">
                        {appReferences.slice(0, 18).map((r) => {
                          const active = selectedRefIds.has(r.id);
                          return (
                            <div
                              key={r.id}
                              className={cn(
                                'relative aspect-square rounded-xl overflow-hidden transition-all cursor-pointer',
                                'outline outline-[0.5px]',
                                active ? 'outline-primary/70 shadow-[0_0_0_3px_rgba(255,184,102,0.18)]' : 'outline-outline-variant/20 hover:outline-outline-variant/35'
                              )}
                              title={r.name}
                            >
                              <button
                                type="button"
                                data-ref-preview-ignore
                                className="absolute inset-0 z-0"
                                aria-pressed={active}
                                onClick={() =>
                                  setSelectedRefIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(r.id)) next.delete(r.id);
                                    else next.add(r.id);
                                    return next;
                                  })
                                }
                              >
                                <img src={r.url} className="w-full h-full object-cover pointer-events-none" alt="" draggable={false} />
                                {active && (
                                  <div className="absolute inset-0 bg-primary/18 flex items-center justify-center">
                                    <div className="w-7 h-7 rounded-full bg-primary text-black flex items-center justify-center shadow-lg">
                                      <Plus className="w-4 h-4" />
                                    </div>
                                  </div>
                                )}
                              </button>
                              <button
                                type="button"
                                data-ref-preview-ignore
                                className="absolute bottom-1 right-1 z-10 flex h-7 w-7 items-center justify-center rounded-lg bg-black/70 text-white outline outline-[0.5px] outline-white/25 hover:bg-black/85 transition-colors cursor-pointer"
                                title="放大查看"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRefModalPreviewUrl(r.url);
                                }}
                              >
                                <Maximize2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                      <div className="mt-2 text-[10px] text-on-surface/45">
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
                          className="relative aspect-square cursor-zoom-in rounded-xl overflow-hidden outline outline-[0.5px] outline-outline-variant/20"
                          {...refThumbHandlers(u)}
                        >
                          <img src={u} className="w-full h-full object-cover pointer-events-none" alt="" draggable={false} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2 flex items-center justify-end gap-3">
                  <button
                    onClick={onClose}
                    className="px-5 py-3 rounded-2xl bg-surface-container-high hover:bg-surface-container-highest text-on-surface/72 hover:text-on-surface transition-colors outline outline-[0.5px] outline-outline-variant/18 cursor-pointer text-xs font-semibold"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSubmit}
                    disabled={isSubmitting}
                    className={cn(
                      'px-6 py-3 rounded-2xl text-xs font-label font-bold uppercase tracking-[0.18em] transition-all cursor-pointer',
                      isSubmitting
                        ? 'bg-surface-container-high text-on-surface/45 outline outline-[0.5px] outline-outline-variant/18 cursor-not-allowed'
                        : 'accent-focus-bg hover:opacity-95 accent-focus-glow',
                    )}
                  >
                    <span className="inline-flex items-center gap-2">
                      {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                      {isSubmitting ? '编辑中…' : '开始编辑'}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    <ReferenceImageLightbox
      url={refModalPreviewUrl}
      onClose={() => setRefModalPreviewUrl(null)}
      zIndexClass="z-[135]"
    />
    </>
  );
};

