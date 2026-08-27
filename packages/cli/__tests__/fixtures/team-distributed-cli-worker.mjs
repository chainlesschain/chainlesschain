import { runDistributedWorker } from "../../src/commands/team-distributed.js";
import { TeamDistributedQueue } from "../../src/lib/agent-team/team-distributed-queue.js";
import executionBroker from "../../src/lib/process-execution-broker/index.js";

const [state, repo, runId, workerId, mode = "run"] = process.argv.slice(2);

// This fixture proves real multi-process queue/worktree coordination. Native
// sandbox enforcement has its own live and Strict Sandbox suites; keeping it
// here would make the queue journey depend on host ACL helper latency.
executionBroker._prepareSandboxPlan = (
  command,
  args,
  options,
  context = {},
) => ({
  contractVersion: 1,
  applied: true,
  platform: process.platform,
  profile: context.sandboxPolicy?.profile || "default",
  command,
  args: [...(args || [])],
  options: { ...options },
  enforcement: "test-process-tree",
  backend: "test-process-tree",
  guarantees: ["process-tree"],
  requiredBoundaries: [...(context.sandboxPolicy?.requiredBoundaries || [])],
  reason: null,
  postSpawn: { required: false, mode: "none" },
  cleanup() {},
});

try {
  if (mode === "crash") {
    const queue = TeamDistributedQueue.open({ filePath: state, runId });
    const claim = queue.claim({
      holder: workerId,
      ttlMs: 300_000,
    });
    process.stdout.write(`${JSON.stringify({ ok: claim.ok, claim })}\n`);
    process.exit(claim.ok ? 0 : 2);
  }
  const result = await runDistributedWorker({
    state,
    repo,
    runId,
    workerId,
    ttlMs: 300_000,
    renewEveryMs: 5_000,
  });
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      workerId: result.workerId,
      executions: result.summary.executions,
      completed: result.completed.map((item) => item.key),
      pendingAdjudications: result.queue.pendingAdjudications,
      failures: result.events.filter((event) =>
        ["task:failed", "run:fatal"].includes(event.type),
      ),
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      code: error?.code || null,
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
}
