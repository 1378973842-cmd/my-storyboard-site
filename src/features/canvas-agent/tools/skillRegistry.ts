import type { AIToolDefinition, CanvasAction, JsonSchema } from '../types';
import { AGENT_CREATABLE_NODE_TYPES } from '../types';

export type CanvasSkillDefinition = {
  id: string;
  name: string;
  description: string;
  nodeTypes: string[];
  inputSchema: JsonSchema;
  endpoint?: string;
};

const objectSchema = (
  properties: Record<string, JsonSchema>,
  required: string[] = [],
): JsonSchema => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

export const canvasSkillRegistry: CanvasSkillDefinition[] = [
  {
    id: 'mx-shell-prompt',
    name: 'Mx Shell Prompt Director',
    description: '把故事意图转换为一镜到底或多机位视频提示词，并保持运镜节拍。',
    nodeTypes: ['mxShellPromptAgent', 'mxShellPolishAgent'],
    endpoint: '/api/canvas/mx-shell-prompt',
    inputSchema: objectSchema({ nodeId: { type: 'string' } }, ['nodeId']),
  },
  {
    id: 'deepwhite-shot',
    name: 'DeepWhite Shot Designer',
    description: '生成电影化镜头设计、构图、运镜和静帧提示词。',
    nodeTypes: ['deepWhiteShotAgent'],
    endpoint: '/api/canvas/deepwhite-shot',
    inputSchema: objectSchema({ nodeId: { type: 'string' } }, ['nodeId']),
  },
  {
    id: 'screenwriting',
    name: 'Screenwriting Agent',
    description: '把创意发展为结构化剧本，供后续分镜节点使用。',
    nodeTypes: ['screenwritingAgent'],
    endpoint: '/api/canvas/screenwriting',
    inputSchema: objectSchema({ nodeId: { type: 'string' } }, ['nodeId']),
  },
  {
    id: 'story-animation',
    name: 'Story Animation Director',
    description: '生成故事动画脚本、资产约束、镜头表和声音配置。',
    nodeTypes: ['pixarAdScriptAgent'],
    endpoint: '/api/canvas/story-anim-script',
    inputSchema: objectSchema({ nodeId: { type: 'string' } }, ['nodeId']),
  },
  {
    id: 'nine-grid',
    name: 'Nine Grid Storyboard',
    description: '把剧本拆成九宫格静帧提示词并生成一致的分镜大图。',
    nodeTypes: ['nineGridAgent'],
    endpoint: '/api/generate-9grid',
    inputSchema: objectSchema({ nodeId: { type: 'string' } }, ['nodeId']),
  },
  {
    id: 'viewpoint',
    name: 'Viewpoint Agent',
    description: '分析空间关系并生成可执行的新机位英文提示词。',
    nodeTypes: ['viewpointAgent'],
    endpoint: '/api/canvas/viewpoint-agent',
    inputSchema: objectSchema({ nodeId: { type: 'string' } }, ['nodeId']),
  },
  {
    id: 'slots-loop-video',
    name: 'Slots Loop Video Agent',
    description: '设计首尾衔接的循环视频提示词。',
    nodeTypes: ['slotsLoopVideoAgent'],
    endpoint: '/api/canvas/slots-loop-video-prompt',
    inputSchema: objectSchema({ nodeId: { type: 'string' } }, ['nodeId']),
  },
  {
    id: 'batch-poster',
    name: 'Batch Poster Agent',
    description: '批量构思海报主题并生成统一视觉系列。',
    nodeTypes: ['batchPosterAgent'],
    endpoint: '/api/canvas/batch-poster-brainstorm',
    inputSchema: objectSchema({ nodeId: { type: 'string' } }, ['nodeId']),
  },
  {
    id: 'replica',
    name: 'Replica Agent',
    description: '参考输入媒体复刻视觉构图与风格。',
    nodeTypes: ['replicaAgent'],
    endpoint: '/api/canvas/replica-agent-run',
    inputSchema: objectSchema({ nodeId: { type: 'string' } }, ['nodeId']),
  },
  {
    id: 'image-repair',
    name: 'Image Repair Agent',
    description: '按要求修复输入图像。',
    nodeTypes: ['imageRepairAgent'],
    endpoint: '/api/canvas/image-repair-agent-run',
    inputSchema: objectSchema({ nodeId: { type: 'string' } }, ['nodeId']),
  },
];

export function convertSkillToAITool(skill: CanvasSkillDefinition): AIToolDefinition {
  return {
    type: 'function',
    function: {
      name: `run_${skill.id.replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '')}`,
      description: skill.description,
      parameters: skill.inputSchema,
    },
  };
}

