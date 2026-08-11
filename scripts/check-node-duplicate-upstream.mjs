/**
 * 右键图片 / 生图 / 生视频图台：创建副本（正下方 + 上游连线）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

const checks = [
  [eng.includes('function duplicateNodeKeepingUpstream'), 'helper exists'],
  [eng.includes('function canDuplicateNodeKeepingUpstream'), 'gate helper'],
  [eng.includes('NODE_DUPLICATE_BELOW_GAP'), 'below gap constant'],
  [eng.includes("node.type === 'image' || isGenConsoleNode(node)"), 'image + gen/video only'],
  [eng.includes('conn.to !== node.id'), 'copies upstream inbound edges'],
  [eng.includes('Math.max(48, h) + NODE_DUPLICATE_BELOW_GAP'), 'places copy below'],
  [eng.includes('data-image-duplicate'), 'image menu item'],
  [eng.includes('data-gen-duplicate'), 'gen/video menu item'],
  [eng.includes("en ? 'Create copy' : '创建副本'"), 'label 创建副本'],
  [!eng.includes("en ? 'Copy node' : '复制节点'"), 'no legacy Copy node label'],
  [eng.includes('bindGenStageDuplicateMenuAction'), 'gen menu binder'],
  [eng.includes('空图台：仍可右键'), 'empty stage contextmenu'],
];

let failed = 0;
for(const [ok, label] of checks){
  if(!ok){
    console.error('FAIL:', label);
    failed++;
  } else {
    console.log('OK:', label);
  }
}
if(failed){
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log('\ncheck-node-duplicate-upstream: all passed');
