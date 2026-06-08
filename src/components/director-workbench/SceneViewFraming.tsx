import { useEffect } from 'react';

import { useThree } from '@react-three/fiber';

import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';

import type { RefObject } from 'react';

import { DUMMY_TARGET_HEIGHT } from '../../lib/director/skeleton';

import { useDirectorSceneStore } from '../../store/useDirectorSceneStore';



type Props = {

  orbitRef: RefObject<OrbitControlsImpl | null>;

};



/**

 * 仅响应「聚焦选中」按钮或添加对象时的 director-frame-view 事件。

 * 不在切换选中人偶/相机时自动改视角，避免点不同人偶时镜头切来切去。

 */

export function SceneViewFraming({ orbitRef }: Props) {

  const invalidate = useThree((s) => s.invalidate);

  const camera = useThree((s) => s.camera);



  useEffect(() => {

    const frameView = () => {

      const state = useDirectorSceneStore.getState();

      const orbit = orbitRef.current;

      if (!orbit) return;



      const { selectedId, selectedCameraId, objects, cameras } = state;



      let targetPos: [number, number, number] = [0, DUMMY_TARGET_HEIGHT * 0.5, 0];

      let frameRadius = 4.2;

      let moveCamera = true;



      if (selectedCameraId) {

        const cam = cameras.find((c) => c.id === selectedCameraId);

        if (cam) {

          targetPos = [...cam.position];

          frameRadius = 2;

          moveCamera = false;

        }

      } else if (selectedId) {

        const obj = objects.find((o) => o.id === selectedId);

        if (obj) {

          const maxScale = Math.max(obj.scale[0], obj.scale[1], obj.scale[2], 1);

          targetPos = [

            obj.position[0],

            obj.position[1] + DUMMY_TARGET_HEIGHT * 0.5 * maxScale,

            obj.position[2],

          ];

          frameRadius = (DUMMY_TARGET_HEIGHT * 2.4 + 1.2) * maxScale;

        }

      } else if (objects.length > 0) {

        const obj = objects[0]!;

        const maxScale = Math.max(obj.scale[0], obj.scale[1], obj.scale[2], 1);

        targetPos = [

          obj.position[0],

          obj.position[1] + DUMMY_TARGET_HEIGHT * 0.5 * maxScale,

          obj.position[2],

        ];

        frameRadius = (DUMMY_TARGET_HEIGHT * 2.4 + 1.2) * maxScale;

      }



      orbit.target.set(targetPos[0], targetPos[1], targetPos[2]);

      if (moveCamera) {

        camera.position.set(

          targetPos[0] + frameRadius,

          targetPos[1] + frameRadius * 0.65,

          targetPos[2] + frameRadius,

        );

      }

      orbit.update();

      invalidate();

    };



    window.addEventListener('director-frame-view', frameView);

    return () => window.removeEventListener('director-frame-view', frameView);

  }, [orbitRef, camera, invalidate]);



  return null;

}


