import { useEffect, useState, type ReactNode } from 'react';
import { getCanvasSnapshot } from '../core/canvasFacade';
import {
  isSavedTextNode,
  mediaOutputUrls,
  mediaRunState,
  mediaStatusLabel,
  type EffectedNode,
} from '../core/effectLedger';

export function ThinkingFold({ text, children }: { text: string; children: ReactNode }) {
  if (!text.trim()) return null;
  return (
    <details className="canvas-agent-turn-label">
      <summary>思考过程</summary>
      {children}
    </details>
  );
}

export function MediaLabelView({
  label,
  preview,
  error,
}: {
  label: string;
  preview?: string;
  error?: string;
}) {
  const video = Boolean(preview && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(preview));
  return (
    <div className="canvas-agent-turn-label" data-collapsed="false">
      <p>{label}</p>
      {preview && video ? <video className="canvas-agent-turn-thumb" src={preview} muted /> : null}
      {preview && !video ? <img className="canvas-agent-turn-thumb" src={preview} alt="" /> : null}
      {error ? <p className="canvas-agent-turn-error">{error}</p> : null}
    </div>
  );
}

export function EffectLabels({ nodes }: { nodes: EffectedNode[] }) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const pending = () => nodes.some((item) => {
      if (isSavedTextNode(item.nodeType)) return false;
      const node = getCanvasSnapshot().nodes.find((entry) => entry.id === item.id);
      return mediaRunState(node) === 'created';
    });
    if (!pending()) return undefined;
    const timer = window.setInterval(() => {
      setRevision((value) => value + 1);
      if (!pending()) window.clearInterval(timer);
    }, 1500);
    return () => window.clearInterval(timer);
  }, [nodes, revision]);
  void revision;
  const snapshot = getCanvasSnapshot();
  return (
    <>
      {nodes.map((item) => {
        if (isSavedTextNode(item.nodeType)) {
          return <MediaLabelView key={item.id} label="创作文本已保存" />;
        }
        const node = snapshot.nodes.find((entry) => entry.id === item.id);
        const state = mediaRunState(node);
        const raw = node?.agentLastError;
        const error = state === 'failed' && raw && typeof raw === 'object'
          ? String((raw as { message?: unknown }).message || '')
          : '';
        return (
          <MediaLabelView
            key={item.id}
            label={mediaStatusLabel(item.nodeType, state)}
            preview={state === 'generated' ? mediaOutputUrls(node)[0] : ''}
            error={error}
          />
        );
      })}
    </>
  );
}
