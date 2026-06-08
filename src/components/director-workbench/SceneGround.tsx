/** 场景地面平面（与网格独立开关） */
export function SceneGround() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
      <planeGeometry args={[24, 24]} />
      <meshStandardMaterial color="#141414" roughness={0.92} metalness={0.05} />
    </mesh>
  );
}
