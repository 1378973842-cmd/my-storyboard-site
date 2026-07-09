import { type RefObject, useEffect, useRef, useState } from 'react';
import { Circle, Diamond, Pause, Play, Plus, Trash2, Video } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useCanvasRecorder } from '../../hooks/useCanvasRecorder';
import { useDirectorTimelinePlayback } from '../../hooks/useDirectorTimelinePlayback';
import { DEFAULT_BEZIER, KEYFRAME_EASE_OPTIONS, type KeyframeEase } from '../../lib/director/keyframeEasing';
import { DirectorBezierEditor } from './DirectorBezierEditor';
import { DirectorCameraPiPDock } from './DirectorCameraPiP';
import {
  getSelectedSceneCamera,
  getSelectedSceneObject,
  TIMELINE_DURATION_PRESETS,
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
  const trackRef = useRef<HTMLDivElement>(null);

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
  const linkedShot = useDirectorSceneStore((s) => s.linkedStoryboardShot);
  const dollySplineEditing = useDirectorSceneStore((s) => s.dollySplineEditing);
  const selectedSplinePointId = useDirectorSceneStore((s) => s.selectedSplinePointId);
  const bakeEditableSplineToCamera = useDirectorSceneStore((s) => s.bakeEditableSplineToCamera);
  const addSplinePointAfter = useDirectorSceneStore((s) => s.addSplinePointAfter);
  const setDollySplineEditing = useDirectorSceneStore((s) => s.setDollySplineEditing);
  const beginSplineEditFromPreset = useDirectorSceneStore((s) => s.beginSplineEditFromPreset);

  const setTimelineCurrentFrame = useDirectorSceneStore((s) => s.setTimelineCurrentFrame);
  const setTimelineDurationSec = useDirectorSceneStore((s) => s.setTimelineDurationSec);
  const toggleTimelinePlaying = useDirectorSceneStore((s) => s.toggleTimelinePlaying);
  const addCameraKeyframe = useDirectorSceneStore((s) => s.addCameraKeyframe);
  const addObjectKeyframe = useDirectorSceneStore((s) => s.addObjectKeyframe);
  const removeCameraKeyframe = useDirectorSceneStore((s) => s.removeCameraKeyframe);
  const removeObjectKeyframe = useDirectorSceneStore((s) => s.removeObjectKeyframe);
  const updateCameraKeyframeEase = useDirectorSceneStore((s) => s.updateCameraKeyframeEase);
  const updateObjectKeyframeEase = useDirectorSceneStore((s) => s.updateObjectKeyframeEase);
  const moveCameraKeyframe = useDirectorSceneStore((s) => s.moveCameraKeyframe);
  const moveObjectKeyframe = useDirectorSceneStore((s) => s.moveObjectKeyframe);
  const applyTimelineFrame = useDirectorSceneStore((s) => s.applyTimelineFrame);

  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; moved: boolean } | null>(null);

  const displayFrame = Math.min(totalFrames, Math.max(0, Math.round(currentFrame)));
  const durationSec = totalFrames / Math.max(1, fps);
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

  const selectedKf = activeKfs.find((k) => k.id === selectedKeyframeId) ?? null;

  useEffect(() => {
    if (selectedKeyframeId && !activeKfs.some((k) => k.id === selectedKeyframeId)) {
      setSelectedKeyframeId(null);
    }
  }, [activeKfs, selectedKeyframeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (timelineLocked) return;
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (!selectedKeyframeId) return;
      e.preventDefault();
      if (selectedCameraId) removeCameraKeyframe(selectedCameraId, selectedKeyframeId);
      else if (selectedId) removeObjectKeyframe(selectedId, selectedKeyframeId);
      setSelectedKeyframeId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    timelineLocked,
    selectedKeyframeId,
    selectedCameraId,
    selectedId,
    removeCameraKeyframe,
    removeObjectKeyframe,
  ]);

  const scrubTo = (frame: number) => {
    if (timelineLocked) return;
    const clamped = Math.max(0, Math.min(totalFrames, frame));
    setTimelineCurrentFrame(clamped);
    applyTimelineFrame(clamped);
  };

  const frameFromClientX = (clientX: number) => {
    const el = trackRef.current;
    if (!el || totalFrames <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.round(t * totalFrames);
  };

  const handleAddKeyframe = () => {
    if (selectedCameraId) addCameraKeyframe(selectedCameraId);
    else if (selectedId) addObjectKeyframe(selectedId);
  };

  const handleDeleteSelectedKeyframe = () => {
    if (!selectedKeyframeId || timelineLocked) return;
    if (selectedCameraId) removeCameraKeyframe(selectedCameraId, selectedKeyframeId);
    else if (selectedId) removeObjectKeyframe(selectedId, selectedKeyframeId);
    setSelectedKeyframeId(null);
  };

  const handleEaseChange = (ease: KeyframeEase) => {
    if (!selectedKeyframeId) return;
    if (selectedCameraId) {
      updateCameraKeyframeEase(
        selectedCameraId,
        selectedKeyframeId,
        ease,
        ease === 'bezier' ? (selectedKf?.easeBezier ?? DEFAULT_BEZIER) : undefined,
      );
    } else if (selectedId) {
      updateObjectKeyframeEase(
        selectedId,
        selectedKeyframeId,
        ease,
        ease === 'bezier' ? (selectedKf?.easeBezier ?? DEFAULT_BEZIER) : undefined,
      );
    }
  };

  const handleBezierChange = (bezier: [number, number, number, number]) => {
    if (!selectedKeyframeId) return;
    if (selectedCameraId) {
      updateCameraKeyframeEase(selectedCameraId, selectedKeyframeId, 'bezier', bezier);
    } else if (selectedId) {
      updateObjectKeyframeEase(selectedId, selectedKeyframeId, 'bezier', bezier);
    }
  };

  const startKeyframeDrag = (kfId: string) => (e: React.PointerEvent) => {
    if (timelineLocked) return;
    e.preventDefault();
    e.stopPropagation();
    setSelectedKeyframeId(kfId);
    dragRef.current = { id: kfId, moved: false };
    const target = e.currentTarget as Element;
    target.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      dragRef.current.moved = true;
      const frame = frameFromClientX(ev.clientX);
      if (selectedCameraId) moveCameraKeyframe(selectedCameraId, kfId, frame);
      else if (selectedId) moveObjectKeyframe(selectedId, kfId, frame);
    };
    const onUp = (ev: PointerEvent) => {
      target.releasePointerCapture(e.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      const info = dragRef.current;
      dragRef.current = null;
      if (!info?.moved) {
        const kf = activeKfs.find((k) => k.id === kfId);
        if (kf) scrubTo(kf.frame);
      } else {
        scrubTo(frameFromClientX(ev.clientX));
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
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
          title={
            selectedCameraId
              ? linkedShot
                ? `录制并回写分镜 ${linkedShot}`
                : '录制选中相机运镜并导出 WebM'
              : '请先选中相机'
          }
        >
          {isRecording ? (
            <>
              <Circle className="w-3 h-3 fill-current animate-pulse" />
              正在录制中…
            </>
          ) : (
            <>
              <Video className="w-3.5 h-3.5" />
              {linkedShot ? `导出并回写 #${linkedShot}` : '导出运镜视频'}
            </>
          )}
        </button>

        <div className="flex items-baseline gap-3 text-[12px] tabular-nums">
          <span className="ai-editor-stat">
            帧 {displayFrame} / {totalFrames}
          </span>
          <span className="ai-editor-body opacity-70">
            {formatTime(currentSec)} / {formatTime(durationSec)}
          </span>
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="时间轴时长">
          {TIMELINE_DURATION_PRESETS.map((sec) => {
            const active = Math.round(durationSec) === sec;
            return (
              <button
                key={sec}
                type="button"
                disabled={timelineLocked}
                onClick={() => setTimelineDurationSec(sec)}
                className={cn(
                  'rounded-full px-2 py-1 text-[11px] font-medium transition-colors',
                  active ? 'cover-hero-cta' : 'ai-editor-btn-secondary hover:bg-white/14',
                  timelineLocked && 'opacity-40 cursor-not-allowed',
                )}
                title={`设为 ${sec} 秒`}
              >
                {sec}s
              </button>
            );
          })}
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
                : selectedObject?.type === 'character'
                  ? '记录人偶位置/旋转/缩放 + 当前姿势（骨骼）'
                  : '记录选中物体的位置/旋转/缩放'
              : '请先选中相机或物体'
          }
        >
          <Plus className="w-3.5 h-3.5" />
          {selectedObject?.type === 'character' && !selectedCameraId ? '添加姿势关键帧' : '添加关键帧'}
        </button>

        {selectedCameraId && (
          <select
            disabled={timelineLocked}
            defaultValue=""
            onChange={(e) => {
              const v = e.target.value as 'orbit' | 'pushIn' | 'craneUp' | '';
              e.target.value = '';
              if (!v || !selectedCameraId) return;
              beginSplineEditFromPreset(selectedCameraId, v);
              setSelectedKeyframeId(null);
            }}
            className={cn(
              'rounded-full bg-white/[0.06] px-2 py-1.5 text-[11px] text-[#e5e2e1]',
              'outline outline-[0.5px] outline-white/15',
              timelineLocked && 'opacity-40 cursor-not-allowed',
            )}
            aria-label="运镜路径预设"
            title="生成可编辑样条并 Bake 关键帧"
          >
            <option value="" disabled>
              路径预设…
            </option>
            <option value="orbit">环绕 90°</option>
            <option value="pushIn">推进</option>
            <option value="craneUp">升摇</option>
          </select>
        )}

        {dollySplineEditing && selectedCameraId && (
          <>
            <button
              type="button"
              disabled={timelineLocked}
              onClick={() => bakeEditableSplineToCamera(selectedCameraId)}
              className={cn(
                'rounded-full px-2.5 py-1.5 text-[11px] font-medium ai-editor-btn-secondary hover:bg-white/14',
                timelineLocked && 'opacity-40 cursor-not-allowed',
              )}
              title="把当前样条 Bake 成关键帧"
            >
              Bake 样条
            </button>
            <button
              type="button"
              disabled={timelineLocked}
              onClick={() => addSplinePointAfter(selectedSplinePointId)}
              className={cn(
                'rounded-full px-2.5 py-1.5 text-[11px] font-medium ai-editor-btn-secondary hover:bg-white/14',
                timelineLocked && 'opacity-40 cursor-not-allowed',
              )}
              title="在选中点后插入控制点"
            >
              + 控制点
            </button>
            <button
              type="button"
              disabled={timelineLocked}
              onClick={() => setDollySplineEditing(false)}
              className={cn(
                'rounded-full px-2.5 py-1.5 text-[11px] font-medium ai-editor-btn-secondary hover:bg-white/14',
                timelineLocked && 'opacity-40 cursor-not-allowed',
              )}
              title="退出样条编辑"
            >
              退出样条
            </button>
          </>
        )}

        <button
          type="button"
          disabled={!selectedKeyframeId || timelineLocked}
          onClick={handleDeleteSelectedKeyframe}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors',
            'ai-editor-btn-secondary hover:bg-red-500/15 hover:text-red-300',
            (!selectedKeyframeId || timelineLocked) && 'opacity-40 cursor-not-allowed',
          )}
          title="删除选中关键帧（Delete）"
        >
          <Trash2 className="w-3.5 h-3.5" />
          删除关键帧
        </button>
      </div>

      {selectedKf && (
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="ai-editor-body opacity-70">
              关键帧 {selectedKf.frame} · 段缓动
            </span>
            <select
              value={selectedKf.ease ?? 'linear'}
              disabled={timelineLocked}
              onChange={(e) => handleEaseChange(e.target.value as KeyframeEase)}
              className={cn(
                'rounded-lg bg-white/[0.06] px-2 py-1 text-[11px] text-[#e5e2e1]',
                'outline outline-[0.5px] outline-white/15',
              )}
              aria-label="关键帧段缓动"
            >
              {KEYFRAME_EASE_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div className="w-[180px] shrink-0">
            <DirectorBezierEditor
              ease={selectedKf.ease ?? 'linear'}
              bezier={selectedKf.easeBezier}
              disabled={timelineLocked}
              onChange={handleBezierChange}
            />
          </div>
        </div>
      )}

      <div className="relative">
        <div
          ref={trackRef}
          className="relative h-8 rounded-lg bg-white/[0.06] border border-white/10 overflow-hidden"
        >
          {activeKfs.map((kf) => {
            const leftPct = totalFrames <= 0 ? 0 : (kf.frame / totalFrames) * 100;
            const isSel = kf.id === selectedKeyframeId;
            return (
              <button
                key={kf.id}
                type="button"
                title={`关键帧 · 帧 ${kf.frame}${kf.ease ? ` · ${kf.ease}` : ''}${
                  'boneRotations' in kf && kf.boneRotations ? ' · 含姿势' : ''
                }（拖动改帧，右键删除）`}
                disabled={timelineLocked}
                onPointerDown={startKeyframeDrag(kf.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (timelineLocked) return;
                  if (selectedCameraId) removeCameraKeyframe(selectedCameraId, kf.id);
                  else if (selectedId) removeObjectKeyframe(selectedId, kf.id);
                  if (selectedKeyframeId === kf.id) setSelectedKeyframeId(null);
                }}
                className={cn(
                  'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 hover:scale-110 transition-transform touch-none',
                  markerClass,
                  isSel && 'scale-125 drop-shadow-[0_0_6px_rgba(255,184,102,0.7)]',
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
            ? `当前轨道：${trackHint} · ${activeKfs.length} 个关键帧。拖动菱形改帧号；选中后可调缓动/贝塞尔。${
                !activeTrackIsCamera && selectedObject?.type === 'character'
                  ? ' 人偶关键帧含姿势（骨骼）插值。'
                  : ''
              }${linkedShot ? ` 已关联分镜 ${linkedShot}，导出将回写。` : ''}`
            : '请选中相机或物体后添加关键帧；相机记录位置/旋转/FOV，人偶记录位置/旋转/缩放+姿势。'}
      </p>
        </div>
      </div>
    </div>
  );
}
