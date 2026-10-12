/**
 * 新视角：箭头几何 → 焦段/光圈/三轴文案 → 视角指令。
 * 公式对齐 ningstudio「镜头视角标注台」（箭头长短=焦段、粗细=光圈）。
 */

export const NOVEL_VIEW_LEN_MIN = 0.08;
export const NOVEL_VIEW_LEN_MAX = 0.62;
export const NOVEL_VIEW_WIDTH_MIN = 0.006;
export const NOVEL_VIEW_WIDTH_MAX = 0.09;
export const NOVEL_VIEW_DEFAULT_WIDTH = 0.022;
export const NOVEL_VIEW_MIN_ARROW = 0.01;
export const NOVEL_VIEW_FOCAL_MIN = 16;
export const NOVEL_VIEW_FOCAL_MAX = 200;
export const NOVEL_VIEW_APERTURE_STOPS = [1.4, 2, 2.8, 4, 5.6, 8, 11, 16];
export const NOVEL_VIEW_MODELS = ['gpt-image-2', 'nano-banana-pro'];
export const NOVEL_VIEW_DEFAULT_MODEL = 'gpt-image-2';

const ARROW_FILL = '#e11d2a';
const ARROW_OUTLINE = '#0e0e0e';
const ARROW_TEXT = '#e5e2e1';

export function clamp01(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

export function arrowLengthFrac(start, end) {
  if (!start || !end) return 0;
  return Math.hypot(Number(end.x) - Number(start.x), Number(end.y) - Number(start.y));
}

export function hasNovelViewArrow(start, end) {
  return Boolean(start && end && arrowLengthFrac(start, end) > NOVEL_VIEW_MIN_ARROW);
}

export function focalMmFromLength(len) {
  const t = clamp01((Number(len) - NOVEL_VIEW_LEN_MIN) / (NOVEL_VIEW_LEN_MAX - NOVEL_VIEW_LEN_MIN));
  return Math.round(NOVEL_VIEW_FOCAL_MIN * (NOVEL_VIEW_FOCAL_MAX / NOVEL_VIEW_FOCAL_MIN) ** t);
}

export function apertureFromWidthFrac(widthFrac) {
  const t = clamp01((Number(widthFrac) - NOVEL_VIEW_WIDTH_MIN) / (NOVEL_VIEW_WIDTH_MAX - NOVEL_VIEW_WIDTH_MIN));
  const raw = 16 * (1.4 / 16) ** t;
  let best = NOVEL_VIEW_APERTURE_STOPS[0];
  let bestScore = Infinity;
  for (const stop of NOVEL_VIEW_APERTURE_STOPS) {
    const score = Math.abs(Math.log(raw) - Math.log(stop));
    if (score < bestScore) {
      bestScore = score;
      best = stop;
    }
  }
  return best;
}

export function clampWidthFrac(widthFrac) {
  const v = Number(widthFrac);
  if (!Number.isFinite(v)) return NOVEL_VIEW_DEFAULT_WIDTH;
  return Math.min(NOVEL_VIEW_WIDTH_MAX, Math.max(NOVEL_VIEW_WIDTH_MIN, v));
}

function zoneX(x) {
  return x < 0.34 ? '左侧' : x < 0.67 ? '中部' : '右侧';
}

function zoneY(y) {
  return y < 0.38 ? '上方' : y < 0.68 ? '中部' : '下方';
}

function camPosText(x, y) {
  const nx = zoneX(x);
  const ny = zoneY(y);
  if (nx === '中部' && ny === '中部') return '画面中央';
  if (nx === '中部') return `画面${ny}`;
  if (ny === '中部') return `画面${nx}`;
  return `画面${ny}偏${nx}`;
}

export function cameraAxesFromArrow(start, end, depthDir = 'into') {
  const sx = clamp01(start?.x);
  const sy = clamp01(start?.y);
  const ex = clamp01(end?.x);
  const ey = clamp01(end?.y);
  const dx = ex - sx;
  const dy = ey - sy;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  let directionText;
  if (ax > ay * 1.3) directionText = dx > 0 ? '朝画面右侧拍摄' : '朝画面左侧拍摄';
  else if (ay > ax * 1.3) directionText = dy < 0 ? '朝画面深处方向拍摄' : '朝画面前方拍摄';
  else directionText = `朝画面${dx > 0 ? '右' : '左'}侧偏${dy < 0 ? '深处' : '前方'}方向拍摄`;
  const yawText = ax < 0.02 ? '水平朝正前方' : dx > 0 ? '朝画面右侧' : '朝画面左侧';
  const pitchDeg = Math.round(Math.min(60, Math.max(-60, Math.atan2(-dy, Math.max(ax, 0.08)) * 180 / Math.PI)));
  const pitchText = pitchDeg > 5 ? `仰拍约 ${pitchDeg}°` : pitchDeg < -5 ? `俯拍约 ${-pitchDeg}°` : '水平持平';
  const depthText = depthDir === 'out' ? '朝画面前方退出' : '朝画面深处推进';
  const pos = camPosText(sx, sy);
  return {
    camPosText: pos,
    directionText,
    cameraDesc: `机位在${pos}，${directionText}`,
    yawText,
    pitchText,
    depthText,
  };
}

function focalDesc(mm) {
  if (mm < 35) return '广角，视野开阔，近大远小的透视感强';
  if (mm < 70) return '标准焦段，透视自然';
  return '长焦，透视压缩，空间层次紧凑';
}

function apertureDesc(f) {
  if (f >= 8) return '小光圈，前景与背景都清晰';
  if (f >= 4) return '中等光圈，主体清晰、背景微虚';
  return '大光圈，主体突出、背景明显虚化';
}

export function buildNovelViewPrompt(focalMm, aperture, axes) {
  const e = Number(focalMm) || 50;
  const t = Number(aperture) || 2.8;
  return [
    '重绘这个场景的新视角画面：机位严格设在图中红色箭头的尾部，镜头严格朝向箭头前端所指的方向拍摄。',
    axes ? `机位位于${axes.camPosText}，${axes.directionText}，新机位与朝向必须与箭头两端严格一致。` : '',
    axes ? `镜头朝向三轴：左右轴——${axes.yawText}；上下轴——${axes.pitchText}；纵深轴——${axes.depthText}。重绘画面必须体现这三个轴向的视角变化。` : '',
    `使用 ${e}mm 焦段镜头（${focalDesc(e)}），光圈 f/${t}（${apertureDesc(t)}）。`,
    '保持场景主体、光线与氛围不变，按新机位与朝向重新构图。',
  ].filter(Boolean).join('');
}

function arrowPct(n) {
  return `${Math.round(clamp01(n) * 100)}%`;
}

/** 箭头尾部点物体，尖端点看向。机位在前景、中景还是背景由用户指定，模型不得改判。 */
export function normalizeArrowCameraDepth(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'near' || v === '前景') return 'near';
  if (v === 'far' || v === '背景') return 'far';
  return 'mid';
}

