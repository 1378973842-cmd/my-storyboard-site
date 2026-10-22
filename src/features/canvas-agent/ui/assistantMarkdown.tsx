import type { ReactNode } from 'react';

function inlineNodes(text: string, key: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).filter(Boolean).map((part, index) => {
    const bold = part.match(/^\*\*([^*\n]+)\*\*$/);
    if (bold) return <strong key={`${key}-${index}`}>{bold[1]}</strong>;
    const code = part.match(/^`([^`\n]+)`$/);
    if (code) return <code key={`${key}-${index}`}>{code[1]}</code>;
    return part;
  });
}

function isHr(line: string): boolean {
  return /^ {0,3}(?:-{3,}|\*{3,}|_{3,})[ \t]*$/.test(line);
}

function headingOf(line: string): { level: 1 | 2 | 3; text: string } | null {
  const match = /^(#{1,3})[ \t]+(.+?)\s*$/.exec(line);
  if (!match) return null;
  const level = match[1].length as 1 | 2 | 3;
  return { level, text: match[2].replace(/\s+#+\s*$/, '') };
}

function isTableSep(line: string): boolean {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function tableCells(line: string): string[] {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
}

function listItem(line: string): { ordered: boolean; text: string } | null {
  const match = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(.+)$/.exec(line);
  if (!match) return null;
  return { ordered: /^\d/.test(line.trim()), text: match[1] };
}

function Heading({ level, text, index }: { level: 1 | 2 | 3; text: string; index: number }) {
  const body = inlineNodes(text, `h${index}`);
  if (level === 1) return <h2>{body}</h2>;
  if (level === 2) return <h3>{body}</h3>;
  return <h4>{body}</h4>;
}

// 存储仍是原文。这里只把 #、加粗、列表、引用、表格、代码块、分隔线画成排版。
export function AssistantMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let index = 0;
  const push = (node: ReactNode) => {
    blocks.push(node);
    index += 1;
  };
  for (let cursor = 0; cursor < lines.length; cursor += 1) {
    const line = lines[cursor] ?? '';
    if (!line.trim()) continue;
    if (line.trim().startsWith('```')) {
      const body: string[] = [];
      cursor += 1;
      while (cursor < lines.length && !(lines[cursor] ?? '').trim().startsWith('```')) {
        body.push(lines[cursor] ?? '');
        cursor += 1;
      }
      push(<pre key={index}><code>{body.join('\n')}</code></pre>);
      continue;
    }
    if (isHr(line)) {
      push(<hr key={index} />);
      continue;
    }
    const heading = headingOf(line);
    if (heading) {
      push(<Heading key={index} level={heading.level} text={heading.text} index={index} />);
      continue;
    }
    if (line.includes('|') && isTableSep(lines[cursor + 1] ?? '')) {
      const header = tableCells(line);
      const rows: string[][] = [];
      cursor += 2;
      while (cursor < lines.length && (lines[cursor] ?? '').includes('|') && (lines[cursor] ?? '').trim()) {
        rows.push(tableCells(lines[cursor] ?? ''));
        cursor += 1;
      }
      cursor -= 1;
      push(
        <table key={index}>
          <thead>
            <tr>{header.map((cell, cellIndex) => <th key={cellIndex}>{inlineNodes(cell, `th${index}-${cellIndex}`)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => <td key={cellIndex}>{inlineNodes(cell, `td${index}-${rowIndex}-${cellIndex}`)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }
    if (line.trim().startsWith('>')) {
      const body: string[] = [];
      while (cursor < lines.length && (lines[cursor] ?? '').trim().startsWith('>')) {
        body.push((lines[cursor] ?? '').replace(/^[ \t]*>[ \t]?/, ''));
        cursor += 1;
      }
      cursor -= 1;
      push(<blockquote key={index}>{inlineNodes(body.join('\n'), `q${index}`)}</blockquote>);
      continue;
    }
    const item = listItem(line);
    if (item) {
      const items: string[] = [];
      const ordered = item.ordered;
      while (cursor < lines.length) {
        const next = listItem(lines[cursor] ?? '');
        if (!next || next.ordered !== ordered) break;
        items.push(next.text);
        cursor += 1;
      }
      cursor -= 1;
      const ListTag = ordered ? 'ol' : 'ul';
      push(
        <ListTag key={index}>
          {items.map((entry, itemIndex) => <li key={itemIndex}>{inlineNodes(entry, `li${index}-${itemIndex}`)}</li>)}
        </ListTag>,
      );
      continue;
    }
    const body: string[] = [line];
    while (cursor + 1 < lines.length) {
      const next = lines[cursor + 1] ?? '';
      if (!next.trim() || next.trim().startsWith('```') || isHr(next) || headingOf(next) || listItem(next) || next.trim().startsWith('>')) break;
      if (next.includes('|') && isTableSep(lines[cursor + 2] ?? '')) break;
      body.push(next);
      cursor += 1;
    }
    push(<p key={index}>{inlineNodes(body.join('\n'), `p${index}`)}</p>);
  }
  return <div className="canvas-agent-md">{blocks}</div>;
}
