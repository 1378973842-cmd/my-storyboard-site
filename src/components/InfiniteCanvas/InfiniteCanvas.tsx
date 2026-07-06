import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { InfiniteCanvasShell } from './InfiniteCanvasShell';
import { installStudioI18n } from '../../lib/infiniteCanvas/studioI18n';
import {
  disposeInfiniteCanvasEngine,
  consumeQueuedCanvasFavoriteNavigation,
  isInfiniteCanvasEngineMountedOn,
  mountInfiniteCanvasEngine,
  refreshInfiniteCanvasLayout,
  setInfiniteCanvasShellSuspended,
} from '../../lib/infiniteCanvas/canvasEngine.js';
import { CanvasLeftDock } from './CanvasBoardColorPicker';
import { CanvasMaterialLibrary } from './CanvasMaterialLibrary';

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-canvas-src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.canvasSrc = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

let scriptsReadyPromise: Promise<void> | null = null;
let scriptsReadyDone = false;
let activeRoot: HTMLDivElement | null = null;
let bootPromise: Promise<void> | null = null;

function ensureCanvasScripts(): Promise<void> {
  if (scriptsReadyDone) return Promise.resolve();
  if (!scriptsReadyPromise) {
    scriptsReadyPromise = (async () => {
      installStudioI18n();
      await loadScript('/canvas/i18n-canvas.js');
      await loadScript('/canvas/lucide.js');
      await loadScript('/canvas/ltx-director-timeline.js');
      scriptsReadyDone = true;
    })();
  }
  return scriptsReadyPromise;
}

/** 主页悬停「无限画布」时可预热脚本，减少首次进入卡顿 */
export function prefetchInfiniteCanvasAssets(): void {
  void ensureCanvasScripts();
}

async function bootEngineOnRoot(root: HTMLDivElement): Promise<void> {
  if (bootPromise && activeRoot === root) {
    await bootPromise;
    return;
  }
  bootPromise = (async () => {
    await ensureCanvasScripts();
    await mountInfiniteCanvasEngine(root);
    activeRoot = root;
    const lucide = (window as unknown as { lucide?: { createIcons: () => void } }).lucide;
    lucide?.createIcons?.();
    window.StudioI18n?.apply(root);
  })();
  try {
    await bootPromise;
  } finally {
    bootPromise = null;
  }
}

export const InfiniteCanvas = memo(function InfiniteCanvas({
  shellActive = false,
}: {
  shellActive?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [materialLibraryOpen, setMaterialLibraryOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  /** 避免 boot 回调闭包读到过期的 shellActive=false，把已打开的 canvas 再次挂起 */
  const shellActiveRef = useRef(shellActive);
  shellActiveRef.current = shellActive;

  const applyShellActiveState = useCallback((active: boolean) => {
    const root = rootRef.current;
    if (root) {
      root.dataset.shellActive = active ? '1' : '0';
    }
    setInfiniteCanvasShellSuspended(!active);
    if (active) {
      refreshInfiniteCanvasLayout();
    }
  }, []);

  useLayoutEffect(() => {
    if (!shellActive) {
      setMaterialLibraryOpen(false);
      applyShellActiveState(false);
      return;
    }
    // 延后一帧再显示 gate，与 StudioConvergePiece 首帧 opacity:0 对齐，避免选择面板硬弹
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (!cancelled) {
        applyShellActiveState(true);
        void consumeQueuedCanvasFavoriteNavigation();
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [shellActive, applyShellActiveState]);

  useLayoutEffect(() => {
    return () => {
      setInfiniteCanvasShellSuspended(true);
    };
  }, []);

  useLayoutEffect(() => {
    if (!shellActive) return;

    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    const syncLayout = () => {
      if (cancelled) return;
      refreshInfiniteCanvasLayout();
    };

    syncLayout();
    const raf1 = requestAnimationFrame(() => {
      syncLayout();
      requestAnimationFrame(syncLayout);
    });
    const settleTimer = window.setTimeout(syncLayout, 480);

    const board = rootRef.current?.querySelector('#board');
    if (board && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => syncLayout());
      resizeObserver.observe(board);
    }

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf1);
      window.clearTimeout(settleTimer);
      resizeObserver?.disconnect();
    };
  }, [shellActive]);

  const assignRootRef = useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    if (!node) {
      if (activeRoot && isInfiniteCanvasEngineMountedOn(activeRoot)) {
        disposeInfiniteCanvasEngine({ preserveEditor: true });
      }
      activeRoot = null;
      return;
    }
    if (activeRoot === node && isInfiniteCanvasEngineMountedOn(node)) {
      node.dataset.shellActive = shellActiveRef.current ? '1' : '0';
      applyShellActiveState(shellActiveRef.current);
      return;
    }

    node.dataset.shellActive = shellActiveRef.current ? '1' : '0';

    void bootEngineOnRoot(node)
      .then(() => {
        setError(null);
        applyShellActiveState(shellActiveRef.current);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '画布初始化失败');
      });
  }, [applyShellActiveState]);

  if (error) {
    return (
      <div className="infinite-canvas-host flex h-full w-full items-center justify-center bg-[#0e0e0e] text-[#e5e2e1]">
        <p className="max-w-md text-center text-sm text-red-300/90">{error}</p>
      </div>
    );
  }

  return (
    <div className="infinite-canvas-host relative h-full w-full min-h-0 bg-transparent">
      <InfiniteCanvasShell
        rootRef={assignRootRef}
        materialLibraryOpen={materialLibraryOpen}
        onMaterialLibraryOpenChange={setMaterialLibraryOpen}
      />
      <CanvasLeftDock active={shellActive} />
      <CanvasMaterialLibrary
        rootRef={rootRef}
        open={materialLibraryOpen}
        onOpenChange={setMaterialLibraryOpen}
        active={shellActive}
      />
    </div>
  );
});
