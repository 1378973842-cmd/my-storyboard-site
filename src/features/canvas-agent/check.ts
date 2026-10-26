import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  bindCanvasAgentAssetCache,
  clearCanvasAgentAssetCache,
  flattenAssetLibrary,
  peekCanvasAgentAssetCache,
  readCanvasAgentAssets,
  refreshCanvasAgentAssets,
} from './core/assetLibraryCache';
import { logoutSession } from '../../lib/authSession';
import { collectCanvasContext, serializeCanvasContext, visionImageUrlsForTurn } from './core/contextSerializer';
import { buildNineGridImagePrompt } from '../../lib/nineGrid/nineGridCore.js';
import { formatNineGridRefLooksForPhaseA } from '../../services/canvasNineGridBridge';
import { checkCanvasContentFidelity } from '../../services/canvasContentFidelity';
import { sortBatchExecutions } from './core/executionOrder';
import { approveRunCard, defaultAskAnswer, normalizeAskCards, parseAskAnswer, withRunApproval } from './core/askCard';
import { actionDisplayLabel, actionProposalNeedsApproval, derivedStepTitle, interpretCanvasProposalText, listedNodeIds, listedRecords, normalizeCanvasActions, openBatchProgress, partialBatchUpdate, pendingExecutionFeedback, proposalWaitsForClick, settleBatchProposal, stripCreatesOnShortYes, unknownCanvasActionMessage } from './core/proposal';
import { actionsReleasedForApproval, runScopeDigest, runScopeMatches } from './core/runApproval';
import { turnStatePrefix } from './core/turnState';
import { changelogFromActions, effectedFromApply, effectedLine, mediaRunState, mediaStatusLabel, parseRunStates, turnLabelCollapsed } from './core/effectLedger';
import { AskCardView } from './ui/AskCardView';
import { AskPager } from './ui/AskPager';
import { citationsForApply, citationsInUserMessage, droppedConnectCount, imageModelAcceptsReferenceInput, readableReferencePrompt, REFERENCE_IMAGE_FALLBACK_MODEL, referenceCapsuleLabel, referenceConnectionOrder, mentionTitleToStore, referenceClampLabels, settleReferenceActions } from './core/referencePrompt';
import {
  deliverProposalDone,
  diskProposalOutcome,
  flushProposalWriteQueue,
  proposalOnReopen,
  runProposalApply,
} from './core/proposalPersistence';
import {
  appendCanvasAgentMessage,
  createCanvasAgentConversation,
  deleteCanvasAgentArtifacts,
  hasPendingRunApproval,
  initCanvasAgentConversationSchema,
  pendingAskQuestions,
  readConversationCitedNodes,
  readConversationEffected,
  readConversationStage,
  readConversationStageData,
  writeConversationStageData,
  recordConversationCitations,
  recordConversationEffected,
  recordConversationStage,
  setConversationCancelMarker,
  takeConversationCancelMarker,
  takeConversationChangelog,
  updateCanvasAgentProposalOutcome,
} from './server/conversationStore';
import {
  appendAgentJobObservation,
  cancelActiveJobsForConversation,
  createAgentJob,
  getAgentJob,
  initCanvasAgentJobSchema,
  isStaleAgentJob,
  listAgentJobs,
  setAgentJobSteps,
  touchAgentJob,
  transitionAgentJob,
} from './server/agentJobStore';
import {
  isActiveAgentJob,
  isTerminalAgentJob,
  nextAgentJobStatus,
} from './core/jobState';
import { remainingRunNodes, runNodeIdsOf } from './core/jobPlan';
import { rollbackCanvasPlan } from './core/rollbackPlan';
import { extractReasoningText } from './core/reasoning';
import { replaceNodeTokens } from './core/displayText';
import { COMBAT_ANCHOR_NOTICE, combatStageDecision } from './core/combatStage';
import { appendRunProposalForNewGenerativeNodes } from './core/runProposal';
import { pruneCanvasSnapshots } from '../../services/infiniteCanvasStore';
import { memoryHitsPrompt, memoryPromptPrefix, searchMemoryHits } from './core/memory';
import { compactHistory } from './core/history';
import { actionRequiresApproval, toolContract, toolResultContent } from './core/toolContract';
import {
  initCanvasAgentMemorySchema,
  deleteAgentMemory,
  listAgentMemory,
  upsertAgentMemory,
} from './server/agentMemoryStore';
import {
  countTurnsSince,
  finishAgentTurn,
  initCanvasAgentTurnSchema,
  overDailyQuota,
  startAgentTurn,
  summarizeAgentTurns,
} from './server/agentTurnStore';
import {
  createAgentApiKey,
  initCanvasAgentApiKeySchema,
  listAgentApiKeys,
  resolveAgentApiKeyOwner,
  revokeAgentApiKey,
} from './server/agentApiKeyStore';
import { ProposalPreviewCard } from './ui/ProposalPreviewCard';
import { AssistantMarkdown } from './ui/assistantMarkdown';
import { proposalDefaultOpen, PROPOSAL_OPEN_CAP, sortProposalsForDisplay } from './ui/proposalOrder';
import { agentPlaybooks, convertSkillToAITool, canvasSkillRegistry, coreCanvasTools, CREATE_PARAM_KEYS, UPDATE_PARAM_KEYS, describeCreateCanvasNodes, describeUpdateNodeConfig, rejectUnknownCanvasParamKeys } from './tools/skillRegistry';
import { readPlaybookForAgent, readRegisteredPlaybookText } from '../../services/infiniteCanvasRoutes';
import { downstreamImpactPaths, invalidationActions, nodeHasGeneratedOutput, upstreamDigest } from './core/invalidation';
import {
  applyRebuildGuards,
  assertAgentActionContent,
  assertCanvasVideoShotTimelines,
  assertVideoShotTimeline,
  choiceActions,
  classifyIntake,
  downstreamChoices,
  insertMention,
  mentionChipToken,
  mentionCandidates,
  historyPieces,
  stripMentionQuery,
  mentionModelCandidates,
  mentionQueryAt,
  nodeLifecycle,
  operatingPrompt,
  settleAgentStaleAfterExecution,
} from './core/operatingModel';
import { canvasAgentStagePrefix, canvasAgentStageSegment, inferAppliedPlaybookStage } from './core/stageLedger';
import type { ActionProposal, CanvasSnapshot } from './types';

const snapshot: CanvasSnapshot = {
  canvasId: 'canvas-check',
  nodes: [
    { id: 'prompt-1', type: 'prompt', x: 0, y: 0, text: '雨夜追逐', style: 'neo noir' },
    {
      id: 'image-1',
      type: 'image',
      x: 350,
      y: 0,
      prompt: 'hero in rain',
      url: '/uploads/hero.png',
    },
    { id: 'video-1', type: 'video', x: 700, y: 0, prompt: 'slow dolly in' },
  ],
  connections: [
    { id: 'edge-1', from: 'prompt-1', to: 'image-1' },
    { id: 'edge-2', from: 'image-1', to: 'video-1' },
  ],
  selectedNodeIds: ['video-1'],
  viewport: { x: 0, y: 0, scale: 1 },
  viewportCenter: { x: 600, y: 400 },
  settings: { aspectRatio: '16:9', style: 'cinematic' },
};

const context = collectCanvasContext(snapshot);
assert.equal(context.activeSelectedNodes[0]?.id, 'video-1');
assert.equal(context.activeSelectedNodes[0]?.lifecycle, 'created');
assert.equal(context.upstreamLineage.find((node) => node.id === 'image-1')?.lifecycle, 'effective');
assert.deepEqual(
  context.upstreamLineage.map((node) => node.id),
  ['image-1', 'prompt-1'],
);
assert.match(serializeCanvasContext(snapshot), /hero\.png/);
assert.deepEqual(
  visionImageUrlsForTurn(snapshot, ''),
  ['/uploads/hero.png'],
);
const visionSnap: CanvasSnapshot = {
  ...snapshot,
  nodes: [
    ...snapshot.nodes,
    {
      id: 'scene-1',
      type: 'image',
      url: '/uploads/scene.png',
      history: ['/uploads/old-a.png', '/uploads/old-b.png'],
    },
    { id: 'prop-1', type: 'image', url: '/uploads/prop.png' },
    { id: 'extra-1', type: 'image', url: '/uploads/extra.png' },
    { id: 'clip-1', type: 'video', url: '/uploads/clip.mp4' },
  ],
  connections: [
    ...snapshot.connections,
    { id: 'e-scene', from: 'scene-1', to: 'video-1' },
  ],
};
assert.deepEqual(
  visionImageUrlsForTurn(visionSnap, '参考 {{prop-1}} {{clip-1}}'),
  ['/uploads/prop.png', '/uploads/hero.png', '/uploads/scene.png'],
);
assert.deepEqual(
  visionImageUrlsForTurn({
    ...visionSnap,
    selectedNodeIds: [],
    connections: snapshot.connections,
  }, '符合预期', ['prop-1']),
  ['/uploads/prop.png'],
);
assert.equal(
  visionImageUrlsForTurn({
    ...visionSnap,
    nodes: [
      ...visionSnap.nodes,
      ...Array.from({ length: 9 }, (_, index) => ({
        id: `more-${index}`,
        type: 'image',
        url: `/uploads/more-${index}.png`,
      })),
    ],
    selectedNodeIds: [],
  }, Array.from({ length: 9 }, (_, index) => `{{more-${index}}}`).join(' ')).length,
  8,
);
assert.equal(referenceCapsuleLabel({ title: '阿波罗', name: 'canvas-output-1.jpg' }, 2), '阿波罗');
assert.equal(referenceCapsuleLabel({ floatTitle: '神殿', name: '角色参考' }, 1), '神殿');
assert.equal(referenceCapsuleLabel({ name: 'canvas-output-1.jpg' }, 1), '参考图1');
assert.equal(referenceCapsuleLabel({}, 0), '参考图');
assert.equal(referenceConnectionOrder('vid', 'img_b', [
  { from: 'prompt-1', to: 'vid' },
  { from: 'img_a', to: 'vid' },
  { from: 'img_b', to: 'vid' },
], [
  { id: 'prompt-1', type: 'prompt' },
  { id: 'img_a', type: 'image' },
  { id: 'img_b', type: 'image' },
]), 2);
assert.equal(upstreamDigest(snapshot, 'video-1').length, 16);
assert.deepEqual(
  downstreamImpactPaths(snapshot, ['prompt-1']).map((item) => item.path),
  [['prompt-1', 'image-1'], ['prompt-1', 'image-1', 'video-1']],
);
assert.deepEqual(
  invalidationActions(snapshot, [{
    type: 'update_node_params',
    nodeId: 'prompt-1',
    patch: { text: 'changed' },
  }]).map((item) => item.nodeId),
  ['prompt-1', 'image-1', 'video-1'],
);

const actions = normalizeCanvasActions([
  {
    type: 'create_node',
    tempId: 'shot',
    nodeType: 'generator',
    initialParams: { prompt: 'wide shot' },
  },
  { type: 'connect_nodes', sourceNodeId: 'prompt-1', targetNodeId: 'shot' },
  { type: 'execute_node_skill', nodeId: 'shot' },
  { type: 'unknown_action' },
]);
assert.equal(actions.length, 3);
assert.equal(actions[0]?.type, 'create_node');
assert.equal(actionProposalNeedsApproval(actions), true);

const tool = convertSkillToAITool(canvasSkillRegistry[0]);
assert.equal(tool.type, 'function');
assert.match(tool.function.name, /^run_/);
assert.equal(coreCanvasTools.length, 7);
assert.ok(coreCanvasTools.some((item) => item.function.name === 'confirm_character_anchor'));
assert.ok(coreCanvasTools.some((item) => item.function.name === 'ask_user'));
assert.ok(coreCanvasTools.some((item) => item.function.name === 'remember_project_fact'));
assert.ok(coreCanvasTools.every((item) => item.function.parameters.type === 'object'));

assert.equal(classifyIntake('总结当前画布，不要修改'), 'direct');
// production 分支已停用，原断言锁的是它的存在。
// 依据见 operatingModel.ts 里 classifyIntake 上方那条注释
// 和 963–995 那一段的重写说明。
for (const cue of [
  '我要一支片子',
  '做一条短片',
  '按分镜来',
  '多镜头',
  '角色一致',
  '同角色',
  '先做锚点',
  '完整成片',
  '走流程',
  '做一条30秒短片，角色保持一致',
  '一条 5 秒的镜头',
  '一条 12 秒，角色保持',
  '一条 8 秒讲完',
]) {
  assert.equal(classifyIntake(cue), 'direct');
}
assert.equal(nodeLifecycle(snapshot.nodes[1]), 'effective');
const executed = {
  id: 'gen-stale',
  type: 'generator',
  url: '/uploads/done.png',
  agentStale: true,
  agentStaleReason: '上游已变更',
  agentImpactPath: ['prompt-1', 'gen-stale'],
};
settleAgentStaleAfterExecution(executed, true);
assert.equal(executed.agentStale, undefined);
assert.equal(executed.agentStaleReason, undefined);
assert.equal(executed.agentImpactPath, undefined);
assert.equal(nodeLifecycle(executed), 'effective');
const failedRun = {
  id: 'gen-fail',
  type: 'generator',
  url: '/uploads/done.png',
  agentStale: true,
  agentStaleReason: '上游已变更',
  agentImpactPath: ['prompt-1'],
};
settleAgentStaleAfterExecution(failedRun, false);
assert.equal(failedRun.agentStale, true);
assert.equal(failedRun.agentStaleReason, '上游已变更');
assert.equal(nodeLifecycle({ ...snapshot.nodes[1], agentStale: true }), 'created');
assert.equal(nodeLifecycle({ ...snapshot.nodes[2], runStatus: 'failed' }), 'discarded');
assert.deepEqual(
  downstreamChoices(snapshot, [{
    type: 'update_node_params',
    nodeId: 'prompt-1',
    patch: { text: 'changed' },
  }]).map((item) => item.nodeId),
  ['image-1'],
);
assert.throws(
  () => applyRebuildGuards(
    [{ type: 'execute_node_skill', nodeId: 'video-1' }],
    {
      ...snapshot,
      nodes: snapshot.nodes.map((node) => (
        node.id === 'video-1' ? { ...node, runStatus: 'failed' } : node
      )),
    },
  ),
  /不能在原节点重试/,
);
const replaced = applyRebuildGuards(
  [{
    type: 'create_node',
    tempId: 'video-2',
    nodeType: 'video',
    initialParams: { replacesNodeId: 'video-1', prompt: 'slow dolly in' },
  }],
  snapshot,
);
assert.equal(replaced.find((action) => action.type === 'create_node' && action.initialParams?.agentRebuildCount === 1)?.type, 'create_node');
assert.equal(
  replaced.find((action) => action.type === 'update_node_params')?.patch.agentLifecycle,
  'discarded',
);
assert.throws(
  () => applyRebuildGuards(
    [{
      type: 'create_node',
      tempId: 'video-4',
      nodeType: 'video',
      initialParams: { replacesNodeId: 'video-1' },
    }],
    {
      ...snapshot,
      nodes: snapshot.nodes.map((node) => (
        node.id === 'video-1' ? { ...node, agentRebuildCount: 3 } : node
      )),
    },
  ),
  /已重建 3 次/,
);
assert.equal(
  choiceActions(snapshot, [{ nodeId: 'image-1', label: 'hero', failed: false }], 'redo')[0]?.type,
  'execute_node_skill',
);
assert.equal(mentionQueryAt('参考 @he', 7), 'he');
assert.equal(insertMention('参考 @he', 7, 'image-1'), '参考 {{image-1}} ');
assert.equal(insertMention('用 @', 3, { kind: 'model', id: 'hailuo-h3' }), '用 使用模型 hailuo-h3 ');
assert.equal(mentionChipToken({ kind: 'model', id: 'nano-banana-pro' }), '使用模型 nano-banana-pro');
assert.equal(mentionChipToken({ kind: 'node', id: 'img_role_1' }), '{{img_role_1}}');
assert.equal(stripMentionQuery('一章 @nan', '一章 @nan'.length), '一章 ');
const named = mentionCandidates({
  ...snapshot,
  nodes: [{ id: 'image-9', type: 'image', url: '/uploads/hero.png', floatTitle: '圣诞老人三视图' }],
});
assert.equal(named[0]?.label, '圣诞老人三视图');
assert.equal(named[0]?.thumb, '/uploads/gallery/hero_thumb.webp');
const titledOverFile = mentionCandidates({
  ...snapshot,
  nodes: [{ id: 'image-8', type: 'image', url: '/uploads/a.png', name: 'canvas-output-1.jpg', title: '阿波罗' }],
});
assert.equal(titledOverFile[0]?.label, '阿波罗');
assert.equal(mentionTitleToStore('阿波罗'), '阿波罗');
assert.equal(mentionTitleToStore('canvas-output-1.jpg'), '');
assert.equal(mentionTitleToStore('  '), '');
const mentionModels = {
  fromConfig: true,
  image: [{ id: 'runninghub', models: [
    'gpt-image-2', 'gpt-image-2-稳定', 'gpt-image-2.5',
    'nano-banana-pro', 'nano-banana-pro-稳定', 'nano-banana-2', 'nano-banana-2.1',
    'midjourneyV8.1', 'niji7',
  ] }],
  chat: [{ id: 'runninghub', models: [
    'gemini-3.5-flash', 'glm-5.1', 'gemini-3.1-pro-preview',
    'gemini-1.5-pro-preview-05-08', 'gpt-4o-mini',
  ] }],
  video: ['hailuo-h3', 'seedance-2.0'],
};
const menu = mentionModelCandidates(mentionModels);
const imageMenu = menu.filter((item) => item.group === '图片');
const chatMenu = menu.filter((item) => item.group === '文本');
const videoMenu = menu.filter((item) => item.group === '视频');
assert.equal(imageMenu.length, 9);
assert.ok(imageMenu.some((item) => item.id === 'nano-banana-pro-稳定' && item.label === 'nano-banana-pro-稳定'));
assert.ok(imageMenu.some((item) => item.id === 'midjourneyV8.1' && item.label === 'midjourneyV8.1'));
assert.ok(imageMenu.some((item) => item.id === 'niji7' && item.label === 'niji7'));
assert.equal(chatMenu.length, 5);
assert.equal(videoMenu.length, 2);
assert.ok(menu.some((item) => item.id === 'nano-banana-2.1' && item.group === '图片'));
assert.ok(menu.some((item) => item.id === 'seedance-2.0' && item.label === 'Seedance 2.0'));
const hailuo = menu.find((item) => item.label === '海螺 H3');
assert.equal(hailuo?.id, 'hailuo-h3');
assert.equal(insertMention('用 @', 3, hailuo || { kind: 'model', id: '' }), '用 使用模型 hailuo-h3 ');
assert.deepEqual(
  historyPieces('{{img_a}} 是阿波罗。{{img_b}} 是神殿。使用模型 hailuo-h3。'),
  [
    { type: 'node', id: 'img_a' },
    { type: 'text', text: ' 是阿波罗。' },
    { type: 'node', id: 'img_b' },
    { type: 'text', text: ' 是神殿。' },
    { type: 'model', id: 'hailuo-h3' },
    { type: 'text', text: '。' },
  ],
);
const withNewImage = mentionModelCandidates({
  ...mentionModels,
  image: [{ id: 'runninghub', models: [...mentionModels.image[0].models, 'brand-new-image-model'] }],
});
assert.equal(withNewImage.filter((item) => item.group === '图片').length, 10);
assert.ok(withNewImage.some((item) => item.id === 'brand-new-image-model' && item.label === 'brand-new-image-model'));
const localMenu = mentionModelCandidates({
  fromConfig: false,
  image: [{ id: 'runninghub', models: ['gpt-image-2', 'nano-banana-pro'] }],
  chat: [],
  video: ['hailuo-h3', 'seedance-2.0'],
});
assert.equal(localMenu.filter((item) => item.group === '图片').map((item) => item.id).join(','), 'gpt-image-2,nano-banana-pro');
assert.equal(localMenu.find((item) => item.id === 'hailuo-h3')?.label, '海螺 H3');
assert.deepEqual(mentionModelCandidates(undefined), []);
assert.deepEqual(mentionModelCandidates({ fromConfig: false, image: [], chat: [], video: [] }), []);
assert.equal(nodeHasGeneratedOutput({ id: 'script-1', type: 'screenwritingAgent', outputText: '第一场' }), true);
assert.equal(nodeHasGeneratedOutput({ id: 'prompt-only', type: 'prompt', text: '雨夜追逐' }), true);
assert.equal(
  invalidationActions(snapshot, [{
    type: 'update_node_params',
    nodeId: 'prompt-1',
    patch: { text: '改后的追逐' },
  }]).find((item) => item.nodeId === 'image-1')?.patch.agentStale,
  true,
);
assert.equal(nodeHasGeneratedOutput({ id: 'old-gen', type: 'generator', previewRoundUrls: ['/old.png'] }), false);
const disabledContext = collectCanvasContext({
  ...snapshot,
  nodes: [
    { id: 'off', type: 'prompt', text: '不要用', disabled: true },
    {
      id: 'shot',
      type: 'generator',
      agentSources: [{ id: 'on', type: 'prompt', label: '用', prompt: '用' }],
    },
    { id: 'on', type: 'prompt', text: '用' },
  ],
  connections: [
    { id: 'a', from: 'off', to: 'shot' },
    { id: 'b', from: 'on', to: 'shot' },
  ],
  selectedNodeIds: ['shot'],
});
assert.equal(disabledContext.upstreamLineage.find((node) => node.id === 'off')?.enabled, false);
assert.equal(disabledContext.upstreamLineage.find((node) => node.id === 'on')?.enabled, true);
assert.equal(disabledContext.activeSelectedNodes[0]?.enabled, undefined);
assert.ok(
  !(disabledContext.activeSelectedNodes[0]?.agentSources as Array<{ id: string }> | undefined)
    ?.some((source) => source.id === 'off'),
);
assert.match(serializeCanvasContext(snapshot), /enabled 为 false 的上游不会参与生成/);
assert.match(
  serializeCanvasContext(snapshot),
  /agentLastError 里如果出现「可选值见上下文的 availableModels」，说明该节点上次因模型值无效被拒绝。换一个 availableModels 里列出的值重新提交即可，不需要重建节点。/,
);
const blankSnapshot: CanvasSnapshot = {
  ...snapshot,
  nodes: [...snapshot.nodes, { id: 'blank-1', type: 'generator' }],
};
assert.equal(
  invalidationActions(blankSnapshot, [{
    type: 'connect_nodes',
    sourceNodeId: 'prompt-1',
    targetNodeId: 'blank-1',
  }]).some((item) => item.nodeId === 'blank-1'),
  false,
);
const effectiveSnapshot: CanvasSnapshot = {
  ...snapshot,
  nodes: snapshot.nodes.map((node) => (
    node.id === 'video-1' ? { ...node, url: '/uploads/clip.mp4' } : node
  )),
};
assert.equal(nodeLifecycle(effectiveSnapshot.nodes.find((node) => node.id === 'video-1')), 'effective');
assert.equal(
  invalidationActions(effectiveSnapshot, [{
    type: 'connect_nodes',
    sourceNodeId: 'prompt-1',
    targetNodeId: 'video-1',
  }]).find((item) => item.nodeId === 'video-1')?.patch.agentStale,
  true,
);
const freshPrompt: CanvasSnapshot = {
  ...snapshot,
  nodes: [...snapshot.nodes, { id: 'cat', type: 'prompt', text: 'a cat' }],
};
assert.equal(nodeHasGeneratedOutput(freshPrompt.nodes.find((node) => node.id === 'cat')), true);
assert.equal(
  invalidationActions(freshPrompt, [
    { type: 'create_node', tempId: 'cat', nodeType: 'prompt', initialParams: { text: 'a cat' } },
    { type: 'connect_nodes', sourceNodeId: 'prompt-1', targetNodeId: 'cat' },
  ]).some((item) => item.nodeId === 'cat'),
  false,
);

function failedProposal(
  id: string,
  error: string,
  createdAt: number,
  extra: Partial<ActionProposal> = {},
): ActionProposal {
  return {
    id,
    title: '建议',
    summary: '新增',
    actions: [],
    status: 'failed',
    requiresApproval: true,
    generative: false,
    createdAt,
    error,
    ...extra,
  };
}

let missingParam = '';
try {
  assertAgentActionContent({
    type: 'create_node',
    tempId: 'side',
    nodeType: 'generator',
    initialParams: {},
  }, snapshot);
} catch (error) {
  missingParam = error instanceof Error ? error.message : String(error);
}
assert.match(missingParam, /缺少必填参数 prompt/);
const history = [{ role: 'user' as const, content: '画侧面' }];
const missing = pendingExecutionFeedback([failedProposal('miss', missingParam, 1)]);
assert.ok(missing);
const outbound = [...history, { role: 'user' as const, content: missing.content }];
assert.equal(history.length, 1);
assert.match(outbound[1].content, /\[系统反馈\] 上一轮提交的操作未能应用：/);
assert.match(outbound[1].content, /缺少必填参数 prompt/);
assert.match(outbound[1].content, /这是执行结果，不是用户诉求。请修正后重新提交。/);
assert.equal(
  pendingExecutionFeedback([failedProposal('miss', missingParam, 1, { feedbackDeliveredAt: 9 })]),
  null,
);
const tempIdError = 'tempId "shot" 重复，第 1 个和第 2 个节点都用了它';
const carriedTemp = pendingExecutionFeedback([failedProposal('temp', tempIdError, 1)]);
assert.match(carriedTemp?.content || '', /tempId "shot" 重复/);
assert.equal(
  pendingExecutionFeedback([
    failedProposal('temp', tempIdError, 1, { feedbackDeliveredAt: 9 }),
    failedProposal('ok', '', 2, { status: 'applied', error: undefined }),
  ]),
  null,
);
const duplicate = pendingExecutionFeedback([
  failedProposal('old', 'tempId "shot" 重复，第 1 个和第 2 个节点都用了它', 1),
  failedProposal('new', 'Invalid canvas connection: a -> b', 2),
]);
assert.equal(duplicate?.id, 'new');
assert.match(duplicate?.content || '', /Invalid canvas connection: a -> b/);
assert.match(duplicate?.content || '', /不是用户诉求/);
assert.equal(
  pendingExecutionFeedback([failedProposal('gone', missingParam, 1, { status: 'expired', error: undefined })]),
  null,
);
const partial = pendingExecutionFeedback([{
  ...failedProposal('part', '3 个节点已执行，2 个节点被跳过', 4),
  status: 'partial',
  partialSkipped: 2,
}]);
assert.match(partial?.content || '', /3 个节点已执行，2 个节点因超时或超出批次数上限被跳过/);
assert.match(partial?.content || '', /被跳过的节点没有产出，也没有失败记录/);
assert.doesNotMatch(partial?.content || '', /请修正后重新提交/);
const overflowPatch = partialBatchUpdate(13, 1);
assert.equal(overflowPatch.status, 'partial');
if (overflowPatch.status === 'partial') {
  assert.equal(overflowPatch.partialSkipped, 1);
  assert.match(overflowPatch.error, /12 个节点已执行，1 个节点因超时或超出批次数上限被跳过/);
}
assert.deepEqual(partialBatchUpdate(3, 0), { status: 'applied' });
const cardHtml = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: {
    ...failedProposal('card', overflowPatch.status === 'partial' ? overflowPatch.error : '', 8),
    ...overflowPatch,
  },
  onApply() {},
  onDiscard() {},
}));
assert.match(cardHtml, /部分完成/);
assert.doesNotMatch(cardHtml, /已应用/);
assert.match(cardHtml, /1 个节点被跳过，没有产出/);
const execOnly = settleBatchProposal(1, 0, { nodeId: 'gen_1', message: '节点 gen_1 没有内容，无法执行。' });
assert.equal(execOnly.status, 'exec_failed');
if (execOnly.status === 'exec_failed') {
  assert.equal(execOnly.error, '节点 gen_1 没有内容，无法执行。');
  assert.equal(execOnly.partialSkipped, undefined);
}
const execThenSkip = settleBatchProposal(2, 1, { nodeId: 'gen_1', message: '节点 gen_1 没有内容，无法执行。' });
assert.equal(execThenSkip.status, 'exec_failed');
if (execThenSkip.status === 'exec_failed') assert.equal(execThenSkip.partialSkipped, 1);
assert.equal(settleBatchProposal(1, 0).status, 'applied');
const execFeedback = pendingExecutionFeedback([failedProposal('exec', '节点 gen_1 没有内容，无法执行。', 5, { status: 'exec_failed' })]);
assert.match(execFeedback?.content || '', /上一轮的结构操作已应用，但执行失败：节点 gen_1 没有内容，无法执行。/);
assert.match(execFeedback?.content || '', /不要重新创建该节点/);
assert.doesNotMatch(execFeedback?.content || '', /未能应用/);
assert.doesNotMatch(execFeedback?.content || '', /请修正后重新提交/);
const execSkipFeedback = pendingExecutionFeedback([failedProposal('exec2', '节点 gen_1 没有内容，无法执行。', 6, {
  status: 'exec_failed',
  partialSkipped: 1,
})]);
assert.match(execSkipFeedback?.content || '', /不要重新创建该节点/);
assert.match(execSkipFeedback?.content || '', /1 个节点因上一条执行失败而未执行/);
const execCard = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: failedProposal('exec-card', '节点 gen_1 没有内容，无法执行。', 7, { status: 'exec_failed' }),
  onApply() {},
  onDiscard() {},
}));
assert.match(execCard, /已创建，执行失败/);
assert.match(execCard, /is-exec_failed/);
assert.match(execCard, /节点 gen_1 没有内容，无法执行。/);
assert.doesNotMatch(execCard, /部分完成/);
assert.doesNotMatch(execCard, />失败</);

const keptError = 'RunningHub 任务失败 [1011]：busy';
const reopenedFailed = proposalOnReopen({
  status: 'exec_failed' as const,
  error: keptError,
  partialSkipped: 1,
});
assert.equal(reopenedFailed.status, 'exec_failed');
assert.equal(reopenedFailed.error, keptError);
assert.equal(reopenedFailed.partialSkipped, 1);
const reopenedPending = proposalOnReopen({ status: 'pending' as const, error: '结构错', partialSkipped: null });
assert.equal(reopenedPending.status, 'expired', '只剩运行的 pending 重开即过期');
assert.equal(reopenedPending.error, '结构错');
assert.equal(reopenedPending.partialSkipped, null);
// 有结构动作、且一次都没开始过：重开留着，用户还能点。
const reopenedStructural = proposalOnReopen({
  status: 'pending' as const,
  actions: [{ type: 'create_node' }],
});
assert.equal(reopenedStructural.status, 'pending');
// applying 说明报过开始、结果没写回来：再点可能重复建节点，必须过期。
const reopenedApplying = proposalOnReopen({ status: 'applying' as const, actions: [{ type: 'create_node' }] });
assert.equal(reopenedApplying.status, 'expired');
const reopenedApplied = proposalOnReopen({
  status: 'applied' as const,
  error: null,
  partialSkipped: null,
});
assert.equal(reopenedApplied.status, 'applied');
assert.equal(reopenedApplied.error, null);
assert.equal(reopenedApplied.partialSkipped, null);
const reopenedPartial = proposalOnReopen({
  status: 'partial' as const,
  error: '1 个节点已执行，1 个节点因超时或超出批次数上限被跳过。被跳过的节点没有产出。',
  partialSkipped: 1,
});
assert.equal(reopenedPartial.status, 'partial');
assert.equal(reopenedPartial.error, '1 个节点已执行，1 个节点因超时或超出批次数上限被跳过。被跳过的节点没有产出。');
assert.equal(reopenedPartial.partialSkipped, 1);
const reopenedApplyFailed = proposalOnReopen({
  status: 'failed' as const,
  error: 'tempId "shot" 重复，第 1 个和第 2 个节点都用了它',
  partialSkipped: null,
});
assert.equal(reopenedApplyFailed.status, 'failed');
assert.equal(reopenedApplyFailed.error, 'tempId "shot" 重复，第 1 个和第 2 个节点都用了它');
assert.equal(reopenedApplyFailed.partialSkipped, null);

const outcomeDb = new Database(':memory:');
initCanvasAgentConversationSchema(outcomeDb);
const outcomeConversation = createCanvasAgentConversation(outcomeDb, 'user-1', 'canvas-outcome');
const outcomeQueue = new Set<string>();
const outcomeMemory = new Map<string, ActionProposal>();

function rememberOutcome(id: string, patch: Partial<ActionProposal>) {
  const previous = outcomeMemory.get(id);
  if (!previous) return;
  outcomeMemory.set(id, { ...previous, ...patch });
}

function seedOutcome(proposal: ActionProposal) {
  outcomeMemory.set(proposal.id, proposal);
}

async function writeOutcome(current: ActionProposal): Promise<number> {
  return updateCanvasAgentProposalOutcome(
    outcomeDb,
    'user-1',
    current.id,
    diskProposalOutcome(current),
  );
}

