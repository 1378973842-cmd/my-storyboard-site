/**
 * 预览「对比」按钮：DOM / 接线 / URL 回退 / 视频隐藏规则自检。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shell = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/InfiniteCanvasShell.tsx'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/components/InfiniteCanvas/infinite-canvas.css'), 'utf8');

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL', msg);
    process.exit(1);
  }
}

assert(shell.includes('id="outputCompareBtn"'), 'Shell missing #outputCompareBtn');
assert(shell.includes('output-lightbox-compare'), 'Shell missing compare class');
assert(shell.includes('columns-2'), 'Shell missing columns-2 icon');
assert(/hidden/.test(shell.match(/id="outputCompareBtn"[^>]*>/)?.[0] || ''), 'Compare btn should default hidden');

assert(engine.includes('outputCompareBtn = g(\'outputCompareBtn\')'), 'Engine missing outputCompareBtn bind');
assert(engine.includes('function syncOutputCompareBtn'), 'Engine missing syncOutputCompareBtn');
assert(engine.includes('generatorSources(node)'), 'Engine missing generatorSources fallback');
assert(engine.includes('outputCompareBtn.hidden = !canCompare'), 'Engine missing show/hide by canCompare');
assert(engine.includes('isVideoUrl(currentOutputLightboxUrl)'), 'Engine must hide compare for video');
assert(engine.includes('ondblclick'), 'Engine must keep dblclick toggle');
assert(engine.includes('function outputCompareRefListFor'), 'Engine missing outputCompareRefListFor');
assert(engine.includes('function renderOutputCompareRefPicker'), 'Engine missing renderOutputCompareRefPicker');
assert(engine.includes('function selectOutputCompareRef'), 'Engine missing selectOutputCompareRef');
assert(engine.includes('output-compare-ref-picker'), 'Engine must exclude picker from slider drag');
assert(shell.includes('id="outputCompareRefPicker"'), 'Shell missing #outputCompareRefPicker');
assert(css.includes('.output-compare-ref-picker'), 'CSS missing ref picker');
assert(css.includes('.output-compare-ref-chip'), 'CSS missing ref chips');
assert(css.includes('.output-lightbox-compare.is-active'), 'CSS missing compare active style');

/** 纯逻辑镜像：meta refs → comparisons → sources 首图 */
function resolveCompareUrl({ url, comparisons, metaRefs, sources }) {
  const source = comparisons?.[url];
  if (typeof source === 'string' && source) return source;
  if (source?.url) return source.url;
  const fromMeta = (metaRefs || []).find((r) => r?.url)?.url || '';
  if (fromMeta) return fromMeta;
  const first = (sources || []).find((s) => s?.refs?.some((r) => r?.url));
  return first?.refs?.find((r) => r?.url)?.url || '';
}

assert(
  resolveCompareUrl({
    url: 'out.png',
    metaRefs: [{ url: 'ref-meta.png' }],
    sources: [{ refs: [{ url: 'ref-src.png' }] }],
  }) === 'ref-meta.png',
  'meta refs should win',
);

assert(
  resolveCompareUrl({
    url: 'out.png',
    comparisons: { 'out.png': { url: 'ref-cmp.png' } },
    sources: [{ refs: [{ url: 'ref-src.png' }] }],
  }) === 'ref-cmp.png',
  'imageComparisons should win',
);

assert(
  resolveCompareUrl({
    url: 'out.png',
    metaRefs: [],
    sources: [{ refs: [] }, { refs: [{ url: '图1.png' }] }],
  }) === '图1.png',
  'fallback should use first source with refs',
);

assert(
  resolveCompareUrl({ url: 'out.png', metaRefs: [], sources: [] }) === '',
  'no refs → empty (hide button)',
);

function canShowCompareBtn({ compareUrl, lightboxUrl, isVideo }) {
  return !!compareUrl && !!lightboxUrl && !isVideo;
}

assert(canShowCompareBtn({ compareUrl: 'a.png', lightboxUrl: 'b.png', isVideo: false }) === true, 'image+ref shows');
assert(canShowCompareBtn({ compareUrl: '', lightboxUrl: 'b.png', isVideo: false }) === false, 'no ref hides');
assert(canShowCompareBtn({ compareUrl: 'a.png', lightboxUrl: 'v.mp4', isVideo: true }) === false, 'video hides');

/** 多参考：去重、跳过结果自身与视频，保留顺序 */
function uniqueCompareRefs({ resultUrl, metaRefs, sourceRefs }) {
  const list = [];
  const push = (raw) => {
    const u = String(raw || '').trim();
    if (!u || u === resultUrl) return;
    if (/\.(mp4|webm|mov|m4v|mkv)(\?|$)/i.test(u.split('?')[0])) return;
    if (list.includes(u)) return;
    list.push(u);
  };
  (metaRefs || []).forEach((r) => push(r?.url));
  (sourceRefs || []).forEach((r) => push(r?.url));
  return list;
}

assert(
  uniqueCompareRefs({
    resultUrl: 'out.png',
    metaRefs: [{ url: 'a.png' }, { url: 'b.png' }, { url: 'a.png' }, { url: 'clip.mp4' }, { url: 'out.png' }],
    sourceRefs: [{ url: 'b.png' }, { url: 'c.png' }],
  }).join(',') === 'a.png,b.png,c.png',
  'multi-ref list unique + skip video/result',
);

assert(
  uniqueCompareRefs({
    resultUrl: 'out.png',
    metaRefs: [{ url: 'only.png' }],
    sourceRefs: [],
  }).length === 1,
  'single ref stays one item (picker hidden at <2)',
);

console.log('check-output-compare-btn: pass');
