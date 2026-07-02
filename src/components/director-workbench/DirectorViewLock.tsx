import { useFrame } from '@react-three/fiber';
import { Euler, PerspectiveCamera } from 'three';
import type { RefObject } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { applyShakeToTransform, shouldApplyCameraShake } from '../../lib/director/cameraShake';
import { getSelectedSceneCamera, useDirectorSceneStore } from '../../store/useDirectorSceneStore';

const _euler = new Euler();

type Props = {
  orbitRef: RefObject<OrbitControlsImpl | null>;
};

/** 锁定视图：编辑视角与选中导演相机同步（播放/录制时可叠加镜头抖动） */
export function DirectorViewLock({ orbitRef }: Props) {
  const lockViewToCamera = useDirectorSceneStore((s) => s.lockViewToCamera);
  const isGizmoDragging = useDirectorSceneStore((s) => s.isGizmoDragging);
  const timelineIsPlaying = useDirectorSceneStore((s) => s.timelineIsPlaying);
  const timelineIsRecording = useDirectorSceneStore((s) => s.timelineIsRecording);
  const selectedCamera = useDirectorSceneStore(getSelectedSceneCamera);

  useFrame(({ camera, clock }) => {
    if (!lockViewToCamera || !selectedCamera || isGizmoDragging) return;
    const orbit = orbitRef.current;
    if (!orbit) return;

    let position = selectedCamera.position;
    let rotation = selectedCamera.rotation;
    if (shouldApplyCameraShake(timelineIsPlaying, timelineIsRecording, selectedCamera)) {
      ({ position, rotation } = applyShakeToTransform(
        position,
        rotation,
        selectedCamera.shakeIntensity,
        clock.elapsedTime,
      ));
    }

    camera.position.set(position[0], position[1], position[2]);
    _euler.set(rotation[0], rotation[1], rotation[2], 'XYZ');
    camera.rotation.copy(_euler);

    if (camera instanceof PerspectiveCamera && Math.abs(camera.fov - selectedCamera.fov) > 0.01) {
      camera.fov = selectedCamera.fov;
      camera.updateProjectionMatrix();
    }

    const forward = -1;
    const dist = 0.01;
    orbit.target.set(
      position[0] + Math.sin(_euler.y) * forward * dist,
      position[1] - Math.sin(_euler.x) * dist,
      position[2] + Math.cos(_euler.y) * forward * dist,
    );
    orbit.update();
  });

  return null;
}
