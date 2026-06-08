import { useMemo } from 'react';
import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';

const BODY = 0.22;
const FRUSTUM_DEPTH = 2.4;
const ASPECT = 16 / 10;

type Props = {
  fov: number;
  selected?: boolean;
};

/** 图1风格：浅蓝机身 + 绿色线框视锥（沿 -Z 为镜头朝向） */
export function DirectorCameraGizmo({ fov, selected }: Props) {
  const frustumGeometry = useMemo(() => {
    const fovRad = (fov * Math.PI) / 180;
    const tan = Math.tan(fovRad / 2);
    const far = FRUSTUM_DEPTH;
    const fh = far * tan;
    const fw = fh * ASPECT;

    const apex = new Vector3(0, 0, 0);
    const fl = new Vector3(-fw, fh, -far);
    const fr = new Vector3(fw, fh, -far);
    const br = new Vector3(fw, -fh, -far);
    const bl = new Vector3(-fw, -fh, -far);

    const pairs = [
      apex, fl, apex, fr, apex, br, apex, bl,
      fl, fr, fr, br, br, bl, bl, fl,
    ];
    const verts: number[] = [];
    for (const p of pairs) verts.push(p.x, p.y, p.z);

    const geom = new BufferGeometry();
    geom.setAttribute('position', new Float32BufferAttribute(verts, 3));
    return geom;
  }, [fov]);

  return (
    <group>
      <mesh>
        <boxGeometry args={[BODY, BODY, BODY * 0.85]} />
        <meshStandardMaterial
          color="#8dcdff"
          metalness={0.15}
          roughness={0.35}
          emissive="#5ba3d9"
          emissiveIntensity={selected ? 0.45 : 0.22}
        />
      </mesh>
      <lineSegments
        geometry={frustumGeometry}
        ref={(m) => {
          if (m) m.raycast = () => undefined;
        }}
      >
        <lineBasicMaterial color="#4ade80" transparent opacity={0.95} />
      </lineSegments>
      {/* 扩大点击区域，便于选中与拖 Gizmo */}
      <mesh visible={false}>
        <sphereGeometry args={[0.55, 12, 12]} />
        <meshBasicMaterial />
      </mesh>
    </group>
  );
}
