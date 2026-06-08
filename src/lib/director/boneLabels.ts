/** Mixamo 骨骼英文名 -> 中文显示名 */
const BONE_LABELS: Record<string, string> = {
  mixamorig_Hips: '髋部（根骨骼）',
  mixamorig_Spine: '脊柱（下）',
  mixamorig_Spine1: '脊柱（中）',
  mixamorig_Spine2: '脊柱（上）',
  mixamorig_Neck: '颈部',
  mixamorig_Head: '头部',
  mixamorig_HeadTop_End: '头顶端点',
  mixamorig_LeftShoulder: '左肩',
  mixamorig_RightShoulder: '右肩',
  mixamorig_LeftArm: '左上臂',
  mixamorig_RightArm: '右上臂',
  mixamorig_LeftForeArm: '左前臂',
  mixamorig_RightForeArm: '右前臂',
  mixamorig_LeftHand: '左手',
  mixamorig_RightHand: '右手',
  mixamorig_LeftHandThumb1: '左拇指 1',
  mixamorig_LeftHandThumb2: '左拇指 2',
  mixamorig_LeftHandThumb3: '左拇指 3',
  mixamorig_LeftHandThumb4: '左拇指尖',
  mixamorig_LeftHandIndex1: '左食指 1',
  mixamorig_LeftHandIndex2: '左食指 2',
  mixamorig_LeftHandIndex3: '左食指 3',
  mixamorig_LeftHandIndex4: '左食指尖',
  mixamorig_LeftHandMiddle1: '左中指 1',
  mixamorig_LeftHandMiddle2: '左中指 2',
  mixamorig_LeftHandMiddle3: '左中指 3',
  mixamorig_LeftHandMiddle4: '左中指尖',
  mixamorig_LeftHandRing1: '左无名指 1',
  mixamorig_LeftHandRing2: '左无名指 2',
  mixamorig_LeftHandRing3: '左无名指 3',
  mixamorig_LeftHandRing4: '左无名指尖',
  mixamorig_LeftHandPinky1: '左小指 1',
  mixamorig_LeftHandPinky2: '左小指 2',
  mixamorig_LeftHandPinky3: '左小指 3',
  mixamorig_LeftHandPinky4: '左小指尖',
  mixamorig_RightHandThumb1: '右拇指 1',
  mixamorig_RightHandThumb2: '右拇指 2',
  mixamorig_RightHandThumb3: '右拇指 3',
  mixamorig_RightHandThumb4: '右拇指尖',
  mixamorig_RightHandIndex1: '右食指 1',
  mixamorig_RightHandIndex2: '右食指 2',
  mixamorig_RightHandIndex3: '右食指 3',
  mixamorig_RightHandIndex4: '右食指尖',
  mixamorig_RightHandMiddle1: '右中指 1',
  mixamorig_RightHandMiddle2: '右中指 2',
  mixamorig_RightHandMiddle3: '右中指 3',
  mixamorig_RightHandMiddle4: '右中指尖',
  mixamorig_RightHandRing1: '右无名指 1',
  mixamorig_RightHandRing2: '右无名指 2',
  mixamorig_RightHandRing3: '右无名指 3',
  mixamorig_RightHandRing4: '右无名指尖',
  mixamorig_RightHandPinky1: '右小指 1',
  mixamorig_RightHandPinky2: '右小指 2',
  mixamorig_RightHandPinky3: '右小指 3',
  mixamorig_RightHandPinky4: '右小指尖',
  mixamorig_LeftUpLeg: '左大腿',
  mixamorig_RightUpLeg: '右大腿',
  mixamorig_LeftLeg: '左小腿',
  mixamorig_RightLeg: '右小腿',
  mixamorig_LeftFoot: '左脚',
  mixamorig_RightFoot: '右脚',
  mixamorig_LeftToeBase: '左脚趾',
  mixamorig_RightToeBase: '右脚趾',
  mixamorig_LeftToe_End: '左脚趾端点',
  mixamorig_RightToe_End: '右脚趾端点',
};

const PART_ZH: Record<string, string> = {
  Hips: '髋部',
  Spine: '脊柱',
  Neck: '颈部',
  Head: '头部',
  Shoulder: '肩',
  Arm: '臂',
  ForeArm: '前臂',
  Hand: '手',
  UpLeg: '大腿',
  Leg: '小腿',
  Foot: '脚',
  ToeBase: '脚趾',
};

function fallbackBoneLabel(boneName: string): string {
  const raw = boneName.replace(/^mixamorig_/, '');
  const side = raw.startsWith('Left')
    ? '左'
    : raw.startsWith('Right')
      ? '右'
      : '';
  const rest = raw.replace(/^Left|^Right/, '');
  for (const [key, zh] of Object.entries(PART_ZH)) {
    if (rest.startsWith(key)) {
      const suffix = rest.slice(key.length).replace(/^\d+/, (m) => ` ${m}`);
      return `${side}${zh}${suffix}`.trim();
    }
  }
  return raw || boneName;
}

export function getBoneLabel(boneName: string): string {
  return BONE_LABELS[boneName] ?? fallbackBoneLabel(boneName);
}

/** 骨骼分组，便于折叠列表 */
export function getBoneGroup(boneName: string): string {
  if (/Head|Neck/i.test(boneName)) return '头颈';
  if (/Spine|Hips/i.test(boneName)) return '躯干';
  if (/Hand|Arm|Shoulder|Finger|Thumb|Index|Middle|Ring|Pinky/i.test(boneName)) {
    return boneName.includes('Left') ? '左臂与手' : boneName.includes('Right') ? '右臂与手' : '手臂';
  }
  if (/Leg|Foot|Toe|UpLeg/i.test(boneName)) {
    return boneName.includes('Left') ? '左腿' : boneName.includes('Right') ? '右腿' : '腿部';
  }
  return '其他';
}

export const BONE_GROUP_ORDER = ['躯干', '头颈', '左臂与手', '右臂与手', '左腿', '右腿', '其他', '手臂', '腿部'];
