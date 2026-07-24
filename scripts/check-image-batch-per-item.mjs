/**
 * 图片组逐张路由自检（与 canvasEngine resolvePerItemGroupBatch 契约对齐）
 */
const PER_ITEM = new Set(["batch-image", "group-image"]);

function resolvePerItemGroupBatch(sources, loopCtx) {
  if (loopCtx) return null;
  const imageSources = (sources || []).filter((s) => s.refs?.length);
  const itemSources = imageSources.filter((s) => PER_ITEM.has(s.type) && s.groupId);
  if (!itemSources.length) return null;
  const primaryGroupId = itemSources[0].groupId;
  const primaryItems = itemSources.filter((s) => s.groupId === primaryGroupId);
  const itemRefs = primaryItems.map((s) => s.refs?.[0]).filter((r) => r?.url);
  if (!itemRefs.length) return null;
  const shared = imageSources
    .filter((s) => !(PER_ITEM.has(s.type) && s.groupId === primaryGroupId))
    .flatMap((s) => s.refs || []);
  const jobRefs = itemRefs.map((item) => [item, ...shared.filter((r) => r.url !== item.url)]);
  return { jobRefs, itemRefs };
}

const seven = Array.from({ length: 7 }, (_, i) => ({
  type: "batch-image",
  groupId: "g1",
  refs: [{ url: `u${i}` }],
}));

const plan = resolvePerItemGroupBatch(seven, null);
if (!plan || plan.jobRefs.length !== 7) {
  console.error("FAIL expected 7 jobs", plan?.jobRefs?.length);
  process.exit(1);
}

const blocked = resolvePerItemGroupBatch(seven, { index: 1 });
if (blocked) {
  console.error("FAIL loopCtx must disable per-item");
  process.exit(1);
}

const flatSeven = seven.map((s) => ({ type: "image", refs: s.refs }));
const noBatch = resolvePerItemGroupBatch(flatSeven, null);
if (noBatch) {
  console.error("FAIL plain images must not per-item");
  process.exit(1);
}

console.log("ok jobs", plan.jobRefs.length);
console.log("check-image-batch-per-item: pass");
