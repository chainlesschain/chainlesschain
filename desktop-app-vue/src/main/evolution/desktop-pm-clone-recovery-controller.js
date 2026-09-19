"use strict";

const { createHash } = require("node:crypto");
const { types } = require("node:util");
const {
  RECOVERY_SNAPSHOT_CAPTURE_SCHEMA,
  verifyDesktopPmPreRunSealValue,
} = require("./desktop-pm-pre-run-seal");
const {
  WORKSPACE_SNAPSHOT_CAPTURE_SCHEMA,
  verifyDesktopPmWorkspaceSnapshotCapture,
} = require("./desktop-pm-workspace-snapshot");

const FAILED_TRANSITION_SCHEMA =
  "chainlesschain.desktop-pm-failed-execution-evidence/v1";
const RECOVERY_SET_ACK_SCHEMA =
  "chainlesschain.pm-exploration-recovery-snapshot-ack/v2";
const RECOVERY_SET_RESOLUTION_SCHEMA =
  "chainlesschain.pm-exploration-recovery-snapshot-resolution/v1";
const CLONE_RECOVERY_LEASE_REQUEST_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-lease-request/v1";
const CLONE_RECOVERY_LEASE_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-lease/v1";
const CLONE_RECOVERY_CLOSE_REQUEST_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-close-request/v1";
const CLONE_RECOVERY_CLOSE_ACK_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-close-ack/v1";
const CLONE_RECOVERY_SWITCH_REQUEST_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-switch-request/v1";
const CLONE_RECOVERY_SWITCH_ACK_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-switch-ack/v1";
const CLONE_RECOVERY_REOPEN_REQUEST_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-reopen-request/v1";
const CLONE_RECOVERY_REOPEN_ACK_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-reopen-ack/v1";
const CLONE_RECOVERY_CAPTURE_REQUEST_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-capture-request/v1";
const CLONE_RECOVERY_EVENT_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-event/v1";
const CLONE_RECOVERY_COMMIT_ACK_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-commit-ack/v1";
const CLONE_RECOVERY_FINALIZE_REQUEST_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-finalize-request/v1";
const CLONE_RECOVERY_FINALIZE_ACK_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-finalize-ack/v1";
const CLONE_RECOVERY_RESULT_SCHEMA =
  "chainlesschain.desktop-pm-clone-recovery-result/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CONTROLLERS = new WeakMap();

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return !descriptor?.enumerable || !("value" in descriptor);
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function direct(value, label) {
  if (typeof value !== "function" || types.isProxy(value)) {
    throw new TypeError(`${label} must be a direct function`);
  }
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new TypeError(`${label} must be a sha256 digest`);
  }
  return value;
}

function optionalDigest(value, label) {
  return value === null ? null : digest(value, label);
}

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

function failedEvidence(value, manifestDigest) {
  exact(
    value,
    [
      "schema",
      "manifestDigest",
      "preRunSeal",
      "failureSeal",
      "databaseIdentityUnchanged",
      "databaseChanged",
      "previousStateTransitionDigest",
      "failureClass",
      "authenticated",
      "durable",
      "qualifiesForPromotion",
      "evidenceDigest",
    ],
    "Desktop PM failed transition evidence",
  );
  if (
    value.schema !== FAILED_TRANSITION_SCHEMA ||
    value.manifestDigest !== manifestDigest ||
    value.failureClass !== "execution-or-evidence-failed" ||
    value.authenticated !== false ||
    value.durable !== false ||
    value.qualifiesForPromotion !== false
  ) {
    throw new Error("Desktop PM failed transition evidence is invalid");
  }
  const preRunSeal = verifyDesktopPmPreRunSealValue(value.preRunSeal);
  const failureSeal =
    value.failureSeal === null
      ? null
      : verifyDesktopPmPreRunSealValue(value.failureSeal);
  const databaseIdentityUnchanged =
    failureSeal === null
      ? null
      : failureSeal.databasePathDigest === preRunSeal.databasePathDigest;
  const databaseChanged =
    failureSeal === null || databaseIdentityUnchanged !== true
      ? null
      : failureSeal.databaseSnapshotDigest !==
        preRunSeal.databaseSnapshotDigest;
  if (
    value.databaseIdentityUnchanged !== databaseIdentityUnchanged ||
    value.databaseChanged !== databaseChanged
  ) {
    throw new Error("Desktop PM failed transition database state is invalid");
  }
  const core = {
    schema: value.schema,
    manifestDigest,
    preRunSeal,
    failureSeal,
    databaseIdentityUnchanged,
    databaseChanged,
    previousStateTransitionDigest: optionalDigest(
      value.previousStateTransitionDigest,
      "previousStateTransitionDigest",
    ),
    failureClass: value.failureClass,
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
  };
  const evidenceDigest = digest(value.evidenceDigest, "evidenceDigest");
  if (evidenceDigest !== hash(FAILED_TRANSITION_SCHEMA, core, false)) {
    throw new Error("Desktop PM failed transition evidence digest mismatch");
  }
  return Object.freeze({ ...core, evidenceDigest });
}

