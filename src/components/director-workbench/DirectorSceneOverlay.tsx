import { Camera, Eye, EyeOff, Grid3x3, Layers, Lock, LockOpen, Trash2, User } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDirectorSceneStore } from '../../store/useDirectorSceneStore';

function SceneRow({
  label,
  icon,
  isActive,
  visible,
  locked,
  onSelect,
  onToggleVisible,
  onToggleLocked,
  onRemove,
}: {
  label: string;
  icon: React.ReactNode;
  isActive: boolean;
  visible: boolean;
  locked: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onToggleLocked: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors',
        isActive ? 'bg-primary/15' : 'hover:bg-white/5',
      )}
    >
      <button type="button" onClick={onSelect} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
        {icon}
        <span className="font-body text-[10px] text-on-surface/85 truncate">{label}</span>
      </button>
      <button
        type="button"
        title={visible ? '隐藏' : '显示'}
        onClick={onToggleVisible}
        className="p-1 rounded-md text-on-surface/55 hover:text-on-surface hover:bg-white/8"
      >
        {visible ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3 opacity-50" />}
      </button>
      <button
        type="button"
        title={locked ? '解锁' : '锁定'}
        onClick={onToggleLocked}
        className={cn(
          'p-1 rounded-md hover:bg-white/8',
          locked ? 'text-secondary' : 'text-on-surface/55 hover:text-on-surface',
        )}
      >
        {locked ? <Lock className="w-3 h-3" /> : <LockOpen className="w-3 h-3" />}
      </button>
      {onRemove && (
        <button
          type="button"
          title="删除"
          onClick={onRemove}
          className="p-1 rounded-md text-on-surface/45 hover:text-red-300 hover:bg-red-500/10"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

/** 图：视口右上「场景对象」树 */
export function DirectorSceneOverlay() {
  const objects = useDirectorSceneStore((s) => s.objects);
  const cameras = useDirectorSceneStore((s) => s.cameras);
  const selectedId = useDirectorSceneStore((s) => s.selectedId);
  const selectedCameraId = useDirectorSceneStore((s) => s.selectedCameraId);
  const showGrid = useDirectorSceneStore((s) => s.showGrid);
  const showGround = useDirectorSceneStore((s) => s.showGround);
  const setShowGrid = useDirectorSceneStore((s) => s.setShowGrid);
  const setShowGround = useDirectorSceneStore((s) => s.setShowGround);
  const selectObject = useDirectorSceneStore((s) => s.selectObject);
  const selectCamera = useDirectorSceneStore((s) => s.selectCamera);
  const toggleObjectVisible = useDirectorSceneStore((s) => s.toggleObjectVisible);
  const toggleObjectLocked = useDirectorSceneStore((s) => s.toggleObjectLocked);
  const toggleCameraVisible = useDirectorSceneStore((s) => s.toggleCameraVisible);
  const toggleCameraLocked = useDirectorSceneStore((s) => s.toggleCameraLocked);
  const removeObject = useDirectorSceneStore((s) => s.removeObject);
  const removeCamera = useDirectorSceneStore((s) => s.removeCamera);

  return (
    <div
      className={cn(
        'absolute top-4 right-4 z-20 w-[220px] rounded-2xl p-3 ai-editor-panel director-floating-panel',
      )}
    >
      <p className="cover-section-label mb-2 text-[11px]">场景对象</p>
      <div className="space-y-2 max-h-[280px] overflow-y-auto custom-scrollbar">
        {objects.length > 0 && (
          <div>
            <p className="cover-section-label mb-1 px-1 text-[10px]">小人</p>
            {objects.map((obj, i) => (
              <SceneRow
                key={obj.id}
                label={obj.name || `小人 #${i + 1}`}
                icon={<User className="w-3 h-3 text-primary shrink-0" />}
                isActive={selectedId === obj.id}
                visible={obj.visible}
                locked={obj.locked}
                onSelect={() => selectObject(obj.id)}
                onToggleVisible={() => toggleObjectVisible(obj.id)}
                onToggleLocked={() => toggleObjectLocked(obj.id)}
                onRemove={() => removeObject(obj.id)}
              />
            ))}
          </div>
        )}
        {cameras.length > 0 && (
          <div>
            <p className="cover-section-label mb-1 px-1 text-[10px]">相机</p>
            {cameras.map((cam, i) => (
              <SceneRow
                key={cam.id}
                label={`相机 ${i + 1}`}
                icon={<Camera className="w-3 h-3 text-secondary shrink-0" />}
                isActive={selectedCameraId === cam.id}
                visible={cam.visible}
                locked={cam.locked}
                onSelect={() => selectCamera(cam.id)}
                onToggleVisible={() => toggleCameraVisible(cam.id)}
                onToggleLocked={() => toggleCameraLocked(cam.id)}
                onRemove={() => removeCamera(cam.id)}
              />
            ))}
          </div>
        )}
        <div>
          <p className="cover-section-label mb-1 px-1 text-[10px]">背景</p>
          <SceneRow
            label="地面"
            icon={<Layers className="w-3 h-3 text-on-surface/60 shrink-0" />}
            isActive={false}
            visible={showGround}
            locked={false}
            onSelect={() => setShowGround(!showGround)}
            onToggleVisible={() => setShowGround(!showGround)}
            onToggleLocked={() => {}}
          />
          <SceneRow
            label="网格"
            icon={<Grid3x3 className="w-3 h-3 text-on-surface/60 shrink-0" />}
            isActive={false}
            visible={showGrid}
            locked={false}
            onSelect={() => setShowGrid(!showGrid)}
            onToggleVisible={() => setShowGrid(!showGrid)}
            onToggleLocked={() => {}}
          />
        </div>
      </div>
    </div>
  );
}
