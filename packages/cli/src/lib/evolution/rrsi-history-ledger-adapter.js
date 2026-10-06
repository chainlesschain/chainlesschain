/** Durable RRSI controls. Recording history never grants model or promotion authority. */
import {
  KeyObject,
  createHash,
  createPublicKey,
  verify as verifySignature,
} from "node:crypto";
import { isProxy } from "node:util/types";
import path from "node:path";
import { withFileLock } from "../with-file-lock.js";
import {
  EvolutionLedger,
  EVOLUTION_LEDGER_MAX_EVENTS,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_ARTIFACT_REF_SCHEMA,
} from "./evolution-ledger.js";
import { captureEvolutionLedgerFileBackend } from "./evolution-ledger-file-backend.js";
import { isEvolutionLedgerV2Journal } from "./evolution-ledger-v2-journal.js";
import {
  EvolutionArtifactPorts,
  isEvolutionLedgerArtifactResolver,
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
} from "./evolution-artifact-ports.js";
import {
  RRSI_PARTITIONS,
  RRSI_BUDGET_FIELDS,
  verifyRrsiCampaign,
  verifyRrsiCandidate,
} from "./rrsi-contracts.js";
import {
  isRrsiPreparationReservation,
  RRSI_PREPARATION_SETTLEMENT_SCHEMA,
  RRSI_PREPARATION_PHASES,
  RRSI_PREPARATION_BINDING_FIELDS,
  normalizeRrsiPreparationPlan,
  normalizeRrsiPreparationRequest,
  rrsiTrainingSourcesDigest,
} from "./rrsi-preparation-contracts.js";
import {
  snapshotRrsiData,
  rrsiExact,
  rrsiId,
  rrsiDigest,
  rrsiInteger,
  rrsiBoolean,
  rrsiHash,
  rrsiCanonical,
  rrsiEnvelope,
  freezeRrsiData,
  rrsiFail,
} from "./rrsi-data.js";
import {
  RRSI_NATIVE_RESERVATION_SCHEMA,
  RRSI_NATIVE_SETTLEMENT_SCHEMA,
  RRSI_NATIVE_EXECUTION_UNITS,
  isRrsiNativeReservation,
  rrsiNativeUnitCount,
  buildRrsiNativeEvaluationBatch,
  normalizeRrsiNativeEvaluationBatch,
} from "./rrsi-native-evaluation-batch.js";

export const RRSI_HISTORY_EVENT_SCHEMA = "chainlesschain.rrsi-history-event/v1";
export const RRSI_HISTORY_STATUS_SCHEMA =
  "chainlesschain.rrsi-history-status/v1";
export const RRSI_RESERVATION_SCHEMA = "chainlesschain.rrsi-reservation/v1";
export const RRSI_SETTLEMENT_SCHEMA = "chainlesschain.rrsi-settlement/v1";
export const RRSI_HISTORY_EVENT_TYPE = "rrsi.history.committed";
const ARTIFACT_TYPE = "rrsi-history-event";
const VERIFIERS = new WeakMap();
const ADAPTERS = new WeakMap();

/** Capture only methods of an already composed, genuine history adapter. */
export function captureRrsiHistoryLedgerAdapter(value) {
  const captured = ADAPTERS.get(value);
  if (!captured) rrsiFail("a branded RRSI history adapter is required");
  return captured;
}
const USAGE_FIELDS = [
  "tokens",
  "toolCalls",
  "wallClockMs",
  "costMicrounits",
  "executions",
];
const USAGE_TO_BUDGET = Object.fromEntries(
  USAGE_FIELDS.map((key, index) => [key, RRSI_BUDGET_FIELDS[index]]),
);
const FLAGS = [
  "structuralOnly",
  "authenticated",
  "readyForExecution",
  "qualifiesForPromotion",
];

function ownOptions(input, keys) {
  if (
    !input ||
    typeof input !== "object" ||
    isProxy(input) ||
    Object.getPrototypeOf(input) !== Object.prototype
  )
    rrsiFail("RRSI composition options must be plain own data fields");
  if (Reflect.ownKeys(input).length !== keys.length)
    rrsiFail("RRSI composition fields differ");
  return Object.fromEntries(
    keys.map((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      if (!descriptor?.enumerable || !("value" in descriptor))
        rrsiFail("RRSI composition cannot use accessors");
      return [key, descriptor.value];
    }),
  );
}

function timestamp(value, label) {
  if (
    typeof value !== "string" ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    rrsiFail(`${label} must be a canonical timestamp`);
  return value;
}

function budget(value, label) {
  rrsiExact(value, RRSI_BUDGET_FIELDS, label);
  return Object.fromEntries(
    RRSI_BUDGET_FIELDS.map((key) => [
      key,
      rrsiInteger(value[key], `${label}.${key}`),
    ]),
  );
}

function digestList(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 64)
    rrsiFail(`${label} must be a bounded nonempty list`);
  const result = value.map((entry) => rrsiDigest(entry, label)).sort();
  if (new Set(result).size !== result.length)
    rrsiFail(`${label} contains duplicate digests`);
  return result;
}

/** Genuine v2 journals use null-prototype JSON refs. Copy their exact typed fields. */
function copyRetainedRef(input) {
  if (
    !input ||
    typeof input !== "object" ||
    isProxy(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Reflect.ownKeys(input).length !== 3
  )
    rrsiFail("history artifact reference is invalid");
  const output = Object.fromEntries(
    ["schema", "ref", "digest"].map((name) => {
      const field = Object.getOwnPropertyDescriptor(input, name);
      if (
        !field?.enumerable ||
        !("value" in field) ||
        typeof field.value !== "string"
      )
        rrsiFail("history artifact reference must be own data");
      return [name, field.value];
    }),
  );
  if (
    output.schema !== EVOLUTION_ARTIFACT_REF_SCHEMA ||
    output.ref.length > 2048 ||
    !/^[a-z][a-z0-9+.-]*:[^\\\s]+$/iu.test(output.ref)
  )
    rrsiFail("history artifact reference scope differs");
  rrsiDigest(output.digest, "history artifact reference digest");
  return output;
}

/** Trusted composition pins this independent public key; no caller callbacks. */
export function createRrsiSettlementVerifier(input) {
  const options = ownOptions(input, [
    "publicKey",
    "authorityId",
    "trustPolicyDigest",
  ]);
  if (
    options.publicKey &&
    typeof options.publicKey === "object" &&
    isProxy(options.publicKey)
  )
    rrsiFail("settlement public key cannot be a Proxy");
  const publicKey =
    options.publicKey instanceof KeyObject &&
    options.publicKey.type === "public"
      ? options.publicKey
      : createPublicKey(options.publicKey);
  if (publicKey.asymmetricKeyType !== "ed25519")
    rrsiFail("RRSI settlement requires Ed25519");
  const descriptor = freezeRrsiData({
    authorityId: rrsiId(options.authorityId, "settlement authority"),
    trustPolicyDigest: rrsiDigest(
      options.trustPolicyDigest,
      "settlement trust policy",
    ),
    publicKeyDigest: `sha256:${createHash("sha256")
      .update(publicKey.export({ format: "der", type: "spki" }))
      .digest("hex")}`,
  });
  const verifier = Object.freeze({ descriptor });
  VERIFIERS.set(verifier, { publicKey, descriptor });
  return verifier;
}

function settlementCore(input) {
  const value = snapshotRrsiData(input);
  if (value.schema === RRSI_NATIVE_SETTLEMENT_SCHEMA) {
    rrsiExact(
      value,
      [
        "schema",
        "receiptId",
        "bindings",
        "statusByArm",
        "cleanupConfirmedByArm",
        "usageByArm",
        "executionUnitsByArm",
        "sourceReceiptDigests",
        "issuedAt",
        "validUntil",
      ],
      "native child settlement core",
    );
    rrsiId(value.receiptId, "native receipt ID");
    rrsiExact(
      value.bindings,
      [
        "tenantId",
        "scopeId",
        "ledgerId",
        "identityDigest",
        "epoch",
        "campaignDigest",
        "batchDigest",
        "childId",
        "requestDigest",
        "evaluationContextDigest",
        "attributionDigest",
        "armReservationDigests",
      ],
      "native child settlement bindings",
    );
    for (const name of ["tenantId", "scopeId", "childId"])
      rrsiId(value.bindings[name], name);
    for (const name of ["ledgerId", "epoch"])
      if (
        typeof value.bindings[name] !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value.bindings[name])
      )
        rrsiFail(`invalid native ${name}`);
    for (const name of [
      "identityDigest",
      "campaignDigest",
      "batchDigest",
      "requestDigest",
      "evaluationContextDigest",
      "attributionDigest",
    ])
      rrsiDigest(value.bindings[name], name);
    const arms = Object.keys(value.bindings.armReservationDigests ?? {});
    if (
      arms.length !== 2 ||
      arms.some((arm) => !["baseline", "rsi", "rrsi"].includes(arm))
    )
      rrsiFail("native child settlement needs both frozen arms");
    rrsiExact(
      value.bindings.armReservationDigests,
      arms,
      "native arm reservations",
    );
    for (const digest of Object.values(value.bindings.armReservationDigests))
      rrsiDigest(digest, "arm reservation digest");
    for (const name of [
      "statusByArm",
      "cleanupConfirmedByArm",
      "usageByArm",
      "executionUnitsByArm",
    ])
      rrsiExact(value[name], arms, name);
    for (const arm of arms) {
      if (
        ![
          "succeeded",
          "failed",
          "cancelled",
          "not-started",
          "unknown",
        ].includes(value.statusByArm[arm])
      )
        rrsiFail("invalid native settlement status");
      rrsiBoolean(value.cleanupConfirmedByArm[arm], "native cleanup");
      rrsiExact(value.usageByArm[arm], USAGE_FIELDS, "native arm usage");
      for (const amount of Object.values(value.usageByArm[arm]))
        if (amount !== null) rrsiInteger(amount, "native usage");
      rrsiExact(
        value.executionUnitsByArm[arm],
        RRSI_NATIVE_EXECUTION_UNITS,
        "native settlement execution units",
      );
      for (const amount of Object.values(value.executionUnitsByArm[arm]))
        if (amount !== null) rrsiInteger(amount, "native execution units");
      const complete = RRSI_NATIVE_EXECUTION_UNITS.every(
        (name) => value.executionUnitsByArm[arm][name] !== null,
      );
      if (
        complete
          ? value.usageByArm[arm].executions !==
            rrsiNativeUnitCount(value.executionUnitsByArm[arm])
          : value.usageByArm[arm].executions !== null
      )
        rrsiFail(
          "native execution usage must match the typed charged-unit vector",
        );
    }
    value.sourceReceiptDigests = digestList(
      value.sourceReceiptDigests,
      "native child source receipts",
    );
    timestamp(value.issuedAt, "issuedAt");
    timestamp(value.validUntil, "validUntil");
    if (Date.parse(value.validUntil) < Date.parse(value.issuedAt))
      rrsiFail("native settlement validity window is reversed");
    return value;
  }
  rrsiExact(
    value,
    [
      "schema",
      "receiptId",
      "bindings",
      "status",
      "cleanupConfirmed",
      "usage",
      "sourceReceiptDigests",
      "issuedAt",
      "validUntil",
    ],
    "settlement core",
  );
  const preparation = value.schema === RRSI_PREPARATION_SETTLEMENT_SCHEMA;
  if (!preparation && value.schema !== RRSI_SETTLEMENT_SCHEMA)
    rrsiFail("RRSI settlement schema differs");
  rrsiId(value.receiptId, "settlement receipt ID");
  rrsiExact(
    value.bindings,
    [
      "tenantId",
      "scopeId",
      "ledgerId",
      "identityDigest",
      "epoch",
      "campaignDigest",
      ...(preparation
        ? RRSI_PREPARATION_BINDING_FIELDS
        : ["candidateDigest", "contentDigest"]),
      "executionDigest",
      "reservationDigest",
      "executionId",
      "slotId",
      "partition",
    ],
    "settlement bindings",
  );
  for (const key of [
    "tenantId",
    "scopeId",
    "executionId",
    "slotId",
    ...(preparation ? ["roundId", "branchId"] : []),
  ])
    rrsiId(value.bindings[key], key);
  for (const key of ["ledgerId", "epoch"])
    if (
      typeof value.bindings[key] !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u.test(value.bindings[key])
    )
      rrsiFail(`invalid settlement ${key}`);
  rrsiDigest(value.bindings.identityDigest, "ledger identity digest");
  for (const key of [
    "campaignDigest",
    ...(preparation
      ? RRSI_PREPARATION_BINDING_FIELDS.filter((key) => key.endsWith("Digest"))
      : ["candidateDigest", "contentDigest"]),
    "executionDigest",
    "reservationDigest",
  ])
    rrsiDigest(value.bindings[key], key);
  if (
    preparation
      ? value.bindings.partition !== "train" ||
        !RRSI_PREPARATION_PHASES.includes(value.bindings.phase)
      : !RRSI_PARTITIONS.includes(value.bindings.partition) ||
        value.bindings.partition === "train"
  )
    rrsiFail("invalid settlement partition");
  if (
    !["succeeded", "failed", "cancelled", "not-started", "unknown"].includes(
      value.status,
    )
  )
    rrsiFail("invalid settlement status");
  rrsiBoolean(value.cleanupConfirmed, "settlement cleanup");
  rrsiExact(value.usage, USAGE_FIELDS, "settlement usage");
  for (const key of USAGE_FIELDS)
    if (value.usage[key] !== null) rrsiInteger(value.usage[key], key);
  value.sourceReceiptDigests = digestList(
    value.sourceReceiptDigests,
    "source receipt digests",
  );
  timestamp(value.issuedAt, "issuedAt");
  timestamp(value.validUntil, "validUntil");
  if (Date.parse(value.validUntil) < Date.parse(value.issuedAt))
    rrsiFail("settlement validity window is reversed");
  return value;
}

