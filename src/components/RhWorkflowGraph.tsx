import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Maximize2, ZoomIn, ZoomOut } from 'lucide-react';
import { cn } from '../lib/utils';
import { computeWorkflowGraphLayout, RH_NODE_CATEGORY_COLORS, type RhField } from '../lib/runningHubAdmin';

type Transform = { x: number; y: number; k: number };

/**
 * RunningHub 工作流 DAG 节点图：拓扑分层自动布局 + SVG 贝塞尔连线 + 滚轮缩放/拖拽平移/适应窗口。
 * 逻辑对齐旧版 canvas_source/static/js/api-settings.js 的 rhWorkflowEditor 图形部分。
 */
export function RhWorkflowGraph({
  workflowJson,
  fields,
  activeNodeId,
  onNodeClick,
}: {
  workflowJson: Record<string, unknown>;
  fields: RhField[];
  activeNodeId?: string | null;
  onNodeClick?: (nodeId: string) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<SVGGElement | null>(null);
  const transformRef = useRef<Transform>({ x: 0, y: 0, k: 1 });
  const panRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);
  const [zoomPercent, setZoomPercent] = useState(100);

  const layout = useMemo(() => computeWorkflowGraphLayout(workflowJson, fields), [workflowJson, fields]);

  const applyTransform = useCallback(() => {
    const t = transformRef.current;
    if (viewportRef.current) viewportRef.current.setAttribute('transform', `translate(${t.x},${t.y}) scale(${t.k})`);
    setZoomPercent(Math.round(t.k * 100));
  }, []);

  const fitToWindow = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap || !layout.width || !layout.height) return;
    const pad = 24;
    const k = Math.max(
      0.2,
      Math.min(2, Math.min((wrap.clientWidth - pad * 2) / layout.width, (wrap.clientHeight - pad * 2) / layout.height))
    );
    transformRef.current = {
      k,
      x: (wrap.clientWidth - layout.width * k) / 2,
      y: (wrap.clientHeight - layout.height * k) / 2,
    };
    applyTransform();
  }, [layout, applyTransform]);

  useEffect(() => {
    const id = window.setTimeout(fitToWindow, 30);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  const zoomBy = useCallback(
    (factor: number, center?: { x: number; y: number }) => {
      const wrap = wrapRef.current;
      if (!wrap) return;
      const t = transformRef.current;
      const newK = Math.max(0.2, Math.min(3, t.k * factor));
      const cx = center?.x ?? wrap.clientWidth / 2;
      const cy = center?.y ?? wrap.clientHeight / 2;
      transformRef.current = {
        k: newK,
        x: cx - (cx - t.x) * (newK / t.k),
        y: cy - (cy - t.y) * (newK / t.k),
      };
      applyTransform();
    },
    [applyTransform]
  );

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = wrap.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? 1.15 : 1 / 1.15, { x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    const handleMouseDown = (event: MouseEvent) => {
      event.preventDefault();
      panRef.current = { sx: event.clientX, sy: event.clientY, ox: transformRef.current.x, oy: transformRef.current.y };
      wrap.classList.add('is-panning');
    };
    const handleMouseMove = (event: MouseEvent) => {
      const pan = panRef.current;
      if (!pan) return;
      transformRef.current = { ...transformRef.current, x: pan.ox + event.clientX - pan.sx, y: pan.oy + event.clientY - pan.sy };
      applyTransform();
    };
    const handleMouseUp = () => {
      if (panRef.current) {
        panRef.current = null;
        wrap.classList.remove('is-panning');
      }
    };
    wrap.addEventListener('wheel', handleWheel, { passive: false });
    wrap.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      wrap.removeEventListener('wheel', handleWheel);
      wrap.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [zoomBy, applyTransform]);

  if (!layout.nodes.length) {
    return (
      <div className="flex h-full items-center justify-center rounded-2xl bg-[#131313]/60 text-sm text-[#e5e2e1]/40">
        暂无工作流预览
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative h-full min-h-[320px] cursor-grab overflow-hidden rounded-2xl bg-[#131313]/60 [&.is-panning]:cursor-grabbing">
      <svg className="h-full w-full select-none" viewBox={`0 0 ${wrapRef.current?.clientWidth || 800} ${wrapRef.current?.clientHeight || 480}`}>
        <g ref={viewportRef}>
          {layout.edges.map((edge, i) => {
            const cx = (edge.x1 + edge.x2) / 2;
            return (
              <path
                key={`${edge.from}-${edge.to}-${i}`}
                d={`M ${edge.x1} ${edge.y1} C ${cx} ${edge.y1}, ${cx} ${edge.y2}, ${edge.x2} ${edge.y2}`}
                stroke="#e5e2e1"
                strokeOpacity={0.22}
                strokeWidth={1.5}
                fill="none"
              />
            );
          })}
          {layout.nodes.map((node) => {
            const colors = RH_NODE_CATEGORY_COLORS[node.category];
            const isActive = String(node.id) === String(activeNodeId || '');
            return (
              <g
                key={node.id}
                transform={`translate(${node.x},${node.y})`}
                className="cursor-pointer"
                onClick={() => onNodeClick?.(node.id)}
              >
                <rect
                  width={layout.nodeW}
                  height={layout.nodeH}
                  rx={10}
                  fill={colors.fill}
                  style={
                    isActive
                      ? { filter: 'drop-shadow(0 0 0 1.5px #ffb866) drop-shadow(0 6px 16px rgba(255,184,102,0.25))' }
                      : node.exposedCount > 0
                        ? { filter: `drop-shadow(0 0 0 1px ${colors.accent}aa)` }
                        : undefined
                  }
                />
                <text x={10} y={20} fontSize={11} fontWeight={600} fill="#e5e2e1">
                  {node.title.length > 15 ? `${node.title.slice(0, 15)}…` : node.title}
                </text>
                <text x={10} y={36} fontSize={9.5} fill="#e5e2e1" fillOpacity={0.5}>
                  {node.klass.length > 18 ? `${node.klass.slice(0, 18)}…` : node.klass}
                </text>
                <text x={layout.nodeW - 8} y={20} fontSize={9.5} fill="#e5e2e1" fillOpacity={0.35} textAnchor="end">
                  #{node.id}
                </text>
                {node.exposedCount ? (
                  <text x={layout.nodeW - 8} y={43} fontSize={9} fontWeight={700} fill={colors.accent} textAnchor="end">
                    {node.exposedCount}
                  </text>
                ) : null}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="absolute bottom-3 right-3 flex items-center gap-1 rounded-full bg-[#0e0e0e]/80 p-1 backdrop-blur-[12px]">
        <button
          type="button"
          onClick={() => zoomBy(1 / 1.2)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#e5e2e1]/60 hover:bg-[#1c1b1b] hover:text-[#e5e2e1]"
        >
          <ZoomOut className="h-3.5 w-3.5" />
        </button>
        <span className="min-w-[3ch] text-center text-[11px] text-[#e5e2e1]/55">{zoomPercent}%</span>
        <button
          type="button"
          onClick={() => zoomBy(1.2)}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full text-[#e5e2e1]/60 hover:bg-[#1c1b1b] hover:text-[#e5e2e1]"
        >
          <ZoomIn className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={fitToWindow}
          title="适应窗口"
          className={cn('inline-flex h-7 w-7 items-center justify-center rounded-full text-[#e5e2e1]/60 hover:bg-[#1c1b1b] hover:text-[#e5e2e1]')}
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
