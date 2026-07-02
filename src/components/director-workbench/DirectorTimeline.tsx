import { type RefObject } from 'react';
import { Circle, Diamond, Pause, Play, Plus, Video } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useCanvasRecorder } from '../../hooks/useCanvasRecorder';
import { useDirectorTimelinePlayback } from '../../hooks/useDirectorTimelinePlayback';
import { DirectorCameraPiPDock } from './DirectorCameraPiP';
import {
  getSelectedSceneCamera,
  getSelectedSceneObject,
  TIMELINE_DURATION_SEC,
  useDirectorSceneStore,
} from '../../store/useDirectorSceneStore';

function formatTime(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

type Props = {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  previewBoundsRef: RefObject<HTMLElement | null>;
};

/** 导演台底部时间轴：播放/暂停、帧 scrub、关键帧打点、运镜导出 */
export function DirectorTimeline({ canvasRef, previewBoundsRef }: Props) {
  useDirectorTimelinePlayback();
  const { isRecording, startExport } = useCanvasRecorder(canvasRef);

  const fps = useDirectorSceneStore((s) => s.timelineFps);
  const totalFrames = useDirectorSceneStore((s) => s.timelineTotalFrames);
  const currentFrame = useDirectorSceneStore((s) => s.timelineCurrentFrame);
  const isPlaying = useDirectorSceneStore((s) => s.timelineIsPlaying);
  const selectedCamera = useDirectorSceneStore(getSelectedSceneCamera);
  const selectedObject = useDirectorSceneStore(getSelectedSceneObject);
  const selectedCameraId = useDirectorSceneStore((s) => s.selectedCameraId);
  const selectedId = useDirectorSceneStore((s) => s.selectedId);
  const cameras = useDirectorSceneStore((s) => s.cameras);
  const previewOpen = useDirectorSceneStore((s) => s.previewOpen);
  const cameraKeyframes = useDirectorSceneStore((s) => s.cameraKeyframes);
  const objectKeyframes = useDirectorSceneStore((s) => s.objectKeyframes);

  const setTimelineCurrentFrame = useDirectorSceneStore((s) => s.setTimelineCurrentFrame);
  const toggleTimelinePlaying = useDirectorSceneStore((s) => s.toggleTimelinePlaying);
  const addCameraKeyframe = useDirectorSceneStore((s) => s.addCameraKeyframe);
  const addObjectKeyframe = useDirectorSceneStore((s) => s.addObjectKeyframe);
  const applyTimelineFrame = useDirectorSceneStore((s) => s.applyTimelineFrame);

  const displayFrame = Math.min(totalFrames, Math.max(0, Math.round(currentFrame)));
  const currentSec = displayFrame / fps;
  const timelineLocked = isPlaying || isRecording;
  const canAddKeyframe = Boolean(selectedCameraId || selectedId);

  const activeKfs = selectedCameraId
    ? (cameraKeyframes[selectedCameraId] ?? [])
    : selectedId
      ? (objectKeyframes[selectedId] ?? [])
      : [];
  const activeTrackIsCamera = Boolean(selectedCameraId);
  const markerClass = activeTrackIsCamera ? 'text-[#4ade80]' : 'text-[#60a5fa]';
  const playheadClass = activeTrackIsCamera ? 'bg-[#4ade80]/80' : 'bg-[#60a5fa]/80';

  const selectedIndex = selectedCamera
    ? cameras.findIndex((c) => c.id === selectedCamera.id)
    : -1;

  const scrubTo = (frame: number) => {
    if (timelineLocked) return;
    const clamped = Math.max(0, Math.min(totalFrames, frame));
    setTimelineCurrentFrame(clamped);
    applyTimelineFrame(clamped);
  };

  const handleAddKeyframe = () => {
    if (selectedCameraId) addCameraKeyframe(selectedCameraId);
    else if (selectedId) addObjectKeyframe(selectedId);
  };

  const trackHint = selectedCamera
    ? `相机 ${selectedIndex + 1}`
    : selectedObject
      ? selectedObject.name
      : null;

  return (
    <div
      className={cn(
        'shrink-0 border-t border-white/10 bg-[#0c0c0c]/95 backdrop-blur-md',
        'px-4 py-3',
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
        {previewOpen && <DirectorCameraPiPDock boundsRef={previewBoundsRef} />}

        <div className="flex-1 min-w-0 space-y-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleTimelinePlaying}
          disabled={isRecording}
          className={cn(
            'inline-flex items-center justify-center w-9 h-9 rounded-full transition-colors',
            isPlaying ? 'cover-hero-cta' : 'ai-editor-btn-secondary hover:bg-white/14',
            isRecording && 'opacity-40 cursor-not-allowed',
          )}
          title={isPlaying ? '暂停' : '播放'}
        >
          {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
        </button>

        <button
          type="button"
          onClick={() => void startExport()}
          disabled={!selectedCameraId || timelineLocked}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
            isRecording ? 'cover-hero-cta' : 'ai-editor-btn-secondary hover:bg-white/14',
            (!selectedCameraId || (timelineLocked && !isRecording)) && 'opacity-40 cursor-not-allowed',
          )}
          title={selectedCameraId ? '录制选中相机运镜并导出 WebM' : '请先选中相机'}
        >
          {isRecording ? (
            <>
              <Circle className="w-3 h-3 fill-current animate-pulse" />
              正在录制中…
            </>
          ) : (
            <>
              <Video className="w-3.5 h-3.5" />
              导出运镜视频
            </>
          )}
        </button>

        <div className="flex items-baseline gap-3 text-[12px] tabular-nums">
          <span className="ai-editor-stat">
            帧 {displayFrame} / {totalFrames}
          </span>
          <span className="ai-editor-body opacity-70">
            {formatTime(currentSec)} / {formatTime(TIMELINE_DURATION_SEC)}
          </span>
        </div>

        <button
          type="button"
          disabled={!canAddKeyframe || timelineLocked}
          onClick={handleAddKeyframe}
          className={cn(
            'ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
            'ai-editor-btn-secondary hover:bg-white/14',
            (!canAddKeyframe || timelineLocked) && 'opacity-40 cursor-not-allowed',
          )}
          title={
            canAddKeyframe
              ? selectedCameraId
                ? '记录选中相机的位置/旋转/FOV'
                : '记录选中物体的位置/旋转/缩放'
              : '请先选中相机或物体'
          }
        >
          <Plus className="w-3.5 h-3.5" />
          添加关键帧
        </button>
      </div>

      <div className="relative">
        <div className="relative h-8 rounded-lg bg-white/[0.06] border border-white/10 overflow-hidden">
          {activeKfs.map((kf) => {
            const leftPct = totalFrames <= 0 ? 0 : (kf.frame / totalFrames) * 100;
            return (
              <button
                key={kf.id}
                type="button"
                title={`关键帧 · 帧 ${kf.frame}`}
                disabled={timelineLocked}
                onClick={() => scrubTo(kf.frame)}
                className={cn(
                  'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hover:scale-110 transition-transform',
                  markerClass,
                  timelineLocked && 'pointer-events-none opacity-60',
                )}
                style={{ left: `${leftPct}%` }}
              >
                <Diamond className="w-3 h-3 fill-current" />
              </button>
            );
          })}
          <div
            className={cn('absolute top-0 bottom-0 w-0.5 pointer-events-none z-20', playheadClass)}
            style={{ left: `${totalFrames <= 0 ? 0 : (displayFrame / totalFrames) * 100}%` }}
          />
        </div>

        <input
          type="range"
          min={0}
          max={totalFrames}
          step={1}
          value={displayFrame}
          disabled={timelineLocked}
          onChange={(e) => scrubTo(Number(e.target.value))}
          className="absolute inset-0 w-full h-8 opacity-0 cursor-pointer disabled:cursor-not-allowed"
          aria-label="时间轴 scrub"
        />
      </div>

      <p className="ai-editor-body text-[11px] leading-relaxed opacity-75">
        {isRecording
          ? '正在录制运镜参考视频：主画布已锁定为选中相机第一人称视角，播放结束后自动下载 WebM。'
          : trackHint
            ? `当前轨道：${trackHint} · ${activeKfs.length} 个关键帧（${activeTrackIsCamera ? '相机' : '物体'}）。播放时所有已打点的相机与物体同步插值。`
            : '请选中相机或物体后添加关键帧；相机记录位置/旋转/FOV，物体记录位置/旋转/缩放。'}
      </p>
        </div>
      </div>
    </div>
  );
}
