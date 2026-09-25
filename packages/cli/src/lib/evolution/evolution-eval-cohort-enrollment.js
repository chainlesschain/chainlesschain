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
  EvolutionLedger,
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import {
  verifyPmExplorationEffectPlan,
  verifyPmExplorationEffectSlotManifest,
} from "./pm-exploration-benchmark.js";
import {
  createEvolutionEvalLaunchAdmissionAuthority,
  resolveEvolutionEvalLaunch,
  EVOLUTION_EVAL_LAUNCH_ADMISSION_EVENT_TYPE,
} from "./evolution-eval-launch-admission.js";

export const EVOLUTION_EVAL_COHORT_ENROLLMENT_SCHEMA =
  "chainlesschain.evolution-eval-cohort-enrollment/v1";
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
  return EvolutionLedger.prototype.read.call(state.ledger);
}
function head(state) {
  return EvolutionLedger.prototype.verify.call(state.ledger);
}
function eventId(state, cohortId, type) {
  return `${type}.${hash("eval-cohort-identity/v1", { tenantId: state.descriptor.tenantId, streamId: state.descriptor.streamId, cohortId }).slice(7)}`;
}
function matching(state, cohortId, type) {
  return allEvents(state).filter(
    (event) =>
      event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
      event.eventId === eventId(state, cohortId, type),
  );
}
function admissions(state) {
  return allEvents(state).filter(
    (event) =>
      event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
      event.type === EVOLUTION_EVAL_LAUNCH_ADMISSION_EVENT_TYPE &&
      event.tenantId === state.descriptor.tenantId &&
      event.correlationId === state.descriptor.streamId,
  );
}
function readArtifact(state, event) {
  const identity = head(state);
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
  return stored.value;
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
function validateRegistration(input) {
  const source = record(
    snapshot(input),
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
  if (
    event.eventId !== eventId(state, cohortId, type) ||
    event.type !== type ||
    event.tenantId !== state.descriptor.tenantId ||
    event.artifactTenantId !== state.descriptor.artifactTenantId ||
    event.correlationId !== state.descriptor.streamId ||
    event.decision !== "accepted" ||
    event.skillName !== "evolution-eval" ||
    event.timestamp !== evidence.issuedAt ||
    canonical(event.sourceRefs) !== canonical(sourceRefs)
  )
    fail("cohort Ledger event differs from signed evidence");
}
function resolveEnrollment(state, cohortId) {
  const found = matching(
    state,
    cohortId,
    EVOLUTION_EVAL_COHORT_ENROLLMENT_EVENT_TYPE,
  );
  if (found.length !== 1) fail("cohort enrollment is absent or ambiguous");
  const event = found[0];
  const evidence = verifySigned(
    state,
    readArtifact(state, event),
    EVOLUTION_EVAL_COHORT_ENROLLMENT_SCHEMA,
    ENROLL_FIELDS,
  );
  const registration = validateRegistration({
    plan: evidence.plan,
    manifest: evidence.manifest,
    slots: evidence.slots,
  });
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
    [],
  );
  return frozen({
    schema: "chainlesschain.evolution-eval-cohort-enrollment-resolution/v1",
    enrollmentDigest: hash(evidence.schema, evidence),
    evidence,
    enrollmentRef: event.subjectRef,
    enrollmentSequence: event.sequence,
    authenticated: true,
    durable: true,
    ...LIMITS,
  });
}
function publish(state, cohortId, type, evidence, sourceRefs, expectedHead) {
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
  const receipt = EvolutionLedger.prototype.appendDomainEvent.call(
    state.ledger,
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

export function createEvolutionEvalCohortEnrollmentAuthority({
  descriptor,
  publicKey,
  signer,
  artifactPorts,
  ledger,
  ledgerArtifactResolver,
  now = Date.now,
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
    !(ledger instanceof EvolutionLedger) ||
    isProxy(ledger) ||
    !isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)
  )
    fail("cohort requires real artifact ports, Ledger and branded resolver");
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
    resolveArtifact: ledgerArtifactResolver,
    now,
  });
  return authority;
}

