import { OrbitControls, TransformControls } from '@react-three/drei';
import { useCallback, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { MOUSE, type Group } from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { DirectorEditorViewListener } from './DirectorEditorViewListener';
import { DirectorViewLock } from './DirectorViewLock';
import {
  applyGizmoTransform,
  createTransformSnapshot,
  readTransformTuple,
  type TransformMode,
  type TransformSnapshot,
} from '../../lib/director/gizmoTransform';
import {
  useDirectorSceneStore,
  type SceneCamera,
  type SceneObject,
  type Vec3Tuple,
} from '../../store/useDirectorSceneStore';
import { DirectorSceneEnvironment } from './DirectorSceneContent';
import { DirectorCameraGizmo } from './DirectorCameraGizmo';
import { DirectorDollySplineEditor } from './DirectorDollySplineEditor';
import { SceneObjectRenderer } from './SceneObjectRenderer';
import { SceneViewFraming } from './SceneViewFraming';
import type { TransformAxis } from '../../store/useDirectorSceneStore';

export type { TransformMode };

const ORBIT_MOUSE_BUTTONS = {
  LEFT: -1 as MOUSE,
  MIDDLE: MOUSE.ROTATE,
  RIGHT: MOUSE.PAN,
};

type Props = {
  orbitRef: RefObject<OrbitControlsImpl | null>;
  transformMode: TransformMode;
  onTransformDragging: (dragging: boolean) => void;
};

function SelectableGroup({
  position,
  rotation,
  scale,
  isSelected,
  transformMode,
  transformSpace,
  transformAxis,
  visible = true,
  locked = false,
  rawGizmo = false,
  onTransformDragging,
  onSelect,
  syncToStore,
  children,
}: {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
  isSelected: boolean;
  transformMode: TransformMode;
  transformSpace: 'local' | 'world';
  transformAxis: TransformAxis;
  visible?: boolean;
  locked?: boolean;
  /** 为 true 时不做灵敏度折算，释放位置与 Gizmo 一致（导演相机） */
  rawGizmo?: boolean;
  onTransformDragging: (dragging: boolean) => void;
  onSelect: () => void;
  syncToStore: (patch: {
    position: Vec3Tuple;
    rotation: Vec3Tuple;
    scale: Vec3Tuple;
  }) => void;
  children: ReactNode;
}) {
  const groupRef = useRef<Group>(null);
  const dragSnapshotRef = useRef<TransformSnapshot | null>(null);
  const isDraggingRef = useRef(false);

  /** 不用 R3F 的 position/rotation/scale 属性，避免拖拽时与 Gizmo 互相覆盖导致闪烁、卡顿 */
  useLayoutEffect(() => {
    const g = groupRef.current;
    if (!g || isDraggingRef.current) return;
    g.position.set(position[0], position[1], position[2]);
    g.rotation.set(rotation[0], rotation[1], rotation[2]);
    g.scale.set(scale[0], scale[1], scale[2]);
  }, [position, rotation, scale]);

  const handleDragStart = useCallback(() => {
    const target = groupRef.current;
    if (!target) return;
    dragSnapshotRef.current = createTransformSnapshot(
      position,
      rotation,
      scale,
      target.position,
      target.rotation,
      target.scale,
    );
    isDraggingRef.current = true;
    onTransformDragging(true);
  }, [position, rotation, scale, onTransformDragging]);

  const handleGizmoChange = useCallback(() => {
    const target = groupRef.current;
    const snap = dragSnapshotRef.current;
    if (!target || !snap || transformMode === 'rotate' || transformMode === 'translate' || rawGizmo) return;
    applyGizmoTransform(transformMode, snap, target.position, target.rotation, target.scale);
  }, [transformMode, rawGizmo]);

  const handleDragEnd = useCallback(() => {
    const target = groupRef.current;
    const snap = dragSnapshotRef.current;
    if (target && snap) {
      if (!rawGizmo && transformMode === 'scale') {
        applyGizmoTransform('scale', snap, target.position, target.rotation, target.scale);
      }
      syncToStore(readTransformTuple(target.position, target.rotation, target.scale));
    }
    dragSnapshotRef.current = null;
    onTransformDragging(false);
    queueMicrotask(() => {
      isDraggingRef.current = false;
    });
  }, [transformMode, rawGizmo, syncToStore, onTransformDragging]);

  return (
    <>
      <group
        ref={groupRef}
        visible={visible}
        onClick={(e) => {
          e.stopPropagation();
          if (!locked) onSelect();
        }}
      >
        {children}
      </group>
      {isSelected && !locked && (
        <TransformControls
          object={groupRef}
          mode={transformMode}
          space={transformSpace}
          size={0.9}
          showX={transformAxis === 'xyz' || transformAxis === 'x'}
          showY={transformAxis === 'xyz' || transformAxis === 'y'}
          showZ={transformAxis === 'xyz' || transformAxis === 'z'}
          onObjectChange={handleGizmoChange}
          onMouseDown={handleDragStart}
          onMouseUp={handleDragEnd}
        />
      )}
    </>
  );
}

function SceneObjectMesh({
  object,
  isSelected,
  transformMode,
  transformSpace,
  transformAxis,
  onTransformDragging,
}: {
  object: SceneObject;
  isSelected: boolean;
  transformMode: TransformMode;
  transformSpace: 'local' | 'world';
  transformAxis: TransformAxis;
  onTransformDragging: (dragging: boolean) => void;
}) {
  const selectObject = useDirectorSceneStore((s) => s.selectObject);
  const updateObjectTransform = useDirectorSceneStore((s) => s.updateObjectTransform);
  const timelineIsPlaying = useDirectorSceneStore((s) => s.timelineIsPlaying);
  const timelineIsRecording = useDirectorSceneStore((s) => s.timelineIsRecording);
  const editorHelpersHidden = timelineIsRecording;

  return (
    <SelectableGroup
      position={object.position}
      rotation={object.rotation}
      scale={object.scale}
      isSelected={isSelected}
      transformMode={transformMode}
      transformSpace={transformSpace}
      transformAxis={transformAxis}
      visible={object.visible}
      locked={object.locked || timelineIsPlaying || editorHelpersHidden}
      onTransformDragging={onTransformDragging}
      onSelect={() => selectObject(object.id)}
      syncToStore={(patch) => updateObjectTransform(object.id, patch)}
    >
      <SceneObjectRenderer object={object} pointerEvents={!isSelected} />
    </SelectableGroup>
  );
}

function SceneCameraMesh({
  camera,
  isSelected,
  transformMode,
  transformSpace,
  transformAxis,
  showFrustum,
  onTransformDragging,
}: {
  camera: SceneCamera;
  isSelected: boolean;
  transformMode: TransformMode;
  transformSpace: 'local' | 'world';
  transformAxis: TransformAxis;
  showFrustum: boolean;
  onTransformDragging: (dragging: boolean) => void;
}) {
  const selectCamera = useDirectorSceneStore((s) => s.selectCamera);
  const updateCameraTransform = useDirectorSceneStore((s) => s.updateCameraTransform);
  const timelineIsPlaying = useDirectorSceneStore((s) => s.timelineIsPlaying);
  const timelineIsRecording = useDirectorSceneStore((s) => s.timelineIsRecording);
  const editorHelpersHidden = timelineIsRecording;

  return (
    <SelectableGroup
      position={camera.position}
      rotation={camera.rotation}
      scale={camera.scale}
      isSelected={isSelected}
      transformMode={transformMode}
      transformSpace={transformSpace}
      transformAxis={transformAxis}
      visible={camera.visible}
      locked={camera.locked || timelineIsPlaying || editorHelpersHidden}
      rawGizmo
      onTransformDragging={onTransformDragging}
      onSelect={() => selectCamera(camera.id)}
      syncToStore={(patch) => updateCameraTransform(camera.id, patch)}
    >
      <DirectorCameraGizmo fov={camera.fov} selected={isSelected} showFrustum={showFrustum} />
    </SelectableGroup>
  );
}

/** 主编辑画布：轨道相机 + 可交互物体/导演相机 */
export function DirectorWorkbenchScene({ orbitRef, transformMode, onTransformDragging }: Props) {
  const objects = useDirectorSceneStore((s) => s.objects);
  const cameras = useDirectorSceneStore((s) => s.cameras);
  const selectedId = useDirectorSceneStore((s) => s.selectedId);
  const selectedCameraId = useDirectorSceneStore((s) => s.selectedCameraId);
  const showCameraGizmo = useDirectorSceneStore((s) => s.showCameraGizmo);
  const showGrid = useDirectorSceneStore((s) => s.showGrid);
  const showGround = useDirectorSceneStore((s) => s.showGround);
  const lockViewToCamera = useDirectorSceneStore((s) => s.lockViewToCamera);
  const timelineIsPlaying = useDirectorSceneStore((s) => s.timelineIsPlaying);
  const timelineIsRecording = useDirectorSceneStore((s) => s.timelineIsRecording);
  const transformSpace = useDirectorSceneStore((s) => s.transformSpace);
  const transformAxis = useDirectorSceneStore((s) => s.transformAxis);

  return (
    <>
      <DirectorSceneEnvironment showGrid={showGrid && !timelineIsRecording} showGround={showGround} />

      {!timelineIsRecording &&
        cameras.map((camera) => {
        const isSelected = selectedCameraId === camera.id;
        if (!camera.visible && !isSelected) return null;
        if (!showCameraGizmo && !isSelected) return null;
        return (
          <SceneCameraMesh
            key={camera.id}
            camera={camera}
            isSelected={isSelected}
            transformMode={transformMode}
            transformSpace={transformSpace}
            transformAxis={transformAxis}
            showFrustum={showCameraGizmo}
            onTransformDragging={onTransformDragging}
          />
        );
      })}

      {objects.map((object) => {
        if (!object.visible && selectedId !== object.id) return null;
        return (
          <SceneObjectMesh
            key={object.id}
            object={object}
            isSelected={selectedId === object.id}
            transformMode={transformMode}
            transformSpace={transformSpace}
            transformAxis={transformAxis}
            onTransformDragging={onTransformDragging}
          />
        );
      })}

      <SceneViewFraming orbitRef={orbitRef} />
      <DirectorEditorViewListener orbitRef={orbitRef} />
      <DirectorViewLock orbitRef={orbitRef} />
      <DirectorDollySplineEditor onTransformDragging={onTransformDragging} />

      <OrbitControls
        ref={orbitRef}
        makeDefault
        enabled={!lockViewToCamera && !timelineIsPlaying && !timelineIsRecording}
        enableDamping
        dampingFactor={0.08}
        mouseButtons={ORBIT_MOUSE_BUTTONS}
      />
    </>
  );
}
