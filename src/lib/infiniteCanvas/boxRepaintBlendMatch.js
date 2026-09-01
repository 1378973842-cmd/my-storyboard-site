/**
 * 框选重绘贴回 + 融合校色（复刻 PixelRunner blend-match 生产路径参数）。
 * 来源：PixelRunner/src/host/photoshop/blend-match.js
 * - buildInternalColorProfile / applyInternalColorCorrectionsToRgba
 * - buildSubjectAwareColorWeights
 * - 简化版 Sobel 平移对齐（省略 affine/local mesh）
 * - 向内收缩 + 羽化蒙版（矩形选区）
 */

/** @typedef {{ mode?: string, totalStrength?: number, luminanceStrength?: number, colorStrength?: number, saturationStrength?: number, contrastStrength?: number, featherRadius?: number, alignmentEnabled?: boolean, alignmentMaxOffset?: number }} BoxRepaintBlendConfig */

export const DEFAULT_BOX_REPAINT_BLEND_CONFIG = {
  mode: 'balanced',
  totalStrength: 78,
  luminanceStrength: 82,
  colorStrength: 76,
  saturationStrength: 62,
  contrastStrength: 58,
  featherRadius: 20,
  /**
   * 几何对齐默认关：平移/缩放会在选区内造成「缝」和观感上的像素位移。
   * 框选重绘流水线是 crop→同框贴回，优先铺满+校色；需要对齐时再显式打开。
   */
  alignmentEnabled: false,
  alignmentMaxOffset: 120,
  /** 框选裁切返图默认 stretch 铺满选区，避免 contain 留白在框内形成硬缝 */
  fitMode: 'stretch',
  /** 与 PixelRunner deriveDetailedSettings(flex=63)：maxScale/Stretch≈2.52、rotation≈1.75 */
  alignmentMaxScale: 2.52,
  alignmentMaxRotation: 1.75,
  alignmentMaxStretch: 2.52,
  alignmentScaleEnabled: true,
  alignmentRotationEnabled: true,
  localAlignmentEnabled: false, // 全量 local mesh 未移植；默认关，避免半吊子
  analysisMaxEdge: 512,
};

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(Number(value) || 0)));
}

export function resolveBoxRepaintBlendConfig(payload = {}) {
  const mode = String(payload.mode || DEFAULT_BOX_REPAINT_BLEND_CONFIG.mode).trim() || 'balanced';
  const modeBoost = mode === 'strong' ? 1.16 : mode === 'natural' ? 0.82 : 1;
  const edgeOnly = mode === 'edgeOnly';
  const colorOnly = mode === 'colorOnly';
  return {
    mode,
    totalStrength: clampNumber(payload.totalStrength, 0, 100, DEFAULT_BOX_REPAINT_BLEND_CONFIG.totalStrength),
    luminanceStrength: edgeOnly || colorOnly
      ? 0
      : clampNumber(payload.luminanceStrength, 0, 100, DEFAULT_BOX_REPAINT_BLEND_CONFIG.luminanceStrength) * modeBoost,
    colorStrength: edgeOnly
      ? 0
      : clampNumber(payload.colorStrength, 0, 100, DEFAULT_BOX_REPAINT_BLEND_CONFIG.colorStrength) * modeBoost,
    saturationStrength: edgeOnly
      ? 0
      : clampNumber(payload.saturationStrength, -100, 100, DEFAULT_BOX_REPAINT_BLEND_CONFIG.saturationStrength) * modeBoost,
    contrastStrength: edgeOnly || colorOnly
      ? 0
      : clampNumber(payload.contrastStrength, 0, 100, DEFAULT_BOX_REPAINT_BLEND_CONFIG.contrastStrength) * modeBoost,
    featherRadius: clampNumber(payload.featherRadius, 0, 64, DEFAULT_BOX_REPAINT_BLEND_CONFIG.featherRadius),
    alignmentEnabled: payload.alignmentEnabled === true,
    alignmentMaxOffset: clampNumber(payload.alignmentMaxOffset, 1, 320, DEFAULT_BOX_REPAINT_BLEND_CONFIG.alignmentMaxOffset),
    fitMode: ['contain', 'cover', 'stretch'].includes(String(payload.fitMode || '').toLowerCase())
      ? String(payload.fitMode).toLowerCase()
      : DEFAULT_BOX_REPAINT_BLEND_CONFIG.fitMode,
    alignmentMaxScale: clampNumber(payload.alignmentMaxScale, 0, 4, DEFAULT_BOX_REPAINT_BLEND_CONFIG.alignmentMaxScale),
    alignmentMaxRotation: clampNumber(payload.alignmentMaxRotation, 0, 3, DEFAULT_BOX_REPAINT_BLEND_CONFIG.alignmentMaxRotation),
    alignmentMaxStretch: clampNumber(payload.alignmentMaxStretch, 0, 4, DEFAULT_BOX_REPAINT_BLEND_CONFIG.alignmentMaxStretch),
    alignmentScaleEnabled: payload.alignmentScaleEnabled !== false,
    alignmentRotationEnabled: payload.alignmentRotationEnabled !== false,
    localAlignmentEnabled: payload.localAlignmentEnabled === true,
    analysisMaxEdge: clampNumber(payload.analysisMaxEdge, 256, 1536, DEFAULT_BOX_REPAINT_BLEND_CONFIG.analysisMaxEdge),
  };
}

