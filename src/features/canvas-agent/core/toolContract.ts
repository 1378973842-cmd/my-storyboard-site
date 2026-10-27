/**
 * 工具契约：每个工具能碰什么、要不要审批、重复调用是否幂等、结果回给模型的状态。
 * 这份表现在是服务端路由和提案闸门的唯一事实来源，将来 MCP 也读它。
 */
export type ToolScope = 'canvas' | 'meta';

export type ToolContract = {
  name: string;
  scope: ToolScope;
  /** 会不会改画布内容（结构） */
  mutatesCanvas: boolean;
  /** 会不会触发生成 */
  requiresApproval: boolean;
  /** 同一轮重复调用同参数只做一次 */
  idempotent: boolean;
  /** 回给模型的 observation.status */
  resultStatus: string;
};

const CORE_CONTRACTS: ToolContract[] = [
  {
    name: 'create_canvas_nodes',
    scope: 'canvas',
    mutatesCanvas: true,
    requiresApproval: false,
    idempotent: false,
    resultStatus: 'queued_for_user_approval',
  },
  {
    name: 'connect_workflow_edges',
    scope: 'canvas',
    mutatesCanvas: true,
    requiresApproval: false,
    idempotent: true,
    resultStatus: 'queued_for_user_approval',
  },
  {
    name: 'update_node_config',
    scope: 'canvas',
    mutatesCanvas: true,
    requiresApproval: false,
    idempotent: false,
    resultStatus: 'queued_for_user_approval',
  },
  {
    name: 'trigger_skill_execution',
    scope: 'canvas',
    mutatesCanvas: false,
    requiresApproval: true,
    idempotent: false,
    resultStatus: 'queued_for_user_approval',
  },
  {
    name: 'ask_user',
    scope: 'meta',
    mutatesCanvas: false,
    requiresApproval: false,
    idempotent: true,
    resultStatus: 'presented',
  },
  {
    name: 'remember_project_fact',
    scope: 'meta',
    mutatesCanvas: false,
    requiresApproval: false,
    idempotent: true,
    resultStatus: 'stored',
  },
  {
    name: 'confirm_character_anchor',
    scope: 'meta',
    mutatesCanvas: false,
    requiresApproval: false,
    idempotent: true,
    resultStatus: 'stored',
  },
  {
    name: 'start_production_task',
    scope: 'meta',
    mutatesCanvas: false,
    requiresApproval: false,
    idempotent: true,
    resultStatus: 'stored',
  },
  {
    name: 'write_task_artifact',
    scope: 'meta',
    mutatesCanvas: false,
    requiresApproval: false,
    idempotent: false,
    resultStatus: 'stored',
  },
  {
    name: 'complete_task_step',
    scope: 'meta',
    mutatesCanvas: false,
    requiresApproval: false,
    idempotent: true,
    resultStatus: 'stored',
  },
  {
    name: 'read_task_artifact',
    scope: 'meta',
    mutatesCanvas: false,
    requiresApproval: false,
    idempotent: true,
    resultStatus: 'read',
  },
];

const BY_NAME = new Map(CORE_CONTRACTS.map((item) => [item.name, item]));

/** 技能工具（run_*）按“触发生成”处理：要审批。 */
export function toolContract(name: string, skillNames: readonly string[] = []): ToolContract | null {
  const known = BY_NAME.get(name);
  if (known) return known;
  if (skillNames.includes(name)) {
    return {
      name,
      scope: 'canvas',
      mutatesCanvas: false,
      requiresApproval: true,
      idempotent: false,
      resultStatus: 'queued_for_user_approval',
    };
  }
  return null;
}

export function toolResultContent(name: string, skillNames: readonly string[] = []): { status: string } {
  return { status: toolContract(name, skillNames)?.resultStatus || 'ignored' };
}

/** 动作类型 → 工具名。提案闸门靠它判断「这一步要不要人批」。 */
export const ACTION_TOOL: Record<string, string> = {
  create_node: 'create_canvas_nodes',
  connect_nodes: 'connect_workflow_edges',
  update_node_params: 'update_node_config',
  execute_node_skill: 'trigger_skill_execution',
};

export function actionRequiresApproval(type: string, skillNames: readonly string[] = []): boolean {
  const tool = ACTION_TOOL[type];
  if (!tool) return true;
  return toolContract(tool, skillNames)?.requiresApproval ?? true;
}
