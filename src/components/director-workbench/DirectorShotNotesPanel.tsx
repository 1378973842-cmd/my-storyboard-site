import { FileText, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useDirectorSceneStore } from '../../store/useDirectorSceneStore';

/** 从分镜导入后显示导演备注，方便对照摆机位 */
export function DirectorShotNotesPanel() {
  const shot = useDirectorSceneStore((s) => s.linkedStoryboardShot);
  const notes = useDirectorSceneStore((s) => s.linkedDirectorNotes);
  const clear = useDirectorSceneStore((s) => s.clearLinkedStoryboard);

  if (!shot && !notes) return null;

  return (
    <div
      className={cn(
        'absolute bottom-4 left-4 z-20 w-[260px] max-w-[min(260px,calc(100%-2rem))]',
        'rounded-2xl p-3 ai-editor-panel director-floating-panel',
      )}
    >
      <div className="flex items-start gap-2 mb-1.5">
        <FileText className="w-3.5 h-3.5 text-secondary shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="cover-section-label mb-0 text-[11px]">
            {shot ? `分镜 ${shot}` : '导演备注'}
          </p>
        </div>
        <button
          type="button"
          onClick={clear}
          className="p-1 rounded-md text-on-surface/45 hover:text-on-surface hover:bg-white/8"
          title="关闭备注"
        >
          <X className="w-3 h-3" />
        </button>
      </div>
      <p className="ai-editor-body text-[11px] leading-relaxed opacity-85 whitespace-pre-wrap max-h-28 overflow-y-auto custom-scrollbar">
        {notes || '（无导演备注）'}
      </p>
    </div>
  );
}