function smoothstep(edge0, edge1, value) {
  const t = Math.max(0, Math.min(1, (Number(value) - edge0) / Math.max(0.0001, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function yuvToRgb(y, u, v) {
  const r = y + v;
  const b = y + u;
  const g = (y - 0.299 * r - 0.114 * b) / 0.587;
  return [r, g, b];
}

function applySaturationToRgb(r, g, b, factor) {
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [y + (r - y) * factor, y + (g - y) * factor, y + (b - y) * factor];
}

function buildLuma(data, width, height) {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; p < out.length; p += 1, i += 4) {
    out[p] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  }
  return out;
}

function buildYuvChannels(data, width, height) {
  const length = width * height;
  const y = new Float32Array(length);
  const u = new Float32Array(length);
  const v = new Float32Array(length);
  const alpha = new Float32Array(length);
  const saturation = new Float32Array(length);
  for (let pixel = 0, index = 0; pixel < length; pixel += 1, index += 4) {
    const r = Number(data[index]) || 0;
    const g = Number(data[index + 1]) || 0;
    const b = Number(data[index + 2]) || 0;
    const a = Math.max(0, Math.min(1, (Number(data[index + 3]) || 0) / 255));
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    y[pixel] = luma;
    u[pixel] = b - luma;
    v[pixel] = r - luma;
    alpha[pixel] = a;
    saturation[pixel] = max <= 0 ? 0 : (max - min) / max;
  }
  return { y, u, v, alpha, saturation };
}

function buildSobelMagnitude(luma, width, height) {
  const out = new Float32Array(width * height);
  for (let y = 1; y < height - 1; y += 1) {
    const row = y * width;
    for (let x = 1; x < width - 1; x += 1) {
      const i = row + x;
      const gx =
        -luma[i - width - 1] +
        luma[i - width + 1] -
        2 * luma[i - 1] +
        2 * luma[i + 1] -
        luma[i + width - 1] +
        luma[i + width + 1];
      const gy =
        -luma[i - width - 1] -
        2 * luma[i - width] -
        luma[i - width + 1] +
        luma[i + width - 1] +
        2 * luma[i + width] +
        luma[i + width + 1];
      out[i] = Math.sqrt(gx * gx + gy * gy);
    }
  }
  return out;
}

function weightedStatsWhere(values, weights, predicate) {
  let sum = 0;
  let sumSq = 0;
  let weight = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (predicate && !predicate(i)) continue;
    const w = weights ? Number(weights[i]) || 0 : 1;
    if (w <= 0) continue;
    const value = Number(values[i]) || 0;
    sum += value * w;
    sumSq += value * value * w;
    weight += w;
  }
  if (weight <= 0) return { mean: 0, std: 1, weight: 0 };
  const mean = sum / weight;
  return {
    mean,
    std: Math.sqrt(Math.max(0.0001, sumSq / weight - mean * mean)),
    weight,
  };
}

function buildSubjectAwareColorWeights(sourceChannels, referenceChannels, width, height) {
  const length = width * height;
  const weights = new Float32Array(length);
  const sourceGrad = buildSobelMagnitude(sourceChannels.y, width, height);
  const refGrad = buildSobelMagnitude(referenceChannels.y, width, height);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const maxDistance = Math.max(1, Math.hypot(centerX, centerY));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const alpha = Math.max(0, Math.min(1, sourceChannels.alpha[i]));
      if (alpha <= 0.04) {
        weights[i] = 0;
        continue;
      }
      const sourceY = sourceChannels.y[i];
      const refY = referenceChannels.y[i];
      const diffY = Math.abs(sourceY - refY);
      const diffChroma = Math.hypot(
        sourceChannels.u[i] - referenceChannels.u[i],
        sourceChannels.v[i] - referenceChannels.v[i]
      );
      const sourceEdge = sourceGrad[i];
      const refEdge = refGrad[i];
      const edge = Math.max(sourceEdge, refEdge);
      const edgeAgreement = Math.min(sourceEdge, refEdge) / Math.max(1, edge);
      const midtone = 1 - Math.min(1, Math.abs(sourceY - 132) / 132);
      const saturation = Math.max(sourceChannels.saturation[i], referenceChannels.saturation[i]);
      const distance = Math.hypot(x - centerX, y - centerY) / maxDistance;
      const centerBias = 1 - Math.min(1, distance * 0.82);
      const differenceCue = Math.min(1, (diffY * 0.72 + diffChroma * 0.45) / 48);
      const edgeCue = Math.min(1, edge / 42) * (0.45 + edgeAgreement * 0.55);
      const colorCue = Math.min(1, saturation * 2.4);
      const highlightPenalty = smoothstep(222, 252, Math.max(sourceY, refY)) * 0.68;
      const shadowPenalty = (1 - smoothstep(12, 38, Math.min(sourceY, refY))) * 0.62;
      const flatBackgroundPenalty = edge < 6 && diffY < 7 && diffChroma < 7 ? 0.58 : 0;
      let weight =
        alpha *
        (0.08 + differenceCue * 0.42 + edgeCue * 0.36 + colorCue * 0.18 + midtone * 0.24 + centerBias * 0.16);
      weight *= 1 - Math.min(0.82, highlightPenalty + shadowPenalty + flatBackgroundPenalty);
      weights[i] = Math.max(0, weight);
    }
  }
  return weights;
}

