import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";

import { verifyPmExplorationRecoverySnapshotAck } from "./pm-exploration-recovery-snapshot-store.js";

export const PM_EXPLORATION_SUCCESS_TRANSITION_SCHEMA =
  "chainlesschain.desktop-pm-state-transition-success/v1";
export const PM_EXPLORATION_FAILED_TRANSITION_SCHEMA =
  "chainlesschain.desktop-pm-failed-execution-evidence/v1";
export const PM_EXPLORATION_TRANSITION_DURABILITY_ACK_SCHEMA =
  "chainlesschain.pm-exploration-transition-durability-ack/v1";
export const PM_EXPLORATION_SNAPSHOT_BOUND_TRANSITION_DURABILITY_ACK_SCHEMA =
  "chainlesschain.pm-exploration-transition-durability-ack/v2";
export const PM_EXPLORATION_TRANSITION_RECOVERY_REQUEST_SCHEMA =
  "chainlesschain.pm-exploration-transition-recovery-request/v1";
export const PM_EXPLORATION_TRANSITION_RECOVERY_SCHEMA =
  "chainlesschain.pm-exploration-transition-recovery/v1";

const DATABASE_SEAL_SCHEMA =
  "chainlesschain.desktop-pm-database-pre-run-seal/v1";
const DATABASE_TRANSITION_DOMAIN =
  "chainlesschain.desktop-pm-database-transition/v1";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024 * 1024;
