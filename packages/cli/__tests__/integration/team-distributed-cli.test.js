import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adjudicateDistributedQueue,
  distributedQueueStatus,
  finalizeDistributedQueue,
  initDistributedQueue,
  interruptDistributedQueue,
  recoverDistributedQueueCheckpoint,
  runDistributedWorker,
} from "../../src/commands/team-distributed.js";
import { TeamDistributedQueue } from "../../src/lib/agent-team/team-distributed-queue.js";
import { TeamProcessCheckpointBroker } from "../../src/lib/agent-team/team-process-checkpoint.js";
import executionBroker from "../../src/lib/process-execution-broker/index.js";
import {
  SECURE_FILE_IDENTITY_ERROR,
  SecureFileIdentityError,
  isAffectedWindowsZeroDeviceStatRuntime,
} from "../../src/lib/secure-file-identity.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const workerFixture = path.resolve(
  here,
  "../fixtures/team-distributed-cli-worker.mjs",
);
const recoveryWorkerFixture = path.resolve(
  here,
  "../fixtures/team-distributed-recovery-worker.mjs",
);
const temporaryDirectories = [];

function git(repo, ...args) {
  return execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function makeRepo(name = "repo") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-team-cli-"));
  temporaryDirectories.push(root);
  const repo = path.join(root, name);
  const authority = path.join(root, "authority");
  fs.mkdirSync(repo);
  fs.mkdirSync(authority, { mode: 0o700 });
  git(repo, "init");
  git(repo, "config", "user.name", "Team Test");
  git(repo, "config", "user.email", "team-test@example.invalid");
  fs.writeFileSync(path.join(repo, "README.md"), "base\n");
  git(repo, "add", "README.md");
  git(repo, "commit", "-m", "base");
  return {
    root,
    repo,
    state: path.join(authority, "queue.json"),
    graph: path.join(authority, "tasks.json"),
  };
}

function writeGraph(location, tasks) {
  fs.writeFileSync(location, `${JSON.stringify({ tasks }, null, 2)}\n`, {
    mode: 0o600,
  });
}

function statProjection(stat, overrides) {
  return new Proxy(stat, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function projectedFileSystem(filePath, overrides) {
  const runtimeFs = Object.create(fs);
  const nativeLstatSync = fs.lstatSync.bind(fs);
  const canonicalFilePath = path.join(
    fs.realpathSync.native(path.dirname(filePath)),
    path.basename(filePath),
  );
  runtimeFs.lstatSync = (target, options) => {
    const stat = nativeLstatSync(target, options);
    return path.resolve(String(target)) === path.resolve(canonicalFilePath)
      ? statProjection(stat, overrides)
      : stat;
  };
  return runtimeFs;
}

function createDirectoryAlias(target, alias) {
  try {
    fs.symlinkSync(
      target,
      alias,
      process.platform === "win32" ? "junction" : "dir",
    );
    return true;
  } catch (error) {
    if (
      process.platform === "win32" &&
      ["EACCES", "EPERM", "ENOTSUP"].includes(error?.code)
    ) {
      return false;
    }
    throw error;
  }
}

function nodeWrite(file, value, { delay = 0, requireFiles = [] } = {}) {
  const assertions = requireFiles
    .map(
      (required) =>
        `if(!fs.existsSync(${JSON.stringify(required)}))process.exit(9);`,
    )
    .join("");
  const source = `const fs=require('fs');setTimeout(()=>{${assertions}fs.writeFileSync(${JSON.stringify(file)},${JSON.stringify(value)})},${delay})`;
  return `node -e "eval(Buffer.from('${Buffer.from(source).toString("base64")}','base64').toString())"`;
}

function spawnWorker({ state, repo, runId, workerId, mode = "run" }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [workerFixture, state, repo, runId, workerId, mode],
      {
        cwd: repo,
        shell: false,
        windowsHide: true,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      let output;
      try {
        output = JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
      } catch (error) {
        reject(
          new Error(`Invalid worker output (${code}): ${stdout}\n${stderr}`, {
            cause: error,
          }),
        );
        return;
      }
      resolve({ code, output, stdout, stderr });
    });
  });
}

