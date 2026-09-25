/** Signed admission of one registered attempt; never evidence of Actor execution. */
import { createHash, createPublicKey, KeyObject, verify } from "node:crypto";
import { isProxy } from "node:util/types";
import { captureEvolutionEvalCohortSlotBinding } from "./evolution-eval-cohort-enrollment.js";
import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  EvolutionArtifactPorts,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
  EvolutionLedger,
} from "./evolution-ledger.js";

export const EVOLUTION_EVAL_LAUNCH_ADMISSION_SCHEMA =
  "chainlesschain.evolution-eval-launch-admission/v1";
export const EVOLUTION_EVAL_ENROLLED_LAUNCH_ADMISSION_SCHEMA =
  "chainlesschain.evolution-eval-launch-admission/v2";
export const EVOLUTION_EVAL_LAUNCH_ADMISSION_PURPOSE =
  "chainlesschain.evolution-eval.attempt-admission/v1";
export const EVOLUTION_EVAL_LAUNCH_ADMISSION_EVENT_TYPE =
  "evolution.eval-attempt.admitted";
export const EVOLUTION_EVAL_LAUNCH_ADMISSION_FAILED_CODE =
  "CC_EVOLUTION_EVAL_LAUNCH_ADMISSION_FAILED";

const AUTHORITIES = new WeakMap();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ARTIFACT_TYPE = "evolution-eval-child-evidence";
const INPUT_KEYS = [
  "runId",
  "runNonce",
  "requestDigest",
  "policyDigest",
  "evaluationAuthorityRoot",
  "tenantId",
  "admittedAt",
  "deadlineAt",
];
const DESCRIPTOR_KEYS = [
  "tenantId",
  "artifactTenantId",
  "streamId",
  "audience",
  "purpose",
  "planDigest",
  "manifestDigest",
  "cohortId",
  "slotId",
  "authorityId",
  "keyId",
  "trustPolicyDigest",
];

function fail(message) {
  const error = new Error(message);
  error.code = EVOLUTION_EVAL_LAUNCH_ADMISSION_FAILED_CODE;
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
    for (const item of Object.values(value)) frozen(item);
    Object.freeze(value);
  }
  return value;
}

function record(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).length !== keys.length ||
    keys.some(
      (key) =>
        !Object.hasOwn(value, key) ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
    )
  ) {
    fail(`${label} must contain exactly its own data fields`);
  }
  return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

