import { Camera, Lock, Unlock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { dispatchEditorViewPreset, type EditorViewPreset } from '../../lib/director/editorViewPresets';
import {
  getSelectedSceneCamera,
  useDirectorSceneStore,
} from '../../store/useDirectorSceneStore';

const VIEW_KEYS: EditorViewPreset[] = ['1', '3', '7', '5', '4', '9'];

/** 图：视口左上「相机属性」浮层 */
export function DirectorCameraPropertiesPanel() {
  const cameras = useDirectorSceneStore((s) => s.cameras);
  const selectedCamera = useDirectorSceneStore(getSelectedSceneCamera);
  const selectedCameraId = useDirectorSceneStore((s) => s.selectedCameraId);
  const selectCamera = useDirectorSceneStore((s) => s.selectCamera);
  const updateCameraFov = useDirectorSceneStore((s) => s.updateCameraFov);
  const beginHistoryGesture = useDirectorSceneStore((s) => s.beginHistoryGesture);
  const commitHistoryGesture = useDirectorSceneStore((s) => s.commitHistoryGesture);
  const lockViewToCamera = useDirectorSceneStore((s) => s.lockViewToCamera);
  const setLockViewToCamera = useDirectorSceneStore((s) => s.setLockViewToCamera);

  if (cameras.length === 0) return null;

  const active = selectedCamera ?? cameras[0]!;
  const activeIndex = cameras.findIndex((c) => c.id === active.id);

  return (
    <div
      className={cn(
        'absolute top-4 left-4 z-20 w-[220px] rounded-xl p-3 space-y-3 ai-editor-panel director-floating-panel',
      )}
    >
      <div className="flex items-center gap-2">
        <Camera className="w-4 h-4 shrink-0 opacity-80" />
        <span className="cover-section-label mb-0 text-[12px]">相机属性</span>
      </div>

      <button
        type="button"
        onClick={() => setLockViewToCamera(!lockViewToCamera)}
        disabled={!selectedCameraId}
        className={cn(
          'w-full flex items-center justify-center gap-2 rounded-full py-2 text-[12px] font-medium transition-colors',
          lockViewToCamera
            ? 'cover-hero-cta'
            : 'ai-editor-btn-secondary',
          !selectedCameraId && 'opacity-40 cursor-not-allowed',
        )}
      >
        {lockViewToCamera ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
        {lockViewToCamera ? '已锁定到相机视角' : '切换视角（锁定相机）'}
      </button>

      <div className="space-y-1.5">
        <label className="cover-section-label mb-0 text-[11px]">当前相机</label>
        <select
          value={active.id}
          onChange={(e) => selectCamera(e.target.value)}
          className="w-full rounded-xl ai-editor-select px-3 py-2 text-[12px] focus:outline-none focus-visible:ring-2 accent-focus-ring cursor-pointer"
        >
          {cameras.map((cam, i) => (
            <option key={cam.id} value={cam.id}>
              相机 {i + 1}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <p className="cover-section-label mb-0 text-[11px]">快捷视角（小键盘）</p>
        <div className="grid grid-cols-6 gap-1">
          {VIEW_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => dispatchEditorViewPreset(key)}
              className="rounded-lg py-1.5 text-[11px] font-medium ai-editor-btn-secondary hover:bg-white/14"
            >
              {key}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="ai-editor-body text-[12px]">FOV</span>
          <span className="ai-editor-stat text-[11px]">{active.fov}°</span>
        </div>
        <input
          type="range"
          min={20}
          max={100}
          step={1}
          value={active.fov}
          onPointerDown={beginHistoryGesture}
          onChange={(e) => updateCameraFov(active.id, Number(e.target.value))}
          onPointerUp={commitHistoryGesture}
          onPointerCancel={commitHistoryGesture}
          className="w-full accent-secondary"
        />
      </div>

      {selectedCamera && (
        <p className="ai-editor-body text-[11px] leading-relaxed">
          已选中相机 {activeIndex + 1}。拖 Gizmo 移动机位，上方滑条调视野宽窄。
        </p>
      )}
    </div>
  );
}
