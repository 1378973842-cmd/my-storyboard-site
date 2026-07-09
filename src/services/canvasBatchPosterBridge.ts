import type { Express, Request, RequestHandler } from "express";
import {
  augmentChatCompletionsBody,
  extractTextLlmMessageContent,
  isApimartGeminiFlashModel,
  normalizeOpenAiApiBase,
  postTextLlm,
  resolveTextLlmEnv,
  stripBearerKey,
  textLlmConfigError,
} from "./canvasTextLlmBridge.js";
import { existsSync, readFileSync } from "fs";
import path from "path";
import {
  BATCH_POSTER_THEME_BY_ID,
  BATCH_POSTER_THEME_CLUSTERS,
  type BatchPosterThemeCluster,
} from "./batchPosterThemeClusters.js";

export type BatchPosterPipelineMode = "standard" | "plan_b" | "plan_b_theme";

export type BatchPosterBrainstormBody = {
  count?: number;
  selectedPreset?: string;
  themeId?: number;
  customTheme?: string;
  selectedAspectRatio?: string;
  model?: string;
  pipelineMode?: string;
};

export type BatchPosterTitleStyleLayers = {
  headline: string;
  emphasis: string;
  secondary: string;
  cta: string;
};

export type BatchPosterTitleCopyLayers = BatchPosterTitleStyleLayers & {
  /** 海报上每一段独立可见文案（从上到下），用于多行促销字锁定 */
  blocks?: string[];
};

export type BatchPosterExtractTitlesBody = {
  posterUrl?: string;
  model?: string;
};

