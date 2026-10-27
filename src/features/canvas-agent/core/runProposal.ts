import type { CanvasAction } from '../types';
import { COMBAT_PLAYBOOK_ID } from './combatStage';

const GENERATIVE_NODE_TYPES = new Set(['image', 'video', 'generator']);

/**
 * 成片只该有一个视频节点：一次生成包含完整分镜，不是多段视频拼接。
 * 视频模型时长不够时应换模型，而不是拆成多条。用户明确要分段/多版本时才放行。
 */
export function collapseMultiVideoProposal(
  actions: CanvasAction[],
  message: string,
): { actions: CanvasAction[]; dropped: number } {
  const videos = actions.filter((action) => (
    action.type === 'create_node' && action.nodeType === 'video'
  ));
  if (videos.length <= 1) return { actions, dropped: 0 };
  if (/分段|多个视频|拆成|拼接|多版本|多平台/.test(message)) {
    return { actions, dropped: 0 };
  }
  const droppedIds = new Set(videos.map((action) => (
    action.type === 'create_node' ? String(action.tempId || '') : ''
  )).filter(Boolean));
  const kept = actions.filter((action) => (
    !(action.type === 'create_node' && action.nodeType === 'video')
    && !(action.type === 'execute_node_skill' && droppedIds.has(String(action.nodeId || '')))
  ));
  return { actions: kept, dropped: videos.length };
}

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
