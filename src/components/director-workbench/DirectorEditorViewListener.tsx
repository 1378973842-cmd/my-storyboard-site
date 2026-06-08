import { useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import type { RefObject } from 'react';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { DUMMY_TARGET_HEIGHT } from '../../lib/director/skeleton';
import {
  getEditorViewCameraPosition,
  type EditorViewPreset,
} from '../../lib/director/editorViewPresets';
import { useDirectorSceneStore } from '../../store/useDirectorSceneStore';

type Props = {
  orbitRef: RefObject<OrbitControlsImpl | null>;
};

function resolveViewTarget(
  selectedId: string | null,
  selectedCameraId: string | null,
  objects: { id: string; position: Vec3Tuple; scale: Vec3Tuple }[],
  cameras: { id: string; position: Vec3Tuple }[],
): Vec3Tuple {
  if (selectedCameraId) {
    const cam = cameras.find((c) => c.id === selectedCameraId);
    if (cam) return [...cam.position];
  }
  if (selectedId) {
    const obj = objects.find((o) => o.id === selectedId);
    if (obj) {
      const s = Math.max(obj.scale[0], obj.scale[1], obj.scale[2], 1);
      return [obj.position[0], obj.position[1] + DUMMY_TARGET_HEIGHT * 0.5 * s, obj.position[2]];
    }
  }
  return [0, DUMMY_TARGET_HEIGHT * 0.5, 0];
}

type Vec3Tuple = [number, number, number];

export function DirectorEditorViewListener({ orbitRef }: Props) {
  const selectedId = useDirectorSceneStore((s) => s.selectedId);
  const selectedCameraId = useDirectorSceneStore((s) => s.selectedCameraId);
  const objects = useDirectorSceneStore((s) => s.objects);
  const cameras = useDirectorSceneStore((s) => s.cameras);
  const invalidate = useThree((s) => s.invalidate);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    const onPreset = (e: Event) => {
      const preset = (e as CustomEvent<{ preset: EditorViewPreset }>).detail?.preset;
      if (!preset) return;
      const orbit = orbitRef.current;
      if (!orbit) return;

      const target = resolveViewTarget(selectedId, selectedCameraId, objects, cameras);
      const pos = getEditorViewCameraPosition(preset, target);
      orbit.target.set(target[0], target[1], target[2]);
      camera.position.set(pos[0], pos[1], pos[2]);
      orbit.update();
      invalidate();
    };

    window.addEventListener('director-editor-view', onPreset);
    return () => window.removeEventListener('director-editor-view', onPreset);
  }, [selectedId, selectedCameraId, objects, cameras, orbitRef, camera, invalidate]);

  return null;
}
