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
  RRSI_PREPARATION_RESERVATION_SCHEMA,
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

export const RRSI_HISTORY_EVENT_SCHEMA = "chainlesschain.rrsi-history-event/v1";
export const RRSI_HISTORY_STATUS_SCHEMA =
  "chainlesschain.rrsi-history-status/v1";
export const RRSI_RESERVATION_SCHEMA = "chainlesschain.rrsi-reservation/v1";
export const RRSI_SETTLEMENT_SCHEMA = "chainlesschain.rrsi-settlement/v1";
export const RRSI_HISTORY_EVENT_TYPE = "rrsi.history.committed";
const ARTIFACT_TYPE = "rrsi-history-event";
const VERIFIERS = new WeakMap();
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
  const expectedSchema =
    reservation.schema === RRSI_PREPARATION_RESERVATION_SCHEMA
      ? RRSI_PREPARATION_SETTLEMENT_SCHEMA
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
  function charges(state, stage = null) {
    const totals = Object.fromEntries(
      RRSI_BUDGET_FIELDS.map((key) => [key, 0n]),
    );
    for (const entry of state.reservations.values()) {
      if (
        stage &&
        stage !==
          (entry.reservation.bindings.partition === "train"
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
  function checkBudget(state, reserved, stage) {
    const total = charges(state);
    const staged = charges(state, stage);
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
          entry.reservation.schema === RRSI_PREPARATION_RESERVATION_SCHEMA &&
          entry.status !== "settled",
      )
    )
      rrsiFail(
        "unresolved preparation requires independent settlement",
        "CC_RRSI_HISTORY_HOLD",
      );
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
      const reservationDigest = rrsiHash(RRSI_PREPARATION_RESERVATION_SCHEMA, {
        bindings: core,
        budget: normalized.budget,
        plannedExecutions: 1,
      });
      const reservation = freezeRrsiData({
        schema: RRSI_PREPARATION_RESERVATION_SCHEMA,
        bindings: { ...core, reservationDigest },
        budget: normalized.budget,
        plannedExecutions: 1,
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
      if (
        !selected ||
        selected.status !== "settled" ||
        selected.settlement.core.status !== "succeeded"
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
      if (kind === "dispatch") {
        // New admission guards must not erase authenticated pre-upgrade costs.
        // Old v1 dispatch history remains readable; every new dispatch rechecks.
        if (liveAdmission) {
          if (state.overrun)
            rrsiFail(
              "history contains a resource overrun",
              "CC_RRSI_BUDGET_EXCEEDED",
            );
          if (entry.reservation.schema !== RRSI_PREPARATION_RESERVATION_SCHEMA)
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
    if (kind === "settle") {
      rrsiExact(payload, ["evidence"], "execution settlement");
      const bindings = payload.evidence?.core?.bindings;
      const entry = reservationFor(
        state,
        bindings?.executionId,
        bindings?.reservationDigest,
      );
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
          ref: event.subjectRef,
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
        state.operations.set(record.operationId, { record, result });
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
        "settle",
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
          executions: [...state.reservations.values()]
            .map((entry) => ({
              reservation: entry.reservation,
              status: entry.status,
              dispatched: entry.dispatched,
              knownUsage: entry.knownUsage,
              settlementSignatureVerified: entry.settlement !== null,
              executionEvidenceVerified:
                entry.status === "settled" &&
                entry.settlement.core.usage.executions > 0,
              costEvidenceVerified: entry.status === "settled",
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
  return adapter;
}