function sampleRgbaBilinear(data, width, height, x, y) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1);
  const y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const i00 = (Math.max(0, Math.min(height - 1, y0)) * width + Math.max(0, Math.min(width - 1, x0))) * 4;
  const i10 = (Math.max(0, Math.min(height - 1, y0)) * width + x1) * 4;
  const i01 = (y1 * width + Math.max(0, Math.min(width - 1, x0))) * 4;
  const i11 = (y1 * width + x1) * 4;
  const out = new Uint8Array(4);
  for (let c = 0; c < 4; c += 1) {
    const v00 = data[i00 + c];
    const v10 = data[i10 + c];
    const v01 = data[i01 + c];
    const v11 = data[i11 + c];
    const v0 = v00 + (v10 - v00) * tx;
    const v1 = v01 + (v11 - v01) * tx;
    out[c] = clampByte(v0 + (v1 - v0) * ty);
  }
  return out;
}

/** 与 PixelRunner buildScaleCandidates 一致：按百分比步长展开 */
function buildScaleCandidates(maxScalePercent, enabled) {
  if (!enabled || !(maxScalePercent > 0)) return [1];
  const maxScale = Math.max(0, Math.min(4, Number(maxScalePercent) || 0));
  const out = [1];
  const unit = maxScale <= 1.25 ? 0.25 : 0.5;
  for (let step = unit; step <= maxScale + 0.001; step += unit) {
    out.push(1 - step / 100, 1 + step / 100);
  }
  if (Math.abs(maxScale % unit) > 0.001) {
    out.push(1 - maxScale / 100, 1 + maxScale / 100);
  }
  return out.sort((a, b) => Math.abs(a - 1) - Math.abs(b - 1));
}

function buildRotationCandidates(maxRotationDeg, enabled) {
  if (!enabled || !(maxRotationDeg > 0)) return [0];
  const max = Math.max(0, Math.min(3, Number(maxRotationDeg) || 0));
  const unit = max <= 1 ? 0.25 : 0.5;
  const out = [0];
  for (let step = unit; step <= max + 0.001; step += unit) {
    out.push(-step, step);
  }
  if (Math.abs(max % unit) > 0.001) out.push(-max, max);
  return Array.from(new Set(out.map((v) => Number(v.toFixed(3))))).sort((a, b) => Math.abs(a) - Math.abs(b));
}

/** 仅平移对齐（兼容旧调用） */
export function estimateTranslationAlignment(sourceSample, referenceSample, maxOffset = 120) {
  return estimatePatchAlignment(sourceSample, referenceSample, {
    alignmentMaxOffset: maxOffset,
    alignmentScaleEnabled: false,
    alignmentRotationEnabled: false,
  });
}

/**
 * 平移 + 等比缩放 + 小角度旋转对齐（PixelRunner 子集）。
 * 注意：粗搜只做平移，再在最佳点附近精细缩放/旋转——禁止四重嵌套全搜（会卡死主线程）。
 */
