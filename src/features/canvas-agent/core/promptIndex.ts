export type PromptSection = {
  label: string;
  chars: number;
  percent: number;
};

export type PromptIndex = {
  title: string;
  ratio?: string;
  resolution?: string;
  duration?: string;
  model?: string;
  promptChars: number;
  sections: PromptSection[];
};

function headingLabel(text: string): string | null {
  const bracket = /^【(.+?)】/.exec(text) ?? /^#{1,3}\s*(.+)$/.exec(text);
  if (bracket) return (bracket[1] || '').trim().slice(0, 12) || null;
  const bold = /^\*\*(.+?)\*\*/.exec(text);
  if (bold) return (bold[1] || '').trim().slice(0, 12) || null;
  const named = /^(风格|运镜|核心画面|画面|细节|镜头|节奏|叙事|特效)[：:]/.exec(text);
  if (named) return named[1] || null;
  return null;
}

/**
 * 把四层提示词拆成结构索引：优先认【层名】/### /加粗标题 /「风格：」；
 * 找不到层名就只给「全文」。

 */
export function splitPromptSections(prompt: string): PromptSection[] {
  const lines = String(prompt || '').replace(/\r\n/g, '\n').split('\n');
  const groups: Array<{ label: string; chars: number }> = [];
  let current = { label: '全文', chars: 0 };
  let hasHeading = false;
  const flush = () => {
    if (current.chars > 0) groups.push(current);
  };
  for (const line of lines) {
    const text = line.trim();
    if (!text) continue;
    const heading = headingLabel(text);
    if (heading) {
      flush();
      current = { label: heading, chars: 0 };
      hasHeading = true;
      current.chars += text.length;
      continue;
    }
    current.chars += text.length;
  }
  flush();
  if (!hasHeading || !groups.length) {
    const total = String(prompt || '').replace(/\s/g, '').length;
    return [{ label: '全文', chars: total, percent: total ? 100 : 0 }];
  }
  const total = groups.reduce((sum, group) => sum + group.chars, 0) || 1;
  return groups.map((group) => ({
    label: group.label,
    chars: group.chars,
    percent: Math.round((group.chars / total) * 100),
  }));
}
