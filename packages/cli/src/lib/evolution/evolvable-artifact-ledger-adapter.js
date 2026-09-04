import { createHash } from "node:crypto";

import evolvableArtifactProtocol from "@chainlesschain/session-core/evolvable-artifact";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";

const {
  EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
  EVOLVABLE_ARTIFACT_TRANSITION_REQUEST_SCHEMA,
  EVOLVABLE_ARTIFACT_TRANSITION_RECEIPT_SCHEMA,
  digestEvolvableArtifactValue,
  verifyEvolvableArtifact,
} = evolvableArtifactProtocol;

export const EVOLVABLE_ARTIFACT_LEDGER_RECORD_SCHEMA =
  "chainlesschain.evolvable-artifact-ledger-record/v2";
export const EVOLVABLE_ARTIFACT_LEDGER_RECORD_LEGACY_SCHEMA =
  "chainlesschain.evolvable-artifact-ledger-record/v1";
export const EVOLVABLE_ARTIFACT_CANDIDATE_EVENT =
  "evolvable-artifact.candidate.persisted";
export const EVOLVABLE_ARTIFACT_TRANSITION_EVENT =
  "evolvable-artifact.transition.committed";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const TRANSITION_READERS = new WeakSet();
const RELEASE_RESOLVERS = new WeakSet();
const ACTIVE_RELEASE_READERS = new WeakSet();
const ARTIFACT_TYPES = new Set(["skill", "prompt", "hook", "knowledge"]);
const RECORD_KEYS = new Set([
  "artifact",
  "content",
  "contentAvailable",
  "kind",
  "receipt",
  "recordDigest",
  "request",
  "schema",
]);
const LEGACY_RECORD_KEYS = new Set(
  [...RECORD_KEYS].filter(
    (key) => !["content", "contentAvailable"].includes(key),
  ),
);
const DEPENDENCY_KIND_TYPES = new Map([
  ["skill", "skill"],
  ["active-skill", "skill"],
  ["prompt", "prompt"],
  ["active-prompt", "prompt"],
  ["hook", "hook"],
  ["active-hook", "hook"],
  ["knowledge", "knowledge"],
  ["active-knowledge", "knowledge"],
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(schema, value) {
  return `sha256:${createHash("sha256")
    .update(schema)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function exactRecord(value) {
  const keys =
    value?.schema === EVOLVABLE_ARTIFACT_LEDGER_RECORD_SCHEMA
      ? RECORD_KEYS
      : LEGACY_RECORD_KEYS;
  const ownKeys = Reflect.ownKeys(value ?? {});
  if (
    ![
      EVOLVABLE_ARTIFACT_LEDGER_RECORD_SCHEMA,
      EVOLVABLE_ARTIFACT_LEDGER_RECORD_LEGACY_SCHEMA,
    ].includes(value?.schema) ||
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  )
    throw new Error("artifact ledger record shape is invalid");
}

function text(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} is required`);
  return value;
}

function capture(owner, method, name) {
  if (!owner || typeof owner[method] !== "function")
    throw new TypeError(`${name}.${method}() is required`);
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function freeze(value) {
  const result = structuredClone(value);
  function visit(entry) {
    if (entry && typeof entry === "object" && !Object.isFrozen(entry)) {
      Object.freeze(entry);
      for (const child of Object.values(entry)) visit(child);
    }
  }
  visit(result);
  return result;
}

function transitionReceipt(request, revision) {
  const body = {
    schema: EVOLVABLE_ARTIFACT_TRANSITION_RECEIPT_SCHEMA,
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    kind: request.kind,
    tenantId: request.tenantId,
    type: request.type,
    artifactId: request.artifactId,
    candidateId: request.candidateId,
    releaseId: request.releaseId,
    artifactDigest: request.nextArtifactDigest,
    persisted: true,
    durable: true,
    revision,
  };
  return freeze({
    ...body,
    receiptDigest: digestEvolvableArtifactValue(body),
  });
}

export class EvolvableArtifactLedgerAdapter {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    clock = () => new Date().toISOString(),
  } = {}) {
    this.descriptor = Object.freeze({
      tenantId: text(input?.tenantId, "tenantId"),
      artifactTenantId: text(input?.artifactTenantId, "artifactTenantId"),
      streamId: text(input?.streamId, "streamId"),
      audience: text(input?.audience, "audience"),
      purpose: text(input?.purpose, "purpose"),
    });
    this.readerScope = Object.freeze({});
    if (this.descriptor.purpose !== "evolution-ledger")
      throw new TypeError("artifact adapter purpose must be evolution-ledger");
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._read = capture(ledger, "read", "ledger");
    this._verifyLedger = capture(ledger, "verify", "ledger");
    this._append = capture(ledger, "appendDomainEvent", "ledger");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver))
      throw new TypeError("a branded ledger artifact resolver is required");
    this._resolveArtifact = ledgerArtifactResolver;
    if (typeof clock !== "function") throw new TypeError("clock is required");
    this._clock = clock;
  }

  _events(type) {
    const events = this._read();
    if (!Array.isArray(events)) throw new Error("artifact ledger read failed");
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.type === type &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId,
    );
  }

  _event(eventId, type) {
    const matches = this._events(type).filter(
      (event) => event.eventId === eventId,
    );
    if (matches.length > 1) throw new Error("artifact event is ambiguous");
    return matches[0] ?? null;
  }

  _resolve(event, expectedType, expectedKind) {
    const identity = this._verifyLedger();
    const resolution = this._resolveArtifact({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
      resolution.authenticated !== true ||
      resolution.found !== true ||
      resolution.ref !== event.subjectRef.ref ||
      resolution.digest !== event.subjectRef.digest ||
      !Buffer.isBuffer(resolution.bytes)
    )
      throw new Error("artifact ledger resolution is invalid");
    let durable;
    try {
      durable = JSON.parse(resolution.bytes.toString("utf8"));
    } catch {
      throw new Error("artifact ledger record is not JSON");
    }
    if (
      durable?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      durable.tenantId !== this.descriptor.artifactTenantId ||
      durable.audience !== this.descriptor.audience ||
      durable.purpose !== this.descriptor.purpose ||
      durable.retention !== "ledger" ||
      durable.type !== expectedType ||
      ![
        EVOLVABLE_ARTIFACT_LEDGER_RECORD_SCHEMA,
        EVOLVABLE_ARTIFACT_LEDGER_RECORD_LEGACY_SCHEMA,
      ].includes(durable.value?.schema) ||
      durable.value.kind !== expectedKind
    )
      throw new Error("artifact durable record binding is invalid");
    exactRecord(durable.value);
    const core = structuredClone(durable.value);
    delete core.recordDigest;
    if (durable.value.recordDigest !== hash(durable.value.schema, core))
      throw new Error("artifact ledger record digest is invalid");
    verifyEvolvableArtifact(durable.value.artifact);
    if (durable.value.schema === EVOLVABLE_ARTIFACT_LEDGER_RECORD_SCHEMA) {
      if (
        typeof durable.value.contentAvailable !== "boolean" ||
        (durable.value.contentAvailable
          ? digestEvolvableArtifactValue(durable.value.content) !==
            durable.value.artifact.contentDigest
          : durable.value.content !== null) ||
        (expectedKind === "transition" && durable.value.contentAvailable)
      )
        throw new Error("artifact ledger content binding is invalid");
    }
    return freeze(durable.value);
  }

  _publish(type, value) {
    const published = this._put(type, value, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt?.readbackVerified !== true ||
      published.receipt?.integrityVerified !== true ||
      published.receipt?.retention !== "ledger"
    )
      throw new Error("artifact record was not persistently read back");
    return published.ref;
  }

  _appendRecord({ eventId, type, reason, ref, sourceRefs = [] }) {
    const head = this._verifyLedger();
    const timestamp = this._clock();
    if (
      typeof timestamp !== "string" ||
      !Number.isFinite(Date.parse(timestamp))
    )
      throw new Error("artifact ledger clock is invalid");
    return this._append(
      {
        artifactTenantId: this.descriptor.artifactTenantId,
        correlationId: this.descriptor.streamId,
        decision: "committed",
        eventId,
        reason,
        skillName: null,
        sourceRefs,
        subjectRef: ref,
        tenantId: this.descriptor.tenantId,
        timestamp,
        type,
      },
      { expectedHeadDigest: head.headDigest, expectedSequence: head.sequence },
    );
  }

  async persistCandidate(artifactInput, contentInput = undefined) {
    const artifact = verifyEvolvableArtifact(artifactInput);
    const contentAvailable = contentInput !== undefined;
    const content = contentAvailable ? freeze(contentInput) : null;
    if (
      contentAvailable &&
      digestEvolvableArtifactValue(content) !== artifact.contentDigest
    )
      throw new Error("candidate content does not match contentDigest");
    if (artifact.tenantId !== this.descriptor.tenantId)
      throw new Error("candidate crossed artifact adapter tenant");
    const eventId = `artifact-candidate.${artifact.artifactDigest.slice(7)}`;
    const existing = this._event(eventId, EVOLVABLE_ARTIFACT_CANDIDATE_EVENT);
    if (existing) {
      const stored = this._resolve(
        existing,
        "evolvable-artifact-candidate",
        "candidate",
      );
      if (canonical(stored.artifact) !== canonical(artifact))
        throw new Error("candidate operation resolved different artifact");
      if (
        contentAvailable &&
        (stored.contentAvailable !== true ||
          canonical(stored.content) !== canonical(content))
      )
        throw new Error("candidate content is unavailable or differs");
      return stored.receipt;
    }
    const receipt = freeze({
      schema: EVOLVABLE_ARTIFACT_PERSISTENCE_RECEIPT_SCHEMA,
      tenantId: artifact.tenantId,
      type: artifact.type,
      artifactId: artifact.artifactId,
      candidateId: artifact.candidate.candidateId,
      contentDigest: artifact.contentDigest,
      artifactDigest: artifact.artifactDigest,
      status: "candidate",
      persisted: true,
    });
    const core = {
      schema: EVOLVABLE_ARTIFACT_LEDGER_RECORD_SCHEMA,
      kind: "candidate",
      artifact,
      request: null,
      receipt,
      contentAvailable,
      content,
    };
    const record = freeze({
      ...core,
      recordDigest: hash(EVOLVABLE_ARTIFACT_LEDGER_RECORD_SCHEMA, core),
    });
    const ref = this._publish("evolvable-artifact-candidate", record);
    try {
      this._appendRecord({
        eventId,
        type: EVOLVABLE_ARTIFACT_CANDIDATE_EVENT,
        reason: `${artifact.type} candidate persisted`,
        ref,
      });
    } catch (error) {
      const recovered = this._event(
        eventId,
        EVOLVABLE_ARTIFACT_CANDIDATE_EVENT,
      );
      if (!recovered) throw error;
    }
    const stored = this._resolve(
      this._event(eventId, EVOLVABLE_ARTIFACT_CANDIDATE_EVENT),
      "evolvable-artifact-candidate",
      "candidate",
    );
    if (canonical(stored.artifact) !== canonical(artifact))
      throw new Error("candidate durable readback differs");
    if (
      stored.contentAvailable !== contentAvailable ||
      canonical(stored.content) !== canonical(content)
    )
      throw new Error("candidate content durable readback differs");
    return stored.receipt;
  }

  async commitTransition({ request, artifact: artifactInput }) {
    const artifact = verifyEvolvableArtifact(artifactInput);
    const requestCore = request && {
      schema: request.schema,
      kind: request.kind,
      tenantId: request.tenantId,
      type: request.type,
      artifactId: request.artifactId,
      candidateId: request.candidateId,
      releaseId: request.releaseId,
      previousArtifactDigest: request.previousArtifactDigest,
      nextArtifactDigest: request.nextArtifactDigest,
    };
    if (
      request?.schema !== EVOLVABLE_ARTIFACT_TRANSITION_REQUEST_SCHEMA ||
      !["promote", "rollback"].includes(request.kind) ||
      request?.tenantId !== this.descriptor.tenantId ||
      artifact.tenantId !== this.descriptor.tenantId ||
      request.type !== artifact.type ||
      request.artifactId !== artifact.artifactId ||
      request.candidateId !== artifact.candidate.candidateId ||
      request.releaseId !== artifact.activeReleaseId ||
      request.nextArtifactDigest !== artifact.artifactDigest ||
      !DIGEST.test(request.requestDigest ?? "") ||
      request.requestDigest !== digestEvolvableArtifactValue(requestCore) ||
      request.operationId !==
        `artifact-transition:${request.requestDigest.slice(7)}`
    )
      throw new Error("artifact transition request is invalid");
    const eventId = `artifact-transition.${request.requestDigest.slice(7)}`;
    const existing = this._event(eventId, EVOLVABLE_ARTIFACT_TRANSITION_EVENT);
    if (existing) return this._readTransitionEvent(existing, request).receipt;
    const sourceEvent = [
      ...this._events(EVOLVABLE_ARTIFACT_CANDIDATE_EVENT).map((event) => ({
        event,
        record: this._resolve(
          event,
          "evolvable-artifact-candidate",
          "candidate",
        ),
      })),
      ...this._events(EVOLVABLE_ARTIFACT_TRANSITION_EVENT).map((event) => ({
        event,
        record: this._resolve(
          event,
          "evolvable-artifact-transition",
          "transition",
        ),
      })),
    ].find(
      ({ record }) =>
        record.artifact.artifactDigest === request.previousArtifactDigest,
    )?.event;
    if (!sourceEvent)
      throw new Error("transition has no persisted artifact lineage");
    const revision = this._verifyLedger().sequence + 1;
    const receipt = transitionReceipt(request, revision);
    const core = {
      schema: EVOLVABLE_ARTIFACT_LEDGER_RECORD_SCHEMA,
      kind: "transition",
      artifact,
      request,
      receipt,
      contentAvailable: false,
      content: null,
    };
    const record = freeze({
      ...core,
      recordDigest: hash(EVOLVABLE_ARTIFACT_LEDGER_RECORD_SCHEMA, core),
    });
    const ref = this._publish("evolvable-artifact-transition", record);
    try {
      this._appendRecord({
        eventId,
        type: EVOLVABLE_ARTIFACT_TRANSITION_EVENT,
        reason: `${artifact.type} ${request.kind} transition committed`,
        ref,
        sourceRefs: [sourceEvent.subjectRef],
      });
    } catch (error) {
      const recovered = this._event(
        eventId,
        EVOLVABLE_ARTIFACT_TRANSITION_EVENT,
      );
      if (!recovered) throw error;
    }
    return this._readTransitionEvent(
      this._event(eventId, EVOLVABLE_ARTIFACT_TRANSITION_EVENT),
      request,
    ).receipt;
  }

  _readTransitionEvent(event, expectedRequest = null) {
    const stored = this._resolve(
      event,
      "evolvable-artifact-transition",
      "transition",
    );
    if (
      expectedRequest &&
      canonical(stored.request) !== canonical(expectedRequest)
    )
      throw new Error("transition operation resolved different request");
    return stored;
  }

  async readTransition({ operationId }) {
    const prefix = "artifact-transition:";
    if (typeof operationId !== "string" || !operationId.startsWith(prefix))
      throw new TypeError("operationId is invalid");
    const event = this._event(
      `artifact-transition.${operationId.slice(prefix.length)}`,
      EVOLVABLE_ARTIFACT_TRANSITION_EVENT,
    );
    if (!event) return null;
    const stored = this._readTransitionEvent(event);
    if (stored.request.operationId !== operationId)
      throw new Error("transition operationId was substituted");
    return freeze({
      request: stored.request,
      artifact: stored.artifact,
      receipt: stored.receipt,
    });
  }

  transitionReader() {
    const readTransition = this.readTransition.bind(this);
    const reader = Object.freeze({
      tenantId: this.descriptor.tenantId,
      readerScope: this.readerScope,
      readTransition,
    });
    TRANSITION_READERS.add(reader);
    return reader;
  }

  _activeArtifacts() {
    const histories = new Map();
    for (const event of this._events(EVOLVABLE_ARTIFACT_TRANSITION_EVENT)) {
      const record = this._resolve(
        event,
        "evolvable-artifact-transition",
        "transition",
      );
      const history = histories.get(record.artifact.artifactId) ?? [];
      history.push({ event, artifact: record.artifact });
      histories.set(record.artifact.artifactId, history);
    }
    const active = [];
    for (const history of histories.values()) {
      history.sort((left, right) => left.event.sequence - right.event.sequence);
      const latest = history.at(-1).artifact;
      if (latest.release?.status === "active") {
        active.push(latest);
        continue;
      }
      const target = [...history]
        .reverse()
        .map(({ artifact }) => artifact)
        .find(
          (artifact) =>
            artifact.release?.status === "active" &&
            artifact.activeReleaseId === latest.activeReleaseId,
        );
      if (target) active.push(target);
    }
    return active;
  }

  _activeReleaseRecord(artifact) {
    const transitions = this._events(EVOLVABLE_ARTIFACT_TRANSITION_EVENT)
      .map((event) =>
        this._resolve(event, "evolvable-artifact-transition", "transition"),
      )
      .filter(
        (record) => record.artifact.artifactDigest === artifact.artifactDigest,
      );
    if (transitions.length !== 1)
      throw new Error("active artifact transition is ambiguous");
    const candidateDigest = transitions[0].request.previousArtifactDigest;
    const candidates = this._events(EVOLVABLE_ARTIFACT_CANDIDATE_EVENT)
      .map((event) =>
        this._resolve(event, "evolvable-artifact-candidate", "candidate"),
      )
      .filter((record) => record.artifact.artifactDigest === candidateDigest);
    if (candidates.length !== 1)
      throw new Error("active artifact candidate is ambiguous");
    const candidate = candidates[0];
    if (
      candidate.artifact.artifactId !== artifact.artifactId ||
      candidate.artifact.type !== artifact.type ||
      candidate.artifact.contentDigest !== artifact.contentDigest ||
      candidate.artifact.candidate.candidateId !==
        artifact.candidate.candidateId
    )
      throw new Error("active artifact content lineage is invalid");
    return freeze({
      authenticated: true,
      durable: true,
      tenantId: artifact.tenantId,
      type: artifact.type,
      artifactId: artifact.artifactId,
      releaseId: artifact.activeReleaseId,
      contentDigest: artifact.contentDigest,
      artifactDigest: artifact.artifactDigest,
      contentAvailable: candidate.contentAvailable === true,
      content: candidate.contentAvailable === true ? candidate.content : null,
    });
  }

  activeReleaseReader() {
    const adapter = this;
    const tenantId = this.descriptor.tenantId;
    const reader = Object.freeze({
      tenantId,
      readerScope: this.readerScope,
      async listActive({ type = null } = {}) {
        if (type !== null && !ARTIFACT_TYPES.has(type))
          throw new TypeError("active artifact type is invalid");
        return freeze(
          adapter
            ._activeArtifacts()
            .filter((artifact) => type === null || artifact.type === type)
            .sort((left, right) =>
              `${left.type}:${left.artifactId}`.localeCompare(
                `${right.type}:${right.artifactId}`,
              ),
            )
            .map((artifact) => adapter._activeReleaseRecord(artifact)),
        );
      },
      async readActive({ type, artifactId } = {}) {
        if (!ARTIFACT_TYPES.has(type))
          throw new TypeError("active artifact type is invalid");
        const normalizedArtifactId = text(artifactId, "artifactId");
        const matches = adapter
          ._activeArtifacts()
          .filter(
            (artifact) =>
              artifact.type === type &&
              artifact.artifactId === normalizedArtifactId,
          );
        if (matches.length > 1)
          throw new Error("active artifact release is ambiguous");
        return matches.length === 0
          ? null
          : adapter._activeReleaseRecord(matches[0]);
      },
    });
    ACTIVE_RELEASE_READERS.add(reader);
    return reader;
  }

  releaseResolver() {
    const tenantId = this.descriptor.tenantId;
    const adapter = this;
    const resolver = Object.freeze({
      tenantId,
      readerScope: this.readerScope,
      async resolveDependency(input) {
        if (
          input?.tenantId !== tenantId ||
          !DIGEST.test(input.digest ?? "") ||
          typeof input.kind !== "string" ||
          typeof input.disposition !== "string"
        )
          throw new TypeError("artifact dependency request is invalid");
        const type = DEPENDENCY_KIND_TYPES.get(input.kind);
        if (!type)
          throw new Error("artifact dependency kind is not resolvable");
        const matches = adapter
          ._activeArtifacts()
          .filter(
            (artifact) =>
              artifact.type === type && artifact.contentDigest === input.digest,
          );
        if (matches.length !== 1)
          throw new Error("artifact dependency active release is ambiguous");
        const artifact = matches[0];
        return freeze({
          authenticated: true,
          durable: true,
          tenantId,
          sourceKind: input.kind,
          sourceDigest: input.digest,
          sourceDisposition: input.disposition,
          artifactId: artifact.artifactId,
          type: artifact.type,
          releaseId: artifact.activeReleaseId,
          contentDigest: artifact.contentDigest,
          artifactDigest: artifact.artifactDigest,
        });
      },
    });
    RELEASE_RESOLVERS.add(resolver);
    return resolver;
  }
}

export function isEvolvableArtifactTransitionReader(value) {
  return TRANSITION_READERS.has(value);
}

export function isEvolvableArtifactReleaseResolver(value) {
  return RELEASE_RESOLVERS.has(value);
}

export function isEvolvableArtifactActiveReleaseReader(value) {
  return ACTIVE_RELEASE_READERS.has(value);
}
