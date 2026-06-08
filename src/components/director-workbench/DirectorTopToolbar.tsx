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
} from 'lucide-react';
import { cn } from '../../lib/utils';
import type { TransformMode } from '../../lib/director/gizmoTransform';
import { downloadProjectJson, parseProjectJson } from '../../lib/director/scenePersistence';
import {
  getSelectedSceneCamera,
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
  const lockViewToCamera = useDirectorSceneStore((s) => s.lockViewToCamera);
  const selectedCamera = useDirectorSceneStore(getSelectedSceneCamera);
  const cameras = useDirectorSceneStore((s) => s.cameras);
  const selectedCameraId = useDirectorSceneStore((s) => s.selectedCameraId);
  const historyPast = useDirectorSceneStore((s) => s.historyPast);
  const historyFuture = useDirectorSceneStore((s) => s.historyFuture);
  const undo = useDirectorSceneStore((s) => s.undo);
  const redo = useDirectorSceneStore((s) => s.redo);
  const getProjectSnapshot = useDirectorSceneStore((s) => s.getProjectSnapshot);
  const loadProjectSnapshot = useDirectorSceneStore((s) => s.loadProjectSnapshot);

  const cameraIndex = selectedCameraId
    ? cameras.findIndex((c) => c.id === selectedCameraId)
    : -1;
  const lockLabel =
    lockViewToCamera && cameraIndex >= 0
      ? `锁定视图：已选中相机 ${cameraIndex + 1}`
      : null;

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
    <div className="shrink-0 flex flex-wrap items-center gap-2 px-3 py-2.5 outline outline-[0.5px] outline-white/[0.06] bg-black/20">
      <div className="flex items-center gap-0.5 p-1 rounded-full ai-editor-mode-switch">
        <button
          type="button"
          disabled={historyPast.length === 0}
          onClick={undo}
          title="撤销"
          className="p-2 rounded-full ai-editor-mode-btn disabled:opacity-30"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          type="button"
          disabled={historyFuture.length === 0}
          onClick={redo}
          title="重做"
          className="p-2 rounded-full ai-editor-mode-btn disabled:opacity-30"
        >
          <Redo2 className="w-4 h-4" />
        </button>
        <button type="button" onClick={onSave} title="保存工程 JSON" className="p-2 rounded-full ai-editor-mode-btn hover:text-[var(--cover-fg-warm)]">
          <Save className="w-4 h-4" />
        </button>
        <input ref={fileRef} type="file" accept=".json" className="hidden" onChange={onLoad} />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          title="打开工程"
          className="p-2 rounded-full ai-editor-mode-btn"
        >
          <FolderOpen className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-1 p-1 rounded-full ai-editor-mode-switch">
        {TOOLS.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            disabled={!canTransform}
            title={label}
            onClick={() => onTransformModeChange(mode)}
            className={cn(
              'flex items-center gap-1 rounded-full px-2.5 py-2 text-[12px] font-medium',
              canTransform && transformMode === mode
                ? 'ai-editor-mode-btn--active'
                : 'ai-editor-mode-btn',
              !canTransform && 'opacity-30 cursor-not-allowed',
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5 p-1 rounded-full ai-editor-mode-switch">
        <Axis3D className="w-3.5 h-3.5 opacity-50 ml-1" />
        {AXIS_BTNS.map(({ axis, label }) => (
          <button
            key={axis}
            type="button"
            onClick={() => setTransformAxis(axis)}
            className={cn(
              'rounded-full px-2 py-1.5 text-[11px] font-medium',
              transformAxis === axis ? 'ai-editor-mode-btn--active' : 'ai-editor-mode-btn',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-0.5 p-1 rounded-full ai-editor-mode-switch">
        <button
          type="button"
          onClick={() => setTransformSpace('local')}
          className={cn(
            'rounded-full px-2 py-1.5 text-[11px] font-medium',
            transformSpace === 'local' ? 'ai-editor-mode-btn--active' : 'ai-editor-mode-btn',
          )}
        >
          <Box className="w-3 h-3 inline mr-0.5" />
          局部
        </button>
        <button
          type="button"
          onClick={() => setTransformSpace('world')}
          className={cn(
            'rounded-full px-2 py-1.5 text-[11px] font-medium',
            transformSpace === 'world' ? 'ai-editor-mode-btn--active' : 'ai-editor-mode-btn',
          )}
        >
          <Globe className="w-3 h-3 inline mr-0.5" />
          世界
        </button>
      </div>

      {lockLabel && (
        <span className="ai-editor-body text-[11px] truncate max-w-[180px]">{lockLabel}</span>
      )}

      <button
        type="button"
        className="ml-auto flex items-center gap-1 rounded-full px-3 py-2 text-[12px] font-medium ai-editor-btn-secondary"
        onClick={() => window.dispatchEvent(new CustomEvent('director-frame-view'))}
      >
        <Focus className="w-3.5 h-3.5" />
        聚焦
      </button>
    </div>
  );
}
