/**
 * AG262fix：站内 /uploads 绝对 URL 不得 HTTP 裸拉（会 401），须走本地/OSS 直读路径解析。
 */
import assert from "assert";

function uploadsPathFromInput(input) {
  const trimmed = String(input || "").trim();
  if (trimmed.startsWith("/uploads/")) return trimmed.split("?")[0];
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const u = new URL(trimmed);
      if (u.pathname.startsWith("/uploads/")) return u.pathname;
    } catch {
      return "";
    }
  }
  return "";
}

assert.strictEqual(uploadsPathFromInput("/uploads/a/b.png"), "/uploads/a/b.png");
assert.strictEqual(uploadsPathFromInput("http://localhost:3005/uploads/a/b.png"), "/uploads/a/b.png");
assert.strictEqual(uploadsPathFromInput("https://dreamgrid.cn/uploads/x.webp?sig=1"), "/uploads/x.webp");
assert.strictEqual(uploadsPathFromInput("https://cdn.example.com/foo.png"), "");
assert.strictEqual(uploadsPathFromInput("data:image/png;base64,aaa"), "");

console.log("uploads-path-from-input check passed");
