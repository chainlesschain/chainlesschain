"use strict";

const { createHash } = require("node:crypto");
const path = require("path");
const { pathToFileURL } = require("url");
const { types } = require("util");
const { createDesktopModelIngressHost } = require("./desktop-model-ingress");
const {
  createDesktopPmReadOnlyOutcomeReader,
} = require("./desktop-pm-read-only-outcome-reader");
const {
  RECOVERY_SNAPSHOT_CAPTURE_SCHEMA,
  captureDesktopPmRecoverySnapshot,
  captureDesktopPmPreRunSeal,
  verifyDesktopPmPreRunSealValue,
} = require("./desktop-pm-pre-run-seal");
const {
  createDesktopGovernedSkillMarketplaceHost,
} = require("../marketplace/governed-skill-marketplace-host");
const {
  createEvolvableArtifactRuntimeComposition,
  isEvolvableArtifactRuntimeComposition,
  getEvolvableArtifactRuntimeDependencies,
} = require("@chainlesschain/session-core/evolvable-artifact");

const DEV_LOADER_REL =
  "../../../../packages/cli/src/lib/evolution/evolution-deployment-loader.js";
const DEV_PM_LEDGER_ADAPTER_REL =
  "../../../../packages/cli/src/lib/evolution/pm-exploration-ledger-adapter.js";
const DEV_PM_EXECUTION_HOST_REL =
  "../../../../packages/cli/src/lib/evolution/pm-exploration-execution-host.js";
const DEV_PM_TRANSITION_COMMITTER_REL =
  "../../../../packages/cli/src/lib/evolution/pm-exploration-transition-committer.js";
const DEV_PM_RECOVERY_SNAPSHOT_STORE_REL =
  "../../../../packages/cli/src/lib/evolution/pm-exploration-recovery-snapshot-store.js";
const PM_EXPLORATION_STORAGE_HOSTS = new WeakMap();
const PM_EXPLORATION_EXECUTION_HOSTS = new WeakMap();
const PM_EXPLORATION_EXECUTION_LANES = new WeakMap();
const DESKTOP_PM_SEALED_EXECUTION_RESULT_SCHEMA =
  "chainlesschain.desktop-pm-sealed-execution-result/v3";
const DESKTOP_PM_SNAPSHOT_BACKED_EXECUTION_RESULT_SCHEMA =
  "chainlesschain.desktop-pm-sealed-execution-result/v4";
const DESKTOP_PM_SUCCESS_TRANSITION_EVIDENCE_SCHEMA =
  "chainlesschain.desktop-pm-state-transition-success/v1";
const DESKTOP_PM_FAILED_EXECUTION_EVIDENCE_SCHEMA =
  "chainlesschain.desktop-pm-failed-execution-evidence/v1";
const PM_EXPLORATION_TRANSITION_RECOVERY_SCHEMA =
  "chainlesschain.pm-exploration-transition-recovery/v1";

function ownDirectFunction(owner, name, label) {
  if (!owner || typeof owner !== "object" || types.isProxy(owner))
    throw new TypeError(`${label} module is invalid`);
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (
    !descriptor ||
    !("value" in descriptor) ||
    typeof descriptor.value !== "function" ||
    types.isProxy(descriptor.value)
  ) {
    throw new TypeError(`${label} must be a direct function`);
  }
  return descriptor.value;
}

function ownData(owner, name, label) {
  if (!owner || typeof owner !== "object" || types.isProxy(owner))
    throw new TypeError(`${label} owner is invalid`);
  const descriptor = Object.getOwnPropertyDescriptor(owner, name);
  if (!descriptor || !("value" in descriptor))
    throw new TypeError(`${label} must be plain data`);
  return descriptor.value;
}

