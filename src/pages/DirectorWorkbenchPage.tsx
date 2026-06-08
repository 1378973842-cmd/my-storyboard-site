import { Suspense, useEffect, useRef, useState } from 'react';
import { StudioConvergePiece } from '../components/motion/StudioConverge';
import { Canvas } from '@react-three/fiber';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { DirectorWorkbenchScene } from '../components/director-workbench/DirectorWorkbenchScene';
import { uniformScaleTuple, type TransformMode } from '../lib/director/gizmoTransform';
import { DirectorLeftToolbar } from '../components/director-workbench/DirectorLeftToolbar';
import { DirectorTopToolbar } from '../components/director-workbench/DirectorTopToolbar';
import { DirectorSceneOverlay } from '../components/director-workbench/DirectorSceneOverlay';
import { DirectorCameraPropertiesPanel } from '../components/director-workbench/DirectorCameraPropertiesPanel';
import { DirectorSceneObjectsPanel } from '../components/director-workbench/DirectorSceneObjectsPanel';
import { DirectorCameraPiP } from '../components/director-workbench/DirectorCameraPiP';
import {
  getSelectedSceneObject,
  getSelectedSceneCamera,
  hasTransformSelection,
  useDirectorSceneStore,
} from '../store/useDirectorSceneStore';

type Props = {
  onBack?: () => void;
  enterKey?: number;
};

export function DirectorWorkbenchPage({ enterKey = 0 }: Props) {
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const isTransformDraggingRef = useRef(false);
  const orbitRef = useRef<OrbitControlsImpl>(null);

  useEffect(() => {
    useDirectorSceneStore.setState((state) => {
      let changed = false;
      const objects = state.objects.map((o) => {
        const next = uniformScaleTuple(o.scale);
        if (next[0] === o.scale[0] && next[1] === o.scale[1] && next[2] === o.scale[2]) return o;
        changed = true;
        return { ...o, scale: next };
      });
      return changed ? { objects } : state;
    });

    const { cameras, selectedCameraId } = useDirectorSceneStore.getState();
    if (cameras.length > 0 && !selectedCameraId) {
      useDirectorSceneStore.getState().selectCamera(cameras[0]!.id);
    }
  }, []);

  const selectedObject = useDirectorSceneStore(getSelectedSceneObject);
  const selectedCamera = useDirectorSceneStore(getSelectedSceneCamera);
  const clearSelection = useDirectorSceneStore((s) => s.clearSelection);
  const canTransform = useDirectorSceneStore(hasTransformSelection);

  const selectionLabel = selectedObject
    ? `人偶 · ${selectedObject.name}`
    : selectedCamera
      ? `相机 · #${selectedCamera.id.slice(0, 6)}`
      : '点击场景选中对象';

  return (
    <div
      className="h-[100dvh] overflow-hidden relative ai-editor-page director-page studio-page-shell flex flex-col"
      data-ui-root
      data-cover-page
      data-studio-page
    >
      <div className="studio-page-bg pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="studio-page-scrim pointer-events-none fixed inset-0 z-0" aria-hidden />
      <div className="studio-page-glow pointer-events-none fixed inset-0 z-0 cover-ambient" aria-hidden />

      <div className="studio-page-content ai-editor-layout relative z-10 flex flex-col flex-1 min-h-0 w-full mx-auto px-4 sm:px-6 lg:px-8 xl:px-10 pb-4 md:pb-5">
        <StudioConvergePiece origin="top" enterKey={enterKey} delay={0.03}>
          <header className="shrink-0 mb-3 lg:mb-4 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2">
            <div>
              <h1 className="cover-tools-headline text-[1.75rem] sm:text-[2rem] lg:text-[2.15rem] tracking-[-0.035em] leading-[1.08]">
                导演
              </h1>
              <p className="cover-tools-subhead mt-1 text-[14px] sm:text-[15px] leading-snug">
                三维机位、人偶姿势与场景对象编排。
              </p>
            </div>
            <p className="ai-editor-stat text-[13px] truncate max-w-[min(100%,22rem)] sm:text-right">
              {selectionLabel}
            </p>
          </header>
        </StudioConvergePiece>

        <div className="ai-editor-workspace flex-1 min-h-0 flex gap-4 lg:gap-5 xl:gap-6">
          <StudioConvergePiece origin="left" enterKey={enterKey} delay={0.07} className="shrink-0">
            <DirectorLeftToolbar />
          </StudioConvergePiece>

          <StudioConvergePiece
            origin="center"
            enterKey={enterKey}
            delay={0.09}
            className="flex flex-1 flex-col min-w-0 min-h-0 ai-editor-canvas rounded-[1.15rem] overflow-hidden"
          >
            <DirectorTopToolbar
              transformMode={transformMode}
              onTransformModeChange={setTransformMode}
              canTransform={canTransform}
            />

            <main className="relative flex-1 min-h-0 bg-[#0a0a0a]">
              <Canvas
                className="absolute inset-0 w-full h-full"
                camera={{ position: [4.5, 2.8, 4.5], fov: 45, near: 0.1, far: 200 }}
                gl={{ antialias: true, alpha: false }}
                onCreated={({ gl }) => gl.setClearColor('#0e0e0e')}
                onPointerMissed={() => {
                  if (!isTransformDraggingRef.current) clearSelection();
                }}
              >
                <Suspense fallback={null}>
                  <DirectorWorkbenchScene
                    orbitRef={orbitRef}
                    transformMode={transformMode}
                    onTransformDragging={(dragging) => {
                      isTransformDraggingRef.current = dragging;
                      useDirectorSceneStore.getState().setGizmoDragging(dragging);
                    }}
                  />
                </Suspense>
              </Canvas>

              <DirectorCameraPropertiesPanel />
              <DirectorSceneOverlay />
              <DirectorCameraPiP />
            </main>
          </StudioConvergePiece>

          <StudioConvergePiece origin="right" enterKey={enterKey} delay={0.11} className="shrink-0 min-h-0">
            <DirectorSceneObjectsPanel />
          </StudioConvergePiece>
        </div>
      </div>
    </div>
  );
}
