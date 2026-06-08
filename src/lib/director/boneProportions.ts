import type { Bone } from 'three';

/** 各部位 → Mixamo 骨骼（统一 scale，约等于拉长/缩短该段） */
export const PROPORTION_BONES = {
  head: ['mixamorig_Neck', 'mixamorig_Head'],
  torso: ['mixamorig_Spine', 'mixamorig_Spine1', 'mixamorig_Spine2'],
  shoulder: ['mixamorig_LeftShoulder', 'mixamorig_RightShoulder'],
  upperArm: ['mixamorig_LeftArm', 'mixamorig_RightArm'],
  forearm: ['mixamorig_LeftForeArm', 'mixamorig_RightForeArm'],
  hand: ['mixamorig_LeftHand', 'mixamorig_RightHand'],
  thigh: ['mixamorig_LeftUpLeg', 'mixamorig_RightUpLeg'],
  calf: ['mixamorig_LeftLeg', 'mixamorig_RightLeg'],
  foot: ['mixamorig_LeftFoot', 'mixamorig_RightFoot'],
} as const;

export type ProportionKey = keyof typeof PROPORTION_BONES;

/** 左侧栏展示顺序与文案（对齐参考图部位） */
export const PROPORTION_CONTROLS: { key: ProportionKey; label: string }[] = [
  { key: 'head', label: '头颈长短' },
  { key: 'torso', label: '躯干长短' },
  { key: 'shoulder', label: '肩宽' },
  { key: 'upperArm', label: '上臂长短' },
  { key: 'forearm', label: '前臂长短' },
  { key: 'hand', label: '手掌大小' },
  { key: 'thigh', label: '大腿长短' },
  { key: 'calf', label: '小腿长短' },
  { key: 'foot', label: '脚长' },
];

export type ProportionMap = Record<ProportionKey, number>;

export const DEFAULT_PROPORTIONS: ProportionMap = Object.fromEntries(
  PROPORTION_CONTROLS.map(({ key }) => [key, 1]),
) as ProportionMap;

const MIN = 0.75;
const MAX = 1.35;

type LegacyProportions = Partial<ProportionMap> & { leg?: number };

/** 兼容旧工程里的 leg 字段（原「腿部长短」→ 大腿 + 小腿） */
export function normalizeProportions(raw?: LegacyProportions): ProportionMap {
  const legacyLeg = raw?.leg;
  const { leg: _drop, ...rest } = raw ?? {};
  const next = { ...DEFAULT_PROPORTIONS, ...rest };
  if (legacyLeg != null) {
    if (raw?.thigh === undefined) next.thigh = legacyLeg;
    if (raw?.calf === undefined) next.calf = legacyLeg;
  }
  for (const { key } of PROPORTION_CONTROLS) {
    next[key] = Math.min(MAX, Math.max(MIN, next[key] ?? 1));
  }
  return next;
}

export function applyBoneProportions(bones: Map<string, Bone>, proportions: ProportionMap) {
  const map = normalizeProportions(proportions);
  for (const key of Object.keys(PROPORTION_BONES) as ProportionKey[]) {
    const s = map[key];
    for (const name of PROPORTION_BONES[key]) {
      const bone = bones.get(name);
      if (bone) bone.scale.set(s, s, s);
    }
  }
}
