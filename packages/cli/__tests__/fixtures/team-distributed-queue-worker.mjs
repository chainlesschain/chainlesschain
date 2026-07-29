import { TeamDistributedQueue } from "../../src/lib/agent-team/team-distributed-queue.js";

const [
  filePath,
  mode,
  holder = `worker-${process.pid}`,
  maxTokensArgument,
  maxUsdArgument,
  holdMsArgument,
  ...remainingArguments
] = process.argv.slice(2);

if (!filePath || !mode) {
  process.stderr.write("usage: worker <state-path> <compete|crash|rescue>\n");
  process.exit(64);
}

const queue = new TeamDistributedQueue({ filePath });

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

if (mode === "adjudicate") {
  const taskKey = maxTokensArgument;
  const decision = maxUsdArgument;
  const decisionId = holdMsArgument;
  const evidenceDigest = remainingArguments[0];
  const resolved = queue.resolveAdjudication(taskKey, {
    decision,
    decisionId,
    actor: holder,
    evidenceDigest,
  });
  output({ pid: process.pid, resolved });
  process.exit(resolved.ok ? 0 : 2);
}

if (mode === "crash") {
  const claim = queue.claim({ holder, ttlMs: 60_000 });
  output({ pid: process.pid, claim });
  // Deliberately leave the lease unsettled. process.exit models a worker that
  // disappears without running application cleanup or releasing its lease.
  process.exit(claim.ok ? 0 : 2);
}

if (mode === "rescue") {
  const claim = queue.claim({ holder, ttlMs: 60_000 });
  if (!claim.ok) {
    output({ pid: process.pid, claim });
    process.exit(2);
  }
  const settled = queue.complete(claim.key, {
    holder,
    leaseId: claim.lease.leaseId,
    result: { completedByPid: process.pid },
  });
  output({ pid: process.pid, claim, settled });
  process.exit(settled.ok ? 0 : 3);
}

if (mode === "budget-claim") {
  const maxTokens = Number(maxTokensArgument);
  const maxUsd = Number(maxUsdArgument);
  const holdMs = Number(holdMsArgument) || 0;
  const claim = queue.claim({
    holder,
    ttlMs: 10_000,
    maxTokens,
    maxUsd,
  });
  if (!claim.ok) {
    output({ pid: process.pid, claim });
    process.exit(0);
  }
  sleep(holdMs);
  const settled = queue.complete(claim.key, {
    holder,
    leaseId: claim.lease.leaseId,
    usage: { input_tokens: maxTokens, output_tokens: 0 },
    costUsd: maxUsd,
  });
  output({ pid: process.pid, claim, settled });
  process.exit(settled.ok ? 0 : 3);
}

if (mode !== "compete") {
  process.stderr.write(`unknown worker mode: ${mode}\n`);
  process.exit(64);
}

const completed = [];
let idleRounds = 0;
while (idleRounds < 2_000) {
  const claim = queue.claim({ holder, ttlMs: 10_000 });
  if (claim.ok) {
    idleRounds = 0;
    const settled = queue.complete(claim.key, {
      holder,
      leaseId: claim.lease.leaseId,
      result: { completedByPid: process.pid },
    });
    if (!settled.ok) {
      output({ pid: process.pid, completed, claim, settled });
      process.exit(3);
    }
    completed.push(claim.key);
    continue;
  }
  if (queue.allDone()) break;
  if (
    claim.reason !== "no_claimable_task" &&
    !claim.reason?.startsWith("max-")
  ) {
    output({ pid: process.pid, completed, claim });
    process.exit(4);
  }
  idleRounds += 1;
  sleep(2);
}

output({ pid: process.pid, completed, allDone: queue.allDone() });
process.exit(queue.allDone() ? 0 : 5);
