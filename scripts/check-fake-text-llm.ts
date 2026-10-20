import assert from "node:assert/strict";
import {
  createFakeTextLlmResponse,
  normalizeFakeTextLlmScenario,
} from "../src/services/fakeTextLlmProvider.js";

assert.equal(normalizeFakeTextLlmScenario("unknown"), "direct");

const direct = await createFakeTextLlmResponse({ model: "fixture" }, "direct");
assert.equal(direct.status, 200);
assert.equal((await direct.json() as any).choices[0].message.content, "Fixture provider response.");

const tool = await createFakeTextLlmResponse({}, "tool_call");
const toolBody = await tool.json() as any;
assert.equal(toolBody.choices[0].message.tool_calls[0].function.name, "create_canvas_nodes");
assert.equal(
  JSON.parse(toolBody.choices[0].message.tool_calls[0].function.arguments).nodes[0].tempId,
  "fixture-prompt",
);

const rateLimit = await createFakeTextLlmResponse({}, "rate_limit");
assert.equal(rateLimit.status, 429);

const malformed = await createFakeTextLlmResponse({}, "malformed_tool");
assert.equal(
  (await malformed.json() as any).choices[0].message.tool_calls[0].function.arguments,
  "{",
);

const badJson = await createFakeTextLlmResponse({}, "bad_json");
await assert.rejects(() => badJson.json());

const controller = new AbortController();
const timeout = createFakeTextLlmResponse({}, "timeout", controller.signal);
controller.abort();
await assert.rejects(timeout, (error: unknown) => (error as Error).name === "AbortError");

console.log("fake-text-llm self-check: ok");