export type BatchPosterThemeSlot = {
  theme_prompt: string;
  title_style: BatchPosterTitleStyleLayers;
  title_copy?: BatchPosterTitleCopyLayers;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isUpstreamOverloaded(status: number, payload: unknown): boolean {
  if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
  const msg = (
    typeof payload === "object" && payload
      ? (payload as { error?: { message?: unknown }; message?: unknown }).error?.message ||
        (payload as { message?: unknown }).message ||
        JSON.stringify(payload)
      : String(payload || "")
  )
    .toString()
    .toLowerCase();
  return (
    msg.includes("负载") ||
    msg.includes("饱和") ||
    msg.includes("rate") ||
    msg.includes("too many") ||
    msg.includes("overload")
  );
}

export const BATCH_POSTER_DEFAULT_TITLE_STYLE_LAYERS: BatchPosterTitleStyleLayers = {
  headline:
    "Bold display lettering with theme-primary gradient fill and dark stroke for main banner text",
  emphasis:
    "Brilliant high-contrast accent fill with strong outer glow for numeric amounts and promo words like FREE, TRILLION, BONUS, JACKPOT, %",
  secondary: "Softer supporting micro-copy in lower-saturation theme tint with lighter visual weight",
  cta: "High-contrast white bold text on a saturated pill button color distinct from headline and emphasis",
};

export const BATCH_POSTER_PRESET_THEME_IDS: Record<string, number[]> = {
  nostalgicClassics: [20, 14, 37, 38, 39, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 75, 78, 79, 80, 81, 82, 83],
  mythicBeasts: [18, 12, 19, 31, 36, 40, 41, 52, 53, 77],
  maleHardcore: [3, 4, 10, 17, 21, 28, 30, 42, 74],
  femaleFantasy: [2, 6, 7, 11, 13, 24, 26, 29, 33, 43, 73],
  trendingCasual: [15, 16, 22, 23, 25, 27, 32, 44, 72],
  culturalMysteries: [1, 5, 8, 9, 34, 35, 45],
  luckyAnimalJackpots: [46, 47],
  vegasLuxuryWealth: [48, 49, 76],
  chineseStyle: [11, 26, 46, 50, 51, 58, 59],
  seasonalAntagonists: [54, 55],
  fairyTaleLegends: [56, 57],
};

const BATCH_POSTER_PRESET_LABELS: Record<string, string> = {
  random: "Random / 随机脑暴",
  nostalgicClassics: "Nostalgic Classics / 复古怀旧向",
  mythicBeasts: "Mythic & Beasts / 神话猛兽向",
  maleHardcore: "Male Hardcore / 硬核征服向",
  femaleFantasy: "Female Fantasy / 梦幻女性向",
  trendingCasual: "Trending Casual / 潮流高波动",
  culturalMysteries: "Cultural Mysteries / 异域文明探索",
  luckyAnimalJackpots: "Lucky Animal Jackpots / 财富神兽存钱罐",
  vegasLuxuryWealth: "Vegas Luxury Wealth / 维加斯奢华财富",
  chineseStyle: "Chinese Style / 中国风",
  seasonalAntagonists: "Seasonal Antagonists / 节日反派特供",
  fairyTaleLegends: "Fairy Tale Legends / 经典童话新编",
};

const BATCH_POSTER_PRESET_ALIASES: Record<string, string> = {
  asianFortuneLuck: "chineseStyle",
};

const BATCH_POSTER_LLM_RULES = `【四段式公式】：
每一个 theme_prompt 必须严格遵守：主角状态 + 纵深环境细节 + 贴合世界观的静物设计财富 + 前中后景的层级。不要写短句子，要用极其细腻的英文词汇把场景填满。

【公式化正确示例 — theme_prompt】：
- "A gritty Western bounty hunter cowboy with a weathered brown leather hat and a dirt-stained trench coat, sitting in a dimly lit, detailed wooden saloon corner, meticulously cleaning a silver revolver. On the rough oak bar counter in the foreground, a loosened canvas pouch overflows with heavy, stamped pure gold eagle coins, resting next to a textured whiskey glass and brass bullets. In the blurred background, vintage bar stools and swinging wooden doors create a deep layered space."

【title_style 规则 — 与同一项的 theme_prompt 配对，必须为分层对象】：
- title_style 含四个英文字段：headline / emphasis / secondary / cta
- headline：主标题/横幅大字；emphasis：数字与 FREE/TRILLION/BONUS/JACKPOT/% 等高亮促销词；secondary：up to 等弱化副文案；cta：CLAIM NOW 等按钮文字
- 四层必须使用至少 3 种彼此可区分的填充/发光配色，禁止四层描述同一渐变色
- emphasis 必须是最高对比度高亮色，与 headline 明显不同
- 必须与 theme_prompt 世界观和主色系统一；禁止写具体标题文案、禁止写位置/字号/行数/对齐
- 每层英文 1 句，约 12-28 词；允许 gold / crimson / neon / brush stroke 等配色与材质词

【输出格式要求】：
必须严格返回 JSON 对象数组，不要带有 \`\`\`json 等任何 Markdown 标记，也不要任何多余的解释，例如：
[{"theme_prompt":"English scene description 1","title_style":{"headline":"Main banner molten orange gradient with charred stroke","emphasis":"Brilliant gold-yellow glow for numbers and FREE/TRILLION words","secondary":"Soft amber micro-copy lower saturation","cta":"White bold text on saturated red-orange pill button"}},{"theme_prompt":"English scene description 2","title_style":{"headline":"...","emphasis":"...","secondary":"...","cta":"..."}}]`;

const BATCH_POSTER_THEME_COPY_LLM_RULES = `【title_copy 规则 — 主题原创 Slots 买量文案】：
每一项还必须输出 title_copy 对象，包含四层【实际英文海报字面文案】（不是配色描述）：
- headline：2-6 词，契合 theme_prompt 世界观的主标题/游戏 slogan
- emphasis：高冲击促销词，须含 FREE / TRILLION / BONUS / JACKPOT / MEGA / WIN / % / COINS 等 Slots 买量词之一；可用大数字如 1,000,000,000
- secondary：简短副文案如 "up to" / "for new players"
- cta：按钮文案如 "CLAIM NOW" / "SPIN NOW"
禁令：禁止美元符号 $ 与 USD；禁止中文；各层宜短、适合横幅排版；各项之间 headline/emphasis 不得雷同。`;

function normalizeBatchPosterPipelineMode(value: unknown): BatchPosterPipelineMode {
  const key = String(value || "standard").trim();
  if (key === "plan_b_theme") return "plan_b_theme";
  if (key === "plan_b") return "plan_b";
  return "standard";
}

function needsThemeCreativeTitleCopy(pipelineMode?: string): boolean {
  return normalizeBatchPosterPipelineMode(pipelineMode) === "plan_b_theme";
}

function buildBatchPosterOutputLlmRules(pipelineMode?: string): string {
  if (!needsThemeCreativeTitleCopy(pipelineMode)) {
    return BATCH_POSTER_LLM_RULES;
  }
  return `${BATCH_POSTER_LLM_RULES}

${BATCH_POSTER_THEME_COPY_LLM_RULES}

【输出格式要求 — 主题原创文案模式】：
必须严格返回 JSON 对象数组，每项含 theme_prompt、title_style（四层配色描述，禁止写具体文案）、title_copy（四层实际英文字面文案）。例如：
[{"theme_prompt":"English scene description 1","title_style":{"headline":"Main banner molten orange gradient with charred stroke","emphasis":"Brilliant gold-yellow glow for numbers and FREE/TRILLION words","secondary":"Soft amber micro-copy lower saturation","cta":"White bold text on saturated red-orange pill button"},"title_copy":{"headline":"WILD WEST GOLD RUSH","emphasis":"FREE 2 TRILLION COINS","secondary":"up to","cta":"CLAIM NOW"}}]`;
}

function normalizeBatchPosterPreset(value: unknown): string {
  const key = String(value || "random").trim();
  if (key === "random") return "random";
  const resolved = BATCH_POSTER_PRESET_ALIASES[key] || key;
  if (BATCH_POSTER_PRESET_THEME_IDS[resolved]) return resolved;
  return "random";
}

function clustersByIds(ids: number[]): BatchPosterThemeCluster[] {
  return ids.map((id) => BATCH_POSTER_THEME_BY_ID[id]).filter(Boolean);
}

function allBatchPosterClusters(): BatchPosterThemeCluster[] {
  return Object.values(BATCH_POSTER_THEME_BY_ID);
}

function batchPosterClusterPoolForPreset(preset: string): BatchPosterThemeCluster[] {
  const key = normalizeBatchPosterPreset(preset);
  if (key === "random") return allBatchPosterClusters();
  return clustersByIds(BATCH_POSTER_PRESET_THEME_IDS[key] || []);
}

function pickRandomBatchPosterClusters(count: number, preset: string): BatchPosterThemeCluster[] {
  const pool = [...batchPosterClusterPoolForPreset(preset)];
  const picked: BatchPosterThemeCluster[] = [];
  while (picked.length < count && pool.length) {
    const idx = Math.floor(Math.random() * pool.length);
    picked.push(pool.splice(idx, 1)[0]);
  }
  const fallback = batchPosterClusterPoolForPreset(preset);
  while (picked.length < count && fallback.length) {
    const cluster = fallback[Math.floor(Math.random() * fallback.length)];
    picked.push({
      ...cluster,
      core_anchor: `${cluster.core_anchor} — variant ${picked.length + 1}`,
    });
  }
  return picked;
}

function formatClusterForPrompt(cluster: BatchPosterThemeCluster): string {
  const payload: Record<string, unknown> = {
    id: cluster.id,
    name: cluster.name,
    core_anchor: cluster.core_anchor,
    broad_concept: cluster.broad_concept,
    allowed_entities: cluster.allowed_entities,
  };
  if (cluster.interaction_required) payload.interaction_required = true;
  if (cluster.market_insight) payload.market_insight = cluster.market_insight;
  if (cluster.interaction_blueprint) payload.interaction_blueprint = cluster.interaction_blueprint;
  return JSON.stringify(payload);
}

const BATCH_POSTER_CLUSTER_DIVERGENCE_RULES = `【规则 1：概念集群发散规则（防关键词窄化）】
当你读取到带有 broad_concept 和 allowed_entities 的主题对象时，请将其作为核心灵感池。core_anchor 仅仅是市场标签，严禁让每一张海报都只盯着这个代号生成。你必须从 allowed_entities 列表中随机或组合挑选出【一种具体的角色或生物】作为画面的核心主体，并围绕其展开深度细节扩展。对于包含 market_insight 的高级主题，必须让大模型深度阅读其背后的买量心理学背景，并将该情绪融入 theme_prompt 的客观场景堆叠中。`;

const BATCH_POSTER_STYLE_ANTI_POLLUTION_RULES = `【规则 4：画风防污染硬性死线】
LLM 脑暴并返回的 JSON 细节文本中，绝对禁止携带任何 3D, 2D, cartoon, vector, render, lighting, Unreal Engine, illustration, cinematic, anime, realistic 等涉及画风、渲染材质、光影技术的词汇。必须 100% 保持纯客观的物体、动作和场景内容堆叠，以便无缝融入原有的美式卡通 Base Prompt 容器中。`;

function buildClusterExpansionRules(count: number, pipelineMode?: string): string {
  return `你是一个 Slots 创意广告导演。当前选中的预设大类中包含了一系列主题概念。

${BATCH_POSTER_CLUSTER_DIVERGENCE_RULES}

请确保批量返回的 ${count} 个主题之间，其主体生物、道具和所处环境有明显的视觉差异。

${BATCH_POSTER_STYLE_ANTI_POLLUTION_RULES}

${buildBatchPosterOutputLlmRules(pipelineMode)}`;
}

const BATCH_POSTER_CHINESE_STYLE_RULES = `【中国风预设 — LLM 生成规则再次强调】：
- 必须从每个主题集群的 allowed_entities 数组中挑选【一种】人物或角色作为唯一主体，禁止只写 core_anchor 代号
- 严格四段式公式：主体状态 + 纵深环境细节 + 贴合世界观的静物设计财富 + 前中后景层级
- theme_prompt 输出纯客观英文内容细节，严禁携带 3D, render, cartoon, vector, illustration, cinematic, anime, lighting 等任何画风污染词（画风由画布 Base Prompt 统一控制）
- title_style 四层对象可描述红金、毛笔边、金属浮雕等标题配色与质感，emphasis 须用更高对比 accent 色，禁止写具体标题文案`;

const BATCH_POSTER_DUAL_SUBJECT_INTERACTION_RULES = `【规则 2：硬性双主体剧情互动约束】
请检查当前主题是否包含 "interaction_required": true。如果为真，绝对禁止只写单一角色面对镜头的证件照陈述！你必须强制使用【双主体戏剧张力公式】来堆叠客观细节。对于带有 interaction_blueprint 的主题，必须严格按照该蓝图所规定的对立动作拉扯关系进行展开：
- 公式结构：【主体A (核心人物的动作与面部情绪细节)】 + 【一个具有强烈视觉拉扯感的互动行为/动词】 + 【主体B (生物/对手/神魔/萌宠的体型与受击/对视反应)】 + 【设计感财富与环境层级景深】。
- 实例要求：如果是点唱机餐厅，必须精准写出溜冰服务员失去平衡倾斜、托盘上的奶昔与满空金币横飞的瞬间戏剧冲突。
- 错误反例：只写一个小红帽站在森林里。（绝对禁止）
- 正确正例：一个小红帽惊恐地盯着一只从古树阴影中逼近、流着口水的巨大黑狼，两者在画面中形成剧烈的对峙张力。`;

const BATCH_POSTER_CANVAS_RATIO_TO_ASPECT: Record<string, string> = {
  square: "1:1",
  wide: "16:9",
  story: "9:16",
  portrait43: "3:4",
  landscape43: "4:3",
  portrait: "2:3",
  landscape: "3:2",
};

const BATCH_POSTER_ASPECT_COMPOSITION_RULES: Record<"1:1" | "16:9" | "9:16", string> = {
  "1:1":
    "【规则 3 / 🚨 1:1 正方形向心构图规范】：当前输出严格为正方形海报。禁止长条状载具（车、船、飞艇）横向侧写，必须描述为正面直冲屏幕或大角度对角线斜切。双主体互动禁止左右排开，必须采用一前一后（过肩对视）或上下重叠的紧凑V字型向心结构，视觉核心牢牢收紧在画面正中央。顶部与底部需为标题预留构图空间，但背景必须连续延伸（天空/环境/光效自然过渡），禁止出现横向硬切分隔条、纯色空条或上下两块独立色带。",
  "16:9":
    "【规则 3 / 🚨 16:9 电影全景构图规范】：当前输出为横屏。允许展示宏大的全景叙事、载具的完整侧面以及宽广的背景空间。双主体互动请使用标准的左右分屏横向对峙布局，拉开故事的横向拉扯感。背景需全幅连续，禁止上下横向硬切分隔条。",
  "9:16":
    "【规则 3 / 🚨 纵向瀑布流构图规范】：当前输出为垂直竖屏。必须使用极端的纵向透视，多用强烈的仰视或俯视镜头。双主体采用垂直位阶压迫。重点描述大批财富（如金币、宝石、筹码）从画面上方成瀑布状、雨点状向前方中央喷涌跌落的纵向流动感。顶部与底部标题区背景须与场景自然融合延伸，禁止出现横向硬切分隔条或纯色空条。",
};

function normalizeSelectedAspectRatio(value: unknown): string {
  const raw = String(value || "")
    .trim()
    .replace(/\s/g, "");
  if (!raw) return "16:9";
  if (BATCH_POSTER_CANVAS_RATIO_TO_ASPECT[raw]) return BATCH_POSTER_CANVAS_RATIO_TO_ASPECT[raw];
  if (/^\d+:\d+$/.test(raw)) return raw;
  return "16:9";
}

function aspectCompositionRuleKey(aspectRatio: string): keyof typeof BATCH_POSTER_ASPECT_COMPOSITION_RULES | null {
  const normalized = normalizeSelectedAspectRatio(aspectRatio);
  if (normalized === "1:1") return "1:1";
  if (normalized === "16:9") return "16:9";
  if (normalized === "9:16" || normalized === "3:4") return "9:16";
  const parts = normalized.split(":").map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
    const ratio = parts[0] / parts[1];
    if (Math.abs(ratio - 1) < 0.06) return "1:1";
    if (ratio > 1.1) return "16:9";
    if (ratio < 0.9) return "9:16";
  }
  return "16:9";
}

