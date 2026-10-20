import type { ProposalStatus } from '../types';

/**
 * 停靠面板：top 72 + bottom 16 + 顶栏 58 + 输入区 124 + 消息区内边距 50 = 320。
 * 消息区可视高度 = 100vh - 320。
 * 展开的待确认卡片约 183px（内边距 32 + 角标行 26 + 一行摘要 39 + 一行动作 16 + 按钮 52 + 卡片间距 18）。
 * 宽于 720px 时面板仍是右侧整列。1366×768 这种短窗口里可视约 448px：
 * 2×183 = 366 放得下，3×183 = 549 放不下。所以第一、二档默认展开最多 2 张。
 */
export const PROPOSAL_OPEN_CAP = 2;

const DISPLAY_TIER: Record<ProposalStatus, number> = {
  pending: 0,
  applying: 0,
  exec_failed: 1,
  partial: 1,
  failed: 1,
  applied: 2,
  expired: 2,
  discarded: 2,
};

export function proposalDisplayTier(status: ProposalStatus): number {
  return DISPLAY_TIER[status];
}

export function sortProposalsForDisplay<T extends { status: ProposalStatus; createdAt: number }>(
  items: readonly T[],
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const tier = proposalDisplayTier(a.item.status) - proposalDisplayTier(b.item.status);
      if (tier) return tier;
      if (a.item.createdAt !== b.item.createdAt) return b.item.createdAt - a.item.createdAt;
      return a.index - b.index;
    })
    .map((entry) => entry.item);
}

/** tier12Index 是排序后、第一和第二档里的序号，从 0 起。第三档永远默认收起。 */
export function proposalDefaultOpen(status: ProposalStatus, tier12Index: number): boolean {
  return proposalDisplayTier(status) < 2 && tier12Index < PROPOSAL_OPEN_CAP;
}

export function proposalTimeLabel(createdAt: number): string {
  if (!createdAt) return '';
  const date = new Date(createdAt);
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${date.getMonth() + 1}/${date.getDate()} ${hour}:${minute}`;
}
