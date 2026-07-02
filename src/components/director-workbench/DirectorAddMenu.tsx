import { useRef } from 'react';
import { ImagePlus, Plus, Upload, User } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDirectorSceneStore } from '../../store/useDirectorSceneStore';
import { DirectorToolbarMenuButton, DirectorToolbarMenuChevron } from './DirectorToolbarMenuButton';
import { useToolbarMenu } from './useToolbarMenu';

/** 顶栏「添加」下拉：导入模型 / 人偶 / 图片 / 相机 */
export function DirectorAddMenu() {
  const { open, toggle, close, rootRef } = useToolbarMenu();
  const modelInputRef = useRef<HTMLInputElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const addCharacter = useDirectorSceneStore((s) => s.addCharacter);
  const addCamera = useDirectorSceneStore((s) => s.addCamera);
  const addCustomModel = useDirectorSceneStore((s) => s.addCustomModel);
  const addImagePlane = useDirectorSceneStore((s) => s.addImagePlane);

  const onModelFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    addCustomModel(url, file.name);
    e.target.value = '';
    close();
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
    close();
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      <input ref={modelInputRef} type="file" accept=".glb,.gltf" className="hidden" onChange={onModelFile} />
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={onImageFile} />

      <DirectorToolbarMenuButton open={open} onClick={toggle}>
        <Plus className="w-3.5 h-3.5 shrink-0" />
        <span>添加</span>
        <DirectorToolbarMenuChevron open={open} />
      </DirectorToolbarMenuButton>

      {open && (
        <div
          className={cn(
            'absolute top-[calc(100%+6px)] left-0 z-[60] w-[220px]',
            'rounded-xl p-2 space-y-1 ai-editor-panel director-floating-panel',
            'shadow-[0_24px_56px_-24px_rgba(0,0,0,0.75)]',
          )}
        >
          <button
            type="button"
            onClick={() => {
              modelInputRef.current?.click();
            }}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium ai-editor-btn-secondary"
          >
            <Upload className="w-4 h-4 shrink-0" />
            导入 3D 模型
          </button>
          <button
            type="button"
            onClick={() => {
              addCharacter();
              close();
            }}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium cover-hero-cta"
          >
            <User className="w-4 h-4 shrink-0" />
            导入人偶 (Y Bot)
          </button>
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium ai-editor-btn-secondary"
          >
            <ImagePlus className="w-4 h-4 shrink-0" />
            导入图片
          </button>
          <button
            type="button"
            onClick={() => {
              addCamera();
              close();
            }}
            className="w-full flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-medium ai-editor-btn-secondary"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" />
            添加相机
          </button>
        </div>
      )}
    </div>
  );
}
