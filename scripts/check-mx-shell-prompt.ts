import assert from "node:assert/strict";
import {
  assertMxShellPromptShape,
  normalizeMxShellTask,
} from "../src/services/canvasMxShellPromptBridge.js";

assert.equal(normalizeMxShellTask("polish"), "polish");
assert.equal(normalizeMxShellTask("润色"), "polish");
assert.equal(normalizeMxShellTask(""), "generate");

const wrap = (picture: string) =>
  ["【基础设定】", "设定。", "【氛围与画质】", "氛围。", "【声音】", "声音。", "【画面内容】", picture].join(
    "\n"
  );

// —— 多机位 ——
const goodMulti = [
  "分镜1丨开场入画丨0-1.5s丨广角低角度固定机位，等待主体入画：机器人踏入废墟门口，尘土扬起。",
  "分镜2丨备战起势丨1.5-3s丨镜头快速推近至中景，环绕主角半圈无缝衔接：机器人抬枪上膛，肩灯亮起。",
  "分镜3丨击杀1-2号丧尸丨3-5s丨过肩视角跟拍，随机器人身体平移，枪口始终对准目标：连续两枪命中，丧尸倒地。",
].join("\n");
assert.doesNotThrow(() => assertMxShellPromptShape(wrap(goodMulti), "multi_cam", "standard"));

assert.throws(
  () =>
    assertMxShellPromptShape(
      wrap(
        [
          "分镜1丨0-1.5s丨广角低角度固定机位：机器人入画。",
          "分镜2丨1.5-3s丨中景推进：机器人抬枪。",
        ].join("\n")
      ),
      "multi_cam",
      "standard"
    ),
  /节拍标题|不合规/
);

assert.throws(
  () =>
    assertMxShellPromptShape(
      wrap(
        [
          "分镜1丨开场入画丨1.5-3s丨广角低角度固定机位：机器人入画。",
          "分镜2丨备战起势丨0-1s丨中景推进靠近主体：机器人抬枪。",
        ].join("\n")
      ),
      "multi_cam",
      "standard"
    ),
  /时间轴倒退/
);

// —— 一镜到底（对齐示例A） ——
const goodOneShot = [
  "分镜：单镜头一镜到底。",
  "景别：近景。浅景深。",
  "角度：平视。",
  "构图：前景为角色腰上，背景为街道延伸。",
  "运镜手法：跟拍，机位贴主体侧前方保持相对距离匀速后退跟随，动机是压迫逃亡感。",
  "画面内容：",
  "0-2秒：主体骑乘奔驰入画，尘土扬起。",
  "2-4秒：主体掏出雷管按下启动按钮。",
].join("\n");
assert.doesNotThrow(() => assertMxShellPromptShape(wrap(goodOneShot), "one_shot", "standard"));

assert.throws(
  () =>
    assertMxShellPromptShape(
      wrap(
        [
          "分镜：单镜头一镜到底。",
          "景别：近景。",
          "构图：前景角色。",
          "运镜手法：跟拍，匀速后退跟随主体。",
          "画面内容：",
          "0-2秒：入画。",
          "2-4秒：动作。",
        ].join("\n")
      ),
      "one_shot",
      "standard"
    ),
  /角度/
);

assert.throws(
  () =>
    assertMxShellPromptShape(
      wrap(
        [
          "分镜：单镜头一镜到底。",
          "景别：近景。",
          "角度：平视。",
          "构图：前景角色。",
          "运镜手法：固定机位，跟随拍摄主体。",
          "画面内容：",
          "0-2秒：入画。",
          "2-4秒：动作。",
        ].join("\n")
      ),
      "one_shot",
      "standard"
    ),
  /矛盾组合/
);

assert.throws(
  () =>
    assertMxShellPromptShape(
      wrap(
        [
          "分镜：单镜头一镜到底。",
          "景别：近景。",
          "角度：平视。",
          "构图：前景角色。",
          "运镜手法：跟拍，匀速后退跟随主体。",
          "画面内容：一整段不分段的动作描述。",
        ].join("\n")
      ),
      "one_shot",
      "standard"
    ),
  /按秒分段/
);

console.log("check-mx-shell-prompt: ok");
