import type { ShellScreen } from './ShellNavigation';
import type { StudioNavId } from '../components/StudioTopNav';

/** 将 shell 路由映射为顶栏 active 态（全局唯一顶栏用） */
export function resolveStudioNavActive(screen: ShellScreen): StudioNavId {
  switch (screen) {
    case 'cover':
      return 'cover';
    case 'studio':
      return 'storyboard';
    case 'image-editor':
      return 'editor';
    case 'nine-grid':
      return 'grid';
    case 'director':
      return 'director';
    case 'infinite-canvas':
      return 'canvas';
    default:
      return 'cover';
  }
}

