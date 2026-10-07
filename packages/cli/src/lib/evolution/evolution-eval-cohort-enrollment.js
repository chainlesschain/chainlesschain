/** Signed, durable preregistration and closure of a cohort's admission inventory.
 * An admission proves permission, never Actor execution or global launch coverage.
 */
import { createHash, createPublicKey, KeyObject, verify } from "node:crypto";
import { isProxy } from "node:util/types";
import {
  EvolutionArtifactPorts,
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EVOLUTION_LEDGER_MAX_EVENTS,
} from "./evolution-ledger.js";
import {
  verifyPmExplorationEffectPlan,
  verifyPmExplorationEffectSlotManifest,
} from "./pm-exploration-benchmark.js";
import {
  createEvolutionEvalLaunchAdmissionAuthority,
  resolveEvolutionEvalLaunch,
  resolveEvolutionEvalLaunchFromReadonlyAudit,
  EVOLUTION_EVAL_LAUNCH_ADMISSION_EVENT_TYPE,
} from "./evolution-eval-launch-admission.js";
import {
  captureEvolutionEvalLedger,
  readEvolutionEvalLedger,
} from "./evolution-eval-ledger-capture.js";
import {
  createEvolutionEvalReadonlyAudit,
  captureEvolutionEvalReadonlyAudit,
} from "./evolution-eval-readonly-audit.js";
import { captureRrsiHistoryLedgerAdapter } from "./rrsi-history-ledger-adapter.js";
import { snapshotRrsiData } from "./rrsi-data.js";
import {
  RRSI_COHORT_REGISTRATION_SCHEMA,
  RRSI_COHORT_PLAN_SCHEMA,
  buildRrsiEvalCampaignPlan,
  buildRrsiCohortRegistration,
  prepareRrsiCohortRegistration,
  normalizeRrsiCohortLookup,
} from "./rrsi-cohort-registration.js";

export const EVOLUTION_EVAL_COHORT_ENROLLMENT_SCHEMA =
  "chainlesschain.evolution-eval-cohort-enrollment/v1";
export const RRSI_EVAL_COHORT_ENROLLMENT_SCHEMA =
  "chainlesschain.evolution-eval-cohort-enrollment/v2";
export const RRSI_EVAL_CAMPAIGN_ENROLLMENT_SCHEMA =
  "chainlesschain.rrsi-eval-campaign-enrollment/v1";
export const RRSI_EVAL_CAMPAIGN_ENROLLMENT_EVENT_TYPE =
  "evolution.rrsi-campaign.enrolled";
export const EVOLUTION_EVAL_COHORT_SEAL_SCHEMA =
  "chainlesschain.evolution-eval-cohort-seal/v1";
export const EVOLUTION_EVAL_COHORT_ENROLLMENT_EVENT_TYPE =
  "evolution.eval-cohort.enrolled";
export const EVOLUTION_EVAL_COHORT_SEAL_EVENT_TYPE =
  "evolution.eval-cohort.sealed";
export const EVOLUTION_EVAL_COHORT_FAILED_CODE =
  "CC_EVOLUTION_EVAL_COHORT_FAILED";

const AUTHORITIES = new WeakMap();
const SLOT_BINDINGS = new WeakMap();
const DESCRIPTOR_KEYS = [
  "tenantId",
  "artifactTenantId",
  "streamId",
  "audience",
  "purpose",
  "authorityId",
  "keyId",
  "trustPolicyDigest",
];
const SLOT_KEYS = [
  "slotId",
  "evaluationPlanDigest",
  "requestDigest",
  "policyDigest",
  "evaluationAuthorityRoot",
];
const ARTIFACT_TYPE = "evolution-eval-child-evidence";
const LIMITS = {
  cohortCompletenessAuthenticated: false,
  promotionAuthority: false,
};

function fail(message) {
  const error = new Error(message);
  error.code = EVOLUTION_EVAL_COHORT_FAILED_CODE;
  throw error;
}
function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
function hash(domain, value) {
  return `sha256:${createHash("sha256")
    .update(`${domain}\0${canonical(value)}`)
    .digest("hex")}`;
}
function frozen(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
function snapshot(value, depth = 0) {
  if (depth > 50) fail("cohort evidence nesting exceeds limit");
  if (value === null || ["string", "boolean"].includes(typeof value))
    return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || isProxy(value))
    fail("cohort evidence must contain JSON data");
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      Reflect.ownKeys(value).length !== value.length + 1
    )
      fail("cohort evidence array must be dense own data");
    return Array.from({ length: value.length }, (_, index) => {
      const property = Object.getOwnPropertyDescriptor(value, String(index));
      if (!property || !("value" in property))
        fail("cohort evidence array must be own data");
      return snapshot(property.value, depth + 1);
    });
  }
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    fail("cohort evidence must be plain data");
  return Object.fromEntries(
    Reflect.ownKeys(value).map((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (
        typeof key !== "string" ||
        !property.enumerable ||
        !("value" in property)
      )
        fail("cohort evidence fields must be own data");
      return [key, snapshot(property.value, depth + 1)];
    }),
  );
}
function record(value, keys, label) {
  if (
    !value ||
    Array.isArray(value) ||
    typeof value !== "object" ||
    isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some((key) => {
      const property = Object.getOwnPropertyDescriptor(value, key);
      return !property || !("value" in property);
    })
  )
    fail(`${label} must contain exactly its own data fields`);
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}
function text(value, label) {
  if (
    typeof value !== "string" ||
    !value.length ||
    value.length > 256 ||
    value.trim() !== value ||
    [...value].some((character) => character.codePointAt(0) < 32)
  )
    fail(`${label} is invalid`);
  return value;
}
function digest(value, label) {
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value))
    fail(`${label} must be a sha256 digest`);
  return value;
}
function stateOf(authority) {
  const state = AUTHORITIES.get(authority);
  if (!state) fail("a branded cohort enrollment authority is required");
  return state;
}
function scopeId(input) {
  return text(
    record(input, ["cohortId"], "cohort lookup").cohortId,
    "cohortId",
  );
}
function allEvents(state) {
  return readEvolutionEvalLedger(state.ledgerMethods);
}
function head(state) {
  return state.ledgerMethods.verify();
}
function eventId(state, cohortId, type) {
  return `${type}.${hash("eval-cohort-identity/v1", { tenantId: state.descriptor.tenantId, streamId: state.descriptor.streamId, cohortId }).slice(7)}`;
}
function matching(state, cohortId, type, census = null) {
  return (census ?? allEvents(state)).filter(
    (event) =>
      event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
      event.eventId === eventId(state, cohortId, type),
  );
}
const READONLY_COHORT_AUDITS = new WeakMap();