const nodeRef = {
  type: 'string',
  description: 'Existing node ID or a tempId created in the same proposal.',
} satisfies JsonSchema;

// 工具描述里的键名从这两份集合拼出来。改描述字符串不会改允许名单。
const LISTED_PARAM_KEYS = [
  'prompt', 'text', 'story',
  'apiProvider', 'model', 'ratio', 'resolution', 'customRatio', 'customSize', 'quality', 'count',
  'mjChaos', 'mjQuality', 'mjStylize', 'mjRaw', 'mjHd', 'mjIw', 'mjSw', 'mjSv', 'mjWeird',
  'duration', 'aspectRatio', 'enhancePrompt', 'enableUpsample', 'watermark', 'cameraFixed',
  'generateAudio', 'realPersonMode', 'useFrameRoles', 'fidelity',
  'llmProvider', 'systemPrompt', 'chatInput',
] as const;

// story：九宫格 Phase A 读这个字段。不在名单里时，提案写它会整批被拒。
// replacesNodeId：只在 create_node 的 initialParams 上读（operatingModel.ts applyRebuildGuards）。
// url：上下文要求 image 节点把地址放进 initialParams.url。
// name、title：ProposalPreviewCard 用它们当卡片标题。
// reason：模型对自己选择的说明。创建和更新都收，否则解释会把整批打回。
// 只在提案卡片上展示，不参与 @ 闸门，也不写入节点。
export const CREATE_PARAM_KEYS = [...LISTED_PARAM_KEYS, 'replacesNodeId', 'url', 'name', 'title', 'reason'] as const;

// 更新同样收 url、name、title、reason。不收 replacesNodeId：替换只认创建时的 initialParams。
export const UPDATE_PARAM_KEYS = [...LISTED_PARAM_KEYS, 'url', 'name', 'title', 'reason'] as const;

const CREATE_PARAM_KEY_SET = new Set<string>(CREATE_PARAM_KEYS);
const UPDATE_PARAM_KEY_SET = new Set<string>(UPDATE_PARAM_KEYS);

const CREATE_NODES_LEAD = 'Propose one or more workflow nodes. Use stable tempId values so later tools can connect them. Video nodes sourced from dialogue must carry strict fidelity metadata; never invent measured speech duration. Node type selection: use "generator" for text-to-image, "video" for text-to-video, "prompt" for text content. "image" is a static display node for existing images — it cannot be executed. Do not propose execution for image nodes.';
const CREATE_NODES_TAIL = '不填 model 时使用该 provider 的默认模型。同一批新建的节点如果不指定 model，会全部落到同一个默认值。可选值见上下文的 availableModels。';

export function describeCreateCanvasNodes(keys: readonly string[]): string {
  return `${CREATE_NODES_LEAD} Accepted initialParams keys: ${keys.join(', ')}. ${CREATE_NODES_TAIL}`;
}

export function describeUpdateNodeConfig(keys: readonly string[]): string {
  return `Propose safe configuration changes such as prompts, models, ratios or camera movement. Accepted patch keys: ${keys.join(', ')}.`;
}

export function rejectUnknownCanvasParamKeys(actions: CanvasAction[]): void {
  const problems: string[] = [];
  for (const action of actions) {
    if (action.type === 'create_node') {
      const bad = Object.keys(action.initialParams || {}).filter((key) => !CREATE_PARAM_KEY_SET.has(key));
      if (bad.length) {
        problems.push(`create_canvas_nodes 的 initialParams 里有未知键：${bad.join('、')}。参数键直接放顶层，不要包一层。可用键：${CREATE_PARAM_KEYS.join('、')}。`);
      }
    } else if (action.type === 'update_node_params') {
      const bad = Object.keys(action.patch || {}).filter((key) => !UPDATE_PARAM_KEY_SET.has(key));
      if (bad.length) {
        problems.push(`update_node_config 的 patch 里有未知键：${bad.join('、')}。参数键直接放顶层，不要包一层。可用键：${UPDATE_PARAM_KEYS.join('、')}。`);
      }
    }
  }
  if (problems.length) throw new Error(problems.join('\n'));
}

