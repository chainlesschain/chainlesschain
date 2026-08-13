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

function sleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function testDuration(name, fallback, { allowZero = false } = {}) {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (allowZero ? value < 0 : value <= 0)) {
    throw new TypeError(
      `${name} must be ${allowZero ? "non-negative" : "positive"}`,
    );
  }
  return value;
}

const competeDeadlineMs = testDuration(
  "CC_TEST_TEAM_QUEUE_COMPETE_DEADLINE_MS",
  40_000,
);
const competeLockTimeoutMs = testDuration(
  "CC_TEST_TEAM_QUEUE_LOCK_TIMEOUT_MS",
  1_000,
);
const competeLockYieldMs = testDuration("CC_TEST_TEAM_QUEUE_LOCK_YIELD_MS", 5, {
  allowZero: true,
});
const queue = new TeamDistributedQueue({
  filePath,
  ...(mode === "compete"
    ? {
        lockTimeoutMs: competeLockTimeoutMs,
        lockYieldAfterReleaseMs: competeLockYieldMs,
      }
    : {}),
});

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
let lockRetries = 0;
const competeDeadline = Date.now() + competeDeadlineMs;

function withCompeteLockRetry(operation) {
  for (;;) {
    try {
      return operation();
    } catch (error) {
      if (
        error?.code !== "TEAM_QUEUE_LOCK_FAILED" ||
        error?.cause?.code !== "STATE_LOCK_UNAVAILABLE" ||
        Date.now() >= competeDeadline
      ) {
        throw error;
      }
      lockRetries += 1;
      sleep(Math.min(20, Math.max(1, competeDeadline - Date.now())));
    }
  }
}

let allDone = false;
while (idleRounds < 2_000 && Date.now() < competeDeadline) {
  const claim = withCompeteLockRetry(() =>
    queue.claim({ holder, ttlMs: 10_000 }),
  );
  if (claim.ok) {
    idleRounds = 0;
    const settled = withCompeteLockRetry(() =>
      queue.complete(claim.key, {
        holder,
        leaseId: claim.lease.leaseId,
        result: { completedByPid: process.pid },
      }),
    );
    if (!settled.ok) {
      output({ pid: process.pid, completed, claim, settled, lockRetries });
      process.exit(3);
    }
    completed.push(claim.key);
    continue;
  }
  allDone = withCompeteLockRetry(() => queue.allDone());
  if (allDone) break;
  if (
    claim.reason !== "no_claimable_task" &&
    !claim.reason?.startsWith("max-")
  ) {
    output({ pid: process.pid, completed, claim, lockRetries });
    process.exit(4);
  }
  idleRounds += 1;
  sleep(2);
}

if (!allDone && Date.now() < competeDeadline) {
  allDone = withCompeteLockRetry(() => queue.allDone());
}
output({
  pid: process.pid,
  completed,
  allDone,
  lockRetries,
  deadlineExceeded: Date.now() >= competeDeadline,
});
process.exit(allDone ? 0 : 5);
