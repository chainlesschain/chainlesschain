import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import {
  runtimeCanonical,
  verifySkillRuntimeState,
} from "./skill-runtime-revalidation.js";

export const SKILL_RUNTIME_STATE_EVENT =
  "skill.runtime-revalidation.state-committed";
const ARTIFACT_TYPE = "skill-runtime-revalidation-state";

function fail(message) {
  const error = new Error(message);
  error.code = "CC_SKILL_RUNTIME_STATE_UNAVAILABLE";
  throw error;
}

function capture(owner, key) {
  const method = owner?.[key];
  if (typeof method !== "function")
    throw new TypeError(`${key} port is required`);
  return (...args) => Reflect.apply(method, owner, args);
}

// ArtifactStore retains canonical subjects; the signed, witnessed Ledger is
// authoritative for order, durability and CAS. No mutable local eligibility
// file is trusted, and promotion prepared/committed states are untouched.
export class SkillRuntimeRevalidationLedgerAdapter {
  #descriptor;
  #put;
  #read;
  #verify;
  #append;
  #resolve;
  #now;

  constructor({
    descriptor,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    now = Date.now,
  }) {
    this.#descriptor = Object.freeze(
      Object.fromEntries(
        ["tenantId", "artifactTenantId", "streamId", "audience", "purpose"].map(
          (key) => {
            if (typeof descriptor?.[key] !== "string" || !descriptor[key])
              throw new TypeError(`${key} is required`);
            return [key, descriptor[key]];
          },
        ),
      ),
    );
    if (
      this.#descriptor.purpose !== "evolution-ledger" ||
      !isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)
    )
      throw new TypeError("branded ledger artifact resolver is required");
    this.#put = capture(artifactPorts, "putCanonical");
    this.#read = capture(ledger, "read");
    this.#verify = capture(ledger, "verify");
    this.#append = capture(ledger, "appendDomainEvent");
    this.#resolve = ledgerArtifactResolver;
    this.#now = now;
    Object.freeze(this);
  }

  #history(skillName) {
    const descriptor = this.#descriptor;
    const head = this.#verify();
    const events = this.#read();
    if (!Array.isArray(events)) fail("runtime ledger history is unavailable");
    const history = [];
    for (const event of events) {
      if (
        event.schema !== EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA ||
        event.type !== SKILL_RUNTIME_STATE_EVENT ||
        event.tenantId !== descriptor.tenantId ||
        event.correlationId !== descriptor.streamId ||
        event.skillName !== skillName
      )
        continue;
      const prior = history.at(-1);
      if (
        event.artifactTenantId !== descriptor.artifactTenantId ||
        event.decision !== "committed" ||
        runtimeCanonical(event.sourceRefs) !==
          runtimeCanonical(prior ? [prior.event.subjectRef] : [])
      )
        fail("runtime ledger lineage differs");
      const resolution = this.#resolve({
        epoch: head.epoch,
        ledgerId: head.ledgerId,
        tenantId: descriptor.artifactTenantId,
        ref: event.subjectRef,
      });
      if (
        resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
        resolution.authenticated !== true ||
        resolution.found !== true ||
        !Buffer.isBuffer(resolution.bytes) ||
        resolution.ref !== event.subjectRef.ref ||
        resolution.digest !== event.subjectRef.digest
      )
        fail("runtime artifact resolution is unavailable");
      const record = JSON.parse(resolution.bytes.toString("utf8"));
      if (
        record.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
        record.tenantId !== descriptor.artifactTenantId ||
        record.type !== ARTIFACT_TYPE ||
        record.retention !== "ledger" ||
        record.audience !== descriptor.audience ||
        record.purpose !== descriptor.purpose
      )
        fail("runtime artifact binding differs");
      const state = verifySkillRuntimeState(
        record.value,
        descriptor.tenantId,
        skillName,
      );
      if (
        state.revision !== history.length + 1 ||
        state.previousStateDigest !== (prior?.state.stateDigest ?? null) ||
        event.eventId !==
          `${SKILL_RUNTIME_STATE_EVENT}.${state.stateDigest.slice(7)}`
      )
        fail("runtime state sequence differs");
      if (
        state.status === "eligible" &&
        prior?.state.status !== "stale-needs-revalidation"
      )
        fail("eligibility must follow a stale state");
      if (
        state.evaluationReceipt &&
        history.some(
          (entry) =>
            entry.state.evaluationReceipt?.evaluationId ===
            state.evaluationReceipt.evaluationId,
        )
      )
        fail("evaluation identity was replayed");
      history.push({ state, event });
    }
    const after = this.#verify();
    if (
      after.headDigest !== head.headDigest ||
      after.sequence !== head.sequence
    )
      fail("runtime ledger changed during observation");
    return { history, head };
  }

  load({ tenantId, skillName }) {
    if (tenantId !== this.#descriptor.tenantId) fail("runtime tenant differs");
    const state = this.#history(skillName).history.at(-1)?.state ?? null;
    return Object.freeze({
      authenticated: true,
      durable: true,
      found: state !== null,
      state,
    });
  }

  commit({ state: input, expectedStateDigest }) {
    const descriptor = this.#descriptor;
    const state = verifySkillRuntimeState(
      input,
      descriptor.tenantId,
      input.skillName,
    );
    const { history, head } = this.#history(state.skillName);
    const prior = history.at(-1);
    if (
      (prior?.state.stateDigest ?? null) !== expectedStateDigest ||
      state.previousStateDigest !== expectedStateDigest ||
      state.revision !== history.length + 1
    )
      fail("runtime state CAS conflict");
    if (
      state.status === "eligible" &&
      prior?.state.status !== "stale-needs-revalidation"
    )
      fail("eligibility requires a fresh evaluation of stale state");
    if (
      state.evaluationReceipt &&
      history.some(
        (entry) =>
          entry.state.evaluationReceipt?.evaluationId ===
          state.evaluationReceipt.evaluationId,
      )
    )
      fail("evaluation identity was replayed");
    const published = this.#put(ARTIFACT_TYPE, state, {
      audience: descriptor.audience,
      purpose: descriptor.purpose,
      retention: "ledger",
    });
    if (
      published?.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger"
    )
      fail("runtime artifact persistence was not confirmed");
    const eventId = `${SKILL_RUNTIME_STATE_EVENT}.${state.stateDigest.slice(7)}`;
    const receipt = this.#append(
      {
        artifactTenantId: descriptor.artifactTenantId,
        correlationId: descriptor.streamId,
        tenantId: descriptor.tenantId,
        decision: "committed",
        eventId,
        reason: `runtime eligibility ${state.status}`,
        skillName: state.skillName,
        sourceRefs: prior ? [prior.event.subjectRef] : [],
        subjectRef: published.ref,
        timestamp: new Date(this.#now()).toISOString(),
        type: SKILL_RUNTIME_STATE_EVENT,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (
      receipt?.authenticated !== true ||
      receipt.committed !== true ||
      receipt.durable !== true ||
      receipt.eventId !== eventId ||
      this.load({ tenantId: descriptor.tenantId, skillName: state.skillName })
        .state?.stateDigest !== state.stateDigest
    )
      fail("runtime ledger commit was not confirmed");
    return Object.freeze({
      authenticated: true,
      durable: true,
      committed: true,
      stateDigest: state.stateDigest,
    });
  }

  persistencePorts() {
    return Object.freeze({
      load: this.load.bind(this),
      commit: this.commit.bind(this),
    });
  }
}

Object.freeze(SkillRuntimeRevalidationLedgerAdapter.prototype);
