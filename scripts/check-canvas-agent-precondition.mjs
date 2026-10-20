/**
 * 前置早退 stub。不打真实生成接口。
 * 跑法：node --import tsx scripts/check-canvas-agent-precondition.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { settleAgentStaleAfterExecution, nodeLifecycle, assertAgentCanExecute } from '../src/features/canvas-agent/core/operatingModel.ts';
import { settleBatchProposal, pendingExecutionFeedback } from '../src/features/canvas-agent/core/proposal.ts';
import { serializeCanvasContext } from '../src/features/canvas-agent/core/contextSerializer.ts';

const lines = fs.readFileSync('src/lib/infiniteCanvas/canvasEngine.js', 'utf8').split(/\n/);
function sliceFn(start){
    const i = lines.findIndex((line) => line === start || line === 'export ' + start);
    if(i < 0) throw new Error('missing ' + start);
    let end = i + 1;
    while(end < lines.length && !/^(?:export )?(?:async )?function /.test(lines[end])) end++;
    return lines.slice(i, end).join('\n').replace(/^export /gm, '');
}

const engineFns = [
    'function isNodeDisabled(node){',
    'function isMxShellFamilyAgent(nodeOrType){',
    'function isMxShellPolishAgent(nodeOrType){',
    'function composeGeneratorPrompt(gen, sources){',
    'function rejectCanvasAgentPrecondition(node, message, opts, recordStatus){',
    'async function runViewpointAgent(nodeId, opts={}){',
    'async function runMsGenNode(nodeId, opts={}){',
    'async function runSlotsLoopVideoAgent(nodeId, opts={}){',
    'async function runMxShellPromptAgent(nodeId, opts={}){',
    'async function runDeepWhiteShotAgent(nodeId, opts={}){',
    'async function runScreenwritingAgent(nodeId, opts={}){',
    'async function runPixarAdScriptAgent(nodeId, opts={}){',
    'async function runBatchPosterAgent(nodeId, opts={}){',
    'async function runNineGridPhaseA(nodeId, opts={}){',
    'async function runNineGridPhaseB(nodeId, opts={}){',
    'async function runNineGridFull(nodeId, opts={}){',
    'async function runNineGridCrop(nodeId){',
    'async function runNineGridCellEdit(nodeId, idx){',
    'async function runReplicaAgent(nodeId, opts={}){',
    'async function runImageRepairAgent(nodeId, opts={}){',
    'async function runVideoReverseNode(nodeId, opts={}){',
    'async function runRhNode(nodeId, opts={}){',
    'async function runGeneratorSingle(gen, prompt, refs, opts={}){',
    'async function runGenerator(genId, opts={}){',
    'async function executeBatchPosterRun(nodeId, runToken, ctx, run, out, llmPendingIds, cascade){',
    'async function runVideoNode(nodeId, opts={}){',
    'async function runLLMNode(nodeId, opts={}){',
    'function runCascadeNodeByType(node, opts={}){',
    'function runCascadeNodeWithLoopContext(node, ctx, opts={}){',
    'async function runNodeCascade(nodeId){',
    'async function runOneCascadePass(order, options={}){',
    'async function rerunFailedNode(nodeId){',
    'async function runCanvasGenerate(nodeId){',
    'function canvasRunTypes(){',
    'function stampCanvasAgentLastError(node, message){',
    'function executeCanvasAgentNodeSkill(nodeId){',
    'function flushCanvasAgentSave(){',
].map(sliceFn).join('\n');

const alerts = [];
const reached = [];
const nodes = [];
const connections = [];
const diskBox = { json: '' };
const gate = {
    sources: [],
    background: null,
    repair: null,
    poster: null,
    youchuan: false,
    image: null,
    entry: null,
    fields: [],
};

const harness = new Function('nodes', 'connections', 'alerts', 'reached', 'diskBox', 'gate', `
var loopContext = null;
var MS_GEN_MODELS = { zimage: { supportsImage: false }, img: { supportsImage: true } };
var NINE_GRID_SHOT_PROMPT_MIN_CHARS = 150;
function softAlert(message){ alerts.push(String(message)); }
function tr(key){
    const map = {
        'canvas.needPrompt': '请先连接提示词',
        'canvas.needImage': '请先连接图片',
        'canvas.rhNeedWorkflowId': '请先填写 RunningHub workflowId',
        'canvas.rhNeedWebappId': '请先填写 RunningHub webappId',
        'canvas.youchuanNeedPrompt': '该模型需要提示词',
        'canvas.needPromptOrImage': '请先连接提示词或图片',
        'canvas.videoNeedsPrompt': '请先连接提示词',
        'canvas.needPromptToLLM': '请先连接 Prompt 到 LLM',
        'canvas.runFailedOutputUnchanged': '输出未改变',
        'canvas.generationFailed': '生成失败',
        'canvas.videoFailed': '视频生成失败',
        'canvas.rhFailed': 'RunningHub 生成失败',
        'canvas.nodeDisabledRunBlocked': '节点已禁用',
        'canvas.loopRound': '循环',
    };
    if(!map[key]) throw new Error('unexpected tr ' + key);
    return map[key];
}
function langIsEn(){ return false; }
function refreshNodes(){}
function refreshRunNodes(){}
function setStatus(){}
function scheduleSave(){ diskBox.json = JSON.stringify(nodes); }
function pullFocusedEditableIntoModel(){}
function syncGeneratorDockFieldsIntoNode(){}
function coerceReferenceImageModel(model){ return String(model || ''); }
function syncConnectedImageBatchMembership(){ return false; }
function softRefreshGeneratorInputLists(){}
function scrubGeneratorHistoryBloat(){ return false; }
function resolveCascadeLoop(){ return gate.loop || null; }
function computeCascadeOrder(){ return gate.cascadeOrder || []; }
function cascadeUiNodeIds(_id, order){ return order || gate.cascadeOrder || []; }
function computeConnectedWorkflowOrder(id){ return gate.workflowOrder || [id]; }
function showErrorModal(message, title){ alerts.push('MODAL:' + title + ':' + message); }
function humanizeCanvasGenerationError(text){ return String(text || ''); }
function setTimeout(){ return 0; }
var cascadeRunningIds = new Set();
var cascadeStopIds = new Set();
var cascadeSerialIds = new Set();
var LOOP_PARALLEL_MAX = 10;
function generatorSources(){ return gate.sources; }
function orderedSources(_node, sources){ return sources || []; }
function imageRefsOnly(list){ return (list || []).filter((item) => item && item.url); }
function videoRefsOnly(){ return []; }
function currentMsModelId(){ return 'x'; }
function modelscopeLorasForModel(){ return []; }
function viewpointAgentFields(node){ return { intent: String(node.intent || '') }; }
function viewpointAgentTextReady(fields){ return String(fields.intent || '').trim().length >= 4; }
function slotsLoopVideoAgentImageRef(){ return gate.image; }
function slotsLoopVideoAgentCreativeIdea(){ return ''; }
function mxShellPromptAgentStory(node){ return String(node.story || ''); }
function deepWhiteShotAgentScene(node){ return String(node.scene || ''); }
function pixarAdAgentScript(node){ return String(node.story || ''); }
function replicaAgentRoleImages(){ return { background: gate.background, characters: gate.background ? [] : [] }; }
function imageRepairAgentSourceImage(){ return gate.repair; }
function batchPosterAgentPosterRef(){ return gate.poster; }
function batchPosterUsesCustomTheme(node){ return node.theme_source === 'custom'; }
function normalizeBatchPosterCustomTheme(value){ return String(value || '').trim(); }
function confirmNineGridOverwriteDeepWhite(){ return true; }
function nineGridAgentStory(node){ return String(node.story || ''); }
function nineGridAgentRefsPayload(){ return gate.sources.flatMap((item) => item.refs || []); }
function normalizeNineGridAgentNode(){}
function normalizeNineGridShots(shots){ return Array.isArray(shots) && shots.length ? shots : null; }
function updateNineGridAgentProgress(){}
function updateNineGridRunButtons(){}
function nineGridRefVisionWarnings(){ return []; }
function resolveNineGridAgentTextModel(){ return 'm'; }
function resolveImageRepairAgentTextModel(){ return 'm'; }
async function nineGridFetchJson(){
    reached.push('nine');
    if(gate.fetchShots) return { shots: gate.fetchShots, refLooks: [] };
    throw new Error('REACHED_RUN');
}
function buildNineGridImagePrompt(){ return 'board'; }
async function buildNineGridImageTaskPayload(){ return {}; }
function resolveImageModel(model){ return model || 'nano-banana-pro'; }
async function createCanvasImageTask(){
    reached.push('image');
    if(gate.imageOk || gate.genFail) return { task_id: 'img1' };
    throw new Error('REACHED_RUN');
}
function rhCurrentKind(node){ return node.rhMode || 'workflow'; }
function ensureRhNodeSelection(){}
function rhCurrentEntry(){ return gate.entry; }
async function ensureRunningHubWorkflowConfigForNode(){}
function rhActiveFields(){ return gate.fields; }
function isYouchuanRhModel(){ return gate.youchuan; }
function rejectCanvasAgentModelChoice(){ return false; }
function llmInputText(){ return ''; }
function videoReverseConnectedPromptNodes(node){
    return connections.filter((edge) => edge.to === node.id).map((edge) => nodes.find((item) => item.id === edge.from)).filter((item) => item && item.type === 'prompt');
}
function videoReverseInputText(node){
    const prompt = videoReverseConnectedPromptNodes(node)[0];
    return String((prompt && prompt.text) || '');
}
function videoReverseInputVideos(node){ return node._videos || []; }
function canvasAgentExecutionTimeoutMs(){ return 120000; }
function agentPendingCount(){ return 0; }
function sleep(){ throw new Error('LEAK sleep'); }
async function apiFetch(url){
    reached.push('api');
    const path = String(url || '');
    if(path.includes('replica-agent-run') && (gate.replicaRun || gate.replicaFail)){
        return { ok: true, json: async () => ({ task_id: 'rep1' }) };
    }
    if(path.includes('image-repair-agent-run') && gate.repairRun){
        return { ok: true, json: async () => ({ task_id: 'fix1' }) };
    }
    if(path.includes('/api/canvas/viewpoint-agent')) throw new Error(gate.llmFail || 'REACHED_RUN');
    throw new Error('REACHED_RUN');
}
async function callCanvasLLM(){
    reached.push('llm');
    if(gate.llmText) return gate.llmText;
    throw new Error(gate.llmFail || 'REACHED_RUN');
}
async function createCanvasVideoTask(){
    reached.push('video');
    if(gate.videoOk || gate.videoFail) return { task_id: 'vid1' };
    throw new Error('REACHED_RUN');
}
async function replicaAgentRatioForRun(){ return { canvas_ratio: '1:1', canvas_custom_ratio: '' }; }
function runSnapshot(){ return {}; }
function uid(){ return 'p1'; }
function canvasLocalUploadPath(url){ return url; }
function normalizeReplicaTargetMarkers(){ return []; }
function resolveReplicaAgentTextModel(){ return 'm'; }
function mxShellPromptAgentImageUrls(){ return []; }
async function resolveSlotsLoopVideoImageUrlForApi(url){ return url; }
function normalizeSlotsLoopVideoDuration(){ return 5; }
function normalizeScreenwritingMode(){ return 'short'; }
function clampAgentTextModel(){ return 'm'; }
function resolvePerItemGroupBatch(){
    if(gate.allowSingle) return null;
    throw new Error('LEAK batch');
}
function outputForNode(node){ return node; }
function resetGeneratorPreviewRound(){}
function nowMs(){ return 1; }
function pushNodePending(node, items){ node._pending = (node._pending || []).concat(items || []); return node; }
function makePending(id){ return { id }; }
function reserveGeneratorPendingSlots(){}
function syncAppendableNodeRunState(){}
function revealGeneratorResultsWhileRunning(){}
async function buildGeneratorTaskPayload(){ return {}; }
function dropUnboundGenPending(){}
function pendingHostForNode(node){ return node; }
function isPendingActive(){ return true; }
function stampPendingCanvasTask(){}
async function saveCanvas(){}
async function responseErrorMessage(_res, fallback){ return fallback || 'failed'; }
function resolveVideoProviderId(id){ return id || 'comfly'; }
function isSparkVideo20Model(){ return false; }
function isHailuoH3VideoModel(){ return false; }
function resolveImageRepairAgentImageModel(){ return 'm'; }
function clearNodePending(){}
function collectRunMetas(){ return [{ runMs: 1 }]; }
function addGenerationLog(){}
function syncAgentRunStatusAfterTask(gen, opts){
    if(!gen) return;
    gen.running = false;
    if(opts && opts.failed){
        gen.runStatus = 'failed';
        if(opts.error) gen.runError = opts.error;
        return;
    }
    if(opts && opts.completed){
        gen.runStatus = 'done';
        gen.runError = '';
    }
}
async function pollCanvasImageTask(){
    reached.push('image-poll');
    const node = nodes.find((item) => item.type === 'generator');
    if(gate.genFail){
        if(node){ node.runStatus = 'failed'; node.runError = gate.genFail; }
        return 'failed';
    }
    if(node){ node.runStatus = 'done'; node.runError = ''; }
    return 'succeeded';
}
async function pollCanvasVideoTask(){
    reached.push('video-poll');
    const node = nodes.find((item) => item.type === 'video');
    if(gate.videoFail){
        if(node){ node.runStatus = 'failed'; node.runError = gate.videoFail; }
        return 'failed';
    }
    if(node){ node.runStatus = 'done'; node.runError = ''; }
    return 'succeeded';
}
async function pollReplicaAgentTask(){
    reached.push('replica-poll');
    const node = nodes.find((item) => item.type === 'replicaAgent');
    if(gate.replicaFail){
        if(node){ node.runStatus = 'failed'; node.runError = gate.replicaFail; }
        return 'failed';
    }
    if(node){ node.runStatus = 'done'; node.runError = ''; }
    return 'completed';
}
function pollImageRepairAgentTask(){
    const node = nodes.find((item) => item.type === 'imageRepairAgent');
    if(node && gate.repairFail){
        node.runStatus = 'failed';
        node.runError = gate.repairFail;
        node.running = false;
        node._pending = [];
    }
    return Promise.resolve('failed');
}
function snapshotBatchPosterRunContext(_node, count, posterRef){
    return { count, posterRef, brainstorm: {}, planB: false, basePrompt: 'poster', genStub: {} };
}
function registerBatchPosterRun(){}
function syncBatchPosterNodeRunState(node){
    if(node.runError) node.runStatus = 'failed';
}
function updateBatchPosterRunButton(){}
function batchPosterBrainstormStatusLabelFromCfg(){ return 'brainstorm'; }
function noteCanvasAgentOutputHost(){}
function removeBatchPosterRunPending(){}
function updateBatchPosterRunProgress(){}
function batchPosterModerationRetryAttempt(){ return 0; }
var BATCH_POSTER_IMAGE_MAX_RETRIES = 0;
async function brainstormBatchPosterThemes(){ return [{ theme: '夜戏' }]; }
async function runBatchPosterImageSlot(){
    reached.push('poster');
    if(gate.posterFail) return { status: 'failed', error: gate.posterFail };
    return { status: 'succeeded' };
}
function finishBatchPosterRun(node, _token, opts){
    if(opts && opts.error){
        node.runError = opts.error;
        node.runStatus = 'failed';
        return;
    }
    node.runStatus = 'done';
    node.runError = '';
}
var canvas = { id: 'c1' };
${engineFns}
return { executeCanvasAgentNodeSkill, flushCanvasAgentSave, runViewpointAgent, runMsGenNode, runSlotsLoopVideoAgent, runMxShellPromptAgent, runDeepWhiteShotAgent, runScreenwritingAgent, runPixarAdScriptAgent, runBatchPosterAgent, runNineGridPhaseA, runNineGridPhaseB, runNineGridFull, runNineGridCrop, runNineGridCellEdit, runReplicaAgent, runImageRepairAgent, runVideoReverseNode, runRhNode, runGenerator, runVideoNode, runLLMNode, runNodeCascade, runOneCascadePass, rerunFailedNode, runCanvasGenerate };
`);

const api = harness(nodes, connections, alerts, reached, diskBox, gate);
const runners = {
    runViewpointAgent: api.runViewpointAgent,
    runMsGenNode: api.runMsGenNode,
    runSlotsLoopVideoAgent: api.runSlotsLoopVideoAgent,
    runMxShellPromptAgent: api.runMxShellPromptAgent,
    runDeepWhiteShotAgent: api.runDeepWhiteShotAgent,
    runScreenwritingAgent: api.runScreenwritingAgent,
    runPixarAdScriptAgent: api.runPixarAdScriptAgent,
    runBatchPosterAgent: api.runBatchPosterAgent,
    runNineGridPhaseA: api.runNineGridPhaseA,
    runNineGridPhaseB: api.runNineGridPhaseB,
    runReplicaAgent: api.runReplicaAgent,
    runImageRepairAgent: api.runImageRepairAgent,
    runVideoReverseNode: api.runVideoReverseNode,
    runRhNode: api.runRhNode,
    runGenerator: api.runGenerator,
    runVideoNode: api.runVideoNode,
    runLLMNode: api.runLLMNode,
};

function blank(type, extra){
    return {
        id: 'n1',
        type,
        runStatus: 'idle',
        running: false,
        agentStale: true,
        agentStaleReason: '上游改过',
        agentImpactPath: ['up', 'n1'],
        agentLastError: { message: '上次的错误', at: 1 },
        ...extra,
    };
}
function reset(node, edges){
    nodes.length = 0;
    nodes.push(node);
    connections.length = 0;
    for(const edge of edges || []) connections.push(edge);
    alerts.length = 0;
    reached.length = 0;
    diskBox.json = '';
    gate.sources = [];
    gate.background = null;
    gate.repair = null;
    gate.poster = null;
    gate.youchuan = false;
    gate.image = null;
    gate.entry = null;
    gate.fields = [];
    gate.fetchShots = null;
    gate.cascadeOrder = null;
    gate.workflowOrder = null;
    gate.loop = null;
    gate.allowSingle = false;
    gate.imageOk = false;
    gate.genFail = '';
    gate.videoOk = false;
    gate.videoFail = '';
    gate.replicaRun = false;
    gate.replicaFail = '';
    gate.repairRun = false;
    gate.repairFail = '';
    gate.posterFail = '';
    gate.llmText = '';
    gate.llmFail = '';
}
function snapshotOf(list){
    return {
        canvasId: 'precondition',
        nodes: list,
        connections: [],
        selectedNodeIds: ['n1'],
        viewport: { x: 0, y: 0, scale: 1 },
        viewportCenter: { x: 0, y: 0 },
        settings: {},
    };
}
function readContext(list){
    const packed = serializeCanvasContext(snapshotOf(list));
    const payload = JSON.parse(packed.slice(packed.indexOf('{'), packed.lastIndexOf('}') + 1));
    return { packed, selected: payload.activeSelectedNodes[0] };
}
async function settle(node){
    let thrown = null;
    try {
        await api.executeCanvasAgentNodeSkill(node.id);
        const message = String(node.runError || '').trim()
            || (node.runStatus === 'failed' ? '生成失败' : '');
        if(message){
            delete node.runStatus;
            delete node.runError;
            throw new Error(message);
        }
        settleAgentStaleAfterExecution(node, true);
        api.flushCanvasAgentSave();
    } catch(err){
        thrown = err instanceof Error ? err.message : String(err);
        settleAgentStaleAfterExecution(node, false, thrown);
        api.flushCanvasAgentSave();
    }
    const disk = JSON.parse(diskBox.json);
    const saved = disk.find((item) => item.id === node.id);
    const proposal = {
        id: 'p1', title: '执行', summary: '',
        actions: [{ type: 'execute_node_skill', nodeId: node.id }],
        status: 'applied', requiresApproval: true, generative: true, createdAt: 1,
    };
    const settled = settleBatchProposal(1, 0, thrown ? { nodeId: node.id, message: thrown } : undefined);
    proposal.status = settled.status;
    if('error' in settled) proposal.error = settled.error;
    const feedback = pendingExecutionFeedback([proposal]);
    const ctx = readContext(disk);
    return { thrown, saved, settled, feedback: feedback ? feedback.content : null, ctx };
}

const cases = [
    { name: 'msgen-no-prompt', fn: 'runMsGenNode', type: 'msgen', tier: 'C', message: '请先连接提示词' },
    { name: 'msgen-no-image', fn: 'runMsGenNode', type: 'msgen', tier: 'C', message: '请先连接图片', extra: { prompt: '一张图', msgenModel: 'img' } },
    { name: 'rh-workflow-id', fn: 'runRhNode', type: 'rh', tier: 'C', message: '请先填写 RunningHub workflowId', extra: { rhMode: 'workflow', workflowId: '' } },
    { name: 'rh-webapp-id', fn: 'runRhNode', type: 'rh', tier: 'C', message: '请先填写 RunningHub webappId', extra: { rhMode: 'app', webappId: '' } },
    { name: 'rh-no-entry', fn: 'runRhNode', type: 'rh', tier: 'C', message: '请先在 API 设置里添加 RH 工作流', extra: { rhMode: 'workflow', workflowId: 'w' } },
    { name: 'rh-no-fields', fn: 'runRhNode', type: 'rh', tier: 'C', message: '请先在 API 设置里编辑并保存这个 RH 工作流参数', extra: { rhMode: 'workflow', workflowId: 'w' }, arm(g){ g.entry = { id: 'e' }; g.fields = []; } },
    { name: 'generator-youchuan', fn: 'runGenerator', type: 'generator', tier: 'C', message: '该模型需要提示词', arm(g){ g.youchuan = true; g.sources = [{ refs: [{ url: '/a.png' }] }]; } },
    { name: 'video-no-prompt', fn: 'runVideoNode', type: 'video', tier: 'C', message: '请先连接提示词' },
    { name: 'viewpoint', fn: 'runViewpointAgent', type: 'viewpointAgent', tier: 'B', message: '请用一句话描述视角意向。', fill(node){ node.intent = '门外反打视角'; } },
    { name: 'slots', fn: 'runSlotsLoopVideoAgent', type: 'slotsLoopVideoAgent', tier: 'B', message: '请通过 Image 端口连接一张 Slots 静态图。', fill(_node, g){ g.image = { url: '/slots.png' }; } },
    { name: 'mx', fn: 'runMxShellPromptAgent', type: 'mxShellPromptAgent', tier: 'B', message: '请提供故事大纲/剧本/分镜草稿（至少 10 字），或连接提示词节点。' },
    { name: 'deepWhite', fn: 'runDeepWhiteShotAgent', type: 'deepWhiteShotAgent', tier: 'B', message: '请提供场景/剧本（至少 20 字），或连接提示词节点。DeepWhite skill 要求先有场景再设计镜头。' },
    { name: 'screenwriting', fn: 'runScreenwritingAgent', type: 'screenwritingAgent', tier: 'B', message: '请提供 brief 或素材（至少 8 字）。', fill(node){ node.brief = '12345678'; } },
    { name: 'pixar', fn: 'runPixarAdScriptAgent', type: 'pixarAdScriptAgent', tier: 'B', message: '请提供至少 20 字的故事创意或剧本。' },
    { name: 'replica', fn: 'runReplicaAgent', type: 'replicaAgent', tier: 'B', message: '请连接图片节点，并在角色映射中指定「背景/构图参考」（图1）。', fill(_node, g){ g.background = { id: 'img', url: '/a.png' }; } },
    { name: 'repair', fn: 'runImageRepairAgent', type: 'imageRepairAgent', tier: 'B', message: '请连接一张待修复的图片。' },
    { name: 'nine-story', fn: 'runNineGridPhaseA', type: 'nineGridAgent', tier: 'B', message: '请输入剧本（至少 10 字）或上游连接 Prompt。', fill(node, g){ node.story = '这是一个足够长的剧本'; g.sources = [{ refs: [{ url: '/ref.png' }] }]; g.fetchShots = [{ prompt: '镜'.repeat(150) }]; }, reach: 'image' },
    { name: 'nine-refs', fn: 'runNineGridPhaseA', type: 'nineGridAgent', tier: 'B', message: '请至少连接 1 张参考图。', extra: { story: '这是一个足够长的剧本' } },
    { name: 'nine-b-refs', fn: 'runNineGridPhaseB', type: 'nineGridAgent', tier: 'B', message: '请至少连接 1 张参考图。', extra: { story: '这是一个足够长的剧本' } },
    { name: 'nine-b-shots', fn: 'runNineGridPhaseB', type: 'nineGridAgent', tier: 'B', message: '请先运行 Phase A，并确保每格描述不少于 150 字。', extra: { story: '这是一个足够长的剧本', shots: [{ prompt: '太短' }] }, arm(g){ g.sources = [{ refs: [{ url: '/ref.png' }] }]; g.fetchShots = [{ prompt: '太短' }]; }, allowReached: ['nine'] },
    { name: 'poster-image', fn: 'runBatchPosterAgent', type: 'batchPosterAgent', tier: 'B', message: '请通过 Image 端口连接一张参考海报图。' },
    { name: 'poster-theme', fn: 'runBatchPosterAgent', type: 'batchPosterAgent', tier: 'B', message: '请先填写自定义主题。', extra: { theme_source: 'custom', custom_theme: '' }, arm(g){ g.poster = { url: '/poster.png' }; } },
    { name: 'reverse-no-prompt', fn: 'runVideoReverseNode', type: 'videoReverse', tier: 'D', message: '请先连接「提示词」节点：从提示词右侧输出端口，拖到视频反推节点左侧输入端口。' },
    { name: 'reverse-empty', fn: 'runVideoReverseNode', type: 'videoReverse', tier: 'D', message: '提示词节点已连接，但内容为空。请先在提示词里写好反推要求。', edges: [{ id: 'e', from: 'p', to: 'n1' }], extras: [{ id: 'p', type: 'prompt', text: '' }] },
    { name: 'reverse-no-video', fn: 'runVideoReverseNode', type: 'videoReverse', tier: 'D', message: '请在左侧上传视频，或连接包含视频的节点。', edges: [{ id: 'e', from: 'p', to: 'n1' }], extras: [{ id: 'p', type: 'prompt', text: '分析镜头' }] },
    { name: 'generator-empty', fn: 'runGenerator', type: 'generator', tier: 'D', message: '请先连接提示词或图片' },
    { name: 'llm-missing', fn: 'runLLMNode', type: 'llm', tier: 'A', message: 'LLM 缺少提示词输入' },
];

const failures = [];
const rows = [];
for(const spec of cases){
    const humanNode = blank(spec.type, spec.extra);
    const humanExtras = spec.extras || [];
    nodes.length = 0;
    nodes.push(humanNode, ...humanExtras);
    connections.length = 0;
    for(const edge of spec.edges || []) connections.push(edge);
    alerts.length = 0;
    reached.length = 0;
    gate.sources = [];
    gate.background = null;
    gate.repair = null;
    gate.poster = null;
    gate.youchuan = false;
    gate.image = null;
    gate.entry = null;
    gate.fields = [];
    gate.fetchShots = null;
    gate.cascadeOrder = null;
    gate.workflowOrder = null;
    gate.loop = null;
    if(spec.arm) spec.arm(gate);
    let humanThrew = null;
    try { await runners[spec.fn](humanNode.id, {}); }
    catch(err){ humanThrew = err instanceof Error ? err.message : String(err); }
    const human = {
        threw: humanThrew,
        runStatus: humanNode.runStatus,
        runError: humanNode.runError || null,
        alerts: alerts.slice(),
        reached: reached.slice(),
    };

    const agentNode = blank(spec.type, spec.extra);
    reset(agentNode, spec.edges);
    if(spec.extras){
        for(const extra of spec.extras) nodes.push(extra);
    }
    if(spec.arm) spec.arm(gate);
    const agent = spec.direct
        ? await (async () => {
            let thrown = null;
            try { await runners[spec.fn](agentNode.id, {}); }
            catch(err){ thrown = err instanceof Error ? err.message : String(err); }
            api.flushCanvasAgentSave();
            return { thrown, saved: JSON.parse(diskBox.json)[0], direct: true };
        })()
        : await settle(spec.via === 'full' ? agentNode : agentNode);

    const saved = agent.saved;
    const record = {
        name: spec.name,
        tier: spec.tier,
        thrown: agent.thrown,
        runStatus: saved.runStatus,
        lifecycle: nodeLifecycle(saved),
        stale: Boolean(saved.agentStale),
        error: saved.agentLastError?.message || null,
        proposal: agent.settled?.status || (agent.direct ? 'direct' : null),
        humanStatus: human.runStatus,
        humanError: human.runError,
        humanAlerts: human.alerts,
        humanThrew: human.threw,
        reached: human.reached.concat(reached),
    };
    rows.push(record);
    const problems = [];
    if(human.threw) problems.push('human threw ' + human.threw);
    if(human.reached.length) problems.push('human reached ' + human.reached.join(','));
    if(spec.tier === 'C' || spec.tier === 'D' || spec.tier === 'A'){
        if(human.runStatus !== 'idle') problems.push('human wrote runStatus ' + human.runStatus);
        if(human.runError) problems.push('human wrote runError');
        if(spec.tier !== 'A' && human.alerts[0] !== spec.message) problems.push('human alert ' + human.alerts[0]);
        if(spec.tier === 'A' && human.alerts[0] !== '请先连接 Prompt 到 LLM') problems.push('llm human alert ' + human.alerts[0]);
    }
    if(spec.tier === 'B'){
        if(human.runStatus !== 'failed' || human.runError !== spec.message) problems.push('human status ' + human.runStatus + ' ' + human.runError);
        if(human.alerts.length) problems.push('human alerted');
    }
    if(agent.thrown !== spec.message) problems.push('thrown ' + agent.thrown);
    if(saved.runStatus === 'failed') problems.push('agent wrote runStatus failed');
    if(saved.runError) problems.push('agent wrote runError');
    if(saved.agentLastError?.message !== spec.message) problems.push('disk error ' + saved.agentLastError?.message);
    if(!saved.agentStale) problems.push('stale cleared');
    if(nodeLifecycle(saved) !== 'created') problems.push('lifecycle ' + nodeLifecycle(saved));
    if(agent.settled?.status !== 'exec_failed') problems.push('proposal ' + agent.settled?.status);
    if(agent.settled?.status === 'applied' && nodeLifecycle(saved) === 'discarded') problems.push('applied + discarded');
    if(!agent.ctx?.packed.includes(spec.message)) problems.push('context missing message');
    if(agent.ctx?.packed.includes('上次的错误')) problems.push('old error survived');
    if(!agent.ctx?.selected?.stale) problems.push('context stale missing');
    const leaked = reached.filter((name) => !(spec.allowReached || []).includes(name));
    if(leaked.length) problems.push('reached ' + leaked.join(','));
    if(problems.length) failures.push({ name: spec.name, problems, record });
}

async function recover(name, spec){
    const node = blank(spec.type, spec.extra);
    reset(node, spec.edges);
    if(spec.arm) spec.arm(gate);
    const first = await settle(node);
    let retryBlocked = null;
    try { assertAgentCanExecute(snapshotOf([first.saved]), 'n1'); }
    catch(err){ retryBlocked = err instanceof Error ? err.message : String(err); }
    if(spec.fill) spec.fill(node, gate);
    let second = null;
    let secondBlocked = null;
    try { assertAgentCanExecute(snapshotOf([node]), 'n1'); }
    catch(err){ secondBlocked = err instanceof Error ? err.message : String(err); }
    if(!secondBlocked){
        try { await api.executeCanvasAgentNodeSkill(node.id); second = 'resolved'; }
        catch(err){ second = err instanceof Error ? err.message : String(err); }
    }
    const problems = [];
    if(first.thrown !== spec.message) problems.push('first ' + first.thrown);
    if(nodeLifecycle(first.saved) !== 'created') problems.push('lifecycle ' + nodeLifecycle(first.saved));
    if(retryBlocked) problems.push('blocked before fill ' + retryBlocked);
    if(secondBlocked) problems.push('blocked after fill ' + secondBlocked);
    if(String(second).includes('不能在原节点重试')) problems.push('retry banned');
    if(spec.reach){
        if(!reached.includes(spec.reach)) problems.push('did not reach ' + spec.reach + ' second=' + second);
    } else if(second !== 'REACHED_RUN') problems.push('second ' + second);
    return { name, problems, first: first.thrown, lifecycle: nodeLifecycle(first.saved), second, secondBlocked };
}

const recoveries = [];
for(const spec of cases.filter((item) => item.fill)){
    recoveries.push(await recover(spec.name, spec));
}

const modelSource = [
    sliceFn('function imageProviderIsListed(raw){'),
    sliceFn('function chatProviderIsListed(raw){'),
    sliceFn('function canvasAgentModelRejectMessage(node, kind, forAgent){'),
    sliceFn('function rejectCanvasAgentModelChoice(node, kind, opts){'),
].join('\n');
const modelHarness = new Function('alerts', `
function imageApiProviders(){ return [{ id: 'comfly' }]; }
function chatApiProviders(){ return [{ id: 'comfly' }]; }
function legacyImageProviderId(value){ return value; }
function resolveImageProviderId(id){ return id || 'runninghub'; }
function resolveChatProviderId(id){ return id || 'comfly'; }
function providerImageModels(){ return ['nano-banana-pro']; }
function providerChatModels(){ return ['gpt-4o-mini']; }
function resolveImageModel(model){ return model; }
function resolveChatModel(model){ return model; }
function softAlert(message){ alerts.push(String(message)); }
${modelSource}
return { rejectCanvasAgentModelChoice };
`)(alerts);
alerts.length = 0;
const bad = { type: 'generator', apiProvider: 'nope', model: 'nope', runStatus: 'idle' };
let modelThrew = null;
try { modelHarness.rejectCanvasAgentModelChoice(bad, 'image', { cascade: true, agent: true }); }
catch(err){ modelThrew = err instanceof Error ? err.message : String(err); }
const modelCascade = { threw: modelThrew, runStatus: bad.runStatus, alerts: alerts.slice() };
alerts.length = 0;
let modelHuman = null;
try { modelHuman = modelHarness.rejectCanvasAgentModelChoice(bad, 'image', {}); }
catch(err){ modelHuman = err instanceof Error ? err.message : String(err); }
const modelHumanRow = { returned: modelHuman, runStatus: bad.runStatus, alerts: alerts.slice() };
alerts.length = 0;
const good = { type: 'generator', apiProvider: 'comfly', model: 'nano-banana-pro', runStatus: 'idle' };
let goodThrew = null;
let goodReturned = null;
try { goodReturned = modelHarness.rejectCanvasAgentModelChoice(good, 'image', { cascade: true, agent: true }); }
catch(err){ goodThrew = err instanceof Error ? err.message : String(err); }

function fresh(type, extra){
    const node = blank(type, extra);
    reset(node);
    return node;
}
async function buttonOnce(label, run){
    const node = fresh('nineGridAgent');
    let threw = null;
    try { await run(node); }
    catch(err){ threw = err instanceof Error ? err.message : String(err); }
    const problems = [];
    if(threw) problems.push('threw ' + threw);
    if(node.runStatus !== 'failed') problems.push('status ' + node.runStatus);
    if(!node.runError) problems.push('no runError');
    if(alerts.length) problems.push('softAlert ' + alerts.join('|'));
    if(reached.length) problems.push('reached ' + reached.join(','));
    if(problems.length) failures.push({ name: label, problems, record: { runStatus: node.runStatus, runError: node.runError, alerts: alerts.slice() } });
}
await buttonOnce('button-phase-a', (node) => api.runNineGridPhaseA(node.id));
await buttonOnce('button-phase-b', (node) => api.runNineGridPhaseB(node.id));
await buttonOnce('button-full', (node) => api.runNineGridFull(node.id));

const cropNode = fresh('nineGridAgent');
let cropThrew = null;
try { await api.runNineGridCrop(cropNode.id); await api.runNineGridCellEdit(cropNode.id, 0); }
catch(err){ cropThrew = err instanceof Error ? err.message : String(err); }
if(cropThrew) failures.push({ name: 'crop-cell', problems: [cropThrew] });

async function passStops(name, mid){
    const pre = { id: 'pre', type: 'image', runStatus: '' };
    const post = { id: 'post', type: 'image', runStatus: '' };
    nodes.length = 0;
    nodes.push(pre, mid, post);
    connections.length = 0;
    alerts.length = 0;
    reached.length = 0;
    gate.sources = [];
    gate.background = null;
    gate.repair = null;
    gate.poster = null;
    gate.youchuan = false;
    gate.image = null;
    gate.entry = null;
    gate.fields = [];
    gate.fetchShots = null;
    gate.loop = null;
    let threw = null;
    try { await api.runOneCascadePass(['pre', mid.id, 'post']); }
    catch(err){ threw = err instanceof Error ? err.message : String(err); }
    const problems = [];
    if(!threw) problems.push('did not stop');
    if(pre.runStatus !== 'done') problems.push('pre ' + pre.runStatus);
    if(post.runStatus === 'done') problems.push('post continued');
    if(mid.runStatus !== 'failed') problems.push('mid ' + mid.runStatus);
    if(problems.length) failures.push({ name, problems, record: { threw, pre: pre.runStatus, mid: mid.runStatus, post: post.runStatus, midError: mid.runError } });
}
await passStops('pass-c-stops', { id: 'vid', type: 'video', runStatus: '', prompt: '' });
await passStops('pass-b-stops', blank('replicaAgent'));

const cascadeNine = fresh('nineGridAgent');
const before = { id: 'pre', type: 'image', runStatus: '' };
const after = { id: 'post', type: 'image', runStatus: '' };
nodes.length = 0;
nodes.push(before, cascadeNine, after);
gate.cascadeOrder = ['pre', cascadeNine.id, 'post'];
alerts.length = 0;
let cascadeThrew = null;
try { await api.runNodeCascade(cascadeNine.id); }
catch(err){ cascadeThrew = err instanceof Error ? err.message : String(err); }
if(cascadeThrew || cascadeNine.runStatus !== 'failed' || after.runStatus === 'done' || !alerts.some((item) => item.startsWith('MODAL:'))){
    failures.push({ name: 'human-cascade-nine', problems: ['stop/modal'], record: { cascadeThrew, nine: cascadeNine.runStatus, nineError: cascadeNine.runError, after: after.runStatus, before: before.runStatus, alerts: alerts.slice() } });
}

const singleReplica = fresh('replicaAgent');
gate.workflowOrder = [singleReplica.id];
let singleThrew = null;
try { await api.runCanvasGenerate(singleReplica.id); }
catch(err){ singleThrew = err instanceof Error ? err.message : String(err); }
if(singleThrew || singleReplica.runStatus !== 'failed') failures.push({ name: 'single-generate-b', problems: ['threw or no bar'], record: { singleThrew, runStatus: singleReplica.runStatus, runError: singleReplica.runError } });

const retryVideo = fresh('video');
let retryThrew = null;
try { await api.rerunFailedNode(retryVideo.id); }
catch(err){ retryThrew = err instanceof Error ? err.message : String(err); }
if(retryThrew || retryVideo.runStatus === 'failed') failures.push({ name: 'rerun-c', problems: ['threw or wrote bar'], record: { retryThrew, runStatus: retryVideo.runStatus, alerts: alerts.slice() } });

const retryReplica = fresh('replicaAgent');
let retryBThrew = null;
try { await api.rerunFailedNode(retryReplica.id); }
catch(err){ retryBThrew = err instanceof Error ? err.message : String(err); }
if(retryBThrew || retryReplica.runStatus !== 'failed' || !retryReplica.runError) failures.push({ name: 'rerun-b', problems: ['bar missing'], record: { retryBThrew, runStatus: retryReplica.runStatus, runError: retryReplica.runError } });

function problemsOf(name, problems, record){
    if(problems.length) failures.push({ name, problems, record });
}
function armPrompt(){
    gate.sources = [{ prompt: '一只猫站在窗边' }];
    gate.allowSingle = true;
}
async function expectSuccess(name, node){
    const result = await settle(node);
    const problems = [];
    if(result.thrown) problems.push('thrown ' + result.thrown);
    if(result.settled.status !== 'applied') problems.push('proposal ' + result.settled.status);
    if(result.saved.agentStale) problems.push('stale kept');
    if(result.saved.agentLastError) problems.push('last error kept');
    if(result.saved.runStatus === 'failed' || String(result.saved.runError || '').trim()) problems.push('failure mark left');
    problemsOf(name, problems, { thrown: result.thrown, status: result.saved.runStatus, proposal: result.settled.status });
    return result;
}
async function expectFail(name, node, message){
    const result = await settle(node);
    let blocked = null;
    try { assertAgentCanExecute(snapshotOf([result.saved]), node.id); }
    catch(err){ blocked = err instanceof Error ? err.message : String(err); }
    const problems = [];
    if(result.thrown !== message) problems.push('thrown ' + result.thrown);
    if(result.saved.runStatus === 'failed' || String(result.saved.runError || '').trim()) problems.push('run mark left');
    if(result.saved.agentLastError?.message !== message) problems.push('disk ' + result.saved.agentLastError?.message);
    if(!result.ctx?.packed.includes(message)) problems.push('context missing');
    if(!result.saved.agentStale) problems.push('stale cleared');
    if(result.settled.status !== 'exec_failed') problems.push('proposal ' + result.settled.status);
    if(nodeLifecycle(result.saved) !== 'created') problems.push('lifecycle ' + nodeLifecycle(result.saved));
    if(blocked) problems.push('retry banned ' + blocked);
    problemsOf(name, problems, { thrown: result.thrown, lifecycle: nodeLifecycle(result.saved), proposal: result.settled.status });
    return result;
}

const repairNode = fresh('imageRepairAgent');
gate.repair = { url: '/broken.png' };
gate.repairRun = true;
gate.repairFail = '修图轮询失败';
const repairResult = await expectFail('repair-poll-d3', repairNode, '修图轮询失败');
if(repairNode.running) failures.push({ name: 'repair-poll-d3', problems: ['running left'] });
if(repairResult.settled.status === 'applied' && nodeLifecycle(repairResult.saved) === 'discarded'){
    failures.push({ name: 'repair-poll-d3', problems: ['applied + discarded'] });
}

const imageNode = fresh('generator');
armPrompt();
gate.imageOk = true;
await expectSuccess('success-image', imageNode);

const seeded = fresh('generator', { runStatus: 'failed', runError: '' });
armPrompt();
gate.imageOk = true;
const seededResult = await expectSuccess('seed-failed-then-done', seeded);
if(seededResult.saved.runStatus !== 'done') failures.push({ name: 'seed-failed-then-done', problems: ['status ' + seededResult.saved.runStatus] });

const videoNode = fresh('video');
armPrompt();
gate.videoOk = true;
await expectSuccess('success-video', videoNode);

const replicaNode = fresh('replicaAgent');
gate.background = { id: 'img', url: '/a.png' };
gate.replicaRun = true;
await expectSuccess('success-replica', replicaNode);

const posterNode = fresh('batchPosterAgent', { batch_count: 1 });
gate.poster = { url: '/poster.png' };
await expectSuccess('success-poster', posterNode);

const busy = 'RunningHub 任务失败 [1011]：The service is currently busy. Please try again later. | 当前服务繁忙，请稍后重试';
const genFail = fresh('generator');
armPrompt();
gate.genFail = busy;
await expectFail('generator-1011', genFail, busy);
gate.genFail = '';
gate.imageOk = true;
reached.length = 0;
let genRetryBlocked = null;
try { assertAgentCanExecute(snapshotOf([genFail]), genFail.id); }
catch(err){ genRetryBlocked = err instanceof Error ? err.message : String(err); }
const genRetry = await settle(genFail);
if(genRetryBlocked || genRetry.thrown || !reached.includes('image')){
    failures.push({ name: 'generator-1011-retry', problems: ['did not re-enter'], record: { genRetryBlocked, thrown: genRetry.thrown, reached: reached.slice() } });
}

const videoFail = fresh('video');
armPrompt();
gate.videoFail = '视频轮询失败';
await expectFail('video-poll-d2', videoFail, '视频轮询失败');
const humanVideo = fresh('video');
armPrompt();
gate.videoFail = '视频轮询失败';
let humanVideoThrew = null;
try { await api.runVideoNode(humanVideo.id, {}); }
catch(err){ humanVideoThrew = err instanceof Error ? err.message : String(err); }
if(humanVideoThrew || humanVideo.runStatus !== 'failed' || humanVideo.runError !== '视频轮询失败'){
    failures.push({ name: 'human-video-poll', problems: ['bar missing'], record: { humanVideoThrew, runStatus: humanVideo.runStatus, runError: humanVideo.runError } });
}

const humanGen = fresh('generator');
armPrompt();
gate.genFail = busy;
let humanGenThrew = null;
try { await api.runGenerator(humanGen.id, {}); }
catch(err){ humanGenThrew = err instanceof Error ? err.message : String(err); }
if(humanGenThrew || humanGen.runStatus !== 'failed' || humanGen.runError !== busy){
    failures.push({ name: 'human-generator-poll', problems: ['bar missing'], record: { humanGenThrew, runStatus: humanGen.runStatus, runError: humanGen.runError } });
}

const humanReplica = fresh('replicaAgent');
gate.background = { id: 'img', url: '/a.png' };
gate.replicaFail = '复刻轮询失败';
let humanReplicaThrew = null;
try { await api.runReplicaAgent(humanReplica.id, {}); }
catch(err){ humanReplicaThrew = err instanceof Error ? err.message : String(err); }
if(humanReplicaThrew || humanReplica.runStatus !== 'failed' || humanReplica.runError !== '复刻轮询失败'){
    failures.push({ name: 'human-replica-poll', problems: ['bar missing'], record: { humanReplicaThrew, runStatus: humanReplica.runStatus, runError: humanReplica.runError } });
}

const phaseA = fresh('nineGridAgent', { story: '这是一个足够长的剧本' });
gate.sources = [{ refs: [{ url: '/ref.png' }] }];
const phaseAResult = await expectFail('nine-phase-a-d3', phaseA, 'REACHED_RUN');
if(phaseA.running) failures.push({ name: 'nine-phase-a-d3', problems: ['running left'] });
gate.fetchShots = null;
reached.length = 0;
let phaseARetryBlocked = null;
try { assertAgentCanExecute(snapshotOf([phaseAResult.saved]), phaseA.id); }
catch(err){ phaseARetryBlocked = err instanceof Error ? err.message : String(err); }
let phaseASecond = null;
try { await api.executeCanvasAgentNodeSkill(phaseA.id); phaseASecond = 'resolved'; }
catch(err){ phaseASecond = err instanceof Error ? err.message : String(err); }
if(phaseARetryBlocked || !reached.includes('nine') || String(phaseASecond).includes('不能在原节点重试')){
    failures.push({ name: 'nine-phase-a-retry', problems: ['did not re-enter'], record: { phaseARetryBlocked, phaseASecond, reached: reached.slice() } });
}

const humanPhaseA = fresh('nineGridAgent', { story: '这是一个足够长的剧本' });
gate.sources = [{ refs: [{ url: '/ref.png' }] }];
gate.fetchShots = null;
let humanPhaseAThrew = null;
try { await api.runNineGridPhaseA(humanPhaseA.id, {}); }
catch(err){ humanPhaseAThrew = err instanceof Error ? err.message : String(err); }
if(humanPhaseAThrew || humanPhaseA.runStatus !== 'failed' || !humanPhaseA.runError){
    failures.push({ name: 'human-phase-a', problems: ['bar missing'], record: { humanPhaseAThrew, runStatus: humanPhaseA.runStatus, runError: humanPhaseA.runError } });
}

const phaseB = fresh('nineGridAgent', { story: '这是一个足够长的剧本' });
gate.sources = [{ refs: [{ url: '/ref.png' }] }];
gate.fetchShots = [{ prompt: '镜'.repeat(150) }];
gate.imageOk = false;
gate.genFail = '';
await expectFail('nine-phase-b-d3', phaseB, 'REACHED_RUN');
if(phaseB.running) failures.push({ name: 'nine-phase-b-d3', problems: ['running left'] });

const fullNode = fresh('nineGridAgent', { story: '这是一个足够长的剧本' });
gate.sources = [{ refs: [{ url: '/ref.png' }] }];
gate.fetchShots = null;
reached.length = 0;
let fullThrew = null;
try { await api.runNineGridFull(fullNode.id, { cascade: true, agent: true }); fullThrew = 'resolved'; }
catch(err){ fullThrew = err instanceof Error ? err.message : String(err); }
if(fullThrew !== 'REACHED_RUN' || reached.includes('image') || fullNode.running){
    failures.push({ name: 'nine-full-phase-a-throw', problems: ['full continued or running'], record: { fullThrew, reached: reached.slice(), running: fullNode.running } });
}

const posterFail = fresh('batchPosterAgent', { batch_count: 1 });
gate.poster = { url: '/poster.png' };
gate.posterFail = '海报图失败';
await expectFail('poster-zero-d3', posterFail, '海报图失败');
const humanPoster = fresh('batchPosterAgent', { batch_count: 1 });
gate.poster = { url: '/poster.png' };
gate.posterFail = '海报图失败';
let humanPosterThrew = null;
try { await api.runBatchPosterAgent(humanPoster.id, {}); await new Promise((resolve) => setTimeout(resolve, 0)); }
catch(err){ humanPosterThrew = err instanceof Error ? err.message : String(err); }
if(humanPosterThrew || humanPoster.runStatus !== 'failed' || humanPoster.runError !== '海报图失败'){
    failures.push({ name: 'human-poster', problems: ['bar missing or threw'], record: { humanPosterThrew, runStatus: humanPoster.runStatus, runError: humanPoster.runError } });
}

const textFail = fresh('viewpointAgent', { intent: '门外反打视角' });
gate.llmFail = '视角生成失败';
await expectFail('viewpoint-d2', textFail, '视角生成失败');
reached.length = 0;
let textBlocked = null;
try { assertAgentCanExecute(snapshotOf([textFail]), textFail.id); }
catch(err){ textBlocked = err instanceof Error ? err.message : String(err); }
let textSecond = null;
try { await api.executeCanvasAgentNodeSkill(textFail.id); textSecond = 'resolved'; }
catch(err){ textSecond = err instanceof Error ? err.message : String(err); }
if(textBlocked || !reached.includes('api') || String(textSecond).includes('不能在原节点重试')){
    failures.push({ name: 'viewpoint-d2-retry', problems: ['did not re-enter'], record: { textBlocked, textSecond, reached: reached.slice() } });
}
const humanText = fresh('viewpointAgent', { intent: '门外反打视角' });
gate.llmFail = '视角生成失败';
let humanTextThrew = null;
try { await api.runViewpointAgent(humanText.id, {}); await new Promise((resolve) => setTimeout(resolve, 0)); }
catch(err){ humanTextThrew = err instanceof Error ? err.message : String(err); }
if(humanTextThrew || humanText.runStatus !== 'failed' || humanText.runError !== '视角生成失败'){
    failures.push({ name: 'human-viewpoint', problems: ['bar missing or threw'], record: { humanTextThrew, runStatus: humanText.runStatus, runError: humanText.runError } });
}

const helperNames = [
    'function syncAgentRunStatusAfterTask(gen, {completed=false, failed=false, error=\'\'}={}){',
    'function failCanvasVideoTask(taskId, message){',
    'function failRunningHubTask(taskId, message){',
    'function failCanvasImageTask(taskId, message){',
];
for(const start of helperNames){
    const body = sliceFn(start);
    const problems = [];
    if(!body.includes('failed')) problems.push('lost failed write');
    if(body.includes('cascade')) problems.push('cascade added to helper');
    problemsOf('helper-' + start.slice(9, 28), problems, {});
}
const helperHarness = new Function('nodes', `
function agentPendingCount(){ return 0; }
${sliceFn('function syncAgentRunStatusAfterTask(gen, {completed=false, failed=false, error=\'\'}={}){')}
return { syncAgentRunStatusAfterTask };
`)(nodes);
const helperNode = { id: 'h', runStatus: 'idle', runError: '' };
helperHarness.syncAgentRunStatusAfterTask(helperNode, { failed: true, error: '人类失败条' });
if(helperNode.runStatus !== 'failed' || helperNode.runError !== '人类失败条'){
    failures.push({ name: 'helper-human-bar', problems: ['bar missing'], record: helperNode });
}

const facade = fs.readFileSync('src/features/canvas-agent/core/canvasFacade.ts', 'utf8');
if(!facade.includes("|| (node.runStatus === 'failed' ? '生成失败' : '')") || !facade.includes('executeAndSettle 只有 Agent 路径进')){
    failures.push({ name: 'facade-gate', problems: ['gate text drifted'] });
}

const recoverFails = recoveries.filter((item) => item.problems.length);
if(!modelCascade.threw || modelCascade.runStatus !== 'idle' || modelCascade.alerts.length) failures.push({ name: 'model-cascade', problems: ['changed'], record: modelCascade });
if(modelHumanRow.returned !== true || modelHumanRow.runStatus !== 'idle' || modelHumanRow.alerts.length !== 1) failures.push({ name: 'model-human', problems: ['changed'], record: modelHumanRow });
if(goodReturned !== false || goodThrew) failures.push({ name: 'model-ok', problems: ['changed'], record: { goodReturned, goodThrew } });
if(failures.length || recoverFails.length){
    console.log(JSON.stringify({ failures, recoverFails }, null, 2));
    process.exit(1);
}
console.log('precondition stub: ok');