function appendAspectRatioCompositionRules(prompt: string, selectedAspectRatio?: string): string {
  const ruleKey = aspectCompositionRuleKey(String(selectedAspectRatio || ""));
  if (!ruleKey) return prompt;
  return `${prompt}

${BATCH_POSTER_ASPECT_COMPOSITION_RULES[ruleKey]}`;
}

function anyClusterRequiresInteraction(clusters: BatchPosterThemeCluster[]): boolean {
  return clusters.some((cluster) => cluster.interaction_required === true);
}

function formatInteractionBlueprintBlock(clusters: BatchPosterThemeCluster[]): string {
  const lines = clusters
    .filter((cluster) => cluster.interaction_required && cluster.interaction_blueprint)
    .map(
      (cluster) =>
        `- #${cluster.id} ${cluster.name}：必须严格执行 interaction_blueprint → ${cluster.interaction_blueprint}`
    );
  if (!lines.length) return "";
  return `【interaction_blueprint 强制蓝图 — 对应主题必须遵守】\n${lines.join("\n")}`;
}

function appendInteractionRulesIfNeeded(
  prompt: string,
  assignedClusters: BatchPosterThemeCluster[]
): string {
  if (!anyClusterRequiresInteraction(assignedClusters)) return prompt;
  const blueprintBlock = formatInteractionBlueprintBlock(assignedClusters);
  return `${prompt}

${BATCH_POSTER_DUAL_SUBJECT_INTERACTION_RULES}${blueprintBlock ? `\n\n${blueprintBlock}` : ""}`;
}

function finalizeBatchPosterSystemPrompt(
  prompt: string,
  assignedClusters: BatchPosterThemeCluster[],
  selectedAspectRatio?: string
): string {
  return appendAspectRatioCompositionRules(
    appendInteractionRulesIfNeeded(prompt, assignedClusters),
    selectedAspectRatio
  );
}

function buildRandomSystemPrompt(
  count: number,
  assignedClusters: BatchPosterThemeCluster[],
  selectedAspectRatio?: string,
  pipelineMode?: string
): string {
  const assignedBlock = assignedClusters.map(formatClusterForPrompt).join("\n");
  return finalizeBatchPosterSystemPrompt(
    `${buildClusterExpansionRules(count, pipelineMode)}

【本次随机分配的 ${count} 个主题概念集群 — 每一项必须对应输出数组中的一个主题，顺序一致】：
${assignedBlock}`,
    assignedClusters,
    selectedAspectRatio
  );
}

function buildPresetSystemPrompt(
  preset: string,
  count: number,
  poolClusters: BatchPosterThemeCluster[],
  assignedClusters: BatchPosterThemeCluster[],
  selectedAspectRatio?: string,
  pipelineMode?: string
): string {
  const presetKey = normalizeBatchPosterPreset(preset);
  const presetLabel = BATCH_POSTER_PRESET_LABELS[presetKey] || presetKey;
  const poolBlock = poolClusters.map(formatClusterForPrompt).join("\n");
  const chineseStyleBlock = presetKey === "chineseStyle" ? `\n\n${BATCH_POSTER_CHINESE_STYLE_RULES}` : "";
  const titleOutputs = needsThemeCreativeTitleCopy(pipelineMode)
    ? "theme_prompt 描述主体与环境道具，绝对不含画风词；每项同时输出 title_style（四层配色）与 title_copy（四层主题原创英文文案，禁止 $）"
    : "theme_prompt 描述主体与环境道具，绝对不含画风词；每项同时输出 title_style 标题字体配色";
  return finalizeBatchPosterSystemPrompt(
    `${buildClusterExpansionRules(count, pipelineMode)}

现在用户指定了【特定人群分类：${presetLabel}】。请只从下方【本分类预设主题池】中随机挑选 ${count} 个不同的主题概念集群，分别做四段式深度细节拓展（${titleOutputs}）。不得使用池外题材。${chineseStyleBlock}

【本分类预设主题池 — 只能从此池中选择 ${count} 个不同集群并分别拓展】：
${poolBlock}`,
    assignedClusters,
    selectedAspectRatio
  );
}

