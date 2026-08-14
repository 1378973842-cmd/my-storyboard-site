import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Check, Pencil, Square, Undo2, X } from 'lucide-react';
import { cn } from '../lib/utils';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };
const COLORS = ['#ff5a6a', '#ffb866', '#e5e2e1'] as const;
const SIZE_MIN = 1;
const SIZE_MAX = 80;
const SIZE_DEFAULT = 48;

/** 与画布图片编辑同一套对数滑条：左半段留给细线 */
function sliderToWidth(raw: number, canvas: HTMLCanvasElement): number {
  const t = Math.max(0, Math.min(1, (Number(raw) - SIZE_MIN) / (SIZE_MAX - SIZE_MIN)));
  const visual = SIZE_MIN * (SIZE_MAX / SIZE_MIN) ** t;
  const displayW = canvas.getBoundingClientRect().width || 0;
  if (displayW < 2 || canvas.width < 2) return Math.max(1, visual);
  return Math.max(0.5, visual * (canvas.width / displayW));
}
type Tool = 'brush' | 'arrow' | 'rect';
type Pt = [number, number];
type Stroke =
  | { t: 'brush'; color: string; w: number; pts: Pt[] }
  | { t: 'arrow' | 'rect'; color: string; w: number; a: Pt; b: Pt };

type Props = {
  src: string | null;
  onCancel: () => void;
  onDone: (blob: Blob) => void;
};

