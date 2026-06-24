/** Shared nine-grid storyboard utilities (homepage + infinite canvas). */

/** 与分镜页 image_prompt 一致：每格生图描述字数区间（汉字） */
export const NINE_GRID_SHOT_PROMPT_MIN_CHARS = 150;
export const NINE_GRID_SHOT_PROMPT_MAX_CHARS = 250;

/** Phase A 强制 JSON 输出说明（server 与 LLM 对齐） */
export const NINE_GRID_JSON_OUTPUT_CONSTRAINT =
  '【额外强制输出约束】你必须且只能输出一个合法 JSON，对象结构必须为：\n' +
  '{\n  "shots": [\n    { "n": 1, "specs": "...", "prompt": "..." },\n    ...,\n    { "n": 9, "specs": "...", "prompt": "..." }\n  ]\n}\n' +
  '要求：\n' +
  '- shots 长度必须为 9；不要 Markdown 代码块。\n' +
  '- specs：景别 + 构图摘要（20–40 汉字），如「全景，黄金分割点构图，低角度仰拍」。\n' +
  `- 每条 prompt：纯中文、可直接文生图的长句/段落，严格 ${NINE_GRID_SHOT_PROMPT_MIN_CHARS}-${NINE_GRID_SHOT_PROMPT_MAX_CHARS} 个汉字，不可少于 ${NINE_GRID_SHOT_PROMPT_MIN_CHARS} 字。\n` +
  '- 每条 prompt 必须同时包含：①景别 ②机位与构图位置（黄金分割点/前景遮挡/对角线/荷兰角等至少一项）③光影与材质 ④角色具体动作与视线矢量 ⑤若出场须写「图N」引用。\n' +
  '- 禁止把构图、景别、光影只写在 specs 里而让 prompt 变成短句；specs 的信息必须并入 prompt。\n' +
  '- 与分镜页同级：采用前景/中景/背景三层空间描述，重材质、重光影、重微表情。';

export const NINE_GRID_COSTUME_LOCK =
  '人物造型锁定：以参考图为准，发型、发色、服装品类与颜色、鞋子、配饰必须与参考图一致；' +
  '禁止擅自换装、改色或改发型。仅当分镜文案明确写出换装情节时，该格才可改变服装。' +
  '图生图时参考图的服装权重高于文字中与之冲突的描述。';

export const NINE_GRID_PREFIX =
  '在3X3网格中生成9个连贯分镜，固定版式为“从左到右、从上到下 1-9 顺序”。' +
  '每个格子严格为16:9横屏，整体大图严格为16:9。' +
  '九格必须无任何分隔线、无边框、无留白、无黑边、无白边、无拼接缝；' +
  '九格彼此紧贴，像一张完整画布被分为九个镜头。' +
  '以参考图为主体，保持环境空间布局一致、人物与物品相对位置合理，并通过不同角度推进剧情连贯发展。' +
  NINE_GRID_COSTUME_LOCK +
  '全图要求高分辨率、超高清细节、电影级质感、风格高度一致。' +
  '负向约束：禁止任何文字元素、禁止字幕、禁止对白台词字卡、禁止标题字、禁止 logo、禁止水印、禁止网格线、禁止边框、禁止任何装饰性分割元素。' +
  '如果模型倾向添加文字，必须改为纯画面表达，画面中不得出现可读字符。';

export const IMAGE_REF_COSTUME_LOCK_RULE =
  '每一张上传的参考图均为「完整角色造型参考」：必须同时复刻五官、发型、体型与全套服装（上装/下装/鞋子/外套/配饰及颜色版型），禁止只学面部或气质而忽略服装。';

/** 弱化用户文案里「只参考脸」的歧义表述 */
export function normalizeReferenceCostumeWording(prompt) {
  return String(prompt || '')
    .replace(/参考形象/g, '参考完整造型（含服装）')
    .replace(/换成图(\d+)的样子/g, '换成图$1的完整造型（五官+发型+服装）')
    .replace(/图(\d+)的形象/g, '图$1的完整造型（含服装）')
    .replace(/图(\d+)是[^，。；\n]{0,24}参考形象/g, '图$1是完整造型参考（含服装）')
    .replace(/形象一致/g, '完整造型一致（含服装）');
}

