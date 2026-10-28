import type { AskAnswer } from './askCard';

export type RunCardSettlement = {
  answer: AskAnswer;
  /** 这张卡对应的提案要结算成 discarded */
  discard: boolean;
  /** 要把答复发给服务端，让它知道这张卡已经不会被回答 */
  send: boolean;
  /** 批准被 scope 判过期 */
  expired: boolean;
};

/**
 * 审批卡结算判据：
 * - 批准且 scope 有效：正常放行，不 discard
 * - 批准但 scope 失效：改答「已过期」，discard 提案，并且仍然发答复
 * - 拒绝：discard 提案，并且发答复
 * - 普通提问卡：只发答复
 *
 * 过期分支必须 send=true：只 discard 不发答复，服务端 hasPendingRunApproval 会一直为 true。
 */
export function settleRunCardAnswer(answer: AskAnswer, live: boolean): RunCardSettlement {
  if (answer.mode !== 'approve_run_node') {
    return { answer, discard: false, send: true, expired: false };
  }
  if (answer.selected[0] === '批准') {
    if (live) return { answer, discard: false, send: true, expired: false };
    return {
      answer: { ...answer, selected: ['已过期'] },
      discard: true,
      send: true,
      expired: true,
    };
  }
  return { answer, discard: true, send: true, expired: false };
}

/** 离线夹具用：把结算决定落成两笔可观察的写操作。 */
export function applyRunCardSettlement(
  settlement: RunCardSettlement,
  io: { discard: () => void; send: () => void },
): void {
  if (settlement.discard) io.discard();
  if (settlement.send) io.send();
}
