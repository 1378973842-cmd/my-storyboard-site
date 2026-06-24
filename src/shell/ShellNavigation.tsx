import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

const STORAGE_KEY = 'gemini-shell-nav-v1';

export type ShellScreen =
  | 'cover'
  | 'studio'
  | 'image-editor'
  | 'nine-grid'
  | 'director'
  | 'infinite-canvas';

type Snap = {
  screen: ShellScreen;
  studioKeepAlive: boolean;
  imageEditorKeepAlive: boolean;
  nineGridKeepAlive: boolean;
  directorWorkbenchKeepAlive: boolean;
  infiniteCanvasKeepAlive: boolean;
};

function readSnap(): Snap | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Partial<Snap>;
    const screen = data.screen;
    if (
      screen === 'cover' ||
      screen === 'studio' ||
      screen === 'image-editor' ||
      screen === 'nine-grid' ||
      screen === 'director' ||
      screen === 'infinite-canvas'
    ) {
      return {
        screen,
        studioKeepAlive: Boolean(data.studioKeepAlive) || screen === 'studio',
        imageEditorKeepAlive: Boolean(data.imageEditorKeepAlive),
        nineGridKeepAlive: Boolean(data.nineGridKeepAlive),
        directorWorkbenchKeepAlive: Boolean(data.directorWorkbenchKeepAlive),
        infiniteCanvasKeepAlive: Boolean(data.infiniteCanvasKeepAlive),
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
  openInfiniteCanvas: () => void;
  /** 仅预热挂载（不改 screen），主页悬停画布入口时调用 */
  warmInfiniteCanvas: () => void;
};

const ShellNavigationContext = createContext<ShellNavigationValue | null>(null);

export function ShellNavigationProvider({ children }: { children: React.ReactNode }) {
  const initial = readSnap();
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
  const openInfiniteCanvas = useCallback(() => {
    setInfiniteCanvasKeepAlive(true);
    setScreen('infinite-canvas');
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
      openInfiniteCanvas,
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
      openInfiniteCanvas,
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
