import { motion } from 'framer-motion';
import { Check, Play, Plus, Unplug, X } from 'lucide-react';
import { actionDisplayLabel, actionReasonText, derivedStepTitle } from '../core/proposal';
import type { ActionProposal, CanvasAction } from '../types';
import { proposalTimeLabel } from './proposalOrder';

function ActionIcon({ action }: { action: CanvasAction }) {
  if (action.type === 'create_node') return <Plus aria-hidden="true" />;
  if (action.type === 'connect_nodes') return <Unplug aria-hidden="true" />;
  if (action.type === 'execute_node_skill') return <Play aria-hidden="true" />;
  return <Check aria-hidden="true" />;
}

export function ProposalPreviewCard({
  proposal,
  onApply,
  onDiscard,
  open = true,
  onToggle,
  clampLines,
  nodeLabels,
  canContinue = false,
  onContinue,
  canRollback = false,
  rollbackConfirm = false,
  onRollback,
}: {
  proposal: ActionProposal;
  onApply: (proposal: ActionProposal) => void;
  onDiscard: (proposal: ActionProposal) => void;
  open?: boolean;
  onToggle?: () => void;
  clampLines?: string[];
  nodeLabels?: Record<string, string>;
  canContinue?: boolean;
  onContinue?: () => void;
  canRollback?: boolean;
  rollbackConfirm?: boolean;
  onRollback?: () => void;
}) {
  // 只剩运行的提案由审批卡放行，这里的应用按钮挡不过运行闸，不出按钮。
  const runOnly = proposal.actions.length > 0 && proposal.actions.every((action) => action.type === 'execute_node_skill');
  const pending = proposal.status === 'pending' && !runOnly;
  const applying = proposal.status === 'applying';
  const settled = proposal.status === 'applied' || proposal.status === 'partial' || proposal.status === 'exec_failed';
  const stepTitle = settled
    ? (derivedStepTitle(proposal.actions, proposal.droppedConnects ?? 0) || proposal.title)
    : proposal.title;
  const timeLabel = proposalTimeLabel(proposal.createdAt);
  const head = (
    <>
      <span className={`canvas-agent-proposal-state is-${proposal.status}`}>
        {proposal.status === 'partial'
          ? '部分完成'
          : proposal.status === 'exec_failed'
            ? '已创建，执行失败'
          : proposal.status === 'applied'
            ? '已应用'
          : proposal.status === 'expired'
            ? '已过期'
          : proposal.status === 'discarded'
            ? '已放弃'
          : proposal.status === 'failed'
            ? '失败'
          : applying
            ? '应用中'
          : runOnly
            ? '等审批卡'
            : '待确认'}
      </span>
      <h4>{stepTitle}</h4>
      {timeLabel ? <time className="canvas-agent-proposal-time" dateTime={new Date(proposal.createdAt).toISOString()}>{timeLabel}</time> : null}
    </>
  );
  return (
    <motion.section
      className={`canvas-agent-proposal is-${proposal.status}${open ? '' : ' is-collapsed'}`}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
      aria-label={stepTitle}
    >
      <div className="canvas-agent-proposal-head">
        {onToggle ? (
          <button type="button" className="canvas-agent-proposal-toggle" aria-expanded={open} onClick={onToggle}>
            {head}
          </button>
        ) : (
          <div className="canvas-agent-proposal-toggle">{head}</div>
        )}
      </div>
      {open ? (
        <>
          <p>{proposal.summary}</p>
          <div className="canvas-agent-proposal-actions">
            {proposal.actions.slice(0, 6).map((action, index) => {
              const reason = actionReasonText(action);
              return (
                <div key={`${action.type}-${index}`} className="canvas-agent-proposal-action">
                  <ActionIcon action={action} />
                  <div className="canvas-agent-proposal-action-copy">
                    <span>{actionDisplayLabel(action, proposal.actions, (id) => nodeLabels?.[id] || id)}</span>
                    {reason ? <small>{reason}</small> : null}
                    {clampLines?.[index] ? <small className="canvas-agent-proposal-clamp">{clampLines[index]}</small> : null}
                  </div>
                </div>
              );
            })}
            {proposal.actions.length > 6 ? <small>另有 {proposal.actions.length - 6} 项</small> : null}
          </div>
          {proposal.status === 'partial' && proposal.partialSkipped != null ? (
            <p className="canvas-agent-proposal-error">{proposal.partialSkipped} 个节点被跳过，没有产出。</p>
          ) : null}
          {proposal.error ? <div className="canvas-agent-proposal-error">{proposal.error}</div> : null}
          {pending || applying ? (
            <div className="canvas-agent-proposal-buttons">
              <button type="button" onClick={() => onApply(proposal)} disabled={applying}>
                <Check aria-hidden="true" />
                {applying
                  ? (proposal.progress
                    ? `正在应用… (${proposal.progress.done}/${proposal.progress.total})`
                    : '正在应用…')
                  : '一键应用到画布'}
              </button>
              <button type="button" onClick={() => onDiscard(proposal)} disabled={applying}>
                <X aria-hidden="true" />
                放弃
              </button>
            </div>
          ) : null}
          {canContinue && onContinue && settled ? (
            <div className="canvas-agent-proposal-buttons">
              <button type="button" onClick={onContinue}>
                继续下一步
              </button>
            </div>
          ) : null}
          {canRollback && onRollback && settled ? (
            <div className="canvas-agent-proposal-buttons">
              <button type="button" onClick={onRollback}>
                {rollbackConfirm ? '确认撤销这次应用' : '撤销这次应用'}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </motion.section>
  );
}
