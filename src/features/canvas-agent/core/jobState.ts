/**
 * Agent 作业的状态机。作业代表「一轮 Agent 任务」，不是一次 HTTP 请求：
 * 关页面、断线、刷新都不改变它，只有事件能推动它。
 *
 * queued → running → waiting_approval → executing → done
 *                       ↘ fail / cancel 到终止态
 */
export const AGENT_JOB_STATUSES = [
  'queued',
  'running',
  'waiting_approval',
  'executing',
  'done',
  'failed',
  'cancelled',
] as const;

export type AgentJobStatus = (typeof AGENT_JOB_STATUSES)[number];
export type AgentJobEvent = 'start' | 'ask' | 'execute' | 'continue' | 'finish' | 'fail' | 'cancel';

type Transition = { from: readonly AgentJobStatus[]; to: AgentJobStatus };

const TRANSITIONS: Record<AgentJobEvent, Transition> = {
  start: { from: ['queued'], to: 'running' },
  ask: { from: ['running'], to: 'waiting_approval' },
  execute: { from: ['waiting_approval'], to: 'executing' },
  // 观察完、用户点「继续下一步」：同一份作业回到 running，再规划一步。
  // 也允许从 done 回来：落板结算时可能已经把作业收尾，继续是人为决定重开。
  continue: { from: ['executing', 'waiting_approval', 'done'], to: 'running' },
  finish: { from: ['running', 'waiting_approval', 'executing'], to: 'done' },
  fail: { from: ['queued', 'running', 'waiting_approval', 'executing'], to: 'failed' },
  cancel: { from: ['queued', 'running', 'waiting_approval', 'executing'], to: 'cancelled' },
};

export function nextAgentJobStatus(
  status: AgentJobStatus,
  event: AgentJobEvent,
): AgentJobStatus | null {
  const rule = TRANSITIONS[event];
  if (!rule || !rule.from.includes(status)) return null;
  return rule.to;
}

export function isTerminalAgentJob(status: AgentJobStatus): boolean {
  return status === 'done' || status === 'failed' || status === 'cancelled';
}

/** 还占着「这轮没结束」的作业：重连时要找回它。 */
export function isActiveAgentJob(status: AgentJobStatus): boolean {
  return !isTerminalAgentJob(status);
}
