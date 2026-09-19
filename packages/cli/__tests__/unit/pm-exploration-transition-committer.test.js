import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  PM_EXPLORATION_CLONE_RECOVERY_EVENT_SCHEMA,
  PM_EXPLORATION_SNAPSHOT_BOUND_TRANSITION_DURABILITY_ACK_SCHEMA,
  PM_EXPLORATION_SNAPSHOT_BOUND_TRANSITION_RECOVERY_SCHEMA,
  PM_EXPLORATION_FAILED_TRANSITION_SCHEMA,
  PM_EXPLORATION_SUCCESS_TRANSITION_SCHEMA,
  PM_EXPLORATION_TRANSITION_DURABILITY_ACK_SCHEMA,
  PM_EXPLORATION_TRANSITION_RECOVERY_REQUEST_SCHEMA,
  PM_EXPLORATION_TRANSITION_RECOVERY_SCHEMA,
  capturePmExplorationTransitionCommitter,
  createPmExplorationTransitionCommitter,
} from "../../src/lib/evolution/pm-exploration-transition-committer.js";
import { PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA } from "../../src/lib/evolution/pm-exploration-recovery-snapshot-store.js";

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
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

function sha(label) {
  return `sha256:${createHash("sha256").update(label).digest("hex")}`;
}

function seal(snapshot) {
  const core = {
    schema: "chainlesschain.desktop-pm-database-pre-run-seal/v1",
    databasePathDigest: sha("database-path"),
    databaseSnapshotDigest: sha(snapshot),
    databaseSnapshotBytes: 4096,
    snapshotMethod: "database-manager-backup",
  };
  return Object.freeze({
    ...core,
    sealDigest: hash(core.schema, core),
  });
}

function successEvidence(manifestDigest) {
  const preRunSeal = seal("before");
  const postRunSeal = seal("after");
  const transitionCore = {
    manifestDigest,
    executionReceiptDigest: sha("execution-receipt"),
    graderReceiptDigest: sha("grader-receipt"),
    preRunSealDigest: preRunSeal.sealDigest,
    postRunSealDigest: postRunSeal.sealDigest,
    previousStateTransitionDigest: null,
  };
  return {
    schema: PM_EXPLORATION_SUCCESS_TRANSITION_SCHEMA,
    manifestDigest,
    executionReceiptDigest: transitionCore.executionReceiptDigest,
    graderReceiptDigest: transitionCore.graderReceiptDigest,
    preRunSeal,
    postRunSeal,
    databaseChanged: true,
    previousStateTransitionDigest: null,
    stateTransitionDigest: hash(
      "chainlesschain.desktop-pm-database-transition/v1",
      transitionCore,
      false,
    ),
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
  };
}

function failureEvidence(manifestDigest) {
  const core = {
    schema: PM_EXPLORATION_FAILED_TRANSITION_SCHEMA,
    manifestDigest,
    preRunSeal: seal("before"),
    failureSeal: seal("failed"),
    databaseIdentityUnchanged: true,
    databaseChanged: true,
    previousStateTransitionDigest: null,
    failureClass: "execution-or-evidence-failed",
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
  };
  return {
    ...core,
    evidenceDigest: hash(PM_EXPLORATION_FAILED_TRANSITION_SCHEMA, core, false),
  };
}

function cloneRecoveryEvent(manifestDigest) {
  const core = {
    schema: PM_EXPLORATION_CLONE_RECOVERY_EVENT_SCHEMA,
    manifestDigest,
    cloneIdentityDigest: sha("clone-identity"),
    sourceTransitionRevision: 2,
    sourceFailureEvidenceDigest: sha("source-failure"),
    previousStateTransitionDigest: sha("previous-transition"),
    recoverySnapshotAckDigest: sha("recovery-snapshot-ack"),
    restoredDatabaseSealDigest: sha("restored-database-seal"),
    restoredWorkspaceSealDigest: sha("restored-workspace-seal"),
    switchReceiptDigest: sha("clone-switch-receipt"),
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
  };
  return {
    ...core,
    recoveryEventDigest: hash(PM_EXPLORATION_CLONE_RECOVERY_EVENT_SCHEMA, core),
  };
}

