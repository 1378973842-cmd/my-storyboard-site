import type { CanvasAction } from '../types';

/**
 * 阶段 5（新判据）：骨架常驻；知识按「哪一步用」的段标签拼，不按「是不是 video 轮」猜。
 * 段标签来自注册表 use：collect-params / estimate / storyboard / prompt / prompt-example / troubleshoot。
 */
export type KnowledgeAssembly = {
  video: boolean;
  bones: boolean;
  knowledge: string;
  selected: string[];
  dropped: string[];
  cap: number;
  truncated: boolean;
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

const GENERIC_TITLES = [
  /叙事/, /四层提示词/, /冲击帧/, /核心方法论/,
  /分镜结构/, /多角色镜头/, /每条分镜/, /分镜/, /输入/, /时长/, /示例/, /输出模板/, /内容不满意/,
  /运镜四件套/, /分类 A/, /运镜/, /词典/,
];

type KnowledgeBlock = { path: string; use: string; body: string };

function splitKnowledgeFiles(text: string): KnowledgeBlock[] {
  const blocks: KnowledgeBlock[] = [];
  const regex = /<!--\s*knowledge-file:\s*([^;]+);\s*use=([^\s]+)\s*-->/g;
  const matches = [...String(text || '').matchAll(regex)];
  matches.forEach((match, index) => {
    const start = (match.index ?? 0) + match[0].length;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? text.length) : text.length;
    blocks.push({
      path: match[1].trim(),
      use: match[2].trim(),
      body: text.slice(start, end).trim(),
    });
  });
  return blocks;
}

function splitSections(body: string): Array<{ title: string; body: string }> {
  const lines = String(body || '').split(/\r?\n/);
  const sections: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string } | null = null;
  for (const line of lines) {
    const heading = line.match(/^#{1,3}\s+(.+)$/);
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

export function selectKnowledgeForUse(
  text: string,
  message: string,
  uses: readonly string[],
): { knowledge: string; selected: string[]; dropped: string[]; cap: number; truncated: boolean } {
  const useSet = new Set(uses);
  const blocks = splitKnowledgeFiles(text).filter((block) => useSet.has(block.use));
  const pack = (items: Array<{ label: string; text: string }>, cap: number) => {
    const selected: string[] = [];
    const dropped: string[] = [];
    const chunks: string[] = [];
    let used = 0;
    for (const item of items) {
      const separator = chunks.length ? 2 : 0;
      if (used + separator + item.text.length > cap) {
        dropped.push(item.label);
        continue;
      }
      chunks.push(item.text);
      selected.push(item.label);
      used += separator + item.text.length;
    }
    return {
      knowledge: chunks.join('\n\n'),
      selected,
      dropped,
      cap,
      truncated: dropped.length > 0,
    };
  };
  if (!blocks.length) {
    // 兼容没有段标签的旧知识文本：按全文处理。
    if (!uses.includes('prompt')) return { knowledge: '', selected: [], dropped: [], cap: 0, truncated: false };
    return pack([{ label: '(unmarked knowledge)', text: String(text || '') }], 10_000);
  }
  // 参数/估时是整表知识，不做段落筛选，整段拼。
  if (uses.some((use) => use === 'collect-params' || use === 'estimate')) {
    return pack(blocks.map((block) => ({ label: block.path, text: block.body })), 2_000);
  }
  const elements = ELEMENT_ALIASES
    .filter((item) => item.patterns.test(message))
    .map((item) => item.element);
  const items: Array<{ label: string; text: string }> = [];
  for (const block of blocks) {
    const sections = splitSections(block.body);
    if (!sections.length) {
      items.push({ label: block.path, text: block.body });
      continue;
    }
    for (const section of sections) {
      const generic = GENERIC_TITLES.some((pattern) => pattern.test(section.title));
      const elementMatch = elements.some((element) => section.title.includes(element) || section.body.includes(element));
      if (!generic && !elementMatch) continue;
      items.push({ label: section.title, text: `## ${section.title}\n${section.body}`.trim() });
    }
  }
  const cap = uses.includes('prompt') ? 10_000 : uses.includes('storyboard') ? 2_000 : 2_000;
  return pack(items, cap);
}

export function assembleKnowledgeForTurn(input: {
  actions: readonly CanvasAction[];
  nodeTypeOf?: (nodeId: string) => string;
  message: string;
  knowledgeText: string;
  step?: string;
}): KnowledgeAssembly {
  const nodeTypeOf = input.nodeTypeOf || (() => '');
  const createVideo = input.actions.some((action) => action.type === 'create_node' && action.nodeType === 'video');
  const updateVideo = input.actions.some((action) => action.type === 'update_node_params' && nodeTypeOf(action.nodeId) === 'video');
  const video = createVideo || updateVideo;
  if (!video) {
    return { video: false, bones: true, knowledge: '', selected: [], dropped: [], cap: 0, truncated: false, reason: '本轮动作无 video create/update：只拼骨架' };
  }
  // 改分镜走 storyboard；新建 video 走 prompt。
  const step = input.step || (updateVideo && !createVideo ? 'storyboard' : 'prompt');
  const uses = [step];
  if (step === 'prompt' && /示例|参考|像|参考图|例子/.test(input.message)) uses.push('prompt-example');
  const picked = selectKnowledgeForUse(input.knowledgeText, input.message, uses);
  return {
    video: true,
    bones: true,
    knowledge: picked.knowledge,
    selected: picked.selected,
    dropped: picked.dropped,
    cap: picked.cap,
    truncated: picked.truncated,
    reason: `本轮动作含 video，按步骤 ${uses.join('+')} 拼知识（${picked.selected.length} 段${picked.truncated ? `，未拼入 ${picked.dropped.length} 段` : ''}）`,
  };
}
