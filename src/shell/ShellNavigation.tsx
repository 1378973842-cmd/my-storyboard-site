import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const STORAGE_KEY = 'gemini-shell-nav-v1';

export type ShellScreen =
  | 'cover'
  | 'studio'
  | 'image-editor'
  | 'nine-grid'
  | 'director'
  | 'infinite-canvas'
  | 'my-favorites'
  | 'personal'
  | 'gallery'
  | 'admin-users'
  | 'admin-rh-workflows'
  | 'admin-home-carousel';

type SubScreen =
  | 'my-favorites'
  | 'personal'
  | 'gallery'
  | 'admin-users'
  | 'admin-rh-workflows'
  | 'admin-home-carousel';

const SUB_SCREENS = new Set<ShellScreen>([
  'my-favorites',
  'personal',
  'gallery',
  'admin-users',
  'admin-rh-workflows',
  'admin-home-carousel',
]);

function isSubScreen(screen: ShellScreen): screen is SubScreen {
  return SUB_SCREENS.has(screen);
}

type Snap = {
  screen: ShellScreen;
  studioKeepAlive: boolean;
  imageEditorKeepAlive: boolean;
  nineGridKeepAlive: boolean;
  directorWorkbenchKeepAlive: boolean;
  infiniteCanvasKeepAlive: boolean;
};

const VALID_SCREENS = new Set<ShellScreen>([
  'cover',
  'studio',
  'image-editor',
  'nine-grid',
  'director',
  'infinite-canvas',
  'my-favorites',
  'personal',
  'gallery',
  'admin-users',
  'admin-rh-workflows',
  'admin-home-carousel',
]);

function readSnap(): Snap | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Snap>;
    const screen = data.screen;
    if (screen && VALID_SCREENS.has(screen)) {
      return {
        screen,
        studioKeepAlive: Boolean(data.studioKeepAlive) || screen === 'studio',
        imageEditorKeepAlive: Boolean(data.imageEditorKeepAlive),
        nineGridKeepAlive: Boolean(data.nineGridKeepAlive),
        directorWorkbenchKeepAlive: Boolean(data.directorWorkbenchKeepAlive),
        infiniteCanvasKeepAlive: Boolean(data.infiniteCanvasKeepAlive) || screen === 'infinite-canvas',
      };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeSnap(snap: Snap) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch {
    /* ignore */
  }
}

type ShellNavigationValue = {
  screen: ShellScreen;
  studioKeepAlive: boolean;
  imageEditorKeepAlive: boolean;
  nineGridKeepAlive: boolean;
  directorWorkbenchKeepAlive: boolean;
  infiniteCanvasKeepAlive: boolean;
  openCover: () => void;
  openStudio: () => void;
  openImageEditor: () => void;
  openNineGrid: () => void;
  openDirectorWorkbench: () => void;
  /** 打开导演台并把分镜图导入为参考平面 */
  openDirectorWithStoryboardShot: (payload: {
    imageUrl: string;
    shotNumber?: string;
    summary?: string;
    directorNotes?: string;
  }) => void;
  openInfiniteCanvas: () => void;
  /** 工作空间：打开选择画布闸门（不自动恢复上次画布） */
  openCanvasWorkspace: () => void;
  openMyFavorites: () => void;
  openPersonal: () => void;
  openGallery: () => void;
  openAdminUsers: () => void;
  openAdminRhWorkflows: () => void;
  openAdminHomeCarousel: () => void;
  goBack: () => void;
  warmInfiniteCanvas: () => void;
};

const ShellNavigationContext = createContext<ShellNavigationValue | null>(null);

