import { useDirectorSceneStore } from '../../store/useDirectorSceneStore';

import { DirectorCameraGizmo } from './DirectorCameraGizmo';

import { SceneGround } from './SceneGround';

import { SceneObjectRenderer } from './SceneObjectRenderer';



/** 共享场景环境：灯光、网格、地面 */

export function DirectorSceneEnvironment({

  showGrid = true,

  showGround = true,

}: {

  showGrid?: boolean;

  showGround?: boolean;

}) {

  return (

    <>

      <ambientLight intensity={0.45} />

      <directionalLight position={[6, 10, 4]} intensity={1.15} />

      {showGround && <SceneGround />}

      {showGrid && <gridHelper args={[24, 24, '#45464d', '#2a2a2a']} />}

    </>

  );

}



/** 共享场景几何（无交互，用于预览画布） */

export function DirectorSceneContent({

  showObjects = true,

  showCameraBodies = true,

}: {

  showObjects?: boolean;

  showCameraBodies?: boolean;

}) {

  const objects = useDirectorSceneStore((s) => s.objects);

  const cameras = useDirectorSceneStore((s) => s.cameras);

  const showGrid = useDirectorSceneStore((s) => s.showGrid);

  const showGround = useDirectorSceneStore((s) => s.showGround);



  return (

    <>

      <DirectorSceneEnvironment showGrid={showGrid} showGround={showGround} />



      {showObjects &&

        objects

          .filter((o) => o.visible)

          .map((object) => (

            <group

              key={object.id}

              position={object.position}

              rotation={object.rotation}

              scale={object.scale}

            >

              <SceneObjectRenderer object={object} />

            </group>

          ))}



      {showCameraBodies &&

        cameras

          .filter((c) => c.visible)

          .map((camera) => (

            <group

              key={camera.id}

              position={camera.position}

              rotation={camera.rotation}

              scale={camera.scale}

            >

              <DirectorCameraGizmo fov={camera.fov} />

            </group>

          ))}

    </>

  );

}