export function buildRrsiSettlementMessage(core, authorityInput) {
  const normalized = settlementCore(core);
  const authority = snapshotRrsiData(authorityInput);
  rrsiExact(
    authority,
    ["authorityId", "trustPolicyDigest", "publicKeyDigest"],
    "signed settlement authority",
  );
  rrsiId(authority.authorityId, "signed authority ID");
  rrsiDigest(authority.trustPolicyDigest, "signed policy digest");
  rrsiDigest(authority.publicKeyDigest, "signed public key digest");
  return Buffer.from(
    `${normalized.schema}\0${rrsiCanonical(authority)}\0${rrsiCanonical(normalized)}`,
    "utf8",
  );
}

function verifySettlement(verifier, input, reservation, acceptanceTime) {
  const authority = VERIFIERS.get(verifier);
  if (!authority)
    rrsiFail(
      "independent settlement verification is unavailable",
      "CC_RRSI_SETTLEMENT_UNAVAILABLE",
    );
  const evidence = snapshotRrsiData(input);
  rrsiExact(evidence, ["core", "attestation"], "signed settlement");
  const core = settlementCore(evidence.core);
  const expectedSchema = isRrsiPreparationReservation(reservation)
    ? RRSI_PREPARATION_SETTLEMENT_SCHEMA
    : isRrsiNativeReservation(reservation)
      ? RRSI_NATIVE_SETTLEMENT_SCHEMA
      : RRSI_SETTLEMENT_SCHEMA;
  if (core.schema !== expectedSchema)
    rrsiFail(
      "settlement domain differs from reservation",
      "CC_RRSI_SETTLEMENT_INVALID",
    );
  rrsiExact(
    evidence.attestation,
    ["authorityId", "trustPolicyDigest", "publicKeyDigest", "signature"],
    "settlement attestation",
  );
  for (const key of Object.keys(authority.descriptor))
    if (evidence.attestation[key] !== authority.descriptor[key])
      rrsiFail("settlement authority differs", "CC_RRSI_SETTLEMENT_INVALID");
  const signature = evidence.attestation.signature;
  if (
    typeof signature !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/u.test(signature) ||
    Buffer.from(signature, "base64url").toString("base64url") !== signature ||
    !verifySignature(
      null,
      buildRrsiSettlementMessage(core, authority.descriptor),
      authority.publicKey,
      Buffer.from(signature, "base64url"),
    )
  )
    rrsiFail(
      "settlement signature verification failed",
      "CC_RRSI_SETTLEMENT_INVALID",
    );
  if (rrsiCanonical(core.bindings) !== rrsiCanonical(reservation.bindings))
    rrsiFail(
      "settlement does not bind the reserved execution",
      "CC_RRSI_SETTLEMENT_INVALID",
    );
  // Historical reads use the authenticated original acceptance time, not today.
  if (
    Date.parse(acceptanceTime) < Date.parse(core.issuedAt) ||
    Date.parse(acceptanceTime) > Date.parse(core.validUntil)
  )
    rrsiFail(
      "settlement was outside its acceptance window",
      "CC_RRSI_SETTLEMENT_INVALID",
    );
  return { evidence: { core, attestation: evidence.attestation }, core };
}

function sourceKeys(campaign, partition) {
  const keys = new Set();
  for (const task of campaign.dataset.tasks.filter(
    (task) => task.partition === partition,
  )) {
    keys.add(`content:${task.contentDigest}`);
    for (const [dimension, group] of Object.entries(task.groups))
      keys.add(`${dimension}:${group}`);
  }
  return [...keys].sort();
}

function sameIdentity(left, right) {
  return [
    "ledgerId",
    "identityDigest",
    "epoch",
    "sequence",
    "headDigest",
  ].every((key) => left[key] === right[key]);
}

