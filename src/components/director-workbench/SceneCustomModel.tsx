import { useGLTF } from '@react-three/drei';
import { useMemo } from 'react';
import { Box3, Vector3, type Group } from 'three';
import { SkeletonUtils } from 'three-stdlib';
import { applyMaterialTint, isolateMeshMaterials } from '../../lib/director/materialTint';
import { DUMMY_NORMALIZED_SCALE, DUMMY_TARGET_HEIGHT } from '../../lib/director/skeleton';

type Props = {
  modelUrl: string;
  tint?: string;
};

function computePivotOffset(source: Group): [number, number, number] {
  source.updateMatrixWorld(true);
  const box = new Box3().setFromObject(source);
  const center = box.getCenter(new Vector3());
  return [-center.x, -box.min.y, -center.z];
}

function normalizeScale(source: Group): number {
  source.updateMatrixWorld(true);
  const box = new Box3().setFromObject(source);
  const size = box.getSize(new Vector3());
  const h = Math.max(size.y, 0.001);
  return h > 50 ? DUMMY_NORMALIZED_SCALE : DUMMY_TARGET_HEIGHT / h;
}

/** 用户导入的 GLB/GLTF */
export function SceneCustomModel({ modelUrl, tint }: Props) {
  const { scene } = useGLTF(modelUrl);
  const { model, pivot, scale } = useMemo(() => {
    if (scene.children.length === 0) return { model: null, pivot: null, scale: 1 };
    const cloned = SkeletonUtils.clone(scene) as Group;
    isolateMeshMaterials(cloned);
    if (tint) applyMaterialTint(cloned, tint);
    return {
      model: cloned,
      pivot: computePivotOffset(cloned),
      scale: normalizeScale(cloned),
    };
  }, [scene, tint]);

  if (!model || !pivot) return null;

  return (
    <group scale={[scale, scale, scale]}>
      <group position={pivot}>
        <primitive object={model} />
      </group>
    </group>
  );
}