export const coreCanvasTools: AIToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'create_canvas_nodes',
      description: describeCreateCanvasNodes(CREATE_PARAM_KEYS),
      parameters: objectSchema(
        {
          nodes: {
            type: 'array',
            items: objectSchema(
              {
                tempId: { type: 'string' },
                nodeType: { type: 'string', enum: [...AGENT_CREATABLE_NODE_TYPES] },
                initialParams: { type: 'object', additionalProperties: true },
                position: objectSchema(
                  { x: { type: 'number' }, y: { type: 'number' } },
                  ['x', 'y'],
                ),
              },
              ['tempId', 'nodeType'],
            ),
          },
          rationale: { type: 'string' },
        },
        ['nodes'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'connect_workflow_edges',
      description: 'Propose directed workflow connections from source outputs to target inputs.',
      parameters: objectSchema(
        {
          edges: {
            type: 'array',
            items: objectSchema(
              { sourceNodeId: nodeRef, targetNodeId: nodeRef },
              ['sourceNodeId', 'targetNodeId'],
            ),
          },
        },
        ['edges'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_node_config',
      description: describeUpdateNodeConfig(UPDATE_PARAM_KEYS),
      parameters: objectSchema(
        {
          updates: {
            type: 'array',
            items: objectSchema(
              {
                nodeId: nodeRef,
                patch: { type: 'object', additionalProperties: true },
              },
              ['nodeId', 'patch'],
            ),
          },
        },
        ['updates'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'ask_user',
      description: 'Ask with one card per question, same order. Do not also write the question in chat text. Each card needs type text choices and one type input. Do not use this to approve a run.',
      parameters: objectSchema(
        {
          cards: {
            type: 'array',
            items: objectSchema(
              {
                mode: { type: 'string', enum: ['single', 'multiple'] },
                question: { type: 'string' },
                options: {
                  type: 'array',
                  items: objectSchema(
                    {
                      type: { type: 'string', enum: ['text', 'input'] },
                      label: { type: 'string' },
                      placeholder: { type: 'string' },
                    },
                    ['type'],
                  ),
                },
                node_key: { type: 'string' },
              },
              ['mode', 'question', 'options'],
            ),
          },
        },
        ['cards'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'remember_project_fact',
      description:
        'Persist a project fact or user preference that must survive this conversation '
        + '(character identity, locked style, default duration/model, recurring constraints). '
        + 'Do not store transient canvas state, node ids, or anything the canvas already shows.',
      parameters: objectSchema(
        {
          kind: { type: 'string', enum: ['fact', 'preference'] },
          key: { type: 'string' },
          value: { type: 'string' },
        },
        ['kind', 'key', 'value'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'confirm_character_anchor',
      description:
        'Mark a confirmed character anchor before storyboarding. '
        + 'Use kind=reference when the user cited an existing reference image, '
        + 'kind=three-view after the user approves a generated three-view node. '
        + 'role=opponent marks the opponent anchor instead of the protagonist; '
        + 'role=scene marks the scene reference. '
        + 'When the user provides a reference, assess it first: pass quality="good" if it is clear and shows enough detail/angles, '
        + 'quality="low" if it is blurry, cropped or missing views; low quality forces a three-view regeneration. '
        + 'After checking a generated three-view for style/proportion consistency, pass review="ok"; if it must be redrawn, pass review="rework".',
      parameters: objectSchema(
        {
          kind: { type: 'string', enum: ['reference', 'three-view'] },
          nodeId: { type: 'string' },
          role: { type: 'string', enum: ['protagonist', 'opponent', 'scene'] },
          quality: { type: 'string', enum: ['good', 'low'] },
          review: { type: 'string', enum: ['ok', 'rework'] },
        },
        ['kind'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'start_production_task',
      description:
        'Create the production task ledger before building nodes. Use when the work needs multiple generations with consistent characters/scenes or production assets (draft, anchors, storyboard). Do not use for a direct one-shot edit.',
      parameters: objectSchema(
        {
          title: { type: 'string' },
          goal: { type: 'string' },
          skill: { type: 'string' },
        },
        ['title'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_task_artifact',
      description:
        'Write a production artifact to the task ledger file (draft/index/anchors/storyboard). This is the authoritative source, not chat. Use append to stay within the 8192-token output budget; the 200,000-character file cap is unrelated. Optionally advance the storyboard cursor with the last 12 characters already registered.',
      parameters: objectSchema(
        {
          kind: { type: 'string', enum: ['draft', 'index', 'anchors', 'storyboard'] },
          content: { type: 'string' },
          append: { type: 'boolean' },
          cursor_last_line: { type: 'string' },
          cursor_registered: { type: 'number' },
        },
        ['kind', 'content'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'complete_task_step',
      description:
        'Mark one production todo as done after its artifact has been written and checked. The next unchecked todo becomes the current position.',
      parameters: objectSchema(
        {
          step: {
            type: 'string',
            enum: ['draft', 'anchors', 'storyboard', 'review', 'anchor_runs', 'storyboard_runs', 'compose'],
          },
        },
        ['step'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_task_artifact',
      description:
        'Read a production artifact from the task ledger file (draft/index/anchors/storyboard). Supports offset+length for long files; returns total/truncated/nextOffset. Call this alone (not together with write/complete). Read the file instead of relying on memory.',
      parameters: objectSchema(
        {
          kind: { type: 'string', enum: ['draft', 'index', 'anchors', 'storyboard'] },
          offset: { type: 'number' },
          length: { type: 'number' },
        },
        ['kind'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_skill_file',
      description:
        'Read one knowledge file of the current skill in full (no paging). Use when you need detail the auto-selected knowledge did not include. Pass a file path or basename from the load table; unknown files return the legal list.',
      parameters: objectSchema(
        {
          file: { type: 'string' },
        },
        ['file'],
      ),
    },
  },
  {
    type: 'function',
    function: {
      name: 'trigger_skill_execution',
      description:
        'Propose running existing node skills. Generation always requires explicit user approval.',
      parameters: objectSchema(
        {
          nodeIds: { type: 'array', items: nodeRef },
        },
        ['nodeIds'],
      ),
    },
  },
];

export const allCanvasAITools: AIToolDefinition[] = [
  ...coreCanvasTools,
  ...canvasSkillRegistry.map(convertSkillToAITool),
];

/** 后续技能从这里登记。空着表示还没接入，不要在别处再造一套 Skill 加载器。 */
export type AgentKnowledgeFile = { path: string; when: string; needsRead: boolean; use: string };
export type AgentPlaybook = { id: string; title: string; when: string; path: string; knowledgePath?: string; knowledgeFiles?: AgentKnowledgeFile[] };
export const agentPlaybooks: AgentPlaybook[] = [
  {
    id: 'canvas-video-piece',
    title: '剧情动画',
    when: '用户要多段剧情片时（每段 25–40 秒，分 2–3 段，主角跨段存活）',
    path: 'prompts/playbook_video_content.md',
    knowledgePath: 'prompts/playbook_video_content.prompt.md',
    knowledgeFiles: [
      { path: 'prompts/playbook_video_content.inputs.md', when: '收集参数/估时', needsRead: false, use: 'estimate' },
      { path: 'prompts/playbook_video_content.prompt.md', when: 'video create/update', needsRead: false, use: 'prompt' },
    ],
  },
  {
    id: 'canvas-opening-animation',
    title: '开场动画',
    when: '用户要一条游戏开场动画时（单段，15 秒内，可选配乐）',
    path: 'prompts/playbook_opening_animation.md',
    knowledgePath: 'prompts/playbook_opening_animation.prompt.md',
    knowledgeFiles: [
      { path: 'prompts/playbook_opening_animation.inputs.md', when: '收集参数/估时', needsRead: false, use: 'estimate' },
      { path: 'prompts/playbook_opening_animation.prompt.md', when: 'video create/update', needsRead: false, use: 'prompt' },
    ],
  },
  {
    id: 'canvas-combat-fx',
    title: '特效打斗',
    when: '用户要角色战斗、技能特效或打斗视频时（单段 10–15 秒，分镜 + 冲击帧 + 四层提示词）',
    path: 'prompts/playbook_combat_fx.skeleton.md',
    knowledgePath: 'prompts/playbook_combat_fx.knowledge.md',
    knowledgeFiles: [
      { path: 'prompts/playbook_combat_fx.inputs.md', when: 'ask_user 覆盖六项参数', needsRead: false, use: 'collect-params' },
      { path: 'prompts/playbook_combat_fx.duration.md', when: 'video create/update', needsRead: false, use: 'estimate' },
      { path: 'prompts/playbook_combat_fx.storyboard-spec.md', when: 'video create/update 或写分镜', needsRead: false, use: 'storyboard' },
      { path: 'prompts/playbook_combat_fx.knowledge.md', when: 'video create/update', needsRead: false, use: 'prompt' },
      { path: 'prompts/playbook_combat_fx.techniques.md', when: 'video create/update', needsRead: false, use: 'prompt-example' },
      { path: 'prompts/playbook_combat_fx.troubleshooting.md', when: 'runStates 失败或 review 未通过', needsRead: true, use: 'troubleshoot' },
      { path: 'prompts/mx-shell-prompt/references/camera-moves.md', when: 'video create/update', needsRead: false, use: 'prompt' },
    ],
  },
];
