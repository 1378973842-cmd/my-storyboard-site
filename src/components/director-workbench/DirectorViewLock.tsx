import { useFrame } from '@react-three/fiber';
import { Euler } from 'three';
import type { RefObject } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { getSelectedSceneCamera, useDirectorSceneStore } from '../../store/useDirectorSceneStore';

const _euler = new Euler();

type Props = {
  orbitRef: RefObject<OrbitControlsImpl | null>;
};

/** 锁定视图：编辑视角与选中导演相机同步 */
export function DirectorViewLock({ orbitRef }: Props) {
  const lockViewToCamera = useDirectorSceneStore((s) => s.lockViewToCamera);
  const isGizmoDragging = useDirectorSceneStore((s) => s.isGizmoDragging);
  const selectedCamera = useDirectorSceneStore(getSelectedSceneCamera);

  useFrame(({ camera }) => {
    if (!lockViewToCamera || !selectedCamera || isGizmoDragging) return;
    const orbit = orbitRef.current;
    if (!orbit) return;

    camera.position.set(
      selectedCamera.position[0],
      selectedCamera.position[1],
      selectedCamera.position[2],
    );
    _euler.set(
      selectedCamera.rotation[0],
      selectedCamera.rotation[1],
      selectedCamera.rotation[2],
      'XYZ',
    );
    camera.rotation.copy(_euler);

    const forward = -1;
    const dist = 0.01;
    orbit.target.set(
      selectedCamera.position[0] + Math.sin(_euler.y) * forward * dist,
      selectedCamera.position[1] - Math.sin(_euler.x) * dist,
      selectedCamera.position[2] + Math.cos(_euler.y) * forward * dist,
    );
    orbit.update();
  });

  return null;
}
