/**
 * 画布 409 冲突合并（纯函数）。
 * 原则：本地结构为准（删除/断线不复活）；同 id 可吸取远端媒体更丰内容；
 * 坐标与表单文本始终本地（避免打字中被远端旧 prompt 冲掉）。
 *
 * 生图「删除其他图片」会缩短 history：不得因远端 history 更长就把已删图复活。
 */

/** 用户可编辑的标量/文本字段：充实远端媒体时不得覆盖 */
export const CANVAS_LOCAL_EDITOR_KEYS = [
  'prompt', 'text', 'story', 'raw_script', 'brief', 'material',
  'systemPrompt', 'userInput', 'chatInput', 'creative_idea', 'scene', 'atmosphere',
  'prefixPrompt', 'variablePrompt', 'director_hint', 'scene_name', 'style_description',
  'name', 'title', 'notes',
  'count', 'ratio', 'resolution', 'quality', 'model', 'apiProvider',
  'msgenModel', 'msCustomModel', 'msRatio', 'msResolution', 'msLoraId', 'msLoraStrength', 'msLoraEnabled',
  'msCustomRatioWidth', 'msCustomRatioHeight', 'msCustomWidth', 'msCustomHeight', 'msCustomRatio', 'msCustomSize',
  'customRatio', 'customSize', 'customRatioWidth', 'customRatioHeight', 'customWidth', 'customHeight',
  'duration', 'durationSec', 'durationHint', 'mjChaos', 'mjStylize', 'mjWeird', 'mjIw', 'mjSv', 'mjQuality', 'mjHd', 'mjRaw',
  'previewLayout', 'primaryPinned', 'primaryUrl', 'previewIndex', 'historyOpen', 'disabled',
];

export function canvasNodeMergeScore(node) {
  if (!node || typeof node !== 'object') return 0;
  let score = 1;
  if (String(node.url || '').trim()) score += 10;
  // 有无结果台媒体用固定分，禁止按 history.length 加分——否则「删除其他图片」后本地更短会被远端旧稿盖回
  if (Array.isArray(node.history) && node.history.length) score += 2;
  if (Array.isArray(node.generatedOutputs) && node.generatedOutputs.length) score += 1;
  if (Array.isArray(node.previewRoundUrls) && node.previewRoundUrls.length) score += 1;
  if (String(node.prompt || node.text || '').trim()) score += 3;
  if (node.disabled) score -= 1;
  return score;
}

function pickLocalEditorFields(local) {
  const keep = {};
  if (!local || typeof local !== 'object') return keep;
  for (const key of CANVAS_LOCAL_EDITOR_KEYS) {
    if (Object.prototype.hasOwnProperty.call(local, key)) keep[key] = local[key];
  }
  keep.x = local.x;
  keep.y = local.y;
  keep.w = local.w;
  keep.h = local.h;
  keep.items = local.items;
  keep._userSized = local._userSized;
  keep._layoutW = local._layoutW;
  keep._layoutH = local._layoutH;
  // 本地已有结果列表时以本地为准（缩短=用户删过）；空数组仍允许吸取远端补图
  if (Array.isArray(local.history) && local.history.length) keep.history = local.history;
  if (Array.isArray(local.previewRoundUrls) && local.previewRoundUrls.length) {
    keep.previewRoundUrls = local.previewRoundUrls;
  }
  if (Array.isArray(local.generatedOutputs) && local.generatedOutputs.length) {
    keep.generatedOutputs = local.generatedOutputs;
  }
  return keep;
}

/** 本地节点集合为准；远端独有节点不并入（避免删了又回来）。 */
export function mergeCanvasNodeLists(localList, remoteList) {
  const remoteMap = new Map();
  for (const n of Array.isArray(remoteList) ? remoteList : []) {
    if (n?.id) remoteMap.set(n.id, n);
  }
  const out = [];
  for (const local of Array.isArray(localList) ? localList : []) {
    if (!local?.id) continue;
    const remote = remoteMap.get(local.id);
    if (!remote || canvasNodeMergeScore(local) >= canvasNodeMergeScore(remote)) {
      out.push(local);
      continue;
    }
    out.push({
      ...remote,
      ...pickLocalEditorFields(local),
    });
  }
  return out;
}

/** 本地连线集合为准，避免刀切/删线被远端并集复活。 */
export function mergeCanvasConnectionLists(localList, _remoteList) {
  return Array.isArray(localList) ? localList.slice() : [];
}

/**
 * 就地充实 live 节点内容（保持对象引用，拖拽中的 dragNode.node 不脱节）。
 * 不新增远端独有节点；不覆盖本地表单文本。
 */
export function enrichLiveNodesFromRemote(liveNodes, remoteList) {
  const list = Array.isArray(liveNodes) ? liveNodes : [];
  const remoteMap = new Map();
  for (const n of Array.isArray(remoteList) ? remoteList : []) {
    if (n?.id) remoteMap.set(n.id, n);
  }
  let changed = false;
  for (const local of list) {
    if (!local?.id) continue;
    const remote = remoteMap.get(local.id);
    if (!remote || canvasNodeMergeScore(local) >= canvasNodeMergeScore(remote)) continue;
    const keep = pickLocalEditorFields(local);
    Object.assign(local, remote, keep);
    delete local.running;
    delete local._pending;
    changed = true;
  }
  return changed;
}