function pos(canvas: HTMLCanvasElement, e: PointerEvent | React.PointerEvent): Pt {
  const r = canvas.getBoundingClientRect();
  return [
    ((e.clientX - r.left) * canvas.width) / Math.max(1, r.width),
    ((e.clientY - r.top) * canvas.height) / Math.max(1, r.height),
  ];
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.w;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.t === 'brush') {
    if (s.pts.length < 2) {
      const [x, y] = s.pts[0] || [0, 0];
      ctx.beginPath();
      ctx.arc(x, y, s.w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.beginPath();
    ctx.moveTo(s.pts[0][0], s.pts[0][1]);
    s.pts.forEach((p) => ctx.lineTo(p[0], p[1]));
    ctx.stroke();
    return;
  }
  if (s.t === 'rect') {
    ctx.strokeRect(s.a[0], s.a[1], s.b[0] - s.a[0], s.b[1] - s.a[1]);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(s.a[0], s.a[1]);
  ctx.lineTo(s.b[0], s.b[1]);
  ctx.stroke();
  const ang = Math.atan2(s.b[1] - s.a[1], s.b[0] - s.a[0]);
  const len = 10 + s.w * 1.6;
  ctx.beginPath();
  ctx.moveTo(s.b[0], s.b[1]);
  ctx.lineTo(s.b[0] - len * Math.cos(ang - 0.42), s.b[1] - len * Math.sin(ang - 0.42));
  ctx.moveTo(s.b[0], s.b[1]);
  ctx.lineTo(s.b[0] - len * Math.cos(ang + 0.42), s.b[1] - len * Math.sin(ang + 0.42));
  ctx.stroke();
}

export function VoiceMarkupEditor({ src, onCancel, onDone }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const draftRef = useRef<Stroke | null>(null);
  const strokesRef = useRef<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>('arrow');
  const [color, setColor] = useState<string>(COLORS[0]);
  const [size, setSize] = useState(SIZE_DEFAULT);
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const [busy, setBusy] = useState(false);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    strokesRef.current.forEach((s) => drawStroke(ctx, s));
    if (draftRef.current) drawStroke(ctx, draftRef.current);
  }, []);

  useEffect(() => {
    if (!src) return;
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const maxW = Math.min(1100, img.naturalWidth || 800);
      const scale = maxW / Math.max(1, img.naturalWidth);
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
      strokesRef.current = [];
      draftRef.current = null;
      paint();
    };
    img.src = src;
  }, [paint, src]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(canvas, e);
    const w = sliderToWidth(sizeRef.current, canvas);
    draftRef.current =
      tool === 'brush'
        ? { t: 'brush', color, w, pts: [p] }
        : { t: tool, color, w, a: p, b: p };
    paint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    const draft = draftRef.current;
    if (!canvas || !draft) return;
    const p = pos(canvas, e);
    if (draft.t === 'brush') draft.pts.push(p);
    else draft.b = p;
    paint();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (canvas) canvas.releasePointerCapture(e.pointerId);
    if (draftRef.current) strokesRef.current = [...strokesRef.current, draftRef.current];
    draftRef.current = null;
    paint();
  };

  const exportPng = async () => {
    const canvas = canvasRef.current;
    if (!canvas || busy) return;
    setBusy(true);
    try {
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('导出失败'))), 'image/png');
      });
      onDone(blob);
    } catch {
      /* keep editor open */
    } finally {
      setBusy(false);
    }
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {src ? (
        <div className="fixed inset-0 z-[250] flex items-center justify-center p-3 sm:p-5">
          <motion.button
            type="button"
            aria-label="关闭标注"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-[3px]"
            onClick={onCancel}
          />
          <motion.div
            role="dialog"
            aria-label="标注截图"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={spring}
            className="relative z-10 flex max-h-[min(860px,92dvh)] w-full max-w-[1080px] flex-col overflow-hidden rounded-[22px] bg-[#141414] shadow-[0_40px_96px_-40px_rgba(0,0,0,0.8)]"
            style={{ outline: '0.5px solid rgba(255,255,255,0.1)', outlineOffset: '-0.5px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex shrink-0 flex-wrap items-center gap-2 px-4 py-3 md:px-5">
              <p className="mr-auto text-[14px] font-medium text-[#e5e2e1]">标注截图</p>
              {(
                [
                  ['brush', Pencil, '画笔'],
                  ['arrow', ArrowUpRight, '箭头'],
                  ['rect', Square, '框选'],
                ] as const
              ).map(([id, Icon, label]) => (
                <button
                  key={id}
                  type="button"
                  title={label}
                  onClick={() => setTool(id)}
                  className={cn(
                    'inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px]',
                    tool === id ? 'bg-[#ffb866]/16 text-[#ffb866]' : 'bg-[#242424] text-[#e5e2e1]/70 hover:text-[#e5e2e1]',
                  )}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
                  {label}
                </button>
              ))}
              <div className="mx-1 flex items-center gap-1.5">
                {COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-label={c}
                    onClick={() => setColor(c)}
                    className="h-6 w-6 rounded-full"
                    style={{
                      background: c,
                      boxShadow:
                        color === c
                          ? '0 0 0 2px #141414, 0 0 0 4px rgba(255,184,102,0.9)'
                          : '0 0 0 0.5px rgba(255,255,255,0.2)',
                    }}
                  />
                ))}
              </div>
              <label className="inline-flex w-[132px] items-center" title="粗细">
                <input
                  type="range"
                  min={SIZE_MIN}
                  max={SIZE_MAX}
                  step={1}
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                  className="w-full accent-[#e5e2e1]"
                  aria-label="粗细"
                />
              </label>
              <button
                type="button"
                title="撤销"
                onClick={() => {
                  strokesRef.current = strokesRef.current.slice(0, -1);
                  paint();
                }}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#242424] text-[#e5e2e1]/70 hover:text-[#e5e2e1]"
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#242424] text-[#e5e2e1]"
                aria-label="取消"
              >
                <X className="h-4 w-4" />
              </button>
            </header>
            <div className="shell-slim-scrollbar min-h-0 flex-1 overflow-auto bg-[#0e0e0e] px-4 py-3">
              <canvas
                ref={canvasRef}
                className="mx-auto block max-h-[min(68vh,640px)] max-w-full cursor-crosshair touch-none rounded-xl"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              />
            </div>
            <footer className="flex shrink-0 justify-end gap-2 px-4 py-3 md:px-5">
              <button
                type="button"
                onClick={onCancel}
                className="h-10 rounded-full bg-[#242424] px-4 text-[13px] text-[#e5e2e1]"
              >
                不标注，原图使用
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void exportPng()}
                className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#e5e2e1] px-5 text-[13.5px] font-medium text-[#141414] hover:bg-white disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                完成标注
              </button>
            </footer>
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
