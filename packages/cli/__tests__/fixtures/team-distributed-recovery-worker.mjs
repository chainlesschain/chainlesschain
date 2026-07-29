import { runDistributedWorker } from "../../src/commands/team-distributed.js";
import { TeamProcessCheckpointBroker } from "../../src/lib/agent-team/team-process-checkpoint.js";
import fs from "node:fs";
import path from "node:path";

const [state, repo, runId, workerId, sentinel] = process.argv.slice(2);

class RollbackInterruptionBroker extends TeamProcessCheckpointBroker {
  beginTask(options = {}) {
    const guard = super.beginTask(options);
    return new Proxy(guard, {
      get(target, property, receiver) {
        if (property === "rollback") {
          return () => {
            const error = new Error(
              "injected worker death before checkpoint rollback settlement",
            );
            error.code = "INJECTED_CHECKPOINT_ROLLBACK_INTERRUPTION";
            throw error;
          };
        }
        const value = Reflect.get(target, property, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  }
}

try {
  const result = await runDistributedWorker(
    {
      state,
      repo,
      runId,
      workerId,
      maxTasks: 1,
    },
    {
      CheckpointBroker: RollbackInterruptionBroker,
      agentExecutor: async (_prompt, cwd) => {
        fs.writeFileSync(path.join(cwd, "must-rollback.txt"), "unsafe\n");
        if (sentinel) fs.writeFileSync(sentinel, "attempted\n");
        const error = new Error("injected deterministic Agent failure");
        error.usage = { input_tokens: 2, output_tokens: 1 };
        error.provider = "openai";
        error.model = "gpt-4o";
        throw error;
      },
    },
  );
  process.stdout.write(
    `${JSON.stringify({
      ok: true,
      success: result.summary.success,
      executions: result.summary.executions,
      pendingAdjudications: result.queue.pendingAdjudications,
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
