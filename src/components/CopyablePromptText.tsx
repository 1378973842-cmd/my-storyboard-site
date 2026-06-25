import React, { useCallback, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../lib/utils';

type CopyablePromptTextProps = {
  text: string;
  emptyLabel?: string;
  className?: string;
  lineClamp?: 4 | 5 | 'none';
};

export function CopyablePromptText({
  text,
  emptyLabel = '（无 Prompt）',
  className,
  lineClamp = 4,
}: CopyablePromptTextProps) {
  const [copied, setCopied] = useState(false);
  const trimmed = text?.trim() || '';
  const canCopy = Boolean(trimmed);

  const handleCopy = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!canCopy) return;
      try {
        await navigator.clipboard.writeText(trimmed);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      } catch {
        /* ignore */
      }
    },
    [trimmed, canCopy],
  );

  return (
    <div className={cn('space-y-2', className)}>
      <p
        className={cn(
          'select-text whitespace-pre-wrap break-words text-sm leading-relaxed text-[#e5e2e1]/82',
          lineClamp === 4 && 'line-clamp-4',
          lineClamp === 5 && 'line-clamp-5',
        )}
      >
        {trimmed || emptyLabel}
      </p>
      {canCopy ? (
        <button
          type="button"
          onClick={(e) => void handleCopy(e)}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#1c1b1b]/85 px-3 py-1.5 text-[11px] tracking-[0.06em] text-[#e5e2e1]/55 transition-colors hover:text-[#ffb866]"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-[#ffb866]" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied ? '已复制' : '复制提示词'}
        </button>
      ) : null}
    </div>
  );
}
