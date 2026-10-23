import { spawnSync } from "node:child_process";

const checks = [
  ["node", ["scripts/check-canvas-task-isolation.mjs"]],
  ["node", ["scripts/check-rh-task-resume.mjs"]],
  ["node", ["scripts/check-video-task-resume.mjs"]],
  ["node", ["scripts/check-undo-force-render.mjs"]],
  ["node", ["--import", "tsx", "scripts/check-canvas-agent-precondition.mjs"]],
  ["npx", ["tsx", "src/features/canvas-agent/check.ts"]],
  ["npx", ["tsx", "scripts/check-canvas-agent-evals.ts"]],
  ["npx", ["tsx", "scripts/check-fake-text-llm.ts"]],
  ["npx", ["tsx", "scripts/check-canvas-task-ledger.ts"]],
  ["npx", ["tsx", "scripts/check-canvas-content-fidelity.ts"]],
  ["node", ["scripts/check-server-task-ledger.mjs"]],
  ["npx", ["tsx", "scripts/check-canvas-agent-conversations.ts"]],
  ["node", ["scripts/check-canvas-connect-reason.mjs"]],
  ["node", ["--experimental-strip-types", "scripts/check-canvas-delete-save.mjs"]],
];

for (const [command, args] of checks) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    shell: process.platform === "win32",
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) {
    console.error(`critical check failed: ${command} ${args.join(" ")}`);
    process.exit(result.status || 1);
  }
}

console.log(`critical checks: ${checks.length}/${checks.length} passed`);


