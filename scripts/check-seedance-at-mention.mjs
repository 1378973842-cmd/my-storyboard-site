/**
 * Seedance 2.0 提示词 @ 引用选择器
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eng = fs.readFileSync(path.join(root, "src/lib/infiniteCanvas/canvasEngine.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/components/InfiniteCanvas/infinite-canvas.css"), "utf8");
const i18n = fs.readFileSync(path.join(root, "public/canvas/i18n-canvas.js"), "utf8");

function sparkAtQueryAtCursor(value, pos) {
  const before = String(value || "").slice(0, pos);
  const at = before.lastIndexOf("@");
  if (at < 0) return null;
  const query = before.slice(at + 1);
  if (/[\s\n]/.test(query)) return null;
  return { start: at, query };
}

function filterSparkAtMentions(items, query) {
  const q = String(query || "")
    .trim()
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/\s+/g, "");
  if (!q) return items;
  return items.filter((item) => {
    const hay = `${item.token} ${item.label} ${item.kind} ${item.index}`.toLowerCase().replace(/\s+/g, "");
    return hay.includes(q) || String(item.index) === q;
  });
}

const items = [
  { token: "@Image 1", label: "图片1", kind: "image", index: 1 },
  { token: "@Video 1", label: "视频1", kind: "video", index: 1 },
];

let failed = 0;
const qCases = [
  ["@Image 1 场景是@", null, ""],
  ["hello @Im", null, "Im"],
  ["a@b", 3, "b"],
  ["@图", null, "图"],
];
for (const [value, posArg, expect] of qCases) {
  const pos = posArg == null ? value.length : posArg;
  const got = sparkAtQueryAtCursor(value, pos);
  const q = got ? got.query : null;
  if (q !== expect) {
    console.error("FAIL query", { value, pos, expect, q });
    failed += 1;
  } else console.log("ok query", { value, q });
}

const filtered = filterSparkAtMentions(items, "图");
if (filtered.length !== 1 || filtered[0].kind !== "image") {
  console.error("FAIL filter 图", filtered);
  failed += 1;
} else console.log("ok filter 图");

const fileChecks = [
  [eng.includes("function sparkVideoMentionItems"), "mention items helper"],
  [eng.includes("tokenHead") && eng.includes("'@Image'") && eng.includes("'@Video'"), "RH @Image / @Video tokens"],
  [eng.includes("bindSparkVideoAtMentions"), "bind spark at mentions"],
  [eng.includes("syncSparkAtPicker"), "sync picker on input"],
  [eng.includes("closeSparkAtPicker()"), "close on dock remove"],
  [css.includes(".spark-at-picker"), "picker css"],
  [i18n.includes("canvas.videoAtPickerTitle"), "i18n picker title"],
  [i18n.includes("canvas.videoPromptAtHint"), "i18n prompt hint"],
];
for (const [ok, label] of fileChecks) {
  if (!ok) {
    console.error("FAIL:", label);
    failed += 1;
  } else console.log("ok file", label);
}

if (failed) process.exit(1);
console.log("check-seedance-at-mention: pass");
