/**
 * ponytail: one assert check for DeepWhite markdown audit.
 * Run: npx tsx scripts/check-deepwhite-assert.mjs
 */
import { assertDeepWhiteMarkdownForTest } from "../src/services/canvasDeepWhiteShotBridge.ts";

const sampleOk = `
## 场景诊断
x
## 导演规则选择
主规则：斯皮尔伯格
## 节拍地图
| 节拍 | 内容 | 信息/权力/情绪变化 | 视觉机会 |
|---|---|---|---|
| 1 | a | b | c |
## 视觉策略
x
## 空间调度
x
## 分镜图生成列表
| 镜号 | 镜头功能 | 构图 | 画面描述 | 景别 | 机位 | 镜头角度 | 焦段感 | 运镜 | 视觉规则 |
|---|---|---|---|---|---|---|---|---|---|
| 镜头1 | 建立 | 三分法构图 | 海滩 | 全景 | 正面 | 平视 | 广角 | 静止 | 无 |
## 视频提示词基础列表
| 镜号 | 时长 | 构图 | 画面描述 | 景别 | 机位 | 运镜 | 台词 | 动作 | 节奏 | 音效 |
|---|---|---|---|---|---|---|---|---|---|---|
| 镜头1 | 3秒 | 三分法构图 | 海滩 | 全景 | 正面 | 静止 | 无对白 | 走 | 缓 | 海浪 |
## 镜头语言自检
- 镜号是否只显示编号、没有必拍/可删减/覆盖镜头等标签：是
- 视频提示词基础列表是否删除了听者反应、情绪、微表情、情绪变化、剪辑点字段：是
`;

assertDeepWhiteMarkdownForTest(sampleOk);

let threw = false;
try {
  assertDeepWhiteMarkdownForTest(sampleOk.replace("| 镜头1 | 建立", "| 镜头1（必拍） | 建立"));
} catch {
  threw = true;
}
if (!threw) {
  console.error("expected bad shot id to throw");
  process.exit(1);
}
console.log("ok: deepwhite assert");
