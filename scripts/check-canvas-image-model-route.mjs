/**
 * 画布生图路由自检：gpt-image-2 不得静默掉进 nano T2I；nano-banana-2 走 g31-flash。
 * 纯函数抽检（与 canvasSiteImageBridge / runningHubStoryboardImage 判定一致）。
 */
function isGptImage2(model) {
  return /^gpt-image-2(-稳定)?$/i.test(String(model || "").trim());
}
function isNanoBanana2Model(model) {
  return /^nano-banana-2$/i.test(String(model || "").trim());
}

const NANO2_I2I = "/openapi/v2/rhart-image-n-g31-flash/image-to-image";
const NANO2_T2I = "/openapi/v2/rhart-image-n-g31-flash/text-to-image";
const NANO_PRO_I2I = "/openapi/v2/rhart-image-n-pro/edit";
const NANO_PRO_T2I = "/openapi/v2/rhart-image-n-pro-official/text-to-image";

function routeKind(model, refCount) {
  if (isGptImage2(model)) return refCount > 0 ? "g2-i2i" : "g2-t2i";
  if (isNanoBanana2Model(model)) return refCount > 0 ? "nano2-i2i" : "nano2-t2i";
  return refCount > 0 ? "nano-i2i" : "nano-t2i";
}

function resolvePath(model, refCount) {
  const kind = routeKind(model, refCount);
  if (kind === "nano2-i2i") return NANO2_I2I;
  if (kind === "nano2-t2i") return NANO2_T2I;
  if (kind === "nano-i2i") return NANO_PRO_I2I;
  if (kind === "nano-t2i") return NANO_PRO_T2I;
  return kind;
}

const cases = [
  ["gpt-image-2", 2, "g2-i2i"],
  ["gpt-image-2", 0, "g2-t2i"],
  ["gpt-image-2-稳定", 1, "g2-i2i"],
  ["nano-banana-pro-稳定", 1, "nano-i2i"],
  ["nano-banana-pro-稳定", 0, "nano-t2i"],
  ["nano-banana-2", 1, "nano2-i2i", NANO2_I2I],
  ["nano-banana-2", 0, "nano2-t2i", NANO2_T2I],
  ["nano-banana-pro", 1, "nano-i2i", NANO_PRO_I2I],
];

let failed = 0;
for (const [model, refs, expect, expectPath] of cases) {
  const got = routeKind(model, refs);
  if (got !== expect) {
    console.error("FAIL kind", { model, refs, expect, got });
    failed += 1;
    continue;
  }
  if (expectPath) {
    const path = resolvePath(model, refs);
    if (path !== expectPath) {
      console.error("FAIL path", { model, refs, expectPath, path });
      failed += 1;
      continue;
    }
  }
  console.log("ok", { model, refs, got, path: expectPath || resolvePath(model, refs) });
}
if (failed) process.exit(1);
console.log("check-canvas-image-model-route: pass");
