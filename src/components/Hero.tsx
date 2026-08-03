import React from 'react';
import { CoverHomeWorkspace } from './CoverHomeWorkspace';

/** @deprecated 主页已改为与工作空间同色纯底，保留导出以免旧引用报错 */
export const COVER_HERO_VIDEO = '';
export const COVER_HERO_VIDEO_WEBM = '';
export const COVER_HERO_POSTER = '/cover-hero-option-1.jpg';
export const COVER_HERO_BG = '/cover-hero-option-1.jpg';

/** 封面单屏：与工作空间闸门同色底 (#0e0e0e) + TapNow 式工作台 */
export const Hero: React.FC = () => {
  return (
    <section className="cover-hero relative min-h-[100dvh] w-full overflow-hidden">
      <div className="cover-hero-bg absolute inset-0 z-0" aria-hidden />
      <CoverHomeWorkspace />
    </section>
  );
};
