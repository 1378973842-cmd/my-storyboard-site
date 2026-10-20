import assert from "node:assert/strict";
import { checkCanvasContentFidelity } from "../src/services/canvasContentFidelity.js";

const valid = {
  prompt: "{{image-1}} 作为角色外观参考。林深说：{你回来了。}",
  durationSec: 6,
  fidelity: {
    strict: true,
    source_dialogue: "林深：{你回来了。}",
    refs: [{ node_key: "image-1", role: "character_anchor" }],
    speech_duration_sec: 2.4,
    silent_beats_sec: 1,
  },
};
assert.deepEqual(checkCanvasContentFidelity(valid), []);

const landed = {
  prompt: "角色锚点：诸葛亮 作为角色外观参考。",
  durationSec: 15,
  fidelity: {
    strict: true,
    refs: [{ node_key: "gen_anchor", name: "角色锚点：诸葛亮", role: "character" }],
  },
};
assert.deepEqual(checkCanvasContentFidelity(landed), []);
const missedName = checkCanvasContentFidelity({
  ...landed,
  prompt: "帐中备战，没有提到锚点。",
}).map((item) => item.code);
assert.ok(missedName.includes("REF_NOT_EXPLAINED"));

const codes = checkCanvasContentFidelity({
  prompt: "{{unknown}} 苏晚说：{我从未离开。}",
  durationSec: 1,
  fidelity: {
    strict: true,
    source_dialogue: "林深：{你回来了。}",
    refs: [{ node_key: "image-1", role: "character_anchor" }],
    speech_duration_sec: 2.4,
    silent_beats_sec: 1,
  },
}).map((item) => item.code);
assert.ok(codes.includes("MISSING_DIALOGUE"));
assert.ok(codes.includes("UNSOURCED_DIALOGUE"));
assert.ok(codes.includes("REF_NOT_EXPLAINED"));
assert.ok(codes.includes("UNDECLARED_REF"));
assert.ok(codes.includes("SPEAKER_UNATTRIBUTED"));
assert.ok(codes.includes("DURATION_TOO_SHORT"));

const uncalibrated = checkCanvasContentFidelity({
  ...valid,
  fidelity: { ...valid.fidelity, speech_duration_sec: undefined },
});
assert.ok(uncalibrated.some((item) => item.code === "SPEECH_DURATION_UNCALIBRATED"));

console.log("canvas-content-fidelity self-check: ok");
