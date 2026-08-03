/** 主壳页面：隐藏原生滚动条，右侧短胶囊指示器随滚动短暂显示 */

const IDLE_MS = 1100;
const SELECTOR = '[data-cover-scroll-root], .shell-slim-scrollbar, .infinite-canvas-root .canvas-gate';
const INDICATOR_ID = 'shell-slim-scroll-indicator';

const hideTimers = new WeakMap<Element, number>();
let activeScroller: Element | null = null;

function resolveScroller(target: EventTarget | null): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(SELECTOR);
}

function ensureIndicator(): { root: HTMLDivElement; thumb: HTMLDivElement } {
  let root = document.getElementById(INDICATOR_ID) as HTMLDivElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = INDICATOR_ID;
    root.setAttribute('aria-hidden', 'true');
    const thumb = document.createElement('div');
    thumb.className = 'shell-slim-scroll-thumb';
    root.appendChild(thumb);
    document.body.appendChild(root);
  }
  const thumb = root.querySelector('.shell-slim-scroll-thumb') as HTMLDivElement;
  return { root, thumb };
}

function railMetrics(scroller: Element) {
  const rect = scroller.getBoundingClientRect();
  // 整条指示轨约容器高度的 1/9（视觉上约为原先接近全高条的 1/3×1/3）
  const railH = Math.max(56, Math.round(rect.height / 9));
  const top = rect.top + (rect.height - railH) / 2;
  const right = Math.max(4, window.innerWidth - rect.right + 5);
  return { rect, railH, top, right };
}

function syncIndicator(scroller: Element) {
  const el = scroller as HTMLElement;
  const scrollable = el.scrollHeight - el.clientHeight;
  const { root, thumb } = ensureIndicator();

  if (scrollable <= 1) {
    root.classList.remove('is-visible');
    return;
  }

  const { railH, top, right } = railMetrics(scroller);
  const ratio = el.clientHeight / el.scrollHeight;
  const thumbH = Math.max(22, Math.min(railH, Math.round(railH * ratio)));
  const maxTop = Math.max(0, railH - thumbH);
  const progress = el.scrollTop / scrollable;

  root.style.top = `${top}px`;
  root.style.right = `${right}px`;
  root.style.height = `${railH}px`;
  thumb.style.height = `${thumbH}px`;
  thumb.style.transform = `translateY(${progress * maxTop}px)`;
  root.classList.add('is-visible');
}

function flash(scroller: Element) {
  activeScroller = scroller;
  syncIndicator(scroller);
  const prev = hideTimers.get(scroller);
  if (prev) window.clearTimeout(prev);
  hideTimers.set(
    scroller,
    window.setTimeout(() => {
      if (activeScroller === scroller) {
        ensureIndicator().root.classList.remove('is-visible');
      }
    }, IDLE_MS),
  );
}

/** 挂一次全局监听；返回卸载函数 */
export function installShellAutohideScrollbar(): () => void {
  const onScroll = (e: Event) => {
    const scroller = resolveScroller(e.target);
    if (scroller) flash(scroller);
  };
  const onMove = (e: MouseEvent) => {
    const scroller = resolveScroller(e.target);
    if (!scroller) return;
    const rect = scroller.getBoundingClientRect();
    // 靠近右缘时也露出指示条，方便发现
    if (e.clientX >= rect.right - 28) flash(scroller);
  };
  const onResize = () => {
    if (activeScroller && document.contains(activeScroller)) {
      syncIndicator(activeScroller);
    }
  };

  document.addEventListener('scroll', onScroll, true);
  document.addEventListener('mousemove', onMove, true);
  window.addEventListener('resize', onResize);

  return () => {
    document.removeEventListener('scroll', onScroll, true);
    document.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('resize', onResize);
    document.getElementById(INDICATOR_ID)?.remove();
  };
}