export function estimatePatchAlignment(sourceSample, referenceSample, configOrMaxOffset = {}) {
  if (
    !sourceSample?.data ||
    !referenceSample?.data ||
    sourceSample.width !== referenceSample.width ||
    sourceSample.height !== referenceSample.height
  ) {
    return { applied: false, dx: 0, dy: 0, scale: 1, rotation: 0, confidence: 0, reason: 'size-mismatch' };
  }
  const config =
    typeof configOrMaxOffset === 'object'
      ? configOrMaxOffset
      : { alignmentMaxOffset: configOrMaxOffset, alignmentScaleEnabled: false };
  const width = sourceSample.width;
  const height = sourceSample.height;
  if (width < 32 || height < 32) {
    return { applied: false, dx: 0, dy: 0, scale: 1, rotation: 0, confidence: 0, reason: 'too-small' };
  }
  const scaleDoc = Math.max(1e-6, Number(sourceSample.scaleX) || 1, Number(sourceSample.scaleY) || 1);
  const sampleOffset = Math.max(
    1,
    Math.min(Math.floor(Math.min(width, height) * 0.45), Math.round(Number(config.alignmentMaxOffset || 120) / scaleDoc))
  );
  const sourceGrad = buildSobelMagnitude(buildLuma(sourceSample.data, width, height), width, height);
  const refGrad = buildSobelMagnitude(buildLuma(referenceSample.data, width, height), width, height);
  // 粗搜用更大 stride；细搜再加密
  const coarseStride = Math.max(2, Math.floor(Math.max(width, height) / 96));
  const fineStride = Math.max(1, Math.floor(Math.max(width, height) / 160));
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const scaleCandidates = buildScaleCandidates(config.alignmentMaxScale, config.alignmentScaleEnabled !== false);
  const rotationCandidates = buildRotationCandidates(config.alignmentMaxRotation, config.alignmentRotationEnabled !== false);

  function scoreAt(dx, dy, scale, rotationDeg, stride) {
    const s = Math.max(0.92, Math.min(1.08, Number(scale) || 1));
    const rad = ((Number(rotationDeg) || 0) * Math.PI) / 180;
    const cos = Math.cos(-rad);
    const sin = Math.sin(-rad);
    let sum = 0;
    let sumSqS = 0;
    let sumSqR = 0;
    let n = 0;
    for (let y = 2; y < height - 2; y += stride) {
      for (let x = 2; x < width - 2; x += stride) {
        const lx = (x - cx) / s;
        const ly = (y - cy) / s;
        const sx = cx + lx * cos - ly * sin + dx;
        const sy = cy + lx * sin + ly * cos + dy;
        if (sx < 1 || sy < 1 || sx >= width - 1 || sy >= height - 1) continue;
        const sv = sourceGrad[Math.round(sy) * width + Math.round(sx)];
        const rv = refGrad[y * width + x];
        sum += sv * rv;
        sumSqS += sv * sv;
        sumSqR += rv * rv;
        n += 1;
      }
    }
    if (n < 32) return -1;
    const denom = Math.sqrt(sumSqS * sumSqR);
    return denom > 1e-6 ? sum / denom : -1;
  }

  function consider(bestState, secondRef, dx, dy, scale, rotation, stride) {
    const score = scoreAt(dx, dy, scale, rotation, stride);
    if (score > bestState.score) {
      secondRef.v = bestState.score;
      bestState.dx = dx;
      bestState.dy = dy;
      bestState.scale = scale;
      bestState.rotation = rotation;
      bestState.score = score;
    } else if (score > secondRef.v) {
      secondRef.v = score;
    }
  }

  const best = { dx: 0, dy: 0, scale: 1, rotation: 0, score: scoreAt(0, 0, 1, 0, coarseStride) };
  const second = { v: -1 };
  // 1) 粗搜：仅平移
  const coarse = Math.max(4, Math.floor(sampleOffset / 6));
  for (let dy = -sampleOffset; dy <= sampleOffset; dy += coarse) {
    for (let dx = -sampleOffset; dx <= sampleOffset; dx += coarse) {
      if (dx === 0 && dy === 0) continue;
      consider(best, second, dx, dy, 1, 0, coarseStride);
    }
  }
  // 2) 平移细搜
  for (let dy = best.dy - coarse; dy <= best.dy + coarse; dy += 1) {
    for (let dx = best.dx - coarse; dx <= best.dx + coarse; dx += 1) {
      if (Math.abs(dx) > sampleOffset || Math.abs(dy) > sampleOffset) continue;
      if (dx === best.dx && dy === best.dy) continue;
      consider(best, second, dx, dy, 1, 0, fineStride);
    }
  }
  // 3) 在最佳平移点上搜缩放×旋转（不再扫全偏移）
  for (const scale of scaleCandidates) {
    for (const rotation of rotationCandidates) {
      if (Math.abs(scale - 1) < 1e-6 && Math.abs(rotation) < 1e-6) continue;
      consider(best, second, best.dx, best.dy, scale, rotation, fineStride);
    }
  }
  // 4) 最佳仿射附近再微调 ±2px
  const local = 2;
  for (let dy = best.dy - local; dy <= best.dy + local; dy += 1) {
    for (let dx = best.dx - local; dx <= best.dx + local; dx += 1) {
      if (Math.abs(dx) > sampleOffset || Math.abs(dy) > sampleOffset) continue;
      consider(best, second, dx, dy, best.scale, best.rotation, fineStride);
    }
  }

  const confidence = Math.max(0, Math.min(1, (best.score - Math.max(0, second.v)) * 3 + Math.max(0, best.score - 0.22)));
  const significant =
    Math.abs(best.dx) >= 0.35 ||
    Math.abs(best.dy) >= 0.35 ||
    Math.abs(best.scale * 100 - 100) >= 0.08 ||
    Math.abs(best.rotation) >= 0.03;
  if (confidence < 0.18 || !significant) {
    return { applied: false, dx: 0, dy: 0, scale: 1, rotation: 0, confidence, reason: 'low-confidence' };
  }
  return {
    applied: true,
    dx: best.dx,
    dy: best.dy,
    scale: best.scale,
    rotation: best.rotation,
    confidence,
    reason: 'aligned',
  };
}