const raceProposal: ActionProposal = {
  id: 'proposal-race',
  title: '建议',
  summary: '运行 2 个技能',
  actions: [
    { type: 'execute_node_skill', nodeId: 'gen-a' },
    { type: 'execute_node_skill', nodeId: 'gen-b' },
  ],
  status: 'pending',
  requiresApproval: true,
  generative: true,
  createdAt: 1,
};
seedOutcome(raceProposal);
const raceResult = await runProposalApply(raceProposal, {
  batchApply: async () => ({
    skippedCount: 1,
    failedExecution: { nodeId: 'gen-a', message: keptError },
    choices: [],
  }),
  update: rememberOutcome,
  current: () => outcomeMemory.get(raceProposal.id),
  persist: writeOutcome,
  queue: outcomeQueue,
});
assert.notEqual(raceResult, 'rejected');
assert.equal(outcomeQueue.has(raceProposal.id), true);
appendCanvasAgentMessage(outcomeDb, 'user-1', outcomeConversation.id, 'assistant', '建议', {
  proposal: { ...raceProposal, status: 'pending' },
  toolLogs: [{ id: 'tool-1', name: 'trigger_skill_execution', label: 'trigger skill execution', state: 'queued' }],
});
let streamCaught = false;
let turnFinished = '';
try {
  deliverProposalDone(raceProposal.id, (id) => {
    turnFinished = id;
  }, () => {
    flushProposalWriteQueue(outcomeQueue, (id) => outcomeMemory.get(id), writeOutcome);
  });
} catch {
  streamCaught = true;
}
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(streamCaught, false);
assert.equal(turnFinished, raceProposal.id);
assert.equal(outcomeQueue.size, 0);
const raceRow = outcomeDb.prepare(
  `SELECT metadata_json FROM canvas_agent_messages
   WHERE json_extract(metadata_json, '$.proposal.id') = ?`,
).get(raceProposal.id) as { metadata_json: string };
const raceMeta = JSON.parse(raceRow.metadata_json) as {
  proposal: { status: string; error: string | null; partialSkipped: number | null };
  toolLogs: Array<{ id: string }>;
};
assert.equal(raceMeta.proposal.status, 'exec_failed');
assert.equal(raceMeta.proposal.error, keptError);
assert.equal(raceMeta.proposal.partialSkipped, 1);
assert.equal(raceMeta.toolLogs[0]?.id, 'tool-1');

const appliedProposal: ActionProposal = {
  ...raceProposal,
  id: 'proposal-applied',
  actions: [{ type: 'execute_node_skill', nodeId: 'gen-c' }],
  summary: '运行 1 个技能',
};
seedOutcome(appliedProposal);
appendCanvasAgentMessage(outcomeDb, 'user-1', outcomeConversation.id, 'assistant', '已可写', {
  proposal: { ...appliedProposal, status: 'pending' },
  toolLogs: [{ id: 'tool-2', name: 'trigger_skill_execution', label: 'trigger skill execution', state: 'queued' }],
});
const appliedQueue = new Set<string>();
await runProposalApply(appliedProposal, {
  batchApply: async () => ({ skippedCount: 0, choices: [] }),
  update: rememberOutcome,
  current: () => outcomeMemory.get(appliedProposal.id),
  persist: writeOutcome,
  queue: appliedQueue,
});
assert.equal(appliedQueue.size, 0);
const appliedRow = outcomeDb.prepare(
  `SELECT metadata_json FROM canvas_agent_messages
   WHERE json_extract(metadata_json, '$.proposal.id') = ?`,
).get(appliedProposal.id) as { metadata_json: string };
const appliedMeta = JSON.parse(appliedRow.metadata_json) as {
  proposal: { status: string; error: string | null; partialSkipped: number | null; droppedConnects: number | null };
  toolLogs: Array<{ id: string }>;
};
assert.equal(appliedMeta.proposal.status, 'applied');
assert.equal(appliedMeta.proposal.error, null);
assert.equal(appliedMeta.proposal.partialSkipped, null);
assert.equal(appliedMeta.proposal.droppedConnects, null);
assert.equal(appliedMeta.toolLogs[0]?.id, 'tool-2');

const strippedProposal: ActionProposal = {
  ...appliedProposal,
  id: 'proposal-stripped',
  status: 'pending',
  actions: [
    { type: 'create_node', tempId: 'vid', nodeType: 'video', initialParams: { prompt: '画面' } },
    { type: 'connect_nodes', sourceNodeId: 'img_a', targetNodeId: 'vid' },
    { type: 'connect_nodes', sourceNodeId: 'img_b', targetNodeId: 'vid' },
  ],
};
seedOutcome(strippedProposal);
await runProposalApply(strippedProposal, {
  batchApply: async () => ({ skippedCount: 0, choices: [], droppedConnects: 2 }),
  update: rememberOutcome,
  current: () => outcomeMemory.get(strippedProposal.id),
  persist: async () => 0,
  queue: new Set(),
});
const strippedSaved = outcomeMemory.get(strippedProposal.id);
assert.equal(strippedSaved?.status, 'applied');
assert.equal(strippedSaved?.droppedConnects, 2);
const strippedFeedback = pendingExecutionFeedback(strippedSaved ? [strippedSaved] : []);
assert.match(strippedFeedback?.content || '', /\[系统反馈\] 上一轮有 2 条连线因为没被点名而被拿掉，节点已建但没有参考图/);
assert.equal(pendingExecutionFeedback([failedProposal('plain-applied', '', 3, { status: 'applied' })]), null);

const impactProposal: ActionProposal = {
  ...raceProposal,
  id: 'proposal-impact',
  actions: [{ type: 'create_node', nodeType: 'generator', initialParams: { prompt: 'x' } }],
  generative: false,
  inLibrary: false,
  summary: '新建替换',
};
seedOutcome(impactProposal);
const impactQueue = new Set<string>();
await runProposalApply(impactProposal, {
  batchApply: async () => ({ skippedCount: 0, choices: [] }),
  update: rememberOutcome,
  current: () => outcomeMemory.get(impactProposal.id),
  persist: writeOutcome,
  queue: impactQueue,
});
assert.equal(impactQueue.size, 0);
const impactRow = outcomeDb.prepare(
  `SELECT id FROM canvas_agent_messages
   WHERE json_extract(metadata_json, '$.proposal.id') = ?`,
).get(impactProposal.id);
assert.equal(impactRow, undefined);

const abortQueue = new Set<string>(['proposal-abort']);
appendCanvasAgentMessage(outcomeDb, 'user-1', outcomeConversation.id, 'assistant', '未补', {
  proposal: { ...raceProposal, id: 'proposal-abort', status: 'pending' },
});
let abortFlushed = false;
const onAbortOrDone = (eventType: string) => {
  if (eventType !== 'done') return;
  abortFlushed = true;
  flushProposalWriteQueue(abortQueue, () => undefined, writeOutcome);
};
onAbortOrDone('error');
assert.equal(abortFlushed, false);
assert.equal(abortQueue.has('proposal-abort'), true);
const abortRow = outcomeDb.prepare(
  `SELECT metadata_json FROM canvas_agent_messages
   WHERE json_extract(metadata_json, '$.proposal.id') = ?`,
).get('proposal-abort') as { metadata_json: string };
assert.equal(JSON.parse(abortRow.metadata_json).proposal.status, 'pending');

let batchCalled = false;
const rejected = await runProposalApply(
  { ...raceProposal, id: 'proposal-closed', status: 'exec_failed', error: keptError },
  {
    batchApply: async () => {
      batchCalled = true;
      return { skippedCount: 0, choices: [] };
    },
    update: rememberOutcome,
    current: () => undefined,
    persist: writeOutcome,
    queue: new Set(),
  },
);
assert.equal(rejected, 'rejected');
assert.equal(batchCalled, false);

const warnings: unknown[][] = [];
const previousWarn = console.warn;
console.warn = (...args: unknown[]) => {
  warnings.push(args);
};
let flushLeaked = false;
let bubbleFinished = '';
let streamFinally = false;
try {
  deliverProposalDone('bubble-1', (id) => {
    bubbleFinished = id;
  }, () => {
    throw new Error('SQL boom');
  });
  flushProposalWriteQueue(new Set(['proposal-race']), () => outcomeMemory.get('proposal-race'), async () => {
    throw new Error('connection failed');
  });
} catch {
  flushLeaked = true;
} finally {
  streamFinally = true;
}
await new Promise((resolve) => setTimeout(resolve, 20));
console.warn = previousWarn;
assert.equal(flushLeaked, false);
assert.equal(streamFinally, true);
assert.equal(bubbleFinished, 'bubble-1');
assert.equal(warnings.length >= 2, true);

