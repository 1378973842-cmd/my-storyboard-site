import { useGLTF } from '@react-three/drei';

import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';

import { Box3, Vector3 } from 'three';

import type { Bone, Group } from 'three';

import { SkeletonUtils } from 'three-stdlib';

import { applyBoneProportions } from '../../lib/director/boneProportions';

import { applyMaterialTint, isolateMeshMaterials } from '../../lib/director/materialTint';

import {

  captureBoneRotationsFromScene,

  collectBonesMap,

  DUMMY_GLB_URL,

  DUMMY_NORMALIZED_SCALE,

  extractBoneNamesFromScene,

} from '../../lib/director/skeleton';

import { useDirectorSceneStore, type SceneObject } from '../../store/useDirectorSceneStore';



const NORMALIZED_SCALE: [number, number, number] = [

  DUMMY_NORMALIZED_SCALE,

  DUMMY_NORMALIZED_SCALE,

  DUMMY_NORMALIZED_SCALE,

];



type Props = {

  object: SceneObject;

  pointerEvents?: boolean;

};



function computePivotOffset(source: Group): [number, number, number] {

  source.updateMatrixWorld(true);

  const box = new Box3().setFromObject(source);

  const center = box.getCenter(new Vector3());

  return [-center.x, -box.min.y, -center.z];

}



const noopRaycast = () => null;



export function DummyCharacter({ object, pointerEvents = true }: Props) {

  const url = object.modelUrl ?? DUMMY_GLB_URL;

  const { scene } = useGLTF(url);

  const registerSkeletonBones = useDirectorSceneStore((s) => s.registerSkeletonBones);

  const defaultBonePose = useDirectorSceneStore((s) => s.defaultBonePose);

  const bonesMapRef = useRef<Map<string, Bone>>(new Map());



  const childCount = scene.children.length;



  const model = useMemo(() => {

    if (childCount === 0) return null;

    const cloned = SkeletonUtils.clone(scene) as Group;

    isolateMeshMaterials(cloned);

    return cloned;

  }, [scene, childCount, object.id]);



  useLayoutEffect(() => {

    if (!model) return;

    applyMaterialTint(model, object.color);

  }, [model, object.color]);



  const pivot = useMemo(() => {

    if (!model) return null;

    return computePivotOffset(model);

  }, [model]);



  useEffect(() => {

    if (url === DUMMY_GLB_URL) {

      const names = extractBoneNamesFromScene(scene);

      const restPose = captureBoneRotationsFromScene(scene);

      if (names.length > 0) registerSkeletonBones(names, restPose);

    }

  }, [scene, url, registerSkeletonBones]);



  useLayoutEffect(() => {

    if (!model) return;

    bonesMapRef.current = collectBonesMap(model);

  }, [model]);



  useEffect(() => {

    if (!model) return;

    const map = bonesMapRef.current;

    const rotations =

      Object.keys(object.boneRotations).length > 0 ? object.boneRotations : defaultBonePose;



    for (const [boneName, rot] of Object.entries(rotations)) {

      const bone = map.get(boneName);

      if (bone) bone.rotation.set(rot[0], rot[1], rot[2]);

    }

    applyBoneProportions(map, object.proportions);

  }, [object.boneRotations, object.proportions, defaultBonePose, model]);



  if (!model || !pivot) return null;



  const raycast = pointerEvents ? undefined : noopRaycast;



  return (

    <group scale={NORMALIZED_SCALE} raycast={raycast}>

      <group position={pivot} raycast={raycast}>

        <primitive object={model} raycast={raycast} />

      </group>

    </group>

  );

}