/** 绕中心：旋转 + 等比缩放 + 平移（对齐 PixelRunner warp 子集，无非等比 stretch） */
function warpAlignSample(sample, dx, dy, scale = 1, rotationDeg = 0) {
  if (!sample?.data) return sample;
  const s = Math.max(0.92, Math.min(1.08, Number(scale) || 1));
  const rot = Number(rotationDeg) || 0;
  if (!dx && !dy && Math.abs(s - 1) < 1e-6 && Math.abs(rot) < 1e-6) return sample;
  const width = sample.width;
  const height = sample.height;
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const rad = (rot * Math.PI) / 180;
  const cos = Math.cos(-rad);
  const sin = Math.sin(-rad);
  const out = new Uint8Array(sample.data.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const lx = (x - cx) / s;
      const ly = (y - cy) / s;
      const sx = cx + lx * cos - ly * sin + dx;
      const sy = cy + lx * sin + ly * cos + dy;
      const src = sampleRgbaBilinear(sample.data, width, height, sx, sy);
      const i = (y * width + x) * 4;
      out[i] = src[0];
      out[i + 1] = src[1];
      out[i + 2] = src[2];
      out[i + 3] = src[3];
    }
  }
  return { ...sample, data: out };
}

function warpTranslateSample(sample, dx, dy) {
  return warpAlignSample(sample, dx, dy, 1, 0);
}

function buildInternalColorProfile(sourceSample, referenceSample, config, alignment) {
  if (
    !sourceSample?.data ||
    !referenceSample?.data ||
    sourceSample.width !== referenceSample.width ||
    sourceSample.height !== referenceSample.height
  ) {
    return null;
  }
  const alignedSource = alignment?.applied
    ? warpAlignSample(sourceSample, alignment.dx, alignment.dy, alignment.scale || 1, alignment.rotation || 0)
    : sourceSample;
  const width = Math.max(1, Number(sourceSample.width) || 1);
  const height = Math.max(1, Number(sourceSample.height) || 1);
  const sourceChannels = buildYuvChannels(alignedSource.data, width, height);
  const referenceChannels = buildYuvChannels(referenceSample.data, width, height);
  const weights = buildSubjectAwareColorWeights(sourceChannels, referenceChannels, width, height);
  const total = Math.max(0, Math.min(1, Number(config?.totalStrength) / 100 || 0));
  const luminanceAmount = total * Math.max(0, Math.min(1.15, Number(config?.luminanceStrength) / 100 || 0));
  const colorAmount = total * Math.max(0, Math.min(1.2, Number(config?.colorStrength) / 100 || 0));
  const saturationAmount = total * Math.max(-1, Math.min(1.05, Number(config?.saturationStrength) / 100 || 0));
  const validMid = (i) =>
    sourceChannels.alpha[i] > 0.08 &&
    sourceChannels.y[i] >= 42 &&
    sourceChannels.y[i] <= 218 &&
    referenceChannels.y[i] >= 32 &&
    referenceChannels.y[i] <= 232;
  const validShadow = (i) => sourceChannels.alpha[i] > 0.08 && sourceChannels.y[i] < 106 && sourceChannels.y[i] >= 18;
  const validHighlight = (i) =>
    sourceChannels.alpha[i] > 0.08 && sourceChannels.y[i] > 154 && sourceChannels.y[i] <= 245;
  const sourceY = weightedStatsWhere(sourceChannels.y, weights, validMid);
  const referenceY = weightedStatsWhere(referenceChannels.y, weights, validMid);
  const sourceShadowY = weightedStatsWhere(sourceChannels.y, weights, validShadow);
  const referenceShadowY = weightedStatsWhere(referenceChannels.y, weights, validShadow);
  const sourceHighlightY = weightedStatsWhere(sourceChannels.y, weights, validHighlight);
  const referenceHighlightY = weightedStatsWhere(referenceChannels.y, weights, validHighlight);
  const sourceU = weightedStatsWhere(sourceChannels.u, weights, validMid);
  const referenceU = weightedStatsWhere(referenceChannels.u, weights, validMid);
  const sourceV = weightedStatsWhere(sourceChannels.v, weights, validMid);
  const referenceV = weightedStatsWhere(referenceChannels.v, weights, validMid);
  const sourceSat = weightedStatsWhere(sourceChannels.saturation, weights, validMid);
  const referenceSat = weightedStatsWhere(referenceChannels.saturation, weights, validMid);
  const toneStrength = Math.min(0.72, luminanceAmount * 0.82);
  const colorStrength = Math.min(0.82, colorAmount * 0.86);
  const midDelta = Math.max(-34, Math.min(34, (referenceY.mean - sourceY.mean) * toneStrength));
  const shadowRawDelta =
    referenceShadowY.weight > 16 ? referenceShadowY.mean - sourceShadowY.mean : referenceY.mean - sourceY.mean;
  const highlightRawDelta =
    referenceHighlightY.weight > 16
      ? referenceHighlightY.mean - sourceHighlightY.mean
      : referenceY.mean - sourceY.mean;
  const shadowDelta = Math.max(
    -18,
    Math.min(18, (shadowRawDelta * 0.45 + (referenceY.mean - sourceY.mean) * 0.2) * toneStrength)
  );
  const highlightDelta = Math.max(
    -18,
    Math.min(18, (highlightRawDelta * 0.42 + (referenceY.mean - sourceY.mean) * 0.18) * toneStrength)
  );
  const uDelta = Math.max(-34, Math.min(34, (referenceU.mean - sourceU.mean) * colorStrength));
  const vDelta = Math.max(-34, Math.min(34, (referenceV.mean - sourceV.mean) * colorStrength));
  const saturationFactor = Math.max(
    0.9,
    Math.min(1.1, 1 + (referenceSat.mean - sourceSat.mean) * 1.05 * saturationAmount)
  );
  return {
    midDelta,
    shadowDelta,
    highlightDelta,
    uDelta,
    vDelta,
    chromaScale: 1,
    saturationFactor,
    alignedSource,
  };
}

