import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeCheckpointIdentity,
  createCheckpoint as createCopyCheckpoint,
  diffCheckpoint as diffCopyCheckpoint,
  executeCheckpointRollback as executeCopyCheckpointRollback,
  prepareCheckpointRollback as prepareCopyCheckpointRollback,
} from "../../src/lib/file-checkpoint.js";
import {
  createCheckpoint as createGitCheckpoint,
  executeCheckpointRollback as executeGitCheckpointRollback,
  prepareCheckpointRollback as prepareGitCheckpointRollback,
  statusAgainst as statusAgainstGitCheckpoint,
} from "../../src/lib/checkpoint-store.js";
import { createCheckpointRestorePartialRollbackController } from "../../src/lib/checkpoint-restore-partial-rollback-controller.js";
import {
  CheckpointRestoreSagaStore,
  CHECKPOINT_RESTORE_SAGA_ERROR_CODES,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "../../src/lib/checkpoint-restore-saga.js";
import { createCheckpointRestoreRecoveryReader } from "../../src/lib/checkpoint-restore-recovery.js";
import {
  CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES,
  createCheckpointRestoreRecoveryController,
} from "../../src/lib/checkpoint-restore-recovery-controller.js";
import { inspectWorkspaceLockOwnerSync } from "../../src/lib/process-execution-broker/workspace-transaction.js";

const roots = [];
const workers = [];
const WORKER_PATH = fileURLToPath(
  new URL("../fixtures/checkpoint-restore-kill-worker.mjs", import.meta.url),
);
const GIT_AVAILABLE =
  spawnSync("git", ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    windowsHide: true,
  }).status === 0;

function secureDirectory(target) {
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") fs.chmodSync(target, 0o700);
}

