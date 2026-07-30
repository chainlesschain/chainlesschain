import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TeamDistributedQueue,
  TeamDistributedQueueError,
} from "../../src/lib/agent-team/team-distributed-queue.js";
import { TeamRunner } from "../../src/lib/agent-team/team-runner.js";
import {
  SECURE_FILE_IDENTITY_ERROR,
  SecureFileIdentityError,
  isAffectedWindowsZeroDeviceStatRuntime,
} from "../../src/lib/secure-file-identity.js";

const temporaryDirectories = [];

function tempState(name = "queue.json") {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-team-distributed-"),
  );
  temporaryDirectories.push(directory);
  return path.join(directory, name);
}

function deterministicIds(prefix = "test") {
  let sequence = 0;
  return (kind) => `${prefix}-${kind}-${++sequence}`;
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

function makeClock(start = 1_000) {
  let value = start;
  return {
    now: () => value,
    advance: (milliseconds) => {
      value += milliseconds;
      return value;
    },
  };
}

function createQueue(filePath, options = {}) {
  return TeamDistributedQueue.create({
    filePath,
    id: deterministicIds(),
    processId: 101,
    isProcessAlive: (pid) => pid === 101,
    tasks: [
      { key: "build", title: "Build" },
      { key: "test", title: "Test", dependsOn: ["build"] },
    ],
    authority: { runId: "run-1", graphOwner: "controller" },
    ...options,
  });
}

function managedAuthority(stateDir) {
  return {
    runId: "run-1",
    graphOwner: "controller",
    checkpoint: {
      enabled: true,
      stateDir,
      coverageTarget: "partial",
      writerIsolation: "unknown",
      externalSideEffects: true,
    },
  };
}

function workspaceExecution(
  stateDir,
  {
    phase = "prepared",
    state = "prepared",
    coverage = "partial",
    commitOid = null,
  } = {},
) {
  const terminal = ["committed", "rolled_back"].includes(state);
  const verifiedCommitOid = ["validated", "committed", "completed"].includes(
    phase,
  )
    ? "b".repeat(40)
    : null;
  return {
    workerId: "worker-a",
    phase,
    verifiedCommitOid,
    worktree: {
      key: "task",
      branch: "team/run-1/task",
      path: path.resolve("/workspace/task"),
      committed: phase === "completed",
      completed: phase === "completed",
      commitOid: phase === "completed" ? commitOid || verifiedCommitOid : null,
      dependencyCommits: [],
      baselineCommitOid: "a".repeat(40),
      managedLinks: [],
      workspaceCheckpoint: null,
    },
    checkpoint: {
      transactionId: "txn-task",
      checkpointId: "checkpoint-txn-task",
      runId: "run-1",
      taskKey: "task",
      workspaceRoot: path.resolve("/workspace/task"),
      stateDir,
      state,
      writerIsolation: "unknown",
      requestedCoverage: "partial",
      coverage,
      fileCoverage: coverage,
      externalSideEffects: true,
      uncoveredPaths: [".git", "@external-git-metadata"],
      checkpointDigest: `sha256:${"1".repeat(64)}`,
      writeManifestDigest: terminal ? `sha256:${"2".repeat(64)}` : null,
      evidenceDigest: terminal ? `sha256:${"3".repeat(64)}` : null,
      updatedAt: "2026-07-29T10:00:00.000Z",
      recoveryRequired: ![
        "committed",
        "rolled_back",
        "restored",
        "aborted",
      ].includes(state),
      failureCode: null,
    },
  };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("TeamDistributedQueue durable registry adapter", () => {
  it("bridges a zero-device queue path only on affected Windows libuv", () => {
    const filePath = tempState();
    const runtimeFs = projectedFileSystem(filePath, { dev: 0n });
    const queue = createQueue(filePath, {
      fileSystem: runtimeFs,
    });

    if (!isAffectedWindowsZeroDeviceStatRuntime()) {
      expect(() => queue.claim({ holder: "worker" })).toThrow(
        expect.objectContaining({ code: "TEAM_QUEUE_PATH_RACE" }),
      );
      return;
    }
    expect(queue.claim({ holder: "worker" })).toMatchObject({
      ok: true,
      key: "build",
    });
  });

  it.each([
    SECURE_FILE_IDENTITY_ERROR.INVALID_PARENT,
    SECURE_FILE_IDENTITY_ERROR.PARENT_RACE,
  ])(
    "maps secure queue parent error %s to an insecure-path error and preserves its cause",
    (secureCode) => {
      const filePath = tempState();
      const secureCause = new SecureFileIdentityError(
        secureCode,
        "secure parent rejected",
      );
      const queue = new TeamDistributedQueue({
        filePath,
        secureFileParent: () => {
          throw secureCause;
        },
      });
      let failure;
      try {
        queue.stats();
      } catch (error) {
        failure = error;
      }

      expect(failure).toMatchObject({
        code: "TEAM_QUEUE_INSECURE_PATH",
        filePath: path.resolve(filePath),
      });
      expect(failure.cause).toBe(secureCause);
    },
  );

  it("maps secure queue parent write failures without collapsing them to write-failed", () => {
    const filePath = tempState();
    const secureCause = new SecureFileIdentityError(
      SECURE_FILE_IDENTITY_ERROR.PARENT_RACE,
      "secure parent changed",
    );
    let secureParentCalls = 0;

    let failure;
    try {
      createQueue(filePath, {
        secureFileParent: () => {
          secureParentCalls += 1;
          if (secureParentCalls === 1) {
            return { missing: true, identity: null, serialized: null };
          }
          throw secureCause;
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(secureParentCalls).toBe(2);
    expect(failure).toMatchObject({ code: "TEAM_QUEUE_INSECURE_PATH" });
    expect(failure.cause).toBe(secureCause);
  });

  it("keeps the queue read-failed code for ordinary I/O failures", () => {
    const filePath = tempState();
    const ioFailure = Object.assign(new Error("device unavailable"), {
      code: "EIO",
    });
    const queue = new TeamDistributedQueue({
      filePath,
      secureFileParent: () => {
        throw ioFailure;
      },
    });
    let failure;
    try {
      queue.stats();
    } catch (error) {
      failure = error;
    }

    expect(failure).toMatchObject({ code: "TEAM_QUEUE_READ_FAILED" });
    expect(failure.cause).toBe(ioFailure);
  });

  it("keeps the queue write-failed code for ordinary I/O failures", () => {
    const filePath = tempState();
    const ioFailure = Object.assign(new Error("device unavailable"), {
      code: "EIO",
    });
    let secureParentCalls = 0;

    let failure;
    try {
      createQueue(filePath, {
        secureFileParent: () => {
          secureParentCalls += 1;
          if (secureParentCalls === 1) {
            return { missing: true, identity: null, serialized: null };
          }
          throw ioFailure;
        },
      });
    } catch (error) {
      failure = error;
    }

    expect(secureParentCalls).toBe(2);
    expect(failure).toMatchObject({ code: "TEAM_QUEUE_WRITE_FAILED" });
    expect(failure.cause).toBe(ioFailure);
  });

  it("persists a DAG and exposes the TaskLeaseRegistry-compatible surface", () => {
    const filePath = tempState();
    const queue = createQueue(filePath);

    expect(queue.asRegistry()).toBe(queue);
    expect(queue.claimable()).toEqual(["build"]);
    expect(queue.claimableCount()).toBe(1);
    expect(queue.getTask("test").dependsOn).toEqual(["build"]);
    expect(queue.acquire("test", { holder: "worker" })).toMatchObject({
      ok: false,
      reason: "blocked_by_deps",
    });

    const build = queue.claim({ holder: "worker", ttlMs: 5_000 });
    expect(build).toMatchObject({
      ok: true,
      key: "build",
      lease: {
        holder: "worker",
        ownerPid: 101,
        fencingToken: 1,
      },
    });
    expect(
      queue.complete("build", {
        holder: "worker",
        leaseId: build.lease.leaseId,
        result: { artifact: "abc" },
      }),
    ).toMatchObject({ ok: true });

    const reopened = TeamDistributedQueue.open({
      filePath,
      runId: "run-1",
      id: deterministicIds("reopen"),
      processId: 101,
      isProcessAlive: (pid) => pid === 101,
    });
    expect(reopened.claimable()).toEqual(["test"]);
    expect(reopened.getTask("build")).toMatchObject({
      status: "completed",
      metadata: { result: { artifact: "abc" } },
    });
    expect(reopened.snapshot()).toMatchObject({
      schemaVersion: 1,
      revision: 2,
      authority: { runId: "run-1", graphOwner: "controller" },
    });
    expect(reopened.snapshot().graphDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(reopened.snapshot().authorityDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(() =>
      TeamDistributedQueue.open({
        filePath,
        runId: "another-run",
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "TEAM_QUEUE_CORRUPT",
      }),
    );
  });

  it("drives the existing TeamRunner directly through asRegistry()", async () => {
    const filePath = tempState();
    const queue = createQueue(filePath);
    const executed = [];
    const runner = new TeamRunner(queue.asRegistry(), {
      teammates: 2,
      ttlMs: 5_000,
      renewEveryMs: 1_000,
      emitHook: async () => {},
      runTask: async ({ key }) => {
        executed.push(key);
        return { executed: key };
      },
    });

    await expect(runner.run()).resolves.toMatchObject({
      done: true,
      success: true,
      executions: 2,
    });
    expect(executed).toEqual(["build", "test"]);
    expect(queue.getTask("test")).toMatchObject({
      status: "completed",
      metadata: { result: { executed: "test" } },
    });
  });

  it("atomically persists dynamically added tasks and rejects unknown dependencies", () => {
    const filePath = tempState();
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds(),
      processId: 101,
      isProcessAlive: () => true,
      tasks: [],
    });

    expect(queue.addTask({ key: "a", title: "A" })).toMatchObject({
      ok: true,
      key: "a",
    });
    expect(
      queue.addTasks([
        { key: "b", title: "B", dependsOn: ["a"] },
        { key: "c", title: "C", dependsOn: ["b"] },
      ]),
    ).toMatchObject({ ok: true, keys: ["b", "c"] });
    expect(queue.list().map((task) => task.key)).toEqual(["a", "b", "c"]);
    expect(() =>
      queue.addTask({
        key: "orphan",
        title: "Orphan",
        dependsOn: ["missing"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_INVALID_GRAPH" }),
    );
  });

  it("uses monotonic fencing and rejects a stale holder after TTL recovery", () => {
    const filePath = tempState();
    const clock = makeClock();
    const alive = new Set([101, 202]);
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds(),
      now: clock.now,
      processId: 101,
      isProcessAlive: (pid) => alive.has(pid),
      defaultTtlMs: 100,
      tasks: [
        {
          key: "task",
          title: "Task",
          metadata: { retrySafe: true },
        },
      ],
    });
    const stale = queue.acquire("task", {
      holder: "same-label",
      ttlMs: 100,
    });
    clock.advance(101);

    const replacementQueue = new TeamDistributedQueue({
      filePath,
      id: deterministicIds("replacement"),
      now: clock.now,
      processId: 202,
      isProcessAlive: (pid) => alive.has(pid),
    });
    const replacement = replacementQueue.acquire("task", {
      holder: "same-label",
      ttlMs: 100,
    });
    expect(replacement).toMatchObject({
      ok: true,
      lease: { fencingToken: 2, ownerPid: 202 },
    });
    expect(replacement.lease.leaseId).not.toBe(stale.lease.leaseId);
    expect(
      replacementQueue.complete("task", {
        holder: "same-label",
        leaseId: stale.lease.leaseId,
      }),
    ).toMatchObject({ ok: false });
    expect(
      replacementQueue.complete("task", {
        holder: "same-label",
        leaseId: replacement.lease.leaseId,
      }),
    ).toMatchObject({ ok: true });
  });

  it("fences interrupt requests to the exact current lease and preserves graph authority", () => {
    const filePath = tempState();
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("interrupt-fence"),
      processId: 101,
      isProcessAlive: () => true,
      tasks: [{ key: "task", title: "Task" }],
    });
    const claim = queue.acquire("task", { holder: "worker-a" });
    const before = queue.snapshot();
    expect(
      queue.requestInterrupt("task", {
        holder: "worker-a",
        leaseId: claim.lease.leaseId,
        fencingToken: claim.lease.fencingToken + 1,
        requestId: "interrupt-stale",
        actor: "operator",
        reason: "take over",
      }),
    ).toEqual({ ok: false, reason: "stale_attempt" });
    expect(queue.snapshot()).toMatchObject({
      revision: before.revision,
      graphDigest: before.graphDigest,
      interruptions: [],
    });

    const accepted = queue.requestInterrupt("task", {
      holder: "worker-a",
      leaseId: claim.lease.leaseId,
      fencingToken: claim.lease.fencingToken,
      requestId: "interrupt-exact",
      actor: "operator",
      reason: "take over",
    });
    expect(accepted).toMatchObject({
      ok: true,
      requestId: "interrupt-exact",
      requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      evidenceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      interruption: {
        holder: "worker-a",
        leaseId: claim.lease.leaseId,
        fencingToken: claim.lease.fencingToken,
      },
    });
    const after = queue.snapshot();
    expect(after.graphDigest).toBe(before.graphDigest);
    expect(after.interruptions).toHaveLength(1);
    expect(queue.getTask("task").metadata.interruption).toMatchObject({
      requestId: "interrupt-exact",
      evidenceDigest: accepted.evidenceDigest,
    });
  });

  it("makes interrupt request ids queue-global, fully idempotent, and conflict-safe", () => {
    const filePath = tempState();
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("interrupt-id"),
      processId: 101,
      isProcessAlive: () => true,
      tasks: [
        { key: "a", title: "A" },
        { key: "b", title: "B" },
      ],
    });
    const a = queue.acquire("a", { holder: "worker-a" });
    const b = queue.acquire("b", { holder: "worker-b" });
    const request = {
      holder: "worker-a",
      leaseId: a.lease.leaseId,
      fencingToken: a.lease.fencingToken,
      requestId: "global-request",
      actor: "operator",
      reason: "inspect output",
    };
    const first = queue.requestInterrupt("a", request);
    const revision = queue.snapshot().revision;
    expect(queue.requestInterrupt("a", request)).toMatchObject({
      ok: true,
      idempotent: true,
      requestDigest: first.requestDigest,
      evidenceDigest: first.evidenceDigest,
    });
    expect(queue.snapshot().revision).toBe(revision);

    expect(
      queue.requestInterrupt("b", {
        holder: "worker-b",
        leaseId: b.lease.leaseId,
        fencingToken: b.lease.fencingToken,
        requestId: "global-request",
        actor: "operator",
        reason: "inspect output",
      }),
    ).toEqual({
      ok: false,
      reason: "interrupt_request_id_conflict",
      requestId: "global-request",
    });
    expect(queue.snapshot().revision).toBe(revision);
  });

  it("returns an exact non-retryable interruption error from lease renewal", () => {
    const filePath = tempState();
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("interrupt-renew"),
      processId: 101,
      isProcessAlive: () => true,
      tasks: [{ key: "task", title: "Task" }],
    });
    const claim = queue.acquire("task", { holder: "worker" });
    const interruption = queue.requestInterrupt("task", {
      holder: "worker",
      leaseId: claim.lease.leaseId,
      fencingToken: claim.lease.fencingToken,
      requestId: "renew-abort",
      actor: "operator",
      reason: "human takeover",
    });
    const revision = queue.snapshot().revision;
    const renewed = queue.renew("task", {
      holder: "worker",
      leaseId: claim.lease.leaseId,
    });
    expect(renewed).toMatchObject({
      ok: false,
      reason: "interrupted",
      retryable: false,
      error: {
        code: "TEAM_TASK_HUMAN_INTERRUPTED",
        retryable: false,
        message: "human takeover",
        adjudication: {
          requestId: "renew-abort",
          evidenceDigest: interruption.evidenceDigest,
          holder: "worker",
          leaseId: claim.lease.leaseId,
          fencingToken: claim.lease.fencingToken,
        },
      },
    });
    expect(renewed.error).toBeInstanceOf(Error);
    expect(queue.snapshot().revision).toBe(revision);
  });

  it("settles interrupt-before-complete as adjudication exactly once", () => {
    const filePath = tempState();
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("interrupt-complete"),
      processId: 101,
      isProcessAlive: () => true,
      budget: { maxTokens: 20 },
      tasks: [{ key: "task", title: "Task" }],
    });
    const claim = queue.acquire("task", {
      holder: "worker",
      maxTokens: 20,
    });
    const interruption = queue.requestInterrupt("task", {
      holder: "worker",
      leaseId: claim.lease.leaseId,
      fencingToken: claim.lease.fencingToken,
      requestId: "complete-race",
      actor: "operator",
      reason: "stop before accepting output",
    });
    expect(
      queue.complete("task", {
        holder: "worker",
        leaseId: claim.lease.leaseId,
        usage: {
          input_tokens: 5,
          output_tokens: 3,
          cache_read_input_tokens: 2,
          cache_creation_input_tokens: 1,
        },
        result: { artifact: "must-not-be-accepted" },
      }),
    ).toMatchObject({
      ok: false,
      settled: true,
      reason: "interrupted",
      chargedTokens: 11,
      error: { code: "TEAM_TASK_HUMAN_INTERRUPTED" },
    });
    expect(queue.getTask("task")).toMatchObject({
      status: "cancelled",
      metadata: {
        adjudication: {
          required: true,
          code: "TEAM_TASK_HUMAN_INTERRUPTED",
          evidenceDigest: interruption.evidenceDigest,
        },
        interruption: { requestId: "complete-race" },
      },
    });
    expect(queue.getTask("task").metadata.result).toBeUndefined();
    expect(queue.budgetStatus()).toMatchObject({
      tasksSettled: 1,
      tokens: 11,
      reservations: 0,
    });
    expect(
      queue.complete("task", {
        holder: "worker",
        leaseId: claim.lease.leaseId,
        usage: { input_tokens: 1 },
      }),
    ).toMatchObject({ ok: false, reason: "missing-budget-reservation" });
    expect(queue.budgetStatus()).toMatchObject({
      tasksSettled: 1,
      tokens: 11,
    });
  });

  it("overrides an interrupted failure with exact durable adjudication evidence", () => {
    const filePath = tempState();
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("interrupt-fail"),
      processId: 101,
      isProcessAlive: () => true,
      budget: { maxTokens: 10 },
      tasks: [{ key: "task", title: "Task" }],
    });
    const claim = queue.acquire("task", {
      holder: "worker",
      maxTokens: 10,
    });
    const interruption = queue.requestInterrupt("task", {
      holder: "worker",
      leaseId: claim.lease.leaseId,
      fencingToken: claim.lease.fencingToken,
      requestId: "fail-race",
      actor: "operator",
      reason: "stop execution",
    });
    expect(
      queue.fail("task", {
        holder: "worker",
        leaseId: claim.lease.leaseId,
        error: "executor ignored cancellation",
        retryable: true,
        adjudication: {
          code: "UNTRUSTED",
          evidenceDigest: `sha256:${"f".repeat(64)}`,
        },
        usage: { input_tokens: 4, output_tokens: 2 },
      }),
    ).toMatchObject({
      ok: true,
      retry: false,
      interrupted: true,
      chargedTokens: 6,
    });
    expect(queue.getTask("task")).toMatchObject({
      status: "cancelled",
      metadata: {
        lastError: "stop execution",
        adjudication: {
          required: true,
          code: "TEAM_TASK_HUMAN_INTERRUPTED",
          evidenceDigest: interruption.evidenceDigest,
        },
      },
    });
    expect(queue.budgetStatus()).toMatchObject({
      tasksSettled: 1,
      tokens: 6,
      reservations: 0,
    });
  });

  it("returns one atomic status view with task interruption evidence", () => {
    const filePath = tempState();
    let lockCalls = 0;
    const lock = (_target, body) => {
      lockCalls += 1;
      return body({ locked: true });
    };
    const queue = TeamDistributedQueue.create({
      filePath,
      lock,
      id: deterministicIds("status-view"),
      processId: 101,
      isProcessAlive: () => true,
      tasks: [{ key: "task", title: "Task" }],
    });
    const claim = queue.acquire("task", { holder: "worker" });
    const interruption = queue.requestInterrupt("task", {
      holder: "worker",
      leaseId: claim.lease.leaseId,
      fencingToken: claim.lease.fencingToken,
      requestId: "status-interrupt",
      actor: "operator",
      reason: "show in status",
    });
    lockCalls = 0;
    const view = queue.statusView();
    expect(lockCalls).toBe(1);
    expect(view.revision).toBe(view.stats.revision);
    expect(view.interruptions).toHaveLength(1);
    expect(view.tasks).toEqual([
      expect.objectContaining({
        key: "task",
        metadata: expect.objectContaining({
          interruption: expect.objectContaining({
            evidenceDigest: interruption.evidenceDigest,
          }),
        }),
      }),
    ]);
    expect(view).toMatchObject({
      stats: { in_progress: 1 },
      finalization: { phase: "idle" },
      pendingAdjudications: [],
    });
  });

  it("durably records running workspace checkpoints under the active lease fence", () => {
    const filePath = tempState();
    const stateDir = path.join(path.dirname(filePath), "checkpoints");
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("workspace"),
      processId: 101,
      isProcessAlive: () => true,
      tasks: [
        {
          key: "task",
          title: "Task",
          metadata: { retrySafe: true },
        },
      ],
      authority: managedAuthority(stateDir),
    });
    const claim = queue.acquire("task", { holder: "worker-a" });
    const graphDigest = queue.snapshot().graphDigest;
    const record = (execution, fencingToken = claim.lease.fencingToken) =>
      queue.recordWorkspaceExecution("task", {
        holder: "worker-a",
        leaseId: claim.lease.leaseId,
        fencingToken,
        execution,
      });

    expect(record(workspaceExecution(stateDir))).toMatchObject({
      ok: true,
      execution: {
        phase: "prepared",
        lease: {
          leaseId: claim.lease.leaseId,
          fencingToken: claim.lease.fencingToken,
        },
      },
    });
    expect(
      record(
        workspaceExecution(stateDir, {
          phase: "running",
          state: "running",
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      record(
        workspaceExecution(stateDir, {
          phase: "validated",
          state: "running",
        }),
        claim.lease.fencingToken + 1,
      ),
    ).toMatchObject({
      ok: false,
      reason: "not_holder_or_expired",
    });

    const reopened = TeamDistributedQueue.open({
      filePath,
      processId: 101,
      isProcessAlive: () => true,
    });
    expect(reopened.snapshot().graphDigest).toBe(graphDigest);
    expect(reopened.getTask("task")).toMatchObject({
      status: "in_progress",
      metadata: {
        workspaceExecution: {
          phase: "running",
          checkpoint: {
            state: "running",
            recoveryRequired: true,
          },
        },
      },
    });
  });

  it("binds a settled recovery-required failure to its exact attempt evidence", () => {
    const filePath = tempState();
    const stateDir = path.join(path.dirname(filePath), "checkpoints");
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("workspace-settlement"),
      processId: 101,
      isProcessAlive: () => true,
      tasks: [{ key: "task", title: "Task" }],
      authority: managedAuthority(stateDir),
    });
    const claim = queue.acquire("task", { holder: "worker-a" });
    expect(
      queue.recordWorkspaceExecution("task", {
        holder: "worker-a",
        leaseId: claim.lease.leaseId,
        fencingToken: claim.lease.fencingToken,
        execution: workspaceExecution(stateDir, {
          phase: "rollback-recovery-required",
          state: "rollback_failed",
        }),
      }),
    ).toMatchObject({ ok: true });

    expect(
      queue.fail("task", {
        holder: "worker-a",
        leaseId: claim.lease.leaseId,
        error: "checkpoint rollback could not be proven",
        retryable: false,
        adjudication: {
          code: "TEAM_WORKTREE_CHECKPOINT_ROLLBACK_FAILED",
          reason: "checkpoint rollback could not be proven",
          evidenceDigest: null,
        },
      }),
    ).toMatchObject({ ok: true, retry: false });

    const task = queue.getTask("task");
    expect(task).toMatchObject({
      status: "cancelled",
      metadata: {
        adjudication: {
          required: true,
          code: "TEAM_WORKTREE_CHECKPOINT_ROLLBACK_FAILED",
          evidenceDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
        },
        abandonedLeaseEvidence: {
          kind: "distributed-lease-abandonment",
          reason: "settled-adjudication-required",
          lease: {
            holder: "worker-a",
            leaseId: claim.lease.leaseId,
            fencingToken: claim.lease.fencingToken,
          },
          workspaceExecution: {
            phase: "rollback-recovery-required",
            checkpoint: {
              state: "rollback_failed",
              recoveryRequired: true,
            },
          },
        },
      },
    });
    expect(task.metadata.adjudication.evidenceDigest).toBe(
      task.metadata.abandonedLeaseEvidence.evidenceDigest,
    );
    expect(queue.pendingAdjudications()).toEqual([
      expect.objectContaining({
        key: "task",
        evidenceDigest: task.metadata.adjudication.evidenceDigest,
      }),
    ]);
  });

  it("does not replay a retry-safe task whose managed checkpoint was still running at crash", () => {
    const filePath = tempState();
    const stateDir = path.join(path.dirname(filePath), "checkpoints");
    const alive = new Set([111, 222]);
    const first = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("workspace-crash"),
      processId: 111,
      isProcessAlive: (pid) => alive.has(pid),
      tasks: [
        {
          key: "task",
          title: "Task",
          metadata: { retrySafe: true },
        },
      ],
      authority: managedAuthority(stateDir),
    });
    const claim = first.acquire("task", { holder: "worker-a" });
    expect(
      first.recordWorkspaceExecution("task", {
        holder: "worker-a",
        leaseId: claim.lease.leaseId,
        fencingToken: claim.lease.fencingToken,
        execution: workspaceExecution(stateDir, {
          phase: "running",
          state: "running",
        }),
      }),
    ).toMatchObject({ ok: true });
    alive.delete(111);

    const rescuer = new TeamDistributedQueue({
      filePath,
      id: deterministicIds("workspace-rescuer"),
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });

    expect(rescuer.claim({ holder: "rescuer" })).toEqual({
      ok: false,
      reason: "no_claimable_task",
    });
    expect(rescuer.getTask("task")).toMatchObject({
      status: "cancelled",
      metadata: {
        adjudication: { required: true },
        abandonedLeaseEvidence: {
          workspaceExecution: {
            phase: "running",
            checkpoint: { state: "running" },
          },
        },
      },
    });
  });

  it("archives a proven rollback before issuing a retry lease", () => {
    const filePath = tempState();
    const stateDir = path.join(path.dirname(filePath), "checkpoints");
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("workspace-retry"),
      processId: 101,
      isProcessAlive: () => true,
      tasks: [
        {
          key: "task",
          title: "Task",
          metadata: { retrySafe: true },
        },
      ],
      authority: managedAuthority(stateDir),
    });
    const first = queue.acquire("task", { holder: "worker-a" });
    const record = (execution) =>
      queue.recordWorkspaceExecution("task", {
        holder: "worker-a",
        leaseId: first.lease.leaseId,
        fencingToken: first.lease.fencingToken,
        execution,
      });
    expect(record(workspaceExecution(stateDir))).toMatchObject({ ok: true });
    expect(
      record(
        workspaceExecution(stateDir, {
          phase: "running",
          state: "running",
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      record(
        workspaceExecution(stateDir, {
          phase: "rolled-back",
          state: "rolled_back",
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      queue.fail("task", {
        holder: "worker-a",
        leaseId: first.lease.leaseId,
        error: "retry me",
        retryable: true,
      }),
    ).toMatchObject({ ok: true, retry: true });

    const second = queue.acquire("task", { holder: "worker-b" });

    expect(second).toMatchObject({
      ok: true,
      lease: { fencingToken: first.lease.fencingToken + 1 },
    });
    expect(queue.getTask("task").metadata).toMatchObject({
      workspaceExecution: null,
      workspaceExecutionHistory: [
        {
          phase: "rolled-back",
          lease: { leaseId: first.lease.leaseId },
          checkpoint: { state: "rolled_back" },
        },
      ],
    });
  });

  it("reclaims a dead process before TTL while preserving the execution count", () => {
    const filePath = tempState();
    const alive = new Set([111, 222]);
    const first = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds(),
      processId: 111,
      isProcessAlive: (pid) => alive.has(pid),
      budget: { maxTasks: 2 },
      defaultTtlMs: 60_000,
      tasks: [
        {
          key: "task",
          title: "Task",
          metadata: { retrySafe: true },
        },
      ],
    });
    const abandoned = first.acquire("task", {
      holder: "crashed",
      ttlMs: 60_000,
    });
    alive.delete(111);

    const rescuer = new TeamDistributedQueue({
      filePath,
      id: deterministicIds("rescuer"),
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    const rescued = rescuer.claim({ holder: "rescuer", ttlMs: 60_000 });
    expect(rescued).toMatchObject({
      ok: true,
      key: "task",
      lease: { fencingToken: 2 },
    });
    expect(
      rescuer.complete("task", {
        holder: "crashed",
        leaseId: abandoned.lease.leaseId,
      }),
    ).toMatchObject({ ok: false });
    expect(
      rescuer.complete("task", {
        holder: "rescuer",
        leaseId: rescued.lease.leaseId,
      }),
    ).toMatchObject({ ok: true });
    expect(rescuer.budgetStatus()).toMatchObject({
      tasksStarted: 2,
      tasksSettled: 1,
      reason: "max-tasks",
    });
  });

  it("fails an abandoned non-retry-safe task closed with durable lease evidence", () => {
    const filePath = tempState();
    const alive = new Set([111, 222]);
    const first = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("unsafe"),
      processId: 111,
      isProcessAlive: (pid) => alive.has(pid),
      budget: { maxTasks: 2, maxTokens: 10, maxUsd: 1 },
      defaultTtlMs: 60_000,
      tasks: [
        {
          key: "external-write",
          title: "External write",
          metadata: { retrySafe: false },
        },
      ],
    });
    const abandoned = first.claim({
      holder: "crashed-side-effect-worker",
      maxTokens: 6,
      maxUsd: 0.6,
    });
    expect(abandoned).toMatchObject({
      ok: true,
      lease: { ownerPid: 111, fencingToken: 1 },
    });
    alive.delete(111);

    const rescuer = new TeamDistributedQueue({
      filePath,
      id: deterministicIds("unsafe-rescuer"),
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    expect(rescuer.claim({ holder: "must-not-replay" })).toEqual({
      ok: false,
      reason: "no_claimable_task",
    });

    const failedClosed = rescuer.getTask("external-write");
    expect(failedClosed).toMatchObject({
      status: "cancelled",
      lease: null,
      metadata: {
        attempts: 1,
        adjudication: {
          required: true,
          code: "TEAM_TASK_ABANDONED_ADJUDICATION_REQUIRED",
          decision: null,
        },
        abandonedLeaseEvidence: {
          schemaVersion: 1,
          kind: "distributed-lease-abandonment",
          taskKey: "external-write",
          reason: "owner-dead",
          lease: {
            holder: "crashed-side-effect-worker",
            leaseId: abandoned.lease.leaseId,
            ownerPid: 111,
            fencingToken: 1,
          },
          budgetReservation: {
            taskKey: "external-write",
            leaseId: abandoned.lease.leaseId,
            reservedTokens: 6,
            reservedUsd: 0.6,
          },
        },
      },
    });
    expect(failedClosed.metadata.abandonedLeaseEvidence.evidenceDigest).toMatch(
      /^sha256:[a-f0-9]{64}$/,
    );
    expect(failedClosed.metadata.adjudication.evidenceDigest).toBe(
      failedClosed.metadata.abandonedLeaseEvidence.evidenceDigest,
    );
    expect(rescuer.pendingAdjudications()).toEqual([
      expect.objectContaining({
        key: "external-write",
        code: "TEAM_TASK_ABANDONED_ADJUDICATION_REQUIRED",
        evidenceDigest:
          failedClosed.metadata.abandonedLeaseEvidence.evidenceDigest,
      }),
    ]);
    expect(rescuer.stats()).toMatchObject({
      adjudicationRequired: 1,
      budget: {
        tasksStarted: 1,
        tasksSettled: 0,
        tokens: 6,
        spentUsd: 0.6,
        reservations: 0,
      },
    });
    expect(rescuer.allDone()).toBe(false);
    expect(
      rescuer.adjudicationAcceptance("external-write", {
        evidenceDigest:
          failedClosed.metadata.abandonedLeaseEvidence.evidenceDigest,
      }),
    ).toEqual({
      ok: false,
      reason: "workspace_execution_evidence_missing",
    });
    expect(
      rescuer.complete("external-write", {
        holder: "crashed-side-effect-worker",
        leaseId: abandoned.lease.leaseId,
      }),
    ).toMatchObject({ ok: false });

    const reopened = TeamDistributedQueue.open({
      filePath,
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    expect(reopened.claim({ holder: "still-must-not-replay" })).toEqual({
      ok: false,
      reason: "no_claimable_task",
    });
    expect(reopened.stats().adjudicationRequired).toBe(1);
  });

  it("resolves retry with bounded input, exact replay, and no budget refund", () => {
    const filePath = tempState();
    const alive = new Set([111, 222]);
    const first = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("resolve-retry"),
      processId: 111,
      isProcessAlive: (pid) => alive.has(pid),
      budget: { maxTasks: 3, maxTokens: 10, maxUsd: 1 },
      defaultTtlMs: 60_000,
      tasks: [
        {
          key: "task",
          title: "Task",
          metadata: { retrySafe: false },
        },
      ],
    });
    expect(
      first.acquire("task", {
        holder: "crashed",
        maxTokens: 4,
        maxUsd: 0.4,
      }),
    ).toMatchObject({ ok: true });
    alive.delete(111);

    const queue = new TeamDistributedQueue({
      filePath,
      id: deterministicIds("resolve-retry-rescuer"),
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    const pending = queue.pendingAdjudications()[0];
    expect(pending).toMatchObject({ key: "task", required: true });
    const evidenceDigest = pending.evidenceDigest;
    const initialRevision = queue.snapshot().revision;

    for (const request of [
      {
        decision: "retry",
        decisionId: `bad\nid`,
        evidenceDigest,
      },
      {
        decision: "retry",
        decisionId: "x".repeat(257),
        evidenceDigest,
      },
      {
        decision: "retry",
        decisionId: "bad-actor",
        actor: "operator\u0000name",
        evidenceDigest,
      },
      {
        decision: "retry",
        decisionId: "bad-reason",
        reason: "line 1\nline 2",
        evidenceDigest,
      },
      {
        decision: "retry",
        decisionId: "result-forbidden",
        evidenceDigest,
        result: null,
      },
    ]) {
      expect(queue.resolveAdjudication("task", request)).toMatchObject({
        ok: false,
      });
    }
    expect(
      queue.resolveAdjudication("task", {
        decision: "retry",
        decisionId: "wrong-evidence",
        evidenceDigest: `sha256:${"f".repeat(64)}`,
      }),
    ).toEqual({ ok: false, reason: "evidence_mismatch" });
    expect(queue.snapshot().revision).toBe(initialRevision);

    const exactRequest = {
      decision: "retry",
      decisionId: "d".repeat(256),
      actor: "a".repeat(256),
      reason: "r".repeat(4096),
      evidenceDigest,
    };
    expect(queue.resolveAdjudication("task", exactRequest)).toMatchObject({
      ok: true,
      decision: "retry",
      decisionId: exactRequest.decisionId,
      status: "pending",
      requestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    });
    const resolvedRevision = queue.snapshot().revision;
    expect(resolvedRevision).toBe(initialRevision + 1);
    expect(queue.resolveAdjudication("task", exactRequest)).toMatchObject({
      ok: true,
      idempotent: true,
      decision: "retry",
      status: "pending",
    });
    expect(
      queue.resolveAdjudication("task", {
        ...exactRequest,
        actor: "different",
      }),
    ).toEqual({
      ok: false,
      reason: "decision_id_conflict",
      decisionId: exactRequest.decisionId,
    });
    expect(
      queue.resolveAdjudication("task", {
        ...exactRequest,
        decisionId: "different-decision",
      }),
    ).toEqual({ ok: false, reason: "adjudication_not_required" });
    expect(queue.snapshot().revision).toBe(resolvedRevision);
    expect(queue.budgetStatus()).toMatchObject({
      tasksStarted: 1,
      tasksSettled: 0,
      tokens: 4,
      spentUsd: 0.4,
      reservations: 0,
    });

    const retry = queue.acquire("task", {
      holder: "rescuer",
      maxTokens: 6,
      maxUsd: 0.6,
    });
    expect(retry).toMatchObject({
      ok: true,
      lease: { fencingToken: 2 },
    });
    expect(queue.budgetStatus()).toMatchObject({
      tasksStarted: 2,
      tasksSettled: 0,
      tokens: 4,
      spentUsd: 0.4,
      reservedTokens: 6,
      reservedUsd: 0.6,
    });
  });

  it("rejects validated work and accepts only exact recovered committed evidence", () => {
    const filePath = tempState();
    const stateDir = path.join(path.dirname(filePath), "checkpoints");
    const alive = new Set([111, 222]);
    const first = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("resolve-accept"),
      processId: 111,
      isProcessAlive: (pid) => alive.has(pid),
      budget: { maxTasks: 2 },
      defaultTtlMs: 60_000,
      tasks: [
        {
          key: "task",
          title: "Task",
          metadata: { retrySafe: false },
        },
        { key: "dependent", title: "Dependent", dependsOn: ["task"] },
      ],
      authority: managedAuthority(stateDir),
    });
    const claim = first.acquire("task", { holder: "worker-a" });
    const record = (execution) =>
      first.recordWorkspaceExecution("task", {
        holder: "worker-a",
        leaseId: claim.lease.leaseId,
        fencingToken: claim.lease.fencingToken,
        execution,
      });
    expect(record(workspaceExecution(stateDir))).toMatchObject({ ok: true });
    expect(
      record(
        workspaceExecution(stateDir, {
          phase: "running",
          state: "running",
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      record(
        workspaceExecution(stateDir, {
          phase: "validated",
          state: "running",
        }),
      ),
    ).toMatchObject({ ok: true });
    alive.delete(111);

    const queue = new TeamDistributedQueue({
      filePath,
      id: deterministicIds("resolve-accept-rescuer"),
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    const pending = queue.pendingAdjudications()[0];
    const evidenceDigest = pending.evidenceDigest;
    const initialRevision = queue.snapshot().revision;
    expect(
      queue.adjudicationAcceptance("task", {
        evidenceDigest,
      }),
    ).toEqual({
      ok: false,
      reason: "workspace_execution_not_acceptance_ready",
    });
    expect(
      queue.resolveAdjudication("task", {
        decision: "retry",
        decisionId: "unsafe-retry",
        evidenceDigest,
      }),
    ).toEqual({
      ok: false,
      reason: "workspace_checkpoint_recovery_required",
    });
    expect(
      queue.resolveAdjudication("task", {
        decision: "accept",
        decisionId: "blind-accept",
        evidenceDigest,
        result: { externalId: "unproven" },
      }),
    ).toEqual({
      ok: false,
      reason: "workspace_execution_not_acceptance_ready",
    });
    const cyclicResult = {};
    cyclicResult.self = cyclicResult;
    expect(
      queue.resolveAdjudication("task", {
        decision: "accept",
        decisionId: "cyclic-result",
        evidenceDigest,
        result: cyclicResult,
      }),
    ).toMatchObject({ ok: false, reason: "invalid_result" });
    expect(queue.snapshot().revision).toBe(initialRevision);

    const committed = workspaceExecution(stateDir, {
      phase: "committed",
      state: "committed",
    });
    expect(
      queue.reconcileWorkspaceExecution("task", {
        recoveryId: "recover-validated-commit",
        evidenceDigest,
        checkpointDigest: committed.checkpoint.checkpointDigest,
        writeManifestDigest: committed.checkpoint.writeManifestDigest,
        checkpointEvidenceDigest: committed.checkpoint.evidenceDigest,
        execution: committed,
      }),
    ).toMatchObject({ ok: true, outcome: "committed" });
    expect(
      queue.resolveAdjudication("task", {
        decision: "accept",
        decisionId: "blind-accept",
        evidenceDigest,
        result: { externalId: "unproven" },
      }),
    ).toEqual({ ok: false, reason: "result_evidence_mismatch" });
    const acceptance = queue.adjudicationAcceptance("task", {
      evidenceDigest,
    });
    expect(acceptance).toMatchObject({
      ok: true,
      result: {
        branch: "team/run-1/task",
        commitOid: "b".repeat(40),
        baselineCommitOid: "a".repeat(40),
        workspaceExecutionEvidence: {
          kind: "distributed-workspace-adjudication-acceptance",
          phase: "committed",
          abandonmentEvidenceDigest: evidenceDigest,
        },
      },
    });
    const request = {
      decision: "accept",
      decisionId: "accept-validated-worktree",
      actor: "operator@example.test",
      reason: "recovered committed checkpoint matches the abandoned attempt",
      evidenceDigest,
      result: acceptance.result,
    };
    expect(queue.resolveAdjudication("task", request)).toMatchObject({
      ok: true,
      decision: "accept",
      status: "completed",
    });
    const resolvedRevision = queue.snapshot().revision;
    expect(queue.getTask("task")).toMatchObject({
      status: "completed",
      metadata: {
        result: acceptance.result,
        adjudication: {
          required: false,
          decision: {
            id: request.decisionId,
            queueRequestDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            resultDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
            workspaceEvidence: acceptance.proof,
          },
        },
      },
    });
    expect(queue.claimable()).toEqual(["dependent"]);
    expect(
      queue.resolveAdjudication("task", {
        ...request,
        result: JSON.parse(JSON.stringify(request.result)),
      }),
    ).toMatchObject({ ok: true, idempotent: true });
    expect(queue.snapshot().revision).toBe(resolvedRevision);
  });

  it("reconciles a same-fence terminal rollback before authorizing retry", () => {
    const filePath = tempState();
    const stateDir = path.join(path.dirname(filePath), "checkpoints");
    const alive = new Set([111, 222]);
    const first = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("workspace-recovery"),
      processId: 111,
      isProcessAlive: (pid) => alive.has(pid),
      budget: { maxTasks: 3 },
      defaultTtlMs: 60_000,
      tasks: [
        {
          key: "task",
          title: "Task",
          metadata: { retrySafe: false },
        },
      ],
      authority: managedAuthority(stateDir),
    });
    const claim = first.acquire("task", { holder: "worker-a" });
    const record = (execution) =>
      first.recordWorkspaceExecution("task", {
        holder: "worker-a",
        leaseId: claim.lease.leaseId,
        fencingToken: claim.lease.fencingToken,
        execution,
      });
    expect(record(workspaceExecution(stateDir))).toMatchObject({ ok: true });
    expect(
      record(
        workspaceExecution(stateDir, {
          phase: "running",
          state: "running",
        }),
      ),
    ).toMatchObject({ ok: true });
    alive.delete(111);

    const queue = new TeamDistributedQueue({
      filePath,
      id: deterministicIds("workspace-recovery-rescuer"),
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    const pending = queue.pendingAdjudications()[0];
    const rolledBack = workspaceExecution(stateDir, {
      phase: "rolled-back",
      state: "rolled_back",
    });
    const recovery = {
      recoveryId: "checkpoint-recovery-1",
      actor: "recovery-worker",
      reason: "broker restore verified the write manifest",
      evidenceDigest: pending.evidenceDigest,
      checkpointDigest: rolledBack.checkpoint.checkpointDigest,
      writeManifestDigest: rolledBack.checkpoint.writeManifestDigest,
      checkpointEvidenceDigest: rolledBack.checkpoint.evidenceDigest,
      execution: rolledBack,
    };
    const initialRevision = queue.snapshot().revision;
    expect(
      queue.reconcileWorkspaceExecution("task", {
        ...recovery,
        checkpointEvidenceDigest: `sha256:${"e".repeat(64)}`,
      }),
    ).toEqual({
      ok: false,
      reason: "workspace_recovery_evidence_mismatch",
    });
    expect(queue.snapshot().revision).toBe(initialRevision);

    expect(queue.reconcileWorkspaceExecution("task", recovery)).toMatchObject({
      ok: true,
      recoveryId: recovery.recoveryId,
      outcome: "rolled-back",
      execution: {
        phase: "rolled-back",
        checkpoint: {
          state: "rolled_back",
          recoveryRequired: false,
        },
      },
    });
    const recoveredRevision = queue.snapshot().revision;
    expect(recoveredRevision).toBe(initialRevision + 1);
    expect(queue.reconcileWorkspaceExecution("task", recovery)).toMatchObject({
      ok: true,
      idempotent: true,
      outcome: "rolled-back",
    });
    expect(
      queue.reconcileWorkspaceExecution("task", {
        ...recovery,
        reason: "conflicting recovery request",
      }),
    ).toEqual({
      ok: false,
      reason: "recovery_id_conflict",
      recoveryId: recovery.recoveryId,
    });
    expect(queue.snapshot().revision).toBe(recoveredRevision);

    const reopened = TeamDistributedQueue.open({
      filePath,
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    expect(reopened.getTask("task")).toMatchObject({
      status: "cancelled",
      metadata: {
        adjudication: { required: true },
        workspaceExecution: {
          phase: "rolled-back",
          checkpoint: { state: "rolled_back" },
        },
        workspaceRecovery: {
          recoveryId: recovery.recoveryId,
          outcome: "rolled-back",
          abandonmentEvidenceDigest: pending.evidenceDigest,
        },
      },
    });
    expect(
      reopened.resolveAdjudication("task", {
        decision: "retry",
        decisionId: "retry-after-proven-rollback",
        evidenceDigest: pending.evidenceDigest,
      }),
    ).toMatchObject({ ok: true, status: "pending" });
    expect(reopened.acquire("task", { holder: "replacement" })).toMatchObject({
      ok: true,
      lease: { fencingToken: 2 },
    });
    expect(reopened.getTask("task").metadata).toMatchObject({
      workspaceExecution: null,
      workspaceExecutionHistory: [
        {
          phase: "rolled-back",
          checkpoint: { state: "rolled_back" },
        },
      ],
    });
    expect(reopened.getTask("task").metadata.workspaceRecovery).toBeUndefined();
    expect(reopened.budgetStatus()).toMatchObject({
      tasksStarted: 2,
      tasksSettled: 0,
    });
  });

  it("binds a recovered committed checkpoint into the acceptance proof", () => {
    const filePath = tempState();
    const stateDir = path.join(path.dirname(filePath), "checkpoints");
    const alive = new Set([111, 222]);
    const first = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("committed-recovery"),
      processId: 111,
      isProcessAlive: (pid) => alive.has(pid),
      tasks: [
        {
          key: "task",
          title: "Task",
          metadata: { retrySafe: false },
        },
      ],
      authority: managedAuthority(stateDir),
    });
    const claim = first.acquire("task", { holder: "worker-a" });
    const record = (execution) =>
      first.recordWorkspaceExecution("task", {
        holder: "worker-a",
        leaseId: claim.lease.leaseId,
        fencingToken: claim.lease.fencingToken,
        execution,
      });
    expect(record(workspaceExecution(stateDir))).toMatchObject({ ok: true });
    expect(
      record(
        workspaceExecution(stateDir, {
          phase: "running",
          state: "running",
        }),
      ),
    ).toMatchObject({ ok: true });
    expect(
      record(
        workspaceExecution(stateDir, {
          phase: "validated",
          state: "running",
        }),
      ),
    ).toMatchObject({ ok: true });
    alive.delete(111);

    const queue = new TeamDistributedQueue({
      filePath,
      id: deterministicIds("committed-recovery-rescuer"),
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    const pending = queue.pendingAdjudications()[0];
    const committed = workspaceExecution(stateDir, {
      phase: "committed",
      state: "committed",
    });
    expect(
      queue.reconcileWorkspaceExecution("task", {
        recoveryId: "committed-recovery-1",
        evidenceDigest: pending.evidenceDigest,
        checkpointDigest: committed.checkpoint.checkpointDigest,
        writeManifestDigest: committed.checkpoint.writeManifestDigest,
        checkpointEvidenceDigest: committed.checkpoint.evidenceDigest,
        execution: committed,
      }),
    ).toMatchObject({ ok: true, outcome: "committed" });
    const acceptance = queue.adjudicationAcceptance("task", {
      evidenceDigest: pending.evidenceDigest,
    });
    expect(acceptance).toMatchObject({
      ok: true,
      proof: {
        phase: "committed",
        workspaceRecoveryDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      },
    });
    expect(
      queue.resolveAdjudication("task", {
        decision: "accept",
        decisionId: "accept-recovered-commit",
        evidenceDigest: pending.evidenceDigest,
        result: acceptance.result,
      }),
    ).toMatchObject({ ok: true, status: "completed" });
    expect(queue.getTask("task")).toMatchObject({
      status: "completed",
      metadata: {
        result: {
          commitOid: "b".repeat(40),
          workspaceExecutionEvidence: {
            phase: "committed",
            workspaceRecoveryDigest: acceptance.proof.workspaceRecoveryDigest,
          },
        },
      },
    });
  });

  it("keeps decision ids queue-global and rejects conflicting reuse", () => {
    const filePath = tempState();
    const alive = new Set([111, 222]);
    const first = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("global-decision-id"),
      processId: 111,
      isProcessAlive: (pid) => alive.has(pid),
      budget: { maxTasks: 4 },
      defaultTtlMs: 60_000,
      tasks: [
        { key: "a", title: "A", metadata: { retrySafe: false } },
        { key: "b", title: "B", metadata: { retrySafe: false } },
      ],
    });
    expect(first.acquire("a", { holder: "crashed-a" }).ok).toBe(true);
    expect(first.acquire("b", { holder: "crashed-b" }).ok).toBe(true);
    alive.delete(111);
    const queue = new TeamDistributedQueue({
      filePath,
      id: deterministicIds("global-decision-id-rescuer"),
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    const evidence = new Map(
      queue
        .pendingAdjudications()
        .map((pending) => [pending.key, pending.evidenceDigest]),
    );
    expect(
      queue.resolveAdjudication("a", {
        decision: "cancel",
        decisionId: "queue-global-id",
        evidenceDigest: evidence.get("a"),
      }),
    ).toMatchObject({ ok: true, status: "cancelled" });
    const revision = queue.snapshot().revision;
    expect(
      queue.resolveAdjudication("b", {
        decision: "cancel",
        decisionId: "queue-global-id",
        evidenceDigest: evidence.get("b"),
      }),
    ).toEqual({
      ok: false,
      reason: "decision_id_conflict",
      decisionId: "queue-global-id",
    });
    expect(queue.snapshot().revision).toBe(revision);
  });

  it("charges abandoned reservations so crash/retry cannot refresh a budget", () => {
    const filePath = tempState();
    const alive = new Set([111, 222]);
    const first = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds(),
      processId: 111,
      isProcessAlive: (pid) => alive.has(pid),
      budget: { maxTasks: 3, maxTokens: 10, maxUsd: 1 },
      defaultTtlMs: 60_000,
      tasks: [
        {
          key: "task",
          title: "Task",
          metadata: { retrySafe: true },
        },
      ],
    });
    expect(
      first.acquire("task", {
        holder: "crashed",
        maxTokens: 6,
        maxUsd: 0.6,
      }),
    ).toMatchObject({ ok: true });
    alive.delete(111);

    const rescuer = new TeamDistributedQueue({
      filePath,
      id: deterministicIds("rescuer"),
      processId: 222,
      isProcessAlive: (pid) => alive.has(pid),
    });
    expect(
      rescuer.acquire("task", {
        holder: "too-expensive",
        maxTokens: 6,
        maxUsd: 0.6,
      }),
    ).toMatchObject({ ok: false, reason: "max-tokens" });
    expect(rescuer.budgetStatus()).toMatchObject({
      tasksStarted: 1,
      tokens: 6,
      spentUsd: 0.6,
      reservations: 0,
    });
    expect(
      rescuer.acquire("task", {
        holder: "bounded-rescuer",
        maxTokens: 4,
        maxUsd: 0.4,
      }),
    ).toMatchObject({ ok: true, lease: { fencingToken: 2 } });
  });

  it("atomically enforces task, token, USD, and wall-clock authority", () => {
    const filePath = tempState();
    const clock = makeClock();
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds(),
      now: clock.now,
      processId: 101,
      isProcessAlive: () => true,
      budget: {
        maxTasks: 2,
        maxTokens: 100,
        maxUsd: 2,
        maxWallMs: 1_000,
      },
      tasks: [
        { key: "a", title: "A" },
        { key: "b", title: "B" },
        { key: "c", title: "C" },
      ],
    });

    const a = queue.acquire("a", {
      holder: "worker-a",
      maxTokens: 60,
      maxUsd: 1,
    });
    expect(a).toMatchObject({
      ok: true,
      budgetReservation: { maxTokens: 60, maxUsd: 1 },
    });
    expect(
      queue.acquire("b", {
        holder: "worker-b",
        maxTokens: 50,
        maxUsd: 1,
      }),
    ).toMatchObject({ ok: false, reason: "max-tokens" });

    expect(
      queue.complete("a", {
        holder: "worker-a",
        leaseId: a.lease.leaseId,
        usage: { input_tokens: 30, output_tokens: 10 },
        costUsd: 0.5,
      }),
    ).toMatchObject({ ok: true, chargedTokens: 40, chargedUsd: 0.5 });
    const b = queue.acquire("b", {
      holder: "worker-b",
      maxTokens: 60,
      maxUsd: 1.5,
    });
    expect(b.ok).toBe(true);
    expect(
      queue.complete("b", {
        holder: "worker-b",
        leaseId: b.lease.leaseId,
        usage: { input_tokens: 20, output_tokens: 20 },
        costUsd: 1,
      }),
    ).toMatchObject({ ok: true });
    expect(queue.acquire("c", { holder: "worker-c" })).toMatchObject({
      ok: false,
      reason: "max-tasks",
    });
    expect(queue.budgetStatus()).toMatchObject({
      tasksStarted: 2,
      tasksSettled: 2,
      tokens: 80,
      spentUsd: 1.5,
      reason: "max-tasks",
    });
  });

  it("counts cache tokens against the distributed cap and validates usage records", () => {
    const filePath = tempState();
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds("cache-budget"),
      processId: 101,
      isProcessAlive: () => true,
      budget: { maxTokens: 60 },
      tasks: [{ key: "task", title: "Task" }],
    });
    const claim = queue.acquire("task", {
      holder: "worker",
      maxTokens: 60,
    });
    const overCapUsage = {
      input_tokens: 20,
      output_tokens: 10,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 11,
    };
    expect(
      queue.complete("task", {
        holder: "worker",
        leaseId: claim.lease.leaseId,
        usage: overCapUsage,
      }),
    ).toMatchObject({
      ok: false,
      reason: "usage-exceeds-reservation",
    });
    expect(queue.getTask("task").status).toBe("in_progress");

    const usage = {
      input_tokens: 20,
      output_tokens: 10,
      cache_read_input_tokens: 20,
      cache_creation_input_tokens: 10,
    };
    expect(
      queue.complete("task", {
        holder: "worker",
        leaseId: claim.lease.leaseId,
        usage,
        usageRecords: [
          {
            provider: "anthropic",
            model: "claude",
            usage: { input_tokens: 20, output_tokens: 10 },
          },
        ],
      }),
    ).toMatchObject({
      ok: false,
      reason: "invalid-usage",
      error: expect.stringContaining("cache_read_input_tokens"),
    });
    expect(queue.getTask("task").status).toBe("in_progress");
    expect(
      queue.complete("task", {
        holder: "worker",
        leaseId: claim.lease.leaseId,
        usage,
        usageRecords: [
          {
            provider: "anthropic",
            model: "claude",
            usage: {
              input_tokens: 8,
              output_tokens: 4,
              cache_read_input_tokens: 12,
              cache_creation_input_tokens: 6,
            },
          },
          {
            provider: "anthropic",
            model: "claude",
            usage: {
              input_tokens: 12,
              output_tokens: 6,
              cache_read_input_tokens: 8,
              cache_creation_input_tokens: 4,
            },
          },
        ],
      }),
    ).toMatchObject({ ok: true, chargedTokens: 60 });
    expect(queue.budgetStatus()).toMatchObject({
      tasksSettled: 1,
      tokens: 60,
      reason: "max-tokens",
    });
  });

  it("charges a full reservation when metering is missing", () => {
    const filePath = tempState();
    const queue = TeamDistributedQueue.create({
      filePath,
      id: deterministicIds(),
      processId: 101,
      isProcessAlive: () => true,
      budget: { maxTokens: 20, maxUsd: 1 },
      tasks: [{ key: "task", title: "Task" }],
    });
    const claim = queue.claim({
      holder: "worker",
      maxTokens: 20,
      maxUsd: 1,
    });
    expect(
      queue.complete("task", {
        holder: "worker",
        leaseId: claim.lease.leaseId,
      }),
    ).toMatchObject({ ok: true, chargedTokens: 20, chargedUsd: 1 });
    expect(queue.budgetStatus()).toMatchObject({
      tokens: 20,
      spentUsd: 1,
    });
  });
});

describe("TeamDistributedQueue fail-closed persistence", () => {
  it("writes one private regular file atomically", () => {
    const filePath = tempState();
    createQueue(filePath);
    const stat = fs.lstatSync(filePath);
    expect(stat.isFile()).toBe(true);
    expect(stat.nlink).toBe(1);
    if (process.platform !== "win32") {
      expect(stat.mode & 0o777).toBe(0o600);
    }
    expect(
      fs
        .readdirSync(path.dirname(filePath))
        .filter((name) => name.endsWith(".tmp")),
    ).toEqual([]);
  });

  it("rejects corrupt content and digest tampering without overwriting it", () => {
    const filePath = tempState();
    const queue = createQueue(filePath);
    const state = JSON.parse(fs.readFileSync(filePath, "utf8"));
    state.authority.runId = "tampered";
    const tampered = `${JSON.stringify(state)}\n`;
    fs.writeFileSync(filePath, tampered, { encoding: "utf8", mode: 0o600 });

    expect(() => queue.stats()).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_CORRUPT" }),
    );
    expect(fs.readFileSync(filePath, "utf8")).toBe(tampered);
  });

  it("rejects symlink and hardlink state paths", () => {
    const filePath = tempState();
    createQueue(filePath);
    const hardlinkPath = path.join(path.dirname(filePath), "hardlink.json");
    fs.linkSync(filePath, hardlinkPath);
    const hardlinkQueue = new TeamDistributedQueue({
      filePath: hardlinkPath,
      lockTimeoutMs: 20,
    });
    expect(() => hardlinkQueue.stats()).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_INSECURE_PATH" }),
    );

    const symlinkPath = path.join(path.dirname(filePath), "symlink.json");
    try {
      fs.symlinkSync(filePath, symlinkPath, "file");
    } catch (error) {
      if (process.platform === "win32" && error?.code === "EPERM") return;
      throw error;
    }
    const symlinkQueue = new TeamDistributedQueue({ filePath: symlinkPath });
    expect(() => symlinkQueue.stats()).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_INSECURE_PATH" }),
    );
  });

  it("enforces the configured state-size upper bound", () => {
    const filePath = tempState();
    createQueue(filePath);
    const queue = new TeamDistributedQueue({
      filePath,
      maxStateBytes: 32,
    });
    expect(() => queue.snapshot()).toThrowError(
      expect.objectContaining({ code: "TEAM_QUEUE_TOO_LARGE" }),
    );
  });

  it("never falls back to an unlocked mutation", () => {
    const filePath = tempState();
    createQueue(filePath);
    const lockDirectory = `${filePath}.lock`;
    fs.mkdirSync(lockDirectory);
    fs.writeFileSync(
      path.join(lockDirectory, "owner.json"),
      JSON.stringify({
        pid: process.pid,
        startedAt: Date.now(),
        token: "live-owner-token-0001",
      }),
      { mode: 0o600 },
    );
    const queue = new TeamDistributedQueue({
      filePath,
      lockTimeoutMs: 5,
      lockRetryMs: 1,
    });
    let failure;
    try {
      queue.stats();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "TEAM_QUEUE_LOCK_FAILED",
      cause: {
        code: "STATE_LOCK_UNAVAILABLE",
      },
    });
    expect(fs.existsSync(lockDirectory)).toBe(true);
    expect(JSON.parse(fs.readFileSync(filePath, "utf8")).revision).toBe(0);
  });

  it("passes bounded fair strict-lock options without permitting unlocked access", () => {
    const filePath = tempState();
    const observed = [];
    const lock = (target, body, options) => {
      observed.push({ target, options });
      return body({ locked: true });
    };
    const queue = TeamDistributedQueue.create({
      filePath,
      lock,
      lockTimeoutMs: 31_000,
      lockRetryMs: 7,
      lockMaxRetryMs: 70,
      lockRetryJitterMs: 13,
      lockYieldAfterReleaseMs: 23,
      lockOptions: { failIfUnavailable: false },
      tasks: [{ key: "task", title: "Task" }],
    });
    queue.stats();

    expect(observed).toHaveLength(2);
    for (const entry of observed) {
      expect(entry.target).toBe(path.resolve(filePath));
      expect(entry.options).toMatchObject({
        timeoutMs: 31_000,
        retryMs: 7,
        maxRetryMs: 70,
        retryJitterMs: 13,
        yieldAfterReleaseMs: 23,
        failIfUnavailable: true,
      });
    }
  });

  it("preserves the complete strict-lock filesystem cause chain", () => {
    const filePath = tempState();
    createQueue(filePath);
    const filesystemError = new Error("Windows lock directory is busy");
    filesystemError.code = "EPERM";
    const stateLockError = new Error("state lock unavailable", {
      cause: filesystemError,
    });
    stateLockError.code = "STATE_LOCK_UNAVAILABLE";
    const queue = new TeamDistributedQueue({
      filePath,
      lock: () => {
        throw stateLockError;
      },
    });

    let failure;
    try {
      queue.stats();
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: "TEAM_QUEUE_LOCK_FAILED",
      cause: {
        code: "STATE_LOCK_UNAVAILABLE",
        cause: {
          code: "EPERM",
        },
      },
    });
  });

  it("uses a typed error for attempts to recreate an existing queue", () => {
    const filePath = tempState();
    createQueue(filePath);
    expect(() =>
      TeamDistributedQueue.create({
        filePath,
        tasks: [{ key: "replacement", title: "Replacement" }],
      }),
    ).toThrowError(
      expect.objectContaining({
        code: "TEAM_QUEUE_ALREADY_EXISTS",
      }),
    );
    expect(TeamDistributedQueueError).toBeTypeOf("function");
  });
});
