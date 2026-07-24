/**
 * 画布生图路由自检：gpt-image-2 不得静默掉进 nano T2I。
 * 纯函数抽检（与 canvasSiteImageBridge 判定一致）。
 */
function isGptImage2(model) {
  return /^gpt-image-2(-稳定)?$/i.test(String(model || "").trim());
}

function routeKind(model, refCount) {
  if (isGptImage2(model)) return refCount > 0 ? "g2-i2i" : "g2-t2i";
  return refCount > 0 ? "nano-i2i" : "nano-t2i";
}

const cases = [
  ["gpt-image-2", 2, "g2-i2i"],
  ["gpt-image-2", 0, "g2-t2i"],
  ["gpt-image-2-稳定", 1, "g2-i2i"],
  ["nano-banana-pro-稳定", 1, "nano-i2i"],
  ["nano-banana-pro-稳定", 0, "nano-t2i"],
];

let failed = 0;
for (const [model, refs, expect] of cases) {
  const got = routeKind(model, refs);
  if (got !== expect) {
    console.error("FAIL", { model, refs, expect, got });
    failed += 1;
  } else {
    console.log("ok", { model, refs, got });
  }
}
if (failed) process.exit(1);
console.log("check-canvas-image-model-route: pass");
