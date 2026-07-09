import React, { useCallback, useRef, useState } from 'react';
import { motion, useMotionValue, useSpring } from 'motion/react';
import { ArrowUpRight, Workflow } from 'lucide-react';
import { cn } from '../lib/utils';
import type { StudioToolHeroId } from '../shell/studioToolHero';
import { useShellNavigation } from '../shell/ShellNavigation';
import { ToolConvergeOverlay } from './motion/ToolConvergeOverlay';

const spring = { type: 'spring' as const, stiffness: 320, damping: 28 };
const convergeExit = { duration: 0.38, ease: [0.22, 1, 0.36, 1] as const };

type ToolItem = {
  id: StudioToolHeroId;
  index: string;
  title: string;
  description: string;
  tag: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  onClick?: () => void;
  featured?: boolean;
};

/** 鼠标位置驱动的 3D 倾斜卡片（±4°，spring 平滑，触屏/离开自动归零） */
function ToolCard({
  tool,
  index,
  isHovered,
  isDimmed,
  isConverging,
  convergeLocked,
  onEnter,
  onLeave,
  onConvergeClick,
}: {
  tool: ToolItem;
  index: number;
  isHovered: boolean;
  isDimmed: boolean;
  isConverging: boolean;
  convergeLocked: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onConvergeClick: (el: HTMLButtonElement) => void;
}) {
  const Icon = tool.icon;
  const disabled = !tool.onClick;
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const smoothRotateX = useSpring(rotateX, { stiffness: 260, damping: 24 });
  const smoothRotateY = useSpring(rotateY, { stiffness: 260, damping: 24 });

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType !== 'mouse') return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width - 0.5;
    const py = (e.clientY - rect.top) / rect.height - 0.5;
    rotateY.set(px * 8);
    rotateX.set(py * -8);
  };

  const resetTilt = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <motion.button
      type="button"
      disabled={disabled || convergeLocked}
      onClick={(e) => {
        if (disabled || convergeLocked) return;
        onConvergeClick(e.currentTarget);
      }}
      onMouseEnter={onEnter}
      onMouseLeave={() => {
        onLeave();
        resetTilt();
      }}
      onFocus={onEnter}
      onBlur={onLeave}
      onPointerMove={handlePointerMove}
      initial={{ opacity: 0, y: 28 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      whileTap={convergeLocked ? undefined : { scale: 0.97 }}
      transition={
        isConverging
          ? convergeExit
          : { ...spring, delay: index * 0.06 }
      }
      animate={
        isConverging
          ? { scale: 1.12, opacity: 0, y: 0 }
          : {
              scale: isHovered ? 1.07 : isDimmed ? 0.96 : 1,
              y: isHovered ? -14 : 0,
              opacity: convergeLocked && !isConverging ? 0.35 : 1,
            }
      }
      style={{
        zIndex: isConverging ? 40 : isHovered ? 30 : tool.featured ? 10 : 1,
        rotateX: isConverging ? 0 : smoothRotateX,
        rotateY: isConverging ? 0 : smoothRotateY,
        transformPerspective: 900,
      }}
      data-tool-id={tool.id}
      className={cn(
        'group relative shrink-0 text-left rounded-[1.5rem] p-5 md:p-6 cursor-pointer disabled:opacity-40 disabled:pointer-events-none overflow-hidden',
        'w-[min(100%,420px)] sm:w-[min(100%,460px)] lg:w-full lg:max-w-[520px] lg:min-w-0',
        'min-h-[280px] md:min-h-[300px] lg:min-h-[320px]',
        'cover-tool-card-bento',
        tool.featured && 'cover-tool-card-bento-featured',
        isConverging && 'pointer-events-none',
      )}
    >
      <div className="absolute inset-0 cover-tool-card-shine pointer-events-none" />

      <div className="relative flex h-full flex-col justify-between gap-6">
        <div className="space-y-5">
          <div className="flex items-start justify-between gap-3">
            <span className="cover-tools-index">{tool.index}</span>
            <div className="cover-tool-icon-well flex h-10 w-10 items-center justify-center rounded-xl cover-tool-icon-color">
              <Icon className="w-[18px] h-[18px]" strokeWidth={1.65} />
            </div>
          </div>
          <div className="space-y-2">
            <span className="cover-tools-tag">{tool.tag}</span>
            <h3 className="cover-tools-card-title">{tool.title}</h3>
          </div>
        </div>

        <div className="space-y-3">
          <p className="cover-tools-card-body">{tool.description}</p>
          <span className="cover-tools-enter inline-flex items-center gap-1.5 text-[12px] font-medium tracking-[0.02em]">
            进入
            <ArrowUpRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform" />
          </span>
        </div>
      </div>
    </motion.button>
  );
}

