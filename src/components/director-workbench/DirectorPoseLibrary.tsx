import { Diamond, Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDirectorSceneStore } from '../../store/useDirectorSceneStore';

export function DirectorPoseLibrary() {
  const selectedId = useDirectorSceneStore((s) => s.selectedId);
  const objects = useDirectorSceneStore((s) => s.objects);
  const savedPoses = useDirectorSceneStore((s) => s.savedPoses);
  const savePoseFromObject = useDirectorSceneStore((s) => s.savePoseFromObject);
  const applyPose = useDirectorSceneStore((s) => s.applyPose);
  const deletePose = useDirectorSceneStore((s) => s.deletePose);
  const addObjectKeyframe = useDirectorSceneStore((s) => s.addObjectKeyframe);
  const timelineIsPlaying = useDirectorSceneStore((s) => s.timelineIsPlaying);
  const timelineIsRecording = useDirectorSceneStore((s) => s.timelineIsRecording);
  const currentFrame = useDirectorSceneStore((s) => s.timelineCurrentFrame);

  const selected = objects.find((o) => o.id === selectedId);
  const canPose = selected?.type === 'character';
  const timelineLocked = timelineIsPlaying || timelineIsRecording;

  return (
    <div className="space-y-2 pb-4">
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!canPose}
          onClick={() => selectedId && savePoseFromObject(selectedId)}
          className={cn(
            'flex-1 flex items-center justify-center gap-1 rounded-full py-2 text-[10px] font-label',
            canPose
              ? 'bg-secondary/25 text-secondary hover:bg-secondary/35'
              : 'bg-white/5 text-on-surface/35 cursor-not-allowed',
          )}
        >
          <Plus className="w-3.5 h-3.5" />
          保存姿势
        </button>
        <button
          type="button"
          disabled={!canPose || timelineLocked}
          onClick={() => selectedId && addObjectKeyframe(selectedId)}
          className={cn(
            'flex-1 flex items-center justify-center gap-1 rounded-full py-2 text-[10px] font-label',
            canPose && !timelineLocked
              ? 'bg-primary/20 text-primary hover:bg-primary/30'
              : 'bg-white/5 text-on-surface/35 cursor-not-allowed',
          )}
          title={`在帧 ${Math.round(currentFrame)} 记录当前姿势关键帧`}
        >
          <Diamond className="w-3.5 h-3.5" />
          姿势关键帧
        </button>
      </div>
      {savedPoses.length === 0 ? (
        <p className="font-body text-[10px] text-on-surface/45 px-1">暂无已存姿势</p>
      ) : (
        <ul className="space-y-1 max-h-[140px] overflow-y-auto custom-scrollbar">
          {savedPoses.map((pose) => (
            <li
              key={pose.id}
              className="flex items-center gap-1 rounded-xl bg-surface-container-high/70 px-2 py-1.5"
            >
              <button
                type="button"
                disabled={!canPose}
                onClick={() => selectedId && applyPose(pose.id, selectedId)}
                className="flex-1 text-left font-body text-[10px] text-on-surface/85 truncate hover:text-primary disabled:opacity-40"
              >
                {pose.name}
              </button>
              <button
                type="button"
                onClick={() => deletePose(pose.id)}
                className="p-1 rounded-md text-on-surface/45 hover:text-red-300 hover:bg-red-500/10"
                title="删除姿势"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="font-body text-[9px] text-on-surface/40 px-1 leading-relaxed">
        姿势关键帧会写入时间轴：播放时在关键帧间插值骨骼与比例。
      </p>
    </div>
  );
}