const displaySource = [
  failedProposal('fail-old', '旧失败', 10, { status: 'failed' }),
  failedProposal('exec-new', '新执行失败', 40, { status: 'exec_failed' }),
  failedProposal('partial-mid', '部分', 20, { status: 'partial', partialSkipped: 1 }),
  failedProposal('pending-new', '', 50, { status: 'pending' }),
  failedProposal('pending-old', '', 30, { status: 'pending' }),
  failedProposal('applying-mid', '', 35, { status: 'applying' }),
  failedProposal('applied-new', '', 60, { status: 'applied' }),
  failedProposal('applied-old', '', 5, { status: 'applied' }),
  failedProposal('expired-mid', '过期错误', 25, { status: 'expired' }),
  failedProposal('discarded-old', '', 15, { status: 'discarded' }),
];
const shown = sortProposalsForDisplay(displaySource);
assert.deepEqual(displaySource.map((item) => item.id), [
  'fail-old', 'exec-new', 'partial-mid', 'pending-new', 'pending-old',
  'applying-mid', 'applied-new', 'applied-old', 'expired-mid', 'discarded-old',
]);
assert.deepEqual(shown.map((item) => item.id), [
  'pending-new', 'applying-mid', 'pending-old',
  'exec-new', 'partial-mid', 'fail-old',
  'applied-new', 'expired-mid', 'discarded-old', 'applied-old',
]);
assert.equal(PROPOSAL_OPEN_CAP, 2);
let tier12Index = 0;
const defaultOpen = shown.map((item) => {
  const index = item.status === 'applied' || item.status === 'expired' || item.status === 'discarded'
    ? -1
    : tier12Index++;
  return proposalDefaultOpen(item.status, index);
});
assert.deepEqual(defaultOpen, [true, true, false, false, false, false, false, false, false, false]);
const openOverride: Record<string, boolean> = { 'fail-old': true };
assert.deepEqual(sortProposalsForDisplay(displaySource).map((item) => item.id), shown.map((item) => item.id));
assert.equal(openOverride['fail-old'], true);
const onlyResults = sortProposalsForDisplay([
  failedProposal('f1', 'a', 1, { status: 'failed' }),
  failedProposal('f3', 'c', 3, { status: 'exec_failed' }),
  failedProposal('f2', 'b', 2, { status: 'partial' }),
  failedProposal('done', '', 4, { status: 'applied' }),
]);
assert.deepEqual(onlyResults.map((item) => item.id), ['f3', 'f2', 'f1', 'done']);
let resultIndex = 0;
assert.deepEqual(onlyResults.map((item) => {
  const index = item.status === 'applied' ? -1 : resultIndex++;
  return proposalDefaultOpen(item.status, index);
}), [true, true, false, false]);
const feedback = pendingExecutionFeedback(displaySource);
assert.equal(feedback?.id, 'exec-new');
assert.equal(pendingExecutionFeedback(shown)?.id, 'exec-new');
assert.notEqual(shown[0].id, feedback?.id);
const foldedProposal = {
  ...failedProposal('folded', '错误不该露出', 9, { status: 'applied' as const }),
  summary: '摘要不该露出',
  actions: [{ type: 'create_node' as const, tempId: 'n', nodeType: 'prompt' as const, initialParams: { text: 'a', name: '侧面' } }],
};
const folded = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: foldedProposal,
  open: false,
  onToggle() {},
  onApply() {},
  onDiscard() {},
}));
assert.match(folded, /已应用/);
assert.match(folded, /aria-expanded="false"/);
assert.doesNotMatch(folded, /摘要不该露出/);
assert.doesNotMatch(folded, /侧面/);
assert.doesNotMatch(folded, /错误不该露出/);
const unfolded = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: foldedProposal,
  open: true,
  onToggle() {},
  onApply() {},
  onDiscard() {},
}));
assert.match(unfolded, /aria-expanded="true"/);
assert.match(unfolded, /摘要不该露出/);
assert.match(unfolded, /新增 侧面/);
assert.deepEqual(sortProposalsForDisplay([foldedProposal, ...displaySource]).map((item) => item.status).slice(0, 3), [
  'pending', 'applying', 'pending',
]);
const pendingHtml = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: failedProposal('pending-look', '', 50, { status: 'pending' }),
  onApply() {},
  onDiscard() {},
}));
const expiredHtml = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: failedProposal('expired-look', '过期错误', 25, { status: 'expired' }),
  open: false,
  onApply() {},
  onDiscard() {},
}));
assert.match(pendingHtml, /canvas-agent-proposal is-pending/);
assert.match(pendingHtml, /待确认/);
assert.doesNotMatch(pendingHtml, /is-expired/);
const updateRunCard = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: {
    id: 'update-run',
    title: 'Agent 画布操作建议',
    summary: '更新 1 个节点，运行 1 个技能',
    actions: [
      { type: 'update_node_params', nodeId: 'gen_anchor', patch: { prompt: '诸葛亮' } },
      { type: 'execute_node_skill', nodeId: 'gen_anchor' },
    ],
    status: 'pending',
    requiresApproval: true,
    generative: true,
    createdAt: 1,
    userMessage: '一章 30 秒。三国题材，主角是诸葛亮，在帐中备战。',
  },
  onApply() {},
  onDiscard() {},
}));
assert.match(updateRunCard, /待确认/);
assert.match(updateRunCard, /更新 gen_anchor/);
assert.match(updateRunCard, /运行 gen_anchor/);
assert.match(updateRunCard, /一键应用到画布/);
assert.doesNotMatch(updateRunCard, /已应用/);
const runOnlyCard = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: {
    id: 'run-only',
    title: 'Agent 画布操作建议',
    summary: '运行 1 个技能',
    actions: [{ type: 'execute_node_skill', nodeId: 'vid_a' }],
    status: 'pending',
    requiresApproval: true,
    generative: true,
    createdAt: 1,
  },
  onApply() {},
  onDiscard() {},
}));
assert.match(runOnlyCard, /等审批卡/);
assert.doesNotMatch(runOnlyCard, /一键应用到画布/);
assert.doesNotMatch(runOnlyCard, /放弃/);
assert.doesNotMatch(updateRunCard, /update node config/);
assert.equal(proposalWaitsForClick('confirm', {
  actions: [{ type: 'update_node_params', nodeId: 'gen_anchor', patch: {} }],
}), true);
assert.equal(proposalWaitsForClick('auto', {
  actions: [
    { type: 'update_node_params', nodeId: 'gen_anchor', patch: {} },
    { type: 'execute_node_skill', nodeId: 'gen_anchor' },
  ],
}), false);
assert.equal(proposalWaitsForClick('auto', {
  actions: [{ type: 'update_node_params', nodeId: 'gen_anchor', patch: {} }],
}), false);
assert.equal(proposalWaitsForClick('auto', {
  actions: [{ type: 'execute_node_skill', nodeId: 'gen_anchor' }],
}), true);
assert.equal(listedNodeIds({ nodeIds: 'gen_anchor' })[0], 'gen_anchor');
assert.equal(listedNodeIds({ nodeId: 'gen_anchor' })[0], 'gen_anchor');
assert.equal(listedRecords({ nodeId: 'gen_anchor', patch: { prompt: 'a' } }).length, 1);
const toolShaped = `\`\`\`json
{
  "actions": [
    {
      "type": "create_canvas_nodes",
      "nodes": [{
        "tempId": "anchor_zhuge",
        "nodeType": "generator",
        "initialParams": { "prompt": "诸葛亮", "reason": "创建跨段存活的角色锚点（诸葛亮）" }
      }],
      "rationale": "总时长 30 秒超过单段 15 秒上限，采用分段生成形态。"
    },
    { "type": "trigger_skill_execution", "nodeIds": ["anchor_zhuge"] }
  ],
  "summary": "总时长 30 秒将拆为 2 段。已提议创建诸葛亮的角色锚点并生成。"
}
\`\`\`
总时长 30 秒已超过单段上限。`;
const interpreted = interpretCanvasProposalText(toolShaped);
assert.ok(interpreted);
assert.equal(interpreted.actions[0]?.type, 'create_node');
assert.equal(interpreted.actions[0]?.type === 'create_node' ? interpreted.actions[0].tempId : '', 'anchor_zhuge');
assert.equal(interpreted.actions[0]?.type === 'create_node' ? interpreted.actions[0].initialParams?.reason : '', '创建跨段存活的角色锚点（诸葛亮）');
assert.equal(interpreted.actions[0]?.type === 'create_node' ? 'rationale' in (interpreted.actions[0].initialParams || {}) : true, false);
assert.equal(interpreted.actions[1]?.type, 'execute_node_skill');
assert.equal(interpreted.actions[1]?.type === 'execute_node_skill' ? interpreted.actions[1].nodeId : '', 'anchor_zhuge');
assert.equal(interpreted.summary, '总时长 30 秒将拆为 2 段。已提议创建诸葛亮的角色锚点并生成。');
assert.doesNotMatch(interpreted.prose, /create_canvas_nodes|anchor_zhuge/);
assert.match(interpreted.prose, /总时长 30 秒已超过单段上限/);
const sameSentence: ActionProposal = {
  id: 'tool-shaped',
  title: 'Agent 建议新增 1 个工作流节点',
  summary: interpreted.summary,
  actions: interpreted.actions,
  status: 'pending',
  requiresApproval: true,
  generative: interpreted.actions.some((action) => action.type === 'execute_node_skill'),
  createdAt: 1,
  userMessage: '一章 30 秒。三国题材，主角是诸葛亮，在帐中备战。',
};
assert.equal(sameSentence.generative, true);
assert.equal(proposalWaitsForClick('confirm', sameSentence), true);
const shortYesCreate = [
  { type: 'create_node' as const, tempId: 'v', nodeType: 'video' as const, initialParams: { prompt: '分镜' } },
  { type: 'connect_nodes' as const, sourceNodeId: 'img', targetNodeId: 'v' },
];
const appliedYes = stripCreatesOnShortYes(shortYesCreate, '好的');
assert.equal(appliedYes.some((action) => action.type === 'create_node'), false);
assert.equal(appliedYes.length, 0);
assert.deepEqual(stripCreatesOnShortYes([{ type: 'execute_node_skill', nodeId: 'vid_a' }], '确认'), []);
assert.equal(stripCreatesOnShortYes([{ type: 'execute_node_skill', nodeId: 'vid_a' }], '符合预期').length, 1);
assert.equal(stripCreatesOnShortYes(shortYesCreate, '改成远景').some((action) => action.type === 'create_node'), true);
const cardYes = parseAskAnswer({ cardId: 'c', mode: 'single', selected: ['确认'] });
const cardGate = cardYes ? '' : '确认';
assert.equal(cardGate, '');
assert.equal(stripCreatesOnShortYes(shortYesCreate, cardGate).some((action) => action.type === 'create_node'), true);
const asked = normalizeAskCards({ mode: 'single', question: '多少秒？', options: [{ type: 'text', label: '6' }] });
assert.equal(asked[0]?.options.some((item) => item.type === 'input'), true);
const runCard = withRunApproval([{ ...asked[0], id: 'q' }], ['vid_a', 'vid_b']);
assert.equal(runCard.at(-1)?.mode, 'approve_run_node');
assert.deepEqual(runCard.at(-1)?.options, [{ type: 'text', label: '批准' }, { type: 'text', label: '拒绝' }]);
assert.deepEqual(runCard.at(-1)?.node_keys, ['vid_a', 'vid_b']);
assert.equal(parseAskAnswer({ cardId: 'ask-run', mode: 'approve_run_node', selected: ['批准'], input: '改一下' }), null);
assert.equal(approveRunCard([]) , null);
const askHtml = renderToStaticMarkup(createElement(AskCardView, { card: asked[0], onSubmit() {} }));
assert.match(askHtml, /自己写/);
const runHtml = renderToStaticMarkup(createElement(AskCardView, { card: runCard.at(-1)!, onSubmit() {} }));
assert.match(runHtml, /批准/);
assert.match(runHtml, /拒绝/);
assert.doesNotMatch(runHtml, /自己写/);
assert.doesNotMatch(runHtml, /忽略/);
// 卡上给用户看节点名，不放 id；id 只留在 title 里兜底。
const labeledRun = renderToStaticMarkup(createElement(AskCardView, {
  card: runCard.at(-1)!,
  nodeLabels: { vid_a: '阿波罗开场 10 秒' },
  onSubmit() {},
}));
assert.match(labeledRun, /阿波罗开场 10 秒/);
assert.doesNotMatch(labeledRun, />vid_a</);
// 提案动作行也是节点名，不是 id。
assert.equal(
  actionDisplayLabel({ type: 'execute_node_skill', nodeId: 'vid_a' }, [], (id) => (id === 'vid_a' ? '阿波罗开场 10 秒' : id)),
  '运行 阿波罗开场 10 秒',
);
assert.equal(
  actionDisplayLabel({ type: 'connect_nodes', sourceNodeId: 'vid_a', targetNodeId: 'vid_b' }, [], (id) => (id === 'vid_a' ? '上游' : '下游')),
  '连接 上游 → 下游',
);
const skipped = defaultAskAnswer(asked[0]);
assert.equal(skipped.selected[0], '用默认');
assert.equal(parseAskAnswer(skipped)?.selected[0], '用默认');
assert.notEqual(parseAskAnswer(skipped), null);
const pagerHtml = renderToStaticMarkup(createElement(AskPager, {
  cards: [0, 1, 2, 3].map((index) => ({ ...asked[0], id: `ask-${index}`, question: `题${index + 1}` })),
  onSubmit() {},
}));
assert.match(pagerHtml, /1\/4/);
assert.match(pagerHtml, /忽略/);
assert.match(pagerHtml, /继续/);
assert.match(pagerHtml, /自己写/);
const crowded = renderToStaticMarkup(createElement(AskPager, {
  cards: [{
    ...asked[0],
    options: ['一', '二', '三', '四', '五'].map((label) => ({ type: 'text' as const, label })),
  }],
  onSubmit() {},
}));
assert.match(crowded, /自己写/);
assert.match(crowded, />一</);
assert.match(crowded, />三</);
assert.doesNotMatch(crowded, />四</);
assert.doesNotMatch(crowded, />五</);
assert.equal(mediaStatusLabel('generator', 'created'), '图片节点已创建');
assert.equal(mediaStatusLabel('generator', 'generated'), '图片已生成');
assert.equal(mediaStatusLabel('generator', 'failed'), '执行失败');
assert.equal(mediaStatusLabel('video', 'created'), '视频节点已创建');
assert.notEqual(mediaStatusLabel('image', 'created'), mediaStatusLabel('image', 'generated'));
assert.notEqual(mediaStatusLabel('image', 'generated'), mediaStatusLabel('image', 'failed'));
assert.equal(turnLabelCollapsed('thinking'), true);
assert.equal(turnLabelCollapsed('tools'), true);
assert.equal(turnLabelCollapsed('failed'), false);
assert.equal(turnLabelCollapsed('media'), false);
assert.equal(turnLabelCollapsed('asked'), false);
const turnLabelSource = readFileSync(new URL('./ui/TurnLabels.tsx', import.meta.url), 'utf8');
assert.match(turnLabelSource, /思考过程/);
assert.match(turnLabelSource, /<details/);
assert.match(turnLabelSource, /data-collapsed="false"/);
// 思考过程和参考平台一样默认展开，用户能直接看到分析。
assert.match(turnLabelSource, /<details[^>]*\bopen\b/);
assert.equal(mediaRunState({ id: 'gen', type: 'generator', agentLastError: { message: '跑失败' } }), 'failed');
assert.equal(mediaRunState({ id: 'gen', type: 'generator', url: '/uploads/a.png' }), 'generated');
assert.equal(mediaRunState({ id: 'gen', type: 'generator' }), 'created');
assert.equal(mediaStatusLabel('generator', mediaRunState({ id: 'gen', type: 'generator' })), '图片节点已创建');
assert.notEqual(mediaStatusLabel('generator', mediaRunState({ id: 'gen', type: 'generator' })), '已连线');
const strippedConnects = [
  { type: 'connect_nodes' as const, sourceNodeId: 'img_a', targetNodeId: 'vid' },
  { type: 'connect_nodes' as const, sourceNodeId: 'img_b', targetNodeId: 'vid' },
];
assert.equal(
  derivedStepTitle(strippedConnects, 2),
  '已连线（0 条，2 条因未点名被拿掉）',
);
assert.notEqual(derivedStepTitle(strippedConnects, 2), '已连线');
assert.equal(derivedStepTitle(strippedConnects, 0), '已连线');
assert.equal(derivedStepTitle([
  { type: 'create_node' as const, tempId: 'v', nodeType: 'video' as const, initialParams: {} },
  ...strippedConnects,
], 2), '节点已创建，已连线（0 条，2 条因未点名被拿掉）');
const liedConnectCard = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: {
    id: 'lied-connect',
    title: 'Agent 画布操作建议',
    summary: '连接 2 条边',
    actions: strippedConnects,
    status: 'applied',
    droppedConnects: 2,
    requiresApproval: true,
    generative: false,
    createdAt: 1,
    userMessage: '确认',
  },
  onApply() {},
  onDiscard() {},
}));
assert.match(liedConnectCard, /<h4>已连线（0 条，2 条因未点名被拿掉）<\/h4>/);
assert.match(liedConnectCard, /连接 2 条边/);
const markdownSample = renderToStaticMarkup(createElement(AssistantMarkdown, {
  text: '## 分镜\n\n**俯冲**\n\n- 睁眼\n\n> 停在这里\n\n| 镜 | 秒 |\n| --- | --- |\n| 俯冲 | 0-3 |\n\n---\n\n```\n{{img_a}}\n```\n',
}));
assert.match(markdownSample, /<h3>分镜<\/h3>/);
assert.match(markdownSample, /<strong>俯冲<\/strong>/);
assert.match(markdownSample, /<li>睁眼<\/li>/);
assert.match(markdownSample, /<blockquote>停在这里<\/blockquote>/);
assert.match(markdownSample, /<th>镜<\/th>/);
assert.match(markdownSample, /<td>0-3<\/td>/);
assert.match(markdownSample, /<hr\/>/);
assert.match(markdownSample, /<code>\{\{img_a\}\}<\/code>/);
const h4Sample = renderToStaticMarkup(createElement(AssistantMarkdown, { text: '#### 四级标题' }));
assert.match(h4Sample, /<h4>四级标题<\/h4>/);
assert.doesNotMatch(h4Sample, /####/);
// 聊天正文里的 {{节点}} 显示成可读名字
assert.equal(
  replaceNodeTokens('主角 {{img_a}} 与 {{img_missing}}', [
    { id: 'img_a', type: 'image', title: '阿波罗' },
  ]),
  '主角 阿波罗 与 {{img_missing}}',
);
const tempCard = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: sameSentence,
  onApply() {},
  onDiscard() {},
}));
assert.match(tempCard, /待确认/);
assert.match(tempCard, /新增 anchor_zhuge/);
assert.match(tempCard, /运行 anchor_zhuge/);
assert.match(tempCard, /创建跨段存活的角色锚点（诸葛亮）/);
assert.match(tempCard, /总时长 30 秒将拆为 2 段/);
assert.doesNotMatch(tempCard, /采用分段生成形态/);
assert.doesNotMatch(tempCard, /create_canvas_nodes/);
const duplicateReason = interpretCanvasProposalText(JSON.stringify({
  actions: [{
    type: 'create_canvas_nodes',
    nodes: [{ tempId: 'anchor_zhuge', nodeType: 'generator', initialParams: { reason: '同一句' } }],
    rationale: '同一句',
  }],
}));
assert.equal(duplicateReason?.summary, '');
assert.deepEqual(interpreted?.unknownTypes, []);
const unknownBatch = interpretCanvasProposalText(JSON.stringify({
  actions: [
    { type: 'create_canvas_nodes', nodes: [{ tempId: 'anchor_zhuge', nodeType: 'generator', initialParams: { prompt: '诸葛亮' } }] },
    { type: 'invent_storyboard', nodeIds: ['anchor_zhuge'] },
  ],
  summary: '不该出卡片',
}));
assert.equal(unknownBatch?.actions.length, 0);
assert.deepEqual(unknownBatch?.unknownTypes, ['invent_storyboard']);
const retryNote = unknownCanvasActionMessage(unknownBatch?.unknownTypes || []);
assert.match(retryNote, /invent_storyboard/);
assert.match(retryNote, /create_node、connect_nodes、update_node_params、execute_node_skill/);
assert.doesNotMatch(retryNote, /create_canvas_nodes/);
const corrected = interpretCanvasProposalText(JSON.stringify({
  actions: [
    { type: 'create_node', tempId: 'anchor_zhuge', nodeType: 'generator', initialParams: { reason: '创建跨段存活的角色锚点（诸葛亮）' } },
    { type: 'execute_node_skill', nodeId: 'anchor_zhuge' },
  ],
  summary: '总时长 30 秒将拆为 2 段。已提议创建诸葛亮的角色锚点并生成。',
}));
assert.equal(corrected?.actions.length, 2);
assert.deepEqual(corrected?.unknownTypes, []);
const agentRoute = readFileSync('src/features/canvas-agent/server/registerCanvasAgentRoutes.ts', 'utf8');
assert.match(agentRoute, /unknownCanvasActionMessage\(interpreted\.unknownTypes\)/);
assert.match(agentRoute, /动作类型无法识别/);
assert.match(agentRoute, /type: 'image_url'/);
assert.match(agentRoute, /compressImageForGeminiVision/);
assert.match(agentRoute, /VISION_IMAGE_CAP/);
const hailuoVideo = readFileSync('src/services/runningHubHailuoVideo.ts', 'utf8');
const sparkVideo = readFileSync('src/services/runningHubSparkVideo.ts', 'utf8');
assert.match(hailuoVideo, /compress: compressImageForGeminiVision/);
assert.match(sparkVideo, /compress: compressImageForGeminiVision/);
assert.match(readFileSync('src/services/runningHubStoryboardImage.ts', 'utf8'), /hooks\?\.onUpstreamTaskId\?\.\(taskId\)/);
assert.match(readFileSync('src/services/canvasTaskLedger.ts', 'utf8'), /upstream_task_id/);
assert.match(readFileSync('src/services/canvasVideoBridge.ts', 'utf8'), /saveCanvasTaskUpstreamId/);
const agentClient = readFileSync('src/features/canvas-agent/core/agentService.ts', 'utf8');
assert.match(agentClient, /visionImages:\s*visionImageUrlsForTurn\(request\.snapshot,\s*request\.message,\s*request\.citedNodeIds\)/);
assert.match(expiredHtml, /canvas-agent-proposal is-expired is-collapsed/);
assert.match(expiredHtml, /已过期/);
assert.doesNotMatch(expiredHtml, /过期错误/);
assert.doesNotMatch(expiredHtml, /is-pending/);
const proposalCss = readFileSync('src/features/canvas-agent/ui/canvas-agent.css', 'utf8');
const pendingAt = proposalCss.indexOf('.canvas-agent-proposal.is-pending');
const expiredAt = proposalCss.indexOf('.canvas-agent-proposal.is-expired {');
assert.ok(pendingAt >= 0 && expiredAt > pendingAt);
const pendingBlock = proposalCss.slice(pendingAt, expiredAt);
const expiredBlock = proposalCss.slice(expiredAt, expiredAt + 360);
assert.match(pendingBlock, /background:\s*#2a2928/);
assert.match(expiredBlock, /background:\s*#131313/);
assert.equal(/#9dd7b1|#ffb866|#f0a8a8/.test(pendingBlock + expiredBlock), false);
const queued = new Set(['exec-new']);
const byId = new Map(displaySource.map((item) => [item.id, item]));
let persistedId = '';
flushProposalWriteQueue(queued, (id) => byId.get(id), async (current) => {
  persistedId = current.id;
  assert.equal(current.status, 'exec_failed');
  assert.notEqual(shown[0].id, current.id);
  return 1;
});
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(persistedId, 'exec-new');
assert.equal(queued.size, 0);

const generatorTypeLiteral = readFileSync('src/lib/infiniteCanvas/canvasEngine.js', 'utf8')
  .match(/export const CANVAS_GENERATOR_TYPES = (\[[^\]]+\]);/)?.[1] || '[]';
const GENERATOR_TYPES = JSON.parse(generatorTypeLiteral.replace(/'/g, '"')) as string[];
assert.ok(GENERATOR_TYPES.includes('generator'));
assert.ok(GENERATOR_TYPES.includes('nineGridAgent'));
assert.doesNotThrow(() => assertAgentActionContent(
  { type: 'execute_node_skill', nodeId: 'ngrid_47a62c86553b38_1792478840694' },
  {
    ...snapshot,
    nodes: [{
      id: 'ngrid_47a62c86553b38_1792478840694',
      type: 'nineGridAgent',
      x: 0,
      y: 0,
      story: '深夜中军大帐内，牛油巨烛熊熊燃烧。',
      prompt: '',
    }],
    connections: [{ id: 'edge-grid', from: 'gen_anchor', to: 'ngrid_47a62c86553b38_1792478840694' }],
  },
  GENERATOR_TYPES,
));
assert.throws(
  () => assertAgentActionContent(
    { type: 'execute_node_skill', nodeId: 'grid-empty' },
    {
      ...snapshot,
      nodes: [{ id: 'grid-empty', type: 'nineGridAgent', x: 0, y: 0, story: '  ', prompt: '' }],
      connections: [],
    },
    GENERATOR_TYPES,
  ),
  /没有内容，无法执行/,
);
assert.equal(GENERATOR_TYPES.includes('image'), false);
assert.equal(GENERATOR_TYPES.includes('group'), false);
assert.equal(GENERATOR_TYPES.includes('prompt'), false);

function linkedShot(
  extras: CanvasSnapshot['nodes'],
  connections: CanvasSnapshot['connections'],
): CanvasSnapshot {
  return {
    ...snapshot,
    nodes: [{ id: 'shot', type: 'generator', x: 0, y: 0, prompt: '侧面' }, ...extras],
    connections,
  };
}
const emptyAnchor = linkedShot(
  [{ id: 'anchor', type: 'generator', x: 0, y: 0, prompt: '正面' }],
  [{ id: 'edge-anchor', from: 'anchor', to: 'shot' }],
);
let dependencyReason = '';
let dependencyMessage = '';
try {
  assertAgentActionContent({ type: 'execute_node_skill', nodeId: 'shot' }, emptyAnchor, GENERATOR_TYPES);
} catch (err) {
  dependencyReason = err && typeof err === 'object' && 'reason' in err && typeof err.reason === 'string' ? err.reason : '';
  dependencyMessage = err instanceof Error ? err.message : '';
}
assert.equal(dependencyReason, 'dependency_not_ready');
assert.equal(dependencyMessage, '节点 shot 引用的上游 anchor 还没有产出，无法执行。');

const batchExecutions = [
  { type: 'execute_node_skill' as const, nodeId: 'shot' },
  { type: 'execute_node_skill' as const, nodeId: 'anchor' },
];
const orderedBatch = sortBatchExecutions(batchExecutions, emptyAnchor, batchExecutions, (id) => id);
assert.deepEqual(orderedBatch.map((item) => item.nodeId), ['anchor', 'shot']);
const anchorNode = emptyAnchor.nodes.find((item) => item.id === 'anchor');
if (!anchorNode) throw new Error('anchor missing');
anchorNode.history = ['/uploads/anchor.png'];
assert.doesNotThrow(() => assertAgentActionContent(
  { type: 'execute_node_skill', nodeId: 'shot' },
  emptyAnchor,
  GENERATOR_TYPES,
));

assert.doesNotThrow(() => assertAgentActionContent(
  { type: 'execute_node_skill', nodeId: 'shot' },
  linkedShot(
    [{ id: 'brief', type: 'prompt', x: 0, y: 0, text: '' }],
    [{ id: 'edge-prompt', from: 'brief', to: 'shot' }],
  ),
  GENERATOR_TYPES,
));
assert.doesNotThrow(() => assertAgentActionContent(
  { type: 'execute_node_skill', nodeId: 'shot' },
  linkedShot(
    [{ id: 'ref', type: 'image', x: 0, y: 0 }],
    [{ id: 'edge-image', from: 'ref', to: 'shot' }],
  ),
  GENERATOR_TYPES,
));
assert.doesNotThrow(() => assertAgentActionContent(
  { type: 'execute_node_skill', nodeId: 'shot' },
  linkedShot(
    [
      { id: 'child', type: 'image', x: 0, y: 0, url: '/uploads/child.png' },
      { id: 'box', type: 'group', x: 0, y: 0, items: ['child'] },
    ],
    [{ id: 'edge-group', from: 'box', to: 'shot' }],
  ),
  GENERATOR_TYPES,
));
assert.doesNotThrow(() => assertAgentActionContent(
  { type: 'execute_node_skill', nodeId: 'shot' },
  linkedShot(
    [{ id: 'empty-box', type: 'group', x: 0, y: 0, items: [] }],
    [{ id: 'edge-empty-group', from: 'empty-box', to: 'shot' }],
  ),
  GENERATOR_TYPES,
));

const genericStill = pendingExecutionFeedback([
  failedProposal('generic-still', '节点 gen_1 没有内容，无法执行。', 70, { status: 'exec_failed' }),
]);
assert.match(genericStill?.content || '', /只提交对该节点的执行/);
assert.doesNotMatch(genericStill?.content || '', /加进这一批/);
const storyRetry = pendingExecutionFeedback([
  failedProposal(
    'story-retry',
    '节点 ngrid_47a62c86553b38_1792478840694 没有内容，无法执行。如果它应该承载提示词，请在 initialParams 里填上；如果它是等用户手动填写的空节点，请不要在同一批 actions 里执行它。',
    71,
    { status: 'exec_failed' },
  ),
]);
assert.match(storyRetry?.content || '', /修正它的 story 字段后，只提交对该节点的执行/);
assert.match(storyRetry?.content || '', /不要重新创建该节点/);
assert.doesNotMatch(storyRetry?.content || '', /initialParams/);

const depProposal: ActionProposal = {
  ...raceProposal,
  id: 'proposal-dep',
  actions: [
    { type: 'execute_node_skill', nodeId: 'shot' },
    { type: 'execute_node_skill', nodeId: 'anchor' },
  ],
  summary: '镜头依赖锚点',
};
seedOutcome(depProposal);
const depQueue = new Set<string>();
await runProposalApply(depProposal, {
  batchApply: async () => ({
    skippedCount: 0,
    failedExecution: { nodeId: 'shot', message: dependencyMessage, reason: dependencyReason },
    choices: [],
  }),
  update: rememberOutcome,
  current: () => outcomeMemory.get(depProposal.id),
  persist: writeOutcome,
  queue: depQueue,
});
assert.equal(depQueue.has(depProposal.id), true);
appendCanvasAgentMessage(outcomeDb, 'user-1', outcomeConversation.id, 'assistant', '依赖未就绪', {
  proposal: { ...depProposal, status: 'pending' },
});
deliverProposalDone(depProposal.id, () => {}, () => {
  flushProposalWriteQueue(depQueue, (id) => outcomeMemory.get(id), writeOutcome);
});
await new Promise((resolve) => setTimeout(resolve, 20));
const depRow = outcomeDb.prepare(
  `SELECT metadata_json FROM canvas_agent_messages
   WHERE json_extract(metadata_json, '$.proposal.id') = ?`,
).get(depProposal.id) as { metadata_json: string };
const depMeta = JSON.parse(depRow.metadata_json) as {
  proposal: ActionProposal;
};
assert.equal(depMeta.proposal.status, 'exec_failed');
assert.equal(depMeta.proposal.reason, 'dependency_not_ready');
assert.equal(depMeta.proposal.error, dependencyMessage);
const reopenedDep = proposalOnReopen(depMeta.proposal);
assert.equal(reopenedDep.reason, 'dependency_not_ready');
const depFeedback = pendingExecutionFeedback([reopenedDep]);
assert.match(depFeedback?.content || '', /节点 shot 引用的上游 anchor 还没有产出，无法执行。/);
assert.match(depFeedback?.content || '', /请把 anchor 也加进这一批执行/);
assert.match(depFeedback?.content || '', /不要改 shot、不要重建 shot/);
assert.doesNotMatch(depFeedback?.content || '', /只提交对该节点的执行/);

// 原断言锁的是 production 分支的行为，该分支已停用。
// 测试没写错，它准确锁住了当时的设计；是设计错了——
// 第十五次真实验收证明那句禁令阻止了用户明确要求的动作。
const intakeSamples = [
  '三个角度',
  '一条 5 秒的镜头',
  '多镜头',
  '走流程',
  '做一条30秒短片，角色保持一致',
  '帮我做一支短片',
  '帮我做一支 12 秒的短片。建好之后直接执行全部三个',
];
const intakePrompt = operatingPrompt(intakeSamples[0]);
for (const sample of intakeSamples) {
  assert.equal(classifyIntake(sample), 'direct');
  assert.equal(operatingPrompt(sample), intakePrompt);
}
assert.equal(operatingPrompt(intakeSamples[0], ''), intakePrompt);
assert.equal(intakePrompt.length, 999);
assert.match(intakePrompt, /Playbooks loaded: none\. Do not invent playbooks, web search, memory, a 3D director stage, or a multi-track editor\.$/);
const withPlaybookBody = operatingPrompt(intakeSamples[0], '正文甲');
assert.equal(
  withPlaybookBody,
  intakePrompt.replace('Playbooks loaded: none.', 'Playbooks loaded: 正文甲.'),
);
assert.equal(agentPlaybooks.length, 3);
assert.equal(agentPlaybooks[0]?.id, 'canvas-video-piece');
assert.equal(agentPlaybooks[0]?.title, '剧情动画');
assert.equal(agentPlaybooks[0]?.when, '用户要多段剧情片时（每段 25–40 秒，分 2–3 段，主角跨段存活）');
assert.equal(agentPlaybooks[0]?.path, 'prompts/playbook_video_content.md');
assert.notEqual(agentPlaybooks[0]?.path, 'prompts/mx_shell_prompt_system.md');
assert.equal(agentPlaybooks[1]?.id, 'canvas-opening-animation');
assert.equal(agentPlaybooks[1]?.title, '开场动画');
assert.equal(agentPlaybooks[1]?.path, 'prompts/playbook_opening_animation.md');
assert.equal(agentPlaybooks[2]?.id, 'canvas-combat-fx');
assert.equal(agentPlaybooks[2]?.title, '特效打斗');
assert.equal(agentPlaybooks[2]?.path, 'prompts/playbook_combat_fx.md');
// 打斗阶段闸：方向 → 参数 → 分镜，之前不许建节点；角色锚点没确认也不放行
assert.equal(
  combatStageDecision({ playbookId: 'canvas-combat-fx', stage: '', message: '给我设计一个打斗动画', answering: false, hasAnchor: false }).blocked,
  true,
);
assert.equal(
  combatStageDecision({ playbookId: 'canvas-combat-fx', stage: 'direction', message: '', answering: true, hasAnchor: true }).advanceTo,
  'params',
);
assert.equal(
  combatStageDecision({ playbookId: 'canvas-combat-fx', stage: 'params', message: '', answering: true, hasAnchor: true }).advanceTo,
  'storyboard',
);
assert.equal(
  combatStageDecision({ playbookId: 'canvas-combat-fx', stage: 'params', message: '', answering: true, hasAnchor: false }).reason,
  'blocked-anchor',
);
assert.equal(
  combatStageDecision({ playbookId: 'canvas-combat-fx', stage: '', message: '跳过准备', answering: false, hasAnchor: false }).advanceTo,
  'production',
);
assert.equal(
  combatStageDecision({ playbookId: 'canvas-combat-fx', stage: 'storyboard', message: '', answering: false, hasAnchor: false }).blocked,
  true,
);
assert.equal(
  combatStageDecision({ playbookId: 'canvas-combat-fx', stage: 'storyboard', message: '', answering: false, hasAnchor: true, hasOpponentAnchor: false }).reason,
  'blocked-opponent-anchor',
);
assert.equal(
  combatStageDecision({ playbookId: 'canvas-combat-fx', stage: 'params', message: '', answering: true, hasAnchor: true, hasOpponentAnchor: false }).reason,
  'blocked-opponent-anchor',
);
assert.equal(
  combatStageDecision({ playbookId: 'canvas-combat-fx', stage: 'params', message: '', answering: true, hasAnchor: true, hasOpponentAnchor: true }).advanceTo,
  'storyboard',
);
assert.equal(
  combatStageDecision({ playbookId: 'canvas-combat-fx', stage: 'params', message: '对手是宙斯', answering: false, hasAnchor: false }).blocked,
  true,
);
assert.equal(
  combatStageDecision({ playbookId: 'canvas-video-piece', stage: '', message: '做一段剧情', answering: false, hasAnchor: false }).blocked,
  false,
);
const playbookStepEnd: Record<string, string> = {
  'canvas-video-piece': '## 时长规则',
  'canvas-opening-animation': '## 核心原则',
};
const secondsPerShot = /每镜\s*[0-9]|每\s*[0-9][^。\n]{0,12}秒一个镜头/;
const stackedMovePush = /一镜内[^。\n]{0,16}(?:连打|多手法|多种手法|五种手法)|(?:多种|五种)手法连打/;
const stackedMoveDeny = /不靠|不要|禁止|别|不能|不得/;
const playbookGaps: string[] = [];
const playbookBodies = ['canvas-video-piece', 'canvas-opening-animation'].map((id) => {
  const body = readRegisteredPlaybookText('.', id);
  assert.ok(body.length > 0, id);
  console.log(`playbook body ${id}: ${body.length}`);
  assert.equal(body.includes('运镜词典（强制参考）'), false, id);
  const need = (text: string, pattern: RegExp, label: string) => {
    if (!pattern.test(text)) playbookGaps.push(`${id} 缺 ${label}`);
  };
  if (secondsPerShot.test(body)) playbookGaps.push(`${id} 有秒数档`);
  need(body, /主运镜/, '主运镜');
  need(body, /步骤 0 · 资产分析/, '步骤 0 · 资产分析');
  need(body, /video 的 prompt 里不要写参考图的文件名/, 'video prompt 不写文件名');
  if (body.includes('必须和这些 @ 出现在同一条用户消息里')) playbookGaps.push(`${id} 仍要求同一条消息 @`);
  const modeRow = body.split('\n').find((line) => line.startsWith('| 模式 |')) || '';
  const intensityRow = body.split('\n').find((line) => line.startsWith('| 运镜强度 |')) || '';
  if (!modeRow) playbookGaps.push(`${id} 缺模式行`);
  else {
    need(modeRow, /见步骤 1/, '模式见步骤 1');
    if (/用户没提就问一句|用户没说\s*→\s*默认/.test(modeRow)) playbookGaps.push(`${id} 模式仍把停留在缺省列`);
  }
  if (!intensityRow) playbookGaps.push(`${id} 缺运镜强度行`);
  else {
    need(intensityRow, /见步骤 1/, '运镜强度见步骤 1');
    if (/用户没提就问一句|用户没说\s*→\s*standard|没说就用 standard/.test(intensityRow)) {
      playbookGaps.push(`${id} 运镜强度仍把停留在缺省列`);
    }
  }
  if (body.split('\n').some((line) => stackedMovePush.test(line) && !stackedMoveDeny.test(line))) {
    playbookGaps.push(`${id} 鼓励一镜内多手法连打`);
  }
  const stepsAt = body.indexOf('## 执行逻辑');
  const stepsEnd = body.indexOf(playbookStepEnd[id], stepsAt + 1);
  assert.ok(stepsAt >= 0 && stepsEnd > stepsAt, id);
  const steps = body.slice(stepsAt, stepsEnd);
  need(steps, /这要重跑整[段条]，约 X 秒/, '步骤区报价句');
  need(steps, /不要写进 video prompt/, '步骤区台词禁令');
  const step0 = steps.slice(steps.indexOf('### 步骤 0'), steps.indexOf('### 步骤 1'));
  const step0First = step0.split('\n').map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
  if (step0First !== '这一步的产物不是『识别这是什么图』。只说图里是阿波罗、是神殿，等于没做这一步——那是识别，不是分析。这一步只报两样：图里没有而故事需要的；图里有而和故事冲突的。两样都没有时，一行说『图与故事一致』。报完停下等用户确认，确认前不写任何分镜、不建任何节点。') {
    playbookGaps.push(`${id} 步骤 0 第一句不是闸门`);
  }
  if (step0.includes('参考关系只靠连线')) playbookGaps.push(`${id} 连线句仍停在步骤 0`);
  const step1 = steps.slice(steps.indexOf('### 步骤 1'), steps.indexOf('### 步骤 2'));
  if (!step1.includes('没有审批卡时')) playbookGaps.push(`${id} 步骤 1 没有短句肯定禁令`);
  if (step1.includes('有待批准的提案时')) playbookGaps.push(`${id} 短句禁令仍按待批准提案判`);
  const videoFrom = id === 'canvas-video-piece' ? '### 步骤 3' : '### 步骤 1';
  const videoTo = id === 'canvas-video-piece' ? '### 步骤 4' : '### 步骤 2';
  const videoStep = steps.slice(steps.indexOf(videoFrom), steps.indexOf(videoTo));
  if (!videoStep.includes('参考关系只靠连线表达')) playbookGaps.push(`${id} 建 video 那步没有连线句`);
  const askAt = step1.indexOf('没答就不能建节点、不能写分镜——先问，等回答。');
  const productAt = step1.indexOf('产物：');
  if (askAt < 0 || productAt < 0 || askAt > productAt) playbookGaps.push(`${id} 开工追问不在产物之前`);
  if (!steps.includes('为什么停在这儿')) playbookGaps.push(`${id} 停点没要求说明为什么`);
  const cardWhy = '卡不是文字画出来的，是工具调用触发的';
  if (steps.indexOf(cardWhy) < 0 || steps.indexOf(cardWhy) > steps.indexOf('为什么停在这儿')) {
    playbookGaps.push(`${id} 卡片那句不在停点说明前面`);
  }
  if (!steps.includes('是你的责任不是他的')) playbookGaps.push(`${id} 没要求生成前提醒素材冲突`);
  if (!step1.includes('用默认')) playbookGaps.push(`${id} 忽略没记成用默认`);
  need(step1, /不要问抽象档位，问具体参照/, '提问环节没有具体参照引导');
  const refStart = body.indexOf('参考图承载细节');
  const refEnd = body.indexOf('\n### ', refStart + 1);
  const refSection = refStart >= 0 && refEnd > refStart ? body.slice(refStart, refEnd) : '';
  if (!refSection.includes('不等于角色只写名字')) playbookGaps.push(`${id} 参考图原则缺不等于角色只写名字`);
  const writeFrom = id === 'canvas-video-piece' ? '### 步骤 3' : '### 步骤 1';
  const writeTo = id === 'canvas-video-piece' ? '### 步骤 4' : '### 步骤 2';
  const writeStep = steps.slice(steps.indexOf(writeFrom), steps.indexOf(writeTo));
  const beforeProduct = writeStep.slice(0, writeStep.indexOf('产物：'));
  const shotLineMarks = [
    '分镜行怎么写',
    '表情与眼神', '身体状态', '位置与构图', '动作精度', '特效：形态',
    '道具与环境交互', '物理附着', '光：方向、色温、硬度、变化', '视线与关系',
    '远景 / 建立', '特写：表情、眼神', '动作镜', '特效镜', '对白 / 静场',
    '远景那一镜里，外观锚定和构图合并写，不要单独再抄一遍脸和服装。',
    '不要写『参考图1』这种编号',
  ];
  if (shotLineMarks.some((mark) => !beforeProduct.includes(mark))) {
    playbookGaps.push(`${id} 分镜行九类或选择表不在产物之前`);
  }
  need(beforeProduct, /四层的篇幅配比：风格质量声明 10%、运镜系统 15%、核心画面 60%、技术细节 15%/, '分镜行没写四层篇幅配比');
  need(body, /## 内容不满意时怎么改/, '缺内容不满意的迭代诊断表');
  if (body.includes('和原则 2 的关系')) playbookGaps.push(`${id} 仍用原则编号指外观锚定`);
  const shotHow = beforeProduct.slice(beforeProduct.indexOf('### 分镜行怎么写'));
  if (!shotHow.includes('用用户消息的语言写')) playbookGaps.push(`${id} 分镜行没要求用用户消息的语言写`);
  if (!shotHow.includes('不要把记号放进句子主干')) playbookGaps.push(`${id} 分镜行没拦住把记号放进主干`);
  if (!beforeProduct.includes('防重复的约束，不是进度报告')) playbookGaps.push(`${id} 已生效清单没写成防重复约束`);
  const handoffStop = id === 'canvas-video-piece'
    ? '停点：每段的提示词都可以单独审，审到分镜级。'
    : '停点：prompt 出来后等用户审，审到分镜级。';
  const handoffAt = steps.indexOf(handoffStop);
  const runProductAt = handoffAt < 0 ? -1 : steps.indexOf('批准即成片', handoffAt + handoffStop.length);
  const handoff = handoffAt >= 0 && runProductAt > handoffAt ? steps.slice(handoffAt, runProductAt) : '';
  if (!handoff.includes('下一拍直接提交运行')) playbookGaps.push(`${id} 认可后没要求下一拍提交运行`);
  if (!handoff.includes('不用再等一拍落板')) playbookGaps.push(`${id} 衔接句仍按落板后再等一拍`);
  if (!beforeProduct.includes('不要写分镜1/分镜2/分镜3')) playbookGaps.push(`${id} 一镜到底写法不在产物之前`);
  if (!beforeProduct.includes('必须在同一个提案里做完')) playbookGaps.push(`${id} 建节点和连边没要求同一提案`);
  const axesAt = step1.indexOf('克制不等于一镜到底');
  if (axesAt < 0 || axesAt < askAt) playbookGaps.push(`${id} 克制和一镜到底没拆开`);
  return body;
});
assert.deepEqual(playbookGaps, []);
const playbookLoaded = ['canvas-video-piece', 'canvas-opening-animation'].map((id) => readPlaybookForAgent('.', id));
const cameraInjection = playbookLoaded[0].slice(playbookBodies[0].length);
assert.match(cameraInjection, /^\n\n---\n\n## 运镜词典（写法参考）\n\n/);
assert.match(cameraInjection, /技能正文的分镜结构、节奏与特效层优先/);
assert.equal(playbookLoaded[1].slice(playbookBodies[1].length), cameraInjection);
assert.match(cameraInjection, /甩镜/);
assert.equal(inferAppliedPlaybookStage('canvas-video-piece', [
  { type: 'create_node', tempId: 'gen', nodeType: 'generator' },
  { type: 'create_node', tempId: 'vid', nodeType: 'video' },
], () => ''), 3);
assert.equal(inferAppliedPlaybookStage('canvas-video-piece', [
  { type: 'create_node', tempId: 'grid', nodeType: 'nineGridAgent' },
], () => ''), 2);
assert.equal(inferAppliedPlaybookStage('canvas-video-piece', [
  { type: 'execute_node_skill', nodeId: 'anchor' },
], (id) => id === 'anchor' ? 'generator' : ''), 1);
assert.equal(inferAppliedPlaybookStage('canvas-video-piece', [
  { type: 'execute_node_skill', nodeId: 'vid' },
], () => 'video'), 4);
assert.equal(inferAppliedPlaybookStage('canvas-opening-animation', [
  { type: 'create_node', tempId: 'vid', nodeType: 'video' },
], () => ''), 1);
assert.equal(inferAppliedPlaybookStage('canvas-opening-animation', [
  { type: 'execute_node_skill', nodeId: 'vid' },
], () => 'video'), 2);
assert.equal(inferAppliedPlaybookStage('canvas-opening-animation', [], () => ''), null);
assert.equal(canvasAgentStagePrefix('canvas-video-piece', 3, 'canvas-opening-animation'), '');
assert.equal(canvasAgentStagePrefix('', null, 'canvas-opening-animation'), '');
const stageSegment = canvasAgentStageSegment('canvas-opening-animation', 1);
const systemPrompt = readFileSync(new URL('./server/registerCanvasAgentRoutes.ts', import.meta.url), 'utf8');
const systemStart = systemPrompt.indexOf('const SYSTEM_PROMPT = `');
const systemEnd = systemPrompt.indexOf('`;', systemStart);
const systemBody = systemPrompt.slice(systemStart + 'const SYSTEM_PROMPT = `'.length, systemEnd);
const openingLoaded = readPlaybookForAgent('.', 'canvas-opening-animation');
const openingAssembled = `${systemBody}\n${operatingPrompt('开场', openingLoaded)}\n\n${stageSegment}`;
console.log(`system prompt with opening stage: ${openingAssembled.length}`);
const stageDb = new Database(':memory:');
initCanvasAgentConversationSchema(stageDb);
const freshConversation = createCanvasAgentConversation(stageDb, 'user', 'canvas', '新对话');
// 标题里不能留着 {{节点}} 这类引用，读起来像乱码
const refTitled = createCanvasAgentConversation(stageDb, 'user', 'canvas', '{{img_abc_123}} 神殿参考 10s 开场');
assert.equal(refTitled.title, '神殿参考 10s 开场');
// 标题被 80 字截断时可能留下半个引用
const halfRefTitle = createCanvasAgentConversation(stageDb, 'user', 'canvas', '{{img_abc_123');
assert.equal(halfRefTitle.title, '未命名对话');
assert.deepEqual(readConversationStage(stageDb, 'user', freshConversation.id), { playbookId: '', stage: null });
appendCanvasAgentMessage(stageDb, 'user', freshConversation.id, 'assistant', '提案', {
  proposal: { id: 'p1', actions: [] },
});
recordConversationStage(stageDb, 'user', 'p1', 'canvas-opening-animation', 1);
assert.deepEqual(readConversationStage(stageDb, 'user', freshConversation.id), {
  playbookId: 'canvas-opening-animation',
  stage: 1,
});
const otherConversation = createCanvasAgentConversation(stageDb, 'user', 'canvas', '另一条');
// 阶段数据：默认空，写入后能合并事实
assert.deepEqual(readConversationStageData(stageDb, 'user', otherConversation.id), { stage: '', facts: {} });
writeConversationStageData(stageDb, 'user', otherConversation.id, {
  stage: 'build',
  facts: { opponent: '宙斯' },
});
assert.equal(readConversationStageData(stageDb, 'user', otherConversation.id).stage, 'build');
writeConversationStageData(stageDb, 'user', otherConversation.id, { facts: { style: '金白' } });
const stageDataAfter = readConversationStageData(stageDb, 'user', otherConversation.id);
assert.equal(stageDataAfter.facts.opponent, '宙斯');
assert.equal(stageDataAfter.facts.style, '金白');
assert.equal(readConversationStage(stageDb, 'user', otherConversation.id).stage, null);
assert.deepEqual(readConversationCitedNodes(stageDb, 'user', freshConversation.id), []);
assert.deepEqual(
  recordConversationCitations(stageDb, 'user', freshConversation.id, '确认'),
  [],
);
assert.deepEqual(
  recordConversationCitations(stageDb, 'user', freshConversation.id, '使用模型 midjourneyV8.1'),
  [],
);
assert.deepEqual(
  recordConversationCitations(stageDb, 'user', freshConversation.id, '{{img_a}} 是角色 {{canvas:img_b}} 是场景'),
  ['canvas:img_b', 'img_a', 'img_b'],
);
assert.deepEqual(
  recordConversationCitations(stageDb, 'user', freshConversation.id, '确认'),
  ['canvas:img_b', 'img_a', 'img_b'],
);
assert.deepEqual(readConversationCitedNodes(stageDb, 'user', otherConversation.id), []);
assert.deepEqual(readConversationEffected(stageDb, 'user', freshConversation.id), []);
recordConversationEffected(stageDb, 'user', 'p1', [
  { id: 'vid_xxx', nodeType: 'video', label: '阿波罗开场 10 秒' },
], 'createNode: vid_xxx（video）');
assert.deepEqual(readConversationEffected(stageDb, 'user', freshConversation.id), [
  { id: 'vid_xxx', nodeType: 'video', label: '阿波罗开场 10 秒' },
]);
assert.deepEqual(readConversationEffected(stageDb, 'user', otherConversation.id), []);
updateCanvasAgentProposalOutcome(stageDb, 'user', 'p1', {
  status: 'applied',
  error: null,
  partialSkipped: null,
  droppedConnects: null,
  reason: null,
});
assert.equal(takeConversationChangelog(stageDb, 'user', freshConversation.id), 'createNode: vid_xxx（video）');
assert.equal(takeConversationChangelog(stageDb, 'user', freshConversation.id), '');
recordConversationCitations(stageDb, 'user', otherConversation.id, '{{img_old}}');
assert.deepEqual(readConversationEffected(stageDb, 'user', otherConversation.id), []);
stageDb.close();
const ledgerLine = canvasAgentStageSegment('canvas-opening-animation', 1, [
  { id: 'vid_xxx', nodeType: 'video', label: '阿波罗开场 10 秒' },
]);
assert.equal(ledgerLine, '## 当前阶段\n技能：开场动画 / 步骤：1\n已生效清单：\nvid_xxx | video | 不在画布上 | 阿波罗开场 10 秒');
const ledgerRunStates = parseRunStates({ vid_xxx: 'created', gen_yyy: 'generated', bad: 'running' });
assert.deepEqual(ledgerRunStates, { vid_xxx: 'created', gen_yyy: 'generated' });
assert.equal(effectedLine([
  { id: 'vid_xxx', nodeType: 'video', label: '阿波罗10s克制一镜到底开场' },
  { id: 'gen_yyy', nodeType: 'generator', label: '角色锚点：诸葛亮' },
], ledgerRunStates), '已生效清单：\nvid_xxx | video | 已创建（未生成） | 阿波罗10s克制一镜到底开场\ngen_yyy | generator | 已生成 | 角色锚点：诸葛亮');
assert.equal(
  effectedLine([{ id: 'gen_f', nodeType: 'generator' }], { gen_f: mediaRunState({ id: 'gen_f', type: 'generator', agentLastError: { message: 'x' } }) }),
  '已生效清单：\ngen_f | generator | 执行失败',
);
const approvalDb = new Database(':memory:');
initCanvasAgentConversationSchema(approvalDb);
const approvalConversation = createCanvasAgentConversation(approvalDb, 'user', 'canvas', '审批');
assert.equal(hasPendingRunApproval(approvalDb, 'user', approvalConversation.id), false);
appendCanvasAgentMessage(approvalDb, 'user', approvalConversation.id, 'assistant', '', {
  asks: [{ id: 'q', mode: 'single', question: '几秒？', options: [] }],
});
assert.equal(hasPendingRunApproval(approvalDb, 'user', approvalConversation.id), false);
appendCanvasAgentMessage(approvalDb, 'user', approvalConversation.id, 'assistant', '', {
  asks: [{ id: 'ask-run', mode: 'approve_run_node', question: '批准运行这些节点？', options: [], node_keys: ['vid_a'] }],
});
assert.equal(hasPendingRunApproval(approvalDb, 'user', approvalConversation.id), true);
appendCanvasAgentMessage(approvalDb, 'user', approvalConversation.id, 'user', '好的', {});
assert.equal(hasPendingRunApproval(approvalDb, 'user', approvalConversation.id), true);
appendCanvasAgentMessage(approvalDb, 'user', approvalConversation.id, 'user', '', {
  askAnswer: { cardId: 'ask-run', mode: 'approve_run_node', question: '批准运行这些节点？', selected: ['批准'] },
});
assert.equal(hasPendingRunApproval(approvalDb, 'user', approvalConversation.id), false);
approvalDb.close();

// ---- 审批范围：卡绑的是「那一刻这批节点、这份内容」 ----
const scopeNodes = [
  { id: 'gen_a', type: 'generator', prompt: '阿波罗开场', x: 0, y: 0 },
  { id: 'gen_b', type: 'generator', prompt: '诸葛亮近景' },
];
const scope = { nodeIds: ['gen_a', 'gen_b'], digest: runScopeDigest(scopeNodes, ['gen_a', 'gen_b']) };
assert.equal(runScopeMatches(scope, scopeNodes, ['gen_b', 'gen_a']), true);
assert.equal(runScopeMatches(undefined, scopeNodes, ['gen_a', 'gen_b']), false);
assert.equal(runScopeMatches(scope, scopeNodes, ['gen_a']), false);
assert.equal(runScopeMatches(scope, scopeNodes.map((node) => ({ ...node, x: 900 })), ['gen_a', 'gen_b']), true);
assert.equal(runScopeMatches(scope, scopeNodes.map((node) => (
  node.id === 'gen_a' ? { ...node, prompt: '换成夜景' } : node
)), ['gen_a', 'gen_b']), false);
// 产物字段不算内容：后台写回 url 不该让等待中的卡失效。
assert.equal(runScopeMatches(scope, scopeNodes.map((node) => ({ ...node, url: '/out.png' })), ['gen_a', 'gen_b']), true);
// 上游变了就是输入变了：连线关系、上游正文、上游产出都要让卡作废。
const scopeEdges = [{ id: 'e1', from: 'gen_a', to: 'gen_b' }];
const downstreamScope = { nodeIds: ['gen_b'], digest: runScopeDigest(scopeNodes, ['gen_b'], scopeEdges) };
assert.equal(runScopeMatches(downstreamScope, scopeNodes, ['gen_b'], scopeEdges), true);
assert.equal(runScopeMatches(downstreamScope, scopeNodes, ['gen_b'], []), false);
assert.equal(runScopeMatches(downstreamScope, scopeNodes.map((node) => (
  node.id === 'gen_a' ? { ...node, prompt: '上游改了' } : node
)), ['gen_b'], scopeEdges), false);
assert.equal(runScopeMatches(downstreamScope, scopeNodes.map((node) => (
  node.id === 'gen_a' ? { ...node, url: '/new.png' } : node
)), ['gen_b'], scopeEdges), false);
assert.equal(runScopeMatches(downstreamScope, scopeNodes.map((node) => (
  node.id === 'gen_b' ? { ...node, url: '/out.png' } : node
)), ['gen_b'], scopeEdges), true);
const mixedActions = [
  { type: 'create_node' as const, tempId: 't', nodeType: 'generator', initialParams: { prompt: 'x' } },
  { type: 'execute_node_skill' as const, nodeId: 't' },
];
assert.deepEqual(actionsReleasedForApproval(mixedActions, new Set<string>()), [mixedActions[0]]);
assert.deepEqual(actionsReleasedForApproval(mixedActions, new Set(['t'])), mixedActions);
assert.deepEqual(actionsReleasedForApproval(mixedActions, new Set(['other'])), [mixedActions[0]]);
// 默认 confirm：建 + 跑的混合提案停在待确认；点应用只落结构，运行仍由审批卡放行。
assert.equal(proposalWaitsForClick('confirm', { actions: mixedActions }), true);
assert.equal(proposalWaitsForClick('auto', { actions: mixedActions }), false);
assert.deepEqual(withRunApproval([], ['t']).at(-1)?.node_keys, ['t']);
const redoCard = approveRunCard(['gen_a']);
assert.equal(redoCard?.mode, 'approve_run_node');
assert.deepEqual(redoCard?.node_keys, ['gen_a']);
assert.equal(approveRunCard([]), null);
// 重做产出全是运行动作；这张卡必须指向同一批节点，否则又会停在「等审批卡」。
const redoActions = choiceActions(snapshot, [{ nodeId: 'image-1', label: 'hero', failed: false }], 'redo');
const redoRunCard = approveRunCard(redoActions.flatMap((action) => (
  action.type === 'execute_node_skill' ? [action.nodeId] : []
)));
assert.deepEqual(redoRunCard?.node_keys, ['image-1']);

// ---- 未答 / 已跳过：没答不等于同意 ----
const askDb = new Database(':memory:');
initCanvasAgentConversationSchema(askDb);
const askConversation = createCanvasAgentConversation(askDb, 'user', 'canvas', '提问');
assert.deepEqual(pendingAskQuestions(askDb, 'user', askConversation.id), []);
appendCanvasAgentMessage(askDb, 'user', askConversation.id, 'assistant', '', {
  asks: [{ id: 'q1', mode: 'single', question: '几秒？', options: [] }],
});
assert.deepEqual(pendingAskQuestions(askDb, 'user', askConversation.id), ['几秒？']);
appendCanvasAgentMessage(askDb, 'user', askConversation.id, 'user', '好的', {});
assert.deepEqual(pendingAskQuestions(askDb, 'user', askConversation.id), ['几秒？']);
appendCanvasAgentMessage(askDb, 'user', askConversation.id, 'user', '', {
  askAnswer: { cardId: 'q1', mode: 'single', question: '几秒？', selected: ['6'] },
});
assert.deepEqual(pendingAskQuestions(askDb, 'user', askConversation.id), []);
appendCanvasAgentMessage(askDb, 'user', askConversation.id, 'assistant', '', {
  asks: [{ id: 'ask-run', mode: 'approve_run_node', question: '批准运行这些节点？', options: [], node_keys: ['vid_a'] }],
});
assert.deepEqual(pendingAskQuestions(askDb, 'user', askConversation.id), [], '审批卡不进提问卡统计');
appendCanvasAgentMessage(askDb, 'user', askConversation.id, 'assistant', '', {
  asks: [{ id: 'q2', mode: 'multiple', question: '要哪些镜头？', options: [] }],
});
assert.deepEqual(pendingAskQuestions(askDb, 'user', askConversation.id), ['要哪些镜头？']);
appendCanvasAgentMessage(askDb, 'user', askConversation.id, 'user', '', {
  askAnswer: defaultAskAnswer({ id: 'q2', mode: 'multiple', question: '要哪些镜头？', options: [] }),
});
assert.deepEqual(pendingAskQuestions(askDb, 'user', askConversation.id), [], '点忽略算已答，但记的是用默认');
askDb.close();

// ---- 取消留痕：写一次、下一轮读一次、读完即清 ----
const cancelDb = new Database(':memory:');
initCanvasAgentConversationSchema(cancelDb);
const cancelConversation = createCanvasAgentConversation(cancelDb, 'user', 'canvas', '取消');
appendCanvasAgentMessage(cancelDb, 'user', cancelConversation.id, 'user', '做一版 15 秒', {});
assert.equal(takeConversationCancelMarker(cancelDb, 'user', cancelConversation.id), null);
const cancelled = setConversationCancelMarker(cancelDb, 'user', cancelConversation.id);
assert.ok(cancelled);
assert.ok(cancelled?.messageId);
assert.equal(takeConversationCancelMarker(cancelDb, 'user', cancelConversation.id)?.messageId, cancelled?.messageId);
assert.equal(takeConversationCancelMarker(cancelDb, 'user', cancelConversation.id), null, '取消只读一次');
cancelDb.close();

// ---- 画布清空时，Agent 会话跟着走 ----
const purgeDb = new Database(':memory:');
initCanvasAgentConversationSchema(purgeDb);
const keptConversation = createCanvasAgentConversation(purgeDb, 'user', 'canvas-keep', '留着');
const purgedConversation = createCanvasAgentConversation(purgeDb, 'user', 'canvas-gone', '删掉');
appendCanvasAgentMessage(purgeDb, 'user', purgedConversation.id, 'user', '这条要删', {});
assert.equal(deleteCanvasAgentArtifacts(purgeDb, 'canvas-gone'), 1);
assert.equal(deleteCanvasAgentArtifacts(purgeDb, 'canvas-gone'), 0);
assert.equal(
  (purgeDb.prepare('SELECT COUNT(*) AS c FROM canvas_agent_messages WHERE conversation_id = ?')
    .get(purgedConversation.id) as { c: number }).c,
  0,
);
assert.equal(
  (purgeDb.prepare('SELECT COUNT(*) AS c FROM canvas_agent_conversations WHERE canvas_id = ?')
    .get('canvas-keep') as { c: number }).c,
  1,
);
assert.ok(keptConversation.id);
purgeDb.close();

// ---- Agent 作业：一轮任务不随连接消失 ----
assert.equal(nextAgentJobStatus('queued', 'start'), 'running');
assert.equal(nextAgentJobStatus('running', 'ask'), 'waiting_approval');
assert.equal(nextAgentJobStatus('waiting_approval', 'execute'), 'executing');
assert.equal(nextAgentJobStatus('executing', 'finish'), 'done');
assert.equal(nextAgentJobStatus('done', 'continue'), 'running', '落板后再点继续：重开同一份作业');
assert.equal(nextAgentJobStatus('cancelled', 'continue'), null);
assert.equal(nextAgentJobStatus('running', 'execute'), null);
assert.equal(nextAgentJobStatus('done', 'finish'), null);
assert.equal(isActiveAgentJob('waiting_approval'), true);
assert.equal(isActiveAgentJob('done'), false);
assert.equal(isTerminalAgentJob('cancelled'), true);

const jobDb = new Database(':memory:');
initCanvasAgentConversationSchema(jobDb);
initCanvasAgentJobSchema(jobDb);
const jobConversation = createCanvasAgentConversation(jobDb, 'user', 'canvas-job', '作业');
const job = createAgentJob(jobDb, {
  userId: 'user',
  canvasId: 'canvas-job',
  conversationId: jobConversation.id,
  request: { message: 'hi' },
});
assert.equal(job.status, 'queued');
assert.equal(getAgentJob(jobDb, 'other', job.id), null);
assert.equal(transitionAgentJob(jobDb, 'user', job.id, 'start')?.status, 'running');
assert.equal(transitionAgentJob(jobDb, 'user', job.id, 'execute'), null);
const askedJob = transitionAgentJob(jobDb, 'user', job.id, 'ask', { step: 1, result: { proposalId: 'p1' } });
assert.equal(askedJob?.status, 'waiting_approval');
assert.equal(askedJob?.result.proposalId, 'p1');
assert.equal(listAgentJobs(jobDb, 'user', { activeOnly: true }).length, 1);
assert.equal(transitionAgentJob(jobDb, 'user', job.id, 'execute')?.status, 'executing');
const doneJob = transitionAgentJob(jobDb, 'user', job.id, 'finish', { result: { status: 'applied' } });
assert.equal(doneJob?.status, 'done');
assert.ok(doneJob?.finished_at);
assert.equal(doneJob?.result.status, 'applied');
assert.equal(listAgentJobs(jobDb, 'user', { activeOnly: true }).length, 0);
const secondJob = createAgentJob(jobDb, {
  userId: 'user',
  canvasId: 'canvas-job',
  conversationId: jobConversation.id,
  request: {},
});
transitionAgentJob(jobDb, 'user', secondJob.id, 'start');
assert.equal(cancelActiveJobsForConversation(jobDb, 'user', jobConversation.id), 1);
assert.equal(getAgentJob(jobDb, 'user', secondJob.id)?.status, 'cancelled');
assert.equal(isStaleAgentJob({ ...job, status: 'running', heartbeat_at: Date.now() - 20 * 60 * 1000 }), true);
assert.equal(isStaleAgentJob({ ...job, status: 'running', heartbeat_at: Date.now() }), false);
// 观察与步数：一步一批时 step_total 是 1；拆成多步（C）时按节点数走。
const obsJob = createAgentJob(jobDb, {
  userId: 'user',
  canvasId: 'canvas-job',
  conversationId: jobConversation.id,
  request: { message: 'multi' },
});
transitionAgentJob(jobDb, 'user', obsJob.id, 'start');
setAgentJobSteps(jobDb, 'user', obsJob.id, 3);
const firstObs = appendAgentJobObservation(jobDb, 'user', obsJob.id, { proposalId: 'p1', outcome: 'applied' });
assert.equal(firstObs?.step_total, 3);
assert.equal(firstObs?.step, 1);
assert.equal(firstObs?.observations.length, 1);
appendAgentJobObservation(jobDb, 'user', obsJob.id, { proposalId: 'p1', outcome: 'failed', error: 'x' });
appendAgentJobObservation(jobDb, 'user', obsJob.id, { proposalId: 'p1', outcome: 'applied' });
appendAgentJobObservation(jobDb, 'user', obsJob.id, { proposalId: 'p1', outcome: 'applied' });
const cappedJob = getAgentJob(jobDb, 'user', obsJob.id);
assert.equal(cappedJob?.step, 3, '步数不超过 step_total');
assert.equal(cappedJob?.observations.length, 4);
assert.equal(cappedJob?.observations[1].outcome, 'failed');
const beforeTouch = cappedJob?.heartbeat_at || 0;
touchAgentJob(jobDb, 'user', obsJob.id);
assert.ok((getAgentJob(jobDb, 'user', obsJob.id)?.heartbeat_at || 0) >= beforeTouch);
assert.equal(deleteCanvasAgentArtifacts(jobDb, 'canvas-job'), 1);
assert.equal(listAgentJobs(jobDb, 'user', {}).length, 0, '画布清空时作业跟着走');
jobDb.close();

// ---- 逐节点执行：步数来自提案，续跑只补没跑到的 ----
assert.deepEqual(runNodeIdsOf([
  { type: 'create_node', tempId: 't', nodeType: 'generator' },
  { type: 'execute_node_skill', nodeId: 'a' },
  { type: 'execute_node_skill', nodeId: 'b' },
  { type: 'execute_node_skill', nodeId: 'a' },
]), ['a', 'b']);
assert.deepEqual(remainingRunNodes(['a', 'b', 'c'], [
  { nodeId: 'a', outcome: 'applied' },
  { nodeId: 'b', outcome: 'failed' },
]), ['c']);
assert.deepEqual(remainingRunNodes(['a'], [{ nodeId: 'a', outcome: 'discarded' }]), ['a'], '跳过不算跑过');
assert.deepEqual(remainingRunNodes(['a'], undefined), ['a']);
assert.deepEqual(remainingRunNodes([], [{ nodeId: 'a', outcome: 'applied' }]), []);

// ---- 回滚：只还原这份提案碰过的节点/连线 ----
const rollbackPlan = rollbackCanvasPlan({
  before: {
    nodes: [
      { id: 'n1', type: 'generator', prompt: '旧提示词' },
      { id: 'keep', type: 'image', url: '/keep.png' },
    ],
    connections: [{ id: 'e0', from: 'n1', to: 'keep' }],
  },
  current: {
    nodes: [
      { id: 'n1', type: 'generator', prompt: '新提示词' },
      { id: 'keep', type: 'image', url: '/keep.png' },
      { id: 'created', type: 'image', url: '/new.png' },
    ],
    connections: [
      { id: 'e0', from: 'n1', to: 'keep' },
      { id: 'e1', from: 'n1', to: 'created' },
    ],
  },
  actions: [
    { type: 'update_node_params', nodeId: 'n1', patch: { prompt: '新提示词' } },
    { type: 'create_node', tempId: 'created', nodeType: 'image' },
    { type: 'connect_nodes', sourceNodeId: 'n1', targetNodeId: 'created' },
  ],
  createdNodeIds: ['created'],
});
assert.deepEqual(rollbackPlan.summary.removedNodes, ['created']);
assert.deepEqual(rollbackPlan.summary.restoredNodes, ['n1']);
assert.equal(rollbackPlan.summary.removedEdges, 1);
assert.equal(rollbackPlan.nodes.find((node) => node.id === 'n1')?.prompt, '旧提示词');
assert.equal(rollbackPlan.nodes.some((node) => node.id === 'created'), false);
assert.equal(rollbackPlan.nodes.some((node) => node.id === 'keep'), true, '没碰过的节点保留');
assert.equal(rollbackPlan.connections.length, 1);
assert.equal(rollbackPlan.connections[0].id, 'e0');
// 应用之后又手改过：算冲突，界面要提示会被覆盖。
const conflictedPlan = rollbackCanvasPlan({
  before: { nodes: [{ id: 'n1', type: 'generator', prompt: '旧' }], connections: [] },
  current: { nodes: [{ id: 'n1', type: 'generator', prompt: '用户后来改的' }], connections: [] },
  actions: [{ type: 'update_node_params', nodeId: 'n1', patch: { prompt: '新' } }],
  createdNodeIds: [],
});
assert.deepEqual(conflictedPlan.summary.conflicts, ['n1']);

// 思考过程：各家字段不一，取不到就空
assert.equal(
  extractReasoningText({ choices: [{ message: { reasoning_content: '先看资产，再定机位' } }] }),
  '先看资产，再定机位',
);
assert.equal(
  extractReasoningText({ choices: [{ message: { content: [{ type: 'thinking', text: '甲' }, { type: 'text', text: '乙' }] } }] }),
  '甲',
);
assert.equal(extractReasoningText({ choices: [{ message: { content: '正文' } }] }), '');
assert.equal(extractReasoningText({}), '');

// 快照只留最近 N 份
const pruneDir = mkdtempSync(path.join(tmpdir(), 'canvas-snap-'));
['a', 'b', 'c', 'd'].forEach((name) => writeFileSync(path.join(pruneDir, `${name}.json`), '{}'));
assert.equal(pruneCanvasSnapshots(pruneDir, 2), 2);
assert.equal(readdirSync(pruneDir).filter((name) => name.endsWith('.json')).length, 2);
rmSync(pruneDir, { recursive: true, force: true });


// ---- 记忆 / 指标 / 工具契约 / Agent Key ----
assert.equal(memoryPromptPrefix([]), '');
const memoryText = memoryPromptPrefix([
  { kind: 'fact', key: '主角', value: '银发少年' },
  { kind: 'preference', key: '默认时长', value: '15s' },
]);
assert.match(memoryText, /\[project_memory\]/);
assert.match(memoryText, /事实｜主角：银发少年/);
assert.match(memoryText, /偏好｜默认时长：15s/);
assert.equal(memoryPromptPrefix([{ kind: 'fact', key: '', value: 'x' }]), '');

assert.equal(toolContract('trigger_skill_execution')?.requiresApproval, true);
assert.equal(toolContract('create_canvas_nodes')?.requiresApproval, false);
assert.equal(toolContract('nope'), null);
assert.equal(toolContract('run_foo', ['run_foo'])?.requiresApproval, true);
assert.equal(toolResultContent('remember_project_fact').status, 'stored');
assert.equal(actionRequiresApproval('execute_node_skill'), true);
assert.equal(actionRequiresApproval('create_node'), false);

const metaDb = new Database(':memory:');
initCanvasAgentConversationSchema(metaDb);
initCanvasAgentJobSchema(metaDb);
initCanvasAgentTurnSchema(metaDb);
initCanvasAgentMemorySchema(metaDb);
initCanvasAgentApiKeySchema(metaDb);
metaDb.exec(`CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT, display_name TEXT, password_hash TEXT, role TEXT, disabled INTEGER
)`);
metaDb.prepare('INSERT INTO users (id, email, display_name, password_hash, role, disabled) VALUES (?, ?, ?, ?, ?, 0)')
  .run('user', 'u@local', '用户', 'x', 'admin');
const memoryConversation = createCanvasAgentConversation(metaDb, 'user', 'canvas-mem', '记忆');
assert.equal(
  upsertAgentMemory(metaDb, 'user', 'canvas-mem', { kind: 'fact', key: '主角', value: '银发' })?.key,
  '主角',
);
assert.equal(
  upsertAgentMemory(metaDb, 'user', 'canvas-mem', { kind: 'fact', key: '主角', value: '银发少年' })?.value,
  '银发少年',
);
assert.equal(upsertAgentMemory(metaDb, 'user', 'canvas-mem', { kind: 'bad', key: 'x', value: 'y' }), null);
assert.equal(listAgentMemory(metaDb, 'user', 'canvas-mem').length, 1);
assert.equal(listAgentMemory(metaDb, 'user', 'canvas-mem')[0].value, '银发少年');
assert.equal(deleteAgentMemory(metaDb, 'user', 'canvas-mem', 'fact', '主角'), true);
assert.equal(listAgentMemory(metaDb, 'user', 'canvas-mem').length, 0);

const turnId = startAgentTurn(metaDb, {
  userId: 'user',
  canvasId: 'canvas-mem',
  conversationId: memoryConversation.id,
  jobId: 'job-1',
  model: 'fake-model',
});
assert.equal(countTurnsSince(metaDb, 'user', Date.now() - 3_600_000), 1);
finishAgentTurn(metaDb, turnId, { status: 'ok', replyChars: 12, proposalActions: 2 });
const metrics = summarizeAgentTurns(metaDb, 'user', Date.now() - 3_600_000);
assert.equal(metrics.totals.ok, 1);
assert.equal(metrics.byModel[0].model, 'fake-model');
assert.ok(metrics.latencyMs.avg >= 0);
assert.equal(overDailyQuota(10, 10), true);
assert.equal(overDailyQuota(9, 10), false);
assert.equal(overDailyQuota(100, 0), false);

const apiKey = createAgentApiKey(metaDb, 'user', 'mcp');
assert.ok(apiKey?.token.startsWith('agt_'));
assert.equal(listAgentApiKeys(metaDb, 'user').length, 1);
assert.equal(resolveAgentApiKeyOwner(metaDb, apiKey!.token)?.id, 'user');
assert.equal(revokeAgentApiKey(metaDb, 'user', apiKey!.key.id), true);
assert.equal(resolveAgentApiKeyOwner(metaDb, apiKey!.token), null);
assert.equal(resolveAgentApiKeyOwner(metaDb, 'agt_nope'), null);

// 作用域：只读 Key 不能写
const readOnlyKey = createAgentApiKey(metaDb, 'user', 'reader', ['read']);
assert.deepEqual(readOnlyKey?.key.scopes, ['read']);
assert.deepEqual(resolveAgentApiKeyOwner(metaDb, readOnlyKey!.token)?.scopes, ['read']);
const fullKey = createAgentApiKey(metaDb, 'user', 'all', ['read', 'run', 'write']);
assert.deepEqual(fullKey?.key.scopes, ['read', 'run', 'write']);
const fallbackKey = createAgentApiKey(metaDb, 'user', 'fallback', ['nonsense']);
assert.deepEqual(fallbackKey?.key.scopes, ['read', 'run', 'write']);

// 历史压缩与记忆命中
const historyTurns = Array.from({ length: 12 }, (_, index) => ({
  role: index % 2 ? 'assistant' as const : 'user' as const,
  content: `第${index}条`,
}));
const compacted = compactHistory(historyTurns, 10);
assert.equal(compacted.kept.length, 10);
assert.match(compacted.digest, /更早的对话（2 条）/);
assert.match(compacted.digest, /第0条/);
assert.equal(compactHistory(historyTurns.slice(0, 3), 10).digest, '');
assert.equal(compactHistory([], 10).kept.length, 0);
assert.deepEqual(searchMemoryHits([], '银发'), []);
const memoryHits = searchMemoryHits([
  { kind: 'fact', key: '主角', value: '银发少年 红色披风' },
  { kind: 'preference', key: '默认时长', value: '15s' },
], '银发 披风', 5);
assert.equal(memoryHits.length, 1);
assert.equal(memoryHits[0].key, '主角');
assert.match(memoryHitsPrompt(memoryHits), /\[memory_hits\]/);
assert.equal(memoryHitsPrompt([]), '');
metaDb.close();


const approvalPanelSource = readFileSync(new URL('./ui/AgentFloatingPanel.tsx', import.meta.url), 'utf8');
assert.match(approvalPanelSource, /useState<AgentMode>\('auto'\)/);
assert.match(approvalPanelSource, /setMode\('auto'\)/);
assert.match(approvalPanelSource, /手动确认：建\/连\/改直接落板/);
assert.match(approvalPanelSource, /运行在任何模式下都要审批卡/);
assert.match(approvalPanelSource, /approveRunCard\(nodeIds\)/);
assert.match(approvalPanelSource, /runScopeMatches\(/);
assert.match(approvalPanelSource, /cancelAgentTurn\(/);
assert.match(approvalPanelSource, /nodeLabelsFor\(/);
assert.doesNotMatch(approvalPanelSource, /等待确认/);
assert.match(approvalPanelSource, /'已执行'/);
assert.match(approvalPanelSource, /status: 'applying'/);
assert.match(approvalPanelSource, /ackAgentJob\(/);
assert.match(approvalPanelSource, /event\.jobId/);
const approvalRouteSource = readFileSync(new URL('./server/registerCanvasAgentRoutes.ts', import.meta.url), 'utf8');
assert.match(approvalRouteSource, /initCanvasAgentJobSchema\(db\)/);
assert.match(approvalRouteSource, /app\.get\('\/api\/canvas-agent\/jobs'/);
assert.match(approvalRouteSource, /app\.post\('\/api\/canvas-agent\/jobs\/:id\/events'/);
assert.match(approvalRouteSource, /app\.post\('\/api\/canvas-agent\/jobs'/);
assert.match(approvalRouteSource, /app\.post\('\/api\/canvas-agent\/jobs\/:id\/observations'/);
assert.match(approvalRouteSource, /app\.get\('\/api\/canvas-agent\/jobs\/:id\/stream'/);
assert.match(approvalRouteSource, /\/api\/canvas-agent\/keys/);
assert.match(approvalRouteSource, /Bearer/);
assert.match(approvalRouteSource, /remember_project_fact/);
assert.match(approvalRouteSource, /\/api\/canvas-agent\/metrics/);
assert.match(approvalRouteSource, /\/api\/canvas-agent\/memory/);
assert.match(approvalRouteSource, /type: 'thinking'/);
assert.match(approvalPanelSource, /ThinkingFold text/);
// 新对话要清技能芯片，否则上一轮技能继续生效
assert.match(approvalPanelSource, /appliedSkillRef\.current = '';\n\s+setPlaybookId\(''\);/);
assert.match(approvalRouteSource, /text\/prompt nodes must hold plain prose/);
assert.match(approvalRouteSource, /available references, not the default subject/);
assert.match(approvalRouteSource, /never by \{\{node-id\}\} tokens/);
assert.match(approvalRouteSource, /Do not plan shots or create nodes before those are confirmed/);
assert.match(approvalRouteSource, /combatStageDecision\(/);
assert.match(approvalRouteSource, /stageGate\.notice/);
const combatPlaybookSource = readFileSync(new URL('../../../prompts/playbook_combat_fx.md', import.meta.url), 'utf8');
assert.match(combatPlaybookSource, /分镜剧本写进 prompt 节点/);
assert.match(combatPlaybookSource, /不要写 `\{\{节点\}\}` 引用/);
// 共享运镜词典不能压过技能自身的分镜/节奏
assert.match(combatPlaybookSource, /两者冲突时\*\*以本技能为准\*\*/);
assert.match(combatPlaybookSource, /打斗至少两个角色/);
assert.match(combatPlaybookSource, /六项没确认之前，只做分析和提问/);
assert.match(approvalRouteSource, /\[stage_rule\] 第一张提问卡先确认主角/);
// 准备阶段强制 ask_user：问题只能走卡片
assert.match(approvalRouteSource, /forceAsk/);
assert.match(approvalRouteSource, /tool_choice: forceAsk/);
assert.match(approvalRouteSource, /Never ask questions in prose/);
assert.match(approvalRouteSource, /120-200 字的分析/);
assert.match(combatPlaybookSource, /对手也要锚点/);
assert.match(approvalRouteSource, /opponent-anchor-/);
assert.match(approvalRouteSource, /opponent_anchor/);
assert.match(approvalRouteSource, /blocked-opponent-anchor/);
assert.match(approvalRouteSource, /role "opponent"/);
assert.match(approvalRouteSource, /storyboardAskBlocked/);
assert.match(approvalRouteSource, /storyboard_written/);
assert.match(approvalRouteSource, /opponentPending/);
assert.match(approvalRouteSource, /Never ask the user to confirm an image before it is actually generated/);
assert.match(approvalPanelSource, /autoWatchRef/);
assert.match(approvalPanelSource, /waitingForAnswer/);
assert.match(approvalPanelSource, /\[\[自动\]\]/);
assert.match(approvalRouteSource, /Messages whose text starts with \[\[自动\]\]/);
// 新建可生成节点：同轮补运行请求，用户只在卡片上批准
const autoRun = appendRunProposalForNewGenerativeNodes('canvas-combat-fx', [
  { type: 'create_node', tempId: 'img1', nodeType: 'image' },
]);
assert.equal(autoRun.length, 2);
assert.equal(autoRun[1]?.type, 'execute_node_skill');
assert.equal(autoRun[1]?.nodeId, 'img1');
assert.equal(
  appendRunProposalForNewGenerativeNodes('canvas-combat-fx', [
    { type: 'create_node', tempId: 'img1', nodeType: 'image' },
    { type: 'execute_node_skill', nodeId: 'img1' },
  ]).length,
  2,
);
assert.equal(
  appendRunProposalForNewGenerativeNodes('canvas-video-piece', [
    { type: 'create_node', tempId: 'img1', nodeType: 'image' },
  ]).length,
  1,
);
assert.match(approvalRouteSource, /appendRunProposalForNewGenerativeNodes/);
assert.match(approvalRouteSource, /角色参考怎么定/);
assert.match(approvalRouteSource, /action\.nodeType === 'image' \|\| action\.nodeType === 'generator'/);
assert.match(approvalRouteSource, /params\.ratio = '16:9'/);
assert.match(approvalRouteSource, /const effectivePlaybookId/);
const autoRunGenerator = appendRunProposalForNewGenerativeNodes('canvas-combat-fx', [
  { type: 'create_node', tempId: 'gen1', nodeType: 'generator' },
]);
assert.equal(autoRunGenerator.length, 2);
assert.equal(autoRunGenerator[1]?.type, 'execute_node_skill');
assert.equal((autoRunGenerator[1] as { nodeId?: string }).nodeId, 'gen1');
assert.doesNotMatch(COMBAT_ANCHOR_NOTICE, /confirm_character_anchor/);
assert.match(combatPlaybookSource, /第一个问题先确认主角/);
assert.match(combatPlaybookSource, /confirm_character_anchor/);
assert.match(approvalRouteSource, /confirm_character_anchor/);
assert.match(approvalRouteSource, /follow the skill's preparation order/);
const cameraBridgeSource = readFileSync(new URL('../../services/canvasMxShellPromptBridge.ts', import.meta.url), 'utf8');
assert.match(cameraBridgeSource, /运镜词典（写法参考）/);
assert.match(cameraBridgeSource, /技能正文的分镜结构、节奏与特效层优先/);
assert.match(approvalRouteSource, /proposal\.jobId = jobId/);
assert.match(approvalRouteSource, /sendEvent\(res, \{ type: 'thinking', text: firstText \}\)/);
assert.match(approvalPanelSource, /TurnTimeline steps=\{steps\}/);
assert.match(approvalRouteSource, /if \(!regenerate\) \{/);
assert.match(approvalPanelSource, /sendText\(previous\.content, messages\.slice\(0, index - 1\), undefined, true\)/);
assert.match(approvalRouteSource, /step: \(getAgentJob\(/);
assert.match(approvalPanelSource, /jobIdOfProposal/);
assert.match(approvalRouteSource, /\/proposals\/:id\/rollback/);
assert.match(approvalRouteSource, /copyCanvasDocumentTo\(/);
assert.match(approvalRouteSource, /status === 'applying'/);
assert.match(approvalPanelSource, /requestRollback\(/);
assert.match(approvalPanelSource, /rollbackProposalApi\(/);
const mcpSource = readFileSync(new URL('../../../scripts/canvas-agent-mcp.mjs', import.meta.url), 'utf8');
assert.match(mcpSource, /tools\/list/);
assert.match(mcpSource, /canvas_agent_job_create/);
const toolRegistrySource = readFileSync(new URL('./tools/skillRegistry.ts', import.meta.url), 'utf8');
assert.match(toolRegistrySource, /remember_project_fact/);
assert.match(approvalPanelSource, /postAgentJobObservation\(/);
assert.match(approvalPanelSource, /listAgentJobs\(/);
assert.match(approvalPanelSource, /runNodeIdsOf\(/);
assert.match(approvalPanelSource, /resumeJobRun\(/);
assert.match(approvalPanelSource, /remainingRunNodes\(/);
const facadeSourceForSteps = readFileSync(new URL('./core/canvasFacade.ts', import.meta.url), 'utf8');
assert.match(facadeSourceForSteps, /onStep\?\.\(\{ nodeId, status: 'done' \}\)/);
assert.match(facadeSourceForSteps, /onStep\?\.\(\{ nodeId, status: 'failed', message \}\)/);
assert.match(approvalRouteSource, /app\.post\('\/api\/canvas-agent\/conversations\/:id\/cancel'/);
assert.match(approvalRouteSource, /turnStatePrefix\(/);
assert.equal(turnStatePrefix({ cancelled: false, pendingAsks: [] }), '');
assert.equal(turnStatePrefix({ cancelled: false, pendingAsks: [' ', ''] }), '');
assert.match(
  turnStatePrefix({ cancelled: true, pendingAsks: [] }),
  /\[user_cancelled\]\n上一轮用户取消了，不要默默续跑原计划；把下一条消息当新指示。/,
);
assert.match(
  turnStatePrefix({ cancelled: false, pendingAsks: ['几秒？', '要哪些镜头？'] }),
  /\[unanswered_asks\]\n上一轮的提问卡还没有答复：「几秒？」、「要哪些镜头？」。没答不等于同意/,
);
assert.match(
  turnStatePrefix({ cancelled: true, pendingAsks: ['几秒？'] }),
  /\[user_cancelled\][\s\S]*\[unanswered_asks\]/,
);
const askCardViewSource = readFileSync(new URL('./ui/AskCardView.tsx', import.meta.url), 'utf8');
assert.match(askCardViewSource, /询问中…/);
assert.match(askCardViewSource, /is-asking/);
assert.match(askCardViewSource, /已跳过（用默认）/);
const askPagerSource = readFileSync(new URL('./ui/AskPager.tsx', import.meta.url), 'utf8');
assert.match(askPagerSource, /询问中…/);
// 自己写：点一下先点亮再输入，单选时清掉其它选项
assert.match(askPagerSource, /writing \|\| draft\.trim\(\)/);
assert.match(askPagerSource, /setWriting\(true\)/);
// 作业横幅放在正文末尾，不再置顶
assert.ok(
  approvalPanelSource.indexOf('{activeJob && !jobNoticeHidden') > approvalPanelSource.indexOf('{notice ? <div className="canvas-agent-notice"'),
  '作业横幅应在 notice 之后（正文底部）',
);
assert.equal(canvasAgentStagePrefix('canvas-opening-animation', 1, 'canvas-video-piece', [
  { id: 'vid_xxx', nodeType: 'video', label: '阿波罗开场 10 秒' },
]).includes('步骤'), false);
const keptByLedger = settleReferenceActions([
  { type: 'connect_nodes', sourceNodeId: 'vid_xxx', targetNodeId: 'vid_new' },
], [{ id: 'vid_xxx', type: 'video' }], [], citationsForApply('符合预期', ['vid_xxx']), [], 'other-session');
assert.equal(keptByLedger.some((action) => action.type === 'connect_nodes'), true);
const droppedWithoutLedger = settleReferenceActions([
  { type: 'connect_nodes', sourceNodeId: 'vid_xxx', targetNodeId: 'vid_new' },
], [{ id: 'vid_xxx', type: 'video' }], [], citationsForApply('符合预期', []), [], 'other-session');
assert.equal(droppedWithoutLedger.some((action) => action.type === 'connect_nodes'), false);
const namedLedger = effectedFromApply([
  { type: 'create_node', tempId: 'temp', nodeType: 'video', initialParams: { reason: '模型解释' } },
], { temp: 'vid_real' }, []);
assert.equal(namedLedger[0]?.id, 'vid_real');
assert.equal(namedLedger[0]?.label, '模型解释');
const untitled = effectedFromApply([
  { type: 'create_node', tempId: 'temp', nodeType: 'generator', initialParams: {} },
], { temp: 'gen_real' }, []);
assert.equal(untitled[0]?.label, undefined);
assert.match(changelogFromActions([
  { type: 'create_node', tempId: 'temp', nodeType: 'video' },
  { type: 'connect_nodes', sourceNodeId: 'img_a', targetNodeId: 'temp' },
], { temp: 'vid_xxx' }), /createNode: vid_xxx（video）[\s\S]*connectNodes: 1 条（img_a → vid_xxx）/);
const playbookPanelSource = readFileSync(new URL('./ui/AgentFloatingPanel.tsx', import.meta.url), 'utf8');
assert.doesNotMatch(playbookPanelSource, /按编排规范|按技能「|画布编排/);
assert.match(playbookPanelSource, /setPlaybookId\(playbook\.id\)/);
assert.match(playbookPanelSource, /\{playbook\.when\}/);
assert.doesNotMatch(playbookPanelSource, /setInput\(`按技能/);
assert.equal(playbookPanelSource.includes('operatingPrompt('), false);
const playbookFacadeSource = readFileSync(new URL('./core/canvasFacade.ts', import.meta.url), 'utf8');
assert.equal(playbookFacadeSource.includes('operatingPrompt('), false);
const playbookContextSource = readFileSync(new URL('./core/contextSerializer.ts', import.meta.url), 'utf8');
assert.equal(playbookContextSource.includes('operatingPrompt('), false);
const playbookRouteSource = readFileSync(new URL('./server/registerCanvasAgentRoutes.ts', import.meta.url), 'utf8');
assert.equal(playbookRouteSource.includes('projectRoot'), false);
assert.equal(playbookRouteSource.includes('readFileSync'), false);
assert.match(playbookRouteSource, /operatingPrompt\(turnMessage, playbookText\)/);
assert.match(playbookRouteSource, /readPlaybookText\(requestedPlaybookId\)/);
assert.doesNotMatch(playbookRouteSource, /body\.path/);
assert.match(playbookPanelSource, /setPlaybookId\(playbook\.id\)/);
assert.match(playbookPanelSource, /canvas-agent-skill-chip/);
assert.doesNotMatch(playbookPanelSource, /取消技能/);
assert.match(playbookPanelSource, /data-skill-chip/);
assert.match(playbookPanelSource, /canvas-agent-mention-pill/);
assert.match(playbookPanelSource, /canvas-agent-mention-pill-thumb/);
assert.match(playbookPanelSource, /UserMessageBody/);
assert.match(playbookPanelSource, /canvas-agent-composer-input/);
assert.doesNotMatch(playbookPanelSource, /canvas-agent-chip-row/);
assert.doesNotMatch(playbookPanelSource, /chipsInline/);
assert.doesNotMatch(
  readFileSync(new URL('./ui/canvas-agent.css', import.meta.url), 'utf8'),
  /overflow-x:\s*auto/,
);
assert.doesNotMatch(playbookPanelSource, /移除引用/);
assert.doesNotMatch(playbookPanelSource, /setInput\(insertMention/);
const playbookClientSource = readFileSync(new URL('./core/agentService.ts', import.meta.url), 'utf8');
assert.match(playbookClientSource, /playbookId: request\.playbookId/);
assert.doesNotMatch(playbookClientSource, /path: request\.path/);
const mxShellSource = readFileSync(new URL('../../services/canvasMxShellPromptBridge.ts', import.meta.url), 'utf8');
assert.match(mxShellSource, /prompts", "mx_shell_prompt_system\.md"/);
assert.match(mxShellSource, /skills", "mx-shell-prompt", "Skill", "SKILL\.md"/);
const playbookRoot = mkdtempSync(path.join(tmpdir(), 'playbook-'));
try {
  assert.equal(readRegisteredPlaybookText(playbookRoot, ''), '');
  assert.equal(readRegisteredPlaybookText(playbookRoot, 'missing-id'), '');
  assert.equal(readRegisteredPlaybookText(playbookRoot, 'prompts/playbook_video_content.md'), '');
  assert.equal(operatingPrompt('x', readRegisteredPlaybookText(playbookRoot, 'canvas-video-piece')), intakePrompt);
  mkdirSync(path.join(playbookRoot, 'prompts'));
  const playbookFile = path.join(playbookRoot, 'prompts', 'playbook_video_content.md');
  writeFileSync(playbookFile, '字甲\n', 'utf8');
  assert.equal(readRegisteredPlaybookText(playbookRoot, 'canvas-video-piece'), '字甲');
  writeFileSync(playbookFile, '字乙\n', 'utf8');
  assert.equal(readRegisteredPlaybookText(playbookRoot, 'canvas-video-piece'), '字乙');
  assert.equal(readRegisteredPlaybookText(playbookRoot, '../playbook_video_content.md'), '');
  rmSync(playbookFile);
  assert.equal(readRegisteredPlaybookText(playbookRoot, 'canvas-video-piece'), '');
  assert.equal(operatingPrompt('缺文件', readRegisteredPlaybookText(playbookRoot, 'canvas-video-piece')), intakePrompt);
} finally {
  rmSync(playbookRoot, { recursive: true, force: true });
}
assert.match(intakePrompt, /include both the structural actions and the execution in one proposal/);
assert.doesNotMatch(intakePrompt, /Never execute until the user asks/);
assert.doesNotMatch(intakePrompt, /propose anchor nodes without execution/);
assert.doesNotMatch(intakePrompt, /Never run the whole piece in one proposal/);
assert.doesNotMatch(intakePrompt, /do only the next unfinished stage/);

// stub：不打模型。只按提示词里那句「explicitly asks」决定要不要带执行。
function stubDirectProposal(message: string): Array<{ type: string; nodeId?: string }> {
  const prompt = operatingPrompt(message);
  const guided = /If the user explicitly asks to run or execute, include both the structural actions and the execution in one proposal/.test(prompt);
  const explicit = /(?:直接执行|\bexecute\b|\brun\b)/i.test(message);
  const actions: Array<{ type: string; nodeId?: string }> = [
    { type: 'create_node' },
  ];
  if (classifyIntake(message) === 'direct' && guided && explicit) {
    const count = /全部三个/.test(message) ? 3 : 1;
    for (let index = 0; index < count; index += 1) {
      actions.push({ type: 'execute_node_skill', nodeId: `n${index + 1}` });
    }
  }
  return actions;
}
const askedToRun = stubDirectProposal('建好之后直接执行');
assert.equal(classifyIntake('建好之后直接执行'), 'direct');
assert.equal(askedToRun.filter((action) => action.type === 'execute_node_skill').length, 1);
const createOnly = stubDirectProposal('建一个节点');
assert.equal(classifyIntake('建一个节点'), 'direct');
assert.equal(createOnly.some((action) => action.type === 'execute_node_skill'), false);
const shortFilmRun = stubDirectProposal('做一条30秒短片，角色保持一致。建好之后直接执行。');
assert.equal(classifyIntake('做一条30秒短片，角色保持一致。建好之后直接执行。'), 'direct');
assert.equal(shortFilmRun.some((action) => action.type === 'execute_node_skill'), true);
const threeShots = stubDirectProposal('帮我做一支 12 秒的短片。建好之后直接执行全部三个');
assert.equal(threeShots.filter((action) => action.type === 'execute_node_skill').length, 3);
const filmOnly = stubDirectProposal('帮我做一支短片');
assert.equal(filmOnly.some((action) => action.type === 'execute_node_skill'), false);

outcomeDb.close();

assert.equal(context.activeSelectedNodes[0]?.prompt, 'slow dolly in');
assert.notEqual(context.activeSelectedNodes[0]?.prompt, '…');
const twoSelected = collectCanvasContext({
  ...snapshot,
  nodes: [
    { id: 'a', type: 'prompt', text: 'FIRST_BODY' },
    { id: 'b', type: 'prompt', text: 'SECOND_BODY' },
  ],
  connections: [],
  selectedNodeIds: ['a', 'b'],
});
assert.equal(twoSelected.activeSelectedNodes[0]?.text, 'FIRST_BODY');
assert.equal(twoSelected.activeSelectedNodes[1]?.text, 'SECOND_BODY');
const fixturePacked = serializeCanvasContext(snapshot);
assert.match(fixturePacked, /slow dolly in/);
assert.ok(fixturePacked.length < 14_000);
const cappedBody = 'C'.repeat(900);
const longSelected = collectCanvasContext({
  ...snapshot,
  nodes: [{ id: 'video-1', type: 'video', prompt: 'C'.repeat(3000) }],
  connections: [],
  selectedNodeIds: ['video-1'],
});
assert.equal(longSelected.activeSelectedNodes[0]?.prompt, `${cappedBody}…`);
const longPacked = serializeCanvasContext({
  ...snapshot,
  nodes: [{ id: 'video-1', type: 'video', prompt: 'C'.repeat(3000) }],
  connections: [],
  selectedNodeIds: ['video-1'],
});
assert.ok(longPacked.includes(cappedBody));
assert.ok(longPacked.length > fixturePacked.length);
assert.ok(longPacked.length < 14_000);

const engineSource = readFileSync('src/lib/infiniteCanvas/canvasEngine.js', 'utf8');
assert.match(engineSource, /data-prompt-capsules="1"/);
assert.match(engineSource, /referenceCapsuleLabel\(source, order\)/);
assert.match(engineSource, /mountPromptCapsules\(localPrompt, node\)/);
assert.match(engineSource, /mountPromptCapsules\(promptEl, node\)/);
const connectRejectReason = new Function(
  'nodes',
  'fromId',
  'toId',
  `${engineSlice(engineSource, 'export function canvasAgentConnectRejectReason(', 'function canConnect(fromId, toId){')}
  return canvasAgentConnectRejectReason(fromId, toId);`,
) as (nodes: Array<{ id: string }>, fromId: string, toId: string) => string;
const stitchedGrid = connectRejectReason(
  [
    { id: 'gen_34fa77d3c7dbf8_1792483194168' },
    { id: 'gen_1692b1ee6e2a5_1792483194168' },
    { id: 'ngrid_d0a2d991072fe8_1792483805955' },
  ],
  'gen_34fa77d3c7dbf8_1792483194168',
  'ngrid_d0a2d991072fe8_1792483194168',
);
assert.match(stitchedGrid, /端点不存在：ngrid_d0a2d991072fe8_1792483194168 不在画布上/);
assert.match(stitchedGrid, /画布上的 ngrid_ 节点：ngrid_d0a2d991072fe8_1792483805955/);
assert.doesNotMatch(stitchedGrid, /画布上的 ngrid_ 节点：[^。]*1792483194168/);
const tempMiss = connectRejectReason(
  [
    { id: 'gen_34fa77d3c7dbf8_1792483194168' },
    { id: 'ngrid_d0a2d991072fe8_1792483805955' },
  ],
  'gen_34fa77d3c7dbf8_1792483194168',
  'nine_grid_board',
);
assert.match(tempMiss, /端点不存在：nine_grid_board 不在画布上$/);
assert.doesNotMatch(tempMiss, /5955/);
const clipStart = engineSource.indexOf('const AGENT_SOURCE_PROMPT_MAX');
const clipEnd = engineSource.indexOf('function summarizeCanvasAgentSource');
assert.ok(clipStart > 0 && clipEnd > clipStart);
const clipAgentSourcePrompt = new Function(
  `${engineSource.slice(clipStart, clipEnd)}; return clipAgentSourcePrompt;`,
)() as (value: string) => string;
assert.equal(clipAgentSourcePrompt('A'.repeat(3000)).length, 3000);
assert.equal(clipAgentSourcePrompt('A'.repeat(13000)).length, 12288);

const clampStart = engineSource.indexOf('const VIDEO_ASPECT_LIST');
const clampEnd = engineSource.indexOf('function uid(', clampStart);
assert.ok(clampStart > 0 && clampEnd > clampStart);
const flatStart = engineSource.indexOf('const CANVAS_AGENT_PROTECTED_NODE_KEYS');
const flatEnd = engineSource.indexOf('// 单条来源正文上限', flatStart);
assert.ok(flatStart > 0 && flatEnd > flatStart);
const videoClamp = new Function(
  'saved',
  `${engineSource.slice(clampStart, clampEnd)}
   ${engineSource.slice(flatStart, flatEnd)}
   function flushCanvasAgentSave(){ saved.push(JSON.parse(JSON.stringify(arguments[0] || null))); }
   return { commitAgentVideoParamClamp, applyVideoModelDefaults, videoDurationBounds, flattenCanvasAgentParameters, canvasAgentSafePatch };`,
) as unknown as (
  saved: unknown[],
) => {
  commitAgentVideoParamClamp: (node: Record<string, unknown>) => boolean;
  applyVideoModelDefaults: (node: Record<string, unknown>) => void;
  videoDurationBounds: (model: string) => { min: number; max: number };
  flattenCanvasAgentParameters: (raw: Record<string, unknown>) => Record<string, unknown>;
  canvasAgentSafePatch: (raw: Record<string, unknown>) => Record<string, unknown>;
};
const clampSaves: Array<Record<string, unknown> | null> = [];
const clampApi = videoClamp(clampSaves);
const reasonKeptOffNode = clampApi.canvasAgentSafePatch({
  reason: '建立主角诸葛亮跨段角色视觉锚点',
  prompt: 'keep',
});
assert.equal(reasonKeptOffNode.reason, undefined);
assert.equal(reasonKeptOffNode.prompt, 'keep');
const conversationKeptOffNode = clampApi.canvasAgentSafePatch({
  agentConversationId: 'other-conversation',
  prompt: 'keep',
});
assert.equal(conversationKeptOffNode.agentConversationId, undefined);
assert.equal(conversationKeptOffNode.prompt, 'keep');
assert.match(engineSource, /if\(conversationId\) node\.agentConversationId = conversationId/);
function rememberClamp(node: Record<string, unknown>){
  const saved = clampSaves;
  const original = videoClamp;
  void original;
  const wrapped = new Function(
    'saved',
    'node',
    `${engineSource.slice(clampStart, clampEnd)}
     function flushCanvasAgentSave(){ saved.push(JSON.parse(JSON.stringify(node))); }
     return commitAgentVideoParamClamp(node);`,
  ) as (saved: unknown[], node: Record<string, unknown>) => boolean;
  return wrapped(saved, node);
}
const hailuoFour: Record<string, unknown> = {
  type: 'video',
  model: 'hailuo-h3',
  duration: 5,
  aspectRatio: '16:9',
  resolution: '768P',
};
Object.assign(hailuoFour, { model: 'hailuo-h3', duration: 4, aspectRatio: '3:4' });
assert.equal(rememberClamp(hailuoFour), true);
assert.equal(hailuoFour.duration, 5);
assert.equal(hailuoFour.aspectRatio, '3:4');
const fourRecord = (hailuoFour.agentParamClamped as Array<{ key: string; from: number; to: number; reason: string }>)
  .find((item) => item.key === 'duration');
assert.equal(fourRecord?.from, 4);
assert.equal(fourRecord?.to, 5);
assert.equal(fourRecord?.reason, '该模型的时长范围');
const fourDisk = JSON.parse(JSON.stringify(hailuoFour)) as typeof hailuoFour;
assert.equal(fourDisk.duration, 5);
assert.equal((fourDisk.agentParamClamped as Array<{ from: number; to: number }>)[0].from, 4);
assert.equal((fourDisk.agentParamClamped as Array<{ from: number; to: number }>)[0].to, 5);
const clampedContext = serializeCanvasContext({
  ...snapshot,
  nodes: [{ id: 'video-1', type: 'video', prompt: 'slow dolly in', agentParamClamped: fourDisk.agentParamClamped }],
  selectedNodeIds: ['video-1'],
});
assert.match(clampedContext, /agentParamClamped 表示某个参数被供应商取值范围改掉了/);
assert.match(clampedContext, /原值不是模型填错/);
assert.match(clampedContext, /"from":4/);
const hailuoDefault: Record<string, unknown> = {
  type: 'video', model: 'hailuo-h3', duration: 5, aspectRatio: '16:9', resolution: '768P',
};
assert.equal(rememberClamp(hailuoDefault), false);
assert.equal(hailuoDefault.duration, 5);
assert.equal(hailuoDefault.agentParamClamped, undefined);
const hailuoSix: Record<string, unknown> = {
  type: 'video', model: 'hailuo-h3', duration: 6, aspectRatio: '16:9', resolution: '768P',
};
assert.equal(rememberClamp(hailuoSix), false);
assert.equal(hailuoSix.agentParamClamped, undefined);
const hailuoRes: Record<string, unknown> = {
  type: 'video', model: 'hailuo-h3', duration: 5, aspectRatio: '16:9', resolution: '720p',
};
assert.equal(rememberClamp(hailuoRes), true);
assert.equal(hailuoRes.resolution, '768P');
assert.equal(
  (hailuoRes.agentParamClamped as Array<{ key: string; from: string; to: string }>)[0].key,
  'resolution',
);
const hailuoPortrait: Record<string, unknown> = {
  type: 'video', model: 'hailuo-h3', duration: 5, aspectRatio: 'portrait', resolution: '768P',
};
assert.equal(rememberClamp(hailuoPortrait), true);
assert.equal(hailuoPortrait.aspectRatio, 'adaptive');
assert.equal(
  (hailuoPortrait.agentParamClamped as Array<{ key: string }>)[0].key,
  'aspectRatio',
);
const seedance: Record<string, unknown> = {
  type: 'video', model: 'seedance-2.0', duration: 5, aspectRatio: '16:9', resolution: '720p',
};
assert.equal(rememberClamp(seedance), true);
assert.equal(seedance.realPersonMode, true);
assert.equal(
  (seedance.agentParamClamped as Array<{ key: string; to: boolean; reason: string }>)
    .find((item) => item.key === 'realPersonMode')?.to,
  true,
);
assert.equal(
  (seedance.agentParamClamped as Array<{ key: string; reason: string }>)
    .find((item) => item.key === 'realPersonMode')?.reason,
  '该模型的默认人物模式',
);
const updated: Record<string, unknown> = {
  type: 'video', model: 'hailuo-h3', duration: 8, aspectRatio: '16:9', resolution: '768P',
};
Object.assign(updated, clampApi.canvasAgentSafePatch(clampApi.flattenCanvasAgentParameters({ duration: 4 })));
assert.equal(rememberClamp(updated), true);
assert.equal(updated.duration, 5);
assert.equal(Number(updated.duration || 5), 5);
const nestedSix: Record<string, unknown> = {
  type: 'video', model: 'hailuo-h3', duration: 8, aspectRatio: '16:9', resolution: '768P',
};
Object.assign(nestedSix, clampApi.canvasAgentSafePatch(
  clampApi.flattenCanvasAgentParameters({ parameters: { duration: 6 } }),
));
assert.equal(nestedSix.duration, 6);
assert.equal(nestedSix.parameters, undefined);
assert.equal(rememberClamp(nestedSix), false);
const nestedFour: Record<string, unknown> = {
  type: 'video', model: 'hailuo-h3', duration: 8, aspectRatio: '16:9', resolution: '768P',
};
Object.assign(nestedFour, clampApi.canvasAgentSafePatch(
  clampApi.flattenCanvasAgentParameters({ parameters: { duration: 4 } }),
));
assert.equal(nestedFour.duration, 4);
assert.equal(rememberClamp(nestedFour), true);
assert.equal(nestedFour.duration, 5);
assert.equal(
  (nestedFour.agentParamClamped as Array<{ from: number; to: number }>)[0].from,
  4,
);
assert.equal(
  (nestedFour.agentParamClamped as Array<{ from: number; to: number }>)[0].to,
  5,
);
const directSix: Record<string, unknown> = {
  type: 'video', model: 'hailuo-h3', duration: 8, aspectRatio: '16:9', resolution: '768P',
};
Object.assign(directSix, clampApi.canvasAgentSafePatch(
  clampApi.flattenCanvasAgentParameters({ duration: 6 }),
));
assert.equal(directSix.duration, 6);
assert.equal(rememberClamp(directSix), false);
const tenth: Record<string, unknown> = { type: 'generator', model: 'midjourneyV8.1', ratio: '1:1' };
Object.assign(tenth, clampApi.canvasAgentSafePatch(
  clampApi.flattenCanvasAgentParameters({ parameters: { ratio: '3:4' } }),
));
assert.equal(tenth.ratio, '3:4');
assert.equal(tenth.parameters, undefined);
assert.equal(rememberClamp(tenth), false);
assert.equal(tenth.ratio, '3:4');
const liftedInitial: Record<string, unknown> = {
  type: 'video', model: 'hailuo-h3', duration: 8, aspectRatio: '16:9', resolution: '768P',
};
Object.assign(liftedInitial, clampApi.canvasAgentSafePatch(
  clampApi.flattenCanvasAgentParameters({ initialParams: { duration: 6 } }),
));
assert.equal(liftedInitial.duration, 6);
assert.equal(liftedInitial.initialParams, undefined);
assert.equal(rememberClamp(liftedInitial), false);
const fidelityValue = { strict: true, source_dialogue: '甲：{你好}' };
const clampRecord = [{ key: 'duration', from: 4, to: 5 }];
const sourceRecord = { prompt: 'keep' };
const keptObjects = clampApi.flattenCanvasAgentParameters({
  fidelity: fidelityValue,
  agentParamClamped: clampRecord,
  agentSources: sourceRecord,
});
assert.equal((keptObjects as { fidelity: unknown }).fidelity, fidelityValue);
assert.equal((keptObjects as { agentParamClamped: unknown }).agentParamClamped, clampRecord);
assert.equal((keptObjects as { agentSources: unknown }).agentSources, sourceRecord);
const createTool = coreCanvasTools.find((tool) => tool.function.name === 'create_canvas_nodes');
const updateTool = coreCanvasTools.find((tool) => tool.function.name === 'update_node_config');
assert.equal(createTool?.function.description, describeCreateCanvasNodes(CREATE_PARAM_KEYS));
assert.equal(updateTool?.function.description, describeUpdateNodeConfig(UPDATE_PARAM_KEYS));
assert.notEqual(createTool?.function.description, describeCreateCanvasNodes(['prompt']));
assert.doesNotMatch(createTool?.function.description || '', /use these names exactly/);
const createListed = (createTool?.function.description || '').split('Accepted initialParams keys: ')[1]?.split('. 不填')[0];
const updateListed = (updateTool?.function.description || '').split('Accepted patch keys: ')[1]?.replace(/\.$/, '');
assert.deepEqual(createListed?.split(', '), [...CREATE_PARAM_KEYS]);
assert.deepEqual(updateListed?.split(', '), [...UPDATE_PARAM_KEYS]);
const createKeys = CREATE_PARAM_KEYS as readonly string[];
const updateKeys = UPDATE_PARAM_KEYS as readonly string[];
assert.equal(createKeys.includes('replacesNodeId'), true);
assert.equal(createKeys.includes('reason'), true);
assert.equal(createKeys.includes('story'), true);
assert.equal(updateKeys.includes('story'), true);
assert.equal(updateKeys.includes('reason'), true);
assert.equal(updateKeys.includes('replacesNodeId'), false);
assert.deepEqual(createKeys.filter((key) => !updateKeys.includes(key)), ['replacesNodeId']);
const durationPatch = { type: 'update_node_params' as const, nodeId: 'video-1', patch: { duration: 6 } };
assert.doesNotThrow(() => rejectUnknownCanvasParamKeys([durationPatch]));
const staleAfterGate = invalidationActions(snapshot, [durationPatch]);
const stalePatch = staleAfterGate.find((item) => item.nodeId === 'video-1')?.patch;
assert.equal(stalePatch?.agentStale, true);
assert.equal(stalePatch?.agentStaleReason, '节点参数或输入引用已变更');
assert.deepEqual(stalePatch?.agentImpactPath, ['video-1']);
assert.throws(() => rejectUnknownCanvasParamKeys(staleAfterGate), /agentStale/);
const rebuildInput = [{
  type: 'create_node' as const,
  tempId: 'new-v',
  nodeType: 'video' as const,
  initialParams: { prompt: 'keep', replacesNodeId: 'video-1' },
}];
assert.doesNotThrow(() => rejectUnknownCanvasParamKeys(rebuildInput));
const rebuilt = applyRebuildGuards(rebuildInput, snapshot);
const discarded = rebuilt.find((item) => item.type === 'update_node_params' && item.patch.agentLifecycle === 'discarded');
assert.equal(discarded?.type === 'update_node_params' ? discarded.patch.agentLifecycle : '', 'discarded');
assert.throws(() => rejectUnknownCanvasParamKeys(rebuilt.filter((item) => item.type === 'update_node_params')), /agentLifecycle/);
const liftedRatio = clampApi.flattenCanvasAgentParameters({ parameters: { ratio: '3:4' } }) as { ratio: string };
assert.doesNotThrow(() => rejectUnknownCanvasParamKeys([{
  type: 'update_node_params', nodeId: 'image-1', patch: { ratio: liftedRatio.ratio },
}]));
const tokenShapes = [
  { type: 'create_node' as const, tempId: 'note', nodeType: 'prompt' as const, initialParams: { text: 'see {{ghost}}' } },
  { type: 'create_node' as const, nodeType: 'generator' as const, initialParams: { prompt: 'see {{ghost}}' } },
  { type: 'create_node' as const, tempId: 'shot', nodeType: 'generator' as const, initialParams: { prompt: 'see {{shot}}' } },
  { type: 'create_node' as const, tempId: 'shot', nodeType: 'generator' as const, initialParams: { prompt: 'see {{missing}}' } },
  { type: 'create_node' as const, tempId: 'shot', nodeType: 'generator' as const, initialParams: { prompt: '{{char}}' } },
];
for (const shape of tokenShapes) assert.doesNotThrow(() => rejectUnknownCanvasParamKeys([shape]));
const tokenErrors = [
  '节点类型 prompt 不在生成类型名单里，所以正文里的引用被拒：{{ghost}}。',
  '节点 generator 没有 tempId，无法建立引用。',
  '节点 shot 不能引用自己。',
  '节点 shot 引用了 missing，但它不存在。',
  '删掉引用后 prompt 为空，请补上实际的提示词。',
];
for (const [index, message] of tokenErrors.entries()) {
  const id = `proposal-token-${index}`;
  const proposal: ActionProposal = {
    id, title: '建议', summary: '新增', actions: [tokenShapes[index]], status: 'pending',
    requiresApproval: true, generative: false, createdAt: index + 1,
  };
  seedOutcome(proposal);
  await runProposalApply(proposal, {
    batchApply: async () => { throw new Error(message); },
    update: rememberOutcome,
    current: () => outcomeMemory.get(id),
    persist: async () => 0,
    queue: outcomeQueue,
  });
  const saved = outcomeMemory.get(id);
  assert.equal(saved?.status, 'failed');
  assert.equal(saved?.error, message);
  const feedback = pendingExecutionFeedback(saved ? [saved] : []);
  assert.match(feedback?.content || '', /未能应用/);
  assert.match(feedback?.content || '', /请修正后重新提交/);
  assert.ok((feedback?.content || '').includes(message.split('\n')[0]));
}
const anchorPrompt = '三国诸葛亮角色锚点，参考 {{img_role_1}} 与 {{img_role_2}} 的面部与发冠特征。他身着素雅的白袍道饰，手执羽扇，神态深邃沉稳，电影级质感，精细面部，写实风格，8k --ar 16:9';
const anchorClean = readableReferencePrompt(anchorPrompt, [
  { type: 'create_node', tempId: 'img_role_1', nodeType: 'image', initialParams: { name: '角色参考1' } },
  { type: 'create_node', tempId: 'img_role_2', nodeType: 'image', initialParams: { name: '角色参考2' } },
  { type: 'create_node', tempId: 'img_scene', nodeType: 'image', initialParams: { name: '大帐场景参考' } },
], []);
assert.equal(
  anchorClean,
  '三国诸葛亮角色锚点，参考 角色参考1 与 角色参考2 的面部与发冠特征。他身着素雅的白袍道饰，手执羽扇，神态深邃沉稳，电影级质感，精细面部，写实风格，8k --ar 16:9',
);
assert.doesNotMatch(anchorClean, /\{\{/);
const anchorId = 'gen_002cc96bfe77f8_1792472870794';
const gridProposal = [
  { type: 'create_node' as const, tempId: 'grid_shot_plan', nodeType: 'nineGridAgent' as const, initialParams: { prompt: `分镜 {{${anchorId}}}` } },
  { type: 'connect_nodes' as const, sourceNodeId: anchorId, targetNodeId: 'grid_shot_plan' },
  { type: 'execute_node_skill' as const, nodeId: 'grid_shot_plan' },
];
const gridNodes = [{ id: anchorId, type: 'generator', x: 0, y: 0, name: '角色锚点：诸葛亮' }];
const gridFromConfirm = settleReferenceActions(gridProposal, gridNodes, GENERATOR_TYPES, citationsInUserMessage('确认'));
assert.equal(gridFromConfirm.some((action) => action.type === 'create_node' && action.nodeType === 'nineGridAgent'), true);
assert.equal(gridFromConfirm.some((action) => action.type === 'connect_nodes'), false);
assert.equal(droppedConnectCount(gridProposal, gridFromConfirm), 1);
const gridFromCite = settleReferenceActions(gridProposal, gridNodes, GENERATOR_TYPES, citationsInUserMessage(`{{${anchorId}}}`));
assert.equal(gridFromCite.some((action) => (
  action.type === 'connect_nodes' && action.sourceNodeId === anchorId && action.targetNodeId === 'grid_shot_plan'
)), true);
assert.equal(droppedConnectCount(gridProposal, gridFromCite), 0);
const gridFromSessionCite = settleReferenceActions(
  gridProposal,
  gridNodes,
  GENERATOR_TYPES,
  citationsForApply('确认', [anchorId]),
);
assert.equal(gridFromSessionCite.some((action) => (
  action.type === 'connect_nodes' && action.sourceNodeId === anchorId && action.targetNodeId === 'grid_shot_plan'
)), true);
const cartoonLibraryId = 'img_cartoon_turnaround';
const librarySettled = settleReferenceActions([
  { type: 'create_node' as const, tempId: 'gen_zhuge', nodeType: 'generator' as const, initialParams: { prompt: `参考 {{${cartoonLibraryId}}}` } },
  { type: 'connect_nodes' as const, sourceNodeId: cartoonLibraryId, targetNodeId: 'gen_zhuge' },
], [{ id: cartoonLibraryId, type: 'image', x: 0, y: 0, name: '卡通三视图' }], GENERATOR_TYPES, citationsForApply('确认', [anchorId]));
assert.equal(librarySettled.some((action) => action.type === 'connect_nodes' && action.sourceNodeId === cartoonLibraryId), false);
const sessionId = '1c44a842-992c-4b08-9e4d-c2f337bb803e';
const stampedAnchor = [{ ...gridNodes[0], agentConversationId: sessionId }];
const gridFromSession = settleReferenceActions(
  gridProposal,
  stampedAnchor,
  GENERATOR_TYPES,
  citationsInUserMessage('确认'),
  [],
  sessionId,
);
assert.equal(gridFromSession.filter((action) => (
  action.type === 'connect_nodes' && action.sourceNodeId === anchorId && action.targetNodeId === 'grid_shot_plan'
)).length, 1);
const otherSession = settleReferenceActions(
  gridProposal,
  [{ ...gridNodes[0], agentConversationId: 'other-conversation' }],
  GENERATOR_TYPES,
  citationsInUserMessage('确认'),
  [],
  sessionId,
);
assert.equal(otherSession.some((action) => action.type === 'connect_nodes'), false);
const libraryId = 'img_library_old';
const libraryBlocked = settleReferenceActions(
  [
    { type: 'create_node', tempId: 'grid_shot_plan', nodeType: 'nineGridAgent', initialParams: { prompt: `分镜 {{${libraryId}}}` } },
    { type: 'connect_nodes', sourceNodeId: libraryId, targetNodeId: 'grid_shot_plan' },
  ],
  [{ id: libraryId, type: 'image', x: 0, y: 0, name: '素材库' }],
  GENERATOR_TYPES,
  citationsInUserMessage('确认'),
  [],
  sessionId,
);
assert.equal(libraryBlocked.some((action) => action.type === 'connect_nodes'), false);
const storyText = '诸葛亮在帐中摊开地图，灯下核对兵符，准备迎战。';
assert.doesNotThrow(() => rejectUnknownCanvasParamKeys([
  { type: 'create_node', tempId: 'grid_story', nodeType: 'nineGridAgent', initialParams: { story: storyText } },
  { type: 'update_node_params', nodeId: 'grid_story', patch: { story: storyText } },
]));
const storySettled = settleReferenceActions([
  { type: 'create_node', tempId: 'grid_story', nodeType: 'nineGridAgent', initialParams: { story: storyText } },
], [], GENERATOR_TYPES, citationsInUserMessage('确认'));
const storyParams = storySettled.find((action) => action.type === 'create_node' && action.tempId === 'grid_story');
assert.equal(storyParams && storyParams.type === 'create_node' ? storyParams.initialParams?.story : '', storyText);
const fidelityAnchor = 'gen_anchor_zhuge';
const fidelitySettled = settleReferenceActions([
  {
    type: 'create_node',
    tempId: 'seg_1',
    nodeType: 'video',
    initialParams: {
      prompt: `{{${fidelityAnchor}}} 在帐中备战。`,
      duration: 15,
      fidelity: { strict: true, refs: [{ node_key: fidelityAnchor, role: 'character' }] },
    },
  },
], [{ id: fidelityAnchor, type: 'generator', x: 0, y: 0, title: '角色锚点：诸葛亮' }], GENERATOR_TYPES, citationsInUserMessage(`{{${fidelityAnchor}}}`));
const fidelityVideo = fidelitySettled.find((action) => action.type === 'create_node' && action.tempId === 'seg_1');
const fidelityPrompt = fidelityVideo && fidelityVideo.type === 'create_node' ? String(fidelityVideo.initialParams?.prompt || '') : '';
const fidelityPayload = fidelityVideo && fidelityVideo.type === 'create_node'
  ? fidelityVideo.initialParams?.fidelity
  : undefined;
assert.match(fidelityPrompt, /\{\{gen_anchor_zhuge\}\}/);
assert.match(fidelityPrompt, /在帐中备战/);
assert.doesNotMatch(fidelityPrompt, /角色锚点：诸葛亮/);
assert.deepEqual(checkCanvasContentFidelity({
  prompt: fidelityPrompt,
  durationSec: 15,
  fidelity: fidelityPayload as { strict: boolean; refs: Array<{ node_key: string; name?: string; role?: string }> },
}), []);
assert.throws(
  () => settleReferenceActions([
    { type: 'create_node', tempId: 'note', nodeType: 'prompt', initialParams: { text: 'see {{ghost}}' } },
  ], [], GENERATOR_TYPES, null),
  /节点类型 prompt 不在生成类型名单里，所以正文里的引用被拒：\{\{ghost\}\}。/,
);
assert.doesNotMatch(anchorClean, /参考 与/);
const numberedClean = readableReferencePrompt('参考 {{a}} 与 {{b}} 的面部特征', [
  { type: 'create_node', tempId: 'a', nodeType: 'image', initialParams: {} },
  { type: 'create_node', tempId: 'b', nodeType: 'image', initialParams: {} },
], []);
assert.equal(numberedClean, '');
assert.doesNotMatch(numberedClean, /参考图/);
assert.equal(readableReferencePrompt('{{ }}', [], []), '');
assert.equal(
  readableReferencePrompt('参考 {{img_old}} 的构图', [], [{ id: 'img_old', type: 'image', name: '旧角色' }]),
  '参考 旧角色 的构图',
);
assert.equal(
  readableReferencePrompt('阿波罗角色形象参考 {{img_a}}', [], [{ id: 'img_a', type: 'image', name: 'canvas-output-1791792460637.jpg' }]),
  '',
);
assert.equal(
  readableReferencePrompt('参考{{img_a}}阿波罗形象与{{img_b}}神殿场景。\n分镜1丨云端丨0-3s丨白袍金饰', [], [
    { id: 'img_a', type: 'image', name: 'canvas-output-1791792460637.jpg' },
    { id: 'img_b', type: 'image', name: 'canvas-output-1791858206685.jpg' },
  ]),
  '分镜1丨云端丨0-3s丨白袍金饰',
);
assert.equal(
  readableReferencePrompt('参考 {{img_b}}', [], [{ id: 'img_b', type: 'image', name: 'canvas-output-1.jpg', title: '阿波罗' }]),
  '参考 阿波罗',
);
const zhugeMessage = '一章 30 秒。三国题材，主角是诸葛亮，在帐中备战。';
const zhugePrompt = '三国诸葛亮角色锚点，参考 {{img_role_1}} 与 {{img_role_2}} 的面部与发冠特征。他身着素雅的白袍道饰，手执羽扇，神态深邃沉稳，电影级质感，精细面部，写实风格，8k --ar 16:9';
const zhugeActions = [
  { type: 'create_node' as const, tempId: 'img_role_1', nodeType: 'image', initialParams: { name: '角色参考1' } },
  { type: 'create_node' as const, tempId: 'img_role_2', nodeType: 'image', initialParams: { name: '角色参考2' } },
  { type: 'create_node' as const, tempId: 'img_scene', nodeType: 'image', initialParams: { name: '大帐场景参考' } },
  {
    type: 'create_node' as const,
    tempId: 'gen_zhuge_liang',
    nodeType: 'generator',
    initialParams: {
      apiProvider: 'runninghub',
      model: 'midjourneyV8.1',
      prompt: zhugePrompt,
      ratio: '16:9',
      title: '【角色锚点】诸葛亮',
    },
  },
];
const generatorTypes = ['generator', 'msgen', 'video', 'rh', 'replicaAgent', 'imageRepairAgent'];
const zhugeSettled = settleReferenceActions(zhugeActions, [], generatorTypes, citationsInUserMessage(zhugeMessage));
const zhugeGen = zhugeSettled.find((action) => action.type === 'create_node' && action.tempId === 'gen_zhuge_liang');
const zhugeParams = zhugeGen && zhugeGen.type === 'create_node' ? zhugeGen.initialParams : undefined;
assert.equal(zhugeParams?.model, undefined);
assert.equal(zhugeSettled.some((action) => action.type === 'connect_nodes'), false);
assert.doesNotMatch(String(zhugeParams?.prompt || ''), /参考 与/);
assert.match(String(zhugeParams?.prompt || ''), /\{\{img_role_1\}\}/);
assert.match(String(zhugeParams?.prompt || ''), /\{\{img_role_2\}\}/);
assert.doesNotMatch(String(zhugeParams?.prompt || ''), /角色参考1/);
assert.equal(zhugeParams?.ratio, '16:9');
const namedSettled = settleReferenceActions(
  zhugeActions,
  [],
  generatorTypes,
  citationsInUserMessage('参考 {{img_role_1}} 使用模型 midjourneyV8.1'),
);
const namedGen = namedSettled.find((action) => action.type === 'create_node' && action.tempId === 'gen_zhuge_liang');
// 点名留不住 midjourneyV8.1：同批有指向它的图片边，能力约束改成图片模型 V2。
assert.equal(namedGen && namedGen.type === 'create_node' ? namedGen.initialParams?.model : '', REFERENCE_IMAGE_FALLBACK_MODEL);
assert.deepEqual(
  namedSettled.filter((action) => action.type === 'connect_nodes').map((action) => (
    action.type === 'connect_nodes' ? action.sourceNodeId : ''
  )),
  ['img_role_1'],
);
const stopMessage = '使用模型 nano-banana-pro 。一章 30 秒。三国题材，主角是诸葛亮，在帐中备战。';
const stopReason = '建立主角诸葛亮跨段角色视觉锚点';
const stopActions = [
  {
    type: 'create_node' as const,
    tempId: 'gen_zhuge_anchor',
    nodeType: 'generator',
    initialParams: {
      model: 'nano-banana-pro',
      prompt: '三国写实电影质感，蜀汉丞相诸葛亮，三十余岁，容貌俊逸甚伟，面如冠玉，三绺美髯，头戴黑色纶巾，身披素色鹤氅宽袍，手持白鹅羽扇，眉宇间沉稳睿智、目光如炬。中景半身肖像，神情专注，身处中军大帐案几旁，光影明暗分明，面部轮廓与服饰纹理极度清晰一致，8k超清影视级细节。',
      ratio: '16:9',
      reason: stopReason,
      title: '角色锚点：诸葛亮',
    },
  },
  { type: 'execute_node_skill' as const, nodeId: 'gen_zhuge_anchor' },
];
assert.doesNotThrow(() => rejectUnknownCanvasParamKeys(stopActions));
const stopSettled = settleReferenceActions(stopActions, [], generatorTypes, citationsInUserMessage(stopMessage));
const stopGen = stopSettled.find((action) => action.type === 'create_node' && action.tempId === 'gen_zhuge_anchor');
const stopParams = stopGen && stopGen.type === 'create_node' ? stopGen.initialParams : undefined;
assert.equal(stopParams?.model, 'nano-banana-pro');
assert.equal(stopParams?.reason, stopReason);
assert.equal(stopSettled.some((action) => action.type === 'connect_nodes'), false);
assert.match(String(stopParams?.prompt || ''), /8k/);
const reasonDoesNotUnlock = settleReferenceActions(
  [{
    type: 'create_node' as const,
    tempId: 'gen_zhuge_anchor',
    nodeType: 'generator',
    initialParams: { model: 'midjourneyV8.1', reason: stopReason, prompt: '光' },
  }],
  [],
  generatorTypes,
  citationsInUserMessage('一章 30 秒。三国题材，主角是诸葛亮，在帐中备战。'),
);
const lockedGen = reasonDoesNotUnlock.find((action) => action.type === 'create_node');
assert.equal(lockedGen && lockedGen.type === 'create_node' ? lockedGen.initialParams?.model : 'kept', undefined);
const updateStripped = settleReferenceActions(
  [{
    type: 'update_node_params' as const,
    nodeId: 'gen_b851bf3a8293f8_1792461877566',
    patch: { model: 'midjourneyV8.1', reason: '想用它', prompt: '光' },
  }],
  [{ id: 'gen_b851bf3a8293f8_1792461877566', type: 'generator', model: 'nano-banana-pro' }],
  generatorTypes,
  citationsInUserMessage('一章 30 秒。三国题材，主角是诸葛亮，在帐中备战。'),
);
const updateStrippedPatch = updateStripped[0]?.type === 'update_node_params' ? updateStripped[0].patch : undefined;
assert.equal(updateStrippedPatch?.model, undefined);
assert.equal(updateStrippedPatch?.reason, '想用它');
const prefixedCitations = citationsInUserMessage('参考 {{canvas:img_05a777d260ccb8_1792461877565}}');
assert.equal(prefixedCitations.nodes.has('img_05a777d260ccb8_1792461877565'), true);
assert.equal(prefixedCitations.models.size, 0);
const prefixedKept = settleReferenceActions(
  [{
    type: 'connect_nodes' as const,
    sourceNodeId: 'img_05a777d260ccb8_1792461877565',
    targetNodeId: 'gen_b851bf3a8293f8_1792461877566',
  }],
  [],
  generatorTypes,
  prefixedCitations,
);
assert.equal(prefixedKept.some((action) => action.type === 'connect_nodes'), true);
const replayId = 'gen_b851bf3a8293f8_1792461877566';
const replayNodes = [
  { id: replayId, type: 'generator', model: 'midjourneyV8.1' },
  { id: 'img_05a777d260ccb8_1792461877565', type: 'image' },
  { id: 'img_02d385386d9318_1792461877566', type: 'image' },
];
const replayEdges = [
  { from: 'img_05a777d260ccb8_1792461877565', to: replayId },
  { from: 'img_02d385386d9318_1792461877566', to: replayId },
];
const replayMessage = '一章 30 秒。三国题材，主角是诸葛亮，在帐中备战。';
const replaySettled = settleReferenceActions(
  [
    {
      type: 'update_node_params' as const,
      nodeId: replayId,
      patch: {
        prompt: '诸葛亮，羽扇纶巾，鹤氅道袍，沉着内敛，帷幄运筹备战。',
        reason: '为角色锚点诸葛亮设置精简物理特征描述，配合上游参考图锁定形象',
      },
    },
    { type: 'execute_node_skill' as const, nodeId: replayId },
  ],
  replayNodes,
  generatorTypes,
  citationsInUserMessage(replayMessage),
  replayEdges,
);
const replayPatch = replaySettled.find((action) => action.type === 'update_node_params');
assert.equal(replayPatch && replayPatch.type === 'update_node_params' ? replayPatch.patch.model : '', REFERENCE_IMAGE_FALLBACK_MODEL);
assert.equal(replayPatch && replayPatch.type === 'update_node_params' ? replayPatch.modelClamp : 'set', undefined);
assert.equal(replaySettled.some((action) => action.type === 'connect_nodes'), false);
const videoWithEdge = settleReferenceActions(
  [
    { type: 'connect_nodes' as const, sourceNodeId: 'img_a', targetNodeId: 'vid_1' },
    { type: 'update_node_params' as const, nodeId: 'vid_1', patch: { prompt: '分镜1丨俯冲丨0-3s丨白袍' } },
  ],
  [
    { id: 'vid_1', type: 'video', model: 'seedance-2.0' },
    { id: 'img_a', type: 'image' },
  ],
  generatorTypes,
  citationsForApply('确认', ['img_a']),
);
const videoPatch = videoWithEdge.find((action) => action.type === 'update_node_params');
assert.equal(videoPatch && videoPatch.type === 'update_node_params' ? videoPatch.patch.model : 'missing', undefined);
assert.equal(videoWithEdge.some((action) => action.type === 'connect_nodes'), true);
const videoCreate = settleReferenceActions(
  [
    {
      type: 'create_node' as const,
      tempId: 'v',
      nodeType: 'video',
      initialParams: { model: 'hailuo-h3', prompt: '分镜' },
    },
    { type: 'connect_nodes' as const, sourceNodeId: 'img_a', targetNodeId: 'v' },
  ],
  [{ id: 'img_a', type: 'image' }],
  generatorTypes,
  citationsInUserMessage('{{img_a}} 使用模型 hailuo-h3'),
);
const videoCreated = videoCreate.find((action) => action.type === 'create_node');
assert.equal(videoCreated && videoCreated.type === 'create_node' ? videoCreated.initialParams?.model : '', 'hailuo-h3');
const videoTokenCreate = settleReferenceActions(
  [{
    type: 'create_node' as const,
    tempId: 'v_token',
    nodeType: 'video',
    initialParams: { model: 'hailuo-h3', prompt: '与 {{img_a}}（金发白袍）的外观完全一致' },
  }],
  [{ id: 'img_a', type: 'image', title: '阿波罗' }],
  generatorTypes,
  citationsInUserMessage('{{img_a}} 使用模型 hailuo-h3'),
);
const videoToken = videoTokenCreate.find((action) => action.type === 'create_node' && action.tempId === 'v_token');
const videoTokenPrompt = videoToken && videoToken.type === 'create_node' ? String(videoToken.initialParams?.prompt || '') : '';
assert.match(videoTokenPrompt, /\{\{img_a\}\}（金发白袍）/);
assert.doesNotMatch(videoTokenPrompt, /阿波罗/);
const forcedPictureModel = settleReferenceActions(
  [{
    type: 'update_node_params' as const,
    nodeId: replayId,
    patch: { model: 'midjourneyV8.1', prompt: '光' },
  }],
  replayNodes,
  generatorTypes,
  citationsInUserMessage('使用模型 midjourneyV8.1'),
  replayEdges,
);
const forcedPatch = forcedPictureModel[0]?.type === 'update_node_params' ? forcedPictureModel[0].patch : undefined;
assert.equal(forcedPatch?.model, REFERENCE_IMAGE_FALLBACK_MODEL);
assert.equal(forcedPictureModel[0] && 'modelClamp' in forcedPictureModel[0] ? forcedPictureModel[0].modelClamp?.from : '', 'midjourneyV8.1');
assert.equal(
  (forcedPatch?.agentParamClamped as Array<{ key: string; to: string }> | undefined)?.[0]?.to,
  REFERENCE_IMAGE_FALLBACK_MODEL,
);
const forcedLines = referenceClampLabels(
  [{
    type: 'update_node_params' as const,
    nodeId: replayId,
    patch: { model: 'midjourneyV8.1', prompt: '光' },
  }],
  replayNodes,
  generatorTypes,
  '使用模型 midjourneyV8.1',
  replayEdges,
);
assert.deepEqual(forcedLines, ['模型从 midjourneyV8.1 改为 nano-banana-pro：该模型不能带参考图']);
const cleanedReplay = settleReferenceActions(
  [
    {
      type: 'update_node_params' as const,
      nodeId: replayId,
      patch: { prompt: '诸葛亮，羽扇纶巾，鹤氅道袍，沉着内敛，帷幄运筹备战。' },
    },
    { type: 'execute_node_skill' as const, nodeId: replayId },
  ],
  [],
  generatorTypes,
  citationsInUserMessage(replayMessage),
  [],
);
const cleanedPatch = cleanedReplay.find((action) => action.type === 'update_node_params');
assert.equal(cleanedReplay.some((action) => action.type === 'connect_nodes'), false);
assert.equal(cleanedPatch && cleanedPatch.type === 'update_node_params' ? cleanedPatch.patch.model : 'set', undefined);
assert.equal(imageModelAcceptsReferenceInput('midjourneyV8.1'), false);
assert.equal(imageModelAcceptsReferenceInput('niji7'), true);
assert.equal(imageModelAcceptsReferenceInput('model14'), false);
const stopCard = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: {
    id: 'proposal-stop',
    title: 'Agent 建议新增 1 个工作流节点',
    summary: '新增 1 个节点，运行 1 个技能',
    actions: stopActions,
    status: 'pending',
    requiresApproval: true,
    generative: true,
    createdAt: 1,
    userMessage: stopMessage,
  },
  onApply() {},
  onDiscard() {},
}));
assert.match(stopCard, /新增 角色锚点：诸葛亮/);
assert.match(stopCard, /建立主角诸葛亮跨段角色视觉锚点/);
const clampCard = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: {
    id: 'proposal-clamp',
    title: 'Agent 画布操作建议',
    summary: '更新 1 个节点',
    actions: [{
      type: 'update_node_params',
      nodeId: replayId,
      patch: { model: 'midjourneyV8.1', prompt: '光' },
    }],
    status: 'pending',
    requiresApproval: true,
    generative: false,
    createdAt: 2,
    userMessage: '使用模型 midjourneyV8.1',
  },
  clampLines: forcedLines,
  onApply() {},
  onDiscard() {},
}));
assert.match(clampCard, /canvas-agent-proposal-clamp/);
assert.match(clampCard, /模型从 midjourneyV8\.1 改为 nano-banana-pro：该模型不能带参考图/);
const unknownProposal: ActionProposal = {
  id: 'proposal-unknown-params',
  title: '建议',
  summary: '改参数',
  actions: [
    { type: 'update_node_params', nodeId: 'video-1', patch: { duration: 6 } },
    { type: 'update_node_params', nodeId: 'video-1', patch: { params: { duration: 6 } } },
  ],
  status: 'pending',
  requiresApproval: true,
  generative: false,
  createdAt: 80,
};
seedOutcome(unknownProposal);
const unknownDb = new Database(':memory:');
initCanvasAgentConversationSchema(unknownDb);
const unknownConversation = createCanvasAgentConversation(unknownDb, 'user-1', 'canvas-unknown');
appendCanvasAgentMessage(unknownDb, 'user-1', unknownConversation.id, 'assistant', '建议', {
  proposal: { ...unknownProposal },
});
await runProposalApply(unknownProposal, {
  batchApply: async (actions) => {
    const normalized = normalizeCanvasActions(actions);
    const readable = normalized.map((action) => (
      action.type === 'update_node_params'
        ? { ...action, patch: clampApi.flattenCanvasAgentParameters(action.patch) as Record<string, unknown> }
        : action
    ));
    rejectUnknownCanvasParamKeys(readable);
    return { skippedCount: 0, choices: [] };
  },
  update: rememberOutcome,
  current: () => outcomeMemory.get(unknownProposal.id),
  persist: async (current) => updateCanvasAgentProposalOutcome(
    unknownDb, 'user-1', current.id, diskProposalOutcome(current),
  ),
  queue: outcomeQueue,
});
const unknownSaved = outcomeMemory.get(unknownProposal.id);
assert.equal(unknownSaved?.status, 'failed');
assert.match(unknownSaved?.error || '', /未知键：params/);
assert.match(unknownSaved?.error || '', /参数键直接放顶层，不要包一层/);
assert.ok((unknownSaved?.error || '').includes(UPDATE_PARAM_KEYS.join('、')));
const unknownRow = unknownDb.prepare(
  `SELECT metadata_json FROM canvas_agent_messages
   WHERE json_extract(metadata_json, '$.proposal.id') = ?`,
).get(unknownProposal.id) as { metadata_json: string };
const unknownMeta = JSON.parse(unknownRow.metadata_json) as { proposal: { status: string; error: string } };
assert.equal(unknownMeta.proposal.status, 'failed');
assert.match(unknownMeta.proposal.error, /不要包一层/);
const unknownFeedback = pendingExecutionFeedback(unknownSaved ? [unknownSaved] : []);
assert.match(unknownFeedback?.content || '', /未知键：params/);
assert.match(unknownFeedback?.content || '', /不要包一层/);
unknownDb.close();
assert.throws(
  () => rejectUnknownCanvasParamKeys([{ type: 'update_node_params', nodeId: 'video-1', patch: { replacesNodeId: 'x' } }]),
  /未知键：replacesNodeId/,
);
assert.throws(
  () => rejectUnknownCanvasParamKeys([{
    type: 'create_node', tempId: 'pic', nodeType: 'image', initialParams: { params: { url: '/a.png' } },
  }]),
  /未知键：params/,
);
const facadeSource = readFileSync(new URL('./core/canvasFacade.ts', import.meta.url), 'utf8');
const batchSource = facadeSource.slice(facadeSource.indexOf('export async function batchApplyChanges'));
const promptSource = readFileSync(new URL('./server/registerCanvasAgentRoutes.ts', import.meta.url), 'utf8');
const orderAt = (needle: string) => batchSource.indexOf(needle);
assert.ok(orderAt('const normalized = normalizeCanvasActions') < orderAt('flattenModelParamKeys(normalized)'));
assert.ok(orderAt('flattenModelParamKeys(normalized)') < orderAt('rejectUnknownCanvasParamKeys('));
assert.ok(orderAt('rejectUnknownCanvasParamKeys(') < orderAt('applyRebuildGuards('));
assert.ok(orderAt('applyRebuildGuards(') < orderAt('invalidationActions('));
assert.ok(orderAt('assertCanvasVideoShotTimelines(') < orderAt('applyCanvasAgentActions('));
assert.match(promptSource, /stripCreatesOnShortYes\(actions, message\)/);
assert.match(promptSource, /runCardPending\s*\?\s*'审批卡还在等您/);
assert.match(promptSource, /上一批已完成。您是要继续做下一步，还是要改刚才的分析？/);
assert.doesNotMatch(promptSource, /要做什么，直接说/);
const landedShots = [
  '分镜1丨起势丨0-4s丨大远景 + 俯拍 + 缓慢推进',
  '分镜2丨聚焦丨4-9s丨中景 + 低角度仰拍 + 缓慢推进',
  '分镜3丨溃败丨9-15s丨中景 + 俯拍 + 摇摄下摇',
].join('\n');
const openingTen = [
  '分镜1丨0-3s丨大远景 + 高角度俯拍 + 缓慢横移，揭示环境：雪夜城堡被战火笼罩，溃散的军队在漫天飞雪的荒原上向四周逃窜。',
  '分镜2丨3-7s丨中景 + 低角度仰拍 + 缓慢推进，凝视与悲凉：老国王身披残破战袍孤立于城头，眼神沧桑绝望，大风卷着雪花吹动他的白发与斗篷。',
  '分镜3丨7-10s丨特写 + 平视 + 缓慢拉远，收束离场：镜头转向冰封的石质纹理界面，金色耀眼的游戏标题文字在寒风雪花中聚拢浮现。',
].join('\n');
const overlapShots = [
  '分镜1丨0-4s丨甲',
  '分镜2丨4-10s丨乙',
  '分镜3丨9-15s丨丙',
].join('\n');
const shortShots = [
  '分镜1丨0-4s丨甲',
  '分镜2丨4-9s丨乙',
  '分镜3丨9-14s丨丙',
].join('\n');
const gappedShots = landedShots.replace('4-9s', '6-9s');
assert.doesNotThrow(() => assertVideoShotTimeline(openingTen, 10));
assert.doesNotThrow(() => assertVideoShotTimeline(openingTen.replace(/\n/g, ' '), 10));
// 防回归：引用记号换成名字时换行被收成空格。按换行切开只会读到 0-3，合计被报成 3。
assert.doesNotThrow(() => assertVideoShotTimeline(
  '参考角色外观 参考图1。 分镜1丨起势丨0-3s丨甲 分镜2丨承接丨3-6s丨乙 分镜3丨高潮丨6-10s丨丙',
  10,
));
assert.doesNotThrow(() => assertVideoShotTimeline(landedShots, 15));
assert.throws(
  () => assertVideoShotTimeline(overlapShots, 15),
  /分镜2 和分镜3 在 9-10s 重叠/,
);
assert.throws(
  () => assertVideoShotTimeline(shortShots, 15),
  /分镜时长合计 14 秒，节点时长是 15 秒/,
);
assert.throws(
  () => assertVideoShotTimeline('分镜1丨起势丨大远景\n分镜2丨聚焦丨中景', 10),
  /解析不出时间段，请写成 X-Ys 形式/,
);
assert.throws(
  () => assertVideoShotTimeline(gappedShots, 13),
  /分镜1（0-4s）与分镜2（6-9s）留了空档/,
);
assert.doesNotThrow(() => assertCanvasVideoShotTimelines([
  { type: 'update_node_params', nodeId: 'vid', patch: { prompt: landedShots } },
], [{ id: 'vid', type: 'video', duration: 15 }]));
assert.throws(
  () => assertCanvasVideoShotTimelines([
    { type: 'create_node', nodeType: 'video', tempId: 'v', initialParams: { prompt: overlapShots, duration: 15 } },
  ], []),
  /分镜2 和分镜3 在 9-10s 重叠/,
);
assert.doesNotThrow(() => assertCanvasVideoShotTimelines([
  { type: 'update_node_params', nodeId: 'gen', patch: { prompt: overlapShots } },
], [{ id: 'gen', type: 'generator', duration: 15 }]));
assert.match(promptSource, /reuse those tempIds when connecting, updating or executing them/);
assert.match(promptSource, /proposalFor\(actions, message\)/);
assert.match(facadeSource, /translateReferenceTokens\(\s*prepared,\s*snapshot,\s*userMessage,\s*conversationId,\s*sessionCitedNodes,\s*\)/);
assert.match(facadeSource, /droppedConnectCount\(prepared, translated\)/);
assert.match(facadeSource, /snapshot\.connections/);
const runGeneratorAt = engineSource.indexOf('async function runGenerator');
const coerceAt = engineSource.indexOf('coerceReferenceImageModel', runGeneratorAt);
const rejectModelAt = engineSource.indexOf('rejectCanvasAgentModelChoice(gen', runGeneratorAt);
assert.ok(coerceAt > runGeneratorAt && coerceAt < rejectModelAt);
const agentPanelSource = readFileSync(new URL('./ui/AgentFloatingPanel.tsx', import.meta.url), 'utf8');
assert.match(agentPanelSource, /batchApplyChanges\(\s*actions,\s*onProgress,\s*proposal\.userMessage,\s*conversationIdRef\.current,\s*\[\.\.\.citedNodesRef\.current, \.\.\.effectedRef\.current\.map\(\(node\) => node\.id\)\],/);
assert.match(agentPanelSource, /takeConversationChangelog|EffectLabels/);
assert.match(systemPrompt, /takeConversationChangelog/);
assert.match(systemPrompt, /canvasAgentStagePrefix\([\s\S]*effectedNodes, parseRunStates\(body\.runStates\)\)/);
assert.match(systemPrompt, /\[canvas_changelog\]/);
assert.match(agentPanelSource, /citedNodeIds:\s*citedNodesRef\.current/);
assert.match(agentPanelSource, /mentionTitleToStore\(input\.value\)/);
assert.match(agentPanelSource, /node\.title = stored/);
assert.ok(orderAt('const markProgress = openBatchProgress(ordered.length') < orderAt('for (const action of runnable)'));
assert.ok(orderAt('markProgress()') < orderAt('if (failedExecution)'));
assert.ok(orderAt('markProgress()') < orderAt('Date.now() >= deadline'));
const overflowAt = batchSource.indexOf('for (const action of overflow)');
assert.ok(overflowAt >= 0);
assert.ok(batchSource.indexOf('markProgress()', overflowAt) < batchSource.indexOf('skipExecution(', overflowAt));
const fiveLabels: string[] = [];
const markFive = openBatchProgress(5, (done, total) => {
  fiveLabels.push(`正在应用… (${done}/${total})`);
});
for (let step = 0; step < 5; step += 1) markFive();
assert.deepEqual(fiveLabels, [
  '正在应用… (1/5)',
  '正在应用… (2/5)',
  '正在应用… (3/5)',
  '正在应用… (4/5)',
  '正在应用… (5/5)',
]);
const mixedLabels: string[] = [];
const markMixed = openBatchProgress(5, (done, total) => {
  mixedLabels.push(`${done}/${total}`);
});
let mixedFailed = false;
let mixedRan = 0;
for (let step = 0; step < 5; step += 1) {
  markMixed();
  if (mixedFailed) continue;
  if (mixedRan === 3) {
    mixedFailed = true;
    continue;
  }
  mixedRan += 1;
}
assert.equal(mixedRan, 3);
assert.equal(mixedLabels.at(-1), '5/5');
const quotaLabels: Array<[number, number]> = [];
const markQuota = openBatchProgress(13, (done, total) => {
  quotaLabels.push([done, total]);
});
for (let step = 0; step < 12; step += 1) markQuota();
markQuota();
assert.equal(quotaLabels[0]?.[1], 13);
assert.deepEqual(quotaLabels.at(-1), [13, 13]);
const progressSteps: string[] = [];
const progressProposal: ActionProposal = {
  id: 'proposal-progress',
  title: '建议',
  summary: '运行 5 个',
  actions: [1, 2, 3, 4, 5].map((index) => ({ type: 'execute_node_skill' as const, nodeId: `n${index}` })),
  status: 'pending',
  requiresApproval: true,
  generative: true,
  createdAt: 90,
};
seedOutcome(progressProposal);
const progressDb = new Database(':memory:');
initCanvasAgentConversationSchema(progressDb);
const progressConversation = createCanvasAgentConversation(progressDb, 'user-1', 'canvas-progress');
appendCanvasAgentMessage(progressDb, 'user-1', progressConversation.id, 'assistant', '建议', {
  proposal: { ...progressProposal },
});
await runProposalApply(progressProposal, {
  batchApply: async (actions, onProgress) => {
    const count = actions.filter((action) => action.type === 'execute_node_skill').length;
    const mark = openBatchProgress(count, onProgress);
    let failed = false;
    let ran = 0;
    for (let step = 0; step < count; step += 1) {
      mark();
      if (failed) continue;
      if (ran === 3) {
        failed = true;
        continue;
      }
      ran += 1;
    }
    return { skippedCount: count - ran, choices: [] };
  },
  update: (id, patch) => {
    rememberOutcome(id, patch);
    const current = outcomeMemory.get(id);
    if (current?.status === 'applying' && current.progress) {
      progressSteps.push(`正在应用… (${current.progress.done}/${current.progress.total})`);
    }
  },
  current: () => outcomeMemory.get(progressProposal.id),
  persist: async (current) => updateCanvasAgentProposalOutcome(
    progressDb, 'user-1', current.id, diskProposalOutcome(current),
  ),
  queue: outcomeQueue,
});
assert.deepEqual(progressSteps, fiveLabels);
const progressRow = progressDb.prepare(
  `SELECT metadata_json FROM canvas_agent_messages
   WHERE json_extract(metadata_json, '$.proposal.id') = ?`,
).get(progressProposal.id) as { metadata_json: string };
const progressMeta = JSON.parse(progressRow.metadata_json) as { proposal: { status: string; progress?: unknown } };
assert.equal(progressMeta.proposal.status, 'partial');
assert.equal(Object.hasOwn(progressMeta.proposal, 'progress'), false);
progressDb.close();
const applyingCard = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: { ...progressProposal, status: 'applying', progress: { done: 2, total: 5 } },
  onApply: () => {},
  onDiscard: () => {},
}));
assert.match(applyingCard, /正在应用… \(2\/5\)/);
const plainApplying = renderToStaticMarkup(createElement(ProposalPreviewCard, {
  proposal: { ...progressProposal, status: 'applying' },
  onApply: () => {},
  onDiscard: () => {},
}));
assert.match(plainApplying, /正在应用…/);
assert.doesNotMatch(plainApplying, /正在应用… \(/);
assert.equal(engineSource.includes('batchApplyChanges'), false);
const storeText = readFileSync(new URL('./server/conversationStore.ts', import.meta.url), 'utf8');
assert.equal(storeText.includes("'$.proposal.progress'"), false);
for (const type of ['generator', 'image', 'prompt'] as const) {
  const foreign: Record<string, unknown> = {
    type, model: 'hailuo-h3', duration: 4, resolution: '720p', aspectRatio: 'portrait',
  };
  assert.equal(rememberClamp(foreign), false);
  assert.equal(foreign.duration, 4);
  assert.equal(foreign.resolution, '720p');
  assert.equal(foreign.aspectRatio, 'portrait');
  assert.equal(foreign.agentParamClamped, undefined);
}
const dockNode: Record<string, unknown> = {
  type: 'video', model: 'hailuo-h3', duration: 4, aspectRatio: '3:4', resolution: '768P',
};
clampApi.applyVideoModelDefaults(dockNode);
assert.equal(dockNode.duration, 5);
assert.equal(dockNode.agentParamClamped, undefined);
const typed: Record<string, unknown> = {
  type: 'video', model: 'hailuo-h3', duration: 8, aspectRatio: '16:9', resolution: '768P',
};
const bounds = clampApi.videoDurationBounds(String(typed.model));
const applyHumanDuration = (raw: string) => {
  typed.duration = Math.max(bounds.min, Math.min(bounds.max, Number(raw || 5)));
};
applyHumanDuration('4');
assert.equal(typed.duration, 5);
assert.equal(typed.agentParamClamped, undefined);
const batch = [0, 1, 2].map(() => ({
  type: 'video', model: 'hailuo-h3', duration: 4, aspectRatio: '3:4', resolution: '768P',
}));
const batchSaves: unknown[] = [];
for (const node of batch) {
  if (node.type === 'video') {
    new Function(
      'saved',
      'node',
      `${engineSource.slice(clampStart, clampEnd)}
       function flushCanvasAgentSave(){ saved.push(JSON.parse(JSON.stringify(node))); }
       return commitAgentVideoParamClamp(node);`,
    )(batchSaves, node);
  }
}
assert.equal(batchSaves.length, 3);
assert.equal((batchSaves[0] as { duration: number }).duration, 5);
assert.equal((batchSaves[0] as { agentParamClamped: unknown[] }).agentParamClamped.length, 1);
const staleBefore = invalidationActions(snapshot, [{
  type: 'update_node_params',
  nodeId: 'video-1',
  patch: { duration: 4 },
}]);
const stamped = {
  ...snapshot,
  nodes: snapshot.nodes.map((node) => (
    node.id === 'video-1' ? { ...node, agentParamClamped: fourDisk.agentParamClamped } : node
  )),
};
const staleAfter = invalidationActions(stamped, [{
  type: 'update_node_params',
  nodeId: 'video-1',
  patch: { duration: 4 },
}]);
assert.deepEqual(staleAfter, staleBefore);
assert.equal(engineSource.includes('agentParamClamped'), true);
assert.equal(engineSource.slice(
  engineSource.indexOf('function bindVideoDockControls'),
  engineSource.indexOf('function buildVideoDockContent'),
).includes('agentParamClamped'), false);
assert.equal(engineSource.slice(
  engineSource.indexOf('function applyHailuoVideoDefaults'),
  engineSource.indexOf('function applySparkVideoDefaults'),
).includes('agentParamClamped'), false);

function contextPayload(serialized: string): {
  activeSelectedNodes: Array<{
    agentSources?: Array<{ id: string; type: string; label: string; prompt?: string; refs?: string[] }>;
  }>;
  upstreamLineage: Array<{ id: string; text?: string }>;
  connections: [string, string][];
  availableModels?: {
    fromConfig: boolean;
    image: Array<{ id: string; models: string[] }>;
    chat: Array<{ id: string; models: string[] }>;
    video: string[];
  };
} {
  const start = serialized.indexOf('```json\n');
  const end = serialized.indexOf('\n```', start);
  return JSON.parse(serialized.slice(start + '```json\n'.length, end));
}

const analysis = 'R'.repeat(3000);
const sourceModels = {
  fromConfig: true,
  image: [{ id: 'runninghub', models: ['nano-banana-pro'] }],
  chat: [{ id: 'text', models: ['gemini-3.5-flash'] }],
  video: ['hailuo-h3'],
};
const oneSource = serializeCanvasContext({
  canvasId: 'source-one',
  nodes: [
    { id: 'rev', type: 'videoReverse', text: 'reverse-node' },
    {
      id: 'gen',
      type: 'generator',
      prompt: 'shot',
      agentSources: [{ id: 'rev', type: 'videoReverse', label: '反推', refs: ['/u.mp4'], prompt: analysis }],
    },
  ],
  connections: [{ id: 'e', from: 'rev', to: 'gen' }],
  selectedNodeIds: ['gen'],
  viewport: { x: 0, y: 0, scale: 1 },
  viewportCenter: { x: 0, y: 0 },
  settings: {},
  availableModels: sourceModels,
});
assert.ok(oneSource.length <= 14_000);
const onePayload = contextPayload(oneSource);
assert.equal(onePayload.activeSelectedNodes[0]?.agentSources?.[0]?.prompt, analysis);
assert.equal(onePayload.activeSelectedNodes[0]?.agentSources?.[0]?.id, 'rev');
assert.equal(onePayload.activeSelectedNodes[0]?.agentSources?.[0]?.type, 'videoReverse');
assert.equal(onePayload.activeSelectedNodes[0]?.agentSources?.[0]?.label, '反推');
assert.deepEqual(onePayload.connections, [['rev', 'gen']]);
assert.deepEqual(onePayload.availableModels, sourceModels);
assert.doesNotMatch(oneSource, /正文已截断/);

const sourceIds = ['r1', 'r2', 'r3', 'r4', 'r5'];
const fiveSources = serializeCanvasContext({
  canvasId: 'source-five',
  nodes: [
    ...sourceIds.map((id) => ({ id, type: 'videoReverse', text: `body-${id}` })),
    {
      id: 'gen',
      type: 'generator',
      prompt: 'shot',
      agentSources: sourceIds.map((id) => ({
        id,
        type: 'videoReverse',
        label: id,
        refs: [`/${id}.mp4`],
        prompt: analysis,
      })),
    },
  ],
  connections: sourceIds.map((id) => ({ id: `e-${id}`, from: id, to: 'gen' })),
  selectedNodeIds: ['gen'],
  viewport: { x: 0, y: 0, scale: 1 },
  viewportCenter: { x: 0, y: 0 },
  settings: {},
  availableModels: sourceModels,
});
assert.ok(fiveSources.length <= 14_000);
const fivePayload = contextPayload(fiveSources);
assert.equal(fivePayload.upstreamLineage.length, 5);
for (const id of sourceIds) {
  assert.ok(fivePayload.upstreamLineage.some((node) => node.id === id && node.text === `body-${id}`));
}
assert.equal(fivePayload.connections.length, 5);
assert.deepEqual(fivePayload.availableModels, sourceModels);
const clippedPrompts = fivePayload.activeSelectedNodes[0]?.agentSources || [];
assert.equal(clippedPrompts.length, 5);
for (const source of clippedPrompts) {
  assert.equal(source.type, 'videoReverse');
  assert.ok(source.label);
  assert.equal(source.refs?.length, 1);
  assert.match(source.prompt || '', /正文已截断/);
  assert.ok((source.prompt || '').length < 3000);
}
assert.doesNotMatch(fiveSources, /已省略 \d+ 个未展开的节点/);

const finishedScript = collectCanvasContext({
  ...snapshot,
  nodes: [{ id: 'sw', type: 'screenwritingAgent', outputText: '第一场 雨夜' }],
  connections: [],
  selectedNodeIds: ['sw'],
});
assert.equal(finishedScript.activeSelectedNodes[0]?.outputText, '第一场 雨夜');
const finishedReverse = collectCanvasContext({
  ...snapshot,
  nodes: [{ id: 'rev', type: 'videoReverse', outputText: '镜头缓慢推进' }],
  connections: [],
  selectedNodeIds: ['rev'],
});
assert.equal(finishedReverse.activeSelectedNodes[0]?.outputText, '镜头缓慢推进');
const emptyReverse = collectCanvasContext({
  ...snapshot,
  nodes: [{ id: 'rev', type: 'videoReverse', outputText: '' }],
  connections: [],
  selectedNodeIds: ['rev'],
});
assert.equal(Object.prototype.hasOwnProperty.call(emptyReverse.activeSelectedNodes[0] || {}, 'outputText'), false);
const scriptBody = '剧'.repeat(3000);
const scriptPacked = serializeCanvasContext({
  ...snapshot,
  nodes: [{ id: 'sw', type: 'screenwritingAgent', outputText: scriptBody }],
  connections: [],
  selectedNodeIds: ['sw'],
});
// includes('剧'.repeat(900))：没截过头。
// doesNotMatch(/剧{901}/)：没漏截。
// doesNotMatch(/正文已截断/)：P1 兜底没被误触发。
// length < 6000：整体没暴涨，不抓截断。20 条素材满载是 4194，6000 留出约一段素材的空位。
assert.ok(scriptPacked.includes('剧'.repeat(900)));
assert.doesNotMatch(scriptPacked, /剧{901}/);
assert.doesNotMatch(scriptPacked, /正文已截断/);
assert.ok(scriptPacked.length < 6000);

function engineSlice(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, start);
  return source.slice(from, to).replace(/^export /gm, '');
}

const reverseAnalysis = 'R'.repeat(3000);
const reverseHarness = new Function(
  'analysis',
  `
let nodes = [];
let connections = [];
let diskJson = '';
let llmCalls = 0;
${engineSlice(engineSource, 'function isNodeDisabled(node){', 'function toggleSelectedNodesDisabled')}
${engineSlice(engineSource, 'function isImageStackNode(node){', 'const GROUP_DROP_SNAP_PADDING')}
${engineSlice(engineSource, 'function mediaKindForNode(node){', 'function nodeTitleForMedia')}
${engineSlice(engineSource, 'const CANVAS_MEDIA_OUTPUT_TYPES', 'function agentResultPreviewUrls')}
${engineSlice(engineSource, 'function llmInputText(node){', '/** 上传视频')}
${engineSlice(engineSource, 'function rejectCanvasAgentPrecondition(node, message, opts, recordStatus){', 'function renderLLMBody')}
${engineSlice(engineSource, 'async function runVideoReverseNode(nodeId, opts={}){', '/** 上游 Prompt 节点')}
${engineSlice(engineSource, 'function runCascadeNodeByType(node, opts={}){', 'function runCascadeNodeWithLoopContext')}
${engineSlice(engineSource, 'function canvasRunTypes(){', 'const CANVAS_AGENT_PROTECTED_NODE_KEYS')}
${engineSlice(engineSource, 'function generatorSources(gen, ctx=loopContext){', 'function orderedSources')}
${engineSlice(engineSource, 'function composeGeneratorPrompt(gen, sources){', 'function isGenConsoleNode')}
${engineSlice(engineSource, 'function serializableCanvasNode(node){', 'function serializableCanvasNodes')}
${engineSlice(engineSource, 'const RH_POLL_LIMIT = 720;', 'export function canvasAgentBatchTimeoutMs')}
function langIsEn(){ return false; }
function isMxShellFamilyAgent(){ return false; }
function softAlert(){}
function refreshNodes(){}
function scheduleSave(){}
async function callCanvasLLM(){
  llmCalls += 1;
  return analysis;
}
function flushCanvasAgentSave(){
  diskJson = JSON.stringify(nodes.map(serializableCanvasNode));
}
return {
  setBoard(nextNodes, nextConnections){
    nodes = nextNodes;
    connections = nextConnections;
    diskJson = '';
    llmCalls = 0;
  },
  runCascadeNodeByType,
  runVideoReverseNode,
  canvasRunTypes,
  generatorSources,
  composeGeneratorPrompt,
  canvasAgentExecutionTimeoutMs,
  llmCalls: () => llmCalls,
  disk: () => diskJson ? JSON.parse(diskJson) : null,
};
`,
)(reverseAnalysis) as {
  setBoard: (nextNodes: Array<Record<string, unknown>>, nextConnections: Array<Record<string, unknown>>) => void;
  runCascadeNodeByType: (node: Record<string, unknown>, opts: { cascade: boolean; agent: boolean }) => Promise<unknown>;
  runVideoReverseNode: (nodeId: string, opts?: { cascade?: boolean }) => Promise<unknown>;
  canvasRunTypes: () => string[];
  generatorSources: (gen: Record<string, unknown>, ctx: null) => Array<{ prompt?: string }>;
  composeGeneratorPrompt: (gen: Record<string, unknown>, sources: Array<{ prompt?: string }>) => string;
  canvasAgentExecutionTimeoutMs: (node: { type: string }) => number;
  llmCalls: () => number;
  disk: () => Array<Record<string, unknown>> | null;
};

assert.ok(reverseHarness.canvasRunTypes().includes('videoReverse'));
assert.equal(reverseHarness.canvasAgentExecutionTimeoutMs({ type: 'videoReverse' }), 300_000);
assert.equal(reverseHarness.canvasAgentExecutionTimeoutMs({ type: 'generator' }), 180_000);
assert.equal(reverseHarness.canvasAgentExecutionTimeoutMs({ type: 'video' }), 600_000);
const llmBridge = readFileSync('src/services/canvasLlmBridge.ts', 'utf8');
assert.match(llmBridge, /max_tokens: Number\(process\.env\.CANVAS_LLM_MAX_TOKENS \|\| 4096\)/);
assert.match(llmBridge, /TEXT_API_TIMEOUT_MS \|\| 300000/);
const callCanvasLlm = engineSlice(engineSource, 'async function callCanvasLLM', 'async function runLLMNode');
assert.equal(callCanvasLlm.includes('max_tokens'), false);
assert.match(callCanvasLlm, /\/api\/canvas-llm/);

const readyNodes = [
  { id: 'prompt', type: 'prompt', text: '分析镜头' },
  { id: 'vid', type: 'image', mediaKind: 'video', url: '/uploads/clip.mp4' },
  { id: 'rev', type: 'videoReverse', outputText: '' },
];
const readyEdges = [
  { id: 'c1', from: 'prompt', to: 'rev' },
  { id: 'c2', from: 'vid', to: 'rev' },
];
reverseHarness.setBoard(readyNodes, readyEdges);
await reverseHarness.runCascadeNodeByType(readyNodes[2], { cascade: true, agent: true });
assert.equal(readyNodes[2].outputText, reverseAnalysis);
assert.equal(reverseHarness.llmCalls(), 1);

async function expectReverseFail(nodes: Array<Record<string, unknown>>, edges: Array<Record<string, unknown>>, reason: RegExp) {
  reverseHarness.setBoard(nodes, edges);
  await assert.rejects(
    () => reverseHarness.runCascadeNodeByType(nodes.find((node) => node.id === 'rev') || nodes[0], { cascade: true, agent: true }),
    (err: unknown) => {
      assert.match(err instanceof Error ? err.message : '', reason);
      return true;
    },
  );
  assert.equal(reverseHarness.llmCalls(), 0);
  // 落盘由外层负责，不在这里验。
  // 外层 stamp 的覆盖见 A 档 LLM 那条 stub。
}

await expectReverseFail(
  [{ id: 'rev', type: 'videoReverse', outputText: '' }],
  [],
  /请先连接「提示词」/,
);
await expectReverseFail(
  [
    { id: 'prompt', type: 'prompt', text: '' },
    { id: 'rev', type: 'videoReverse', outputText: '' },
  ],
  [{ id: 'c1', from: 'prompt', to: 'rev' }],
  /内容为空/,
);
await expectReverseFail(
  [
    { id: 'prompt', type: 'prompt', text: '分析镜头' },
    { id: 'rev', type: 'videoReverse', outputText: '' },
  ],
  [{ id: 'c1', from: 'prompt', to: 'rev' }],
  /请在左侧上传视频/,
);

const humanNodes = [{ id: 'rev', type: 'videoReverse', outputText: '' }];
reverseHarness.setBoard(humanNodes, []);
assert.equal(await reverseHarness.runVideoReverseNode('rev', {}), undefined);
assert.equal(reverseHarness.disk(), null);
assert.equal(reverseHarness.llmCalls(), 0);

const batchNodes = [
  { id: 'prompt', type: 'prompt', text: '分析镜头' },
  { id: 'vid', type: 'image', mediaKind: 'video', url: '/uploads/clip.mp4' },
  { id: 'rev', type: 'videoReverse', outputText: '' },
  { id: 'gen', type: 'generator', prompt: '出图' },
];
const batchEdges = [
  { id: 'c1', from: 'prompt', to: 'rev' },
  { id: 'c2', from: 'vid', to: 'rev' },
  { id: 'c3', from: 'rev', to: 'gen' },
];
const batchSnapshot: CanvasSnapshot = {
  ...snapshot,
  nodes: batchNodes,
  connections: batchEdges,
  selectedNodeIds: ['gen'],
};
const batchOrder = sortBatchExecutions(
  [
    { type: 'execute_node_skill', nodeId: 'gen' },
    { type: 'execute_node_skill', nodeId: 'rev' },
  ],
  batchSnapshot,
  [],
  (id) => id,
);
assert.deepEqual(batchOrder.map((item) => item.nodeId), ['rev', 'gen']);
reverseHarness.setBoard(batchNodes, batchEdges);
await reverseHarness.runCascadeNodeByType(batchNodes[2], { cascade: true, agent: true });
assert.equal(batchNodes[2].outputText, reverseAnalysis);
const genSources = reverseHarness.generatorSources(batchNodes[3], null);
const genPrompt = reverseHarness.composeGeneratorPrompt(batchNodes[3], genSources);
assert.equal(genPrompt.startsWith(reverseAnalysis), true);
assert.ok(genPrompt.length > 200);
assert.doesNotThrow(() => assertAgentActionContent(
  { type: 'execute_node_skill', nodeId: 'gen' },
  batchSnapshot,
  GENERATOR_TYPES,
));

const apolloId = 'img_6d63229c42dbf8_1792548871759';
const storedSend = `与 {{${apolloId}}}（金发白袍）的外观完全一致`;
const sendHost = { id: 'vid_7778026b6446a8_1792654978537', type: 'video', prompt: storedSend };
reverseHarness.setBoard([
  { id: apolloId, type: 'image', title: '阿波罗', name: 'canvas-output-1791792460637.jpg' },
  { id: 'bare', type: 'image', name: 'canvas-output-1.jpg' },
  sendHost,
], []);
const sentPrompt = reverseHarness.composeGeneratorPrompt(sendHost, [{ prompt: '' }]);
assert.equal(sendHost.prompt, storedSend);
assert.equal(sentPrompt, '与 阿波罗（金发白袍）的外观完全一致');
assert.equal(sentPrompt.includes('{{'), false);
assert.equal(sentPrompt.includes(apolloId), false);
const unnamedSent = reverseHarness.composeGeneratorPrompt(
  { prompt: `与 {{bare}}（金发白袍）的外观完全一致` },
  [],
);
assert.equal(unnamedSent, '与 （金发白袍）的外观完全一致');
assert.equal(unnamedSent.includes('{{'), false);
assert.equal(unnamedSent.includes('bare'), false);

const libraryAssets = [
  { id: 'red', name: '红发女刑警', url: '/uploads/asset-library/user-b/red.png', category: '角色' },
  ...Array.from({ length: 24 }, (_, index) => ({
    id: `extra-${index}`,
    name: `素材${index}`,
    url: `/uploads/asset-library/user-b/lib_${index}.png`,
    category: '场景',
  })),
];
const assetSnapshot: CanvasSnapshot = {
  ...snapshot,
  nodes: [],
  connections: [],
  selectedNodeIds: [],
  availableAssets: libraryAssets,
};
const assetContext = collectCanvasContext(assetSnapshot);
assert.equal(assetContext.availableAssets?.length, 20);
assert.equal(assetContext.availableAssets?.[0]?.name, '红发女刑警');
assert.equal(assetContext.availableAssetsOmission, '[素材库还有 5 条未列出]');
const assetText = serializeCanvasContext(assetSnapshot);
assert.equal(assetText.includes('[素材库还有 5 条未列出]'), true);
assert.equal(assetText.includes(libraryAssets[0].url), true);
assert.equal(assetText.includes(libraryAssets[20].url), false);
assert.equal(assetText.includes('不要把 url 写进生成节点的 initialParams'), true);
assert.ok(assetText.length <= 14000);

const timed = flattenAssetLibrary({
  categories: [
    { name: '场景', items: [{ id: 'old', name: '旧', url: '/uploads/a.png', created_at: 1 }] },
    { name: '角色', items: [{ id: 'new', name: '新', url: '/uploads/b.png', created_at: 9 }] },
  ],
});
assert.deepEqual(timed.map((item) => item.id), ['new', 'old']);
assert.equal(timed[0].category, '角色');
const untimed = flattenAssetLibrary({
  categories: [
    { name: '场景', items: [{ id: 'first', name: '一', url: '/uploads/a.png' }] },
    { name: '角色', items: [{ id: 'second', name: '二', url: '/uploads/b.png' }] },
  ],
});
assert.deepEqual(untimed.map((item) => item.id), ['second', 'first']);
const sameName = flattenAssetLibrary({
  categories: [{
    name: '角色',
    items: [
      { id: 'temple', name: 'Image', url: '/uploads/asset-library/temple.jpg', created_at: 10 },
      { id: 'person', name: 'Image', url: '/uploads/asset-library/person.png', created_at: 30 },
    ],
  }],
});
assert.equal(sameName.length, 2);
assert.equal(sameName[0].id, 'person');
assert.equal(sameName[0].uploadedAt, 30);
assert.equal(sameName[1].uploadedAt, 10);
assert.notEqual(sameName[0].uploadedAt, sameName[1].uploadedAt);
const cappedTwins = flattenAssetLibrary({
  categories: [{
    name: '角色',
    items: Array.from({ length: 21 }, (_, index) => ({
      id: `twin-${index}`,
      name: 'Image',
      url: `/uploads/asset-library/twin-${index}.png`,
      created_at: index + 1,
    })),
  }],
});
assert.equal(cappedTwins[0].uploadedAt, 21);
const cappedContext = collectCanvasContext({
  ...snapshot,
  nodes: [],
  connections: [],
  selectedNodeIds: [],
  availableAssets: cappedTwins,
});
assert.equal(cappedContext.availableAssets?.length, 20);
assert.equal(cappedContext.availableAssets?.[0]?.uploadedAt, 21);
assert.equal(cappedContext.availableAssets?.some((item) => item.uploadedAt === 1), false);
const askRule = /当有多个候选、而上下文信息不足以区分用户指的是哪一个时，先问用户，不要猜/;
const rolesSecondPath = '或者您可以描述一下您想复刻的那张图的主体，我来帮您判断该标成 background 还是 character。';
function ambiguousReply(
  message: string,
  opts: { assets?: Array<{ id: string; name: string; url: string; category: string; uploadedAt?: number }>; roleCount?: number },
): { ask: boolean; actions: string[]; reply: string } {
  const roleCount = opts.roleCount || 0;
  const roles = Object.fromEntries(
    Array.from({ length: roleCount }, (_, index) => [`img${index}`, index === 0 ? 'background' : 'character']),
  );
  const packed = serializeCanvasContext({
    ...snapshot,
    nodes: roleCount
      ? [{ id: 'replica', type: 'replicaAgent', roles }]
      : [],
    connections: [],
    selectedNodeIds: roleCount ? ['replica'] : [],
    availableAssets: opts.assets,
  });
  const guided = askRule.test(packed);
  const pointed = /img\d|第[0-9一二三]|background|character/.test(message);
  const groups = new Map<string, number>();
  for (const asset of opts.assets || []) {
    const key = `${asset.name}\0${asset.category}`;
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const assetClash = [...groups.values()].some((count) => count > 1)
    && /素材库|角色图/.test(message)
    && !pointed;
  const rolesClash = roleCount > 1 && /复刻/.test(message) && !pointed;
  if (guided && (assetClash || rolesClash)) {
    return {
      ask: true,
      actions: [],
      reply: rolesClash && packed.includes(rolesSecondPath) ? rolesSecondPath : '先问用户，不要猜',
    };
  }
  return { ask: false, actions: ['connect'], reply: '' };
}
const threeRoles = ambiguousReply('复刻这张图里的人物', { roleCount: 3 });
assert.equal(threeRoles.ask, true);
assert.deepEqual(threeRoles.actions, []);
assert.equal(threeRoles.reply, rolesSecondPath);
const oneRole = ambiguousReply('复刻这张图里的人物', { roleCount: 1 });
assert.equal(oneRole.ask, false);
const twinAssets = [
  { id: 'a', name: 'Image', url: '/uploads/a.jpg', category: '角色', uploadedAt: 2 },
  { id: 'b', name: 'Image', url: '/uploads/b.png', category: '角色', uploadedAt: 1 },
];
const twoAssets = ambiguousReply('用我素材库里那张角色图当参考', { assets: twinAssets });
assert.equal(twoAssets.ask, true);
assert.deepEqual(twoAssets.actions, []);
const oneAsset = ambiguousReply('用我素材库里那张角色图当参考', {
  assets: [twinAssets[0]],
});
assert.equal(oneAsset.ask, false);

function assetJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
function libraryOf(owner: string, name: string, url: string) {
  return {
    library: {
      categories: [{ name: '角色', items: [{ id: `${owner}-1`, name, url, created_at: 5 }] }],
    },
  };
}
clearCanvasAgentAssetCache();
let assetHits = 0;
let releaseAssetFetch: () => void = () => {};
const assetGate = new Promise<void>((resolve) => {
  releaseAssetFetch = resolve;
});
const concurrentFetch = async (url: string) => {
  assetHits += 1;
  await assetGate;
  if (url === '/api/auth/status') return assetJson({ ok: true, user: { id: 'user-a' } });
  return assetJson(libraryOf('a', 'A的红发', '/uploads/asset-library/user-a/red.png'));
};
const firstRefresh = refreshCanvasAgentAssets(concurrentFetch);
const secondRefresh = refreshCanvasAgentAssets(concurrentFetch);
releaseAssetFetch();
await Promise.all([firstRefresh, secondRefresh]);
assert.equal(assetHits, 2);
assert.equal(peekCanvasAgentAssetCache().ownerKey, 'user-a');
assert.equal(readCanvasAgentAssets()[0]?.url, '/uploads/asset-library/user-a/red.png');

const switchUrls: string[] = [];
await refreshCanvasAgentAssets(async (url) => {
  switchUrls.push(url);
  if (url === '/api/auth/status') return assetJson({ ok: true, user: { id: 'user-b' } });
  return assetJson(libraryOf('b', 'B的道具', '/uploads/asset-library/user-b/prop.png'));
});
assert.deepEqual(switchUrls, ['/api/auth/status', '/api/asset-library']);
assert.equal(peekCanvasAgentAssetCache().ownerKey, 'user-b');
assert.equal(readCanvasAgentAssets().some((item) => item.url.includes('user-a')), false);
assert.equal(readCanvasAgentAssets()[0]?.url, '/uploads/asset-library/user-b/prop.png');

const failUrls: string[] = [];
await refreshCanvasAgentAssets(async (url) => {
  failUrls.push(url);
  if (url === '/api/auth/status') return assetJson({ ok: true, user: { id: 'user-b' } });
  throw new Error('offline');
});
assert.deepEqual(readCanvasAgentAssets(), []);
assert.equal(peekCanvasAgentAssetCache().ownerKey, 'user-b');
assert.equal(readCanvasAgentAssets().some((item) => item.url.includes('user-b')), false);

const loggedOutUrls: string[] = [];
await refreshCanvasAgentAssets(async (url) => {
  loggedOutUrls.push(url);
  return assetJson({ ok: false });
});
assert.deepEqual(loggedOutUrls, ['/api/auth/status']);
assert.deepEqual(readCanvasAgentAssets(), []);
assert.equal(peekCanvasAgentAssetCache().ownerKey, '');
const emptySnapshot: CanvasSnapshot = { ...snapshot, nodes: [], connections: [], selectedNodeIds: [], availableAssets: readCanvasAgentAssets() };
assert.doesNotThrow(() => serializeCanvasContext(emptySnapshot));
assert.deepEqual(collectCanvasContext(emptySnapshot).availableAssets, []);

await refreshCanvasAgentAssets(async (url) => {
  if (url === '/api/auth/status') return assetJson({ ok: true, user: { id: 'user-a' } });
  return assetJson(libraryOf('a', 'A的红发', '/uploads/asset-library/user-a/red.png'));
});
const bus = new EventTarget();
const previousWindow = globalThis.window;
Object.defineProperty(globalThis, 'window', { configurable: true, value: bus });
bindCanvasAgentAssetCache(bus);
const beforeClear = assetHits;
bus.dispatchEvent(new CustomEvent('storyboard-auth-required'));
assert.equal(assetHits, beforeClear);
assert.equal(peekCanvasAgentAssetCache().ownerKey, '');
assert.deepEqual(readCanvasAgentAssets(), []);

const memory = new Map<string, string>();
const memoryStorage = {
  getItem: (key: string) => (memory.has(key) ? memory.get(key)! : null),
  setItem: (key: string, value: string) => { memory.set(key, String(value)); },
  removeItem: (key: string) => { memory.delete(key); },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: memoryStorage });
await refreshCanvasAgentAssets(async (url) => {
  if (url === '/api/auth/status') return assetJson({ ok: true, user: { id: 'user-a' } });
  return assetJson(libraryOf('a', 'A的红发', '/uploads/asset-library/user-a/red.png'));
});
const logoutUrls: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  logoutUrls.push(String(url));
  return assetJson({ ok: true });
}) as typeof fetch;
await logoutSession();
globalThis.fetch = realFetch;
assert.deepEqual(logoutUrls, ['/api/auth/logout']);
assert.equal(peekCanvasAgentAssetCache().ownerKey, '');
assert.deepEqual(readCanvasAgentAssets(), []);
const afterLogout: CanvasSnapshot = { ...snapshot, nodes: [], connections: [], selectedNodeIds: [], availableAssets: readCanvasAgentAssets() };
assert.deepEqual(collectCanvasContext(afterLogout).availableAssets, []);
await refreshCanvasAgentAssets(async (url) => {
  if (url === '/api/auth/status') return assetJson({ ok: true, user: { id: 'user-b' } });
  return assetJson(libraryOf('b', 'B的道具', '/uploads/asset-library/user-b/prop.png'));
});
assert.equal(readCanvasAgentAssets().some((item) => item.url.includes('user-a')), false);
Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });

const panelSource = readFileSync('src/components/InfiniteCanvas/CanvasMaterialLibrary.tsx', 'utf8');
for (const mark of [
  'await uploadAssetItem(folderId, file)',
  'await createAssetCategory(name, draft.parentId)',
  'await renameAssetCategory(draft.id, name)',
  'await renameAssetItem(draft.id, name)',
  'await deleteAssetCategory(draft.id)',
  'await deleteAssetItem(draft.id)',
  'await duplicateAssetCategory(folderId)',
  'await moveAssetItem(item.id, targetId)',
  'await addAssetItem(targetId, url)',
]) {
  const at = panelSource.indexOf(mark);
  assert.ok(at >= 0, mark);
  assert.equal(panelSource.slice(at, at + 240).includes('canvas-asset-library-changed'), true, mark);
}

const listedAssets = assetContext.availableAssets || [];
const redhead = listedAssets.find((item) => item.name === '红发女刑警');
assert.ok(redhead);
const stubActions = [
  { type: 'create_node' as const, tempId: 'ref', nodeType: 'image', initialParams: { url: redhead.url, name: redhead.name } },
  { type: 'create_node' as const, tempId: 'shot', nodeType: 'generator', initialParams: { prompt: '侧面镜头' } },
  { type: 'connect_nodes' as const, sourceNodeId: 'ref', targetNodeId: 'shot' },
];
assert.equal(stubActions[0].initialParams.url, redhead.url);
assert.equal(Object.hasOwn(stubActions[1].initialParams, 'url'), false);
assert.equal(Object.hasOwn(stubActions[1].initialParams, 'reference_images'), false);
const placedShot: CanvasSnapshot = {
  ...snapshot,
  nodes: [
    { id: 'ref', type: 'image', url: redhead.url },
    { id: 'shot', type: 'generator', prompt: '侧面镜头' },
  ],
  connections: [{ id: 'edge-ref', from: 'ref', to: 'shot' }],
  selectedNodeIds: ['shot'],
};
assert.equal(GENERATOR_TYPES.includes('image'), false);
assert.doesNotThrow(() => assertAgentActionContent(
  { type: 'execute_node_skill', nodeId: 'shot' },
  placedShot,
  GENERATOR_TYPES,
));

const replicaWrite = engineSlice(engineSource, 'function completeReplicaAgentTask(taskId, data){', 'function completeImageRepairAgentTask');
const repairWrite = engineSlice(engineSource, 'function completeImageRepairAgentTask(taskId, data){', 'async function pollImageRepairAgentTask');
const mediaPrompt = engineSlice(engineSource, 'if(CANVAS_MEDIA_OUTPUT_TYPES.includes(n.type)){', 'if(isImageStackNode(n)');
const replicaKey = replicaWrite.match(/gen\.(\w+) = data\.reverse_prompt/)?.[1];
const repairKey = repairWrite.match(/gen\.(\w+) = data\.reversed_prompt/)?.[1];
const readKey = mediaPrompt.match(/prompt: n\.(\w+) \|\| ''/)?.[1];
assert.equal(replicaKey, 'outputText');
assert.equal(repairKey, 'outputText');
assert.equal(readKey, 'outputText');
assert.equal(replicaWrite.slice(replicaWrite.indexOf('out._pending'), replicaWrite.indexOf('syncAgentRunStatusAfterTask')).includes('await'), false);
assert.equal(repairWrite.slice(repairWrite.indexOf('out._pending'), repairWrite.indexOf('syncAgentRunStatusAfterTask')).includes('await'), false);
assert.match(replicaWrite, /reverse_prompt: data\.reverse_prompt \|\| ''/);
assert.match(repairWrite, /reversed_prompt: data\.reversed_prompt \|\| ''/);

const analysisHarness = new Function(
  `
let nodes = [];
let connections = [];
let canvas = { id: 'canvas-check' };
let nextCtx = null;
let lastLog = null;
const MAX_GEN_PREVIEW = 120;
${engineSlice(engineSource, 'function isGenConsoleNode(node){', 'function nodeShowsGenDock')}
${engineSlice(engineSource, 'function generatorHistoryItems(node){', 'function syncGeneratorPreviewFromHistory')}
${engineSlice(engineSource, 'function generatorPreviewUrls(node){', 'function collapseOpenGenStagesOnBoardClick')}
${engineSlice(engineSource, 'const CANVAS_MEDIA_OUTPUT_TYPES', 'function agentResultPreviewUrls')}
${engineSlice(engineSource, 'function agentResultPreviewUrls(node){', 'function renderAgentResultStageHtml')}
${engineSlice(engineSource, 'function mediaRefsFromNode(node){', 'function generatorSources')}
${engineSlice(engineSource, 'function generatorSources(gen, ctx=loopContext){', 'function orderedSources')}
${engineSlice(engineSource, 'function isVideoUrl(url){', 'function canvasThumbUrl')}
${engineSlice(engineSource, 'function isAudioUrl(url){', 'function mediaKindForRef')}
${engineSlice(engineSource, 'function mediaKindForOutputItem(item){', 'function formatRunDuration')}
${engineSlice(engineSource, 'function nowMs(){ return Date.now(); }', 'function isMissingAssetUrl')}
${engineSlice(engineSource, 'function commitMediaOutputs(host, sourceNode, urls, compareRef, metas, opts={}){', 'function revealGeneratorResultsWhileRunning')}
${engineSlice(engineSource, 'function mergeGeneratedOutputs(node, outputs, append=false){', 'function pendingById')}
${engineSlice(engineSource, 'function agentPendingCount(nodeId){', 'function clearAgentOutputPending')}
${engineSlice(engineSource, 'function syncAgentRunStatusAfterTask(gen, {completed=false, failed=false, error=\'\'}={}){', 'function resetTransientNodeRunState')}
${engineSlice(engineSource, 'function completeReplicaAgentTask(taskId, data){', 'async function pollImageRepairAgentTask')}
${engineSlice(engineSource, 'const AGENT_SOURCE_PROMPT_MAX', 'function canvasAgentAvailableModels')}
function isNodeDisabled(node){ return Boolean(node && node.disabled); }
function isNodeEnabled(node){ return Boolean(node) && !isNodeDisabled(node); }
function isImageStackNode(){ return false; }
function langIsEn(){ return false; }
function outputImageName(url){ return String(url || '').split('/').filter(Boolean).pop() || 'output'; }
function canvasTaskLedgerRaw(){ return { canvasId: canvas.id }; }
function shouldParkTaskResult(){ return false; }
function resolveCanvasTaskContext(){ return nextCtx; }
function unregisterCanvasTaskLedger(){}
function scheduleSaveNow(){}
function refreshRunNodes(){}
function prefetchOutputOriginal(){}
function addGenerationLog(entry){ lastLog = entry; }
function finish(kind, text, url){
  const id = kind;
  const node = {
    id,
    type: kind === 'replica' ? 'replicaAgent' : 'imageRepairAgent',
    running: true,
    _pending: [{ id: 'p1', startedAt: 1, run: { node: { id } } }],
  };
  nodes = [node];
  connections = [];
  nextCtx = { out: node, pending: node._pending[0], recovered: false, gen: node };
  if(kind === 'replica'){
    completeReplicaAgentTask('task-replica', { final_image_url: url, reverse_prompt: text, washed_image_url: '' });
  } else {
    completeImageRepairAgentTask('task-repair', { final_image_url: url, reversed_prompt: text });
  }
  return node;
}
function setBoard(nextNodes, nextConnections){
  nodes = nextNodes;
  connections = nextConnections;
}
return { finish, setBoard, generatorSources, agentSourcesForSnapshot, log: () => lastLog };
`,
)() as {
  finish: (kind: 'replica' | 'repair', text: string, url: string) => Record<string, unknown>;
  setBoard: (nextNodes: Array<Record<string, unknown>>, nextConnections: Array<Record<string, unknown>>) => void;
  generatorSources: (gen: Record<string, unknown>, ctx: null) => Array<{ prompt?: string; preview?: string; type?: string; refs?: Array<{ url?: string }> }>;
  agentSourcesForSnapshot: (node: Record<string, unknown>) => Array<{ prompt?: string; id?: string; type?: string }>;
  log: () => { run?: { request?: Record<string, unknown> } } | null;
};

const replicaText = '红发女刑警侧脸，保留服装';
const replicaUrl = '/uploads/replica-final.png';
const replicaNode = analysisHarness.finish('replica', replicaText, replicaUrl);
assert.equal(replicaNode.outputText, replicaText);
assert.deepEqual(replicaNode.generatedOutputs, [replicaUrl]);
assert.equal(analysisHarness.log()?.run?.request?.reverse_prompt, replicaText);
const replicaView = collectCanvasContext({
  ...snapshot,
  nodes: [replicaNode] as CanvasSnapshot['nodes'],
  connections: [],
  selectedNodeIds: ['replica'],
});
assert.equal(replicaView.activeSelectedNodes[0]?.outputText, replicaText);
assert.deepEqual(replicaView.activeSelectedNodes[0]?.assets, [replicaUrl]);

const repairText = '线稿压低，主体轮廓保留';
const repairUrl = '/uploads/repair-final.png';
const repairNode = analysisHarness.finish('repair', repairText, repairUrl);
assert.equal(repairNode.outputText, repairText);
assert.deepEqual(repairNode.generatedOutputs, [repairUrl]);
assert.equal(analysisHarness.log()?.run?.request?.reversed_prompt, repairText);
const repairView = collectCanvasContext({
  ...snapshot,
  nodes: [repairNode] as CanvasSnapshot['nodes'],
  connections: [],
  selectedNodeIds: ['repair'],
});
assert.equal(repairView.activeSelectedNodes[0]?.outputText, repairText);
assert.deepEqual(repairView.activeSelectedNodes[0]?.assets, [repairUrl]);

function linkedSources(upstream: Record<string, unknown>) {
  const down = { id: 'down', type: 'generator', prompt: '出图' };
  analysisHarness.setBoard([upstream, down], [{ id: 'edge', from: String(upstream.id), to: 'down' }]);
  return {
    raw: analysisHarness.generatorSources(down, null),
    summarized: analysisHarness.agentSourcesForSnapshot(down),
  };
}

const replicaSources = linkedSources(replicaNode);
assert.equal(replicaSources.raw[0]?.prompt, replicaText);
assert.equal(replicaSources.summarized[0]?.prompt, replicaText);
const longReplica = '复'.repeat(13000);
const longReplicaNode = analysisHarness.finish('replica', longReplica, replicaUrl);
const longReplicaSources = linkedSources(longReplicaNode);
assert.equal(longReplicaSources.summarized[0]?.prompt?.length, 12288);
assert.equal(longReplicaSources.raw[0]?.prompt?.length, 13000);

const repairSources = linkedSources(repairNode);
assert.equal(repairSources.raw[0]?.prompt, repairText);
assert.equal(repairSources.summarized[0]?.prompt, repairText);
const longRepair = '修'.repeat(13000);
const longRepairNode = analysisHarness.finish('repair', longRepair, repairUrl);
const longRepairSources = linkedSources(longRepairNode);
assert.equal(longRepairSources.summarized[0]?.prompt?.length, 12288);

const viaOutput = { id: 'out', type: 'output', images: ['/uploads/hosted.png'] };
const viaDown = { id: 'down', type: 'generator', prompt: '出图' };
analysisHarness.setBoard(
  [replicaNode, viaOutput, viaDown],
  [
    { id: 'to-out', from: 'replica', to: 'out' },
    { id: 'to-gen', from: 'out', to: 'down' },
  ],
);
const viaRaw = analysisHarness.generatorSources(viaDown, null);
assert.equal(viaRaw.length, 1);
assert.equal(viaRaw[0]?.type, 'outputImage');
assert.equal(viaRaw[0]?.prompt, '');
assert.equal(viaRaw[0]?.preview, '/uploads/hosted.png');
assert.equal(JSON.stringify(viaRaw).includes(replicaText), false);
assert.equal(viaRaw[0]?.refs?.[0]?.url, '/uploads/hosted.png');

for (const type of ['generator', 'msgen', 'video', 'rh']) {
  const upstream = {
    id: 'up',
    type,
    prompt: '正文在prompt',
    generatedOutputs: ['/uploads/six.png'],
  };
  const sources = linkedSources(upstream);
  assert.equal(sources.raw.length, 1, type);
  assert.equal(sources.raw[0]?.prompt, '', type);
  assert.equal(sources.summarized[0]?.prompt, undefined, type);
  assert.equal(JSON.stringify(sources.summarized).includes('正文在prompt'), false, type);
}

assert.equal(GENERATOR_TYPES.includes('replicaAgent'), true);
assert.equal(GENERATOR_TYPES.includes('imageRepairAgent'), true);
assert.equal(nodeHasGeneratedOutput(replicaNode as CanvasSnapshot['nodes'][number]), true);
assert.equal(nodeHasGeneratedOutput(repairNode as CanvasSnapshot['nodes'][number]), true);
assert.equal(nodeHasGeneratedOutput({ id: 'text-only-replica', type: 'replicaAgent', outputText: replicaText }), true);
assert.equal(nodeHasGeneratedOutput({ id: 'text-only-repair', type: 'imageRepairAgent', outputText: repairText }), true);
const replicaDownstream: CanvasSnapshot = {
  ...snapshot,
  nodes: [replicaNode as CanvasSnapshot['nodes'][number], { id: 'gen', type: 'generator', prompt: '出图' }],
  connections: [{ id: 'e', from: 'replica', to: 'gen' }],
  selectedNodeIds: ['gen'],
};
assert.doesNotThrow(() => assertAgentActionContent(
  { type: 'execute_node_skill', nodeId: 'gen' },
  replicaDownstream,
  GENERATOR_TYPES,
));
const repairDownstream: CanvasSnapshot = {
  ...snapshot,
  nodes: [repairNode as CanvasSnapshot['nodes'][number], { id: 'gen', type: 'generator', prompt: '出图' }],
  connections: [{ id: 'e', from: 'repair', to: 'gen' }],
  selectedNodeIds: ['gen'],
};
assert.doesNotThrow(() => assertAgentActionContent(
  { type: 'execute_node_skill', nodeId: 'gen' },
  repairDownstream,
  GENERATOR_TYPES,
));

type StructuredNode = {
  shots?: Array<{ n: number; prompt: string }>;
  shotsOmitted?: boolean;
  refLooksSummary?: { count: number; first: string };
  planBTitleCopySummary?: { blocks: number; headline: string };
  roles?: Record<string, string>;
  rolesOmitted?: number;
  agentSources?: Array<{ prompt?: string; id?: string; type?: string; label?: string }>;
  outputText?: string;
  text?: string;
};
function structuredPayload(serialized: string): {
  activeSelectedNodes: StructuredNode[];
  upstreamLineage: StructuredNode[];
  connections: [string, string][];
} {
  const start = serialized.indexOf('```json\n');
  const end = serialized.indexOf('\n```', start);
  return JSON.parse(serialized.slice(start + '```json\n'.length, end));
}

const shotBody = '镜'.repeat(250);
const nineShots = Array.from({ length: 9 }, (_, index) => ({ n: index + 1, prompt: shotBody, specs: '不应进上下文' }));
const gridNode = { id: 'grid', type: 'nineGridAgent', shots: nineShots };
const gridPacked = serializeCanvasContext({
  ...snapshot,
  nodes: [gridNode],
  connections: [],
  selectedNodeIds: ['grid'],
});
const gridView = structuredPayload(gridPacked).activeSelectedNodes[0];
assert.equal(gridView?.shots?.length, 9);
assert.equal(gridView?.shots?.[0]?.prompt, shotBody);
assert.equal(gridView?.shots?.[0]?.prompt.length, 250);
assert.equal(JSON.stringify(gridView?.shots).includes('specs'), false);
assert.equal(gridView?.shotsOmitted, undefined);
assert.doesNotMatch(gridPacked, /正文已截断/);
assert.ok(gridPacked.length < 14_000);
const gridUpstream = structuredPayload(serializeCanvasContext({
  ...snapshot,
  nodes: [gridNode, { id: 'down', type: 'generator', prompt: '出图' }],
  connections: [{ id: 'e', from: 'grid', to: 'down' }],
  selectedNodeIds: ['down'],
})).upstreamLineage.find((node) => node.shots);
assert.equal(gridUpstream?.shots?.[3]?.prompt.length, 250);

const faceHair = `红发${'发'.repeat(298)}`;
const costume = `服装锚点全文${'衣'.repeat(294)}`;
const refLooks = Array.from({ length: 12 }, (_, index) => ({
  index: index + 1,
  name: `角色${index + 1}`,
  face_hair: faceHair,
  costume,
  accessories: '配'.repeat(300),
  body_type: '体'.repeat(300),
  style_notes: '风'.repeat(300),
}));
const posterBlocks = Array.from({ length: 30 }, (_, index) => `区块${index}${'字'.repeat(20)}`);
const posterCopy = {
  headline: `NEW SLOTS ${'FOR YOU '.repeat(12)}`,
  emphasis: 'FREE',
  secondary: 'up to',
  cta: 'CLAIM NOW',
  blocks: posterBlocks,
};
const analysisNode = {
  id: 'analysis',
  type: 'nineGridAgent',
  refLooks,
  planBTitleCopy: posterCopy,
};
const analysisPacked = serializeCanvasContext({
  ...snapshot,
  nodes: [analysisNode],
  connections: [],
  selectedNodeIds: ['analysis'],
});
assert.equal(analysisNode.refLooks[0]?.costume, costume);
assert.equal(analysisNode.planBTitleCopy.blocks.length, 30);
assert.equal(analysisNode.planBTitleCopy.blocks[29], posterBlocks[29]);
const analysisView = structuredPayload(analysisPacked).activeSelectedNodes[0];
assert.equal(analysisView?.refLooksSummary?.count, 12);
assert.equal(analysisView?.refLooksSummary?.first, `${faceHair.slice(0, 80)}…`);
assert.equal(analysisView?.planBTitleCopySummary?.blocks, 30);
assert.equal(analysisView?.planBTitleCopySummary?.headline, `${posterCopy.headline.slice(0, 80)}…`);
assert.equal(analysisPacked.includes(costume), false);
assert.equal(analysisPacked.includes(posterBlocks[29]!), false);
assert.ok(analysisPacked.length <= 14_000);
const phaseA = formatNineGridRefLooksForPhaseA(analysisNode.refLooks as never);
assert.ok(phaseA.includes(faceHair));
assert.ok(phaseA.includes(costume));
const phaseB = buildNineGridImagePrompt(nineShots, [{ url: '/ref.png', name: '角色1' }], { refLooks: analysisNode.refLooks });
assert.ok(phaseB.includes(costume));
const posterPromptFn = new Function(
  `${engineSlice(engineSource, 'function normalizeBatchPosterTitleCopy(raw){', 'function batchPosterTitleCopyHasContent')}
${engineSlice(engineSource, 'function formatBatchPosterThemeTitleCopyForPrompt(titleCopy, themeCreative = false){', 'function batchPosterPlanBSceneTitleZoneSuffix')}
return formatBatchPosterThemeTitleCopyForPrompt;`,
)() as (copy: typeof posterCopy) => string;
const posterPrompt = posterPromptFn(analysisNode.planBTitleCopy);
assert.ok(posterPrompt.includes(posterBlocks[0]!));
assert.ok(posterPrompt.includes(posterBlocks[29]!));

const roleEntries: Record<string, string> = {};
for (let index = 0; index < 20; index += 1) {
  roleEntries[`src${index}`] = index % 2 === 0 ? 'background' : 'character';
}
const longUrl = `https://example.com/${'u'.repeat(400)}`;
const roleNode = { id: 'replica', type: 'replicaAgent', roles: { ...roleEntries } };
const roleView = collectCanvasContext({
  ...snapshot,
  nodes: [roleNode],
  connections: [],
  selectedNodeIds: ['replica'],
}).activeSelectedNodes[0] as StructuredNode;
assert.equal(Object.keys(roleView.roles || {}).length, 16);
assert.equal(roleView.rolesOmitted, 4);
assert.equal(roleView.roles?.src0, 'background');
assert.equal(roleView.roles?.src19, undefined);
assert.equal(Object.values(roleView.roles || {}).every((value) => value === 'background' || value === 'character'), true);
const urlRoleNode = {
  id: 'replica-url',
  type: 'replicaAgent',
  roles: {
    [`img1:ref:0:${longUrl}`]: 'background',
    [`img1:ref:1:${longUrl}`]: 'character',
  },
};
const urlRoleView = collectCanvasContext({
  ...snapshot,
  nodes: [urlRoleNode],
  connections: [],
  selectedNodeIds: ['replica-url'],
}).activeSelectedNodes[0] as StructuredNode;
assert.equal(urlRoleView.roles?.['img1:ref:0'], 'background');
assert.equal(urlRoleView.roles?.['img1:ref:1'], 'character');
assert.equal(JSON.stringify(urlRoleView.roles).includes(longUrl), false);
assert.equal(urlRoleView.rolesOmitted, undefined);
const collisionNode = {
  id: 'replica-clash',
  type: 'replicaAgent',
  roles: {
    'img1:ref:0:https://a.example/one': 'background',
    'img1:ref:0:https://b.example/two': 'character',
  },
};
const collisionView = collectCanvasContext({
  ...snapshot,
  nodes: [collisionNode],
  connections: [],
  selectedNodeIds: ['replica-clash'],
}).activeSelectedNodes[0] as StructuredNode;
assert.deepEqual(collisionView.roles, { 'img1:ref:0': 'background' });
assert.equal(collisionView.rolesOmitted, 1);

const upstreamBody = '上'.repeat(3000);
const sourcePrompt = '源'.repeat(8000);
let overPacked = '';
let overView: StructuredNode | undefined;
for (let count = 6; count <= 40; count += 1) {
  const ids = Array.from({ length: count }, (_, index) => `u${index}`);
  const packed = serializeCanvasContext({
    ...snapshot,
    nodes: [
      ...ids.map((id) => ({ id, type: 'prompt', text: upstreamBody })),
      {
        id: 'gen',
        type: 'generator',
        prompt: '出图',
        shots: nineShots,
        refLooks,
        planBTitleCopy: posterCopy,
        roles: urlRoleNode.roles,
        agentSources: ids.map((id) => ({ id, type: 'prompt', label: id, prompt: sourcePrompt })),
      },
    ],
    connections: ids.map((id) => ({ id: `e-${id}`, from: id, to: 'gen' })),
    selectedNodeIds: ['gen'],
    availableModels: sourceModels,
  });
  const view = structuredPayload(packed).activeSelectedNodes[0];
  const shotPrompt = view?.shots?.[0]?.prompt || '';
  if (packed.length <= 14_000 && /正文已截断/.test(view?.agentSources?.[0]?.prompt || '') && /正文已截断/.test(shotPrompt) && shotPrompt.length < 250) {
    overPacked = packed;
    overView = view;
    break;
  }
}
assert.ok(overPacked, '多条长上游加满载格子时应把 shots 正文截进 14000');
assert.match(overView?.agentSources?.[0]?.prompt || '', /正文已截断/);
assert.ok((overView?.agentSources?.[0]?.prompt || '').length < 8000);
assert.match(overView?.shots?.[0]?.prompt || '', /正文已截断/);
assert.ok((overView?.shots?.[0]?.prompt || '').length < 250);
assert.equal(overView?.refLooksSummary?.first, `${faceHair.slice(0, 80)}…`);
assert.equal(overView?.planBTitleCopySummary?.headline, `${posterCopy.headline.slice(0, 80)}…`);
assert.equal(overView?.roles?.['img1:ref:0'], 'background');
assert.equal(overView?.roles?.['img1:ref:1'], 'character');
assert.equal(overPacked.includes(costume), false);

const capZeroPacked = serializeCanvasContext({
  ...snapshot,
  nodes: [{
    id: 'grid',
    type: 'nineGridAgent',
    shots: nineShots,
    agentSources: [{ id: 'src', type: 'llm', label: '长文', prompt: '长'.repeat(4000) }],
  }],
  connections: [],
  selectedNodeIds: ['grid'],
  settings: { theme: '垫'.repeat(20000) },
});
const capZeroView = structuredPayload(capZeroPacked).activeSelectedNodes[0];
assert.equal(capZeroView?.shots, undefined);
assert.equal(capZeroView?.shotsOmitted, true);
assert.equal(JSON.stringify(capZeroView?.shots || ''), '""');
assert.doesNotMatch(JSON.stringify(capZeroView), /"n":1/);

const loadedNode = {
  id: 'full',
  type: 'replicaAgent',
  shots: nineShots,
  refLooks,
  planBTitleCopy: posterCopy,
  roles: roleEntries,
};
const loadedContext = collectCanvasContext({
  ...snapshot,
  nodes: [loadedNode],
  connections: [],
  selectedNodeIds: ['full'],
});
const loadedJson = JSON.stringify(loadedContext);
const loadedSelected = loadedContext.activeSelectedNodes[0] as StructuredNode;
console.log(`structured-channel budget: ${loadedJson.length} chars, ${(loadedJson.length / 14000 * 100).toFixed(1)}% of 14000`);
assert.equal(loadedSelected.shots?.length, 9);
assert.equal(loadedSelected.shots?.[0]?.prompt.length, 250);
assert.equal(loadedSelected.refLooksSummary?.count, 12);
assert.equal(loadedSelected.planBTitleCopySummary?.blocks, 30);
assert.equal(Object.keys(loadedSelected.roles || {}).length, 16);
assert.ok(loadedJson.length < 14_000);
assert.doesNotMatch(loadedJson, /正文已截断/);

const posterSlot = engineSlice(engineSource, 'async function runBatchPosterImageSlot(', 'async function runBatchPosterImageSlotPlanB(');
const posterPlanB = engineSlice(engineSource, 'async function runBatchPosterImageSlotPlanB(', 'function batchPosterBrainstormStatusLabel(');
const ninePhaseB = engineSlice(engineSource, 'async function runNineGridPhaseB(', 'async function runNineGridFull(');
const nineCell = engineSlice(engineSource, 'async function runNineGridCellEdit(', 'function renderNineGridShotCells(');
assert.equal(posterSlot.split('registerCanvasTaskLedger(').length - 1, 1);
assert.match(posterSlot, /hostNodeId: out\?\.id \|\| ''/);
assert.match(posterSlot, /genNodeId: ownerNodeId \|\| ''/);
assert.equal(posterPlanB.split('registerCanvasTaskLedger(').length - 1, 2);
assert.match(posterPlanB, /hostNodeId: out\?\.id \|\| ''/);
assert.match(posterPlanB, /genNodeId: ownerNodeId \|\| ''/);
assert.match(ninePhaseB, /hostNodeId: node\.id \|\| ''/);
assert.match(ninePhaseB, /genNodeId: node\.id \|\| ''/);
assert.match(nineCell, /hostNodeId: node\.id \|\| ''/);
assert.match(nineCell, /genNodeId: node\.id \|\| ''/);
const resumeSource = engineSlice(engineSource, 'function resumeCanvasImageTasks(){', 'function outputMetaPrompt(');
assert.match(resumeSource, /if\(!gen \|\| !\(isGenConsoleNode\(gen\) \|\| gen\.type === 'rh'\)\) continue;/);
assert.doesNotMatch(resumeSource, /runBatchPosterAgent|runNineGridPhaseB|runNineGridCellEdit|runNineGridFull/);
assert.match(engineSource, /hostNodeId: targetNode\.id \|\| ''/);
assert.match(engineSource, /genNodeId: targetNode\.id \|\| ''/);

const ledgerHarness = new Function(
  'engineSlice',
  'engineSource',
  `
const canvasTaskLedger = new Map();
const completedCanvasTaskIds = new Set();
const serverLedgerHydratedCanvasIds = new Set();
let canvas = { id: 'c1' };
let nodes = [];
let nodesEl = null;
let imageGenDockNodeId = null;
let genHistoryPanelNodeId = null;
const record = { atPoll: [], replica: [], repair: [], sync: [], clicks: [] };
function nowMs(){ return 5000; }
function uid(prefix){ return prefix + '-rebuilt'; }
function langIsEn(){ return false; }
function loadCanvasTaskLedger(){}
function persistCanvasTaskLedger(){}
function hydrateServerCanvasTaskLedger(){}
function flushParkedCanvasTaskResults(){}
function apiFetch(){ return Promise.resolve(); }
function canvasTaskLedgerEntry(id){ return canvasTaskLedger.get(String(id)) || null; }
function canvasTaskLedgerRaw(id){ return canvasTaskLedger.get(String(id)) || null; }
function findPendingTask(taskId){
  for(const host of nodes){
    const pending = (host._pending || []).find(p => String(p.canvasTaskId || '') === String(taskId));
    if(pending) return { out: host, pending, gen: nodes.find(n => n.id === pending.run?.node?.id) || null };
  }
  return null;
}
function pendingHostForNode(node){ record.clicks.push('host-fallback'); return node; }
function outputUrlValue(item){ return typeof item === 'string' ? item : (item?.url || ''); }
function normalizeNineGridShots(shots){ return Array.isArray(shots) ? shots : []; }
function escapeAttr(value){ return String(value ?? ''); }
function escapeHtml(value){ return String(value ?? ''); }
function nineGridFallbackSlicePosition(){ return { col: 0, row: 0 }; }
function mediaKindForOutputItem(){ return 'image'; }
function outputImageModelLabel(){ return ''; }
function outputMetaPrompt(){ return ''; }
function appendGeneratorPreviewRound(){}
function agentPendingCount(nodeId){
  if(!nodeId) return 0;
  const self = nodes.find(n => n.id === nodeId);
  let sum = self && self.type !== 'output' ? (self._pending || []).length : 0;
  return nodes.filter(n => n.type === 'output').reduce((acc, out) => {
    return acc + (out._pending || []).filter(p => p.run?.node?.id === nodeId).length;
  }, sum);
}
function addGenerationLog(){}
function refreshRunNodes(){}
function scheduleSaveNow(){}
function refreshNodes(){}
function reserveGeneratorPendingSlots(){}
function syncAgentRunStatusAfterTask(gen){ record.sync.push(gen?.id || ''); }
function generatorHistoryItems(){ return []; }
function generatorPreviewUrls(){ return []; }
function refreshGenStage(){}
function syncImageGenDock(){}
function refreshOpenGenHistoryPanel(){}
function makePending(id, run, task){ return { id, startedAt: nowMs(), run, ...task }; }
function normalizeTaskResultImages(result){
  if(Array.isArray(result?.images) && result.images.length) return result.images;
  return result?.url ? [result.url] : [];
}
function shouldParkTaskResult(){ return false; }
function requestMetaFromResult(){ return {}; }
function orphanImagesOntoCanvas(){ record.clicks.push('orphan'); }
function unregisterCanvasTaskLedger(taskId){ canvasTaskLedger.delete(String(taskId || '').trim()); }
function runBatchPosterAgent(){ record.clicks.push('poster'); }
function runNineGridPhaseB(){ record.clicks.push('grid'); }
${engineSlice(engineSource, 'function isGenConsoleNode(node){', 'function nodeShowsGenDock(node){')}
${engineSlice(engineSource, 'function mergeGeneratedOutputs(node, outputs, append=false){', 'function pendingById(out, id){')}
${engineSlice(engineSource, 'function registerCanvasTaskLedger(taskId, info){', 'function unregisterCanvasTaskLedger(taskId){')}
${engineSlice(engineSource, 'function resolveCanvasTaskContext(taskId){', 'function orphanImagesOntoCanvas(images, meta={}){')}
${engineSlice(engineSource, 'function appendOutputImages(out, images, compareRef, metas=[], layout=null){', 'function outputCompareUrlFor(url, out){')}
${engineSlice(engineSource, 'function applyCompletedCanvasImages(ctx, images, meta, taskId){', 'function completeCanvasImageTask(taskId, result){')}
${engineSlice(engineSource, 'function completeCanvasImageTask(taskId, result){', 'function failCanvasImageTask(taskId, message){')}
${engineSlice(engineSource, 'function resumeCanvasImageTasks(){', 'function outputMetaPrompt(meta={}){')}
${engineSlice(engineSource, 'function renderNineGridShotCells(node){', 'function renderNineGridAgentBody(node){')}
function pollCanvasImageTask(taskId){
  record.atPoll.push({
    taskId: String(taskId),
    pending: nodes.some(n => (n._pending || []).some(p => String(p.canvasTaskId || '') === String(taskId))),
    running: nodes.some(n => n.running || n.runStatus === 'running'),
  });
  if(String(taskId).startsWith('hold-')) return 'pending';
  completeCanvasImageTask(taskId, { url: 'https://img.test/' + taskId + '.png' });
  return 'succeeded';
}
function pollReplicaAgentTask(taskId){ record.replica.push(String(taskId)); }
function pollImageRepairAgentTask(taskId){ record.repair.push(String(taskId)); }
function pollCanvasVideoTask(){}
function pollRunningHubTask(){}
function urls(list){
  return (list || []).map(item => typeof item === 'string' ? item : item?.url).filter(Boolean);
}
const run = { node: { id: 'poster', type: 'batchPosterAgent' }, prompt: 'poster' };
nodes = [
  { id: 'poster', type: 'batchPosterAgent', generatedOutputs: [] },
  { id: 'out1', type: 'output', images: [] },
];
registerCanvasTaskLedger('task-a', {
  canvasId: 'c1', hostNodeId: 'out1', genNodeId: 'poster', pendingId: 'p1', run,
  appendGenerated: false, startedAt: 1, canvasTaskType: 'online-image',
});
const planACtx = resolveCanvasTaskContext('task-a');
resumeCanvasImageTasks();
const planA = {
  gen: planACtx?.gen?.id,
  host: planACtx?.out?.id,
  posterUrls: urls(nodes[0].generatedOutputs),
  hostUrls: urls(nodes[1].images),
  pending: (nodes[1]._pending || []).length,
  atPoll: record.atPoll[0],
  runStatus: nodes[0].runStatus,
  sync: record.sync.slice(),
  clicks: record.clicks.slice(),
};
record.atPoll = [];
record.sync = [];
nodes = [
  { id: 'poster', type: 'batchPosterAgent', generatedOutputs: [] },
  { id: 'out1', type: 'output', images: [] },
];
registerCanvasTaskLedger('task-scene', {
  canvasId: 'c1', hostNodeId: 'out1', genNodeId: 'poster', pendingId: '', run,
  appendGenerated: false, startedAt: 1, canvasTaskType: 'online-image',
});
registerCanvasTaskLedger('task-typo', {
  canvasId: 'c1', hostNodeId: 'out1', genNodeId: 'poster', pendingId: 'p-typo', run,
  appendGenerated: false, startedAt: 2, canvasTaskType: 'online-image',
});
const planBKeys = [...canvasTaskLedger.keys()];
resumeCanvasImageTasks();
const planB = {
  keys: planBKeys,
  hostUrls: urls(nodes[1].images),
  posterUrls: urls(nodes[0].generatedOutputs),
  polls: record.atPoll.map(item => item.taskId),
  pendingAtPoll: record.atPoll.map(item => item.pending),
  runningAtPoll: record.atPoll.map(item => item.running),
};
for(let i = 0; i < 20; i += 1){
  registerCanvasTaskLedger('wave-' + i, {
    canvasId: 'c1', hostNodeId: 'out1', genNodeId: 'poster', pendingId: 'pend-' + i, run,
    appendGenerated: false, startedAt: i, canvasTaskType: 'online-image',
  });
}
const twenty = canvasTaskLedger.size;
registerCanvasTaskLedger('wave-0', {
  canvasId: 'c1', hostNodeId: 'out1', genNodeId: 'poster', pendingId: 'replaced', run,
  appendGenerated: false, startedAt: 9, canvasTaskType: 'online-image',
});
const afterRewrite = {
  size: canvasTaskLedger.size,
  wave0: canvasTaskLedger.get('wave-0')?.pendingId,
  wave19: canvasTaskLedger.has('wave-19'),
};
canvasTaskLedger.clear();
record.atPoll = [];
record.sync = [];
nodes = [{ id: 'grid', type: 'nineGridAgent', gridUrl: '', generatedOutputs: [], croppedUrls: [], shots: [{ n: 1, prompt: '一格' }] }];
const gridRun = { node: { id: 'grid', type: 'nineGridAgent' }, prompt: 'grid' };
registerCanvasTaskLedger('task-grid', {
  canvasId: 'c1', hostNodeId: 'grid', genNodeId: 'grid', pendingId: '', run: gridRun,
  appendGenerated: false, startedAt: 1, canvasTaskType: 'online-image',
});
const gridCtx = resolveCanvasTaskContext('task-grid');
resumeCanvasImageTasks();
const phaseB = {
  gen: gridCtx?.gen?.id,
  host: gridCtx?.out?.id,
  third: gridCtx?.pending?.run?.node?.id,
  urls: urls(nodes[0].generatedOutputs),
  gridUrl: nodes[0].gridUrl,
  panel: renderNineGridShotCells(nodes[0]),
  pending: (nodes[0]._pending || []).length,
  atPoll: record.atPoll[0],
  runStatus: nodes[0].runStatus,
  clicks: record.clicks.slice(),
};
canvasTaskLedger.clear();
record.atPoll = [];
nodes = [{ id: 'grid', type: 'nineGridAgent', gridUrl: 'board.png', generatedOutputs: [], croppedUrls: ['', '', ''], shots: [{ n: 1, prompt: '一格' }] }];
registerCanvasTaskLedger('task-cell', {
  canvasId: 'c1', hostNodeId: 'grid', genNodeId: 'grid', pendingId: '', run: gridRun,
  appendGenerated: false, startedAt: 1, canvasTaskType: 'online-image',
});
resumeCanvasImageTasks();
const cell = {
  urls: urls(nodes[0].generatedOutputs),
  cropped: nodes[0].croppedUrls.slice(),
  gridUrl: nodes[0].gridUrl,
  panel: renderNineGridShotCells(nodes[0]),
  pending: (nodes[0]._pending || []).length,
  atPoll: record.atPoll[0],
};
canvasTaskLedger.clear();
record.atPoll = [];
record.replica = [];
record.repair = [];
record.sync = [];
nodes = [
  { id: 'replica', type: 'replicaAgent' },
  { id: 'repair', type: 'imageRepairAgent' },
  { id: 'still', type: 'image' },
  { id: 'gen', type: 'generator', generatedOutputs: [] },
  { id: 'gen-out', type: 'output', images: [] },
];
registerCanvasTaskLedger('hold-replica', {
  canvasId: 'c1', hostNodeId: 'replica', genNodeId: 'replica', pendingId: '', run: { node: { id: 'replica' } },
  appendGenerated: false, startedAt: 1, canvasTaskType: 'replica-agent',
});
registerCanvasTaskLedger('hold-repair', {
  canvasId: 'c1', hostNodeId: 'repair', genNodeId: 'repair', pendingId: '', run: { node: { id: 'repair' } },
  appendGenerated: false, startedAt: 1, canvasTaskType: 'image-repair-agent',
});
registerCanvasTaskLedger('hold-image', {
  canvasId: 'c1', hostNodeId: 'still', genNodeId: 'still', pendingId: '', run: { node: { id: 'still' } },
  appendGenerated: false, startedAt: 1, canvasTaskType: 'online-image',
});
registerCanvasTaskLedger('task-gen', {
  canvasId: 'c1', hostNodeId: 'gen-out', genNodeId: 'gen', pendingId: 'pg', run: { node: { id: 'gen' } },
  appendGenerated: false, startedAt: 1, canvasTaskType: 'online-image',
});
resumeCanvasImageTasks();
return {
  planA, planB, twenty, afterRewrite, phaseB, cell,
  replica: record.replica,
  repair: record.repair,
  imagePoll: record.atPoll.find(item => item.taskId === 'hold-image'),
  genPoll: record.atPoll.find(item => item.taskId === 'task-gen'),
  sync: record.sync,
  replicaPending: (nodes.find(n => n.id === 'replica')._pending || []).length,
  repairPending: (nodes.find(n => n.id === 'repair')._pending || []).length,
  imagePending: (nodes.find(n => n.id === 'still')._pending || []).length,
  genGridUrl: nodes.find(n => n.id === 'gen')?.gridUrl,
};
`,
);
const ledger = ledgerHarness(engineSlice, engineSource);
assert.equal(ledger.planA.gen, 'poster');
assert.equal(ledger.planA.host, 'out1');
assert.deepEqual(ledger.planA.posterUrls, ['https://img.test/task-a.png']);
assert.deepEqual(ledger.planA.hostUrls, ['https://img.test/task-a.png']);
assert.equal(ledger.planA.pending, 0);
assert.equal(ledger.planA.atPoll.pending, false);
assert.equal(ledger.planA.atPoll.running, false);
assert.equal(ledger.planA.runStatus, 'done');
assert.deepEqual(ledger.planA.sync, []);
assert.deepEqual(ledger.planA.clicks, []);
assert.deepEqual(ledger.planB.keys, ['task-scene', 'task-typo']);
assert.deepEqual(ledger.planB.polls, ['task-scene', 'task-typo']);
assert.deepEqual(ledger.planB.pendingAtPoll, [false, false]);
assert.deepEqual(ledger.planB.runningAtPoll, [false, false]);
assert.deepEqual(ledger.planB.hostUrls, ['https://img.test/task-scene.png', 'https://img.test/task-typo.png']);
assert.equal(ledger.twenty, 20);
assert.equal(ledger.afterRewrite.size, 20);
assert.equal(ledger.afterRewrite.wave0, 'replaced');
assert.equal(ledger.afterRewrite.wave19, true);
assert.equal(ledger.phaseB.gen, 'grid');
assert.equal(ledger.phaseB.host, 'grid');
assert.equal(ledger.phaseB.third, 'grid');
assert.deepEqual(ledger.phaseB.urls, ['https://img.test/task-grid.png']);
assert.equal(ledger.phaseB.gridUrl, 'https://img.test/task-grid.png');
assert.match(ledger.phaseB.panel, /src="https:\/\/img\.test\/task-grid\.png"/);
assert.doesNotMatch(ledger.phaseB.panel, /等待/);
assert.equal(ledger.phaseB.pending, 0);
assert.equal(ledger.phaseB.atPoll.pending, false);
assert.equal(ledger.phaseB.atPoll.running, false);
assert.deepEqual(ledger.phaseB.clicks, []);
assert.deepEqual(ledger.cell.urls, ['https://img.test/task-cell.png']);
assert.equal(ledger.cell.gridUrl, 'board.png');
assert.deepEqual(ledger.cell.cropped, ['', '', '']);
assert.match(ledger.cell.panel, /src="board\.png"/);
assert.doesNotMatch(ledger.cell.panel, /task-cell/);
assert.equal(ledger.cell.pending, 0);
assert.equal(ledger.cell.atPoll.pending, false);
assert.equal(ledger.cell.atPoll.running, false);
assert.deepEqual(ledger.replica, ['hold-replica']);
assert.deepEqual(ledger.repair, ['hold-repair']);
assert.equal(ledger.imagePoll.pending, false);
assert.equal(ledger.imagePoll.running, false);
assert.equal(ledger.genPoll.pending, true);
assert.equal(ledger.replicaPending, 0);
assert.equal(ledger.repairPending, 0);
assert.equal(ledger.imagePending, 0);
assert.deepEqual(ledger.sync, ['gen']);
assert.equal(ledger.genGridUrl, undefined);
const imageApply = engineSlice(engineSource, 'function applyCompletedCanvasImages(', 'function completeCanvasImageTask(');
const imageComplete = engineSlice(engineSource, 'function completeCanvasImageTask(', 'function failCanvasImageTask(');
const videoAndRh = engineSlice(engineSource, 'function applyCompletedCanvasVideos(', 'function failRunningHubTask(');
assert.equal(imageApply.includes('createCanvasImageTask'), false);
assert.equal(imageComplete.includes('createCanvasImageTask'), false);
assert.equal(videoAndRh.includes('gridUrl'), false);
assert.equal(videoAndRh.includes('createCanvasImageTask'), false);

console.log('canvas-agent self-check: ok');
