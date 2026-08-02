import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CHECKPOINT_RESTORE_SAGA_DURABILITY,
  CHECKPOINT_RESTORE_SAGA_ERROR_CODES,
  CheckpointRestoreSagaStore,
  MAX_CHECKPOINT_RESTORE_SAGA_EVENT_BYTES,
  computeCheckpointRestoreWorkspaceLockOwnerDigest,
} from "../../src/lib/checkpoint-restore-saga.js";
import {
  inspectPrivatePath,
  inspectPrivatePaths,
} from "../../src/lib/secure-fs.js";

const roots = [];
const VALID_UUID = "12345678-1234-4123-8123-123456789abc";

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

function fixture(options = {}) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "cc-restore-saga-")),
  );
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const baseStateDir = path.join(root, "external-state", "checkpoint-restores");
  fs.mkdirSync(workspaceRoot, { recursive: true });
  const canonicalWorkspace = fs.realpathSync.native(workspaceRoot);
  const store = new CheckpointRestoreSagaStore({
    workspaceRoot: canonicalWorkspace,
    stateDir: baseStateDir,
    secureDirectory,
    secureAuthorityPaths,
    ...options,
  });
  return {
    root,
    workspaceRoot: canonicalWorkspace,
    baseStateDir: fs.realpathSync.native(baseStateDir),
    stateDir: store.stateRoot,
    store,
  };
}

function advance(store, saga, phase, evidence = {}) {
  return store.advance(saga.operationId, {
    expectedSeq: saga.seq,
    expectedHash: saga.headHash,
    phase,
    evidence,
  });
}

function operationDirectory(testFixture, operationId) {
  return path.join(testFixture.stateDir, operationId);
}