function nativeAuditContext(state, ledgerAudit) {
  if (!state.rrsiHistory)
    fail("native audit requires genuine RRSI History composition");
  const shared = captureEvolutionEvalReadonlyAudit(ledgerAudit, state.ledger);
  const context = {
    ledgerAudit,
    shared,
    census: shared.events,
    identity: shared.identity,
    historyRoot: state.rrsiHistory.resolveCampaignRoot(),
    resolutions: new Map(),
    registrations: new Map(),
    enrollments: new Map(),
    reconciliations: new Map(),
    verifiedAdmissions: new Map(),
  };
  context.campaign = resolveRrsiCampaign(state, context);
  return context;
}

/** Read-only session caches are private, authority-bound and scoped to one journal snapshot. */
export function createRrsiEvalCohortReadonlyAudit(
  authority,
  ledgerAudit = null,
) {
  const state = stateOf(authority);
  const context = nativeAuditContext(
    state,
    ledgerAudit ?? createEvolutionEvalReadonlyAudit(state.ledger),
  );
  const session = Object.freeze({
    schema: "chainlesschain.rrsi-cohort-readonly-audit/v1",
  });
  READONLY_COHORT_AUDITS.set(session, { state, context });
  return session;
}

export function assertRrsiEvalCohortReadonlyAuditUnchanged(session) {
  const captured = READONLY_COHORT_AUDITS.get(session);
  if (!captured) fail("a branded native cohort audit is required");
  return captured.context.shared.assertUnchanged();
}

export async function resolveRrsiEvalCohortFromReadonlyAudit(
  authority,
  input,
  session,
) {
  const state = stateOf(authority);
  const captured = READONLY_COHORT_AUDITS.get(session);
  if (!captured || captured.state !== state)
    fail("a matching branded native cohort audit is required");
  captureEvolutionEvalReadonlyAudit(captured.context.ledgerAudit, state.ledger);
  const cohortId = scopeId(input);
  const reconciliation = await reconcileCohort(
    state,
    cohortId,
    captured.context,
  );
  return frozen({
    enrollment: captured.context.enrollments.get(cohortId),
    reconciliation,
    auditHead: captured.context.identity,
    historicalSnapshotOnly: true,
    requiresFinalAuditHeadCheck: true,
    readyForExecution: false,
  });
}

