import type { SceneData, SceneVec3 } from '../../types';

function isVec3(v: unknown): v is SceneVec3 {
  return (
    Array.isArray(v) &&
    v.length === 3 &&
    v.every((n) => typeof n === 'number' && Number.isFinite(n))
  );
}

/** 从 LLM 原始文本或已解析对象提取 SceneData；失败返回 null */
export function parseSceneDataPayload(raw: unknown): SceneData | null {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      data = JSON.parse(trimmed);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start < 0 || end <= start) return null;
      try {
        data = JSON.parse(trimmed.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;

  const obj = data as Record<string, unknown>;
  const out: SceneData = {};

  if (obj.camera !== undefined) {
    if (!obj.camera || typeof obj.camera !== 'object' || Array.isArray(obj.camera)) return null;
    const cam = obj.camera as Record<string, unknown>;
    const camera: NonNullable<SceneData['camera']> = {};
    if (cam.position !== undefined) {
      if (!isVec3(cam.position)) return null;
      camera.position = cam.position;
    }
    if (cam.rotation !== undefined) {
      if (!isVec3(cam.rotation)) return null;
      camera.rotation = cam.rotation;
    }
    if (cam.fov !== undefined) {
      if (typeof cam.fov !== 'number' || !Number.isFinite(cam.fov)) return null;
      camera.fov = cam.fov;
    }
    if (camera.position || camera.rotation || camera.fov !== undefined) out.camera = camera;
  }

  if (obj.characters !== undefined) {
    if (!Array.isArray(obj.characters)) return null;
    const characters: NonNullable<SceneData['characters']> = [];
    for (const item of obj.characters) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const c = item as Record<string, unknown>;
      if (typeof c.id !== 'string' || !c.id.trim()) return null;
      const entry: NonNullable<SceneData['characters']>[number] = { id: c.id.trim() };
      if (c.position !== undefined) {
        if (!isVec3(c.position)) return null;
        entry.position = c.position;
      }
      if (c.rotation !== undefined) {
        if (!isVec3(c.rotation)) return null;
        entry.rotation = c.rotation;
      }
      if (c.posePreset !== undefined) {
        if (typeof c.posePreset !== 'string') return null;
        entry.posePreset = c.posePreset;
      }
      characters.push(entry);
    }
    if (characters.length) out.characters = characters;
  }

  if (!out.camera && !out.characters?.length) return null;
  return out;
}