function spawnRecoveryWorker({ state, repo, runId, workerId, sentinel }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [recoveryWorkerFixture, state, repo, runId, workerId, sentinel],
      {
        cwd: repo,
        shell: false,
        windowsHide: true,
        env: { ...process.env },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      let output;
      try {
        output = JSON.parse(stdout.trim().split(/\r?\n/u).at(-1));
      } catch (error) {
        reject(
          new Error(
            `Invalid recovery worker output (${code}): ${stdout}\n${stderr}`,
            { cause: error },
          ),
        );
        return;
      }
      resolve({ code, output, stdout, stderr });
    });
  });
}

function useDeterministicProcessTreeSandbox() {
  // These tests isolate checkpoint orchestration from host sandbox
  // availability. Native Linux/macOS/Windows enforcement stays covered by the
  // live and Strict Sandbox suites.
  return vi
    .spyOn(executionBroker, "_prepareSandboxPlan")
    .mockImplementation((command, args, options, context = {}) => ({
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
      requiredBoundaries: [
        ...(context.sandboxPolicy?.requiredBoundaries || []),
      ],
      reason: null,
      postSpawn: { required: false, mode: "none" },
      cleanup: vi.fn(),
    }));
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("team distributed CLI", () => {
  it("bridges a zero-device task graph only on affected Windows libuv", () => {
    const fixture = makeRepo();
    writeGraph(fixture.graph, [
      {
        key: "build",
        command: nodeWrite("result.txt", "done\n"),
      },
    ]);
    const runtimeFs = projectedFileSystem(fixture.graph, {
      dev: 0n,
    });

    const initialize = () =>
      initDistributedQueue(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "zero-device-graph",
          tasks: fixture.graph,
          maxTasks: 1,
        },
        { fileSystem: runtimeFs },
      );
    if (!isAffectedWindowsZeroDeviceStatRuntime()) {
      expect(initialize).toThrow(
        expect.objectContaining({ code: "TEAM_QUEUE_INPUT_RACE" }),
      );
      return;
    }
    expect(initialize()).toMatchObject({
      runId: "zero-device-graph",
      mode: "shell-worktree",
    });
  });

  it("pins queue and checkpoint authorities to canonical paths", () => {
    const fixture = makeRepo();
    const canonicalParent = path.join(fixture.root, "checkpoint-authority");
    const aliasParent = path.join(fixture.root, "checkpoint-authority-alias");
    fs.mkdirSync(canonicalParent);
    if (!createDirectoryAlias(canonicalParent, aliasParent)) return;
    const requestedCheckpointStateDir = path.join(aliasParent, "transactions");
    const canonicalCheckpointStateDir = path.join(
      fs.realpathSync.native(canonicalParent),
      "transactions",
    );
    const canonicalStatePath = path.join(
      fs.realpathSync.native(path.dirname(fixture.state)),
      path.basename(fixture.state),
    );
    writeGraph(fixture.graph, [
      {
        key: "canonical-authority",
        command: nodeWrite("canonical.txt", "canonical\n"),
      },
    ]);

    const initialized = initDistributedQueue({
      state: fixture.state,
      repo: fixture.repo,
      runId: "canonical-authority",
      tasks: fixture.graph,
      managedCheckpoint: true,
      checkpointStateDir: requestedCheckpointStateDir,
    });
    expect(initialized.statePath).toBe(canonicalStatePath);
    expect(initialized.authority.checkpoint.stateDir).toBe(
      canonicalCheckpointStateDir,
    );
    expect(initialized.checkpoint.stateDir).toBe(canonicalCheckpointStateDir);

    const status = distributedQueueStatus({
      state: fixture.state,
      repo: fixture.repo,
      runId: "canonical-authority",
      checkpointStateDir: requestedCheckpointStateDir,
    });
    expect(status.authority.checkpoint.stateDir).toBe(
      canonicalCheckpointStateDir,
    );
  });

  it.each([
    [SECURE_FILE_IDENTITY_ERROR.INVALID_PARENT, "TEAM_QUEUE_INSECURE_INPUT"],
    [SECURE_FILE_IDENTITY_ERROR.PARENT_RACE, "TEAM_QUEUE_INPUT_RACE"],
  ])(
    "maps secure task-graph parent error %s to %s and preserves its cause",
    (secureCode, expectedCode) => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "build",
          command: nodeWrite("result.txt", "done\n"),
        },
      ]);
      const secureCause = new SecureFileIdentityError(
        secureCode,
        "secure parent rejected",
      );
      let failure;
      try {
        initDistributedQueue(
          {
            state: fixture.state,
            repo: fixture.repo,
            runId: `secure-parent-${secureCode}`,
            tasks: fixture.graph,
            maxTasks: 1,
          },
          {
            secureFileParent: () => {
              throw secureCause;
            },
          },
        );
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({
        code: expectedCode,
        details: { secureFileIdentityCode: secureCode },
      });
      expect(failure.cause).toBe(secureCause);
    },
  );

  it("keeps the task-graph unavailable code for ordinary I/O failures", () => {
    const fixture = makeRepo();
    writeGraph(fixture.graph, [
      {
        key: "build",
        command: nodeWrite("result.txt", "done\n"),
      },
    ]);
    const ioFailure = Object.assign(new Error("device unavailable"), {
      code: "EIO",
    });

    expect(() =>
      initDistributedQueue(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "ordinary-io-parent",
          tasks: fixture.graph,
          maxTasks: 1,
        },
        {
          secureFileParent: () => {
            throw ioFailure;
          },
        },
      ),
    ).toThrow(
      expect.objectContaining({ code: "TEAM_QUEUE_INPUT_UNAVAILABLE" }),
    );
  });

  it(
    "runs a real two-process DAG, composes dependency baselines, and finalizes",
    { timeout: 120_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "left",
          command: nodeWrite("left.txt", "left\n", { delay: 250 }),
        },
        {
          key: "right",
          command: nodeWrite("right.txt", "right\n", { delay: 250 }),
        },
        {
          key: "join",
          dependsOn: ["left", "right"],
          command: nodeWrite("join.txt", "joined\n", {
            requireFiles: ["left.txt", "right.txt"],
          }),
        },
      ]);

      const initialized = initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "real-dag",
        tasks: fixture.graph,
        maxTasks: 3,
      });
      expect(initialized).toMatchObject({
        runId: "real-dag",
        mode: "shell-worktree",
        budget: { maxTasks: 3 },
      });

      const workers = await Promise.all([
        spawnWorker({ ...fixture, runId: "real-dag", workerId: "worker-a" }),
        spawnWorker({ ...fixture, runId: "real-dag", workerId: "worker-b" }),
      ]);
      expect(
        workers.every((worker) => worker.code === 0),
        workers,
      ).toBe(true);
      expect(
        workers.reduce((total, worker) => total + worker.output.executions, 0),
      ).toBe(3);

      const status = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "real-dag",
        queueId: initialized.queueId,
        authorityDigest: initialized.authorityDigest,
      });
      expect(
        status.stats,
        JSON.stringify(
          {
            workers: workers.map((worker) => worker.output),
            tasks: status.tasks,
          },
          null,
          2,
        ),
      ).toMatchObject({
        total: 3,
        completed: 3,
        leased: 0,
      });
      const join = status.tasks.find((task) => task.key === "join");
      expect(
        join.metadata.result.dependencyCommits.map((item) => item.key),
      ).toEqual(["left", "right"]);
      for (const dependency of join.metadata.result.dependencyCommits) {
        expect(
          git(
            fixture.repo,
            "merge-base",
            "--is-ancestor",
            dependency.commitOid,
            join.metadata.result.baselineCommitOid,
          ),
        ).toBe("");
      }

      expect(fs.existsSync(path.join(fixture.repo, "join.txt"))).toBe(false);

      const merged = finalizeDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "real-dag",
        merge: true,
      });
      expect(merged.preview.every((item) => item.clean)).toBe(true);
      expect(merged.integration.every((item) => item.clean)).toBe(true);
      expect(
        fs
          .readFileSync(path.join(fixture.repo, "join.txt"), "utf8")
          .replaceAll("\r\n", "\n"),
      ).toBe("joined\n");
    },
  );

  it(
    "persists managed checkpoint running/final evidence with the worktree result",
    { timeout: 120_000 },
    async () => {
      useDeterministicProcessTreeSandbox();
      const fixture = makeRepo();
      const checkpointStateDir = path.join(
        fixture.root,
        "workspace-checkpoints",
      );
      writeGraph(fixture.graph, [
        {
          key: "managed",
          command: nodeWrite("managed.txt", "managed\n"),
        },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-checkpoint",
        tasks: fixture.graph,
        managedCheckpoint: true,
        checkpointStateDir,
      });
      const canonicalCheckpointStateDir = path.join(
        fs.realpathSync.native(fixture.root),
        path.basename(checkpointStateDir),
      );

      const worker = await runDistributedWorker({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-checkpoint",
        workerId: "managed-worker",
      });
      expect(worker.summary).toMatchObject({
        success: true,
        executions: 1,
      });

      const status = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-checkpoint",
      });
      expect(status.authority.checkpoint).toEqual({
        enabled: true,
        stateDir: canonicalCheckpointStateDir,
        coverageTarget: "partial",
        writerIsolation: "unknown",
        externalSideEffects: true,
      });
      expect(status.tasks[0]).toMatchObject({
        status: "completed",
        metadata: {
          workspaceExecution: {
            phase: "completed",
            workerId: "managed-worker",
            checkpoint: {
              state: "committed",
              coverage: "partial",
              externalSideEffects: true,
              recoveryRequired: false,
            },
          },
          result: {
            workspaceCheckpoint: {
              state: "committed",
              coverage: "partial",
            },
          },
        },
      });
      expect(
        fs.readdirSync(path.join(checkpointStateDir, "transactions")),
      ).toHaveLength(1);
    },
  );

  it(
    "restores a rolled-back worktree from queue history before cross-process retry",
    { timeout: 120_000 },
    async () => {
      useDeterministicProcessTreeSandbox();
      const fixture = makeRepo();
      const checkpointStateDir = path.join(fixture.root, "retry-checkpoints");
      const sentinel = path.join(fixture.root, "first-attempt");
      const source = `const fs=require('fs');const sentinel=${JSON.stringify(
        sentinel,
      )};if(!fs.existsSync(sentinel)){fs.writeFileSync(sentinel,'1');process.exit(7)}fs.writeFileSync('retried.txt','ok\\n')`;
      const command = `node -e "eval(Buffer.from('${Buffer.from(
        source,
      ).toString("base64")}','base64').toString())"`;
      writeGraph(fixture.graph, [{ key: "retry", command, retrySafe: true }]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-retry",
        tasks: fixture.graph,
        maxTasks: 2,
        managedCheckpoint: true,
        checkpointStateDir,
      });

      const first = await runDistributedWorker({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-retry",
        workerId: "retry-worker-one",
        maxTasks: 1,
      });
      expect(first.summary).toMatchObject({
        success: false,
        executions: 1,
      });
      expect(
        distributedQueueStatus({
          state: fixture.state,
          repo: fixture.repo,
          runId: "managed-retry",
        }).tasks[0],
      ).toMatchObject({
        status: "pending",
        metadata: {
          workspaceExecution: {
            phase: "rolled-back",
            checkpoint: { state: "rolled_back" },
          },
        },
      });

      const second = await runDistributedWorker({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-retry",
        workerId: "retry-worker-two",
        maxTasks: 1,
      });

      expect(second.summary).toMatchObject({
        success: true,
        executions: 1,
      });
      const retried = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "managed-retry",
      }).tasks[0];
      expect(retried).toMatchObject({
        status: "completed",
        metadata: {
          workspaceExecutionHistory: [
            {
              phase: "rolled-back",
              checkpoint: { state: "rolled_back" },
            },
          ],
          workspaceExecution: {
            phase: "completed",
            checkpoint: { state: "committed" },
          },
        },
      });
    },
  );

  it("interrupts only the exact durable lease/fence and preserves replay evidence", () => {
    const fixture = makeRepo();
    writeGraph(fixture.graph, [
      { key: "interrupt-me", command: nodeWrite("unused.txt", "unused\n") },
    ]);
    initDistributedQueue({
      state: fixture.state,
      repo: fixture.repo,
      runId: "durable-interrupt",
      tasks: fixture.graph,
    });
    const queue = TeamDistributedQueue.open({
      filePath: fixture.state,
      runId: "durable-interrupt",
    });
    const claim = queue.claim({
      holder: "interrupt-worker",
      ttlMs: 30_000,
    });
    expect(claim).toMatchObject({ ok: true, key: "interrupt-me" });

    expect(() =>
      interruptDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "durable-interrupt",
        task: "interrupt-me",
        holder: "interrupt-worker",
        leaseId: claim.lease.leaseId,
        fencingToken: claim.lease.fencingToken + 1,
        requestId: "stale-interrupt",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_INTERRUPT_REJECTED" }),
    );

    const request = {
      state: fixture.state,
      repo: fixture.repo,
      runId: "durable-interrupt",
      task: "interrupt-me",
      holder: "interrupt-worker",
      leaseId: claim.lease.leaseId,
      fencingToken: claim.lease.fencingToken,
      requestId: "exact-interrupt",
      actor: "operator@example.test",
      reason: "take over the exact running attempt",
    };
    const interrupted = interruptDistributedQueue(request);
    expect(interrupted).toMatchObject({
      ok: true,
      task: "interrupt-me",
      requestId: "exact-interrupt",
      evidenceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
    });
    expect(interruptDistributedQueue(request)).toMatchObject({
      ok: true,
      idempotent: true,
      requestId: "exact-interrupt",
    });
    expect(
      distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "durable-interrupt",
      }).interruptions,
    ).toEqual([
      expect.objectContaining({
        requestId: "exact-interrupt",
        evidenceDigest: interrupted.evidenceDigest,
      }),
    ]);

    const renewal = queue.renew("interrupt-me", {
      holder: "interrupt-worker",
      leaseId: claim.lease.leaseId,
      ttlMs: 30_000,
    });
    expect(renewal).toMatchObject({
      ok: false,
      reason: "interrupted",
      error: {
        code: "TEAM_TASK_HUMAN_INTERRUPTED",
        retryable: false,
        adjudication: {
          requestId: "exact-interrupt",
          evidenceDigest: interrupted.evidenceDigest,
        },
      },
    });
  });

  it(
    "recovers a dead Agent checkpoint, adjudicates retry, and continues under a new fence",
    { timeout: 120_000 },
    async () => {
      useDeterministicProcessTreeSandbox();
      const fixture = makeRepo();
      const checkpointStateDir = path.join(
        fixture.root,
        "recovery-checkpoints",
      );
      const sentinel = path.join(fixture.root, "first-attempt");
      writeGraph(fixture.graph, [
        {
          key: "recover-agent",
          prompt: "perform deterministic recovery work",
          retrySafe: false,
        },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "checkpoint-recovery-control",
        tasks: fixture.graph,
        mode: "agent-worktree",
        managedCheckpoint: true,
        checkpointStateDir,
        model: "gpt-4o",
        maxTasks: 2,
      });

      const failed = await spawnRecoveryWorker({
        ...fixture,
        runId: "checkpoint-recovery-control",
        workerId: "dead-recovery-worker",
        sentinel,
      });
      expect(failed).toMatchObject({
        code: 0,
        output: {
          ok: true,
          success: false,
          executions: 1,
        },
      });
      expect(fs.existsSync(sentinel)).toBe(true);

      const blocked = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "checkpoint-recovery-control",
      });
      expect(blocked.pendingAdjudications).toHaveLength(1);
      expect(blocked.tasks[0]).toMatchObject({
        status: "cancelled",
        metadata: {
          workspaceExecution: {
            phase: "rollback-recovery-required",
            checkpoint: { recoveryRequired: true },
          },
        },
      });
      const evidenceDigest = blocked.pendingAdjudications[0].evidenceDigest;
      const checkpointTransactionId =
        blocked.tasks[0].metadata.workspaceExecution.checkpoint.transactionId;
      class TerminalLockRecoveryBroker extends TeamProcessCheckpointBroker {
        recoverPending(options) {
          return super.recoverPending(options).map((entry) =>
            entry.id === checkpointTransactionId
              ? {
                  ...entry,
                  status: "terminal_lock_recovery_required",
                  manualRecoveryRequired: true,
                }
              : entry,
          );
        }
      }
      expect(() =>
        recoverDistributedQueueCheckpoint(
          {
            state: fixture.state,
            repo: fixture.repo,
            runId: "checkpoint-recovery-control",
            task: "recover-agent",
            recoveryId: "must-not-reconcile-terminal-lock",
            evidenceDigest,
            actor: "recovery-operator",
          },
          { CheckpointBroker: TerminalLockRecoveryBroker },
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "TEAM_QUEUE_CHECKPOINT_RECOVERY_REQUIRED",
        }),
      );
      expect(
        distributedQueueStatus({
          state: fixture.state,
          repo: fixture.repo,
          runId: "checkpoint-recovery-control",
        }).tasks[0].metadata.workspaceRecovery,
      ).toBeUndefined();

      const recovered = recoverDistributedQueueCheckpoint({
        state: fixture.state,
        repo: fixture.repo,
        runId: "checkpoint-recovery-control",
        task: "recover-agent",
        recoveryId: "recover-dead-checkpoint",
        evidenceDigest,
        actor: "recovery-operator",
        reason: "dead owner and settled execution were proven",
      });
      expect(recovered).toMatchObject({
        ok: true,
        task: "recover-agent",
        outcome: "rolled-back",
        execution: {
          phase: "rolled-back",
          worktree: {
            workspaceCheckpoint: {
              state: "rolled_back",
              recoveryRequired: false,
            },
          },
          checkpoint: {
            state: "rolled_back",
            recoveryRequired: false,
          },
        },
      });
      expect(
        fs.existsSync(
          path.join(recovered.execution.worktree.path, "must-rollback.txt"),
        ),
      ).toBe(false);

      const residualPath = path.join(
        recovered.execution.worktree.path,
        "residual-write.txt",
      );
      fs.writeFileSync(residualPath, "must block retry\n");
      expect(() =>
        adjudicateDistributedQueue({
          state: fixture.state,
          repo: fixture.repo,
          runId: "checkpoint-recovery-control",
          task: "recover-agent",
          decision: "retry",
          decisionId: "must-not-retry-dirty-worktree",
          evidenceDigest,
          actor: "recovery-operator",
        }),
      ).toThrowError(
        expect.objectContaining({
          code: "TEAM_QUEUE_RETRY_GIT_RECOVERY_REQUIRED",
        }),
      );
      fs.rmSync(residualPath);

      const adjudicated = adjudicateDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "checkpoint-recovery-control",
        task: "recover-agent",
        decision: "retry",
        decisionId: "retry-recovered-agent",
        evidenceDigest,
        actor: "recovery-operator",
        reason: "checkpoint rollback and Git baseline are settled",
      });
      expect(adjudicated).toMatchObject({
        ok: true,
        decision: "retry",
        status: "pending",
      });

      const retried = await runDistributedWorker(
        {
          state: fixture.state,
          repo: fixture.repo,
          runId: "checkpoint-recovery-control",
          workerId: "replacement-agent",
          maxTasks: 1,
        },
        {
          agentExecutor: async (_prompt, cwd) => {
            fs.writeFileSync(path.join(cwd, "recovered.txt"), "ok\n");
            return {
              usage: { input_tokens: 3, output_tokens: 1 },
              provider: "openai",
              model: "gpt-4o",
            };
          },
        },
      );
      expect(retried.summary, JSON.stringify(retried, null, 2)).toMatchObject({
        success: true,
        executions: 1,
      });
      const final = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "checkpoint-recovery-control",
      });
      expect(final.tasks[0]).toMatchObject({
        status: "completed",
        metadata: {
          attempts: 1,
          workspaceExecutionHistory: [
            {
              phase: "rolled-back",
              checkpoint: { state: "rolled_back" },
            },
          ],
          workspaceExecution: {
            phase: "completed",
            checkpoint: { state: "committed" },
          },
        },
      });
    },
  );

  it("revalidates accepted Git evidence and replays an exact accept decision", () => {
    const fixture = makeRepo();
    const checkpointStateDir = path.join(fixture.root, "accept-checkpoints");
    writeGraph(fixture.graph, [
      {
        key: "accept-task",
        command: nodeWrite("unused.txt", "unused\n"),
        retrySafe: false,
      },
    ]);
    initDistributedQueue({
      state: fixture.state,
      repo: fixture.repo,
      runId: "accept-control",
      tasks: fixture.graph,
      managedCheckpoint: true,
      checkpointStateDir,
    });
    const canonicalCheckpointStateDir = path.join(
      fs.realpathSync.native(fixture.root),
      path.basename(checkpointStateDir),
    );

    const baselineCommitOid = git(fixture.repo, "rev-parse", "HEAD");
    const branch = "team/accept-control/accept-task";
    const worktreePath = path.join(fixture.root, "accept-worktree");
    git(
      fixture.repo,
      "worktree",
      "add",
      "-b",
      branch,
      worktreePath,
      baselineCommitOid,
    );
    fs.writeFileSync(path.join(worktreePath, "accepted.txt"), "accepted\n");
    git(worktreePath, "add", "accepted.txt");
    git(worktreePath, "commit", "-m", "accepted task result");
    const verifiedCommitOid = git(worktreePath, "rev-parse", "HEAD");

    const alive = new Set([111, 222]);
    const workerQueue = new TeamDistributedQueue({
      filePath: fixture.state,
      processId: 111,
      isProcessAlive: (pid) => alive.has(pid),
    });
    const claim = workerQueue.acquire("accept-task", {
      holder: "crashed-accept-worker",
    });
    expect(claim).toMatchObject({ ok: true });
    const execution = (phase, state) => {
      const committed = state === "committed";
      return {
        workerId: "crashed-accept-worker",
        phase,
        verifiedCommitOid: ["validated", "committed"].includes(phase)
          ? verifiedCommitOid
          : null,
        worktree: {
          key: "accept-task",
          branch,
          path: worktreePath,
          committed: false,
          completed: false,
          commitOid: null,
          dependencyCommits: [],
          baselineCommitOid,
          managedLinks: [],
          workspaceCheckpoint: null,
        },
        checkpoint: {
          transactionId: "txn-accept-task",
          checkpointId: "checkpoint-txn-accept-task",
          runId: "accept-control",
          taskKey: "accept-task",
          workspaceRoot: worktreePath,
          stateDir: canonicalCheckpointStateDir,
          state,
          writerIsolation: "unknown",
          requestedCoverage: "partial",
          coverage: "partial",
          fileCoverage: "partial",
          externalSideEffects: true,
          uncoveredPaths: [".git", "@external-git-metadata"],
          checkpointDigest: `sha256:${"1".repeat(64)}`,
          writeManifestDigest: committed ? `sha256:${"2".repeat(64)}` : null,
          evidenceDigest: committed ? `sha256:${"3".repeat(64)}` : null,
          updatedAt: "2026-07-29T10:00:00.000Z",
          recoveryRequired: !committed,
          failureCode: null,
        },
      };
    };
    const record = (value) =>
      workerQueue.recordWorkspaceExecution("accept-task", {
        holder: claim.lease.holder,
        leaseId: claim.lease.leaseId,
        fencingToken: claim.lease.fencingToken,
        execution: value,
      });
    expect(record(execution("prepared", "prepared"))).toMatchObject({
      ok: true,
    });
    expect(record(execution("running", "running"))).toMatchObject({
      ok: true,
    });
    expect(record(execution("validated", "running"))).toMatchObject({
      ok: true,
    });
    expect(record(execution("committed", "committed"))).toMatchObject({
      ok: true,
    });
    alive.delete(111);
    const rescuer = new TeamDistributedQueue({
      filePath: fixture.state,
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    const pending = rescuer.pendingAdjudications();
    expect(pending).toHaveLength(1);
    const evidenceDigest = pending[0].evidenceDigest;
    const baseRequest = {
      state: fixture.state,
      repo: fixture.repo,
      runId: "accept-control",
      task: "accept-task",
      decision: "accept",
      decisionId: "accept-exact-worktree",
      evidenceDigest,
      actor: "operator@example.test",
      reason: "validated commit is the intended result",
    };

    const driftPath = path.join(worktreePath, "unreviewed.txt");
    fs.writeFileSync(driftPath, "drift\n");
    expect(() => adjudicateDistributedQueue(baseRequest)).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_RECOVERY_GIT_DRIFT" }),
    );
    fs.rmSync(driftPath);

    const accepted = adjudicateDistributedQueue(baseRequest);
    expect(accepted).toMatchObject({
      ok: true,
      decision: "accept",
      status: "completed",
      acceptance: {
        verifiedCommitOid,
        branch,
      },
    });
    expect(adjudicateDistributedQueue(baseRequest)).toMatchObject({
      ok: true,
      idempotent: true,
      decision: "accept",
      status: "completed",
    });
    expect(() =>
      adjudicateDistributedQueue({
        ...baseRequest,
        actor: "different-operator@example.test",
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_ADJUDICATION_REJECTED" }),
    );
  });

  it("pins state outside the repo and rejects another run authority", () => {
    const fixture = makeRepo();
    writeGraph(fixture.graph, [
      { key: "only", command: nodeWrite("only.txt", "ok\n") },
    ]);
    expect(() =>
      initDistributedQueue({
        state: path.join(fixture.repo, "queue.json"),
        repo: fixture.repo,
        runId: "inside",
        tasks: fixture.graph,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "TEAM_QUEUE_STATE_INSIDE_REPOSITORY",
      }),
    );

    initDistributedQueue({
      state: fixture.state,
      repo: fixture.repo,
      runId: "pinned",
      tasks: fixture.graph,
    });
    expect(() =>
      distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "wrong",
      }),
    ).toThrow();
  });

  it(
    "blocks workers and finalize when a crashed unsafe lease needs adjudication",
    { timeout: 60_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        {
          key: "unsafe",
          command: nodeWrite("unsafe.txt", "unknown\n"),
          retrySafe: false,
        },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "unsafe-crash",
        tasks: fixture.graph,
      });
      const crashed = await spawnWorker({
        ...fixture,
        runId: "unsafe-crash",
        workerId: "crashed-worker",
        mode: "crash",
      });
      expect(crashed).toMatchObject({
        code: 0,
        output: { ok: true, claim: { key: "unsafe" } },
      });

      const status = distributedQueueStatus({
        state: fixture.state,
        repo: fixture.repo,
        runId: "unsafe-crash",
      });
      expect(status.pendingAdjudications).toHaveLength(1);
      expect(status.stats).toMatchObject({
        completed: 0,
        adjudicationRequired: 1,
      });

      const worker = await runDistributedWorker({
        state: fixture.state,
        repo: fixture.repo,
        runId: "unsafe-crash",
        workerId: "safe-observer",
      });
      expect(worker.summary.executions).toBe(0);
      expect(worker.queue.pendingAdjudications).toHaveLength(1);
      expect(() =>
        finalizeDistributedQueue({
          state: fixture.state,
          repo: fixture.repo,
          runId: "unsafe-crash",
        }),
      ).toThrowError(
        expect.objectContaining({ code: "TEAM_QUEUE_FINALIZE_BLOCKED" }),
      );

      const evidenceDigest = status.pendingAdjudications[0].evidenceDigest;
      const request = {
        state: fixture.state,
        repo: fixture.repo,
        runId: "unsafe-crash",
        task: "unsafe",
        decision: "cancel",
        decisionId: "cancel-unsafe-crash",
        evidenceDigest,
        actor: "operator@example.test",
        reason: "external effects cannot be proven safe",
      };
      expect(adjudicateDistributedQueue(request)).toMatchObject({
        ok: true,
        decision: "cancel",
        status: "cancelled",
      });
      expect(adjudicateDistributedQueue(request)).toMatchObject({
        ok: true,
        idempotent: true,
        decision: "cancel",
      });
      expect(
        distributedQueueStatus({
          state: fixture.state,
          repo: fixture.repo,
          runId: "unsafe-crash",
        }).pendingAdjudications,
      ).toHaveLength(0);
    },
  );

  it(
    "enforces the global queue budget and blocks incomplete finalization",
    { timeout: 120_000 },
    async () => {
      const fixture = makeRepo();
      writeGraph(fixture.graph, [
        { key: "one", command: nodeWrite("one.txt", "one\n") },
        { key: "two", command: nodeWrite("two.txt", "two\n") },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "budget",
        tasks: fixture.graph,
        maxTasks: 1,
      });

      const worker = await runDistributedWorker({
        state: fixture.state,
        repo: fixture.repo,
        runId: "budget",
        workerId: "budget-worker",
      });
      expect(worker.queue.stats.completed).toBe(1);
      expect(worker.queue.stats.budget.reason).toBe("max-tasks");
      expect(() =>
        finalizeDistributedQueue({
          state: fixture.state,
          repo: fixture.repo,
          runId: "budget",
        }),
      ).toThrowError(
        expect.objectContaining({ code: "TEAM_QUEUE_FINALIZE_BLOCKED" }),
      );
    },
  );

  it(
    "fails closed on a real sequential merge conflict",
    { timeout: 120_000 },
    async () => {
      const fixture = makeRepo();
      fs.writeFileSync(path.join(fixture.repo, "shared.txt"), "base\n");
      git(fixture.repo, "add", "shared.txt");
      git(fixture.repo, "commit", "-m", "shared base");
      writeGraph(fixture.graph, [
        { key: "first", command: nodeWrite("shared.txt", "first\n") },
        { key: "second", command: nodeWrite("shared.txt", "second\n") },
      ]);
      initDistributedQueue({
        state: fixture.state,
        repo: fixture.repo,
        runId: "conflict",
        tasks: fixture.graph,
      });
      await Promise.all([
        spawnWorker({ ...fixture, runId: "conflict", workerId: "conflict-a" }),
        spawnWorker({ ...fixture, runId: "conflict", workerId: "conflict-b" }),
      ]);

      expect(() =>
        finalizeDistributedQueue({
          state: fixture.state,
          repo: fixture.repo,
          runId: "conflict",
          merge: true,
        }),
      ).toThrowError(
        expect.objectContaining({ code: "TEAM_QUEUE_INTEGRATION_CONFLICT" }),
      );
    },
  );
});