function eventFiles(testFixture, operationId) {
  return fs
    .readdirSync(operationDirectory(testFixture, operationId))
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function workspaceLockOwner(testFixture, operationId) {
  return {
    identityPolicy: "pid-only-fail-closed",
    pid: process.pid,
    purpose: "checkpoint-restore",
    startedAt: 1_700_000_000_000,
    token: "12345678-1234-4123-8123-123456789abc",
    transactionId: operationId,
    workspaceRoot: testFixture.workspaceRoot,
  };
}

function errorCode(code) {
  return expect.objectContaining({ code });
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function recomputeEventHash(event) {
  const body = { ...event };
  delete body.hash;
  return `sha256:${createHash("sha256")
    .update(`cc-checkpoint-restore-saga-event-v1\0${canonicalJson(body)}`)
    .digest("hex")}`;
}

function recomputeHeadAnchor(head) {
  const body = { ...head };
  delete body.anchorHash;
  return `sha256:${createHash("sha256")
    .update(`cc-checkpoint-restore-saga-head-v1\0${canonicalJson(body)}`)
    .digest("hex")}`;
}

function headPath(testFixture, operationId) {
  return path.join(operationDirectory(testFixture, operationId), "HEAD");
}

function readHead(testFixture, operationId) {
  return JSON.parse(
    fs.readFileSync(headPath(testFixture, operationId), "utf8"),
  );
}

function writeHead(testFixture, operationId, head) {
  fs.writeFileSync(
    headPath(testFixture, operationId),
    `${JSON.stringify(head, null, 2)}\n`,
    { mode: 0o600 },
  );
  if (process.platform !== "win32") {
    fs.chmodSync(headPath(testFixture, operationId), 0o600);
  }
}

function projectedStat(stat, overrides) {
  return new Proxy(stat, {
    get(target, property) {
      if (Object.hasOwn(overrides, property)) return overrides[property];
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

function projectedAuthorityIdentityRuntime({
  platform = "win32",
  uvVersion = "1.49.1",
  pathDevice = 987654321n,
  handleDevice = 77n,
  pathOverrides = () => ({}),
  handleOverrides = () => ({}),
  productionParent = false,
  forbidDescriptorReadFile = false,
} = {}) {
  const nativeLstatSync = fs.lstatSync.bind(fs);
  const nativeOpenSync = fs.openSync.bind(fs);
  const nativeFstatSync = fs.fstatSync.bind(fs);
  const nativeCloseSync = fs.closeSync.bind(fs);
  const eventDescriptors = new Set();
  const lockOwnerDescriptors = new Set();
  const lockOwnerDevice = 88n;
  let insideStableRead = false;
  let pathSample = 0;
  let handleSample = 0;
  const isEventPath = (target) => {
    const basename = path.basename(String(target));
    return basename === "HEAD" || /^\d{6}-[a-z_]+\.json$/u.test(basename);
  };
  const isStateLockOwnerPath = (target) => {
    const ownerPath = String(target);
    return (
      !productionParent &&
      path.basename(ownerPath) === "owner.json" &&
      path.basename(path.dirname(path.dirname(ownerPath))) === ".locks"
    );
  };
  const runtimeFs = {
    ...fs,
    constants: fs.constants,
    realpathSync: fs.realpathSync,
    lstatSync(target, options) {
      const stat = nativeLstatSync(target, options);
      if (isStateLockOwnerPath(target)) {
        return projectedStat(stat, { dev: lockOwnerDevice });
      }
      if (!isEventPath(target)) return stat;
      const sample = insideStableRead ? ++pathSample : 0;
      return projectedStat(stat, {
        dev: pathDevice,
        ...pathOverrides(stat, sample),
      });
    },
    openSync(target, ...args) {
      const descriptor = nativeOpenSync(target, ...args);
      if (isEventPath(target)) eventDescriptors.add(descriptor);
      if (isStateLockOwnerPath(target)) lockOwnerDescriptors.add(descriptor);
      return descriptor;
    },
    fstatSync(descriptor, options) {
      const stat = nativeFstatSync(descriptor, options);
      if (lockOwnerDescriptors.has(descriptor)) {
        return projectedStat(stat, { dev: lockOwnerDevice });
      }
      if (!eventDescriptors.has(descriptor) || handleDevice == null) {
        return stat;
      }
      handleSample += 1;
      return projectedStat(stat, {
        dev: handleDevice,
        ...handleOverrides(stat, handleSample),
      });
    },
    readFileSync(descriptor, ...args) {
      if (forbidDescriptorReadFile && eventDescriptors.has(descriptor)) {
        throw new Error("event descriptors must use bounded readSync");
      }
      return fs.readFileSync(descriptor, ...args);
    },
    closeSync(descriptor) {
      eventDescriptors.delete(descriptor);
      lockOwnerDescriptors.delete(descriptor);
      return nativeCloseSync(descriptor);
    },
  };
  const identityOptions = {
    fs: runtimeFs,
    runtime: { platform, uvVersion },
  };
  if (!productionParent) {
    identityOptions.secureFileParent = (_runtimeFs, filePath, callback) => {
      const projectedEvent = isEventPath(filePath);
      const projectedLockOwner = isStateLockOwnerPath(filePath);
      insideStableRead = true;
      pathSample = 0;
      handleSample = 0;
      try {
        const nativeDevice = nativeLstatSync(filePath, { bigint: true }).dev;
        return callback({
          canonicalPath: filePath,
          parentDevice: projectedEvent
            ? String(handleDevice)
            : projectedLockOwner
              ? String(lockOwnerDevice)
              : String(nativeDevice),
        });
      } finally {
        insideStableRead = false;
      }
    };
  }
  return identityOptions;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CheckpointRestoreSagaStore", () => {
  it("persists the strict restore chain as immutable hash-linked events", () => {
    const testFixture = fixture({ now: () => 1_700_000_000_000 });
    const operationId = "restore_normal_1";
    let saga = testFixture.store.create({
      operationId,
      evidence: {
        restoreKind: "copy",
        checkpointId: "checkpoint-1",
        confirmationDigest: `sha256:${"0".repeat(64)}`,
      },
    });

    expect(saga.phase).toBe("created");
    expect(saga.seq).toBe(1);
    expect(saga.workspaceRoot).toBe(testFixture.workspaceRoot);
    expect(saga.events[0].prevHash).toBeNull();
    expect(saga.events[0].hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(saga.events[0].evidence.confirmationDigest).toBe(
      `sha256:${"0".repeat(64)}`,
    );

    const transitions = [
      [
        "locked",
        { workspaceLockOwner: workspaceLockOwner(testFixture, operationId) },
      ],
      [
        "prepared",
        { prestateDigest: `sha256:${"1".repeat(64)}`, targetCount: 2 },
      ],
      [
        "intent_committed",
        {
          sessionId: "session-1",
          intentCommitDigest: `sha256:${"9".repeat(64)}`,
        },
      ],
      [
        "safety_ready",
        {
          safetyId: "safety-1",
          safetyIdentity: "safety-identity-1",
          safetyPlanIdentity: "safety-plan-1",
          safetyCoverage: "full",
        },
      ],
      ["mutation_started", { targetCount: 2 }],
      [
        "workspace_applied",
        {
          appliedCount: 2,
          poststateDigest: `sha256:${"4".repeat(64)}`,
        },
      ],
      [
        "session_committed",
        { sessionCommitDigest: `sha256:${"2".repeat(64)}` },
      ],
      ["completed", { resultDigest: `sha256:${"3".repeat(64)}` }],
    ];
    for (const [phase, evidence] of transitions) {
      const previous = saga;
      saga = advance(testFixture.store, saga, phase, evidence);
      expect(saga.seq).toBe(previous.seq + 1);
      expect(saga.events.at(-1).prevHash).toBe(previous.headHash);
    }

    expect(saga.terminal).toBe(true);
    expect(saga.pending).toBe(false);
    expect(eventFiles(testFixture, operationId)).toEqual([
      "000001-created.json",
      "000002-locked.json",
      "000003-prepared.json",
      "000004-intent_committed.json",
      "000005-safety_ready.json",
      "000006-mutation_started.json",
      "000007-workspace_applied.json",
      "000008-session_committed.json",
      "000009-completed.json",
    ]);
    expect(testFixture.store.load(operationId)).toEqual(saga);
  });

  it("requires evidence that makes every mutation boundary decidable", () => {
    const testFixture = fixture();
    const operationId = "strict_phase_evidence";
    let saga = testFixture.store.create({ operationId });
    saga = advance(testFixture.store, saga, "locked", {
      workspaceLockOwner: workspaceLockOwner(testFixture, operationId),
    });
    expect(() => advance(testFixture.store, saga, "prepared")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE),
    );
    saga = advance(testFixture.store, saga, "prepared", {
      prestateDigest: `sha256:${"1".repeat(64)}`,
      targetCount: 2,
    });
    expect(() => advance(testFixture.store, saga, "intent_committed")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE),
    );
    expect(() =>
      advance(testFixture.store, saga, "intent_committed", {
        sessionId: "strict-session",
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    expect(() =>
      advance(testFixture.store, saga, "intent_committed", {
        sessionId: "strict-session",
        intentCommitDigest: "sha256:not-a-digest",
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    saga = advance(testFixture.store, saga, "intent_committed", {
      sessionId: "strict-session",
      intentCommitDigest: `sha256:${"9".repeat(64)}`,
    });
    expect(() => advance(testFixture.store, saga, "safety_ready")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE),
    );
    saga = advance(testFixture.store, saga, "safety_ready", {
      safetyId: "safety-strict",
      safetyIdentity: "safety-identity-strict",
      safetyPlanIdentity: "safety-plan-strict",
      safetyCoverage: "full",
    });
    expect(() =>
      advance(testFixture.store, saga, "mutation_started", { targetCount: 1 }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    saga = advance(testFixture.store, saga, "mutation_started", {
      targetCount: 2,
    });
    expect(() =>
      advance(testFixture.store, saga, "workspace_applied", {
        appliedCount: 1,
        poststateDigest: `sha256:${"2".repeat(64)}`,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    saga = advance(testFixture.store, saga, "workspace_applied", {
      appliedCount: 2,
      poststateDigest: `sha256:${"2".repeat(64)}`,
    });
    expect(() => advance(testFixture.store, saga, "session_committed")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE),
    );
    saga = advance(testFixture.store, saga, "session_committed", {
      sessionCommitDigest: `sha256:${"3".repeat(64)}`,
    });
    expect(() => advance(testFixture.store, saga, "completed")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE),
    );
    saga = advance(testFixture.store, saga, "completed", {
      resultDigest: `sha256:${"4".repeat(64)}`,
    });
    expect(saga.terminal).toBe(true);

    const partialFixture = fixture();
    const partialOperationId = "partial_safety_evidence";
    let partial = partialFixture.store.create({
      operationId: partialOperationId,
    });
    partial = advance(partialFixture.store, partial, "locked", {
      workspaceLockOwner: workspaceLockOwner(
        partialFixture,
        partialOperationId,
      ),
    });
    partial = advance(partialFixture.store, partial, "prepared", {
      prestateDigest: `sha256:${"5".repeat(64)}`,
      targetCount: 1,
    });
    partial = advance(partialFixture.store, partial, "intent_committed", {
      sessionId: "partial-session",
      intentCommitDigest: `sha256:${"9".repeat(64)}`,
    });
    partial = advance(partialFixture.store, partial, "safety_ready", {
      safetyId: "partial-safety",
      safetyIdentity: "partial-identity",
      safetyPlanIdentity: "partial-plan",
      safetyCoverage: "partial",
    });
    expect(() =>
      advance(partialFixture.store, partial, "mutation_started", {
        targetCount: 1,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
  });

  it("settles an exact zero-target restore without safety or mutation events", () => {
    const testFixture = fixture();
    const operationId = "zero_target_restore";
    let saga = testFixture.store.create({ operationId });
    saga = advance(testFixture.store, saga, "locked", {
      workspaceLockOwner: workspaceLockOwner(testFixture, operationId),
    });
    saga = advance(testFixture.store, saga, "prepared", {
      prestateDigest: `sha256:${"1".repeat(64)}`,
      targetCount: 0,
    });
    saga = advance(testFixture.store, saga, "intent_committed", {
      sessionId: "zero-target-session",
      intentCommitDigest: `sha256:${"2".repeat(64)}`,
    });

    expect(() =>
      advance(testFixture.store, saga, "workspace_applied", {
        appliedCount: 1,
        poststateDigest: `sha256:${"3".repeat(64)}`,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));

    saga = advance(testFixture.store, saga, "workspace_applied", {
      appliedCount: 0,
      poststateDigest: `sha256:${"3".repeat(64)}`,
    });
    saga = advance(testFixture.store, saga, "session_committed", {
      sessionCommitDigest: `sha256:${"4".repeat(64)}`,
    });
    saga = advance(testFixture.store, saga, "completed", {
      resultDigest: `sha256:${"5".repeat(64)}`,
    });

    expect(saga.terminal).toBe(true);
    expect(eventFiles(testFixture, operationId)).toEqual([
      "000001-created.json",
      "000002-locked.json",
      "000003-prepared.json",
      "000004-intent_committed.json",
      "000005-workspace_applied.json",
      "000006-session_committed.json",
      "000007-completed.json",
    ]);
  });

  it("does not let a nonzero restore bypass full safety and mutation", () => {
    const testFixture = fixture();
    const operationId = "nonzero_safety_bypass";
    let saga = testFixture.store.create({ operationId });
    saga = advance(testFixture.store, saga, "locked", {
      workspaceLockOwner: workspaceLockOwner(testFixture, operationId),
    });
    saga = advance(testFixture.store, saga, "prepared", {
      prestateDigest: `sha256:${"1".repeat(64)}`,
      targetCount: 1,
    });
    saga = advance(testFixture.store, saga, "intent_committed", {
      sessionId: "nonzero-session",
      intentCommitDigest: `sha256:${"2".repeat(64)}`,
    });

    expect(() =>
      advance(testFixture.store, saga, "workspace_applied", {
        appliedCount: 1,
        poststateDigest: `sha256:${"3".repeat(64)}`,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    expect(testFixture.store.load(operationId).phase).toBe("intent_committed");
    expect(eventFiles(testFixture, operationId)).toHaveLength(4);
  });

  it("rejects a rehashed nonzero restore that bypasses safety during replay", () => {
    const testFixture = fixture();
    const operationId = "replay_nonzero_safety_bypass";
    let saga = testFixture.store.create({ operationId });
    saga = advance(testFixture.store, saga, "locked", {
      workspaceLockOwner: workspaceLockOwner(testFixture, operationId),
    });
    saga = advance(testFixture.store, saga, "prepared", {
      prestateDigest: `sha256:${"1".repeat(64)}`,
      targetCount: 0,
    });
    saga = advance(testFixture.store, saga, "intent_committed", {
      sessionId: "replay-session",
      intentCommitDigest: `sha256:${"2".repeat(64)}`,
    });
    advance(testFixture.store, saga, "workspace_applied", {
      appliedCount: 0,
      poststateDigest: `sha256:${"3".repeat(64)}`,
    });

    const directory = operationDirectory(testFixture, operationId);
    const preparedPath = path.join(directory, "000003-prepared.json");
    const intentPath = path.join(directory, "000004-intent_committed.json");
    const appliedPath = path.join(directory, "000005-workspace_applied.json");
    const prepared = JSON.parse(fs.readFileSync(preparedPath, "utf8"));
    const intent = JSON.parse(fs.readFileSync(intentPath, "utf8"));
    const applied = JSON.parse(fs.readFileSync(appliedPath, "utf8"));
    prepared.evidence.targetCount = 1;
    prepared.hash = recomputeEventHash(prepared);
    intent.prevHash = prepared.hash;
    intent.hash = recomputeEventHash(intent);
    applied.prevHash = intent.hash;
    applied.evidence.appliedCount = 1;
    applied.hash = recomputeEventHash(applied);
    for (const [filePath, event] of [
      [preparedPath, prepared],
      [intentPath, intent],
      [appliedPath, applied],
    ]) {
      fs.writeFileSync(filePath, `${JSON.stringify(event)}\n`, { mode: 0o600 });
    }
    const head = readHead(testFixture, operationId);
    head.prevHash = intent.hash;
    head.eventHash = applied.hash;
    head.anchorHash = recomputeHeadAnchor(head);
    writeHead(testFixture, operationId, head);

    expect(() => testFixture.store.load(operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
  });

  it("settles every published event behind an exact self-hashed HEAD", () => {
    const testFixture = fixture();
    const saga = testFixture.store.create({ operationId: "head_settlement" });
    const head = readHead(testFixture, saga.operationId);

    expect(head).toMatchObject({
      state: "committed",
      operationId: saga.operationId,
      workspaceIdentity: saga.workspaceIdentity,
      seq: saga.seq,
      phase: saga.phase,
      eventFile: "000001-created.json",
      eventHash: saga.headHash,
      prevHash: null,
    });
    expect(head.anchorHash).toBe(recomputeHeadAnchor(head));
  });

  it("fails closed when a committed tail event is deleted", () => {
    const testFixture = fixture();
    let saga = testFixture.store.create({ operationId: "deleted_tail" });
    saga = advance(testFixture.store, saga, "locked", {
      workspaceLockOwner: workspaceLockOwner(testFixture, saga.operationId),
    });
    fs.unlinkSync(
      path.join(
        operationDirectory(testFixture, saga.operationId),
        "000002-locked.json",
      ),
    );

    expect(() => testFixture.store.load(saga.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
    expect(() => advance(testFixture.store, saga, "prepared")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
    expect(testFixture.store.listPending()).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          operationId: saga.operationId,
          status: "corrupt",
          recoverable: false,
        }),
      ],
    });
  });

  it("reconciles exactly one event committed before its HEAD settlement", () => {
    let injectFailure = true;
    const testFixture = fixture({
      beforeHeadRename({ head }) {
        if (head.seq === 2 && injectFailure) {
          injectFailure = false;
          throw new Error("injected crash before HEAD settlement");
        }
      },
    });
    const created = testFixture.store.create({
      operationId: "head_one_event_lag",
    });

    expect(() =>
      advance(testFixture.store, created, "locked", {
        workspaceLockOwner: workspaceLockOwner(
          testFixture,
          created.operationId,
        ),
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED));

    const peer = new CheckpointRestoreSagaStore({
      workspaceRoot: testFixture.workspaceRoot,
      stateDir: testFixture.baseStateDir,
      secureDirectory,
      secureAuthorityPaths,
    });
    const reconciled = peer.load(created.operationId);
    expect(reconciled).toMatchObject({ seq: 2, phase: "locked" });
    expect(readHead(testFixture, created.operationId)).toMatchObject({
      seq: 2,
      eventHash: reconciled.headHash,
    });
    expect(peer.load(created.operationId)).toEqual(reconciled);
    expect(eventFiles(testFixture, created.operationId)).toHaveLength(2);
  });

  it("reconciles create after its event commits before the first HEAD settlement", () => {
    let injectFailure = true;
    const testFixture = fixture({
      beforeHeadRename({ head }) {
        if (head.seq === 1 && injectFailure) {
          injectFailure = false;
          throw new Error("injected crash before created HEAD settlement");
        }
      },
    });
    const operationId = "created_event_head_lag";
    let failure;
    try {
      testFixture.store.create({ operationId });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
      commitState: "event_committed_head_unsettled",
      intendedSeq: 1,
    });
    expect(eventFiles(testFixture, operationId)).toEqual([
      "000001-created.json",
    ]);

    const peer = new CheckpointRestoreSagaStore({
      workspaceRoot: testFixture.workspaceRoot,
      stateDir: testFixture.baseStateDir,
      secureDirectory,
      secureAuthorityPaths,
    });
    const reconciled = peer.load(operationId);
    expect(reconciled).toMatchObject({ seq: 1, phase: "created" });
    expect(() => peer.create({ operationId })).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.ALREADY_EXISTS),
    );
    expect(eventFiles(testFixture, operationId)).toEqual([
      "000001-created.json",
    ]);
  });

  it("marks post-rename event and HEAD validation failures as unknown commits", () => {
    const nativeRenameSync = fs.renameSync.bind(fs);
    const eventFs = {
      ...fs,
      constants: fs.constants,
      realpathSync: fs.realpathSync,
      renameSync(source, destination) {
        nativeRenameSync(source, destination);
        if (/^000001-created\.json$/u.test(path.basename(destination))) {
          fs.appendFileSync(destination, "corrupt");
        }
      },
    };
    const eventFixture = fixture({ fs: eventFs });
    let eventFailure;
    try {
      eventFixture.store.create({ operationId: "event_validation_unknown" });
    } catch (error) {
      eventFailure = error;
    }
    expect(eventFailure).toMatchObject({
      code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
      commitState: "event_commit_unknown",
      intendedSeq: 1,
    });

    let headRenameCount = 0;
    const headFs = {
      ...fs,
      constants: fs.constants,
      realpathSync: fs.realpathSync,
      renameSync(source, destination) {
        nativeRenameSync(source, destination);
        if (path.basename(destination) === "HEAD") {
          headRenameCount += 1;
          if (headRenameCount === 2) fs.writeFileSync(destination, "{}\n");
        }
      },
    };
    const headFixture = fixture({ fs: headFs });
    let headFailure;
    try {
      headFixture.store.create({ operationId: "head_validation_unknown" });
    } catch (error) {
      headFailure = error;
    }
    expect(headFailure).toMatchObject({
      code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT,
      commitState: "head_settlement_unknown",
      intendedSeq: 1,
    });
  });

  it("never reconciles a HEAD that is more than one event behind", () => {
    const testFixture = fixture();
    let saga = testFixture.store.create({ operationId: "head_two_event_lag" });
    const headAtCreated = readHead(testFixture, saga.operationId);
    saga = advance(testFixture.store, saga, "locked", {
      workspaceLockOwner: workspaceLockOwner(testFixture, saga.operationId),
    });
    saga = advance(testFixture.store, saga, "prepared", {
      prestateDigest: `sha256:${"a".repeat(64)}`,
      targetCount: 1,
    });
    writeHead(testFixture, saga.operationId, headAtCreated);

    expect(() => testFixture.store.load(saga.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
  });

  it("never adopts a published event chain whose HEAD is missing", () => {
    const testFixture = fixture();
    const saga = testFixture.store.create({ operationId: "missing_head" });
    fs.unlinkSync(headPath(testFixture, saga.operationId));

    expect(() => testFixture.store.load(saga.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
  });

  it("binds exact owner plus digest only to locked and recovery_started", () => {
    const testFixture = fixture();
    const operationId = "phase_owner_rules";
    const owner = workspaceLockOwner(testFixture, operationId);
    let saga = testFixture.store.create({ operationId });

    expect(() => advance(testFixture.store, saga, "locked")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE),
    );
    expect(() =>
      advance(testFixture.store, saga, "locked", {
        lockOwnerDigest:
          computeCheckpointRestoreWorkspaceLockOwnerDigest(owner),
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    expect(() =>
      advance(testFixture.store, saga, "locked", {
        workspaceLockOwner: owner,
        lockOwnerDigest: `sha256:${"f".repeat(64)}`,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    expect(() =>
      advance(testFixture.store, saga, "locked", {
        workspaceLockOwner: {
          ...owner,
          workspaceRoot: `${testFixture.workspaceRoot}${path.sep}`,
        },
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));

    saga = advance(testFixture.store, saga, "locked", {
      workspaceLockOwner: owner,
    });
    expect(saga.events.at(-1).evidence.lockOwnerDigest).toBe(
      computeCheckpointRestoreWorkspaceLockOwnerDigest(owner),
    );
    expect(() =>
      advance(testFixture.store, saga, "prepared", {
        workspaceLockOwner: owner,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    expect(() =>
      advance(testFixture.store, saga, "prepared", {
        lockOwnerDigest:
          computeCheckpointRestoreWorkspaceLockOwnerDigest(owner),
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));

    expect(() =>
      testFixture.store.create({
        operationId: "created_owner_forbidden",
        evidence: { workspaceLockOwner: owner },
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    expect(
      fs.existsSync(operationDirectory(testFixture, "created_owner_forbidden")),
    ).toBe(false);
  });

  it("replays phase-specific owner evidence with the same strict rules", () => {
    const testFixture = fixture();
    const operationId = "phase_owner_replay";
    const saga = testFixture.store.create({ operationId });
    advance(testFixture.store, saga, "locked", {
      workspaceLockOwner: workspaceLockOwner(testFixture, operationId),
    });
    const lockedPath = path.join(
      operationDirectory(testFixture, operationId),
      "000002-locked.json",
    );
    const locked = JSON.parse(fs.readFileSync(lockedPath, "utf8"));
    delete locked.evidence.workspaceLockOwner;
    locked.hash = recomputeEventHash(locked);
    fs.writeFileSync(lockedPath, `${JSON.stringify(locked)}\n`, {
      mode: 0o600,
    });

    expect(() => testFixture.store.load(operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
  });

  it("rejects rehashed events that omit required phase evidence", () => {
    const testFixture = fixture();
    const operationId = "phase_required_replay";
    let saga = testFixture.store.create({ operationId });
    saga = advance(testFixture.store, saga, "locked", {
      workspaceLockOwner: workspaceLockOwner(testFixture, operationId),
    });
    advance(testFixture.store, saga, "prepared", {
      prestateDigest: `sha256:${"1".repeat(64)}`,
      targetCount: 1,
    });
    const preparedPath = path.join(
      operationDirectory(testFixture, operationId),
      "000003-prepared.json",
    );
    const prepared = JSON.parse(fs.readFileSync(preparedPath, "utf8"));
    delete prepared.evidence.targetCount;
    prepared.hash = recomputeEventHash(prepared);
    fs.writeFileSync(preparedPath, `${JSON.stringify(prepared)}\n`, {
      mode: 0o600,
    });
    const head = readHead(testFixture, operationId);
    head.eventHash = prepared.hash;
    head.anchorHash = recomputeHeadAnchor(head);
    writeHead(testFixture, operationId, head);

    expect(() => testFixture.store.load(operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );

    const intentFixture = fixture();
    const intentOperationId = "intent_digest_replay";
    let intentSaga = intentFixture.store.create({
      operationId: intentOperationId,
    });
    intentSaga = advance(intentFixture.store, intentSaga, "locked", {
      workspaceLockOwner: workspaceLockOwner(intentFixture, intentOperationId),
    });
    intentSaga = advance(intentFixture.store, intentSaga, "prepared", {
      prestateDigest: `sha256:${"2".repeat(64)}`,
      targetCount: 0,
    });
    advance(intentFixture.store, intentSaga, "intent_committed", {
      sessionId: "intent-replay-session",
      intentCommitDigest: `sha256:${"3".repeat(64)}`,
    });
    const intentPath = path.join(
      operationDirectory(intentFixture, intentOperationId),
      "000004-intent_committed.json",
    );
    const intent = JSON.parse(fs.readFileSync(intentPath, "utf8"));
    delete intent.evidence.intentCommitDigest;
    intent.hash = recomputeEventHash(intent);
    fs.writeFileSync(intentPath, `${JSON.stringify(intent)}\n`, {
      mode: 0o600,
    });
    const intentHead = readHead(intentFixture, intentOperationId);
    intentHead.eventHash = intent.hash;
    intentHead.anchorHash = recomputeHeadAnchor(intentHead);
    writeHead(intentFixture, intentOperationId, intentHead);

    expect(() => intentFixture.store.load(intentOperationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
  });

  it("allows recovery_started to abort but not to enter session_committed", () => {
    const testFixture = fixture();
    const operationId = "recovery_abort";
    let saga = testFixture.store.create({ operationId });
    saga = advance(testFixture.store, saga, "recovery_required", {
      reason: "dead owner",
      errorCode: "LOCK_OWNER_DEAD",
    });
    expect(() => advance(testFixture.store, saga, "recovery_started")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE),
    );
    saga = advance(testFixture.store, saga, "recovery_started", {
      workspaceLockOwner: workspaceLockOwner(testFixture, operationId),
      recoveryAction: "pre-mutation-abort",
    });
    expect(() => advance(testFixture.store, saga, "session_committed")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_TRANSITION),
    );
    saga = advance(testFixture.store, saga, "aborted", {
      recoveryAction: "pre-mutation-abort",
      reason: "restore cancelled during recovery",
    });
    expect(saga.phase).toBe("aborted");
    expect(saga.terminal).toBe(true);
  });

  it("makes created durable before the caller acquires a workspace lock", () => {
    const testFixture = fixture();
    const order = [];
    const saga = testFixture.store.create({
      operationId: "created_before_workspace_lock",
      evidence: { restoreKind: "git" },
    });
    order.push("created-returned");
    expect(
      fs.existsSync(
        path.join(
          operationDirectory(testFixture, saga.operationId),
          "000001-created.json",
        ),
      ),
    ).toBe(true);

    const withFakeWorkspaceLock = (callback) => {
      order.push("workspace-lock-acquired");
      return callback();
    };
    withFakeWorkspaceLock(() => order.push("workspace-operation"));
    expect(order).toEqual([
      "created-returned",
      "workspace-lock-acquired",
      "workspace-operation",
    ]);
  });

  it("defaults to getStatePath()/checkpoint-restores outside the workspace", () => {
    const root = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), "cc-restore-saga-default-")),
    );
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    const stateBase = path.join(root, "state-base");
    fs.mkdirSync(workspaceRoot);
    const store = new CheckpointRestoreSagaStore({
      workspaceRoot: fs.realpathSync.native(workspaceRoot),
      getStatePath: () => stateBase,
      secureDirectory,
      secureAuthorityPaths,
    });

    expect(store.baseStateRoot).toBe(
      fs.realpathSync.native(path.join(stateBase, "checkpoint-restores")),
    );
    expect(path.dirname(store.stateRoot)).toBe(store.baseStateRoot);
    expect(path.basename(store.stateRoot)).toMatch(/^workspace-[a-f0-9]{64}$/);
  });

  it(
    "establishes a real owner-private state root with the production helper",
    { timeout: process.platform === "win32" ? 20_000 : 5_000 },
    () => {
      const testFixture = fixture({
        secureDirectory: undefined,
        secureAuthorityPaths: undefined,
      });
      const state = fs.lstatSync(testFixture.stateDir);

      expect(state.isSymbolicLink()).toBe(false);
      expect(state.isDirectory()).toBe(true);
      if (process.platform !== "win32") {
        expect(state.mode & 0o077).toBe(0);
      }
    },
  );

  it.runIf(process.platform === "win32")(
    "repairs an existing broadly writable Windows base state DACL",
    { timeout: 30_000 },
    () => {
      const root = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "cc-restore-saga-acl-")),
      );
      roots.push(root);
      const workspaceRoot = path.join(root, "workspace");
      const baseStateRoot = path.join(root, "broad-state");
      fs.mkdirSync(workspaceRoot);
      fs.mkdirSync(baseStateRoot);
      execFileSync(
        "icacls.exe",
        [baseStateRoot, "/inheritance:e", "/grant", "*S-1-1-0:(OI)(CI)F"],
        { windowsHide: true },
      );
      expect(inspectPrivatePath(baseStateRoot, { platform: "win32" }).ok).toBe(
        false,
      );

      new CheckpointRestoreSagaStore({
        workspaceRoot: fs.realpathSync.native(workspaceRoot),
        stateDir: baseStateRoot,
      });
      expect(inspectPrivatePath(baseStateRoot, { platform: "win32" }).ok).toBe(
        true,
      );
    },
  );

  it.runIf(process.platform === "win32")(
    "repairs Windows child authorities and atomic files in a fresh process",
    { timeout: 120_000 },
    () => {
      const root = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "cc-restore-saga-child-acl-")),
      );
      roots.push(root);
      const workspaceRoot = path.join(root, "workspace");
      const baseStateRoot = path.join(root, "state");
      fs.mkdirSync(workspaceRoot);
      const canonicalWorkspace = fs.realpathSync.native(workspaceRoot);
      const initial = new CheckpointRestoreSagaStore({
        workspaceRoot: canonicalWorkspace,
        stateDir: baseStateRoot,
        secureDirectory,
        secureAuthorityPaths,
      });

      let archived = initial.create({ operationId: "a_archived_acl" });
      archived = advance(initial, archived, "aborted", {
        reason: "archived ACL fixture",
      });
      initial.archiveTerminal(archived.operationId, {
        expectedSeq: archived.seq,
        expectedHash: archived.headHash,
      });

      let purging = initial.create({ operationId: "c_purging_acl" });
      purging = advance(initial, purging, "aborted", {
        reason: "purge ACL fixture",
      });
      initial.archiveTerminal(purging.operationId, {
        expectedSeq: purging.seq,
        expectedHash: purging.headHash,
      });
      fs.renameSync(
        path.join(initial.archiveRoot, purging.operationId),
        path.join(initial.purgeRoot, purging.operationId),
      );

      const active = initial.create({ operationId: "b_active_acl" });
      const operationDirectories = [
        path.join(initial.archiveRoot, archived.operationId),
        path.join(initial.stateRoot, active.operationId),
        path.join(initial.purgeRoot, purging.operationId),
      ];
      const controlDirectories = [
        initial.stateRoot,
        initial.lockRoot,
        initial.archiveRoot,
        initial.purgeRoot,
        initial.purgeReceiptRoot,
      ];
      const grantEveryone = (target, directory) => {
        execFileSync(
          "icacls.exe",
          [
            target,
            "/inheritance:r",
            "/grant",
            directory ? "*S-1-1-0:(OI)(CI)F" : "*S-1-1-0:F",
          ],
          { windowsHide: true },
        );
      };
      for (const target of [...controlDirectories, ...operationDirectories]) {
        grantEveryone(target, true);
      }
      const activeEvent = path.join(
        initial.stateRoot,
        active.operationId,
        "000001-created.json",
      );
      grantEveryone(activeEvent, false);

      const existingAuthorityPaths = [
        ...controlDirectories,
        ...operationDirectories.flatMap((directory) => [
          directory,
          ...fs
            .readdirSync(directory)
            .map((name) => path.join(directory, name)),
        ]),
      ];
      expect(
        inspectPrivatePaths(existingAuthorityPaths, {
          platform: "win32",
        }).some((result) => result.ok !== true),
      ).toBe(true);

      const moduleUrl = new URL(
        "../../src/lib/checkpoint-restore-saga.js",
        import.meta.url,
      ).href;
      const script = `
        const payload = JSON.parse(process.env.CC_SAGA_ACL_PAYLOAD);
        const { CheckpointRestoreSagaStore } = await import(payload.moduleUrl);
        const store = new CheckpointRestoreSagaStore({
          workspaceRoot: payload.workspaceRoot,
          stateDir: payload.stateDir,
        });
        store.load(payload.activeOperationId);
        store.listPending({ limit: 1 });
        store.listPending({ afterOperationId: payload.archivedOperationId, limit: 1 });
        store.listPending({ afterOperationId: payload.activeOperationId, limit: 1 });
        const created = store.create({ operationId: payload.newOperationId });
        process.stdout.write(JSON.stringify({
          phase: created.phase,
          stateRoot: store.stateRoot,
        }));
      `;
      const payload = {
        moduleUrl,
        workspaceRoot: canonicalWorkspace,
        stateDir: initial.baseStateRoot,
        archivedOperationId: archived.operationId,
        activeOperationId: active.operationId,
        newOperationId: "d_new_acl",
      };
      const childResult = JSON.parse(
        execFileSync(
          process.execPath,
          ["--input-type=module", "--eval", script],
          {
            env: {
              ...process.env,
              CC_SAGA_ACL_PAYLOAD: JSON.stringify(payload),
            },
            encoding: "utf8",
            windowsHide: true,
            timeout: 90_000,
          },
        ),
      );
      expect(childResult).toMatchObject({
        phase: "created",
        stateRoot: initial.stateRoot,
      });

      const newDirectory = path.join(initial.stateRoot, payload.newOperationId);
      const finalAuthorityPaths = [
        initial.baseStateRoot,
        ...existingAuthorityPaths,
        newDirectory,
        ...fs
          .readdirSync(newDirectory)
          .map((name) => path.join(newDirectory, name)),
      ];
      const finalInspection = inspectPrivatePaths(finalAuthorityPaths, {
        platform: "win32",
      });
      expect(
        finalInspection.every(
          (result) =>
            result.ok === true &&
            result.details?.ownerSid === result.details?.currentSid &&
            (result.details?.isDirectory !== true ||
              result.details?.protected === true),
        ),
      ).toBe(true);
    },
  );

  it("repairs simulated Windows atomic temporaries before every rename", () => {
    const secured = new Set();
    const nativeRenameSync = fs.renameSync.bind(fs);
    const secureAuthorityPaths = (targets) =>
      targets.map((target) => {
        expect(fs.existsSync(target)).toBe(true);
        secured.add(path.resolve(target).toLowerCase());
        return { target, exists: true, ok: true };
      });
    const runtimeFs = {
      ...fs,
      constants: fs.constants,
      realpathSync: fs.realpathSync,
      renameSync(source, destination) {
        if (path.basename(path.dirname(String(destination))) === ".purged") {
          expect(secured.has(path.resolve(source).toLowerCase())).toBe(true);
        }
        return nativeRenameSync(source, destination);
      },
    };
    const testFixture = fixture({
      fs: runtimeFs,
      platform: "win32",
      secureAuthorityPaths,
      beforeRename({ temporaryPath }) {
        expect(secured.has(path.resolve(temporaryPath).toLowerCase())).toBe(
          true,
        );
      },
      beforeHeadRename({ temporaryPath }) {
        expect(secured.has(path.resolve(temporaryPath).toLowerCase())).toBe(
          true,
        );
      },
    });
    let terminal = testFixture.store.create({
      operationId: "windows_temp_acl_order",
    });
    terminal = advance(testFixture.store, terminal, "aborted", {
      reason: "verify ACL ordering",
    });
    testFixture.store.archiveTerminal(terminal.operationId, {
      expectedSeq: terminal.seq,
      expectedHash: terminal.headHash,
    });
    testFixture.store.purgeArchived(terminal.operationId, {
      expectedSeq: terminal.seq,
      expectedHash: terminal.headHash,
      confirmOperationId: terminal.operationId,
    });

    expect(
      [...secured].some((target) => {
        const name = path.basename(target);
        return name.startsWith(".head.") && name.endsWith(".tmp");
      }),
    ).toBe(true);
    expect(
      [...secured].some((target) => {
        const name = path.basename(target);
        return (
          name.startsWith(".") &&
          name.includes(".json.") &&
          name.endsWith(".tmp")
        );
      }),
    ).toBe(true);
    expect(
      [...secured].some(
        (target) =>
          target.includes(`${path.sep}.purged${path.sep}`.toLowerCase()) &&
          target.endsWith(".tmp"),
      ),
    ).toBe(true);
  });

  it("rejects illegal transitions without publishing another event", () => {
    const testFixture = fixture();
    const saga = testFixture.store.create({
      operationId: "illegal_transition",
    });

    expect(() => advance(testFixture.store, saga, "workspace_applied")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_TRANSITION),
    );
    expect(eventFiles(testFixture, saga.operationId)).toEqual([
      "000001-created.json",
    ]);
  });

  it("enforces sequence and head-hash CAS across store instances", () => {
    const testFixture = fixture();
    const peer = new CheckpointRestoreSagaStore({
      workspaceRoot: testFixture.workspaceRoot,
      stateDir: testFixture.baseStateDir,
      secureDirectory,
      secureAuthorityPaths,
    });
    const stale = testFixture.store.create({ operationId: "cas_instances" });
    const winner = advance(testFixture.store, stale, "locked", {
      workspaceLockOwner: workspaceLockOwner(testFixture, stale.operationId),
    });

    expect(() => advance(peer, stale, "locked")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT),
    );
    expect(peer.load(stale.operationId).headHash).toBe(winner.headHash);
    expect(eventFiles(testFixture, stale.operationId)).toHaveLength(2);
  });

  it("serializes a real two-process CAS so exactly one contender wins", async () => {
    const testFixture = fixture();
    const saga = testFixture.store.create({ operationId: "cas_processes" });
    const gate = path.join(testFixture.root, "cas-gate");
    const moduleUrl = new URL(
      "../../src/lib/checkpoint-restore-saga.js",
      import.meta.url,
    ).href;
    const script = `
      import fs from "node:fs";
      const payload = JSON.parse(process.env.CC_SAGA_PAYLOAD);
      const { CheckpointRestoreSagaStore } = await import(payload.moduleUrl);
      const secureDirectory = (target) => {
        fs.mkdirSync(target, { recursive: true, mode: 0o700 });
        if (process.platform !== "win32") fs.chmodSync(target, 0o700);
      };
      const secureAuthorityPaths = (targets) => targets.map((target) => ({
        target,
        exists: true,
        ok: true,
      }));
      const store = new CheckpointRestoreSagaStore({
        workspaceRoot: payload.workspaceRoot,
        stateDir: payload.stateDir,
        secureDirectory,
        secureAuthorityPaths,
      });
      process.stdout.write("READY\\n");
      while (!fs.existsSync(payload.gate)) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
      }
      try {
        store.advance(payload.operationId, {
          expectedSeq: payload.expectedSeq,
          expectedHash: payload.expectedHash,
          phase: "aborted",
          evidence: { reason: "concurrent cancellation" },
        });
        process.stdout.write("RESULT:ok\\n");
      } catch (error) {
        process.stdout.write("RESULT:" + error.code + "\\n");
      }
    `;
    const payload = {
      moduleUrl,
      workspaceRoot: testFixture.workspaceRoot,
      stateDir: testFixture.baseStateDir,
      gate,
      operationId: saga.operationId,
      expectedSeq: saga.seq,
      expectedHash: saga.headHash,
    };

    const contenders = [0, 1].map(() => {
      const child = spawn(
        process.execPath,
        ["--input-type=module", "--eval", script],
        {
          env: {
            ...process.env,
            CC_SAGA_PAYLOAD: JSON.stringify(payload),
          },
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      let stdout = "";
      let stderr = "";
      const ready = new Promise((resolve, reject) => {
        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString();
          if (stdout.includes("READY\n")) resolve();
        });
        child.once("error", reject);
        child.once("exit", (code) => {
          if (!stdout.includes("READY\n")) {
            reject(new Error(`contender exited before ready: ${code}`));
          }
        });
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      const done = new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("exit", (code) => {
          if (code !== 0) {
            reject(new Error(`contender failed (${code}): ${stderr}`));
          } else {
            resolve(() => stdout);
          }
        });
      });
      return { ready, done };
    });

    await Promise.all(contenders.map((contender) => contender.ready));
    fs.writeFileSync(gate, "go", { mode: 0o600 });
    const outputs = await Promise.all(
      contenders.map(async (contender) => (await contender.done)()),
    );
    expect(
      outputs.filter((output) => output.includes("RESULT:ok")),
    ).toHaveLength(1);
    expect(
      outputs.filter((output) =>
        output.includes(
          `RESULT:${CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT}`,
        ),
      ),
    ).toHaveLength(1);
    expect(testFixture.store.load(saga.operationId).seq).toBe(2);
  });

  it("recovers a strict operation lock only after its exact owner is dead", () => {
    const testFixture = fixture({ lockTimeoutMs: 25, lockRetryMs: 1 });
    const saga = testFixture.store.create({ operationId: "dead_saga_lock" });
    const lockDirectory = path.join(
      testFixture.stateDir,
      ".locks",
      `${saga.operationId}.lock`,
    );
    fs.mkdirSync(lockDirectory);
    fs.writeFileSync(
      path.join(lockDirectory, "owner.json"),
      JSON.stringify({
        pid: 2_147_483_647,
        startedAt: 1,
        token: VALID_UUID,
      }),
      { mode: 0o600 },
    );

    expect(testFixture.store.load(saga.operationId).headHash).toBe(
      saga.headHash,
    );
    expect(fs.existsSync(lockDirectory)).toBe(false);
  });

  it("never reclaims a live operation lock by age and fails closed on corrupt owners", () => {
    const testFixture = fixture({ lockTimeoutMs: 20, lockRetryMs: 1 });
    const saga = testFixture.store.create({ operationId: "live_saga_lock" });
    const lockDirectory = path.join(
      testFixture.stateDir,
      ".locks",
      `${saga.operationId}.lock`,
    );
    fs.mkdirSync(lockDirectory);
    fs.writeFileSync(
      path.join(lockDirectory, "owner.json"),
      JSON.stringify({ pid: process.pid, startedAt: 0, token: VALID_UUID }),
      { mode: 0o600 },
    );

    expect(() => testFixture.store.load(saga.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED),
    );
    let pending = testFixture.store.listPending();
    expect(pending).toHaveLength(0);
    expect(pending.diagnostics).toEqual([
      expect.objectContaining({
        operationId: saga.operationId,
        status: "busy",
        recoverable: false,
      }),
    ]);
    expect(fs.existsSync(lockDirectory)).toBe(true);
    fs.rmSync(lockDirectory, { recursive: true, force: true });
    fs.mkdirSync(lockDirectory);
    fs.writeFileSync(path.join(lockDirectory, "owner.json"), "not-json", {
      mode: 0o600,
    });
    expect(() => testFixture.store.load(saga.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED),
    );
    pending = testFixture.store.listPending();
    expect(pending.diagnostics).toEqual([
      expect.objectContaining({
        operationId: saga.operationId,
        status: "corrupt",
        recoverable: false,
      }),
    ]);
    expect(fs.existsSync(lockDirectory)).toBe(true);
  });

  it("rejects hardlinked and oversized saga state-lock owners before reading them", () => {
    const hardlinkFixture = fixture({ lockTimeoutMs: 20, lockRetryMs: 1 });
    const hardlinkSaga = hardlinkFixture.store.create({
      operationId: "hardlink_lock_owner",
    });
    const hardlinkLock = path.join(
      hardlinkFixture.store.lockRoot,
      `${hardlinkSaga.operationId}.lock`,
    );
    fs.mkdirSync(hardlinkLock);
    const ownerPath = path.join(hardlinkLock, "owner.json");
    fs.writeFileSync(
      ownerPath,
      JSON.stringify({ pid: process.pid, startedAt: 0, token: VALID_UUID }),
      { mode: 0o600 },
    );
    fs.linkSync(ownerPath, path.join(hardlinkFixture.root, "owner-hardlink"));
    expect(() => hardlinkFixture.store.load(hardlinkSaga.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED),
    );

    const oversizedFixture = fixture({ lockTimeoutMs: 20, lockRetryMs: 1 });
    const oversizedSaga = oversizedFixture.store.create({
      operationId: "oversized_lock_owner",
    });
    const oversizedLock = path.join(
      oversizedFixture.store.lockRoot,
      `${oversizedSaga.operationId}.lock`,
    );
    fs.mkdirSync(oversizedLock);
    fs.writeFileSync(
      path.join(oversizedLock, "owner.json"),
      "x".repeat(3 * 1024),
      { mode: 0o600 },
    );
    expect(() =>
      oversizedFixture.store.load(oversizedSaga.operationId),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LOCK_FAILED));
  });

  it("removes bounded orphan temps and never promotes their content", () => {
    const testFixture = fixture();
    let saga = testFixture.store.create({ operationId: "orphan_temp" });
    const temporaryName = `.000002-locked.json.99999.${VALID_UUID}.tmp`;
    const temporaryPath = path.join(
      operationDirectory(testFixture, saga.operationId),
      temporaryName,
    );
    fs.writeFileSync(
      temporaryPath,
      JSON.stringify({ phase: "completed", forged: true }),
      { mode: 0o600 },
    );

    const loaded = testFixture.store.load(saga.operationId);
    expect(loaded.seq).toBe(1);
    expect(loaded.phase).toBe("created");
    expect(loaded.orphanTemporaryFiles).toEqual([]);
    expect(fs.existsSync(temporaryPath)).toBe(false);
    saga = advance(testFixture.store, loaded, "locked", {
      workspaceLockOwner: workspaceLockOwner(testFixture, saga.operationId),
    });
    expect(saga.seq).toBe(2);
    expect(saga.phase).toBe("locked");
    expect(saga.events.some((event) => event.forged)).toBe(false);
    expect(saga.orphanTemporaryFiles).toEqual([]);
    const pending = testFixture.store.listPending();
    expect(pending.map((entry) => entry.operationId)).toEqual([
      saga.operationId,
    ]);
    expect(pending.diagnostics).toEqual([]);
  });

  it("allows create to retry an exact empty operation directory left before created", () => {
    let injected = true;
    const testFixture = fixture({
      beforeCreatedEvent() {
        if (injected) {
          injected = false;
          throw new Error("injected kill before created event");
        }
      },
    });
    const operationId = "retry_empty_created";

    expect(() => testFixture.store.create({ operationId })).toThrow();
    const peer = new CheckpointRestoreSagaStore({
      workspaceRoot: testFixture.workspaceRoot,
      stateDir: testFixture.baseStateDir,
      secureDirectory,
      secureAuthorityPaths,
    });
    const pending = peer.listPending();
    expect(pending).toHaveLength(0);
    expect(pending.orphanOperationIds).toEqual([operationId]);
    expect(pending.diagnostics).toEqual([
      expect.objectContaining({
        operationId,
        status: "orphan_unpublished",
        recoverable: true,
      }),
    ]);
    const orphanHeadTemporary = `.HEAD.99999.${VALID_UUID}.tmp`;
    fs.writeFileSync(
      path.join(
        operationDirectory(testFixture, operationId),
        orphanHeadTemporary,
      ),
      "{}\n",
      { mode: 0o600 },
    );
    expect(peer.create({ operationId }).phase).toBe("created");
    expect(
      fs.existsSync(
        path.join(
          operationDirectory(testFixture, operationId),
          orphanHeadTemporary,
        ),
      ),
    ).toBe(false);
  });

  it("clamps a regressing clock before writing the next event", () => {
    const timestamps = [200, 100];
    const testFixture = fixture({ now: () => timestamps.shift() });
    let saga = testFixture.store.create({ operationId: "clock_rollback" });
    saga = advance(testFixture.store, saga, "locked", {
      workspaceLockOwner: workspaceLockOwner(testFixture, saga.operationId),
    });

    expect(saga.events.map((event) => event.timestamp)).toEqual([200, 200]);
    expect(testFixture.store.load(saga.operationId).headHash).toBe(
      saga.headHash,
    );
  });

  it("fails closed if the workspace directory is replaced after construction", () => {
    const testFixture = fixture();
    const saga = testFixture.store.create({
      operationId: "workspace_replaced",
    });
    const retired = `${testFixture.workspaceRoot}-retired`;
    fs.renameSync(testFixture.workspaceRoot, retired);
    fs.mkdirSync(testFixture.workspaceRoot);

    expect(() => testFixture.store.load(saga.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WORKSPACE_MISMATCH),
    );
    expect(() => advance(testFixture.store, saga, "locked")).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WORKSPACE_MISMATCH),
    );
  });

  it("lists only pending sagas for the exact workspace and reports empty orphans", () => {
    const testFixture = fixture();
    let pendingSaga = testFixture.store.create({ operationId: "pending_one" });
    pendingSaga = advance(testFixture.store, pendingSaga, "recovery_required", {
      reason: "interrupted before lock",
      errorCode: "INTERRUPTED",
    });
    let completedSaga = testFixture.store.create({
      operationId: "terminal_one",
    });
    completedSaga = advance(testFixture.store, completedSaga, "aborted", {
      reason: "operator cancelled",
    });
    fs.mkdirSync(path.join(testFixture.stateDir, "empty_orphan"), {
      mode: 0o700,
    });
    if (process.platform !== "win32") {
      fs.chmodSync(path.join(testFixture.stateDir, "empty_orphan"), 0o700);
    }

    const otherWorkspace = path.join(testFixture.root, "other-workspace");
    fs.mkdirSync(otherWorkspace);
    const otherStore = new CheckpointRestoreSagaStore({
      workspaceRoot: fs.realpathSync.native(otherWorkspace),
      stateDir: testFixture.baseStateDir,
      secureDirectory,
      secureAuthorityPaths,
    });
    let otherSaga = otherStore.create({
      operationId: "other_workspace_pending",
    });
    advance(otherStore, otherSaga, "locked", {
      workspaceLockOwner: workspaceLockOwner(
        { workspaceRoot: fs.realpathSync.native(otherWorkspace) },
        otherSaga.operationId,
      ),
    });

    const pending = testFixture.store.listPending();
    expect(pending.map((saga) => saga.operationId)).toEqual([
      pendingSaga.operationId,
    ]);
    expect(pending.orphanOperationIds).toEqual(["empty_orphan"]);
    expect(
      pending.some((saga) => saga.operationId === completedSaga.operationId),
    ).toBe(false);
    expect(pending.terminalOperationIds).toEqual([completedSaga.operationId]);
    expect(pending.diagnostics).toContainEqual(
      expect.objectContaining({
        operationId: completedSaga.operationId,
        status: "terminal_unarchived",
        recoverable: true,
      }),
    );
  });

  it("bounds each shard and archives only an exact clean terminal head", () => {
    const testFixture = fixture({ maxSagas: 2 });
    let terminal = testFixture.store.create({
      operationId: "archive_terminal",
    });
    terminal = advance(testFixture.store, terminal, "aborted", {
      reason: "operator cancelled",
    });
    const active = testFixture.store.create({ operationId: "retained_active" });

    expect(() =>
      testFixture.store.create({ operationId: "over_capacity" }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT));
    expect(
      fs.existsSync(operationDirectory(testFixture, "over_capacity")),
    ).toBe(false);
    expect(() =>
      testFixture.store.archiveTerminal(active.operationId, {
        expectedSeq: active.seq,
        expectedHash: active.headHash,
      }),
    ).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_TRANSITION),
    );
    expect(() =>
      testFixture.store.archiveTerminal(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: `sha256:${"0".repeat(64)}`,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT));

    const archived = testFixture.store.archiveTerminal(terminal.operationId, {
      expectedSeq: terminal.seq,
      expectedHash: terminal.headHash,
    });
    expect(archived).toEqual(
      expect.objectContaining({
        operationId: terminal.operationId,
        archived: true,
        phase: "aborted",
      }),
    );
    expect(
      fs.existsSync(operationDirectory(testFixture, terminal.operationId)),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(testFixture.stateDir, ".archive", terminal.operationId),
      ),
    ).toBe(true);
    expect(
      testFixture.store.archiveTerminal(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
      }),
    ).toEqual(
      expect.objectContaining({
        archived: true,
        alreadyArchived: true,
      }),
    );
    const retained = testFixture.store.listPending();
    expect(retained.archivedOperationIds).toEqual([terminal.operationId]);
    expect(retained.diagnostics).toContainEqual(
      expect.objectContaining({
        operationId: terminal.operationId,
        status: "archived",
        recoverable: true,
      }),
    );
    expect(() =>
      testFixture.store.create({ operationId: terminal.operationId }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.ALREADY_EXISTS));
    expect(() =>
      testFixture.store.create({ operationId: "receipt_still_over_capacity" }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT));
    expect(() =>
      testFixture.store.create({ operationId: "still_over_capacity" }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.LIMIT));
    expect(() =>
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: "wrong-operation",
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT));
    const purged = testFixture.store.purgeArchived(terminal.operationId, {
      expectedSeq: terminal.seq,
      expectedHash: terminal.headHash,
      confirmOperationId: terminal.operationId,
    });
    expect(purged).toEqual(
      expect.objectContaining({
        operationId: terminal.operationId,
        purged: true,
        operationIdMayBeReused: false,
      }),
    );
    expect(
      fs.existsSync(
        path.join(testFixture.stateDir, ".archive", terminal.operationId),
      ),
    ).toBe(false);
    expect(
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      }),
    ).toEqual(expect.objectContaining({ purged: true, alreadyPurged: true }));
    expect(() =>
      testFixture.store.create({ operationId: terminal.operationId }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.ALREADY_EXISTS));
    const purgedRetention = testFixture.store.listPending();
    expect(purgedRetention.purgedOperationIds).toEqual([terminal.operationId]);
    expect(
      testFixture.store.releasePurgeReceipt(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      }),
    ).toEqual(
      expect.objectContaining({
        released: true,
        operationIdMayBeReused: true,
      }),
    );
    expect(
      testFixture.store.releasePurgeReceipt(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      }),
    ).toEqual(
      expect.objectContaining({ released: true, alreadyReleased: true }),
    );
    const explicitlyReused = testFixture.store.create({
      operationId: terminal.operationId,
    });
    expect(explicitlyReused.phase).toBe("created");
    expect(() =>
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT));
    expect(
      testFixture.store
        .listPending()
        .map((saga) => saga.operationId)
        .sort(),
    ).toEqual([active.operationId, explicitlyReused.operationId].sort());
  });

  it("settles an archive rename whose response is lost by exact idempotent retry", () => {
    const nativeRenameSync = fs.renameSync.bind(fs);
    let loseArchiveResponse = true;
    const runtimeFs = {
      ...fs,
      constants: fs.constants,
      realpathSync: fs.realpathSync,
      renameSync(source, destination) {
        nativeRenameSync(source, destination);
        if (
          loseArchiveResponse &&
          path.basename(path.dirname(destination)) === ".archive"
        ) {
          loseArchiveResponse = false;
          const error = new Error("injected lost archive response");
          error.code = "EIO";
          throw error;
        }
      },
    };
    const testFixture = fixture({ fs: runtimeFs });
    let terminal = testFixture.store.create({
      operationId: "archive_unknown_retry",
    });
    terminal = advance(testFixture.store, terminal, "aborted", {
      reason: "operator cancelled",
    });

    let failure;
    try {
      testFixture.store.archiveTerminal(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
      commitState: "archive_commit_unknown",
      intendedSeq: terminal.seq,
      intendedHash: terminal.headHash,
    });
    expect(
      testFixture.store.archiveTerminal(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
      }),
    ).toEqual(
      expect.objectContaining({ archived: true, alreadyArchived: true }),
    );
  });

  it("revalidates exact terminal state before resuming a pending purge", () => {
    const nativeRmSync = fs.rmSync.bind(fs);
    let failPurgeDelete = true;
    const runtimeFs = {
      ...fs,
      constants: fs.constants,
      realpathSync: fs.realpathSync,
      rmSync(target, options) {
        if (
          failPurgeDelete &&
          path.basename(path.dirname(String(target))) === ".purge"
        ) {
          failPurgeDelete = false;
          const error = new Error("injected purge interruption");
          error.code = "EACCES";
          throw error;
        }
        return nativeRmSync(target, options);
      },
    };
    const testFixture = fixture({ fs: runtimeFs });
    let terminal = testFixture.store.create({
      operationId: "purge_resume_exact",
    });
    terminal = advance(testFixture.store, terminal, "aborted", {
      reason: "operator cancelled",
    });
    testFixture.store.archiveTerminal(terminal.operationId, {
      expectedSeq: terminal.seq,
      expectedHash: terminal.headHash,
    });

    let failure;
    try {
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({
      code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
      commitState: "purge_delete_unknown",
    });
    const retained = testFixture.store.listPending();
    expect(retained.purgeOperationIds).toEqual([terminal.operationId]);
    expect(retained.diagnostics).toContainEqual(
      expect.objectContaining({
        operationId: terminal.operationId,
        status: "purge_pending",
        recoverable: true,
      }),
    );
    expect(() =>
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq + 1,
        expectedHash: `sha256:${"0".repeat(64)}`,
        confirmOperationId: terminal.operationId,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT));
    expect(
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      }),
    ).toEqual(expect.objectContaining({ purged: true }));
    expect(() =>
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq + 1,
        expectedHash: `sha256:${"0".repeat(64)}`,
        confirmOperationId: terminal.operationId,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CONFLICT));
    expect(() =>
      testFixture.store.purgeArchived("never_existed", {
        expectedSeq: 63,
        expectedHash: `sha256:${"0".repeat(64)}`,
        confirmOperationId: "never_existed",
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.NOT_FOUND));
  });

  it("settles lost purge-receipt and release responses without weakening CAS", () => {
    const nativeRenameSync = fs.renameSync.bind(fs);
    const nativeUnlinkSync = fs.unlinkSync.bind(fs);
    let loseReceiptResponse = true;
    let loseReleaseResponse = true;
    const runtimeFs = {
      ...fs,
      constants: fs.constants,
      realpathSync: fs.realpathSync,
      renameSync(source, destination) {
        nativeRenameSync(source, destination);
        if (
          loseReceiptResponse &&
          path.basename(path.dirname(destination)) === ".purged" &&
          destination.endsWith(".json")
        ) {
          loseReceiptResponse = false;
          throw Object.assign(new Error("injected lost receipt response"), {
            code: "EIO",
          });
        }
      },
      unlinkSync(target) {
        if (
          loseReleaseResponse &&
          path.basename(path.dirname(String(target))) === ".purged" &&
          String(target).endsWith(".json")
        ) {
          nativeUnlinkSync(target);
          loseReleaseResponse = false;
          throw Object.assign(new Error("injected lost release response"), {
            code: "EIO",
          });
        }
        return nativeUnlinkSync(target);
      },
    };
    const testFixture = fixture({ fs: runtimeFs });
    let terminal = testFixture.store.create({
      operationId: "purge_receipt_unknown",
    });
    terminal = advance(testFixture.store, terminal, "aborted", {
      reason: "operator cancelled",
    });
    testFixture.store.archiveTerminal(terminal.operationId, {
      expectedSeq: terminal.seq,
      expectedHash: terminal.headHash,
    });

    let receiptFailure;
    try {
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      });
    } catch (error) {
      receiptFailure = error;
    }
    expect(receiptFailure).toMatchObject({
      code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
      commitState: "purge_receipt_commit_unknown",
    });
    expect(
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      }),
    ).toEqual(
      expect.objectContaining({
        purged: true,
        operationIdMayBeReused: false,
      }),
    );

    let releaseFailure;
    try {
      testFixture.store.releasePurgeReceipt(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      });
    } catch (error) {
      releaseFailure = error;
    }
    expect(releaseFailure).toMatchObject({
      code: CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED,
      commitState: "purge_receipt_release_unknown",
    });
    expect(
      testFixture.store.releasePurgeReceipt(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      }),
    ).toEqual(
      expect.objectContaining({ released: true, alreadyReleased: true }),
    );
  });

  it("fails closed on a corrupt HEAD retained in pending purge", () => {
    const nativeRmSync = fs.rmSync.bind(fs);
    let failPurgeDelete = true;
    const runtimeFs = {
      ...fs,
      constants: fs.constants,
      realpathSync: fs.realpathSync,
      rmSync(target, options) {
        if (
          failPurgeDelete &&
          path.basename(path.dirname(String(target))) === ".purge"
        ) {
          failPurgeDelete = false;
          throw Object.assign(new Error("injected purge interruption"), {
            code: "EACCES",
          });
        }
        return nativeRmSync(target, options);
      },
    };
    const testFixture = fixture({ fs: runtimeFs });
    let terminal = testFixture.store.create({
      operationId: "purge_corrupt_head",
    });
    terminal = advance(testFixture.store, terminal, "aborted", {
      reason: "operator cancelled",
    });
    testFixture.store.archiveTerminal(terminal.operationId, {
      expectedSeq: terminal.seq,
      expectedHash: terminal.headHash,
    });
    expect(() =>
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.WRITE_FAILED));
    fs.writeFileSync(
      path.join(testFixture.store.purgeRoot, terminal.operationId, "HEAD"),
      "{}\n",
    );
    expect(() =>
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT));
    expect(
      fs.existsSync(
        path.join(testFixture.store.purgeRoot, terminal.operationId),
      ),
    ).toBe(true);
  });

  it("fails closed on a corrupt durable purge receipt", () => {
    const testFixture = fixture();
    let terminal = testFixture.store.create({
      operationId: "corrupt_purge_receipt",
    });
    terminal = advance(testFixture.store, terminal, "aborted", {
      reason: "operator cancelled",
    });
    testFixture.store.archiveTerminal(terminal.operationId, {
      expectedSeq: terminal.seq,
      expectedHash: terminal.headHash,
    });
    testFixture.store.purgeArchived(terminal.operationId, {
      expectedSeq: terminal.seq,
      expectedHash: terminal.headHash,
      confirmOperationId: terminal.operationId,
    });
    const receiptPath = path.join(
      testFixture.store.purgeReceiptRoot,
      `${terminal.operationId}.json`,
    );
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    receipt.headHash = `sha256:${"0".repeat(64)}`;
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt)}\n`, {
      mode: 0o600,
    });

    expect(() =>
      testFixture.store.purgeArchived(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT));
    expect(() =>
      testFixture.store.releasePurgeReceipt(terminal.operationId, {
        expectedSeq: terminal.seq,
        expectedHash: terminal.headHash,
        confirmOperationId: terminal.operationId,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT));
    expect(() =>
      testFixture.store.create({ operationId: terminal.operationId }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT));
  });

  it("paginates retention scans with a stable operationId cursor", () => {
    const testFixture = fixture();
    for (const operationId of ["page_a", "page_b", "page_c"]) {
      testFixture.store.create({ operationId });
    }
    const first = testFixture.store.listPending({ limit: 2 });
    expect(first.map((saga) => saga.operationId)).toEqual(["page_a", "page_b"]);
    expect(first).toMatchObject({
      truncated: true,
      budgetExhausted: false,
      nextCursor: "page_b",
    });
    const second = testFixture.store.listPending({
      afterOperationId: first.nextCursor,
      limit: 2,
    });
    expect(second.map((saga) => saga.operationId)).toEqual(["page_c"]);
    expect(second).toMatchObject({ truncated: false, nextCursor: null });
  });

  it("returns an explicit continuation when the listing deadline is exhausted", () => {
    const ticks = [0, 3_000];
    const testFixture = fixture({
      wallClock: () => ticks.shift() ?? 3_000,
    });
    testFixture.store.create({ operationId: "deadline_pending" });

    const pending = testFixture.store.listPending();
    expect(pending).toHaveLength(0);
    expect(pending).toMatchObject({
      truncated: true,
      budgetExhausted: true,
      nextCursor: "",
    });
  });

  it("fails closed when an operationId exists in active and archive retention", () => {
    const testFixture = fixture();
    const saga = testFixture.store.create({
      operationId: "duplicate_retention",
    });
    fs.cpSync(
      operationDirectory(testFixture, saga.operationId),
      path.join(testFixture.store.archiveRoot, saga.operationId),
      { recursive: true },
    );

    expect(() => testFixture.store.load(saga.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
    expect(testFixture.store.listPending()).toMatchObject({
      diagnostics: [
        expect.objectContaining({
          operationId: saga.operationId,
          status: "corrupt",
          recoverable: false,
        }),
      ],
    });
  });

  it("isolates corrupt data and live locks in another workspace shard", () => {
    const testFixture = fixture({ lockTimeoutMs: 20, lockRetryMs: 1 });
    const local = testFixture.store.create({ operationId: "local_pending" });
    const otherWorkspace = path.join(testFixture.root, "isolated-workspace");
    fs.mkdirSync(otherWorkspace);
    const otherStore = new CheckpointRestoreSagaStore({
      workspaceRoot: fs.realpathSync.native(otherWorkspace),
      stateDir: testFixture.baseStateDir,
      secureDirectory,
      secureAuthorityPaths,
      lockTimeoutMs: 20,
      lockRetryMs: 1,
    });
    const foreign = otherStore.create({ operationId: "foreign_corrupt" });
    fs.appendFileSync(
      path.join(
        otherStore.stateRoot,
        foreign.operationId,
        "000001-created.json",
      ),
      "corrupt",
    );
    const foreignLock = path.join(
      otherStore.lockRoot,
      `${foreign.operationId}.lock`,
    );
    fs.mkdirSync(foreignLock);
    fs.writeFileSync(
      path.join(foreignLock, "owner.json"),
      JSON.stringify({ pid: process.pid, startedAt: 0, token: VALID_UUID }),
      { mode: 0o600 },
    );

    expect(otherStore.stateRoot).not.toBe(testFixture.store.stateRoot);
    const pending = testFixture.store.listPending();
    expect(pending.map((saga) => saga.operationId)).toEqual([
      local.operationId,
    ]);
    expect(pending.diagnostics).toEqual([]);
  });

  it("uses a new shard when the same workspace path is rebuilt", () => {
    const testFixture = fixture({ maxSagas: 1, lockTimeoutMs: 20 });
    let old = testFixture.store.create({ operationId: "old_terminal" });
    old = advance(testFixture.store, old, "aborted", {
      reason: "old workspace retired",
    });
    fs.appendFileSync(
      path.join(
        operationDirectory(testFixture, old.operationId),
        "000001-created.json",
      ),
      "old-corrupt",
    );
    const oldLock = path.join(
      testFixture.store.lockRoot,
      `${old.operationId}.lock`,
    );
    fs.mkdirSync(oldLock);
    fs.writeFileSync(
      path.join(oldLock, "owner.json"),
      JSON.stringify({ pid: process.pid, startedAt: 0, token: VALID_UUID }),
      { mode: 0o600 },
    );
    const oldShard = testFixture.store.stateRoot;
    fs.renameSync(
      testFixture.workspaceRoot,
      `${testFixture.workspaceRoot}-old`,
    );
    fs.mkdirSync(testFixture.workspaceRoot);

    const rebuilt = new CheckpointRestoreSagaStore({
      workspaceRoot: fs.realpathSync.native(testFixture.workspaceRoot),
      stateDir: testFixture.baseStateDir,
      secureDirectory,
      secureAuthorityPaths,
      maxSagas: 1,
      lockTimeoutMs: 20,
    });
    expect(rebuilt.stateRoot).not.toBe(oldShard);
    const fresh = rebuilt.create({ operationId: "fresh_after_rebuild" });
    expect(rebuilt.listPending().map((saga) => saga.operationId)).toEqual([
      fresh.operationId,
    ]);
  });

  it("rejects unknown and oversized evidence before creating files", () => {
    const testFixture = fixture();
    expect(() =>
      testFixture.store.create({
        operationId: "unknown_evidence",
        evidence: { arbitrary: "not allowed" },
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    expect(() =>
      testFixture.store.create({
        operationId: "large_evidence",
        evidence: { reason: "x".repeat(2049) },
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    expect(() =>
      testFixture.store.create({
        operationId: "invalid_confirmation_digest",
        evidence: { confirmationDigest: "sha256:not-a-digest" },
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    expect(
      fs.existsSync(path.join(testFixture.stateDir, "unknown_evidence")),
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(testFixture.stateDir, "invalid_confirmation_digest"),
      ),
    ).toBe(false);
  });

  it("requires an exact workspace lock owner binding", () => {
    const testFixture = fixture();
    const saga = testFixture.store.create({
      operationId: "lock_owner_binding",
    });
    const owner = workspaceLockOwner(testFixture, "different_operation");

    expect(() =>
      advance(testFixture.store, saga, "locked", {
        workspaceLockOwner: owner,
      }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_EVIDENCE));
    expect(eventFiles(testFixture, saga.operationId)).toHaveLength(1);
  });

  it("detects content tampering and hash drift", () => {
    const testFixture = fixture();
    const saga = testFixture.store.create({ operationId: "tamper_hash" });
    const filePath = path.join(
      operationDirectory(testFixture, saga.operationId),
      "000001-created.json",
    );
    const event = JSON.parse(fs.readFileSync(filePath, "utf8"));
    event.evidence.restoreKind = "copy";
    fs.writeFileSync(filePath, `${JSON.stringify(event)}\n`, { mode: 0o600 });

    expect(() => testFixture.store.load(saga.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
    const pending = testFixture.store.listPending();
    expect(pending).toHaveLength(0);
    expect(pending.diagnostics).toEqual([
      expect.objectContaining({
        operationId: saga.operationId,
        status: "corrupt",
        recoverable: false,
      }),
    ]);
  });

  it("detects missing and duplicate event sequences", () => {
    const missingFixture = fixture();
    let missing = missingFixture.store.create({ operationId: "missing_seq" });
    missing = advance(missingFixture.store, missing, "locked", {
      workspaceLockOwner: workspaceLockOwner(
        missingFixture,
        missing.operationId,
      ),
    });
    fs.unlinkSync(
      path.join(
        operationDirectory(missingFixture, missing.operationId),
        "000001-created.json",
      ),
    );
    expect(() => missingFixture.store.load(missing.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );

    const duplicateFixture = fixture();
    let duplicate = duplicateFixture.store.create({
      operationId: "duplicate_seq",
    });
    duplicate = advance(duplicateFixture.store, duplicate, "locked", {
      workspaceLockOwner: workspaceLockOwner(
        duplicateFixture,
        duplicate.operationId,
      ),
    });
    fs.copyFileSync(
      path.join(
        operationDirectory(duplicateFixture, duplicate.operationId),
        "000002-locked.json",
      ),
      path.join(
        operationDirectory(duplicateFixture, duplicate.operationId),
        "000002-prepared.json",
      ),
    );
    expect(() => duplicateFixture.store.load(duplicate.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
  });

  it("rejects oversized event files and unknown temporary names", () => {
    const oversizedFixture = fixture();
    const oversized = oversizedFixture.store.create({
      operationId: "oversized_event",
    });
    const eventPath = path.join(
      operationDirectory(oversizedFixture, oversized.operationId),
      "000001-created.json",
    );
    fs.appendFileSync(
      eventPath,
      "x".repeat(MAX_CHECKPOINT_RESTORE_SAGA_EVENT_BYTES),
    );
    expect(() => oversizedFixture.store.load(oversized.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );

    const unknownFixture = fixture();
    const unknown = unknownFixture.store.create({
      operationId: "unknown_temp",
    });
    fs.writeFileSync(
      path.join(
        operationDirectory(unknownFixture, unknown.operationId),
        ".bad.tmp",
      ),
      "ignored?",
      { mode: 0o600 },
    );
    expect(() => unknownFixture.store.load(unknown.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
  });

  it.skipIf(process.platform === "win32")("rejects symlink event files", () => {
    const symlinkFixture = fixture();
    const symlinkSaga = symlinkFixture.store.create({
      operationId: "symlink_event",
    });
    const symlinkEvent = path.join(
      operationDirectory(symlinkFixture, symlinkSaga.operationId),
      "000001-created.json",
    );
    const symlinkBackup = `${symlinkEvent}.backup`;
    fs.renameSync(symlinkEvent, symlinkBackup);
    fs.symlinkSync(path.basename(symlinkBackup), symlinkEvent);
    expect(() => symlinkFixture.store.load(symlinkSaga.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
  });

  it("rejects hardlink event files on every supported platform", () => {
    const hardlinkFixture = fixture();
    const hardlinkSaga = hardlinkFixture.store.create({
      operationId: "hardlink_event",
    });
    const hardlinkEvent = path.join(
      operationDirectory(hardlinkFixture, hardlinkSaga.operationId),
      "000001-created.json",
    );
    fs.linkSync(hardlinkEvent, `${hardlinkEvent}.external-link`);
    expect(() => hardlinkFixture.store.load(hardlinkSaga.operationId)).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT),
    );
  });

  it("rejects operation path escapes and state/workspace overlap", () => {
    const testFixture = fixture();
    expect(() =>
      testFixture.store.create({ operationId: "../escape" }),
    ).toThrow(
      errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.INVALID_OPERATION_ID),
    );
    expect(
      () =>
        new CheckpointRestoreSagaStore({
          workspaceRoot: testFixture.workspaceRoot,
          stateDir: path.join(testFixture.workspaceRoot, "state"),
          secureDirectory,
          secureAuthorityPaths,
        }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH));
    expect(fs.existsSync(path.join(testFixture.workspaceRoot, "state"))).toBe(
      false,
    );
  });

  it.skipIf(process.platform === "win32")(
    "rejects aliased state and workspace roots",
    () => {
      const testFixture = fixture();
      const realState = path.join(testFixture.root, "real-state");
      const stateAlias = path.join(testFixture.root, "state-alias");
      secureDirectory(realState);
      fs.symlinkSync(realState, stateAlias, "dir");
      expect(
        () =>
          new CheckpointRestoreSagaStore({
            workspaceRoot: testFixture.workspaceRoot,
            stateDir: stateAlias,
            secureDirectory,
            secureAuthorityPaths,
          }),
      ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH));

      const workspaceAlias = path.join(testFixture.root, "workspace-alias");
      fs.symlinkSync(testFixture.workspaceRoot, workspaceAlias, "dir");
      expect(
        () =>
          new CheckpointRestoreSagaStore({
            workspaceRoot: workspaceAlias,
            stateDir: path.join(testFixture.root, "another-state"),
            secureDirectory,
            secureAuthorityPaths,
          }),
      ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH));
    },
  );

  it.runIf(process.platform === "win32")(
    "production private-directory checks reject junctions before writing the workspace",
    () => {
      const root = fs.realpathSync.native(
        fs.mkdtempSync(path.join(os.tmpdir(), "cc-restore-saga-junction-")),
      );
      roots.push(root);
      const workspaceRoot = path.join(root, "workspace");
      fs.mkdirSync(workspaceRoot);
      const canonicalWorkspace = fs.realpathSync.native(workspaceRoot);
      const defaultStateJunction = path.join(root, "default-state-junction");
      const explicitStateJunction = path.join(root, "explicit-state-junction");
      fs.symlinkSync(canonicalWorkspace, defaultStateJunction, "junction");
      fs.symlinkSync(canonicalWorkspace, explicitStateJunction, "junction");

      expect(
        () =>
          new CheckpointRestoreSagaStore({
            workspaceRoot: canonicalWorkspace,
            getStatePath: () => defaultStateJunction,
          }),
      ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH));
      expect(
        () =>
          new CheckpointRestoreSagaStore({
            workspaceRoot: canonicalWorkspace,
            stateDir: explicitStateJunction,
          }),
      ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.UNSAFE_PATH));
      expect(fs.readdirSync(canonicalWorkspace)).toEqual([]);
    },
    30000,
  );

  it.each(["1.49.1", "1.50.0"])(
    "accepts trusted Windows event and HEAD path-device projection on libuv %s",
    (uvVersion) => {
      const testFixture = fixture(
        projectedAuthorityIdentityRuntime({
          uvVersion,
          forbidDescriptorReadFile: true,
        }),
      );
      const saga = testFixture.store.create({
        operationId: `projected_event_${uvVersion.replaceAll(".", "_")}`,
      });

      expect(testFixture.store.load(saga.operationId)).toMatchObject({
        operationId: saga.operationId,
        headHash: saga.headHash,
        seq: 1,
      });
    },
  );

  it.each([
    ["newer Windows libuv", { platform: "win32", uvVersion: "1.51.0" }],
    ["non-Windows libuv", { platform: "linux", uvVersion: "1.49.1" }],
  ])("rejects the same path-device projection on %s", (_label, runtime) => {
    const testFixture = fixture(projectedAuthorityIdentityRuntime(runtime));

    expect(() =>
      testFixture.store.create({ operationId: "untrusted_event_projection" }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT));
  });

  it.each([
    [
      "path snapshots",
      {
        pathOverrides: (stat, sample) =>
          sample === 2 ? { ctimeNs: stat.ctimeNs + 1n } : {},
      },
    ],
    [
      "handle snapshots",
      {
        handleOverrides: (stat, sample) =>
          sample === 2 ? { ctimeNs: stat.ctimeNs + 1n } : {},
      },
    ],
  ])("keeps %s exact on the affected runtime", (_label, overrides) => {
    const testFixture = fixture(projectedAuthorityIdentityRuntime(overrides));

    expect(() =>
      testFixture.store.create({ operationId: "event_snapshot_drift" }),
    ).toThrow(errorCode(CHECKPOINT_RESTORE_SAGA_ERROR_CODES.CORRUPT));
  });

  it.skipIf(process.platform !== "win32")(
    "combines projected event and HEAD lstat with the production trusted-parent authority",
    () => {
      const testFixture = fixture(
        projectedAuthorityIdentityRuntime({
          pathDevice: 0n,
          handleDevice: null,
          productionParent: true,
        }),
      );
      const saga = testFixture.store.create({
        operationId: "production_parent_projection",
      });

      expect(testFixture.store.load(saga.operationId).headHash).toBe(
        saga.headHash,
      );
    },
  );

  it("does not use POSIX directory fsync in the Windows durability branch", () => {
    const openSync = vi.fn((...args) => fs.openSync(...args));
    const runtimeFs = { ...fs, openSync };
    const testFixture = fixture({ fs: runtimeFs, platform: "win32" });
    testFixture.store.create({ operationId: "windows_compatible" });

    expect(openSync.mock.calls.some((call) => call[1] === "r")).toBe(false);
    expect(CHECKPOINT_RESTORE_SAGA_DURABILITY.windowsDirectory).toContain(
      "without-directory-fsync",
    );
  });
});
