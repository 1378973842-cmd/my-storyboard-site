import React, { useCallback, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Camera, Clapperboard, Grid3x3, ImageIcon, Workflow } from 'lucide-react';
import { cn } from '../lib/utils';
import type { StudioToolHeroId } from '../shell/studioToolHero';
import { useShellNavigation } from '../shell/ShellNavigation';

const spring = { type: 'spring' as const, stiffness: 320, damping: 28 };

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

interface HomeToolsProps {
  onStart?: () => void;
  onOpenImageEditor?: () => void;
  onOpenNineGrid?: () => void;
  onOpenDirectorWorkbench?: () => void;
  onOpenInfiniteCanvas?: () => void;
}

export const HomeTools: React.FC<HomeToolsProps> = ({
  onStart,
  onOpenImageEditor,
  onOpenNineGrid,
  onOpenDirectorWorkbench,
  onOpenInfiniteCanvas,
}) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const { warmInfiniteCanvas } = useShellNavigation();

  const prefetchCanvasAssets = useCallback(() => {
    warmInfiniteCanvas();
    void import('./InfiniteCanvas/InfiniteCanvas').then((mod) => {
      mod.prefetchInfiniteCanvasAssets?.();
    });
  }, [warmInfiniteCanvas]);

  const tools: ToolItem[] = [
    {
      id: 'canvas',
      index: '01',
      title: '无限画布',
      description: '节点串联提示词与 API 生图，编排复杂流程。',
      tag: 'Canvas',
      icon: Workflow,
      onClick: onOpenInfiniteCanvas,
    },
    {
      id: 'grid',
      index: '02',
      title: '九宫格',
      description: '九帧连贯分镜，快速建立镜头序列整体感。',
      tag: 'Nine Grid',
      icon: Grid3x3,
      onClick: onOpenNineGrid,
    },
    {
      id: 'studio',
      index: '03',
      title: '分镜工作台',
      description: '剧本拆解、批量生图——故事可视化的核心入口。',
      tag: 'Storyboard',
      icon: Clapperboard,
      onClick: onStart,
      featured: true,
    },
    {
      id: 'editor',
      index: '04',
      title: '图片编辑',
      description: '独立精修与局部重绘，随时打磨画面细节。',
      tag: 'Edit',
      icon: ImageIcon,
      onClick: onOpenImageEditor,
    },
    {
      id: 'director',
      index: '05',
      title: '导演台',
      description: '三维场景摆位与机位预演，辅助镜头设计。',
      tag: 'Director',
      icon: Camera,
      onClick: onOpenDirectorWorkbench,
    },
  ];

  return (
    <section
      id="tools"
      className="cover-tools-section relative scroll-mt-0 min-h-[100dvh] pb-24 md:pb-32 px-4 md:px-8 lg:px-12 flex flex-col justify-center"
    >
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

        <div className="cover-tool-strip mx-auto flex items-end justify-center gap-3 md:gap-4 lg:gap-5 overflow-x-auto pb-12 pt-2 px-2 custom-scrollbar">
          {tools.map((tool, index) => {
            const Icon = tool.icon;
            const disabled = !tool.onClick;
            const isHovered = hoveredId === tool.id;
            const isDimmed = hoveredId !== null && !isHovered;

            return (
              <motion.button
                key={tool.id}
                type="button"
                disabled={disabled}
                onClick={tool.onClick}
                onMouseEnter={() => {
                  setHoveredId(tool.id);
                  if (tool.id === 'canvas') prefetchCanvasAssets();
                }}
                onMouseLeave={() => setHoveredId(null)}
                onFocus={() => {
                  setHoveredId(tool.id);
                  if (tool.id === 'canvas') prefetchCanvasAssets();
                }}
                onBlur={() => setHoveredId(null)}
                initial={{ opacity: 0, y: 28 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                whileTap={{ scale: 0.97 }}
                transition={{ ...spring, delay: index * 0.06 }}
                animate={{
                  scale: isHovered ? 1.07 : isDimmed ? 0.96 : 1,
                  y: isHovered ? -14 : 0,
                }}
                style={{ zIndex: isHovered ? 30 : tool.featured ? 10 : 1 }}
                className={cn(
                  'group relative shrink-0 text-left rounded-[1.5rem] p-5 md:p-6 cursor-pointer disabled:opacity-40 disabled:pointer-events-none overflow-hidden',
                  'w-[172px] sm:w-[196px] md:w-[216px] lg:w-[min(248px,18vw)]',
                  tool.featured ? 'min-h-[360px] md:min-h-[400px]' : 'min-h-[300px] md:min-h-[320px]',
                  'cover-tool-card-bento',
                  tool.featured && 'cover-tool-card-bento-featured',
                )}
              >
                <div className="absolute inset-0 cover-tool-card-shine pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

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
          })}
        </div>
      </div>
    </section>
  );
};