const COMMITTERS = new WeakMap();

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

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
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
        !descriptor.enumerable ||
        !("value" in descriptor)
      );
    })
  ) {
    throw new TypeError(`${label} has unexpected or accessor fields`);
  }
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function optionalDigest(value, label) {
  return value === null ? null : digest(value, label);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function databaseSeal(value, label) {
  exact(
    value,
    [
      "schema",
      "databasePathDigest",
      "databaseSnapshotDigest",
      "databaseSnapshotBytes",
      "snapshotMethod",
      "sealDigest",
    ],
    label,
  );
  if (
    value.schema !== DATABASE_SEAL_SCHEMA ||
    value.snapshotMethod !== "database-manager-backup" ||
    !Number.isSafeInteger(value.databaseSnapshotBytes) ||
    value.databaseSnapshotBytes < 1 ||
    value.databaseSnapshotBytes > MAX_SNAPSHOT_BYTES
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  const core = {
    schema: value.schema,
    databasePathDigest: digest(
      value.databasePathDigest,
      `${label} databasePathDigest`,
    ),
    databaseSnapshotDigest: digest(
      value.databaseSnapshotDigest,
      `${label} databaseSnapshotDigest`,
    ),
    databaseSnapshotBytes: value.databaseSnapshotBytes,
    snapshotMethod: value.snapshotMethod,
  };
  const seal = deepFreeze({
    ...core,
    sealDigest: digest(value.sealDigest, `${label} sealDigest`),
  });
  if (seal.sealDigest !== hash(DATABASE_SEAL_SCHEMA, core))
    throw new Error(`${label} digest mismatch`);
  return seal;
}

function successTransition(value, expectedManifestDigest) {
  exact(
    value,
    [
      "schema",
      "manifestDigest",
      "executionReceiptDigest",
      "graderReceiptDigest",
      "preRunSeal",
      "postRunSeal",
      "databaseChanged",
      "previousStateTransitionDigest",
      "stateTransitionDigest",
      "authenticated",
      "durable",
      "qualifiesForPromotion",
    ],
    "PM success transition evidence",
  );
  if (
    value.schema !== PM_EXPLORATION_SUCCESS_TRANSITION_SCHEMA ||
    value.manifestDigest !== expectedManifestDigest ||
    typeof value.databaseChanged !== "boolean" ||
    value.authenticated !== false ||
    value.durable !== false ||
    value.qualifiesForPromotion !== false
  ) {
    throw new Error("PM success transition evidence fields are invalid");
  }
  const preRunSeal = databaseSeal(value.preRunSeal, "PM pre-run seal");
  const postRunSeal = databaseSeal(value.postRunSeal, "PM post-run seal");
  if (postRunSeal.databasePathDigest !== preRunSeal.databasePathDigest)
    throw new Error("PM success transition changed database identity");
  const databaseChanged =
    postRunSeal.databaseSnapshotDigest !== preRunSeal.databaseSnapshotDigest;
  if (databaseChanged !== value.databaseChanged)
    throw new Error("PM success transition databaseChanged is inconsistent");
  const core = {
    manifestDigest: digest(value.manifestDigest, "manifestDigest"),
    executionReceiptDigest: digest(
      value.executionReceiptDigest,
      "executionReceiptDigest",
    ),
    graderReceiptDigest: digest(
      value.graderReceiptDigest,
      "graderReceiptDigest",
    ),
    preRunSealDigest: preRunSeal.sealDigest,
    postRunSealDigest: postRunSeal.sealDigest,
    previousStateTransitionDigest: optionalDigest(
      value.previousStateTransitionDigest,
      "previousStateTransitionDigest",
    ),
  };
  const stateTransitionDigest = digest(
    value.stateTransitionDigest,
    "stateTransitionDigest",
  );
  if (stateTransitionDigest !== hash(DATABASE_TRANSITION_DOMAIN, core, false))
    throw new Error("PM success transition digest mismatch");
  return deepFreeze({
    schema: value.schema,
    manifestDigest: core.manifestDigest,
    executionReceiptDigest: core.executionReceiptDigest,
    graderReceiptDigest: core.graderReceiptDigest,
    preRunSeal,
    postRunSeal,
    databaseChanged,
    previousStateTransitionDigest: core.previousStateTransitionDigest,
    stateTransitionDigest,
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
  });
}

function failedTransition(value, expectedManifestDigest) {
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
    "PM failed transition evidence",
  );
  if (
    value.schema !== PM_EXPLORATION_FAILED_TRANSITION_SCHEMA ||
    value.manifestDigest !== expectedManifestDigest ||
    value.failureClass !== "execution-or-evidence-failed" ||
    value.authenticated !== false ||
    value.durable !== false ||
    value.qualifiesForPromotion !== false
  ) {
    throw new Error("PM failed transition evidence fields are invalid");
  }
  const preRunSeal = databaseSeal(value.preRunSeal, "PM pre-run seal");
  const failureSeal =
    value.failureSeal === null
      ? null
      : databaseSeal(value.failureSeal, "PM failure seal");
  const databaseIdentityUnchanged =
    failureSeal === null
      ? null
      : failureSeal.databasePathDigest === preRunSeal.databasePathDigest;
  const databaseChanged =
    failureSeal === null || !databaseIdentityUnchanged
      ? null
      : failureSeal.databaseSnapshotDigest !==
        preRunSeal.databaseSnapshotDigest;
  if (
    value.databaseIdentityUnchanged !== databaseIdentityUnchanged ||
    value.databaseChanged !== databaseChanged
  ) {
    throw new Error("PM failed transition database state is inconsistent");
  }
  const previousStateTransitionDigest = optionalDigest(
    value.previousStateTransitionDigest,
    "previousStateTransitionDigest",
  );
  const core = {
    schema: value.schema,
    manifestDigest: digest(value.manifestDigest, "manifestDigest"),
    preRunSeal,
    failureSeal,
    databaseIdentityUnchanged,
    databaseChanged,
    previousStateTransitionDigest,
    failureClass: value.failureClass,
    authenticated: false,
    durable: false,
    qualifiesForPromotion: false,
  };
  const evidenceDigest = digest(value.evidenceDigest, "evidenceDigest");
  if (
    evidenceDigest !==
    hash(PM_EXPLORATION_FAILED_TRANSITION_SCHEMA, core, false)
  ) {
    throw new Error("PM failed transition evidence digest mismatch");
  }
  return deepFreeze({ ...core, evidenceDigest });
}

export function verifyPmExplorationTransitionEvidence(
  value,
  expectedManifestDigest,
) {
  const manifestDigest = digest(expectedManifestDigest, "manifestDigest");
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value)
  ) {
    throw new TypeError("PM transition evidence must be a plain object");
  }
  const schema = Object.getOwnPropertyDescriptor(value, "schema");
  if (!schema || !("value" in schema))
    throw new TypeError("PM transition evidence schema must be plain data");
  if (schema.value === PM_EXPLORATION_SUCCESS_TRANSITION_SCHEMA)
    return successTransition(value, manifestDigest);
  if (schema.value === PM_EXPLORATION_FAILED_TRANSITION_SCHEMA)
    return failedTransition(value, manifestDigest);
  throw new TypeError("PM transition evidence schema is invalid");
}