/** Only caller-owned branded storage is accepted. A migrated v2 journal stays v2. */
export function createRrsiHistoryLedgerAdapter(input) {
  const options = ownOptions(input, [
    "backend",
    "artifactPorts",
    "ledgerArtifactResolver",
    "descriptor",
    "settlementVerifier",
    "now",
  ]);
  const backend = captureEvolutionLedgerFileBackend(options.backend);
  if (
    isProxy(options.artifactPorts) ||
    !(options.artifactPorts instanceof EvolutionArtifactPorts) ||
    !isEvolutionLedgerArtifactResolver(options.ledgerArtifactResolver) ||
    typeof options.now !== "function" ||
    isProxy(options.now)
  )
    rrsiFail("RRSI history requires trusted storage composition");
  if (
    options.settlementVerifier !== null &&
    !VERIFIERS.has(options.settlementVerifier)
  )
    rrsiFail("RRSI history requires a branded independent settlement verifier");
  const configured = snapshotRrsiData(options.descriptor);
  rrsiExact(
    configured,
    ["tenantId", "artifactTenantId", "goalId", "audience", "purpose"],
    "history descriptor",
  );
  for (const key of Object.keys(configured)) rrsiId(configured[key], key);
  if (configured.purpose !== "evolution-ledger")
    rrsiFail("RRSI history requires Ledger retention");
  if (!/^[a-z][a-z0-9-]{0,127}$/u.test(configured.goalId))
    rrsiFail("history goal must be a canonical artifact target");
  const descriptor = freezeRrsiData({
    ...configured,
    // Stable per tenant/goal, independent of caller candidate/campaign/dataset IDs.
    scopeId: `rrsi.${rrsiHash("chainlesschain.rrsi-history-scope/v1", { tenantId: configured.tenantId, goalId: configured.goalId }).slice(7)}`,
    settlementAuthority: options.settlementVerifier?.descriptor ?? null,
  });
  const ledger = backend.ledger;
  const methods = {};
  for (const name of ["read", "verify", "appendDomainEvent"]) {
    if (ledger instanceof EvolutionLedger)
      methods[name] = (...args) =>
        Reflect.apply(EvolutionLedger.prototype[name], ledger, args);
    else if (isEvolutionLedgerV2Journal(ledger)) {
      const method = Object.getOwnPropertyDescriptor(ledger, name)?.value;
      if (typeof method !== "function")
        rrsiFail("RRSI history v2 method is missing");
      methods[name] = (...args) => Reflect.apply(method, ledger, args);
    } else
      rrsiFail("RRSI history requires the branded backend's original journal");
  }
  const freshReservations = new WeakMap();
  const freshNativeChildren = new WeakMap();
  // ArtifactPorts correctly rejects changing descriptor snapshots. Serialize
  // all RRSI read/publish/CAS/readback on this backend, without weakening it.
  const withHistoryLock = (operation) =>
    withFileLock(
      path.join(backend.descriptor.authorityRootDir, "rrsi-history-operations"),
      operation,
      {
        failIfUnavailable: true,
        timeoutMs: 30_000,
        retryMs: 1,
        maxRetryMs: 8,
        retryJitterMs: 4,
      },
    );
  const now = () => {
    const milliseconds = options.now();
    if (!Number.isSafeInteger(milliseconds))
      rrsiFail("RRSI history clock is invalid");
    return new Date(milliseconds).toISOString();
  };
  const scopeDigest = rrsiHash(
    "chainlesschain.rrsi-history-descriptor/v1",
    descriptor,
  );

  function emptyState(identity) {
    return {
      identity: {
        ledgerId: identity.ledgerId,
        identityDigest: identity.identityDigest,
        epoch: identity.epoch,
      },
      root: null,
      campaigns: new Map(),
      operations: new Map(),
      reservations: new Map(),
      nativeBatches: new Map(),
      nativeChildren: new Map(),
      nativeControls: null,
      nativeRecoveryHolds: new Map(),
      nativeInvocations: new Set(),
      nativeInvocationIds: new Set(),
      nativeInvocationNonces: new Set(),
      nativeRequestContexts: new Set(),
      nativeCandidateOwners: new Map(),
      nativeQueryOrdinals: new Map(),
      slots: new Set(),
      candidates: new Map(),
      finalCandidates: new Map(),
      sources: new Map(),
      receiptIds: new Set(),
      sourceReceiptOwners: new Map(),
      selectionQueries: 0,
      preparationPlan: null,
      preparationAttempts: 0,
      preparationRequests: new Set(),
      overrun: false,
      lastRecordDigest: null,
    };
  }
  function campaignFor(state, digest) {
    rrsiDigest(digest, "campaign digest");
    const campaign = state.campaigns.get(digest);
    if (!campaign)
      rrsiFail(
        "campaign has not been durably registered",
        "CC_RRSI_UNREGISTERED",
      );
    return campaign;
  }
  function reservationFor(state, executionId, digest) {
    rrsiId(executionId, "execution ID");
    rrsiDigest(digest, "reservation digest");
    const value = state.reservations.get(executionId);
    if (!value || value.reservation.reservationDigest !== digest)
      rrsiFail("reserved execution binding differs");
    return value;
  }
  function charges(state, stage = null, arm = null) {
    if (arm === null && state.nativeBatches.size) {
      const perArm = ["baseline", "rsi", "rrsi"].map((name) =>
        charges(state, stage, name),
      );
      return Object.fromEntries(
        RRSI_BUDGET_FIELDS.map((name) => [
          name,
          perArm.reduce(
            (max, total) => (total[name] > max ? total[name] : max),
            0n,
          ),
        ]),
      );
    }
    const totals = Object.fromEntries(
      RRSI_BUDGET_FIELDS.map((key) => [key, 0n]),
    );
    for (const entry of state.reservations.values()) {
      const native = isRrsiNativeReservation(entry.reservation);
      if (native && arm !== entry.reservation.bindings.arm) continue;
      if (
        stage &&
        stage !==
          (native
            ? entry.reservation.bindings.stage === "selection"
              ? "selection"
              : "final"
            : entry.reservation.bindings.partition === "train"
              ? "proposal"
              : entry.reservation.bindings.partition === "select"
                ? "selection"
                : "final")
      )
        continue;
      for (const [usage, ceiling] of Object.entries(USAGE_TO_BUDGET)) {
        const known = BigInt(entry.knownUsage[usage] ?? 0);
        const held =
          entry.status === "settled"
            ? known
            : BigInt(entry.reservation.budget[ceiling]);
        totals[ceiling] += known > held ? known : held;
      }
    }
    return totals;
  }
  function checkBudget(state, reserved, stage, arm = null) {
    const total = charges(state, null, arm);
    const staged = charges(state, stage, arm);
    const cap =
      stage === "proposal"
        ? state.root.budget.proposalPerExploringArm
        : stage === "selection"
          ? state.root.budget.selectionPerExploringArm
          : state.root.budget.finalEvaluationPerArm;
    for (const key of RRSI_BUDGET_FIELDS)
      if (
        total[key] + BigInt(reserved[key]) >
          BigInt(state.root.budget.totalPerArm[key]) ||
        staged[key] + BigInt(reserved[key]) > BigInt(cap[key])
      )
        rrsiFail(
          "RRSI durable resource budget is exhausted",
          "CC_RRSI_BUDGET_EXCEEDED",
        );
  }
  function checkPreparationHold(state) {
    if (
      [...state.reservations.values()].some(
        (entry) =>
          isRrsiPreparationReservation(entry.reservation) &&
          entry.status !== "settled",
      )
    )
      rrsiFail(
        "unresolved preparation requires independent settlement",
        "CC_RRSI_HISTORY_HOLD",
      );
  }
  function reserveNativeBatch(state, payload) {
    rrsiExact(payload, ["batch"], "native batch reservation");
    const campaign = campaignFor(state, payload.batch?.campaignDigest);
    const batch = normalizeRrsiNativeEvaluationBatch(payload.batch, campaign);
    if (state.finalCandidates.size > 1)
      rrsiFail(
        "native history requires a unique global finalist",
        "CC_RRSI_HISTORY_HOLD",
      );
    if (state.overrun)
      rrsiFail(
        "history contains a resource overrun",
        "CC_RRSI_BUDGET_EXCEEDED",
      );
    if (
      rrsiCanonical(campaign.experiment) !==
      rrsiCanonical(state.root.experiment)
    )
      rrsiFail("native experiment cannot reset the frozen statistical design");
    if (
      [...state.reservations.values()].some(
        (entry) => entry.status !== "settled",
      )
    )
      rrsiFail(
        "native batch requires complete preceding history accounting",
        "CC_RRSI_HISTORY_HOLD",
      );
    const slot = `${descriptor.scopeId}:native:${batch.queryId}`;
    if (state.slots.has(slot))
      rrsiFail("native query slot is already occupied", "CC_RRSI_SLOT_USED");
    const candidate = batch.candidate;
    for (const identity of [
      batch.versions.rrsi,
      batch.nativeCandidateContents.rrsi,
    ]) {
      const owner = state.nativeCandidateOwners.get(identity);
      if (owner && owner !== candidate.contentDigest)
        rrsiFail(
          "native candidate identity is already bound to another RRSI content",
          "CC_RRSI_DUPLICATE_CONTENT",
        );
    }
    for (const child of batch.children) {
      const contextKey = rrsiCanonical(child.request.evaluationContext);
      if (
        state.nativeInvocations.has(child.invocationDigest) ||
        state.nativeInvocationIds.has(child.invocationIdDigest) ||
        state.nativeInvocationNonces.has(child.invocationNonceDigest) ||
        state.nativeRequestContexts.has(contextKey)
      )
        rrsiFail(
          "native invocation or original request context has already been consumed",
          "CC_RRSI_QUERY_USED",
        );
    }
    const prior = state.candidates.get(candidate.contentDigest);
    if (prior && prior.candidateDigest !== candidate.candidateDigest)
      rrsiFail(
        "content is already bound to another candidate identity",
        "CC_RRSI_DUPLICATE_CONTENT",
      );
    const stage = batch.stage === "selection" ? "selection" : "final";
    if (stage === "selection") {
      if (state.finalCandidates.size)
        rrsiFail("frozen finalist prohibits further native selection");
      if (prior)
        rrsiFail(
          "candidate selection query has already been consumed",
          "CC_RRSI_QUERY_USED",
        );
      if (
        state.selectionQueries >=
          state.root.policy.limits.maxSelectionQueries ||
        state.candidates.size >= state.root.policy.limits.maxCandidates
      )
        rrsiFail(
          "history selection quota is exhausted",
          "CC_RRSI_QUERY_EXHAUSTED",
        );
    } else {
      if (
        state.finalCandidates.get(campaign.campaignDigest) !==
        candidate.contentDigest
      )
        rrsiFail("native final requires the unique frozen candidate");
      const selected = [...state.nativeBatches.values()].find(
        (entry) =>
          entry.stage === "selection" &&
          entry.campaignDigest === campaign.campaignDigest &&
          entry.candidate.contentDigest === candidate.contentDigest,
      );
      if (!selected)
        rrsiFail("native final cannot relabel legacy selection evidence");
      for (const field of [
        "versions",
        "nativeCandidateContents",
        "lifecycleDigests",
        "parentIdentity",
        "targetIdentity",
      ])
        if (rrsiCanonical(batch[field]) !== rrsiCanonical(selected[field]))
          rrsiFail(
            "native final changes frozen selection artifacts or runtime",
          );
      if (
        [...state.nativeBatches.values()].some(
          (entry) =>
            entry.stage === "generalization" &&
            entry.campaignDigest === campaign.campaignDigest,
        ) ||
        [...state.reservations.values()].some(
          (entry) =>
            !isRrsiNativeReservation(entry.reservation) &&
            entry.reservation.bindings.campaignDigest ===
              campaign.campaignDigest &&
            ["gate-validation", "gate-test", "audit"].includes(
              entry.reservation.bindings.partition,
            ),
        )
      )
        rrsiFail(
          "final partitions have already been consumed",
          "CC_RRSI_QUERY_USED",
        );
    }
    const controls = {
      versions: { baseline: batch.versions.baseline, rsi: batch.versions.rsi },
      nativeRsiContentDigest: batch.nativeCandidateContents.rsi,
      lifecycles: {
        baseline: batch.lifecycleDigests.baseline,
        rsi: batch.lifecycleDigests.rsi,
      },
      parentIdentity: batch.parentIdentity,
      targetIdentity: batch.targetIdentity,
    };
    if (
      state.nativeControls &&
      rrsiCanonical(controls) !== rrsiCanonical(state.nativeControls)
    )
      rrsiFail("native control arms or target scope cannot be reset");
    const partitions =
      stage === "selection"
        ? ["select"]
        : ["gate-validation", "gate-test", "audit"];
    const keys = [
      ...new Set(
        partitions.flatMap((partition) => sourceKeys(campaign, partition)),
      ),
    ];
    for (const key of keys) {
      const previous = state.sources.get(key);
      if (
        previous &&
        (previous.stage !== stage ||
          (stage === "final" &&
            previous.campaignDigest !== campaign.campaignDigest))
      )
        rrsiFail(
          "previously exposed source cannot be treated as unseen",
          "CC_RRSI_HOLDOUT_USED",
        );
    }
    const totals = Object.fromEntries(
      campaign.experiment.arms.map((arm) => [
        arm,
        Object.fromEntries(RRSI_BUDGET_FIELDS.map((field) => [field, 0])),
      ]),
    );
    for (const child of batch.children)
      for (const [arm, allocation] of Object.entries(child.byArm))
        for (const field of RRSI_BUDGET_FIELDS)
          totals[arm][field] += allocation.budget[field];
    for (const [arm, ceiling] of Object.entries(totals))
      checkBudget(state, ceiling, stage, arm);
    // One reservation event, plus capacity for dispatch, unknown and two settlement
    // attempts per child. Do not admit work that cannot retain its minimum recovery graph.
    if (state.operations.size + 1 + 4 * batch.children.length > 5000)
      rrsiFail(
        "native batch exceeds remaining history recovery capacity",
        "CC_RRSI_HISTORY_HOLD",
      );
    const result = [];
    for (const child of batch.children) {
      const reservations = Object.entries(child.byArm).map(
        ([arm, allocation]) => {
          const executionId = `eval.${rrsiHash("chainlesschain.rrsi-native-arm-execution/v1", { batchDigest: batch.batchDigest, childId: child.childId, arm }).slice(7)}`;
          if (state.reservations.has(executionId))
            rrsiFail(
              "native arm execution is already occupied",
              "CC_RRSI_SLOT_USED",
            );
          const partition =
            child.role === "selection"
              ? "select"
              : child.role === "gate"
                ? "gate-validation"
                : "audit";
          const core = {
            tenantId: descriptor.tenantId,
            scopeId: descriptor.scopeId,
            ...state.identity,
            campaignDigest: campaign.campaignDigest,
            candidateDigest: candidate.candidateDigest,
            contentDigest: candidate.contentDigest,
            executionDigest: rrsiHash(
              "chainlesschain.rrsi-execution-bindings/v1",
              campaign.execution,
            ),
            executionId,
            slotId: child.slotId,
            partition,
            queryId: batch.queryId,
            childId: child.childId,
            batchDigest: batch.batchDigest,
            stage: batch.stage,
            role: child.role,
            variant: child.variant,
            pairId: child.pairId,
            arm,
            cohortId: child.cohortId,
            nativePlanDigest: child.nativePlanDigest,
            requestDigest: child.requestDigest,
            evaluationContextDigest: child.evaluationContextDigest,
            invocationDigest: child.invocationDigest,
            nativeArtifactId: batch.versions[arm],
            nativeContentDigest:
              arm === "baseline"
                ? batch.parentIdentity.contentDigest
                : batch.nativeCandidateContents[arm],
            lifecycleDigest: batch.lifecycleDigests[arm],
            executionUnitsDigest: rrsiHash(
              "chainlesschain.rrsi-native-execution-units/v1",
              allocation.executionUnits,
            ),
            costInventoryDigest: allocation.costInventoryDigest,
          };
          const plannedExecutions = rrsiNativeUnitCount(
            allocation.executionUnits,
          );
          const reservationDigest = rrsiHash(RRSI_NATIVE_RESERVATION_SCHEMA, {
            bindings: core,
            budget: allocation.budget,
            plannedExecutions,
            executionUnits: allocation.executionUnits,
            coveredPartitions: Object.keys(
              child.plannedObservationsPerArmByPartition,
            ).sort(),
          });
          const reservation = freezeRrsiData({
            schema: RRSI_NATIVE_RESERVATION_SCHEMA,
            bindings: { ...core, reservationDigest },
            budget: allocation.budget,
            plannedExecutions,
            executionUnits: allocation.executionUnits,
            coveredPartitions: Object.keys(
              child.plannedObservationsPerArmByPartition,
            ).sort(),
            reservationDigest,
          });
          state.reservations.set(executionId, {
            reservation,
            status: "reserved",
            knownUsage: Object.fromEntries(
              USAGE_FIELDS.map((name) => [name, null]),
            ),
            knownExecutionUnits: Object.fromEntries(
              RRSI_NATIVE_EXECUTION_UNITS.map((name) => [name, null]),
            ),
            settlement: null,
            dispatched: false,
          });
          return reservation;
        },
      );
      const bindings = freezeRrsiData({
        tenantId: descriptor.tenantId,
        scopeId: descriptor.scopeId,
        ...state.identity,
        campaignDigest: campaign.campaignDigest,
        batchDigest: batch.batchDigest,
        childId: child.childId,
        requestDigest: child.requestDigest,
        evaluationContextDigest: child.evaluationContextDigest,
        attributionDigest: rrsiHash(
          "chainlesschain.rrsi-native-cost-attribution/v1",
          { method: batch.costAttribution, byArm: child.byArm },
        ),
        armReservationDigests: Object.fromEntries(
          reservations.map((reservation) => [
            reservation.bindings.arm,
            reservation.reservationDigest,
          ]),
        ),
      });
      if (state.nativeChildren.has(child.childId))
        rrsiFail("native child is already occupied", "CC_RRSI_SLOT_USED");
      state.nativeChildren.set(child.childId, { bindings, reservations });
      state.nativeRecoveryHolds.set(child.childId, 4);
      result.push(
        freezeRrsiData({ childId: child.childId, bindings, reservations }),
      );
    }
    state.slots.add(slot);
    for (const identity of [
      batch.versions.rrsi,
      batch.nativeCandidateContents.rrsi,
    ])
      state.nativeCandidateOwners.set(identity, candidate.contentDigest);
    for (const child of batch.children) {
      state.nativeInvocations.add(child.invocationDigest);
      state.nativeInvocationIds.add(child.invocationIdDigest);
      state.nativeInvocationNonces.add(child.invocationNonceDigest);
      state.nativeRequestContexts.add(
        rrsiCanonical(child.request.evaluationContext),
      );
    }
    state.nativeControls ??= controls;
    state.nativeBatches.set(batch.batchDigest, batch);
    state.candidates.set(candidate.contentDigest, candidate);
    if (stage === "selection") state.selectionQueries++;
    state.nativeQueryOrdinals.set(
      batch.batchDigest,
      stage === "selection"
        ? state.selectionQueries
        : state.nativeQueryOrdinals.get(
            [...state.nativeBatches.values()].find(
              (entry) =>
                entry.stage === "selection" &&
                entry.campaignDigest === batch.campaignDigest &&
                entry.candidate.contentDigest === batch.candidate.contentDigest,
            ).batchDigest,
          ),
    );
    for (const key of keys)
      state.sources.set(key, {
        campaignDigest: campaign.campaignDigest,
        stage,
      });
    const response = { batchDigest: batch.batchDigest, children: result };
    snapshotRrsiData({
      ...response,
      children: result.map((child) => ({
        ...child,
        newlyCommitted: true,
        historyAuthenticated: true,
        readyForExecution: false,
        qualifiesForPromotion: false,
      })),
      newlyCommitted: true,
      historyAuthenticated: true,
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
    return freezeRrsiData(response);
  }
  function apply(state, kind, payload, acceptedAt, liveAdmission = false) {
    if (kind === "register") {
      rrsiExact(payload, ["campaign"], "campaign registration");
      const campaign = verifyRrsiCampaign(payload.campaign);
      if (
        campaign.tenantId !== descriptor.tenantId ||
        campaign.goalId !== descriptor.goalId
      )
        rrsiFail("campaign history scope differs");
      for (const existing of state.campaigns.values())
        if (
          existing.campaignId === campaign.campaignId &&
          existing.campaignDigest !== campaign.campaignDigest
        )
          rrsiFail(
            "campaign ID is already bound",
            "CC_RRSI_OPERATION_CONFLICT",
          );
      if (
        state.root &&
        ["parentReleaseDigest", "anchorReleaseDigest", "candidateKind"].some(
          (key) => campaign[key] !== state.root[key],
        )
      )
        rrsiFail("history baseline cannot be reset by a new campaign ID");
      if (
        state.root &&
        (campaign.policy.policyDigest !== state.root.policy.policyDigest ||
          rrsiCanonical(campaign.execution) !==
            rrsiCanonical(state.root.execution) ||
          rrsiCanonical(campaign.budget) !== rrsiCanonical(state.root.budget))
      )
        rrsiFail("history policy, model, or budget cannot be reset");
      const trainingKeys = sourceKeys(campaign, "train");
      for (const key of trainingKeys) {
        const previous = state.sources.get(key);
        if (previous && previous.stage !== "train")
          rrsiFail(
            "exposed selection or holdout sources require explicit retirement before training",
            "CC_RRSI_HOLDOUT_USED",
          );
      }
      for (const key of trainingKeys)
        state.sources.set(key, {
          campaignDigest: campaign.campaignDigest,
          stage: "train",
        });
      state.root ??= campaign;
      state.campaigns.set(campaign.campaignDigest, campaign);
      return campaign;
    }
    if (!state.root) rrsiFail("RRSI history has no registered root campaign");
    if (kind === "reserve-native-batch")
      return reserveNativeBatch(state, payload);
    if (kind === "dispatch-native" || kind === "unknown-native") {
      rrsiExact(payload, ["childId", "batchDigest"], "native child transition");
      const child = state.nativeChildren.get(payload.childId);
      if (!child || child.bindings.batchDigest !== payload.batchDigest)
        rrsiFail("native child binding differs");
      if (kind === "dispatch-native") {
        if (state.overrun)
          rrsiFail(
            "history contains a resource overrun",
            "CC_RRSI_BUDGET_EXCEEDED",
          );
        checkPreparationHold(state);
      }
      for (const reservation of child.reservations) {
        const entry = state.reservations.get(reservation.bindings.executionId);
        if (kind === "dispatch-native") {
          if (entry.status !== "reserved" || entry.dispatched)
            rrsiFail(
              "native child cannot be dispatched twice",
              "CC_RRSI_REPLAY_FORBIDDEN",
            );
          entry.dispatched = true;
          entry.status = "dispatch-intent";
        } else if (entry.status !== "settled") entry.status = "unknown";
      }
      state.nativeRecoveryHolds.set(
        payload.childId,
        child.reservations.every(
          (reservation) =>
            state.reservations.get(reservation.bindings.executionId).status ===
            "settled",
        )
          ? 0
          : Math.max(1, state.nativeRecoveryHolds.get(payload.childId) - 1),
      );
      return child.bindings;
    }
    if (kind === "settle-native") {
      rrsiExact(payload, ["evidence"], "native child settlement");
      const child = state.nativeChildren.get(
        payload.evidence?.core?.bindings?.childId,
      );
      if (!child) rrsiFail("native settlement child is not reserved");
      const checked = verifySettlement(
        options.settlementVerifier,
        payload.evidence,
        { schema: RRSI_NATIVE_RESERVATION_SCHEMA, bindings: child.bindings },
        acceptedAt,
      );
      const core = checked.core;
      if (
        child.reservations.every(
          (reservation) =>
            state.reservations.get(reservation.bindings.executionId).status ===
            "settled",
        )
      )
        rrsiFail(
          "native child is already settled",
          "CC_RRSI_OPERATION_CONFLICT",
        );
      if (state.receiptIds.has(core.receiptId))
        rrsiFail("native settlement receipt ID is already used");
      const owner = rrsiHash(
        "chainlesschain.rrsi-native-child-settlement-owner/v1",
        child.bindings,
      );
      for (const digest of core.sourceReceiptDigests) {
        if (
          state.sourceReceiptOwners.has(digest) &&
          state.sourceReceiptOwners.get(digest) !== owner
        )
          rrsiFail(
            "source receipt is already bound to another child or reservation",
            "CC_RRSI_SETTLEMENT_INVALID",
          );
        state.sourceReceiptOwners.set(digest, owner);
      }
      for (const reservation of child.reservations) {
        const entry = state.reservations.get(reservation.bindings.executionId);
        const arm = reservation.bindings.arm;
        const usage = core.usageByArm[arm],
          units = core.executionUnitsByArm[arm],
          status = core.statusByArm[arm];
        if (entry.status === "settled") {
          const prior = entry.settlement.core;
          if (
            rrsiCanonical([
              usage,
              units,
              status,
              core.cleanupConfirmedByArm[arm],
            ]) !==
            rrsiCanonical([
              prior.usageByArm[arm],
              prior.executionUnitsByArm[arm],
              prior.statusByArm[arm],
              prior.cleanupConfirmedByArm[arm],
            ])
          )
            rrsiFail("settled native arm cannot be rewritten");
          continue;
        }
        for (const name of RRSI_NATIVE_EXECUTION_UNITS) {
          if (
            units[name] !== null &&
            entry.knownExecutionUnits[name] !== null &&
            units[name] < entry.knownExecutionUnits[name]
          )
            rrsiFail("native execution units cannot decrease known totals");
          if (units[name] !== null)
            entry.knownExecutionUnits[name] = units[name];
          if (
            status === "succeeded" &&
            units[name] !== null &&
            units[name] < reservation.executionUnits[name]
          )
            rrsiFail(
              "successful native settlement omits a frozen execution category",
            );
        }
        for (const name of USAGE_FIELDS) {
          if (
            usage[name] !== null &&
            entry.knownUsage[name] !== null &&
            usage[name] < entry.knownUsage[name]
          )
            rrsiFail("native usage cannot decrease known totals");
          if (usage[name] !== null) entry.knownUsage[name] = usage[name];
          if (
            usage[name] !== null &&
            usage[name] > reservation.budget[USAGE_TO_BUDGET[name]]
          )
            state.overrun = true;
        }
        const knownUnitFloor = rrsiNativeUnitCount(
          Object.fromEntries(
            RRSI_NATIVE_EXECUTION_UNITS.map((name) => [
              name,
              entry.knownExecutionUnits[name] ?? 0,
            ]),
          ),
        );
        entry.knownUsage.executions = Math.max(
          entry.knownUsage.executions ?? 0,
          knownUnitFloor,
        );
        if (knownUnitFloor > reservation.budget.maxExecutions)
          state.overrun = true;
        if (
          status === "not-started" &&
          (entry.dispatched ||
            Object.values(usage).some((amount) => amount !== 0) ||
            Object.values(units).some((amount) => amount !== 0))
        )
          rrsiFail(
            "native not-started settlement contradicts dispatch or usage",
          );
        if (!["not-started", "unknown"].includes(status) && !entry.dispatched)
          rrsiFail("native terminal settlement has no durable dispatch intent");
        entry.settlement = checked.evidence;
        entry.status =
          status !== "unknown" &&
          core.cleanupConfirmedByArm[arm] &&
          Object.values(usage).every((amount) => amount !== null) &&
          Object.values(units).every((amount) => amount !== null)
            ? "settled"
            : "unknown";
      }
      state.nativeRecoveryHolds.set(
        child.bindings.childId,
        child.reservations.every(
          (reservation) =>
            state.reservations.get(reservation.bindings.executionId).status ===
            "settled",
        )
          ? 0
          : Math.max(
              1,
              state.nativeRecoveryHolds.get(child.bindings.childId) - 1,
            ),
      );
      state.receiptIds.add(core.receiptId);
      return child.bindings;
    }
    if (kind === "register-preparation-plan") {
      const campaign = campaignFor(state, payload.campaignDigest);
      const plan = normalizeRrsiPreparationPlan(payload, state.root);
      if (state.finalCandidates.size)
        rrsiFail("frozen finalist prohibits preparation plan registration");
      if (rrsiTrainingSourcesDigest(campaign) !== plan.trainingSourcesDigest)
        rrsiFail("preparation plan training sources differ from root");
      if (state.preparationPlan)
        rrsiFail(
          "preparation plan is already frozen",
          "CC_RRSI_OPERATION_CONFLICT",
        );
      state.preparationPlan = plan;
      return plan;
    }
    if (kind === "reserve-preparation") {
      if (state.overrun)
        rrsiFail(
          "history contains a resource overrun",
          "CC_RRSI_BUDGET_EXCEEDED",
        );
      if (!state.preparationPlan)
        rrsiFail(
          "preparation plan has not been durably registered",
          "CC_RRSI_UNREGISTERED",
        );
      if (state.finalCandidates.size)
        rrsiFail("frozen finalist prohibits further preparation");
      checkPreparationHold(state);
      if (
        [...state.reservations.values()].some(
          (entry) => entry.status !== "settled",
        )
      )
        rrsiFail(
          "unresolved query prohibits preparation admission",
          "CC_RRSI_HISTORY_HOLD",
        );
      const campaign = campaignFor(state, payload.campaignDigest);
      const normalized = normalizeRrsiPreparationRequest(
        payload,
        campaign,
        state.preparationPlan,
      );
      if (state.preparationRequests.has(normalized.bindings.requestDigest))
        rrsiFail(
          "semantic preparation request has already been consumed",
          "CC_RRSI_PREPARATION_USED",
        );
      if (state.preparationAttempts >= state.preparationPlan.maxAttempts)
        rrsiFail(
          "preparation attempt limit is exhausted",
          "CC_RRSI_PREPARATION_EXHAUSTED",
        );
      const slot = `${descriptor.scopeId}:preparation:${payload.slotId}`;
      if (state.slots.has(slot) || state.reservations.has(payload.executionId))
        rrsiFail("execution or slot is already occupied", "CC_RRSI_SLOT_USED");
      checkBudget(state, normalized.budget, "proposal");
      const core = {
        tenantId: descriptor.tenantId,
        scopeId: descriptor.scopeId,
        ...state.identity,
        campaignDigest: campaign.campaignDigest,
        executionDigest: state.preparationPlan.executionDigest,
        executionId: payload.executionId,
        slotId: payload.slotId,
        partition: "train",
        ...normalized.bindings,
      };
      const reservationDigest = rrsiHash(normalized.schema, {
        bindings: core,
        budget: normalized.budget,
        plannedExecutions: normalized.plannedExecutions,
      });
      const reservation = freezeRrsiData({
        schema: normalized.schema,
        bindings: { ...core, reservationDigest },
        budget: normalized.budget,
        plannedExecutions: normalized.plannedExecutions,
        reservationDigest,
      });
      state.reservations.set(payload.executionId, {
        reservation,
        status: "reserved",
        knownUsage: Object.fromEntries(USAGE_FIELDS.map((key) => [key, null])),
        settlement: null,
        dispatched: false,
      });
      state.slots.add(slot);
      state.preparationAttempts++;
      state.preparationRequests.add(normalized.bindings.requestDigest);
      return reservation;
    }
    if (kind === "reserve") {
      rrsiExact(
        payload,
        [
          "campaignDigest",
          "candidate",
          "partition",
          "slotId",
          "executionId",
          "budget",
        ],
        "query reservation",
      );
      if (state.overrun)
        rrsiFail(
          "history contains a resource overrun",
          "CC_RRSI_BUDGET_EXCEEDED",
        );
      checkPreparationHold(state);
      const campaign = campaignFor(state, payload.campaignDigest);
      if (
        state.nativeBatches.size &&
        state.finalCandidates.size &&
        payload.partition === "select"
      )
        rrsiFail("frozen native finalist prohibits legacy selection fallback");
      if (
        payload.partition !== "select" &&
        [...state.nativeBatches.values()].some(
          (batch) => batch.campaignDigest === campaign.campaignDigest,
        )
      )
        rrsiFail(
          "native candidate cannot fall back to legacy final reservations",
        );
      if (
        [...state.nativeBatches.values()].some(
          (batch) =>
            batch.stage === "generalization" &&
            batch.campaignDigest === campaign.campaignDigest,
        ) &&
        payload.partition !== "select"
      )
        rrsiFail(
          "native final partitions have already been consumed",
          "CC_RRSI_QUERY_USED",
        );
      const candidate = verifyRrsiCandidate(campaign, payload.candidate);
      if (
        !RRSI_PARTITIONS.includes(payload.partition) ||
        payload.partition === "train"
      )
        rrsiFail("invalid reserved partition");
      const slotId = rrsiId(payload.slotId, "slot ID");
      const executionId = rrsiId(payload.executionId, "execution ID");
      const slot = `${campaign.campaignDigest}:${payload.partition}:${slotId}`;
      if (state.slots.has(slot) || state.reservations.has(executionId))
        rrsiFail("execution or slot is already occupied", "CC_RRSI_SLOT_USED");
      const priorCandidate = state.candidates.get(candidate.contentDigest);
      if (
        priorCandidate &&
        priorCandidate.candidateDigest !== candidate.candidateDigest
      )
        rrsiFail(
          "content is already bound to another candidate identity",
          "CC_RRSI_DUPLICATE_CONTENT",
        );
      const stage = payload.partition === "select" ? "selection" : "final";
      if (stage === "selection") {
        if (state.finalCandidates.has(campaign.campaignDigest))
          rrsiFail("frozen candidate prohibits further selection");
        if (priorCandidate)
          rrsiFail(
            "candidate selection query has already been consumed",
            "CC_RRSI_QUERY_USED",
          );
        if (
          state.selectionQueries >=
            state.root.policy.limits.maxSelectionQueries ||
          state.candidates.size >= state.root.policy.limits.maxCandidates
        )
          rrsiFail(
            "history selection quota is exhausted",
            "CC_RRSI_QUERY_EXHAUSTED",
          );
      } else if (
        state.finalCandidates.get(campaign.campaignDigest) !==
        candidate.contentDigest
      )
        rrsiFail("final query requires the unique frozen candidate");
      if (
        stage === "final" &&
        [...state.reservations.values()].some(
          (entry) =>
            entry.reservation.bindings.campaignDigest ===
              campaign.campaignDigest &&
            entry.reservation.bindings.partition === payload.partition,
        )
      )
        rrsiFail(
          "final partition has already been consumed",
          "CC_RRSI_QUERY_USED",
        );
      const keys = sourceKeys(campaign, payload.partition);
      for (const key of keys) {
        const previous = state.sources.get(key);
        if (
          previous &&
          (previous.stage !== stage ||
            (stage === "final" &&
              previous.campaignDigest !== campaign.campaignDigest))
        )
          rrsiFail(
            "previously exposed source cannot be treated as unseen",
            "CC_RRSI_HOLDOUT_USED",
          );
      }
      const ceiling = budget(payload.budget, "reserved budget");
      const minimumExecutions =
        campaign.dataset.pools[payload.partition].taskCount *
        campaign.experiment.seeds.length *
        (stage === "selection"
          ? 2 * (1 + campaign.experiment.perturbations.length)
          : 1);
      if (ceiling.maxExecutions < minimumExecutions)
        rrsiFail("reservation does not cover its frozen execution denominator");
      checkBudget(state, ceiling, stage);
      const core = {
        tenantId: descriptor.tenantId,
        scopeId: descriptor.scopeId,
        ...state.identity,
        campaignDigest: campaign.campaignDigest,
        candidateDigest: candidate.candidateDigest,
        contentDigest: candidate.contentDigest,
        executionDigest: rrsiHash(
          "chainlesschain.rrsi-execution-bindings/v1",
          campaign.execution,
        ),
        executionId,
        slotId,
        partition: payload.partition,
      };
      const reservationDigest = rrsiHash(RRSI_RESERVATION_SCHEMA, {
        bindings: core,
        budget: ceiling,
        plannedExecutions: minimumExecutions,
      });
      const reservation = freezeRrsiData({
        schema: RRSI_RESERVATION_SCHEMA,
        bindings: { ...core, reservationDigest },
        budget: ceiling,
        plannedExecutions: minimumExecutions,
        reservationDigest,
      });
      state.reservations.set(executionId, {
        reservation,
        status: "reserved",
        knownUsage: Object.fromEntries(USAGE_FIELDS.map((key) => [key, null])),
        settlement: null,
        dispatched: false,
      });
      state.slots.add(slot);
      state.candidates.set(candidate.contentDigest, candidate);
      if (stage === "selection") state.selectionQueries++;
      for (const key of keys)
        state.sources.set(key, {
          campaignDigest: campaign.campaignDigest,
          stage,
        });
      return reservation;
    }
    if (kind === "freeze") {
      rrsiExact(
        payload,
        ["campaignDigest", "contentDigest"],
        "candidate freeze",
      );
      const campaign = campaignFor(state, payload.campaignDigest);
      if (
        liveAdmission &&
        state.nativeBatches.size &&
        state.finalCandidates.size
      )
        rrsiFail("native history already has its unique global finalist");
      rrsiDigest(payload.contentDigest, "frozen content digest");
      if (
        state.overrun ||
        [...state.reservations.values()].some(
          (entry) => entry.status !== "settled",
        )
      )
        rrsiFail(
          "candidate freeze requires complete history accounting without overruns",
          "CC_RRSI_HISTORY_HOLD",
        );
      const selected = [...state.reservations.values()].find(
        (entry) =>
          entry.reservation.bindings.campaignDigest ===
            campaign.campaignDigest &&
          entry.reservation.bindings.contentDigest === payload.contentDigest &&
          entry.reservation.bindings.partition === "select",
      );
      const nativeSelection = [...state.nativeBatches.values()].find(
        (batch) =>
          batch.stage === "selection" &&
          batch.campaignDigest === campaign.campaignDigest &&
          batch.candidate.contentDigest === payload.contentDigest,
      );
      if (
        nativeSelection &&
        nativeSelection.children.some((child) => {
          const group = state.nativeChildren.get(child.childId);
          return group.reservations.some((reservation) => {
            const entry = state.reservations.get(
              reservation.bindings.executionId,
            );
            return (
              entry.status !== "settled" ||
              entry.settlement.core.statusByArm[reservation.bindings.arm] !==
                "succeeded"
            );
          });
        })
      )
        rrsiFail(
          "native candidate freeze requires every planned paired arm to settle successfully",
        );
      if (
        !selected ||
        selected.status !== "settled" ||
        (nativeSelection
          ? selected.settlement.core.statusByArm[
              selected.reservation.bindings.arm
            ] !== "succeeded"
          : selected.settlement.core.status !== "succeeded")
      )
        rrsiFail(
          "candidate requires independently settled successful selection before freezing",
        );
      if (state.finalCandidates.has(campaign.campaignDigest))
        rrsiFail("campaign finalist is already frozen");
      state.finalCandidates.set(campaign.campaignDigest, payload.contentDigest);
      return payload;
    }
    if (kind === "dispatch" || kind === "unknown") {
      rrsiExact(
        payload,
        ["executionId", "reservationDigest"],
        "execution transition",
      );
      const entry = reservationFor(
        state,
        payload.executionId,
        payload.reservationDigest,
      );
      if (isRrsiNativeReservation(entry.reservation))
        rrsiFail("native arms require the atomic child transition");
      if (kind === "dispatch") {
        // New admission guards must not erase authenticated pre-upgrade costs.
        // Old v1 dispatch history remains readable; every new dispatch rechecks.
        if (liveAdmission) {
          if (state.overrun)
            rrsiFail(
              "history contains a resource overrun",
              "CC_RRSI_BUDGET_EXCEEDED",
            );
          if (!isRrsiPreparationReservation(entry.reservation))
            checkPreparationHold(state);
        }
        if (entry.status !== "reserved" || entry.dispatched)
          rrsiFail(
            "execution cannot be dispatched twice",
            "CC_RRSI_REPLAY_FORBIDDEN",
          );
        entry.dispatched = true;
        entry.status = "dispatch-intent";
      } else {
        if (entry.status === "settled")
          rrsiFail("settled execution cannot become unknown");
        entry.status = "unknown";
      }
      return entry.reservation;
    }
    if (kind === "observe-preparation") {
      rrsiExact(
        payload,
        ["executionId", "reservationDigest", "observation"],
        "preparation execution observation",
      );
      const entry = reservationFor(
        state,
        payload.executionId,
        payload.reservationDigest,
      );
      if (!isRrsiPreparationReservation(entry.reservation) || !entry.dispatched)
        rrsiFail(
          "preparation observation requires durable preparation dispatch",
        );
      rrsiExact(
        payload.observation,
        ["result", "failureCode", "driftDetected"],
        "PM execution observation",
      );
      rrsiBoolean(payload.observation.driftDetected, "PM journal drift");
      if (payload.observation.failureCode !== null)
        rrsiId(payload.observation.failureCode, "PM failure code");
      if (
        payload.observation.result !== null &&
        (typeof payload.observation.result !== "object" ||
          Array.isArray(payload.observation.result))
      )
        rrsiFail("PM observation result must be a record or null");
      entry.observation = freezeRrsiData({
        ...payload.observation,
        independentlyReverified: false,
        costEvidenceVerified: false,
        qualifiesForPromotion: false,
      });
      // A PM receipt does not settle money or cleanup. Never erase signed settlement.
      if (entry.status !== "settled") entry.status = "unknown";
      return entry.reservation;
    }
    if (kind === "settle") {
      rrsiExact(payload, ["evidence"], "execution settlement");
      const bindings = payload.evidence?.core?.bindings;
      const entry = reservationFor(
        state,
        bindings?.executionId,
        bindings?.reservationDigest,
      );
      if (isRrsiNativeReservation(entry.reservation))
        rrsiFail("native arms require a paired child settlement");
      const checked = verifySettlement(
        options.settlementVerifier,
        payload.evidence,
        entry.reservation,
        acceptedAt,
      );
      if (entry.status === "settled")
        rrsiFail(
          "execution is already independently settled",
          "CC_RRSI_OPERATION_CONFLICT",
        );
      if (state.receiptIds.has(checked.core.receiptId))
        rrsiFail("settlement receipt ID is already used");
      for (const digest of checked.core.sourceReceiptDigests) {
        const owner = state.sourceReceiptOwners.get(digest);
        if (owner && owner !== entry.reservation.reservationDigest)
          rrsiFail(
            "source receipt is already bound to another reservation",
            "CC_RRSI_SETTLEMENT_INVALID",
          );
        state.sourceReceiptOwners.set(
          digest,
          entry.reservation.reservationDigest,
        );
      }
      for (const field of USAGE_FIELDS) {
        const actual = checked.core.usage[field];
        if (
          actual !== null &&
          entry.knownUsage[field] !== null &&
          actual < entry.knownUsage[field]
        )
          rrsiFail("settlement usage cannot decrease previous known totals");
        if (actual !== null) entry.knownUsage[field] = actual;
        if (
          actual !== null &&
          actual > entry.reservation.budget[USAGE_TO_BUDGET[field]]
        )
          state.overrun = true;
      }
      if (
        checked.core.status === "not-started" &&
        (entry.dispatched ||
          USAGE_FIELDS.some((key) => checked.core.usage[key] !== 0))
      )
        rrsiFail("not-started settlement contradicts dispatch or usage");
      if (
        checked.core.status !== "not-started" &&
        checked.core.status !== "unknown" &&
        !entry.dispatched
      )
        rrsiFail("terminal settlement has no durable dispatch intent");
      if (
        checked.core.status === "succeeded" &&
        checked.core.usage.executions !== null &&
        checked.core.usage.executions < entry.reservation.plannedExecutions
      )
        rrsiFail(
          "successful settlement does not cover the frozen execution denominator",
        );
      entry.settlement = checked.evidence;
      entry.status =
        checked.core.status !== "unknown" &&
        checked.core.cleanupConfirmed &&
        USAGE_FIELDS.every((key) => checked.core.usage[key] !== null)
          ? "settled"
          : "unknown";
      state.receiptIds.add(checked.core.receiptId);
      return entry.reservation;
    }
    rrsiFail("unsupported RRSI history operation");
  }

  function load() {
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = methods.verify();
      if (
        before.authenticated !== true ||
        before.durable !== true ||
        before.status !== "verified"
      )
        rrsiFail("RRSI Ledger head is unauthenticated");
      const events = methods.read({
        afterSequence: 0,
        limit: EVOLUTION_LEDGER_MAX_EVENTS,
      });
      const after = methods.verify();
      if (!sameIdentity(before, after)) continue;
      if (
        events.length !== after.sequence ||
        events.some((event, index) => event.sequence !== index + 1)
      )
        rrsiFail(
          "RRSI history requires complete contiguous Ledger coverage",
          "CC_RRSI_HISTORY_CORRUPT",
        );
      const state = emptyState(before);
      let count = 0;
      for (const event of events) {
        if (
          event.type !== RRSI_HISTORY_EVENT_TYPE ||
          event.tenantId !== descriptor.tenantId ||
          event.skillName !== descriptor.goalId
        )
          continue;
        if (
          ++count > 5000 ||
          event.schema !== EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA ||
          event.artifactTenantId !== descriptor.artifactTenantId ||
          event.correlationId !== descriptor.scopeId
        )
          rrsiFail(
            "RRSI history event scope is inconsistent",
            "CC_RRSI_HISTORY_CORRUPT",
          );
        const resolution = options.ledgerArtifactResolver({
          epoch: before.epoch,
          ledgerId: before.ledgerId,
          ref: copyRetainedRef(event.subjectRef),
          tenantId: descriptor.artifactTenantId,
        });
        if (
          resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
          resolution.authenticated !== true ||
          resolution.found !== true ||
          resolution.ref !== event.subjectRef.ref ||
          resolution.digest !== event.subjectRef.digest ||
          !Buffer.isBuffer(resolution.bytes)
        )
          rrsiFail(
            "RRSI durable artifact cannot be authenticated",
            "CC_RRSI_HISTORY_CORRUPT",
          );
        const stored = snapshotRrsiData(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(resolution.bytes),
          ),
        );
        if (
          stored.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
          stored.tenantId !== descriptor.artifactTenantId ||
          stored.audience !== descriptor.audience ||
          stored.purpose !== descriptor.purpose ||
          stored.retention !== "ledger" ||
          stored.type !== ARTIFACT_TYPE
        )
          rrsiFail(
            "RRSI durable artifact retention scope differs",
            "CC_RRSI_HISTORY_CORRUPT",
          );
        const record = stored.value;
        rrsiExact(
          record,
          [
            "schema",
            "descriptor",
            "ledgerId",
            "epoch",
            "operationId",
            "kind",
            "payload",
            "previousRecordDigest",
            "acceptedAt",
            ...FLAGS,
            "recordDigest",
          ],
          "RRSI history record",
        );
        const core = Object.fromEntries(
          [
            "descriptor",
            "ledgerId",
            "epoch",
            "operationId",
            "kind",
            "payload",
            "previousRecordDigest",
            "acceptedAt",
          ].map((key) => [key, record[key]]),
        );
        const rebuilt = rrsiEnvelope(
          RRSI_HISTORY_EVENT_SCHEMA,
          "recordDigest",
          core,
        );
        if (
          rrsiCanonical(record) !== rrsiCanonical(rebuilt) ||
          rrsiCanonical(record.descriptor) !== rrsiCanonical(descriptor) ||
          record.ledgerId !== before.ledgerId ||
          record.epoch !== before.epoch ||
          record.acceptedAt !== event.timestamp ||
          record.previousRecordDigest !== state.lastRecordDigest ||
          event.eventId !== operationEventId(record.operationId)
        )
          rrsiFail(
            "RRSI history record chain or identity differs",
            "CC_RRSI_HISTORY_CORRUPT",
          );
        if (state.operations.has(record.operationId))
          rrsiFail("RRSI history has duplicate operations");
        const result = apply(
          state,
          record.kind,
          record.payload,
          record.acceptedAt,
        );
        state.operations.set(record.operationId, {
          record,
          result,
          ref: copyRetainedRef(event.subjectRef),
          sequence: event.sequence,
        });
        state.lastRecordDigest = record.recordDigest;
      }
      if (!sameIdentity(before, methods.verify())) continue;
      return { state, head: before };
    }
    rrsiFail(
      "RRSI history changed repeatedly during verification",
      "CC_RRSI_HEAD_CONFLICT",
    );
  }
  function operationEventId(operationId) {
    return `rrsi.${rrsiHash("chainlesschain.rrsi-history-operation/v1", { scopeDigest, operationId }).slice(7)}`;
  }
  function nativeBatchResolution(state, batchDigest, reservationRecord) {
    const batch = state.nativeBatches.get(batchDigest);
    if (!batch) rrsiFail("native batch is not registered");
    const result = {
      batch,
      campaign: campaignFor(state, batch.campaignDigest),
      queryOrdinal: state.nativeQueryOrdinals.get(batch.batchDigest),
      reservationRecord,
      identity: state.identity,
      budgetOverrun: state.overrun,
      recoveryEventsHeld: [...state.nativeRecoveryHolds.values()].reduce(
        (sum, amount) => sum + amount,
        0,
      ),
      children: batch.children.map((child) => {
        const group = state.nativeChildren.get(child.childId);
        return {
          bindings: group.bindings,
          states: group.reservations.map((reservation) => {
            const entry = state.reservations.get(
              reservation.bindings.executionId,
            );
            return {
              arm: reservation.bindings.arm,
              status: entry.status,
              dispatched: entry.dispatched,
            };
          }),
        };
      }),
      historyAuthenticated: true,
      readyForExecution: false,
      qualifiesForPromotion: false,
    };
    // Reserve enough byte/node space for the longest later status as well as
    // the actual retained event reference. Do not admit an unreadable batch.
    snapshotRrsiData({
      ...result,
      children: result.children.map((child) => ({
        ...child,
        states: child.states.map((arm) => ({
          ...arm,
          status: "dispatch-intent",
        })),
      })),
    });
    return freezeRrsiData(result);
  }
  function commitUnlocked(kind, operationId, input) {
    const payload = snapshotRrsiData(input);
    rrsiId(operationId, "operation ID");
    for (let attempt = 0; attempt < 8; attempt++) {
      const { state, head } = load();
      const existing = state.operations.get(operationId);
      if (existing) {
        if (
          existing.record.kind !== kind ||
          rrsiCanonical(existing.record.payload) !== rrsiCanonical(payload)
        )
          rrsiFail(
            "RRSI operation ID is bound to different data",
            "CC_RRSI_OPERATION_CONFLICT",
          );
        return { result: existing.result, newlyCommitted: false };
      }
      const acceptedAt = now();
      const result = apply(state, kind, payload, acceptedAt, true);
      if (
        state.nativeBatches.size &&
        (state.operations.size +
          1 +
          [...state.nativeRecoveryHolds.values()].reduce(
            (sum, amount) => sum + amount,
            0,
          ) >
          5000 ||
          head.sequence +
            1 +
            [...state.nativeRecoveryHolds.values()].reduce(
              (sum, amount) => sum + amount,
              0,
            ) >
            EVOLUTION_LEDGER_MAX_EVENTS)
      )
        rrsiFail(
          "history must retain native recovery capacity",
          "CC_RRSI_HISTORY_HOLD",
        );
      const record = rrsiEnvelope(RRSI_HISTORY_EVENT_SCHEMA, "recordDigest", {
        descriptor,
        ledgerId: head.ledgerId,
        epoch: head.epoch,
        operationId,
        kind,
        payload,
        previousRecordDigest: state.lastRecordDigest,
        acceptedAt,
      });
      if (kind.includes("native")) snapshotRrsiData(record);
      const published = EvolutionArtifactPorts.prototype.putCanonical.call(
        options.artifactPorts,
        ARTIFACT_TYPE,
        record,
        {
          audience: descriptor.audience,
          purpose: descriptor.purpose,
          retention: "ledger",
        },
      );
      if (
        published?.receipt?.persisted !== true ||
        published.receipt.readbackVerified !== true ||
        published.receipt.integrityVerified !== true ||
        published.receipt.retention !== "ledger"
      )
        rrsiFail("RRSI history artifact was not durably retained");
      if (kind.includes("native")) {
        const resolution = options.ledgerArtifactResolver({
          epoch: head.epoch,
          ledgerId: head.ledgerId,
          ref: copyRetainedRef(published.ref),
          tenantId: descriptor.artifactTenantId,
        });
        if (!resolution?.found || !Buffer.isBuffer(resolution.bytes))
          rrsiFail("native history wrapper cannot be read back");
        snapshotRrsiData(
          JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(resolution.bytes),
          ),
        );
      }
      if (kind === "reserve-native-batch")
        nativeBatchResolution(state, payload.batch.batchDigest, {
          recordDigest: record.recordDigest,
          ref: copyRetainedRef(published.ref),
          sequence: head.sequence + 1,
        });
      try {
        const receipt = methods.appendDomainEvent(
          {
            type: RRSI_HISTORY_EVENT_TYPE,
            eventId: operationEventId(operationId),
            tenantId: descriptor.tenantId,
            artifactTenantId: descriptor.artifactTenantId,
            correlationId: descriptor.scopeId,
            skillName: descriptor.goalId,
            decision: "accepted",
            reason:
              "RRSI durable control history; independent execution admission remains required",
            sourceRefs: [],
            subjectRef: published.ref,
            timestamp: acceptedAt,
          },
          {
            expectedHeadDigest: head.headDigest,
            expectedSequence: head.sequence,
          },
        );
        if (receipt?.authenticated !== true || receipt.durable !== true)
          rrsiFail("RRSI append returned an uncertain receipt");
      } catch (error) {
        if (error.code === "CC_EVOLUTION_LEDGER_HEAD_CONFLICT") continue;
        // Could have committed. Readback can recover history, never replay execution.
        rrsiFail(
          "RRSI commit outcome requires readback",
          "CC_RRSI_COMMIT_UNKNOWN",
        );
      }
      const reread = load().state.operations.get(operationId);
      if (
        !reread ||
        rrsiCanonical(reread.record.payload) !== rrsiCanonical(payload)
      )
        rrsiFail(
          "RRSI committed operation could not be read back",
          "CC_RRSI_COMMIT_UNKNOWN",
        );
      return { result, newlyCommitted: true };
    }
    rrsiFail(
      "RRSI operation exceeded CAS retry bound",
      "CC_RRSI_HEAD_CONFLICT",
    );
  }

  function commit(kind, operationId, input) {
    return withHistoryLock(() => commitUnlocked(kind, operationId, input));
  }

  function reservationResponse(result) {
    const response = freezeRrsiData({
      reservation: result.result,
      newlyCommitted: result.newlyCommitted,
      historyAuthenticated: true,
      executionEvidenceVerified: false,
      readyForExecution: false,
      qualifiesForPromotion: false,
    });
    if (result.newlyCommitted) freshReservations.set(response, result.result);
    return response;
  }

  const adapter = Object.freeze({
    descriptor,
    resolveCampaignRoot() {
      return withHistoryLock(() => {
        const { state } = load();
        if (!state.root) rrsiFail("RRSI root campaign is not registered");
        const operation = [...state.operations.values()].find(
          (entry) =>
            entry.record.kind === "register" &&
            entry.record.payload.campaign.campaignDigest ===
              state.root.campaignDigest,
        );
        return freezeRrsiData({
          descriptor,
          identity: state.identity,
          campaign: state.root,
          registrationRecord: {
            recordDigest: operation.record.recordDigest,
            ref: operation.ref,
            sequence: operation.sequence,
          },
          historyAuthenticated: true,
          productionBudgetAuthorityVerified: false,
        });
      });
    },
    resolveNativeBatch(input) {
      const lookup = snapshotRrsiData(input);
      rrsiExact(lookup, ["batchDigest"], "native batch lookup");
      rrsiDigest(lookup.batchDigest, "native batch digest");
      return withHistoryLock(() => {
        const { state } = load();
        const batch = state.nativeBatches.get(lookup.batchDigest);
        if (!batch) rrsiFail("native batch is not registered");
        const operation = [...state.operations.values()].find(
          (entry) =>
            entry.record.kind === "reserve-native-batch" &&
            entry.record.payload.batch.batchDigest === batch.batchDigest,
        );
        return nativeBatchResolution(state, batch.batchDigest, {
          recordDigest: operation.record.recordDigest,
          ref: operation.ref,
          sequence: operation.sequence,
        });
      });
    },
    registerCampaign(campaign) {
      const normalized = verifyRrsiCampaign(campaign);
      const result = commit(
        "register",
        `register.${rrsiHash("rrsi-campaign-id/v1", normalized.campaignId).slice(7)}`,
        { campaign: normalized },
      );
      return freezeRrsiData({
        campaignDigest: normalized.campaignDigest,
        newlyCommitted: result.newlyCommitted,
        historyAuthenticated: true,
        controlBudgetCoverage: "selection-and-final-only",
        readyForExecution: false,
        qualifiesForPromotion: false,
      });
    },
    reserve(input) {
      const value = snapshotRrsiData(input);
      const result = commit(
        "reserve",
        `reserve.${rrsiHash("rrsi-execution-id/v1", value.executionId).slice(7)}`,
        value,
      );
      return reservationResponse(result);
    },
    reserveNativeBatch(input) {
      const batch = buildRrsiNativeEvaluationBatch(input);
      const result = commit(
        "reserve-native-batch",
        `reserve-native.${rrsiHash("chainlesschain.rrsi-native-query-operation/v1", batch.queryId).slice(7)}`,
        { batch },
      );
      const response = freezeRrsiData({
        batchDigest: result.result.batchDigest,
        children: result.result.children.map((child) => {
          const value = freezeRrsiData({
            ...child,
            newlyCommitted: result.newlyCommitted,
            historyAuthenticated: true,
            readyForExecution: false,
            qualifiesForPromotion: false,
          });
          if (result.newlyCommitted)
            freshNativeChildren.set(value, child.bindings);
          return value;
        }),
        newlyCommitted: result.newlyCommitted,
        historyAuthenticated: true,
        readyForExecution: false,
        qualifiesForPromotion: false,
      });
      return response;
    },
    recordNativeDispatch(response) {
      const bindings = freshNativeChildren.get(response);
      if (!bindings)
        rrsiFail(
          "native dispatch requires this process's fresh child reservation",
          "CC_RRSI_REPLAY_FORBIDDEN",
        );
      freshNativeChildren.delete(response);
      const result = commit(
        "dispatch-native",
        `dispatch-native.${rrsiHash("chainlesschain.rrsi-native-child-operation/v1", bindings.childId).slice(7)}`,
        { childId: bindings.childId, batchDigest: bindings.batchDigest },
      );
      return freezeRrsiData({
        newlyCommitted: result.newlyCommitted,
        historyAuthenticated: true,
        readyForExecution: false,
        qualifiesForPromotion: false,
      });
    },
    markNativeUnknown(input) {
      const value = snapshotRrsiData(input);
      return commit(
        "unknown-native",
        `unknown-native.${rrsiHash("chainlesschain.rrsi-native-child-operation/v1", value.childId).slice(7)}`,
        value,
      ).newlyCommitted;
    },
    registerPreparationPlan(input) {
      const result = commit(
        "register-preparation-plan",
        "register.preparation-plan",
        input,
      );
      return freezeRrsiData({
        plan: result.result,
        newlyCommitted: result.newlyCommitted,
        historyAuthenticated: true,
        mappingAuthenticated: false,
        readyForExecution: false,
        qualifiesForPromotion: false,
      });
    },
    reservePreparation(input) {
      const value = snapshotRrsiData(input);
      return reservationResponse(
        commit(
          "reserve-preparation",
          `reserve.${rrsiHash("rrsi-execution-id/v1", value.executionId).slice(7)}`,
          value,
        ),
      );
    },
    recordDispatch(response) {
      const reservation = freshReservations.get(response);
      if (!reservation)
        rrsiFail(
          "dispatch requires this process's fresh reservation",
          "CC_RRSI_REPLAY_FORBIDDEN",
        );
      freshReservations.delete(response);
      const payload = {
        executionId: reservation.bindings.executionId,
        reservationDigest: reservation.reservationDigest,
      };
      const result = commit(
        "dispatch",
        `dispatch.${rrsiHash("rrsi-execution-id/v1", payload.executionId).slice(7)}`,
        payload,
      );
      return freezeRrsiData({
        newlyCommitted: result.newlyCommitted,
        historyAuthenticated: true,
        executionEvidenceVerified: false,
        readyForExecution: false,
        qualifiesForPromotion: false,
      });
    },
    markUnknown(input) {
      const payload = snapshotRrsiData(input);
      return commit(
        "unknown",
        `unknown.${rrsiHash("rrsi-execution-id/v1", payload.executionId).slice(7)}`,
        payload,
      ).newlyCommitted;
    },
    recordPreparationObservation(input) {
      const payload = snapshotRrsiData(input);
      return commit(
        "observe-preparation",
        `observe.${rrsiHash("rrsi-execution-id/v1", payload.executionId).slice(7)}`,
        payload,
      ).newlyCommitted;
    },
    freezeCandidate(input) {
      const payload = snapshotRrsiData(input);
      return commit(
        "freeze",
        `freeze.${rrsiDigest(payload.campaignDigest, "campaign digest").slice(7)}`,
        payload,
      ).newlyCommitted;
    },
    settle(input) {
      const evidence = snapshotRrsiData(input);
      const receiptId = rrsiId(
        evidence.core?.receiptId,
        "settlement receipt ID",
      );
      return commit(
        evidence.core.schema === RRSI_NATIVE_SETTLEMENT_SCHEMA
          ? "settle-native"
          : "settle",
        `settle.${rrsiHash("rrsi-settlement-id/v1", receiptId).slice(7)}`,
        { evidence },
      ).newlyCommitted;
    },
    inspect() {
      return withHistoryLock(() => {
        const { state, head } = load();
        const charged = charges(state);
        return rrsiEnvelope(RRSI_HISTORY_STATUS_SCHEMA, "statusDigest", {
          controlBudgetCoverage: state.preparationPlan
            ? "preparation-selection-and-final"
            : "selection-and-final-only",
          preparationPlan: state.preparationPlan,
          preparationAttempts: state.preparationAttempts,
          chargedResourcesByStage: Object.fromEntries(
            ["proposal", "selection", "final"].map((stage) => [
              stage,
              Object.fromEntries(
                Object.entries(charges(state, stage)).map(([key, value]) => [
                  key,
                  value.toString(),
                ]),
              ),
            ]),
          ),
          qualityVerdictVerified: false,
          descriptor,
          ledgerId: head.ledgerId,
          epoch: head.epoch,
          headDigest: head.headDigest,
          historyAuthenticated: true,
          candidateCount: state.candidates.size,
          campaignCount: state.campaigns.size,
          selectionQueries: state.selectionQueries,
          chargedResources: Object.fromEntries(
            Object.entries(charged).map(([key, value]) => [
              key,
              value.toString(),
            ]),
          ),
          budgetOverrun: state.overrun,
          ...(state.nativeBatches.size
            ? {
                nativeBatches: [...state.nativeBatches.values()].map(
                  (batch) => ({
                    batchDigest: batch.batchDigest,
                    queryId: batch.queryId,
                    stage: batch.stage,
                    nativeEvaluationPlanDigest:
                      batch.nativeEvaluationPlanDigest,
                    childCount: batch.children.length,
                  }),
                ),
                legacyCostAttribution: "conservatively-charged-to-every-arm/v1",
                nativeRecoveryEventHolds: [
                  ...state.nativeRecoveryHolds.values(),
                ].reduce((sum, amount) => sum + amount, 0),
                chargedResourcesInterpretation:
                  "componentwise-maximum-of-arm-charges/v1",
                chargedResourcesByArm: Object.fromEntries(
                  ["baseline", "rsi", "rrsi"].map((arm) => [
                    arm,
                    Object.fromEntries(
                      Object.entries(charges(state, null, arm)).map(
                        ([name, amount]) => [name, amount.toString()],
                      ),
                    ),
                  ]),
                ),
                chargedResourcesByStageByArm: Object.fromEntries(
                  ["baseline", "rsi", "rrsi"].map((arm) => [
                    arm,
                    Object.fromEntries(
                      ["proposal", "selection", "final"].map((stage) => [
                        stage,
                        Object.fromEntries(
                          Object.entries(charges(state, stage, arm)).map(
                            ([name, amount]) => [name, amount.toString()],
                          ),
                        ),
                      ]),
                    ),
                  ]),
                ),
                requestCostGraphVerified: false,
                billingComplete: false,
              }
            : {}),
          executions: [...state.reservations.values()]
            .map((entry) => ({
              reservation: entry.reservation,
              status: entry.status,
              dispatched: entry.dispatched,
              knownUsage: entry.knownUsage,
              executionObservation: entry.observation ?? null,
              settlementSignatureVerified: entry.settlement !== null,
              executionEvidenceVerified:
                !isRrsiNativeReservation(entry.reservation) &&
                entry.status === "settled" &&
                entry.settlement.core.usage.executions > 0,
              costEvidenceVerified:
                !isRrsiNativeReservation(entry.reservation) &&
                entry.status === "settled",
              ...(isRrsiNativeReservation(entry.reservation)
                ? {
                    knownExecutionUnits: entry.knownExecutionUnits,
                    executionCountKnowledge: RRSI_NATIVE_EXECUTION_UNITS.every(
                      (name) => entry.knownExecutionUnits[name] !== null,
                    )
                      ? "signed-category-total"
                      : "known-category-lower-bound",
                    budgetSettlementVerified: entry.status === "settled",
                    nativeExecutionDenominatorVerified: false,
                  }
                : {}),
            }))
            .sort((a, b) =>
              a.reservation.bindings.executionId <
              b.reservation.bindings.executionId
                ? -1
                : 1,
            ),
        });
      });
    },
  });
  // Validate existing roots immediately, including a changed settlement authority.
  withHistoryLock(load);
  ADAPTERS.set(
    adapter,
    Object.freeze({
      descriptor,
      ledger,
      artifactPorts: options.artifactPorts,
      ledgerArtifactResolver: options.ledgerArtifactResolver,
      resolveCampaignRoot: adapter.resolveCampaignRoot,
      resolveNativeBatch: adapter.resolveNativeBatch,
      assertNativeFreshChild(response, expectedBindings) {
        const bindings = freshNativeChildren.get(response);
        if (!bindings)
          rrsiFail(
            "native admission requires this process's fresh child capability",
            "CC_RRSI_REPLAY_FORBIDDEN",
          );
        if (
          rrsiCanonical(bindings) !==
          rrsiCanonical(snapshotRrsiData(expectedBindings))
        )
          rrsiFail("fresh native child differs from signed enrollment");
        return bindings;
      },
      inspect: adapter.inspect,
      reservePreparation: adapter.reservePreparation,
      reserveNativeBatch: adapter.reserveNativeBatch,
      recordNativeDispatch: adapter.recordNativeDispatch,
      markNativeUnknown: adapter.markNativeUnknown,
      recordDispatch: adapter.recordDispatch,
      markUnknown: adapter.markUnknown,
      recordPreparationObservation: adapter.recordPreparationObservation,
    }),
  );
  return adapter;
}
