import { Suspense, useRef, useCallback } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { PerspectiveCamera } from '@react-three/drei';
import { Camera, Download, Minus, X, CircleSlash } from 'lucide-react';
import { cn } from '../../lib/utils';
import {
  getPreviewSceneCamera,
  useDirectorSceneStore,
  type SceneCamera,
} from '../../store/useDirectorSceneStore';
import { DirectorSceneContent } from './DirectorSceneContent';

function DirectorCameraRig({ camera }: { camera: SceneCamera }) {
  const size = useThree((s) => s.size);
  return (
    <PerspectiveCamera
      makeDefault
      position={camera.position}
      rotation={camera.rotation}
      fov={camera.fov}
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

export function DirectorCameraPiP() {
  const previewCamera = useDirectorSceneStore(getPreviewSceneCamera);
  const cameras = useDirectorSceneStore((s) => s.cameras);
  const previewOpen = useDirectorSceneStore((s) => s.previewOpen);
  const previewMinimized = useDirectorSceneStore((s) => s.previewMinimized);
  const previewLive = useDirectorSceneStore((s) => s.previewLive);
  const setPreviewOpen = useDirectorSceneStore((s) => s.setPreviewOpen);
  const setPreviewMinimized = useDirectorSceneStore((s) => s.setPreviewMinimized);
  const setPreviewLive = useDirectorSceneStore((s) => s.setPreviewLive);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraIndex = previewCamera
    ? cameras.findIndex((c) => c.id === previewCamera.id)
    : -1;
  const title = cameraIndex >= 0 ? `相机 ${cameraIndex + 1}` : '相机';

  const exportPng = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !previewCamera) return;
    const dataUrl = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `director-camera-${previewCamera.id.slice(0, 8)}-${Date.now()}.png`;
    link.href = dataUrl;
    link.click();
  }, [previewCamera]);

  if (cameras.length === 0 || !previewOpen) return null;

  return (
    <div
      className={cn(
        'absolute left-5 bottom-5 z-20 w-[320px] rounded-xl overflow-hidden transition-all ai-editor-panel director-floating-panel',
        'outline outline-2 outline-[#4ade80]/70',
        previewMinimized ? 'h-[40px]' : 'h-[210px]',
      )}
    >
      <div
        className={cn(
          'absolute top-0 left-0 right-0 z-30 flex items-center justify-between gap-2',
          'px-2.5 py-1.5 bg-black/35 backdrop-blur-[20px]',
          'outline-b outline-[0.5px] outline-white/12',
        )}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-[#4ade80]/25">
            <Camera className="w-4 h-4 text-[#4ade80]" />
          </span>
          <span className="ai-editor-body text-[12px] font-medium">{title}</span>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            title={previewLive ? '暂停实时预览' : '恢复实时预览'}
            onClick={() => setPreviewLive(!previewLive)}
            className={cn(
              'p-1.5 rounded-lg transition-colors',
              previewLive
                ? 'text-amber-300/90 hover:bg-amber-400/15'
                : 'bg-amber-400/25 text-amber-200',
            )}
          >
            <CircleSlash className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="导出 PNG"
            onClick={exportPng}
            disabled={!previewCamera || !previewLive}
            className="p-1.5 rounded-lg text-primary hover:bg-primary/20 disabled:opacity-35"
          >
            <Download className="w-4 h-4" />
          </button>
          <button
            type="button"
            title={previewMinimized ? '展开' : '最小化'}
            onClick={() => setPreviewMinimized(!previewMinimized)}
            className="p-1.5 rounded-lg text-[var(--cover-fg-warm)] hover:bg-white/10"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            title="关闭预览窗"
            onClick={() => setPreviewOpen(false)}
            className="p-1.5 rounded-lg text-[var(--cover-fg-warm)] hover:bg-red-500/15 hover:text-red-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {!previewMinimized && (
        <>
          <Canvas
            className="w-full h-full pt-10"
            frameloop={previewLive ? 'always' : 'demand'}
            dpr={[1, 1.5]}
            gl={{ antialias: true, preserveDrawingBuffer: true }}
            onCreated={({ gl }) => {
              gl.setClearColor('#0e0e0e');
              canvasRef.current = gl.domElement;
            }}
          >
            <Suspense fallback={null}>
              <DirectorCameraView />
            </Suspense>
          </Canvas>
          {!previewLive && (
            <div className="absolute inset-0 pt-10 flex items-center justify-center bg-[#0e0e0e]/90">
              <p className="ai-editor-body text-[11px]">预览已暂停</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