function applyInternalColorCorrectionsToRgba(sourceSample, config, colorProfile) {
  if (!sourceSample?.data) throw new Error('blend-match missing source');
  const width = Math.max(1, Number(sourceSample.width) || 1);
  const height = Math.max(1, Number(sourceSample.height) || 1);
  const sourceData = sourceSample.data;
  const out = new Uint8ClampedArray(sourceData.length);
  const profile = colorProfile || null;
  for (let index = 0; index < sourceData.length; index += 4) {
    const alpha = sourceData[index + 3];
    if (alpha <= 0) {
      out[index] = 0;
      out[index + 1] = 0;
      out[index + 2] = 0;
      out[index + 3] = 0;
      continue;
    }
    let r = sourceData[index];
    let g = sourceData[index + 1];
    let b = sourceData[index + 2];
    if (profile) {
      const y0 = 0.299 * r + 0.587 * g + 0.114 * b;
      const u0 = b - y0;
      const v0 = r - y0;
      const shadowWeight = 1 - smoothstep(42, 118, y0);
      const highlightWeight = smoothstep(172, 238, y0);
      const midWeight = Math.max(0, 1 - Math.max(shadowWeight, highlightWeight));
      let toneDelta =
        (Number(profile.shadowDelta) || 0) * shadowWeight +
        (Number(profile.midDelta) || 0) * midWeight +
        (Number(profile.highlightDelta) || 0) * highlightWeight;
      if (y0 > 218 && toneDelta > 0) toneDelta *= 0.35;
      if (y0 < 32 && toneDelta < 0) toneDelta *= 0.35;
      const y = y0 + toneDelta;
      const chromaProtect = 0.52 + midWeight * 0.48;
      const u = u0 * (1 + (profile.chromaScale - 1) * chromaProtect) + profile.uDelta * chromaProtect;
      const v = v0 * (1 + (profile.chromaScale - 1) * chromaProtect) + profile.vDelta * chromaProtect;
      [r, g, b] = yuvToRgb(y, u, v);
      [r, g, b] = applySaturationToRgb(r, g, b, 1 + (profile.saturationFactor - 1) * chromaProtect);
    }
    out[index] = clampByte(r);
    out[index + 1] = clampByte(g);
    out[index + 2] = clampByte(b);
    // 保留 alpha：contain 留白透明，避免把空隙当实像素参与贴回
    out[index + 3] = alpha;
  }
  return { width, height, data: out };
}

/** 向内羽化：距边 softstep（比 contract+盒模糊更干净，避免框边硬缝） */
export function makeInwardFeatherMask(width, height, featherRadius) {
  const w = Math.max(1, width | 0);
  const h = Math.max(1, height | 0);
  const feather = Math.max(0, Math.round(Number(featherRadius) || 0));
  const out = new Float32Array(w * h);
  if (feather <= 0) {
    out.fill(1);
    return out;
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const dist = Math.min(x, y, w - 1 - x, h - 1 - y);
      out[y * w + x] = dist >= feather ? 1 : smoothstep(0, feather, dist);
    }
  }
  return out;
}

/**
 * 对 AI 贴片相对原选区做对齐 + YUV 融合校色，返回校色后的 RGBA。
 * @param {{ data: Uint8ClampedArray|Uint8Array, width: number, height: number, scaleX?: number, scaleY?: number }} sourceSample AI 结果
 * @param {{ data: Uint8ClampedArray|Uint8Array, width: number, height: number }} referenceSample 原图同位置裁切
 */
export function blendMatchPatch(sourceSample, referenceSample, rawConfig = {}) {
  const config = resolveBoxRepaintBlendConfig(rawConfig);
  const alignment = config.alignmentEnabled
    ? estimatePatchAlignment(sourceSample, referenceSample, config)
    : { applied: false, dx: 0, dy: 0, scale: 1, rotation: 0, confidence: 0 };
  const profile = buildInternalColorProfile(sourceSample, referenceSample, config, alignment);
  const sampleForColor = profile?.alignedSource || sourceSample;
  const corrected = applyInternalColorCorrectionsToRgba(sampleForColor, config, profile);
  return {
    ...corrected,
    alignment,
    profile,
    config,
  };
}

