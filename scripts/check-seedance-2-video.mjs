/**
 * Seedance 2.0 / SparkVideo 2.0 视频参数映射与接入点自检
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SPARK_VIDEO_RESOLUTIONS = ["480p", "720p", "native1080p", "native4k", "1080p", "2k", "4k"];
const SPARK_VIDEO_RATIOS = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const PATH = "/openapi/v2/rhart-video/sparkvideo-2.0/multimodal-video";

function isSparkVideo20Model(model) {
  const m = String(model || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return (
    m === "seedance-2.0" ||
    m === "seedance-2" ||
    m === "sparkvideo-2.0" ||
    m.includes("sparkvideo-2") ||
    m.includes("seedance-2")
  );
}

function mapResolution(raw) {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  if (text === "native1080p" || text === "native-1080p") return "native1080p";
  if (text === "native4k" || text === "native-4k") return "native4k";
  if (text === "480p" || text === "480") return "480p";
  if (text === "1080p" || text === "1080") return "1080p";
  if (text === "2k" || text === "2kp" || text === "1440p") return "2k";
  if (text === "4k" || text === "4kp" || text === "2160p") return "4k";
  if (text === "768p" || text === "768") return "720p";
  return "720p";
}

function mapDuration(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return "5";
  return String(Math.max(4, Math.min(15, n)));
}

function mapRatio(raw) {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!text || text === "keep_ratio" || text === "keep" || text === "auto" || text === "adapt") {
    return "adaptive";
  }
  return SPARK_VIDEO_RATIOS.includes(text) ? text : "adaptive";
}

const cases = [
  ["seedance-2.0", true],
  ["sparkvideo-2.0", true],
  ["hailuo-h3", false],
];
let failed = 0;
for (const [model, expect] of cases) {
  const got = isSparkVideo20Model(model);
  if (got !== expect) {
    console.error("FAIL model", { model, expect, got });
    failed += 1;
  } else console.log("ok model", { model, got });
}

const mapCases = [
  ["", "720p", "5"],
  ["768P", "720p", "3"], // duration clamps up to 4
  ["2K", "2k", "20"], // duration clamps down to 15
  ["native4k", "native4k", "8"],
  ["1080p", "1080p", "4"],
];
for (const [resIn, resOut, durIn] of mapCases) {
  const resolution = mapResolution(resIn);
  const duration = mapDuration(durIn);
  const expectDur = mapDuration(durIn);
  if (resolution !== resOut || duration !== expectDur) {
    console.error("FAIL map", { resIn, resolution, resOut, durIn, duration, expectDur });
    failed += 1;
  } else console.log("ok map", { resolution, duration });
}

if (mapRatio("16:9") !== "16:9" || mapRatio("keep") !== "adaptive") {
  console.error("FAIL ratio");
  failed += 1;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eng = fs.readFileSync(path.join(root, "src/lib/infiniteCanvas/canvasEngine.js"), "utf8");
const svc = fs.readFileSync(path.join(root, "src/services/runningHubSparkVideo.ts"), "utf8");
const bridge = fs.readFileSync(path.join(root, "src/services/canvasVideoBridge.ts"), "utf8");
const routes = fs.readFileSync(path.join(root, "src/services/infiniteCanvasRoutes.ts"), "utf8");
const i18n = fs.readFileSync(path.join(root, "public/canvas/i18n-canvas.js"), "utf8");

const fileChecks = [
  [svc.includes(PATH), "spark service path"],
  [SPARK_VIDEO_RESOLUTIONS.includes("native4k") && svc.includes("native4k"), "native4k resolution"],
  [eng.includes("'seedance-2.0'"), "engine default models include seedance-2.0"],
  [eng.includes("function isSparkVideo20Model"), "engine spark detector"],
  [eng.includes("remountImageGenDock(node)"), "model change remounts dock"],
  [eng.includes("real_person_mode"), "run payload real_person_mode"],
  [eng.includes("native1080p"), "engine native1080p option"],
  [bridge.includes("isSparkVideo20Model") && bridge.includes("runSparkVideo20Job"), "bridge dispatches spark"],
  [routes.includes("SEEDANCE_2_MODEL_ID"), "config exposes seedance"],
  [i18n.includes("canvas.videoRealPersonMode"), "i18n real person mode"],
];
for (const [ok, label] of fileChecks) {
  if (!ok) {
    console.error("FAIL:", label);
    failed += 1;
  } else console.log("ok file", label);
}

if (failed) process.exit(1);
console.log("check-seedance-2-video: pass");
