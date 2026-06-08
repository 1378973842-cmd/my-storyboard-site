import type { Bone, Object3D, SkinnedMesh } from 'three';

/** public/Y Bot.glb — 文件名含空格，请求时需编码 */
export const DUMMY_GLB_URL = encodeURI('/Y Bot.glb');

/** Mixamo Y Bot 绑定姿势下的大致身高（厘米量级单位），用于归一化 */
export const DUMMY_SOURCE_HEIGHT = 180.47;

/** 场景中显示的目标身高（米），与 24×24 地面网格协调 */
export const DUMMY_TARGET_HEIGHT = 1.75;

/** 将 Mixamo 原始单位缩放到场景米制（由 R3F 外层 group 施加） */
export const DUMMY_NORMALIZED_SCALE = DUMMY_TARGET_HEIGHT / DUMMY_SOURCE_HEIGHT;

/** 遍历 GLTF 场景，收集 Skeleton / Bone 节点名称 */
export function extractBoneNamesFromScene(root: Object3D): string[] {
  const names = new Set<string>();

  root.traverse((child) => {
    const skinned = child as SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) {
      skinned.skeleton.bones.forEach((bone) => {
        if (bone.name) names.add(bone.name);
      });
    }
    const bone = child as Bone;
    if (bone.isBone && bone.name) {
      names.add(bone.name);
    }
  });

  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

export type BoneRotationsMap = Record<string, [number, number, number]>;

/** 读取 GLTF 当前骨骼 local rotation（绑定姿势），勿全部置 0 否则会塌成一点 */
export function captureBoneRotationsFromScene(root: Object3D): BoneRotationsMap {
  const map = collectBonesMap(root);
  const rotations: BoneRotationsMap = {};
  map.forEach((bone, name) => {
    rotations[name] = [bone.rotation.x, bone.rotation.y, bone.rotation.z];
  });
  return rotations;
}

export function createDefaultBoneRotations(boneNames: string[]): BoneRotationsMap {
  return Object.fromEntries(boneNames.map((name) => [name, [0, 0, 0] as [number, number, number]]));
}

/** 构建骨骼名 -> Bone 实例映射，用于实时写 rotation */
export function collectBonesMap(root: Object3D): Map<string, Bone> {
  const map = new Map<string, Bone>();

  root.traverse((child) => {
    const skinned = child as SkinnedMesh;
    if (skinned.isSkinnedMesh && skinned.skeleton) {
      skinned.skeleton.bones.forEach((bone) => {
        if (bone.name) map.set(bone.name, bone);
      });
    }
    const bone = child as Bone;
    if (bone.isBone && bone.name) {
      map.set(bone.name, bone);
    }
  });

  return map;
}
