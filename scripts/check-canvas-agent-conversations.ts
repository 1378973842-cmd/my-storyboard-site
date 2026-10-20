import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import {
  appendCanvasAgentMessage,
  createCanvasAgentConversation,
  deleteCanvasAgentConversation,
  initCanvasAgentConversationSchema,
  listCanvasAgentConversations,
  listCanvasAgentMessages,
  renameCanvasAgentConversation,
  resolveCanvasAgentConversation,
} from "../src/features/canvas-agent/server/conversationStore.js";

const db = new Database(":memory:");
initCanvasAgentConversationSchema(db);

const first = createCanvasAgentConversation(db, "user-a", "canvas-a", "第一场雨夜");
createCanvasAgentConversation(db, "user-a", "canvas-b", "其它画布");
createCanvasAgentConversation(db, "user-b", "canvas-a", "其它用户");
assert.deepEqual(
  listCanvasAgentConversations(db, "user-a", "canvas-a").map((item) => item.id),
  [first.id],
);

appendCanvasAgentMessage(db, "user-a", first.id, "user", "创建三个镜头");
appendCanvasAgentMessage(db, "user-a", first.id, "assistant", "建议已准备", {
  proposal: { id: "proposal-fixture", status: "pending" },
});
const messages = listCanvasAgentMessages(db, "user-a", first.id);
assert.equal(messages.length, 2);
assert.equal((messages[1].metadata.proposal as { id: string }).id, "proposal-fixture");
assert.deepEqual(listCanvasAgentMessages(db, "user-b", first.id), []);

assert.throws(
  () => resolveCanvasAgentConversation(
    db,
    "user-a",
    "canvas-b",
    first.id,
    "不应跨画布",
  ),
  /不属于当前画布/,
);

const renamed = renameCanvasAgentConversation(db, "user-a", first.id, "雨夜追逐");
assert.equal(renamed?.title, "雨夜追逐");
assert.equal(deleteCanvasAgentConversation(db, "user-b", first.id), false);
assert.equal(deleteCanvasAgentConversation(db, "user-a", first.id), true);
assert.equal(listCanvasAgentMessages(db, "user-a", first.id).length, 0);

const panel = readFileSync(
  "src/features/canvas-agent/ui/AgentFloatingPanel.tsx",
  "utf8",
);
const css = readFileSync(
  "src/features/canvas-agent/ui/canvas-agent.css",
  "utf8",
);
assert.match(panel, /loadAgentConversation/);
// 重开时的状态保持由 check.ts 直接调用 proposalOnReopen 测，
// 不在这里锁源码文本——
// 这个字面量现在在 proposalPersistence.ts，
// 文本锁锁的是实现位置而不是行为。
assert.match(panel, /canvas-agent-open/);
assert.match(panel, /切换为浮窗/);
assert.match(panel, /停靠在右侧/);
assert.match(panel, /beginPanelDrag/);
assert.match(panel, /requestAnimationFrame\(paint\)/);
assert.match(panel, /resolveFloatingPlacement/);
assert.match(panel, /FLOATING_OBSTACLE_SELECTOR/);
assert.match(panel, /原节点重做/);
assert.match(panel, /mentionQueryAt/);
assert.match(css, /\.canvas-agent-mentions/);
assert.doesNotMatch(
  panel.slice(panel.indexOf('const beginPanelDrag'), panel.indexOf('const beginResize')),
  /setFloatingPosition\(\{[\s\S]*moveEvent\.clientX/,
);
assert.match(css, /\.infinite-canvas-root\.canvas-agent-open \.minimap/);
assert.match(css, /html\.canvas-image-edit-open \.canvas-agent-layer/);
assert.match(css, /\.canvas-agent-panel\.is-expanded\s*\{\s*top:\s*72px/);
assert.match(css, /\.canvas-agent-panel\.is-floating/);
assert.match(css, /\.canvas-agent-panel\.is-floating\.is-dragging/);
assert.match(css, /@media \(max-width: 720px\)/);

db.close();
console.log("canvas-agent-conversations self-check: ok");
