import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'canvas_source/static/canvas.html'), 'utf8');
const inner = html.match(/<div id="shell"[\s\S]*<\/div>\s*(?=<script)/)?.[0] || '';

function onClickAttr(expr) {
  const call = expr.trim().match(/^(\w+)\((.*)\)$/);
  if (call) {
    const [, fn, args] = call;
    return `onClick={() => canvasWin["${fn}"]?.(${args})}`;
  }
  const bare = expr.trim().match(/^(\w+)\(\)$/);
  if (bare) return `onClick={() => canvasWin["${bare[1]}"]?.()}`;
  return `onClick={() => void 0}`;
}

let jsx = inner
  .replace(/class=/g, 'className=')
  .replace(/maxlength=/g, 'maxLength=')
  .replace(/maxLength="(\d+)"/g, 'maxLength={$1}')
  .replace(/min="(\d+)"/g, 'min={$1}')
  .replace(/max="(\d+)"/g, 'max={$1}')
  .replace(/step="(\d+)"/g, 'step={$1}')
  .replace(/value="(\d+)"/g, 'value={$1}')
  .replace(/playsinline/g, 'playsInline')
  .replace(/disablepictureinpicture/g, 'disablePictureInPicture')
  .replace(/controlslist=/g, 'controlsList=')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<img([^>]*?)>/gi, (_, attrs) => `<img${attrs} />`)
  .replace(/<input([^>]*?)>/gi, (_, attrs) => `<input${attrs} />`)
  .replace(/style="display:none"/g, 'style={{ display: "none" }}')
  .replace(/style="display:contents"/g, 'style={{ display: "contents" }}')
  .replace(/style="display:none;align-items:center;gap:6px"/g, 'style={{ display: "none", alignItems: "center", gap: 6 }}')
  .replace(/style="opacity:\.4"/g, 'style={{ opacity: 0.4 }}')
  .replace(
    /style="color:#94a3b8[^"]*"/g,
    'style={{ color: "#94a3b8", fontSize: 11, fontWeight: 800, padding: "0 4px", marginRight: "auto", cursor: "pointer", userSelect: "none" }}'
  )
  .replace(/ondblclick="resetImageEditZoom\(\)"/g, 'onDoubleClick={() => canvasWin["resetImageEditZoom"]?.()}')
  .replace(/onclick="event\.stopPropagation\(\)"/g, 'onClick={(e) => e.stopPropagation()}')
  .replace(/onclick="([^"]+)"/g, (_, expr) => onClickAttr(expr));

const out = `/** Auto-generated from canvas.html — re-run scripts/html-to-jsx-shell.mjs */
import type { Ref } from 'react';

const canvasWin = window as unknown as Record<string, (...args: unknown[]) => void>;

type Props = { rootRef: Ref<HTMLDivElement> };

export function InfiniteCanvasShell({ rootRef }: Props) {
  return (
    <div ref={rootRef} className="infinite-canvas-root theme-dark">
${jsx.split('\n').map((l) => '      ' + l).join('\n')}
    </div>
  );
}
`;

fs.mkdirSync(path.join(root, 'src/components/InfiniteCanvas'), { recursive: true });
fs.writeFileSync(path.join(root, 'src/components/InfiniteCanvas/InfiniteCanvasShell.tsx'), out);
console.log('Wrote InfiniteCanvasShell.tsx');