function admissions(state, nativeContext = null) {
  if (nativeContext?.streamAdmissions) return nativeContext.streamAdmissions;
  const result = (nativeContext?.census ?? allEvents(state)).filter(
    (event) =>
      event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
      event.type === EVOLUTION_EVAL_LAUNCH_ADMISSION_EVENT_TYPE &&
      event.tenantId === state.descriptor.tenantId &&
      event.correlationId === state.descriptor.streamId,
  );
  if (nativeContext?.ledgerAudit) nativeContext.streamAdmissions = result;
  return result;
}
function readArtifact(state, event, wrapper = false, capturedIdentity = null) {
  const identity = capturedIdentity ?? head(state);
  const result = state.resolveArtifact({
    epoch: identity.epoch,
    ledgerId: identity.ledgerId,
    ref: event.subjectRef,
    tenantId: state.descriptor.artifactTenantId,
  });
  if (
    result?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    result.authenticated !== true ||
    result.found !== true ||
    result.ref !== event.subjectRef.ref ||
    result.digest !== event.subjectRef.digest ||
    !Buffer.isBuffer(result.bytes)
  )
    fail("cohort artifact resolution rejected");
  let stored;
  try {
    stored = JSON.parse(result.bytes.toString("utf8"));
  } catch {
    fail("cohort artifact is not JSON");
  }
  if (
    stored.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    stored.tenantId !== state.descriptor.artifactTenantId ||
    stored.audience !== state.descriptor.audience ||
    stored.purpose !== state.descriptor.purpose ||
    stored.retention !== "ledger" ||
    stored.type !== ARTIFACT_TYPE
  )
    fail("cohort durable artifact scope differs");
  return wrapper ? stored : stored.value;
}
function signatureMessage(core) {
  return Buffer.from(`${core.schema}\0${canonical(core)}`, "utf8");
}
function verifySigned(state, value, schema, fields) {
  const evidence = record(
    value,
    ["schema", "descriptor", ...fields, "attestation"],
    "cohort signed evidence",
  );
  if (
    evidence.schema !== schema ||
    canonical(evidence.descriptor) !== canonical(state.descriptor)
  )
    fail("cohort evidence scope is substituted");
  const attestation = record(
    evidence.attestation,
    ["algorithm", "issuer", "keyId", "trustPolicyDigest", "value"],
    "cohort attestation",
  );
  if (
    attestation.algorithm !== "ed25519" ||
    attestation.issuer !== state.descriptor.authorityId ||
    attestation.keyId !== state.descriptor.keyId ||
    attestation.trustPolicyDigest !== state.descriptor.trustPolicyDigest ||
    typeof attestation.value !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/u.test(attestation.value)
  )
    fail("cohort signature trust differs from fixed anchor");
  const core = { ...evidence };
  delete core.attestation;
  const bytes = Buffer.from(attestation.value, "base64url");
  if (
    bytes.length !== 64 ||
    bytes.toString("base64url") !== attestation.value ||
    !verify(null, signatureMessage(core), state.publicKey, bytes)
  )
    fail("cohort Ed25519 signature rejected");
  if (
    typeof evidence.issuedAt !== "string" ||
    !Number.isFinite(Date.parse(evidence.issuedAt)) ||
    new Date(evidence.issuedAt).toISOString() !== evidence.issuedAt
  )
    fail("cohort issuedAt is invalid");
  return frozen(snapshot(evidence));
}
function sign(state, core) {
  return {
    ...core,
    attestation: {
      algorithm: "ed25519",
      issuer: state.descriptor.authorityId,
      keyId: state.descriptor.keyId,
      trustPolicyDigest: state.descriptor.trustPolicyDigest,
      value: state.sign(
        Object.freeze({ message: signatureMessage(core).toString("utf8") }),
      ),
    },
  };
}
function issuedAt(state) {
  const now = state.now();
  if (!Number.isFinite(now)) fail("cohort clock is invalid");
  return new Date(now).toISOString();
}
function validateRegistration(input, state, nativeContext = null) {
  const nativeSource = snapshot(input);
  if (
    nativeSource.schema === RRSI_COHORT_REGISTRATION_SCHEMA ||
    nativeSource.plan?.schema === RRSI_COHORT_PLAN_SCHEMA
  ) {
    if (!state?.rrsiHistory)
      fail("native enrollment requires genuine RRSI History composition");
    const source =
      nativeSource.schema === RRSI_COHORT_REGISTRATION_SCHEMA
        ? normalizeRrsiCohortLookup(nativeSource)
        : record(
            nativeSource,
            ["plan", "manifest", "slots"],
            "native cohort declaration",
          );
    const campaign = nativeContext?.campaign ?? resolveRrsiCampaign(state);
    const batchDigest = source.batchDigest ?? source.plan.batchDigest;
    if (
      nativeContext?.expectedBatchDigest &&
      nativeContext.expectedBatchDigest !== batchDigest
    )
      fail("native audit belongs to another batch");
    const resolution =
      nativeContext?.resolution ??
      nativeContext?.resolutions?.get(batchDigest) ??
      state.rrsiHistory.resolveNativeBatch({ batchDigest });
    if (nativeContext?.resolutions)
      nativeContext.resolutions.set(batchDigest, resolution);
    if (resolution.batch.batchDigest !== batchDigest)
      fail("native registration snapshot belongs to another batch");
    const cohortId = source.cohortId ?? source.manifest.cohortId;
    let prepared = nativeContext?.registrations?.get(batchDigest);
    if (!prepared && nativeContext?.registrations) {
      prepared = prepareRrsiCohortRegistration(
        campaign.evidence.plan,
        resolution,
      );
      nativeContext.registrations.set(batchDigest, prepared);
    }
    const derived = prepared
      ? prepared.build(cohortId)
      : buildRrsiCohortRegistration(
          campaign.evidence.plan,
          resolution,
          cohortId,
        );
    if (state.descriptor.streamId !== derived.plan.queryStreamId)
      fail("native cohort must use its global History query stream");
    if (
      nativeSource.schema !== RRSI_COHORT_REGISTRATION_SCHEMA &&
      canonical(nativeSource) !== canonical(derived)
    )
      fail("native cohort declaration differs from committed History");
    return frozen(derived);
  }
  const source = record(
    nativeSource,
    ["plan", "manifest", "slots"],
    "cohort registration",
  );
  const plan = verifyPmExplorationEffectPlan(source.plan);
  const manifest = verifyPmExplorationEffectSlotManifest({
    plan,
    manifest: source.manifest,
  });
  if (
    !Array.isArray(source.slots) ||
    source.slots.length !== manifest.slotIds.length
  )
    fail("cohort slots must cover the complete manifest");
  const slots = source.slots.map((slot, index) => {
    const output = record(slot, SLOT_KEYS, "cohort slot");
    if (output.slotId !== manifest.slotIds[index])
      fail("cohort slots differ from manifest membership/order");
    for (const field of SLOT_KEYS.filter((key) => key !== "slotId"))
      digest(output[field], field);
    return output;
  });
  return frozen({ plan, manifest, slots });
}
const ENROLL_FIELDS = ["cohortId", "plan", "manifest", "slots", "issuedAt"];
const SEAL_FIELDS = [
  "cohortId",
  "enrollmentDigest",
  "inventory",
  "preSealHead",
  "issuedAt",
];
function checkEvent(state, event, cohortId, type, evidence, sourceRefs) {
  const expectedRefs = [...sourceRefs].sort((left, right) =>
    left.ref < right.ref
      ? -1
      : left.ref > right.ref
        ? 1
        : left.digest < right.digest
          ? -1
          : left.digest > right.digest
            ? 1
            : 0,
  );
  if (
    event.eventId !== eventId(state, cohortId, type) ||
    event.type !== type ||
    event.tenantId !== state.descriptor.tenantId ||
    event.artifactTenantId !== state.descriptor.artifactTenantId ||
    event.correlationId !== state.descriptor.streamId ||
    event.decision !== "accepted" ||
    event.skillName !== "evolution-eval" ||
    event.timestamp !== evidence.issuedAt ||
    canonical(event.sourceRefs) !== canonical(expectedRefs)
  )
    fail("cohort Ledger event differs from signed evidence");
}
function resolveEnrollment(state, cohortId, nativeContext = null) {
  if (nativeContext?.enrollments?.has(cohortId))
    return nativeContext.enrollments.get(cohortId);
  const found = matching(
    state,
    cohortId,
    EVOLUTION_EVAL_COHORT_ENROLLMENT_EVENT_TYPE,
    nativeContext?.census ?? null,
  );
  if (found.length !== 1) fail("cohort enrollment is absent or ambiguous");
  const event = found[0];
  const evidence = verifySigned(
    state,
    readArtifact(state, event, false, nativeContext?.identity ?? null),
    state.rrsiHistory
      ? RRSI_EVAL_COHORT_ENROLLMENT_SCHEMA
      : EVOLUTION_EVAL_COHORT_ENROLLMENT_SCHEMA,
    ENROLL_FIELDS,
  );
  const registration = validateRegistration(
    {
      plan: evidence.plan,
      manifest: evidence.manifest,
      slots: evidence.slots,
    },
    state,
    nativeContext,
  );
  if (
    evidence.cohortId !== cohortId ||
    registration.manifest.cohortId !== cohortId
  )
    fail("cohort enrollment identity differs");
  checkEvent(
    state,
    event,
    cohortId,
    EVOLUTION_EVAL_COHORT_ENROLLMENT_EVENT_TYPE,
    evidence,
    state.rrsiHistory
      ? [
          (nativeContext?.campaign ?? resolveRrsiCampaign(state)).enrollmentRef,
          registration.manifest.reservationRecord.ref,
        ]
      : [],
  );
  const result = frozen({
    schema: "chainlesschain.evolution-eval-cohort-enrollment-resolution/v1",
    enrollmentDigest: hash(evidence.schema, evidence),
    evidence,
    enrollmentRef: event.subjectRef,
    enrollmentSequence: event.sequence,
    authenticated: true,
    durable: true,
    ...LIMITS,
  });
  if (nativeContext?.enrollments)
    nativeContext.enrollments.set(cohortId, result);
  return result;
}
function publish(state, cohortId, type, evidence, sourceRefs, expectedHead) {
  if (state.rrsiHistory) snapshotRrsiData(evidence);
  if (
    state.rrsiHistory &&
    expectedHead.sequence +
      1 +
      (state.rrsiHistory.inspect().nativeRecoveryEventHolds ?? 0) >
      EVOLUTION_LEDGER_MAX_EVENTS
  )
    fail("cohort must preserve native History recovery capacity");
  const published = EvolutionArtifactPorts.prototype.putCanonical.call(
    state.artifactPorts,
    ARTIFACT_TYPE,
    evidence,
    {
      audience: state.descriptor.audience,
      purpose: state.descriptor.purpose,
      retention: "ledger",
    },
  );
  if (
    published?.receipt?.persisted !== true ||
    published.receipt.readbackVerified !== true ||
    published.receipt.integrityVerified !== true ||
    published.receipt.retention !== "ledger"
  )
    fail("cohort artifact persistence failed");
  if (state.rrsiHistory)
    snapshotRrsiData(readArtifact(state, { subjectRef: published.ref }, true));
  const receipt = state.ledgerMethods.appendDomainEvent(
    {
      type,
      eventId: eventId(state, cohortId, type),
      tenantId: state.descriptor.tenantId,
      artifactTenantId: state.descriptor.artifactTenantId,
      correlationId: state.descriptor.streamId,
      decision: "accepted",
      skillName: "evolution-eval",
      reason:
        "signed cohort admission inventory; execution coverage remains unproven",
      sourceRefs,
      subjectRef: published.ref,
      timestamp: evidence.issuedAt,
    },
    {
      expectedHeadDigest: expectedHead.headDigest,
      expectedSequence: expectedHead.sequence,
    },
  );
  if (receipt?.authenticated !== true || receipt.durable !== true)
    fail("cohort Ledger persistence failed");
}

