/**
 * 新视角·深度立板：相对深度图 → 网格 Z 位移。
 * 0=近（朝相机 +Z），1=远。光圈/焦段不绑这张图。
 */

export const NOVEL_VIEW_DEPTH_STRENGTH_DEFAULT = 0.34;
export const NOVEL_VIEW_DEPTH_STRENGTH_MIN = 0;
export const NOVEL_VIEW_DEPTH_STRENGTH_MAX = 0.7;
export const NOVEL_VIEW_DEPTH_MESH_SEG = 160;
export const NOVEL_VIEW_DEPTH_INFER_MAX = 384;

export function clampDepthStrength(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return NOVEL_VIEW_DEPTH_STRENGTH_DEFAULT;
  return Math.min(NOVEL_VIEW_DEPTH_STRENGTH_MAX, Math.max(NOVEL_VIEW_DEPTH_STRENGTH_MIN, v));
}

/** 线性归一化到 0–1。 */
export function normalizeDepth01(values) {
  const data = values instanceof Float32Array ? values : Float32Array.from(values || []);
  if (!data.length) return data;
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max - min < 1e-6) {
    return new Float32Array(data.length);
  }
  const out = new Float32Array(data.length);
  const span = max - min;
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    out[i] = Number.isFinite(v) ? (v - min) / span : 0;
  }
  return out;
}

export function invertDepth01(data) {
  const out = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) out[i] = 1 - data[i];
  return out;
}

/**
 * 人物分镜：画面中心通常更近。若中心比边框更远，翻一次。
 */
export function orientDepthNearCenter(data, width, height) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  if (data.length < w * h) return data;
  const meanRect = (x0, y0, x1, y1) => {
    let s = 0;
    let n = 0;
    const xa = Math.max(0, Math.min(w - 1, x0 | 0));
    const xb = Math.max(0, Math.min(w - 1, x1 | 0));
    const ya = Math.max(0, Math.min(h - 1, y0 | 0));
    const yb = Math.max(0, Math.min(h - 1, y1 | 0));
    for (let y = ya; y <= yb; y++) {
      const row = y * w;
      for (let x = xa; x <= xb; x++) {
        s += data[row + x];
        n += 1;
      }
    }
    return n ? s / n : 0.5;
  };
  const cx0 = Math.floor(w * 0.35);
  const cx1 = Math.floor(w * 0.65);
  const cy0 = Math.floor(h * 0.35);
  const cy1 = Math.floor(h * 0.65);
  const band = Math.max(2, Math.floor(Math.min(w, h) * 0.08));
  const center = meanRect(cx0, cy0, cx1, cy1);
  const border = (
    meanRect(0, 0, w - 1, band) +
    meanRect(0, h - 1 - band, w - 1, h - 1) +
    meanRect(0, 0, band, h - 1) +
    meanRect(w - 1 - band, 0, w - 1, h - 1)
  ) / 4;
  // depth01 大=远。中心应更近 → center < border。若相反则翻转。
  if (center - border > 0.04) return invertDepth01(data);
  return data;
}

export function sampleDepthBilinear(data, width, height, u, v) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  if (!data?.length || data.length < w * h) return 0.5;
  const x = Math.min(w - 1, Math.max(0, u * (w - 1)));
  const y = Math.min(h - 1, Math.max(0, v * (h - 1)));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const a = data[y0 * w + x0];
  const b = data[y0 * w + x1];
  const c = data[y1 * w + x0];
  const d = data[y1 * w + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

/** 平面朝 +Z、相机在 +Z：近→+z，远→−z。 */
export function depth01ToOffsetZ(depth01, strength) {
  const d = Number(depth01);
  const s = clampDepthStrength(strength);
  if (!Number.isFinite(d)) return 0;
  return (0.5 - d) * s;
}

/**
 * 把深度写进 PlaneGeometry 顶点 Z。
 * Three 的 uv.v=0 在底边，深度图 row0 在图像顶，所以采样 v 要翻转。
 */
export function applyDepthToPositions(positions, uvs, planeW, planeH, depth) {
  if (!positions || !uvs || !depth?.data) return 0;
  const n = positions.length / 3;
  let pivot = 0;
  let pivotN = 0;
  for (let i = 0; i < n; i++) {
    const u = uvs[i * 2];
    const v = uvs[i * 2 + 1];
    const d = sampleDepthBilinear(depth.data, depth.width, depth.height, u, 1 - v);
    const z = depth01ToOffsetZ(d, depth.strength);
    positions[i * 3 + 2] = z;
    if (Math.abs(u - 0.5) < 0.04 && Math.abs(v - 0.5) < 0.04) {
      pivot += z;
      pivotN += 1;
    }
  }
  return pivotN ? pivot / pivotN : 0;
}

export function drawImageToDepthCanvas(img, maxEdge = NOVEL_VIEW_DEPTH_INFER_MAX) {
  const nw = Math.max(1, img.naturalWidth || img.width || 1);
  const nh = Math.max(1, img.naturalHeight || img.height || 1);
  const scale = Math.min(1, maxEdge / Math.max(nw, nh));
  const w = Math.max(16, Math.round(nw * scale));
  const h = Math.max(16, Math.round(nh * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('depth canvas');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas;
}
