import { useCallback, useMemo, useRef } from 'react';
import { cn } from '../../lib/utils';
import {
  applyKeyframeEase,
  DEFAULT_BEZIER,
  type KeyframeEase,
} from '../../lib/director/keyframeEasing';

type Props = {
  ease: KeyframeEase;
  bezier?: [number, number, number, number];
  disabled?: boolean;
  onChange: (bezier: [number, number, number, number]) => void;
};

const W = 160;
const H = 100;
const PAD = 10;

function toSvg(x: number, y: number) {
  return {
    cx: PAD + x * (W - PAD * 2),
    cy: PAD + (1 - y) * (H - PAD * 2),
  };
}

function fromSvg(cx: number, cy: number) {
  return {
    x: Math.min(1, Math.max(0, (cx - PAD) / (W - PAD * 2))),
    y: Math.min(1, Math.max(0, 1 - (cy - PAD) / (H - PAD * 2))),
  };
}

/** 轻量贝塞尔曲线预览 + 双控制点拖拽（借鉴 dollycurve Graph，不整库） */
export function DirectorBezierEditor({ ease, bezier, disabled, onChange }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const bz = bezier ?? DEFAULT_BEZIER;

  const pathD = useMemo(() => {
    const samples: string[] = [];
    for (let i = 0; i <= 24; i++) {
      const t = i / 24;
      const y = applyKeyframeEase(t, ease === 'bezier' ? 'bezier' : ease, bz);
      const { cx, cy } = toSvg(t, y);
      samples.push(`${i === 0 ? 'M' : 'L'}${cx.toFixed(1)},${cy.toFixed(1)}`);
    }
    return samples.join(' ');
  }, [ease, bz]);

  const p1 = toSvg(bz[0], bz[1]);
  const p2 = toSvg(bz[2], bz[3]);
  const p0 = toSvg(0, 0);
  const p3 = toSvg(1, 1);

  const dragHandle = useCallback(
    (which: 0 | 1, clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg || disabled || ease !== 'bezier') return;
      const rect = svg.getBoundingClientRect();
      const sx = ((clientX - rect.left) / rect.width) * W;
      const sy = ((clientY - rect.top) / rect.height) * H;
      const { x, y } = fromSvg(sx, sy);
      if (which === 0) onChange([x, y, bz[2], bz[3]]);
      else onChange([bz[0], bz[1], x, y]);
    },
    [bz, disabled, ease, onChange],
  );

  const startDrag = (which: 0 | 1) => (e: React.PointerEvent) => {
    if (disabled || ease !== 'bezier') return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => dragHandle(which, ev.clientX, ev.clientY);
    const up = () => {
      target.releasePointerCapture(e.pointerId);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="rounded-lg bg-white/[0.04] p-2 outline outline-[0.5px] outline-white/10">
      <p className="cover-section-label mb-1.5 text-[10px]">
        {ease === 'bezier' ? '贝塞尔手柄（拖圆点）' : '缓动曲线预览'}
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={cn('w-full h-[100px] rounded-md bg-black/30', ease === 'bezier' && !disabled && 'cursor-crosshair')}
        aria-label="关键帧缓动曲线"
      >
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        {ease === 'bezier' && (
          <>
            <line x1={p0.cx} y1={p0.cy} x2={p1.cx} y2={p1.cy} stroke="rgba(255,184,102,0.45)" strokeWidth={1} />
            <line x1={p3.cx} y1={p3.cy} x2={p2.cx} y2={p2.cy} stroke="rgba(255,184,102,0.45)" strokeWidth={1} />
          </>
        )}
        <path d={pathD} fill="none" stroke="#ffb866" strokeWidth={1.75} />
        {ease === 'bezier' && (
          <>
            <circle
              cx={p1.cx}
              cy={p1.cy}
              r={5}
              fill="#ffb866"
              className={cn(!disabled && 'cursor-grab active:cursor-grabbing')}
              onPointerDown={startDrag(0)}
            />
            <circle
              cx={p2.cx}
              cy={p2.cy}
              r={5}
              fill="#e5e2e1"
              className={cn(!disabled && 'cursor-grab active:cursor-grabbing')}
              onPointerDown={startDrag(1)}
            />
          </>
        )}
      </svg>
    </div>
  );
}
