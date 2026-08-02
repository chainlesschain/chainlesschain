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
} from "../../src/lib/file-checkpoint.js";
import {
  createCheckpoint as createGitCheckpoint,
  statusAgainst as statusAgainstGitCheckpoint,
} from "../../src/lib/checkpoint-store.js";
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

function createScenario(engine) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), `cc-restore-kill-${engine}-`)),
  );
  roots.push(root);
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  const workspaceRoot = fs.realpathSync.native(workspace);
  const targetPath = path.join(workspaceRoot, "target.txt");
  const targetContents = `checkpoint-${engine}\n`;
  fs.writeFileSync(targetPath, targetContents, "utf8");

  let checkpointId;
  let checkpointIdentity;
  let checkpointStoreRoot = null;
  const checkpointNamespace = `kill-restart-${engine}`;
  if (engine === "copy") {
    checkpointStoreRoot = path.join(root, "copy-checkpoints");
    const checkpoint = createCopyCheckpoint(["target.txt"], {
      cwd: workspaceRoot,
      root: checkpointStoreRoot,
      label: "cross-process target",
    });
    checkpointId = checkpoint.id;
    checkpointIdentity = computeCheckpointIdentity(checkpoint);
    fs.writeFileSync(targetPath, "mutated-copy\n", "utf8");
  } else {
    runGit(workspaceRoot, ["init", "--quiet"]);
    runGit(workspaceRoot, ["config", "user.email", "fixture@example.invalid"]);
    runGit(workspaceRoot, ["config", "user.name", "Checkpoint Fixture"]);
    runGit(workspaceRoot, ["config", "core.autocrlf", "false"]);
    runGit(workspaceRoot, ["add", "--", "target.txt"]);
    runGit(workspaceRoot, ["commit", "--quiet", "-m", "target state"]);
    const checkpoint = createGitCheckpoint(workspaceRoot, {
      session: checkpointNamespace,
      label: "cross-process target",
    });
    checkpointId = checkpoint.id;
    checkpointIdentity = `git:${checkpoint.commit}`;
    fs.writeFileSync(targetPath, "mutated-git\n", "utf8");
    fs.writeFileSync(path.join(workspaceRoot, "extra.txt"), "remove me\n");
  }

  const operationId = `kill_restart_${engine}_${process.pid}_${Date.now()}`;
  return {
    root,
    engine,
    workspaceRoot,
    targetPath,
    targetContents,
    checkpointId,
    checkpointIdentity,
    checkpointNamespace,
    checkpointStoreRoot,
    operationId,
    sagaStateDir: path.join(root, "saga-state"),
    lockDir: path.join(root, "workspace-locks"),
    markerPath: path.join(root, "completed-lock-held.json"),
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

function assertExactWorkspace(config) {
  expect(fs.readFileSync(config.targetPath, "utf8")).toBe(
    config.targetContents,
  );
  if (config.engine === "copy") {
    expect(fs.readdirSync(config.workspaceRoot).sort()).toEqual(["target.txt"]);
    const status = diffCopyCheckpoint(config.checkpointId, {
      root: config.checkpointStoreRoot,
      cwd: config.workspaceRoot,
      expectedIdentity: config.checkpointIdentity,
    });
    expect(status.modified).toEqual([]);
    expect(status.deleted).toEqual([]);
    expect(status.unchanged).toEqual(["target.txt"]);
    return;
  }

  expect(fs.existsSync(path.join(config.workspaceRoot, "extra.txt"))).toBe(
    false,
  );
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

async function runKillRestartScenario(engine) {
  const config = createScenario(engine);
  const worker = spawnWorker(config);
  const marker = await waitForMarker(worker, config.markerPath);
  expect(marker).toMatchObject({
    ready: true,
    blocked: true,
    engine,
    operationId: config.operationId,
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
  assertExactWorkspace(config);

  expect(worker.child.kill("SIGKILL")).toBe(true);
  const killed = await bounded(
    worker.exit,
    10_000,
    "killed restore worker exit",
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
      expectedSeq: recovery.seq,
      expectedHash: recovery.headHash,
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
  assertExactWorkspace(config);

  const released = controller.release(config.operationId, {
    expectedSeq: recovery.seq,
    expectedHash: recovery.headHash,
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
  assertExactWorkspace(config);

  const verificationStore = createStore(config);
  expect(() => verificationStore.load(config.operationId)).toThrow(
    expect.objectContaining({
      code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.NOT_FOUND,
    }),
  );
  expect(
    verificationStore.archiveTerminal(config.operationId, {
      expectedSeq: recovery.seq,
      expectedHash: recovery.headHash,
    }),
  ).toMatchObject({
    archived: true,
    alreadyArchived: true,
    phase: "completed",
    seq: recovery.seq,
    headHash: recovery.headHash,
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
    "recovers a real copy restore killed after completed and before lock release",
    () => runKillRestartScenario("copy"),
    85_000,
  );

  it.skipIf(!GIT_AVAILABLE)(
    "recovers a real git restore killed after completed and before lock release (skipped when git is unavailable)",
    () => runKillRestartScenario("git"),
    85_000,
  );
});