function rrsiCampaignState(state, historyRoot = null) {
  if (!state.rrsiHistory)
    fail("RRSI campaign needs genuine History composition");
  const plan = buildRrsiEvalCampaignPlan(
    historyRoot ?? state.rrsiHistory.resolveCampaignRoot(),
  );
  return {
    ...state,
    descriptor: frozen({
      ...state.descriptor,
      streamId: `rrsi-root.${plan.campaignRootDigest.slice(7)}`,
    }),
    campaignPlan: plan,
  };
}

function resolveRrsiCampaign(state, nativeContext = null) {
  const root = rrsiCampaignState(state, nativeContext?.historyRoot ?? null);
  const cohortId = root.campaignPlan.campaignRootDigest;
  const matches = matching(
    root,
    cohortId,
    RRSI_EVAL_CAMPAIGN_ENROLLMENT_EVENT_TYPE,
    nativeContext?.census ?? null,
  );
  if (matches.length !== 1) fail("RRSI campaign root is absent or ambiguous");
  const event = matches[0];
  const evidence = verifySigned(
    root,
    readArtifact(root, event, false, nativeContext?.identity ?? null),
    RRSI_EVAL_CAMPAIGN_ENROLLMENT_SCHEMA,
    ["cohortId", "plan", "issuedAt"],
  );
  if (
    evidence.cohortId !== cohortId ||
    canonical(evidence.plan) !== canonical(root.campaignPlan)
  )
    fail("RRSI signed campaign root differs from durable History");
  checkEvent(
    root,
    event,
    cohortId,
    RRSI_EVAL_CAMPAIGN_ENROLLMENT_EVENT_TYPE,
    evidence,
    [root.campaignPlan.rootRegistrationRecord.ref],
  );
  return frozen({
    enrollmentDigest: hash(evidence.schema, evidence),
    enrollmentRef: event.subjectRef,
    enrollmentSequence: event.sequence,
    evidence,
    authenticated: true,
    durable: true,
    productionAdmissionVerified: false,
    promotionAuthority: false,
  });
}

/** Freeze the shared History quota root before any native child dispatch. */
export function enrollRrsiEvalCampaign(authority) {
  const state = stateOf(authority);
  const expectedHead = head(state);
  const root = rrsiCampaignState(state);
  const cohortId = root.campaignPlan.campaignRootDigest;
  if (matching(root, cohortId, RRSI_EVAL_CAMPAIGN_ENROLLMENT_EVENT_TYPE).length)
    fail("RRSI campaign root is already enrolled");
  if (
    state.rrsiHistory
      .inspect()
      .executions.some(
        (entry) =>
          entry.reservation.schema ===
            "chainlesschain.rrsi-native-reservation/v1" && entry.dispatched,
      )
  )
    fail("RRSI campaign root must precede native dispatch");
  const evidence = verifySigned(
    root,
    sign(root, {
      schema: RRSI_EVAL_CAMPAIGN_ENROLLMENT_SCHEMA,
      descriptor: root.descriptor,
      cohortId,
      plan: root.campaignPlan,
      issuedAt: issuedAt(root),
    }),
    RRSI_EVAL_CAMPAIGN_ENROLLMENT_SCHEMA,
    ["cohortId", "plan", "issuedAt"],
  );
  publish(
    root,
    cohortId,
    RRSI_EVAL_CAMPAIGN_ENROLLMENT_EVENT_TYPE,
    evidence,
    [root.campaignPlan.rootRegistrationRecord.ref],
    expectedHead,
  );
  return resolveRrsiCampaign(state);
}