function secureAuthorityPaths(targets) {
  return targets.map((target) => {
    const stat = fs.lstatSync(target);
    if (process.platform !== "win32") {
      fs.chmodSync(target, stat.isDirectory() ? 0o700 : 0o600);
    }
    return { target, exists: true, ok: true };
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function bounded(promise, timeoutMs, label) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed (${result.status}): ${result.stderr || result.error || "unknown error"}`,
    );
  }
  return result.stdout.trim();
}

function createStore(config) {
  return new CheckpointRestoreSagaStore({
    workspaceRoot: config.workspaceRoot,
    stateDir: config.sagaStateDir,
    secureDirectory,
    secureAuthorityPaths,
  });
}

function lockOptions(config) {
  return {
    workspaceRoot: config.workspaceRoot,
    operationId: config.operationId,
    purpose: "checkpoint-restore",
    lockDir: config.lockDir,
    allowNonCanonicalLockDirForTests: true,
    timeoutMs: 10_000,
    retryMs: 5,
  };
}

function createScenario(engine, recoveryMode) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), `cc-restore-kill-${engine}-`)),
  );
  roots.push(root);
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const workspaceRoot = fs.realpathSync.native(workspace);
  const targetPath = path.join(workspaceRoot, "target.txt");
  const secondaryPath = path.join(workspaceRoot, "secondary.txt");
  const safetyOnlyPath = path.join(workspaceRoot, "safety-only.txt");
  const thirdPartyPath = path.join(workspaceRoot, "third-party.txt");
  const checkpointTargetContents = `checkpoint-target-${engine}\n`;
  const checkpointSecondaryContents = `checkpoint-secondary-${engine}\n`;
  const preRestoreTargetContents = `pre-restore-target-${engine}\n`;
  const preRestoreSecondaryContents = `pre-restore-secondary-${engine}\n`;
  const safetyOnlyContents = `safety-only-${engine}\n`;
  const thirdPartyContents = `third-party-stable-${engine}\n`;
  fs.writeFileSync(targetPath, checkpointTargetContents, "utf8");
  fs.writeFileSync(secondaryPath, checkpointSecondaryContents, "utf8");
  fs.writeFileSync(thirdPartyPath, thirdPartyContents, "utf8");

  let checkpointId;
  let checkpointIdentity;
  let checkpointStoreRoot = null;
  const checkpointNamespace =
    engine === "git" ? `kill-restart-${engine}` : null;
  if (engine === "copy") {
    checkpointStoreRoot = path.join(root, "copy-checkpoints");
    const checkpoint = createCopyCheckpoint(["target.txt", "secondary.txt"], {
      cwd: workspaceRoot,
      root: checkpointStoreRoot,
      label: "cross-process target",
    });
    checkpointId = checkpoint.id;
    checkpointIdentity = computeCheckpointIdentity(checkpoint);
  } else {
    runGit(workspaceRoot, ["init", "--quiet"]);
    runGit(workspaceRoot, ["config", "user.email", "fixture@example.invalid"]);
    runGit(workspaceRoot, ["config", "user.name", "Checkpoint Fixture"]);
    runGit(workspaceRoot, ["config", "core.autocrlf", "false"]);
    runGit(workspaceRoot, [
      "add",
      "--",
      "target.txt",
      "secondary.txt",
      "third-party.txt",
    ]);
    runGit(workspaceRoot, ["commit", "--quiet", "-m", "target state"]);
    const checkpoint = createGitCheckpoint(workspaceRoot, {
      session: checkpointNamespace,
      label: "cross-process target",
    });
    checkpointId = checkpoint.id;
    checkpointIdentity = `git:${checkpoint.commit}`;
  }
  fs.writeFileSync(targetPath, preRestoreTargetContents, "utf8");
  fs.writeFileSync(secondaryPath, preRestoreSecondaryContents, "utf8");
  fs.writeFileSync(safetyOnlyPath, safetyOnlyContents, "utf8");

  const operationId = `kill_restart_${engine}_${process.pid}_${Date.now()}`;
  return {
    root,
    engine,
    workspaceRoot,
    targetPath,
    secondaryPath,
    safetyOnlyPath,
    thirdPartyPath,
    checkpointTargetContents,
    checkpointSecondaryContents,
    preRestoreTargetContents,
    preRestoreSecondaryContents,
    safetyOnlyContents,
    thirdPartyContents,
    checkpointId,
    checkpointIdentity,
    checkpointNamespace,
    checkpointStoreRoot,
    operationId,
    sagaStateDir: path.join(root, "saga-state"),
    lockDir: path.join(root, "workspace-locks"),
    markerPath: path.join(root, `${recoveryMode}-lock-held.json`),
    holdBoundary:
      recoveryMode === "terminal"
        ? "completed-lock-held"
        : engine === "copy"
          ? "first-target-published"
          : "workspace-applied",
    expectedRolledBackCount: engine === "copy" ? 1 : 3,
    originalMutationTargetCount: engine === "copy" ? 2 : 3,
    holdTimeoutMs: 120_000,
  };
}

function spawnWorker(config) {
  const encoded = Buffer.from(JSON.stringify(config), "utf8").toString(
    "base64url",
  );
  const child = spawn(process.execPath, [WORKER_PATH, encoded], {
    env: { ...process.env, NODE_ENV: "test" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
    windowsHide: true,
  });
  const record = {
    child,
    stdout: "",
    stderr: "",
    messages: [],
    outcome: null,
    exit: null,
  };
  child.stdout.on("data", (chunk) => {
    record.stdout = `${record.stdout}${chunk}`.slice(-16_384);
  });
  child.stderr.on("data", (chunk) => {
    record.stderr = `${record.stderr}${chunk}`.slice(-16_384);
  });
  child.on("message", (message) => record.messages.push(message));
  record.exit = new Promise((resolve) => {
    const finish = (outcome) => {
      if (record.outcome) return;
      record.outcome = outcome;
      resolve(outcome);
    };
    child.once("error", (error) => finish({ error, code: null, signal: null }));
    child.once("exit", (code, signal) => finish({ error: null, code, signal }));
  });
  workers.push(record);
  return record;
}

async function waitForMarker(record, markerPath, timeoutMs = 75_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(markerPath)) {
      return JSON.parse(fs.readFileSync(markerPath, "utf8"));
    }
    if (record.outcome) {
      throw new Error(
        `restore worker exited before its hold marker: ${JSON.stringify(record.outcome)}\n${record.stderr}`,
      );
    }
    await delay(20);
  }
  throw new Error(
    `restore worker did not reach its hold marker within ${timeoutMs}ms\n${record.stderr}`,
  );
}

async function terminateWorker(record) {
  if (!record.outcome) {
    record.child.kill("SIGKILL");
  }
  return bounded(record.exit, 10_000, "restore worker termination");
}

function assertThirdPartyUnchanged(config) {
  expect(fs.readFileSync(config.thirdPartyPath, "utf8")).toBe(
    config.thirdPartyContents,
  );
}

function assertCrashWorkspace(config, marker) {
  assertThirdPartyUnchanged(config);
  if (config.engine === "copy") {
    expect(marker.boundaryEvidence).toMatchObject({
      index: 0,
      operation: "write",
      created: false,
    });
    const publishedPath = path.join(
      config.workspaceRoot,
      marker.boundaryEvidence.rel,
    );
    const publishedTarget =
      publishedPath === config.targetPath
        ? {
            checkpoint: config.checkpointTargetContents,
            otherPath: config.secondaryPath,
            otherPreRestore: config.preRestoreSecondaryContents,
          }
        : publishedPath === config.secondaryPath
          ? {
              checkpoint: config.checkpointSecondaryContents,
              otherPath: config.targetPath,
              otherPreRestore: config.preRestoreTargetContents,
            }
          : null;
    expect(publishedTarget).not.toBeNull();
    expect(fs.readFileSync(publishedPath, "utf8")).toBe(
      publishedTarget.checkpoint,
    );
    expect(fs.readFileSync(publishedTarget.otherPath, "utf8")).toBe(
      publishedTarget.otherPreRestore,
    );
    expect(fs.readFileSync(config.safetyOnlyPath, "utf8")).toBe(
      config.safetyOnlyContents,
    );
    const status = diffCopyCheckpoint(config.checkpointId, {
      root: config.checkpointStoreRoot,
      cwd: config.workspaceRoot,
      expectedIdentity: config.checkpointIdentity,
    });
    expect(status.modified).toEqual([path.basename(publishedTarget.otherPath)]);
    expect(status.deleted).toEqual([]);
    expect(status.unchanged).toEqual([marker.boundaryEvidence.rel]);
    return;
  }

  expect(fs.readFileSync(config.targetPath, "utf8")).toBe(
    config.checkpointTargetContents,
  );
  expect(fs.readFileSync(config.secondaryPath, "utf8")).toBe(
    config.checkpointSecondaryContents,
  );
  expect(fs.existsSync(config.safetyOnlyPath)).toBe(false);
  const status = statusAgainstGitCheckpoint(
    config.workspaceRoot,
    config.checkpointId,
    {
      session: config.checkpointNamespace,
      expectedIdentity: config.checkpointIdentity,
    },
  );
  expect(status.modified).toEqual([]);
  expect(status.added).toEqual([]);
  expect(status.deleted).toEqual([]);
  expect(
    runGit(config.workspaceRoot, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
  ).toBe("");
}

function assertCompletedWorkspace(config) {
  expect(fs.readFileSync(config.targetPath, "utf8")).toBe(
    config.checkpointTargetContents,
  );
  expect(fs.readFileSync(config.secondaryPath, "utf8")).toBe(
    config.checkpointSecondaryContents,
  );
  assertThirdPartyUnchanged(config);

  if (config.engine === "copy") {
    expect(fs.readFileSync(config.safetyOnlyPath, "utf8")).toBe(
      config.safetyOnlyContents,
    );
    const status = diffCopyCheckpoint(config.checkpointId, {
      root: config.checkpointStoreRoot,
      cwd: config.workspaceRoot,
      expectedIdentity: config.checkpointIdentity,
    });
    expect(status.modified).toEqual([]);
    expect(status.deleted).toEqual([]);
    expect([...status.unchanged].sort()).toEqual([
      "secondary.txt",
      "target.txt",
    ]);
    return;
  }

  expect(fs.existsSync(config.safetyOnlyPath)).toBe(false);
  const status = statusAgainstGitCheckpoint(
    config.workspaceRoot,
    config.checkpointId,
    {
      session: config.checkpointNamespace,
      expectedIdentity: config.checkpointIdentity,
    },
  );
  expect(status.modified).toEqual([]);
  expect(status.added).toEqual([]);
  expect(status.deleted).toEqual([]);
  expect(
    runGit(config.workspaceRoot, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
    ]),
  ).toBe("");
}

function assertSafetyWorkspace(config) {
  expect(fs.readFileSync(config.targetPath, "utf8")).toBe(
    config.preRestoreTargetContents,
  );
  expect(fs.readFileSync(config.targetPath, "utf8")).not.toBe(
    config.checkpointTargetContents,
  );
  expect(fs.readFileSync(config.secondaryPath, "utf8")).toBe(
    config.preRestoreSecondaryContents,
  );
  expect(fs.readFileSync(config.secondaryPath, "utf8")).not.toBe(
    config.checkpointSecondaryContents,
  );
  expect(fs.readFileSync(config.safetyOnlyPath, "utf8")).toBe(
    config.safetyOnlyContents,
  );
  assertThirdPartyUnchanged(config);

  if (config.engine === "copy") {
    expect(fs.readdirSync(config.workspaceRoot).sort()).toEqual([
      "safety-only.txt",
      "secondary.txt",
      "target.txt",
      "third-party.txt",
    ]);
    const status = diffCopyCheckpoint(config.checkpointId, {
      root: config.checkpointStoreRoot,
      cwd: config.workspaceRoot,
      expectedIdentity: config.checkpointIdentity,
    });
    expect([...status.modified].sort()).toEqual([
      "secondary.txt",
      "target.txt",
    ]);
    expect(status.deleted).toEqual([]);
    return;
  }

  const status = statusAgainstGitCheckpoint(
    config.workspaceRoot,
    config.checkpointId,
    {
      session: config.checkpointNamespace,
      expectedIdentity: config.checkpointIdentity,
    },
  );
  expect([...status.modified].sort()).toEqual(["secondary.txt", "target.txt"]);
  expect(status.added).toEqual(["safety-only.txt"]);
  expect(status.deleted).toEqual([]);
}

async function runTerminalKillRestartScenario(engine) {
  const config = createScenario(engine, "terminal");
  const worker = spawnWorker(config);
  const marker = await waitForMarker(worker, config.markerPath);
  expect(marker).toMatchObject({
    ready: true,
    blocked: true,
    engine,
    operationId: config.operationId,
    boundary: "completed-lock-held",
    phase: "completed",
    pid: worker.child.pid,
  });

  const preKillStore = createStore(config);
  const preKillSaga = preKillStore.load(config.operationId);
  expect(preKillSaga).toMatchObject({
    operationId: config.operationId,
    phase: "completed",
    terminal: true,
    pending: false,
    seq: marker.seq,
    headHash: marker.headHash,
  });
  const liveOwner = inspectWorkspaceLockOwnerSync(lockOptions(config));
  expect(liveOwner).toMatchObject({
    pid: worker.child.pid,
    purpose: "checkpoint-restore",
    transactionId: config.operationId,
    workspaceRoot: config.workspaceRoot,
  });
  assertCompletedWorkspace(config);

  expect(worker.child.kill("SIGKILL")).toBe(true);
  const killed = await bounded(
    worker.exit,
    10_000,
    "terminal restore worker exit",
  );
  expect(killed.error).toBeNull();

  const restartedStore = createStore(config);
  const reader = createCheckpointRestoreRecoveryReader({
    store: restartedStore,
  });
  const recovery = reader.show(config.operationId);
  expect(recovery).toMatchObject({
    operationId: config.operationId,
    phase: "completed",
    terminal: true,
    pending: false,
    restore: {
      kind: engine,
      surface: "direct",
      intentAuthority: "operation",
      checkpointNamespace: config.checkpointNamespace,
      checkpointId: config.checkpointId,
      checkpointIdentity: config.checkpointIdentity,
    },
    actionEligibility: {
      release: { candidate: true },
    },
  });

  const retainedOwner = inspectWorkspaceLockOwnerSync(lockOptions(config));
  expect(retainedOwner).toEqual(liveOwner);
  const ownerDigest =
    computeCheckpointRestoreWorkspaceLockOwnerDigest(retainedOwner);
  expect(recovery.fence).toEqual({
    expectedSeq: recovery.seq,
    expectedHash: recovery.headHash,
    ownerAuthority: "unverified",
    recordedOwnerDigest: ownerDigest,
  });

  const controller = createCheckpointRestoreRecoveryController({
    workspaceRoot: config.workspaceRoot,
    store: restartedStore,
    workspaceLockOptions: lockOptions(config),
  });
  const zeroDigest = `sha256:${"0".repeat(64)}`;
  const wrongOwnerDigest =
    ownerDigest === zeroDigest ? `sha256:${"1".repeat(64)}` : zeroDigest;
  expect(() =>
    controller.release(config.operationId, {
      expectedSeq: recovery.fence.expectedSeq,
      expectedHash: recovery.fence.expectedHash,
      expectedOwnerDigest: wrongOwnerDigest,
    }),
  ).toThrow(
    expect.objectContaining({
      code: CHECKPOINT_RESTORE_RECOVERY_ERROR_CODES.OWNER_CONFLICT,
    }),
  );
  expect(inspectWorkspaceLockOwnerSync(lockOptions(config))).toEqual(
    retainedOwner,
  );
  expect(restartedStore.load(config.operationId)).toMatchObject({
    phase: "completed",
    seq: recovery.seq,
    headHash: recovery.headHash,
  });
  assertCompletedWorkspace(config);

  const released = controller.release(config.operationId, {
    expectedSeq: recovery.fence.expectedSeq,
    expectedHash: recovery.fence.expectedHash,
    expectedOwnerDigest: ownerDigest,
  });
  expect(released).toMatchObject({
    ok: true,
    action: "release",
    operationId: config.operationId,
    phase: "completed",
    seq: recovery.seq,
    headHash: recovery.headHash,
    archived: true,
    alreadyArchived: false,
    warning: null,
  });
  expect(inspectWorkspaceLockOwnerSync(lockOptions(config))).toBeNull();
  assertCompletedWorkspace(config);

  const verificationStore = createStore(config);
  expect(() => verificationStore.load(config.operationId)).toThrow(
    expect.objectContaining({
      code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.NOT_FOUND,
    }),
  );
  expect(
    verificationStore.archiveTerminal(config.operationId, {
      expectedSeq: released.seq,
      expectedHash: released.headHash,
    }),
  ).toMatchObject({
    archived: true,
    alreadyArchived: true,
    phase: "completed",
    seq: released.seq,
    headHash: released.headHash,
  });
  expect(
    fs.existsSync(path.join(verificationStore.archiveRoot, config.operationId)),
  ).toBe(true);
}

async function runMutationKillRestartScenario(engine) {
  const config = createScenario(engine, "mutation");
  const worker = spawnWorker(config);
  const marker = await waitForMarker(worker, config.markerPath);
  expect(marker).toMatchObject({
    ready: true,
    blocked: true,
    engine,
    operationId: config.operationId,
    boundary: config.holdBoundary,
    phase: "mutation_started",
    pid: worker.child.pid,
  });

  const preKillStore = createStore(config);
  const preKillSaga = preKillStore.load(config.operationId);
  expect(preKillSaga).toMatchObject({
    operationId: config.operationId,
    phase: "mutation_started",
    terminal: false,
    pending: true,
    seq: marker.seq,
    headHash: marker.headHash,
  });
  expect(preKillSaga.events.slice(-2).map((event) => event.phase)).toEqual([
    "safety_ready",
    "mutation_started",
  ]);
  expect(
    preKillSaga.events.some((event) => event.phase === "workspace_applied"),
  ).toBe(false);
  const liveOwner = inspectWorkspaceLockOwnerSync(lockOptions(config));
  expect(liveOwner).toMatchObject({
    pid: worker.child.pid,
    purpose: "checkpoint-restore",
    transactionId: config.operationId,
    workspaceRoot: config.workspaceRoot,
  });
  assertCrashWorkspace(config, marker);

  expect(worker.child.kill("SIGKILL")).toBe(true);
  const killed = await bounded(
    worker.exit,
    10_000,
    "killed restore worker exit",
  );
  expect(killed.error).toBeNull();
  const retainedOwner = inspectWorkspaceLockOwnerSync(lockOptions(config));
  expect(retainedOwner).toEqual(liveOwner);
  assertCrashWorkspace(config, marker);

  const restartedStore = createStore(config);
  const reader = createCheckpointRestoreRecoveryReader({
    store: restartedStore,
  });
  const recovery = reader.show(config.operationId);
  expect(recovery).toMatchObject({
    operationId: config.operationId,
    phase: "mutation_started",
    basePhase: "mutation_started",
    terminal: false,
    pending: true,
    restore: {
      kind: engine,
      surface: "direct",
      intentAuthority: "operation",
      checkpointNamespace: config.checkpointNamespace,
      checkpointId: config.checkpointId,
      checkpointIdentity: config.checkpointIdentity,
    },
    progress: {
      targetCount: config.originalMutationTargetCount,
      appliedCount: null,
    },
    safety: {
      coverage: "full",
      complete: true,
    },
    actionEligibility: {
      rollback: { candidate: true },
    },
  });

  const ownerDigest =
    computeCheckpointRestoreWorkspaceLockOwnerDigest(retainedOwner);
  expect(recovery.fence).toEqual({
    expectedSeq: recovery.seq,
    expectedHash: recovery.headHash,
    ownerAuthority: "unverified",
    recordedOwnerDigest: ownerDigest,
  });

  const adapterAudit = { prepared: [], executed: [] };
  const controller = createCheckpointRestorePartialRollbackController({
    workspaceRoot: config.workspaceRoot,
    store: restartedStore,
    workspaceLockOptions: lockOptions(config),
    prepareWorkspaceRollback(request) {
      const expected = request.expected;
      const plan =
        engine === "copy"
          ? prepareCopyCheckpointRollback(
              config.workspaceRoot,
              expected.originalCheckpoint.id,
              expected.safetyCheckpoint.id,
              {
                root: config.checkpointStoreRoot,
                expectedOriginalIdentity: expected.originalCheckpoint.identity,
                expectedSafetyIdentity: expected.safetyCheckpoint.identity,
                expectedSafetyPlanIdentity:
                  expected.safetyCheckpoint.planIdentity,
                originalMutationTargetCount:
                  expected.originalMutationTargetCount,
              },
            )
          : prepareGitCheckpointRollback(
              config.workspaceRoot,
              expected.originalCheckpoint.id,
              expected.safetyCheckpoint.id,
              {
                session: expected.checkpointNamespace,
                expectedOriginalIdentity: expected.originalCheckpoint.identity,
                expectedSafetyIdentity: expected.safetyCheckpoint.identity,
                expectedSafetyPlanIdentity:
                  expected.safetyCheckpoint.planIdentity,
                originalMutationTargetCount:
                  expected.originalMutationTargetCount,
              },
            );
      adapterAudit.prepared.push({ expected, plan });
      return plan;
    },
    executeWorkspaceRollback(request) {
      adapterAudit.executed.push({
        operationId: request.operationId,
        recoveryRequestId: request.recoveryRequestId,
        plan: request.plan,
      });
      return engine === "copy"
        ? executeCopyCheckpointRollback(config.workspaceRoot, request.plan, {
            root: config.checkpointStoreRoot,
            workspaceLease: request.workspaceLease,
          })
        : executeGitCheckpointRollback(config.workspaceRoot, request.plan, {
            workspaceLease: request.workspaceLease,
          });
    },
  });

  const rolledBack = controller.rollback(config.operationId, {
    expectedSeq: recovery.fence.expectedSeq,
    expectedHash: recovery.fence.expectedHash,
    expectedOwnerDigest: ownerDigest,
  });
  expect(rolledBack).toMatchObject({
    ok: true,
    action: "rollback-partial-mutation",
    operationId: config.operationId,
    phase: "rolled_back",
    rolledBackCount: config.expectedRolledBackCount,
    rollbackStateDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    resultDigest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    sessionRollbackCommitDigest: null,
    archived: true,
    alreadyArchived: false,
    reconciledFromError: false,
    warning: null,
  });
  expect(adapterAudit.prepared).toHaveLength(1);
  expect(adapterAudit.prepared[0].expected).toMatchObject({
    engine,
    restoreSurface: "direct",
    checkpointNamespace: config.checkpointNamespace,
    originalCheckpoint: {
      id: config.checkpointId,
      identity: config.checkpointIdentity,
    },
    safetyCheckpoint: {
      id: recovery.safety.checkpointId,
      identity: recovery.safety.checkpointIdentity,
      planIdentity: recovery.safety.planIdentity,
    },
    originalMutationTargetCount: config.originalMutationTargetCount,
  });
  expect(adapterAudit.prepared[0].plan).toMatchObject({
    engine,
    checkpointNamespace: config.checkpointNamespace,
    targetCount: config.expectedRolledBackCount,
    originalMutationTargetCount: config.originalMutationTargetCount,
  });
  expect(adapterAudit.executed).toHaveLength(1);
  expect(adapterAudit.executed[0]).toMatchObject({
    operationId: config.operationId,
    recoveryRequestId: rolledBack.recoveryRequestId,
    plan: {
      engine,
      targetCount: config.expectedRolledBackCount,
    },
  });
  expect(inspectWorkspaceLockOwnerSync(lockOptions(config))).toBeNull();
  assertSafetyWorkspace(config);

  const verificationStore = createStore(config);
  expect(() => verificationStore.load(config.operationId)).toThrow(
    expect.objectContaining({
      code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.NOT_FOUND,
    }),
  );
  expect(
    verificationStore.archiveTerminal(config.operationId, {
      expectedSeq: rolledBack.seq,
      expectedHash: rolledBack.headHash,
    }),
  ).toMatchObject({
    archived: true,
    alreadyArchived: true,
    phase: "rolled_back",
    seq: rolledBack.seq,
    headHash: rolledBack.headHash,
  });
  expect(
    fs.existsSync(path.join(verificationStore.archiveRoot, config.operationId)),
  ).toBe(true);
}

afterEach(async () => {
  for (const worker of workers.splice(0)) {
    await terminateWorker(worker);
  }
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("checkpoint restore kill -> restart recovery", () => {
  it(
    "releases and archives a real copy restore killed after completion while its workspace lock is held",
    () => runTerminalKillRestartScenario("copy"),
    120_000,
  );

  it.skipIf(!GIT_AVAILABLE)(
    "releases and archives a real git restore killed after completion while its workspace lock is held (skipped when git is unavailable)",
    () => runTerminalKillRestartScenario("git"),
    120_000,
  );

  it(
    "rolls a copy restore back to its durable safety checkpoint after the first target is published and the worker is killed",
    () => runMutationKillRestartScenario("copy"),
    120_000,
  );

  it.skipIf(!GIT_AVAILABLE)(
    "rolls a git restore back to its durable safety checkpoint when killed at workspace-applied before saga settlement (skipped when git is unavailable)",
    () => runMutationKillRestartScenario("git"),
    120_000,
  );
});
