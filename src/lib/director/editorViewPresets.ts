import type { Vec3Tuple } from '../../store/useDirectorSceneStore';

/** 小键盘视角：相对目标点的标准机位 */
export type EditorViewPreset = '1' | '3' | '4' | '5' | '7' | '9';

const DIST = 5.5;

export function getEditorViewCameraPosition(preset: EditorViewPreset, target: Vec3Tuple): Vec3Tuple {
  const [tx, ty, tz] = target;
  switch (preset) {
    case '1':
      return [tx, ty, tz + DIST];
    case '5':
      return [tx, ty, tz - DIST];
    case '3':
      return [tx + DIST, ty, tz];
    case '4':
      return [tx - DIST, ty, tz];
    case '7':
      return [tx, ty + DIST, tz];
    case '9':
      return [tx, ty - DIST, tz];
    default:
      return [tx + DIST * 0.7, ty + DIST * 0.5, tz + DIST * 0.7];
  }
}

export function dispatchEditorViewPreset(preset: EditorViewPreset) {
  window.dispatchEvent(new CustomEvent('director-editor-view', { detail: { preset } }));
}