function recoveryInput(value, manifestDigest) {
  exact(
    value,
    ["revision", "evidence", "recoverySnapshot"],
    "Desktop PM clone recovery input",
  );
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) {
    throw new TypeError("Desktop PM clone recovery revision is invalid");
  }
  const evidence = failedEvidence(value.evidence, manifestDigest);
  const recoverySnapshot = recoverySnapshotAcknowledgement(
    value.recoverySnapshot,
    manifestDigest,
    evidence,
  );
  return Object.freeze({
    revision: value.revision,
    evidence,
    recoverySnapshot,
  });
}

function recoverySnapshotAcknowledgement(value, manifestDigest, evidence) {
  const keys = [
    "schema",
    "authenticated",
    "durable",
    "readbackVerified",
    "manifestDigest",
    "transitionKind",
    "snapshotRole",
    "evidenceDigest",
    "sealDigest",
    "databaseSnapshotDigest",
    "databaseSnapshotBytes",
    "workspaceSealDigest",
    "workspaceRootDigest",
    "capturePolicyDigest",
    "workspaceSnapshotDigest",
    "workspaceSnapshotBytes",
    "workspaceFileCount",
    "artifactDigest",
    "artifactRef",
    "durabilityAuthorityId",
    "durabilityReceiptDigest",
    "qualifiesForPromotion",
    "snapshotAckDigest",
  ];
  exact(value, keys, "Desktop PM recovery-set acknowledgement");
  const core = {};
  for (const key of keys.slice(0, -1)) {
    core[key] = value[key];
  }
  if (
    core.schema !== RECOVERY_SET_ACK_SCHEMA ||
    core.authenticated !== true ||
    core.durable !== true ||
    core.readbackVerified !== true ||
    core.manifestDigest !== manifestDigest ||
    core.transitionKind !== "failure" ||
    core.snapshotRole !== "pre-run" ||
    core.evidenceDigest !== evidence.evidenceDigest ||
    core.sealDigest !== evidence.preRunSeal.sealDigest ||
    core.databaseSnapshotDigest !==
      evidence.preRunSeal.databaseSnapshotDigest ||
    core.databaseSnapshotBytes !== evidence.preRunSeal.databaseSnapshotBytes ||
    core.qualifiesForPromotion !== false ||
    !Number.isSafeInteger(core.workspaceSnapshotBytes) ||
    core.workspaceSnapshotBytes < 1 ||
    !Number.isSafeInteger(core.workspaceFileCount) ||
    core.workspaceFileCount < 0 ||
    typeof core.artifactRef !== "string" ||
    core.artifactRef.length < 1 ||
    typeof core.durabilityAuthorityId !== "string" ||
    core.durabilityAuthorityId.length < 1
  ) {
    throw new Error("Desktop PM recovery-set acknowledgement is unbound");
  }
  for (const key of [
    "manifestDigest",
    "evidenceDigest",
    "sealDigest",
    "databaseSnapshotDigest",
    "workspaceSealDigest",
    "workspaceRootDigest",
    "capturePolicyDigest",
    "workspaceSnapshotDigest",
    "artifactDigest",
    "durabilityReceiptDigest",
  ]) {
    digest(core[key], key);
  }
  const snapshotAckDigest = digest(
    value.snapshotAckDigest,
    "snapshotAckDigest",
  );
  if (snapshotAckDigest !== hash(RECOVERY_SET_ACK_SCHEMA, core)) {
    throw new Error("Desktop PM recovery-set acknowledgement digest mismatch");
  }
  return Object.freeze({ ...core, snapshotAckDigest });
}

