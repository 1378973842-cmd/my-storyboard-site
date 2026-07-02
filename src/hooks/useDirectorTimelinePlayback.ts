import { useEffect, useRef } from 'react';
import { DIRECTOR_TIMELINE_RECORD_END } from './useCanvasRecorder';
import { useDirectorSceneStore } from '../store/useDirectorSceneStore';

/** 时间轴播放循环：按 fps 推进当前帧并应用到各相机关键帧轨道 */
export function useDirectorTimelinePlayback() {
  const isPlaying = useDirectorSceneStore((s) => s.timelineIsPlaying);
  const fps = useDirectorSceneStore((s) => s.timelineFps);
  const totalFrames = useDirectorSceneStore((s) => s.timelineTotalFrames);
  const rafRef = useRef(0);
  const lastRef = useRef(0);

  useEffect(() => {
    if (!isPlaying) return;

    lastRef.current = performance.now();

    const tick = (now: number) => {
      const state = useDirectorSceneStore.getState();
      if (!state.timelineIsPlaying) return;

      const deltaSec = (now - lastRef.current) / 1000;
      lastRef.current = now;
      const nextFrame = state.timelineCurrentFrame + deltaSec * fps;

      if (nextFrame >= totalFrames) {
        state.setTimelineCurrentFrame(totalFrames);
        state.applyTimelineFrame(totalFrames);
        state.setTimelinePlaying(false);
        if (state.timelineIsRecording) {
          window.dispatchEvent(new CustomEvent(DIRECTOR_TIMELINE_RECORD_END));
        } else {
          state.setTimelineCurrentFrame(0);
          state.applyTimelineFrame(0);
        }
      } else {
        state.setTimelineCurrentFrame(nextFrame);
        state.applyTimelineFrame(nextFrame);
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [isPlaying, fps, totalFrames]);
}
