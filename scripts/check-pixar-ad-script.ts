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
  const comps = [
    "三分法构图",
    "框架构图",
    "负空间构图",
    "前景遮挡构图",
    "中心构图",
    "纵深构图",
    "层次构图",
    "引导线构图",
    "开放式构图",
    "对称构图",
    "三角构图",
    "黄金分割构图",
    "对角线构图",
    "S形构图",
    "封闭式构图",
  ];
  const composition = comps[(n - 1) % comps.length];
  const move = n % 3 === 0 ? "固定镜头，机位不动突出表演" : "推进，机位向前匀速靠近，动机是递进情绪";
  // 前景遮挡构图=电影式前景层，须点名前景物+层次（非「挡住身体」）
  const device = composition.includes("前景遮挡")
    ? "虚化前景蒸汽贴近镜头形成纵深雾层"
    : n % 5 === 0
      ? "过肩，前景右肩虚化形成窥视层"
      : n % 3 === 1
        ? "插入特写手部细节"
        : "负空间留给窗光";
  const shotDesc = `${scale}，平视，${composition}，${move}；豆豆夸张抬臂完成可见动作起止，眉眼口型清晰；${device}，中景半身、后景灯串；左侧窗光暖黄勾轮廓，右侧柔阴影`;
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
    opts.nonFinal
      ? "本张非最后一张，最后一格必须保持动作进行中，禁止出现任何收尾信号。"
      : "本张为最后一张，可故事收束，无品牌Logo。",
    "表演风格极度夸张浮夸，四肢动作参考迪士尼角色动画表演方式。",
    "景别大特写与近景交替，禁止连续相同景别，禁止荷兰角倾斜构图。",
    `镜头号从${opts.from}连续标注（仅镜号角标，禁止运镜图表）。`,
    "逐格镜头描述（静帧改编）：近景，平视，三分法构图；角色定格姿态与表情；构图呈推进感的近景定格；道具状态清晰。",
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
    "#### 节拍地图",
    "* Beat1：开门揭示空间",
    "* Beat2：手艺建立期待",
    "* Beat3：递杯交付情绪",
    "#### 视觉策略",
    "插入特写→镜2,6；框中框→镜1；过肩→镜11；负空间→镜12",
    "### 分镜1-9（对应视频段1，≤15s）",
    "| 编号 | 视频内容片段（拍什么） | 引用锚点 | 镜头描述 |",
    "|---|---|---|---|",
    ...nums1.map((n) => shot(n, 15)),
    "### 分镜10-15（对应视频段2，≤15s）",
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
      prompt: fill(
        "本段镜头串联：按分镜表镜头描述串联。【画面渲染】主光左侧窗光暖黄【对话】豆豆（雀跃）【音效】倒水声 前半段故事",
        30
      ),
    },
    {
      segment_index: 2,
      duration_sec: 15,
      prompt: fill(
        "承接上一段动作，本段镜头串联：按分镜表镜头描述串联。【画面渲染】主光顶光暖黄【对话】【音效】【结尾】故事收束无Logo",
        30
      ),
    },
  ],
  audio_config: { bgm: "轻快爵士" },
};

const script = parseStoryAnimScriptResult(JSON.stringify(scriptPayload), 30, false);
assert.equal(script.mode, "story_script");

// 前景遮挡：只写构图名词应失败；带「前景物+遮挡部位」应通过
{
  const bareFg = {
    ...scriptPayload,
    storyboard_table_md: [
      "#### 节拍地图",
      "* Beat1：测试",
      "#### 视觉策略",
      "前景遮挡→镜1",
      "### 分镜1-9（对应视频段1，≤15s）",
      "| 编号 | 视频内容片段（拍什么） | 引用锚点 | 镜头描述 |",
      "|---|---|---|---|",
      "| 1 | 豆豆推门 | 角色锚点A、场景锚点A | 近景，平视，前景遮挡构图，固定镜头，机位不动突出表演；豆豆夸张抬臂完成可见动作起止，眉眼口型清晰；中景半身、后景灯串；左侧窗光暖黄勾轮廓 |",
      ...[2, 3, 4, 5, 6, 7, 8, 9].map((n) => shot(n, 15)),
      "### 分镜10-15（对应视频段2，≤15s）",
      "| 编号 | 视频内容片段（拍什么） | 引用锚点 | 镜头描述 |",
      "|---|---|---|---|",
      ...nums2.map((n) => shot(n, 15)),
    ].join("\n"),
  };
  let bareThrew = false;
  try {
    parseStoryAnimScriptResult(JSON.stringify(bareFg), 30, false);
  } catch (e) {
    bareThrew = /前景遮挡/.test(String((e as Error)?.message || e));
  }
  assert.equal(bareThrew, true, "bare 前景遮挡构图 should fail validation");

  const okFg = {
    ...bareFg,
    storyboard_table_md: bareFg.storyboard_table_md.replace(
      "眉眼口型清晰；中景半身",
      "眉眼口型清晰；虚化前景门框压在画面左缘形成窥视层次，中景半身"
    ),
  };
  const okParsed = parseStoryAnimScriptResult(JSON.stringify(okFg), 30, false);
  assert.equal(okParsed.mode, "story_script");
}
assert.equal(script.sketch_sheets?.[0]?.grid_count, 9);
assert.equal(script.sketch_sheets?.[1]?.shot_from, 10);
assert.match(script.sketch_sheets?.[0]?.prompt || "", /场景\s*[:：]/);
assert.doesNotMatch(script.sketch_sheets?.[0]?.prompt || "", /本段剧情/);
assert.match(script.sketch_sheets?.[0]?.prompt || "", /禁止荷兰角/);
assert.match(script.sketch_sheets?.[0]?.prompt || "", /禁止连续相同景别/);

