import assert from "node:assert/strict";
import {
  buildViewpointUserMessage,
  parseViewpointAgentResponse,
  splitViewpointAgentSections,
} from "../src/services/canvasViewpointAgentBridge.js";

const sample = `### Part 1: 物理空间推演看板（Markdown 预检）
1. 机位在门外，室内不作为主场。
2. 原图由左至右：门 - 主持人 - 调音台。新图由左至右：调音台 - 主持人 - 门。
3. 调音台背面朝向镜头。
4. 击杀走廊。

### Part 2: 一键复制提示词（Code Block）

\`\`\`text
A cinematic wide shot from the doorway, 24mm, appearing noticeably smaller in the distant center --ar 16:9
\`\`\`
`;

const sections = splitViewpointAgentSections(sample);
assert.equal(sections.length, 2);
assert.match(sections[0].title, /看板/);
assert.match(sections[0].body, /击杀走廊/);
assert.match(sections[1].title, /一键复制/);
assert.match(sections[1].body, /doorway/);
assert.doesNotMatch(sections[1].body, /```/);

const parsed = parseViewpointAgentResponse(sample);
assert.match(parsed.english_prompt, /doorway/);
assert.match(parsed.english_prompt, /--ar 16:9/);
assert.match(parsed.spatial_notes, /击杀走廊/);
assert.doesNotMatch(parsed.english_prompt, /击杀/);

const userMsg = buildViewpointUserMessage({
  intent: "从门外反打，看主持人右手边设备的背面",
  refCount: 1,
});
assert.match(userMsg, /【视角意向】：从门外反打/);
assert.match(userMsg, /已按发送顺序附上 1 张/);
assert.match(userMsg, /【图1】\/ Image 1/);

console.log("check-viewpoint-agent: ok");
