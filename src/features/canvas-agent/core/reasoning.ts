/**
 * 从模型响应里取「思考过程」。
 * 各家字段不一：OpenAI 兼容常用 reasoning_content，Gemini 的 thinking 块常放在 content 数组里。
 * 取不到就返回空，不编造。
 */
export function extractReasoningText(data: Record<string, unknown>): string {
  const choices = data.choices;
  const message = Array.isArray(choices) && choices.length
    ? (choices[0] as { message?: Record<string, unknown> }).message
    : undefined;
  const direct = message?.reasoning_content ?? message?.reasoning;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const parts = message?.content;
  if (Array.isArray(parts)) {
    const out: string[] = [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const row = part as { type?: unknown; text?: unknown; thought?: unknown };
      const isThought = row.type === "thinking" || row.type === "thought" || row.thought === true;
      const text = typeof row.text === "string" ? row.text : "";
      if (isThought && text.trim()) out.push(text.trim());
    }
    if (out.length) return out.join("\n\n");
  }
  return "";
}
