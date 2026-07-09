import type { DirectorSceneSnapshot } from '../../store/useDirectorSceneStore';
import { TIMELINE_FPS, TIMELINE_TOTAL_FRAMES } from '../../store/useDirectorSceneStore';

const PROJECT_VERSION = 1;
const DRAFT_KEY = 'lhz-director-scene-draft-v1';

export type DirectorPersistedSnapshot = DirectorSceneSnapshot & {
  version?: number;
  timelineTotalFrames?: number;
  timelineFps?: number;
};

export function downloadProjectJson(snapshot: DirectorPersistedSnapshot, filename?: string) {
  const json = JSON.stringify({ version: PROJECT_VERSION, ...snapshot }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename ?? `director-scene-${Date.now()}.json`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function parseProjectJson(text: string): DirectorPersistedSnapshot | null {
  try {
    const data = JSON.parse(text) as DirectorPersistedSnapshot;
    if (!data.cameras || !data.objects) return null;
    return {
      objects: data.objects,
      cameras: data.cameras,
      savedPoses: data.savedPoses ?? [],
      showGrid: data.showGrid ?? true,
      showGround: data.showGround ?? true,
      cameraKeyframes: data.cameraKeyframes ?? {},
      objectKeyframes: data.objectKeyframes ?? {},
      timelineTotalFrames: data.timelineTotalFrames ?? TIMELINE_TOTAL_FRAMES,
      timelineFps: data.timelineFps ?? TIMELINE_FPS,
    };
  } catch {
    return null;
  }
}

export function saveDirectorDraft(snapshot: DirectorPersistedSnapshot) {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({ version: PROJECT_VERSION, savedAt: Date.now(), ...snapshot }),
    );
  } catch (e) {
    console.warn('[director] draft save failed', e);
  }
}

export function loadDirectorDraft(): DirectorPersistedSnapshot | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    return parseProjectJson(raw);
  } catch {
    return null;
  }
}

export function clearDirectorDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
