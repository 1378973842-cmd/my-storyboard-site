import { draftNarrativeBody } from './planCheck.js';

/**
 * 只从 draft 正文切原文，禁止模型重写剧情。
 * 片段拼接必须逐字等于 draftNarrativeBody(draft)。
 */
export function deriveStoryboardFromDraft(
  draft: string,
  totalDuration = 15,
): { storyboard: string; sources: string[] } {
  const body = draftNarrativeBody(draft)
    .replace(/<!--\s*正文结束\s*-->/g, '')
    .trim();
  if (!body) return { storyboard: '', sources: [] };
  const chunks = body
    .split(/(?<=[。！？!?；;])|\n+/u)
    .map((item) => item.trim())
    .filter(Boolean);
  const sources: string[] = [];
  if (chunks.length >= 3) {
    sources.push(...chunks);
  } else {
    const count = Math.min(3, Math.max(1, body.length));
    const size = Math.ceil(body.length / count);
    for (let i = 0; i < count; i += 1) {
      const part = body.slice(i * size, (i + 1) * size);
      if (part) sources.push(part);
    }
  }
  const total = Math.max(1, Number(totalDuration) || 15);
  const base = Math.round((total / sources.length) * 10) / 10;
  const lines: string[] = ['# 分镜表（draft 派生）', ''];
  sources.forEach((source, index) => {
    const duration = index === sources.length - 1
      ? Math.round((total - base * (sources.length - 1)) * 10) / 10
      : base;
    lines.push(`## SB-${String(index + 1).padStart(2, '0')}`);
    lines.push(`原文：${source}`);
    lines.push(`时长：${duration}s`);
    lines.push('镜头：待补');
    lines.push('');
  });
  return { storyboard: lines.join('\n'), sources };
}
