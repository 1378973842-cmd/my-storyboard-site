/**
 * 自检：删除其他图片须同步 history / previewRoundUrls / _stageSlots / generatedOutputs
 */
function outputUrlValue(item){
  return typeof item === 'string' ? item : item?.url || '';
}
function genStageFindPreviewIndex(urls, url){
  const list = urls || [];
  const target = outputUrlValue(url);
  if(!target) return -1;
  const exact = list.indexOf(target);
  if(exact >= 0) return exact;
  return list.findIndex(u => outputUrlValue(u) === target);
}
function generatorHistoryItems(node){
  if(Array.isArray(node.history) && node.history.length){
    return node.history
      .map(item => {
        const url = outputUrlValue(item);
        if(!url) return null;
        if(item && typeof item === 'object') return {...item, url};
        return {url};
      })
      .filter(Boolean);
  }
  return (node.previewRoundUrls || []).map(outputUrlValue).filter(Boolean).map(url => ({url}));
}
function generatorPreviewUrls(node){
  const histUrls = generatorHistoryItems(node).map(item => item.url).filter(Boolean);
  let order = Array.isArray(node?.previewRoundUrls)
    ? node.previewRoundUrls.map(outputUrlValue).filter(Boolean)
    : [];
  if(histUrls.length){
    const histSet = new Set(histUrls);
    if(order.length){
      order = order.filter(u => histSet.has(u));
      histUrls.forEach(u => { if(!order.includes(u)) order.push(u); });
    } else {
      order = histUrls.slice();
    }
  }
  return order;
}
function deleteOtherGeneratorPreviews(gen, keepUrl){
  if(!gen || !keepUrl) return false;
  const previewBefore = generatorPreviewUrls(gen).map(outputUrlValue).filter(Boolean);
  const keepIdx = genStageFindPreviewIndex(previewBefore, keepUrl);
  if(previewBefore.length < 2 || keepIdx < 0) return false;
  const keep = previewBefore[keepIdx];
  const drop = new Set(previewBefore.filter(u => u !== keep));
  const hist = generatorHistoryItems(gen);
  if(hist.length){
    gen.history = hist.filter(item => outputUrlValue(item?.url) === keep);
  } else {
    gen.history = [{url: keep}];
  }
  gen.previewRoundUrls = [keep];
  gen.previewIndex = 0;
  gen.primaryPinned = true;
  gen.primaryUrl = keep;
  gen.historyOpen = false;
  if(Array.isArray(gen.generatedOutputs)){
    gen.generatedOutputs = gen.generatedOutputs.map(outputUrlValue).filter(u => u === keep);
  }
  if(Array.isArray(gen._stageSlots)){
    const pendingSlots = gen._stageSlots.filter(s => s?.kind === 'pending');
    const keepSlot = gen._stageSlots.find(s => s?.kind === 'url' && outputUrlValue(s.url) === keep);
    gen._stageSlots = [
      keepSlot ? {...keepSlot, url: keep} : {kind:'url', url: keep},
      ...pendingSlots,
    ];
  }
  return drop.size > 0;
}

const gen = {
  history: [{url:'/a.png'}, {url:'/b.png'}, {url:'/c.png'}, {url:'/d.png'}],
  previewRoundUrls: ['/a.png', '/b.png', '/c.png', '/d.png'],
  generatedOutputs: ['/a.png', '/b.png', '/c.png', '/d.png'],
  _stageSlots: [
    {kind:'url', url:'/a.png'},
    {kind:'url', url:'/b.png'},
    {kind:'url', url:'/c.png'},
    {kind:'url', url:'/d.png'},
    {kind:'pending', id:'p1'},
  ],
  historyOpen: true,
  previewIndex: 2,
};

if(!deleteOtherGeneratorPreviews(gen, '/c.png')){
  console.error('FAIL: deleteOther should return true');
  process.exit(1);
}
const urls = generatorPreviewUrls(gen);
if(urls.length !== 1 || urls[0] !== '/c.png'){
  console.error('FAIL: preview should be solo /c.png', urls);
  process.exit(1);
}
if(gen.history.length !== 1 || outputUrlValue(gen.history[0]) !== '/c.png'){
  console.error('FAIL: history not solo', gen.history);
  process.exit(1);
}
if(gen._stageSlots.filter(s => s.kind === 'url').length !== 1
  || outputUrlValue(gen._stageSlots[0].url) !== '/c.png'
  || !gen._stageSlots.some(s => s.kind === 'pending' && s.id === 'p1')){
  console.error('FAIL: _stageSlots not synced', gen._stageSlots);
  process.exit(1);
}
if(gen.generatedOutputs.length !== 1 || gen.generatedOutputs[0] !== '/c.png'){
  console.error('FAIL: generatedOutputs not synced', gen.generatedOutputs);
  process.exit(1);
}
if(gen.historyOpen !== false || gen.primaryUrl !== '/c.png'){
  console.error('FAIL: primary/collapse flags', gen);
  process.exit(1);
}
// URL 归一：对象形态 keep
const gen2 = {
  history: [{url:'/x.png'}, {url:'/y.png'}],
  previewRoundUrls: ['/x.png', '/y.png'],
  _stageSlots: [{kind:'url', url:'/x.png'}, {kind:'url', url:'/y.png'}],
};
if(!deleteOtherGeneratorPreviews(gen2, {url:'/y.png'})){
  console.error('FAIL: object keepUrl should resolve');
  process.exit(1);
}
if(generatorPreviewUrls(gen2)[0] !== '/y.png'){
  console.error('FAIL: object keepUrl preview', gen2);
  process.exit(1);
}

// 菜单定位：opts.url 与列表不完全相等时，须用 findIndex 归一后再删
{
  const gen3 = {
    history: [{url:'/p.png'}, {url:'/q.png'}],
    previewRoundUrls: ['/p.png', '/q.png'],
    _stageSlots: [{kind:'url', url:'/p.png'}, {kind:'url', url:'/q.png'}],
  };
  const urls = generatorPreviewUrls(gen3);
  const optsUrl = {url:'/q.png'};
  const resolvedIdx = genStageFindPreviewIndex(urls, optsUrl);
  if(resolvedIdx !== 1){
    console.error('FAIL: menu resolve idx', resolvedIdx);
    process.exit(1);
  }
  if(!deleteOtherGeneratorPreviews(gen3, urls[resolvedIdx])){
    console.error('FAIL: resolved keep delete');
    process.exit(1);
  }
  if(generatorPreviewUrls(gen3)[0] !== '/q.png'){
    console.error('FAIL: resolved keep preview', gen3);
    process.exit(1);
  }
}

console.log('check-gen-delete-others: ok');
