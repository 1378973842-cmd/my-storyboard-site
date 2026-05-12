import { create } from 'zustand';
import { AppState, readStoredUiTheme } from '../types';

function defaultShotNumber(index: number): string {
  return `镜头 ${String(index + 1).padStart(2, '0')}`;
}

export const useStore = create<AppState>()((set, get) => ({
  currentProjectId: null,
  projectTitle: '未命名项目',
  context: '',
  script: '',
  selectedStyle: 'Cinematic',
  imageSize: '2K',
  aspectRatio: '16:9',
  isGeneratingScript: false,
  data: null,
  references: [],
  selectedShotNumber: null,
  uiTheme: readStoredUiTheme(),
  imageEditor: { isOpen: false, target: null },
  notices: [],

  setCurrentProjectId: (currentProjectId) => set({ currentProjectId }),
  setProjectTitle: (projectTitle) => set({ projectTitle }),
  setContext: (context) => set({ context }),
  setScript: (script) => set({ script }),
  setStyle: (selectedStyle) => set({ selectedStyle }),
  setImageSize: (imageSize) => set({ imageSize }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
  setGeneratingScript: (isGeneratingScript) => set({ isGeneratingScript }),
  setData: (data) =>
    set((state) => ({
      data: data
        ? {
            ...data,
            global_assets:
              data.global_assets && Array.isArray(data.global_assets.scenes)
                ? data.global_assets
                : { scenes: [{ description: '' }] },
            storyboards: (() => {
              const rawList = Array.isArray(data.storyboards) ? data.storyboards : [];
              const seen = new Set<string>();
              return rawList.map((s, i) => {
                const rawNum = s.shot_number;
                const trimmed = rawNum != null ? String(rawNum).trim() : '';
                let shot_number = trimmed || defaultShotNumber(i);
                // 同一编号会命中多条分镜，生图更新会「串图」——顺延默认镜头名直到唯一
                if (seen.has(shot_number)) {
                  let n = i;
                  do {
                    n += 1;
                    shot_number = defaultShotNumber(n);
                  } while (seen.has(shot_number));
                }
                seen.add(shot_number);
                return {
                  ...s,
                  shot_number,
                  summary: s.summary ?? '',
                  director_notes: s.director_notes ?? '',
                  image_prompt: s.image_prompt ?? '',
                  video_prompt: s.video_prompt ?? '',
                  image_history: s.image_history || [],
                  image_size: s.image_size || state.imageSize,
                  aspect_ratio: s.aspect_ratio || state.aspectRatio,
                };
              });
            })(),
          }
        : null,
    })),

  addReference: (ref) => set((state) => ({ references: [...state.references, ref] })),
  updateReference: (id, url) => set((state) => ({
    references: state.references.map(r => r.id === id ? { ...r, url } : r)
  })),
  updateReferenceName: (id, name) => set((state) => ({
    references: state.references.map(r => r.id === id ? { ...r, name } : r)
  })),
  reorderReferences: (startIndex, endIndex) => set((state) => {
    const result = Array.from(state.references);
    const [removed] = result.splice(startIndex, 1);
    result.splice(endIndex, 0, removed);
    return { references: result };
  }),
  removeReference: (id) => set((state) => ({ references: state.references.filter(r => r.id !== id) })),

  updateStoryboard: (shotNumber, updatedShot) => set((state) => ({
    data: state.data ? {
      ...state.data,
      storyboards: state.data.storyboards.map((s) =>
        s.shot_number === shotNumber ? { ...s, ...updatedShot } : s
      )
    } : null
  })),

  updateStoryboardImage: (shotNumber, url) => set((state) => ({
    data: state.data ? {
      ...state.data,
      storyboards: state.data.storyboards.map((s) =>
        s.shot_number === shotNumber ? {
          ...s,
          image_url: url,
          image_history: [...(s.image_history || []), url],
          is_loading_image: false
        } : s
      )
    } : null
  })),

  switchStoryboardImage: (shotNumber, url) => set((state) => ({
    data: state.data ? {
      ...state.data,
      storyboards: state.data.storyboards.map((s) =>
        s.shot_number === shotNumber ? { ...s, image_url: url } : s
      )
    } : null
  })),

  updateStoryboardPrompt: (shotNumber, type, content) => set((state) => ({
    data: state.data ? {
      ...state.data,
      storyboards: state.data.storyboards.map((s) =>
        s.shot_number === shotNumber ? {
          ...s,
          [type === 'image' ? 'image_prompt' : 'video_prompt']: content
        } : s
      )
    } : null
  })),

  updateStoryboardParams: (shotNumber, params) => set((state) => ({
    data: state.data ? {
      ...state.data,
      storyboards: state.data.storyboards.map((s) =>
        s.shot_number === shotNumber ? { ...s, ...params } : s
      )
    } : null
  })),

  setStoryboardLoading: (shotNumber, loading) => set((state) => ({
    data: state.data ? {
      ...state.data,
      storyboards: state.data.storyboards.map((s) =>
        s.shot_number === shotNumber ? { ...s, is_loading_image: loading } : s
      )
    } : null
  })),

  removeStoryboard: (shotNumber) => set((state) => ({
    data: state.data ? {
      ...state.data,
      storyboards: state.data.storyboards.filter((s) => s.shot_number !== shotNumber)
    } : null
  })),

  setSelectedShotNumber: (selectedShotNumber) => set({ selectedShotNumber }),

  openImageEditor: (target) => set({ imageEditor: { isOpen: true, target } }),
  closeImageEditor: () => set({ imageEditor: { isOpen: false, target: null } }),

  updateGlobalSceneImage: (sceneIndex, url) =>
    set((state) => ({
      data: state.data
        ? {
            ...state.data,
            global_assets: {
              ...state.data.global_assets,
              scenes: state.data.global_assets.scenes.map((scene, i) =>
                i === sceneIndex
                  ? {
                      ...scene,
                      image_url: url,
                      image_history: [url, ...(scene.image_history || [])],
                    }
                  : scene
              ),
            },
          }
        : null,
    })),

  addNotice: (message, level = 'info', action) =>
    set((state) => ({
      notices: [
        { id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, message, level, action, createdAt: Date.now() },
        ...state.notices,
      ].slice(0, 8),
    })),
  removeNotice: (id) => set((state) => ({ notices: state.notices.filter((n) => n.id !== id) })),

  setUiTheme: (uiTheme) => {
    const prev = get().uiTheme;
    if (prev === uiTheme) return;

    const apply = () => {
      if (typeof document !== 'undefined') {
        document.documentElement.dataset.theme = uiTheme;
      }
      set({ uiTheme });
    };

    if (typeof window === 'undefined') {
      apply();
      return;
    }

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      apply();
      return;
    }

    const doc = document as Document & {
      startViewTransition?: (callback: () => void) => { finished: Promise<void> };
    };

    if (typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(apply);
    } else {
      apply();
    }
  },

  resetProject: () =>
    set((state) => ({
      currentProjectId: null,
      projectTitle: '未命名项目',
      context: '',
      script: '',
      selectedStyle: 'Cinematic',
      imageSize: '2K',
      aspectRatio: '16:9',
      data: null,
      references: [],
      uiTheme: state.uiTheme,
      imageEditor: { isOpen: false, target: null },
    })),
}));
