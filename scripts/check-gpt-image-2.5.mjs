/**
 * gpt-image-2.5 图片节点接入自检：不得误判为 gpt-image-2 / nano T2I。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const G25_PATH = "/openapi/v2/rhart-image-g-2.5/sunburst/image-to-image";

function isGptImage2(model) {
  return /^gpt-image-2(-稳定)?$/i.test(String(model || "").trim());
}
function isGptImage25(model) {
  const m = String(model || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  return m === "gpt-image-2.5" || m === "gpt-image-2-5";
}

function routeKind(model, refCount) {
  if (isGptImage25(model)) return "g25-i2i";
  if (isGptImage2(model)) return refCount > 0 ? "g2-i2i" : "g2-t2i";
  return refCount > 0 ? "nano-i2i" : "nano-t2i";
}

const cases = [
  ["gpt-image-2.5", 0, "g25-i2i"],
  ["gpt-image-2.5", 3, "g25-i2i"],
  ["gpt-image-2-5", 1, "g25-i2i"],
  ["gpt-image-2", 0, "g2-t2i"],
  ["gpt-image-2", 2, "g2-i2i"],
  ["gpt-image-2-稳定", 1, "g2-i2i"],
  ["nano-banana-pro", 0, "nano-t2i"],
];

let failed = 0;
for (const [model, refs, expect] of cases) {
  const got = routeKind(model, refs);
  if (got !== expect) {
    console.error("FAIL kind", { model, refs, expect, got });
    failed += 1;
  } else console.log("ok kind", { model, refs, got });
}

if (isGptImage2("gpt-image-2.5") || isGptImage2("gpt-image-2-5")) {
  console.error("FAIL: gpt-image-2 detector must not match 2.5");
  failed += 1;
} else console.log("ok gpt-image-2 detector excludes 2.5");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const svc = fs.readFileSync(path.join(root, "src/services/runningHubStoryboardImage.ts"), "utf8");
const bridge = fs.readFileSync(path.join(root, "src/services/canvasSiteImageBridge.ts"), "utf8");
const routes = fs.readFileSync(path.join(root, "src/services/infiniteCanvasRoutes.ts"), "utf8");
const eng = fs.readFileSync(path.join(root, "src/lib/infiniteCanvas/canvasEngine.js"), "utf8");

const g25Fn = svc.slice(
  svc.indexOf("export async function runStoryboardRunningHubG25Job"),
  svc.indexOf("export function extractCitedReferenceIndices")
);
const fileChecks = [
  [svc.includes(G25_PATH), "service sunburst path"],
  [svc.includes("export function isGptImage25Model"), "service detector"],
  [svc.includes("runStoryboardRunningHubG25Job"), "service job"],
  [g25Fn.includes("imageUrls") && !g25Fn.includes("quality:"), "g25 body has no quality"],
  [bridge.includes("isGptImage25Model") && bridge.includes("runStoryboardRunningHubG25Job"), "bridge dispatches g25"],
  [routes.includes('"gpt-image-2.5"'), "config lists gpt-image-2.5"],
  [eng.includes("'gpt-image-2.5'"), "engine default models include gpt-image-2.5"],
  [eng.includes("function isGptImage25Model"), "engine detector"],
  [eng.includes("profile: 'gpt-image-2.5'"), "engine caps profile"],
  [eng.includes("showQuality: false") && eng.includes("profile: 'gpt-image-2.5'"), "engine hides quality for 2.5"],
];
for (const [ok, label] of fileChecks) {
  if (!ok) {
    console.error("FAIL:", label);
    failed += 1;
  } else console.log("ok file", label);
}

if (failed) process.exit(1);
console.log("check-gpt-image-2.5: pass");
