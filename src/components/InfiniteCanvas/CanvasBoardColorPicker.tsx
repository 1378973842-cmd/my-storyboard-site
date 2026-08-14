import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LayoutTemplate, MapPinned, Maximize2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  fitCanvasViewportAll,
  getCanvasBoardBackground,
  isCanvasMinimapVisible,
  isInfiniteCanvasEditorOpen,
  resetCanvasViewportZoom,
  setCanvasBoardBackground,
  subscribeCanvasViewportScale,
  toggleCanvasMinimapVisible,
} from '../../lib/infiniteCanvas/canvasEngine.js';
import {
  BOARD_BG_PRESETS,
  boardDockRingColor,
  hexToHsv,
  hsvToHex,
  hueColor,
  isDarkBoardHex,
  normalizeHex,
  type Hsv,
} from './canvasBoardColor';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };
const DOCK_ICON = 'h-[15px] w-[15px]';

const canvasWin = window as unknown as {
  openWorkflowTemplateModal?: () => void;
};

function DockTooltip({ label, show }: { label: string; show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          initial={{ opacity: 0, y: 3 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 3 }}
          transition={{ duration: 0.14 }}
          className="canvas-left-dock-tip"
        >
          {label}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function DockIconButton({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <div className="relative flex items-center justify-center">
      <button
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        aria-label={label}
        aria-pressed={pressed}
        className={cn('canvas-left-dock-icon', pressed && 'is-active')}
      >
        {children}
      </button>
      <DockTooltip label={label} show={hovered} />
    </div>
  );
}

function useCanvasEditorVisible(active: boolean) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!active) {
      setVisible(false);
      return;
    }
    const sync = () => setVisible(isInfiniteCanvasEditorOpen());
    sync();
    const obs = new MutationObserver(sync);
    obs.observe(document.body, { attributes: true, attributeFilter: ['data-infinite-canvas-editor'] });
    window.addEventListener('canvas-board-bg-change', sync);
    return () => {
      obs.disconnect();
      window.removeEventListener('canvas-board-bg-change', sync);
    };
  }, [active]);
  return visible;
}

function ColorField({
  hsv,
  onChange,
}: {
  hsv: Hsv;
  onChange: (next: Hsv) => void;
}) {
  const fieldRef = useRef<HTMLDivElement>(null);

  const pickAt = useCallback(
    (clientX: number, clientY: number) => {
      const el = fieldRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const s = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const v = Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height));
      onChange({ ...hsv, s, v });
    },
    [hsv, onChange],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pickAt(e.clientX, e.clientY);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    pickAt(e.clientX, e.clientY);
  };

  return (
    <div
      ref={fieldRef}
      className="relative h-[112px] w-full overflow-hidden rounded-[12px] touch-none cursor-crosshair"
      style={{ backgroundColor: hueColor(hsv.h) }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
      <div
        className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
      />
    </div>
  );
}

