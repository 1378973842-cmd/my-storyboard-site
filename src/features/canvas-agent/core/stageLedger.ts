import { effectedLine, type EffectedNode, type MediaRunState } from './effectLedger';
import type { CanvasAction } from '../types';

// ponytail: 一批落板动作取映射到的最大步骤。同批既改提示词又执行视频时记成执行那一步。
// 升级路径是按节点拆开。推不出时返回 null，调用方不覆盖旧值。
export function inferAppliedPlaybookStage(
  playbookId: string,
  actions: CanvasAction[],
  typeOf: (id: string) => string,
): number | null {
  const story = playbookId === 'canvas-video-piece';
  const opening = playbookId === 'canvas-opening-animation';
  if (!story && !opening) return null;
  const created = new Map<string, string>();
  for (const action of actions) {
    if (action.type === 'create_node' && action.tempId) created.set(action.tempId, action.nodeType);
  }
  const typeAt = (id: string) => created.get(id) || typeOf(id) || '';
  const steps: number[] = [];
  for (const action of actions) {
    if (action.type === 'create_node') {
      const step = story
        ? action.nodeType === 'generator' ? 1
          : action.nodeType === 'nineGridAgent' ? 2
            : action.nodeType === 'video' ? 3
              : 0
        : action.nodeType === 'video' ? 1 : 0;
      if (step) steps.push(step);
    } else if (action.type === 'update_node_params' && typeof action.patch?.prompt === 'string') {
      const kind = typeAt(action.nodeId);
      if (story && kind === 'video') steps.push(3);
      else if (story && kind === 'generator') steps.push(1);
      else if (opening && kind === 'video') steps.push(1);
    } else if (action.type === 'execute_node_skill') {
      const kind = typeAt(action.nodeId);
      if (story && kind === 'video') steps.push(4);
      else if (story && kind === 'nineGridAgent') steps.push(2);
      else if (story && kind === 'generator') steps.push(1);
      else if (opening && kind === 'video') steps.push(2);
    }
  }
  if (!steps.length) return null;
  return Math.max(...steps);
}

export function canvasAgentStageSegment(
  playbookId: string,
  stage: number,
  effected: readonly EffectedNode[] = [],
  states: Readonly<Record<string, MediaRunState>> = {},
): string {
  const title = playbookId === 'canvas-video-piece'
    ? '剧情动画'
    : playbookId === 'canvas-opening-animation'
      ? '开场动画'
      : playbookId;
  const line = effectedLine(effected, states);
  const head = `技能：${title} / 步骤：${stage}`;
  return `## 当前阶段\n${line ? `${head}\n${line}` : head}`;
}

/** 技能对得上才报步骤号。对不上时只报本会话已生效的节点。 */
export function canvasAgentStagePrefix(
  storedPlaybookId: string,
  stage: number | null,
  requestedPlaybookId: string,
  effected: readonly EffectedNode[] = [],
  states: Readonly<Record<string, MediaRunState>> = {},
): string {
  const line = effectedLine(effected, states);
  if (storedPlaybookId && storedPlaybookId === requestedPlaybookId && stage != null) {
    return `\n\n${canvasAgentStageSegment(storedPlaybookId, stage, effected, states)}`;
  }
  return line ? `\n\n## 当前阶段\n${line}` : '';
}
