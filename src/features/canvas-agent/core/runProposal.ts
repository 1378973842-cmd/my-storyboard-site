import type { CanvasAction } from '../types';
import { COMBAT_PLAYBOOK_ID } from './combatStage';

const GENERATIVE_NODE_TYPES = new Set(['image', 'video', 'generator']);

/**
 * 特效打斗：一轮里新建了可生成节点、却没有提运行请求时，自动补一个运行动作。
 * 运行仍然要用户在卡片上批准；这里只是把「去画布点生成」换成「卡片上点批准」。
 */
export function appendRunProposalForNewGenerativeNodes(
  playbookId: string,
  actions: CanvasAction[],
): CanvasAction[] {
  if (playbookId !== COMBAT_PLAYBOOK_ID) return actions;
  if (actions.some((action) => action.type === 'execute_node_skill')) return actions;
  const tempIds = actions
    .flatMap((action) => (
      action.type === 'create_node'
      && action.tempId
      && GENERATIVE_NODE_TYPES.has(action.nodeType)
        ? [action.tempId]
        : []
    ));
  if (!tempIds.length) return actions;
  return [
    ...actions,
    ...tempIds.map((tempId) => ({ type: 'execute_node_skill' as const, nodeId: tempId })),
  ];
}
