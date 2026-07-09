import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';

import { uniformScaleTuple } from '../lib/director/gizmoTransform';

import {
  DEFAULT_PROPORTIONS,
  normalizeProportions,
  type ProportionMap,
} from '../lib/director/boneProportions';

import { builtinPoseToSavedPose } from '../lib/director/builtinPosePresets';
import { DIRECTOR_POSE_PRESETS } from '../lib/director/posePresets';
import { DUMMY_GLB_URL } from '../lib/director/skeleton';

import type { BoneRotationsMap } from '../lib/director/skeleton';
import { buildSceneDataPatch } from '../lib/director/buildSceneDataPatch';
import { sampleCameraAtFrame, sampleObjectAtFrame } from '../lib/director/cameraKeyframeInterpolation';
import { normalizeSceneCamera } from '../lib/director/cameraShake';
import type { KeyframeEase } from '../lib/director/keyframeEasing';
import { DEFAULT_BEZIER } from '../lib/director/keyframeEasing';
import {
  bakeSplineToKeyframes,
  createSplineFromPreset,
  type DollySplinePoint,
} from '../lib/director/dollySpline';
import type { SceneData } from '../types';



export type SceneObjectType = 'character' | 'customModel' | 'image';



export type Vec3Tuple = [number, number, number];



export type TransformAxis = 'xyz' | 'x' | 'y' | 'z';



export interface SavedPose {

  id: string;

  name: string;

  boneRotations: BoneRotationsMap;

  proportions: ProportionMap;

}



export interface SceneObject {

  id: string;

  type: SceneObjectType;

  name: string;

  position: Vec3Tuple;

  rotation: Vec3Tuple;

  scale: Vec3Tuple;

  visible: boolean;

  locked: boolean;

  /** character / customModel */

  modelUrl?: string;

  /** character tint */

  color: string;

  boneRotations: Record<string, Vec3Tuple>;

  proportions: ProportionMap;

  /** image plane */

  imageUrl?: string;

}



export interface SceneCamera {

  id: string;

  position: Vec3Tuple;

  rotation: Vec3Tuple;

  scale: Vec3Tuple;

  fov: number;

  visible: boolean;

  locked: boolean;

  /** 播放/录制时在插值位姿上叠加镜头抖动（不写入关键帧） */
  shakeEnabled: boolean;

  /** 抖动强度 0–1 */
  shakeIntensity: number;

}



export interface CameraKeyframe {

  id: string;

  frame: number;

  position: Vec3Tuple;

  rotation: Vec3Tuple;

  fov: number;

  /** 离开本关键帧走向下一关键帧时的缓动 */
  ease?: KeyframeEase;

  /** ease === 'bezier' 时的 cubic-bezier 控制点 */
  easeBezier?: [number, number, number, number];

}



export interface ObjectKeyframe {

  id: string;

  frame: number;

  position: Vec3Tuple;

  rotation: Vec3Tuple;

  scale: Vec3Tuple;

  ease?: KeyframeEase;

  easeBezier?: [number, number, number, number];

  /** 人偶姿势关键帧：骨骼欧拉角（弧度） */
  boneRotations?: Record<string, Vec3Tuple>;

  /** 人偶比例（与姿势一并插值） */
  proportions?: ProportionMap;

}



export const TIMELINE_FPS = 24;

export const TIMELINE_DURATION_SEC = 5;

export const TIMELINE_TOTAL_FRAMES = TIMELINE_FPS * TIMELINE_DURATION_SEC;

/** 时长预设（秒） */
export const TIMELINE_DURATION_PRESETS = [5, 10, 15] as const;



export type DirectorSceneSnapshot = {

  objects: SceneObject[];

  cameras: SceneCamera[];

  savedPoses: SavedPose[];

  showGrid: boolean;

  showGround: boolean;

  cameraKeyframes?: Record<string, CameraKeyframe[]>;

  objectKeyframes?: Record<string, ObjectKeyframe[]>;

  timelineTotalFrames?: number;

  timelineFps?: number;

};



type TransformPatch = {

  position?: Vec3Tuple;

  rotation?: Vec3Tuple;

  scale?: Vec3Tuple;

};



const MAX_HISTORY = 50;



function takeSnapshot(state: DirectorSceneState): DirectorSceneSnapshot {

  return {

    objects: structuredClone(state.objects),

    cameras: structuredClone(state.cameras),

    savedPoses: structuredClone(state.savedPoses),

    showGrid: state.showGrid,

    showGround: state.showGround,

    cameraKeyframes: structuredClone(state.cameraKeyframes),

    objectKeyframes: structuredClone(state.objectKeyframes),

  };

}



