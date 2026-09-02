import fs from "node:fs";
import {
  finalizeDistributedQueue,
  TeamDistributedCliError,
} from "../../src/commands/team-distributed.js";
import { TeamWorktreeCoordinator } from "../../src/lib/agent-team/team-worktree.js";

const [
  state,
  repo,
  runId,
  mode = "normal",
  finalizerId = "fixture-finalizer",
  readyPath = null,
] = process.argv.slice(2);

class FinalizeFixtureCoordinator extends TeamWorktreeCoordinator {
  integrate(options = {}) {
    if (mode === "slow" && options.merge !== true) {
      if (readyPath) {
        fs.writeFileSync(readyPath, "ready\n");
        const releasePath = `${readyPath}.release`;
        const deadline = Date.now() + 30_000;
        while (!fs.existsSync(releasePath) && Date.now() < deadline) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
        }
      } else {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);
      }
    }
    const result = super.integrate(options);
    if (mode === "kill-merge" && options.merge === true) {
      process.exit(86);
    }
    return result;
  }

  cleanupAll(options = {}) {
    const result = super.cleanupAll(options);
    if (mode === "kill-cleanup") {
      process.exit(87);
    }
    return result;
  }
}

try {
  const result = finalizeDistributedQueue(
    {
      state,
      repo,
      runId,
      merge: true,
      finalizerId,
      ttlMs: 60_000,
    },
    {
      WorktreeCoordinator: FinalizeFixtureCoordinator,
    },
  );
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      phase: result.finalization.phase,
      idempotent: result.idempotent === true,
    })}\n`,
  );
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({
      ok: false,
      code:
        error instanceof TeamDistributedCliError
          ? error.code
          : error?.code || null,
      message: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 2;
}