export function resolveRrsiEvalCampaign(authority) {
  return resolveRrsiCampaign(stateOf(authority));
}

export function createEvolutionEvalCohortEnrollmentAuthority({
  descriptor,
  publicKey,
  signer,
  artifactPorts,
  ledger,
  ledgerArtifactResolver,
  now = Date.now,
  rrsiHistoryAdapter = null,
} = {}) {
  const scope = record(
    descriptor,
    DESCRIPTOR_KEYS,
    "cohort authority descriptor",
  );
  for (const key of DESCRIPTOR_KEYS) text(scope[key], key);
  digest(scope.trustPolicyDigest, "trustPolicyDigest");
  if (scope.purpose !== "evolution-ledger")
    fail("cohort requires Ledger retention purpose");
  if (
    !(artifactPorts instanceof EvolutionArtifactPorts) ||
    isProxy(artifactPorts) ||
    isProxy(ledger) ||
    !isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)
  )
    fail("cohort requires real artifact ports, Ledger and branded resolver");
  let ledgerMethods;
  try {
    ledgerMethods = captureEvolutionEvalLedger(ledger);
  } catch {
    fail("cohort requires real artifact ports, Ledger and branded resolver");
  }
  const rrsiHistory =
    rrsiHistoryAdapter === null
      ? null
      : captureRrsiHistoryLedgerAdapter(rrsiHistoryAdapter);
  if (
    rrsiHistory &&
    (rrsiHistory.ledger !== ledger ||
      rrsiHistory.artifactPorts !== artifactPorts ||
      rrsiHistory.ledgerArtifactResolver !== ledgerArtifactResolver ||
      ["tenantId", "artifactTenantId", "audience", "purpose"].some(
        (name) => rrsiHistory.descriptor[name] !== scope[name],
      ))
  )
    fail("native cohort must use the same History storage and scope");
  if (!signer || isProxy(signer) || typeof now !== "function" || isProxy(now))
    fail("cohort signer and clock are required");
  const signing = Object.getOwnPropertyDescriptor(signer, "sign")?.value;
  if (typeof signing !== "function" || isProxy(signing))
    fail("cohort signer must be an own callable");
  const key =
    publicKey instanceof KeyObject && publicKey.type === "public"
      ? publicKey
      : createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519")
    fail("cohort anchor must be Ed25519");
  const authority = Object.freeze({ descriptor: frozen(scope) });
  AUTHORITIES.set(authority, {
    descriptor: authority.descriptor,
    publicKey: key,
    sign: signing.bind(signer),
    artifactPorts,
    ledger,
    ledgerMethods,
    rrsiHistory,
    resolveArtifact: ledgerArtifactResolver,
    now,
  });
  return authority;
}

export function enrollEvolutionEvalCohort(authority, input) {
  const state = stateOf(authority);
  const registration = validateRegistration(input, state);
  if (state.rrsiHistory && registration.plan.schema !== RRSI_COHORT_PLAN_SCHEMA)
    fail("native authority cannot downgrade to PM enrollment");
  const cohortId = registration.manifest.cohortId;
  const expectedHead = head(state);
  if (
    matching(state, cohortId, EVOLUTION_EVAL_COHORT_ENROLLMENT_EVENT_TYPE)
      .length ||
    matching(state, cohortId, EVOLUTION_EVAL_COHORT_SEAL_EVENT_TYPE).length
  )
    fail("cohort is already enrolled or sealed");
  // All cohorts sharing a stream must be enrolled before its first admission.
  // Legacy admissions cannot establish a trustworthy cohort identity.
  if (admissions(state).length)
    fail("stream admission already exists before enrollment");
  if (state.rrsiHistory) {
    const resolution = state.rrsiHistory.resolveNativeBatch({
      batchDigest: registration.plan.batchDigest,
    });
    if (
      resolution.budgetOverrun ||
      resolution.children.some((child) =>
        child.states.some((arm) => arm.status !== "reserved" || arm.dispatched),
      )
    )
      fail("native enrollment must precede every paired dispatch in its query");
  }
  const evidence = verifySigned(
    state,
    sign(state, {
      schema: state.rrsiHistory
        ? RRSI_EVAL_COHORT_ENROLLMENT_SCHEMA
        : EVOLUTION_EVAL_COHORT_ENROLLMENT_SCHEMA,
      descriptor: state.descriptor,
      cohortId,
      ...registration,
      issuedAt: issuedAt(state),
    }),
    state.rrsiHistory
      ? RRSI_EVAL_COHORT_ENROLLMENT_SCHEMA
      : EVOLUTION_EVAL_COHORT_ENROLLMENT_SCHEMA,
    ENROLL_FIELDS,
  );
  publish(
    state,
    cohortId,
    EVOLUTION_EVAL_COHORT_ENROLLMENT_EVENT_TYPE,
    evidence,
    state.rrsiHistory
      ? [
          resolveRrsiCampaign(state).enrollmentRef,
          registration.manifest.reservationRecord.ref,
        ]
      : [],
    expectedHead,
  );
  const result = resolveEnrollment(state, cohortId);
  if (canonical(result.evidence) !== canonical(evidence))
    fail("cohort enrollment readback differs");
  return result;
}

export function resolveEvolutionEvalCohortEnrollment(authority, input) {
  return resolveEnrollment(stateOf(authority), scopeId(input));
}

/** Read-only identity check, never an admission or dispatch capability. */
export function assertRrsiEvalCohortHistoryComposition(authority, adapter) {
  const state = stateOf(authority);
  const history = captureRrsiHistoryLedgerAdapter(adapter);
  if (
    !state.rrsiHistory ||
    state.rrsiHistory.ledger !== history.ledger ||
    state.rrsiHistory.artifactPorts !== history.artifactPorts ||
    state.rrsiHistory.ledgerArtifactResolver !==
      history.ledgerArtifactResolver ||
    canonical(state.rrsiHistory.descriptor) !== canonical(history.descriptor)
  )
    fail("native cohort census requires the same History storage and scope");
  return true;
}

