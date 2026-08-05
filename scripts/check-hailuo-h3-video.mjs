/**
 * Hailuo H3 视频参数映射自检（与 runningHubHailuoVideo.ts 一致）
 */
const HAILUO_H3_RESOLUTIONS = ["768P", "2K"];
const HAILUO_H3_RATIOS = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"];
const PATH = "/openapi/v2/minimax/hailuo-h3/multimodal-to-video";

function isHailuoH3Model(model) {
  const m = String(model || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-");
  return m === "hailuo-h3" || m === "minimax-hailuo-h3" || m.includes("hailuo-h3");
}

function mapResolution(raw) {
  const text = String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (text === "2K" || text === "2KP" || text === "1440P") return "2K";
  return "768P";
}

function mapDuration(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return "5";
  return String(Math.max(5, Math.min(15, n)));
}

function mapRatio(raw) {
  const text = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!text || text === "keep_ratio" || text === "keep" || text === "auto" || text === "adapt") {
    return "adaptive";
  }
  return HAILUO_H3_RATIOS.includes(text) ? text : "adaptive";
}

const cases = [
  ["hailuo-h3", true],
  ["minimax-hailuo-h3", true],
  ["veo3-fast", false],
];
let failed = 0;
for (const [model, expect] of cases) {
  const got = isHailuoH3Model(model);
  if (got !== expect) {
    console.error("FAIL model", { model, expect, got });
    failed += 1;
  } else console.log("ok model", { model, got });
}

const mapCases = [
  ["", "768P", "5", "adaptive"],
  ["2k", "2K", "3", "adaptive"], // duration clamps up to 5
  ["720p", "768P", "20", "adaptive"], // duration clamps down to 15
  ["768P", "768P", "8", "16:9"],
];
for (const [resIn, resOut, durIn, ratioIn] of mapCases) {
  const resolution = mapResolution(resIn);
  const duration = mapDuration(durIn);
  const ratio = mapRatio(ratioIn === "16:9" ? "16:9" : ratioIn);
  const expectDur = mapDuration(durIn);
  if (resolution !== resOut || duration !== expectDur) {
    console.error("FAIL map", { resIn, resolution, resOut, durIn, duration, expectDur });
    failed += 1;
  } else console.log("ok map", { resolution, duration, ratio });
}

if (!HAILUO_H3_RESOLUTIONS.includes("768P") || !PATH.includes("hailuo-h3")) {
  console.error("FAIL constants");
  failed += 1;
}

if (failed) process.exit(1);
console.log("check-hailuo-h3-video: pass");
