import type { SceneCamera, Vec3Tuple } from '../../store/useDirectorSceneStore';

export type CameraShakeOffset = {
  position: Vec3Tuple;
  rotation: Vec3Tuple;
};

/** 多频正弦叠加，模拟手持/载具颠簸（不写入关键帧，仅渲染层偏移） */
export function sampleCameraShake(intensity: number, timeSec: number): CameraShakeOffset {
  const i = Math.max(0, Math.min(1, intensity));
  const ampPos = i * 0.065;
  const ampRot = i * 0.028;

  const px = Math.sin(timeSec * 11.3) * Math.cos(timeSec * 4.7) * ampPos;
  const py = Math.sin(timeSec * 13.1 + 1.2) * Math.cos(timeSec * 5.3) * ampPos * 0.55;
  const pz = Math.cos(timeSec * 9.7 + 0.5) * Math.sin(timeSec * 6.1) * ampPos * 0.85;

  const rx = Math.sin(timeSec * 10.5 + 2.1) * ampRot;
  const ry = Math.cos(timeSec * 12.2 + 0.8) * ampRot * 0.75;
  const rz = Math.sin(timeSec * 8.9 + 1.5) * ampRot * 0.55;

  return {
    position: [px, py, pz],
    rotation: [rx, ry, rz],
  };
}

export function shouldApplyCameraShake(
  playing: boolean,
  recording: boolean,
  camera: Pick<SceneCamera, 'shakeEnabled'>,
): boolean {
  return (playing || recording) && Boolean(camera.shakeEnabled);
}

export function applyShakeToTransform(
  position: Vec3Tuple,
  rotation: Vec3Tuple,
  intensity: number,
  timeSec: number,
): { position: Vec3Tuple; rotation: Vec3Tuple } {
  const offset = sampleCameraShake(intensity, timeSec);
  return {
    position: [
      position[0] + offset.position[0],
      position[1] + offset.position[1],
      position[2] + offset.position[2],
    ],
    rotation: [
      rotation[0] + offset.rotation[0],
      rotation[1] + offset.rotation[1],
      rotation[2] + offset.rotation[2],
    ],
  };
}

export function normalizeSceneCamera(camera: SceneCamera): SceneCamera {
  return {
    ...camera,
    shakeEnabled: camera.shakeEnabled ?? false,
    shakeIntensity: Math.max(0, Math.min(1, camera.shakeIntensity ?? 0.35)),
  };
}
