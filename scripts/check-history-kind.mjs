import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/InfiniteCanvasShell.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');
const api = fs.readFileSync(path.join(root, 'src/services/canvasGenerations.ts'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'src/services/infiniteCanvasRoutes.ts'), 'utf8');
const video = fs.readFileSync(path.join(root, 'src/services/canvasVideoBridge.ts'), 'utf8');

const checks = [
  [shell.includes('data-history-kind="image"') && shell.includes('data-history-kind="video"') && shell.includes('data-history-kind="audio"'), 'shell kind tabs'],
  [shell.includes('history-hub-chrome') && shell.includes('生成历史'), 'stable chrome + title'],
  [css.includes('.history-kind-seg') && css.includes('.history-kind-seg-btn.is-active'), 'kind segment CSS'],
  [css.includes('history-hub-panel.log-panel') && css.includes('height:min(86vh, 820px)'), 'fixed panel height'],
  [css.includes('.history-library-controls.is-inert'), 'controls keep space'],
  [eng.includes("historyLibraryKind = 'image'") && eng.includes('syncHistoryLibraryKindUi'), 'engine kind state'],
  [eng.includes('音频生成暂未开放') || eng.includes('Audio generation is not available yet'), 'audio locked empty'],
  [eng.includes('Generation history') || eng.includes('生成历史'), 'stable title in sync'],
  [eng.includes('kind=${encodeURIComponent(kind)}') || eng.includes('&kind='), 'loads with kind query'],
  [api.includes('kindFilter') && api.includes('generationMediaKindFromItem'), 'API kind filter'],
  [routes.includes("media_kind: \"video\"") && routes.includes('recordCanvasGeneration'), 'video records to history'],
  [video.includes('CanvasVideoPersistMeta') && video.includes('onPersisted?.(localUrl, req,'), 'video persist meta'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (ok) console.log(`OK: ${label}`);
  else {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) {
  console.error(`\ncheck-history-kind: ${failed} failed`);
  process.exit(1);
}
console.log('\ncheck-history-kind: all passed');
