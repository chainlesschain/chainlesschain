import { createHash } from "node:crypto";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";
const {
  inspectDesktopPmExplorationCloneRecoveryHost,
  inspectDesktopPmExplorationExecutionHost,
  loadDesktopEvolutionDependencies,
  recoverDesktopPmExplorationClone,
} = require("../desktop-evolution-deployment");
const {
  CLONE_RECOVERY_CLOSE_ACK_SCHEMA,
  CLONE_RECOVERY_CLOSE_REQUEST_SCHEMA,
  CLONE_RECOVERY_COMMIT_ACK_SCHEMA,
  CLONE_RECOVERY_FINALIZE_ACK_SCHEMA,
  CLONE_RECOVERY_FINALIZE_REQUEST_SCHEMA,
  CLONE_RECOVERY_LEASE_SCHEMA,
  CLONE_RECOVERY_REOPEN_ACK_SCHEMA,
  CLONE_RECOVERY_REOPEN_REQUEST_SCHEMA,
  CLONE_RECOVERY_RESULT_SCHEMA,
  CLONE_RECOVERY_SWITCH_ACK_SCHEMA,
  CLONE_RECOVERY_SWITCH_REQUEST_SCHEMA,
  captureDesktopPmCloneRecoveryController,
  createDesktopPmCloneRecoveryController,
} = require("../desktop-pm-clone-recovery-controller");
const {
  RECOVERY_SNAPSHOT_CAPTURE_SCHEMA,
  createDesktopPmPreRunSealValue,
} = require("../desktop-pm-pre-run-seal");
const {
  WORKSPACE_SEAL_SCHEMA,
  WORKSPACE_SNAPSHOT_CAPTURE_SCHEMA,
  WORKSPACE_SNAPSHOT_DOMAIN,
} = require("../desktop-pm-workspace-snapshot");

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(domain, value, canonicalize = true) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(canonicalize ? canonical(value) : JSON.stringify(value))
    .digest("hex")}`;
}

function hashBytes(domain, value) {
  return `sha256:${createHash("sha256")
    .update(domain)
    .update("\0")
    .update(value)
    .digest("hex")}`;
}

function sha(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function fixture({ mainDatabaseIsClone = false } = {}) {
  const manifestDigest = sha("manifest");
  const cloneIdentityDigest = sha("clone-identity");
  const databaseBytes = Buffer.from("isolated-clone-database");
  const databasePathDigest = sha("isolated-clone-database-path");
  const databaseSeal = createDesktopPmPreRunSealValue({
    databasePathDigest,
    databaseSnapshotDigest: hashBytes(
      "chainlesschain.desktop-pm-database-snapshot/v1",
      databaseBytes,
    ),
    databaseSnapshotBytes: databaseBytes.byteLength,
  });
  const workspaceBytes = Buffer.from("isolated-clone-workspace");
  const workspaceCore = {
    schema: WORKSPACE_SEAL_SCHEMA,
    manifestDigest,
    workspaceRootDigest: sha("workspace-root"),
    capturePolicyDigest: sha("workspace-policy"),
    workspaceSnapshotDigest: hashBytes(
      WORKSPACE_SNAPSHOT_DOMAIN,
      workspaceBytes,
    ),
    workspaceSnapshotBytes: workspaceBytes.byteLength,
    workspaceFileCount: 1,
    snapshotMethod: "bounded-canonical-workspace-archive",
  };
  const workspaceSeal = Object.freeze({
    ...workspaceCore,
    sealDigest: hash(WORKSPACE_SEAL_SCHEMA, workspaceCore),
  });
  const failureCore = {
    schema: "chainlesschain.desktop-pm-failed-execution-evidence/v1",
    manifestDigest,
    preRunSeal: databaseSeal,
    failureSeal: databaseSeal,
    databaseIdentityUnchanged: true,
    databaseChanged: false,
    previousStateTransitionDigest: sha("previous-transition"),
    failureClass: "execution-or-evidence-failed",
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
  };
  const evidence = Object.freeze({
    ...failureCore,
    evidenceDigest: hash(failureCore.schema, failureCore, false),
  });
  const acknowledgementCore = {
    schema: "chainlesschain.pm-exploration-recovery-snapshot-ack/v2",
    authenticated: true,
    durable: true,
    readbackVerified: true,
    manifestDigest,
    transitionKind: "failure",
    snapshotRole: "pre-run",
    evidenceDigest: evidence.evidenceDigest,
    sealDigest: databaseSeal.sealDigest,
    databaseSnapshotDigest: databaseSeal.databaseSnapshotDigest,
    databaseSnapshotBytes: databaseSeal.databaseSnapshotBytes,
    workspaceSealDigest: workspaceSeal.sealDigest,
    workspaceRootDigest: workspaceSeal.workspaceRootDigest,
    capturePolicyDigest: workspaceSeal.capturePolicyDigest,
    workspaceSnapshotDigest: workspaceSeal.workspaceSnapshotDigest,
    workspaceSnapshotBytes: workspaceSeal.workspaceSnapshotBytes,
    workspaceFileCount: workspaceSeal.workspaceFileCount,
    artifactDigest: sha("artifact"),
    artifactRef: "recovery:test",
    durabilityAuthorityId: "durability:test",
    durabilityReceiptDigest: sha("retention-receipt"),
    qualifiesForPromotion: false,
  };
  const recoverySnapshot = Object.freeze({
    ...acknowledgementCore,
    snapshotAckDigest: hash(acknowledgementCore.schema, acknowledgementCore),
  });
  const resolution = Object.freeze({
    schema: "chainlesschain.pm-exploration-recovery-snapshot-resolution/v1",
    authenticated: true,
    durable: true,
    readbackVerified: true,
    manifestDigest,
    acknowledgement: recoverySnapshot,
    databaseSeal,
    databaseBytes,
    workspaceSeal,
    workspaceBytes,
    durabilityReceiptDigest: sha("resolution-receipt"),
    qualifiesForPromotion: false,
  });
  const leaseDigest = sha("exclusive-lease");
  const switchReceiptDigest = sha("switch-receipt");
  const calls = [];
  const ports = {
    resolveTransitionSnapshot: vi.fn(() => {
      calls.push("resolve");
      return resolution;
    }),
    acquireExclusiveClone: vi.fn(async (request) => {
      calls.push("acquire");
      return {
        schema: CLONE_RECOVERY_LEASE_SCHEMA,
        manifestDigest,
        cloneIdentityDigest,
        applicationMainDatabasePathDigest:
          request.applicationMainDatabasePathDigest,
        databasePathDigest,
        workspaceRootDigest: workspaceSeal.workspaceRootDigest,
        leaseDigest,
        exclusive: true,
        mainDatabaseExcluded: true,
      };
    }),
    closeClone: vi.fn(async () => {
      calls.push("close");
      return {
        schema: CLONE_RECOVERY_CLOSE_ACK_SCHEMA,
        manifestDigest,
        cloneIdentityDigest,
        leaseDigest,
        connectionClosed: true,
        writeHandlesDrained: true,
      };
    }),
    replaceCloneRecoverySet: vi.fn(async () => {
      calls.push("switch");
      return {
        schema: CLONE_RECOVERY_SWITCH_ACK_SCHEMA,
        manifestDigest,
        cloneIdentityDigest,
        leaseDigest,
        databasePathDigest,
        workspaceRootDigest: workspaceSeal.workspaceRootDigest,
        switchReceiptDigest,
        transactionallyRecoverable: true,
        mainDatabaseUntouched: true,
      };
    }),
    reopenClone: vi.fn(async () => {
      calls.push("reopen");
      return {
        schema: CLONE_RECOVERY_REOPEN_ACK_SCHEMA,
        manifestDigest,
        cloneIdentityDigest,
        leaseDigest,
        databasePathDigest,
        workspaceRootDigest: workspaceSeal.workspaceRootDigest,
        connectionOpened: true,
      };
    }),
    captureDatabaseSnapshot: vi.fn(async () => {
      calls.push("capture-database");
      return {
        schema: RECOVERY_SNAPSHOT_CAPTURE_SCHEMA,
        seal: databaseSeal,
        bytes: Buffer.from(databaseBytes),
      };
    }),
    captureWorkspaceSnapshot: vi.fn(async () => {
      calls.push("capture-workspace");
      return {
        schema: WORKSPACE_SNAPSHOT_CAPTURE_SCHEMA,
        seal: workspaceSeal,
        bytes: Buffer.from(workspaceBytes),
      };
    }),
    commitRecoveryEvent: vi.fn(async (event) => {
      calls.push("commit");
      return {
        schema: CLONE_RECOVERY_COMMIT_ACK_SCHEMA,
        manifestDigest,
        recoveryEventDigest: event.recoveryEventDigest,
        revision: 8,
        authenticated: true,
        durable: true,
        readbackVerified: true,
        ledgerEventDigest: sha("recovery-ledger-event"),
        durabilityReceiptDigest: sha("recovery-durability"),
        qualifiesForPromotion: false,
      };
    }),
    finalizeExclusiveClone: vi.fn(async (request) => {
      calls.push("finalize");
      return {
        schema: CLONE_RECOVERY_FINALIZE_ACK_SCHEMA,
        manifestDigest,
        cloneIdentityDigest,
        leaseDigest,
        recoveryEventDigest: request.recoveryEventDigest,
        released: true,
      };
    }),
  };
  const controller = createDesktopPmCloneRecoveryController({
    manifestDigest,
    applicationMainDatabasePathDigest: mainDatabaseIsClone
      ? databasePathDigest
      : sha("application-main-database-path"),
    cloneIdentityDigest,
    ...ports,
  });
  return {
    calls,
    controller,
    evidence,
    manifestDigest,
    ports,
    recoverySnapshot,
    resolution,
  };
}

describe("Desktop PM clone recovery controller", () => {
  it("recovers only through an exclusive transactional clone switch and double-seal readback", async () => {
    const value = fixture();
    const port = captureDesktopPmCloneRecoveryController(value.controller);

    await expect(
      port.recoverFailedClone({
        revision: 7,
        evidence: value.evidence,
        recoverySnapshot: value.recoverySnapshot,
      }),
    ).resolves.toMatchObject({
      schema: CLONE_RECOVERY_RESULT_SCHEMA,
      manifestDigest: value.manifestDigest,
      sourceTransitionRevision: 7,
      recoveryRevision: 8,
      authenticated: true,
      durable: true,
      readbackVerified: true,
      transactionallyRecoverable: true,
      mainDatabaseUntouched: true,
      qualifiesForPromotion: false,
    });
    expect(value.calls).toEqual([
      "resolve",
      "acquire",
      "close",
      "switch",
      "reopen",
      "capture-database",
      "capture-workspace",
      "commit",
      "finalize",
    ]);
    expect(value.ports.closeClone.mock.calls[0][0].schema).toBe(
      CLONE_RECOVERY_CLOSE_REQUEST_SCHEMA,
    );
    expect(value.ports.replaceCloneRecoverySet.mock.calls[0][0].schema).toBe(
      CLONE_RECOVERY_SWITCH_REQUEST_SCHEMA,
    );
    expect(value.ports.reopenClone.mock.calls[0][0].schema).toBe(
      CLONE_RECOVERY_REOPEN_REQUEST_SCHEMA,
    );
    expect(value.ports.finalizeExclusiveClone.mock.calls[0][0].schema).toBe(
      CLONE_RECOVERY_FINALIZE_REQUEST_SCHEMA,
    );
    expect(port.inspect()).toEqual({
      status: "recovered",
      qualifiesForPromotion: false,
    });
    await expect(
      port.recoverFailedClone({
        revision: 7,
        evidence: value.evidence,
        recoverySnapshot: value.recoverySnapshot,
      }),
    ).rejects.toThrow("not reusable");
  });

  it("refuses a recovery target that resolves to the application main database", async () => {
    const value = fixture({ mainDatabaseIsClone: true });
    const port = captureDesktopPmCloneRecoveryController(value.controller);

    await expect(
      port.recoverFailedClone({
        revision: 7,
        evidence: value.evidence,
        recoverySnapshot: value.recoverySnapshot,
      }),
    ).rejects.toThrow("application main database");
    expect(value.ports.acquireExclusiveClone).not.toHaveBeenCalled();
    expect(port.inspect().status).toBe("ready");
  });

  it("fails closed and poisons the controller without a transactional switch proof", async () => {
    const value = fixture();
    value.ports.replaceCloneRecoverySet.mockImplementationOnce(async () => ({
      schema: CLONE_RECOVERY_SWITCH_ACK_SCHEMA,
      manifestDigest: value.manifestDigest,
      cloneIdentityDigest: sha("clone-identity"),
      leaseDigest: sha("exclusive-lease"),
      databasePathDigest: value.evidence.preRunSeal.databasePathDigest,
      workspaceRootDigest: value.resolution.workspaceSeal.workspaceRootDigest,
      switchReceiptDigest: sha("switch-receipt"),
      transactionallyRecoverable: false,
      mainDatabaseUntouched: true,
    }));
    const port = captureDesktopPmCloneRecoveryController(value.controller);

    await expect(
      port.recoverFailedClone({
        revision: 7,
        evidence: value.evidence,
        recoverySnapshot: value.recoverySnapshot,
      }),
    ).rejects.toThrow("switch acknowledgement is invalid");
    expect(value.ports.reopenClone).not.toHaveBeenCalled();
    expect(value.ports.commitRecoveryEvent).not.toHaveBeenCalled();
    expect(value.ports.finalizeExclusiveClone).not.toHaveBeenCalled();
    expect(port.inspect().status).toBe("poisoned");
  });

  it("does not commit when either restored seal differs from retained media", async () => {
    const value = fixture();
    value.ports.captureDatabaseSnapshot.mockImplementationOnce(async () => {
      const bytes = Buffer.from("substituted-database");
      return {
        schema: RECOVERY_SNAPSHOT_CAPTURE_SCHEMA,
        seal: createDesktopPmPreRunSealValue({
          databasePathDigest: value.evidence.preRunSeal.databasePathDigest,
          databaseSnapshotDigest: hashBytes(
            "chainlesschain.desktop-pm-database-snapshot/v1",
            bytes,
          ),
          databaseSnapshotBytes: bytes.byteLength,
        }),
        bytes,
      };
    });
    const port = captureDesktopPmCloneRecoveryController(value.controller);

    await expect(
      port.recoverFailedClone({
        revision: 7,
        evidence: value.evidence,
        recoverySnapshot: value.recoverySnapshot,
      }),
    ).rejects.toThrow("differs from signed manifest");
    expect(value.ports.commitRecoveryEvent).not.toHaveBeenCalled();
    expect(value.ports.finalizeExclusiveClone).not.toHaveBeenCalled();
    expect(port.inspect().status).toBe("poisoned");
  });

  it("clears execution taint only after the bound controller returns durable recovery", async () => {
    const value = fixture();
    const rawHost = Object.freeze({});
    const rawCommitter = Object.freeze({});
    const rawSnapshotStore = Object.freeze({});
    const transitionRecovery = Object.freeze({
      schema: "chainlesschain.pm-exploration-transition-recovery/v2",
      authenticated: true,
      durable: true,
      readbackVerified: true,
      manifestDigest: value.manifestDigest,
      revision: 7,
      transitionKind: "failure",
      evidenceDigest: value.evidence.evidenceDigest,
      evidence: value.evidence,
      recoverySnapshot: value.recoverySnapshot,
      ledgerHeadDigest: sha("failed-ledger-head"),
      ledgerEventDigest: sha("failed-ledger-event"),
      durabilityReceiptDigest: sha("failed-ledger-durability"),
      qualifiesForPromotion: false,
    });
    const dependencies = await loadDesktopEvolutionDependencies({
      importLoader: async () => ({
        loadEvolutionDeploymentCommandDependencies: async (
          _command,
          options,
        ) => ({
          pmExplorationExecutionHost: rawHost,
          pmExplorationTransitionCommitter: rawCommitter,
          pmExplorationRecoverySnapshotStore: rawSnapshotStore,
          pmExplorationWorkspaceSnapshotter:
            options.additionalFactories.createDesktopPmWorkspaceSnapshotter({
              manifestDigest: value.manifestDigest,
              workspaceRoot: path.resolve("."),
              includePaths: ["package.json"],
              maxFileCount: 10,
              maxFileBytes: 1024 * 1024,
              maxSnapshotBytes: 1024 * 1024,
            }),
          pmExplorationCloneRecoveryController: value.controller,
        }),
      }),
      importPmExplorationExecutionModule: async () => ({
        isPmExplorationExecutionHost: (candidate) => candidate === rawHost,
        inspectPmExplorationExecutionHost: () => ({
          manifestDigest: value.manifestDigest,
          preRunSealDigest: value.evidence.preRunSeal.sealDigest,
        }),
        executePmExplorationRound: vi.fn(),
        mergePmExplorationBranches: vi.fn(),
        evaluatePmExplorationMemory: vi.fn(),
      }),
      importPmExplorationTransitionModule: async () => ({
        capturePmExplorationTransitionCommitter: () => ({
          manifestDigest: value.manifestDigest,
          commitTransition: vi.fn(),
          recoverTransition: vi.fn(async () => transitionRecovery),
        }),
      }),
      importPmExplorationRecoverySnapshotModule: async () => ({
        capturePmExplorationRecoverySnapshotStore: (candidate) => {
          if (candidate !== rawSnapshotStore) {
            throw new TypeError("unbranded");
          }
          return {
            manifestDigest: value.manifestDigest,
            retainTransitionSnapshot: vi.fn(),
            resolveTransitionSnapshot: vi.fn(() => value.resolution),
          };
        },
      }),
      capturePmPreRunSeal: vi.fn(),
    });
    const executionHost = dependencies.desktopPmExplorationExecutionHost;
    const recoveryHost = dependencies.desktopPmExplorationCloneRecoveryHost;

    expect(
      inspectDesktopPmExplorationExecutionHost(executionHost),
    ).toMatchObject({ tainted: true, transitionRecoveryStatus: "failure" });
    await expect(
      recoverDesktopPmExplorationClone(recoveryHost),
    ).resolves.toMatchObject({ recoveryRevision: 8, durable: true });
    expect(
      inspectDesktopPmExplorationExecutionHost(executionHost),
    ).toMatchObject({
      tainted: false,
      requiresRecovery: false,
      transitionRecoveryStatus: "recovery",
      transitionRecoveryRevision: 8,
    });
    expect(inspectDesktopPmExplorationCloneRecoveryHost(recoveryHost)).toEqual({
      configured: true,
      recoverableFailure: false,
      controllerStatus: "recovered",
      qualifiesForPromotion: false,
    });
  });
});