function buildPreciseThemeSystemPrompt(
  count: number,
  cluster: BatchPosterThemeCluster,
  selectedAspectRatio?: string,
  pipelineMode?: string
): string {
  const clusterJson = formatClusterForPrompt(cluster);
  const titleOutputs = needsThemeCreativeTitleCopy(pipelineMode)
    ? "theme_prompt（四段式客观场景英文）、title_style（四层配色对象）与 title_copy（四层主题原创英文文案，禁止 $）"
    : "theme_prompt（四段式客观场景英文）与 title_style（headline/emphasis/secondary/cta 四层对象）";
  const themeCopyBlock = needsThemeCreativeTitleCopy(pipelineMode)
    ? `\n\n${BATCH_POSTER_THEME_COPY_LLM_RULES}`
    : "";
  return finalizeBatchPosterSystemPrompt(
    `你是一个 Slots 广告创意导演。当前用户已精准锁定主题：【${cluster.broad_concept}】。

${BATCH_POSTER_CLUSTER_DIVERGENCE_RULES}

你的任务是：针对该主题，从 allowed_entities 矩阵中挑选角色，连续构思出 ${count} 个【完全不同构图、不同动作、不同前景道具互动】的深度细节描述。
- 示例：若主题是中华大厨，海报1写他铁锅爆炒飞出金币；海报2写他手握金色漏勺从火锅里捞出钻石；海报3写他单手推开蒸笼冒出金光。
每个对象必须包含 ${titleOutputs}。

${BATCH_POSTER_STYLE_ANTI_POLLUTION_RULES}${themeCopyBlock}

返回包含 ${count} 个对象的 JSON 数组。

【锁定的主题对象 — core_anchor: ${cluster.core_anchor}】：
${clusterJson}`,
    [cluster],
    selectedAspectRatio
  );
}

function batchPosterStrictFormatExample(pipelineMode?: string): string {
  if (needsThemeCreativeTitleCopy(pipelineMode)) {
    return `[{"theme_prompt":"English scene 1","title_style":{"headline":"...","emphasis":"...","secondary":"...","cta":"..."},"title_copy":{"headline":"WILD WEST GOLD RUSH","emphasis":"FREE 2 TRILLION COINS","secondary":"up to","cta":"CLAIM NOW"}}]`;
  }
  return `[{"theme_prompt":"English scene 1","title_style":{"headline":"...","emphasis":"...","secondary":"...","cta":"..."}}]`;
}

function normalizeCustomTheme(value: unknown): string {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 120);
}

function buildCustomThemeSystemPrompt(
  count: number,
  customTheme: string,
  selectedAspectRatio?: string,
  pipelineMode?: string
): string {
  const titleOutputs = needsThemeCreativeTitleCopy(pipelineMode)
    ? "theme_prompt（四段式客观场景英文）、title_style（四层配色对象）与 title_copy（四层主题原创英文文案，禁止 $）"
    : "theme_prompt（四段式客观场景英文）与 title_style（headline/emphasis/secondary/cta 四层对象）";
  const themeCopyBlock = needsThemeCreativeTitleCopy(pipelineMode)
    ? `\n\n${BATCH_POSTER_THEME_COPY_LLM_RULES}`
    : "";
  return finalizeBatchPosterSystemPrompt(
    `你是一个 Slots 广告创意导演。用户自定义了主题：【${customTheme}】。

你的任务是：围绕该主题的世界观、标志性角色、道具与环境符号，连续构思出 ${count} 个【完全不同构图、不同动作、不同前景道具互动】的深度细节描述。
- 若用户用中文或其他语言描述（如「忍者神龟」），请先理解其 IP/文化含义，再转为纯正客观的英文场景堆叠；严禁在 theme_prompt 中写中文。
- 每个变体必须从该主题宇宙中挑选【不同的主体或场景切面】，不得 ${count} 张都画同一姿势的证件照。
- 示例：主题「忍者神龟」→ 海报1 在下水道披萨旁翻腾金币；海报2 四龟围战反派金币飞溅；海报3 屋顶夜战霓虹与宝石宝箱前景。
每个对象必须包含 ${titleOutputs}。

${BATCH_POSTER_STYLE_ANTI_POLLUTION_RULES}${themeCopyBlock}

返回包含 ${count} 个对象的 JSON 数组。`,
    [],
    selectedAspectRatio
  );
}

function buildCustomThemeUserMessage(
  count: number,
  customTheme: string,
  strict = false,
  pipelineMode?: string
): string {
  const batchNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const strictLine = strict
    ? `\n【强制格式】仅输出 JSON 对象数组，例如 ${batchPosterStrictFormatExample(pipelineMode)}。禁止 Markdown、禁止解释、禁止字符串数组与单层 title_style 字符串。`
    : "";
  const titleLine = needsThemeCreativeTitleCopy(pipelineMode)
    ? "每个对象含 theme_prompt（场景四段式英文，无画风词）、title_style（四层配色描述）与 title_copy（四层主题原创英文文案，契合 Slots 买量风格，禁止 $）。"
    : "每个对象含 theme_prompt（场景四段式英文，无画风词）与 title_style（headline/emphasis/secondary/cta 四层，emphasis 高亮促销数字与 FREE/TRILLION 等词）。";
  return [
    `创意批次 ${batchNonce}。用户自定义主题：「${customTheme}」。`,
    `请围绕该主题连续输出 ${count} 个英文变体。`,
    `${count} 个变体之间必须构图不同、主体动作不同、前景道具互动不同，不得重复同一画面套路。`,
    titleLine,
    `仅返回 JSON 对象数组（${count} 项）。${strictLine}`,
  ].join("\n");
}

function buildPreciseThemeUserMessage(
  count: number,
  cluster: BatchPosterThemeCluster,
  strict = false,
  pipelineMode?: string
): string {
  const batchNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const strictLine = strict
    ? `\n【强制格式】仅输出 JSON 对象数组，例如 ${batchPosterStrictFormatExample(pipelineMode)}。禁止 Markdown、禁止解释、禁止字符串数组与单层 title_style 字符串。`
    : "";
  const titleLine = needsThemeCreativeTitleCopy(pipelineMode)
    ? "每个对象含 theme_prompt（场景四段式英文，无画风词）、title_style（四层配色描述）与 title_copy（四层主题原创英文文案，契合 Slots 买量风格，禁止 $）。"
    : "每个对象含 theme_prompt（场景四段式英文，无画风词）与 title_style（headline/emphasis/secondary/cta 四层，emphasis 高亮促销数字与 FREE/TRILLION 等词）。";
  return [
    `创意批次 ${batchNonce}。用户已精准锁定主题 #${cluster.id} ${cluster.name}（${cluster.broad_concept}）。`,
    `请围绕该主题的 allowed_entities 矩阵，连续输出 ${count} 个英文变体。`,
    `${count} 个变体之间必须构图不同、主体动作不同、前景道具互动不同，不得重复同一画面套路。`,
    titleLine,
    cluster.market_insight ? `买量心理学背景（必须融入场景情绪）：${cluster.market_insight}` : "",
    cluster.interaction_required
      ? "该主题为双主体互动题材：每个变体必须包含两个对立个体的视觉拉扯与互动动词，禁止只写单一角色。"
      : "",
    cluster.interaction_blueprint
      ? `必须严格执行 interaction_blueprint：${cluster.interaction_blueprint}`
      : "",
    `仅返回 JSON 对象数组（${count} 项）。${strictLine}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function resolvePreciseThemeCluster(themeId: number, preset: string): BatchPosterThemeCluster {
  const cluster = BATCH_POSTER_THEME_BY_ID[themeId];
  if (!cluster) throw new Error(`未知主题 ID: ${themeId}`);
  if (preset !== "random") {
    const pool = BATCH_POSTER_PRESET_THEME_IDS[preset] || [];
    if (!pool.includes(themeId)) {
      throw new Error(`主题 #${themeId} 不属于当前预设分类`);
    }
  }
  return cluster;
}

