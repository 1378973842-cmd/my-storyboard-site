import assert from "node:assert/strict";
import {
  isPublicRunningHubImageUrl,
  normalizeImageInputForUpload,
} from "../src/services/runningHubStoryboardImage.ts";

assert.equal(
  isPublicRunningHubImageUrl("https://8.163.127.198/uploads/canvas/foo.jpg"),
  false,
  "site /uploads must not be treated as a public RH url"
);
assert.equal(
  isPublicRunningHubImageUrl("http://8.163.127.198:3000/uploads/canvas/foo.jpg"),
  false
);
assert.equal(
  normalizeImageInputForUpload("https://8.163.127.198/uploads/canvas/foo.jpg", ""),
  "/uploads/canvas/foo.jpg"
);
assert.equal(
  normalizeImageInputForUpload("http://localhost:3005/uploads/canvas/foo.jpg", ""),
  "/uploads/canvas/foo.jpg"
);

console.log("uploads-ref-to-rh-check ok");