type DirectorSceneState = DirectorSceneSnapshot & {

  skeletonBoneNames: string[];

  defaultBonePose: BoneRotationsMap;

  selectedId: string | null;

  selectedCameraId: string | null;

  showCameraGizmo: boolean;

  lockViewToCamera: boolean;

  transformSpace: 'local' | 'world';

  transformAxis: TransformAxis;

  previewOpen: boolean;

  previewMinimized: boolean;

  previewLive: boolean;

  /** 预览窗是否脱离时间轴、浮动在视口上 */
  previewFloating: boolean;

  previewFloatPosition: { x: number; y: number };

  previewFloatSize: { width: number; height: number };

  /** 上次成功测量的 dock 屏幕坐标（避免同步失败时预览消失） */
  previewDockRect: { left: number; top: number; width: number; height: number } | null;

  isGizmoDragging: boolean;

  historyPast: DirectorSceneSnapshot[];

  historyFuture: DirectorSceneSnapshot[];

  /** 连续拖拽（骨骼/比例/FOV）开始前捕获的快照 */
  historyCheckpoint: DirectorSceneSnapshot | null;

  timelineFps: number;

  timelineTotalFrames: number;

  timelineCurrentFrame: number;

  timelineIsPlaying: boolean;

  timelineIsRecording: boolean;

  cameraKeyframes: Record<string, CameraKeyframe[]>;

  objectKeyframes: Record<string, ObjectKeyframe[]>;

  /** 从分镜导入时关联的镜头号（用于运镜回写） */
  linkedStoryboardShot: string | null;

  linkedDirectorNotes: string;

  /** 可编辑运镜样条（世界坐标控制点） */
  dollySplinePoints: DollySplinePoint[];

  dollySplineEditing: boolean;

  selectedSplinePointId: string | null;

  setTimelineCurrentFrame: (frame: number) => void;

  setTimelinePlaying: (playing: boolean) => void;

  setTimelineRecording: (recording: boolean) => void;

  toggleTimelinePlaying: () => void;

  addCameraKeyframe: (cameraId: string) => void;

  addObjectKeyframe: (objectId: string) => void;

  removeCameraKeyframe: (cameraId: string, keyframeId: string) => void;

  removeObjectKeyframe: (objectId: string, keyframeId: string) => void;

  updateCameraKeyframeEase: (
    cameraId: string,
    keyframeId: string,
    ease: KeyframeEase,
    easeBezier?: [number, number, number, number],
  ) => void;

  updateObjectKeyframeEase: (
    objectId: string,
    keyframeId: string,
    ease: KeyframeEase,
    easeBezier?: [number, number, number, number],
  ) => void;

  moveCameraKeyframe: (cameraId: string, keyframeId: string, frame: number) => void;

  moveObjectKeyframe: (objectId: string, keyframeId: string, frame: number) => void;

  setTimelineDurationSec: (seconds: number) => void;

  applyTimelineFrame: (frame: number) => void;

  setShowCameraGizmo: (show: boolean) => void;

  setShowGrid: (show: boolean) => void;

  setShowGround: (show: boolean) => void;

  setLockViewToCamera: (lock: boolean) => void;

  setTransformSpace: (space: 'local' | 'world') => void;

  setTransformAxis: (axis: TransformAxis) => void;

  setPreviewOpen: (open: boolean) => void;

  setPreviewMinimized: (min: boolean) => void;

  setPreviewLive: (live: boolean) => void;

  setPreviewFloating: (floating: boolean) => void;

  setPreviewFloatPosition: (position: { x: number; y: number }) => void;

  setPreviewFloatSize: (size: { width: number; height: number }) => void;

  setPreviewDockRect: (
    rect: { left: number; top: number; width: number; height: number } | null,
  ) => void;

  /** 预览窗弹出到视口（放大可拖动） */
  popOutPreview: (bounds?: { width: number; height: number }) => void;

  dockPreview: () => void;

  setGizmoDragging: (dragging: boolean) => void;

  beginHistoryGesture: () => void;

  commitHistoryGesture: () => void;

  cancelHistoryGesture: () => void;

  undo: () => void;

  redo: () => void;

  getProjectSnapshot: () => DirectorSceneSnapshot;

  loadProjectSnapshot: (snap: DirectorSceneSnapshot) => void;

  toggleObjectVisible: (id: string) => void;

  toggleObjectLocked: (id: string) => void;

  toggleCameraVisible: (id: string) => void;

  toggleCameraLocked: (id: string) => void;

  resetAllBoneRotations: (objectId: string) => void;

  updateCameraFov: (id: string, fov: number) => void;

  updateCameraShake: (
    id: string,
    patch: { shakeEnabled?: boolean; shakeIntensity?: number },
  ) => void;

  addCharacter: () => void;

  addCustomModel: (modelUrl: string, fileName: string) => void;

  addImagePlane: (imageUrl: string, fileName: string) => void;

  /** 从分镜导入参考图平面（可选附带导演备注到名称） */
  importStoryboardShot: (payload: {
    imageUrl: string;
    shotNumber?: string;
    summary?: string;
    directorNotes?: string;
  }) => void;

  clearLinkedStoryboard: () => void;

  /** 将运镜路径预设 Bake 到选中相机关键帧（并进入可编辑样条） */
  bakeDollyPathOnCamera: (
    cameraId: string,
    preset: 'orbit' | 'pushIn' | 'craneUp',
  ) => void;

  beginSplineEditFromPreset: (
    cameraId: string,
    preset: 'orbit' | 'pushIn' | 'craneUp',
  ) => void;

  setDollySplineEditing: (editing: boolean) => void;

  selectSplinePoint: (id: string | null) => void;

  updateSplinePointPosition: (id: string, position: Vec3Tuple) => void;

  addSplinePointAfter: (afterId: string | null) => void;

  removeSplinePoint: (id: string) => void;

  bakeEditableSplineToCamera: (cameraId: string) => void;

  addCamera: () => void;

  removeObject: (id: string) => void;

  removeCamera: (id: string) => void;

  clearSelection: () => void;

  selectObject: (id: string | null) => void;

  selectCamera: (id: string | null) => void;

  registerSkeletonBones: (boneNames: string[], restPose?: BoneRotationsMap) => void;

  setBoneRotation: (objectId: string, boneName: string, axis: 0 | 1 | 2, value: number) => void;

  setObjectColor: (id: string, color: string) => void;

  setObjectProportions: (id: string, proportions: Partial<ProportionMap>) => void;

  updateObjectTransform: (id: string, patch: TransformPatch) => void;

  updateCameraTransform: (id: string, patch: TransformPatch) => void;

  savePoseFromObject: (objectId: string, name?: string) => void;

  applyPose: (poseId: string, objectId: string) => void;

  deletePose: (poseId: string) => void;

  /** LLM 等外部模块：按 SceneData 合并更新相机与人偶（缺省字段保持原状） */
  applySceneData: (data: SceneData) => void;

};