export function ShellNavigationProvider({ children }: { children: React.ReactNode }) {
  const initial = readSnap();
  const returnToRef = useRef<ShellScreen>(
    initial?.screen && !isSubScreen(initial.screen) ? initial.screen : 'cover',
  );
  const [screen, setScreen] = useState<ShellScreen>(initial?.screen ?? 'cover');
  const [studioKeepAlive, setStudioKeepAlive] = useState(
    () => initial?.studioKeepAlive ?? initial?.screen === 'studio',
  );
  const [imageEditorKeepAlive, setImageEditorKeepAlive] = useState(
    () => initial?.imageEditorKeepAlive ?? false,
  );
  const [nineGridKeepAlive, setNineGridKeepAlive] = useState(
    () => initial?.nineGridKeepAlive ?? false,
  );
  const [directorWorkbenchKeepAlive, setDirectorWorkbenchKeepAlive] = useState(
    () => initial?.directorWorkbenchKeepAlive ?? false,
  );
  const [infiniteCanvasKeepAlive, setInfiniteCanvasKeepAlive] = useState(
    () => initial?.infiniteCanvasKeepAlive ?? initial?.screen === 'infinite-canvas',
  );

  useEffect(() => {
    writeSnap({
      screen,
      studioKeepAlive: studioKeepAlive || screen === 'studio',
      imageEditorKeepAlive,
      nineGridKeepAlive,
      directorWorkbenchKeepAlive,
      infiniteCanvasKeepAlive: infiniteCanvasKeepAlive || screen === 'infinite-canvas',
    });
  }, [
    screen,
    studioKeepAlive,
    imageEditorKeepAlive,
    nineGridKeepAlive,
    directorWorkbenchKeepAlive,
    infiniteCanvasKeepAlive,
  ]);

  const openSubPage = useCallback((target: SubScreen) => {
    setScreen((prev) => {
      if (!isSubScreen(prev)) returnToRef.current = prev;
      return target;
    });
  }, []);

  const openCover = useCallback(() => setScreen('cover'), []);
  const openStudio = useCallback(() => {
    setStudioKeepAlive(true);
    setScreen('studio');
  }, []);
  const openImageEditor = useCallback(() => {
    setImageEditorKeepAlive(true);
    setScreen('image-editor');
  }, []);
  const openNineGrid = useCallback(() => {
    setNineGridKeepAlive(true);
    setScreen('nine-grid');
  }, []);
  const openDirectorWorkbench = useCallback(() => {
    setDirectorWorkbenchKeepAlive(true);
    setScreen('director');
  }, []);
  const openDirectorWithStoryboardShot = useCallback(
    (payload: {
      imageUrl: string;
      shotNumber?: string;
      summary?: string;
      directorNotes?: string;
    }) => {
      setDirectorWorkbenchKeepAlive(true);
      setScreen('director');
      // 等导演台挂载后再写入场景
      queueMicrotask(() => {
        void import('../store/useDirectorSceneStore').then(({ useDirectorSceneStore }) => {
          useDirectorSceneStore.getState().importStoryboardShot(payload);
        });
      });
    },
    [],
  );
  const openInfiniteCanvas = useCallback(() => {
    setInfiniteCanvasKeepAlive(true);
    setScreen('infinite-canvas');
  }, []);
  const openCanvasWorkspace = useCallback(() => {
    setInfiniteCanvasKeepAlive(true);
    setScreen('infinite-canvas');
    void import('../lib/homeCanvasBridge').then(({ openCanvasSelectionGate }) => {
      void openCanvasSelectionGate({
        warmInfiniteCanvas: () => setInfiniteCanvasKeepAlive(true),
        openInfiniteCanvas: () => setScreen('infinite-canvas'),
      }).catch((err) => {
        console.warn('[shell] open canvas workspace failed', err);
      });
    });
  }, []);
  const openMyFavorites = useCallback(() => {
    setInfiniteCanvasKeepAlive(true);
    setScreen('infinite-canvas');
    // 进入画布后打开素材库「收藏」
    window.setTimeout(() => {
      window.dispatchEvent(new CustomEvent('canvas-open-material-library', { detail: { view: 'favorites' } }));
    }, 80);
  }, []);
  const openPersonal = useCallback(() => openSubPage('personal'), [openSubPage]);
  const openGallery = useCallback(() => openSubPage('gallery'), [openSubPage]);
  const openAdminUsers = useCallback(() => openSubPage('admin-users'), [openSubPage]);
  const openAdminRhWorkflows = useCallback(() => openSubPage('admin-rh-workflows'), [openSubPage]);
  const openAdminHomeCarousel = useCallback(() => openSubPage('admin-home-carousel'), [openSubPage]);
  const goBack = useCallback(() => {
    setScreen(returnToRef.current);
  }, []);
  const warmInfiniteCanvas = useCallback(() => {
    setInfiniteCanvasKeepAlive(true);
  }, []);

  const value = useMemo(
    () => ({
      screen,
      studioKeepAlive,
      imageEditorKeepAlive,
      nineGridKeepAlive,
      directorWorkbenchKeepAlive,
      infiniteCanvasKeepAlive,
      openCover,
      openStudio,
      openImageEditor,
      openNineGrid,
      openDirectorWorkbench,
      openDirectorWithStoryboardShot,
      openInfiniteCanvas,
      openCanvasWorkspace,
      openMyFavorites,
      openPersonal,
      openGallery,
      openAdminUsers,
      openAdminRhWorkflows,
      openAdminHomeCarousel,
      goBack,
      warmInfiniteCanvas,
    }),
    [
      screen,
      studioKeepAlive,
      imageEditorKeepAlive,
      nineGridKeepAlive,
      directorWorkbenchKeepAlive,
      infiniteCanvasKeepAlive,
      openCover,
      openStudio,
      openImageEditor,
      openNineGrid,
      openDirectorWorkbench,
      openDirectorWithStoryboardShot,
      openInfiniteCanvas,
      openCanvasWorkspace,
      openMyFavorites,
      openPersonal,
      openGallery,
      openAdminUsers,
      openAdminRhWorkflows,
      openAdminHomeCarousel,
      goBack,
      warmInfiniteCanvas,
    ],
  );

  return (
    <ShellNavigationContext.Provider value={value}>{children}</ShellNavigationContext.Provider>
  );
}

export function useShellNavigation(): ShellNavigationValue {
  const ctx = useContext(ShellNavigationContext);
  if (!ctx) {
    throw new Error('useShellNavigation must be used within ShellNavigationProvider');
  }
  return ctx;
}
