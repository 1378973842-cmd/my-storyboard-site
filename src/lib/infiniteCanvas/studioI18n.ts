type Locale = 'zh' | 'en';
type Entry = { zh: string; en: string };

const dict: Record<string, Entry> = {};

function currentLang(): Locale {
  try {
    const stored = localStorage.getItem('studio_lang') || localStorage.getItem('canvas_lang');
    if (stored === 'en') return 'en';
  } catch {
    /* ignore */
  }
  return 'zh';
}

function applyI18n(root?: ParentNode | null) {
  const scope = root ?? document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key);
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key && el instanceof HTMLInputElement) el.placeholder = t(key);
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const key = el.getAttribute('data-i18n-title');
    if (key) {
      el.setAttribute('title', t(key));
      el.setAttribute('aria-label', t(key));
    }
  });
}

export function t(key: string): string {
  const entry = dict[key];
  if (!entry) return key;
  return entry[currentLang()] ?? entry.zh ?? key;
}

export function installStudioI18n(extra?: Record<string, Entry>) {
  if (extra) Object.assign(dict, extra);
  const api = {
    register(payload: Record<string, Entry>) {
      Object.assign(dict, payload);
    },
    t,
    lang: currentLang,
    set(lang: Locale) {
      try {
        localStorage.setItem('studio_lang', lang);
      } catch {
        /* ignore */
      }
      applyI18n();
    },
    apply: applyI18n,
  };
  (window as unknown as { StudioI18n: typeof api }).StudioI18n = api;
  return api;
}

/** Load canvas i18n dictionary from public bundle (same keys as canvas_source). */
export async function loadCanvasI18n(): Promise<void> {
  const res = await fetch('/canvas/i18n-canvas.js');
  if (!res.ok) return;
  const text = await res.text();
  const match = text.match(/StudioI18n\.register\(\{([\s\S]*)\}\)/);
  if (!match) return;
  try {
    const fn = new Function(`return ({${match[1]}})`);
    const payload = fn() as Record<string, Entry>;
    installStudioI18n(payload);
  } catch {
    installStudioI18n();
  }
}