function durabilityAck(value, binding) {
  const snapshotBound = binding.recoverySnapshot !== null;
  exact(
    value,
    snapshotBound
      ? [
          "schema",
          "authenticated",
          "durable",
          "readbackVerified",
          "manifestDigest",
          "evidenceDigest",
          "transitionKind",
          "recoverySnapshotAckDigest",
          "ledgerEventDigest",
          "durabilityReceiptDigest",
          "qualifiesForPromotion",
        ]
      : [
          "schema",
          "authenticated",
          "durable",
          "readbackVerified",
          "manifestDigest",
          "evidenceDigest",
          "transitionKind",
          "ledgerEventDigest",
          "durabilityReceiptDigest",
          "qualifiesForPromotion",
        ],
    "PM transition durability acknowledgement",
  );
  if (
    value.schema !==
      (snapshotBound
        ? PM_EXPLORATION_SNAPSHOT_BOUND_TRANSITION_DURABILITY_ACK_SCHEMA
        : PM_EXPLORATION_TRANSITION_DURABILITY_ACK_SCHEMA) ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.manifestDigest !== binding.manifestDigest ||
    value.evidenceDigest !== binding.evidenceDigest ||
    value.transitionKind !== binding.transitionKind ||
    !DIGEST.test(value.ledgerEventDigest ?? "") ||
    !DIGEST.test(value.durabilityReceiptDigest ?? "") ||
    value.qualifiesForPromotion !== false
  ) {
    throw new Error("PM transition durability acknowledgement is invalid");
  }
  if (
    snapshotBound &&
    value.recoverySnapshotAckDigest !==
      binding.recoverySnapshot.snapshotAckDigest
  ) {
    throw new Error(
      "PM transition durability acknowledgement snapshot binding is invalid",
    );
  }
  return deepFreeze({ ...value });
}

function transitionRecovery(value, expectedManifestDigest) {
  exact(
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
    "PM transition recovery",
  );
  if (
    value.schema !== PM_EXPLORATION_TRANSITION_RECOVERY_SCHEMA ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.readbackVerified !== true ||
    value.manifestDigest !== expectedManifestDigest ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    ![null, "success", "failure"].includes(value.transitionKind) ||
    !DIGEST.test(value.ledgerHeadDigest ?? "") ||
    value.qualifiesForPromotion !== false
  ) {
    throw new Error("PM transition recovery is invalid");
  }
  if (value.transitionKind === null) {
    if (
      value.revision !== 0 ||
      value.evidenceDigest !== null ||
      value.evidence !== null ||
      value.ledgerEventDigest !== null ||
      value.durabilityReceiptDigest !== null
    ) {
      throw new Error("empty PM transition recovery is inconsistent");
    }
    return deepFreeze({ ...value });
  }
  if (
    value.revision < 1 ||
    !DIGEST.test(value.evidenceDigest ?? "") ||
    !DIGEST.test(value.ledgerEventDigest ?? "") ||
    !DIGEST.test(value.durabilityReceiptDigest ?? "")
  ) {
    throw new Error("PM transition recovery evidence is incomplete");
  }
  const evidence = verifyPmExplorationTransitionEvidence(
    value.evidence,
    expectedManifestDigest,
  );
  const transitionKind =
    evidence.schema === PM_EXPLORATION_SUCCESS_TRANSITION_SCHEMA
      ? "success"
      : "failure";
  const evidenceDigest =
    transitionKind === "success"
      ? evidence.stateTransitionDigest
      : evidence.evidenceDigest;
  if (
    value.transitionKind !== transitionKind ||
    value.evidenceDigest !== evidenceDigest
  ) {
    throw new Error("PM transition recovery evidence binding is invalid");
  }
  return deepFreeze({ ...value, evidence });
}

