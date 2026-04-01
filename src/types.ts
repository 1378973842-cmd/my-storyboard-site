export interface GlobalAssets {
  scenes: {
    description: string;
    image_url?: string;
    image_history?: string[];
  }[];
}

export interface ReferenceImage {
  id: string;
  url: string; // base64 or blob url
  name: string;
  type: 'character' | 'scene';
}

export interface Storyboard {
  shot_number: string;
  summary: string;
  director_notes: string;
  image_prompt: string;
  video_prompt: string;
  image_url?: string;
  image_history?: string[];
  is_loading_image?: boolean;
  image_size?: ImageSize;
  aspect_ratio?: AspectRatio;
  // Detail fields
  dialogue?: string;
  shot_type?: string;
  lens?: string;
  frame_depth?: string;
  movement?: string;
  character?: string;
  mood?: string;
}

export interface GenerationResponse {
  global_assets: GlobalAssets;
  storyboards: Storyboard[];
  qa_check: string[];
}

export type StyleBase = 'Pixar' | 'Cyberpunk' | 'Realistic' | 'Anime' | 'Cinematic';
export type ImageSize = '1K' | '2K' | '4K';
export type AspectRatio = '4:3' | '3:4' | '16:9' | '9:16' | '2:3' | '3:2' | '1:1' | '4:5' | '5:4' | '21:9';

/** 日间：高对比、浅色底；夜间：深色底、降低刺眼 */
export type UiTheme = 'light' | 'dark';

export interface AppState {
  currentProjectId: string | null;
  projectTitle: string;
  context: string;
  script: string;
  selectedStyle: StyleBase;
  imageSize: ImageSize;
  aspectRatio: AspectRatio;
  isGeneratingScript: boolean;
  data: GenerationResponse | null;
  references: ReferenceImage[];
  selectedShotNumber: string | null;
  uiTheme: UiTheme;
  imageEditor: {
    isOpen: boolean;
    target:
      | { kind: 'reference'; id: string; url: string; title?: string }
      | { kind: 'shot'; shotNumber: string; url: string; title?: string }
      | { kind: 'scene'; sceneIndex: number; url: string; title?: string }
      | null;
  };

  setCurrentProjectId: (id: string | null) => void;
  setProjectTitle: (title: string) => void;
  setContext: (context: string) => void;
  setScript: (script: string) => void;
  setStyle: (style: StyleBase) => void;
  setImageSize: (size: ImageSize) => void;
  setAspectRatio: (ratio: AspectRatio) => void;
  setGeneratingScript: (val: boolean) => void;
  setData: (data: GenerationResponse | null) => void;
  addReference: (ref: ReferenceImage) => void;
  updateReference: (id: string, url: string) => void;
  updateReferenceName: (id: string, name: string) => void;
  reorderReferences: (startIndex: number, endIndex: number) => void;
  removeReference: (id: string) => void;
  updateStoryboard: (shotNumber: string, updatedShot: Partial<Storyboard>) => void;
  updateStoryboardImage: (shotNumber: string, url: string) => void;
  switchStoryboardImage: (shotNumber: string, url: string) => void;
  updateStoryboardPrompt: (shotNumber: string, type: 'image' | 'video', content: string) => void;
  updateStoryboardParams: (shotNumber: string, params: { image_size?: ImageSize, aspect_ratio?: AspectRatio }) => void;
  setStoryboardLoading: (shotNumber: string, loading: boolean) => void;
  removeStoryboard: (shotNumber: string) => void;
  setSelectedShotNumber: (shotNumber: string | null) => void;
  setUiTheme: (theme: UiTheme) => void;
  openImageEditor: (target: NonNullable<AppState['imageEditor']['target']>) => void;
  closeImageEditor: () => void;
  updateGlobalSceneImage: (sceneIndex: number, url: string) => void;
  resetProject: () => void;
}

const THEME_STORAGE_KEY = 'storyboard-ui-theme';

export function readStoredUiTheme(): UiTheme {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function persistUiTheme(theme: UiTheme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    /* ignore */
  }
}
