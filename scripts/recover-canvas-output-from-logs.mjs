#!/usr/bin/env node
/**
 * 从画布 logs[] 恢复 Output 节点（生成结果画廊）。
 *
 * 适用：nodes 被误写为空，但 logs 仍保留成功记录与 /uploads/... 路径。
 * 不能恢复：生成器/提示词节点、连线、布局位置。
 *
 * 用法：
 *   node scripts/recover-canvas-output-from-logs.mjs <canvasId>
 *   node scripts/recover-canvas-output-from-logs.mjs <canvasId> --dry-run
 *   node scripts/recover-canvas-output-from-logs.mjs <canvasId> --force
 *
 * npm：
 *   npm run recover:canvas-output -- <canvasId>
 *   npm run recover:canvas-output -- <canvasId> --dry-run
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CANVAS_DIR = path.join(ROOT, 'data', 'canvases');
const UPLOADS_DIR = path.join(ROOT, 'public');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const canvasId = args.find((a) => !a.startsWith('--'));

const dryRun = flags.has('--dry-run');
const force = flags.has('--force');

function usage(exitCode = 1) {
  console.log(`用法: node scripts/recover-canvas-output-from-logs.mjs <canvasId> [--dry-run] [--force]

  <canvasId>   画布 ID（不含 .json），例如 78068d3de1f0454e93d50f1b15acf8b2
  --dry-run    只统计与校验，不写回文件
  --force      即使已有节点也覆盖为「仅 Output 节点」的恢复结果

示例:
  npm run recover:canvas-output -- 78068d3de1f0454e93d50f1b15acf8b2
  npm run recover:canvas-output -- 78068d3de1f0454e93d50f1b15acf8b2 --dry-run
`);
  process.exit(exitCode);
}

if (!canvasId || flags.has('--help') || flags.has('-h')) usage(canvasId ? 0 : 1);

const safeId = String(canvasId).replace(/[^a-zA-Z0-9_-]/g, '');
if (!safeId) {
  console.error('错误: 无效的画布 ID');
  usage();
}

const canvasPath = path.join(CANVAS_DIR, `${safeId}.json`);
if (!fs.existsSync(canvasPath)) {
  console.error(`错误: 找不到画布文件 ${canvasPath}`);
  process.exit(1);
}

function backupPathFor(fp) {
  const base = `${fp}.pre-recover`;
  if (!fs.existsSync(base)) return base;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${fp}.pre-recover-${stamp}`;
}

function buildImagesFromLogs(logs) {
  const successLogs = (logs || [])
    .filter((log) => log?.status === 'success' && Array.isArray(log.outputs) && log.outputs.length)
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const seen = new Set();
  const images = [];

  for (const log of successLogs) {
    for (const url of log.outputs) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      images.push({
        url,
        viewed: false,
        runMs: log.runMs || 0,
        run: {
          nodeType: log.nodeType || 'generator',
          prompt: log.prompt || '',
          refs: log.refs || [],
          request: log.request || {},
        },
        model: log.model || '',
        prompt: log.prompt || '',
      });
    }
  }

  return { images, successLogs: successLogs.length };
}

function verifyUploads(images) {
  const missing = [];
  for (const img of images) {
    const rel = String(img.url || '').replace(/^\//, '');
    const fp = path.join(UPLOADS_DIR, rel);
    if (!fs.existsSync(fp)) missing.push(img.url);
  }
  return missing;
}

const raw = fs.readFileSync(canvasPath, 'utf8');
const doc = JSON.parse(raw);
const existingNodeCount = Array.isArray(doc.nodes) ? doc.nodes.length : 0;
const logCount = Array.isArray(doc.logs) ? doc.logs.length : 0;
const { images, successLogs } = buildImagesFromLogs(doc.logs);
const missingFiles = verifyUploads(images);

console.log(`画布: ${doc.title || '(未命名)'} (${safeId})`);
console.log(`现有节点: ${existingNodeCount}，logs: ${logCount}，成功且含 outputs: ${successLogs}`);
console.log(`可恢复图片: ${images.length}，缺失文件: ${missingFiles.length}`);

if (missingFiles.length) {
  console.warn('\n以下图片在 public/ 下未找到（仍会写入 URL，浏览器可能破图）:');
  missingFiles.slice(0, 10).forEach((u) => console.warn(`  ${u}`));
  if (missingFiles.length > 10) console.warn(`  … 另有 ${missingFiles.length - 10} 条`);
}

if (!images.length) {
  console.error('\n错误: logs 中没有可恢复的成功输出，已中止。');
  process.exit(1);
}

if (existingNodeCount > 0 && !force) {
  console.error(
    `\n错误: 当前已有 ${existingNodeCount} 个节点。若确要覆盖为「仅 Output」恢复结果，请加 --force。`
  );
  process.exit(1);
}

const outputNode = {
  id: `out_recovered_${safeId.slice(0, 8)}`,
  type: 'output',
  x: 260,
  y: 0,
  w: 795,
  h: 608,
  images,
  imageComparisons: {},
};

if (dryRun) {
  console.log('\n[dry-run] 将写入 1 个 Output 节点，不修改磁盘。');
  console.log(`[dry-run] Output 节点 ID: ${outputNode.id}`);
  process.exit(0);
}

const backup = backupPathFor(canvasPath);
fs.copyFileSync(canvasPath, backup);
console.log(`\n已备份: ${path.relative(ROOT, backup)}`);

doc.nodes = [outputNode];
doc.connections = [];
doc.updated_at = Date.now();

fs.writeFileSync(canvasPath, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');

console.log(`已恢复: ${path.relative(ROOT, canvasPath)}`);
console.log(`Output 节点: ${outputNode.id}，图片 ${images.length} 张`);
console.log('请在浏览器中刷新并重新打开该画布。');