function slotDescriptor(state, enrollment, slot) {
  return frozen({
    ...state.descriptor,
    planDigest: slot.evaluationPlanDigest,
    manifestDigest: enrollment.evidence.manifest.manifestDigest,
    cohortId: enrollment.evidence.cohortId,
    slotId: slot.slotId,
  });
}
function assertNativeQueryReady(state, enrollment) {
  const campaign = resolveRrsiCampaign(state);
  const resolution = state.rrsiHistory.resolveNativeBatch({
    batchDigest: enrollment.evidence.plan.batchDigest,
  });
  if (resolution.budgetOverrun) fail("native History has a resource overrun");
  if (
    head(state).sequence + 1 + resolution.recoveryEventsHeld >
    EVOLUTION_LEDGER_MAX_EVENTS
  )
    fail("admission must preserve native History recovery capacity");
  const identity = head(state);
  const census = allEvents(state);
  for (const cohortId of enrollment.evidence.manifest.allCohortIds) {
    const sibling = resolveEnrollment(state, cohortId, {
      campaign,
      resolution,
      census,
      identity,
    });
    if (
      sibling.evidence.plan.schema !== RRSI_COHORT_PLAN_SCHEMA ||
      sibling.evidence.plan.batchDigest !==
        enrollment.evidence.plan.batchDigest ||
      sibling.evidence.manifest.queryOrdinal !==
        enrollment.evidence.manifest.queryOrdinal ||
      canonical(sibling.evidence.manifest.reservationRecord) !==
        canonical(enrollment.evidence.manifest.reservationRecord)
    )
      fail("native query enrollment barrier is incomplete or substituted");
  }
  const current = head(state);
  if (
    ["ledgerId", "identityDigest", "epoch", "headDigest", "sequence"].some(
      (name) => current[name] !== identity[name],
    )
  )
    fail("Ledger changed during native query barrier; retry audit");
  return resolution;
}

function deriveSlot(state, enrollment, slot, freshChild = null) {
  const descriptor = slotDescriptor(state, enrollment, slot);
  const expectedRequest = frozen({
    requestDigest: slot.requestDigest,
    policyDigest: slot.policyDigest,
    evaluationAuthorityRoot: slot.evaluationAuthorityRoot,
  });
  const binding = Object.freeze({});
  const nativeChild = state.rrsiHistory
    ? enrollment.evidence.manifest.childBindings.find(
        (child) => child.slotId === slot.slotId,
      )
    : null;
  let preparedAttempt = false;
  let livePermit = null;
  const recordNativeFailure = () => {
    const resolution = state.rrsiHistory.resolveNativeBatch({
      batchDigest: enrollment.evidence.plan.batchDigest,
    });
    const child = resolution.children.find(
      (child) => child.bindings.childId === nativeChild.childId,
    );
    if (
      child?.states.some(
        (arm) => arm.dispatched && arm.status === "dispatch-intent",
      )
    )
      state.rrsiHistory.markNativeUnknown({
        childId: nativeChild.childId,
        batchDigest: enrollment.evidence.plan.batchDigest,
      });
  };
  SLOT_BINDINGS.set(binding, {
    state,
    descriptor,
    enrollmentDigest: enrollment.enrollmentDigest,
    enrollmentRef: enrollment.enrollmentRef,
    expectedRequest,
    ...(state.rrsiHistory
      ? {
          registrationKind: "rrsi-native",
          historyBinding: {
            campaignRootDigest: enrollment.evidence.plan.campaignRootDigest,
            batchDigest: enrollment.evidence.plan.batchDigest,
            childId: nativeChild.childId,
            queryOrdinal: enrollment.evidence.manifest.queryOrdinal,
          },
          prepare(input) {
            if (preparedAttempt)
              fail("native admission permit has already been consumed");
            preparedAttempt = true;
            if (!freshChild)
              fail("native admission requires a fresh paired child capability");
            for (const key of Object.keys(expectedRequest))
              if (input[key] !== expectedRequest[key])
                fail("native admission request differs from enrolled child");
            state.rrsiHistory.assertNativeFreshChild(
              freshChild,
              nativeChild.bindings,
            );
            const resolution = assertNativeQueryReady(state, enrollment);
            const child = resolution.children.find(
              (child) => child.bindings.childId === nativeChild.childId,
            );
            if (
              !child ||
              child.states.some(
                (arm) => arm.status !== "reserved" || arm.dispatched,
              )
            )
              fail("native child is not fresh and reserved");
            if (
              matching(
                state,
                descriptor.cohortId,
                EVOLUTION_EVAL_COHORT_SEAL_EVENT_TYPE,
              ).length
            )
              fail("cohort is sealed");
            try {
              const dispatch =
                state.rrsiHistory.recordNativeDispatch(freshChild);
              if (!dispatch.newlyCommitted)
                fail("native dispatch outcome is not fresh");
              livePermit = frozen(snapshot(input));
            } catch (error) {
              try {
                recordNativeFailure();
              } catch {
                /* Admission is unavailable; intent remains held. */
              }
              throw error;
            }
          },
          recordFailure: recordNativeFailure,
        }
      : {}),
    assertOpen(input) {
      const current = resolveEnrollment(state, descriptor.cohortId);
      if (current.enrollmentDigest !== enrollment.enrollmentDigest)
        fail("cohort enrollment changed");
      if (
        matching(
          state,
          descriptor.cohortId,
          EVOLUTION_EVAL_COHORT_SEAL_EVENT_TYPE,
        ).length
      )
        fail("cohort is sealed");
      for (const key of Object.keys(expectedRequest))
        if (input[key] !== expectedRequest[key])
          fail("admission request differs from enrolled slot");
      if (state.rrsiHistory) {
        if (!livePermit || canonical(input) !== canonical(livePermit))
          fail("native admission has no matching live run permit");
        const resolution = assertNativeQueryReady(state, enrollment);
        const child = resolution.children.find(
          (child) => child.bindings.childId === nativeChild.childId,
        );
        if (
          !child ||
          child.states.some(
            (arm) => !arm.dispatched || arm.status !== "dispatch-intent",
          )
        )
          fail("native child dispatch intent is stale or unresolved");
      }
    },
  });
  return createEvolutionEvalLaunchAdmissionAuthority({
    descriptor,
    publicKey: state.publicKey,
    signer: { sign: state.sign },
    artifactPorts: state.artifactPorts,
    ledger: state.ledger,
    ledgerArtifactResolver: state.resolveArtifact,
    now: state.now,
    cohortSlotBinding: binding,
  });
}

