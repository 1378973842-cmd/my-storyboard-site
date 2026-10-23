import type { AskAnswer, AskCard } from './core/askCard';

export type JsonSchema = {
  type: string;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: string[];
  additionalProperties?: boolean | JsonSchema;
};

export const AGENT_CREATABLE_NODE_TYPES = [
  'generator',
  'video',
  'prompt',
  'image',
  'loop',
  'group',
  'llm',
  'replicaAgent',
  'imageRepairAgent',
  'batchPosterAgent',
  'nineGridAgent',
  'slotsLoopVideoAgent',
  'mxShellPromptAgent',
  'mxShellPolishAgent',
  'deepWhiteShotAgent',
  'screenwritingAgent',
  'viewpointAgent',
  'pixarAdScriptAgent',
  'textOutput',
  'videoReverse',
  'msgen',
  'rh',
  'output',
  'imageBatch',
] as const;

export type AIToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchema;
  };
};

export type CanvasAgentSourceSummary = {
  id: string;
  type: string;
  label: string;
  preview?: string;
  refs?: string[];
  prompt?: string;
};

export type CanvasNodeSnapshot = Record<string, unknown> & {
  id: string;
  type: string;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  agentSources?: CanvasAgentSourceSummary[];
};

export type CanvasEdgeSnapshot = {
  id: string;
  from: string;
  to: string;
};

export type CanvasSnapshot = {
  canvasId: string;
  nodes: CanvasNodeSnapshot[];
  connections: CanvasEdgeSnapshot[];
  selectedNodeIds: string[];
  viewport: { x: number; y: number; scale: number };
  viewportCenter: { x: number; y: number };
  settings: Record<string, unknown>;
  availableModels?: {
    fromConfig: boolean;
    image: Array<{ id: string; models: string[] }>;
    chat: Array<{ id: string; models: string[] }>;
    video: string[];
  };
  availableAssets?: Array<{ id: string; name: string; url: string; category: string; uploadedAt?: number }>;
};

export type ModelClampNote = {
  from: string;
  to: string;
  reason: string;
};

export type CreateNodeAction = {
  type: 'create_node';
  tempId?: string;
  nodeType: string;
  initialParams?: Record<string, unknown>;
  position?: { x: number; y: number };
  modelClamp?: ModelClampNote;
};

export type ConnectNodesAction = {
  type: 'connect_nodes';
  sourceNodeId: string;
  targetNodeId: string;
};

export type UpdateNodeParamsAction = {
  type: 'update_node_params';
  nodeId: string;
  patch: Record<string, unknown>;
  modelClamp?: ModelClampNote;
};

export type ExecuteNodeSkillAction = {
  type: 'execute_node_skill';
  nodeId: string;
};

export type CanvasAction =
  | CreateNodeAction
  | ConnectNodesAction
  | UpdateNodeParamsAction
  | ExecuteNodeSkillAction;

export type ProposalStatus =
  | 'pending'
  | 'applying'
  | 'applied'
  | 'discarded'
  | 'failed'
  | 'partial'
  | 'exec_failed'
  | 'expired';

export type ActionProposal = {
  id: string;
  title: string;
  summary: string;
  actions: CanvasAction[];
  status: ProposalStatus;
  requiresApproval: true;
  generative: boolean;
  createdAt: number;
  error?: string;
  feedbackDeliveredAt?: number;
  partialSkipped?: number | null;
  /** 落板时被点名闸门拿掉的 connect_nodes 条数。状态仍是 applied。 */
  droppedConnects?: number | null;
  reason?: string;
  inLibrary?: boolean;
  progress?: { done: number; total: number };
  /** 产生这份提案的用户消息。只有聊天提案有。批准时用它认 @ 点名。 */
  userMessage?: string;
  /** 这一步落板新建的节点。标签和下一轮「已生效」都读它。 */
  effectedNodes?: Array<{ id: string; nodeType: string; label?: string }>;
  changelog?: string;
  messageId?: string;
};

export type CanvasContextPayload = {
  activeSelectedNodes: Array<Record<string, unknown>>;
  upstreamLineage: Array<Record<string, unknown>>;
  canvasSummary: Record<string, unknown>;
  connections: Array<[string, string]>;
  availableModels?: CanvasSnapshot['availableModels'];
  availableAssets?: CanvasSnapshot['availableAssets'];
  availableAssetsOmission?: string;
};

export type AgentChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  askAnswer?: AskAnswer;
  askAnswers?: AskAnswer[];
  asks?: AskCard[];
};

export type AgentToolLog = {
  id: string;
  name: string;
  label: string;
  state: 'running' | 'queued' | 'done' | 'failed';
};

export type AgentConversation = {
  id: string;
  canvas_id: string;
  title: string;
  created_at: number;
  updated_at: number;
};

export type AgentStoredMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: {
    proposal?: ActionProposal;
    toolLogs?: AgentToolLog[];
    error?: string;
    elapsedMs?: number;
    asks?: AskCard[];
    askAnswer?: AskAnswer;
    askAnswers?: AskAnswer[];
  };
  created_at: number;
};

export type CanvasAgentStreamEvent =
  | { type: 'meta'; model: string; conversationId?: string; jobId?: string; citedNodes?: string[]; effectedNodes?: Array<{ id: string; nodeType: string; label?: string }> }
  | { type: 'delta'; text: string }
  | { type: 'tool'; log: AgentToolLog }
  | { type: 'proposal'; proposal: ActionProposal }
  | { type: 'done' }
  | { type: 'error'; error: string }
  | { type: 'ask'; asks: AskCard[] };