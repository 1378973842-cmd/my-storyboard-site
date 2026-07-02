import { useRef } from 'react';
import {
  Move,
  RotateCw,
  Maximize2,
  Focus,
  Globe,
  Box,
  Undo2,
  Redo2,
  Save,
  FolderOpen,
  Axis3D,
  Monitor,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TransformMode } from '../../lib/director/gizmoTransform';
import { downloadProjectJson, parseProjectJson } from '../../lib/director/scenePersistence';
import { DirectorAddMenu } from './DirectorAddMenu';
import { DirectorSceneMenu } from './DirectorSceneMenu';
import { DirectorCameraPropertiesMenu } from './DirectorCameraPropertiesPanel';
import {
  useDirectorSceneStore,
  type TransformAxis,
} from '../../store/useDirectorSceneStore';

const TOOLS: { mode: TransformMode; label: string; icon: typeof Move }[] = [
  { mode: 'translate', label: '移动', icon: Move },
  { mode: 'rotate', label: '旋转', icon: RotateCw },
  { mode: 'scale', label: '缩放', icon: Maximize2 },
];

const AXIS_BTNS: { axis: TransformAxis; label: string }[] = [
  { axis: 'xyz', label: 'XYZ' },
  { axis: 'x', label: 'X' },
  { axis: 'y', label: 'Y' },
  { axis: 'z', label: 'Z' },
];

type Props = {
  transformMode: TransformMode;
  onTransformModeChange: (mode: TransformMode) => void;
  canTransform: boolean;
};

function TransformToolSwitch({
  transformMode,
  onTransformModeChange,
  canTransform,
}: Pick<Props, 'transformMode' | 'onTransformModeChange' | 'canTransform'>) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-full ai-editor-mode-switch">
      {TOOLS.map(({ mode, label, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          disabled={!canTransform}
          title={label}
          onClick={() => onTransformModeChange(mode)}
          className={cn(
            'flex items-center gap-1 ai-editor-mode-btn',
            canTransform && transformMode === mode && 'ai-editor-mode-btn--active',
            !canTransform && 'opacity-30 cursor-not-allowed',
          )}
        >
          <Icon className="w-3.5 h-3.5 shrink-0" />
          <span className="hidden lg:inline">{label}</span>
        </button>
      ))}
    </div>
  );
}

/** 导演台顶栏：左工具 · 右操作 */
export function DirectorTopToolbar({
  transformMode,
  onTransformModeChange,
  canTransform,
}: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const transformSpace = useDirectorSceneStore((s) => s.transformSpace);
  const setTransformSpace = useDirectorSceneStore((s) => s.setTransformSpace);
  const transformAxis = useDirectorSceneStore((s) => s.transformAxis);
  const setTransformAxis = useDirectorSceneStore((s) => s.setTransformAxis);
  const historyPast = useDirectorSceneStore((s) => s.historyPast);
  const historyFuture = useDirectorSceneStore((s) => s.historyFuture);
  const undo = useDirectorSceneStore((s) => s.undo);
  const redo = useDirectorSceneStore((s) => s.redo);
  const getProjectSnapshot = useDirectorSceneStore((s) => s.getProjectSnapshot);
  const loadProjectSnapshot = useDirectorSceneStore((s) => s.loadProjectSnapshot);
  const previewOpen = useDirectorSceneStore((s) => s.previewOpen);
  const setPreviewOpen = useDirectorSceneStore((s) => s.setPreviewOpen);

  const onSave = () => downloadProjectJson(getProjectSnapshot());
  const onLoad = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const snap = parseProjectJson(String(reader.result));
      if (snap) loadProjectSnapshot(snap);
      else alert('无法解析工程文件');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="director-top-toolbar relative z-30 shrink-0 overflow-visible border-b border-white/[0.06] bg-[#0a0a0a]">
      <div className="flex items-center gap-2 min-h-[44px] pr-3 director-top-toolbar-row">
        <div className="flex items-center gap-1.5 shrink-0 min-w-0 director-top-toolbar-left">
          <div className="flex items-center gap-0.5 p-0.5 rounded-full ai-editor-mode-switch">
            <button
              type="button"
              disabled={historyPast.length === 0}
              onClick={undo}
              title="撤销"
              className="p-1.5 rounded-full ai-editor-mode-btn disabled:opacity-30"
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={historyFuture.length === 0}
              onClick={redo}
              title="重做"
              className="p-1.5 rounded-full ai-editor-mode-btn disabled:opacity-30"
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onSave}
              title="保存工程 JSON"
              className="p-1.5 rounded-full ai-editor-mode-btn hover:text-[var(--cover-fg-warm)]"
            >
              <Save className="w-3.5 h-3.5" />
            </button>
            <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={onLoad} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="打开工程"
              className="p-1.5 rounded-full ai-editor-mode-btn"
            >
              <FolderOpen className="w-3.5 h-3.5" />
            </button>
          </div>

          <TransformToolSwitch
            transformMode={transformMode}
            onTransformModeChange={onTransformModeChange}
            canTransform={canTransform}
          />

          <div className="hidden xl:flex items-center gap-0.5 p-0.5 rounded-full ai-editor-mode-switch">
            <Axis3D className="w-3.5 h-3.5 opacity-50 ml-0.5" />
            {AXIS_BTNS.map(({ axis, label }) => (
              <button
                key={axis}
                type="button"
                onClick={() => setTransformAxis(axis)}
                className={cn(
                  'ai-editor-mode-btn',
                  transformAxis === axis && 'ai-editor-mode-btn--active',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="hidden xl:flex items-center gap-0.5 p-0.5 rounded-full ai-editor-mode-switch">
            <button
              type="button"
              onClick={() => setTransformSpace('local')}
              className={cn(
                'ai-editor-mode-btn',
                transformSpace === 'local' && 'ai-editor-mode-btn--active',
              )}
            >
              <Box className="w-3 h-3 inline mr-0.5" />
              局部
            </button>
            <button
              type="button"
              onClick={() => setTransformSpace('world')}
              className={cn(
                'ai-editor-mode-btn',
                transformSpace === 'world' && 'ai-editor-mode-btn--active',
              )}
            >
              <Globe className="w-3 h-3 inline mr-0.5" />
              世界
            </button>
          </div>

          <DirectorAddMenu />
          <DirectorSceneMenu />
          <DirectorCameraPropertiesMenu />
        </div>

        <div className="flex items-center gap-1.5 shrink-0 ml-auto director-top-toolbar-right">
          <button
            type="button"
            title={previewOpen ? '隐藏相机预览窗' : '显示相机预览窗'}
            onClick={() => setPreviewOpen(!previewOpen)}
            className={cn(
              'p-1.5 ai-editor-mode-btn',
              previewOpen && 'ai-editor-mode-btn--active',
            )}
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            className="flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[11px] font-medium ai-editor-btn-secondary"
            onClick={() => window.dispatchEvent(new CustomEvent('director-frame-view'))}
          >
            <Focus className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">聚焦</span>
          </button>
        </div>
      </div>
    </div>
  );
}