function withHistory(

  set: (fn: (state: DirectorSceneState) => Partial<DirectorSceneState> | DirectorSceneState) => void,

  recipe: (state: DirectorSceneState) => Partial<DirectorSceneState>,

) {

  set((state) => {

    const past = [...state.historyPast, takeSnapshot(state)].slice(-MAX_HISTORY);

    return { ...recipe(state), historyPast: past, historyFuture: [] };

  });

}



function createCharacterObject(

  index: number,

  boneNames: string[],

  bonePose: BoneRotationsMap,

): SceneObject {

  const col = (index % 5) - 2;

  const row = Math.floor(index / 5);

  const boneRotations = Object.keys(bonePose).length > 0 ? { ...bonePose } : {};

  return {

    id: uuidv4(),

    type: 'character',

    name: `人偶 ${index + 1}`,

    position: [col * 2, 0, row * 2],

    rotation: [0, 0, 0],

    scale: [1, 1, 1],

    modelUrl: DUMMY_GLB_URL,

    color: '#7ec8f8',

    boneRotations,

    proportions: { ...DEFAULT_PROPORTIONS },

    visible: true,

    locked: false,

  };

}



function createSceneCamera(index: number): SceneCamera {

  const angle = index * 0.8;

  return {

    id: uuidv4(),

    position: [Math.cos(angle) * 4, 2.5, Math.sin(angle) * 4],

    rotation: [0, angle + Math.PI, 0],

    scale: [1, 1, 1],

    fov: 50,

    visible: true,

    locked: false,

    shakeEnabled: false,

    shakeIntensity: 0.35,

  };

}



function normalizeObject(o: SceneObject): SceneObject {

  return {

    ...o,

    type: o.type ?? 'character',

    name: o.name ?? '对象',

    color: o.color ?? '#7ec8f8',

    boneRotations: o.boneRotations ?? {},

    proportions: normalizeProportions(o.proportions as Partial<ProportionMap> & { leg?: number }),

    visible: o.visible ?? true,

    locked: o.locked ?? false,

  };

}