export function buildReferenceCostumeLockBlock(refs, refLooks = []) {
  const list = Array.isArray(refs) ? refs.filter((r) => r && (r.url || r.name)) : [];
  if (!list.length) return '';
  const looks = Array.isArray(refLooks) ? refLooks : [];
  const lines = list.map((r, idx) => {
    const n = idx + 1;
    const name = String(r?.name || '').trim() || `角色${String(n).padStart(2, '0')}`;
    const look = looks.find((l) => Number(l?.index) === n);
    if (look && !look.visionFailed) {
      const parts = [
        look.face_hair ? `发型五官：${String(look.face_hair).trim()}` : '',
        look.costume ? `服装：${String(look.costume).trim()}` : '',
        look.accessories ? `配饰：${String(look.accessories).trim()}` : '',
      ].filter(Boolean);
      if (parts.length) {
        return `图${n}（${name}）→ ${parts.join('；')}；生图须完整复刻以上造型，禁止只参考面部。`;
      }
    }
    return (
      `图${n}（${name}）→ 以实际上传的第 ${n} 张参考图像素为准，` +
      '完整复刻其发型、五官、体型与全套服装（颜色/版型/配饰），禁止只学脸而换装。'
    );
  });
  const orderHint =
    list.length > 1
      ? `多图顺序：按上传顺序对应图1至图${list.length}；引用图N即引用第N张参考图的完整造型。\n`
      : '';
  return `【参考图完整造型锁定】\n${IMAGE_REF_COSTUME_LOCK_RULE}\n${orderHint}${lines.join('\n')}`;
}

export function augmentImagePromptWithReferenceCostumeLock(prompt, refs, refLooks = []) {
  const base = normalizeReferenceCostumeWording(String(prompt || '').trim());
  const block = buildReferenceCostumeLockBlock(refs, refLooks);
  if (!block) return base;
  if (base.includes('【参考图完整造型锁定】')) return base;
  return base ? `${base}\n\n${block}` : block;
}

export function formatNineGridRefLookAnchors(refLooks) {
  const looks = Array.isArray(refLooks) ? refLooks.filter(Boolean) : [];
  if (!looks.length) return '';
  const lines = looks.map((look, idx) => {
    const n = Number(look?.index || idx + 1);
    const name = String(look?.name || `角色${String(n).padStart(2, '0')}`).trim();
    if (look?.visionFailed) {
      return (
        `图${n}（${name}）：【必须严格按上传的图${n}像素复刻完整造型：` +
        '发型、五官、体型与全套服装（上装/下装/鞋/配饰/颜色），禁止只学面部而臆造服装】'
      );
    }
    const parts = [
      look?.face_hair ? `发型五官：${String(look.face_hair).trim()}` : '',
      look?.costume ? `服装：${String(look.costume).trim()}` : '',
      look?.accessories ? `配饰：${String(look.accessories).trim()}` : '',
      look?.body_type ? `体型：${String(look.body_type).trim()}` : '',
    ].filter(Boolean);
    return `图${n}（${name}）${parts.length ? `：${parts.join('；')}` : ''}`;
  });
  return `参考图造型锚点（生图必须严格遵循）：\n${lines.join('\n')}`;
}

export function nineGridFallbackSlicePosition(idx) {
  const row = Math.floor(idx / 3);
  const col = idx % 3;
  return { row, col };
}

/** 合并 LLM 返回的 specs + prompt，避免构图细节落在 specs 却未进生图 */
export function mergeNineGridShotPrompt(shot) {
  const prompt = String(shot?.prompt ?? '').trim();
  const specs = String(shot?.specs ?? '').trim();
  const desc = String(shot?.description ?? '').trim();
  if (!specs && !prompt) return desc;
  if (!specs) return prompt || desc;
  if (!prompt) return specs;
  const head = specs.slice(0, Math.min(16, specs.length));
  if (head && prompt.includes(head)) return prompt;
  if (prompt.length >= specs.length && prompt.includes(specs)) return prompt;
  return `${specs}，${prompt}`;
}

