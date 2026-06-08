import { useRef } from 'react';
import { Plus, User, Eye, EyeOff, Upload, ImagePlus } from 'lucide-react';
import { cn } from '../../lib/utils';
import { getSelectedSceneObject, useDirectorSceneStore } from '../../store/useDirectorSceneStore';
import { PROPORTION_CONTROLS } from '../../lib/director/boneProportions';

const PALETTE = ['#7ec8f8', '#f87171', '#4ade80', '#ffb866', '#c084fc', '#e5e2e1'];

export function DirectorLeftToolbar() {
  const modelInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const selectedObject = useDirectorSceneStore(getSelectedSceneObject);
  const showCameraGizmo = useDirectorSceneStore((s) => s.showCameraGizmo);
  const setShowCameraGizmo = useDirectorSceneStore((s) => s.setShowCameraGizmo);
  const addCharacter = useDirectorSceneStore((s) => s.addCharacter);
  const addCamera = useDirectorSceneStore((s) => s.addCamera);
  const addCustomModel = useDirectorSceneStore((s) => s.addCustomModel);
  const addImagePlane = useDirectorSceneStore((s) => s.addImagePlane);
  const updateObjectTransform = useDirectorSceneStore((s) => s.updateObjectTransform);
  const setObjectColor = useDirectorSceneStore((s) => s.setObjectColor);
  const setObjectProportions = useDirectorSceneStore((s) => s.setObjectProportions);
  const beginHistoryGesture = useDirectorSceneStore((s) => s.beginHistoryGesture);
  const commitHistoryGesture = useDirectorSceneStore((s) => s.commitHistoryGesture);
  const previewOpen = useDirectorSceneStore((s) => s.previewOpen);
  const setPreviewOpen = useDirectorSceneStore((s) => s.setPreviewOpen);

  const isCharacter = selectedObject?.type === 'character';
  const selectionLabel = selectedObject ? selectedObject.name : '未选中';
  const uniformScale = selectedObject
    ? (selectedObject.scale[0] + selectedObject.scale[1] + selectedObject.scale[2]) / 3
    : 1;

  const onModelFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    addCustomModel(url, file.name);
    e.target.value = '';
  };

  const onImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') addImagePlane(reader.result, file.name);
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  };

  return (
    <aside className="ai-editor-sidebar shrink-0 w-[260px] h-full min-h-0">
      <div className="ai-editor-panel ai-editor-sidebar-panel rounded-[1.15rem] h-full flex flex-col overflow-hidden">
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div className="cover-section-label mb-1">工具</div>
        <p className="ai-editor-body text-[12px]">当前：{selectionLabel}</p>
      </div>

      {isCharacter && selectedObject && (
        <div className="px-4 pb-3 space-y-2">
          <p className="cover-section-label mb-0 text-[11px]">人偶颜色</p>
          <div className="flex flex-wrap gap-2">
            {PALETTE.map((hex) => (
              <button
                key={hex}
                type="button"
                title={hex}
                onClick={() => setObjectColor(selectedObject.id, hex)}
                className={cn(
                  'w-8 h-8 rounded-lg transition-transform hover:scale-105',
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
        </div>
      )}

      <div className="px-4 space-y-2">
        <p className="cover-section-label mb-0 text-[11px]">添加对象</p>
        <input ref={modelInputRef} type="file" accept=".glb,.gltf" className="hidden" onChange={onModelFile} />
        <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onImageFile} />
        <button
          type="button"
          onClick={() => modelInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-[12px] font-medium ai-editor-btn-secondary"
        >
          <Upload className="w-4 h-4" />
          导入 3D 模型
        </button>
        <button
          type="button"
          onClick={addCharacter}
          className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-[12px] font-medium cover-hero-cta"
        >
          <User className="w-4 h-4" />
          导入人偶 (Y Bot)
        </button>
        <button
          type="button"
          onClick={() => imageInputRef.current?.click()}
          className="w-full flex items-center justify-center gap-2 rounded-full py-2.5 text-[12px] font-medium ai-editor-btn-secondary"
        >
          <ImagePlus className="w-4 h-4" />
          导入图片
        </button>
        <button
          type="button"
          onClick={addCamera}
          className="w-full flex items-center justify-center gap-2 rounded-full py-2 text-[12px] font-medium ai-editor-btn-secondary"
        >
          <Plus className="w-3.5 h-3.5" />
          添加相机
        </button>
      </div>

      {isCharacter && selectedObject && (
        <div className="px-4 mt-4 space-y-2 flex-1 min-h-0 overflow-y-auto custom-scrollbar">
          <p className="cover-section-label mb-0 text-[11px]">关节长短</p>
          <div className="rounded-xl ai-editor-panel p-3 space-y-2.5 max-h-[320px] overflow-y-auto custom-scrollbar">
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
        </div>
      )}

      {selectedObject && (
        <div className="px-4 mt-4 space-y-2">
          <p className="cover-section-label mb-0 text-[11px]">缩放比例</p>
          <div className="rounded-xl ai-editor-panel p-3">
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
          </div>
        </div>
      )}

      <div className="px-4 mt-4 space-y-2">
        {!previewOpen && (
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="w-full rounded-full py-2 text-[12px] font-medium ai-editor-btn-secondary"
          >
            打开左下角预览窗
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowCameraGizmo(!showCameraGizmo)}
          className="w-full flex items-center gap-2 rounded-xl px-3 py-2.5 ai-editor-btn-secondary"
        >
          {showCameraGizmo ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
          <span className="text-[12px] font-medium">{showCameraGizmo ? '隐藏相机视锥' : '显示相机视锥'}</span>
        </button>
      </div>

      <div className="mt-auto px-4 py-4 shrink-0">
        <p className="ai-editor-body text-[11px] leading-relaxed">
          自定义 GLB 使用浏览器临时链接，刷新后需重新导入。工程 JSON 可保存姿势与骨骼数据。
        </p>
      </div>
      </div>
    </aside>
  );
}
