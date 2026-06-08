import { Suspense } from 'react';
import type { SceneObject } from '../../store/useDirectorSceneStore';
import { DummyCharacter } from './DummyCharacter';
import { SceneCustomModel } from './SceneCustomModel';
import { SceneImagePlane } from './SceneImagePlane';

type Props = {
  object: SceneObject;
  pointerEvents?: boolean;
};

export function SceneObjectRenderer({ object, pointerEvents }: Props) {
  return (
    <Suspense fallback={null}>
      {object.type === 'image' ? (
        <SceneImagePlane object={object} />
      ) : object.type === 'customModel' && object.modelUrl ? (
        <SceneCustomModel modelUrl={object.modelUrl} tint={object.color} />
      ) : (
        <DummyCharacter object={object} pointerEvents={pointerEvents} />
      )}
    </Suspense>
  );
}
