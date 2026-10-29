/**
 * 特效打斗的阶段闸。
 *
 * 按 skill 原设计分四段（外加方案确认）：
 *   direction   风格定向（画风 / 特效风格 / 动作风格 / 叙事节奏）
 *   proposal    整合成个性化方案，让用户确认方向（skill STEP 2）
 *   params      六项参数（角色资产、比例、分辨率、场景、时长、强度；打斗再加对手）
 *   storyboard  分镜
 *   production  提示词与生成
 *
 * 服务端只做一件事：没到 storyboard 之前，丢掉建/连/改/运行的动作。
 * 其它技能完全不受影响。
 *
 * 逃生口：用户明确说「跳过准备 / 直接做 / 不用问」→ 直接 production。
 */
export const COMBAT_PLAYBOOK_ID = 'canvas-combat-fx';
export const COMBAT_STAGES = ['direction', 'proposal', 'params', 'storyboard', 'production'] as const;
export type CombatStage = typeof COMBAT_STAGES[number];

export type CombatStageReason =
  | 'not-combat'
  | 'production'
  | 'storyboard'
  | 'answered'
  | 'params-ready'
  | 'escape'
  | 'blocked-direction'
  | 'blocked-params'
  | 'blocked-anchor'
  | 'blocked-opponent-anchor'
  | 'blocked-scene-anchor'
  | 'blocked-anchor-review';

export type CombatStageDecision = {
  blocked: boolean;
  advanceTo: CombatStage | null;
  reason: CombatStageReason;
  /** 被拦时给用户的话（带当前阶段该问什么） */
  notice: string;
};

const ESCAPE = /跳过(准备|提问)?|直接做|直接来|不用问|别问|不要问/;

const NEXT_STAGE: Record<CombatStage, CombatStage | null> = {
  direction: 'proposal',
  proposal: 'params',
  params: 'storyboard',
  storyboard: 'production',
  production: null,
};

export const COMBAT_STAGE_NOTICES: Record<CombatStage, string> = {
  direction: [
    '先把主角和方向定下来，再动画面。',
    '',
    '0. 主角：用画布里的参考（比如阿波罗），还是新角色？用户没点名时先问这个，不要默认。',
    '1. 画风：偏写实（真人质感）还是偏二次元（国漫/日漫/3D 卡通）',
    '2. 特效风格：有没有喜欢的游戏/动漫技能参考（鬼灭呼吸、原神元素爆发等）',
    '3. 动作风格：快速连击 / 蓄力一击 / 舞步式 / 野蛮压制',
    '4. 叙事节奏：完整故事弧（建立→蓄力→爆发→收束）还是直接上高潮',
    '',
    '回答后我会整合成一套具体方案，再和你确认。',
  ].join('\n'),
  proposal: [
    '把刚才的回答整合成一套具体方案，先让用户确认方向：',
    '',
    '- 风格 / 特效 / 动作节奏 / 叙事结构各一句',
    '- 主动给 1-2 个创意建议',
    '- 只问「这个方向可以吗」，确认后再收六项参数',
    '',
    '方向确认前，不建节点、不写分镜。',
  ].join('\n'),
  params: [
    '用户消息、draft.md、index.md 里已有的参数都算确认，不再打印六项问卷。',
    '',
    '只补问确实缺失的项；没有缺失就直接 create_canvas_nodes 建锚点节点，然后写 anchors.md 并完成锚点。',
  ].join('\n'),
  storyboard: '分镜阶段：先排 SB-01～04 和节拍，再写提示词。',
  production: '制作阶段：提示词与生成。运行仍然要审批卡。',
};

export const COMBAT_ANCHOR_NOTICE = [
  '角色参考还没确认，先别写分镜。',
  '',
  '两个选择：',
  '1. 用画布里的参考图（在消息里 @ 它）',
  '2. 先让我出一张三视图（正面/侧面/背面），你确认后我再往下走',
].join('\n');

export const COMBAT_OPPONENT_NOTICE = [
  '主角参考已确认，但对手还没有参考。',
  '',
  '两个选择：',
  '1. 用画布里的对手图（在消息里 @ 它）',
  '2. 先让我出对手三视图，你确认后再写分镜',
].join('\n');

export const COMBAT_SCENE_NOTICE = [
  '场景参考还没确认。',
  '',
  '两个选择：',
  '1. 用画布里的场景图（在消息里 @ 它，我会做视觉分析）',
  '2. 让我生成一张场景图，你确认后再写分镜',
].join('\n');

