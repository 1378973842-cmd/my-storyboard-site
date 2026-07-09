import { Euler, Quaternion } from 'three';
import type {
  CameraKeyframe,
  ObjectKeyframe,
  Vec3Tuple,
} from '../../store/useDirectorSceneStore';
import type { ProportionMap } from './boneProportions';
import {
  applyKeyframeEase,
  DEFAULT_BEZIER,
  type KeyframeEase,
} from './keyframeEasing';

export type CameraSample = {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  fov: number;
};

export type ObjectSample = {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
  scale: Vec3Tuple;
  boneRotations?: Record<string, Vec3Tuple>;
  proportions?: ProportionMap;
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

function lerpBoneMaps(
  a: Record<string, Vec3Tuple> | undefined,
  b: Record<string, Vec3Tuple> | undefined,
  t: number,
): Record<string, Vec3Tuple> | undefined {
  if (!a && !b) return undefined;
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  const out: Record<string, Vec3Tuple> = {};
  for (const key of keys) {
    const va = a?.[key] ?? b?.[key] ?? [0, 0, 0];
    const vb = b?.[key] ?? a?.[key] ?? [0, 0, 0];
    out[key] = slerpRotation(va, vb, t);
  }
  return out;
}

function lerpProportions(
  a: ProportionMap | undefined,
  b: ProportionMap | undefined,
  t: number,
): ProportionMap | undefined {
  if (!a && !b) return undefined;
  const left = a ?? b!;
  const right = b ?? a!;
  const out = { ...left };
  for (const key of Object.keys(right) as (keyof ProportionMap)[]) {
    const av = Number(left[key] ?? right[key] ?? 1);
    const bv = Number(right[key] ?? left[key] ?? 1);
    (out as Record<string, number>)[key] = av + (bv - av) * t;
  }
  return out;
}

type EaseCarrier = {
  frame: number;
  ease?: KeyframeEase;
  easeBezier?: [number, number, number, number];
};

function sampleBetweenFrames<T extends EaseCarrier>(
  keyframes: T[],
  frame: number,
  blend: (a: T, b: T, t: number) => Omit<T, 'id' | 'frame' | 'ease' | 'easeBezier'>,
): Omit<T, 'id' | 'frame' | 'ease' | 'easeBezier'> | null {
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
    const rawT = span <= 0 ? 0 : (frame - a.frame) / span;
    const eased = applyKeyframeEase(
      rawT,
      a.ease ?? 'linear',
      a.easeBezier ?? DEFAULT_BEZIER,
    );
    return blend(a, b, eased);
  }

  return blend(last, last, 0);
}

/** 按帧号在关键帧之间插值（支持段缓动；rotation 球面插值） */
export function sampleCameraAtFrame(keyframes: CameraKeyframe[], frame: number): CameraSample | null {
  const sample = sampleBetweenFrames(keyframes, frame, (a, b, t) => ({
    position: lerp3(a.position, b.position, t),
    rotation: slerpRotation(a.rotation, b.rotation, t),
    fov: a.fov + (b.fov - a.fov) * t,
  }));
  return sample;
}

/** 物体/人偶关键帧插值（含可选骨骼姿势；rotation 球面插值） */
export function sampleObjectAtFrame(keyframes: ObjectKeyframe[], frame: number): ObjectSample | null {
  const sample = sampleBetweenFrames(keyframes, frame, (a, b, t) => ({
    position: lerp3(a.position, b.position, t),
    rotation: slerpRotation(a.rotation, b.rotation, t),
    scale: lerp3(a.scale, b.scale, t),
    boneRotations: lerpBoneMaps(a.boneRotations, b.boneRotations, t),
    proportions: lerpProportions(a.proportions, b.proportions, t),
  }));
  return sample;
}
