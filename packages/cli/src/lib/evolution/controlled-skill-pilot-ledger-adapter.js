import { types as utilTypes } from "node:util";

import {
  CONTROLLED_SKILL_PILOT_EVENT_SCHEMA,
  CONTROLLED_SKILL_PILOT_PROGRESSIVE_STATE_SCHEMA,
  CONTROLLED_SKILL_PILOT_STAGE,
  CONTROLLED_SKILL_PILOT_STATE_SCHEMA,
  digestControlledSkillPilotEvent,
  digestControlledSkillPilotState,
} from "./controlled-skill-production-pilot.js";
import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";

export const CONTROLLED_SKILL_PILOT_LEDGER_RECORD_SCHEMA =
  "chainlesschain.controlled-skill-pilot-ledger-record/v1";
export const CONTROLLED_SKILL_PILOT_LEDGER_EVENT_TYPE =
  "controlled-skill-pilot.state-committed";
export const CONTROLLED_SKILL_PILOT_LEDGER_CORRUPT_CODE =
  "CC_CONTROLLED_SKILL_PILOT_LEDGER_CORRUPT";
export const CONTROLLED_SKILL_PILOT_LEDGER_CONFLICT_CODE =
  "CC_CONTROLLED_SKILL_PILOT_LEDGER_CONFLICT";

const ARTIFACT_TYPE = "controlled-skill-pilot-state";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/u;
const STATE_SCHEMAS = new Set([
  CONTROLLED_SKILL_PILOT_STATE_SCHEMA,
  CONTROLLED_SKILL_PILOT_PROGRESSIVE_STATE_SCHEMA,
]);
const STAGES = new Set(Object.values(CONTROLLED_SKILL_PILOT_STAGE));
const PILOT_EVENT_TYPES = new Set([
  "pilot.started",
  "pilot.observation-recorded",
  "pilot.stage-transition-prepared",
  "pilot.stage-transitioned",
]);
const COMMIT_KEYS = new Set([
  "expectedRevision",
  "state",
  "stateDigest",
  "event",
  "eventDigest",
]);
const RECORD_KEYS = new Set([
  "schema",
  "descriptorDigest",
  "state",
  "stateDigest",
  "event",
  "eventDigest",
]);
const RESTORE_KEYS = new Set([
  "authenticated",
  "durable",
  "descriptorDigest",
  "stateDigest",
  "state",
]);
const EVENT_KEYS = new Set([
  "schema",
  "descriptorDigest",
  "tenantId",
  "pilotId",
  "type",
  "expectedRevision",
  "revision",
  "stateDigest",
  "evidence",
  "committedAt",
]);
const V1_STATE_KEYS = new Set([
  "schema",
  "descriptorDigest",
  "revision",
  "stage",
  "stageStartedAt",
  "activeStateDigest",
  "reviewReceiptDigest",
  "killSwitch",
  "observations",
  "pendingTransition",
  "lastTransitionReceiptDigest",
]);
const V2_STATE_KEYS = new Set([
  ...V1_STATE_KEYS,
  "progressivePlanDigest",
  "progressiveStepId",
  "progressiveGateReceiptDigests",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.size ||
    own.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${String(key)} is not a data field`);
    }
  }
}

function requiredString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${label} is required`);
  }
  return value;
}