interface HomeToolsProps {
  onStart?: () => void;
  onOpenImageEditor?: () => void;
  onOpenNineGrid?: () => void;
  onOpenDirectorWorkbench?: () => void;
  onOpenInfiniteCanvas?: () => void;
}

export const HomeTools: React.FC<HomeToolsProps> = ({
  onOpenInfiniteCanvas,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [convergingId, setConvergingId] = useState<string | null>(null);
  const [convergeRect, setConvergeRect] = useState<DOMRect | null>(null);
  const convergeTimerRef = useRef<number | null>(null);
  const { warmInfiniteCanvas } = useShellNavigation();

  const clearConvergeTimer = useCallback(() => {
    if (convergeTimerRef.current != null) {
      window.clearTimeout(convergeTimerRef.current);
      convergeTimerRef.current = null;
    }
  }, []);

  const prefetchCanvasAssets = useCallback(() => {
    warmInfiniteCanvas();
    void import('./InfiniteCanvas/InfiniteCanvas').then((mod) => {
      mod.prefetchInfiniteCanvasAssets?.();
    });
  }, [warmInfiniteCanvas]);

  const beginToolConverge = useCallback(
    (tool: ToolItem, el: HTMLButtonElement) => {
      if (!tool.onClick || convergingId) return;

      const reduceMotion =
        typeof window !== 'undefined' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      if (reduceMotion) {
        tool.onClick();
        return;
      }

      clearConvergeTimer();
      setHoveredId(null);
      setConvergingId(tool.id);
      setConvergeRect(el.getBoundingClientRect());

      convergeTimerRef.current = window.setTimeout(() => {
        tool.onClick?.();
        setConvergingId(null);
        setConvergeRect(null);
        convergeTimerRef.current = null;
      }, 380);
    },
    [clearConvergeTimer, convergingId],
  );

  React.useEffect(() => () => clearConvergeTimer(), [clearConvergeTimer]);

  // 产品收缩：主页只露出无限画布；分镜/九宫格/修图/导演台路由暂留、入口隐藏
  const tools: ToolItem[] = [
    {
      id: 'canvas',
      index: '01',
      title: '无限画布',
      description: '节点串联提示词与 API 生图，编排复杂流程——Studio 的主工作台。',
      tag: 'Canvas',
      icon: Workflow,
      onClick: onOpenInfiniteCanvas,
      featured: true,
    },
  ];

  return (
    <section
      id="tools"
      className="cover-tools-section relative scroll-mt-0 min-h-[100dvh] pb-24 md:pb-32 px-4 md:px-8 lg:px-12 flex flex-col justify-center"
    >
      <ToolConvergeOverlay rect={convergeRect} />
      <div className="cover-tools-glow pointer-events-none absolute inset-0" aria-hidden />
      <div className="cover-noise pointer-events-none absolute inset-0 z-0" aria-hidden />

      <div className="relative z-10 max-w-[1400px] mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={spring}
          className="text-center mb-10 md:mb-14 px-2"
        >
          <span className="cover-tools-eyebrow">Studio Suite</span>
        </motion.div>

        <div className="cover-tool-strip cover-tool-bento mx-auto flex items-end justify-center gap-3 md:gap-4 lg:gap-5 overflow-x-auto lg:overflow-visible pb-12 pt-2 px-2 custom-scrollbar">
          {tools.map((tool, index) => (
            <ToolCard
              key={tool.id}
              tool={tool}
              index={index}
              isHovered={hoveredId === tool.id}
              isDimmed={hoveredId !== null && hoveredId !== tool.id}
              isConverging={convergingId === tool.id}
              convergeLocked={convergingId !== null}
              onEnter={() => {
                if (convergingId) return;
                setHoveredId(tool.id);
                if (tool.id === 'canvas') prefetchCanvasAssets();
              }}
              onLeave={() => setHoveredId(null)}
              onConvergeClick={(el) => beginToolConverge(tool, el)}
            />
          ))}
        </div>
      </div>
    </section>
  );
};
