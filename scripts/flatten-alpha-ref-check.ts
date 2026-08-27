import assert from "node:assert/strict";
import sharp from "sharp";
import { flattenAlphaForModelRef } from "../src/services/runningHubStoryboardImage.ts";

const src = await sharp({
  create: {
    width: 4,
    height: 4,
    channels: 4,
    background: { r: 200, g: 40, b: 40, alpha: 0.5 },
  },
})
  .png()
  .toBuffer();

const before = await sharp(src).metadata();
assert.equal(before.hasAlpha, true);

const flat = await flattenAlphaForModelRef(src, "image/png", "cutout.png");
const after = await sharp(flat.buffer).metadata();
assert.equal(after.hasAlpha, false);
assert.equal(flat.mime, "image/png");
assert.match(flat.filename, /\.png$/);

const jpeg = await sharp({
  create: { width: 4, height: 4, channels: 3, background: { r: 10, g: 20, b: 30 } },
})
  .jpeg()
  .toBuffer();
const jpegOut = await flattenAlphaForModelRef(jpeg, "image/jpeg", "photo.jpg");
assert.equal(jpegOut.buffer.equals(jpeg), true);

console.log("flatten-alpha-ref-check ok");
