import { Euler, Vector3 } from 'three';
import type { Vec3Tuple } from '../../store/useDirectorSceneStore';

export type TransformMode = 'translate' | 'rotate' | 'scale';

/** 拖拽灵敏度（旋转交给 Gizmo 原生处理，勿改 Euler 以免绿环乱转） */
export const GIZMO_SENSITIVITY: Record<'translate' | 'scale', number> = {
  translate: 0.38,
  scale: 0.45,
};

export const GIZMO_SCALE_MIN = 0.5;
export const GIZMO_SCALE_MAX = 2;

export type TransformSnapshot = {
  storePosition: Vector3;
  storeRotation: Euler;
  storeScale: number;
  objPosition: Vector3;
  objRotation: Euler;
  objScale: Vector3;
};

export function createTransformSnapshot(
  storePosition: Vec3Tuple,
  storeRotation: Vec3Tuple,
  storeScale: Vec3Tuple,
  objPosition: Vector3,
  objRotation: Euler,
  objScale: Vector3,
): TransformSnapshot {
  const storePos = new Vector3(...storePosition);
  const storeRot = new Euler(...storeRotation, 'XYZ');
  const uniform = (storeScale[0] + storeScale[1] + storeScale[2]) / 3;
  return {
    storePosition: storePos,
    storeRotation: storeRot,
    storeScale: uniform,
    objPosition: objPosition.clone(),
    objRotation: objRotation.clone(),
    objScale: objScale.clone(),
  };
}

function clampScale(value: number): number {
  return Math.min(GIZMO_SCALE_MAX, Math.max(GIZMO_SCALE_MIN, value));
}

const _delta = new Vector3();

/** 按灵敏度写回 object，返回用于 store 的 tuple */
export function applyGizmoTransform(
  mode: 'translate' | 'scale',
  snapshot: TransformSnapshot,
  currentPosition: Vector3,
  currentRotation: Euler,
  currentScale: Vector3,
): { position: Vec3Tuple; rotation: Vec3Tuple; scale: Vec3Tuple } {
  const factor = GIZMO_SENSITIVITY[mode];

  if (mode === 'translate') {
    _delta.copy(currentPosition).sub(snapshot.objPosition).multiplyScalar(factor);
    currentPosition.copy(snapshot.storePosition).add(_delta);
  } else {
    const ratioX = currentScale.x / snapshot.objScale.x;
    const ratioY = currentScale.y / snapshot.objScale.y;
    const ratioZ = currentScale.z / snapshot.objScale.z;
    const ratio = Math.max(ratioX, ratioY, ratioZ);
    const uniform = clampScale(snapshot.storeScale * (1 + (ratio - 1) * factor));
    currentScale.setScalar(uniform);
  }

  const s = currentScale.x;
  return {
    position: [currentPosition.x, currentPosition.y, currentPosition.z],
    rotation: [currentRotation.x, currentRotation.y, currentRotation.z],
    scale: [s, s, s],
  };
}

export function uniformScaleTuple(s: Vec3Tuple): Vec3Tuple {
  const u = clampScale((s[0] + s[1] + s[2]) / 3);
  return [u, u, u];
}

export function readTransformTuple(
  position: Vector3,
  rotation: Euler,
  scale: Vector3,
): { position: Vec3Tuple; rotation: Vec3Tuple; scale: Vec3Tuple } {
  const u = scale.x;
  return {
    position: [position.x, position.y, position.z],
    rotation: [rotation.x, rotation.y, rotation.z],
    scale: [u, u, u],
  };
}
