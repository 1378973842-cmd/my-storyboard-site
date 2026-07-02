import { Camera, Eye, EyeOff, Lock, Unlock } from 'lucide-react';
import { cn } from '../../lib/utils';
import { normalizeSceneCamera } from '../../lib/director/cameraShake';
import { dispatchEditorViewPreset, type EditorViewPreset } from '../../lib/director/editorViewPresets';
import {
  getPreviewSceneCamera,
  useDirectorSceneStore,
} from '../../store/useDirectorSceneStore';
import { DirectorToolbarMenuButton, DirectorToolbarMenuChevron } from './DirectorToolbarMenuButton';
import { useToolbarMenu } from './useToolbarMenu';

const VIEW_KEYS: EditorViewPreset[] = ['1', '3', '7', '5', '4', '9'];

/** 顶栏「相机属性」下拉菜单，不遮挡 3D 视口 */
export function DirectorCameraPropertiesMenu() {
  const { open, toggle, rootRef } = useToolbarMenu();

  const cameras = useDirectorSceneStore((s) => s.cameras);
  const previewCamera = useDirectorSceneStore(getPreviewSceneCamera);
  const selectedCameraId = useDirectorSceneStore((s) => s.selectedCameraId);
  const updateCameraFov = useDirectorSceneStore((s) => s.updateCameraFov);
  const updateCameraShake = useDirectorSceneStore((s) => s.updateCameraShake);
  const beginHistoryGesture = useDirectorSceneStore((s) => s.beginHistoryGesture);
  const commitHistoryGesture = useDirectorSceneStore((s) => s.commitHistoryGesture);
  const lockViewToCamera = useDirectorSceneStore((s) => s.lockViewToCamera);
  const setLockViewToCamera = useDirectorSceneStore((s) => s.setLockViewToCamera);
  const showCameraGizmo = useDirectorSceneStore((s) => s.showCameraGizmo);
  const setShowCameraGizmo = useDirectorSceneStore((s) => s.setShowCameraGizmo);

  if (cameras.length === 0 || !previewCamera) return null;

  const active = normalizeSceneCamera(previewCamera);
  const activeIndex = cameras.findIndex((c) => c.id === active.id);

  return (
    <div ref={rootRef} className="relative shrink-0">
      <DirectorToolbarMenuButton open={open} onClick={toggle}>
        <Camera className="w-3.5 h-3.5 shrink-0" />
        <span>相机</span>
        <span className="ai-editor-stat text-[10px] tabular-nums">{active.fov}°</span>
        {lockViewToCamera && selectedCameraId && (
          <Lock className="w-3 h-3 shrink-0 text-[#4ade80]" aria-label="视角已锁定" />
        )}
        <DirectorToolbarMenuChevron open={open} />
      </DirectorToolbarMenuButton>

      {open && (
        <div
          className={cn(
            'absolute top-[calc(100%+6px)] left-0 z-[60] w-[240px]',
            'rounded-xl p-3 space-y-2.5 ai-editor-panel director-floating-panel',
            'shadow-[0_24px_56px_-24px_rgba(0,0,0,0.75)]',
          )}
        >
          <p className="cover-section-label mb-0 text-[11px]">相机 {activeIndex + 1} · 属性</p>
          <p className="ai-editor-body text-[10px] opacity-60 leading-snug">
            {selectedCameraId ? '切换相机请在「场景」菜单选择' : '当前编辑预览相机，选中相机后可锁定视角'}
          </p>

          <button
            type="button"
            onClick={() => setLockViewToCamera(!lockViewToCamera)}
            disabled={!selectedCameraId}
            className={cn(
              'w-full flex items-center justify-center gap-2 rounded-full py-1.5 text-[11px] font-medium transition-colors',
              lockViewToCamera ? 'cover-hero-cta' : 'ai-editor-btn-secondary',
              !selectedCameraId && 'opacity-40 cursor-not-allowed',
            )}
          >
            {lockViewToCamera ? <Lock className="w-3.5 h-3.5" /> : <Unlock className="w-3.5 h-3.5" />}
            {lockViewToCamera ? '已锁定视角' : '锁定相机视角'}
          </button>

          <button
            type="button"
            onClick={() => setShowCameraGizmo(!showCameraGizmo)}
            className={cn(
              'w-full flex items-center justify-center gap-2 rounded-full py-1.5 text-[11px] font-medium transition-colors',
              showCameraGizmo ? 'cover-hero-cta' : 'ai-editor-btn-secondary',
            )}
          >
            {showCameraGizmo ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
            {showCameraGizmo ? '隐藏相机视锥' : '显示相机视锥'}
          </button>
          <p className="ai-editor-body text-[10px] opacity-55 leading-snug -mt-1">
            {showCameraGizmo
              ? '关闭后隐藏绿色视锥线；未选中的相机机身也会隐藏'
              : '视锥已隐藏；选中相机仍保留蓝色机身以便调整'}
          </p>

          <div className="space-y-1.5 rounded-lg p-2 bg-white/[0.04] outline outline-[0.5px] outline-white/10">
            <p className="cover-section-label mb-0 text-[10px]">镜头抖动</p>
            <button
              type="button"
              onClick={() =>
                updateCameraShake(active.id, { shakeEnabled: !active.shakeEnabled })
              }
              className={cn(
                'w-full flex items-center justify-center gap-1.5 rounded-full py-1.5 text-[11px] font-medium transition-colors',
                active.shakeEnabled ? 'cover-hero-cta' : 'ai-editor-btn-secondary',
              )}
            >
              {active.shakeEnabled ? '已开启' : '开启镜头抖动'}
            </button>
            <div className={cn('space-y-1', !active.shakeEnabled && 'opacity-45')}>
              <div className="flex items-center justify-between">
                <span className="ai-editor-body text-[11px]">强度</span>
                <span className="ai-editor-stat text-[10px]">
                  {Math.round(active.shakeIntensity * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={active.shakeIntensity}
                disabled={!active.shakeEnabled}
                onPointerDown={beginHistoryGesture}
                onChange={(e) =>
                  updateCameraShake(active.id, { shakeIntensity: Number(e.target.value) })
                }
                onPointerUp={commitHistoryGesture}
                onPointerCancel={commitHistoryGesture}
                className="w-full accent-secondary disabled:cursor-not-allowed"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="ai-editor-body text-[11px]">FOV</span>
              <span className="ai-editor-stat text-[10px]">{active.fov}°</span>
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

          <div className="space-y-1">
            <p className="cover-section-label mb-0 text-[10px]">快捷视角</p>
            <div className="grid grid-cols-6 gap-0.5">
              {VIEW_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => dispatchEditorViewPreset(key)}
                  className="rounded-md py-1 text-[10px] font-medium ai-editor-btn-secondary hover:bg-white/14"
                >
                  {key}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