function recoveryResolution(value, binding) {
  exact(
    value,
    [
      "schema",
      "authenticated",
      "durable",
      "readbackVerified",
      "manifestDigest",
      "acknowledgement",
      "databaseSeal",
      "databaseBytes",
      "workspaceSeal",
      "workspaceBytes",
      "durabilityReceiptDigest",
      "qualifiesForPromotion",
    ],
    "Desktop PM recovery-set resolution",
  );
  if (
    value.schema !== RECOVERY_SET_RESOLUTION_SCHEMA ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.manifestDigest !== binding.manifestDigest ||
    value.qualifiesForPromotion !== false ||
    !Buffer.isBuffer(value.databaseBytes) ||
    !Buffer.isBuffer(value.workspaceBytes)
  ) {
    throw new Error("Desktop PM recovery-set resolution is invalid");
  }
  const acknowledgement = recoverySnapshotAcknowledgement(
    value.acknowledgement,
    binding.manifestDigest,
    binding.evidence,
  );
  if (
    acknowledgement.snapshotAckDigest !==
    binding.recoverySnapshot.snapshotAckDigest
  ) {
    throw new Error("Desktop PM recovery-set acknowledgement is unbound");
  }
  digest(value.durabilityReceiptDigest, "durabilityReceiptDigest");
  const databaseSeal = verifyDesktopPmPreRunSealValue(value.databaseSeal);
  if (databaseSeal.sealDigest !== binding.evidence.preRunSeal.sealDigest) {
    throw new Error(
      "Desktop PM recovery database seal is not the pre-run seal",
    );
  }
  const databaseCapture = Object.freeze({
    schema: RECOVERY_SNAPSHOT_CAPTURE_SCHEMA,
    seal: databaseSeal,
    bytes: Buffer.from(value.databaseBytes),
  });
  const verifiedDatabase = normalizeDatabaseCapture(
    databaseCapture,
    databaseSeal.sealDigest,
  );
  const verifiedWorkspace = verifyDesktopPmWorkspaceSnapshotCapture(
    Object.freeze({
      schema: WORKSPACE_SNAPSHOT_CAPTURE_SCHEMA,
      seal: value.workspaceSeal,
      bytes: Buffer.from(value.workspaceBytes),
    }),
    binding.manifestDigest,
  );
  if (
    acknowledgement.workspaceSealDigest !== verifiedWorkspace.seal.sealDigest ||
    acknowledgement.workspaceRootDigest !==
      verifiedWorkspace.seal.workspaceRootDigest ||
    acknowledgement.capturePolicyDigest !==
      verifiedWorkspace.seal.capturePolicyDigest ||
    acknowledgement.workspaceSnapshotDigest !==
      verifiedWorkspace.seal.workspaceSnapshotDigest ||
    acknowledgement.workspaceSnapshotBytes !==
      verifiedWorkspace.seal.workspaceSnapshotBytes ||
    acknowledgement.workspaceFileCount !==
      verifiedWorkspace.seal.workspaceFileCount
  ) {
    throw new Error("Desktop PM recovery workspace seal is unbound");
  }
  return Object.freeze({
    acknowledgement,
    database: verifiedDatabase,
    workspace: verifiedWorkspace,
  });
}

function normalizeDatabaseCapture(value, expectedSealDigest) {
  exact(
    value,
    ["schema", "seal", "bytes"],
    "Desktop PM recovery database capture",
  );
  if (
    value.schema !== RECOVERY_SNAPSHOT_CAPTURE_SCHEMA ||
    !Buffer.isBuffer(value.bytes) ||
    Object.getPrototypeOf(value.bytes) !== Buffer.prototype
  ) {
    throw new TypeError("Desktop PM recovery database capture is invalid");
  }
  const seal = verifyDesktopPmPreRunSealValue(value.seal, expectedSealDigest);
  if (
    seal.databaseSnapshotBytes !== value.bytes.byteLength ||
    seal.databaseSnapshotDigest !==
      hashBytes("chainlesschain.desktop-pm-database-snapshot/v1", value.bytes)
  ) {
    throw new Error("Desktop PM recovery database capture bytes are invalid");
  }
  return Object.freeze({ seal, bytes: Buffer.from(value.bytes) });
}

