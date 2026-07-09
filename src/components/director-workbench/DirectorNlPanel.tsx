import { useState } from 'react';
import { Loader2, Sparkles, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { parseSceneDataPayload } from '../../lib/director/parseSceneData';
import { useDirectorSceneStore } from '../../store/useDirectorSceneStore';
import { useStore } from '../../store/useStore';

/** 自然语言调机位 / 摆人偶（调用 /api/director-scene） */
export function DirectorNlPanel({ onClose }: { onClose?: () => void }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const applySceneData = useDirectorSceneStore((s) => s.applySceneData);
  const addNotice = useStore((s) => s.addNotice);

  const handleSubmit = async () => {
    const instruction = text.trim();
    if (!instruction || busy) return;
    setBusy(true);
    try {
      const state = useDirectorSceneStore.getState();
      const snapshot = {
        selectedCameraId: state.selectedCameraId,
        cameras: state.cameras.map((c) => ({
          id: c.id,
          position: c.position,
          rotation: c.rotation,
          fov: c.fov,
        })),
        characters: state.objects
          .filter((o) => o.type === 'character')
          .map((o) => ({
            id: o.id,
            name: o.name,
            position: o.position,
            rotation: o.rotation,
          })),
        posePresets: ['stand', 'sit', 'run', ...state.savedPoses.map((p) => p.name)],
      };

      const res = await fetch('/api/director-scene', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instruction, snapshot }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || `请求失败 ${res.status}`);
      }
      const scene = parseSceneDataPayload(data.sceneData ?? data);
      if (!scene) throw new Error('模型返回无法解析为 SceneData');
      applySceneData(scene);
      addNotice('已应用导演指令');
      setText('');
    } catch (e) {
      addNotice(e instanceof Error ? e.message : '导演指令失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className={cn(
        'absolute bottom-4 right-4 z-20 w-[300px] max-w-[min(300px,calc(100%-2rem))]',
        'rounded-2xl p-3 ai-editor-panel director-floating-panel space-y-2',
      )}
    >
      <div className="flex items-center gap-2">
        <Sparkles className="w-3.5 h-3.5 text-secondary shrink-0" />
        <p className="cover-section-label mb-0 text-[11px] flex-1">口语调机位</p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-on-surface/45 hover:text-on-surface hover:bg-white/8"
            title="关闭"
          >
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        placeholder="例如：把相机抬高一点并拉远；让人偶 1 坐下面向左侧"
        className={cn(
          'w-full resize-none rounded-lg bg-white/[0.05] px-2.5 py-2 text-[12px] text-[#e5e2e1]',
          'outline outline-[0.5px] outline-white/12 placeholder:text-white/30',
        )}
        disabled={busy}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void handleSubmit();
          }
        }}
      />
      <button
        type="button"
        disabled={busy || !text.trim()}
        onClick={() => void handleSubmit()}
        className={cn(
          'w-full inline-flex items-center justify-center gap-1.5 rounded-full py-1.5 text-[12px] font-medium',
          busy || !text.trim() ? 'opacity-40 cursor-not-allowed ai-editor-btn-secondary' : 'cover-hero-cta',
        )}
      >
        {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
        {busy ? '应用中…' : '应用指令'}
      </button>
      <p className="ai-editor-body text-[10px] opacity-55">Ctrl/⌘ + Enter 发送</p>
    </div>
  );
}
