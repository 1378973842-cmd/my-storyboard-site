import { useState, type ReactNode } from 'react';
import { Plus, Trash2, MousePointer2, Camera, User } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDirectorSceneStore } from '../../store/useDirectorSceneStore';
import { SkeletonControlPanel } from './SkeletonControlPanel';
import { DirectorPoseLibrary } from './DirectorPoseLibrary';

type TabId = 'scene' | 'skeleton';

function shortId(id: string) {
  return id.slice(0, 6);
}

function ObjectListItem({
  title,
  sub,
  isActive,
  onSelect,
  onRemove,
  activeClass,
  icon,
}: {
  title: string;
  sub: string;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
  activeClass: string;
  icon: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-xl p-2.5 transition-colors outline outline-[0.5px]',
        isActive ? `${activeClass} outline-white/15` : 'ai-editor-panel outline-white/8',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="font-body text-[11px] text-[var(--cover-fg-warm)] truncate">{title}</p>
          <p className="ai-editor-stat text-[10px] truncate">{sub}</p>
        </div>
      </div>
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'flex-1 flex items-center justify-center gap-1 rounded-full py-1 text-[11px] font-medium transition-colors',
            isActive ? 'ai-editor-mode-btn--active' : 'ai-editor-btn-secondary',
          )}
        >
          <MousePointer2 className="w-3 h-3" />
          选中
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full py-1 px-2.5 text-[11px] font-medium ai-editor-btn-secondary hover:bg-red-500/15 hover:text-red-200"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

export function DirectorSceneObjectsPanel() {
  const [tab, setTab] = useState<TabId>('scene');

  const objects = useDirectorSceneStore((s) => s.objects);
  const cameras = useDirectorSceneStore((s) => s.cameras);
  const selectedId = useDirectorSceneStore((s) => s.selectedId);
  const selectedCameraId = useDirectorSceneStore((s) => s.selectedCameraId);
  const addCharacter = useDirectorSceneStore((s) => s.addCharacter);
  const addCamera = useDirectorSceneStore((s) => s.addCamera);
  const removeObject = useDirectorSceneStore((s) => s.removeObject);
  const removeCamera = useDirectorSceneStore((s) => s.removeCamera);
  const selectObject = useDirectorSceneStore((s) => s.selectObject);
  const selectCamera = useDirectorSceneStore((s) => s.selectCamera);

  const tabs: { id: TabId; label: string }[] = [
    { id: 'scene', label: '场景' },
    { id: 'skeleton', label: '骨骼' },
  ];

  return (
    <aside className="ai-editor-sidebar shrink-0 w-[340px] h-full min-h-0">
      <div className="ai-editor-panel ai-editor-sidebar-panel rounded-[1.15rem] h-full flex flex-col overflow-hidden">
      <div className="px-4 pt-4 pb-3 shrink-0">
        <div className="cover-section-label mb-2">场景对象</div>
        <div className="ai-editor-segmented" role="tablist" aria-label="场景对象面板">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'ai-editor-segmented-btn',
                tab === t.id && 'ai-editor-segmented-btn--active',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'scene' ? (
        <>
          <div className="px-4 pb-2 flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => {
                addCharacter();
                setTab('skeleton');
              }}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-2 px-3 cover-hero-cta text-[12px] font-medium"
            >
              <Plus className="w-3.5 h-3.5" />
              添加人偶
            </button>
            <button
              type="button"
              onClick={addCamera}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-full py-2 px-3 ai-editor-btn-secondary text-[12px] font-medium"
            >
              <Camera className="w-3.5 h-3.5" />
              添加相机
            </button>
          </div>

          <div className="flex-1 min-h-0 px-4 pb-4 overflow-y-auto custom-scrollbar space-y-4">
            <section>
              <p className="cover-section-label mb-0 text-[11px] mb-1.5">导演相机 · 左下角预览</p>
              <div className="space-y-1.5">
                {cameras.map((cam, i) => (
                  <ObjectListItem
                    key={cam.id}
                    title={`相机 ${String(i + 1).padStart(2, '0')}`}
                    sub={`#${shortId(cam.id)} · 视野 ${cam.fov}°`}
                    isActive={selectedCameraId === cam.id}
                    onSelect={() => selectCamera(cam.id)}
                    onRemove={() => removeCamera(cam.id)}
                    activeClass="bg-white/10 outline-white/20"
                    icon={<Camera className="w-3.5 h-3.5 text-secondary shrink-0" />}
                  />
                ))}
              </div>
            </section>

            <section>
              <p className="cover-section-label mb-0 text-[11px] mb-1.5">人偶 · 点击场景可选中</p>
              <div className="space-y-1.5">
                {objects.length === 0 ? (
                  <p className="ai-editor-body text-[12px] py-3 text-center">暂无，请添加人偶</p>
                ) : (
                  objects.map((obj, i) => (
                    <ObjectListItem
                      key={obj.id}
                      title={obj.name || `人偶 ${String(i + 1).padStart(2, '0')}`}
                      sub={`#${shortId(obj.id)}`}
                      isActive={selectedId === obj.id}
                      onSelect={() => {
                        selectObject(obj.id);
                        setTab('skeleton');
                      }}
                      onRemove={() => removeObject(obj.id)}
                      activeClass="bg-white/10 outline-white/20"
                      icon={<User className="w-3.5 h-3.5 text-primary shrink-0" />}
                    />
                  ))
                )}
              </div>
            </section>
          </div>
        </>
      ) : (
        <div className="flex-1 min-h-0 px-4 pb-4 overflow-y-auto custom-scrollbar space-y-4">
          <DirectorPoseLibrary />
          <SkeletonControlPanel />
        </div>
      )}
      </div>
    </aside>
  );
}