function operationAck(value, schema, keys, checks, label) {
  exact(value, ["schema", ...keys], label);
  if (value.schema !== schema || !checks(value)) {
    throw new Error(`${label} is invalid`);
  }
  return Object.freeze({ ...value });
}

function createDesktopPmCloneRecoveryController(options = {}) {
  exact(
    options,
    [
      "manifestDigest",
      "applicationMainDatabasePathDigest",
      "cloneIdentityDigest",
      "resolveTransitionSnapshot",
      "acquireExclusiveClone",
      "closeClone",
      "replaceCloneRecoverySet",
      "reopenClone",
      "captureDatabaseSnapshot",
      "captureWorkspaceSnapshot",
      "commitRecoveryEvent",
      "finalizeExclusiveClone",
    ],
    "Desktop PM clone recovery controller options",
  );
  const captured = {
    manifestDigest: digest(options.manifestDigest, "manifestDigest"),
    applicationMainDatabasePathDigest: digest(
      options.applicationMainDatabasePathDigest,
      "applicationMainDatabasePathDigest",
    ),
    cloneIdentityDigest: digest(
      options.cloneIdentityDigest,
      "cloneIdentityDigest",
    ),
    resolveTransitionSnapshot: direct(
      options.resolveTransitionSnapshot,
      "resolveTransitionSnapshot",
    ),
    acquireExclusiveClone: direct(
      options.acquireExclusiveClone,
      "acquireExclusiveClone",
    ),
    closeClone: direct(options.closeClone, "closeClone"),
    replaceCloneRecoverySet: direct(
      options.replaceCloneRecoverySet,
      "replaceCloneRecoverySet",
    ),
    reopenClone: direct(options.reopenClone, "reopenClone"),
    captureDatabaseSnapshot: direct(
      options.captureDatabaseSnapshot,
      "captureDatabaseSnapshot",
    ),
    captureWorkspaceSnapshot: direct(
      options.captureWorkspaceSnapshot,
      "captureWorkspaceSnapshot",
    ),
    commitRecoveryEvent: direct(
      options.commitRecoveryEvent,
      "commitRecoveryEvent",
    ),
    finalizeExclusiveClone: direct(
      options.finalizeExclusiveClone,
      "finalizeExclusiveClone",
    ),
    state: { status: "ready" },
  };
  const controller = Object.freeze({});
  CONTROLLERS.set(controller, captured);
  return controller;
}

function captureDesktopPmCloneRecoveryController(value) {
  const captured = CONTROLLERS.get(value);
  if (!captured) {
    throw new TypeError(
      "a branded Desktop PM clone recovery controller is required",
    );
  }
  return Object.freeze({
    manifestDigest: captured.manifestDigest,
    inspect: () =>
      Object.freeze({
        status: captured.state.status,
        qualifiesForPromotion: false,
      }),
    recoverFailedClone: async (input) => recoverFailedClone(captured, input),
  });
}