export const useDirectorSceneStore = create<DirectorSceneState>()((set, get) => ({

  objects: [],

  cameras: [createSceneCamera(0)],

  savedPoses: [],

  skeletonBoneNames: [],

  defaultBonePose: {},

  selectedId: null,

  selectedCameraId: null,

  showCameraGizmo: true,

  showGrid: true,

  showGround: true,

  lockViewToCamera: false,

  transformSpace: 'local',

  transformAxis: 'xyz',

  previewOpen: true,

  previewMinimized: false,

  previewLive: true,

  previewFloating: false,

  previewFloatPosition: { x: 16, y: 16 },

  previewFloatSize: { width: 400, height: 268 },

  previewDockRect: null,

  isGizmoDragging: false,

  historyPast: [],

  historyFuture: [],

  historyCheckpoint: null,

  timelineFps: TIMELINE_FPS,

  timelineTotalFrames: TIMELINE_TOTAL_FRAMES,

  timelineCurrentFrame: 0,

  timelineIsPlaying: false,

  timelineIsRecording: false,

  cameraKeyframes: {},

  objectKeyframes: {},

  linkedStoryboardShot: null,

  linkedDirectorNotes: '',

  dollySplinePoints: [],

  dollySplineEditing: false,

  selectedSplinePointId: null,



  setTimelineCurrentFrame: (frame) =>
    set({
      timelineCurrentFrame: Math.max(0, Math.min(get().timelineTotalFrames, frame)),
    }),

  setTimelinePlaying: (playing) => set({ timelineIsPlaying: playing }),

  setTimelineRecording: (recording) => set({ timelineIsRecording: recording }),

  toggleTimelinePlaying: () => {
    const state = get();
    if (state.timelineIsRecording) return;
    const next = !state.timelineIsPlaying;
    if (next) {
      state.applyTimelineFrame(state.timelineCurrentFrame);
    }
    set({ timelineIsPlaying: next });
  },

  addCameraKeyframe: (cameraId) => {
    const state = get();
    const cam = state.cameras.find((c) => c.id === cameraId);
    if (!cam) return;
    const frame = Math.round(state.timelineCurrentFrame);
    const keyframe: CameraKeyframe = {
      id: uuidv4(),
      frame,
      position: [...cam.position] as Vec3Tuple,
      rotation: [...cam.rotation] as Vec3Tuple,
      fov: cam.fov,
      ease: 'easeInOut',
    };
    const existing = state.cameraKeyframes[cameraId] ?? [];
    const filtered = existing.filter((k) => k.frame !== frame);
    withHistory(set, () => ({
      cameraKeyframes: {
        ...state.cameraKeyframes,
        [cameraId]: [...filtered, keyframe].sort((a, b) => a.frame - b.frame),
      },
    }));
  },

  addObjectKeyframe: (objectId) => {
    const state = get();
    const obj = state.objects.find((o) => o.id === objectId);
    if (!obj) return;
    const frame = Math.round(state.timelineCurrentFrame);
    const keyframe: ObjectKeyframe = {
      id: uuidv4(),
      frame,
      position: [...obj.position] as Vec3Tuple,
      rotation: [...obj.rotation] as Vec3Tuple,
      scale: [...obj.scale] as Vec3Tuple,
      ease: 'easeInOut',
      ...(obj.type === 'character'
        ? {
            boneRotations: structuredClone(obj.boneRotations),
            proportions: { ...obj.proportions },
          }
        : {}),
    };
    const existing = state.objectKeyframes[objectId] ?? [];
    const filtered = existing.filter((k) => k.frame !== frame);
    withHistory(set, () => ({
      objectKeyframes: {
        ...state.objectKeyframes,
        [objectId]: [...filtered, keyframe].sort((a, b) => a.frame - b.frame),
      },
    }));
  },

  removeCameraKeyframe: (cameraId, keyframeId) =>
    withHistory(set, (state) => {
      const list = state.cameraKeyframes[cameraId];
      if (!list?.length) return {};
      return {
        cameraKeyframes: {
          ...state.cameraKeyframes,
          [cameraId]: list.filter((k) => k.id !== keyframeId),
        },
      };
    }),

  removeObjectKeyframe: (objectId, keyframeId) =>
    withHistory(set, (state) => {
      const list = state.objectKeyframes[objectId];
      if (!list?.length) return {};
      return {
        objectKeyframes: {
          ...state.objectKeyframes,
          [objectId]: list.filter((k) => k.id !== keyframeId),
        },
      };
    }),

  updateCameraKeyframeEase: (cameraId, keyframeId, ease, easeBezier) =>
    withHistory(set, (state) => {
      const list = state.cameraKeyframes[cameraId];
      if (!list?.length) return {};
      return {
        cameraKeyframes: {
          ...state.cameraKeyframes,
          [cameraId]: list.map((k) =>
            k.id === keyframeId
              ? {
                  ...k,
                  ease,
                  easeBezier: ease === 'bezier' ? (easeBezier ?? DEFAULT_BEZIER) : undefined,
                }
              : k,
          ),
        },
      };
    }),

  updateObjectKeyframeEase: (objectId, keyframeId, ease, easeBezier) =>
    withHistory(set, (state) => {
      const list = state.objectKeyframes[objectId];
      if (!list?.length) return {};
      return {
        objectKeyframes: {
          ...state.objectKeyframes,
          [objectId]: list.map((k) =>
            k.id === keyframeId
              ? {
                  ...k,
                  ease,
                  easeBezier: ease === 'bezier' ? (easeBezier ?? DEFAULT_BEZIER) : undefined,
                }
              : k,
          ),
        },
      };
    }),

  moveCameraKeyframe: (cameraId, keyframeId, frame) =>
    withHistory(set, (state) => {
      const list = state.cameraKeyframes[cameraId];
      if (!list?.length) return {};
      const target = Math.max(0, Math.min(state.timelineTotalFrames, Math.round(frame)));
      const occupied = new Set(list.filter((k) => k.id !== keyframeId).map((k) => k.frame));
      let nextFrame = target;
      while (occupied.has(nextFrame) && nextFrame < state.timelineTotalFrames) nextFrame += 1;
      if (occupied.has(nextFrame)) {
        nextFrame = target;
        while (occupied.has(nextFrame) && nextFrame > 0) nextFrame -= 1;
      }
      if (occupied.has(nextFrame)) return {};
      return {
        cameraKeyframes: {
          ...state.cameraKeyframes,
          [cameraId]: list
            .map((k) => (k.id === keyframeId ? { ...k, frame: nextFrame } : k))
            .sort((a, b) => a.frame - b.frame),
        },
      };
    }),

  moveObjectKeyframe: (objectId, keyframeId, frame) =>
    withHistory(set, (state) => {
      const list = state.objectKeyframes[objectId];
      if (!list?.length) return {};
      const target = Math.max(0, Math.min(state.timelineTotalFrames, Math.round(frame)));
      const occupied = new Set(list.filter((k) => k.id !== keyframeId).map((k) => k.frame));
      let nextFrame = target;
      while (occupied.has(nextFrame) && nextFrame < state.timelineTotalFrames) nextFrame += 1;
      if (occupied.has(nextFrame)) {
        nextFrame = target;
        while (occupied.has(nextFrame) && nextFrame > 0) nextFrame -= 1;
      }
      if (occupied.has(nextFrame)) return {};
      return {
        objectKeyframes: {
          ...state.objectKeyframes,
          [objectId]: list
            .map((k) => (k.id === keyframeId ? { ...k, frame: nextFrame } : k))
            .sort((a, b) => a.frame - b.frame),
        },
      };
    }),

  setTimelineDurationSec: (seconds) => {
    const sec = Math.max(1, Math.min(60, Math.round(seconds)));
    const fps = get().timelineFps || TIMELINE_FPS;
    const total = sec * fps;
    set((state) => ({
      timelineTotalFrames: total,
      timelineCurrentFrame: Math.min(state.timelineCurrentFrame, total),
      timelineIsPlaying: false,
    }));
  },

  applyTimelineFrame: (frame) =>
    set((state) => {
      let camerasChanged = false;
      let objectsChanged = false;
      const cameras = state.cameras.map((cam) => {
        const kfs = state.cameraKeyframes[cam.id];
        if (!kfs?.length) return cam;
        const sample = sampleCameraAtFrame(kfs, frame);
        if (!sample) return cam;
        camerasChanged = true;
        return {
          ...cam,
          position: sample.position,
          rotation: sample.rotation,
          fov: sample.fov,
        };
      });
      const objects = state.objects.map((obj) => {
        const kfs = state.objectKeyframes[obj.id];
        if (!kfs?.length) return obj;
        const sample = sampleObjectAtFrame(kfs, frame);
        if (!sample) return obj;
        objectsChanged = true;
        return {
          ...obj,
          position: sample.position,
          rotation: sample.rotation,
          scale: sample.scale,
          ...(sample.boneRotations
            ? { boneRotations: sample.boneRotations }
            : {}),
          ...(sample.proportions ? { proportions: sample.proportions } : {}),
        };
      });
      if (!camerasChanged && !objectsChanged) return state;
      return { cameras, objects };
    }),

  setShowCameraGizmo: (show) => set({ showCameraGizmo: show }),

  setShowGrid: (show) => set({ showGrid: show }),

  setShowGround: (show) => set({ showGround: show }),

  setLockViewToCamera: (lock) => set({ lockViewToCamera: lock }),

  setTransformSpace: (space) => set({ transformSpace: space }),

  setTransformAxis: (axis) => set({ transformAxis: axis }),

  setPreviewOpen: (open) =>
    set({
      previewOpen: open,
      previewFloating: false,
    }),

  setPreviewMinimized: (min) => set({ previewMinimized: min }),

  setPreviewLive: (live) => set({ previewLive: live }),

  setPreviewFloating: (floating) =>
    set((state) => ({
      previewFloating: floating,
      previewMinimized: floating ? false : state.previewMinimized,
    })),

  setPreviewFloatPosition: (position) => set({ previewFloatPosition: position }),

  setPreviewFloatSize: (size) => set({ previewFloatSize: size }),

  setPreviewDockRect: (rect) => set({ previewDockRect: rect }),

  popOutPreview: (bounds) =>
    set((state) => {
      const h = state.previewFloatSize.height;
      return {
        previewOpen: true,
        previewFloating: true,
        previewMinimized: false,
        previewFloatPosition: bounds
          ? {
              x: 16,
              y: Math.max(16, Math.round((bounds.height - h) * 0.5)),
            }
          : { x: 16, y: 16 },
      };
    }),

  dockPreview: () =>
    set({ previewFloating: false, previewMinimized: false, previewOpen: true }),
  setGizmoDragging: (dragging) => set({ isGizmoDragging: dragging }),



  beginHistoryGesture: () => {
    const snap = takeSnapshot(get());
    set({ historyCheckpoint: snap });
  },

  commitHistoryGesture: () =>
    set((state) => {
      if (!state.historyCheckpoint) return state;
      const past = [...state.historyPast, state.historyCheckpoint].slice(-MAX_HISTORY);
      return { historyPast: past, historyFuture: [], historyCheckpoint: null };
    }),

  cancelHistoryGesture: () => set({ historyCheckpoint: null }),

  undo: () =>
    set((state) => {
      if (state.historyPast.length === 0) return state;
      const prev = state.historyPast[state.historyPast.length - 1]!;
      const current = takeSnapshot(state);
      return {
        ...state,
        ...prev,
        historyPast: state.historyPast.slice(0, -1),
        historyFuture: [current, ...state.historyFuture],
        historyCheckpoint: null,
      };
    }),

  redo: () =>
    set((state) => {
      if (state.historyFuture.length === 0) return state;
      const next = state.historyFuture[0]!;
      const current = takeSnapshot(state);
      return {
        ...state,
        ...next,
        historyPast: [...state.historyPast, current],
        historyFuture: state.historyFuture.slice(1),
        historyCheckpoint: null,
      };
    }),



  getProjectSnapshot: () => {
    const snap = takeSnapshot(get());
    return {
      ...snap,
      timelineTotalFrames: get().timelineTotalFrames,
      timelineFps: get().timelineFps,
    };
  },



  loadProjectSnapshot: (snap) =>

    set({

      objects: snap.objects.map(normalizeObject),

      cameras: snap.cameras.map(normalizeSceneCamera),

      savedPoses: snap.savedPoses ?? [],

      showGrid: snap.showGrid ?? true,

      showGround: snap.showGround ?? true,

      cameraKeyframes: snap.cameraKeyframes ?? {},

      objectKeyframes: snap.objectKeyframes ?? {},

      timelineTotalFrames: snap.timelineTotalFrames ?? TIMELINE_TOTAL_FRAMES,

      timelineFps: snap.timelineFps ?? TIMELINE_FPS,

      selectedId: null,

      selectedCameraId: snap.cameras[0]?.id ?? null,

      timelineCurrentFrame: 0,

      timelineIsPlaying: false,

      historyPast: [],

      historyFuture: [],

    }),



  toggleObjectVisible: (id) =>

    withHistory(set, (state) => ({

      objects: state.objects.map((o) => (o.id === id ? { ...o, visible: !o.visible } : o)),

    })),



  toggleObjectLocked: (id) =>

    withHistory(set, (state) => ({

      objects: state.objects.map((o) => (o.id === id ? { ...o, locked: !o.locked } : o)),

    })),



  toggleCameraVisible: (id) =>

    withHistory(set, (state) => ({

      cameras: state.cameras.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c)),

    })),



  toggleCameraLocked: (id) =>

    withHistory(set, (state) => ({

      cameras: state.cameras.map((c) => (c.id === id ? { ...c, locked: !c.locked } : c)),

    })),



  resetAllBoneRotations: (objectId) =>

    withHistory(set, (state) => ({

      objects: state.objects.map((o) => {

        if (o.id !== objectId || o.type !== 'character') return o;

        return { ...o, boneRotations: { ...state.defaultBonePose } };

      }),

    })),



  updateCameraFov: (id, fov) =>
    set((state) => ({
      cameras: state.cameras.map((c) =>
        c.id === id ? { ...c, fov: Math.min(120, Math.max(15, fov)) } : c,
      ),
    })),

  updateCameraShake: (id, patch) =>
    set((state) => ({
      cameras: state.cameras.map((c) =>
        c.id === id
          ? normalizeSceneCamera({
              ...c,
              shakeEnabled: patch.shakeEnabled ?? c.shakeEnabled,
              shakeIntensity:
                patch.shakeIntensity === undefined ? c.shakeIntensity : patch.shakeIntensity,
            })
          : c,
      ),
    })),

  addCharacter: () =>

    withHistory(set, (state) => {

      const next = createCharacterObject(

        state.objects.length,

        state.skeletonBoneNames,

        state.defaultBonePose,

      );

      queueMicrotask(() => window.dispatchEvent(new CustomEvent('director-frame-view')));

      return {

        objects: [...state.objects, next],

        selectedId: next.id,

        selectedCameraId: null,

      };

    }),



  addCustomModel: (modelUrl, fileName) =>

    withHistory(set, (state) => {

      const i = state.objects.length;

      const next: SceneObject = {

        id: uuidv4(),

        type: 'customModel',

        name: fileName.replace(/\.[^.]+$/, '') || `模型 ${i + 1}`,

        position: [(i % 5) - 2, 0, Math.floor(i / 5) * 2],

        rotation: [0, 0, 0],

        scale: [1, 1, 1],

        modelUrl,

        color: '#e5e2e1',

        boneRotations: {},

        proportions: { ...DEFAULT_PROPORTIONS },

        visible: true,

        locked: false,

      };

      queueMicrotask(() => window.dispatchEvent(new CustomEvent('director-frame-view')));

      return { objects: [...state.objects, next], selectedId: next.id, selectedCameraId: null };

    }),



  addImagePlane: (imageUrl, fileName) =>

    withHistory(set, (state) => {

      const i = state.objects.length;

      const next: SceneObject = {

        id: uuidv4(),

        type: 'image',

        name: fileName.replace(/\.[^.]+$/, '') || `图片 ${i + 1}`,

        position: [(i % 5) - 2, 1.2, Math.floor(i / 5) * 2],

        rotation: [0, 0, 0],

        scale: [2, 2, 2],

        imageUrl,

        color: '#ffffff',

        boneRotations: {},

        proportions: { ...DEFAULT_PROPORTIONS },

        visible: true,

        locked: false,

      };

      return { objects: [...state.objects, next], selectedId: next.id, selectedCameraId: null };

    }),

  importStoryboardShot: ({ imageUrl, shotNumber, summary, directorNotes }) =>
    withHistory(set, (state) => {
      const i = state.objects.length;
      const labelParts = [
        shotNumber ? `分镜 ${shotNumber}` : null,
        summary?.trim() || null,
      ].filter(Boolean);
      const name =
        labelParts.join(' · ') ||
        (directorNotes?.trim().slice(0, 24) || `分镜参考 ${i + 1}`);
      const next: SceneObject = {
        id: uuidv4(),
        type: 'image',
        name,
        position: [(i % 5) - 2, 1.2, Math.floor(i / 5) * 2],
        rotation: [0, 0, 0],
        scale: [2.4, 2.4, 2.4],
        imageUrl,
        color: '#ffffff',
        boneRotations: {},
        proportions: { ...DEFAULT_PROPORTIONS },
        visible: true,
        locked: false,
      };
      queueMicrotask(() => window.dispatchEvent(new CustomEvent('director-frame-view')));
      return {
        objects: [...state.objects, next],
        selectedId: next.id,
        selectedCameraId: null,
        linkedStoryboardShot: shotNumber ?? state.linkedStoryboardShot,
        linkedDirectorNotes: directorNotes?.trim() || state.linkedDirectorNotes,
      };
    }),

  clearLinkedStoryboard: () =>
    set({ linkedStoryboardShot: null, linkedDirectorNotes: '' }),

  bakeDollyPathOnCamera: (cameraId, preset) =>
    withHistory(set, (state) => {
      const cam = state.cameras.find((c) => c.id === cameraId);
      if (!cam) return {};
      const points = createSplineFromPreset(preset, cam.position, cam.rotation, 5);
      const baked = bakeSplineToKeyframes({
        points,
        totalFrames: state.timelineTotalFrames,
        fov: cam.fov,
        startRotation: cam.rotation,
      });
      return {
        dollySplinePoints: points,
        dollySplineEditing: true,
        selectedSplinePointId: points[0]?.id ?? null,
        cameraKeyframes: {
          ...state.cameraKeyframes,
          [cameraId]: baked,
        },
        timelineCurrentFrame: 0,
        timelineIsPlaying: false,
      };
    }),

  beginSplineEditFromPreset: (cameraId, preset) => {
    get().bakeDollyPathOnCamera(cameraId, preset);
  },

  setDollySplineEditing: (editing) =>
    set({
      dollySplineEditing: editing,
      selectedSplinePointId: editing ? get().selectedSplinePointId : null,
    }),

  selectSplinePoint: (id) => set({ selectedSplinePointId: id, selectedId: null, selectedCameraId: null }),

  updateSplinePointPosition: (id, position) =>
    set((state) => ({
      dollySplinePoints: state.dollySplinePoints.map((p) =>
        p.id === id ? { ...p, position: [...position] as Vec3Tuple } : p,
      ),
    })),

  addSplinePointAfter: (afterId) =>
    withHistory(set, (state) => {
      const pts = state.dollySplinePoints;
      if (pts.length === 0) return {};
      const idx = afterId ? pts.findIndex((p) => p.id === afterId) : pts.length - 1;
      const i = idx < 0 ? pts.length - 1 : idx;
      const a = pts[i]!;
      const b = pts[Math.min(pts.length - 1, i + 1)]!;
      const mid: Vec3Tuple = [
        (a.position[0] + b.position[0]) / 2,
        (a.position[1] + b.position[1]) / 2,
        (a.position[2] + b.position[2]) / 2,
      ];
      const next: DollySplinePoint = { id: uuidv4(), position: mid };
      const list = [...pts];
      list.splice(i + 1, 0, next);
      return { dollySplinePoints: list, selectedSplinePointId: next.id };
    }),

  removeSplinePoint: (id) =>
    withHistory(set, (state) => {
      if (state.dollySplinePoints.length <= 2) return {};
      const list = state.dollySplinePoints.filter((p) => p.id !== id);
      return {
        dollySplinePoints: list,
        selectedSplinePointId:
          state.selectedSplinePointId === id ? list[0]?.id ?? null : state.selectedSplinePointId,
      };
    }),

  bakeEditableSplineToCamera: (cameraId) =>
    withHistory(set, (state) => {
      const cam = state.cameras.find((c) => c.id === cameraId);
      if (!cam || state.dollySplinePoints.length < 2) return {};
      const baked = bakeSplineToKeyframes({
        points: state.dollySplinePoints,
        totalFrames: state.timelineTotalFrames,
        fov: cam.fov,
        startRotation: cam.rotation,
      });
      return {
        cameraKeyframes: {
          ...state.cameraKeyframes,
          [cameraId]: baked,
        },
        timelineCurrentFrame: 0,
        timelineIsPlaying: false,
      };
    }),



  addCamera: () =>

    withHistory(set, (state) => {

      const next = createSceneCamera(state.cameras.length);

      return {

        cameras: [...state.cameras, next],

        selectedCameraId: next.id,

        selectedId: null,

      };

    }),



  removeObject: (id) =>

    withHistory(set, (state) => {

      const objects = state.objects.filter((o) => o.id !== id);

      let selectedId = state.selectedId;

      if (selectedId === id) selectedId = objects.length > 0 ? objects[objects.length - 1]!.id : null;

      const { [id]: _removed, ...objectKeyframes } = state.objectKeyframes;

      return { objects, selectedId, objectKeyframes };

    }),



  removeCamera: (id) =>

    withHistory(set, (state) => {

      const cameras = state.cameras.filter((c) => c.id !== id);

      let selectedCameraId = state.selectedCameraId;

      if (selectedCameraId === id) {

        selectedCameraId = cameras.length > 0 ? cameras[cameras.length - 1]!.id : null;

      }

      const { [id]: _removed, ...cameraKeyframes } = state.cameraKeyframes;

      return { cameras, selectedCameraId, cameraKeyframes };

    }),



  clearSelection: () => set({ selectedId: null, selectedCameraId: null }),



  selectObject: (id) =>

    set((state) => ({

      selectedId: id,

      selectedCameraId: id ? null : state.selectedCameraId,

    })),



  selectCamera: (id) =>

    set((state) => ({

      selectedCameraId: id,

      selectedId: id ? null : state.selectedId,

    })),



  registerSkeletonBones: (boneNames, restPose) =>

    set((state) => {

      if (boneNames.length === 0) return state;

      const names = state.skeletonBoneNames.length > 0 ? state.skeletonBoneNames : boneNames;

      const pose =

        restPose && Object.keys(restPose).length > 0

          ? restPose

          : Object.keys(state.defaultBonePose).length > 0

            ? state.defaultBonePose

            : {};

      const objects = state.objects.map((o) => {

        if (o.type !== 'character') return o;

        return {

          ...o,

          boneRotations:

            Object.keys(o.boneRotations).length > 0

              ? o.boneRotations

              : Object.keys(pose).length > 0

                ? { ...pose }

                : {},

        };

      });

      const builtins = DIRECTOR_POSE_PRESETS.map((id) => builtinPoseToSavedPose(id, pose)).filter(
        (p): p is SavedPose => p != null,
      );
      const savedPoses = [
        ...builtins,
        ...state.savedPoses.filter((p) => !builtins.some((b) => b.id === p.id)),
      ];

      return { skeletonBoneNames: names, defaultBonePose: pose, objects, savedPoses };

    }),



  setBoneRotation: (objectId, boneName, axis, value) =>

    set((state) => ({

      objects: state.objects.map((o) => {

        if (o.id !== objectId || o.type !== 'character') return o;

        const current = o.boneRotations[boneName] ?? [0, 0, 0];

        const next: Vec3Tuple = [current[0], current[1], current[2]];

        next[axis] = value;

        return { ...o, boneRotations: { ...o.boneRotations, [boneName]: next } };

      }),

    })),



  setObjectColor: (id, color) =>

    withHistory(set, (state) => ({

      objects: state.objects.map((o) => (o.id === id ? { ...o, color } : o)),

    })),



  setObjectProportions: (id, proportions) =>
    set((state) => ({
      objects: state.objects.map((o) => {
        if (o.id !== id || o.type !== 'character') return o;
        return { ...o, proportions: normalizeProportions({ ...o.proportions, ...proportions }) };
      }),
    })),



  updateObjectTransform: (id, patch) =>

    withHistory(set, (state) => ({

      objects: state.objects.map((o) => {

        if (o.id !== id) return o;

        return {

          ...o,

          position: patch.position ?? o.position,

          rotation: patch.rotation ?? o.rotation,

          scale: patch.scale ? uniformScaleTuple(patch.scale) : o.scale,

        };

      }),

    })),



  updateCameraTransform: (id, patch) =>

    withHistory(set, (state) => ({

      cameras: state.cameras.map((c) =>

        c.id === id

          ? {

              ...c,

              position: patch.position ?? c.position,

              rotation: patch.rotation ?? c.rotation,

              scale: patch.scale ?? c.scale,

            }

          : c,

      ),

    })),



  savePoseFromObject: (objectId, name) =>

    withHistory(set, (state) => {

      const obj = state.objects.find((o) => o.id === objectId && o.type === 'character');

      if (!obj) return {};

      const pose: SavedPose = {

        id: uuidv4(),

        name: name ?? `姿势 ${state.savedPoses.length + 1}`,

        boneRotations: structuredClone(obj.boneRotations),

        proportions: { ...obj.proportions },

      };

      return { savedPoses: [...state.savedPoses, pose] };

    }),



  applyPose: (poseId, objectId) =>

    withHistory(set, (state) => {

      const pose = state.savedPoses.find((p) => p.id === poseId);

      if (!pose) return {};

      return {

        objects: state.objects.map((o) =>

          o.id === objectId && o.type === 'character'

            ? { ...o, boneRotations: { ...pose.boneRotations }, proportions: { ...pose.proportions } }

            : o,

        ),

      };

    }),



  deletePose: (poseId) =>

    withHistory(set, (state) => ({

      savedPoses: state.savedPoses.filter((p) => p.id !== poseId),

    })),



  applySceneData: (data) =>

    withHistory(set, (state) => {

      const patch = buildSceneDataPatch(

        {

          objects: state.objects,

          cameras: state.cameras,

          savedPoses: state.savedPoses,

          selectedCameraId: state.selectedCameraId,

          defaultBonePose: state.defaultBonePose,

        },

        data,

      );

      return {

        ...(patch.objects ? { objects: patch.objects } : {}),

        ...(patch.cameras ? { cameras: patch.cameras } : {}),

      };

    }),

}));



export function getSelectedSceneObject(state: DirectorSceneState): SceneObject | null {

  if (!state.selectedId) return null;

  return state.objects.find((o) => o.id === state.selectedId) ?? null;

}



export function getSelectedSceneCamera(state: DirectorSceneState): SceneCamera | null {

  if (!state.selectedCameraId) return null;

  return state.cameras.find((c) => c.id === state.selectedCameraId) ?? null;

}



export function getPreviewSceneCamera(state: DirectorSceneState): SceneCamera | null {

  const selected = getSelectedSceneCamera(state);

  if (selected) return selected;

  return state.cameras[0] ?? null;

}



export function hasTransformSelection(state: DirectorSceneState): boolean {

  return Boolean(state.selectedId || state.selectedCameraId);

}



/** @deprecated 使用 beginHistoryGesture / commitHistoryGesture */
export function commitDirectorHistory() {
  useDirectorSceneStore.getState().commitHistoryGesture();
}


