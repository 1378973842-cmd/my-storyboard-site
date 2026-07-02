import {
  Suspense,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import type { PerspectiveCamera as PerspectiveCameraImpl, WebGLRenderer } from 'three';
import {
  Camera,
  Download,
  Maximize2,
  Minus,
  PanelBottom,
  CircleSlash,
  X,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { applyShakeToTransform, shouldApplyCameraShake } from '../../lib/director/cameraShake';
import {
  getPreviewSceneCamera,
  useDirectorSceneStore,
  type SceneCamera,
} from '../../store/useDirectorSceneStore';
import { DirectorSceneContent } from './DirectorSceneContent';

export const DIRECTOR_PIP_DOCK_WIDTH = 240;
export const DIRECTOR_PIP_DOCK_HEIGHT = 148;
export const DIRECTOR_PIP_HEADER_HEIGHT = 36;

const DOCK_WIDTH = DIRECTOR_PIP_DOCK_WIDTH;
const DOCK_HEIGHT = DIRECTOR_PIP_DOCK_HEIGHT;
const HEADER_HEIGHT = DIRECTOR_PIP_HEADER_HEIGHT;
const MIN_FLOAT_WIDTH = 260;
const MIN_FLOAT_HEIGHT = 160;

type ViewportBounds = { width: number; height: number; left: number; top: number };

function readViewportBounds(boundsEl: HTMLElement | null): ViewportBounds {
  if (boundsEl) {
    const r = boundsEl.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      return { width: r.width, height: r.height, left: r.left, top: r.top };
    }
  }
  return {
    width: Math.max(320, window.innerWidth),
    height: Math.max(240, window.innerHeight - 180),
    left: 0,
    top: 64,
  };
}

function attachContextGuard(gl: WebGLRenderer) {
  gl.domElement.addEventListener('webglcontextlost', (e) => e.preventDefault(), false);
}

function DirectorCameraRig({ camera }: { camera: SceneCamera }) {
  const ref = useRef<PerspectiveCameraImpl>(null);
  const size = useThree((s) => s.size);
  const timelineIsPlaying = useDirectorSceneStore((s) => s.timelineIsPlaying);
  const timelineIsRecording = useDirectorSceneStore((s) => s.timelineIsRecording);

  useFrame(({ clock }) => {
    const rig = ref.current;
    if (!rig) return;

    let position = camera.position;
    let rotation = camera.rotation;
    if (shouldApplyCameraShake(timelineIsPlaying, timelineIsRecording, camera)) {
      ({ position, rotation } = applyShakeToTransform(
        position,
        rotation,
        camera.shakeIntensity,
        clock.elapsedTime,
      ));
    }

    rig.position.set(position[0], position[1], position[2]);
    rig.rotation.set(rotation[0], rotation[1], rotation[2], 'XYZ');
    if (Math.abs(rig.fov - camera.fov) > 0.01) {
      rig.fov = camera.fov;
      rig.updateProjectionMatrix();
    }
  });

  return (
    <PerspectiveCamera
      ref={ref}
      makeDefault
      aspect={size.width / Math.max(size.height, 1)}
      near={0.1}
      far={200}
    />
  );
}

function DirectorCameraView() {
  const camera = useDirectorSceneStore(getPreviewSceneCamera);
  const previewLive = useDirectorSceneStore((s) => s.previewLive);
  if (!camera || !previewLive) return null;

  return (
    <>
      <DirectorCameraRig camera={camera} />
      <DirectorSceneContent showCameraBodies={false} />
    </>
  );
}

function clampFloatPosition(
  x: number,
  y: number,
  boundsW: number,
  boundsH: number,
  panelW: number,
  panelH: number,
) {
  const pad = 8;
  return {
    x: Math.max(pad, Math.min(x, boundsW - panelW - pad)),
    y: Math.max(pad, Math.min(y, boundsH - panelH - pad)),
  };
}

type PanelProps = {
  variant: 'dock' | 'float';
  boundsRef: RefObject<HTMLElement | null>;
};

function DirectorCameraPiPPanel({ variant, boundsRef }: PanelProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(
    null,
  );
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    origW: number;
    origH: number;
  } | null>(null);

  const [bounds, setBounds] = useState<ViewportBounds>(() =>
    readViewportBounds(boundsRef.current),
  );

  const previewCamera = useDirectorSceneStore(getPreviewSceneCamera);
  const cameras = useDirectorSceneStore((s) => s.cameras);
  const previewMinimized = useDirectorSceneStore((s) => s.previewMinimized);
  const previewLive = useDirectorSceneStore((s) => s.previewLive);
  const previewFloatPosition = useDirectorSceneStore((s) => s.previewFloatPosition);
  const previewFloatSize = useDirectorSceneStore((s) => s.previewFloatSize);

  const setPreviewOpen = useDirectorSceneStore((s) => s.setPreviewOpen);
  const setPreviewMinimized = useDirectorSceneStore((s) => s.setPreviewMinimized);
  const setPreviewLive = useDirectorSceneStore((s) => s.setPreviewLive);
  const setPreviewFloatSize = useDirectorSceneStore((s) => s.setPreviewFloatSize);
  const dockPreview = useDirectorSceneStore((s) => s.dockPreview);

  const isFloat = variant === 'float';

  useLayoutEffect(() => {
    if (!isFloat) return undefined;
    const sync = () => setBounds(readViewportBounds(boundsRef.current));
    sync();
    const el = boundsRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener('resize', sync);
    window.addEventListener('scroll', sync, true);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', sync);
      window.removeEventListener('scroll', sync, true);
    };
  }, [isFloat, boundsRef]);

  const panelWidth = isFloat ? previewFloatSize.width : DOCK_WIDTH;
  const panelHeight = previewMinimized
    ? HEADER_HEIGHT
    : isFloat
      ? previewFloatSize.height
      : DOCK_HEIGHT;
  const canvasMinHeight = panelHeight - HEADER_HEIGHT;

  const exportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewCamera) return;
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `director-camera-${previewCamera.id.slice(0, 8)}-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }, [previewCamera]);

  const popOut = useCallback(
    (e: ReactMouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      useDirectorSceneStore.getState().popOutPreview(
        bounds.width > 0 ? { width: bounds.width, height: bounds.height } : undefined,
      );
    },
    [bounds.width, bounds.height],
  );

  const onDragPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isFloat || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: previewFloatPosition.x,
      origY: previewFloatPosition.y,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onDragPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const next = clampFloatPosition(
      drag.origX + (e.clientX - drag.startX),
      drag.origY + (e.clientY - drag.startY),
      bounds.width,
      bounds.height,
      panelWidth,
      panelHeight,
    );
    useDirectorSceneStore.getState().setPreviewFloatPosition(next);
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* released */
    }
  };

  const onResizePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!isFloat || previewMinimized) return;
    e.preventDefault();
    e.stopPropagation();
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origW: previewFloatSize.width,
      origH: previewFloatSize.height,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onResizePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const resize = resizeRef.current;
    if (!resize) return;
    const pad = 8;
    const maxW = bounds.width - previewFloatPosition.x - pad;
    const maxH = bounds.height - previewFloatPosition.y - pad;
    const newW = Math.max(MIN_FLOAT_WIDTH, Math.min(resize.origW + (e.clientX - resize.startX), maxW));
    const newH = Math.max(MIN_FLOAT_HEIGHT, Math.min(resize.origH + (e.clientY - resize.startY), maxH));
    setPreviewFloatSize({ width: newW, height: newH });
  };

  const endResize = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* released */
    }
  };

  if (cameras.length === 0) return null;

  const cameraIndex = previewCamera
    ? cameras.findIndex((c) => c.id === previewCamera.id)
    : -1;
  const title = cameraIndex >= 0 ? `相机 ${cameraIndex + 1}` : '相机';

  const floatStyle: CSSProperties = {
    position: 'fixed',
    left: bounds.left + previewFloatPosition.x,
    top: bounds.top + previewFloatPosition.y,
    width: panelWidth,
    height: panelHeight,
    zIndex: 200,
  };

  return (
    <div
      className={cn(
        'director-camera-pip rounded-xl overflow-hidden',
        'ai-editor-panel director-floating-panel outline outline-2 outline-[#4ade80]/70',
        isFloat && 'director-camera-pip--floating shadow-[0_24px_64px_-16px_rgba(0,0,0,0.85)]',
        !isFloat && 'shrink-0 w-[min(100%,240px)]',
      )}
      style={isFloat ? floatStyle : { height: panelHeight }}
    >
      <div
        className={cn(
          'flex items-center justify-between gap-2 shrink-0 select-none',
          'px-2 py-1 bg-black/40 backdrop-blur-[20px] border-b border-white/10',
          isFloat && 'cursor-grab active:cursor-grabbing',
        )}
        onPointerDown={onDragPointerDown}
        onPointerMove={onDragPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="flex items-center gap-1.5 min-w-0 pointer-events-none">
          <span className="flex items-center justify-center w-6 h-6 rounded-md bg-[#4ade80]/25 shrink-0">
            <Camera className="w-3.5 h-3.5 text-[#4ade80]" />
          </span>
          <span className="ai-editor-body text-[11px] font-medium truncate">{title}</span>
          {isFloat && (
            <span className="ai-editor-body text-[10px] opacity-45 shrink-0 hidden sm:inline">
              拖动标题栏
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {!isFloat && (
            <button
              type="button"
              title="放大并拖动"
              onClick={popOut}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 rounded-md text-[var(--cover-fg-warm)] hover:bg-white/10"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}
          {isFloat && (
            <button
              type="button"
              title="放回时间轴"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                dockPreview();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className="p-1 rounded-md text-[var(--cover-fg-warm)] hover:bg-white/10"
            >
              <PanelBottom className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            title={previewLive ? '暂停实时预览' : '恢复实时预览'}
            onClick={(e) => {
              e.stopPropagation();
              setPreviewLive(!previewLive);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className={cn(
              'p-1 rounded-md transition-colors',
              previewLive
                ? 'text-amber-300/90 hover:bg-amber-400/15'
                : 'bg-amber-400/25 text-amber-200',
            )}
          >
            <CircleSlash className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="导出 PNG"
            onClick={(e) => {
              e.stopPropagation();
              exportPng();
            }}
            onPointerDown={(e) => e.stopPropagation()}
            disabled={!previewCamera || !previewLive}
            className="p-1 rounded-md text-primary hover:bg-primary/20 disabled:opacity-35"
          >
            <Download className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title={previewMinimized ? '展开' : '最小化'}
            onClick={(e) => {
              e.stopPropagation();
              setPreviewMinimized(!previewMinimized);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-1 rounded-md text-[var(--cover-fg-warm)] hover:bg-white/10"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            title="关闭预览窗"
            onClick={(e) => {
              e.stopPropagation();
              setPreviewOpen(false);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            className="p-1 rounded-md text-[var(--cover-fg-warm)] hover:bg-red-500/15 hover:text-red-300"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {!previewMinimized && (
        <div className="relative" style={{ height: canvasMinHeight }}>
          <Canvas
            className="absolute inset-0 w-full h-full"
            frameloop={previewLive ? 'always' : 'demand'}
            dpr={[1, 1.25]}
            gl={{
              antialias: true,
              preserveDrawingBuffer: true,
              powerPreference: 'low-power',
            }}
            onCreated={({ gl }) => {
              attachContextGuard(gl);
              gl.setClearColor('#0e0e0e');
              canvasRef.current = gl.domElement;
            }}
          >
            <Suspense fallback={null}>
              <DirectorCameraView />
            </Suspense>
          </Canvas>
          {!previewLive && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#0e0e0e]/90">
              <p className="ai-editor-body text-[11px]">预览已暂停</p>
            </div>
          )}
          {isFloat && (
            <div
              className="director-camera-pip-resize-handle absolute right-0 bottom-0 z-10"
              title="拖动缩放"
              onPointerDown={onResizePointerDown}
              onPointerMove={onResizePointerMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            />
          )}
        </div>
      )}
    </div>
  );
}

type BoundsProps = {
  boundsRef: RefObject<HTMLElement | null>;
};

/** 时间轴内 dock 预览（直接渲染，不 portal） */
export function DirectorCameraPiPDock({ boundsRef }: BoundsProps) {
  const previewOpen = useDirectorSceneStore((s) => s.previewOpen);
  const previewFloating = useDirectorSceneStore((s) => s.previewFloating);
  if (!previewOpen || previewFloating) return null;
  return <DirectorCameraPiPPanel variant="dock" boundsRef={boundsRef} />;
}

/** 浮动预览（portal 到 body） */
export function DirectorCameraPiPFloat({ boundsRef }: BoundsProps) {
  const previewOpen = useDirectorSceneStore((s) => s.previewOpen);
  const previewFloating = useDirectorSceneStore((s) => s.previewFloating);
  const cameras = useDirectorSceneStore((s) => s.cameras);
  if (!previewOpen || !previewFloating || cameras.length === 0) return null;
  return createPortal(
    <DirectorCameraPiPPanel variant="float" boundsRef={boundsRef} />,
    document.body,
  );
}
