/**
 * RH 字段：管理台显式 TEXT 不得被 fieldName/默认值启发式猜成图片上传槽
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const start = eng.indexOf('function rhFieldKind(field){');
const end = eng.indexOf('function rhFieldRole(field){', start);
const src = eng.slice(start, end);
if(!src.includes("['TEXT','STRING','PROMPT'")){
  console.error('FAIL: rhFieldKind missing explicit TEXT early-return');
  process.exit(1);
}

const sandbox = { console };
vm.createContext(sandbox);
vm.runInContext(`${src}\nthis.rhFieldKind = rhFieldKind;`, sandbox);
const rhFieldKind = sandbox.rhFieldKind;

const cases = [
  [{ fieldType: 'TEXT', fieldName: 'image', fieldValue: 'a.png' }, 'text', 'explicit TEXT beats image name'],
  [{ fieldType: 'STRING', fieldName: 'img', fieldValue: '' }, 'text', 'explicit STRING'],
  [{ fieldType: 'PROMPT', fieldName: 'mask', fieldValue: '' }, 'text', 'explicit PROMPT'],
  [{ fieldType: 'SELECT', fieldName: 'image', fieldValue: 'opt' }, 'text', 'explicit SELECT'],
  [{ fieldType: 'IMAGE', fieldName: 'foo', fieldValue: '' }, 'image', 'explicit IMAGE kept'],
  [{ fieldType: '', fieldName: 'image', fieldValue: '' }, 'image', 'untyped still infers image'],
  [{ fieldType: '', fieldName: 'prompt', fieldValue: 'hello' }, 'text', 'untyped text stays text'],
];

let failed = 0;
for(const [field, expect, label] of cases){
  const got = rhFieldKind(field);
  if(got !== expect){
    console.error(`FAIL: ${label} → got ${got}, expect ${expect}`);
    failed++;
  } else console.log('OK:', label);
}
if(failed){
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncheck-rh-text-field-kind: all passed');