export function arrowCameraDepthLabel(cameraDepth, en) {
  const band = normalizeArrowCameraDepth(cameraDepth);
  if (en) return band === 'near' ? 'Foreground' : band === 'far' ? 'Background' : 'Midground';
  return band === 'near' ? '前景' : band === 'far' ? '背景' : '中景';
}

export function arrowCameraDepthClause(cameraDepth) {
  const band = normalizeArrowCameraDepth(cameraDepth);
  if (band === 'near') {
    return '用户已指定机位在前景。这是硬性条件，不要改判成中景或背景。尾部只说明站在哪件东西旁边，机位贴在那件东西前面很近的地方。相机脸朝箭头尖端。镜头背后的原图内容不要写进新画面。最近的体块必须又大又靠下。';
  }
  if (band === 'far') {
    return '用户已指定机位在背景。这是硬性条件，不要改判成前景或中景。尾部只说明站在哪件东西旁边，机位站在这个空间的后部。相机脸朝箭头尖端。从这个位置沿箭头看出去，镜头背后的原图内容可以完全不出现，包括原来画面里的前景。不要把原图主体强行留在新画面里。';
  }
  return '用户已指定机位在中景。这是硬性条件，不要改判成前景或背景。尾部只说明站在哪件东西旁边，机位在场景中间。相机脸朝箭头尖端。镜头背后的原图内容不要写进新画面。';
}