function buildBrainstormUserMessage(
  count: number,
  preset: string,
  assignedClusters: BatchPosterThemeCluster[],
  strict = false,
  pipelineMode?: string
): string {
  const batchNonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const presetKey = normalizeBatchPosterPreset(preset);
  const strictLine = strict
    ? `\n【强制格式】仅输出 JSON 对象数组，例如 ${batchPosterStrictFormatExample(pipelineMode)}。禁止 Markdown、禁止解释、禁止字符串数组与单层 title_style 字符串。`
    : "";
  const itemOutputs = needsThemeCreativeTitleCopy(pipelineMode)
    ? "每项含 theme_prompt（场景）、title_style（四层配色）与 title_copy（四层主题原创英文文案，禁止 $）。"
    : "每项含 theme_prompt（场景）与 title_style（headline/emphasis/secondary/cta 四层，至少 3 种不同配色）。";
  if (presetKey === "random") {
    const slotLines = assignedClusters
      .map(
        (cluster, index) =>
          `${index + 1}. #${cluster.id} ${cluster.name} — pick ONE entity from allowed_entities, not core_anchor alone`
      )
      .join("\n");
    return [
      `创意批次 ${batchNonce}。请严格脑暴 ${count} 个完全不同的英文主题。`,
      "数组每一项必须对应 System Prompt 中指定顺序的主题概念集群。",
      "每项必须从 allowed_entities 中挑选一种不同的主体，主角、场景、核心情节均不得与其他项重复。",
      itemOutputs,
      "指定顺序：",
      slotLines,
      `仅返回 JSON 对象数组（${count} 项），顺序与指定顺序一致。${strictLine}`,
    ].join("\n");
  }
  return [
    `创意批次 ${batchNonce}。请从 System Prompt 给出的【本分类预设主题池】中随机挑选 ${count} 个不同主题概念集群，分别做四段式深度细节拓展。`,
    "每个数组项必须对应一个不同的池内集群，且必须从 allowed_entities 数组中挑选【一种】不同的主体；主角、场景、核心情节不得重复。",
    needsThemeCreativeTitleCopy(pipelineMode)
      ? "每项含 theme_prompt（场景，无画风词）、title_style（四层标题配色）与 title_copy（四层主题原创英文文案，禁止 $）。"
      : "每项含 theme_prompt（场景，无画风词）与 title_style（四层标题配色，emphasis 须高对比 accent）。",
    presetKey === "chineseStyle"
      ? "中国风预设：theme_prompt 纯客观内容细节，严禁 3D, render, cartoon, vector 等画风词；title_style 四层可写红金/毛笔边，emphasis 用更高亮 accent。"
      : "",
    `仅返回包含 ${count} 个对象的 JSON 数组，不要任何 Markdown 或解释。${strictLine}`,
  ]
    .filter(Boolean)
    .join("\n");
}

function clusterSlotSummary(clusters: BatchPosterThemeCluster[]): Array<{
  id: number;
  name: string;
  core_anchor: string;
  broad_concept: string;
}> {
  return clusters.map((cluster) => ({
    id: cluster.id,
    name: cluster.name,
    core_anchor: cluster.core_anchor,
    broad_concept: cluster.broad_concept,
  }));
}

