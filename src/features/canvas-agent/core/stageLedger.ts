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

export function canvasAgentStageSegment(playbookId: string, stage: number): string {
  const title = playbookId === 'canvas-video-piece'
    ? '剧情动画'
    : playbookId === 'canvas-opening-animation'
      ? '开场动画'
      : playbookId;
  return `## 当前阶段\n技能：${title}\n步骤：${stage}`;
}

/** 和本次请求的技能不一致、或还没有阶段时，不加这段。 */
export function canvasAgentStagePrefix(
  storedPlaybookId: string,
  stage: number | null,
  requestedPlaybookId: string,
): string {
  if (!storedPlaybookId || storedPlaybookId !== requestedPlaybookId || stage == null) return '';
  return `\n\n${canvasAgentStageSegment(storedPlaybookId, stage)}`;
}
