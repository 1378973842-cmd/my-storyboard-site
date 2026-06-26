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
  syncCanvasTopbarDom,
} from '../../lib/infiniteCanvas/canvasEngine.js';
import { CANVAS_TOPBAR_SLOT_ID } from '../StudioTopNav';
import { CanvasLeftDock } from './CanvasBoardColorPicker';

function dockCanvasTopbar(root: HTMLDivElement | null): (() => void) | undefined {
  if (!root) return undefined;
  const slot = document.getElementById(CANVAS_TOPBAR_SLOT_ID);
  const topbar = root.querySelector('.topbar.editor-only');
  const shell = root.querySelector('#shell');
  if (!(topbar instanceof HTMLElement) || !(shell instanceof HTMLElement) || !slot) return undefined;

  const placeholder = document.createComment('canvas-topbar-placeholder');
  shell.insertBefore(placeholder, topbar);
  slot.appendChild(topbar);
  topbar.classList.add('canvas-topbar-docked');
  syncCanvasTopbarDom();

  return () => {
    topbar.classList.remove('canvas-topbar-docked');
    if (placeholder.parentNode === shell) {
      shell.insertBefore(topbar, placeholder);
      placeholder.remove();
    }
  };
}

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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const undockTopbarRef = useRef<(() => void) | null>(null);

  const syncTopbarDock = useCallback((root: HTMLDivElement | null) => {
    undockTopbarRef.current?.();
    undockTopbarRef.current = null;
    if (root && shellActive) {
      undockTopbarRef.current = dockCanvasTopbar(root) ?? null;
    }
  }, [shellActive]);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root) {
      root.dataset.shellActive = shellActive ? '1' : '0';
    }
    if (!shellActive) {
      setInfiniteCanvasShellSuspended(true);
      return;
    }
    // 延后一帧再显示 gate，与 StudioConvergePiece 首帧 opacity:0 对齐，避免选择面板硬弹
    let cancelled = false;
    const id = requestAnimationFrame(() => {
      if (!cancelled) {
        setInfiniteCanvasShellSuspended(false);
        void consumeQueuedCanvasFavoriteNavigation();
      }
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(id);
    };
  }, [shellActive]);

  useLayoutEffect(() => {
    return () => {
      setInfiniteCanvasShellSuspended(true);
    };
  }, []);

  useLayoutEffect(() => {
    syncTopbarDock(rootRef.current);
    return () => {
      undockTopbarRef.current?.();
      undockTopbarRef.current = null;
    };
  }, [syncTopbarDock]);

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
      syncTopbarDock(null);
      if (activeRoot && isInfiniteCanvasEngineMountedOn(activeRoot)) {
        disposeInfiniteCanvasEngine({ preserveEditor: true });
      }
      activeRoot = null;
      return;
    }
    if (activeRoot === node && isInfiniteCanvasEngineMountedOn(node)) return;

    node.dataset.shellActive = shellActive ? '1' : '0';
    syncTopbarDock(node);

    void bootEngineOnRoot(node)
      .then(() => {
        setError(null);
        setInfiniteCanvasShellSuspended(!shellActive);
        if (shellActive) {
          syncCanvasTopbarDom();
          refreshInfiniteCanvasLayout();
        }
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : '画布初始化失败');
      });
  }, [shellActive, syncTopbarDock]);

  if (error) {
    return (
      <div className="infinite-canvas-host flex h-full w-full items-center justify-center bg-[#0e0e0e] text-[#e5e2e1]">
        <p className="max-w-md text-center text-sm text-red-300/90">{error}</p>
      </div>
    );
  }

  return (
    <div className="infinite-canvas-host relative h-full w-full min-h-0 bg-transparent">
      <InfiniteCanvasShell rootRef={assignRootRef} />
      <CanvasLeftDock active={shellActive} />
    </div>
  );
});
