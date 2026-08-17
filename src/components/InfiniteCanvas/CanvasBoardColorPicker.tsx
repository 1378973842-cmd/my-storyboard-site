import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, LayoutTemplate, MapPinned, Maximize2, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  fitCanvasViewportAll,
  getCanvasThemeMode,
  isCanvasMinimapVisible,
  isInfiniteCanvasEditorOpen,
  resetCanvasViewportZoom,
  setCanvasThemeMode,
  subscribeCanvasViewportScale,
  toggleCanvasMinimapVisible,
} from '../../lib/infiniteCanvas/canvasEngine.js';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };
const DOCK_ICON = 'h-[15px] w-[15px]';
const THEME_OPTIONS = [
  { id: 'dark' as const, label: '夜间', desc: '炭黑 · 琥珀光', bg: '#12100E' },
  { id: 'light' as const, label: '日间', desc: '米白 · 深色字', bg: '#F8FAFC' },
];
const THEME_HEX: Record<'dark' | 'light', string> = { dark: '#12100E', light: '#F8FAFC' };

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

export const CanvasLeftDock = memo(function CanvasLeftDock({
  active = false,
}: {
  active?: boolean;
}) {
  const editorVisible = useCanvasEditorVisible(active);
  const [open, setOpen] = useState(false);
  const [hovered, setHovered] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(() => getCanvasThemeMode());
  const [zoomPct, setZoomPct] = useState(100);
  const [minimapOn, setMinimapOn] = useState(() => isCanvasMinimapVisible());
  const boardDark = themeMode === 'dark';
  const themeHex = THEME_HEX[themeMode];

  const chooseTheme = useCallback((mode: 'dark' | 'light') => {
    setThemeMode(setCanvasThemeMode(mode));
  }, []);

  useEffect(() => {
    if (!editorVisible) return;
    setThemeMode(getCanvasThemeMode());
    const onThemeChange = (e: Event) => {
      const detail = (e as CustomEvent<{ mode?: string }>).detail;
      if (detail?.mode === 'light' || detail?.mode === 'dark') setThemeMode(detail.mode);
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
    window.addEventListener('canvas-theme-change', onThemeChange);
    window.addEventListener('canvas-minimap-visibility', onMinimapVis);
    return () => {
      unsubViewport();
      window.removeEventListener('canvas-theme-change', onThemeChange);
      window.removeEventListener('canvas-minimap-visibility', onMinimapVis);
    };
  }, [editorVisible]);

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
                className={cn(
                  'absolute bottom-[calc(100%+10px)] left-0 w-[220px] overflow-hidden rounded-[16px] backdrop-blur-[32px] outline outline-[0.5px]',
                  boardDark
                    ? 'bg-[#1c1b1b]/78 text-[#e5e2e1] shadow-[0_20px_48px_-24px_rgba(0,0,0,0.62)] outline-white/10'
                    : 'bg-white/90 text-[#111827] shadow-[0_20px_48px_-28px_rgba(15,23,42,0.30)] outline-black/10',
                )}
              >
                <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <span className={cn('text-[12px] font-medium tracking-[0.03em]', boardDark ? 'text-[#e5e2e1]/88' : 'text-[#111827]/80')}>画布主题</span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className={cn('flex h-6 w-6 items-center justify-center rounded-full transition-colors cursor-pointer', boardDark ? 'text-[#e5e2e1]/45 hover:bg-white/[0.06] hover:text-[#e5e2e1]' : 'text-[#111827]/45 hover:bg-black/[0.06] hover:text-[#111827]')}
                    aria-label="关闭"
                  >
                    <X className="h-3.5 w-3.5" strokeWidth={1.75} />
                  </button>
                </div>

                <div className={boardDark ? 'h-px bg-white/[0.06]' : 'h-px bg-black/[0.06]'} />

                <div className="space-y-1.5 px-2.5 py-2.5">
                  {THEME_OPTIONS.map((t) => {
                    const selected = themeMode === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => chooseTheme(t.id)}
                        aria-pressed={selected}
                        className={cn(
                          'flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors cursor-pointer',
                          selected
                            ? (boardDark ? 'bg-white/[0.08]' : 'bg-black/[0.05]')
                            : (boardDark ? 'hover:bg-white/[0.05]' : 'hover:bg-black/[0.04]'),
                          selected && (boardDark ? 'outline outline-[0.5px] outline-[#ffb866]/40' : 'outline outline-[0.5px] outline-[#b77100]/40'),
                        )}
                      >
                        <span
                          className={cn('h-5 w-5 shrink-0 rounded-full', boardDark ? 'outline outline-[0.5px] outline-white/20' : 'outline outline-[0.5px] outline-black/15')}
                          style={{ backgroundColor: t.bg }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[12.5px] font-medium leading-tight">{t.label}</span>
                          <span className={cn('block text-[10.5px] leading-tight', boardDark ? 'text-[#e5e2e1]/40' : 'text-[#111827]/45')}>{t.desc}</span>
                        </span>
                        {selected && <Check className={cn('h-3.5 w-3.5 shrink-0', boardDark ? 'text-[#ffb866]' : 'text-[#b77100]')} strokeWidth={2} />}
                      </button>
                    );
                  })}
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
          aria-label="画布主题（夜间/日间）"
          aria-expanded={open}
          className="canvas-left-dock-color"
          style={{ backgroundColor: themeHex }}
        />

        <DockTooltip label="画布主题" show={hovered && !open} />
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
