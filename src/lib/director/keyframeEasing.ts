/** 关键帧段缓动（借鉴 dollycurve / Penner，不整库接入） */

export type KeyframeEase =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'easeInCubic'
  | 'easeOutCubic'
  | 'easeInOutCubic'
  | 'bezier';

export const KEYFRAME_EASE_OPTIONS: { id: KeyframeEase; label: string }[] = [
  { id: 'linear', label: '线性' },
  { id: 'easeIn', label: '缓入' },
  { id: 'easeOut', label: '缓出' },
  { id: 'easeInOut', label: '缓入缓出' },
  { id: 'easeInCubic', label: '立方缓入' },
  { id: 'easeOutCubic', label: '立方缓出' },
  { id: 'easeInOutCubic', label: '立方缓入缓出' },
  { id: 'bezier', label: '自定义贝塞尔' },
];

/** CSS 默认 ease 近似：cubic-bezier(0.25, 0.1, 0.25, 1) */
export const DEFAULT_BEZIER: [number, number, number, number] = [0.25, 0.1, 0.25, 1];

function clamp01(t: number) {
  return Math.min(1, Math.max(0, t));
}

/** 单位立方贝塞尔：P0=(0,0) P3=(1,1)，控制点 (x1,y1)(x2,y2) */
export function cubicBezierEase(t: number, x1: number, y1: number, x2: number, y2: number): number {
  const t0 = clamp01(t);
  // 牛顿法求 u，使 Bx(u)=t
  let u = t0;
  for (let i = 0; i < 8; i++) {
    const bx =
      3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
    const dx =
      3 * (1 - u) * (1 - u) * x1 +
      6 * (1 - u) * u * (x2 - x1) +
      3 * u * u * (1 - x2);
    if (Math.abs(dx) < 1e-6) break;
    u -= (bx - t0) / dx;
    u = clamp01(u);
  }
  return (
    3 * (1 - u) * (1 - u) * u * y1 + 3 * (1 - u) * u * u * y2 + u * u * u
  );
}

export function applyKeyframeEase(
  t: number,
  ease: KeyframeEase = 'linear',
  bezier: [number, number, number, number] = DEFAULT_BEZIER,
): number {
  const x = clamp01(t);
  switch (ease) {
    case 'easeIn':
      return x * x;
    case 'easeOut':
      return 1 - (1 - x) * (1 - x);
    case 'easeInOut':
      return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    case 'easeInCubic':
      return x * x * x;
    case 'easeOutCubic':
      return 1 - Math.pow(1 - x, 3);
    case 'easeInOutCubic':
      return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    case 'bezier':
      return cubicBezierEase(x, bezier[0], bezier[1], bezier[2], bezier[3]);
    case 'linear':
    default:
      return x;
  }
}
