import { useFrame } from '@react-three/fiber';
import { useRef } from 'react';
import type { Mesh } from 'three';

const GROUND_SIZE = 2048;

/** 大地面平面（配合无限网格，避免看到硬边界） */
export function SceneGround() {
  const meshRef = useRef<Mesh>(null);

  useFrame(({ camera }) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.position.x = camera.position.x;
    mesh.position.z = camera.position.z;
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[GROUND_SIZE, GROUND_SIZE]} />
      <meshStandardMaterial color="#141414" roughness={0.92} metalness={0.05} />
    </mesh>
  );
}
