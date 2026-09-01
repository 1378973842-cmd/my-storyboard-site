/**
 * 新视角·3D机位预览：深度立板 + 透视相机绕转。
 * 焦段改 FOV，推拉按 50mm 基准距离，避免调焦段画面不变。
 * 不把控件烙进提交图。
 */
import * as THREE from 'three';
import {
  clampOrbitCamera,
  fitDistanceForFocal,
  orbitCameraPosition,
  verticalFovDeg,
  NOVEL_VIEW_ORBIT_DEFAULT,
  NOVEL_VIEW_ORBIT_DIST_MAX,
  NOVEL_VIEW_ORBIT_DIST_MIN,
  NOVEL_VIEW_ORBIT_PITCH_MAX,
  NOVEL_VIEW_ORBIT_PITCH_MIN,
  NOVEL_VIEW_ORBIT_YAW_MAX,
  NOVEL_VIEW_ORBIT_YAW_MIN,
} from './novelViewOrbit.js';
import {
  NOVEL_VIEW_DEPTH_MESH_SEG,
  applyDepthToPositions,
  clampDepthStrength,
} from './novelViewDepth.js';

const BG = 0x0e0e0e;
const GRID_A = 0x2a2a2c;
const GRID_B = 0x1a1a1c;
const YAW_PER_PX = 0.35;
const PITCH_PER_PX = 0.28;
const DOLLY_STEP = 1.06;

export function createNovelViewOrbitView(container, opts = {}) {
  if (!container) throw new Error('orbit viewport missing');
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BG);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.domElement.className = 'image-novel-orbit-canvas';
  renderer.domElement.tabIndex = 0;
  container.appendChild(renderer.domElement);

  const cam = new THREE.PerspectiveCamera(50, 1, 0.05, 40);
  let state = clampOrbitCamera(opts.camera);
  const aspect = Math.max(0.2, Number(opts.aspect) || 1);
  const planeH = 1;
  const planeW = planeH * aspect;
  let depthMap = null;
  let depthStrength = clampDepthStrength(opts.depthStrength);
  let pivotZ = 0;

  const geom = new THREE.PlaneGeometry(planeW, planeH, NOVEL_VIEW_DEPTH_MESH_SEG, NOVEL_VIEW_DEPTH_MESH_SEG);
  const mat = new THREE.MeshBasicMaterial({ color: 0x1c1b1b, side: THREE.FrontSide });
  const mesh = new THREE.Mesh(geom, mat);
  scene.add(mesh);

  const grid = new THREE.GridHelper(4, 8, GRID_A, GRID_B);
  grid.position.y = -planeH / 2 - 0.04;
  scene.add(grid);

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

  function applyDepth() {
    const pos = geom.attributes.position;
    const uv = geom.attributes.uv;
    if (!pos || !uv) return;
    if (!depthMap) {
      for (let i = 0; i < pos.count; i++) pos.setZ(i, 0);
      pos.needsUpdate = true;
      pivotZ = 0;
      return;
    }
    pivotZ = applyDepthToPositions(pos.array, uv.array, planeW, planeH, {
      data: depthMap.data,
      width: depthMap.width,
      height: depthMap.height,
      strength: depthStrength,
    });
    pos.needsUpdate = true;
    geom.computeVertexNormals();
  }

  function applyCamera() {
    cam.fov = verticalFovDeg(state.focalMm);
    cam.updateProjectionMatrix();
    const worldD = fitDistanceForFocal(NOVEL_VIEW_ORBIT_DEFAULT.focalMm) * state.distance;
    const p = orbitCameraPosition(state.yaw, state.pitch, worldD);
    cam.position.set(p.x, p.y, p.z + pivotZ);
    cam.lookAt(0, 0, pivotZ);
  }

  function render() {
    if (disposed) return;
    applyCamera();
    renderer.render(scene, cam);
  }

  function resize() {
    if (disposed) return;
    const w = Math.max(1, container.clientWidth || 1);
    const h = Math.max(1, container.clientHeight || 1);
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    render();
  }

  function emit() {
    opts.onChange?.(getCamera());
  }

  function onPointerDown(e) {
    if (e.button !== 0 || disposed) return;
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    container.classList.add('is-dragging');
    e.currentTarget?.setPointerCapture?.(e.pointerId);
    e.preventDefault();
    e.stopPropagation();
  }

  function onPointerMove(e) {
    if (!dragging || disposed) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    state.yaw = Math.min(NOVEL_VIEW_ORBIT_YAW_MAX, Math.max(NOVEL_VIEW_ORBIT_YAW_MIN, state.yaw - dx * YAW_PER_PX));
    state.pitch = Math.min(NOVEL_VIEW_ORBIT_PITCH_MAX, Math.max(NOVEL_VIEW_ORBIT_PITCH_MIN, state.pitch - dy * PITCH_PER_PX));
    render();
    emit();
    e.preventDefault();
  }

  function onPointerUp() {
    dragging = false;
    container.classList.remove('is-dragging');
  }

  function onWheel(e) {
    if (disposed) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = e.deltaY > 0 ? DOLLY_STEP : 1 / DOLLY_STEP;
    state.distance = Math.min(NOVEL_VIEW_ORBIT_DIST_MAX, Math.max(NOVEL_VIEW_ORBIT_DIST_MIN, state.distance * dir));
    render();
    emit();
  }

  function onDblClick(e) {
    e.preventDefault();
    e.stopPropagation();
    state = clampOrbitCamera({ yaw: 0, pitch: 0, distance: 1, focalMm: state.focalMm });
    render();
    emit();
  }

  const el = renderer.domElement;
  el.addEventListener('pointerdown', onPointerDown);
  el.addEventListener('pointermove', onPointerMove);
  el.addEventListener('pointerup', onPointerUp);
  el.addEventListener('pointercancel', onPointerUp);
  el.addEventListener('wheel', onWheel, { passive: false });
  el.addEventListener('dblclick', onDblClick);

  const ro = new ResizeObserver(() => resize());
  ro.observe(container);

  function getCamera() {
    return clampOrbitCamera(state);
  }

  function setCamera(next) {
    state = clampOrbitCamera({ ...state, ...next });
    render();
  }

  function setDepth(next) {
    depthMap = next && next.data && next.width && next.height ? next : null;
    applyDepth();
    render();
  }

  function setDepthStrength(next) {
    depthStrength = clampDepthStrength(next);
    applyDepth();
    render();
  }

  async function captureStill(opts = {}) {
    if (disposed) throw new Error('orbit disposed');
    const w = Math.max(16, Math.round(Number(opts.width) || renderer.domElement.width || 1));
    const h = Math.max(16, Math.round(Number(opts.height) || renderer.domElement.height || 1));
    const prevGrid = grid.visible;
    grid.visible = false;
    try {
      renderer.setPixelRatio(1);
      renderer.setSize(w, h, false);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
      applyCamera();
      renderer.render(scene, cam);
      const dataUrl = renderer.domElement.toDataURL('image/jpeg', 0.92);
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      if (!blob?.size) throw new Error('orbit capture empty');
      return blob;
    } finally {
      grid.visible = prevGrid;
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

  resize();
  return { getCamera, setCamera, setDepth, setDepthStrength, captureStill, resize, dispose, render };
}
