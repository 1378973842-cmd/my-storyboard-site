import assert from "node:assert/strict";
import Database from "better-sqlite3";
import {
  hashCanonicalParams,
  initCanvasTaskLedger,
  readCanvasTask,
  saveCanvasTask,
} from "../src/services/canvasTaskLedger.js";

const db = new Database(":memory:");
initCanvasTaskLedger(db);
const now = Date.now();
assert.equal(
  hashCanonicalParams({ b: 2, a: 1, omitted: null }),
  hashCanonicalParams({ a: 1, b: 2 })
);
assert.equal(hashCanonicalParams({ value: 8 }), hashCanonicalParams({ value: 8.0 }));
assert.equal(
  hashCanonicalParams({ value: 1.12345641 }),
  hashCanonicalParams({ value: 1.12345649 })
);

saveCanvasTask(db, {
  id: "task-running",
  userId: "user-a",
  canvasId: "canvas-a",
  nodeId: "node-a",
  taskType: "canvas-image",
  payload: { prompt: "fixture" },
  status: "running",
  createdAt: now,
  updatedAt: now,
  result: null,
  error: "",
});
assert.equal(readCanvasTask(db, "task-running", "user-b"), null);

initCanvasTaskLedger(db);
const interrupted = readCanvasTask(db, "task-running", "user-a");
assert.equal(interrupted?.status, "failed");
assert.match(interrupted?.error || "", /避免重复扣费/);

saveCanvasTask(db, {
  ...interrupted!,
  status: "succeeded",
  result: { url: "/uploads/fixture.png" },
  error: "",
  updatedAt: now + 1,
});
initCanvasTaskLedger(db);
const completed = readCanvasTask<{ url: string }>(db, "task-running", "user-a");
assert.equal(completed?.status, "succeeded");
assert.equal(completed?.result?.url, "/uploads/fixture.png");
const audit = db.prepare(
  "SELECT params_hash_at_run, outcome FROM canvas_task_runs WHERE task_id = ?"
).get("task-running") as { params_hash_at_run: string; outcome: string };
assert.equal(audit.params_hash_at_run.length, 16);
assert.equal(audit.outcome, "success");

db.close();
console.log("canvas-task-ledger self-check: ok");
