import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, Reorder } from 'motion/react';
import { Loader2, Plus, X, Grid3X3, Download, Scissors, Sparkles, ArrowLeft } from 'lucide-react';
import { cn, uniqueRefItemId } from '../lib/utils';
import { parseApiResponse } from '../lib/http';
import { useRefThumbPreview } from '../hooks/useRefThumbPreview';
import { ReferenceImageLightbox } from './ReferenceImageLightbox';
import { ZoomableLightboxImage } from './ZoomableLightboxImage';

type RefItem = { id: string; url: string; name?: string };
type GridHistoryItem = {
  id: string;
  createdAt: number;
  gridUrl: string;
  shots: string[];
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
  onBack: () => void;
};

const GRID_PREFIX =
  `在3X3网格中生成9个连贯分镜，固定版式为“从左到右、从上到下 1-9 顺序”。` +
  `每个格子严格为16:9横屏，整体大图严格为16:9。` +
  `九格必须无任何分隔线、无边框、无留白、无黑边、无白边、无拼接缝；` +
  `九格彼此紧贴，像一张完整画布被分为九个镜头。` +
  `以参考图为主体，保持环境空间布局一致、人物与物品相对位置合理，并通过不同角度推进剧情连贯发展。` +
  `全图要求4K极致分辨率、超高清细节、电影级质感、风格高度一致。` +
  `负向约束：禁止任何文字元素、禁止字幕、禁止对白台词字卡、禁止标题字、禁止 logo、禁止水印、禁止网格线、禁止边框、禁止任何装饰性分割元素。` +
  `如果模型倾向添加文字，必须改为纯画面表达，画面中不得出现可读字符。` +
  ` "image_generation_model": "gemini-3.1-flash-image-preview-4k", "grid_layout": "3x3", "grid_aspect_ratio": "16:9"。`;

