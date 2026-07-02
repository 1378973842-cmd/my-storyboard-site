import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useDirectorSceneStore } from '../store/useDirectorSceneStore';

export const DIRECTOR_TIMELINE_RECORD_END = 'director-timeline-record-end';

type SavedTimelineState = {
  lockViewToCamera: boolean;
  showCameraGizmo: boolean;
  showGrid: boolean;
  timelineIsPlaying: boolean;
  timelineCurrentFrame: number;
};

function pickRecorderMimeType(): string {
  const candidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return 'video/webm';
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function waitAnimationFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const step = () => {
      left -= 1;
      if (left <= 0) resolve();
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

/** 录制主 WebGL 画布：锁定选中相机视角 → 播放时间轴 → 导出 WebM */
export function useCanvasRecorder(canvasRef: RefObject<HTMLCanvasElement | null>) {
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const savedRef = useRef<SavedTimelineState | null>(null);

  const restoreSavedState = useCallback(() => {
    const saved = savedRef.current;
    if (!saved) {
      setIsRecording(false);
      return;
    }
    const store = useDirectorSceneStore.getState();
    store.setTimelineRecording(false);
    store.setTimelinePlaying(false);
    store.setTimelineCurrentFrame(saved.timelineCurrentFrame);
    store.applyTimelineFrame(saved.timelineCurrentFrame);
    store.setLockViewToCamera(saved.lockViewToCamera);
    store.setShowCameraGizmo(saved.showCameraGizmo);
    store.setShowGrid(saved.showGrid);
    savedRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    setIsRecording(false);
  }, []);

  useEffect(() => {
    const onRecordEnd = () => {
      const recorder = mediaRecorderRef.current;
      if (recorder && recorder.state !== 'inactive') {
        recorder.stop();
      }
    };
    window.addEventListener(DIRECTOR_TIMELINE_RECORD_END, onRecordEnd);
    return () => window.removeEventListener(DIRECTOR_TIMELINE_RECORD_END, onRecordEnd);
  }, []);

  const startExport = useCallback(async () => {
    const canvas = canvasRef.current;
    const state = useDirectorSceneStore.getState();

    if (!canvas) {
      window.alert('未找到主画布，无法录制');
      return;
    }
    if (!state.selectedCameraId) {
      window.alert('请先选中要录制的相机');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      window.alert('当前浏览器不支持 MediaRecorder 录制');
      return;
    }
    if (!HTMLCanvasElement.prototype.captureStream) {
      window.alert('当前浏览器不支持 canvas.captureStream');
      return;
    }

    savedRef.current = {
      lockViewToCamera: state.lockViewToCamera,
      showCameraGizmo: state.showCameraGizmo,
      showGrid: state.showGrid,
      timelineIsPlaying: state.timelineIsPlaying,
      timelineCurrentFrame: state.timelineCurrentFrame,
    };

    setIsRecording(true);
    state.setTimelineRecording(true);
    state.setTimelinePlaying(false);
    state.setTimelineCurrentFrame(0);
    state.applyTimelineFrame(0);
    state.setLockViewToCamera(true);
    state.setShowCameraGizmo(false);
    state.setShowGrid(false);

    await waitAnimationFrames(3);

    const fps = state.timelineFps;
    const mimeType = pickRecorderMimeType();
    const stream = canvas.captureStream(fps);
    chunksRef.current = [];

    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
    });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };

    recorder.onerror = () => {
      stream.getTracks().forEach((track) => track.stop());
      window.alert('录制失败，请重试');
      restoreSavedState();
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      const blob = new Blob(chunksRef.current, { type: mimeType.split(';')[0] || 'video/webm' });
      const ext = mimeType.includes('webm') ? 'webm' : 'mp4';
      downloadBlob(blob, `camera_movement.${ext}`);
      restoreSavedState();
    };

    recorder.start(200);
    await waitAnimationFrames(1);
    useDirectorSceneStore.getState().setTimelinePlaying(true);
  }, [canvasRef, restoreSavedState]);

  return { isRecording, startExport };
}