export function clampNineGridShotPrompt(text) {
  const s = String(text || '').trim();
  if (s.length <= NINE_GRID_SHOT_PROMPT_MAX_CHARS) return s;
  const cut = s.slice(0, NINE_GRID_SHOT_PROMPT_MAX_CHARS);
  const lastPause = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('，'), cut.lastIndexOf('；'));
  if (lastPause > NINE_GRID_SHOT_PROMPT_MIN_CHARS - 20) {
    return cut.slice(0, lastPause + 1).trim();
  }
  return cut.trim();
}

export function mapNineGridShotsFromLlm(raw) {
  if (!Array.isArray(raw) || raw.length !== 9) return null;
  return raw
    .map((s, idx) => {
      const n = Number(s?.n || idx + 1);
      const specs = String(s?.specs ?? '').trim();
      const prompt = clampNineGridShotPrompt(mergeNineGridShotPrompt(s));
      return { n, specs, prompt };
    })
    .sort((a, b) => a.n - b.n);
}

export function nineGridShotsBelowMinChars(shots, minChars = NINE_GRID_SHOT_PROMPT_MIN_CHARS) {
  if (!Array.isArray(shots)) return [];
  return shots
    .filter((s) => String(s?.prompt ?? '').trim().length < minChars)
    .map((s) => Number(s?.n || 0))
    .filter((n) => n > 0);
}

export function buildNineGridShotExpandRetryMessage(shortShotNumbers) {
  const nums = (shortShotNumbers || []).filter((n) => n > 0);
  const list = nums.length ? nums.map((n) => `格子${n}`).join('、') : '部分格子';
  return (
    `上一轮 JSON 中 ${list} 的 prompt 字数不足 ${NINE_GRID_SHOT_PROMPT_MIN_CHARS} 汉字，或未包含景别/构图/光影/视线矢量。` +
    `请重新输出完整 JSON（shots 仍为 9 条），将每条 prompt 扩写为 ${NINE_GRID_SHOT_PROMPT_MIN_CHARS}-${NINE_GRID_SHOT_PROMPT_MAX_CHARS} 汉字的高密度画面描述，` +
    '必须写入黄金分割或前景遮挡等构图信息、三层空间、光影材质与图N引用，禁止只写动作短句。'
  );
}

export function normalizeNineGridShots(raw) {
  const mapped = mapNineGridShotsFromLlm(raw);
  if (!mapped) return null;
  return mapped.map(({ n, prompt }) => ({ n, prompt }));
}

export function buildNineGridImagePrompt(shots, refs, opts = {}) {
  const prefix = opts?.prefix || NINE_GRID_PREFIX;
  const refLooks = opts?.refLooks || [];
  const imageModel = String(opts?.imageModel || '').trim();
  const refMap = (refs || [])
    .map((r, idx) => {
      const name = (r.name || '').trim() || `角色${String(idx + 1).padStart(2, '0')}`;
      return `图${idx + 1}（${name}）`;
    })
    .join('、');
  const shotLines = (shots || [])
    .slice()
    .sort((a, b) => a.n - b.n)
    .map((s) => `格子${s.n}：${String(s.prompt || '').trim()}`)
    .join('\n');
  const anchorBlock = formatNineGridRefLookAnchors(refLooks);
  const modelMeta = imageModel
    ? `\n"image_generation_model": "${imageModel}", "grid_layout": "3x3", "grid_aspect_ratio": "16:9"。`
    : '';
  const core = `${prefix}${modelMeta}\n${anchorBlock ? `${anchorBlock}\n` : ''}参考图命名映射：${refMap || '无'}\n九宫格内容要求（从左到右、从上到下对应1-9）：\n${shotLines}`;
  return augmentImagePromptWithReferenceCostumeLock(core, refs, refLooks);
}

export function loadNineGridImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('图片加载失败（可能跨域或链接已失效）'));
    img.src = src;
  });
}

