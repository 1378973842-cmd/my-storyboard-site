import { Euler, Quaternion } from 'three';
import type { CameraKeyframe, ObjectKeyframe, Vec3Tuple } from '../../store/useDirectorSceneStore';

export type CameraSample = {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  fov: number;
};

export type ObjectSample = {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
};

const _eulerA = new Euler();
const _eulerB = new Euler();
const _eulerOut = new Euler();
const _quatA = new Quaternion();
const _quatB = new Quaternion();
const _quatOut = new Quaternion();

function lerp3(a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

function slerpRotation(a: Vec3Tuple, b: Vec3Tuple, t: number): Vec3Tuple {
  _eulerA.set(a[0], a[1], a[2], 'XYZ');
  _eulerB.set(b[0], b[1], b[2], 'XYZ');
  _quatA.setFromEuler(_eulerA);
  _quatB.setFromEuler(_eulerB);
  _quatOut.slerpQuaternions(_quatA, _quatB, t);
  _eulerOut.setFromQuaternion(_quatOut, 'XYZ');
  return [_eulerOut.x, _eulerOut.y, _eulerOut.z];
}

function sampleBetweenFrames<T extends { frame: number }>(
  keyframes: T[],
  frame: number,
  blend: (a: T, b: T, t: number) => Omit<T, 'id' | 'frame'>,
): Omit<T, 'id' | 'frame'> | null {
  if (keyframes.length === 0) return null;

  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;

  if (frame <= first.frame) {
    return blend(first, first, 0);
  }
  if (frame >= last.frame) {
    return blend(last, last, 0);
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i]!;
    const b = sorted[i + 1]!;
    if (frame < a.frame || frame > b.frame) continue;
    const span = b.frame - a.frame;
    const t = span <= 0 ? 0 : (frame - a.frame) / span;
    return blend(a, b, t);
  }

  return blend(last, last, 0);
}

/** 按帧号在关键帧之间插值（position/fov 线性，rotation 球面插值） */
export function sampleCameraAtFrame(keyframes: CameraKeyframe[], frame: number): CameraSample | null {
  const sample = sampleBetweenFrames(keyframes, frame, (a, b, t) => ({
    position: lerp3(a.position, b.position, t),
    rotation: slerpRotation(a.rotation, b.rotation, t),
    fov: a.fov + (b.fov - a.fov) * t,
  }));
  return sample;
}

/** 物体/人偶关键帧插值（position/scale 线性，rotation 球面插值） */
export function sampleObjectAtFrame(keyframes: ObjectKeyframe[], frame: number): ObjectSample | null {
  const sample = sampleBetweenFrames(keyframes, frame, (a, b, t) => ({
    position: lerp3(a.position, b.position, t),
    rotation: slerpRotation(a.rotation, b.rotation, t),
    scale: lerp3(a.scale, b.scale, t),
  }));
  return sample;
}
