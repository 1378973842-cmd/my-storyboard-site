/**
 * 生图任务画布隔离：完成回调不得把结果落到「当前打开」的非归属画布。
 * ponytail: 纯函数抽出便于 assert；引擎侧只做停泊/落板。
 */

/** 归属画布 ≠ 当前画布 → 必须停泊，禁止落当前板 */
export function shouldParkTaskResult(ownerCanvasId, currentCanvasId){
    const owner = String(ownerCanvasId || '').trim();
    const cur = String(currentCanvasId || '').trim();
    if(!owner || !cur) return false;
    return owner !== cur;
}

/** 仅当归属为空（旧任务）或与当前一致时，才允许孤儿落当前板 */
export function canOrphanOntoCurrent(ownerCanvasId, currentCanvasId){
    const owner = String(ownerCanvasId || '').trim();
    const cur = String(currentCanvasId || '').trim();
    if(!cur) return false;
    if(!owner) return true;
    return owner === cur;
}
