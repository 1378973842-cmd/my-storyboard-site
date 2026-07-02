import { Grid } from '@react-three/drei';

/** 随相机延伸的无限网格（替代有限 gridHelper） */
export function DirectorInfiniteGrid() {
  return (
    <Grid
      infiniteGrid
      followCamera
      args={[10, 10]}
      cellSize={1}
      sectionSize={5}
      cellColor="#2a2a2a"
      sectionColor="#45464d"
      cellThickness={0.55}
      sectionThickness={1}
      fadeDistance={120}
      fadeStrength={1.25}
      position={[0, 0, 0]}
    />
  );
}
