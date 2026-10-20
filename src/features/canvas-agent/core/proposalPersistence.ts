import type { ActionProposal, CanvasAction } from '../types';
import { settleBatchProposal } from './proposal';

export type ProposalWriteQueue = Set<string>;

export type ProposalDiskOutcome = {
  status: ActionProposal['status'];
  error: string | null;
  partialSkipped: number | null;
  reason: string | null;
};

/** 缺省写成 null，重开时原样读回。空错误、缺失的跳过数和缺失的 reason 都是 null。 */
export function diskProposalOutcome(
  proposal: Pick<ActionProposal, 'status' | 'error' | 'partialSkipped' | 'reason'>,
): ProposalDiskOutcome {
  const skipped = proposal.partialSkipped;
  const reason = proposal.reason;
  return {
    status: proposal.status,
    error: typeof proposal.error === 'string' && proposal.error ? proposal.error : null,
    partialSkipped: typeof skipped === 'number' && Number.isFinite(skipped) ? skipped : null,
    reason: typeof reason === 'string' && reason ? reason : null,
  };
}

export function noteUnpersistedProposal(
  changes: number,
  proposal: Pick<ActionProposal, 'id' | 'inLibrary'>,
  queue: ProposalWriteQueue,
): 'hit' | 'skip' | 'queued' {
  if (changes > 0) {
    queue.delete(proposal.id);
    return 'hit';
  }
  if (proposal.inLibrary === false) return 'skip';
  // 竞态窗口 = 用户在 done 之前点了按钮。
  // done 是「assistant 行已插入」的确定信号，
  // 所以 0 行时不猜时机，入队等 done。
  //
  // done 不到的两类：
  // 1. followup 抛错走 catch、await 期间中止
  //    → 本来就没有 proposal 行，不补写是正确的。
  // 2. appendCanvasAgentMessage 已返回、
  //    但 sendEvent(done) 因连接断而抛错，
  //    或客户端在 reader.read() 读到 done 之前
  //    调了 stopStreaming
  //    → 行已在库里，这一侧的 done 分支不会跑，
  //      补写不发生，库里停在 pending，重开被收成 expired。
  //    这是已知且可接受的损失：
  //    断线时客户端无法知道那次插入有没有落成。
  //    不要在这一轮为它做额外补写。
  //
  // 补写必须自己 try/catch：
  // onEvent 是同步调用，抛出会让整次流失败。
  queue.add(proposal.id);
  return 'queued';
}

/** pending 才过期。其余状态原样留着，error、partialSkipped 和 reason 不删。竞态没补上的 pending 也在这里收成 expired。 */
export function proposalOnReopen<T extends { status: string }>(proposal: T): T {
  if (proposal.status !== 'pending') return proposal;
  return { ...proposal, status: 'expired' };
}

export function deliverProposalDone(
  assistantId: string,
  finishTurn: (id: string) => void,
  flush: () => void,
): void {
  finishTurn(assistantId);
  try {
    flush();
  } catch (error) {
    console.warn('[canvas-agent] proposal 结局补写失败:', error);
  }
}

export function flushProposalWriteQueue(
  queue: ProposalWriteQueue,
  lookup: (id: string) => ActionProposal | undefined,
  persist: (current: ActionProposal) => Promise<number>,
): void {
  const ids = [...queue];
  queue.clear();
  void (async () => {
    for (const id of ids) {
      const current = lookup(id);
      if (!current || current.inLibrary === false) continue;
      await persist(current);
    }
  })().catch((error) => {
    console.warn('[canvas-agent] proposal 结局补写失败:', error);
  });
}

type ApplyBatchResult<T> = {
  skippedCount: number;
  failedExecution?: { nodeId: string; message: string; reason?: string };
  choices: T[];
};

export async function runProposalApply<T>(
  proposal: ActionProposal,
  deps: {
    batchApply: (
      actions: CanvasAction[],
      onProgress?: (done: number, total: number) => void,
    ) => Promise<ApplyBatchResult<T>>;
    update: (id: string, patch: Partial<ActionProposal>) => void;
    current: () => ActionProposal | undefined;
    persist: (current: ActionProposal) => Promise<number>;
    queue: ProposalWriteQueue;
  },
): Promise<{ choices: T[] } | 'rejected'> {
  if (proposal.status !== 'pending') return 'rejected';
  deps.update(proposal.id, { status: 'applying', error: '' });
  let choices: T[] = [];
  try {
    const result = await deps.batchApply(proposal.actions, (done, total) => {
      deps.update(proposal.id, { progress: { done, total } });
    });
    choices = result.choices;
    const executionCount = proposal.actions.filter((action) => action.type === 'execute_node_skill').length;
    deps.update(
      proposal.id,
      settleBatchProposal(executionCount, result.skippedCount, result.failedExecution),
    );
  } catch (applyError) {
    deps.update(proposal.id, {
      status: 'failed',
      error: applyError instanceof Error ? applyError.message : String(applyError),
    });
  }
  const current = deps.current();
  if (!current) return { choices };
  try {
    const changes = await deps.persist(current);
    noteUnpersistedProposal(changes, proposal, deps.queue);
  } catch (error) {
    console.warn('[canvas-agent] proposal 结局写回失败:', error);
    noteUnpersistedProposal(0, proposal, deps.queue);
  }
  return { choices };
}
