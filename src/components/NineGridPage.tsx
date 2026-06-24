import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, Reorder } from 'motion/react';
import { Loader2, Plus, X, Grid3X3, Download, Scissors, Sparkles } from 'lucide-react';
import { cn, uniqueRefItemId } from '../lib/utils';
import { parseApiResponse } from '../lib/http';
import { useStore } from '../store/useStore';
import { useRefThumbPreview } from '../hooks/useRefThumbPreview';
import { ReferenceImageLightbox } from './ReferenceImageLightbox';
import { ZoomableLightboxImage } from './ZoomableLightboxImage';
import { StudioConvergePiece } from './motion/StudioConverge';
import {
  buildNineGridImagePrompt,
  estimateNineGridGap,
  NINE_GRID_SHOT_PROMPT_MIN_CHARS,
  nineGridFallbackSlicePosition,
  splitNineGridToNine,
} from '../lib/nineGrid/nineGridCore';

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
  onBack?: () => void;
  enterKey?: number;
};

type NineGridImageModel = 'nano-banana-pro-4k' | 'gpt-image-2';

export const NineGridPage: React.FC<Props> = ({ enterKey = 0 }) => {
  const addNotice = useStore((s) => s.addNotice);
  const fileRef = useRef<HTMLInputElement>(null);
  const [story, setStory] = useState('');
  const [refs, setRefs] = useState<RefItem[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'text' | 'image'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [shotsPreview, setShotsPreview] = useState<Array<{ n: number; prompt: string }>>([]);
  const [refLooks, setRefLooks] = useState<Array<Record<string, unknown>>>([]);
  const [cropPadding, setCropPadding] = useState(0);
  const [cropGap, setCropGap] = useState(0);
  const [isCropping, setIsCropping] = useState(false);
  const [croppedUrls, setCroppedUrls] = useState<string[]>([]);
  const [cropError, setCropError] = useState<string | null>(null);
  const [cellEditingSet, setCellEditingSet] = useState<Set<number>>(new Set());
  const [history, setHistory] = useState<GridHistoryItem[]>([]);
  const [preview, setPreview] = useState<{ type: 'result'; url?: string } | { type: 'crop'; idx: number } | null>(null);
  const [imageModel, setImageModel] = useState<NineGridImageModel>('nano-banana-pro-4k');

  const { previewUrl: refThumbPreviewUrl, setPreviewUrl: setRefThumbPreviewUrl, handlersFor: refThumbHandlers } =
    useRefThumbPreview();

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPreview(null);
        return;
      }
      if (preview.type !== 'crop' || croppedUrls.length === 0) return;
      const prevKeys = new Set(['ArrowLeft', 'ArrowUp']);
      const nextKeys = new Set(['ArrowRight', 'ArrowDown']);
      if (!prevKeys.has(e.key) && !nextKeys.has(e.key)) return;
      e.preventDefault();
      const delta = prevKeys.has(e.key) ? -1 : 1;
      const max = croppedUrls.length - 1;
      const next = Math.min(max, Math.max(0, preview.idx + delta));
      if (next !== preview.idx) {
        setPreview({ type: 'crop', idx: next });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, croppedUrls]);

  const canBuildPrompts = story.trim().length >= 10 && refs.length >= 1 && !isRunning;
  const canGenerateImage =
    refs.length >= 1 &&
    shotsPreview.length === 9 &&
    shotsPreview.every((s) => s.prompt.trim().length >= NINE_GRID_SHOT_PROMPT_MIN_CHARS) &&
    !isRunning;

  const getFallbackSlicePosition = nineGridFallbackSlicePosition;

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
          textModel: 'gemini-3.5-flash',
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
      setRefLooks(Array.isArray(textData.refLooks) ? textData.refLooks : []);
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

      const mergedPrompt = buildNineGridImagePrompt(
        shotsPreview,
        refs.map((r, idx) => ({
          url: r.url,
          name: (r.name || '').trim() || `角色${String(idx + 1).padStart(2, '0')}`,
        })),
        {
          refLooks,
          imageModel,
        },
      );

      const imageRes = await fetch('/api/generate-9grid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'image_only',
          imagePrompt: mergedPrompt,
          imageModel,
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
      addNotice('九宫格：主图生成成功（点击前往）', 'success', { type: 'open-nine-grid' });
      try {
        const autoCropped = await splitNineGridToNine(imageData.url, 0, 0);
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
        setCropError('自动裁切受跨域限制，已切换到预览切片模式（仍可放大查看主图）');
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

  const splitToNine = splitNineGridToNine;

  const estimateGapAndPadding = async () => {
    if (!resultUrl) return;
    setCropError(null);
    try {
      const gap = await estimateNineGridGap(resultUrl);
      setCropGap(gap);
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
    setCellEditingSet(new Set());
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
    const target = croppedUrls[idx] || resultUrl || '';
    const prompt = shotsPreview[idx]?.prompt?.trim() || '';
    if (!target || !prompt || cellEditingSet.has(idx)) return;

    try {
      setCellEditingSet((prev) => new Set(prev).add(idx));
      setError(null);
      const res = await fetch('/api/edit-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: croppedUrls[idx]
            ? prompt
            : `只编辑九宫格第${idx + 1}格对应内容，其余8格保持不变。${prompt}`,
          images: [target, ...refs.map((r) => r.url)],
          image_size: '2K',
          aspect_ratio: '16:9',
        }),
      });
      const data = await parseApiResponse(res);
      if (!res.ok) throw new Error(data.error || `单格编辑失败 (${res.status})`);
      if (!data?.url) throw new Error('单格编辑失败：未返回图片 URL');

      setCroppedUrls((prev) => prev.map((u, i) => (i === idx ? data.url : u)));
      addNotice(`九宫格：图${idx + 1}编辑完成（点击前往）`, 'success', { type: 'open-nine-grid' });
    } catch (e) {
      setError(e instanceof Error ? e.message : '单格编辑失败');
    } finally {
      setCellEditingSet((prev) => {
        const next = new Set(prev);
        next.delete(idx);
        return next;
      });
    }
  };

  return (
    <div
      className="h-[100dvh] overflow-y-auto lg:overflow-hidden relative ai-editor-page nine-grid-page studio-page-shell flex flex-col"
      data-ui-root
      data-cover-page
      data-studio-page
    >
      <div className="studio-page-bg pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="studio-page-scrim pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="studio-page-glow pointer-events-none fixed inset-0 z-0 cover-ambient" aria-hidden />

      <div className="studio-page-content ai-editor-layout relative z-10 flex flex-col flex-1 min-h-0 w-full mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pb-4 md:pb-5">
        <StudioConvergePiece origin="top" enterKey={enterKey} delay={0.03}>
        <header className="shrink-0 mb-4 lg:mb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
          <div>
            <h1 className="cover-tools-headline text-[1.75rem] sm:text-[2rem] lg:text-[2.15rem] tracking-[-0.035em] leading-[1.08]">
              九宫格
            </h1>
            <p className="cover-tools-subhead mt-1 text-[14px] sm:text-[15px] leading-snug">
              剧本裂变九格分镜，批量生图与单格精修。
            </p>
          </div>
          {resultUrl && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={cropToNine}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-black/50 backdrop-blur-md text-white text-[12px] font-medium outline outline-[0.5px] outline-white/15 hover:bg-black/60 transition-colors cursor-pointer"
                title="裁切成 9 张"
              >
                {isCropping ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Scissors className="w-3.5 h-3.5" />}
                裁切9张
              </button>
              <button
                onClick={download}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-white/90 text-[#1d1d1f] text-[12px] font-medium outline outline-[0.5px] outline-white/30 hover:bg-white transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                下载
              </button>
            </div>
          )}
        </header>
        </StudioConvergePiece>

        <div className="ai-editor-workspace flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[minmax(0,1.38fr)_minmax(340px,440px)] xl:grid-cols-[minmax(0,1.42fr)_minmax(380px,480px)] 2xl:grid-cols-[minmax(0,1.48fr)_minmax(400px,520px)] gap-4 lg:gap-5 xl:gap-6">
          <StudioConvergePiece
            origin="left"
            enterKey={enterKey}
            delay={0.07}
            className="relative rounded-[1.15rem] overflow-hidden ai-editor-canvas min-h-[220px] lg:min-h-0 h-full flex flex-col min-h-0"
          >
            {shotsPreview.length === 9 ? (
              <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-3 md:p-4">
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <p className="ai-editor-body line-clamp-2">
                    逐格润色提示词；成片后自动裁切回填，可单格精修或批量导出。
                  </p>
                  {croppedUrls.length === 9 && (
                    <button
                      type="button"
                      onClick={downloadAllCropped}
                      className="shrink-0 inline-flex items-center gap-1.5 px-4 py-2 rounded-full cover-hero-cta text-[12px] font-medium cursor-pointer"
                      title="下载全部切图"
                    >
                      <Download className="w-3.5 h-3.5" />
                      下载全部
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2 sm:gap-2.5">
                  {shotsPreview.map((shot, idx) => (
                    <motion.div
                      key={`${shot.n}_${idx}`}
                      layout
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ ...spring, delay: Math.min(idx * 0.035, 0.24) }}
                      whileHover={{ y: -2 }}
                      className="rounded-xl ai-editor-panel p-2 outline outline-[0.5px] outline-white/10"
                    >
                      <div className="mb-1 flex items-center justify-between gap-1">
                        <div className="cover-section-label mb-0 text-[12px]">格子 {shot.n}</div>
                        <button
                          type="button"
                          onClick={() => runCellEdit(idx)}
                          disabled={!(croppedUrls[idx] || resultUrl) || cellEditingSet.has(idx)}
                          className={cn(
                            'px-2 py-0.5 rounded-full text-[11px] font-medium transition-all',
                            cellEditingSet.has(idx)
                              ? 'ai-editor-btn-disabled'
                              : (croppedUrls[idx] || resultUrl)
                                ? 'bg-white/90 text-[#1d1d1f] hover:bg-white cursor-pointer'
                                : 'ai-editor-btn-disabled',
                          )}
                          title={croppedUrls[idx] ? '使用当前提示词编辑该格' : '自动裁切失败时，将基于主图对该格进行定向编辑'}
                        >
                          {cellEditingSet.has(idx) ? '编辑中' : '编辑'}
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
                            : 'outline-white/8 cursor-default bg-black/20',
                        )}
                        title={croppedUrls[idx] ? `查看图${idx + 1}` : '生图后自动回填到此格'}
                      >
                        {croppedUrls[idx] ? (
                          <div className="relative w-full h-full">
                            <img src={croppedUrls[idx]} className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                downloadCropped(idx);
                              }}
                              className="absolute bottom-1 right-1 px-2 py-0.5 rounded-full bg-white/90 text-[#1d1d1f] text-[10px] font-medium hover:bg-white transition-all cursor-pointer"
                              title={`下载 图${idx + 1}`}
                            >
                              下载
                            </button>
                          </div>
                        ) : resultUrl ? (
                          <div className="relative h-full w-full overflow-hidden">
                            <img
                              src={resultUrl}
                              referrerPolicy="no-referrer"
                              className="absolute h-[300%] w-[300%] max-w-none object-cover"
                              style={{
                                left: `-${getFallbackSlicePosition(idx).col * 100}%`,
                                top: `-${getFallbackSlicePosition(idx).row * 100}%`,
                              }}
                            />
                            <div className="absolute inset-0 bg-black/15" />
                            <div className="absolute bottom-1 right-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
                              预览
                            </div>
                          </div>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[12px] ai-editor-body">
                            等待生图
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
                        className="mt-1.5 w-full min-h-[72px] max-h-[88px] ai-editor-input rounded-lg p-2 text-[13px] leading-relaxed focus:outline-none focus-visible:ring-2 accent-focus-ring resize-y custom-scrollbar"
                        placeholder={`请输入格子 ${shot.n} 的提示词`}
                      />
                    </motion.div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="relative flex-1 min-h-[200px] flex items-center justify-center p-3 md:p-4">
                {resultUrl ? (
                  <button
                    type="button"
                    onClick={() => setPreview({ type: 'result', url: resultUrl || '' })}
                    className="w-full h-full cursor-zoom-in group/vp flex items-center justify-center"
                    title="点击放大"
                  >
                    <img
                      src={resultUrl}
                      className="max-w-full max-h-full object-contain transition-transform duration-500 group-hover/vp:scale-[1.02]"
                      referrerPolicy="no-referrer"
                    />
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-2 px-6 text-center">
                    <span className="cover-tools-subhead text-[15px]">等待分镜裂变</span>
                    <span className="ai-editor-body text-[13px]">
                      右侧生成提示词后，画布将裂变为 3×3
                    </span>
                  </div>
                )}

                {isRunning && (
                  <div className="absolute inset-0 bg-black/55 backdrop-blur-[2px] flex items-center justify-center">
                    <div className="w-[min(88%,260px)] rounded-xl ai-editor-panel px-4 py-4">
                      <div className="flex items-center justify-between mb-2.5">
                        <span className="cover-section-label mb-0">
                          {phase === 'text' ? '文本生成中' : phase === 'image' ? '生图中' : '处理中'}
                        </span>
                        <span className="ai-editor-stat text-[13px]">{Math.round(progress)}%</span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden bg-white/10">
                        <motion.div
                          className="h-full bg-white/85"
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
              <div className="shrink-0 mx-3 mb-3 px-3 py-2 rounded-xl bg-red-500/15 outline outline-[0.5px] outline-red-400/25 text-red-200 text-[13px] leading-snug">
                {error}
              </div>
            )}
            {cropError && (
              <div className="shrink-0 mx-3 mb-3 px-3 py-2 rounded-xl bg-amber-500/15 outline outline-[0.5px] outline-amber-400/25 text-amber-100 text-[13px] leading-snug">
                {cropError}
              </div>
            )}
          </StudioConvergePiece>

          <StudioConvergePiece
            origin="right"
            enterKey={enterKey}
            delay={0.11}
            className="ai-editor-sidebar min-h-0 h-full lg:max-h-none"
          >
            <div className="ai-editor-panel ai-editor-sidebar-panel rounded-[1.15rem] p-4 md:p-5 h-full min-h-0 flex flex-col gap-3 overflow-hidden">
              <div className="shrink-0">
                <div className="cover-section-label">剧本母本</div>
                <textarea
                  value={story}
                  onChange={(e) => setStory(e.target.value)}
                  placeholder="粘贴长剧本、梗概或分场——模型会据此写出九格提示词。"
                  className="mt-2 w-full min-h-[88px] max-h-[120px] ai-editor-input rounded-xl p-3 text-[14px] leading-relaxed focus:outline-none focus-visible:ring-2 accent-focus-ring resize-none custom-scrollbar"
                />
              </div>

              <div className="shrink-0 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="cover-section-label mb-0">角色参考</div>
                  <button
                    data-ref-preview-ignore
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full ai-editor-btn-secondary text-[12px] font-medium transition-colors cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
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

                <p className="ai-editor-body line-clamp-2">{hint}</p>

                <div
                  className="ai-editor-dropzone ai-editor-dropzone--compact"
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
                        className="relative shrink-0 h-[4.5rem] min-w-[108px] max-w-[180px] rounded-xl overflow-hidden ai-editor-ref-tile cursor-grab active:cursor-grabbing bg-transparent flex items-center justify-center px-1 cursor-zoom-in"
                        data-theme-preserve="dark"
                        {...refThumbHandlers(r.url)}
                      >
                        <img src={r.url} className="h-full w-auto max-w-[172px] object-contain pointer-events-none" draggable={false} />
                        <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-medium pointer-events-none">
                          图{idx + 1}
                        </div>
                        <button
                          data-ref-preview-ignore
                          onClick={(e) => {
                            e.stopPropagation();
                            const id = r.id;
                            setRefs((prev) => prev.filter((x) => x.id !== id));
                          }}
                          className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-black/70 text-white flex items-center justify-center"
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
                            className="w-full h-6 px-2 rounded-md bg-black/70 text-white text-[10px] font-medium placeholder:text-white/50 focus:outline-none focus:ring-1 accent-focus-ring"
                            title="给这张参考图命名（例如：小明）"
                          />
                        </div>
                      </Reorder.Item>
                    ))}
                  </Reorder.Group>
                ) : (
                  <div className="h-14 flex items-center justify-center ai-editor-body text-center px-3 text-[13px]">
                    拖放参考图至此处
                  </div>
                )}
                </div>
              </div>

              <div className="shrink-0 grid grid-cols-2 gap-2.5">
                <button
                  onClick={runPromptPhase}
                  disabled={!canBuildPrompts}
                  className={cn(
                    'w-full px-3 py-2.5 rounded-full text-[12px] font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5',
                    isRunning
                      ? phase === 'text'
                        ? 'cover-hero-cta opacity-95'
                        : 'ai-editor-btn-disabled'
                      : canBuildPrompts
                        ? 'cover-hero-cta'
                        : 'ai-editor-btn-disabled',
                  )}
                >
                  {isRunning && phase === 'text' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {isRunning && phase === 'text' ? '生成中...' : '生成提示词'}
                </button>
                <button
                  type="button"
                  onClick={startNewBatch}
                  disabled={isRunning}
                  className={cn(
                    'w-full px-3 py-2.5 rounded-full text-[12px] font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5 ai-editor-btn-secondary',
                    isRunning && 'opacity-50 cursor-not-allowed',
                  )}
                  title="清空当前编辑批次，开始新一批"
                >
                  换一批
                </button>
              </div>

              <div className="shrink-0 flex flex-col gap-2 sm:flex-row sm:items-center">
                <button
                  onClick={runImagePhase}
                  disabled={!canGenerateImage}
                  className={cn(
                    'w-full sm:flex-1 px-4 py-2.5 rounded-full text-[13px] font-medium transition-all cursor-pointer flex items-center justify-center gap-1.5',
                    isRunning
                      ? phase === 'image'
                        ? 'cover-hero-cta opacity-95'
                        : 'ai-editor-btn-disabled'
                      : canGenerateImage
                        ? 'cover-hero-cta'
                        : 'ai-editor-btn-disabled',
                  )}
                >
                  {isRunning && phase === 'image' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Grid3X3 className="w-3.5 h-3.5" />}
                  {isRunning && phase === 'image' ? '生图中...' : '生成 9 宫格'}
                </button>
                <select
                  value={imageModel}
                  onChange={(e) => setImageModel(e.target.value as NineGridImageModel)}
                  disabled={isRunning}
                  className={cn(
                    'ai-editor-select min-w-[12rem] text-[13px] rounded-full px-4 py-2 focus:outline-none focus-visible:ring-2 accent-focus-ring cursor-pointer',
                    isRunning ? 'opacity-65 cursor-not-allowed' : '',
                  )}
                  title={imageModel === 'gpt-image-2' ? 'gpt-image-2 固定 size=3840x2160' : 'nano 模型走 IMAGE_GRID_* 配置'}
                >
                  <option value="nano-banana-pro-4k">nano-banana-pro-4k（默认）</option>
                  <option value="gpt-image-2">gpt-image-2（3840×2160）</option>
                </select>
              </div>

              <p className="shrink-0 ai-editor-body text-[12px] line-clamp-2">
                先生成提示词逐格打磨，再生成 9 宫格主图；系统会尝试自动裁切并填入各格。
              </p>

              {history.length > 0 && (
                <div className="ai-editor-history-section shrink-0 min-h-0 flex flex-col pt-3 mt-auto">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="cover-section-label mb-0">历史批次</div>
                    <span className="ai-editor-stat text-[13px]">{history.length} 批</span>
                  </div>
                  <div className="ai-editor-timeline-rail ai-editor-timeline-rail--compact custom-scrollbar">
                    {history.map((h, i) => (
                      <motion.button
                        key={h.id}
                        type="button"
                        onClick={() => setPreview({ type: 'result', url: h.gridUrl })}
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.99 }}
                        transition={spring}
                        className="ai-editor-history-chip ai-editor-history-chip--compact cursor-zoom-in"
                        title="点击放大查看"
                      >
                        <img
                          src={h.gridUrl}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                          onError={(e) => {
                            (e.currentTarget as HTMLImageElement).style.opacity = '0.08';
                          }}
                        />
                        <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded-md bg-black/70 text-white text-[10px] font-medium">
                          {history.length - i}
                        </span>
                      </motion.button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </StudioConvergePiece>
        </div>
      </div>

      <ReferenceImageLightbox url={refThumbPreviewUrl} onClose={() => setRefThumbPreviewUrl(null)} zIndexClass="z-[98]" />

      {preview && (
        <motion.div
          role="presentation"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={spring}
          className="fixed inset-0 z-[90]"
          data-theme-preserve="dark"
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
                className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white/90 outline outline-[0.5px] outline-white/15 backdrop-blur-[30px] transition-colors hover:bg-white/16 hover:text-white cursor-pointer"
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
                    className="absolute left-3 top-3 z-10 inline-flex items-center gap-2 rounded-full bg-white/10 backdrop-blur-md px-4 py-2.5 text-white text-[13px] font-medium outline outline-[0.5px] outline-white/15 hover:bg-white/16 transition-colors cursor-pointer sm:left-4 sm:top-4"
                    title={`下载 图${preview.idx + 1}`}
                  >
                    <Download className="h-4 w-4" />
                    下载图{preview.idx + 1}
                  </button>
                )}
              </motion.div>
              <p className="pointer-events-none shrink-0 pt-2 text-center text-[12px] text-white/55">
                滚轮缩放 · 中键拖拽 · 方向键切图 · 点空白或 ✕ 关闭
              </p>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
};

