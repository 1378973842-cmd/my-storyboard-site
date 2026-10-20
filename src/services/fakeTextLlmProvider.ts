export type FakeTextLlmScenario =
  | "direct"
  | "tool_call"
  | "rate_limit"
  | "timeout"
  | "bad_json"
  | "empty"
  | "malformed_tool";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function normalizeFakeTextLlmScenario(value: unknown): FakeTextLlmScenario {
  const scenario = String(value || "").trim().toLowerCase();
  if (
    scenario === "tool_call" ||
    scenario === "rate_limit" ||
    scenario === "timeout" ||
    scenario === "bad_json" ||
    scenario === "empty" ||
    scenario === "malformed_tool"
  ) {
    return scenario;
  }
  return "direct";
}

/** Deterministic OpenAI-compatible fixture. Never performs network I/O. */
export async function createFakeTextLlmResponse(
  body: Record<string, unknown>,
  scenarioInput?: unknown,
  signal?: AbortSignal,
): Promise<Response> {
  const scenario = normalizeFakeTextLlmScenario(scenarioInput);
  if (scenario === "timeout") {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, 60_000);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new DOMException("The operation was aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }
  if (scenario === "rate_limit") {
    return jsonResponse({ error: { code: "fixture_rate_limit", message: "fake provider rate limit" } }, 429);
  }
  if (scenario === "bad_json") {
    return new Response("{fixture-bad-json", {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (scenario === "empty") {
    return jsonResponse({ choices: [{ message: { role: "assistant", content: "" } }] });
  }
  if (scenario === "malformed_tool") {
    return jsonResponse({
      choices: [{
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "fixture-call-bad",
            type: "function",
            function: { name: "create_canvas_nodes", arguments: "{" },
          }],
        },
      }],
    });
  }
  if (scenario === "tool_call") {
    return jsonResponse({
      choices: [{
        message: {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "fixture-call-1",
            type: "function",
            function: {
              name: "create_canvas_nodes",
              arguments: JSON.stringify({
                nodes: [{
                  tempId: "fixture-prompt",
                  nodeType: "prompt",
                  initialParams: { text: "fixture storyboard prompt" },
                }],
              }),
            },
          }],
        },
      }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    });
  }
  const model = String(body.model || "fixture-model");
  return jsonResponse({
    choices: [{
      message: { role: "assistant", content: "Fixture provider response." },
      finish_reason: "stop",
    }],
    model,
    usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
  });
}
