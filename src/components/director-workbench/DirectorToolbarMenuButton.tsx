import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/utils';

type Props = {
  open: boolean;
  onClick: () => void;
  children: ReactNode;
};

/** 顶栏下拉触发按钮：打开态用半透明高亮，不用白底 active（避免文字消失/整块发白） */
export function DirectorToolbarMenuButton({ open, onClick, children }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={cn(
        'director-toolbar-menu-btn flex items-center gap-1.5 ai-editor-mode-btn',
        open && 'director-toolbar-menu-btn--open',
      )}
    >
      {children}
    </button>
  );
}

export function DirectorToolbarMenuChevron({ open }: { open: boolean }) {
  return (
    <ChevronDown
      className={cn(
        'w-3 h-3 shrink-0 opacity-50 transition-transform origin-center',
        open && 'rotate-180',
      )}
    />
  );
}
