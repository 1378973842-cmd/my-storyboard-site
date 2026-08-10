/**
 * RH SELECT：ratio 等下拉勿因 group 含 Text / SELECT→text 被渲成提示词 textarea
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const checks = [
  [eng.includes("return 'select'"), 'rhFieldKind returns select'],
  [eng.includes('function rhLooksLikePromptField'), 'prompt detect helper'],
  [eng.includes('只用 fieldName/label 判断'), 'group excluded from prompt detect'],
  [eng.includes('function rhNormalizeOptionList'), 'string options normalized'],
  [eng.includes("kind === 'select' || options?.length"), 'render select by kind'],
];

let failed = 0;
for (const [ok, label] of checks) {
  if (!ok) {
    console.error('FAIL:', label);
    failed++;
  } else console.log('OK:', label);
}

// Extract and eval the RH field helpers in isolation
const start = eng.indexOf('const RH_KNOWN_FIELD_OPTIONS = {');
const end = eng.indexOf('function rhDefaultValue');
if (start < 0 || end < 0) {
  console.error('FAIL: cannot slice helpers');
  process.exit(1);
}
const slice = eng.slice(start, end);
const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(`${slice}\nthis.rhFieldKind=rhFieldKind;this.rhFieldRole=rhFieldRole;this.rhIsStageField=rhIsStageField;this.rhExtractFieldOptions=rhExtractFieldOptions;`, sandbox);

const ratioSelect = {
  fieldName: 'ratio',
  label: 'ratio',
  fieldType: 'SELECT',
  fieldValue: '3',
  group: 'CLIPTextEncode · MiniMax',
  options: ['1', '2', '3'],
};
if (sandbox.rhFieldKind(ratioSelect) !== 'select') {
  console.error('FAIL: SELECT kind', sandbox.rhFieldKind(ratioSelect));
  failed++;
} else console.log('OK: SELECT → select kind');
if (sandbox.rhFieldRole(ratioSelect) !== 'select') {
  console.error('FAIL: SELECT role', sandbox.rhFieldRole(ratioSelect));
  failed++;
} else console.log('OK: SELECT → select role');
if (sandbox.rhIsStageField(ratioSelect)) {
  console.error('FAIL: SELECT should not be stage/prompt');
  failed++;
} else console.log('OK: SELECT not stage field');

const ratioTextTypedButOptions = {
  fieldName: 'ratio',
  label: 'ratio',
  fieldType: 'TEXT',
  fieldValue: '16:9',
  group: 'SomeTextNode',
  options: ['1:1', '16:9', '9:16'],
};
if (sandbox.rhFieldRole(ratioTextTypedButOptions) !== 'select') {
  console.error('FAIL: options should force select role', sandbox.rhFieldRole(ratioTextTypedButOptions));
  failed++;
} else console.log('OK: options force select even if TEXT + Text group');

const realPrompt = {
  fieldName: 'prompt',
  label: 'prompt',
  fieldType: 'TEXT',
  fieldValue: 'hello',
  group: 'CLIPTextEncode',
  options: [],
};
if (sandbox.rhFieldRole(realPrompt) !== 'prompt') {
  console.error('FAIL: prompt role', sandbox.rhFieldRole(realPrompt));
  failed++;
} else console.log('OK: prompt still prompt');

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncheck-rh-select-field-ui: all passed');
