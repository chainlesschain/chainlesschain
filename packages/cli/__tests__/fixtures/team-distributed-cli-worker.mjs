import { runDistributedWorker } from "../../src/commands/team-distributed.js";
import { TeamDistributedQueue } from "../../src/lib/agent-team/team-distributed-queue.js";

const [state, repo, runId, workerId, mode = "run"] = process.argv.slice(2);

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
