/**
 * 特效打斗的阶段闸。
 *
 * 只做一件事：在「准备」阶段拦下建节点/连线/改参数/运行，逼模型先把
 * 主角、对手、风格、时长问清楚。其它技能完全不受影响。
 *
 * 逃生口：用户明确说「跳过/直接做/不用问」，或在消息里点名了对手。
 */
export const COMBAT_PLAYBOOK_ID = 'canvas-combat-fx';
export const COMBAT_STAGE_PREPARE = 'prepare';
export const COMBAT_STAGE_BUILD = 'build';

export type CombatStageReason =
  | 'not-combat'
  | 'building'
  | 'answered'
  | 'explicit-opponent'
  | 'escape'
  | 'blocked';

export type CombatStageDecision = {
  /** true = 这一轮的动作全部丢掉 */
  blocked: boolean;
  /** 有值就把会话阶段推进到它 */
  advanceTo: typeof COMBAT_STAGE_BUILD | null;
  reason: CombatStageReason;
};

const ESCAPE = /跳过(准备|提问)?|直接做|直接来|不用问|别问|不要问/;
const OPPONENT = /对手\s*[:：是]|敌人\s*[:：是]|反派\s*[:：是]|对战\s*[:：]?\s*\S/;

export function combatStageDecision(input: {
  playbookId: string;
  stage: string;
  message: string;
  /** 这一轮是在回答提问卡 */
  answering: boolean;
}): CombatStageDecision {
  if (input.playbookId !== COMBAT_PLAYBOOK_ID) {
    return { blocked: false, advanceTo: null, reason: 'not-combat' };
  }
  if (input.stage === COMBAT_STAGE_BUILD) {
    return { blocked: false, advanceTo: null, reason: 'building' };
  }
  if (input.answering) {
    return { blocked: false, advanceTo: COMBAT_STAGE_BUILD, reason: 'answered' };
  }
  if (ESCAPE.test(input.message)) {
    return { blocked: false, advanceTo: COMBAT_STAGE_BUILD, reason: 'escape' };
  }
  if (OPPONENT.test(input.message)) {
    return { blocked: false, advanceTo: COMBAT_STAGE_BUILD, reason: 'explicit-opponent' };
  }
  return { blocked: true, advanceTo: null, reason: 'blocked' };
}

/** 被拦下时给用户的话。有提问卡时由卡承载问题，这句只做说明。 */
export const COMBAT_STAGE_NOTICE = [
  '打斗至少需要两个角色，我先把该确认的确认掉，再动画面。',
  '',
  '1. 主角是谁（用画布里的阿波罗，还是新角色）',
  '2. 对手是谁（这一项不能由我替你编）',
  '3. 风格与色调（金白神圣 / 冷灰写实 / 其他）',
  '4. 时长与强度（例如 10 秒、炫技）',
  '',
  '确认完我就按「分镜 → 关键帧 → 视频」往下走。不想走准备阶段的话，直接说「跳过准备」。',
].join('\n');
