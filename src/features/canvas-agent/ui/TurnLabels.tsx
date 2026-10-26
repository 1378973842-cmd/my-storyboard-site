import { useEffect, useState, type ReactNode } from 'react';
import { FileText, Image as ImageIcon, Video } from 'lucide-react';
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
    <details className="canvas-agent-turn-label" open>
      <summary>思考过程</summary>
      {children}
    </details>
  );
}

type MediaKind = 'image' | 'video' | 'text';

function MediaKindIcon({ kind }: { kind: MediaKind }) {
  if (kind === 'video') return <Video aria-hidden="true" />;
  if (kind === 'text') return <FileText aria-hidden="true" />;
  return <ImageIcon aria-hidden="true" />;
}

export function MediaLabelView({
  label,
  preview,
  error,
  kind = 'image',
}: {
  label: string;
  preview?: string;
  error?: string;
  kind?: MediaKind;
}) {
  const video = Boolean(preview && /\.(mp4|webm|mov|m4v)(\?|$)/i.test(preview));
  return (
    <div className="canvas-agent-turn-label" data-collapsed="false">
      <p>
        <span className="canvas-agent-turn-icon"><MediaKindIcon kind={kind} /></span>
        {label}
      </p>
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
          return <MediaLabelView key={item.id} label="创作文本已保存" kind="text" />;
        }
        const node = snapshot.nodes.find((entry) => entry.id === item.id);
        const state = mediaRunState(node);
        const raw = node?.agentLastError;
        const error = state === 'failed' && raw && typeof raw === 'object'
          ? String((raw as { message?: unknown }).message || '')
          : '';
        const kind: MediaKind = item.nodeType === 'video'
          ? 'video'
          : item.nodeType === 'text' || item.nodeType === 'prompt' ? 'text' : 'image';
        return (
          <MediaLabelView
            key={item.id}
            label={mediaStatusLabel(item.nodeType, state)}
            preview={state === 'generated' ? mediaOutputUrls(node)[0] : ''}
            error={error}
            kind={kind}
          />
        );
      })}
    </>
  );
}
