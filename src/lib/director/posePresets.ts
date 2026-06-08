/** LLM 可引用的姿势预设 id（须与 System Prompt 一致） */
export const DIRECTOR_POSE_PRESETS = ['stand', 'sit', 'run'] as const;

export type DirectorPosePresetId = (typeof DIRECTOR_POSE_PRESETS)[number];
