/**
 * RH 字段类型推断：prompt 类字段勿被默认值文案猜成 IMAGE；管理台列表右侧可改类型
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { normalizeRhField } from '../src/lib/runningHubAdmin.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const admin = fs.readFileSync(path.join(root, 'src/lib/runningHubAdmin.ts'), 'utf8');
const svc = fs.readFileSync(path.join(root, 'src/services/runningHubWorkflows.ts'), 'utf8');
const page = fs.readFileSync(path.join(root, 'src/pages/AdminRunningHubWorkflowsPage.tsx'), 'utf8');

assert.match(admin, /isLikelyTextFieldName/);
assert.match(svc, /isLikelyTextFieldName/);
assert.match(page, /RH_INLINE_FIELD_TYPES/);
assert.match(page, /onUpdateField/);
assert.match(page, /字段类型/);

const healed = normalizeRhField({
  id: '1::prompt',
  nodeId: '1',
  fieldName: 'prompt',
  fieldType: 'IMAGE',
  fieldValue: 'a picture of a cat with mask',
  enabled: true,
});
assert.equal(healed.fieldType, 'TEXT', 'prompt+IMAGE should heal to TEXT');

const keepImage = normalizeRhField({
  id: '2::image',
  nodeId: '2',
  fieldName: 'image',
  fieldType: 'IMAGE',
  fieldValue: 'a.png',
  enabled: true,
});
assert.equal(keepImage.fieldType, 'IMAGE', 'real image field stays IMAGE');

console.log('OK: prompt IMAGE heals to TEXT');
console.log('OK: image field stays IMAGE');
console.log('OK: admin page has inline type select');
console.log('\ncheck-rh-prompt-field-type: all passed');
