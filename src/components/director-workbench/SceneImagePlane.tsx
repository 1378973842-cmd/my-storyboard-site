import { useTexture } from '@react-three/drei';
import { DoubleSide } from 'three';
import type { SceneObject } from '../../store/useDirectorSceneStore';

type Props = {
  object: SceneObject;
};

export function SceneImagePlane({ object }: Props) {
  const url = object.imageUrl;
  if (!url) return null;

  const texture = useTexture(url);
  const aspect = texture.image
    ? (texture.image as HTMLImageElement).width / Math.max((texture.image as HTMLImageElement).height, 1)
    : 1;

  return (
    <mesh>
      <planeGeometry args={[aspect, 1]} />
      <meshStandardMaterial map={texture} side={DoubleSide} transparent />
    </mesh>
  );
}
