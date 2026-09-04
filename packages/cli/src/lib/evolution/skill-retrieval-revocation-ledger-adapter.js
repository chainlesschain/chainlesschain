import { createHash } from "node:crypto";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import { verifySkillRetrievalRevocationState } from "./skill-retrieval-revocation-authority.js";

export const SKILL_RETRIEVAL_REVOCATION_LEDGER_EVENT_TYPE =
  "skill.retrieval-revocation.state-committed";
export const SKILL_RETRIEVAL_REVOCATION_LEDGER_RESOLUTION_SCHEMA =
  "chainlesschain.skill-retrieval-revocation-ledger-resolution/v1";
export const SKILL_RETRIEVAL_REVOCATION_LEDGER_CORRUPT_CODE =
  "CC_SKILL_RETRIEVAL_REVOCATION_LEDGER_CORRUPT";
export const SKILL_RETRIEVAL_REVOCATION_LEDGER_CONFLICT_CODE =
  "CC_SKILL_RETRIEVAL_REVOCATION_LEDGER_CONFLICT";

const ARTIFACT_TYPE = "skill-retrieval-revocation-state";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;

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
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function string(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function digest(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function capture(owner, method, label = method) {
  if (typeof owner?.[method] !== "function") {
    throw new TypeError(`${label} port is required`);
  }
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function fail(code, message, options) {
  const error = new Error(message, options);
  error.code = code;
  throw error;
}

function corrupt(message, options) {
  fail(SKILL_RETRIEVAL_REVOCATION_LEDGER_CORRUPT_CODE, message, options);
}

function conflict(message) {
  fail(SKILL_RETRIEVAL_REVOCATION_LEDGER_CONFLICT_CODE, message);
}

function normalizeDescriptor(input) {
  return Object.freeze({
    tenantId: string(input?.tenantId, "tenantId"),
    artifactTenantId: string(input?.artifactTenantId, "artifactTenantId"),
    streamId: string(input?.streamId, "streamId"),
    audience: string(input?.audience, "audience"),
    purpose: string(input?.purpose, "purpose"),
  });
}

function normalizeState(input, tenantId) {
  return verifySkillRetrievalRevocationState(input, tenantId);
}

function assertStateExtends(previous, next) {
  if (!previous) return;
  const priorEntries = Object.entries(previous.invalidations);
  if (Object.keys(next.invalidations).length < priorEntries.length) {
    corrupt("retrieval revocation history removed an invalidation");
  }
  for (const [contentDigest, invalidation] of priorEntries) {
    if (
      canonical(next.invalidations[contentDigest]) !== canonical(invalidation)
    ) {
      corrupt("retrieval revocation history replaced an invalidation");
    }
  }
}

function parseState(resolution, descriptor) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest ?? "") ||
    !DIGEST.test(resolution.receiptDigest ?? "") ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    corrupt("retrieval revocation artifact resolution is incomplete");
  }
  let record;
  try {
    record = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    corrupt("retrieval revocation artifact is not JSON");
  }
  if (
    record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    record.tenantId !== descriptor.artifactTenantId ||
    record.audience !== descriptor.audience ||
    record.purpose !== descriptor.purpose ||
    record.retention !== "ledger" ||
    record.type !== ARTIFACT_TYPE
  ) {
    corrupt("retrieval revocation durable artifact binding is invalid");
  }
  try {
    return normalizeState(record.value, descriptor.tenantId);
  } catch (cause) {
    corrupt("retrieval revocation state artifact is invalid", { cause });
  }
}

export class SkillRetrievalRevocationLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    now = Date.now,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical");
    this._read = capture(ledger, "read");
    this._verifyLedger = capture(ledger, "verify");
    this._append = capture(ledger, "appendDomainEvent");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (typeof now !== "function")
      throw new TypeError("now must be a function");
    this._resolveArtifact = ledgerArtifactResolver;
    this._now = now;
    Object.freeze(this);
  }

  _events() {
    const events = this._read();
    if (!Array.isArray(events)) {
      corrupt("EvolutionLedger did not return an event array");
    }
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === SKILL_RETRIEVAL_REVOCATION_LEDGER_EVENT_TYPE &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
  }

  _resolveEvent(event, previous = null) {
    if (
      event.artifactTenantId !== this.descriptor.artifactTenantId ||
      event.decision !== "committed" ||
      event.skillName !== null ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== (previous ? 1 : 0) ||
      (previous &&
        canonical(event.sourceRefs[0]) !== canonical(previous.subjectRef))
    ) {
      corrupt("retrieval revocation ledger lineage is invalid");
    }
    const identity = this._verifyLedger();
    const resolution = this._resolveArtifact({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution.ref !== event.subjectRef.ref ||
      resolution.digest !== event.subjectRef.digest
    ) {
      corrupt("retrieval revocation ledger subject was substituted");
    }
    const state = parseState(resolution, this.descriptor);
    if (
      event.eventId !==
      `${SKILL_RETRIEVAL_REVOCATION_LEDGER_EVENT_TYPE}.${state.stateDigest.slice(7)}`
    ) {
      corrupt("retrieval revocation event identity is invalid");
    }
    return state;
  }

  _history() {
    const events = this._events();
    const history = [];
    for (const [index, event] of events.entries()) {
      const previous = events[index - 1] ?? null;
      const state = this._resolveEvent(event, previous);
      if (
        state.revision !== index + 1 ||
        (index > 0 && state.revision !== history[index - 1].state.revision + 1)
      ) {
        corrupt("retrieval revocation state sequence is invalid");
      }
      assertStateExtends(history[index - 1]?.state ?? null, state);
      history.push(Object.freeze({ event, state }));
    }
    return history;
  }

  _resolution(state) {
    const core = {
      schema: SKILL_RETRIEVAL_REVOCATION_LEDGER_RESOLUTION_SCHEMA,
      tenantId: this.descriptor.tenantId,
      streamId: this.descriptor.streamId,
      found: state !== null,
      stateDigest: state?.stateDigest ?? null,
    };
    return Object.freeze({
      authenticated: true,
      durable: true,
      found: state !== null,
      state,
      receiptDigest: hash(
        SKILL_RETRIEVAL_REVOCATION_LEDGER_RESOLUTION_SCHEMA,
        core,
      ),
    });
  }

  load = ({ tenantId } = {}) => {
    if (tenantId !== this.descriptor.tenantId) {
      throw new TypeError("retrieval revocation load tenant is invalid");
    }
    return this._resolution(this._history().at(-1)?.state ?? null);
  };

  commit = ({ state: input, expectedStateDigest } = {}) => {
    const state = normalizeState(input, this.descriptor.tenantId);
    const expected = digest(expectedStateDigest, "expectedStateDigest", {
      nullable: true,
    });
    const history = this._history();
    const latest = history.at(-1) ?? null;
    const currentDigest = latest?.state.stateDigest ?? null;
    if (currentDigest !== expected) {
      if (currentDigest === state.stateDigest) {
        return Object.freeze({
          authenticated: true,
          durable: true,
          committed: true,
          stateDigest: state.stateDigest,
          receiptDigest: latest.event.eventDigest,
        });
      }
      conflict("retrieval revocation state changed before commit");
    }
    if (state.revision !== history.length + 1) {
      conflict("retrieval revocation state revision does not extend history");
    }
    assertStateExtends(latest?.state ?? null, state);
    const nowMs = Number(this._now());
    if (!Number.isFinite(nowMs)) {
      throw new TypeError("retrieval revocation ledger clock is invalid");
    }
    const head = this._verifyLedger();
    const published = this._put(ARTIFACT_TYPE, state, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      published?.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger"
    ) {
      corrupt("retrieval revocation state persistence was not confirmed");
    }
    const eventId = `${SKILL_RETRIEVAL_REVOCATION_LEDGER_EVENT_TYPE}.${state.stateDigest.slice(7)}`;
    const receipt = this._append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.streamId,
        decision: "committed",
        eventId,
        reason: `retrieval revocation state ${state.revision} committed`,
        skillName: null,
        sourceRefs: latest ? [latest.event.subjectRef] : [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp: new Date(nowMs).toISOString(),
        type: SKILL_RETRIEVAL_REVOCATION_LEDGER_EVENT_TYPE,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
    if (
      receipt?.authenticated !== true ||
      receipt.committed !== true ||
      receipt.durable !== true ||
      receipt.eventId !== eventId ||
      !DIGEST.test(receipt.eventDigest ?? "")
    ) {
      corrupt("retrieval revocation ledger append was not confirmed");
    }
    const recovered = this._history().at(-1);
    if (recovered?.state.stateDigest !== state.stateDigest) {
      corrupt("retrieval revocation state readback differs after commit");
    }
    return Object.freeze({
      authenticated: true,
      durable: true,
      committed: true,
      stateDigest: state.stateDigest,
      receiptDigest: receipt.eventDigest,
    });
  };

  persistencePorts() {
    return Object.freeze({ load: this.load, commit: this.commit });
  }
}

export function createSkillRetrievalRevocationLedgerAdapter(options) {
  return new SkillRetrievalRevocationLedgerAdapter(options);
}
