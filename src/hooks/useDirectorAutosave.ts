import { useEffect, useRef } from 'react';
import {
  loadDirectorDraft,
  saveDirectorDraft,
} from '../lib/director/scenePersistence';
import { useDirectorSceneStore } from '../store/useDirectorSceneStore';

const SAVE_DEBOUNCE_MS = 800;

/** 进入导演台时恢复 localStorage 草稿；编辑时防抖自动保存 */
export function useDirectorAutosave() {
  const hydrated = useRef(false);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const draft = loadDirectorDraft();
    if (!draft) return;
    const state = useDirectorSceneStore.getState();
    const empty =
      state.objects.length === 0 &&
      Object.keys(state.cameraKeyframes).length === 0 &&
      Object.keys(state.objectKeyframes).length === 0;
    // 仅在近乎空场景时恢复，避免覆盖用户已打开的工程
    if (empty) {
      state.loadProjectSnapshot(draft);
    }
  }, []);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsub = useDirectorSceneStore.subscribe(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const snap = useDirectorSceneStore.getState().getProjectSnapshot();
        saveDirectorDraft(snap);
      }, SAVE_DEBOUNCE_MS);
    });
    return () => {
      unsub();
      if (timer) clearTimeout(timer);
    };
  }, []);
}