function safeId(value, label) {
  if (!SAFE_ID.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) {
    throw new TypeError(`${label} must be sha256-bound`);
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
  fail(CONTROLLED_SKILL_PILOT_LEDGER_CORRUPT_CODE, message, options);
}

function conflict(message) {
  fail(CONTROLLED_SKILL_PILOT_LEDGER_CONFLICT_CODE, message);
}

function normalizeDescriptor(input) {
  return Object.freeze({
    tenantId: requiredString(input?.tenantId, "tenantId"),
    artifactTenantId: requiredString(
      input?.artifactTenantId,
      "artifactTenantId",
    ),
    streamId: requiredString(input?.streamId, "streamId"),
    pilotId: safeId(input?.pilotId, "pilotId"),
    skillName: safeId(input?.skillName, "skillName"),
    descriptorDigest: digest(input?.descriptorDigest, "descriptorDigest"),
    audience: requiredString(input?.audience, "audience"),
    purpose: requiredString(input?.purpose, "purpose"),
  });
}

function nullableDigest(value, label) {
  if (value === null) return null;
  return digest(value, label);
}

function verifyState(input, descriptor) {
  const stateKeys =
    input?.schema === CONTROLLED_SKILL_PILOT_PROGRESSIVE_STATE_SCHEMA
      ? V2_STATE_KEYS
      : V1_STATE_KEYS;
  exact(input, stateKeys, "controlled Skill Pilot state");
  const state = structuredClone(input);
  if (
    !STATE_SCHEMAS.has(state.schema) ||
    state.descriptorDigest !== descriptor.descriptorDigest ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 1 ||
    !STAGES.has(state.stage) ||
    (state.stageStartedAt !== null &&
      (!Number.isSafeInteger(state.stageStartedAt) ||
        state.stageStartedAt < 0)) ||
    typeof state.killSwitch !== "boolean" ||
    !Array.isArray(state.observations) ||
    state.observations.length > 10_000
  ) {
    corrupt("controlled Skill Pilot state is invalid");
  }
  for (const [value, label] of [
    [state.activeStateDigest, "activeStateDigest"],
    [state.reviewReceiptDigest, "reviewReceiptDigest"],
    [state.lastTransitionReceiptDigest, "lastTransitionReceiptDigest"],
  ]) {
    try {
      nullableDigest(value, label);
    } catch (cause) {
      corrupt("controlled Skill Pilot state digest is invalid", { cause });
    }
  }
  if (state.schema === CONTROLLED_SKILL_PILOT_PROGRESSIVE_STATE_SCHEMA) {
    try {
      digest(state.progressivePlanDigest, "progressivePlanDigest");
    } catch (cause) {
      corrupt("controlled Skill Pilot progressive plan is invalid", { cause });
    }
    if (
      (state.progressiveStepId !== null &&
        !SAFE_ID.test(state.progressiveStepId ?? "")) ||
      !Array.isArray(state.progressiveGateReceiptDigests) ||
      state.progressiveGateReceiptDigests.length > 512 ||
      state.progressiveGateReceiptDigests.some((value) => !DIGEST.test(value))
    ) {
      corrupt("controlled Skill Pilot progressive state is invalid");
    }
  }
  return Object.freeze(state);
}

function verifyCommit(input, descriptor) {
  exact(input, COMMIT_KEYS, "controlled Skill Pilot state commit");
  const state = verifyState(input.state, descriptor);
  exact(input.event, EVENT_KEYS, "controlled Skill Pilot event");
  const event = structuredClone(input.event);
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    state.revision !== input.expectedRevision + 1 ||
    input.stateDigest !== digestControlledSkillPilotState(state) ||
    event.schema !== CONTROLLED_SKILL_PILOT_EVENT_SCHEMA ||
    event.descriptorDigest !== descriptor.descriptorDigest ||
    event.tenantId !== descriptor.tenantId ||
    event.pilotId !== descriptor.pilotId ||
    !PILOT_EVENT_TYPES.has(event.type) ||
    event.expectedRevision !== input.expectedRevision ||
    event.revision !== state.revision ||
    event.stateDigest !== input.stateDigest ||
    !Number.isSafeInteger(event.committedAt) ||
    event.committedAt < 0 ||
    input.eventDigest !== digestControlledSkillPilotEvent(event)
  ) {
    corrupt("controlled Skill Pilot commit binding is invalid");
  }
  return Object.freeze({
    expectedRevision: input.expectedRevision,
    state,
    stateDigest: input.stateDigest,
    event: Object.freeze(event),
    eventDigest: input.eventDigest,
  });
}

function parseRecord(resolution, descriptor) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest ?? "") ||
    !DIGEST.test(resolution.receiptDigest ?? "") ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    corrupt("controlled Skill Pilot artifact resolution is incomplete");
  }
  let durable;
  try {
    durable = JSON.parse(resolution.bytes.toString("utf8"));
  } catch (cause) {
    corrupt("controlled Skill Pilot artifact is not JSON", { cause });
  }
  if (
    durable?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    durable.tenantId !== descriptor.artifactTenantId ||
    durable.audience !== descriptor.audience ||
    durable.purpose !== descriptor.purpose ||
    durable.retention !== "ledger" ||
    durable.type !== ARTIFACT_TYPE
  ) {
    corrupt("controlled Skill Pilot durable artifact binding is invalid");
  }
  exact(durable.value, RECORD_KEYS, "controlled Skill Pilot ledger record");
  if (
    durable.value.schema !== CONTROLLED_SKILL_PILOT_LEDGER_RECORD_SCHEMA ||
    durable.value.descriptorDigest !== descriptor.descriptorDigest
  ) {
    corrupt("controlled Skill Pilot ledger record identity is invalid");
  }
  return verifyCommit(
    {
      expectedRevision: durable.value.event.expectedRevision,
      state: durable.value.state,
      stateDigest: durable.value.stateDigest,
      event: durable.value.event,
      eventDigest: durable.value.eventDigest,
    },
    descriptor,
  );
}

function acknowledgement(descriptor, commit, recovered = false) {
  return Object.freeze({
    authenticated: true,
    durable: true,
    descriptorDigest: descriptor.descriptorDigest,
    revision: commit.state.revision,
    stateDigest: commit.stateDigest,
    eventDigest: commit.eventDigest,
    recovered,
  });
}