export function buildArrowViewpointIntent(start, end, cameraDepth) {
  const sx = clamp01(start?.x);
  const sy = clamp01(start?.y);
  const ex = clamp01(end?.x);
  const ey = clamp01(end?.y);
  return [
    '用户在照片上画了一根红色箭头来指定新机位。箭头不是场景里的物体。',
    '【图1】是干净原图。【图2】是同一张图加上这根红箭头，箭头只是标注。',
    arrowCameraDepthClause(cameraDepth),
    `箭头尾部在画面左起 ${arrowPct(sx)}、上起 ${arrowPct(sy)}。先说出尾部压住的物体，机位站在它旁边的空处，不要放进物体内部。远近用上面指定的层次，不要再自己判断前景、中景或背景。`,
    `箭头尖端在画面左起 ${arrowPct(ex)}、上起 ${arrowPct(ey)}。尖端是脸朝的方向。先说出尖端压住的表面或物体，再写沿这个方向、镜头前方会看见什么。尖端不是必须留在画面中央的主体。`,
    '落在镜头背后、或被墙挡住的原图物体，按协议三击杀，新画面可以完全没有它们。材质和光线跟原场景一致，但不要为了像原图而把主体都留住。',
    '不要把屏幕上的上下左右当成机位角度。',
    '英文提示词只描述新机位，以及这个机位下会看见什么。不要写图1、图2、Image 1、Image 2，也不要写红色箭头。',
    '英文提示词放在 ```text 代码块里。在它后面另给一个 ```json 代码块，不要把 JSON 写进英文。格式：{"masses":[{"depth":"near","cx":0.5,"cy":0.78,"size":0.42}]}。masses 是新机位画面里的体块，不是原图坐标。depth 只能是 near、mid、far。cx、cy 是体块中心，左上为 0。size 是相对画面宽度。体块的远近必须服从用户指定的机位层次。最多 6 块，不要文字。',
  ].join('\n');
}

/** ponytail: three coarse bands, not meters. A depth map would replace this if the server can run one. */
export function placeArrowMassing(masses, cameraDepth) {
  const band = normalizeArrowCameraDepth(cameraDepth);
  const list = (Array.isArray(masses) ? masses : []).slice(0, 6).map(item => ({ ...item }));
  const ensure = (depth, cx, cy, size) => {
    let found = list.find(item => item.band === depth);
    if (!found) {
      found = { band: depth, cx, cy, size };
      list.push(found);
    }
    return found;
  };
  if (band === 'near') {
    const near = ensure('near', 0.5, 0.78, 0.5);
    near.size = Math.max(near.size, 0.46);
    near.cy = Math.max(near.cy, 0.72);
    list.forEach(item => {
      if (item.band === 'far') item.size = Math.min(item.size, 0.2);
    });
  } else if (band === 'far') {
    list.forEach(item => {
      if (item.band === 'near') {
        item.size = Math.min(item.size, 0.16);
        item.cy = Math.min(item.cy, 0.4);
      }
    });
    const far = ensure('far', 0.5, 0.36, 0.2);
    far.size = Math.min(Math.max(far.size, 0.12), 0.26);
    far.cy = Math.min(far.cy, 0.46);
  } else {
    const mid = ensure('mid', 0.5, 0.5, 0.32);
    mid.size = Math.min(Math.max(mid.size, 0.24), 0.4);
    mid.cy = Math.min(Math.max(mid.cy, 0.4), 0.62);
  }
  return list.slice(0, 6);
}

export function buildArrowEditPrompt(english, hasMassing, cameraDepth) {
  const camera = String(english || '').trim();
  const band = normalizeArrowCameraDepth(cameraDepth);
  const depthLine = band === 'near'
    ? 'The camera stands in the foreground, close beside the object at the arrow tail, and faces along the arrow.'
    : band === 'far'
      ? 'The camera stands in the background of this space and faces along the arrow. Subjects that were in front of this spot in the original photo may now be behind the camera and must leave the frame.'
      : 'The camera stands in the midground and faces along the arrow. Anything behind this camera leaves the frame.';
  const lines = [
    'Image 1 is a reference for this place. Keep the materials and light of whatever stays visible. Do not keep subjects that fall behind the new camera. Do not copy image 1\'s camera angle.',
  ];
  if (hasMassing) {
    lines.push('Image 2 is a flat gray massing guide of the new camera only. Larger darker shapes are closer. Smaller lighter shapes are farther. Match image 2 for placement and scale. Do not paint the gray blocks.');
  }
  lines.push(depthLine, '', 'New camera:', camera);
  return lines.join('\n');
}