export const COMBAT_REVIEW_NOTICE = [
  '锚点图还没审阅，先别写分镜。',
  '',
  '三张图（主角/对手/场景）要先过一遍：比例、画风、服装武器是否一致。',
  '1. 一致，可以进分镜',
  '2. 有问题，需要重画（说明哪里不对）',
].join('\n');

export function combatStageDecision(input: {
  playbookId: string;
  stage: string;
  message: string;
  answering: boolean;
  /** 主角锚点是否已确认（参考图或已确认的三视图） */
  hasAnchor: boolean;
  /** 对手锚点是否已确认；不传视为已确认（兼容旧调用） */
  hasOpponentAnchor?: boolean;
  /** 场景锚点是否已确认；不传视为已确认（兼容旧调用） */
  hasSceneAnchor?: boolean;
  /** 三视图锚点是否还有未审阅的；true 表示缺审阅 */
  reviewMissing?: boolean;
}): CombatStageDecision {
  const stage = (COMBAT_STAGES as readonly string[]).includes(input.stage)
    ? input.stage as CombatStage
    : 'direction';
  const notice = COMBAT_STAGE_NOTICES[stage];
  if (input.playbookId !== COMBAT_PLAYBOOK_ID) {
    return { blocked: false, advanceTo: null, reason: 'not-combat', notice };
  }
  if (stage === 'production') {
    return { blocked: false, advanceTo: null, reason: 'production', notice };
  }
  if (stage === 'storyboard' && !input.hasAnchor) {
    return { blocked: true, advanceTo: null, reason: 'blocked-anchor', notice: COMBAT_ANCHOR_NOTICE };
  }
  if (stage === 'storyboard' && input.hasOpponentAnchor === false) {
    return { blocked: true, advanceTo: null, reason: 'blocked-opponent-anchor', notice: COMBAT_OPPONENT_NOTICE };
  }
  if (stage === 'storyboard' && input.hasSceneAnchor === false) {
    return { blocked: true, advanceTo: null, reason: 'blocked-scene-anchor', notice: COMBAT_SCENE_NOTICE };
  }
  if (stage === 'storyboard' && input.reviewMissing) {
    return { blocked: true, advanceTo: null, reason: 'blocked-anchor-review', notice: COMBAT_REVIEW_NOTICE };
  }
  if (stage === 'storyboard') {
    return { blocked: false, advanceTo: null, reason: 'storyboard', notice };
  }
  if (ESCAPE.test(input.message)) {
    return { blocked: false, advanceTo: 'production', reason: 'escape', notice };
  }
  if (input.answering) {
    // 锚点是「参数 → 分镜」的门槛；方向/方案阶段先放行，别在第一步就卡角色图。
    if (stage === 'params') {
      if (!input.hasAnchor) {
        return { blocked: true, advanceTo: null, reason: 'blocked-anchor', notice: COMBAT_ANCHOR_NOTICE };
      }
      if (input.hasOpponentAnchor === false) {
        return { blocked: true, advanceTo: null, reason: 'blocked-opponent-anchor', notice: COMBAT_OPPONENT_NOTICE };
      }
      if (input.hasSceneAnchor === false) {
        return { blocked: true, advanceTo: null, reason: 'blocked-scene-anchor', notice: COMBAT_SCENE_NOTICE };
      }
      if (input.reviewMissing) {
        return { blocked: true, advanceTo: null, reason: 'blocked-anchor-review', notice: COMBAT_REVIEW_NOTICE };
      }
    }
    // 每答完一轮提问，往前推一段：方向 → 方案 → 参数 → 分镜
    return { blocked: false, advanceTo: NEXT_STAGE[stage], reason: 'answered', notice };
  }
  if (stage === 'params') {
    // 参数阶段不再用服务端文案阻塞：已有参数由模型/账本判断缺失，直接允许建锚点。
    return { blocked: false, advanceTo: null, reason: 'params-ready', notice };
  }
  return {
    blocked: true,
    advanceTo: null,
    reason: stage === 'direction' ? 'blocked-direction' : 'blocked-params',
    notice,
  };
}

/** 兼容旧引用：默认阶段提示。 */
export const COMBAT_STAGE_NOTICE = COMBAT_STAGE_NOTICES.direction;