function stripMarkdownCodeFence(text: string): string {
  return String(text || "")
    .trim()
    .replace(/^```(?:json|JSON)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function themeTextFromParsedItem(item: unknown): string {
  if (typeof item === "string") return item.trim();
  if (!item || typeof item !== "object") return String(item || "").trim();
  const obj = item as Record<string, unknown>;
  for (const key of ["description", "theme", "text", "prompt", "content", "theme_prompt"]) {
    if (typeof obj[key] === "string" && obj[key].trim()) return String(obj[key]).trim();
  }
  return "";
}

function extractBalancedJsonArray(text: string): unknown {
  const cleaned = stripMarkdownCodeFence(text);
  const start = cleaned.indexOf("[");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch === "[") depth += 1;
    else if (ch === "]") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function pickTitleStyleLayer(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    if (typeof obj[key] === "string" && obj[key].trim()) return String(obj[key]).trim();
  }
  return "";
}

function parseTitleStyleLayers(raw: unknown): BatchPosterTitleStyleLayers {
  const defaults = BATCH_POSTER_DEFAULT_TITLE_STYLE_LAYERS;
  if (typeof raw === "string" && raw.trim()) {
    return {...defaults, headline: raw.trim()};
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    return {
      headline:
        pickTitleStyleLayer(obj, ["headline", "main", "banner", "primary"]) || defaults.headline,
      emphasis:
        pickTitleStyleLayer(obj, ["emphasis", "highlight", "promo", "accent"]) || defaults.emphasis,
      secondary:
        pickTitleStyleLayer(obj, ["secondary", "support", "micro", "sub"]) || defaults.secondary,
      cta: pickTitleStyleLayer(obj, ["cta", "button", "action"]) || defaults.cta,
    };
  }
  return {...defaults};
}

function titleStyleFromParsedItem(item: unknown): BatchPosterTitleStyleLayers {
  if (!item || typeof item !== "object") return {...BATCH_POSTER_DEFAULT_TITLE_STYLE_LAYERS};
  const obj = item as Record<string, unknown>;
  const raw = obj.title_style ?? obj.titleStyle ?? obj.typography ?? obj.title_typography;
  if (typeof raw === "string") return parseTitleStyleLayers(raw);
  if (raw && typeof raw === "object") return parseTitleStyleLayers(raw);
  return {...BATCH_POSTER_DEFAULT_TITLE_STYLE_LAYERS};
}

function titleCopyFromParsedItem(item: unknown): BatchPosterTitleCopyLayers | undefined {
  if (!item || typeof item !== "object") return undefined;
  const obj = item as Record<string, unknown>;
  const raw = obj.title_copy ?? obj.titleCopy ?? obj.copy ?? obj.ad_copy ?? obj.adCopy;
  if (!raw) return undefined;
  const copy = normalizeBatchPosterTitleCopy(raw);
  if (!copy.headline && !copy.emphasis && !copy.secondary && !copy.cta) return undefined;
  return copy;
}

function assertThemeCreativeCopy(slots: BatchPosterThemeSlot[], pipelineMode?: string): void {
  if (!needsThemeCreativeTitleCopy(pipelineMode)) return;
  for (const slot of slots) {
    const copy = slot.title_copy;
    if (!copy || (!copy.headline && !copy.emphasis && !copy.cta)) {
      throw new Error("主题原创 B 计划模式缺少 title_copy 文案");
    }
    const joined = [copy.headline, copy.emphasis, copy.secondary, copy.cta].join(" ");
    if (joined.includes("$")) {
      throw new Error("title_copy 包含禁止的美元符号 $");
    }
  }
}

function themeSlotFromParsedItem(item: unknown): BatchPosterThemeSlot | null {
  if (typeof item === "string") {
    const theme_prompt = item.trim();
    return theme_prompt
      ? { theme_prompt, title_style: {...BATCH_POSTER_DEFAULT_TITLE_STYLE_LAYERS} }
      : null;
  }
  const theme_prompt = themeTextFromParsedItem(item);
  if (!theme_prompt) return null;
  const slot: BatchPosterThemeSlot = {
    theme_prompt,
    title_style: titleStyleFromParsedItem(item),
  };
  const title_copy = titleCopyFromParsedItem(item);
  if (title_copy) slot.title_copy = title_copy;
  return slot;
}

function parseBatchPosterThemeSlots(raw: string): BatchPosterThemeSlot[] {
  const text = String(raw || "").trim();
  if (!text) throw new Error("LLM 返回了空内容");

  const cleaned = stripMarkdownCodeFence(text);
  const attempts: unknown[] = [];

  try {
    attempts.push(JSON.parse(cleaned));
  } catch {
    /* fall through */
  }

  const balanced = extractBalancedJsonArray(text);
  if (balanced !== null) attempts.push(balanced);

  const legacyMatch = cleaned.match(/\[[\s\S]*\]/);
  if (legacyMatch) {
    try {
      attempts.push(JSON.parse(legacyMatch[0]));
    } catch {
      /* fall through */
    }
  }

  for (const parsed of attempts) {
    if (Array.isArray(parsed)) {
      const slots = parsed.map(themeSlotFromParsedItem).filter(Boolean) as BatchPosterThemeSlot[];
      if (slots.length) return slots;
    }
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      for (const key of ["themes", "items", "results", "data", "output", "descriptions"]) {
        const val = obj[key];
        if (Array.isArray(val)) {
          const slots = val.map(themeSlotFromParsedItem).filter(Boolean) as BatchPosterThemeSlot[];
          if (slots.length) return slots;
        }
      }
    }
  }

  throw new Error("LLM 未返回有效 JSON 数组");
}

function normalizeThemeKey(theme: string): string {
  return String(theme || "")
    .toLowerCase()
    .replace(/[^\w\s\u4e00-\u9fff]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function themeSimilarity(a: string, b: string): number {
  const keyA = normalizeThemeKey(a);
  const keyB = normalizeThemeKey(b);
  if (!keyA || !keyB) return 0;
  if (keyA === keyB) return 1;
  const wordsA = new Set(keyA.split(" ").filter((w) => w.length > 2));
  const wordsB = new Set(keyB.split(" ").filter((w) => w.length > 2));
  if (!wordsA.size || !wordsB.size) return 0;
  let overlap = 0;
  wordsA.forEach((w) => {
    if (wordsB.has(w)) overlap += 1;
  });
  return overlap / Math.max(wordsA.size, wordsB.size);
}

function dedupeBatchPosterThemeSlots(
  slots: BatchPosterThemeSlot[],
  similarityThreshold = 0.5
): BatchPosterThemeSlot[] {
  const unique: BatchPosterThemeSlot[] = [];
  slots.forEach((slot) => {
    const dup = unique.some(
      (existing) => themeSimilarity(existing.theme_prompt, slot.theme_prompt) >= similarityThreshold
    );
    if (!dup) unique.push(slot);
  });
  return unique;
}

async function callBatchPosterLlm(
  systemPrompt: string,
  userMessage: string,
  model: string,
  temperature = 1
): Promise<string> {
  const { apiBase, apiKey } = resolveTextLlmEnv(model);
  if (!apiBase || !apiKey) {
    throw new Error(textLlmConfigError(model));
  }
  const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 300000);
  const maxRetries = 4;
  const baseDelayMs = 2000;
  let lastError = "";

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const response = await postTextLlm(
        model,
        apiBase,
        apiKey,
        augmentChatCompletionsBody(model, {
          model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userMessage },
          ],
          max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 4096),
          temperature: Math.max(0, Math.min(2, temperature)),
          stream: false,
        }),
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      const rawText = await response.text();
      let data: Record<string, unknown> = {};
      try {
        data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
      } catch {
        data = { error: { message: rawText.slice(0, 400) } };
      }
      if (!response.ok) {
        const errMsg =
          (typeof (data?.error as { message?: unknown })?.message === "string" &&
            (data.error as { message: string }).message) ||
          rawText.slice(0, 400) ||
          `上游接口错误 (${response.status})`;
        if (isUpstreamOverloaded(response.status, errMsg) && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 260);
          const delay = Math.min(12000, baseDelayMs * Math.pow(2, attempt) + jitter);
          console.warn("[batch-poster-llm] upstream overloaded, retrying...", {
            model,
            attempt,
            delay,
          });
          await sleep(delay);
          lastError = errMsg;
          continue;
        }
        throw new Error(errMsg);
      }
      return extractTextLlmMessageContent(model, data).trim();
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      const retryable =
        isUpstreamOverloaded(0, msg) ||
        /fetch failed|network|econnreset|aborted/i.test(msg);
      if (retryable && attempt < maxRetries) {
        const jitter = Math.floor(Math.random() * 260);
        const delay = Math.min(12000, baseDelayMs * Math.pow(2, attempt) + jitter);
        console.warn("[batch-poster-llm] transient error, retrying...", { model, attempt, delay, msg });
        await sleep(delay);
        lastError = msg;
        continue;
      }
      throw err instanceof Error ? err : new Error(msg);
    }
  }
  throw new Error(lastError || "Batch Poster LLM 请求失败");
}

export function getBatchPosterThemeCatalog() {
  return {
    presets: BATCH_POSTER_PRESET_THEME_IDS,
    themes: BATCH_POSTER_THEME_CLUSTERS.map(({ id, name }) => ({ id, name })),
  };
}

const BATCH_POSTER_TITLE_COPY_EXTRACTION_SYSTEM = `你是 Slots 买量海报标题 OCR 专家。请阅读用户提供的参考海报，把所有可见标题/促销文案提取为 JSON。
- headline：主标题/横幅大字/顶部 slogan
- emphasis：最醒目的数字金额或 FREE/TRILLION/BONUS/JACKPOT/% 促销词（仅一段）
- secondary：弱化副文案（如 up to、for new players）
- cta：按钮文字（如 CLAIM NOW、SPIN NOW）
- blocks：【必填】数组，按从上到下、从左到右列出海报上每一段独立可见的标题/促销/按钮文案（逐字照抄，一段一行，不得遗漏）。例如三块字：["NEW SLOTS FOR YOU","200 FREE SPINS","UP TO 10T FREE COINS"]
规则：逐字照抄，保持原语言、大小写与标点；禁止翻译、改写、合并或臆造；某角色不存在则填空字符串。
仅返回 JSON：{"headline":"...","emphasis":"...","secondary":"...","cta":"...","blocks":["...","..."]}`;

function listenPort(): number {
  return Number(process.env.PORT) || 3000;
}

function absolutePosterUrl(req: Request, url: string): string {
  const u = String(url || "").trim();
  if (!u) return u;
  if (/^https?:\/\//i.test(u) || u.startsWith("data:")) return u;
  if (u.startsWith("/")) {
    const host = req.get("host") || `127.0.0.1:${listenPort()}`;
    const proto = (req.get("x-forwarded-proto") as string) || "http";
    return `${proto}://${host}${u}`;
  }
  return u;
}

function guessPosterMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

