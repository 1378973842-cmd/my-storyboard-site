import { useLayoutEffect, useMemo, useRef } from 'react';
import { Line, TransformControls } from '@react-three/drei';
import type { Mesh } from 'three';
import { densifySplineLine } from '../../lib/director/dollySpline';
import type { DollySplinePoint } from '../../lib/director/dollySpline';
import {
  useDirectorSceneStore,
  type Vec3Tuple,
} from '../../store/useDirectorSceneStore';

function SplinePointHandle({
  point,
  selected,
  onSelect,
  onMove,
  onDragging,
}: {
  point: DollySplinePoint;
  selected: boolean;
  onSelect: () => void;
  onMove: (pos: Vec3Tuple) => void;
  onDragging: (dragging: boolean) => void;
}) {
  const meshRef = useRef<Mesh>(null);

  useLayoutEffect(() => {
    const m = meshRef.current;
    if (!m) return;
    m.position.set(point.position[0], point.position[1], point.position[2]);
  }, [point.position]);

  return (
    <>
      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <sphereGeometry args={[0.12, 16, 16]} />
        <meshStandardMaterial
          color={selected ? '#ffb866' : '#4ade80'}
          emissive={selected ? '#ffb866' : '#4ade80'}
          emissiveIntensity={selected ? 0.55 : 0.25}
          roughness={0.4}
        />
      </mesh>
      {selected && (
        <TransformControls
          object={meshRef}
          mode="translate"
          size={0.75}
          onMouseDown={() => onDragging(true)}
          onMouseUp={() => {
            const m = meshRef.current;
            if (m) onMove([m.position.x, m.position.y, m.position.z]);
            onDragging(false);
          }}
        />
      )}
    </>
  );
}

/** 3D 可编辑运镜样条：控制点 + 曲线预览 */
export function DirectorDollySplineEditor({
  onTransformDragging,
}: {
  onTransformDragging: (dragging: boolean) => void;
}) {
  const editing = useDirectorSceneStore((s) => s.dollySplineEditing);
  const points = useDirectorSceneStore((s) => s.dollySplinePoints);
  const selectedId = useDirectorSceneStore((s) => s.selectedSplinePointId);
  const selectSplinePoint = useDirectorSceneStore((s) => s.selectSplinePoint);
  const updateSplinePointPosition = useDirectorSceneStore((s) => s.updateSplinePointPosition);
  const timelineIsPlaying = useDirectorSceneStore((s) => s.timelineIsPlaying);
  const timelineIsRecording = useDirectorSceneStore((s) => s.timelineIsRecording);

  const linePoints = useMemo(() => {
    if (points.length < 2) return null;
    const arr = densifySplineLine(
      points.map((p) => p.position),
      64,
    );
    const out: [number, number, number][] = [];
    for (let i = 0; i < arr.length; i += 3) {
      out.push([arr[i]!, arr[i + 1]!, arr[i + 2]!]);
    }
    return out;
  }, [points]);

  if (!editing || points.length < 2 || timelineIsPlaying || timelineIsRecording) return null;

  return (
    <group>
      {linePoints && (
        <Line points={linePoints} color="#ffb866" lineWidth={2} transparent opacity={0.9} />
      )}
      {points.map((p) => (
        <SplinePointHandle
          key={p.id}
          point={p}
          selected={selectedId === p.id}
          onSelect={() => selectSplinePoint(p.id)}
          onMove={(pos) => updateSplinePointPosition(p.id, pos)}
          onDragging={onTransformDragging}
        />
      ))}
    </group>
  );
}
