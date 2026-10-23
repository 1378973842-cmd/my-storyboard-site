import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { actionsReleasedForApproval } from "../src/features/canvas-agent/core/runApproval";
import {
  actionProposalNeedsApproval,
  proposalWaitsForClick,
  stripCreatesOnShortYes,
} from "../src/features/canvas-agent/core/proposal";
import type { CanvasAction } from "../src/features/canvas-agent/types";

type GoldenCase = {
  id: string;
  message: string;
  mode: "confirm" | "auto";
  actions: CanvasAction[];
  expect: {
    waits?: boolean;
    requiresApproval?: boolean;
    afterShortYes?: number;
    releasedWithoutApproval?: number;
    releasedWithApproval?: number;
  };
};

const golden = JSON.parse(
  readFileSync(new URL("../prompts/evals/canvas-agent-golden.json", import.meta.url), "utf8"),
) as { cases: GoldenCase[] };

assert.ok(golden.cases.length >= 4, "eval 至少要有 4 个用例");

let passed = 0;
const failures: string[] = [];
golden.cases.forEach((item) => {
  try {
    const actions = item.actions as CanvasAction[];
    if (item.expect.waits !== undefined) {
      assert.equal(
        proposalWaitsForClick(item.mode, { actions }),
        item.expect.waits,
        `${item.id}: waits`,
      );
    }
    if (item.expect.requiresApproval !== undefined) {
      assert.equal(
        actionProposalNeedsApproval(actions),
        item.expect.requiresApproval,
        `${item.id}: requiresApproval`,
      );
    }
    if (item.expect.afterShortYes !== undefined) {
      assert.equal(
        stripCreatesOnShortYes(actions, item.message).length,
        item.expect.afterShortYes,
        `${item.id}: afterShortYes`,
      );
    }
    const released = actionsReleasedForApproval(actions, new Set<string>());
    if (item.expect.releasedWithoutApproval !== undefined) {
      assert.equal(released.length, item.expect.releasedWithoutApproval, `${item.id}: released 0`);
    }
    const releasedAll = actionsReleasedForApproval(
      actions,
      new Set(actions.flatMap((action) => (action.type === "execute_node_skill" ? [action.nodeId] : []))),
    );
    if (item.expect.releasedWithApproval !== undefined) {
      assert.equal(releasedAll.length, item.expect.releasedWithApproval, `${item.id}: released all`);
    }
    passed += 1;
  } catch (error) {
    failures.push(error instanceof Error ? error.message : String(error));
  }
});

if (failures.length) {
  console.error(`eval failures:\n${failures.map((item) => `  - ${item}`).join("\n")}`);
  process.exit(1);
}
console.log(`canvas-agent evals: ${passed}/${golden.cases.length} passed`);
