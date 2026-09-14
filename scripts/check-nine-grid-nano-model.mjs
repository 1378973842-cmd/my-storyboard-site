/**
 * 九宫格 Agent 的 nano 必须是图片生成节点的 nano-banana-pro（不含 稳定）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const eng = fs.readFileSync(path.join(root, "src/lib/infiniteCanvas/canvasEngine.js"), "utf8");

const start = eng.indexOf("function generatorNanoBananaProModel");
const nineStart = eng.indexOf("function normalizeNineGridAgentNode");
const nineEnd = eng.indexOf("function resolveNineGridAgentTextModel");
const addStart = eng.indexOf("function addNineGridAgentNode");
const addEnd = eng.indexOf("function nineGridAgentStory");
const optStart = eng.indexOf("function nineGridImageModelOptions");
const optEnd = eng.indexOf("async function buildNineGridImageTaskPayload");

let failed = 0;
function ok(cond, label) {
  if (!cond) {
    console.error("FAIL:", label);
    failed += 1;
  } else console.log("ok", label);
}

ok(start >= 0, "generatorNanoBananaProModel helper");
ok(/\/\^nano-banana-pro\$\/i/.test(eng.slice(start, start + 400)), "helper matches exact nano-banana-pro");
ok(!/nano-banana-pro-稳定/.test(eng.slice(start, start + 400)), "helper excludes 稳定");

const nineFn = eng.slice(nineStart, nineEnd);
ok(nineFn.includes("generatorNanoBananaProModel"), "normalize remaps to generator nano");
ok(nineFn.includes("nano-banana-pro-稳定"), "normalize catches 稳定 alias");
ok(!/models\.nano/.test(nineFn), "normalize does not use models.nano");

const optFn = eng.slice(optStart, optEnd);
ok(optFn.includes("generatorNanoBananaProModel"), "dropdown uses generator nano");
ok(!/models\.nano/.test(optFn), "dropdown does not fall back to models.nano");

const addFn = eng.slice(addStart, addEnd);
ok(addFn.includes("generatorNanoBananaProModel(providerId)"), "new node defaults to generator nano");
ok(!/models\.nano/.test(addFn), "new node does not use models.nano");

if (failed) process.exit(1);
console.log("check-nine-grid-nano-model: pass");
