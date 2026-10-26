import type { ReactNode } from 'react';

export type TurnStepState = 'done' | 'active' | 'pending' | 'failed';

export type TurnStep = {
  label: string;
  state: TurnStepState;
};

/**
 * 一轮的推进顺序：分析 → 提问 → 提案 → 节点。
 * 只做展示，状态由调用方从消息/提案/画布现算。
 */
export function TurnTimeline({ steps }: { steps: TurnStep[] }): ReactNode {
  if (steps.length < 2) return null;
  return (
    <ol className="canvas-agent-timeline" aria-label="本轮进度">
      {steps.map((step, index) => (
        <li key={`${step.label}-${index}`} className={`is-${step.state}`}>
          <span className="canvas-agent-timeline-dot" aria-hidden="true" />
          <span className="canvas-agent-timeline-label">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}