export function parseArrowMassing(raw) {
  const match = /```json\s*([\s\S]*?)```/i.exec(String(raw || ''));
  if (!match) return [];
  let data;
  try { data = JSON.parse(match[1]); } catch { return []; }
  const list = Array.isArray(data) ? data : data?.masses;
  if (!Array.isArray(list)) return [];
  return list.slice(0, 6).map(item => {
    const depth = String(item?.depth || item?.band || '').toLowerCase();
    const band = depth === 'near' || depth === 'far' ? depth : 'mid';
    const size = Number(item?.size);
    return {
      band,
      cx: clamp01(item?.cx ?? item?.x),
      cy: clamp01(item?.cy ?? item?.y),
      size: Math.min(0.72, Math.max(0.08, Number.isFinite(size) ? size : (band === 'near' ? 0.42 : band === 'far' ? 0.16 : 0.28))),
    };
  });
}

export function arrowMassingPixelSize(w, h) {
  const maxEdge = 960;
  const sw = Math.max(1, Number(w) || 1);
  const sh = Math.max(1, Number(h) || 1);
  const scale = Math.min(1, maxEdge / Math.max(sw, sh));
  return {
    w: Math.max(64, Math.round(sw * scale)),
    h: Math.max(64, Math.round(sh * scale)),
  };
}

export function paintArrowMassing(ctx, w, h, masses) {
  if (!ctx || !w || !h || !masses?.length) return;
  ctx.fillStyle = '#141414';
  ctx.fillRect(0, 0, w, h);
  const order = { far: 0, mid: 1, near: 2 };
  const sorted = [...masses].sort((a, b) => (order[a.band] ?? 1) - (order[b.band] ?? 1));
  for (const m of sorted) {
    const bw = m.size * w;
    const bh = m.size * h * 0.72;
    ctx.fillStyle = m.band === 'near' ? '#2a2a2a' : m.band === 'far' ? '#a3a3a3' : '#5c5c5c';
    ctx.fillRect(m.cx * w - bw / 2, m.cy * h - bh / 2, bw, bh);
  }
}

export function novelViewFromArrow(start, end, widthFrac, depthDir = 'into') {
  const len = arrowLengthFrac(start, end);
  const width = clampWidthFrac(widthFrac);
  const hasArrow = len > NOVEL_VIEW_MIN_ARROW;
  const focalMm = focalMmFromLength(len);
  const aperture = apertureFromWidthFrac(width);
  const axes = hasArrow ? cameraAxesFromArrow(start, end, depthDir) : null;
  return {
    hasArrow,
    lengthFrac: len,
    widthFrac: width,
    focalMm,
    aperture,
    apertureText: `f/${aperture}`,
    axes,
    prompt: hasArrow ? buildNovelViewPrompt(focalMm, aperture, axes) : '',
  };
}

