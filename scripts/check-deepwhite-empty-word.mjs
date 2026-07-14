/**
 * ponytail: DeepWhite soft parse (quality gates off).
 * Run: npx tsx scripts/check-deepwhite-empty-word.mjs
 */
import {
  assertDeepWhiteMarkdownForTest,
  sanitizeDeepWhiteEmptyWordsForTest,
} from "../src/services/canvasDeepWhiteShotBridge.ts";

const base = `## 场景诊断
x
## 分镜图生成列表
| 镜号 | 运镜 |
|---|---|
| 镜头1 | 向后拉开 |
## 视频提示词基础列表
| 镜号 | 时长 |
|---|---|
| 镜头1 | 3秒 |
`;

assertDeepWhiteMarkdownForTest(base);
assertDeepWhiteMarkdownForTest(base + "\n电影感很好");
const cleaned = sanitizeDeepWhiteEmptyWordsForTest("电影感海滩");
if (cleaned.includes("电影感")) {
  console.error("sanitize should strip adjective");
  process.exit(1);
}
console.log("ok: quality gates off");
