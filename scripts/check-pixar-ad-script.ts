import assert from "node:assert/strict";
import {
  minSheetCount,
  normalizeDurationSec,
  parseStoryAnimAssetResult,
  parseStoryAnimScriptResult,
  toNodeKeySuffix,
} from "../src/services/canvasPixarAdScriptBridge.js";

assert.equal(toNodeKeySuffix("豆豆"), "doudou");
assert.equal(normalizeDurationSec(30), 30);
assert.equal(normalizeDurationSec(45), 45);
assert.equal(minSheetCount(15), 1);
assert.equal(minSheetCount(16), 2);
assert.equal(minSheetCount(30), 2);

const assetPayload = {
  mode: "asset_prompts",
  asset_prompts: [
    {
      kind: "character",
      name: "豆豆",
      prompt: `${"皮克斯圆润角色造型描写 ".repeat(20)}无尾巴、无翅膀、无宠物、肩上无附着物`,
      node_key: "anchor_char_doudou",
    },
  ],
};
const asset = parseStoryAnimAssetResult(JSON.stringify(assetPayload));
assert.equal(asset.mode, "asset_prompts");
assert.equal(asset.asset_prompts?.[0]?.name, "豆豆");

const fill = (label: string, length = 40) => `${label} ${"内容".repeat(length)}`;
const shot = (n: number, total: number) => {
  const summary =
    n === 9
      ? "豆豆抬起杯子，动作进行中不收尾"
      : n === 10
        ? "承接上一段动作，豆豆把杯子推向镜头"
        : `豆豆完成第${n}个明确动作`;
  const scale = n === total ? "定格画面" : n % 2 ? "大特写" : "近景";
  const shotDesc = `${scale}，豆豆保持清晰可见的动作姿态和夸张表情，镜头缓慢推进，暖色光线勾勒人物与道具轮廓`;
  return `| ${n} | ${summary} | 角色锚点A、场景锚点A | ${shotDesc} |`;
};

function sketchPrompt(opts: {
  from: number;
  to: number;
  nonFinal: boolean;
}): string {
  const body = [
    "图1=角色锚点A，图2=场景锚点A。参考图仅用于锁定外形。最终画面必须是铅笔线稿：纯素描、不上颜色、不上灰度、只有黑白线条。",
    "角色造型严格锁定：豆豆短发围裙。",
    "场景：暖光咖啡馆木质吧台与复古咖啡机。",
    `本段剧情：镜${opts.from}到镜${opts.to}的连续动作清单。`,
    opts.nonFinal
      ? "本张非最后一张，最后一格必须保持动作进行中，禁止出现任何收尾信号。"
      : "本张为最后一张，可故事收束，无品牌Logo。",
    "表演风格极度夸张浮夸，四肢动作参考迪士尼角色动画表演方式。",
    "景别大特写与近景交替，禁止连续相同景别，禁止荷兰角倾斜构图。",
    `镜头号从${opts.from}连续标注到${opts.to}，每格标注运镜图表。`,
  ].join(" ");
  return fill(body, 20);
}

const nums1 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const nums2 = [10, 11, 12, 13, 14, 15];
const scriptPayload = {
  mode: "story_script",
  duration_sec: 30,
  sheet_count: 2,
  node_keys: { char_a: "anchor_char_doudou", scene_a: "anchor_scene_cafe" },
  global_config_md: fill("故事设定 无品牌 多场景锚点清单", 50),
  storyboard_table_md: [
    "### 第1张",
    "| 编号 | 视频内容片段（拍什么） | 引用锚点 | 镜头描述 |",
    "|---|---|---|---|",
    ...nums1.map((n) => shot(n, 15)),
    "### 第2张",
    "| 编号 | 视频内容片段（拍什么） | 引用锚点 | 镜头描述 |",
    "|---|---|---|---|",
    ...nums2.map((n) => shot(n, 15)),
  ].join("\n"),
  sketch_sheets: [
    {
      sheet_index: 1,
      grid_count: 9,
      shot_from: 1,
      shot_to: 9,
      prompt: sketchPrompt({ from: 1, to: 9, nonFinal: true }),
    },
    {
      sheet_index: 2,
      grid_count: 6,
      shot_from: 10,
      shot_to: 15,
      prompt: sketchPrompt({ from: 10, to: 15, nonFinal: false }),
    },
  ],
  video_segments: [
    {
      segment_index: 1,
      duration_sec: 15,
      prompt: fill("【画面渲染】【对话】【音效】 前半段故事", 30),
    },
    {
      segment_index: 2,
      duration_sec: 15,
      prompt: fill("承接上一段动作【画面渲染】【对话】【音效】【结尾】故事收束无Logo", 30),
    },
  ],
  audio_config: { bgm: "轻快爵士" },
};

const script = parseStoryAnimScriptResult(JSON.stringify(scriptPayload), 30, false);
assert.equal(script.mode, "story_script");
assert.equal(script.sketch_sheets?.[0]?.grid_count, 9);
assert.equal(script.sketch_sheets?.[1]?.shot_from, 10);
assert.match(script.sketch_sheets?.[0]?.prompt || "", /场景\s*[:：]/);
assert.match(script.sketch_sheets?.[0]?.prompt || "", /本段剧情/);
assert.match(script.sketch_sheets?.[0]?.prompt || "", /禁止荷兰角/);
assert.match(script.sketch_sheets?.[0]?.prompt || "", /禁止连续相同景别/);

let threw = false;
try {
  parseStoryAnimScriptResult(
    JSON.stringify({
      ...scriptPayload,
      sketch_sheets: [
        {
          sheet_index: 1,
          grid_count: 6,
          shot_from: 1,
          shot_to: 6,
          prompt: sketchPrompt({ from: 1, to: 6, nonFinal: true }),
        },
      ],
    }),
    15,
    false
  );
} catch {
  threw = true;
}
assert.equal(threw, true);

console.log("Story anim script bridge self-check passed.");
