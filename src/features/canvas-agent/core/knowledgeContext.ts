import type { CanvasAction } from '../types';

/**
 * 阶段 5（新判据）：骨架常驻；知识只在「本轮动作含 video create/update」时拼。
 * 打斗知识再按素材元素选段，且仍然只在写 prompt 那一轮。
 */
export type KnowledgeAssembly = {
  video: boolean;
  bones: boolean;
  knowledge: string;
  selected: string[];
  reason: string;
};

const ELEMENT_ALIASES: Array<{ element: string; patterns: RegExp }> = [
  { element: '火', patterns: /火|炎|烈焰|赤金|熔岩/ },
  { element: '冰', patterns: /冰|霜|寒|冻结/ },
  { element: '雷', patterns: /雷|电|弧光/ },
  { element: '自然', patterns: /自然|木|藤|草木|生机/ },
  { element: '神圣', patterns: /神圣|圣光|金身|佛光/ },
  { element: '体术', patterns: /体术|拳|近战|搏击|摔投/ },
  { element: '兽形', patterns: /龙|虎|兽形|巨影/ },
];

const GENERIC_TITLES = [/叙事/, /四层提示词/, /冲击帧/, /核心方法论/];

function splitKnowledgeSections(text: string): Array<{ title: string; body: string }> {
  const lines = String(text || '').split(/\r?\n/);
  const sections: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string } | null = null;
  for (const line of lines) {
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      if (current) sections.push(current);
      current = { title: heading[1].trim(), body: '' };
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  if (current) sections.push(current);
  return sections;
}

export function selectCombatKnowledge(text: string, message: string): { knowledge: string; selected: string[] } {
  const sections = splitKnowledgeSections(text);
  if (!sections.length) return { knowledge: String(text || '').slice(0, 12_000), selected: ['全文'] };
  const elements = ELEMENT_ALIASES
    .filter((item) => item.patterns.test(message))
    .map((item) => item.element);
  const selected: string[] = [];
  const chunks: string[] = [];
  for (const section of sections) {
    const generic = GENERIC_TITLES.some((pattern) => pattern.test(section.title));
    const elementMatch = elements.some((element) => section.title.includes(element) || section.body.includes(element));
    if (!generic && !elementMatch) continue;
    selected.push(section.title);
    chunks.push(`## ${section.title}\n${section.body}`.trim());
  }
  const knowledge = chunks.join('\n\n').slice(0, 12_000);
  return { knowledge, selected };
}

export function assembleKnowledgeForTurn(input: {
  actions: readonly CanvasAction[];
  nodeTypeOf?: (nodeId: string) => string;
  message: string;
  knowledgeText: string;
}): KnowledgeAssembly {
  const nodeTypeOf = input.nodeTypeOf || (() => '');
  const video = input.actions.some((action) => {
    if (action.type === 'create_node') return action.nodeType === 'video';
    if (action.type === 'update_node_params') return nodeTypeOf(action.nodeId) === 'video';
    return false;
  });
  if (!video) {
    return { video: false, bones: true, knowledge: '', selected: [], reason: '本轮动作无 video create/update：只拼骨架' };
  }
  const picked = selectCombatKnowledge(input.knowledgeText, input.message);
  return {
    video: true,
    bones: true,
    knowledge: picked.knowledge,
    selected: picked.selected,
    reason: `本轮动作含 video：拼骨架 + 知识（${picked.selected.length} 段）`,
  };
}
