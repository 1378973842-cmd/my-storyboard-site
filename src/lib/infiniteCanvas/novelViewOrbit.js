/**
 * 新视角·3D机位：yaw/pitch/distance/focal → 数值视角指令。
 * 预览是假透视（图当立板），提交仍走 2D i2i；光圈不绑几何。
 */

export const NOVEL_VIEW_ORBIT_YAW_MIN = -180;
export const NOVEL_VIEW_ORBIT_YAW_MAX = 180;
export const NOVEL_VIEW_ORBIT_PITCH_MIN = -60;
export const NOVEL_VIEW_ORBIT_PITCH_MAX = 60;
export const NOVEL_VIEW_ORBIT_DIST_MIN = 0.5;
export const NOVEL_VIEW_ORBIT_DIST_MAX = 2.5;
export const NOVEL_VIEW_ORBIT_FOCAL_MIN = 16;
export const NOVEL_VIEW_ORBIT_FOCAL_MAX = 200;
export const NOVEL_VIEW_ORBIT_DEFAULT = Object.freeze({
  yaw: 0,
  pitch: 0,
  distance: 1,
  focalMm: 50,
});
export const NOVEL_VIEW_ORBIT_CAPTURE_MAX_EDGE = 1536;

export function orbitCaptureSize(srcW, srcH) {
  const w = Math.max(1, Number(srcW) || 1);
  const h = Math.max(1, Number(srcH) || 1);
  const scale = Math.min(1, NOVEL_VIEW_ORBIT_CAPTURE_MAX_EDGE / Math.max(w, h));
  return {
    width: Math.max(16, Math.round(w * scale)),
    height: Math.max(16, Math.round(h * scale)),
  };
}

function clamp(n, lo, hi, fallback) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.min(hi, Math.max(lo, v));
}

export function clampOrbitCamera(cam = {}) {
  return {
    yaw: clamp(cam.yaw, NOVEL_VIEW_ORBIT_YAW_MIN, NOVEL_VIEW_ORBIT_YAW_MAX, 0),
    pitch: clamp(cam.pitch, NOVEL_VIEW_ORBIT_PITCH_MIN, NOVEL_VIEW_ORBIT_PITCH_MAX, 0),
    distance: clamp(cam.distance, NOVEL_VIEW_ORBIT_DIST_MIN, NOVEL_VIEW_ORBIT_DIST_MAX, 1),
    focalMm: Math.round(clamp(cam.focalMm, NOVEL_VIEW_ORBIT_FOCAL_MIN, NOVEL_VIEW_ORBIT_FOCAL_MAX, 50)),
  };
}

/** 35mm 画幅竖边 24mm → 垂直 FOV（度） */
export function verticalFovDeg(focalMm) {
  const f = clamp(focalMm, NOVEL_VIEW_ORBIT_FOCAL_MIN, NOVEL_VIEW_ORBIT_FOCAL_MAX, 50);
  return (2 * Math.atan(24 / (2 * f)) * 180) / Math.PI;
}

/** 平面高=1 时，distance 倍率 1 刚好竖向装满画幅 */
export function fitDistanceForFocal(focalMm) {
  const fov = (verticalFovDeg(focalMm) * Math.PI) / 180;
  return 0.5 / Math.tan(fov / 2);
}

/**
 * yaw=0 pitch=0 → +Z 正对平面正面。
 * 正 yaw = 相机绕到主体右侧；正 pitch = 相机上移俯拍。
 */
export function orbitCameraPosition(yawDeg, pitchDeg, worldDistance) {
  const yaw = (Number(yawDeg) || 0) * (Math.PI / 180);
  const pitch = (Number(pitchDeg) || 0) * (Math.PI / 180);
  const d = Number(worldDistance);
  const dist = Number.isFinite(d) && d > 0 ? d : 1;
  const cp = Math.cos(pitch);
  return {
    x: dist * Math.sin(yaw) * cp,
    y: dist * Math.sin(pitch),
    z: dist * Math.cos(yaw) * cp,
  };
}

function yawPhrase(yaw) {
  const a = Math.abs(Math.round(yaw));
  if (a < 1) return '水平朝向保持原机位';
  return yaw > 0 ? `摄像机绕主体向右旋转 ${a}°` : `摄像机绕主体向左旋转 ${a}°`;
}

function pitchPhrase(pitch) {
  const a = Math.abs(Math.round(pitch));
  if (a < 1) return '高度保持原机位';
  return pitch > 0 ? `从上方俯 ${a}°` : `从下方仰 ${a}°`;
}

function distPhrase(distance) {
  const t = Math.round(Number(distance) * 100) / 100;
  if (Math.abs(t - 1) < 0.03) return '距离保持原机位';
  if (t < 1) return `距离拉近到 ${t} 倍`;
  return `距离拉远到 ${t} 倍`;
}

function focalKind(mm) {
  if (mm <= 35) return '广角';
  if (mm >= 85) return '长焦';
  return '标准';
}

export function buildNovelViewOrbitPrompt(cam) {
  const c = clampOrbitCamera(cam);
  return [
    '共两张参考图：第一张是原图，必须保持人物与物体的身份、服装、材质、光线和氛围；第二张是目标机位预览，必须严格跟随它的构图、透视、主体占比和远近关系来画这一帧。',
    `相对原图重新构图：${yawPhrase(c.yaw)}，${pitchPhrase(c.pitch)}，${distPhrase(c.distance)}，使用 ${c.focalMm}mm ${focalKind(c.focalMm)}镜头。`,
    '按新机位补全被遮挡与未见侧面。不要复制预览里的纸片拉伸、网格、锯齿或控件。不要在画面中出现控件、网格、文字或箭头。',
  ].join('');
}

export function orbitHudChips(cam, en = false) {
  const c = clampOrbitCamera(cam);
  const yawAbs = Math.abs(Math.round(c.yaw));
  const pitchAbs = Math.abs(Math.round(c.pitch));
  const dist = Math.round(c.distance * 100) / 100;
  const yawChip = yawAbs < 1
    ? (en ? 'Yaw · original' : '水平 · 原位')
    : (en
      ? `Yaw ${c.yaw > 0 ? 'right' : 'left'} ${yawAbs}°`
      : `水平 · ${c.yaw > 0 ? '右' : '左'} ${yawAbs}°`);
  const pitchChip = pitchAbs < 1
    ? (en ? 'Pitch · original' : '高度 · 原位')
    : (en
      ? `${c.pitch > 0 ? 'Down' : 'Up'} ${pitchAbs}°`
      : `${c.pitch > 0 ? '俯' : '仰'} ${pitchAbs}°`);
  const distChip = Math.abs(dist - 1) < 0.03
    ? (en ? 'Distance · original' : '距离 · 原位')
    : (en ? `Distance ${dist}×` : `距离 ${dist}×`);
  return [
    yawChip,
    pitchChip,
    distChip,
    `${en ? 'Focal' : '焦段'} ${c.focalMm}mm`,
  ];
}
