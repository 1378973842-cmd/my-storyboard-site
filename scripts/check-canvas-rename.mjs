/**
 * 画布重命名：元数据 PUT 不与内容保存抢 409；客户端只提交 title/icon
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const store = fs.readFileSync(path.join(root, 'src/services/infiniteCanvasStore.ts'), 'utf8');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const nav = fs.readFileSync(path.join(root, 'src/components/StudioTopNav.tsx'), 'utf8');

const checks = [
  [store.includes('touchesContent'), 'meta-only skip 409'],
  [store.includes('payload.title !== undefined'), 'title patch only when provided'],
  [eng.includes("body:JSON.stringify({\n                title: nextTitle"), 'rename PUT title/icon only'],
  [!/setCanvasTitle[\s\S]{0,800}base_updated_at/.test(eng) || eng.includes('仅提交 title/icon'), 'rename omits base lock'],
  [eng.includes('titleEl.ondblclick'), 'gate title dblclick rename'],
  [nav.includes('onDoubleClick') && nav.includes('startRename'), 'topnav title dblclick rename'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error(`FAIL: ${label}`);
    failed += 1;
  }
}
if (failed) process.exit(1);
console.log('ok: canvas rename checks passed');
