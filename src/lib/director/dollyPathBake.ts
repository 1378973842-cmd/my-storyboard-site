import type { CameraKeyframe, Vec3Tuple } from '../../store/useDirectorSceneStore';
import { v4 as uuidv4 } from 'uuid';

export type DollyPathPreset = 'orbit' | 'pushIn' | 'craneUp';

/**
 * 将简单运镜路径 Bake 成关键帧（借鉴 dollycurve 样条思路，不整库接入）。
 * 输出帧落在 [0, totalFrames]，默认 easeInOut。
 */
export function bakeDollyPathKeyframes(opts: {
  preset: DollyPathPreset;
  totalFrames: number;
  startPosition: Vec3Tuple;
  startRotation: Vec3Tuple;
  fov: number;
  steps?: number;
}): CameraKeyframe[] {
  const steps = Math.max(3, Math.min(24, opts.steps ?? 8));
  const { totalFrames, startPosition, startRotation, fov, preset } = opts;
  const frames: CameraKeyframe[] = [];

  for (let i = 0; i < steps; i++) {
    const t = steps <= 1 ? 0 : i / (steps - 1);
    const frame = Math.round(t * totalFrames);
    const { position, rotation } = samplePath(preset, t, startPosition, startRotation);
    frames.push({
      id: uuidv4(),
      frame,
      position,
      rotation,
      fov,
      ease: i < steps - 1 ? 'easeInOut' : 'linear',
    });
  }

  // 合并同帧
  const byFrame = new Map<number, CameraKeyframe>();
  for (const kf of frames) byFrame.set(kf.frame, kf);
  return [...byFrame.values()].sort((a, b) => a.frame - b.frame);
}

function samplePath(
  preset: DollyPathPreset,
  t: number,
  startPos: Vec3Tuple,
  startRot: Vec3Tuple,
): { position: Vec3Tuple; rotation: Vec3Tuple } {
  const [sx, sy, sz] = startPos;
  switch (preset) {
    case 'orbit': {
      // 绕世界原点水平环绕约 90°
      const angle = t * (Math.PI / 2);
      const radius = Math.hypot(sx, sz) || 4;
      const base = Math.atan2(sz, sx);
      const x = Math.cos(base + angle) * radius;
      const z = Math.sin(base + angle) * radius;
      return {
        position: [x, sy, z],
        rotation: [startRot[0], startRot[1] - angle, startRot[2]],
      };
    }
    case 'pushIn': {
      // 沿朝向推进约 40% 距离
      const yaw = startRot[1];
      const dist = Math.hypot(sx, sz) * 0.4;
      return {
        position: [
          sx - Math.sin(yaw) * dist * t,
          sy,
          sz - Math.cos(yaw) * dist * t,
        ],
        rotation: [...startRot] as Vec3Tuple,
      };
    }
    case 'craneUp': {
      return {
        position: [sx, sy + 1.5 * t, sz],
        rotation: [startRot[0] - 0.15 * t, startRot[1], startRot[2]],
      };
    }
    default:
      return { position: [...startPos] as Vec3Tuple, rotation: [...startRot] as Vec3Tuple };
  }
}