async function recoverFailedClone(captured, input) {
  if (captured.state.status !== "ready") {
    throw new Error("Desktop PM clone recovery controller is not reusable");
  }
  const normalized = recoveryInput(input, captured.manifestDigest);
  const resolutionValue = Reflect.apply(
    captured.resolveTransitionSnapshot,
    undefined,
    [normalized.recoverySnapshot],
  );
  if (resolutionValue && typeof resolutionValue.then === "function") {
    throw new TypeError("PM recovery snapshot resolution must be synchronous");
  }
  const resolution = recoveryResolution(resolutionValue, {
    manifestDigest: captured.manifestDigest,
    evidence: normalized.evidence,
    recoverySnapshot: normalized.recoverySnapshot,
  });
  if (
    resolution.database.seal.databasePathDigest ===
    captured.applicationMainDatabasePathDigest
  ) {
    throw new Error(
      "Desktop PM recovery target resolves to the application main database",
    );
  }
  captured.state.status = "acquiring";
  try {
    const leaseRequest = Object.freeze({
      schema: CLONE_RECOVERY_LEASE_REQUEST_SCHEMA,
      manifestDigest: captured.manifestDigest,
      cloneIdentityDigest: captured.cloneIdentityDigest,
      applicationMainDatabasePathDigest:
        captured.applicationMainDatabasePathDigest,
      databasePathDigest: resolution.database.seal.databasePathDigest,
      workspaceRootDigest: resolution.workspace.seal.workspaceRootDigest,
      sourceTransitionRevision: normalized.revision,
      sourceFailureEvidenceDigest: normalized.evidence.evidenceDigest,
    });
    const lease = operationAck(
      await Reflect.apply(captured.acquireExclusiveClone, undefined, [
        leaseRequest,
      ]),
      CLONE_RECOVERY_LEASE_SCHEMA,
      [
        "manifestDigest",
        "cloneIdentityDigest",
        "applicationMainDatabasePathDigest",
        "databasePathDigest",
        "workspaceRootDigest",
        "leaseDigest",
        "exclusive",
        "mainDatabaseExcluded",
      ],
      (value) =>
        value.manifestDigest === captured.manifestDigest &&
        value.cloneIdentityDigest === captured.cloneIdentityDigest &&
        value.applicationMainDatabasePathDigest ===
          captured.applicationMainDatabasePathDigest &&
        value.databasePathDigest ===
          resolution.database.seal.databasePathDigest &&
        value.workspaceRootDigest ===
          resolution.workspace.seal.workspaceRootDigest &&
        DIGEST.test(value.leaseDigest ?? "") &&
        value.exclusive === true &&
        value.mainDatabaseExcluded === true,
      "Desktop PM clone recovery lease",
    );
    captured.state.status = "leased";
    operationAck(
      await Reflect.apply(captured.closeClone, undefined, [
        Object.freeze({
          schema: CLONE_RECOVERY_CLOSE_REQUEST_SCHEMA,
          manifestDigest: captured.manifestDigest,
          cloneIdentityDigest: captured.cloneIdentityDigest,
          leaseDigest: lease.leaseDigest,
        }),
      ]),
      CLONE_RECOVERY_CLOSE_ACK_SCHEMA,
      [
        "manifestDigest",
        "cloneIdentityDigest",
        "leaseDigest",
        "connectionClosed",
        "writeHandlesDrained",
      ],
      (value) =>
        value.manifestDigest === captured.manifestDigest &&
        value.cloneIdentityDigest === captured.cloneIdentityDigest &&
        value.leaseDigest === lease.leaseDigest &&
        value.connectionClosed === true &&
        value.writeHandlesDrained === true,
      "Desktop PM clone recovery close acknowledgement",
    );
    captured.state.status = "closed";
    const switchAck = operationAck(
      await Reflect.apply(captured.replaceCloneRecoverySet, undefined, [
        Object.freeze({
          schema: CLONE_RECOVERY_SWITCH_REQUEST_SCHEMA,
          manifestDigest: captured.manifestDigest,
          cloneIdentityDigest: captured.cloneIdentityDigest,
          leaseDigest: lease.leaseDigest,
          applicationMainDatabasePathDigest:
            captured.applicationMainDatabasePathDigest,
          databaseSeal: resolution.database.seal,
          databaseBytes: Buffer.from(resolution.database.bytes),
          workspaceSeal: resolution.workspace.seal,
          workspaceBytes: Buffer.from(resolution.workspace.bytes),
          recoverySnapshotAckDigest:
            resolution.acknowledgement.snapshotAckDigest,
        }),
      ]),
      CLONE_RECOVERY_SWITCH_ACK_SCHEMA,
      [
        "manifestDigest",
        "cloneIdentityDigest",
        "leaseDigest",
        "databasePathDigest",
        "workspaceRootDigest",
        "switchReceiptDigest",
        "transactionallyRecoverable",
        "mainDatabaseUntouched",
      ],
      (value) =>
        value.manifestDigest === captured.manifestDigest &&
        value.cloneIdentityDigest === captured.cloneIdentityDigest &&
        value.leaseDigest === lease.leaseDigest &&
        value.databasePathDigest ===
          resolution.database.seal.databasePathDigest &&
        value.workspaceRootDigest ===
          resolution.workspace.seal.workspaceRootDigest &&
        DIGEST.test(value.switchReceiptDigest ?? "") &&
        value.transactionallyRecoverable === true &&
        value.mainDatabaseUntouched === true,
      "Desktop PM clone recovery switch acknowledgement",
    );
    captured.state.status = "switched";
    operationAck(
      await Reflect.apply(captured.reopenClone, undefined, [
        Object.freeze({
          schema: CLONE_RECOVERY_REOPEN_REQUEST_SCHEMA,
          manifestDigest: captured.manifestDigest,
          cloneIdentityDigest: captured.cloneIdentityDigest,
          leaseDigest: lease.leaseDigest,
        }),
      ]),
      CLONE_RECOVERY_REOPEN_ACK_SCHEMA,
      [
        "manifestDigest",
        "cloneIdentityDigest",
        "leaseDigest",
        "databasePathDigest",
        "workspaceRootDigest",
        "connectionOpened",
      ],
      (value) =>
        value.manifestDigest === captured.manifestDigest &&
        value.cloneIdentityDigest === captured.cloneIdentityDigest &&
        value.leaseDigest === lease.leaseDigest &&
        value.databasePathDigest ===
          resolution.database.seal.databasePathDigest &&
        value.workspaceRootDigest ===
          resolution.workspace.seal.workspaceRootDigest &&
        value.connectionOpened === true,
      "Desktop PM clone recovery reopen acknowledgement",
    );
    captured.state.status = "verifying";
    const captureRequest = Object.freeze({
      schema: CLONE_RECOVERY_CAPTURE_REQUEST_SCHEMA,
      manifestDigest: captured.manifestDigest,
      cloneIdentityDigest: captured.cloneIdentityDigest,
      leaseDigest: lease.leaseDigest,
    });
    const restoredDatabase = normalizeDatabaseCapture(
      await Reflect.apply(captured.captureDatabaseSnapshot, undefined, [
        captureRequest,
      ]),
      resolution.database.seal.sealDigest,
    );
    const restoredWorkspace = verifyDesktopPmWorkspaceSnapshotCapture(
      await Reflect.apply(captured.captureWorkspaceSnapshot, undefined, [
        captureRequest,
      ]),
      captured.manifestDigest,
    );
    if (
      restoredWorkspace.seal.sealDigest !==
        resolution.workspace.seal.sealDigest ||
      restoredDatabase.seal.databasePathDigest ===
        captured.applicationMainDatabasePathDigest
    ) {
      throw new Error(
        "Desktop PM clone recovery readback differs from the retained recovery set",
      );
    }
    const eventCore = Object.freeze({
      schema: CLONE_RECOVERY_EVENT_SCHEMA,
      manifestDigest: captured.manifestDigest,
      cloneIdentityDigest: captured.cloneIdentityDigest,
      sourceTransitionRevision: normalized.revision,
      sourceFailureEvidenceDigest: normalized.evidence.evidenceDigest,
      previousStateTransitionDigest:
        normalized.evidence.previousStateTransitionDigest,
      recoverySnapshotAckDigest: resolution.acknowledgement.snapshotAckDigest,
      restoredDatabaseSealDigest: restoredDatabase.seal.sealDigest,
      restoredWorkspaceSealDigest: restoredWorkspace.seal.sealDigest,
      switchReceiptDigest: switchAck.switchReceiptDigest,
      authenticated: false,
      durable: false,
      qualifiesForPromotion: false,
    });
    const recoveryEvent = Object.freeze({
      ...eventCore,
      recoveryEventDigest: hash(CLONE_RECOVERY_EVENT_SCHEMA, eventCore),
    });
    captured.state.status = "committing";
    const commitAck = operationAck(
      await Reflect.apply(captured.commitRecoveryEvent, undefined, [
        recoveryEvent,
      ]),
      CLONE_RECOVERY_COMMIT_ACK_SCHEMA,
      [
        "manifestDigest",
        "recoveryEventDigest",
        "revision",
        "authenticated",
        "durable",
        "readbackVerified",
        "ledgerEventDigest",
        "durabilityReceiptDigest",
        "qualifiesForPromotion",
      ],
      (value) =>
        value.manifestDigest === captured.manifestDigest &&
        value.recoveryEventDigest === recoveryEvent.recoveryEventDigest &&
        Number.isSafeInteger(value.revision) &&
        value.revision > normalized.revision &&
        value.authenticated === true &&
        value.durable === true &&
        value.readbackVerified === true &&
        DIGEST.test(value.ledgerEventDigest ?? "") &&
        DIGEST.test(value.durabilityReceiptDigest ?? "") &&
        value.qualifiesForPromotion === false,
      "Desktop PM clone recovery commit acknowledgement",
    );
    captured.state.status = "finalizing";
    operationAck(
      await Reflect.apply(captured.finalizeExclusiveClone, undefined, [
        Object.freeze({
          schema: CLONE_RECOVERY_FINALIZE_REQUEST_SCHEMA,
          manifestDigest: captured.manifestDigest,
          cloneIdentityDigest: captured.cloneIdentityDigest,
          leaseDigest: lease.leaseDigest,
          recoveryEventDigest: recoveryEvent.recoveryEventDigest,
          durabilityReceiptDigest: commitAck.durabilityReceiptDigest,
        }),
      ]),
      CLONE_RECOVERY_FINALIZE_ACK_SCHEMA,
      [
        "manifestDigest",
        "cloneIdentityDigest",
        "leaseDigest",
        "recoveryEventDigest",
        "released",
      ],
      (value) =>
        value.manifestDigest === captured.manifestDigest &&
        value.cloneIdentityDigest === captured.cloneIdentityDigest &&
        value.leaseDigest === lease.leaseDigest &&
        value.recoveryEventDigest === recoveryEvent.recoveryEventDigest &&
        value.released === true,
      "Desktop PM clone recovery finalize acknowledgement",
    );
    captured.state.status = "recovered";
    return Object.freeze({
      schema: CLONE_RECOVERY_RESULT_SCHEMA,
      manifestDigest: captured.manifestDigest,
      cloneIdentityDigest: captured.cloneIdentityDigest,
      sourceTransitionRevision: normalized.revision,
      recoveryRevision: commitAck.revision,
      databaseSeal: restoredDatabase.seal,
      workspaceSeal: restoredWorkspace.seal,
      recoveryEventDigest: recoveryEvent.recoveryEventDigest,
      ledgerEventDigest: commitAck.ledgerEventDigest,
      durabilityReceiptDigest: commitAck.durabilityReceiptDigest,
      authenticated: true,
      durable: true,
      readbackVerified: true,
      transactionallyRecoverable: true,
      mainDatabaseUntouched: true,
      qualifiesForPromotion: false,
    });
  } catch (error) {
    captured.state.status = "poisoned";
    throw error;
  }
}

module.exports = {
  CLONE_RECOVERY_CAPTURE_REQUEST_SCHEMA,
  CLONE_RECOVERY_CLOSE_REQUEST_SCHEMA,
  CLONE_RECOVERY_CLOSE_ACK_SCHEMA,
  CLONE_RECOVERY_COMMIT_ACK_SCHEMA,
  CLONE_RECOVERY_EVENT_SCHEMA,
  CLONE_RECOVERY_FINALIZE_ACK_SCHEMA,
  CLONE_RECOVERY_FINALIZE_REQUEST_SCHEMA,
  CLONE_RECOVERY_LEASE_REQUEST_SCHEMA,
  CLONE_RECOVERY_LEASE_SCHEMA,
  CLONE_RECOVERY_REOPEN_ACK_SCHEMA,
  CLONE_RECOVERY_REOPEN_REQUEST_SCHEMA,
  CLONE_RECOVERY_RESULT_SCHEMA,
  CLONE_RECOVERY_SWITCH_ACK_SCHEMA,
  CLONE_RECOVERY_SWITCH_REQUEST_SCHEMA,
  captureDesktopPmCloneRecoveryController,
  createDesktopPmCloneRecoveryController,
};