export function nearestAspectRatio(w, h, keys) {
  const list = Array.isArray(keys) && keys.length ? keys : ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];
  const n = Math.log(Math.max(1, Number(w)) / Math.max(1, Number(h)));
  let best = list[0];
  let bestScore = Infinity;
  for (const key of list) {
    const [a, b] = String(key).split(':').map(Number);
    if (!a || !b) continue;
    const score = Math.abs(Math.log(a / b) - n);
    if (score < bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

function drawShaft(ctx, x0, y0, px, py, tailW, headW, x1, y1) {
  ctx.beginPath();
  ctx.moveTo(x0 + px * tailW / 2, y0 + py * tailW / 2);
  ctx.lineTo(x1 + px * headW / 2, y1 + py * headW / 2);
  ctx.lineTo(x1 - px * headW / 2, y1 - py * headW / 2);
  ctx.lineTo(x0 - px * tailW / 2, y0 - py * tailW / 2);
  ctx.closePath();
}

function drawHead(ctx, tipX, tipY, px, py, baseX, baseY, spread) {
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + px * spread, baseY + py * spread);
  ctx.lineTo(baseX - px * spread, baseY - py * spread);
  ctx.closePath();
}

function strokeLabel(ctx, text, x, y, size, fill, outline) {
  ctx.font = `600 ${size}px system-ui, "Noto Sans SC", "PingFang SC", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = Math.max(3, size * 0.22);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = outline;
  ctx.strokeText(text, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
}

function drawAxesGizmo(ctx, x, y, size, fill, outline, text) {
  const arms = [
    { dx: 1, dy: 0, label: '左右', dashed: false },
    { dx: 0, dy: -1, label: '上下', dashed: false },
    { dx: 0.62, dy: -0.62, label: '纵深', dashed: true },
  ];
  ctx.lineCap = 'round';
  for (const arm of arms) {
    const tx = x + arm.dx * size;
    const ty = y + arm.dy * size;
    ctx.setLineDash([]);
    ctx.strokeStyle = outline;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash(arm.dashed ? [4, 3] : []);
    ctx.strokeStyle = fill;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.setLineDash([]);
    const ang = Math.atan2(arm.dy, arm.dx);
    const ah = Math.max(4, size * 0.22);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(tx - ah * Math.cos(ang - 0.45), ty - ah * Math.sin(ang - 0.45));
    ctx.lineTo(tx - ah * Math.cos(ang + 0.45), ty - ah * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
    strokeLabel(ctx, arm.label, tx + arm.dx * size * 0.42, ty + arm.dy * size * 0.42, Math.max(9, size * 0.34), text, outline);
  }
  ctx.beginPath();
  ctx.arc(x, y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** 在 ctx 上画红箭头（start/end 为 0–1 相对坐标）。合成给模型时也走这里，标签保持中文。 */
export function drawNovelViewArrow(ctx, w, h, start, end, widthFrac, colors = {}) {
  if (!ctx || !start || !end || w < 2 || h < 2) return;
  const fill = colors.fill || ARROW_FILL;
  const outline = colors.outline || ARROW_OUTLINE;
  const text = colors.text || ARROW_TEXT;
  const x0 = start.x * w;
  const y0 = start.y * h;
  const x1 = end.x * w;
  const y1 = end.y * h;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1) return;
  const headW = Math.max(3, clampWidthFrac(widthFrac) * Math.min(w, h));
  const tailW = Math.max(1.5, headW * 0.4);
  const ux = dx / len;
  const uy = dy / len;
  const px = -uy;
  const py = ux;
  const headLen = Math.min(Math.max(headW * 2.2, 14), len * 0.6);
  const baseX = x1 - ux * headLen;
  const baseY = y1 - uy * headLen;
  const neckX = x1 - ux * headLen * 0.55;
  const neckY = y1 - uy * headLen * 0.55;
  const headSpread = headW * 1.15;
  drawShaft(ctx, x0, y0, px, py, tailW + 5, headW + 5, neckX, neckY);
  ctx.fillStyle = outline;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x0, y0, (tailW + 5) / 2, 0, Math.PI * 2);
  ctx.fill();
  drawHead(ctx, x1 + ux * 4, y1 + uy * 4, px, py, baseX, baseY, headSpread + 4);
  ctx.fill();
  ctx.fillStyle = fill;
  drawShaft(ctx, x0, y0, px, py, tailW, headW, neckX, neckY);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x0, y0, tailW / 2, 0, Math.PI * 2);
  ctx.fill();
  drawHead(ctx, x1, y1, px, py, baseX, baseY, headSpread);
  ctx.fill();
  const ring = Math.max(8, headW * 0.75);
  ctx.beginPath();
  ctx.arc(x0, y0, ring + 2.5, 0, Math.PI * 2);
  ctx.lineWidth = 7;
  ctx.strokeStyle = outline;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x0, y0, ring, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = fill;
  ctx.stroke();
  const font = Math.max(12, Math.min(Math.min(w, h) * 0.032, 28));
  const clampX = (v) => Math.min(w - font * 2.2, Math.max(font * 2.2, v));
  const clampY = (v) => Math.min(h - font, Math.max(font, v));
  const back = font * 1.5;
  strokeLabel(ctx, '机位', clampX(x0 - ux * back), clampY(y0 - uy * back), font, text, outline);
  strokeLabel(ctx, '拍摄方向', clampX(x1 + ux * back), clampY(y1 + uy * back), font, text, outline);
  const gizmo = Math.max(16, font * 1.35);
  const side = py >= 0 ? -1 : 1;
  const gx = Math.min(w - gizmo * 1.6, Math.max(gizmo * 1.6, x0 + px * side * (ring + gizmo * 1.5)));
  const gy = Math.min(h - gizmo * 1.6, Math.max(gizmo * 1.6, y0 + py * side * (ring + gizmo * 1.5)));
  drawAxesGizmo(ctx, gx, gy, gizmo, fill, outline, text);
}
