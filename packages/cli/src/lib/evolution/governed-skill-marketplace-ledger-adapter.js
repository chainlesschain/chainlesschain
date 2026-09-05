import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import {
  GOVERNED_SKILL_MARKETPLACE_STATE_SCHEMA,
  verifyGovernedSkillMarketplaceState,
} from "./governed-skill-marketplace.js";

export const GOVERNED_SKILL_MARKETPLACE_LEDGER_EVENT_TYPE =
  "governed-skill-marketplace.state-committed";
export const GOVERNED_SKILL_MARKETPLACE_LEDGER_CORRUPT_CODE =
  "CC_GOVERNED_SKILL_MARKETPLACE_LEDGER_CORRUPT";
export const GOVERNED_SKILL_MARKETPLACE_LEDGER_CONFLICT_CODE =
  "CC_GOVERNED_SKILL_MARKETPLACE_LEDGER_CONFLICT";

const ARTIFACT_TYPE = "governed-skill-marketplace-state";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SKILL = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const EVENTS = new Set([
  "marketplace.staged",
  "marketplace.advanced",
  "marketplace.revoked",
]);
const ADVANCES = new Map([
  ["candidate", "shadow"],
  ["shadow", "canary"],
  ["canary", "active"],
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function string(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function skill(value, label = "skillName") {
  if (!SKILL.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function expectedDigest(value) {
  if (value === null) return null;
  if (!DIGEST.test(value ?? "")) {
    throw new TypeError("expectedStateDigest is invalid");
  }
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
  fail(GOVERNED_SKILL_MARKETPLACE_LEDGER_CORRUPT_CODE, message, options);
}

function conflict(message) {
  fail(GOVERNED_SKILL_MARKETPLACE_LEDGER_CONFLICT_CODE, message);
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

function parseState(resolution, descriptor, skillName) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest ?? "") ||
    !DIGEST.test(resolution.receiptDigest ?? "") ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    corrupt("marketplace artifact resolution is incomplete");
  }
  let record;
  try {
    record = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    corrupt("marketplace artifact is not JSON");
  }
  if (
    record?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    record.tenantId !== descriptor.artifactTenantId ||
    record.audience !== descriptor.audience ||
    record.purpose !== descriptor.purpose ||
    record.retention !== "ledger" ||
    record.type !== ARTIFACT_TYPE
  ) {
    corrupt("marketplace durable artifact binding is invalid");
  }
  try {
    return verifyGovernedSkillMarketplaceState(
      record.value,
      descriptor.tenantId,
      skillName,
    );
  } catch (cause) {
    corrupt("marketplace state artifact is invalid", { cause });
  }
}

function assertStableIdentity(previous, next) {
  if (!previous) return;
  for (const field of [
    "tenantId",
    "skillName",
    "version",
    "manifestDigest",
    "packageDigest",
    "adaptedOutputDigest",
    "target",
    "previousStateDigest",
  ]) {
    if (canonical(previous[field]) !== canonical(next[field])) {
      corrupt(`marketplace state replaced immutable ${field}`);
    }
  }
}

function assertTransition(previous, next, event) {
  if (event === "marketplace.staged") {
    if (
      next.schema !== GOVERNED_SKILL_MARKETPLACE_STATE_SCHEMA ||
      next.stage !== "candidate" ||
      next.revoked !== false ||
      next.previousStateDigest !== (previous?.stateDigest ?? null)
    ) {
      corrupt("marketplace staged state transition is invalid");
    }
    return;
  }
  if (!previous) corrupt("marketplace state transition has no baseline");
  assertStableIdentity(previous, next);
  if (event === "marketplace.advanced") {
    if (
      ADVANCES.get(previous.stage) !== next.stage ||
      previous.revoked !== false ||
      next.revoked !== false ||
      !DIGEST.test(next.transitionRequestDigest ?? "") ||
      !DIGEST.test(next.transitionReceiptDigest ?? "")
    ) {
      corrupt("marketplace advance state transition is invalid");
    }
    return;
  }
  if (
    event !== "marketplace.revoked" ||
    next.stage !== "rolled-back" ||
    next.revoked !== true ||
    !DIGEST.test(next.revocationReceiptDigest ?? "") ||
    !DIGEST.test(next.transitionRequestDigest ?? "") ||
    !DIGEST.test(next.transitionReceiptDigest ?? "")
  ) {
    corrupt("marketplace revocation state transition is invalid");
  }
  if (
    Object.hasOwn(next, "revocationPropagationRequestDigest") !==
    Object.hasOwn(next, "revocationBaselineStateDigest")
  ) {
    corrupt("marketplace propagation state binding is incomplete");
  }
  if (
    Object.hasOwn(next, "revocationPropagationRequestDigest") &&
    (!DIGEST.test(next.revocationPropagationRequestDigest) ||
      next.revocationBaselineStateDigest !== previous.stateDigest)
  ) {
    corrupt("marketplace propagation baseline is invalid");
  }
}

export class GovernedSkillMarketplaceLedgerAdapter {
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

  _events(skillName) {
    const events = this._read();
    if (!Array.isArray(events)) {
      corrupt("EvolutionLedger did not return an event array");
    }
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === GOVERNED_SKILL_MARKETPLACE_LEDGER_EVENT_TYPE &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId &&
        event.skillName === skillName,
    );
  }

  _resolveEvent(event, previous = null) {
    if (
      event.artifactTenantId !== this.descriptor.artifactTenantId ||
      event.decision !== "committed" ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== (previous ? 1 : 0) ||
      (previous &&
        canonical(event.sourceRefs[0]) !== canonical(previous.subjectRef))
    ) {
      corrupt("marketplace ledger event lineage is invalid");
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
      corrupt("marketplace ledger subject was substituted");
    }
    const state = parseState(resolution, this.descriptor, event.skillName);
    if (
      event.eventId !==
      `${GOVERNED_SKILL_MARKETPLACE_LEDGER_EVENT_TYPE}.${state.stateDigest.slice(7)}`
    ) {
      corrupt("marketplace ledger event identity is invalid");
    }
    return state;
  }

  _history(skillName) {
    const events = this._events(skillName);
    const history = [];
    for (const [index, event] of events.entries()) {
      const previous = events[index - 1] ?? null;
      const state = this._resolveEvent(event, previous);
      const transition = event.reason.split(" ")[0];
      if (!EVENTS.has(transition)) {
        corrupt("marketplace ledger transition reason is invalid");
      }
      assertTransition(history[index - 1]?.state ?? null, state, transition);
      history.push(Object.freeze({ event, state, transition }));
    }
    return history;
  }

  load = ({ skillName } = {}) => {
    const normalizedSkill = skill(skillName);
    return this._history(normalizedSkill).at(-1)?.state ?? null;
  };

  commit = ({ state: input, expectedStateDigest, event } = {}) => {
    if (!EVENTS.has(event)) throw new TypeError("marketplace event is invalid");
    const state = verifyGovernedSkillMarketplaceState(
      input,
      this.descriptor.tenantId,
      input?.skillName,
    );
    const expected = expectedDigest(expectedStateDigest);
    const history = this._history(state.skillName);
    const latest = history.at(-1) ?? null;
    const currentDigest = latest?.state.stateDigest ?? null;
    if (currentDigest !== expected) {
      if (currentDigest === state.stateDigest && latest.transition === event) {
        return Object.freeze({
          authenticated: true,
          durable: true,
          stateDigest: state.stateDigest,
          expectedStateDigest: expected,
        });
      }
      conflict("marketplace state changed before commit");
    }
    assertTransition(latest?.state ?? null, state, event);
    const nowMs = Number(this._now());
    if (!Number.isFinite(nowMs)) {
      throw new TypeError("marketplace ledger clock is invalid");
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
      corrupt("marketplace state persistence was not confirmed");
    }
    const eventId = `${GOVERNED_SKILL_MARKETPLACE_LEDGER_EVENT_TYPE}.${state.stateDigest.slice(7)}`;
    const receipt = this._append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.streamId,
        decision: "committed",
        eventId,
        reason: `${event} committed`,
        skillName: state.skillName,
        sourceRefs: latest ? [latest.event.subjectRef] : [],
        subjectRef: published.ref,
        tenantId: this.descriptor.tenantId,
        timestamp: new Date(nowMs).toISOString(),
        type: GOVERNED_SKILL_MARKETPLACE_LEDGER_EVENT_TYPE,
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
      corrupt("marketplace ledger append was not confirmed");
    }
    const recovered = this._history(state.skillName).at(-1);
    if (recovered?.state.stateDigest !== state.stateDigest) {
      corrupt("marketplace state readback differs after commit");
    }
    return Object.freeze({
      authenticated: true,
      durable: true,
      stateDigest: state.stateDigest,
      expectedStateDigest: expected,
    });
  };

  persistencePorts() {
    return Object.freeze({ load: this.load, commit: this.commit });
  }
}

export function createGovernedSkillMarketplaceLedgerAdapter(options) {
  return new GovernedSkillMarketplaceLedgerAdapter(options);
}
