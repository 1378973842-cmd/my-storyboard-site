import { DEFAULT_PROPORTIONS } from './boneProportions';
import type { BoneRotationsMap } from './skeleton';
import { DIRECTOR_POSE_PRESETS, type DirectorPosePresetId } from './posePresets';
import type { SavedPose } from '../../store/useDirectorSceneStore';

type Vec3 = [number, number, number];

/** 在绑定姿势上的增量（弧度），勿当作绝对欧拉角 */
const PRESET_DELTAS: Record<DirectorPosePresetId, Partial<BoneRotationsMap>> = {
  stand: {},
  sit: {
    mixamorig_Hips: [0.15, 0, 0],
    mixamorig_Spine: [0.22, 0, 0],
    mixamorig_Spine1: [0.1, 0, 0],
    mixamorig_LeftUpLeg: [0.95, 0, 0.35],
    mixamorig_RightUpLeg: [0.95, 0, -0.35],
    mixamorig_LeftLeg: [-1.15, 0, 0.05],
    mixamorig_RightLeg: [-1.15, 0, -0.05],
    mixamorig_LeftArm: [-0.55, 0.1, -0.35],
    mixamorig_RightArm: [-0.55, -0.1, 0.35],
    mixamorig_LeftForeArm: [-0.45, 0, 0],
    mixamorig_RightForeArm: [-0.45, 0, 0],
  },
  /** 针对 Y Bot 绑定姿势调校：摆臂 + 弓步，避免 T-pose 横臂 */
  run: {
    mixamorig_Hips: [0.22, 0, 0.04],
    mixamorig_Spine: [0.2, 0, 0],
    mixamorig_Spine1: [0.08, 0, 0],
    mixamorig_LeftArm: [-1.35, 0.15, -1.05],
    mixamorig_RightArm: [1.15, -0.15, 1.05],
    mixamorig_LeftForeArm: [-1.15, 0, 0.05],
    mixamorig_RightForeArm: [-1.15, 0, -0.05],
    mixamorig_LeftUpLeg: [0.85, 0, 0.55],
    mixamorig_RightUpLeg: [-0.65, 0, -0.45],
    mixamorig_LeftLeg: [-0.95, 0, 0.08],
    mixamorig_RightLeg: [1.05, 0, -0.08],
  },
};

function addVec3(base: Vec3, delta: Vec3): Vec3 {
  return [base[0] + delta[0], base[1] + delta[1], base[2] + delta[2]];
}

export function isBuiltinPosePreset(preset: string): preset is DirectorPosePresetId {
  const key = preset.trim().toLowerCase();
  return (DIRECTOR_POSE_PRESETS as readonly string[]).includes(key);
}

/**
 * 在 Y Bot 绑定姿势上叠加增量，得到完整 boneRotations。
 * 必须使用 defaultBonePose（T-pose 快照），不能把上次扭曲后的姿势当基底。
 */
export function mergeBuiltinPoseRotations(
  preset: string,
  bindPose: BoneRotationsMap,
): BoneRotationsMap | null {
  if (!isBuiltinPosePreset(preset)) return null;
  const key = preset.trim().toLowerCase() as DirectorPosePresetId;

  if (key === 'stand') {
    return Object.keys(bindPose).length > 0 ? { ...bindPose } : {};
  }

  if (Object.keys(bindPose).length === 0) return null;

  const deltas = PRESET_DELTAS[key];
  const out: BoneRotationsMap = { ...bindPose };
  for (const [bone, delta] of Object.entries(deltas)) {
    if (!delta) continue;
    const rest = bindPose[bone] ?? ([0, 0, 0] as Vec3);
    out[bone] = addVec3(rest, delta);
  }
  return out;
}

export function builtinPoseToSavedPose(preset: string, bindPose: BoneRotationsMap): SavedPose | null {
  const boneRotations = mergeBuiltinPoseRotations(preset, bindPose);
  if (!boneRotations || Object.keys(boneRotations).length === 0) return null;
  const id = preset.trim().toLowerCase();
  return {
    id,
    name: id,
    boneRotations,
    proportions: { ...DEFAULT_PROPORTIONS },
  };
}
