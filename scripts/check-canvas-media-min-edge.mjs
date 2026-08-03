/** 最短边归一：1:1 边长须等于 9:16 / 16:9 的最短边 */
const CANVAS_MEDIA_MIN_EDGE = 496;

function canvasFitByMinEdge(nw, nh, minEdge = CANVAS_MEDIA_MIN_EDGE){
    const W = Math.max(1, Number(nw) || 1);
    const H = Math.max(1, Number(nh) || 1);
    const edge = Math.max(48, Number(minEdge) || CANVAS_MEDIA_MIN_EDGE);
    const scale = edge / Math.min(W, H);
    return {
        w: Math.max(48, Math.round(W * scale)),
        h: Math.max(48, Math.round(H * scale)),
    };
}

const square = canvasFitByMinEdge(1024, 1024);
const portrait = canvasFitByMinEdge(1080, 1920); // 9:16
const landscape = canvasFitByMinEdge(1920, 1080); // 16:9

const assert = (cond, msg) => {
    if(!cond) throw new Error(msg);
};

assert(square.w === CANVAS_MEDIA_MIN_EDGE && square.h === CANVAS_MEDIA_MIN_EDGE, `1:1 expected ${CANVAS_MEDIA_MIN_EDGE}`);
assert(Math.min(portrait.w, portrait.h) === CANVAS_MEDIA_MIN_EDGE, '9:16 short edge mismatch');
assert(Math.min(landscape.w, landscape.h) === CANVAS_MEDIA_MIN_EDGE, '16:9 short edge mismatch');
assert(square.w === Math.min(portrait.w, portrait.h), '1:1 side must equal 9:16 short side');
assert(square.w === Math.min(landscape.w, landscape.h), '1:1 side must equal 16:9 short side');
assert(portrait.h === landscape.w, '9:16 long edge should equal 16:9 long edge');

console.log('check-canvas-media-min-edge: pass', {square, portrait, landscape});
