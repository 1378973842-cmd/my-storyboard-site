import React, { useMemo, useRef, useState } from 'react';
import { motion, Reorder } from 'motion/react';
import { ImageIcon, Upload, Sparkles, Loader2, X, GripHorizontal, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { parseApiResponse } from '../lib/http';
import { GenerationResponse, ReferenceImage } from '../types';

type StudioRef = { id: string; url: string; name: string };

type Props = {
  references: ReferenceImage[];
  data: GenerationResponse | null;
  addReference: (ref: ReferenceImage) => void;
};

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.onloadend = () => resolve(reader.result as string);
    reader.readAsDataURL(file);
  });
}

export const ImageEditorStudio: React.FC<Props> = ({ references, data, addReference }) => {
  const targetInputRef = useRef<HTMLInputElement>(null);
  const refsInputRef = useRef<HTMLInputElement>(null);
  const [targetImage, setTargetImage] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [editRefs, setEditRefs] = useState<StudioRef[]>([]);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleDropTarget = async (e: React.DragEvent) => {
    e.preventDefault();
    setError(null);
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setTargetImage(await readFileAsDataUrl(file));
      return;
    }
    const url = parseDroppedUrl(e);
    if (url && (url.startsWith('http') || url.startsWith('data:image'))) setTargetImage(url);
  };

  const handleDropRefs = async (e: React.DragEvent) => {
    e.preventDefault();
    setError(null);
    const files = e.dataTransfer.files;
    if (files?.length) {
      const imgs = Array.from(files as FileList)
        .filter((f: File) => f.type.startsWith('image/'))
        .slice(0, 8);
      const urls = await Promise.all(imgs.map(readFileAsDataUrl));
      setEditRefs((prev) => [...prev, ...urls.map((u, i) => ({ id: uid(), url: u, name: `参考 ${prev.length + i + 1}` }))]);
      return;
    }
    const url = parseDroppedUrl(e);
    if (url && (url.startsWith('http') || url.startsWith('data:image'))) {
      setEditRefs((prev) => [...prev, { id: uid(), url, name: `参考 ${prev.length + 1}` }]);
    }
  };

  const uploadTarget = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return;
    setTargetImage(await readFileAsDataUrl(file));
  };

  const uploadRefs = async (files: FileList | null) => {
    if (!files?.length) return;
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/')).slice(0, 8);
    const urls = await Promise.all(imgs.map(readFileAsDataUrl));
    setEditRefs((prev) => [...prev, ...urls.map((u, i) => ({ id: uid(), url: u, name: `参考 ${prev.length + i + 1}` }))]);
  };

  const runEdit = async () => {
    if (!targetImage) {
      setError('请先设置待编辑图片（拖拽或上传）。');
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
          target_image: targetImage,
          prompt,
          references: editRefs.map((r) => ({ url: r.url })),
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
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Target Image</div>
            <div
              className="relative aspect-video rounded-2xl bg-white/[0.02] outline outline-[0.5px] outline-white/10 overflow-hidden"
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDropTarget}
            >
              {targetImage ? (
                <img src={targetImage} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-2">
                  <ImageIcon className="w-6 h-6" />
                  <span className="text-[10px] uppercase tracking-widest">拖拽图片到这里</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => targetInputRef.current?.click()}
                className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer"
              >
                <Upload className="w-3 h-3 inline mr-1" />
                Upload Target
              </button>
              {resultImage && (
                <button
                  onClick={() => setTargetImage(resultImage)}
                  className="px-3 py-2 rounded-xl bg-primary/20 hover:bg-primary/30 text-primary text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer"
                >
                  使用结果图继续编辑
                </button>
              )}
              <input ref={targetInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadTarget(e.target.files)} />
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
                      id: uid(),
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
          <div className="flex items-center justify-between">
            <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Reference Stack</div>
            <button
              onClick={() => refsInputRef.current?.click()}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 text-[10px] font-bold uppercase tracking-widest transition-colors cursor-pointer"
            >
              <Upload className="w-3 h-3 inline mr-1" />
              Upload Refs
            </button>
            <input ref={refsInputRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => uploadRefs(e.target.files)} />
          </div>

          <div
            className="min-h-[92px] p-3 rounded-2xl bg-white/[0.02] border border-dashed border-white/10"
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDropRefs}
          >
            <Reorder.Group axis="x" values={editRefs} onReorder={setEditRefs} className="flex gap-2 overflow-x-auto custom-scrollbar">
              {editRefs.map((r) => (
                <Reorder.Item
                  key={r.id}
                  value={r}
                  whileDrag={{ scale: 1.04, zIndex: 20 }}
                  transition={{ layout: spring }}
                  className="relative shrink-0 w-16 h-16 rounded-xl overflow-hidden outline outline-[0.5px] outline-white/10 cursor-grab active:cursor-grabbing"
                >
                  <img src={r.url} className="w-full h-full object-cover" />
                  <div className="absolute inset-x-0 top-0 p-1 flex items-center justify-between">
                    <GripHorizontal className="w-3 h-3 text-white/90" />
                    <button
                      onClick={() => setEditRefs((prev) => prev.filter((x) => x.id !== r.id))}
                      className="w-4 h-4 rounded-full bg-black/70 text-white flex items-center justify-center"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </Reorder.Item>
              ))}
            </Reorder.Group>
            {editRefs.length === 0 && (
              <div className="h-[64px] flex items-center justify-center text-slate-600 text-[10px] uppercase tracking-widest">
                拖拽上传或从图库拖入参考图
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Library (Drag Into Target / Refs)</div>
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
    </section>
  );
};

