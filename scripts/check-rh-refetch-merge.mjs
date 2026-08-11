/**
 * RH 重新拉取：合并远端字段时保留本站已调参数（类型/默认值/排序/启停等）
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeRhFieldsOnRefetch, normalizeRhField } from '../src/lib/runningHubAdmin.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = fs.readFileSync(path.join(root, 'src/lib/runningHubAdmin.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/AdminRunningHubWorkflowsPage.tsx'), 'utf8');

assert.match(admin, /export function mergeRhFieldsOnRefetch/);
assert.match(page, /mergeRhFieldsOnRefetch/);
assert.doesNotMatch(page, /prevFieldsById/);

const previous = [
  normalizeRhField({
    id: '10::prompt',
    nodeId: '10',
    fieldName: 'prompt',
    fieldType: 'TEXT',
    fieldValue: '导演手调默认提示词',
    label: '主提示词',
    note: '手填说明',
    enabled: true,
    order: 3,
    options: [],
    random_enabled: false,
  }),
  normalizeRhField({
    id: '20::ratio',
    nodeId: '20',
    fieldName: 'ratio',
    fieldType: 'SELECT',
    fieldValue: '16:9',
    label: '画幅',
    enabled: true,
    order: 1,
    options: ['16:9', '9:16', '1:1'],
  }),
];

const fetched = [
  normalizeRhField({
    id: '10::prompt',
    nodeId: '10',
    fieldName: 'prompt',
    fieldType: 'IMAGE',
    fieldValue: 'remote default',
    label: 'prompt',
    enabled: false,
    order: 0,
  }),
  normalizeRhField({
    id: '20::ratio',
    nodeId: '20',
    fieldName: 'ratio',
    fieldType: 'TEXT',
    fieldValue: '1:1',
    label: 'ratio',
    enabled: false,
    order: 99,
    options: [],
  }),
  normalizeRhField({
    id: '30::seed',
    nodeId: '30',
    fieldName: 'seed',
    fieldType: 'NUMBER',
    fieldValue: '0',
    enabled: false,
    order: 0,
  }),
];

const merged = mergeRhFieldsOnRefetch(fetched, previous);
assert.equal(merged.length, 3);

const prompt = merged.find((f) => f.fieldName === 'prompt');
assert.ok(prompt);
assert.equal(prompt.fieldType, 'TEXT', '保留手改类型');
assert.equal(prompt.fieldValue, '导演手调默认提示词', '保留默认值');
assert.equal(prompt.label, '主提示词');
assert.equal(prompt.note, '手填说明');
assert.equal(prompt.enabled, true);
assert.equal(prompt.order, 3);

const ratio = merged.find((f) => f.fieldName === 'ratio');
assert.ok(ratio);
assert.equal(ratio.fieldType, 'SELECT');
assert.equal(ratio.fieldValue, '16:9');
assert.deepEqual(ratio.options, ['16:9', '9:16', '1:1']);
assert.equal(ratio.order, 1);

const seed = merged.find((f) => f.fieldName === 'seed');
assert.ok(seed);
assert.equal(seed.enabled, false, '新增字段用远端默认');
assert.equal(seed.fieldValue, '0');

// 仅靠 nodeId::fieldName 也能对齐（id 不一致时）
const byKey = mergeRhFieldsOnRefetch(
  [normalizeRhField({ id: 'weird', nodeId: '10', fieldName: 'prompt', fieldType: 'IMAGE', fieldValue: 'x', enabled: false })],
  previous
);
assert.equal(byKey[0].fieldType, 'TEXT');
assert.equal(byKey[0].fieldValue, '导演手调默认提示词');

console.log('OK: merge keeps type/value/label/note/enabled/order/options');
console.log('OK: new remote fields appended');
console.log('OK: match by nodeId::fieldName');
console.log('\ncheck-rh-refetch-merge: all passed');