export const NineGridPage: React.FC<Props> = ({ onBack }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  const [story, setStory] = useState('');
  const [refs, setRefs] = useState<RefItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'text' | 'image'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [shotsPreview, setShotsPreview] = useState<Array<{ n: number; prompt: string }>>([]);
  const [cropPadding, setCropPadding] = useState(0);
  const [cropGap, setCropGap] = useState(0);
  const [isCropping, setIsCropping] = useState(false);
  const [croppedUrls, setCroppedUrls] = useState<string[]>([]);
  const [cropError, setCropError] = useState<string | null>(null);
  const [cellEditLoadingIdx, setCellEditLoadingIdx] = useState<number | null>(null);
  const [history, setHistory] = useState<GridHistoryItem[]>([]);
  const [preview, setPreview] = useState<{ type: 'result'; url?: string } | { type: 'crop'; idx: number } | null>(null);

  const { previewUrl: refThumbPreviewUrl, setPreviewUrl: setRefThumbPreviewUrl, handlersFor: refThumbHandlers } =
    useRefThumbPreview();

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview]);

  const canBuildPrompts = story.trim().length >= 10 && refs.length >= 1 && !isRunning;
  const canGenerateImage =
    refs.length >= 1 &&
    shotsPreview.length === 9 &&
    shotsPreview.every((s) => s.prompt.trim().length >= 12) &&
    !isRunning;

  const hint = useMemo(() => {
    if (refs.length === 0) return '上传参考图并命名（按顺序：图1/图2/...）。';
    return `已上传 ${refs.length} 张（顺序即 图1..图${refs.length}，可拖拽调整，建议命名为角色名）。`;
  }, [refs.length]);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setError(null);
    const imgs = Array.from(files)
      .filter((f) => f.type.startsWith('image/'))
      .slice(0, 12);
    if (imgs.length === 0) return;
    const urls = await Promise.all(imgs.map(readFileAsDataUrl));
    setRefs((prev) => {
      const base = prev.length;
      return [
        ...prev,
        ...urls.map((u, idx) => ({
          id: uniqueRefItemId('ref'),
          url: u,
          name: `角色${String(base + idx + 1).padStart(2, '0')}`,
        })),
      ];
    });
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files?.length) {
      await handleFiles(e.dataTransfer.files);
    }
  };

  const runPromptPhase = async () => {
    if (!canBuildPrompts) return;
    setIsRunning(true);
    setPhase('text');
    setProgress(0);
    setError(null);
    setResultUrl(null);
    setCroppedUrls([]);

    let timer: any = null;
    try {
      timer = setInterval(() => {
        setProgress((p) => (p >= 92 ? p : p + Math.random() * 6));
      }, 420);

      const textRes = await fetch('/api/generate-9grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'prompts_only',
          story,
          references: refs.map((r, idx) => ({
            url: r.url,
            name: (r.name || '').trim() || `角色${String(idx + 1).padStart(2, '0')}`,
          })),
        }),
      });

      const textData = await parseApiResponse(textRes);
      if (!textRes.ok) throw new Error(textData.error || `分镜提示词生成失败 (${textRes.status})`);
      if (!textData?.imagePrompt) throw new Error('分镜提示词生成失败：未返回 imagePrompt');
      if (!Array.isArray(textData?.shots) || textData.shots.length !== 9) throw new Error('分镜提示词生成失败：shots 数量异常');

      setShotsPreview(
        textData.shots.map((s: any, idx: number) => ({
          n: Number(s?.n || idx + 1),
          prompt: String(s?.prompt || '').trim(),
        })).sort((a: { n: number }, b: { n: number }) => a.n - b.n),
      );
      setProgress(100);
    } catch (e) {
      setError(e instanceof Error ? e.message : '九宫格生成失败');
      setProgress(0);
    } finally {
      if (timer) clearInterval(timer);
      setIsRunning(false);
      setPhase('idle');
    }
  };

  const runImagePhase = async () => {
    if (!canGenerateImage) return;
    setIsRunning(true);
    setPhase('image');
    setProgress(8);
    setError(null);

    let timer: any = null;
    try {
      timer = setInterval(() => {
        setProgress((p) => (p >= 94 ? p : p + Math.random() * 5));
      }, 450);

      const refMap = refs
        .map((r, idx) => `图${idx + 1}（${(r.name || '').trim() || `角色${String(idx + 1).padStart(2, '0')}`}）`)
        .join('、');
      const shotLines = shotsPreview
        .slice()
        .sort((a, b) => a.n - b.n)
        .map((s) => `格子${s.n}：${s.prompt.trim()}`)
        .join('\n');
      const mergedPrompt = `${GRID_PREFIX}\n参考图命名映射：${refMap || '无'}\n九宫格内容要求（从左到右、从上到下对应1-9）：\n${shotLines}`;

      const imageRes = await fetch('/api/generate-9grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'image_only',
          imagePrompt: mergedPrompt,
          references: refs.map((r, idx) => ({
            url: r.url,
            name: (r.name || '').trim() || `角色${String(idx + 1).padStart(2, '0')}`,
          })),
        }),
      });

      const imageData = await parseApiResponse(imageRes);
      if (!imageRes.ok) throw new Error(imageData.error || `九宫格生图失败 (${imageRes.status})`);
      if (!imageData?.url) throw new Error('未返回图片 URL');
      setResultUrl(imageData.url);
      try {
        const autoCropped = await splitToNine(imageData.url, 0, 0);
        setCroppedUrls(autoCropped);
        setHistory((prev) => [
          {
            id: uniqueRefItemId('hist'),
            createdAt: Date.now(),
            gridUrl: imageData.url,
            shots: autoCropped,
          },
          ...prev,
        ].slice(0, 30));
        setCropPadding(0);
        setCropGap(0);
        setCropError(null);
      } catch {
        // keep manual crop available when upstream image url disallows canvas read
        setHistory((prev) => [
          {
            id: uniqueRefItemId('hist'),
            createdAt: Date.now(),
            gridUrl: imageData.url,
            shots: [],
          },
          ...prev,
        ].slice(0, 30));
      }
      setProgress(100);
    } catch (e) {
      setError(e instanceof Error ? e.message : '九宫格生图失败');
      setProgress(0);
    } finally {
      if (timer) clearInterval(timer);
      setIsRunning(false);
      setPhase('idle');
    }
  };

  const download = async () => {
    if (!resultUrl) return;
    const resp = await fetch(resultUrl);
    const blob = await resp.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `nine_grid_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(blobUrl);
  };

  const loadImage = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('图片加载失败（可能跨域或链接已失效）'));
      img.src = src;
    });

  const splitToNine = async (src: string, pad: number, gap: number): Promise<string[]> => {
    const img = await loadImage(src);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const safePad = Math.max(0, Math.min(Math.floor(Math.min(w, h) / 10), Math.round(pad)));
    const safeGap = Math.max(0, Math.min(200, Math.round(gap)));
    const innerW = w - safePad * 2 - safeGap * 2;
    const innerH = h - safePad * 2 - safeGap * 2;
    if (innerW <= 0 || innerH <= 0) throw new Error('裁切参数过大：内框尺寸为负');

    const cellW = Math.floor(innerW / 3);
    const cellH = Math.floor(innerH / 3);
    if (cellW <= 10 || cellH <= 10) throw new Error('裁切参数过大：单格过小');

    const out: string[] = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const sx = safePad + col * (cellW + safeGap);
        const sy = safePad + row * (cellH + safeGap);
        const c = document.createElement('canvas');
        c.width = cellW;
        c.height = cellH;
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('Canvas 初始化失败');
        ctx.drawImage(img, sx, sy, cellW, cellH, 0, 0, cellW, cellH);
        out.push(c.toDataURL('image/png'));
      }
    }
    return out;
  };

  const estimateGapAndPadding = async () => {
    if (!resultUrl) return;
    setCropError(null);
    try {
      const img = await loadImage(resultUrl);
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Canvas 初始化失败');
      ctx.drawImage(img, 0, 0);

      const data = ctx.getImageData(0, 0, w, h).data;
      const sampleColumnScore = (x: number) => {
        let sum = 0;
        let sum2 = 0;
        let n = 0;
        for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 220))) {
          const i = (y * w + x) * 4;
          const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
          sum += v;
          sum2 += v * v;
          n++;
        }
        const mean = sum / Math.max(1, n);
        const variance = sum2 / Math.max(1, n) - mean * mean;
        return { mean, variance };
      };

      const findGapNear = (center: number, axis: 'x' | 'y') => {
        const radius = Math.max(8, Math.floor((axis === 'x' ? w : h) * 0.02));
        const start = Math.max(1, Math.floor(center - radius));
        const end = Math.min((axis === 'x' ? w : h) - 2, Math.floor(center + radius));

        let best = { pos: start, variance: Number.POSITIVE_INFINITY, mean: 0 };
        for (let p = start; p <= end; p++) {
          const s =
            axis === 'x'
              ? sampleColumnScore(p)
              : (() => {
                  let sum = 0;
                  let sum2 = 0;
                  let n = 0;
                  for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 220))) {
                    const i = (p * w + x) * 4;
                    const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
                    sum += v;
                    sum2 += v * v;
                    n++;
                  }
                  const mean = sum / Math.max(1, n);
                  const variance = sum2 / Math.max(1, n) - mean * mean;
                  return { mean, variance };
                })();
          if (s.variance < best.variance) best = { pos: p, variance: s.variance, mean: s.mean };
        }

        // expand around best.pos for contiguous low-variance + similar-mean region
        const thresholdVar = best.variance + 8;
        const thresholdMean = 14;
        let left = best.pos;
        let right = best.pos;
        const scoreAt = (p: number) =>
          axis === 'x' ? sampleColumnScore(p) : (() => {
            let sum = 0;
            let sum2 = 0;
            let n = 0;
            for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 220))) {
              const i = (p * w + x) * 4;
              const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
              sum += v;
              sum2 += v * v;
              n++;
            }
            const mean = sum / Math.max(1, n);
            const variance = sum2 / Math.max(1, n) - mean * mean;
            return { mean, variance };
          })();

        for (let p = best.pos - 1; p >= start; p--) {
          const s = scoreAt(p);
          if (s.variance <= thresholdVar && Math.abs(s.mean - best.mean) <= thresholdMean) left = p;
          else break;
        }
        for (let p = best.pos + 1; p <= end; p++) {
          const s = scoreAt(p);
          if (s.variance <= thresholdVar && Math.abs(s.mean - best.mean) <= thresholdMean) right = p;
          else break;
        }
        return { gap: Math.max(0, right - left + 1) };
      };

      const g1 = findGapNear(w / 3, 'x');
      const g2 = findGapNear((2 * w) / 3, 'x');
      const gapX = Math.max(g1.gap, g2.gap);
      const r1 = findGapNear(h / 3, 'y');
      const r2 = findGapNear((2 * h) / 3, 'y');
      const gapY = Math.max(r1.gap, r2.gap);
      const gap = Math.max(gapX, gapY);

      setCropGap(Math.min(160, Math.max(0, Math.round(gap))));
      setCropPadding(0);
    } catch (e) {
      setCropError(e instanceof Error ? e.message : '自动估算失败');
    }
  };

  const cropToNine = async () => {
    if (!resultUrl) return;
    setIsCropping(true);
    setCropError(null);
    try {
      const out = await splitToNine(resultUrl, cropPadding, cropGap);
      setCroppedUrls(out);
    } catch (e) {
      setCropError(e instanceof Error ? e.message : '裁切失败');
    } finally {
      setIsCropping(false);
    }
  };

  const downloadCropped = async (idx: number) => {
    const url = croppedUrls[idx];
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `shot_${String(idx + 1).padStart(2, '0')}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const downloadAllCropped = async () => {
    if (croppedUrls.length === 0) return;
    for (let i = 0; i < croppedUrls.length; i++) {
      await downloadCropped(i);
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  };

  const startNewBatch = () => {
    if (isRunning) return;
    setShotsPreview([]);
    setResultUrl(null);
    setCroppedUrls([]);
    setCropError(null);
    setError(null);
    setCellEditLoadingIdx(null);
    setProgress(0);
    setPhase('idle');
  };

  const toggleCropPreview = (idx: number) => {
    setPreview((prev) => {
      if (prev && prev.type === 'crop' && prev.idx === idx) return null;
      return { type: 'crop', idx };
    });
  };

  const runCellEdit = async (idx: number) => {
    const target = croppedUrls[idx];
    const prompt = shotsPreview[idx]?.prompt?.trim() || '';
    if (!target || !prompt || cellEditLoadingIdx !== null) return;

    try {
      setCellEditLoadingIdx(idx);
      setError(null);
      const res = await fetch('/api/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt,
          images: [target, ...refs.map((r) => r.url)],
          image_size: '2K',
          aspect_ratio: '16:9',
        }),
      });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || `单格编辑失败 (${res.status})`);
      if (!data?.url) throw new Error('单格编辑失败：未返回图片 URL');

      setCroppedUrls((prev) => prev.map((u, i) => (i === idx ? data.url : u)));
    } catch (e) {
      setError(e instanceof Error ? e.message : '单格编辑失败');
    } finally {
      setCellEditLoadingIdx(null);
    }
  };

  return (
    <div className="min-h-screen bg-surface text-on-background font-sans overflow-hidden relative" data-ui-root>
      <div className="pointer-events-none fixed inset-0 z-0 opacity-[0.48]" aria-hidden>
        <div className="absolute -top-36 right-[-10%] h-[min(48vw,480px)] w-[min(62vw,560px)] rounded-full bg-secondary/[0.09] blur-[105px]" />
        <div className="absolute bottom-[-12%] left-[-8%] h-[380px] w-[min(70vw,620px)] rounded-full bg-primary/[0.07] blur-[95px]" />
        <div className="absolute top-[42%] left-[35%] h-[200px] w-[280px] rounded-full bg-primary/[0.04] blur-[70px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring}
        className="relative z-10 p-6 md:p-8 lg:p-10 max-w-[1680px] mx-auto"
      >
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between mb-8 lg:mb-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
            <button
              type="button"
              onClick={onBack}
              className="group/bak inline-flex w-fit items-center gap-2.5 px-5 py-2.5 rounded-full glass-panel ghost-border text-on-surface/75 hover:text-primary transition-colors cursor-pointer text-[10px] font-label tracking-widest uppercase shadow-[0_40px_80px_-50px_rgba(0,0,0,0.75)]"
            >
              <ArrowLeft className="w-4 h-4 opacity-65 group-hover/bak:-translate-x-0.5 transition-transform duration-300" />
              返回起始页
            </button>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-container-high/80 outline outline-[0.5px] outline-white/10 shadow-[0_20px_40px_-24px_rgba(0,0,0,0.65)]">
                <Grid3X3 className="w-5 h-5 accent-focus" />
              </div>
              <div>
                <h1 className="font-headline text-2xl sm:text-3xl tracking-[-0.02em] text-on-surface italic leading-tight">
                  九宫叙事台
                </h1>
                <p className="mt-1 font-label text-[9px] tracking-[0.26em] uppercase text-on-surface/35">
                  Nine-beat storyboard
                </p>
              </div>
            </div>
          </div>
          <span className="inline-flex w-fit items-center gap-2 rounded-full px-3 py-1.5 glass-panel ghost-border font-label text-[9px] tracking-[0.2em] uppercase text-secondary/90">
            <span className="h-1 w-1 rounded-full bg-secondary/90 shadow-[0_0_14px_rgba(141,205,255,0.4)]" />
            3×3 Pipeline
          </span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.18fr)_minmax(0,0.9fr)] gap-8 lg:gap-10 xl:gap-12">
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.04 }}
            className="bg-surface-container-low/88 backdrop-blur-sm rounded-[1.5rem] p-5 md:p-6 outline outline-[0.5px] outline-white/[0.07] shadow-[0_56px_100px_-48px_rgba(0,0,0,0.78)]"
          >
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-8 w-px rounded-full bg-gradient-to-b from-secondary/55 to-transparent shrink-0" />
                <div className="min-w-0">
                  <div className="text-[9px] font-label tracking-[0.22em] uppercase text-on-surface/40">主画布</div>
                  <div className="font-headline text-sm italic text-on-surface/80 truncate">Result viewport</div>
                </div>
              </div>
              {resultUrl && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={cropToNine}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full glass-panel ghost-border text-on-surface/80 hover:text-primary transition-colors cursor-pointer text-[10px] font-label font-semibold uppercase tracking-widest shadow-[0_20px_44px_-36px_rgba(0,0,0,0.65)]"
                    title="裁切成 9 张"
                  >
                    {isCropping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                    裁切9张
                  </button>
                  <button
                    onClick={download}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full glass-panel ghost-border text-on-surface/80 hover:text-primary transition-colors cursor-pointer text-[10px] font-label font-semibold uppercase tracking-widest shadow-[0_20px_44px_-36px_rgba(0,0,0,0.65)]"
                  >
                    <Download className="w-4 h-4" />
                    下载
                  </button>
                </div>
              )}
            </div>

            {shotsPreview.length === 9 ? (
              <div className="rounded-[1.25rem] bg-surface-container-high/55 backdrop-blur-sm p-4 md:p-5 outline outline-[0.5px] outline-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <p className="text-[10px] text-on-surface/45 leading-relaxed max-w-[46ch]">
                    九格工作台：逐格润色提示词；成片后自动裁切回填，可单格精修或批量导出。
                  </p>
                  {croppedUrls.length === 9 && (
                    <button
                      type="button"
                      onClick={downloadAllCropped}
                      className="shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[linear-gradient(135deg,var(--color-primary),var(--color-on-primary-container))] text-on-primary-fixed text-[10px] font-label font-bold uppercase tracking-widest hover:opacity-95 cursor-pointer accent-focus-glow shadow-[0_24px_48px_-28px_rgba(255,184,102,0.35)]"
                      title="下载全部切图"
                    >
                      <Download className="w-4 h-4" />
                      下载全部
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
                  {shotsPreview.map((shot, idx) => (
                    <motion.div
                      key={`${shot.n}_${idx}`}
                      layout
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...spring, delay: Math.min(idx * 0.035, 0.24) }}
                      whileHover={{ y: -2 }}
                      className="rounded-[1rem] bg-surface-container-low/90 p-2.5 outline outline-[0.5px] outline-white/[0.09] shadow-[0_22px_44px_-28px_rgba(0,0,0,0.72)]"
                    >
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <div className="text-[9px] font-label tracking-[0.16em] uppercase accent-focus">格子 {shot.n}</div>
                        <button
                          type="button"
                          onClick={() => runCellEdit(idx)}
                          disabled={!croppedUrls[idx] || cellEditLoadingIdx !== null}
                          className={cn(
                            'px-2 py-1 rounded-full text-[9px] font-black tracking-widest outline outline-[0.5px] transition-all',
                            cellEditLoadingIdx === idx
                              ? 'bg-surface-container-high text-slate-200 outline-white/20 cursor-wait'
                              : croppedUrls[idx]
                                ? 'accent-focus-bg text-white outline-white/30 hover:opacity-90 cursor-pointer'
                                : 'bg-surface-container-high text-slate-400 outline-white/10 cursor-not-allowed',
                          )}
                          title="使用当前提示词编辑该格"
                        >
                          {cellEditLoadingIdx === idx ? '编辑中' : '编辑'}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (croppedUrls[idx]) toggleCropPreview(idx);
                        }}
                        className={cn(
                          'w-full aspect-video rounded-lg overflow-hidden outline outline-[0.5px] transition-all',
                          croppedUrls[idx]
                            ? 'outline-white/15 hover:outline-white/30 cursor-zoom-in'
                            : 'outline-white/8 cursor-default bg-surface-container-highest',
                        )}
                        title={croppedUrls[idx] ? `查看图${idx + 1}` : '生图后自动回填到此格'}
                      >
                        {croppedUrls[idx] ? (
                          <div className="relative w-full h-full">
                            <img src={croppedUrls[idx]} className="w-full h-full object-cover" />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadCropped(idx);
                              }}
                              className="absolute bottom-1 right-1 px-2 py-1 rounded-full accent-focus-bg text-white text-[9px] font-black tracking-widest outline outline-[0.5px] outline-white/30 hover:opacity-90 transition-all cursor-pointer shadow-[0_8px_22px_-12px_rgba(0,0,0,0.55)]"
                              title={`下载 图${idx + 1}`}
                            >
                              下载
                            </button>
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[9px] text-slate-500 tracking-widest uppercase">
                            Waiting
                          </div>
                        )}
                      </button>
                      <textarea
                        value={shot.prompt}
                        onChange={(e) =>
                          setShotsPreview((prev) =>
                            prev.map((s, i) => (i === idx ? { ...s, prompt: e.target.value } : s)),
                          )
                        }
                        className="mt-2 w-full min-h-[96px] bg-surface-container-high/90 rounded-xl p-2.5 text-[11px] font-body text-white placeholder:text-white/40 focus:outline-none focus-visible:ring-2 accent-focus-ring transition-all resize-y custom-scrollbar outline outline-[0.5px] outline-white/[0.06]"
                        placeholder={`请输入格子 ${shot.n} 的提示词`}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="relative aspect-video rounded-[1.15rem] overflow-hidden bg-surface-container-highest/95 flex items-center justify-center shadow-[inset_0_0_100px_rgba(0,0,0,0.4)] outline outline-[0.5px] outline-white/[0.06]">
                {resultUrl ? (
                  <button
                    type="button"
                    onClick={() => setPreview({ type: 'result', url: resultUrl || '' })}
                    className="w-full h-full cursor-zoom-in group/vp"
                    title="点击放大"
                  >
                    <img
                      src={resultUrl}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover/vp:scale-[1.02]"
                    />
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-2 px-6 text-center">
                    <span className="font-headline text-base italic text-on-surface/35">等待分镜裂变</span>
                    <span className="text-[10px] font-label uppercase tracking-[0.22em] text-on-surface/28">
                      右侧生成提示词后，画布将裂变为 3×3
                    </span>
                  </div>
                )}

                {isRunning && (
                  <div className="absolute inset-0 bg-black/58 backdrop-blur-[18px] flex items-center justify-center">
                    <div className="w-[min(88%,260px)] rounded-2xl glass-panel ghost-border px-4 py-4 shadow-[0_40px_80px_-40px_rgba(0,0,0,0.85)]">
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-black tracking-[0.14em] uppercase chip-accent-focus">
                          {phase === 'text' ? '文本生成中...' : phase === 'image' ? '生图中...' : 'Generating'}
                        </span>
                        <span className="text-[11px] font-mono text-white tabular-nums">{Math.round(progress)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden bg-slate-900/80">
                        <motion.div
                          className="h-full bg-primary shadow-[0_0_14px_rgba(255,184,102,0.45)]"
                          initial={false}
                          animate={{ width: `${progress}%` }}
                          transition={{ type: 'spring', stiffness: 120, damping: 22 }}
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="mt-4 px-4 py-3 rounded-2xl bg-red-500/10 outline outline-[0.5px] outline-red-500/20 text-red-200 text-xs">
                {error}
              </div>
            )}

            {/* Crop pipeline now runs in background; no extra bottom panel shown */}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.1 }}
            className="flex flex-col gap-6"
          >
            <div className="bg-surface-container-low/90 backdrop-blur-sm rounded-[1.35rem] p-5 md:p-6 outline outline-[0.5px] outline-white/[0.06] shadow-[0_40px_72px_-52px_rgba(0,0,0,0.68)]">
              <div className="flex items-end gap-3 mb-3">
                <span className="text-[9px] font-label tracking-[0.22em] uppercase text-secondary/90 shrink-0">剧本母本</span>
                <span className="h-px flex-1 mb-1 bg-gradient-to-r from-secondary/25 to-transparent" />
              </div>
              <textarea
                value={story}
                onChange={(e) => setStory(e.target.value)}
                placeholder="粘贴长剧本、梗概或分场——模型会据此写出九格提示词。"
                className="w-full min-h-[168px] bg-surface-container-high/90 rounded-2xl p-4 text-[11px] font-body text-white placeholder:text-white/40 focus:outline-none focus-visible:ring-2 accent-focus-ring transition-all resize-none custom-scrollbar outline outline-[0.5px] outline-white/[0.07]"
              />
            </div>

            <div className="bg-surface-container-low/90 backdrop-blur-sm rounded-[1.35rem] p-5 md:p-6 outline outline-[0.5px] outline-white/[0.06] shadow-[0_40px_72px_-52px_rgba(0,0,0,0.68)]">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                <div className="flex items-end gap-3 flex-1 min-w-0">
                  <span className="text-[9px] font-label tracking-[0.22em] uppercase text-secondary/90 shrink-0">角色参考</span>
                  <span className="h-px flex-1 mb-1 bg-gradient-to-r from-secondary/22 to-transparent min-w-[2rem]" />
                </div>
                <button
                  data-ref-preview-ignore
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-panel ghost-border text-on-surface/80 hover:text-primary transition-colors cursor-pointer text-[10px] font-label font-semibold uppercase tracking-widest shrink-0"
                >
                  <Plus className="w-4 h-4" />
                  上传
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

              <p className="text-[10px] text-on-surface/42 mb-3 leading-relaxed">{hint}</p>

              <div
                className="rounded-2xl outline outline-dashed outline-[0.5px] outline-white/14 bg-surface-container-highest/22 min-h-[128px] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                {refs.length > 0 ? (
                  <Reorder.Group as="div" axis="x" values={refs} onReorder={setRefs} className="flex gap-2 overflow-x-auto custom-scrollbar">
                    {refs.map((r, idx) => (
                      <Reorder.Item
                        as="div"
                        key={r.id}
                        value={r}
                        whileDrag={{ scale: 1.04, zIndex: 20 }}
                        transition={{ layout: spring }}
                        className="relative shrink-0 h-24 min-w-[120px] max-w-[220px] rounded-xl overflow-hidden outline outline-[0.5px] outline-white/20 cursor-grab active:cursor-grabbing bg-transparent flex items-center justify-center px-1 cursor-zoom-in"
                        data-theme-preserve="dark"
                        {...refThumbHandlers(r.url)}
                      >
                        <img src={r.url} className="h-full w-auto max-w-[172px] object-contain pointer-events-none" draggable={false} />
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-black/80 text-white text-[9px] font-black tracking-widest outline outline-[0.5px] outline-white/20 pointer-events-none">
                          图{idx + 1}
                        </div>
                        <button
                          data-ref-preview-ignore
                          onClick={(e) => {
                            e.stopPropagation();
                            const id = r.id;
                            setRefs((prev) => prev.filter((x) => x.id !== id));
                          }}
                          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/80 text-white flex items-center justify-center outline outline-[0.5px] outline-white/20"
                          title="移除图片"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-1 left-1 right-1" data-ref-preview-ignore>
                          <input
                            value={r.name || ''}
                            onClick={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setRefs((prev) =>
                                prev.map((x) =>
                                  x.id === r.id ? { ...x, name: e.target.value.slice(0, 24) } : x,
                                ),
                              )
                            }
                            placeholder={`图${idx + 1} 名称`}
                            className="w-full h-6 px-2 rounded-md bg-black/70 text-white text-[9px] font-semibold outline outline-[0.5px] outline-white/25 placeholder:text-white/60 focus:outline-none focus:ring-1 accent-focus-ring"
                            title="给这张参考图命名（例如：小明）"
                          />
                        </div>
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
                ) : (
                  <div className="h-20 flex flex-col items-center justify-center gap-1 text-on-surface/35 text-[10px] font-label uppercase tracking-[0.2em]">
                    <span>拖放参考图至此处</span>
                    <span className="text-[9px] normal-case tracking-normal text-on-surface/28">可命名、排序，映射到「图1 / 图2…」</span>
                  </div>
                )}
              </div>

              <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={runPromptPhase}
                  disabled={!canBuildPrompts}
                  className={cn(
                    'w-full px-4 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.18em] transition-all cursor-pointer flex items-center justify-center gap-2 outline outline-[0.5px] outline-outline-variant/50 shadow-[0_24px_48px_-32px_rgba(0,0,0,0.55)]',
                    isRunning
                      ? phase === 'text'
                        ? 'accent-focus-bg text-white accent-focus-glow opacity-95'
                        : 'bg-surface-container-low text-slate-300 cursor-not-allowed'
                      : canBuildPrompts
                        ? 'accent-focus-bg text-white hover:opacity-90 accent-focus-glow'
                        : 'bg-surface-container-low text-slate-300 cursor-not-allowed',
                  )}
                >
                  {isRunning && phase === 'text' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  {isRunning && phase === 'text' ? '文本生成中...' : '生成提示词'}
                </button>
                <button
                  type="button"
                  onClick={startNewBatch}
                  disabled={isRunning}
                  className={cn(
                    'w-full px-4 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.18em] transition-all cursor-pointer flex items-center justify-center gap-2 glass-panel ghost-border',
                    isRunning
                      ? 'bg-surface-container-low text-slate-400 cursor-not-allowed'
                      : 'bg-surface-container-high text-slate-200 hover:text-primary hover:bg-white/5',
                  )}
                  title="清空当前编辑批次，开始新一批"
                >
                  换一批
                </button>
              </div>

              <button
                onClick={runImagePhase}
                disabled={!canGenerateImage}
                className={cn(
                  'mt-3 w-full px-4 py-3.5 rounded-2xl text-[11px] font-black uppercase tracking-[0.18em] transition-all cursor-pointer flex items-center justify-center gap-2 outline outline-[0.5px] outline-outline-variant/50 shadow-[0_28px_56px_-32px_rgba(255,184,102,0.18)]',
                  isRunning
                    ? phase === 'image'
                      ? 'accent-focus-bg text-white accent-focus-glow opacity-95'
                      : 'bg-surface-container-low text-slate-300 cursor-not-allowed'
                    : canGenerateImage
                      ? 'accent-focus-bg text-white hover:opacity-90 accent-focus-glow'
                      : 'bg-surface-container-low text-slate-300 cursor-not-allowed',
                )}
              >
                {isRunning && phase === 'image' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Grid3X3 className="w-4 h-4" />}
                {isRunning && phase === 'image' ? '生图中...' : '生成 9 宫格'}
              </button>

              <p className="mt-4 text-[10px] text-on-surface/38 leading-relaxed">
                两步走：先「生成提示词」逐格打磨，再「生成 9 宫格」出主图；系统会尝试自动裁切并填入各格。
              </p>

              {history.length > 0 && (
                <div className="mt-5 rounded-[1.15rem] bg-surface-container-high/55 backdrop-blur-sm p-4 outline outline-[0.5px] outline-white/[0.08]">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-[9px] font-label tracking-[0.2em] uppercase text-secondary/85">历史批次</div>
                    <div className="font-mono text-[9px] text-on-surface/35 tabular-nums">{history.length} 批</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 max-h-[260px] overflow-y-auto custom-scrollbar pr-1">
                    {history.map((h, i) => (
                      <motion.button
                        key={h.id}
                        type="button"
                        onClick={() => setPreview({ type: 'result', url: h.gridUrl })}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.99 }}
                        transition={spring}
                        className="relative rounded-xl overflow-hidden outline outline-[0.5px] outline-white/12 hover:outline-secondary/35 transition-shadow cursor-zoom-in shadow-[0_18px_36px_-24px_rgba(0,0,0,0.65)]"
                        title="点击放大查看"
                      >
                        <img src={h.gridUrl} className="w-full aspect-video object-cover" />
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-full bg-black/80 text-white text-[9px] font-black tracking-widest outline outline-[0.5px] outline-white/20">
                          #{history.length - i}
                        </div>
                      </motion.button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        </div>
      </motion.div>

      <ReferenceImageLightbox url={refThumbPreviewUrl} onClose={() => setRefThumbPreviewUrl(null)} zIndexClass="z-[98]" />

      {preview && (
        <motion.div
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={spring}
          className="fixed inset-0 z-[90]"
        >
          <button
            type="button"
            className="absolute inset-0 cursor-zoom-out bg-black/88 backdrop-blur-[26px]"
            onClick={() => setPreview(null)}
            aria-label="关闭预览"
          />
          <div className="pointer-events-none absolute inset-0 flex flex-col p-3 sm:p-4">
            <div className="pointer-events-auto absolute right-3 top-3 z-20 sm:right-4 sm:top-4">
              <button
                type="button"
                onClick={() => setPreview(null)}
                className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-high/55 text-white/90 outline outline-[0.5px] outline-outline-variant/20 backdrop-blur-[30px] transition-colors hover:text-white cursor-pointer"
                title="关闭 (Esc)"
                aria-label="关闭"
              >
                <X className="h-5 w-5" strokeWidth={1.75} />
              </button>
            </div>
            <div className="flex min-h-0 min-w-0 flex-1 flex-col pt-12">
              <motion.div
                initial={{ opacity: 0, y: 14, scale: 0.985 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={spring}
                className="pointer-events-auto relative min-h-0 min-w-0 flex-1"
              >
                <ZoomableLightboxImage
                  url={
                    preview.type === 'result' ? preview.url || resultUrl || '' : croppedUrls[preview.idx] || ''
                  }
                  resetKey={
                    preview.type === 'result'
                      ? `r:${preview.url || resultUrl || ''}`
                      : `c:${preview.idx}:${croppedUrls[preview.idx] || ''}`
                  }
                  className="h-full w-full"
                  imgClassName="rounded-2xl outline outline-[0.5px] outline-white/18 shadow-[0_48px_120px_-40px_rgba(0,0,0,0.88)]"
                />
                {preview.type === 'crop' && (
                  <button
                    type="button"
                    onClick={() => downloadCropped(preview.idx)}
                    className="absolute left-3 top-3 z-10 inline-flex items-center gap-2 rounded-full glass-panel ghost-border px-4 py-2.5 text-on-surface shadow-[0_24px_48px_-32px_rgba(0,0,0,0.85)] transition-colors cursor-pointer text-[10px] font-label font-bold uppercase tracking-widest hover:text-primary sm:left-4 sm:top-4"
                    title={`下载 图${preview.idx + 1}`}
                  >
                    <Download className="h-4 w-4" />
                    下载图{preview.idx + 1}
                  </button>
                )}
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

