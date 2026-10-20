export type FidelityReference = {
  node_key?: string;
  nodeId?: string;
  id?: string;
  role?: string;
  /** 落地时 {{node_key}} 换成的节点名。保真对着这个名字查 prompt。 */
  name?: string;
};

export type CanvasFidelityInput = {
  source_dialogue?: string;
  refs?: FidelityReference[];
  /** 真实 TTS 或已校准语音服务返回的时长；不使用占位语速猜测。 */
  speech_duration_sec?: number;
  silent_beats_sec?: number;
  strict?: boolean;
};

export type FidelityIssue = {
  code:
    | "MISSING_DIALOGUE"
    | "UNSOURCED_DIALOGUE"
    | "REF_NOT_EXPLAINED"
    | "UNDECLARED_REF"
    | "SPEAKER_UNATTRIBUTED"
    | "SPEECH_DURATION_UNCALIBRATED"
    | "DURATION_TOO_SHORT";
  message: string;
};

export function checkCanvasContentFidelity(input: {
  prompt: string;
  durationSec: number;
  fidelity: CanvasFidelityInput;
}): FidelityIssue[] {
  const prompt = String(input.prompt || "");
  const source = String(input.fidelity.source_dialogue || "");
  const issues: FidelityIssue[] = [];
  const sourceLines = extractBracedText(source);
  const promptLines = extractBracedText(prompt);

  for (const line of sourceLines) {
    if (!prompt.includes(`{${line}}`)) {
      issues.push(issue("MISSING_DIALOGUE", `缺少逐字台词/旁白：${preview(line)}`));
    }
  }
  for (const line of promptLines) {
    if (!sourceLines.includes(line)) {
      issues.push(issue("UNSOURCED_DIALOGUE", `出现来源中不存在的台词/旁白：${preview(line)}`));
    }
  }

  const declared = (input.fidelity.refs || []).map((ref) => ({
    key: String(ref.node_key || ref.nodeId || ref.id || "").trim(),
    name: String(ref.name || "").trim(),
  })).filter((ref) => ref.key || ref.name);
  const declaredKeys = new Set(declared.map((ref) => ref.key).filter(Boolean));
  // 落地前 prompt 里还是 {{id}}。落地后记号换成节点名，名字在就说明引用在。
  const tokenMentions = new Set(
    [...prompt.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1].trim()).filter(Boolean)
  );
  for (const ref of declared) {
    const byName = Boolean(ref.name) && prompt.includes(ref.name);
    const byToken = Boolean(ref.key) && tokenMentions.has(ref.key);
    if (!byName && !byToken) {
      issues.push(issue("REF_NOT_EXPLAINED", `引用未在 prompt 中说明用途：${ref.name || ref.key}`));
    }
  }
  for (const nodeKey of tokenMentions) {
    if (!declaredKeys.has(nodeKey)) {
      issues.push(issue("UNDECLARED_REF", `prompt 使用了未声明引用：${nodeKey}`));
    }
  }

  for (const { speaker, line } of parseSpeakerLines(source)) {
    const speakerAt = prompt.indexOf(speaker);
    const lineAt = prompt.indexOf(`{${line}}`);
    if (speakerAt < 0 || lineAt < 0 || speakerAt > lineAt || lineAt - speakerAt > 120) {
      issues.push(issue("SPEAKER_UNATTRIBUTED", `台词未明确归属说话人：${speaker} → ${preview(line)}`));
    }
  }

  const speechDuration = Number(input.fidelity.speech_duration_sec);
  const silentBeats = Math.max(0, Number(input.fidelity.silent_beats_sec) || 0);
  if (sourceLines.length && !(speechDuration > 0)) {
    issues.push(issue(
      "SPEECH_DURATION_UNCALIBRATED",
      "含台词的镜头必须提供真实 TTS/校准服务测得的 speech_duration_sec"
    ));
  } else {
    const required = Math.max(0, speechDuration || 0) + silentBeats;
    if (required > 0 && input.durationSec + 1e-6 < required) {
      issues.push(issue(
        "DURATION_TOO_SHORT",
        `镜头 ${input.durationSec}s，短于语音与无声节拍所需 ${required.toFixed(2)}s`
      ));
    }
  }
  return issues;
}

function extractBracedText(value: string): string[] {
  const lines: string[] = [];
  const pattern = /(^|[^{])\{([^{}]+)\}(?!\})/g;
  for (const match of value.matchAll(pattern)) {
    const line = match[2].trim();
    if (line) lines.push(line);
  }
  return [...new Set(lines)];
}

function parseSpeakerLines(value: string): Array<{ speaker: string; line: string }> {
  return [...value.matchAll(/(?:^|[\n；;])\s*([^：:\n；;]{1,40})\s*[：:]\s*\{([^{}]+)\}/g)]
    .map((match) => ({ speaker: match[1].trim(), line: match[2].trim() }))
    .filter((item) => item.speaker && item.line);
}

function issue(code: FidelityIssue["code"], message: string): FidelityIssue {
  return { code, message };
}

function preview(value: string): string {
  return value.length > 24 ? `${value.slice(0, 24)}…` : value;
}
