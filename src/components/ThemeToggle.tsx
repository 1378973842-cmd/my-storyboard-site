import React from 'react';
import { motion } from 'framer-motion';
import { Moon, Sun } from 'lucide-react';
import { useStore } from '../store/useStore';
import { cn } from '../lib/utils';

const spring = { type: 'spring' as const, stiffness: 300, damping: 30 };

type Props = {
  className?: string;
};

export const ThemeToggle: React.FC<Props> = ({ className }) => {
  const uiTheme = useStore((s) => s.uiTheme);
  const setUiTheme = useStore((s) => s.setUiTheme);
  const isDark = uiTheme === 'dark';

  return (
    <motion.button
      type="button"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.94 }}
      transition={spring}
      onClick={() => setUiTheme(isDark ? 'light' : 'dark')}
      className={cn(
        'rounded-full p-2 md:p-2.5 shrink-0',
        'bg-surface-container-high/55 backdrop-blur-md text-on-surface/80 hover:text-primary',
        'outline outline-[0.5px] outline-outline-variant/20',
        'shadow-[0_24px_48px_-28px_rgba(0,0,0,0.45)]',
        'transition-colors cursor-pointer',
        className
      )}
      title={isDark ? '切换为日间模式' : '切换为夜间模式'}
      aria-label={isDark ? '切换为日间模式' : '切换为夜间模式'}
      aria-pressed={!isDark}
    >
      {isDark ? <Sun className="w-4 h-4" strokeWidth={1.75} /> : <Moon className="w-4 h-4" strokeWidth={1.75} />}
    </motion.button>
  );
};