export function enrollEvolutionEvalCohort(authority, input) {
  const state = stateOf(authority);
  const registration = validateRegistration(input);
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
  const evidence = verifySigned(
    state,
    sign(state, {
      schema: EVOLUTION_EVAL_COHORT_ENROLLMENT_SCHEMA,
      descriptor: state.descriptor,
      cohortId,
      ...registration,
      issuedAt: issuedAt(state),
    }),
    EVOLUTION_EVAL_COHORT_ENROLLMENT_SCHEMA,
    ENROLL_FIELDS,
  );
  publish(
    state,
    cohortId,
    EVOLUTION_EVAL_COHORT_ENROLLMENT_EVENT_TYPE,
    evidence,
    [],
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

function slotDescriptor(state, enrollment, slot) {
  return frozen({
    ...state.descriptor,
    planDigest: slot.evaluationPlanDigest,
    manifestDigest: enrollment.evidence.manifest.manifestDigest,
    cohortId: enrollment.evidence.cohortId,
    slotId: slot.slotId,
  });
}
function deriveSlot(state, enrollment, slot) {
  const descriptor = slotDescriptor(state, enrollment, slot);
  const expectedRequest = frozen({
    requestDigest: slot.requestDigest,
    policyDigest: slot.policyDigest,
    evaluationAuthorityRoot: slot.evaluationAuthorityRoot,
  });
  const binding = Object.freeze({});
  SLOT_BINDINGS.set(binding, {
    state,
    descriptor,
    enrollmentDigest: enrollment.enrollmentDigest,
    enrollmentRef: enrollment.enrollmentRef,
    expectedRequest,
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
  });
}

export function createEvolutionEvalCohortSlotAdmissionAuthority(
  authority,
  input,
) {
  const state = stateOf(authority);
  const lookup = record(input, ["cohortId", "slotId"], "cohort slot lookup");
  text(lookup.cohortId, "cohortId");
  text(lookup.slotId, "slotId");
  const enrollment = resolveEnrollment(state, lookup.cohortId);
  const slot = enrollment.evidence.slots.find(
    (item) => item.slotId === lookup.slotId,
  );
  if (!slot) fail("slot is not in the enrolled manifest");
  return deriveSlot(state, enrollment, slot);
}

async function inventory(state, enrollment, sealSequence = Infinity) {
  const result = [];
  const used = new Set();
  for (const event of admissions(state)) {
    const value = readArtifact(state, event);
    // Reject ambiguous legacy entries instead of accepting a caller-selected subset.
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
  const enrollment = resolveEnrollment(state, cohortId);
  if (matching(state, cohortId, EVOLUTION_EVAL_COHORT_SEAL_EVENT_TYPE).length)
    fail("cohort is already sealed");
  const contents = await inventory(state, enrollment);
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
  const expectedHead = head(state);
  const enrollment = resolveEnrollment(state, cohortId);
  const matches = matching(
    state,
    cohortId,
    EVOLUTION_EVAL_COHORT_SEAL_EVENT_TYPE,
  );
  if (matches.length !== 1) fail("cohort seal is absent or ambiguous");
  const event = matches[0];
  const evidence = verifySigned(
    state,
    readArtifact(state, event),
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
  const previous = allEvents(state).find(
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
  const contents = await inventory(state, enrollment, event.sequence);
  if (canonical(contents) !== canonical(evidence.inventory))
    fail("sealed cohort inventory differs from complete Ledger events");
  const currentHead = head(state);
  if (
    currentHead.headDigest !== expectedHead.headDigest ||
    currentHead.sequence !== expectedHead.sequence
  )
    fail("Ledger changed during cohort reconciliation; retry audit");
  return frozen({
    schema: "chainlesschain.evolution-eval-cohort-reconciliation/v1",
    cohortId,
    enrollmentDigest: enrollment.enrollmentDigest,
    sealDigest: hash(evidence.schema, evidence),
    sealSequence: event.sequence,
    inventory: contents,
    plannedTestObservationsPerArm:
      enrollment.evidence.manifest.plannedTestObservationsPerArm,
    admissionInventoryAuthenticated: true,
    executionCoverageAuthenticated: false,
    authenticated: true,
    durable: true,
    ...LIMITS,
  });
}
