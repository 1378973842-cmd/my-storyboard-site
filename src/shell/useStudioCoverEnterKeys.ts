import { useState } from 'react';
import type { ShellScreen } from './ShellNavigation';

export type StudioFeatureEnterKeys = {
  studio: number;
  'image-editor': number;
  'nine-grid': number;
  director: number;
  'infinite-canvas': number;
};

export type StudioTransitionKeys = StudioFeatureEnterKeys & {
  /** 从功能页回到封面时递增 */
  cover: number;
};

const INITIAL_FEATURE_KEYS: StudioFeatureEnterKeys = {
  studio: 0,
  'image-editor': 0,
  'nine-grid': 0,
  director: 0,
  'infinite-canvas': 0,
};

/** 进入功能页 / 回到封面时递增 key，驱动汇聚进/退场动画 */
export function useStudioCoverEnterKeys(screen: ShellScreen): StudioTransitionKeys {
  const [featureKeys, setFeatureKeys] = useState<StudioFeatureEnterKeys>(INITIAL_FEATURE_KEYS);
  const [coverEnterKey, setCoverEnterKey] = useState(0);
  const [prevScreen, setPrevScreen] = useState(screen);

  // 同步递增：首帧就带上新 enterKey，避免晚一帧导致汇聚被跳过
  if (screen !== prevScreen) {
    setPrevScreen(screen);

    if (screen === 'cover') {
      setCoverEnterKey((k) => k + 1);
    } else {
      // 封面 → 功能页，或 功能页 ↔ 功能页（顶栏切换）
      setFeatureKeys((k) => ({
        ...k,
        [screen]: k[screen] + 1,
      }));
    }
  }

  return { ...featureKeys, cover: coverEnterKey };
}
