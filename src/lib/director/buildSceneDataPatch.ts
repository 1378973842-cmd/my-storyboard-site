import type { SceneData, SceneVec3 } from '../../types';
import type { BoneRotationsMap } from './skeleton';
import { builtinPoseToSavedPose } from './builtinPosePresets';
import type { SavedPose, SceneCamera, SceneObject } from '../../store/useDirectorSceneStore';

export type SceneDataMergeInput = {
  objects: SceneObject[];
  cameras: SceneCamera[];
  savedPoses: SavedPose[];
  selectedCameraId: string | null;
  /** Y Bot 绑定姿势；内置 stand/sit/run 预设依赖此表合并 */
  defaultBonePose: BoneRotationsMap;
};

export type SceneDataMergeResult = {
  objects?: SceneObject[];
  cameras?: SceneCamera[];
};

function mergeVec3(current: SceneVec3, patch?: SceneVec3): SceneVec3 {
  if (!patch) return current;
  return [
    patch[0] ?? current[0],
    patch[1] ?? current[1],
    patch[2] ?? current[2],
  ];
}

function resolvePosePreset(
  savedPoses: SavedPose[],
  preset: string,
  bindPose: BoneRotationsMap,
): SavedPose | undefined {
  const key = preset.trim();
  if (!key) return undefined;

  const builtin = builtinPoseToSavedPose(key, bindPose);
  if (builtin) return builtin;

  return (
    savedPoses.find((p) => p.id === key) ??
    savedPoses.find((p) => p.name === key) ??
    savedPoses.find((p) => p.name.toLowerCase() === key.toLowerCase())
  );
}

/**
 * 将 SceneData 合并进当前场景（仅更新出现的字段；未列出的角色/相机不动）。
 */
export function buildSceneDataPatch(
  state: SceneDataMergeInput,
  data: SceneData,
): SceneDataMergeResult {
  const result: SceneDataMergeResult = {};

  if (data.camera) {
    const targetId = state.selectedCameraId ?? state.cameras[0]?.id;
    if (targetId) {
      const { position, rotation, fov } = data.camera;
      result.cameras = state.cameras.map((cam) => {
        if (cam.id !== targetId) return cam;
        return {
          ...cam,
          ...(position ? { position: mergeVec3(cam.position, position) } : {}),
          ...(rotation ? { rotation: mergeVec3(cam.rotation, rotation) } : {}),
          ...(fov !== undefined ? { fov: Math.min(120, Math.max(15, fov)) } : {}),
        };
      });
    }
  }

  if (data.characters?.length) {
    const byId = new Map(data.characters.map((c) => [c.id, c]));
    result.objects = state.objects.map((obj) => {
      if (obj.type !== 'character') return obj;
      const patch = byId.get(obj.id);
      if (!patch) return obj;

      let next: SceneObject = { ...obj };
      if (patch.position) next = { ...next, position: mergeVec3(obj.position, patch.position) };
      if (patch.rotation) next = { ...next, rotation: mergeVec3(obj.rotation, patch.rotation) };

      if (patch.posePreset) {
        const bindForChar =
          Object.keys(state.defaultBonePose).length > 0 ? state.defaultBonePose : obj.boneRotations;
        const pose = resolvePosePreset(state.savedPoses, patch.posePreset, bindForChar);
        if (pose) {
          next = {
            ...next,
            boneRotations: structuredClone(pose.boneRotations),
            proportions: { ...pose.proportions },
          };
        }
      }

      return next;
    });
  }

  return result;
}
