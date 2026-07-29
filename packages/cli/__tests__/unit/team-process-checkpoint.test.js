import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  TeamProcessCheckpointBroker,
  WORKSPACE_TRANSACTION_COVERAGE,
} from "../../src/lib/agent-team/team-process-checkpoint.js";
import { WorkspaceTransactionManager } from "../../src/lib/process-execution-broker/workspace-transaction.js";

const roots = [];

function fixture() {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-team-process-checkpoint-"),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const stateDir = path.join(root, "state");
  fs.mkdirSync(workspaceRoot);
  fs.writeFileSync(path.join(workspaceRoot, "task.txt"), "before\n", "utf8");
  const manager = new WorkspaceTransactionManager({
    stateDir,
    lockDir: path.join(root, "locks"),
    allowNonCanonicalLockDirForTests: true,
    uuid: () => "00000000-0000-4000-8000-000000000001",
    ownerToken: () => "00000000-0000-4000-8000-000000000002",
  });
  const broker = {
    beginWorkspaceTransaction: (options) => manager.begin(options),
    recoverWorkspaceTransactions: (options) => manager.recoverPending(options),
    inspectWorkspaceTransaction: (id) => manager.inspect(id),
    listWorkspaceTransactions: (options) => manager.list(options),
    restoreWorkspaceTransaction: (id, options) => manager.restore(id, options),
    undoWorkspaceTransactionRestore: (id, options) =>
      manager.undoRestore(id, options),
  };
  return {
    root,
    workspaceRoot,
    stateDir,
    guard: new TeamProcessCheckpointBroker({
      broker,
      stateDir,
      coverageTarget: WORKSPACE_TRANSACTION_COVERAGE.FULL,
      writerIsolation: "exclusive-workspace",
    }),
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("TeamProcessCheckpointBroker", () => {
  it("returns durable checkpoint evidence after a successful task", async () => {
    const input = fixture();
    const outcome = await input.guard.executeTask(
      {
        runId: "team-run",
        taskKey: "task-a",
        workspaceRoot: input.workspaceRoot,
        externalSideEffects: false,
      },
      async ({ checkpointId, workspaceRoot }) => {
        fs.writeFileSync(
          path.join(workspaceRoot, "task.txt"),
          "after\n",
          "utf8",
        );
        return { ok: true, checkpointId };
      },
    );
    expect(outcome.result).toMatchObject({ ok: true });
    expect(outcome.checkpoint).toMatchObject({
      checkpointId: outcome.result.checkpointId,
      outcome: "committed",
      fileCoverage: WORKSPACE_TRANSACTION_COVERAGE.FULL,
      coverage: WORKSPACE_TRANSACTION_COVERAGE.FULL,
    });
    expect(
      input.guard.inspectCheckpoint(outcome.checkpoint.transactionId),
    ).toMatchObject({
      id: outcome.checkpoint.transactionId,
      runId: "team-run",
      taskKey: "task-a",
      state: "committed",
    });
    expect(
      input.guard.listCheckpoints({
        workspaceRoot: input.workspaceRoot,
      }),
    ).toEqual([
      expect.objectContaining({
        id: outcome.checkpoint.transactionId,
        state: "committed",
        runId: "team-run",
        taskKey: "task-a",
      }),
    ]);
  });

  it("rolls back an interrupted task before rethrowing its error", async () => {
    const input = fixture();
    const interrupted = Object.assign(new Error("human interrupt"), {
      name: "AbortError",
      code: "ABORT_ERR",
    });
    await expect(
      input.guard.executeTask(
        {
          runId: "team-run",
          taskKey: "task-a",
          workspaceRoot: input.workspaceRoot,
        },
        async ({ workspaceRoot }) => {
          fs.writeFileSync(
            path.join(workspaceRoot, "task.txt"),
            "partial\n",
            "utf8",
          );
          throw interrupted;
        },
      ),
    ).rejects.toBe(interrupted);
    expect(interrupted.workspaceCheckpoint).toMatchObject({
      outcome: "rolled_back",
      rollbackReason: "task interrupted",
    });
    expect(
      fs.readFileSync(path.join(input.workspaceRoot, "task.txt"), "utf8"),
    ).toBe("before\n");
  });

  it("does not misreport rollback failure for a frozen task error", async () => {
    const input = fixture();
    const frozenError = Object.freeze(new Error("frozen task failure"));

    await expect(
      input.guard.executeTask(
        {
          runId: "team-run",
          taskKey: "task-frozen",
          workspaceRoot: input.workspaceRoot,
        },
        async ({ workspaceRoot }) => {
          fs.writeFileSync(
            path.join(workspaceRoot, "task.txt"),
            "partial\n",
            "utf8",
          );
          throw frozenError;
        },
      ),
    ).rejects.toBe(frozenError);

    expect(
      fs.readFileSync(path.join(input.workspaceRoot, "task.txt"), "utf8"),
    ).toBe("before\n");
    expect(
      input.guard.listCheckpoints({ workspaceRoot: input.workspaceRoot }),
    ).toEqual([
      expect.objectContaining({
        taskKey: "task-frozen",
        state: "rolled_back",
      }),
    ]);
  });
});
