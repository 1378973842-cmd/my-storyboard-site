/**
 * 图片/生图工具栏派生物：贴源节点右侧，间距只留端口；
 * 不按下游图宽累加，以免新节点被甩远。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

function imageEditSpawnOffsetX(source, siblings, gap = 24){
    const packedLeft = source.x + source.w + gap;
    let nextX = packedLeft;
    const rowSlop = Math.max(48, source.h * 0.7);
    siblings.forEach(sib => {
        if(Math.abs(sib.y - source.y) > rowSlop) return;
        nextX = Math.max(nextX, sib.x + sib.w + gap);
    });
    return Math.max(0, nextX - packedLeft);
}

assert.equal(imageEditSpawnOffsetX({x:0, y:0, w:400, h:400}, []), 0);
assert.equal(imageEditSpawnOffsetX({x:0, y:0, w:400, h:400}, [{x:0, y:800, w:400, h:400}]), 0);
assert.equal(imageEditSpawnOffsetX({x:0, y:0, w:400, h:400}, [{x:424, y:0, w:400, h:400}]), 424);

const spawn = eng.slice(
    eng.indexOf('const IMAGE_DERIVED_NODE_GAP_X'),
    eng.indexOf('\nfunction imageEditorOutputNode('),
);

const checks = [
    [/IMAGE_DERIVED_NODE_GAP_X\s*=\s*24/.test(eng), 'toolbar spawn gap is 24'],
    [spawn.includes('el?.offsetWidth'), 'spawn size prefers live DOM width'],
    [eng.includes('function imageEditSpawnOffsetX('), 'shared offset helper'],
    [!eng.includes('offsetX += nodeEditSpawnLayoutSize(sib).w + 36'), 'no summed sibling widths'],
    [(eng.match(/imageEditSpawnOffsetX\(sourceNode\)/g) || []).length >= 8, 'all toolbar spawns use helper'],
];

let failed = 0;
for(const [ok, label] of checks){
    if(!ok){
        console.error('FAIL:', label);
        failed++;
    } else console.log('OK:', label);
}
if(failed){
    console.error(`\n${failed} check(s) failed`);
    process.exit(1);
}
console.log('\ncheck-image-edit-spawn-gap: all passed');
