/**
 * 并发生成槽位序自检：后完成的任务不得插到先完成任务前面。
 */
function reserve(ready, pendingIds) {
  return [
    ...ready.map((url) => ({ kind: "url", url })),
    ...pendingIds.map((id) => ({ kind: "pending", id })),
  ];
}

function fill(slots, pendingId, url) {
  const next = slots.map((s) => ({ ...s }));
  const idx = next.findIndex((s) => s.kind === "pending" && s.id === pendingId);
  if (idx < 0) next.push({ kind: "url", url });
  else next[idx] = { kind: "url", url };
  return next;
}

function urlsOf(slots) {
  return slots.filter((s) => s.kind === "url").map((s) => s.url);
}

// 已有 A；一次出 3 张；完成顺序 p1 → p0 → p2
let slots = reserve(["A"], ["p0", "p1", "p2"]);
slots = fill(slots, "p1", "B");
slots = fill(slots, "p0", "C");
slots = fill(slots, "p2", "D");

const got = urlsOf(slots);
const expect = ["A", "C", "B", "D"]; // 槽位序：p0=C, p1=B, p2=D；不是完成序 A,B,C,D
if (JSON.stringify(got) !== JSON.stringify(expect)) {
  console.error("FAIL slot order", { got, expect });
  process.exit(1);
}

// 旧逻辑（ready+pending 拼接）会变成完成序
const buggy = ["A", "B", "C", "D"];
if (JSON.stringify(got) === JSON.stringify(buggy)) {
  console.error("FAIL unexpectedly matched completion order");
  process.exit(1);
}

console.log("ok", got);
console.log("check-gen-stage-order: pass");
