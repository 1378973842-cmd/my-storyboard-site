/**
 * A1 一次性：浅色画布基础规则里的 1px 实线 → 幽灵 outline / 内阴影分隔。
 * ponytail: 机械替换，暗色 .theme-dark 覆盖块不碰。
 */
import { readFileSync, writeFileSync } from 'fs';

const path = 'src/components/InfiniteCanvas/infinite-canvas.css';
let css = readFileSync(path, 'utf8');

const pairs = [
  // 高频 token
  ['border:1px solid var(--line-2);', 'border:none; outline:0.5px solid rgba(203,213,225,.42); outline-offset:-0.5px;'],
  ['border:1px solid var(--line);', 'border:none; outline:0.5px solid rgba(232,237,243,.55); outline-offset:-0.5px;'],
  // 硬编码浅色
  ['border:1px solid #edf2f7;', 'border:none; outline:0.5px solid rgba(237,242,247,.72); outline-offset:-0.5px;'],
  ['border:1px solid #e8edf3;', 'border:none; outline:0.5px solid rgba(232,237,243,.55); outline-offset:-0.5px;'],
  ['border:1px solid #e2e8f0;', 'border:none; outline:0.5px solid rgba(226,232,240,.55); outline-offset:-0.5px;'],
  ['border:1px solid #cbd5e1;', 'border:none; outline:0.5px solid rgba(203,213,225,.5); outline-offset:-0.5px;'],
  ['border:1px solid #edf0f3;', 'border:none; outline:0.5px solid rgba(237,240,243,.6); outline-offset:-0.5px;'],
  // 半透明
  ['border:1px solid rgba(255,255,255,.16);', 'border:none; outline:0.5px solid rgba(255,255,255,.16); outline-offset:-0.5px;'],
  ['border:1px solid rgba(139,92,246,.18);', 'border:none; outline:0.5px solid rgba(139,92,246,.22); outline-offset:-0.5px;'],
  ['border:1px solid rgba(239,68,68,.3);', 'border:none; outline:0.5px solid rgba(239,68,68,.35); outline-offset:-0.5px;'],
  ['border:1px solid rgba(239,68,68,.28);', 'border:none; outline:0.5px solid rgba(239,68,68,.32); outline-offset:-0.5px;'],
  ['border:1px solid rgba(226,232,240,.86);', 'border:none; outline:0.5px solid rgba(226,232,240,.55); outline-offset:-0.5px;'],
  // 单向分隔 → 内阴影（outline 无法只画一边）
  ['border-bottom:1px solid var(--line);', 'border-bottom:none; box-shadow:inset 0 -1px 0 rgba(232,237,243,.55);'],
  ['border-top:1px solid var(--line-2);', 'border-top:none; box-shadow:inset 0 1px 0 rgba(203,213,225,.42);'],
  // 虚线 drop 区
  ['border:1px dashed var(--line-2);', 'border:none; outline:1px dashed rgba(148,163,184,.48); outline-offset:-1px;'],
  ['border:1px dashed #cbd5e1;', 'border:none; outline:1px dashed rgba(148,163,184,.48); outline-offset:-1px;'],
  // 节点外壳（在通用 var(--line) 替换后再精确覆盖）
];

for (const [from, to] of pairs) {
  css = css.split(from).join(to);
}

// .node 浅色：幽灵轮廓（通用替换后可能已是 outline，再统一）
css = css.replace(
  /\.node \{ position:absolute; min-width:220px; min-height:96px; border:none; outline:0\.5px solid rgba\(232,237,243,\.55\); outline-offset:-0\.5px;/,
  '.node { position:absolute; min-width:220px; min-height:96px; border:none; outline:0.5px solid rgba(148,163,184,.35); outline-offset:-0.5px;',
);

// .node-head：去底部分隔线 + 圆角对齐 22px
css = css.replace(
  /\.node-head \{([^}]*?)border-bottom:none; box-shadow:inset 0 -1px 0 rgba\(232,237,243,\.55\);([^}]*?)border-radius:21px 21px 0 0;/,
  '.node-head {$1border-bottom:none;$2border-radius:22px 22px 0 0;',
);

// 暗色 node-head 已 border-bottom:transparent，避免 box-shadow 残留
if (!css.includes('.infinite-canvas-root.theme-dark .node-head { border-bottom:none;')) {
  css = css.replace(
    '/* 暗色：头部靠类型色调差分区，去掉实线分割 */\n.infinite-canvas-root.theme-dark .node-head { border-bottom-color:transparent; }',
    '/* 暗色：头部靠类型色调差分区，去掉实线分割 */\n.infinite-canvas-root.theme-dark .node-head { border-bottom:none; box-shadow:none; }',
  );
}

// border:1px solid transparent 保留；统计剩余
const remain = [...css.matchAll(/border(?:-(?:top|bottom|left|right))?:1px solid(?!\s+transparent)/g)];
console.log('remaining border:1px solid (non-transparent):', remain.length);

writeFileSync(path, css);
