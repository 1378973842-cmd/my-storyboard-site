import type { CameraKeyframe, Vec3Tuple } from '../../store/useDirectorSceneStore';
import { v4 as uuidv4 } from 'uuid';
import type { DollyPathPreset } from './dollyPathBake';

export type DollySplinePoint = {
  id: string;
  position: Vec3Tuple;
};

/** Catmull-Rom 样条采样（均匀参数，闭合=false） */
export function sampleCatmullRom(points: Vec3Tuple[], t: number): Vec3Tuple {
  if (points.length === 0) return [0, 0, 0];
  if (points.length === 1) return [...points[0]!] as Vec3Tuple;
  const n = points.length - 1;
  const clamped = Math.min(1, Math.max(0, t));
  const ft = clamped * n;
  const i = Math.min(n - 1, Math.floor(ft));
  const localT = ft - i;
  const p0 = points[Math.max(0, i - 1)]!;
  const p1 = points[i]!;
  const p2 = points[Math.min(n, i + 1)]!;
  const p3 = points[Math.min(n, i + 2)]!;
  return [
    catmull(p0[0], p1[0], p2[0], p3[0], localT),
    catmull(p0[1], p1[1], p2[1], p3[1], localT),
    catmull(p0[2], p1[2], p2[2], p3[2], localT),
  ];
}

function catmull(a: number, b: number, c: number, d: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    2 * b +
    (-a + c) * t +
    (2 * a - 5 * b + 4 * c - d) * t2 +
    (-a + 3 * b - 3 * c + d) * t3
  );
}

/** 沿路径切线推算朝向（look along -Z in Three camera space ≈ yaw/pitch） */
export function rotationLookingAlong(from: Vec3Tuple, to: Vec3Tuple, fallback: Vec3Tuple): Vec3Tuple {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return [...fallback] as Vec3Tuple;
  const yaw = Math.atan2(dx, dz);
  const pitch = -Math.asin(Math.min(1, Math.max(-1, dy / len)));
  return [pitch, yaw, fallback[2]];
}

export function createSplineFromPreset(
  preset: DollyPathPreset,
  startPos: Vec3Tuple,
  startRot: Vec3Tuple,
  count = 5,
): DollySplinePoint[] {
  const pts: DollySplinePoint[] = [];
  for (let i = 0; i < count; i++) {
    const t = count <= 1 ? 0 : i / (count - 1);
    const { position } = samplePresetPoint(preset, t, startPos, startRot);
    pts.push({ id: uuidv4(), position });
  }
  return pts;
}

function samplePresetPoint(
  preset: DollyPathPreset,
  t: number,
  startPos: Vec3Tuple,
  startRot: Vec3Tuple,
): { position: Vec3Tuple } {
  const [sx, sy, sz] = startPos;
  switch (preset) {
    case 'orbit': {
      const angle = t * (Math.PI / 2);
      const radius = Math.hypot(sx, sz) || 4;
      const base = Math.atan2(sz, sx);
      return {
        position: [Math.cos(base + angle) * radius, sy, Math.sin(base + angle) * radius],
      };
    }
    case 'pushIn': {
      const yaw = startRot[1];
      const dist = Math.hypot(sx, sz) * 0.4;
      return {
        position: [
          sx - Math.sin(yaw) * dist * t,
          sy,
          sz - Math.cos(yaw) * dist * t,
        ],
      };
    }
    case 'craneUp':
      return { position: [sx, sy + 1.5 * t, sz] };
    default:
      return { position: [...startPos] as Vec3Tuple };
  }
}

/** 将可编辑样条 Bake 成相机关键帧 */
export function bakeSplineToKeyframes(opts: {
  points: DollySplinePoint[];
  totalFrames: number;
  fov: number;
  startRotation: Vec3Tuple;
  steps?: number;
  lookAlong?: boolean;
}): CameraKeyframe[] {
  const positions = opts.points.map((p) => p.position);
  if (positions.length < 2) return [];
  const steps = Math.max(4, Math.min(32, opts.steps ?? 12));
  const lookAlong = opts.lookAlong !== false;
  const frames: CameraKeyframe[] = [];

  for (let i = 0; i < steps; i++) {
    const t = steps <= 1 ? 0 : i / (steps - 1);
    const frame = Math.round(t * opts.totalFrames);
    const position = sampleCatmullRom(positions, t);
    const ahead = sampleCatmullRom(positions, Math.min(1, t + 0.02));
    const rotation = lookAlong
      ? rotationLookingAlong(position, ahead, opts.startRotation)
      : ([...opts.startRotation] as Vec3Tuple);
    frames.push({
      id: uuidv4(),
      frame,
      position,
      rotation,
      fov: opts.fov,
      ease: i < steps - 1 ? 'easeInOut' : 'linear',
    });
  }

  const byFrame = new Map<number, CameraKeyframe>();
  for (const kf of frames) byFrame.set(kf.frame, kf);
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}

export function densifySplineLine(points: Vec3Tuple[], segments = 48): Float32Array {
  const arr = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i++) {
    const p = sampleCatmullRom(points, i / segments);
    arr[i * 3] = p[0];
    arr[i * 3 + 1] = p[1];
    arr[i * 3 + 2] = p[2];
  }
  return arr;
}