function text(value, label) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 256 ||
    value.trim() !== value ||
    [...value].some((character) => character.codePointAt(0) < 32)
  )
    fail(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} must be a sha256 digest`);
  return value;
}

function timestamp(value, label) {
  const parsed = Date.parse(value);
  if (
    typeof value !== "string" ||
    !Number.isFinite(parsed) ||
    new Date(parsed).toISOString() !== value
  )
    fail(`${label} is invalid`);
  return parsed;
}

function descriptor(input) {
  const output = record(input, DESCRIPTOR_KEYS, "admission descriptor");
  for (const key of DESCRIPTOR_KEYS) text(output[key], key);
  for (const key of ["planDigest", "manifestDigest", "trustPolicyDigest"])
    digest(output[key], key);
  if (output.purpose !== "evolution-ledger")
    fail("admission requires ledger retention purpose");
  return frozen(output);
}

function request(input, state, live = false) {
  const output = record(input, INPUT_KEYS, "admission request");
  for (const key of ["runId", "runNonce", "tenantId"]) text(output[key], key);
  for (const key of [
    "requestDigest",
    "policyDigest",
    "evaluationAuthorityRoot",
  ])
    digest(output[key], key);
  const start = timestamp(output.admittedAt, "admittedAt");
  const end = timestamp(output.deadlineAt, "deadlineAt");
  if (output.tenantId !== state.descriptor.tenantId || start >= end)
    fail("admission tenant or interval differs from its authority");
  if (live) {
    const now = state.now();
    if (!Number.isFinite(now) || now < start || now >= end)
      fail("admission is outside its execution validity window");
  }
  return frozen(output);
}

function message(core) {
  return Buffer.from(
    `${EVOLUTION_EVAL_LAUNCH_ADMISSION_PURPOSE}\0${canonical(core)}`,
    "utf8",
  );
}

function verifyEvidence(value, state) {
  const evidence = record(
    value,
    [
      "schema",
      "descriptorDigest",
      ...INPUT_KEYS,
      ...(state.enrollment ? ["enrollmentDigest", "descriptor"] : []),
      "attestation",
    ],
    "admission evidence",
  );
  const input = request(
    Object.fromEntries(INPUT_KEYS.map((key) => [key, evidence[key]])),
    state,
  );
  if (
    evidence.schema !==
      (state.enrollment
        ? EVOLUTION_EVAL_ENROLLED_LAUNCH_ADMISSION_SCHEMA
        : EVOLUTION_EVAL_LAUNCH_ADMISSION_SCHEMA) ||
    evidence.descriptorDigest !== state.descriptorDigest
  )
    fail("admission scope is substituted");
  const signature = record(
    evidence.attestation,
    ["algorithm", "issuer", "keyId", "trustPolicyDigest", "value"],
    "admission attestation",
  );
  if (
    signature.algorithm !== "ed25519" ||
    signature.issuer !== state.descriptor.authorityId ||
    signature.keyId !== state.descriptor.keyId ||
    signature.trustPolicyDigest !== state.descriptor.trustPolicyDigest ||
    typeof signature.value !== "string" ||
    !/^[A-Za-z0-9_-]{86}$/u.test(signature.value)
  )
    fail("admission signature trust differs from the fixed anchor");
  const core = {
    schema: evidence.schema,
    descriptorDigest: evidence.descriptorDigest,
    ...input,
  };
  if (state.enrollment) {
    if (
      evidence.enrollmentDigest !== state.enrollment.enrollmentDigest ||
      canonical(evidence.descriptor) !== canonical(state.descriptor)
    )
      fail("admission enrollment scope is substituted");
    for (const key of [
      "requestDigest",
      "policyDigest",
      "evaluationAuthorityRoot",
    ])
      if (input[key] !== state.enrollment.expectedRequest[key])
        fail("admission request differs from the enrolled slot");
    core.enrollmentDigest = evidence.enrollmentDigest;
    core.descriptor = state.descriptor;
  }
  const bytes = Buffer.from(signature.value, "base64url");
  if (
    bytes.length !== 64 ||
    bytes.toString("base64url") !== signature.value ||
    !verify(null, message(core), state.publicKey, bytes)
  )
    fail("admission Ed25519 signature rejected");
  return frozen({ ...core, attestation: signature });
}

function eventId(state) {
  // Authority/key rotation cannot free a previously occupied cohort slot.
  return `${EVOLUTION_EVAL_LAUNCH_ADMISSION_EVENT_TYPE}.${hash(
    "eval-admission-slot/v1",
    {
      tenantId: state.descriptor.tenantId,
      streamId: state.descriptor.streamId,
      cohortId: state.descriptor.cohortId,
      slotId: state.descriptor.slotId,
    },
  ).slice(7)}`;
}

function events(state) {
  return EvolutionLedger.prototype.read
    .call(state.ledger)
    .filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.eventId === eventId(state),
    );
}

function resolveEvent(state, event) {
  if (
    event.type !== EVOLUTION_EVAL_LAUNCH_ADMISSION_EVENT_TYPE ||
    event.tenantId !== state.descriptor.tenantId ||
    event.artifactTenantId !== state.descriptor.artifactTenantId ||
    event.correlationId !== state.descriptor.streamId ||
    event.decision !== "accepted" ||
    event.skillName !== "evolution-eval" ||
    !Array.isArray(event.sourceRefs) ||
    canonical(event.sourceRefs) !==
      canonical(state.enrollment ? [state.enrollment.enrollmentRef] : [])
  )
    fail("admission ledger event is substituted");
  const identity = EvolutionLedger.prototype.verify.call(state.ledger);
  const resolution = state.resolveArtifact({
    epoch: identity.epoch,
    ledgerId: identity.ledgerId,
    ref: event.subjectRef,
    tenantId: state.descriptor.artifactTenantId,
  });
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    resolution.ref !== event.subjectRef.ref ||
    resolution.digest !== event.subjectRef.digest ||
    !Buffer.isBuffer(resolution.bytes)
  )
    fail("admission artifact resolution rejected");
  let stored;
  try {
    stored = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    fail("admission artifact is not JSON");
  }
  if (
    stored.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    stored.tenantId !== state.descriptor.artifactTenantId ||
    stored.audience !== state.descriptor.audience ||
    stored.purpose !== state.descriptor.purpose ||
    stored.retention !== "ledger" ||
    stored.type !== ARTIFACT_TYPE
  )
    fail("admission durable artifact scope differs");
  const evidence = verifyEvidence(stored.value, state);
  if (event.timestamp !== evidence.admittedAt)
    fail("admission event timestamp differs");
  return frozen({
    schema: "chainlesschain.evolution-eval-launch-admission-resolution/v1",
    eventId: event.eventId,
    eventSequence: event.sequence,
    admissionDigest: hash(evidence.schema, evidence),
    evidence,
    authenticated: true,
    durable: true,
    cohortCompletenessAuthenticated: false,
    promotionAuthority: false,
  });
}

/** Trusted composition only. This does not certify the supplied manifest's creation time. */
export function createEvolutionEvalLaunchAdmissionAuthority({
  descriptor: input,
  publicKey,
  signer,
  artifactPorts,
  ledger,
  ledgerArtifactResolver,
  now = Date.now,
  cohortSlotBinding,
} = {}) {
  const scope = descriptor(input);
  if (
    !(artifactPorts instanceof EvolutionArtifactPorts) ||
    isProxy(artifactPorts) ||
    !(ledger instanceof EvolutionLedger) ||
    isProxy(ledger) ||
    !isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)
  )
    fail(
      "admission requires real artifact ports, Ledger and a branded resolver",
    );
  if (typeof now !== "function" || isProxy(now) || !signer || isProxy(signer))
    fail("admission signer and clock are required");
  const sign = Object.getOwnPropertyDescriptor(signer, "sign")?.value;
  if (typeof sign !== "function" || isProxy(sign))
    fail("admission signer must be an own callable");
  const key =
    publicKey instanceof KeyObject && publicKey.type === "public"
      ? publicKey
      : createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519")
    fail("admission trust anchor must be Ed25519");
  const state = {
    descriptor: scope,
    descriptorDigest: hash("eval-admission-descriptor/v1", scope),
    publicKey: key,
    sign: sign.bind(signer),
    artifactPorts,
    ledger,
    resolveArtifact: ledgerArtifactResolver,
    now,
    enrollment:
      cohortSlotBinding === undefined
        ? null
        : captureEvolutionEvalCohortSlotBinding(cohortSlotBinding, {
            descriptor: scope,
            ledger,
            artifactPorts,
            ledgerArtifactResolver,
            publicKey: key,
          }),
  };
  const authority = Object.freeze({ descriptor: scope });
  AUTHORITIES.set(authority, state);
  return authority;
}

export function isEvolutionEvalLaunchAdmissionAuthority(value) {
  return AUTHORITIES.has(value);
}

/** Captured identity for strict production composition; copies cannot forge enrollment. */
export function captureEvolutionEvalLaunchAdmissionBinding(authority) {
  const state = authorityState(authority);
  return frozen({
    mode: state.enrollment ? "enrolled-cohort" : "legacy-single-slot",
    descriptor: state.descriptor,
    expectedRequest: state.enrollment?.expectedRequest ?? null,
    enrollmentDigest: state.enrollment?.enrollmentDigest ?? null,
    cohortCompletenessAuthenticated: false,
    promotionAuthority: false,
  });
}

function authorityState(authority) {
  const state = AUTHORITIES.get(authority);
  if (!state) fail("a trusted launch admission authority is required");
  return state;
}

/** One admission per slot, including identical requests. Recovery only reads; it never launches again. */
export async function admitEvolutionEvalLaunch(authority, input) {
  const state = authorityState(authority);
  const captured = request(input, state, true);
  // Capture head BEFORE the occupancy read: a concurrent append cannot escape CAS.
  const head = EvolutionLedger.prototype.verify.call(state.ledger);
  if (state.enrollment) state.enrollment.assertOpen(captured);
  if (events(state).length !== 0) fail("admission slot is already occupied");
  const core = {
    schema: state.enrollment
      ? EVOLUTION_EVAL_ENROLLED_LAUNCH_ADMISSION_SCHEMA
      : EVOLUTION_EVAL_LAUNCH_ADMISSION_SCHEMA,
    descriptorDigest: state.descriptorDigest,
    ...captured,
    ...(state.enrollment
      ? {
          enrollmentDigest: state.enrollment.enrollmentDigest,
          descriptor: state.descriptor,
        }
      : {}),
  };
  const signature = state.sign(
    Object.freeze({ message: message(core).toString("utf8") }),
  );
  const evidence = verifyEvidence(
    {
      ...core,
      attestation: {
        algorithm: "ed25519",
        issuer: state.descriptor.authorityId,
        keyId: state.descriptor.keyId,
        trustPolicyDigest: state.descriptor.trustPolicyDigest,
        value: signature,
      },
    },
    state,
  );
  request(captured, state, true);
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
    fail("admission artifact persistence failed");
  request(captured, state, true);
  if (state.enrollment) state.enrollment.assertOpen(captured);
  const receipt = EvolutionLedger.prototype.appendDomainEvent.call(
    state.ledger,
    {
      type: EVOLUTION_EVAL_LAUNCH_ADMISSION_EVENT_TYPE,
      eventId: eventId(state),
      tenantId: state.descriptor.tenantId,
      artifactTenantId: state.descriptor.artifactTenantId,
      correlationId: state.descriptor.streamId,
      decision: "accepted",
      skillName: "evolution-eval",
      reason: "signed attempt admission; Actor execution is unproven",
      sourceRefs: state.enrollment ? [state.enrollment.enrollmentRef] : [],
      subjectRef: published.ref,
      timestamp: captured.admittedAt,
    },
    { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
  );
  if (receipt?.authenticated !== true || receipt.durable !== true)
    fail("admission ledger append failed");
  const matches = events(state);
  if (matches.length !== 1) fail("admission slot is absent or ambiguous");
  const result = resolveEvent(state, matches[0]);
  if (canonical(result.evidence) !== canonical(evidence))
    fail("admission readback differs from signed bytes");
  request(captured, state, true);
  return result;
}

/** Durable audit/recovery may outlive the execution deadline; it grants no execution permit. */
export async function resolveEvolutionEvalLaunch(authority, input) {
  const state = authorityState(authority);
  const expected = record(
    input,
    ["runId", "runNonce", "requestDigest"],
    "admission lookup",
  );
  text(expected.runId, "runId");
  text(expected.runNonce, "runNonce");
  digest(expected.requestDigest, "requestDigest");
  const matches = events(state);
  if (matches.length !== 1) fail("admission slot is absent or ambiguous");
  const result = resolveEvent(state, matches[0]);
  if (
    Object.keys(expected).some((key) => result.evidence[key] !== expected[key])
  )
    fail("admission lookup differs from the recorded attempt");
  return result;
}
