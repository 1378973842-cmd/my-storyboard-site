/**
 * 收起叠卡封面应钉住「设为主图」的 URL，而不是永远最新张。
 * 模拟：previewRoundUrls 与展示列表短暂不一致时，按 URL 仍能钉对。
 */
function outputUrlValue(v){
  if(!v) return '';
  if(typeof v === 'string') return v;
  return String(v.url || v.href || '').trim();
}
function genStageFindPreviewIndex(urls, url){
  const list = urls || [];
  const target = outputUrlValue(url);
  if(!target) return -1;
  const exact = list.indexOf(target);
  if(exact >= 0) return exact;
  return list.findIndex(u => outputUrlValue(u) === target);
}
function genStageCollapsedDisplayUrl(node, urls){
  const list = (urls || []).map(outputUrlValue).filter(Boolean);
  if(!list.length) return '';
  if(node?.primaryPinned || node?.primaryUrl){
    const pinned = outputUrlValue(node.primaryUrl);
    if(pinned){
      const hit = genStageFindPreviewIndex(list, pinned);
      if(hit >= 0) return list[hit];
    }
    const idx = Number(node.previewIndex);
    if(Number.isFinite(idx) && idx >= 0 && idx < list.length) return list[idx];
  }
  return list[list.length - 1];
}
function setPrimary(node, displayIndex, preferredUrl=''){
  const displayUrls = (node.previewRoundUrls || []).map(outputUrlValue).filter(Boolean);
  // 故意制造「展示列表更长」：history 多出一张
  const extra = node._extra || [];
  const urls = [...displayUrls];
  extra.forEach(u => { if(!urls.includes(u)) urls.push(u); });
  node.previewRoundUrls = urls.slice();
  let from = -1;
  const want = outputUrlValue(preferredUrl);
  if(want) from = genStageFindPreviewIndex(urls, want);
  if(from < 0) from = Math.max(0, Math.min(urls.length - 1, Number(displayIndex)));
  node.previewIndex = from;
  node.primaryPinned = true;
  node.primaryUrl = urls[from];
  return node.primaryUrl;
}

const node = {
  previewRoundUrls: ['/a.png', '/b.png', '/c.png'],
  previewIndex: 2,
  primaryPinned: false,
};
// 网格展示含 history 多出的 /d.png；用户点「设为主图」钉住 /b.png（下标若只看短列表会夹成错误图）
node._extra = ['/d.png'];
const pinned = setPrimary(node, 99, '/b.png'); // 错误下标 + 正确 URL
const cover = genStageCollapsedDisplayUrl(node, [...node.previewRoundUrls]);
if(pinned !== '/b.png' || cover !== '/b.png'){
  console.error('FAIL: expected cover /b.png, got', { pinned, cover, node });
  process.exit(1);
}
// 未钉住 → 最新
const loose = { previewRoundUrls: ['/a.png', '/b.png', '/c.png'], previewIndex: 0 };
if(genStageCollapsedDisplayUrl(loose, loose.previewRoundUrls) !== '/c.png'){
  console.error('FAIL: unpinned should show latest');
  process.exit(1);
}
console.log('check-gen-stage-primary-stack: ok');
