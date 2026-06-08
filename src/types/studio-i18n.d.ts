interface StudioI18nApi {
  register(payload: Record<string, { zh: string; en: string }>): void;
  t(key: string): string;
  lang(): string;
  set(lang: string): void;
  apply(root?: ParentNode | null): void;
}

interface Window {
  StudioI18n?: StudioI18nApi;
  lucide?: { createIcons: () => void };
}