// prior assets: anchor list must include asset names
const withAssets = {
  ...scriptPayload,
  global_config_md: fill("故事设定 角色锚点A 豆豆 场景锚点A 暖光咖啡馆", 50),
};
parseStoryAnimScriptResult(JSON.stringify(withAssets), 30, false, [
  {
    kind: "character",
    name: "豆豆",
    prompt: "皮克斯圆润短发女孩围裙造型描写".repeat(8),
  },
]);
let alignThrew = false;
try {
  parseStoryAnimScriptResult(JSON.stringify(scriptPayload), 30, false, [
    { kind: "character", name: "绝不出现的名字XYZ", prompt: "皮克斯圆润造型描写".repeat(10) },
  ]);
} catch {
  alignThrew = true;
}
assert.equal(alignThrew, true);

// single merged table without 分镜1-9 / 分镜10-N headings must fail
let sheetHeadThrew = false;
try {
  parseStoryAnimScriptResult(
    JSON.stringify({
      ...scriptPayload,
      storyboard_table_md: [
        "#### 节拍地图",
        "* Beat1：测试",
        "#### 视觉策略",
        "插入特写→镜2",
        "#### 分镜表",
        "| 编号 | 视频内容片段（拍什么） | 引用锚点 | 镜头描述 |",
        "|---|---|---|---|",
        ...nums1.map((n) => shot(n, 15)),
        ...nums2.map((n) => shot(n, 15)),
      ].join("\n"),
    }),
    30,
    false
  );
} catch {
  sheetHeadThrew = true;
}
assert.equal(sheetHeadThrew, true);

// sketch 若误带「本段剧情」应被剥掉后放行
const stripped = parseStoryAnimScriptResult(
  JSON.stringify({
    ...scriptPayload,
    sketch_sheets: [
      {
        ...scriptPayload.sketch_sheets[0],
        prompt: [
          sketchPrompt({ from: 1, to: 9, nonFinal: true }),
          "本段剧情：①开门②递杯③告别",
          "表演风格极度夸张浮夸，四肢动作参考迪士尼角色动画表演方式。",
        ].join("\n"),
      },
      scriptPayload.sketch_sheets[1],
    ],
  }),
  30,
  false
);
assert.doesNotMatch(stripped.sketch_sheets?.[0]?.prompt || "", /本段剧情|本段镜头串联/);

// video legacy label 本段剧情 → 本段镜头串联
const videoNorm = parseStoryAnimScriptResult(
  JSON.stringify({
    ...scriptPayload,
    video_segments: [
      {
        segment_index: 1,
        duration_sec: 15,
        prompt: fill(
          "本段剧情：按分镜表串联。【画面渲染】主光左侧窗光暖黄【对话】豆豆【音效】倒水 前半段",
          30
        ),
      },
      scriptPayload.video_segments[1],
    ],
  }),
  30,
  false
);
assert.match(videoNorm.video_segments?.[0]?.prompt || "", /本段镜头串联/);
assert.doesNotMatch(videoNorm.video_segments?.[0]?.prompt || "", /本段剧情/);

// sketch with video motion language must fail
let sketchMotionThrew = false;
try {
  parseStoryAnimScriptResult(
    JSON.stringify({
      ...scriptPayload,
      sketch_sheets: [
        {
          ...scriptPayload.sketch_sheets[0],
          prompt: sketchPrompt({ from: 1, to: 9, nonFinal: true }).replace(
            "静帧改编",
            "静帧改编。快速变焦逼近面部，机位自右向左滑移"
          ),
        },
        scriptPayload.sketch_sheets[1],
      ],
    }),
    30,
    false
  );
} catch {
  sketchMotionThrew = true;
}
assert.equal(sketchMotionThrew, true);

// 「禁止荷兰角」合规句不得误杀
parseStoryAnimScriptResult(
  JSON.stringify({
    ...scriptPayload,
    storyboard_table_md: scriptPayload.storyboard_table_md.replace(
      /^\| 12 \|.*\|$/m,
      "| 12 | 豆豆眨眼 | 角色锚点A | 特写，平视，负空间构图，固定镜头，机位不动突出表演；单侧眨眼定格，负空间留给脸颊，窗光点瞳孔，禁止荷兰角 |"
    ),
  }),
  30,
  false
);

// empty words in shot description must fail
let emptyWordThrew = false;
try {
  const badRow = `| 1 | 豆豆开门 | 角色锚点A | 近景，平视，推进，机位前移，动机亲近；豆豆抬手，电影感运镜自然流畅，左侧窗光 |`;
  parseStoryAnimScriptResult(
    JSON.stringify({
      ...scriptPayload,
      storyboard_table_md: scriptPayload.storyboard_table_md.replace(
        /^\| 1 \|.*\|$/m,
        badRow
      ),
    }),
    30,
    false
  );
} catch {
  emptyWordThrew = true;
}
assert.equal(emptyWordThrew, true);

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
