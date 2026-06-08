import { create } from 'zustand';

const STORAGE_KEY = 'studio-bg-reveal-v1';
/** 0–1：越大底图越清晰（遮罩越淡） */
export const DEFAULT_STUDIO_BG_REVEAL = 0.58;

function readStoredReveal(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw == null) return DEFAULT_STUDIO_BG_REVEAL;
    const n = Number(raw);
    if (!Number.isFinite(n)) return DEFAULT_STUDIO_BG_REVEAL;
    return Math.min(1, Math.max(0, n / 100));
  } catch {
    return DEFAULT_STUDIO_BG_REVEAL;
  }
}

export function applyStudioBgReveal(reveal: number) {
  const v = Math.min(1, Math.max(0, reveal));
  document.documentElement.style.setProperty('--studio-bg-reveal', String(v));
}

type StudioBackgroundState = {
  reveal: number;
  setReveal: (reveal: number) => void;
  setRevealPercent: (percent: number) => void;
};

const initialReveal = readStoredReveal();
applyStudioBgReveal(initialReveal);

export const useStudioBackgroundStore = create<StudioBackgroundState>((set) => ({
  reveal: initialReveal,
  setReveal: (reveal) => {
    const v = Math.min(1, Math.max(0, reveal));
    applyStudioBgReveal(v);
    try {
      localStorage.setItem(STORAGE_KEY, String(Math.round(v * 100)));
    } catch {
      /* ignore */
    }
    set({ reveal: v });
  },
  setRevealPercent: (percent) => {
    const v = Math.min(100, Math.max(0, percent)) / 100;
    useStudioBackgroundStore.getState().setReveal(v);
  },
}));
