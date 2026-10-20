import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const engine = readFileSync("src/lib/infiniteCanvas/canvasEngine.js", "utf8");
const ledger = readFileSync("src/services/canvasTaskLedger.ts", "utf8");
const routes = readFileSync("src/services/infiniteCanvasRoutes.ts", "utf8");

assert.match(ledger, /CREATE TABLE IF NOT EXISTS canvas_task_bindings/);
assert.match(ledger, /app\.get\("\/api\/canvas-task-ledger"/);
assert.match(ledger, /app\.post\("\/api\/canvas-task-ledger"/);
assert.match(ledger, /app\.delete\("\/api\/canvas-task-ledger\/:taskId"/);
assert.match(routes, /registerCanvasTaskLedgerRoutes\(app, deps\.db, gate\)/);
assert.match(engine, /hydrateServerCanvasTaskLedger/);
assert.match(engine, /apiFetch\('\/api\/canvas-task-ledger'/);
assert.match(engine, /canvasTaskType === 'runninghub'/);

console.log("server-task-ledger self-check: ok");