function resolvePosterImageForVision(req: Request, projectRoot: string, rawUrl: string): string {
  const url = String(rawUrl || "").trim();
  if (!url) return "";
  if (url.startsWith("blob:")) {
    throw new Error("参考图为浏览器临时地址(blob)，请重新连接图片或先上传到画布");
  }
  if (url.startsWith("data:") || /^https?:\/\//i.test(url)) return url;
  if (url.startsWith("/uploads/")) {
    const rel = url.replace(/^\/uploads\//, "").replace(/\\/g, "/");
    const abs = path.join(projectRoot, "public", "uploads", rel);
    if (!existsSync(abs)) return absolutePosterUrl(req, url);
    const buf = readFileSync(abs);
    return `data:${guessPosterMime(abs)};base64,${buf.toString("base64")}`;
  }
  return absolutePosterUrl(req, url);
}

function extractBalancedJsonObject(text: string): unknown {
  const cleaned = stripMarkdownCodeFence(text);
  const start = cleaned.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < cleaned.length; i += 1) {
    const ch = cleaned[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

export function normalizeBatchPosterTitleCopy(raw: unknown): BatchPosterTitleCopyLayers {
  if (typeof raw === "string" && raw.trim()) {
    const headline = raw.trim();
    return { headline, emphasis: "", secondary: "", cta: "", blocks: [headline] };
  }
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const headline = pickTitleStyleLayer(obj, ["headline", "main", "banner", "primary", "title"]);
    const emphasis = pickTitleStyleLayer(obj, ["emphasis", "highlight", "promo", "accent"]);
    const secondary = pickTitleStyleLayer(obj, ["secondary", "support", "micro", "sub"]);
    const cta = pickTitleStyleLayer(obj, ["cta", "button", "action"]);
    const rawBlocks = Array.isArray(obj.blocks)
      ? obj.blocks
      : Array.isArray(obj.lines)
        ? obj.lines
        : Array.isArray(obj.text_blocks)
          ? obj.text_blocks
          : [];
    const blocks = rawBlocks
      .map((item) => String(item || "").trim())
      .filter(Boolean);
    const layered = [headline, emphasis, secondary, cta].filter(Boolean);
    const merged = [...new Set([...blocks, ...layered])];
    return { headline, emphasis, secondary, cta, blocks: merged };
  }
  return { headline: "", emphasis: "", secondary: "", cta: "", blocks: [] };
}

export function parseBatchPosterTitleCopy(raw: string): BatchPosterTitleCopyLayers {
  const text = String(raw || "").trim();
  if (!text) throw new Error("标题 OCR 返回了空内容");
  const cleaned = stripMarkdownCodeFence(text);
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = extractBalancedJsonObject(text);
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("标题 OCR 未返回有效 JSON");
  }
  const copy = normalizeBatchPosterTitleCopy(parsed);
  if (!copy.headline && !copy.emphasis && !copy.secondary && !copy.cta && !(copy.blocks || []).length) {
    throw new Error("标题 OCR 未识别到任何文案");
  }
  return copy;
}

type VisionLlmRoute = { apiBase: string; apiKey: string; model: string; label: string };

/** gemini-3.5-flash 优先 APIMart（与脑暴同路）；饱和时可回退 comfly/THIRD_PARTY */
function batchPosterVisionLlmRoutes(model: string): VisionLlmRoute[] {
  const visionModel = /gemini/i.test(model) ? model : "gemini-3.5-flash";
  const routes: VisionLlmRoute[] = [];
  const primary = resolveTextLlmEnv(visionModel);
  if (primary.apiBase && primary.apiKey) {
    routes.push({ ...primary, model: visionModel, label: "primary" });
  }
  if (isApimartGeminiFlashModel(visionModel)) {
    const fbBase = normalizeOpenAiApiBase((process.env.THIRD_PARTY_API_BASE || "").trim());
    const fbKey = stripBearerKey((process.env.THIRD_PARTY_API_KEY || "").trim());
    if (fbBase && fbKey && !routes.some((r) => r.apiBase === fbBase && r.apiKey === fbKey)) {
      routes.push({ apiBase: fbBase, apiKey: fbKey, model: visionModel, label: "third-party-fallback" });
    }
  }
  return routes;
}

async function callBatchPosterVisionLlm(
  systemPrompt: string,
  userMessage: string,
  imageDataUrl: string,
  model: string
): Promise<string> {
  const routes = batchPosterVisionLlmRoutes(model);
  if (!routes.length) {
    throw new Error(textLlmConfigError(/gemini/i.test(model) ? model : "gemini-3.5-flash"));
  }
  const timeoutMs = Number(process.env.TEXT_API_TIMEOUT_MS || 300000);
  const maxRetries = 4;
  const baseDelayMs = 2000;
  let lastError = "";

  for (const route of routes) {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const response = await postTextLlm(
          route.model,
          route.apiBase,
          route.apiKey,
          augmentChatCompletionsBody(route.model, {
            model: route.model,
            messages: [
              { role: "system", content: systemPrompt },
              {
                role: "user",
                content: [
                  { type: "text", text: userMessage },
                  { type: "image_url", image_url: { url: imageDataUrl } },
                ],
              },
            ],
            max_tokens: Number(process.env.CANVAS_LLM_MAX_TOKENS || 2048),
            temperature: 0,
            stream: false,
          }),
          { signal: ctrl.signal }
        );
        clearTimeout(timer);
        const rawText = await response.text();
        let data: Record<string, unknown> = {};
        try {
          data = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : {};
        } catch {
          data = { error: { message: rawText.slice(0, 400) } };
        }
        if (!response.ok) {
          const errMsg =
            (typeof (data?.error as { message?: unknown })?.message === "string" &&
              (data.error as { message: string }).message) ||
            rawText.slice(0, 400) ||
            `上游接口错误 (${response.status})`;
          if (isUpstreamOverloaded(response.status, errMsg) && attempt < maxRetries) {
            const jitter = Math.floor(Math.random() * 260);
            const delay = Math.min(12000, baseDelayMs * Math.pow(2, attempt) + jitter);
            console.warn("[batch-poster-vision] upstream overloaded, retrying...", {
              model: route.model,
              route: route.label,
              attempt,
              delay,
            });
            await sleep(delay);
            lastError = errMsg;
            continue;
          }
          lastError = errMsg;
          break;
        }
        return extractTextLlmMessageContent(route.model, data).trim();
      } catch (err) {
        clearTimeout(timer);
        const msg = err instanceof Error ? err.message : String(err);
        const retryable =
          isUpstreamOverloaded(0, msg) ||
          /fetch failed|network|econnreset|aborted/i.test(msg);
        if (retryable && attempt < maxRetries) {
          const jitter = Math.floor(Math.random() * 260);
          const delay = Math.min(12000, baseDelayMs * Math.pow(2, attempt) + jitter);
          console.warn("[batch-poster-vision] transient error, retrying...", {
            model: route.model,
            route: route.label,
            attempt,
            delay,
            msg,
          });
          await sleep(delay);
          lastError = msg;
          continue;
        }
        lastError = msg;
        break;
      }
    }
  }
  throw new Error(lastError || "Batch Poster 视觉 OCR 请求失败");
}

export async function extractBatchPosterTitleCopyOnServer(
  req: Request,
  projectRoot: string,
  body: BatchPosterExtractTitlesBody
): Promise<BatchPosterTitleCopyLayers> {
  const posterUrl = String(body.posterUrl || "").trim();
  if (!posterUrl) throw new Error("缺少 posterUrl");
  const imageDataUrl = resolvePosterImageForVision(req, projectRoot, posterUrl);
  if (!imageDataUrl) throw new Error("无法读取参考海报");
  const model =
    String(body.model || "").trim() ||
    (process.env.TEXT_MODEL || "").trim() ||
    "gemini-3.5-flash";
  const visionModel = /gemini/i.test(model) ? model : "gemini-3.5-flash";
  const maxAttempts = 3;
  let lastError = "";
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const text = await callBatchPosterVisionLlm(
        BATCH_POSTER_TITLE_COPY_EXTRACTION_SYSTEM,
        attempt === 0
          ? "请提取这张海报上所有标题与促销文案，返回 JSON（含 headline/emphasis/secondary/cta 与必填 blocks 数组，blocks 逐段列出每一段可见标题字）。"
          : "再次检查：必须逐字照抄海报上每一段标题/促销/按钮文案，blocks 不得遗漏任何一段。禁止翻译或改写。仅返回 JSON。",
        imageDataUrl,
        visionModel
      );
      return parseBatchPosterTitleCopy(text);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      console.warn("[batch-poster-extract-titles] attempt failed:", { attempt, model: visionModel, lastError });
      if (isUpstreamOverloaded(0, lastError) && attempt < maxAttempts - 1) {
        const delay = Math.min(8000, 1500 * Math.pow(2, attempt));
        await sleep(delay);
      }
    }
  }
  throw new Error(lastError || "参考海报标题提取失败");
}