export function createPmExplorationTransitionCommitter(input = {}) {
  const inspectableInput =
    input &&
    typeof input === "object" &&
    !Array.isArray(input) &&
    !isProxy(input) &&
    Object.getPrototypeOf(input) === Object.prototype;
  const recoverDescriptor = inspectableInput
    ? Object.getOwnPropertyDescriptor(input, "recover")
    : null;
  exact(
    input,
    recoverDescriptor
      ? ["manifestDigest", "commit", "recover"]
      : ["manifestDigest", "commit"],
    "PM transition committer input",
  );
  const expectedManifestDigest = digest(input.manifestDigest, "manifestDigest");
  if (typeof input.commit !== "function" || isProxy(input.commit))
    throw new TypeError("PM transition commit must be a direct function");
  if (
    recoverDescriptor &&
    (typeof input.recover !== "function" || isProxy(input.recover))
  ) {
    throw new TypeError("PM transition recovery must be a direct function");
  }
  const committer = Object.freeze({});
  COMMITTERS.set(
    committer,
    Object.freeze({
      manifestDigest: expectedManifestDigest,
      commit: input.commit,
      recover: recoverDescriptor ? input.recover : null,
    }),
  );
  return committer;
}

export function capturePmExplorationTransitionCommitter(value) {
  const captured = COMMITTERS.get(value);
  if (!captured)
    throw new TypeError("a branded PM transition committer is required");
  return Object.freeze({
    manifestDigest: captured.manifestDigest,
    commitTransition: async (input, recoverySnapshotInput = null) => {
      const evidence = verifyPmExplorationTransitionEvidence(
        input,
        captured.manifestDigest,
      );
      const transitionKind =
        evidence.schema === PM_EXPLORATION_SUCCESS_TRANSITION_SCHEMA
          ? "success"
          : "failure";
      const evidenceDigest =
        transitionKind === "success"
          ? evidence.stateTransitionDigest
          : evidence.evidenceDigest;
      const recoverySnapshot =
        recoverySnapshotInput === null
          ? null
          : verifyPmExplorationRecoverySnapshotAck(recoverySnapshotInput, {
              manifestDigest: captured.manifestDigest,
              transitionKind,
              evidenceDigest,
              sealDigest:
                transitionKind === "success"
                  ? evidence.postRunSeal.sealDigest
                  : evidence.preRunSeal.sealDigest,
            });
      const acknowledgement = await Reflect.apply(captured.commit, undefined, [
        evidence,
        ...(recoverySnapshot === null ? [] : [recoverySnapshot]),
      ]);
      return durabilityAck(acknowledgement, {
        manifestDigest: captured.manifestDigest,
        evidenceDigest,
        transitionKind,
        recoverySnapshot,
      });
    },
    recoverTransition:
      captured.recover === null
        ? null
        : async () => {
            const request = Object.freeze({
              schema: PM_EXPLORATION_TRANSITION_RECOVERY_REQUEST_SCHEMA,
              manifestDigest: captured.manifestDigest,
            });
            const recovered = await Reflect.apply(captured.recover, undefined, [
              request,
            ]);
            return transitionRecovery(recovered, captured.manifestDigest);
          },
  });
}