function acknowledgement(manifestDigest, evidenceDigest, transitionKind) {
  return {
    schema: PM_EXPLORATION_TRANSITION_DURABILITY_ACK_SCHEMA,
    authenticated: true,
    durable: true,
    readbackVerified: true,
    manifestDigest,
    evidenceDigest,
    transitionKind,
    ledgerEventDigest: sha(`ledger-${transitionKind}`),
    durabilityReceiptDigest: sha(`durability-${transitionKind}`),
    qualifiesForPromotion: false,
  };
}

function recoverySnapshotAcknowledgement(
  manifestDigest,
  evidence,
  transitionKind,
) {
  const selectedSeal =
    transitionKind === "success" ? evidence.postRunSeal : evidence.preRunSeal;
  const core = {
    schema: PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA,
    authenticated: true,
    durable: true,
    readbackVerified: true,
    manifestDigest,
    transitionKind,
    snapshotRole: transitionKind === "success" ? "post-run" : "pre-run",
    evidenceDigest:
      transitionKind === "success"
        ? evidence.stateTransitionDigest
        : evidence.evidenceDigest,
    sealDigest: selectedSeal.sealDigest,
    databaseSnapshotDigest: selectedSeal.databaseSnapshotDigest,
    databaseSnapshotBytes: selectedSeal.databaseSnapshotBytes,
    artifactDigest: sha(`snapshot-artifact-${transitionKind}`),
    artifactRef: `snapshot:${transitionKind}`,
    durabilityAuthorityId: "durability:test",
    durabilityReceiptDigest: sha(`snapshot-receipt-${transitionKind}`),
    qualifiesForPromotion: false,
  };
  return {
    ...core,
    snapshotAckDigest: hash(PM_EXPLORATION_RECOVERY_SNAPSHOT_ACK_SCHEMA, core),
  };
}

function recoveredTransition(
  manifestDigest,
  evidence,
  transitionKind,
  revision = 1,
) {
  const evidenceDigest =
    transitionKind === "success"
      ? evidence.stateTransitionDigest
      : transitionKind === "failure"
        ? evidence.evidenceDigest
        : evidence.recoveryEventDigest;
  return {
    schema: PM_EXPLORATION_TRANSITION_RECOVERY_SCHEMA,
    authenticated: true,
    durable: true,
    readbackVerified: true,
    manifestDigest,
    revision,
    transitionKind,
    evidenceDigest,
    evidence,
    ledgerHeadDigest: sha(`ledger-head-${revision}`),
    ledgerEventDigest: sha(`ledger-event-${revision}`),
    durabilityReceiptDigest: sha(`durability-${revision}`),
    qualifiesForPromotion: false,
  };
}

function recoveredSnapshotTransition(
  manifestDigest,
  evidence,
  transitionKind,
  revision = 1,
) {
  return {
    ...recoveredTransition(manifestDigest, evidence, transitionKind, revision),
    schema: PM_EXPLORATION_SNAPSHOT_BOUND_TRANSITION_RECOVERY_SCHEMA,
    recoverySnapshot: recoverySnapshotAcknowledgement(
      manifestDigest,
      evidence,
      transitionKind,
    ),
  };
}

function emptyRecovery(manifestDigest) {
  return {
    schema: PM_EXPLORATION_TRANSITION_RECOVERY_SCHEMA,
    authenticated: true,
    durable: true,
    readbackVerified: true,
    manifestDigest,
    revision: 0,
    transitionKind: null,
    evidenceDigest: null,
    evidence: null,
    ledgerHeadDigest: sha("empty-ledger-head"),
    ledgerEventDigest: null,
    durabilityReceiptDigest: null,
    qualifiesForPromotion: false,
  };
}