export async function splitNineGridToNine(src, pad = 0, gap = 0) {
  const img = await loadNineGridImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const safePad = Math.max(0, Math.min(Math.floor(Math.min(w, h) / 10), Math.round(pad)));
  const safeGap = Math.max(0, Math.min(200, Math.round(gap)));
  const innerW = w - safePad * 2 - safeGap * 2;
  const innerH = h - safePad * 2 - safeGap * 2;
  if (innerW <= 0 || innerH <= 0) throw new Error('裁切参数过大：内框尺寸为负');

  const cellW = Math.floor(innerW / 3);
  const cellH = Math.floor(innerH / 3);
  if (cellW <= 10 || cellH <= 10) throw new Error('裁切参数过大：单格过小');

  const out = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const sx = safePad + col * (cellW + safeGap);
      const sy = safePad + row * (cellH + safeGap);
      const c = document.createElement('canvas');
      c.width = cellW;
      c.height = cellH;
      const ctx = c.getContext('2d');
      if (!ctx) throw new Error('Canvas 初始化失败');
      ctx.drawImage(img, sx, sy, cellW, cellH, 0, 0, cellW, cellH);
      out.push(c.toDataURL('image/png'));
    }
  }
  return out;
}

export async function estimateNineGridGap(src) {
  const img = await loadNineGridImage(src);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('Canvas 初始化失败');
  ctx.drawImage(img, 0, 0);

  const data = ctx.getImageData(0, 0, w, h).data;
  const sampleColumnScore = (x) => {
    let sum = 0;
    let sum2 = 0;
    let n = 0;
    for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 220))) {
      const i = (y * w + x) * 4;
      const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
      sum += v;
      sum2 += v * v;
      n++;
    }
    const mean = sum / Math.max(1, n);
    const variance = sum2 / Math.max(1, n) - mean * mean;
    return { mean, variance };
  };

  const findGapNear = (center, axis) => {
    const radius = Math.max(8, Math.floor((axis === 'x' ? w : h) * 0.02));
    const start = Math.max(1, Math.floor(center - radius));
    const end = Math.min((axis === 'x' ? w : h) - 2, Math.floor(center + radius));

    let best = { pos: start, variance: Number.POSITIVE_INFINITY, mean: 0 };
    for (let p = start; p <= end; p++) {
      const s =
        axis === 'x'
          ? sampleColumnScore(p)
          : (() => {
              let sum = 0;
              let sum2 = 0;
              let n = 0;
              for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 220))) {
                const i = (p * w + x) * 4;
                const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
                sum += v;
                sum2 += v * v;
                n++;
              }
              const mean = sum / Math.max(1, n);
              const variance = sum2 / Math.max(1, n) - mean * mean;
              return { mean, variance };
            })();
      if (s.variance < best.variance) best = { pos: p, variance: s.variance, mean: s.mean };
    }

    const thresholdVar = best.variance + 8;
    const thresholdMean = 14;
    let left = best.pos;
    let right = best.pos;
    const scoreAt = (p) =>
      axis === 'x'
        ? sampleColumnScore(p)
        : (() => {
            let sum = 0;
            let sum2 = 0;
            let n = 0;
            for (let x = 0; x < w; x += Math.max(1, Math.floor(w / 220))) {
              const i = (p * w + x) * 4;
              const v = (data[i] + data[i + 1] + data[i + 2]) / 3;
              sum += v;
              sum2 += v * v;
              n++;
            }
            const mean = sum / Math.max(1, n);
            const variance = sum2 / Math.max(1, n) - mean * mean;
            return { mean, variance };
          })();

    for (let p = best.pos - 1; p >= start; p--) {
      const s = scoreAt(p);
      if (s.variance <= thresholdVar && Math.abs(s.mean - best.mean) <= thresholdMean) left = p;
      else break;
    }
    for (let p = best.pos + 1; p <= end; p++) {
      const s = scoreAt(p);
      if (s.variance <= thresholdVar && Math.abs(s.mean - best.mean) <= thresholdMean) right = p;
      else break;
    }
    return { gap: Math.max(0, right - left + 1) };
  };

  const g1 = findGapNear(w / 3, 'x');
  const g2 = findGapNear((2 * w) / 3, 'x');
  const gapX = Math.max(g1.gap, g2.gap);
  const r1 = findGapNear(h / 3, 'y');
  const r2 = findGapNear((2 * h) / 3, 'y');
  const gapY = Math.max(r1.gap, r2.gap);
  return Math.min(160, Math.max(0, Math.round(Math.max(gapX, gapY))));
}

export function dataUrlToBlob(dataUrl) {
  const [header, b64] = String(dataUrl || '').split(',');
  if (!b64) throw new Error('无效的图片数据');
  const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
