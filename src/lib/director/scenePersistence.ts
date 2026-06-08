import type { DirectorSceneSnapshot } from '../../store/useDirectorSceneStore';

const PROJECT_VERSION = 1;

export function downloadProjectJson(snapshot: DirectorSceneSnapshot, filename?: string) {
  const json = JSON.stringify({ version: PROJECT_VERSION, ...snapshot }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename ?? `director-scene-${Date.now()}.json`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function parseProjectJson(text: string): DirectorSceneSnapshot | null {
  try {
    const data = JSON.parse(text) as { version?: number } & DirectorSceneSnapshot;
    if (!data.cameras || !data.objects) return null;
    return {
      objects: data.objects,
      cameras: data.cameras,
      savedPoses: data.savedPoses ?? [],
      showGrid: data.showGrid ?? true,
      showGround: data.showGround ?? true,
    };
  } catch {
    return null;
  }
}
