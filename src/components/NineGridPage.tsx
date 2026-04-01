import React, { useMemo, useRef, useState } from 'react';
import { motion, Reorder } from 'motion/react';
import { Loader2, Plus, X, Grid3X3, Download, Home, Scissors, Sparkles } from 'lucide-react';
import { cn } from '../lib/utils';
import { parseApiResponse } from '../lib/http';

type RefItem = { id: string; url: string; name?: string };
type GridHistoryItem = {
  id: string;
  createdAt: number;
  gridUrl: string;
  shots: string[];
};

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

function uid(prefix = 'ref') {
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
          id: uid(),
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
            id: uid('hist'),
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
            id: uid('hist'),
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
          target_image: target,
          references: refs.map((r) => ({ url: r.url })),
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
    <div className="min-h-screen bg-surface text-slate-100 font-sans overflow-hidden" data-ui-root>
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="flex items-center justify-between mb-5">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-primary transition-colors cursor-pointer text-[10px] font-label tracking-widest uppercase"
          >
            <Home className="w-4 h-4" />
            返回起始页
          </button>
          <div className="flex items-center gap-2 text-[10px] font-label tracking-[0.18em] uppercase accent-info">
            <Grid3X3 className="w-4 h-4 accent-focus" />
            9_GRID
          </div>
        </div>

        <div className="grid grid-cols-12 gap-6">
          <div className="col-span-7 bg-surface-container-low rounded-[1.25rem] p-4 outline outline-[0.5px] outline-white/5 shadow-[0_45px_80px_-42px_rgba(0,0,0,0.58)]">
            <div className="flex items-center justify-between mb-3">
              <div className="text-[9px] font-label tracking-[0.2em] uppercase text-slate-400">Result</div>
              {resultUrl && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={cropToNine}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 hover:text-primary transition-colors outline outline-[0.5px] outline-white/10 cursor-pointer text-[10px] font-semibold"
                    title="裁切成 9 张"
                  >
                    {isCropping ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scissors className="w-4 h-4" />}
                    裁切9张
                  </button>
                  <button
                    onClick={download}
                    className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 hover:text-primary transition-colors outline outline-[0.5px] outline-white/10 cursor-pointer text-[10px] font-semibold"
                  >
                    <Download className="w-4 h-4" />
                    下载
                  </button>
                </div>
              )}
            </div>

            {shotsPreview.length === 9 ? (
              <div className="rounded-2xl bg-surface-container-high/70 p-3 outline outline-[0.5px] outline-white/10">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-slate-400">
                  已进入 9 格编辑台：每格下方可单独改提示词；生图后自动裁切并回填到对应格子。
                  </span>
                  {croppedUrls.length === 9 && (
                    <button
                      type="button"
                      onClick={downloadAllCropped}
                      className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-200 hover:text-primary transition-colors outline outline-[0.5px] outline-white/12 cursor-pointer text-[10px] font-semibold"
                      title="下载全部切图"
                    >
                      <Download className="w-4 h-4" />
                      下载全部
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-3">
                  {shotsPreview.map((shot, idx) => (
                    <motion.div
                      key={`${shot.n}_${idx}`}
                      layout
                      transition={spring}
                      className="rounded-xl bg-surface-container-low p-2 outline outline-[0.5px] outline-white/10 shadow-[0_18px_34px_-22px_rgba(0,0,0,0.6)]"
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
                        className="mt-2 w-full min-h-[96px] bg-surface-container-high rounded-lg p-2 text-[11px] font-body text-white placeholder:text-white/40 focus:outline-none focus:ring-1 accent-focus-ring transition-all resize-y custom-scrollbar"
                        placeholder={`请输入格子 ${shot.n} 的提示词`}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="relative aspect-video rounded-2xl overflow-hidden bg-surface-container-highest flex items-center justify-center">
                {resultUrl ? (
                  <button
                    type="button"
                    onClick={() => setPreview({ type: 'result', url: resultUrl || '' })}
                    className="w-full h-full cursor-zoom-in"
                    title="点击放大"
                  >
                    <img src={resultUrl} className="w-full h-full object-cover" />
                  </button>
                ) : (
                  <div className="text-slate-400 text-[10px] uppercase tracking-[0.3em] font-bold">
                    点击“生成提示词”后，左侧会分裂成 9 个格子
                  </div>
                )}

                {isRunning && (
                  <div className="absolute inset-0 bg-black/55 backdrop-blur-sm flex items-center justify-center">
                    <div className="w-[240px]">
                      <div className="flex items-center justify-between mb-2">
                        <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-black tracking-[0.14em] uppercase chip-accent-focus">
                          {phase === 'text' ? '文本生成中...' : phase === 'image' ? '生图中...' : 'Generating'}
                        </span>
                        <span className="text-[11px] font-mono text-white">{Math.round(progress)}%</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden bg-slate-800/80">
                        <div className="h-full bg-primary transition-all duration-200" style={{ width: `${progress}%` }} />
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
          </div>

          <div className="col-span-5 flex flex-col gap-4">
            <div className="bg-surface-container-low rounded-[1.25rem] p-4 outline outline-[0.5px] outline-white/5">
              <div className="text-[9px] font-label tracking-[0.2em] uppercase accent-info mb-2">Story</div>
              <textarea
                value={story}
                onChange={(e) => setStory(e.target.value)}
                placeholder="粘贴你的剧本故事（支持长文本）。"
                className="w-full min-h-[160px] bg-surface-container-high rounded-2xl p-4 text-[11px] font-body text-white placeholder:text-white/40 focus:outline-none focus:ring-1 accent-focus-ring transition-all resize-none custom-scrollbar"
              />
            </div>

            <div className="bg-surface-container-low rounded-[1.25rem] p-4 outline outline-[0.5px] outline-white/5">
              <div className="flex items-center justify-between mb-2">
                <div className="text-[9px] font-label tracking-[0.2em] uppercase accent-info">References</div>
                <button
                  onClick={() => fileRef.current?.click()}
                  className="inline-flex items-center gap-2 px-3 py-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-300 hover:text-primary transition-colors outline outline-[0.5px] outline-white/10 cursor-pointer text-[10px] font-semibold"
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

              <div className="text-[10px] text-slate-400 mb-3">{hint}</div>

              <div
                className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] min-h-[120px] p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                {refs.length > 0 ? (
                  <Reorder.Group axis="x" values={refs} onReorder={setRefs} className="flex gap-2 overflow-x-auto custom-scrollbar">
                    {refs.map((r, idx) => (
                      <Reorder.Item
                        key={r.id}
                        value={r}
                        whileDrag={{ scale: 1.04, zIndex: 20 }}
                        transition={{ layout: spring }}
                        className="relative shrink-0 h-24 min-w-[120px] max-w-[220px] rounded-xl overflow-hidden outline outline-[0.5px] outline-white/20 cursor-grab active:cursor-grabbing bg-transparent flex items-center justify-center px-1"
                        data-theme-preserve="dark"
                      >
                        <img src={r.url} className="h-full w-auto max-w-[172px] object-contain" draggable={false} />
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-black/80 text-white text-[9px] font-black tracking-widest outline outline-[0.5px] outline-white/20">
                          图{idx + 1}
                        </div>
                        <button
                          onClick={() => setRefs((prev) => prev.filter((x) => x.id !== r.id))}
                          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/80 text-white flex items-center justify-center outline outline-[0.5px] outline-white/20"
                          title="移除图片"
                        >
                          <X className="w-3 h-3" />
                        </button>
                        <div className="absolute bottom-1 left-1 right-1">
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
                  <div className="h-20 flex items-center justify-center text-slate-400 text-[10px] uppercase tracking-widest">
                    拖拽上传参考图到这个框
                  </div>
                )}
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={runPromptPhase}
                  disabled={!canBuildPrompts}
                  className={cn(
                    'w-full px-4 py-3 rounded-2xl text-[11px] font-black uppercase tracking-[0.18em] transition-all cursor-pointer flex items-center justify-center gap-2 outline outline-[0.5px] outline-outline-variant/60',
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
                    'w-full px-4 py-3 rounded-2xl text-[11px] font-black uppercase tracking-[0.18em] transition-all cursor-pointer flex items-center justify-center gap-2 outline outline-[0.5px] outline-white/15',
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
                  'mt-2 w-full px-4 py-3 rounded-2xl text-[11px] font-black uppercase tracking-[0.18em] transition-all cursor-pointer flex items-center justify-center gap-2 outline outline-[0.5px] outline-outline-variant/60',
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

              <div className="mt-3 text-[10px] text-slate-400 leading-relaxed">
                两步工作流：先生成 9 格提示词并逐条修改，再合并生图；出图后自动裁切并回填到对应格子。
              </div>

              {history.length > 0 && (
                <div className="mt-4 rounded-2xl bg-surface-container-high p-3 outline outline-[0.5px] outline-white/10">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-[9px] font-label tracking-[0.18em] uppercase accent-info">9Grid History</div>
                    <div className="text-[9px] text-slate-500">{history.length} 批</div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 max-h-[260px] overflow-y-auto custom-scrollbar pr-1">
                    {history.map((h, i) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => setPreview({ type: 'result', url: h.gridUrl })}
                        className="relative rounded-xl overflow-hidden outline outline-[0.5px] outline-white/10 hover:outline-white/30 transition-all cursor-zoom-in"
                        title="点击放大查看"
                      >
                        <img src={h.gridUrl} className="w-full aspect-video object-cover" />
                        <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded-full bg-black/80 text-white text-[9px] font-black tracking-widest outline outline-[0.5px] outline-white/20">
                          #{history.length - i}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {preview && (
        <button
          type="button"
          onClick={() => setPreview(null)}
          className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-sm p-6 flex items-center justify-center cursor-zoom-out"
          title="点击返回"
        >
          <div className="relative max-w-[96vw] max-h-[92vh]">
            <img
              src={preview.type === 'result' ? preview.url || resultUrl || '' : croppedUrls[preview.idx] || ''}
              className="max-w-[96vw] max-h-[92vh] object-contain rounded-2xl outline outline-[0.5px] outline-white/20 shadow-[0_40px_100px_-40px_rgba(0,0,0,0.8)]"
            />
            {preview.type === 'crop' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadCropped(preview.idx);
                }}
                className="absolute top-3 right-3 inline-flex items-center gap-2 px-3 py-2 rounded-full bg-black/70 hover:bg-black/85 text-white hover:text-primary transition-colors outline outline-[0.5px] outline-white/25 cursor-pointer text-[10px] font-semibold"
                title={`下载 图${preview.idx + 1}`}
              >
                <Download className="w-4 h-4" />
                下载图{preview.idx + 1}
              </button>
            )}
          </div>
        </button>
      )}
    </div>
  );
};