export class ControlledSkillPilotLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
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
    this._resolveArtifact = ledgerArtifactResolver;
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
        event.type === CONTROLLED_SKILL_PILOT_LEDGER_EVENT_TYPE &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId &&
        event.skillName === this.descriptor.skillName,
    );
  }

  _resolveEvent(event, identity) {
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
      corrupt("controlled Skill Pilot ledger subject was substituted");
    }
    return parseRecord(resolution, this.descriptor);
  }

  _historyWithIdentity() {
    const events = this._events();
    const identity = this._verifyLedger();
    const history = [];
    for (const [index, event] of events.entries()) {
      const previous = history.at(-1) ?? null;
      const commit = this._resolveEvent(event, identity);
      if (
        commit.state.revision !== index + 1 ||
        commit.expectedRevision !== index ||
        event.artifactTenantId !== this.descriptor.artifactTenantId ||
        event.decision !== "committed" ||
        event.eventId !==
          `${CONTROLLED_SKILL_PILOT_LEDGER_EVENT_TYPE}.${commit.stateDigest.slice(7)}` ||
        event.reason !== `${commit.event.type} committed` ||
        event.timestamp !== new Date(commit.event.committedAt).toISOString() ||
        !Array.isArray(event.sourceRefs) ||
        event.sourceRefs.length !== (previous ? 1 : 0) ||
        (previous &&
          canonical(event.sourceRefs[0]) !==
            canonical(previous.event.subjectRef))
      ) {
        corrupt("controlled Skill Pilot ledger history is invalid");
      }
      history.push(Object.freeze({ event, commit }));
    }
    return Object.freeze({ history, identity });
  }

  _history() {
    return this._historyWithIdentity().history;
  }

  load = () => {
    const latest = this._history().at(-1)?.commit ?? null;
    if (!latest) return null;
    return Object.freeze({
      authenticated: true,
      durable: true,
      descriptorDigest: this.descriptor.descriptorDigest,
      stateDigest: latest.stateDigest,
      state: latest.state,
    });
  };

  verifyRestore = ({ restore, descriptorDigest } = {}) => {
    const current = this.load();
    try {
      exact(restore, RESTORE_KEYS, "controlled Skill Pilot restore");
    } catch (cause) {
      corrupt("controlled Skill Pilot restore has an invalid shape", { cause });
    }
    if (
      !current ||
      restore.authenticated !== true ||
      restore.durable !== true ||
      descriptorDigest !== this.descriptor.descriptorDigest ||
      restore.descriptorDigest !== descriptorDigest ||
      canonical(restore) !== canonical(current)
    ) {
      corrupt("controlled Skill Pilot restore differs from durable state");
    }
    return current;
  };

  commitState = async (input) => {
    const commit = verifyCommit(input, this.descriptor);
    const { history, identity: head } = this._historyWithIdentity();
    const latest = history.at(-1) ?? null;
    const currentRevision = latest?.commit.state.revision ?? 0;
    if (commit.expectedRevision !== currentRevision) {
      if (
        latest?.commit.stateDigest === commit.stateDigest &&
        latest.commit.eventDigest === commit.eventDigest
      ) {
        return acknowledgement(this.descriptor, commit, true);
      }
      conflict("controlled Skill Pilot state changed before commit");
    }
    const record = Object.freeze({
      schema: CONTROLLED_SKILL_PILOT_LEDGER_RECORD_SCHEMA,
      descriptorDigest: this.descriptor.descriptorDigest,
      state: commit.state,
      stateDigest: commit.stateDigest,
      event: commit.event,
      eventDigest: commit.eventDigest,
    });
    const published = this._put(ARTIFACT_TYPE, record, {
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
      corrupt("controlled Skill Pilot state persistence was not confirmed");
    }
    const eventId = `${CONTROLLED_SKILL_PILOT_LEDGER_EVENT_TYPE}.${commit.stateDigest.slice(7)}`;
    try {
      const receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "committed",
          eventId,
          reason: `${commit.event.type} committed`,
          skillName: this.descriptor.skillName,
          sourceRefs: latest ? [latest.event.subjectRef] : [],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: new Date(commit.event.committedAt).toISOString(),
          type: CONTROLLED_SKILL_PILOT_LEDGER_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (
        receipt?.authenticated !== true ||
        receipt.committed !== true ||
        receipt.durable !== true ||
        receipt.eventId !== eventId ||
        !DIGEST.test(receipt.receiptDigest ?? "")
      ) {
        corrupt("controlled Skill Pilot ledger append was not confirmed");
      }
    } catch (cause) {
      const recovered = this._history().at(-1)?.commit;
      if (
        recovered?.stateDigest !== commit.stateDigest ||
        recovered.eventDigest !== commit.eventDigest
      ) {
        throw cause;
      }
      return acknowledgement(this.descriptor, commit, true);
    }
    const recovered = this._history().at(-1)?.commit;
    if (
      recovered?.stateDigest !== commit.stateDigest ||
      recovered.eventDigest !== commit.eventDigest
    ) {
      corrupt("controlled Skill Pilot state readback differs after commit");
    }
    return acknowledgement(this.descriptor, commit, false);
  };

  pilotPorts(ports = {}) {
    return Object.freeze({
      readActiveState: capture(ports, "readActiveState"),
      verifyApproval: capture(ports, "verifyApproval"),
      verifyObservation: capture(ports, "verifyObservation"),
      transitionStage: capture(ports, "transitionStage"),
      verifyRestore: this.verifyRestore,
      commitState: this.commitState,
    });
  }
}

export function createControlledSkillPilotLedgerAdapter(options) {
  return new ControlledSkillPilotLedgerAdapter(options);
}
