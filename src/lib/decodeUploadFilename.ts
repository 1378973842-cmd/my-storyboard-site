/**
 * Multer/busboy 常把 multipart filename 按 Latin-1 解；中文名需按 UTF-8 还原。
 * 已是正常中文 / ASCII 则原样返回。
 */
export function decodeUploadFilename(name: unknown): string {
  const raw = String(name ?? "").trim();
  if (!raw) return "";

  // RFC 5987: filename*=UTF-8''...
  const star = raw.match(/^UTF-8''(.+)$/i);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1].replace(/\+/g, "%20"));
    } catch {
      /* fallthrough */
    }
  }

  // 已含 CJK → 信任
  if (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(raw)) return raw;

  // 百分号编码
  if (/%[0-9A-Fa-f]{2}/.test(raw)) {
    try {
      const decoded = decodeURIComponent(raw.replace(/\+/g, "%20"));
      if (decoded) return decoded;
    } catch {
      /* fallthrough */
    }
  }

  // UTF-8 字节被当成 Latin-1 的典型乱码（如 æµ‹è¯•）
  if (/[\u00C0-\u00FF]/.test(raw)) {
    try {
      const repaired = Buffer.from(raw, "latin1").toString("utf8");
      if (
        repaired &&
        !repaired.includes("\uFFFD") &&
        (/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/.test(repaired) ||
          repaired.length < raw.length)
      ) {
        return repaired;
      }
    } catch {
      /* ignore */
    }
  }

  return raw;
}