/**
 * 把校色后的贴片羽化合成到整图。
 * @returns {ImageData}
 */
export function compositeBoxRepaint(originalImageData, correctedPatch, box, featherRadius = 16) {
  const { x, y, w, h } = box;
  const out = new ImageData(new Uint8ClampedArray(originalImageData.data), originalImageData.width, originalImageData.height);
  const featherMask = makeInwardFeatherMask(w, h, featherRadius);
  const ow = originalImageData.width;
  const patch = correctedPatch.data;
  for (let py = 0; py < h; py += 1) {
    for (let px = 0; px < w; px += 1) {
      const dx = x + px;
      const dy = y + py;
      if (dx < 0 || dy < 0 || dx >= ow || dy >= originalImageData.height) continue;
      const pi = (py * w + px) * 4;
      const patchA = (Number(patch[pi + 3]) || 0) / 255;
      // 羽化 × 贴片 alpha：contain 留白（透明）露出原图，对齐 PR 图层蒙版行为
      const t = featherMask[py * w + px] * patchA;
      if (t <= 0.001) continue;
      const oi = (dy * ow + dx) * 4;
      out.data[oi] = Math.round(out.data[oi] * (1 - t) + patch[pi] * t);
      out.data[oi + 1] = Math.round(out.data[oi + 1] * (1 - t) + patch[pi + 1] * t);
      out.data[oi + 2] = Math.round(out.data[oi + 2] * (1 - t) + patch[pi + 2] * t);
      out.data[oi + 3] = 255;
    }
  }
  return out;
}

/** 下载/缩放图到 RGBA sample（浏览器）；fetch→blob 避免 CORS/crossOrigin 污染导致贴回失败 */
export async function loadRgbaSampleFromUrl(url, targetW, targetH) {
  const raw = String(url || '').trim();
  if (!raw) throw new Error('empty url');
  const res = await fetch(raw, { credentials: 'include' });
  if (!res.ok) throw new Error(`fetch ${res.status}`);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('image decode failed'));
      el.src = objUrl;
    });
    const w = Math.max(1, targetW || img.naturalWidth || img.width);
    const h = Math.max(1, targetH || img.naturalHeight || img.height);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: imageData.data, scaleX: 1, scaleY: 1, canvas, imageData, img };
  } finally {
    URL.revokeObjectURL(objUrl);
  }
}

/**
 * PixelRunner 选区贴回：把结果图装进 targetW×targetH。
 * contain（默认）= 等比缩放居中，空隙保持透明（对齐 PS place 图层；合成时露出原图）。
 * baseImageData 仅 stretch 铺底时使用；contain/cover 默认透明底。
 */
export function placeResultIntoTargetBounds(resultImg, targetW, targetH, baseImageData = null, fitMode = 'contain') {
  const tw = Math.max(1, targetW | 0);
  const th = Math.max(1, targetH | 0);
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const mode = String(fitMode || 'contain').toLowerCase();
  // contain/cover：透明留白（PR 图层 alpha）；stretch 可铺原图底
  if (mode === 'stretch' && baseImageData && baseImageData.width === tw && baseImageData.height === th) {
    ctx.putImageData(baseImageData, 0, 0);
  } else {
    ctx.clearRect(0, 0, tw, th);
  }
  const rw = Math.max(1, resultImg.naturalWidth || resultImg.width || 1);
  const rh = Math.max(1, resultImg.naturalHeight || resultImg.height || 1);
  let dw;
  let dh;
  let dx;
  let dy;
  if (mode === 'stretch') {
    dw = tw;
    dh = th;
    dx = 0;
    dy = 0;
  } else if (mode === 'cover') {
    const sc = Math.max(tw / rw, th / rh);
    dw = rw * sc;
    dh = rh * sc;
    dx = (tw - dw) / 2;
    dy = (th - dh) / 2;
  } else {
    const sc = Math.min(tw / rw, th / rh);
    dw = rw * sc;
    dh = rh * sc;
    dx = (tw - dw) / 2;
    dy = (th - dh) / 2;
  }
  ctx.drawImage(resultImg, 0, 0, rw, rh, dx, dy, dw, dh);
  const imageData = ctx.getImageData(0, 0, tw, th);
  return {
    width: tw,
    height: th,
    data: imageData.data,
    scaleX: 1,
    scaleY: 1,
    canvas,
    imageData,
    placed: { dx, dy, dw, dh, fitMode: mode, srcW: rw, srcH: rh },
  };
}

/**
 * 完整框选贴回：原图 URL + AI 结果 URL + 像素框 → 合成后 ImageData
 * 几何：先按 PixelRunner 选区 fitMode(contain) 装入原选区矩形，再做缩放/平移对齐 + 校色 + 羽化。
 */
