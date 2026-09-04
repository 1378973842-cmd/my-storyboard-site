/**
 * 画笔不得画到图片外：笔迹层用宿主本地像素（扣除 world scale），
 * 且只在 #editDrawCanvas 上起笔。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const eng = fs.readFileSync(path.join(root, 'src/lib/infiniteCanvas/canvasEngine.js'), 'utf8');

function clientRectToHostLocal(hostOffsetW, hostOffsetH, hr, rect){
    const sx = hr.width / Math.max(1, hostOffsetW);
    const sy = hr.height / Math.max(1, hostOffsetH);
    return {
        left: (rect.left - hr.left) / sx,
        top: (rect.top - hr.top) / sy,
        width: rect.width / sx,
        height: rect.height / sy,
    };
}

function replacedObjectFitBox(nw, nh, cw, ch, fit){
    if(nw < 2 || nh < 2 || cw < 1 || ch < 1) return { left: 0, top: 0, width: cw, height: ch };
    if(fit === 'contain' || fit === 'scale-down'){
        const scale = Math.min(cw / nw, ch / nh);
        const w = nw * scale;
        const h = nh * scale;
        return { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h };
    }
    return { left: 0, top: 0, width: cw, height: ch };
}

const scaled = clientRectToHostLocal(400, 300, { left: 100, top: 50, width: 800, height: 600 }, { left: 100, top: 50, width: 800, height: 600 });
assert.equal(Math.round(scaled.left), 0);
assert.equal(Math.round(scaled.top), 0);
assert.equal(Math.round(scaled.width), 400);
assert.equal(Math.round(scaled.height), 300);

const letterbox = replacedObjectFitBox(200, 100, 400, 400, 'contain');
assert.equal(Math.round(letterbox.width), 400);
assert.equal(Math.round(letterbox.height), 200);
assert.equal(Math.round(letterbox.top), 100);

const checks = [
    [eng.includes('function clientRectToHostLocal('), 'scale-aware host local rect helper'],
    [eng.includes('host.offsetWidth'), 'divides client rect by host offsetWidth'],
    [eng.includes('function replacedObjectFitBox('), 'object-fit content box helper'],
    [eng.includes('objectFit') && eng.includes('contain'), 'contain letterbox inset'],
    [eng.includes("if(!event.target.closest('#editDrawCanvas')) return;"), 'brush starts only on draw canvas'],
    [!/closest\('\.crop-canvas, #cropCanvas, #editDrawCanvas'\)/.test(eng), 'no longer starts brush on whole crop host'],
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
console.log('\ncheck-brush-clip-to-image: all passed');