async function brainstormPreciseThemeVariantsOnServer(
  count: number,
  themeId: number,
  preset: string,
  model: string,
  selectedAspectRatio?: string,
  pipelineMode?: string
) {
  const cluster = resolvePreciseThemeCluster(themeId, preset);
  const presetLabel = BATCH_POSTER_PRESET_LABELS[preset] || preset;
  const maxAttempts = 3;
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const systemPrompt = buildPreciseThemeSystemPrompt(count, cluster, selectedAspectRatio, pipelineMode);
    const userMessage = buildPreciseThemeUserMessage(count, cluster, attempt > 0, pipelineMode);
    try {
      const text = await callBatchPosterLlm(
        systemPrompt,
        userMessage,
        model,
        attempt === 0 ? 1 : 0.85
      );
      let parsed: BatchPosterThemeSlot[];
      try {
        parsed = parseBatchPosterThemeSlots(text);
        assertThemeCreativeCopy(parsed, pipelineMode);
      } catch (parseErr) {
        console.warn("[batch-poster-brainstorm] precise parse failed:", {
          themeId,
          attempt,
          model,
          preview: text.slice(0, 500),
        });
        throw parseErr;
      }
      const unique = dedupeBatchPosterThemeSlots(parsed, 0.72);
      if (unique.length >= count) {
        const lockedSlots = Array.from({ length: count }, () => cluster);
        return {
          themes: unique.slice(0, count),
          selectedPreset: preset,
          presetLabel,
          mode: "precise" as const,
          themeId: cluster.id,
          themeName: cluster.name,
          selectedAspectRatio: normalizeSelectedAspectRatio(selectedAspectRatio),
          slots: clusterSlotSummary(lockedSlots),
          model,
        };
      }
      lastError = `精准变体去重后仅 ${unique.length} 个，需要 ${count} 个`;
      console.warn("[batch-poster-brainstorm] precise dedupe shortfall:", {
        themeId,
        count,
        unique: unique.length,
        attempt,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (isUpstreamOverloaded(0, lastError) && attempt < maxAttempts - 1) {
        await sleep(Math.min(8000, 1500 * Math.pow(2, attempt)));
      }
    }
  }

  throw new Error(lastError || "精准主题变体脑暴失败");
}

async function brainstormCustomThemeVariantsOnServer(
  count: number,
  customTheme: string,
  model: string,
  selectedAspectRatio?: string,
  pipelineMode?: string
) {
  const theme = normalizeCustomTheme(customTheme);
  if (!theme) throw new Error("自定义主题不能为空");
  const maxAttempts = 3;
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const systemPrompt = buildCustomThemeSystemPrompt(count, theme, selectedAspectRatio, pipelineMode);
    const userMessage = buildCustomThemeUserMessage(count, theme, attempt > 0, pipelineMode);
    try {
      const text = await callBatchPosterLlm(
        systemPrompt,
        userMessage,
        model,
        attempt === 0 ? 1 : 0.85
      );
      let parsed: BatchPosterThemeSlot[];
      try {
        parsed = parseBatchPosterThemeSlots(text);
        assertThemeCreativeCopy(parsed, pipelineMode);
      } catch (parseErr) {
        console.warn("[batch-poster-brainstorm] custom parse failed:", {
          customTheme: theme,
          attempt,
          model,
          preview: text.slice(0, 500),
        });
        throw parseErr;
      }
      const unique = dedupeBatchPosterThemeSlots(parsed, 0.72);
      if (unique.length >= count) {
        return {
          themes: unique.slice(0, count),
          selectedPreset: "custom",
          presetLabel: `Custom / 自定义：${theme}`,
          mode: "custom" as const,
          customTheme: theme,
          selectedAspectRatio: normalizeSelectedAspectRatio(selectedAspectRatio),
          model,
        };
      }
      lastError = `自定义主题去重后仅 ${unique.length} 个，需要 ${count} 个`;
      console.warn("[batch-poster-brainstorm] custom dedupe shortfall:", {
        customTheme: theme,
        count,
        unique: unique.length,
        attempt,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (isUpstreamOverloaded(0, lastError) && attempt < maxAttempts - 1) {
        await sleep(Math.min(8000, 1500 * Math.pow(2, attempt)));
      }
    }
  }

  throw new Error(lastError || "自定义主题脑暴失败");
}

export async function brainstormBatchPosterThemesOnServer(body: BatchPosterBrainstormBody) {
  const count = Math.max(1, Math.min(10, Number(body.count || 1)));
  const preset = normalizeBatchPosterPreset(body.selectedPreset);
  const pipelineMode = normalizeBatchPosterPipelineMode(body.pipelineMode);
  const model =
    String(body.model || "").trim() ||
    (process.env.TEXT_MODEL || "").trim() ||
    "gemini-3.5-flash";
  const selectedAspectRatio = normalizeSelectedAspectRatio(body.selectedAspectRatio);
  const customTheme = normalizeCustomTheme(body.customTheme);
  if (customTheme) {
    return brainstormCustomThemeVariantsOnServer(
      count,
      customTheme,
      model,
      selectedAspectRatio,
      pipelineMode
    );
  }
  const themeId = Number(body.themeId);
  if (Number.isFinite(themeId) && themeId > 0) {
    return brainstormPreciseThemeVariantsOnServer(
      count,
      themeId,
      preset,
      model,
      selectedAspectRatio,
      pipelineMode
    );
  }
  const presetLabel = BATCH_POSTER_PRESET_LABELS[preset] || preset;
  const poolClusters = batchPosterClusterPoolForPreset(preset);
  const maxAttempts = 3;
  let lastError = "";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const assignedClusters = pickRandomBatchPosterClusters(count, preset);
    const systemPrompt =
      preset === "random"
        ? buildRandomSystemPrompt(count, assignedClusters, selectedAspectRatio, pipelineMode)
        : buildPresetSystemPrompt(
            preset,
            count,
            poolClusters,
            assignedClusters,
            selectedAspectRatio,
            pipelineMode
          );
    const userMessage = buildBrainstormUserMessage(
      count,
      preset,
      assignedClusters,
      attempt > 0,
      pipelineMode
    );
    try {
      const text = await callBatchPosterLlm(
        systemPrompt,
        userMessage,
        model,
        attempt === 0 ? 1 : 0.75
      );
      let parsed: BatchPosterThemeSlot[];
      try {
        parsed = parseBatchPosterThemeSlots(text);
        assertThemeCreativeCopy(parsed, pipelineMode);
      } catch (parseErr) {
        console.warn("[batch-poster-brainstorm] parse failed:", {
          preset,
          attempt,
          model,
          preview: text.slice(0, 500),
        });
        throw parseErr;
      }
      const unique = dedupeBatchPosterThemeSlots(parsed);
      if (unique.length >= count) {
        return {
          themes: unique.slice(0, count),
          selectedPreset: preset,
          presetLabel,
          mode: "random" as const,
          selectedAspectRatio,
          slots: clusterSlotSummary(assignedClusters.slice(0, count)),
          model,
        };
      }
      lastError = `去重后仅 ${unique.length} 个主题，需要 ${count} 个`;
      console.warn("[batch-poster-brainstorm] dedupe shortfall:", {
        preset,
        count,
        unique: unique.length,
        attempt,
      });
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (isUpstreamOverloaded(0, lastError) && attempt < maxAttempts - 1) {
        await sleep(Math.min(8000, 1500 * Math.pow(2, attempt)));
      }
    }
  }

  throw new Error(lastError || "Batch Poster 主题脑暴失败");
}

export function registerCanvasBatchPosterRoutes(app: Express, projectRoot: string, gate?: RequestHandler) {
  app.get("/api/canvas/batch-poster-theme-catalog", ...(gate ? [gate] : []), (_req, res) => {
    return res.json(getBatchPosterThemeCatalog());
  });
  app.post("/api/canvas/batch-poster-brainstorm", ...(gate ? [gate] : []), async (req, res) => {
    try {
      const result = await brainstormBatchPosterThemesOnServer(req.body || {});
      return res.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[batch-poster-brainstorm] failed:", msg);
      return res.status(502).json({ error: msg });
    }
  });
  app.post("/api/canvas/batch-poster-extract-titles", ...(gate ? [gate] : []), async (req, res) => {
    try {
      const titleCopy = await extractBatchPosterTitleCopyOnServer(req, projectRoot, req.body || {});
      return res.json({ titleCopy });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[batch-poster-extract-titles] failed:", msg);
      return res.status(502).json({ error: msg });
    }
  });
}