export async function stitchBoxRepaintResult({
  originalUrl,
  resultUrl,
  box,
  config = DEFAULT_BOX_REPAINT_BLEND_CONFIG,
  analysisMaxEdge = 512,
}) {
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.max(1, Math.round(box.w));
  const h = Math.max(1, Math.round(box.h));
  const origFull = await loadRgbaSampleFromUrl(originalUrl);
  const ow = origFull.width;
  const oh = origFull.height;
  const bx = Math.min(x, ow - 1);
  const by = Math.min(y, oh - 1);
  const bw = Math.min(w, ow - bx);
  const bh = Math.min(h, oh - by);

  const refCanvas = document.createElement('canvas');
  refCanvas.width = bw;
  refCanvas.height = bh;
  const refCtx = refCanvas.getContext('2d', { willReadFrequently: true });
  refCtx.drawImage(origFull.canvas, bx, by, bw, bh, 0, 0, bw, bh);
  const referenceImageData = refCtx.getImageData(0, 0, bw, bh);
  const referenceFull = {
    width: bw,
    height: bh,
    data: referenceImageData.data,
    scaleX: 1,
    scaleY: 1,
  };

  const resultSample = await loadRgbaSampleFromUrl(resultUrl);
  const resultImg = resultSample.img || resultSample.canvas;
  if (!resultImg) throw new Error('result image load failed');

  const cfg = resolveBoxRepaintBlendConfig(config);
  // contain：透明底；勿把原图像素填进留白，否则会污染对齐梯度与校色权重
  const resultFull = placeResultIntoTargetBounds(resultImg, bw, bh, null, cfg.fitMode);

  const longEdge = Math.max(bw, bh);
  const maxEdge = Math.max(256, Number(cfg.analysisMaxEdge) || analysisMaxEdge || 512);
  const analysisScale = longEdge > maxEdge ? maxEdge / longEdge : 1;
  const aw = Math.max(32, Math.round(bw * analysisScale));
  const ah = Math.max(32, Math.round(bh * analysisScale));
  const srcAnalysisCanvas = document.createElement('canvas');
  srcAnalysisCanvas.width = aw;
  srcAnalysisCanvas.height = ah;
  srcAnalysisCanvas.getContext('2d').drawImage(resultFull.canvas, 0, 0, aw, ah);
  const srcAnalysis = {
    width: aw,
    height: ah,
    data: srcAnalysisCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, aw, ah).data,
    scaleX: bw / aw,
    scaleY: bh / ah,
  };
  const refAnalysisCanvas = document.createElement('canvas');
  refAnalysisCanvas.width = aw;
  refAnalysisCanvas.height = ah;
  refAnalysisCanvas.getContext('2d').drawImage(refCanvas, 0, 0, aw, ah);
  const refAnalysis = {
    width: aw,
    height: ah,
    data: refAnalysisCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, aw, ah).data,
    scaleX: bw / aw,
    scaleY: bh / ah,
  };

  const alignment = cfg.alignmentEnabled
    ? estimatePatchAlignment(srcAnalysis, refAnalysis, cfg)
    : { applied: false, dx: 0, dy: 0, scale: 1, confidence: 0 };

  const fullAlignment = alignment.applied
    ? {
        applied: true,
        dx: alignment.dx * (bw / aw),
        dy: alignment.dy * (bh / ah),
        scale: alignment.scale || 1,
        rotation: alignment.rotation || 0,
        confidence: alignment.confidence,
        reason: alignment.reason,
      }
    : alignment;

  const profile = buildInternalColorProfile(resultFull, referenceFull, cfg, fullAlignment);
  const corrected = applyInternalColorCorrectionsToRgba(profile?.alignedSource || resultFull, cfg, profile);
  const featherMask = makeInwardFeatherMask(bw, bh, cfg.featherRadius);
  // 仅导出选区贴片：RGB=校色结果，A=羽化×贴片透明度（服务端按 alpha 融进原图像素）
  const patchData = new Uint8ClampedArray(bw * bh * 4);
  for (let i = 0, p = 0; p < bw * bh; p += 1, i += 4) {
    const srcA = (Number(corrected.data[i + 3]) || 0) / 255;
    const a = Math.max(0, Math.min(1, featherMask[p] * srcA));
    patchData[i] = corrected.data[i];
    patchData[i + 1] = corrected.data[i + 1];
    patchData[i + 2] = corrected.data[i + 2];
    patchData[i + 3] = Math.round(a * 255);
  }
  const composited = compositeBoxRepaint(origFull.imageData, corrected, { x: bx, y: by, w: bw, h: bh }, cfg.featherRadius);
  return {
    imageData: composited,
    patchImageData: { width: bw, height: bh, data: patchData },
    width: ow,
    height: oh,
    box: { x: bx, y: by, w: bw, h: bh },
    alignment: fullAlignment,
    placed: resultFull.placed,
    config: cfg,
  };
}
