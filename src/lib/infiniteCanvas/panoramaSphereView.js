/**
 * 360° 等距柱状全景：球体内相机看图。
 * 拖=偏航/俯仰，滚轮改 FOV，截图走 preserveDrawingBuffer。
 */
import * as THREE from 'three';

export const PANO_FOV_DEFAULT = 75;
export const PANO_FOV_MIN = 40;
export const PANO_FOV_MAX = 100;
export const PANO_PITCH_MAX = 85;
/** 节点内「全景预览」观察画幅（整图仍按生成比例，默认 21:9） */
export const PANO_PREVIEW_ASPECT = '16:9';
const YAW_PER_PX = 0.18;
const PITCH_PER_PX = 0.16;
const FOV_STEP = 1.06;

export function panoAspectToCss(key) {
  const [a, b] = String(key || '').split(':').map(Number);
  if (a > 0 && b > 0) return `${a} / ${b}`;
  return '21 / 9';
}

export function clampPanoCamera(raw = {}) {
  const yaw = Number(raw.yaw);
  const pitch = Number(raw.pitch);
  const fov = Number(raw.fov);
  return {
    yaw: Number.isFinite(yaw) ? yaw : 0,
    pitch: Math.max(-PANO_PITCH_MAX, Math.min(PANO_PITCH_MAX, Number.isFinite(pitch) ? pitch : 0)),
    fov: Math.max(PANO_FOV_MIN, Math.min(PANO_FOV_MAX, Number.isFinite(fov) ? fov : PANO_FOV_DEFAULT)),
  };
}

export function createPanoramaView(container, opts = {}) {
  if (!container) throw new Error('panorama viewport missing');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const el = renderer.domElement;
  el.className = 'pano-sphere-canvas';
  el.tabIndex = 0;
  container.appendChild(el);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0e0e0e);
  const cam = new THREE.PerspectiveCamera(PANO_FOV_DEFAULT, 1, 0.1, 2000);
  cam.rotation.order = 'YXZ';
  let state = clampPanoCamera(opts.camera);

  const geom = new THREE.SphereGeometry(500, 64, 40);
  geom.scale(-1, 1, 1);
  const mat = new THREE.MeshBasicMaterial({ color: 0x1c1b1b });
  const mesh = new THREE.Mesh(geom, mat);
  scene.add(mesh);

  const loader = new THREE.TextureLoader();
  if (opts.crossOrigin) loader.setCrossOrigin('anonymous');
  let texture = null;
  if (opts.url) {
    texture = loader.load(String(opts.url), () => render());
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy?.() || 1);
    mat.map = texture;
    mat.color.set(0xffffff);
    mat.needsUpdate = true;
  }

  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let disposed = false;

  function applyCamera() {
    cam.fov = state.fov;
    cam.rotation.y = THREE.MathUtils.degToRad(state.yaw);
    cam.rotation.x = THREE.MathUtils.degToRad(state.pitch);
    cam.updateProjectionMatrix();
  }

  function render() {
    if (disposed) return;
    applyCamera();
    renderer.render(scene, cam);
  }

  function resize() {
    if (disposed) return;
    const w = Math.max(16, container.clientWidth || 1);
    const h = Math.max(16, container.clientHeight || 1);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    render();
  }

  function emitChange() {
    opts.onChange?.(getCamera());
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    el.setPointerCapture?.(e.pointerId);
    el.classList.add('is-dragging');
    opts.onInteractStart?.(e);
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    state = clampPanoCamera({
      yaw: state.yaw + dx * YAW_PER_PX,
      pitch: state.pitch + dy * PITCH_PER_PX,
      fov: state.fov,
    });
    render();
    emitChange();
  }

  function onPointerUp(e) {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('is-dragging');
    try { el.releasePointerCapture?.(e.pointerId); } catch (_) { /* ignore */ }
  }

  function onWheel(e) {
    e.preventDefault();
    e.stopPropagation();
    const next = e.deltaY > 0 ? state.fov * FOV_STEP : state.fov / FOV_STEP;
    state = clampPanoCamera({ ...state, fov: next });
    render();
    emitChange();
  }

  function onDblClick(e) {
    e.preventDefault();
    e.stopPropagation();
    opts.onDblClick?.(e);
  }

  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('dblclick', onDblClick);

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);

  function getCamera() {
    return clampPanoCamera(state);
  }

  function setCamera(next) {
    state = clampPanoCamera({ ...state, ...next });
    render();
  }

  function reset() {
    state = clampPanoCamera({ yaw: 0, pitch: 0, fov: PANO_FOV_DEFAULT });
    render();
    emitChange();
  }

  function attach(nextContainer) {
    if (!nextContainer || nextContainer === container) {
      resize();
      return;
    }
    ro.disconnect();
    container = nextContainer;
    nextContainer.appendChild(el);
    ro.observe(container);
    resize();
  }

  async function captureStill(capOpts = {}) {
    if (disposed) throw new Error('panorama disposed');
    const w = Math.max(16, Math.round(Number(capOpts.width) || el.width || 1));
    const h = Math.max(16, Math.round(Number(capOpts.height) || el.height || 1));
    renderer.setPixelRatio(1);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    applyCamera();
    renderer.render(scene, cam);
    try {
      const dataUrl = el.toDataURL('image/jpeg', 0.92);
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      if (!blob?.size) throw new Error('panorama capture empty');
      return blob;
    } finally {
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      resize();
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    ro.disconnect();
    el.removeEventListener('pointerdown', onPointerDown);
    el.removeEventListener('pointermove', onPointerMove);
    el.removeEventListener('pointerup', onPointerUp);
    el.removeEventListener('pointercancel', onPointerUp);
    el.removeEventListener('wheel', onWheel);
    el.removeEventListener('dblclick', onDblClick);
    texture?.dispose();
    geom.dispose();
    mat.dispose();
    renderer.dispose();
    el.remove();
  }

  applyCamera();
  resize();
  return { el, getCamera, setCamera, reset, attach, captureStill, resize, dispose, render };
}
