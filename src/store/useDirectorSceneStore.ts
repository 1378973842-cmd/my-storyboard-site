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

}



export type DirectorSceneSnapshot = {

  objects: SceneObject[];

  cameras: SceneCamera[];

  savedPoses: SavedPose[];

  showGrid: boolean;

  showGround: boolean;

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

  isGizmoDragging: boolean;

  historyPast: DirectorSceneSnapshot[];

  historyFuture: DirectorSceneSnapshot[];

  /** 连续拖拽（骨骼/比例/FOV）开始前捕获的快照 */
  historyCheckpoint: DirectorSceneSnapshot | null;

  setShowCameraGizmo: (show: boolean) => void;

  setShowGrid: (show: boolean) => void;

  setShowGround: (show: boolean) => void;

  setLockViewToCamera: (lock: boolean) => void;

  setTransformSpace: (space: 'local' | 'world') => void;

  setTransformAxis: (axis: TransformAxis) => void;

  setPreviewOpen: (open: boolean) => void;

  setPreviewMinimized: (min: boolean) => void;

  setPreviewLive: (live: boolean) => void;

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

  addCharacter: () => void;

  addCustomModel: (modelUrl: string, fileName: string) => void;

  addImagePlane: (imageUrl: string, fileName: string) => void;

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

  isGizmoDragging: false,

  historyPast: [],

  historyFuture: [],

  historyCheckpoint: null,



  setShowCameraGizmo: (show) => set({ showCameraGizmo: show }),

  setShowGrid: (show) => set({ showGrid: show }),

  setShowGround: (show) => set({ showGround: show }),

  setLockViewToCamera: (lock) => set({ lockViewToCamera: lock }),

  setTransformSpace: (space) => set({ transformSpace: space }),

  setTransformAxis: (axis) => set({ transformAxis: axis }),

  setPreviewOpen: (open) => set({ previewOpen: open }),

  setPreviewMinimized: (min) => set({ previewMinimized: min }),

  setPreviewLive: (live) => set({ previewLive: live }),
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



  getProjectSnapshot: () => takeSnapshot(get()),



  loadProjectSnapshot: (snap) =>

    set({

      objects: snap.objects.map(normalizeObject),

      cameras: snap.cameras,

      savedPoses: snap.savedPoses ?? [],

      showGrid: snap.showGrid ?? true,

      showGround: snap.showGround ?? true,

      selectedId: null,

      selectedCameraId: snap.cameras[0]?.id ?? null,

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

      return { objects, selectedId };

    }),



  removeCamera: (id) =>

    withHistory(set, (state) => {

      const cameras = state.cameras.filter((c) => c.id !== id);

      let selectedCameraId = state.selectedCameraId;

      if (selectedCameraId === id) {

        selectedCameraId = cameras.length > 0 ? cameras[cameras.length - 1]!.id : null;

      }

      return { cameras, selectedCameraId };

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