/** Internal branded capability capture: data copies and different storage/key ports are rejected. */
export function captureEvolutionEvalCohortSlotBinding(binding, expected) {
  const captured = SLOT_BINDINGS.get(binding);
  if (
    !captured ||
    canonical(captured.descriptor) !== canonical(expected.descriptor) ||
    captured.state.ledger !== expected.ledger ||
    captured.state.artifactPorts !== expected.artifactPorts ||
    captured.state.resolveArtifact !== expected.ledgerArtifactResolver ||
    !captured.state.publicKey.equals(expected.publicKey)
  )
    fail("a matching branded cohort slot binding is required");
  return Object.freeze({
    enrollmentDigest: captured.enrollmentDigest,
    enrollmentRef: captured.enrollmentRef,
    expectedRequest: captured.expectedRequest,
    assertOpen: captured.assertOpen,
    ...(captured.registrationKind
      ? {
          registrationKind: captured.registrationKind,
          historyBinding: captured.historyBinding,
          prepare: captured.prepare,
          recordFailure: captured.recordFailure,
        }
      : {}),
  });
}

export function createEvolutionEvalCohortSlotAdmissionAuthority(
  authority,
  input,
) {
  const state = stateOf(authority);
  const lookup = record(
    input,
    [
      "cohortId",
      "slotId",
      ...(state.rrsiHistory &&
      input &&
      typeof input === "object" &&
      !isProxy(input) &&
      Object.hasOwn(input, "freshChild")
        ? ["freshChild"]
        : []),
    ],
    "cohort slot lookup",
  );
  text(lookup.cohortId, "cohortId");
  text(lookup.slotId, "slotId");
  const enrollment = resolveEnrollment(state, lookup.cohortId);
  const slot = enrollment.evidence.slots.find(
    (item) => item.slotId === lookup.slotId,
  );
  if (!slot) fail("slot is not in the enrolled manifest");
  return deriveSlot(state, enrollment, slot, lookup.freshChild ?? null);
}

async function inventory(
  state,
  enrollment,
  sealSequence = Infinity,
  nativeContext = null,
) {
  if (!nativeContext) return legacyInventory(state, enrollment, sealSequence);
  const result = [];
  const used = new Set();
  for (const event of admissions(state, nativeContext)) {
    let checked = nativeContext?.verifiedAdmissions?.get(event.eventId);
    let value, registered, slot, resolution;
    if (checked) ({ value, registered, slot, resolution } = checked);
    else {
      value = readArtifact(
        state,
        event,
        false,
        nativeContext?.identity ?? null,
      );
      // Reject ambiguous legacy entries instead of accepting a caller-selected subset.
      if (!value.descriptor)
        fail("legacy admission prevents complete cohort inventory");
      registered =
        value.descriptor.cohortId === enrollment.evidence.cohortId
          ? enrollment
          : resolveEnrollment(
              state,
              text(value.descriptor.cohortId, "admission cohortId"),
              nativeContext,
            );
      slot = registered.evidence.slots.find(
        (item) => item.slotId === value.descriptor.slotId,
      );
      if (!slot) fail("unknown cohort admission slot");
      const authority = deriveSlot(state, registered, slot);
      const lookup = {
        runId: value.runId,
        runNonce: value.runNonce,
        requestDigest: value.requestDigest,
      };
      resolution = nativeContext?.ledgerAudit
        ? await resolveEvolutionEvalLaunchFromReadonlyAudit(
            authority,
            lookup,
            nativeContext.ledgerAudit,
          )
        : await resolveEvolutionEvalLaunch(authority, lookup);
      if (
        resolution.eventId !== event.eventId ||
        resolution.eventSequence !== event.sequence ||
        canonical(resolution.evidence) !== canonical(value)
      )
        fail("cohort admission event substitution");
      if (nativeContext?.verifiedAdmissions)
        nativeContext.verifiedAdmissions.set(event.eventId, {
          value,
          registered,
          slot,
          resolution,
        });
    }
    const ownCohort =
      value.descriptor.cohortId === enrollment.evidence.cohortId;
    if (
      event.sequence <= registered.enrollmentSequence ||
      (ownCohort && event.sequence >= sealSequence)
    )
      fail("admission lies outside cohort enrollment/seal boundary");
    if (!slot || (ownCohort && used.has(slot.slotId)))
      fail("unknown or duplicate cohort admission slot");
    if (!ownCohort) continue;
    used.add(slot.slotId);
    result.push({
      slotId: slot.slotId,
      eventId: event.eventId,
      sequence: event.sequence,
      admissionDigest: resolution.admissionDigest,
      runId: value.runId,
      runNonce: value.runNonce,
      requestDigest: value.requestDigest,
    });
  }
  return frozen({
    admissions: result,
    unadmittedSlotIds: enrollment.evidence.slots
      .filter((slot) => !used.has(slot.slotId))
      .map((slot) => slot.slotId),
  });
}

async function legacyInventory(state, enrollment, sealSequence = Infinity) {
  const result = [];
  const used = new Set();
  for (const event of admissions(state)) {
    const value = readArtifact(state, event);
    if (!value.descriptor)
      fail("legacy admission prevents complete cohort inventory");
    const ownCohort =
      value.descriptor.cohortId === enrollment.evidence.cohortId;
    const registered = ownCohort
      ? enrollment
      : resolveEnrollment(
          state,
          text(value.descriptor.cohortId, "admission cohortId"),
        );
    if (
      event.sequence <= registered.enrollmentSequence ||
      (ownCohort && event.sequence >= sealSequence)
    )
      fail("admission lies outside cohort enrollment/seal boundary");
    const slot = registered.evidence.slots.find(
      (item) => item.slotId === value.descriptor.slotId,
    );
    if (!slot || (ownCohort && used.has(slot.slotId)))
      fail("unknown or duplicate cohort admission slot");
    const resolution = await resolveEvolutionEvalLaunch(
      deriveSlot(state, registered, slot),
      {
        runId: value.runId,
        runNonce: value.runNonce,
        requestDigest: value.requestDigest,
      },
    );
    if (
      resolution.eventId !== event.eventId ||
      resolution.eventSequence !== event.sequence ||
      canonical(resolution.evidence) !== canonical(value)
    )
      fail("cohort admission event substitution");
    if (!ownCohort) continue;
    used.add(slot.slotId);
    result.push({
      slotId: slot.slotId,
      eventId: event.eventId,
      sequence: event.sequence,
      admissionDigest: resolution.admissionDigest,
      runId: value.runId,
      runNonce: value.runNonce,
      requestDigest: value.requestDigest,
    });
  }
  return frozen({
    admissions: result,
    unadmittedSlotIds: enrollment.evidence.slots
      .filter((slot) => !used.has(slot.slotId))
      .map((slot) => slot.slotId),
  });
}

