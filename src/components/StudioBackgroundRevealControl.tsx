import { ImageIcon } from 'lucide-react';
import { cn } from '../lib/utils';
import { useStudioBackgroundStore } from '../store/useStudioBackgroundStore';

type Props = {
  heroTone?: boolean;
  className?: string;
};

export function StudioBackgroundRevealControl({ heroTone = false, className }: Props) {
  const reveal = useStudioBackgroundStore((s) => s.reveal);
  const setRevealPercent = useStudioBackgroundStore((s) => s.setRevealPercent);
  const percent = Math.round(reveal * 100);

  return (
    <div
      className={cn(
        'flex items-center gap-2 shrink-0 rounded-full px-2.5 py-1.5',
        heroTone
          ? 'bg-white/[0.06] outline outline-[0.5px] outline-white/10 backdrop-blur-[24px]'
          : 'ai-editor-panel',
        className,
      )}
      title="向右拖动：减弱遮罩，让背景图更清晰"
    >
      <ImageIcon
        className="w-3.5 h-3.5 shrink-0 opacity-60"
        strokeWidth={1.75}
        aria-hidden
      />
      <span className="text-[10px] font-medium tracking-[0.04em] text-white/72 whitespace-nowrap hidden lg:inline">
        背景显露
      </span>
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={percent}
        onChange={(e) => setRevealPercent(Number(e.target.value))}
        aria-label="背景显露度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="studio-bg-reveal-slider w-[4.5rem] sm:w-20 md:w-24 h-1 cursor-pointer"
      />
      <span className="text-[10px] tabular-nums text-white/50 w-6 text-right">{percent}</span>
    </div>
  );
}