function exactDataObject(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.length ||
    actual.some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.includes(key) ||
        !descriptor ||
        descriptor.enumerable !== true ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function sha256Digest(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function transitionDigest(value) {
  return `sha256:${createHash("sha256")
    .update("chainlesschain.desktop-pm-database-transition/v1\0")
    .update(JSON.stringify(value))
    .digest("hex")}`;
}

function normalizeDesktopPmRecoverySnapshotCapture(value, expectedSealDigest) {
  exactDataObject(
    value,
    ["schema", "seal", "bytes"],
    "Desktop PM recovery snapshot capture",
  );
  if (
    value.schema !== RECOVERY_SNAPSHOT_CAPTURE_SCHEMA ||
    !Buffer.isBuffer(value.bytes) ||
    Object.getPrototypeOf(value.bytes) !== Buffer.prototype
  ) {
    throw new TypeError("Desktop PM recovery snapshot capture is invalid");
  }
  const seal = verifyDesktopPmPreRunSealValue(value.seal, expectedSealDigest);
  if (value.bytes.byteLength !== seal.databaseSnapshotBytes)
    throw new Error("Desktop PM recovery snapshot byte length is inconsistent");
  const snapshotDigest = `sha256:${createHash("sha256")
    .update("chainlesschain.desktop-pm-database-snapshot/v1\0")
    .update(value.bytes)
    .digest("hex")}`;
  if (snapshotDigest !== seal.databaseSnapshotDigest)
    throw new Error("Desktop PM recovery snapshot digest is inconsistent");
  return Object.freeze({ seal, bytes: Buffer.from(value.bytes) });
}

async function captureExecutionSnapshot(captured, expectedSealDigest) {
  if (captured.retainTransitionSnapshot) {
    return normalizeDesktopPmRecoverySnapshotCapture(
      await captured.capturePmRecoverySnapshot(),
      expectedSealDigest,
    );
  }
  return Object.freeze({
    seal: verifyDesktopPmPreRunSealValue(
      await captured.capturePmPreRunSeal(),
      expectedSealDigest,
    ),
    bytes: null,
  });
}

async function retainRecoverySnapshot(
  captured,
  transitionKind,
  evidenceDigest,
  snapshot,
) {
  if (!captured.retainTransitionSnapshot || snapshot.bytes === null)
    return null;
  return captured.retainTransitionSnapshot(
    Object.freeze({
      schema: "chainlesschain.pm-exploration-recovery-snapshot-request/v1",
      manifestDigest: captured.manifestDigest,
      transitionKind,
      snapshotRole: transitionKind === "success" ? "post-run" : "pre-run",
      evidenceDigest,
      seal: snapshot.seal,
      bytes: snapshot.bytes,
    }),
  );
}

function normalizeDesktopPmTransitionRecovery(value, manifestDigest) {
  exactDataObject(
    value,
    [
      "schema",
      "authenticated",
      "durable",
      "readbackVerified",
      "manifestDigest",
      "revision",
      "transitionKind",
      "evidenceDigest",
      "evidence",
      "ledgerHeadDigest",
      "ledgerEventDigest",
      "durabilityReceiptDigest",
      "qualifiesForPromotion",
    ],
    "Desktop PM transition recovery",
  );
  if (
    value.schema !== PM_EXPLORATION_TRANSITION_RECOVERY_SCHEMA ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.manifestDigest !== manifestDigest ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    ![null, "success", "failure"].includes(value.transitionKind) ||
    value.qualifiesForPromotion !== false
  ) {
    throw new Error("Desktop PM transition recovery is invalid");
  }
  sha256Digest(value.ledgerHeadDigest, "PM transition ledger head digest");
  if (value.transitionKind === null) {
    if (
      value.revision !== 0 ||
      value.evidenceDigest !== null ||
      value.evidence !== null ||
      value.ledgerEventDigest !== null ||
      value.durabilityReceiptDigest !== null
    ) {
      throw new Error("Desktop PM empty transition recovery is inconsistent");
    }
    return Object.freeze({ kind: null, revision: 0, evidence: null });
  }
  if (value.revision < 1) {
    throw new Error("Desktop PM transition recovery revision is invalid");
  }
  sha256Digest(value.evidenceDigest, "PM recovered evidence digest");
  sha256Digest(value.ledgerEventDigest, "PM recovered ledger event digest");
  sha256Digest(
    value.durabilityReceiptDigest,
    "PM recovered durability receipt digest",
  );
  if (
    !value.evidence ||
    typeof value.evidence !== "object" ||
    types.isProxy(value.evidence) ||
    ownData(
      value.evidence,
      "manifestDigest",
      "PM recovered evidence manifest digest",
    ) !== manifestDigest
  ) {
    throw new Error("Desktop PM recovered evidence manifest is invalid");
  }
  const schema = ownData(
    value.evidence,
    "schema",
    "PM recovered evidence schema",
  );
  const expectedSchema =
    value.transitionKind === "success"
      ? DESKTOP_PM_SUCCESS_TRANSITION_EVIDENCE_SCHEMA
      : DESKTOP_PM_FAILED_EXECUTION_EVIDENCE_SCHEMA;
  if (schema !== expectedSchema)
    throw new Error("Desktop PM recovered transition kind is inconsistent");
  const evidenceDigest =
    value.transitionKind === "success"
      ? sha256Digest(
          ownData(
            value.evidence,
            "stateTransitionDigest",
            "PM recovered state transition digest",
          ),
          "PM recovered state transition digest",
        )
      : sha256Digest(
          ownData(
            value.evidence,
            "evidenceDigest",
            "PM recovered failure evidence digest",
          ),
          "PM recovered failure evidence digest",
        );
  if (evidenceDigest !== value.evidenceDigest)
    throw new Error("Desktop PM recovered evidence digest is inconsistent");
  return Object.freeze({
    kind: value.transitionKind,
    revision: value.revision,
    evidence: value.evidence,
  });
}

function failedExecutionEvidence({
  captured,
  preRunSeal,
  failureSeal,
  previousStateTransitionDigest,
}) {
  const databaseIdentityUnchanged =
    failureSeal === null
      ? null
      : failureSeal.databasePathDigest === preRunSeal.databasePathDigest;
  const core = Object.freeze({
    schema: DESKTOP_PM_FAILED_EXECUTION_EVIDENCE_SCHEMA,
    manifestDigest: captured.manifestDigest,
    preRunSeal,
    failureSeal,
    databaseIdentityUnchanged,
    databaseChanged:
      failureSeal === null || !databaseIdentityUnchanged
        ? null
        : failureSeal.databaseSnapshotDigest !==
          preRunSeal.databaseSnapshotDigest,
    previousStateTransitionDigest,
    failureClass: "execution-or-evidence-failed",
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
  });
  return Object.freeze({
    ...core,
    evidenceDigest: `sha256:${createHash("sha256")
      .update(`${DESKTOP_PM_FAILED_EXECUTION_EVIDENCE_SCHEMA}\0`)
      .update(JSON.stringify(core))
      .digest("hex")}`,
  });
}

function successfulExecutionEvidence({
  captured,
  preRunSeal,
  postRunSeal,
  executionReceiptDigest,
  graderReceiptDigest,
  previousStateTransitionDigest,
  stateTransitionDigest,
}) {
  return Object.freeze({
    schema: DESKTOP_PM_SUCCESS_TRANSITION_EVIDENCE_SCHEMA,
    manifestDigest: captured.manifestDigest,
    executionReceiptDigest,
    graderReceiptDigest,
    preRunSeal,
    postRunSeal,
    databaseChanged:
      postRunSeal.databaseSnapshotDigest !== preRunSeal.databaseSnapshotDigest,
    previousStateTransitionDigest,
    stateTransitionDigest,
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
  });
}

async function captureFailedExecution(
  captured,
  preRunSnapshot,
  cause,
  { transitionCommitOutcomeUnknown = false } = {},
) {
  captured.executionState.tainted = true;
  let failureSeal = null;
  try {
    failureSeal = (await captureExecutionSnapshot(captured)).seal;
  } catch {
    // A missing failure seal is itself explicit evidence. Never let a second
    // capture failure erase the original execution or verification failure.
  }
  const evidence = failedExecutionEvidence({
    captured,
    preRunSeal: preRunSnapshot.seal,
    failureSeal,
    previousStateTransitionDigest:
      captured.executionState.previousStateTransitionDigest,
  });
  let transitionDurability = null;
  let recoverySnapshot = null;
  let recoverySnapshotFailed = false;
  if (captured.retainTransitionSnapshot) {
    try {
      recoverySnapshot = await retainRecoverySnapshot(
        captured,
        "failure",
        evidence.evidenceDigest,
        preRunSnapshot,
      );
    } catch {
      recoverySnapshotFailed = true;
    }
  }
  let transitionDurabilityFailed = transitionCommitOutcomeUnknown;
  if (captured.commitTransition && !transitionCommitOutcomeUnknown) {
    try {
      transitionDurability =
        recoverySnapshot === null
          ? await captured.commitTransition(evidence)
          : await captured.commitTransition(evidence, recoverySnapshot);
    } catch {
      transitionDurabilityFailed = true;
    }
  }
  const error = new Error(
    "Desktop PM execution failed after its pre-run seal; host is tainted",
    { cause },
  );
  error.code = "CC_DESKTOP_PM_EXECUTION_TAINTED";
  error.evidence = evidence;
  error.transitionDurability = transitionDurability;
  error.transitionDurabilityFailed = transitionDurabilityFailed;
  error.transitionCommitOutcomeUnknown = transitionDurabilityFailed;
  error.recoverySnapshot = recoverySnapshot;
  error.recoverySnapshotFailed = recoverySnapshotFailed;
  throw error;
}

function executionLane(capturePmPreRunSeal) {
  let lane = PM_EXPLORATION_EXECUTION_LANES.get(capturePmPreRunSeal);
  if (!lane) {
    lane = { tail: Promise.resolve() };
    PM_EXPLORATION_EXECUTION_LANES.set(capturePmPreRunSeal, lane);
  }
  return lane;
}

function enqueueExecution(lane, operation) {
  const result = lane.tail.then(operation, operation);
  lane.tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function resolveLoaderPath({ isPackaged = false, resourcesPath } = {}) {
  if (isPackaged) {
    if (typeof resourcesPath !== "string" || resourcesPath === "") {
      throw new Error("packaged evolution deployment requires resourcesPath");
    }
    return path.join(
      resourcesPath,
      "packages/cli/src/lib/evolution/evolution-deployment-loader.js",
    );
  }
  return path.resolve(__dirname, DEV_LOADER_REL);
}

function resolvePmExplorationLedgerAdapterPath({
  isPackaged = false,
  resourcesPath,
} = {}) {
  if (isPackaged) {
    if (typeof resourcesPath !== "string" || resourcesPath === "") {
      throw new Error("packaged PM exploration storage requires resourcesPath");
    }
    return path.join(
      resourcesPath,
      "packages/cli/src/lib/evolution/pm-exploration-ledger-adapter.js",
    );
  }
  return path.resolve(__dirname, DEV_PM_LEDGER_ADAPTER_REL);
}

function resolvePmExplorationExecutionHostPath({
  isPackaged = false,
  resourcesPath,
} = {}) {
  if (isPackaged) {
    if (typeof resourcesPath !== "string" || resourcesPath === "") {
      throw new Error(
        "packaged PM exploration execution requires resourcesPath",
      );
    }
    return path.join(
      resourcesPath,
      "packages/cli/src/lib/evolution/pm-exploration-execution-host.js",
    );
  }
  return path.resolve(__dirname, DEV_PM_EXECUTION_HOST_REL);
}

function resolvePmExplorationTransitionCommitterPath({
  isPackaged = false,
  resourcesPath,
} = {}) {
  if (isPackaged) {
    if (typeof resourcesPath !== "string" || resourcesPath === "") {
      throw new Error(
        "packaged PM exploration transition committer requires resourcesPath",
      );
    }
    return path.join(
      resourcesPath,
      "packages/cli/src/lib/evolution/pm-exploration-transition-committer.js",
    );
  }
  return path.resolve(__dirname, DEV_PM_TRANSITION_COMMITTER_REL);
}

function resolvePmExplorationRecoverySnapshotStorePath({
  isPackaged = false,
  resourcesPath,
} = {}) {
  if (isPackaged) {
    if (typeof resourcesPath !== "string" || resourcesPath === "") {
      throw new Error(
        "packaged PM recovery snapshot store requires resourcesPath",
      );
    }
    return path.join(
      resourcesPath,
      "packages/cli/src/lib/evolution/pm-exploration-recovery-snapshot-store.js",
    );
  }
  return path.resolve(__dirname, DEV_PM_RECOVERY_SNAPSHOT_STORE_REL);
}

function createDesktopPmExplorationStorageHost(store, captureStore) {
  if (typeof captureStore !== "function" || types.isProxy(captureStore)) {
    throw new TypeError("PM exploration ledger store capture is invalid");
  }
  const ports = captureStore(store);
  const loadDescriptor = Object.getOwnPropertyDescriptor(ports, "load");
  if (
    !loadDescriptor ||
    !("value" in loadDescriptor) ||
    typeof loadDescriptor.value !== "function" ||
    types.isProxy(loadDescriptor.value)
  ) {
    throw new TypeError("PM exploration ledger store has no direct load port");
  }
  const host = Object.freeze({});
  PM_EXPLORATION_STORAGE_HOSTS.set(
    host,
    Object.freeze({ load: loadDescriptor.value }),
  );
  return host;
}

function isDesktopPmExplorationStorageHost(value) {
  return PM_EXPLORATION_STORAGE_HOSTS.has(value);
}

function inspectDesktopPmExplorationStorageHost(host) {
  const captured = PM_EXPLORATION_STORAGE_HOSTS.get(host);
  if (!captured) {
    return Object.freeze({
      configured: false,
      readable: false,
      snapshotAvailable: false,
      snapshotAuthenticated: false,
      durableSnapshotAvailable: false,
      powerLossDurabilityTested: false,
      qualifiesForPromotion: false,
    });
  }
  try {
    const evidence = captured.load();
    if (evidence && typeof evidence.then === "function") {
      throw new TypeError("PM exploration ledger load must be synchronous");
    }
    if (evidence === null) {
      return Object.freeze({
        configured: true,
        readable: true,
        snapshotAvailable: false,
        snapshotAuthenticated: false,
        durableSnapshotAvailable: false,
        powerLossDurabilityTested: false,
        qualifiesForPromotion: false,
      });
    }
    const valid =
      evidence &&
      typeof evidence === "object" &&
      !types.isProxy(evidence) &&
      evidence.schema === "chainlesschain.pm-exploration-ledger-restore/v1" &&
      evidence.authenticated === true &&
      evidence.durable === true &&
      evidence.ledgerAuthenticated === true &&
      evidence.ledgerDurable === true &&
      evidence.authorityDurable === true &&
      evidence.powerLossDurabilityTested === false &&
      typeof evidence.snapshotAuthenticated === "boolean" &&
      evidence.qualifiesForPromotion === false;
    if (!valid) {
      throw new Error("PM exploration restore evidence is invalid");
    }
    return Object.freeze({
      configured: true,
      readable: true,
      snapshotAvailable: true,
      snapshotAuthenticated: evidence.snapshotAuthenticated,
      durableSnapshotAvailable: true,
      powerLossDurabilityTested: false,
      qualifiesForPromotion: false,
    });
  } catch {
    return Object.freeze({
      configured: true,
      readable: false,
      snapshotAvailable: false,
      snapshotAuthenticated: false,
      durableSnapshotAvailable: false,
      powerLossDurabilityTested: false,
      qualifiesForPromotion: false,
    });
  }
}

function createDesktopPmExplorationExecutionHost(
  host,
  executionModule,
  capturePmPreRunSeal,
  transitionCommitter = null,
  transitionRecovery = null,
  recoverySnapshotStore = null,
  capturePmRecoverySnapshot = captureDesktopPmRecoverySnapshot,
) {
  const isExecutionHost = ownDirectFunction(
    executionModule,
    "isPmExplorationExecutionHost",
    "PM exploration execution host guard",
  );
  if (!Reflect.apply(isExecutionHost, undefined, [host])) {
    throw new TypeError("a branded PM exploration execution host is required");
  }
  const inspectExecutionHost = ownDirectFunction(
    executionModule,
    "inspectPmExplorationExecutionHost",
    "PM exploration execution host inspector",
  );
  if (
    typeof capturePmPreRunSeal !== "function" ||
    types.isProxy(capturePmPreRunSeal)
  ) {
    throw new TypeError("Desktop PM pre-run seal capture must be direct");
  }
  const inspection = Reflect.apply(inspectExecutionHost, undefined, [host]);
  const preRunSealDigest = ownData(
    inspection,
    "preRunSealDigest",
    "PM exploration pre-run seal digest",
  );
  sha256Digest(preRunSealDigest, "PM exploration pre-run seal digest");
  const manifestDigest = sha256Digest(
    ownData(
      inspection,
      "manifestDigest",
      "PM exploration execution manifest digest",
    ),
    "PM exploration execution manifest digest",
  );
  if (
    transitionCommitter !== null &&
    transitionCommitter.manifestDigest !== manifestDigest
  ) {
    throw new Error(
      "PM exploration transition committer manifest does not match execution host",
    );
  }
  if (
    recoverySnapshotStore !== null &&
    recoverySnapshotStore.manifestDigest !== manifestDigest
  ) {
    throw new Error(
      "PM recovery snapshot store manifest does not match execution host",
    );
  }
  if (
    recoverySnapshotStore !== null &&
    (typeof capturePmRecoverySnapshot !== "function" ||
      types.isProxy(capturePmRecoverySnapshot))
  ) {
    throw new TypeError("Desktop PM recovery snapshot capture must be direct");
  }
  const operations = {};
  for (const name of [
    "executePmExplorationRound",
    "mergePmExplorationBranches",
    "evaluatePmExplorationMemory",
  ]) {
    const operation = ownDirectFunction(
      executionModule,
      name,
      `PM exploration execution module ${name}`,
    );
    operations[name] = (...args) =>
      Reflect.apply(operation, undefined, [host, ...args]);
  }
  const desktopHost = Object.freeze({});
  let nextPreRunSealDigest = preRunSealDigest;
  let previousStateTransitionDigest = null;
  let tainted = false;
  let transitionRecoveryStatus = "unavailable";
  let transitionRecoveryRevision = null;
  if (transitionRecovery) {
    transitionRecoveryStatus = transitionRecovery.kind ?? "empty";
    transitionRecoveryRevision = transitionRecovery.revision;
    if (transitionRecovery.kind === "success") {
      const postRunSeal = verifyDesktopPmPreRunSealValue(
        ownData(
          transitionRecovery.evidence,
          "postRunSeal",
          "PM recovered post-run seal",
        ),
      );
      nextPreRunSealDigest = postRunSeal.sealDigest;
      previousStateTransitionDigest = sha256Digest(
        ownData(
          transitionRecovery.evidence,
          "stateTransitionDigest",
          "PM recovered state transition digest",
        ),
        "PM recovered state transition digest",
      );
    } else if (transitionRecovery.kind === "failure") {
      tainted = true;
      previousStateTransitionDigest = ownData(
        transitionRecovery.evidence,
        "previousStateTransitionDigest",
        "PM recovered previous state transition digest",
      );
      if (previousStateTransitionDigest !== null) {
        sha256Digest(
          previousStateTransitionDigest,
          "PM recovered previous state transition digest",
        );
      }
    }
  }
  PM_EXPLORATION_EXECUTION_HOSTS.set(
    desktopHost,
    Object.freeze({
      ...operations,
      capturePmPreRunSeal,
      capturePmRecoverySnapshot,
      commitTransition: transitionCommitter?.commitTransition ?? null,
      retainTransitionSnapshot:
        recoverySnapshotStore?.retainTransitionSnapshot ?? null,
      executionLane: executionLane(
        recoverySnapshotStore === null
          ? capturePmPreRunSeal
          : capturePmRecoverySnapshot,
      ),
      executionState: {
        nextPreRunSealDigest,
        previousStateTransitionDigest,
        tainted,
        transitionRecoveryStatus,
        transitionRecoveryRevision,
      },
      manifestDigest,
      preRunSealDigest,
    }),
  );
  return desktopHost;
}

function captureDesktopPmExplorationExecutionHost(host) {
  const captured = PM_EXPLORATION_EXECUTION_HOSTS.get(host);
  if (!captured) {
    throw new TypeError(
      "a branded Desktop PM exploration execution host is required",
    );
  }
  return captured;
}

function isDesktopPmExplorationExecutionHost(value) {
  return PM_EXPLORATION_EXECUTION_HOSTS.has(value);
}

function inspectDesktopPmExplorationExecutionHost(host) {
  const captured = captureDesktopPmExplorationExecutionHost(host);
  return Object.freeze({
    tainted: captured.executionState.tainted,
    requiresRecovery: captured.executionState.tainted,
    transitionDurabilityConfigured: captured.commitTransition !== null,
    recoverySnapshotConfigured: captured.retainTransitionSnapshot !== null,
    transitionRecoveryConfigured:
      captured.executionState.transitionRecoveryStatus !== "unavailable",
    transitionRecoveryStatus: captured.executionState.transitionRecoveryStatus,
    transitionRecoveryRevision:
      captured.executionState.transitionRecoveryRevision,
    qualifiesForPromotion: false,
  });
}

async function executeDesktopPmExplorationRound(host, journal, input) {
  const captured = captureDesktopPmExplorationExecutionHost(host);
  return enqueueExecution(captured.executionLane, async () => {
    if (captured.executionState.tainted) {
      const error = new Error(
        "Desktop PM execution host is tainted and requires recovery",
      );
      error.code = "CC_DESKTOP_PM_EXECUTION_TAINTED";
      throw error;
    }
    const previousStateTransitionDigest =
      captured.executionState.previousStateTransitionDigest;
    const preRunSnapshot = await captureExecutionSnapshot(
      captured,
      captured.executionState.nextPreRunSealDigest,
    );
    const seal = preRunSnapshot.seal;
    let transitionCommitAttempted = false;
    try {
      const executionResult = await captured.executePmExplorationRound(
        journal,
        input,
      );
      const executionReceiptDigest = sha256Digest(
        ownData(
          ownData(
            executionResult,
            "executionReceipt",
            "PM exploration execution receipt",
          ),
          "receiptDigest",
          "PM exploration execution receipt digest",
        ),
        "PM exploration execution receipt digest",
      );
      const graderReceiptDigest = sha256Digest(
        ownData(
          ownData(
            executionResult,
            "graderReceipt",
            "PM exploration grader receipt",
          ),
          "receiptDigest",
          "PM exploration grader receipt digest",
        ),
        "PM exploration grader receipt digest",
      );
      const postRunSnapshot = await captureExecutionSnapshot(captured);
      const postRunSeal = postRunSnapshot.seal;
      if (postRunSeal.databasePathDigest !== seal.databasePathDigest)
        throw new Error("Desktop PM database path changed after execution");
      const stateTransitionDigest = transitionDigest({
        manifestDigest: captured.manifestDigest,
        executionReceiptDigest,
        graderReceiptDigest,
        preRunSealDigest: seal.sealDigest,
        postRunSealDigest: postRunSeal.sealDigest,
        previousStateTransitionDigest,
      });
      const transitionEvidence = successfulExecutionEvidence({
        captured,
        preRunSeal: seal,
        postRunSeal,
        executionReceiptDigest,
        graderReceiptDigest,
        previousStateTransitionDigest,
        stateTransitionDigest,
      });
      const recoverySnapshot = await retainRecoverySnapshot(
        captured,
        "success",
        stateTransitionDigest,
        postRunSnapshot,
      );
      let transitionDurability = null;
      if (captured.commitTransition) {
        transitionCommitAttempted = true;
        transitionDurability =
          recoverySnapshot === null
            ? await captured.commitTransition(transitionEvidence)
            : await captured.commitTransition(
                transitionEvidence,
                recoverySnapshot,
              );
      }
      captured.executionState.nextPreRunSealDigest = postRunSeal.sealDigest;
      captured.executionState.previousStateTransitionDigest =
        stateTransitionDigest;
      const result = {
        schema:
          recoverySnapshot === null
            ? DESKTOP_PM_SEALED_EXECUTION_RESULT_SCHEMA
            : DESKTOP_PM_SNAPSHOT_BACKED_EXECUTION_RESULT_SCHEMA,
        preRunSeal: seal,
        postRunSeal,
        databaseChanged:
          postRunSeal.databaseSnapshotDigest !== seal.databaseSnapshotDigest,
        previousStateTransitionDigest,
        stateTransitionDigest,
        transitionEvidence,
        transitionDurability,
        executionResult,
        preRunSealVerified: true,
        qualifiesForPromotion: false,
      };
      if (recoverySnapshot !== null) result.recoverySnapshot = recoverySnapshot;
      return Object.freeze(result);
    } catch (cause) {
      return captureFailedExecution(captured, preRunSnapshot, cause, {
        transitionCommitOutcomeUnknown: transitionCommitAttempted,
      });
    }
  });
}

function mergeDesktopPmExplorationBranches(host, journal, input) {
  return captureDesktopPmExplorationExecutionHost(
    host,
  ).mergePmExplorationBranches(journal, input);
}

function evaluateDesktopPmExplorationMemory(host, journal, input) {
  return captureDesktopPmExplorationExecutionHost(
    host,
  ).evaluatePmExplorationMemory(journal, input);
}

async function loadDesktopEvolutionDependencies({
  isPackaged = false,
  resourcesPath,
  importLoader = (url) => import(url),
  loaderOptions = {},
  importMarketplaceHostModule,
  importPmExplorationLedgerModule = (url) => import(url),
  importPmExplorationExecutionModule = (url) => import(url),
  importPmExplorationTransitionModule = (url) => import(url),
  importPmExplorationRecoverySnapshotModule = (url) => import(url),
  capturePmPreRunSeal = captureDesktopPmPreRunSeal,
  capturePmRecoverySnapshot = captureDesktopPmRecoverySnapshot,
} = {}) {
  const loaderPath = resolveLoaderPath({ isPackaged, resourcesPath });
  const loader = await importLoader(pathToFileURL(loaderPath).href);
  if (typeof loader.loadEvolutionDeploymentCommandDependencies !== "function") {
    throw new Error("evolution deployment loader is invalid");
  }
  const result = await loader.loadEvolutionDeploymentCommandDependencies(
    "desktop",
    {
      ...loaderOptions,
      additionalFactories: Object.freeze({
        createDesktopPmReadOnlyOutcomeReader,
        createEvolvableArtifactRuntimeComposition,
      }),
    },
  );
  if (result === null) {
    return Object.freeze({});
  }

  const desktopDependencies = {};
  const modelFactoryDescriptor = Object.getOwnPropertyDescriptor(
    result,
    "evolutionCompositionFactory",
  );
  if (modelFactoryDescriptor) {
    if (!Object.hasOwn(modelFactoryDescriptor, "value")) {
      throw new TypeError(
        "Desktop model composition factory must be a data property",
      );
    }
    desktopDependencies.desktopModelIngressHost = createDesktopModelIngressHost(
      modelFactoryDescriptor.value,
      {
        isPackaged,
        resourcesPath,
      },
    );
  }
  if (result.marketplaceHost !== undefined) {
    desktopDependencies.governedSkillMarketplaceHost =
      await createDesktopGovernedSkillMarketplaceHost(result.marketplaceHost, {
        isPackaged,
        resourcesPath,
        importHostModule: importMarketplaceHostModule,
      });
  }
  const pmStoreDescriptor = Object.getOwnPropertyDescriptor(
    result,
    "pmExplorationLedgerStore",
  );
  if (pmStoreDescriptor) {
    if (
      !("value" in pmStoreDescriptor) ||
      pmStoreDescriptor.enumerable !== true
    ) {
      throw new TypeError(
        "Desktop PM exploration ledger store must be an enumerable data property",
      );
    }
    const adapterPath = resolvePmExplorationLedgerAdapterPath({
      isPackaged,
      resourcesPath,
    });
    const adapterModule = await importPmExplorationLedgerModule(
      pathToFileURL(adapterPath).href,
    );
    desktopDependencies.desktopPmExplorationStorageHost =
      createDesktopPmExplorationStorageHost(
        pmStoreDescriptor.value,
        adapterModule?.capturePmExplorationLedgerStore,
      );
  }
  const pmExecutionHostDescriptor = Object.getOwnPropertyDescriptor(
    result,
    "pmExplorationExecutionHost",
  );
  const pmTransitionCommitterDescriptor = Object.getOwnPropertyDescriptor(
    result,
    "pmExplorationTransitionCommitter",
  );
  const pmRecoverySnapshotStoreDescriptor = Object.getOwnPropertyDescriptor(
    result,
    "pmExplorationRecoverySnapshotStore",
  );
  let transitionCommitter = null;
  let transitionRecovery = null;
  if (pmTransitionCommitterDescriptor) {
    if (
      !("value" in pmTransitionCommitterDescriptor) ||
      pmTransitionCommitterDescriptor.enumerable !== true
    ) {
      throw new TypeError(
        "Desktop PM transition committer must be an enumerable data property",
      );
    }
    if (!pmExecutionHostDescriptor) {
      throw new Error(
        "Desktop PM transition committer requires an execution host",
      );
    }
    const committerPath = resolvePmExplorationTransitionCommitterPath({
      isPackaged,
      resourcesPath,
    });
    const committerModule = await importPmExplorationTransitionModule(
      pathToFileURL(committerPath).href,
    );
    const captureCommitter = ownDirectFunction(
      committerModule,
      "capturePmExplorationTransitionCommitter",
      "PM exploration transition committer capture",
    );
    const capturedCommitter = Reflect.apply(captureCommitter, undefined, [
      pmTransitionCommitterDescriptor.value,
    ]);
    const committerManifestDigest = sha256Digest(
      ownData(
        capturedCommitter,
        "manifestDigest",
        "PM exploration transition committer manifest digest",
      ),
      "PM exploration transition committer manifest digest",
    );
    const recoverTransitionDescriptor = Object.getOwnPropertyDescriptor(
      capturedCommitter,
      "recoverTransition",
    );
    let recoverTransition = null;
    if (recoverTransitionDescriptor) {
      if (!("value" in recoverTransitionDescriptor)) {
        throw new TypeError(
          "PM exploration transition recovery port must be plain data",
        );
      }
      if (recoverTransitionDescriptor.value !== null) {
        if (
          typeof recoverTransitionDescriptor.value !== "function" ||
          types.isProxy(recoverTransitionDescriptor.value)
        ) {
          throw new TypeError(
            "PM exploration transition recovery port must be direct",
          );
        }
        recoverTransition = recoverTransitionDescriptor.value;
      }
    }
    transitionCommitter = Object.freeze({
      manifestDigest: committerManifestDigest,
      commitTransition: ownDirectFunction(
        capturedCommitter,
        "commitTransition",
        "PM exploration transition committer port",
      ),
    });
    if (recoverTransition) {
      transitionRecovery = normalizeDesktopPmTransitionRecovery(
        await Reflect.apply(recoverTransition, undefined, []),
        committerManifestDigest,
      );
    }
  }
  let recoverySnapshotStore = null;
  if (pmRecoverySnapshotStoreDescriptor) {
    if (
      !("value" in pmRecoverySnapshotStoreDescriptor) ||
      pmRecoverySnapshotStoreDescriptor.enumerable !== true
    ) {
      throw new TypeError(
        "Desktop PM recovery snapshot store must be an enumerable data property",
      );
    }
    if (!pmExecutionHostDescriptor || !pmTransitionCommitterDescriptor) {
      throw new Error(
        "Desktop PM recovery snapshot store requires an execution host and transition committer",
      );
    }
    const snapshotStorePath = resolvePmExplorationRecoverySnapshotStorePath({
      isPackaged,
      resourcesPath,
    });
    const snapshotModule = await importPmExplorationRecoverySnapshotModule(
      pathToFileURL(snapshotStorePath).href,
    );
    const captureSnapshotStore = ownDirectFunction(
      snapshotModule,
      "capturePmExplorationRecoverySnapshotStore",
      "PM recovery snapshot store capture",
    );
    const capturedSnapshotStore = Reflect.apply(
      captureSnapshotStore,
      undefined,
      [pmRecoverySnapshotStoreDescriptor.value],
    );
    recoverySnapshotStore = Object.freeze({
      manifestDigest: sha256Digest(
        ownData(
          capturedSnapshotStore,
          "manifestDigest",
          "PM recovery snapshot store manifest digest",
        ),
        "PM recovery snapshot store manifest digest",
      ),
      retainTransitionSnapshot: ownDirectFunction(
        capturedSnapshotStore,
        "retainTransitionSnapshot",
        "PM recovery snapshot retention port",
      ),
    });
  }
  if (pmExecutionHostDescriptor) {
    if (
      !("value" in pmExecutionHostDescriptor) ||
      pmExecutionHostDescriptor.enumerable !== true
    ) {
      throw new TypeError(
        "Desktop PM exploration execution host must be an enumerable data property",
      );
    }
    const executionHostPath = resolvePmExplorationExecutionHostPath({
      isPackaged,
      resourcesPath,
    });
    const executionModule = await importPmExplorationExecutionModule(
      pathToFileURL(executionHostPath).href,
    );
    desktopDependencies.desktopPmExplorationExecutionHost =
      createDesktopPmExplorationExecutionHost(
        pmExecutionHostDescriptor.value,
        executionModule,
        capturePmPreRunSeal,
        transitionCommitter,
        transitionRecovery,
        recoverySnapshotStore,
        capturePmRecoverySnapshot,
      );
  }
  const composition = result.evolvableArtifactRuntimeComposition;
  if (
    composition === undefined &&
    Object.keys(desktopDependencies).length > 0
  ) {
    return Object.freeze(desktopDependencies);
  }
  if (!isEvolvableArtifactRuntimeComposition(composition)) {
    throw new Error(
      "desktop evolution deployment must return a branded runtime composition",
    );
  }
  const dependencies = getEvolvableArtifactRuntimeDependencies(composition);
  for (const type of ["Skill", "Prompt", "Hook"]) {
    if (!dependencies[`evolvableArtifact${type}ActiveReleaseReader`]) {
      throw new Error(
        `desktop evolution deployment is missing ${type} runtime`,
      );
    }
    if (!dependencies[`evolvableArtifact${type}LifecycleProducer`]) {
      throw new Error(
        `desktop evolution deployment is missing ${type} lifecycle producer`,
      );
    }
  }
  return Object.freeze({ ...dependencies, ...desktopDependencies });
}

module.exports = {
  evaluateDesktopPmExplorationMemory,
  executeDesktopPmExplorationRound,
  inspectDesktopPmExplorationStorageHost,
  inspectDesktopPmExplorationExecutionHost,
  isDesktopPmExplorationExecutionHost,
  isDesktopPmExplorationStorageHost,
  loadDesktopEvolutionDependencies,
  mergeDesktopPmExplorationBranches,
  resolvePmExplorationExecutionHostPath,
  resolvePmExplorationLedgerAdapterPath,
  resolvePmExplorationRecoverySnapshotStorePath,
  resolvePmExplorationTransitionCommitterPath,
  resolveLoaderPath,
};
