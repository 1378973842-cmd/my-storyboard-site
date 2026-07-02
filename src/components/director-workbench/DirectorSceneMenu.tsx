import { type ReactNode } from 'react';
import { Camera, Layers, MousePointer2, Trash2, User } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDirectorSceneStore } from '../../store/useDirectorSceneStore';
import { DirectorToolbarMenuButton, DirectorToolbarMenuChevron } from './DirectorToolbarMenuButton';
import { useToolbarMenu } from './useToolbarMenu';

function shortId(id: string) {
  return id.slice(0, 6);
}

function ObjectListItem({
  title,
  sub,
  isActive,
  onSelect,
  onRemove,
  icon,
}: {
  title: string;
  sub: string;
  isActive: boolean;
  onSelect: () => void;
  onRemove: () => void;
  icon: ReactNode;
}) {
  return (
    <div
      className={cn(
        'rounded-lg p-2 transition-colors outline outline-[0.5px]',
        isActive ? 'bg-white/10 outline-white/15' : 'outline-white/8 bg-white/[0.02]',
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        {icon}
        <div className="min-w-0 flex-1">
          <p className="font-body text-[11px] text-[var(--cover-fg-warm)] truncate">{title}</p>
          <p className="ai-editor-stat text-[10px] truncate">{sub}</p>
        </div>
      </div>
      <div className="mt-1.5 flex gap-1">
        <button
          type="button"
          onClick={onSelect}
          className={cn(
            'flex-1 flex items-center justify-center gap-1 rounded-full py-1 text-[10px] font-medium transition-colors',
            isActive ? 'ai-editor-mode-btn--active' : 'ai-editor-btn-secondary',
          )}
        >
          <MousePointer2 className="w-3 h-3" />
          选中
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="rounded-full py-1 px-2 text-[10px] font-medium ai-editor-btn-secondary hover:bg-red-500/15 hover:text-red-200"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
    </div>
  );
}

/** 顶栏「场景」下拉：相机与人偶列表 */
export function DirectorSceneMenu() {
  const { open, toggle, close, rootRef } = useToolbarMenu();

  const objects = useDirectorSceneStore((s) => s.objects);
  const cameras = useDirectorSceneStore((s) => s.cameras);
  const selectedId = useDirectorSceneStore((s) => s.selectedId);
  const selectedCameraId = useDirectorSceneStore((s) => s.selectedCameraId);
  const removeObject = useDirectorSceneStore((s) => s.removeObject);
  const removeCamera = useDirectorSceneStore((s) => s.removeCamera);
  const selectObject = useDirectorSceneStore((s) => s.selectObject);
  const selectCamera = useDirectorSceneStore((s) => s.selectCamera);

  const totalCount = objects.length + cameras.length;

  return (
    <div ref={rootRef} className="relative shrink-0">
      <DirectorToolbarMenuButton open={open} onClick={toggle}>
        <Layers className="w-3.5 h-3.5 shrink-0" />
        <span>场景</span>
        {totalCount > 0 && (
          <span className="ai-editor-stat text-[10px] tabular-nums">{totalCount}</span>
        )}
        <DirectorToolbarMenuChevron open={open} />
      </DirectorToolbarMenuButton>

      {open && (
        <div
          className={cn(
            'absolute top-[calc(100%+6px)] left-0 z-[60] w-[280px] max-h-[min(70vh,480px)]',
            'rounded-xl p-3 flex flex-col min-h-0 ai-editor-panel director-floating-panel',
            'shadow-[0_24px_56px_-24px_rgba(0,0,0,0.75)]',
          )}
        >
          <p className="cover-section-label mb-2 shrink-0 text-[11px]">场景对象</p>

          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-3">
            <section>
              <p className="cover-section-label mb-1 text-[10px]">导演相机</p>
              {cameras.length === 0 ? (
                <p className="ai-editor-body text-[11px] py-2 text-center opacity-50">暂无相机</p>
              ) : (
                <div className="space-y-1">
                  {cameras.map((cam, i) => (
                    <ObjectListItem
                      key={cam.id}
                      title={`相机 ${String(i + 1).padStart(2, '0')}`}
                      sub={`#${shortId(cam.id)}`}
                      isActive={selectedCameraId === cam.id}
                      onSelect={() => {
                        selectCamera(cam.id);
                        close();
                      }}
                      onRemove={() => removeCamera(cam.id)}
                      icon={<Camera className="w-3.5 h-3.5 text-secondary shrink-0" />}
                    />
                  ))}
                </div>
              )}
            </section>

            <section>
              <p className="cover-section-label mb-1 text-[10px]">人偶与对象</p>
              {objects.length === 0 ? (
                <p className="ai-editor-body text-[11px] py-2 text-center opacity-50">暂无，请从「添加」导入</p>
              ) : (
                <div className="space-y-1">
                  {objects.map((obj, i) => (
                    <ObjectListItem
                      key={obj.id}
                      title={obj.name || `人偶 ${String(i + 1).padStart(2, '0')}`}
                      sub={`#${shortId(obj.id)}`}
                      isActive={selectedId === obj.id}
                      onSelect={() => {
                        selectObject(obj.id);
                        close();
                      }}
                      onRemove={() => removeObject(obj.id)}
                      icon={<User className="w-3.5 h-3.5 text-primary shrink-0" />}
                    />
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
