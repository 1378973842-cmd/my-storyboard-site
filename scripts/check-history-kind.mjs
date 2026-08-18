import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/InfiniteCanvasShell.tsx'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

const checks = [
  [shell.includes('history-library-scope-row') && shell.includes('所有项目') && shell.includes('当前项目'), 'scope row above search'],
  [!shell.includes('history-kind-tab-count">(0)</span>\n                                  </button>\n                                  <button type="button" className="history-kind-tab" data-history-scope'), 'scope tabs have no counts'],
  [shell.includes('图片历史') && shell.includes('视频历史') && shell.includes('音频历史'), 'media kind tabs kept'],
  [shell.indexOf('history-library-scope-row') < shell.indexOf('history-library-toolbar'), 'scope before search toolbar'],
  [shell.indexOf('history-library-toolbar') < shell.indexOf('history-library-kind-row'), 'kind row after search'],
  [css.includes('.history-scope-tabs') && css.includes('.history-scope-tab.is-active'), 'scope tab CSS'],
  [eng.includes('historyLibraryScope') && eng.includes('historyLibraryKind'), 'engine scope + kind state'],
  [eng.includes('syncHistoryLibraryScopeUi') && eng.includes('syncHistoryLibraryKindUi'), 'engine sync both tab rows'],
  [eng.includes('historyLibraryItemsForScope') && eng.includes('historyLibraryKindCounts'), 'scoped kind counts'],
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
