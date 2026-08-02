import fs from "node:fs";
import process from "node:process";
import {
  computeCheckpointRestoreDigest,
  runCheckpointRestoreOperation,
} from "../../src/lib/checkpoint-restore-orchestrator.js";
import { CheckpointRestoreSagaStore } from "../../src/lib/checkpoint-restore-saga.js";
import { withWorkspaceLockSync } from "../../src/lib/process-execution-broker/workspace-transaction.js";
import * as copyCheckpoints from "../../src/lib/file-checkpoint.js";
import * as gitCheckpoints from "../../src/lib/checkpoint-store.js";

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

function publishMarker(markerPath, value) {
  const temporaryPath = `${markerPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, markerPath);
}

function preview(config, expectedIdentity = undefined) {
  if (config.engine === "copy") {
    const result = copyCheckpoints.diffCheckpoint(config.checkpointId, {
      root: config.checkpointStoreRoot,
      cwd: config.workspaceRoot,
      expectedIdentity,
    });
    return {
      checkpointIdentity: result.checkpointIdentity,
      modified: result.modified,
      added: [],
      deleted: result.deleted,
      workspaceBinding: result.workspaceBinding,
    };
  }

  return gitCheckpoints.statusAgainst(
    config.workspaceRoot,
    config.checkpointId,
    {
      session: config.checkpointNamespace,
      expectedIdentity,
    },
  );
}

function restore(config, expectedIdentity, expectedWorkspaceBinding, hooks) {
  if (config.engine === "copy") {
    const result = copyCheckpoints.restoreCheckpoint(config.checkpointId, {
      root: config.checkpointStoreRoot,
      cwd: config.workspaceRoot,
      expectedIdentity,
      expectedWorkspaceBinding,
      ...hooks,
    });
    return {
      engine: "copy",
      restored: result.restored,
      deletedPaths: result.deletedPaths,
      safetyId: result.safetyId,
      safetyIdentity: result.safetyIdentity,
      safetyPlanIdentity: result.safetyPlanIdentity,
      safetyCoverage: result.safetyCoverage,
    };
  }

  const result = gitCheckpoints.rewindTo(
    config.workspaceRoot,
    config.checkpointId,
    {
      session: config.checkpointNamespace,
      expectedIdentity,
      expectedWorkspaceBinding,
      ...hooks,
    },
  );
  return {
    engine: "git",
    restored: result.restored,
    modified: result.modified,
    deleted: result.deleted,
    recreated: result.recreated,
    safetyId: result.safetyId,
    safetyIdentity: result.safetyIdentity,
    safetyPlanIdentity: result.safetyPlanIdentity,
    safetyCoverage: result.safetyCoverage,
  };
}

function buildPlan(config, current) {
  const targetCount =
    current.modified.length + current.added.length + current.deleted.length;
  return {
    restoreKind: config.engine,
    restoreSurface: "direct",
    checkpointId: config.checkpointId,
    checkpointIdentity: current.checkpointIdentity,
    checkpointNamespace: config.checkpointNamespace,
    workspaceRoot: config.workspaceRoot,
    workspaceBinding: current.workspaceBinding,
    targetCount,
    confirmationDigest: computeCheckpointRestoreDigest(
      "cc-checkpoint-restore-kill-restart-fixture-v1",
      {
        authorization: "integration-fixture",
        restoreKind: config.engine,
        checkpointId: config.checkpointId,
        checkpointIdentity: current.checkpointIdentity,
        checkpointNamespace: config.checkpointNamespace,
        workspaceBinding: current.workspaceBinding,
        targetCount,
      },
    ),
  };
}

function decodeConfiguration(encoded) {
  if (!encoded)
    throw new Error("checkpoint restore worker configuration missing");
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

try {
  const config = decodeConfiguration(process.argv[2]);
  const store = new CheckpointRestoreSagaStore({
    workspaceRoot: config.workspaceRoot,
    stateDir: config.sagaStateDir,
    secureDirectory,
    secureAuthorityPaths,
  });
  const initialPlan = buildPlan(
    config,
    preview(config, config.checkpointIdentity),
  );
  const holdState = new Int32Array(new SharedArrayBuffer(4));

  runCheckpointRestoreOperation({
    operationId: config.operationId,
    plan: initialPlan,
    revalidate: () =>
      buildPlan(config, preview(config, initialPlan.checkpointIdentity)),
    restore: ({ expectedIdentity, expectedWorkspaceBinding, hooks }) =>
      restore(config, expectedIdentity, expectedWorkspaceBinding, hooks),
    dependencies: {
      createSagaStore: () => store,
      withWorkspaceLockSync: (options, callback) =>
        withWorkspaceLockSync(
          {
            ...options,
            lockDir: config.lockDir,
            allowNonCanonicalLockDirForTests: true,
            timeoutMs: 10_000,
            retryMs: 5,
          },
          (lease) => {
            const result = callback(lease);
            const completed = store.load(config.operationId);
            if (!completed.terminal || completed.phase !== "completed") {
              throw new Error(
                `worker reached hold boundary at ${completed.phase}, not completed`,
              );
            }
            publishMarker(config.markerPath, {
              ready: true,
              blocked: true,
              engine: config.engine,
              operationId: config.operationId,
              phase: completed.phase,
              seq: completed.seq,
              headHash: completed.headHash,
              pid: process.pid,
            });
            if (typeof process.send === "function") {
              process.send({
                type: "checkpoint-restore-completed-lock-held",
                operationId: config.operationId,
                pid: process.pid,
              });
            }
            Atomics.wait(holdState, 0, 0, config.holdTimeoutMs || 120_000);
            return result;
          },
        ),
    },
  });
} catch (error) {
  const message = error?.stack || error?.message || String(error);
  if (typeof process.send === "function") {
    process.send({ type: "checkpoint-restore-worker-error", message });
  }
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
