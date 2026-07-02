import { useEffect, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { PROPORTION_CONTROLS } from '../../lib/director/boneProportions';
import { getSelectedSceneObject, useDirectorSceneStore } from '../../store/useDirectorSceneStore';
import { DirectorPoseLibrary } from './DirectorPoseLibrary';
import { SkeletonControlPanel } from './SkeletonControlPanel';

const PALETTE = ['#7ec8f8', '#f87171', '#4ade80', '#ffb866', '#c084fc', '#e5e2e1'];

type Props = {
  onDismiss: () => void;
};

/** 选中人偶时的固定右侧检查器：颜色 / 比例 / 姿势 / 骨骼 */
export function DirectorCharacterInspector({ onDismiss }: Props) {
  const selectedObject = useDirectorSceneStore(getSelectedSceneObject);
  const isCharacter = selectedObject?.type === 'character';

  const setObjectColor = useDirectorSceneStore((s) => s.setObjectColor);
  const setObjectProportions = useDirectorSceneStore((s) => s.setObjectProportions);
  const updateObjectTransform = useDirectorSceneStore((s) => s.updateObjectTransform);
  const beginHistoryGesture = useDirectorSceneStore((s) => s.beginHistoryGesture);
  const commitHistoryGesture = useDirectorSceneStore((s) => s.commitHistoryGesture);

  const [proportionsOpen, setProportionsOpen] = useState(true);

  useEffect(() => {
    if (isCharacter) setProportionsOpen(true);
  }, [selectedObject?.id, isCharacter]);

  if (!isCharacter || !selectedObject) return null;

  const uniformScale =
    (selectedObject.scale[0] + selectedObject.scale[1] + selectedObject.scale[2]) / 3;

  return (
    <aside
      className={cn(
        'director-character-inspector shrink-0 w-[300px] h-full min-h-0',
        'border-l border-white/[0.08] bg-[#0b0b0b]/98 backdrop-blur-2xl',
        'flex flex-col overflow-hidden',
      )}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2.5 shrink-0 border-b border-white/[0.06]">
        <div className="min-w-0">
          <p className="cover-section-label mb-0 text-[11px]">人偶检查器</p>
          <p className="ai-editor-body text-[11px] truncate">{selectedObject.name}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          title="收起检查器"
          className="shrink-0 p-1.5 rounded-full ai-editor-mode-btn"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-3 py-3 space-y-4">
        <section className="space-y-2">
          <p className="cover-section-label mb-0 text-[11px]">颜色</p>
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((hex) => (
              <button
                key={hex}
                type="button"
                title={hex}
                onClick={() => setObjectColor(selectedObject.id, hex)}
                className={cn(
                  'w-7 h-7 rounded-lg transition-transform hover:scale-105',
                  selectedObject.color === hex && 'ring-2 ring-white/40 ring-offset-2 ring-offset-transparent',
                )}
                style={{ backgroundColor: hex }}
              />
            ))}
          </div>
          <input
            type="color"
            value={selectedObject.color}
            onChange={(e) => setObjectColor(selectedObject.id, e.target.value)}
            className="w-full h-8 rounded-lg cursor-pointer bg-transparent"
          />
        </section>

        <section className="space-y-2">
          <p className="cover-section-label mb-0 text-[11px]">缩放比例</p>
          <input
            type="number"
            min={0.5}
            max={2}
            step={0.01}
            value={uniformScale.toFixed(2)}
            onChange={(e) => {
              const v = Math.min(2, Math.max(0.5, Number(e.target.value) || 1));
              updateObjectTransform(selectedObject.id, { scale: [v, v, v] });
            }}
            className="w-full rounded-lg ai-editor-input px-2 py-1.5 text-[12px] tabular-nums"
          />
        </section>

        <section className="space-y-2">
          <button
            type="button"
            onClick={() => setProportionsOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 text-left"
          >
            <p className="cover-section-label mb-0 text-[11px]">关节长短</p>
            <ChevronRight
              className={cn('w-3.5 h-3.5 opacity-50 transition-transform', proportionsOpen && 'rotate-90')}
            />
          </button>
          {proportionsOpen && (
            <div className="rounded-xl ai-editor-panel p-2.5 space-y-2 max-h-[240px] overflow-y-auto custom-scrollbar">
              {PROPORTION_CONTROLS.map(({ key, label }) => {
                const v = selectedObject.proportions[key] ?? 1;
                return (
                  <label key={key} className="block space-y-1">
                    <div className="flex justify-between gap-2">
                      <span className="ai-editor-body text-[11px]">{label}</span>
                      <span className="ai-editor-stat text-[10px] tabular-nums">{v.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0.75}
                      max={1.35}
                      step={0.01}
                      value={v}
                      onPointerDown={beginHistoryGesture}
                      onChange={(e) =>
                        setObjectProportions(selectedObject.id, { [key]: Number(e.target.value) })
                      }
                      onPointerUp={commitHistoryGesture}
                      onPointerCancel={commitHistoryGesture}
                      className="w-full h-1 accent-primary cursor-pointer"
                    />
                  </label>
                );
              })}
            </div>
          )}
        </section>

        <DirectorPoseLibrary />
        <SkeletonControlPanel />
      </div>
    </aside>
  );
}

/** 人偶已选中但检查器被收起时，视口边缘的重新打开按钮 */
export function DirectorInspectorReopenButton({ onReopen }: { onReopen: () => void }) {
  return (
    <button
      type="button"
      onClick={onReopen}
      title="打开人偶检查器"
      className={cn(
        'absolute right-2 top-1/2 -translate-y-1/2 z-30',
        'flex items-center gap-1 rounded-full px-2.5 py-2 text-[11px] font-medium',
        'ai-editor-panel director-floating-panel shadow-lg',
        'border border-white/10 hover:bg-white/[0.06] transition-colors',
      )}
    >
      <ChevronRight className="w-3.5 h-3.5 rotate-180" />
      检查器
    </button>
  );
}
