import { Suspense, useEffect, useRef, useState } from 'react';

import { StudioConvergePiece } from '../components/motion/StudioConverge';

import { Canvas } from '@react-three/fiber';

import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

import { DirectorWorkbenchScene } from '../components/director-workbench/DirectorWorkbenchScene';

import { uniformScaleTuple, type TransformMode } from '../lib/director/gizmoTransform';

import { DirectorTopToolbar } from '../components/director-workbench/DirectorTopToolbar';

import { DirectorTimeline } from '../components/director-workbench/DirectorTimeline';
import { DirectorCameraPiPFloat } from '../components/director-workbench/DirectorCameraPiP';

import {

  DirectorCharacterInspector,

  DirectorInspectorReopenButton,

} from '../components/director-workbench/DirectorCharacterInspector';

import {

  getSelectedSceneObject,

  hasTransformSelection,

  useDirectorSceneStore,

} from '../store/useDirectorSceneStore';



type Props = {

  onBack?: () => void;

  enterKey?: number;

};



export function DirectorWorkbenchPage({ enterKey = 0 }: Props) {

  const [transformMode, setTransformMode] = useState<TransformMode>('translate');

  const [inspectorDismissed, setInspectorDismissed] = useState(false);

  const isTransformDraggingRef = useRef(false);

  const orbitRef = useRef<OrbitControlsImpl>(null);

  const mainCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const previewBoundsRef = useRef<HTMLDivElement>(null);

  const selectedObject = useDirectorSceneStore(getSelectedSceneObject);
  const isCharacter = selectedObject?.type === 'character';
  const selectedId = useDirectorSceneStore((s) => s.selectedId);



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

    useDirectorSceneStore.setState({ previewFloating: false });

  }, []);



  useEffect(() => {

    if (isCharacter) setInspectorDismissed(false);

  }, [selectedId, isCharacter]);



  const clearSelection = useDirectorSceneStore((s) => s.clearSelection);

  const canTransform = useDirectorSceneStore(hasTransformSelection);



  const showInspector = isCharacter && !inspectorDismissed;



  return (

    <div

      className="h-full min-h-0 overflow-hidden relative ai-editor-page director-page studio-page-shell flex flex-col"

      data-ui-root

      data-cover-page

      data-studio-page

    >

      <div className="studio-page-bg pointer-events-none fixed inset-0 z-0" aria-hidden />

      <div className="studio-page-scrim pointer-events-none fixed inset-0 z-0" aria-hidden />

      <div className="studio-page-glow pointer-events-none fixed inset-0 z-0 cover-ambient" aria-hidden />



      <div className="studio-page-content director-page-content ai-editor-layout relative z-10 flex flex-col flex-1 min-h-0 w-full mx-auto">

        <div className="director-workspace-rails ai-editor-workspace relative flex-1 min-h-0">

          <div className="flex h-full min-h-0 flex-col director-canvas-shell ai-editor-canvas">

            <StudioConvergePiece origin="center" enterKey={enterKey} delay={0.09} className="relative z-30 shrink-0">

              <DirectorTopToolbar

                transformMode={transformMode}

                onTransformModeChange={setTransformMode}

                canTransform={canTransform}

              />

            </StudioConvergePiece>



            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">

            <main className="relative flex flex-1 flex-col min-h-0 bg-[#0a0a0a] min-w-0">

              <div className="relative flex flex-1 min-h-0 min-w-0 flex-row">

                <div ref={previewBoundsRef} className="relative flex-1 min-h-0 min-w-0">

                  <div className="absolute inset-0 overflow-hidden">

                    <Canvas

                      className="!absolute inset-0 w-full h-full"

                      camera={{ position: [4.5, 2.8, 4.5], fov: 45, near: 0.1, far: 200 }}

                      gl={{ antialias: true, alpha: false }}

                      onCreated={({ gl }) => {

                        gl.setClearColor('#0e0e0e');

                        mainCanvasRef.current = gl.domElement;

                      }}

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

                  </div>



                  {isCharacter && inspectorDismissed && (
                    <DirectorInspectorReopenButton onReopen={() => setInspectorDismissed(false)} />
                  )}
                </div>



                {showInspector && (
                  <DirectorCharacterInspector onDismiss={() => setInspectorDismissed(true)} />
                )}

              </div>

              <DirectorTimeline canvasRef={mainCanvasRef} previewBoundsRef={previewBoundsRef} />

              <DirectorCameraPiPFloat boundsRef={previewBoundsRef} />

            </main>

            </div>

          </div>

        </div>

      </div>

    </div>

  );

}