/** Seal competes with every admission at the same Ledger CAS head. No silent retry. */
export async function sealEvolutionEvalCohort(authority, input) {
  const state = stateOf(authority);
  const cohortId = scopeId(input);
  const expectedHead = head(state);
  const context = state.rrsiHistory
    ? nativeAuditContext(state, createEvolutionEvalReadonlyAudit(state.ledger))
    : null;
  const enrollment = resolveEnrollment(state, cohortId, context);
  if (matching(state, cohortId, EVOLUTION_EVAL_COHORT_SEAL_EVENT_TYPE).length)
    fail("cohort is already sealed");
  const contents = await inventory(state, enrollment, Infinity, context);
  if (context) context.shared.assertUnchanged();
  const evidence = verifySigned(
    state,
    sign(state, {
      schema: EVOLUTION_EVAL_COHORT_SEAL_SCHEMA,
      descriptor: state.descriptor,
      cohortId,
      enrollmentDigest: enrollment.enrollmentDigest,
      inventory: contents,
      preSealHead: {
        headDigest: expectedHead.headDigest,
        sequence: expectedHead.sequence,
      },
      issuedAt: issuedAt(state),
    }),
    EVOLUTION_EVAL_COHORT_SEAL_SCHEMA,
    SEAL_FIELDS,
  );
  publish(
    state,
    cohortId,
    EVOLUTION_EVAL_COHORT_SEAL_EVENT_TYPE,
    evidence,
    [enrollment.enrollmentRef],
    expectedHead,
  );
  return resolveEvolutionEvalCohortReconciliation(authority, { cohortId });
}

/** Enumerates actual retained Ledger events; input cannot supply an admission subset. */
export async function resolveEvolutionEvalCohortReconciliation(
  authority,
  input,
) {
  const state = stateOf(authority);
  const cohortId = scopeId(input);
  const context = state.rrsiHistory
    ? nativeAuditContext(state, createEvolutionEvalReadonlyAudit(state.ledger))
    : null;
  const result = await reconcileCohort(state, cohortId, context);
  if (context) context.shared.assertUnchanged();
  return result;
}

async function reconcileCohort(state, cohortId, nativeContext = null) {
  if (nativeContext?.reconciliations?.has(cohortId))
    return nativeContext.reconciliations.get(cohortId);
  const expectedHead = nativeContext?.identity ?? head(state);
  const enrollment = resolveEnrollment(state, cohortId, nativeContext);
  const matches = matching(
    state,
    cohortId,
    EVOLUTION_EVAL_COHORT_SEAL_EVENT_TYPE,
    nativeContext?.census ?? null,
  );
  if (matches.length !== 1) fail("cohort seal is absent or ambiguous");
  const event = matches[0];
  const evidence = verifySigned(
    state,
    readArtifact(state, event, false, nativeContext?.identity ?? null),
    EVOLUTION_EVAL_COHORT_SEAL_SCHEMA,
    SEAL_FIELDS,
  );
  checkEvent(
    state,
    event,
    cohortId,
    EVOLUTION_EVAL_COHORT_SEAL_EVENT_TYPE,
    evidence,
    [enrollment.enrollmentRef],
  );
  const previous = (nativeContext?.census ?? allEvents(state)).find(
    (item) => item.sequence === event.sequence - 1,
  );
  if (
    evidence.cohortId !== cohortId ||
    evidence.enrollmentDigest !== enrollment.enrollmentDigest ||
    event.sequence <= enrollment.enrollmentSequence ||
    canonical(evidence.preSealHead) !==
      canonical({
        headDigest: previous?.eventDigest ?? null,
        sequence: event.sequence - 1,
      })
  )
    fail("cohort seal boundary differs");
  const contents = await inventory(
    state,
    enrollment,
    event.sequence,
    nativeContext,
  );
  if (canonical(contents) !== canonical(evidence.inventory))
    fail("sealed cohort inventory differs from complete Ledger events");
  const currentHead = nativeContext?.identity ?? head(state);
  if (
    currentHead.headDigest !== expectedHead.headDigest ||
    currentHead.sequence !== expectedHead.sequence
  )
    fail("Ledger changed during cohort reconciliation; retry audit");
  const result = frozen({
    schema: state.rrsiHistory
      ? "chainlesschain.evolution-eval-cohort-reconciliation/v2"
      : "chainlesschain.evolution-eval-cohort-reconciliation/v1",
    cohortId,
    enrollmentDigest: enrollment.enrollmentDigest,
    sealDigest: hash(evidence.schema, evidence),
    sealSequence: event.sequence,
    inventory: contents,
    ...(state.rrsiHistory
      ? {
          plannedObservationsPerArmByPartition:
            enrollment.evidence.manifest.plannedObservationsPerArmByPartition,
          nativeExecutionDenominatorVerified: false,
        }
      : {
          plannedTestObservationsPerArm:
            enrollment.evidence.manifest.plannedTestObservationsPerArm,
        }),
    admissionInventoryAuthenticated: true,
    executionCoverageAuthenticated: false,
    authenticated: true,
    durable: true,
    ...LIMITS,
  });
  if (nativeContext?.reconciliations)
    nativeContext.reconciliations.set(cohortId, result);
  return result;
}
