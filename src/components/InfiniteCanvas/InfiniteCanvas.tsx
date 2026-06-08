import { memo, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { InfiniteCanvasShell } from './InfiniteCanvasShell';
import { installStudioI18n } from '../../lib/infiniteCanvas/studioI18n';
import {
  disposeInfiniteCanvasEngine,
  isInfiniteCanvasEngineMountedOn,
  mountInfiniteCanvasEngine,
  setInfiniteCanvasShellSuspended,
} from '../../lib/infiniteCanvas/canvasEngine.js';
import './infinite-canvas.css';

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

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (root) {
      root.dataset.shellActive = shellActive ? '1' : '0';
    }
    setInfiniteCanvasShellSuspended(!shellActive);
    return () => setInfiniteCanvasShellSuspended(true);
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
    if (activeRoot === node && isInfiniteCanvasEngineMountedOn(node)) return;

    node.dataset.shellActive = shellActive ? '1' : '0';

    void bootEngineOnRoot(node)
      .then(() => setError(null))
      .catch((err) => {
        setError(err instanceof Error ? err.message : '画布初始化失败');
      });
  }, [shellActive]);

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
    </div>
  );
});
