import { create } from 'zustand';
import { AppState, GenerationResponse, StyleBase } from '../types';

export const useStore = create<AppState>((set) => ({
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

  setCurrentProjectId: (currentProjectId) => set({ currentProjectId }),
  setProjectTitle: (projectTitle) => set({ projectTitle }),
  setContext: (context) => set({ context }),
  setScript: (script) => set({ script }),
  setStyle: (selectedStyle) => set({ selectedStyle }),
  setImageSize: (imageSize) => set({ imageSize }),
  setAspectRatio: (aspectRatio) => set({ aspectRatio }),
  setGeneratingScript: (isGeneratingScript) => set({ isGeneratingScript }),
  setData: (data) => set((state) => ({ 
    data: data ? {
      ...data,
      storyboards: data.storyboards.map(s => ({ 
        ...s, 
        image_history: s.image_history || [],
        image_size: s.image_size || state.imageSize,
        aspect_ratio: s.aspect_ratio || state.aspectRatio
      }))
    } : null 
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

  resetProject: () => set({
    currentProjectId: null,
    projectTitle: '未命名项目',
    context: '',
    script: '',
    selectedStyle: 'Cinematic',
    imageSize: '2K',
    aspectRatio: '16:9',
    data: null,
    references: []
  }),
}));
