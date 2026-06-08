import { Color, type Group, type Mesh, type MeshStandardMaterial, type Texture } from 'three';

/** 每人偶/模型实例独立材质，避免 SkeletonUtils.clone 后仍共享 GLTF 材质 */
export function isolateMeshMaterials(root: Group) {
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map((m) => m.clone());
    } else {
      mesh.material = mesh.material.clone();
    }
  });
}

/**
 * 将模型染成与选项一致的颜色（所见即所选）。
 * GLTF 漫反射贴图会乘在 color 上，故着色时暂关贴图，避免发灰/偏色。
 */
export function applyMaterialTint(root: Group, hex: string) {
  const target = new Color(hex);
  root.traverse((child) => {
    const mesh = child as Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach((mat) => {
      const m = mat as MeshStandardMaterial;
      if (!m.color) return;

      if (m.map && !m.userData.tintStripped) {
        m.userData.tintStripped = true;
        m.userData.originalMap = m.map as Texture;
        m.map = null;
      }

      m.color.copy(target);
      m.emissive.copy(target).multiplyScalar(0.08);
      m.emissiveIntensity = 1;
      m.metalness = Math.min(m.metalness, 0.15);
      m.roughness = Math.max(m.roughness, 0.45);
      m.needsUpdate = true;
    });
  });
}
