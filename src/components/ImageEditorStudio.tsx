import React, { useMemo, useRef, useState } from 'react';
import { motion, Reorder } from 'motion/react';
import { ImageIcon, Upload, Sparkles, Loader2, X, GripHorizontal, Plus } from 'lucide-react';
import { cn, uniqueRefItemId } from '../lib/utils';
import { parseApiResponse } from '../lib/http';
import { GenerationResponse, ReferenceImage } from '../types';
import { useRefThumbPreview } from '../hooks/useRefThumbPreview';
import { ReferenceImageLightbox } from './ReferenceImageLightbox';

type StudioRef = { id: string; url: string; name: string };

type Props = {
  references: ReferenceImage[];
  data: GenerationResponse | null;
  addReference: (ref: ReferenceImage) => void;
};

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

export const ImageEditorStudio: React.FC<Props> = ({ references, data, addReference }) => {
  const queueInputRef = useRef<HTMLInputElement>(null);
  const [prompt, setPrompt] = useState('');
  /** 从左到右为图1、图2…（仅顺序；具体角色由用户在 prompt 中描述） */
  const [editQueue, setEditQueue] = useState<StudioRef[]>([]);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { previewUrl: refThumbPreviewUrl, setPreviewUrl: setRefThumbPreviewUrl, handlersFor: refThumbHandlers } =
    useRefThumbPreview();

  const library = useMemo(() => {
    const items: StudioRef[] = [];
    const seen = new Set<string>();

    references.forEach((r, i) => {
      if (!r.url || seen.has(r.url)) return;
      seen.add(r.url);
      items.push({ id: `ref_${r.id}`, url: r.url, name: r.name || `参考 ${i + 1}` });
    });

    data?.storyboards?.forEach((shot, i) => {
      const urls = [shot.image_url, ...(shot.image_history || [])].filter(Boolean) as string[];
      urls.forEach((u, j) => {
        if (!u || seen.has(u)) return;
        seen.add(u);
        items.push({ id: `shot_${i}_${j}`, url: u, name: `镜头 ${shot.shot_number}` });
      });
    });

    data?.global_assets?.scenes?.forEach((scene, i) => {
      const urls = [scene.image_url, ...(scene.image_history || [])].filter(Boolean) as string[];
      urls.forEach((u, j) => {
        if (!u || seen.has(u)) return;
        seen.add(u);
        items.push({ id: `scene_${i}_${j}`, url: u, name: `场景 ${i + 1}` });
      });
    });

    return items.slice(0, 60);
  }, [references, data]);

  const onDragStartLib = (e: React.DragEvent, item: StudioRef) => {
    e.dataTransfer.setData('application/x-image-url', item.url);
    e.dataTransfer.setData('text/plain', item.url);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const parseDroppedUrl = (e: React.DragEvent): string | null => {
    return (
      e.dataTransfer.getData('application/x-image-url') ||
      e.dataTransfer.getData('text/uri-list') ||
      e.dataTransfer.getData('text/plain') ||
      null
    );
  };

  const handleDropQueue = async (e: React.DragEvent) => {
    e.preventDefault();
    setError(null);
    const files = e.dataTransfer.files;
    if (files?.length) {
      const imgs = Array.from(files as FileList)
        .filter((f: File) => f.type.startsWith('image/'))
        .slice(0, 12);
      if (!imgs.length) return;
      const urls = await Promise.all(imgs.map(readFileAsDataUrl));
      setEditQueue((prev) => [
        ...prev,
        ...urls.map((u, i) => ({
          id: uniqueRefItemId('ref'),
          url: u,
          name: `图${prev.length + i + 1}`,
        })),
      ]);
      return;
    }
    const url = parseDroppedUrl(e);
    if (url && (url.startsWith('http') || url.startsWith('data:image'))) {
      setEditQueue((prev) => [
        ...prev,
        { id: uniqueRefItemId('ref'), url, name: `图${prev.length + 1}` },
      ]);
    }
  };

  const uploadQueue = async (files: FileList | null) => {
    if (!files?.length) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 12);
    const urls = await Promise.all(imgs.map(readFileAsDataUrl));
    setEditQueue((prev) => [
      ...prev,
      ...urls.map((u, i) => ({
        id: uniqueRefItemId('ref'),
        url: u,
        name: `图${prev.length + i + 1}`,
      })),
    ]);
  };

  const runEdit = async () => {
    if (editQueue.length === 0) {
      setError('请先上传至少一张图片（图1、图2…仅为顺序，关系写在提示词里）');
      return;
    }
    if (!prompt.trim()) {
      setError('请先填写修改描述（prompt）。');
      return;
    }
    setIsEditing(true);
    setError(null);
    try {
      const res = await fetch('/api/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          images: editQueue.map((r) => r.url),
        }),
      });
      const payload = await parseApiResponse(res);
      if (!res.ok) throw new Error(payload.error || `编辑失败 (${res.status})`);
      if (!payload.url) throw new Error('未返回图片 URL');
      setResultImage(payload.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '编辑失败');
    } finally {
      setIsEditing(false);
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2">
        <div className="w-1 h-3 bg-primary rounded-full" />
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">Image_Edit_Studio</span>
      </div>

      <div className="space-y-4 bg-white/[0.02] border border-white/10 rounded-2xl p-4">
        {error && (
          <div className="px-3 py-2 rounded-xl bg-red-500/10 outline outline-[0.5px] outline-red-500/20 text-red-300 text-xs">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">顺序首图预览（图1）</div>
            <div
              className="relative aspect-video rounded-2xl bg-white/[0.02] outline outline-[0.5px] outline-white/10 overflow-hidden"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDropQueue}
            >
              {editQueue[0] ? (
                <img src={editQueue[0].url} className="w-full h-full object-cover" alt="" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                  <ImageIcon className="w-6 h-6" />
                  <span className="text-[10px] uppercase tracking-widest">先在下栏排队列或拖图到此处</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => queueInputRef.current?.click()}
                className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer"
              >
                <Upload className="w-3 h-3 inline mr-1" />
                上传图片
              </button>
              {resultImage && (
                <button
                  type="button"
                  onClick={() =>
                    setEditQueue((prev) => [
                      {
                        id: uniqueRefItemId('ref'),
                        url: resultImage,
                        name: '编辑结果',
                      },
                      ...prev,
                    ])
                  }
                  className="px-3 py-2 rounded-xl bg-primary/20 hover:bg-primary/30 text-primary text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer"
                >
                  将结果图插到队首（成为图1）
                </button>
              )}
              <input
                ref={queueInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => uploadQueue(e.target.files)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Result</div>
            <div className="relative aspect-video rounded-2xl bg-white/[0.02] outline outline-[0.5px] outline-white/10 overflow-hidden">
              {resultImage ? (
                <img src={resultImage} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-slate-600 text-[10px] uppercase tracking-widest">
                  尚未生成
                </div>
              )}
            </div>
            {resultImage && (
              <div className="flex gap-2">
                <button
                  onClick={() =>
                    addReference({
                      id: uniqueRefItemId('ref'),
                      url: resultImage,
                      name: `编辑结果 ${Date.now().toString().slice(-4)}`,
                      type: 'scene',
                    })
                  }
                  className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer"
                >
                  添加到参考图
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Edit Prompt</div>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="描述你希望如何修改（光线、构图、风格、角色细节等）"
            className="w-full min-h-[90px] bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all resize-none"
          />
        </div>

        <div className="space-y-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">
            图片队列（图1、图2…，可拖拽排序）
          </div>

          <div
            className="min-h-[92px] p-3 rounded-2xl bg-white/[0.02] border border-dashed border-white/10"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropQueue}
          >
            <Reorder.Group as="div" axis="x" values={editQueue} onReorder={setEditQueue} className="flex gap-2 overflow-x-auto custom-scrollbar">
              {editQueue.map((r, idx) => (
                <Reorder.Item
                  as="div"
                  key={r.id}
                  value={r}
                  whileDrag={{ scale: 1.04, zIndex: 20 }}
                  transition={{ layout: spring }}
                  className="relative shrink-0 w-16 h-16 rounded-xl overflow-hidden outline outline-[0.5px] outline-white/10 cursor-grab active:cursor-grabbing cursor-zoom-in"
                  {...refThumbHandlers(r.url)}
                >
                  <img src={r.url} className="w-full h-full object-cover pointer-events-none" draggable={false} />
                  <div className="absolute bottom-0 left-0 right-0 py-0.5 text-center text-[8px] font-black text-white bg-black/70 pointer-events-none">
                    {idx + 1}
                  </div>
                  <div className="absolute inset-x-0 top-0 p-1 flex items-center justify-between pointer-events-none">
                    <GripHorizontal className="w-3 h-3 text-white/90" />
                    <button
                      data-ref-preview-ignore
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        const id = r.id;
                        setEditQueue((prev) => prev.filter((x) => x.id !== id));
                      }}
                      className="w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center pointer-events-auto"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </Reorder.Item>
              ))}
            </Reorder.Group>
            {editQueue.length === 0 && (
              <div className="h-[64px] flex items-center justify-center text-slate-600 text-[10px] uppercase tracking-widest">
                拖拽上传或从图库拖入（首张为图1）
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Library（拖入上方队列）</div>
          <div className="grid grid-cols-6 md:grid-cols-8 gap-2 max-h-[180px] overflow-y-auto custom-scrollbar p-1">
            {library.map((item) => (
              <motion.div
                key={item.id}
                draggable
                onDragStart={(e) => onDragStartLib(e, item)}
                whileHover={{ y: -2 }}
                transition={spring}
                className="group relative aspect-square rounded-xl overflow-hidden outline outline-[0.5px] outline-white/10 cursor-grab active:cursor-grabbing"
                title={item.name}
              >
                <img src={item.url} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Plus className="w-4 h-4 text-white" />
                </div>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={runEdit}
            disabled={isEditing}
            className={cn(
              'px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-[0.18em] transition-all cursor-pointer',
              isEditing ? 'bg-slate-800 text-primary' : 'bg-primary text-black hover:bg-amber-400'
            )}
          >
            {isEditing ? <Loader2 className="w-4 h-4 inline mr-2 animate-spin" /> : <Sparkles className="w-4 h-4 inline mr-2" />}
            {isEditing ? 'Editing...' : 'Run Edit'}
          </button>
        </div>
      </div>

      <ReferenceImageLightbox url={refThumbPreviewUrl} onClose={() => setRefThumbPreviewUrl(null)} />
    </section>
  );
};