function HueSlider({ h, onChange }: { h: number; onChange: (h: number) => void }) {
  const trackRef = useRef<HTMLDivElement>(null);

  const pickAt = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const t = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      onChange(t * 360);
    },
    [onChange],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    pickAt(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    pickAt(e.clientX);
  };

  return (
    <div
      ref={trackRef}
      className="relative mt-2.5 h-2.5 w-full rounded-full touch-none cursor-pointer"
      style={{
        background:
          'linear-gradient(90deg,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)',
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    >
      <div
        className="pointer-events-none absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-[1.5px] border-white shadow-[0_0_0_1px_rgba(0,0,0,0.35)]"
        style={{
          left: `${(h / 360) * 100}%`,
          backgroundColor: hueColor(h),
        }}
      />
    </div>
  );
}

export const CanvasLeftDock = memo(function CanvasLeftDock({
  active = false,
}: {
  active?: boolean;
}) {
  const editorVisible = useCanvasEditorVisible(active);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [hex, setHex] = useState('#12100E');
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv('#12100E'));
  const [hexDraft, setHexDraft] = useState('12100E');
  const [zoomPct, setZoomPct] = useState(100);
  const [minimapOn, setMinimapOn] = useState(() => isCanvasMinimapVisible());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boardDark = isDarkBoardHex(hex);

  const commitColor = useCallback((nextHex: string, { save }: { save: boolean }) => {
    const normalized = normalizeHex(nextHex);
    if (!normalized) return;
    setHex(normalized);
    setHsv(hexToHsv(normalized));
    setHexDraft(normalized.slice(1));
    if (save) setCanvasBoardBackground(normalized);
  }, []);

  const scheduleSave = useCallback(
    (next: Hsv) => {
      const nextHex = hsvToHex(next.h, next.s, next.v);
      setHex(nextHex);
      setHexDraft(nextHex.slice(1));
      setHsv(next);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setCanvasBoardBackground(nextHex), 100);
    },
    [],
  );

  useEffect(() => {
    if (!editorVisible) return;
    const current = getCanvasBoardBackground();
    commitColor(current, { save: false });
    const onExternal = (e: Event) => {
      const detail = (e as CustomEvent<{ color?: string }>).detail;
      if (detail?.color) commitColor(detail.color, { save: false });
    };
    const unsubViewport = subscribeCanvasViewportScale((scale) => {
      setZoomPct(Math.round(scale * 100));
    });
    const onMinimapVis = (e: Event) => {
      const detail = (e as CustomEvent<{ visible?: boolean }>).detail;
      if (typeof detail?.visible === 'boolean') setMinimapOn(detail.visible);
      else setMinimapOn(isCanvasMinimapVisible());
    };
    setMinimapOn(isCanvasMinimapVisible());
    window.addEventListener('canvas-board-bg-change', onExternal);
    window.addEventListener('canvas-minimap-visibility', onMinimapVis);
    return () => {
      unsubViewport();
      window.removeEventListener('canvas-board-bg-change', onExternal);
      window.removeEventListener('canvas-minimap-visibility', onMinimapVis);
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, [editorVisible, commitColor]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  if (!active || !editorVisible) return null;

  return (
    <div
      ref={rootRef}
      className="canvas-left-dock"
      data-canvas-left-dock
      data-board-tone={boardDark ? 'dark' : 'light'}
    >
      <div className="canvas-left-dock-inner">
        <div className="relative flex items-center justify-center">
          <AnimatePresence>
            {open && (
              <motion.div
                key="panel"
                initial={{ opacity: 0, y: 10, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.96 }}
                transition={spring}
                className="absolute bottom-[calc(100%+10px)] left-0 w-[220px] overflow-hidden rounded-[16px] bg-[#1c1b1b]/78 text-[#e5e2e1] shadow-[0_20px_48px_-24px_rgba(0,0,0,0.62)] backdrop-blur-[32px] outline outline-[0.5px] outline-white/10"
              >
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <span className="text-[12px] font-medium tracking-[0.03em] text-[#e5e2e1]/88">画布背景</span>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[#e5e2e1]/45 transition-colors hover:bg-white/[0.06] hover:text-[#e5e2e1] cursor-pointer"
                  aria-label="关闭"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                </button>
              </div>

              <div className="h-px bg-white/[0.06]" />

              <div className="space-y-2.5 px-3.5 py-3">
                <ColorField hsv={hsv} onChange={scheduleSave} />
                <HueSlider h={hsv.h} onChange={(h) => scheduleSave({ ...hsv, h })} />

                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {BOARD_BG_PRESETS.map((preset) => {
                    const selected = hex === preset;
                    return (
                      <button
                        key={preset}
                        type="button"
                        title={preset}
                        onClick={() => commitColor(preset, { save: true })}
                        className={cn(
                          'h-5 w-5 rounded-full cursor-pointer transition-transform',
                          selected
                            ? 'outline outline-[1.5px] outline-[#ffb866] outline-offset-[2px] scale-105'
                            : 'outline outline-[0.5px] outline-white/12 hover:scale-105',
                        )}
                        style={{ backgroundColor: preset }}
                        aria-label={`预设 ${preset}`}
                      />
                    );
                  })}
                </div>

                <div className="flex items-center gap-1.5 rounded-[10px] bg-[#131313]/72 px-2.5 py-1.5 outline outline-[0.5px] outline-white/8">
                  <span className="text-[11px] font-medium text-[#e5e2e1]/38">#</span>
                  <input
                    value={hexDraft}
                    onChange={(e) => setHexDraft(e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6))}
                    onBlur={() => {
                      const normalized = normalizeHex(hexDraft);
                      if (normalized) commitColor(normalized, { save: true });
                      else setHexDraft(hex.slice(1));
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      const normalized = normalizeHex(hexDraft);
                      if (normalized) commitColor(normalized, { save: true });
                      else setHexDraft(hex.slice(1));
                    }}
                    className="min-w-0 flex-1 bg-transparent text-[11px] font-medium tracking-[0.08em] text-[#e5e2e1] outline-none uppercase"
                    aria-label="十六进制颜色"
                    spellCheck={false}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.button
          type="button"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18 }}
          onClick={() => setOpen((v) => !v)}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          aria-label="调整画布背景"
          aria-expanded={open}
          className="canvas-left-dock-color"
          style={{ borderColor: boardDockRingColor(hex, hex) }}
        />

        <DockTooltip label="调整画布背景" show={hovered && !open} />
        </div>

        <DockIconButton label="工作流模板" onClick={() => canvasWin.openWorkflowTemplateModal?.()}>
          <LayoutTemplate className={DOCK_ICON} strokeWidth={1.25} />
        </DockIconButton>

        <span className="canvas-left-dock-sep" aria-hidden />

        <button
          type="button"
          className="canvas-left-dock-zoom"
          title="Ctrl + 滚轮缩放 · 点击重置为 100%"
          aria-label={`画布缩放 ${zoomPct}%，点击重置为 100%`}
          onClick={() => resetCanvasViewportZoom()}
        >
          {zoomPct}%
        </button>

        <DockIconButton label="适配全部节点" onClick={() => fitCanvasViewportAll()}>
          <Maximize2 className={DOCK_ICON} strokeWidth={1.25} />
        </DockIconButton>

        <DockIconButton
          label={minimapOn ? '隐藏小地图' : '显示小地图'}
          pressed={minimapOn}
          onClick={() => setMinimapOn(toggleCanvasMinimapVisible())}
        >
          <MapPinned className={DOCK_ICON} strokeWidth={1.25} />
        </DockIconButton>
      </div>
    </div>
  );
});

/** @deprecated 使用 CanvasLeftDock */
export const CanvasBoardColorPicker = CanvasLeftDock;
