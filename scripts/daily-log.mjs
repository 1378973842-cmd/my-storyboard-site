#!/usr/bin/env node
/**
 * 每日工作记录：写入 docs/DAILY_LOG.md
 *
 * 用法：
 *   node scripts/daily-log.mjs              # 同步「今天 0 点起」尚未记录的 git 提交
 *   node scripts/daily-log.mjs --hook       # post-commit：只追加当前这一次提交（短哈希 + subject）
 *   node scripts/daily-log.mjs --note "…"   # 追加一条人工/Agent 说明（如无 Git 也可用）
 *
 * npm：
 *   npm run log:daily
 *   npm run log:daily -- --note "完成了 xxx"
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_PATH = path.join(ROOT, 'docs', 'DAILY_LOG.md');

function localDateString(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function readFileSafe(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function ensureLogFile() {
  if (fs.existsSync(LOG_PATH)) return;
  const header = `# 每日工作记录（Daily Log）

本文件由 \`scripts/daily-log.mjs\` 维护，用于记录「每天做了什么 / 做完了什么」。

- **自动**：安装 Git hook 后，每次 \`git commit\` 会自动追加一条提交摘要；也可运行 \`npm run log:daily\` 批量补全当天未记录的提交。
- **半自动（Agent）**：会话结束时运行 \`npm run log:daily -- --note "……"\` 补充无法用 Git 概括的说明。
- **安装 hook（可选）**：\`npm run hooks:install\`（需已 \`git init\`，Windows 需 Git 自带 sh 执行 hooks）

---
`;
  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, header, 'utf8');
}

/** 从当天小节里提取已记录的 commit 短哈希 */
function parseRecordedHashes(sectionBody) {
  const set = new Set();
  const re = /^- `\s*([a-f0-9]{7,40})\s*`/gim;
  let m;
  while ((m = re.exec(sectionBody))) {
    set.add(m[1].slice(0, 7));
  }
  return set;
}

function extractTodaySection(content, date) {
  const header = `## ${date}`;
  const idx = content.indexOf(header);
  if (idx === -1) return { before: content, section: '', after: '', start: -1 };

  const afterHeader = idx + header.length;
  const rest = content.slice(afterHeader);
  const next = rest.search(/\n## \d{4}-\d{2}-\d{2}/);
  const sectionEnd = next === -1 ? content.length : afterHeader + next;
  const section = content.slice(afterHeader, sectionEnd);
  return {
    before: content.slice(0, afterHeader),
    section,
    after: content.slice(sectionEnd),
    start: idx,
  };
}

function git(args) {
  try {
    return execSync(`git ${args}`, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

function appendLines(date, lines) {
  if (lines.length === 0) return false;
  ensureLogFile();
  let content = readFileSafe(LOG_PATH);
  const block = extractTodaySection(content, date);

  let newSection = block.section;
  if (!newSection.trim()) {
    newSection = `\n\n### 今日提交（Git）\n`;
  } else if (!newSection.includes('### 今日提交（Git）') && lines.some((l) => l.startsWith('- `'))) {
    newSection += `\n### 今日提交（Git）\n`;
  }

  for (const line of lines) {
    if (!newSection.includes(line.trim())) {
      newSection += `${line}\n`;
    }
  }

  if (block.start === -1) {
    content = content.trimEnd() + `\n\n## ${date}${newSection}`;
  } else {
    content = block.before + newSection + block.after;
  }

  fs.writeFileSync(LOG_PATH, content, 'utf8');
  return true;
}

function appendNote(date, note) {
  const text = note.trim();
  if (!text) return false;
  ensureLogFile();
  let content = readFileSafe(LOG_PATH);
  const block = extractTodaySection(content, date);
  let newSection = block.section;
  if (!newSection.trim()) {
    newSection = `\n\n### 记录 / 说明\n`;
  } else if (!newSection.includes('### 记录 / 说明')) {
    newSection += `\n### 记录 / 说明\n`;
  }
  const line = `- ${text}`;
  if (newSection.includes(line)) return false;
  newSection += `${line}\n`;

  if (block.start === -1) {
    content = content.trimEnd() + `\n\n## ${date}${newSection}`;
  } else {
    content = block.before + newSection + block.after;
  }
  fs.writeFileSync(LOG_PATH, content, 'utf8');
  return true;
}

function syncTodayCommits() {
  const date = localDateString();
  ensureLogFile();
  const content = readFileSafe(LOG_PATH);
  const block = extractTodaySection(content, date);
  const recorded = parseRecordedHashes(block.section || '');
  const raw = git('log --since=midnight --pretty=format:%h %s');
  if (!raw) {
    console.log('[daily-log] 今天暂无 Git 提交（或不在 git 仓库中）。');
    return;
  }
  const lines = [];
  for (const row of raw.split('\n')) {
    const t = row.trim();
    if (!t) continue;
    const sp = t.indexOf(' ');
    const hash = sp === -1 ? t : t.slice(0, sp);
    const subj = sp === -1 ? '' : t.slice(sp + 1).trim();
    const short = hash.slice(0, 7);
    if (recorded.has(short)) continue;
    lines.push(`- \`${short}\` ${subj}`);
  }
  if (lines.length === 0) {
    console.log('[daily-log] 今日提交均已记录在 DAILY_LOG.md。');
    return;
  }
  appendLines(date, lines);
  console.log(`[daily-log] 已追加 ${lines.length} 条提交到 docs/DAILY_LOG.md（${date}）。`);
}

function hookLastCommit() {
  const date = localDateString();
  const raw = git('log -1 --pretty=format:%h %s');
  if (!raw) return;
  const sp = raw.indexOf(' ');
  const hash = sp === -1 ? raw : raw.slice(0, sp);
  const subj = sp === -1 ? '' : raw.slice(sp + 1).trim();
  const line = `- \`${hash.slice(0, 7)}\` ${subj}`;
  ensureLogFile();
  const content = readFileSafe(LOG_PATH);
  const block = extractTodaySection(content, date);
  if (block.section.includes(line.trim())) return;
  appendLines(date, [line]);
  console.log('[daily-log] post-commit: 已追加一条到 docs/DAILY_LOG.md');
}

function main() {
  const argv = process.argv.slice(2);
  const noteIdx = argv.indexOf('--note');
  if (noteIdx !== -1) {
    const note = argv.slice(noteIdx + 1).join(' ').trim();
    if (!note) {
      console.error('用法: node scripts/daily-log.mjs --note "说明文字"');
      process.exit(1);
    }
    const date = localDateString();
    appendNote(date, note);
    console.log(`[daily-log] 已追加说明到 docs/DAILY_LOG.md（${date}）。`);
    return;
  }
  if (argv.includes('--hook')) {
    hookLastCommit();
    return;
  }
  syncTodayCommits();
}

main();
