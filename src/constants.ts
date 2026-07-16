import { StyleBase, ImageSize, AspectRatio } from './types';

export const STYLES: StyleBase[] = ['Cinematic', 'Pixar', 'Cyberpunk', 'Realistic', 'Anime'];
export const SIZES: ImageSize[] = ['1K', '2K', '4K'];
export const RATIOS: AspectRatio[] = ['4:3', '3:4', '16:9', '9:16', '2:3', '3:2', '1:1', '4:5', '5:4', '21:9'];

/** 分镜页 LLM：与九宫格 Phase A 共用 NINE_GRID_TEXT_* 渠道 */
export const STORYBOARD_TEXT_MODEL = 'gemini-3.5-flash';

/** RunningHub G-2 / gpt-image-2 aspectRatio 枚举（与官方文档顺序一致） */
export const RUNNINGHUB_G2_RATIOS = [
  '1:1',
  '2:3',
  '3:2',
  '4:5',
  '5:4',
  '4:3',
  '3:4',
  '16:9',
  '9:16',
  '21:9',
  '9:21',
  '2:1',
  '1:2',
  '3:1',
  '1:3',
] as const;