describe("PM exploration transition committer", () => {
  it("validates and durably commits a successful state transition", async () => {
    const manifestDigest = sha("manifest");
    const evidence = successEvidence(manifestDigest);
    const commit = vi.fn(async (verified) =>
      acknowledgement(
        manifestDigest,
        verified.stateTransitionDigest,
        "success",
      ),
    );
    const committer = createPmExplorationTransitionCommitter({
      manifestDigest,
      commit,
    });
    const port = capturePmExplorationTransitionCommitter(committer);

    await expect(port.commitTransition(evidence)).resolves.toEqual(
      acknowledgement(
        manifestDigest,
        evidence.stateTransitionDigest,
        "success",
      ),
    );
    expect(commit).toHaveBeenCalledOnce();
    expect(commit.mock.calls[0][0]).toEqual(evidence);
    expect(Object.isFrozen(commit.mock.calls[0][0])).toBe(true);
  });

  it("validates and durably commits failure-state evidence", async () => {
    const manifestDigest = sha("manifest");
    const evidence = failureEvidence(manifestDigest);
    const commit = vi.fn(async () =>
      acknowledgement(manifestDigest, evidence.evidenceDigest, "failure"),
    );
    const port = capturePmExplorationTransitionCommitter(
      createPmExplorationTransitionCommitter({ manifestDigest, commit }),
    );

    await expect(port.commitTransition(evidence)).resolves.toMatchObject({
      transitionKind: "failure",
      evidenceDigest: evidence.evidenceDigest,
      authenticated: true,
      durable: true,
      readbackVerified: true,
    });
    expect(commit).toHaveBeenCalledOnce();
  });

  it("commits and recovers a clone recovery event as the next authenticated head", async () => {
    const manifestDigest = sha("manifest");
    const evidence = cloneRecoveryEvent(manifestDigest);
    const commit = vi.fn(async () =>
      acknowledgement(manifestDigest, evidence.recoveryEventDigest, "recovery"),
    );
    const recover = vi.fn(async () =>
      recoveredTransition(manifestDigest, evidence, "recovery", 3),
    );
    const port = capturePmExplorationTransitionCommitter(
      createPmExplorationTransitionCommitter({
        manifestDigest,
        commit,
        recover,
      }),
    );

    await expect(port.commitTransition(evidence)).resolves.toMatchObject({
      transitionKind: "recovery",
      evidenceDigest: evidence.recoveryEventDigest,
      authenticated: true,
      durable: true,
      readbackVerified: true,
    });
    await expect(port.recoverTransition()).resolves.toMatchObject({
      revision: 3,
      transitionKind: "recovery",
      evidence,
    });
    await expect(port.commitTransition(evidence, {})).rejects.toThrow(
      "cannot retain another recovery snapshot",
    );
    expect(commit).toHaveBeenCalledOnce();

    await expect(
      port.commitTransition({
        ...evidence,
        restoredWorkspaceSealDigest: sha("substituted-workspace-seal"),
      }),
    ).rejects.toThrow("event digest mismatch");
    expect(commit).toHaveBeenCalledOnce();
  });

  it("binds a durable recovery snapshot into the transition acknowledgement", async () => {
    const manifestDigest = sha("manifest");
    const evidence = successEvidence(manifestDigest);
    const recoverySnapshot = recoverySnapshotAcknowledgement(
      manifestDigest,
      evidence,
      "success",
    );
    const commit = vi.fn(async (_verified, verifiedSnapshot) => ({
      ...acknowledgement(
        manifestDigest,
        evidence.stateTransitionDigest,
        "success",
      ),
      schema: PM_EXPLORATION_SNAPSHOT_BOUND_TRANSITION_DURABILITY_ACK_SCHEMA,
      recoverySnapshotAckDigest: verifiedSnapshot.snapshotAckDigest,
    }));
    const port = capturePmExplorationTransitionCommitter(
      createPmExplorationTransitionCommitter({ manifestDigest, commit }),
    );

    await expect(
      port.commitTransition(evidence, recoverySnapshot),
    ).resolves.toMatchObject({
      schema: PM_EXPLORATION_SNAPSHOT_BOUND_TRANSITION_DURABILITY_ACK_SCHEMA,
      recoverySnapshotAckDigest: recoverySnapshot.snapshotAckDigest,
      authenticated: true,
      durable: true,
      readbackVerified: true,
    });
    expect(commit).toHaveBeenCalledWith(evidence, recoverySnapshot);

    await expect(
      port.commitTransition(evidence, {
        ...recoverySnapshot,
        evidenceDigest: sha("substituted-evidence"),
      }),
    ).rejects.toThrow(/digest mismatch|evidenceDigest mismatch/u);
    expect(commit).toHaveBeenCalledOnce();

    const forgedCommit = vi.fn(async () => ({
      ...acknowledgement(
        manifestDigest,
        evidence.stateTransitionDigest,
        "success",
      ),
      schema: PM_EXPLORATION_SNAPSHOT_BOUND_TRANSITION_DURABILITY_ACK_SCHEMA,
      recoverySnapshotAckDigest: sha("substituted-snapshot-ack"),
    }));
    const forgedPort = capturePmExplorationTransitionCommitter(
      createPmExplorationTransitionCommitter({
        manifestDigest,
        commit: forgedCommit,
      }),
    );
    await expect(
      forgedPort.commitTransition(evidence, recoverySnapshot),
    ).rejects.toThrow("snapshot binding is invalid");
  });

  it("rejects tampering and accessors before invoking the deployment writer", async () => {
    const manifestDigest = sha("manifest");
    const commit = vi.fn();
    const port = capturePmExplorationTransitionCommitter(
      createPmExplorationTransitionCommitter({ manifestDigest, commit }),
    );
    const tampered = successEvidence(manifestDigest);
    tampered.databaseChanged = false;
    await expect(port.commitTransition(tampered)).rejects.toThrow(
      "databaseChanged is inconsistent",
    );

    const getter = vi.fn(() => PM_EXPLORATION_SUCCESS_TRANSITION_SCHEMA);
    const accessor = {};
    Object.defineProperty(accessor, "schema", {
      enumerable: true,
      get: getter,
    });
    await expect(port.commitTransition(accessor)).rejects.toThrow(
      "schema must be plain data",
    );
    expect(getter).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();

    const inputGetter = vi.fn(() => manifestDigest);
    const accessorInput = { commit };
    Object.defineProperty(accessorInput, "manifestDigest", {
      enumerable: true,
      get: inputGetter,
    });
    expect(() => createPmExplorationTransitionCommitter(accessorInput)).toThrow(
      "unexpected or accessor fields",
    );
    expect(inputGetter).not.toHaveBeenCalled();
  });

  it("rejects a substituted manifest or unauthenticated durability ack", async () => {
    const manifestDigest = sha("manifest");
    const evidence = failureEvidence(manifestDigest);
    const commit = vi.fn(async () => ({
      ...acknowledgement(manifestDigest, evidence.evidenceDigest, "failure"),
      readbackVerified: false,
    }));
    const port = capturePmExplorationTransitionCommitter(
      createPmExplorationTransitionCommitter({ manifestDigest, commit }),
    );

    await expect(
      port.commitTransition({
        ...evidence,
        manifestDigest: sha("substituted-manifest"),
      }),
    ).rejects.toThrow("fields are invalid");
    expect(commit).not.toHaveBeenCalled();

    await expect(port.commitTransition(evidence)).rejects.toThrow(
      "acknowledgement is invalid",
    );
    expect(commit).toHaveBeenCalledOnce();
  });

  it("recovers an authenticated empty, success or failure transition head", async () => {
    const manifestDigest = sha("manifest");
    const success = successEvidence(manifestDigest);
    const failure = failureEvidence(manifestDigest);
    const recover = vi
      .fn()
      .mockResolvedValueOnce(emptyRecovery(manifestDigest))
      .mockResolvedValueOnce(
        recoveredTransition(manifestDigest, success, "success", 1),
      )
      .mockResolvedValueOnce(
        recoveredTransition(manifestDigest, failure, "failure", 2),
      );
    const port = capturePmExplorationTransitionCommitter(
      createPmExplorationTransitionCommitter({
        manifestDigest,
        commit: vi.fn(),
        recover,
      }),
    );

    await expect(port.recoverTransition()).resolves.toEqual(
      emptyRecovery(manifestDigest),
    );
    await expect(port.recoverTransition()).resolves.toMatchObject({
      revision: 1,
      transitionKind: "success",
      evidence: success,
    });
    await expect(port.recoverTransition()).resolves.toMatchObject({
      revision: 2,
      transitionKind: "failure",
      evidence: failure,
    });
    expect(recover).toHaveBeenCalledTimes(3);
    expect(recover).toHaveBeenNthCalledWith(1, {
      schema: PM_EXPLORATION_TRANSITION_RECOVERY_REQUEST_SCHEMA,
      manifestDigest,
    });
  });

  it("recovers and verifies the snapshot acknowledgement bound to a v2 head", async () => {
    const manifestDigest = sha("manifest");
    const failure = failureEvidence(manifestDigest);
    const recovered = recoveredSnapshotTransition(
      manifestDigest,
      failure,
      "failure",
    );
    const recover = vi.fn(async () => recovered);
    const port = capturePmExplorationTransitionCommitter(
      createPmExplorationTransitionCommitter({
        manifestDigest,
        commit: vi.fn(),
        recover,
      }),
    );

    await expect(port.recoverTransition()).resolves.toMatchObject({
      schema: PM_EXPLORATION_SNAPSHOT_BOUND_TRANSITION_RECOVERY_SCHEMA,
      transitionKind: "failure",
      recoverySnapshot: recovered.recoverySnapshot,
    });

    const substituted = {
      ...recovered,
      recoverySnapshot: {
        ...recovered.recoverySnapshot,
        evidenceDigest: sha("substituted-evidence"),
      },
    };
    const forgedPort = capturePmExplorationTransitionCommitter(
      createPmExplorationTransitionCommitter({
        manifestDigest,
        commit: vi.fn(),
        recover: vi.fn(async () => substituted),
      }),
    );
    await expect(forgedPort.recoverTransition()).rejects.toThrow();
  });

  it("rejects substituted recovery evidence and accessor-backed recovery input", async () => {
    const manifestDigest = sha("manifest");
    const evidence = successEvidence(manifestDigest);
    const recover = vi.fn(async () => ({
      ...recoveredTransition(manifestDigest, evidence, "success"),
      evidenceDigest: sha("substituted-evidence"),
    }));
    const port = capturePmExplorationTransitionCommitter(
      createPmExplorationTransitionCommitter({
        manifestDigest,
        commit: vi.fn(),
        recover,
      }),
    );
    await expect(port.recoverTransition()).rejects.toThrow(
      "evidence binding is invalid",
    );

    const getter = vi.fn(() => vi.fn());
    const accessorInput = { manifestDigest, commit: vi.fn() };
    Object.defineProperty(accessorInput, "recover", {
      enumerable: true,
      get: getter,
    });
    expect(() => createPmExplorationTransitionCommitter(accessorInput)).toThrow(
      "unexpected or accessor fields",
    );
    expect(getter).not.toHaveBeenCalled();

    const descriptorTrap = vi.fn(() => {
      throw new Error("must not inspect proxy descriptors");
    });
    const proxyInput = new Proxy(
      {},
      { getOwnPropertyDescriptor: descriptorTrap },
    );
    expect(() => createPmExplorationTransitionCommitter(proxyInput)).toThrow(
      "must be a plain object",
    );
    expect(descriptorTrap).not.toHaveBeenCalled();
  });
});
