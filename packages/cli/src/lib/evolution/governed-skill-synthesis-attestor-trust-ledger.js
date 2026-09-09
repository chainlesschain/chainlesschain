import { createHash, createPublicKey } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import {
  getGovernedSkillSynthesisExternalAttestationIdentity,
  verifyGovernedSkillSynthesisExternalAttestation,
} from "./governed-skill-synthesis-external-attestor.js";

export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_RECORD_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-record/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_VERIFIER_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-verifier/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_KEY_REGISTERED_EVENT =
  "learning.skill-synthesis-attestor-key.registered";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_KEY_ROTATED_EVENT =
  "learning.skill-synthesis-attestor-key.rotated";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_KEY_REVOKED_EVENT =
  "learning.skill-synthesis-attestor-key.revoked";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_CORRUPT_CODE =
  "CC_LEARNING_SYNTHESIS_ATTESTOR_TRUST_CORRUPT";

const ARTIFACT_TYPE = "governed-skill-synthesis-attestor-trust-record";
const VERIFIERS = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SERVICE_ID = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+){1,7}$/u;
const RECORD_KEYS = new Set([
  "effectiveAt",
  "keyId",
  "operation",
  "priorKeyId",
  "priorPublicKeySpki",
  "publicKeySpki",
  "reason",
  "recordDigest",
  "schema",
  "serviceId",
  "tenantId",
]);
const EVENT_TYPES = new Set([
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_KEY_REGISTERED_EVENT,
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_KEY_ROTATED_EVENT,
  GOVERNED_SKILL_SYNTHESIS_ATTESTOR_KEY_REVOKED_EVENT,
]);

function corrupt(message) {
  const error = new Error(message);
  error.code = GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_CORRUPT_CODE;
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
    .update(domain)
    .update("\0")
    .update(canonical(value))
    .digest("hex")}`;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    Reflect.ownKeys(value).length !== keys.size ||
    Reflect.ownKeys(value).some((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return (
        typeof key !== "string" ||
        !keys.has(key) ||
        !descriptor ||
        !("value" in descriptor) ||
        descriptor.enumerable !== true
      );
    })
  ) {
    corrupt(`${label} is invalid`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function serviceId(value) {
  if (typeof value !== "string" || !SERVICE_ID.test(value)) {
    throw new TypeError("attestor serviceId is invalid");
  }
  return value;
}

function reason(value) {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 2048
  ) {
    throw new TypeError("attestor key lifecycle reason is invalid");
  }
  return value;
}

function capture(owner, method, label) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function"
  ) {
    throw new TypeError(`${label}.${method}() is required`);
  }
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function normalizeDescriptor(input) {
  return Object.freeze({
    tenantId: identifier(input?.tenantId, "tenantId"),
    artifactTenantId: identifier(input?.artifactTenantId, "artifactTenantId"),
    streamId: identifier(input?.streamId, "streamId"),
    audience: identifier(input?.audience, "audience"),
    purpose: identifier(input?.purpose, "purpose"),
  });
}

function encodePublicKey(value) {
  let publicKey;
  try {
    if (
      (utilTypes.isKeyObject(value) && value.type !== "public") ||
      (typeof value === "string" && /PRIVATE KEY/u.test(value))
    ) {
      throw new TypeError("private keys are not accepted");
    }
    publicKey = utilTypes.isKeyObject(value) ? value : createPublicKey(value);
  } catch {
    throw new TypeError("attestor publicKey must be Ed25519");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("attestor publicKey must be Ed25519");
  }
  const bytes = publicKey.export({ format: "der", type: "spki" });
  return Object.freeze({
    keyId: `key:ed25519:${createHash("sha256").update(bytes).digest("hex")}`,
    publicKeySpki: bytes.toString("base64url"),
  });
}

function decodePublicKey(publicKeySpki, keyId) {
  if (typeof publicKeySpki !== "string") corrupt("attestor SPKI is invalid");
  const bytes = Buffer.from(publicKeySpki, "base64url");
  if (bytes.toString("base64url") !== publicKeySpki) {
    corrupt("attestor SPKI is not canonical base64url");
  }
  let publicKey;
  try {
    publicKey = createPublicKey({ key: bytes, format: "der", type: "spki" });
  } catch {
    corrupt("attestor SPKI is invalid");
  }
  if (publicKey.asymmetricKeyType !== "ed25519") {
    corrupt("attestor SPKI is not Ed25519");
  }
  const expected = `key:ed25519:${createHash("sha256")
    .update(bytes)
    .digest("hex")}`;
  if (keyId !== expected) corrupt("attestor keyId does not bind its SPKI");
  return publicKey;
}

function recordCore(value) {
  const core = structuredClone(value);
  delete core.recordDigest;
  return core;
}

export function digestGovernedSkillSynthesisAttestorTrustRecord(value) {
  return hash(
    GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_RECORD_SCHEMA,
    recordCore(value),
  );
}

function validateRecord(value, descriptor) {
  exact(value, RECORD_KEYS, "attestor trust record");
  if (
    value.schema !== GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_RECORD_SCHEMA ||
    value.tenantId !== descriptor.tenantId ||
    !["register", "rotate", "revoke"].includes(value.operation) ||
    !SERVICE_ID.test(value.serviceId ?? "") ||
    !/^key:ed25519:[a-f0-9]{64}$/u.test(value.keyId ?? "") ||
    !Number.isFinite(Date.parse(value.effectiveAt)) ||
    new Date(Date.parse(value.effectiveAt)).toISOString() !==
      value.effectiveAt ||
    value.recordDigest !==
      digestGovernedSkillSynthesisAttestorTrustRecord(value)
  ) {
    corrupt("attestor trust record binding is invalid");
  }
  decodePublicKey(value.publicKeySpki, value.keyId);
  if (value.operation === "register") {
    if (
      value.priorKeyId !== null ||
      value.priorPublicKeySpki !== null ||
      value.reason !== null
    ) {
      corrupt("attestor registration record is invalid");
    }
  } else if (value.operation === "rotate") {
    if (
      !/^key:ed25519:[a-f0-9]{64}$/u.test(value.priorKeyId ?? "") ||
      value.priorKeyId === value.keyId ||
      typeof value.priorPublicKeySpki !== "string" ||
      typeof value.reason !== "string" ||
      value.reason.trim() !== value.reason ||
      value.reason.length < 1 ||
      value.reason.length > 2048
    ) {
      corrupt("attestor rotation record is invalid");
    }
    decodePublicKey(value.priorPublicKeySpki, value.priorKeyId);
  } else if (
    value.priorKeyId !== null ||
    value.priorPublicKeySpki !== null ||
    typeof value.reason !== "string" ||
    value.reason.trim() !== value.reason ||
    value.reason.length < 1 ||
    value.reason.length > 2048
  ) {
    corrupt("attestor revocation record is invalid");
  }
  return freeze(structuredClone(value));
}

function eventType(operation) {
  if (operation === "register") {
    return GOVERNED_SKILL_SYNTHESIS_ATTESTOR_KEY_REGISTERED_EVENT;
  }
  if (operation === "rotate") {
    return GOVERNED_SKILL_SYNTHESIS_ATTESTOR_KEY_ROTATED_EVENT;
  }
  return GOVERNED_SKILL_SYNTHESIS_ATTESTOR_KEY_REVOKED_EVENT;
}

function eventId(record) {
  return `${eventType(record.operation)}.${hash("attestor-trust-event", {
    serviceId: record.serviceId,
    keyId: record.keyId,
  }).slice(7)}`;
}

function sameLifecycleIntent(left, right) {
  const strip = (value) => {
    const copy = recordCore(value);
    delete copy.effectiveAt;
    return copy;
  };
  return canonical(strip(left)) === canonical(strip(right));
}

function parseArtifact(resolution, descriptor) {
  if (
    resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
    resolution.authenticated !== true ||
    resolution.found !== true ||
    !DIGEST.test(resolution.digest ?? "") ||
    !DIGEST.test(resolution.receiptDigest ?? "") ||
    !Buffer.isBuffer(resolution.bytes)
  ) {
    corrupt("attestor trust artifact resolution is incomplete");
  }
  let artifact;
  try {
    artifact = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    corrupt("attestor trust artifact is not JSON");
  }
  if (
    artifact?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    artifact.tenantId !== descriptor.artifactTenantId ||
    artifact.audience !== descriptor.audience ||
    artifact.purpose !== descriptor.purpose ||
    artifact.retention !== "ledger" ||
    artifact.type !== ARTIFACT_TYPE
  ) {
    corrupt("attestor trust durable artifact binding is invalid");
  }
  return validateRecord(artifact.value, descriptor);
}

function verificationInput(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return null;
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const required = new Set([
    "attestation",
    "candidateDigest",
    "descriptor",
    "receiptDigest",
  ]);
  const allowed = new Set([...required, "ledgerContext"]);
  if (
    Reflect.ownKeys(descriptors).some(
      (key) =>
        typeof key !== "string" ||
        !allowed.has(key) ||
        !("value" in descriptors[key]) ||
        descriptors[key].enumerable !== true,
    ) ||
    [...required].some((key) => !Object.hasOwn(descriptors, key))
  ) {
    return null;
  }
  return Object.fromEntries(
    Object.entries(descriptors).map(([key, entry]) => [key, entry.value]),
  );
}

export class GovernedSkillSynthesisAttestorTrustLedger {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    now = Date.now,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._read = capture(ledger, "read", "ledger");
    this._verify = capture(ledger, "verify", "ledger");
    this._append = capture(ledger, "appendDomainEvent", "ledger");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (typeof now !== "function" || utilTypes.isProxy(now)) {
      throw new TypeError("attestor trust clock must be a non-proxy function");
    }
    this._resolve = ledgerArtifactResolver;
    this._now = now;
    Object.freeze(this);
  }

  _events() {
    const events = this._read();
    if (!Array.isArray(events)) corrupt("EvolutionLedger returned no events");
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === this.descriptor.streamId &&
        EVENT_TYPES.has(event.type),
    );
  }

  async _resolveEvent(event) {
    const authority = this._verify();
    const resolution = await this._resolve({
      epoch: authority.epoch,
      ledgerId: authority.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.ref !== event.subjectRef.ref ||
      resolution?.digest !== event.subjectRef.digest
    ) {
      corrupt("attestor trust ledger resolved a substituted artifact");
    }
    const record = parseArtifact(resolution, this.descriptor);
    if (
      event.type !== eventType(record.operation) ||
      event.eventId !== eventId(record) ||
      event.timestamp !== record.effectiveAt ||
      event.decision !== "committed" ||
      !Number.isSafeInteger(event.sequence) ||
      event.sequence < 1
    ) {
      corrupt("attestor trust event binding is invalid");
    }
    return { event, record };
  }

  async _entry(targetEventId) {
    const matches = this._events().filter(
      (event) => event.eventId === targetEventId,
    );
    if (matches.length > 1) corrupt("attestor trust event is ambiguous");
    return matches.length === 0 ? null : this._resolveEvent(matches[0]);
  }

  async _states() {
    const states = new Map();
    for (const event of this._events()) {
      const entry = await this._resolveEvent(event);
      const { record } = entry;
      const state = states.get(record.serviceId) ?? {
        active: null,
        retired: new Map(),
        revoked: new Set(),
        seen: new Set(),
      };
      if (record.operation === "register") {
        if (state.active || state.seen.size > 0) {
          corrupt("attestor service has duplicate registration");
        }
        state.active = {
          keyId: record.keyId,
          publicKeySpki: record.publicKeySpki,
          registeredSequence: event.sequence,
        };
        state.seen.add(record.keyId);
      } else if (record.operation === "rotate") {
        if (
          !state.active ||
          state.active.keyId !== record.priorKeyId ||
          state.active.publicKeySpki !== record.priorPublicKeySpki ||
          state.seen.has(record.keyId)
        ) {
          corrupt("attestor rotation does not follow the active key");
        }
        state.retired.set(state.active.keyId, {
          ...state.active,
          retiredSequence: event.sequence,
        });
        state.active = {
          keyId: record.keyId,
          publicKeySpki: record.publicKeySpki,
          registeredSequence: event.sequence,
        };
        state.seen.add(record.keyId);
      } else {
        const activeMatch = state.active?.keyId === record.keyId;
        const retired = state.retired.get(record.keyId);
        const stored = activeMatch ? state.active : retired;
        if (!stored || stored.publicKeySpki !== record.publicKeySpki) {
          corrupt("attestor revocation has no matching trusted key");
        }
        if (activeMatch) state.active = null;
        else state.retired.delete(record.keyId);
        state.revoked.add(record.keyId);
      }
      states.set(record.serviceId, state);
    }
    return states;
  }

  async _stateSnapshot() {
    const before = this._verify();
    const states = await this._states();
    const after = this._verify();
    if (
      before.ledgerId !== after.ledgerId ||
      before.epoch !== after.epoch ||
      before.sequence !== after.sequence ||
      before.headDigest !== after.headDigest
    ) {
      const error = new Error("attestor trust ledger changed during read");
      error.code = "CC_LEARNING_SYNTHESIS_ATTESTOR_TRUST_CONFLICT";
      throw error;
    }
    return { authority: after, states };
  }

  async _appendRecord(record, expectedHead) {
    const id = eventId(record);
    const existing = await this._entry(id);
    if (existing) {
      if (!sameLifecycleIntent(existing.record, record)) {
        corrupt("attestor trust event identity resolved different content");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
      });
    }
    const head = this._verify();
    if (
      !expectedHead ||
      head.ledgerId !== expectedHead.ledgerId ||
      head.epoch !== expectedHead.epoch ||
      head.sequence !== expectedHead.sequence ||
      head.headDigest !== expectedHead.headDigest
    ) {
      const error = new Error("attestor trust ledger changed before commit");
      error.code = "CC_LEARNING_SYNTHESIS_ATTESTOR_TRUST_CONFLICT";
      throw error;
    }
    const published = this._put(ARTIFACT_TYPE, record, {
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
    ) {
      corrupt("attestor trust artifact was not durably read back");
    }
    let receipt;
    try {
      receipt = this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "committed",
          eventId: id,
          reason: `governed synthesis attestor key ${record.operation}`,
          skillName: null,
          sourceRefs: [],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: record.effectiveAt,
          type: eventType(record.operation),
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
    } catch (error) {
      const recovered = await this._entry(id);
      if (!recovered || !sameLifecycleIntent(recovered.record, record)) {
        throw error;
      }
      receipt = { authenticated: true, durable: true, recovered: true };
    }
    if (receipt?.authenticated !== true || receipt.durable !== true) {
      corrupt("attestor trust ledger append was not durably confirmed");
    }
    const stored = await this._entry(id);
    if (!stored || canonical(stored.record) !== canonical(record)) {
      corrupt("attestor trust ledger readback differs after commit");
    }
    return Object.freeze({
      authenticated: true,
      durable: true,
      recovered: receipt.recovered === true,
    });
  }

  _timestamp() {
    const milliseconds = Number(this._now());
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError("attestor trust clock is invalid");
    }
    return new Date(milliseconds).toISOString();
  }

  async registerKey({ serviceId: inputServiceId, publicKey } = {}) {
    const normalizedServiceId = serviceId(inputServiceId);
    const encoded = encodePublicKey(publicKey);
    const existing = await this._entry(
      eventId({
        operation: "register",
        serviceId: normalizedServiceId,
        keyId: encoded.keyId,
      }),
    );
    if (existing) {
      if (
        existing.record.operation !== "register" ||
        existing.record.serviceId !== normalizedServiceId ||
        existing.record.publicKeySpki !== encoded.publicKeySpki
      ) {
        corrupt("attestor registration event identity was reused");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        serviceId: normalizedServiceId,
        keyId: encoded.keyId,
        operation: "register",
        recordDigest: existing.record.recordDigest,
      });
    }
    const snapshot = await this._stateSnapshot();
    const states = snapshot.states;
    if (states.has(normalizedServiceId)) {
      throw new Error("attestor service is already registered");
    }
    return this._commitLifecycle(
      {
        operation: "register",
        serviceId: normalizedServiceId,
        ...encoded,
        priorKeyId: null,
        priorPublicKeySpki: null,
        reason: null,
      },
      snapshot.authority,
    );
  }

  async rotateKey({
    serviceId: inputServiceId,
    priorKeyId,
    publicKey,
    reason: inputReason,
  } = {}) {
    const normalizedServiceId = serviceId(inputServiceId);
    const normalizedPriorKeyId = identifier(priorKeyId, "priorKeyId");
    const encoded = encodePublicKey(publicKey);
    const normalizedReason = reason(inputReason);
    const existing = await this._entry(
      eventId({
        operation: "rotate",
        serviceId: normalizedServiceId,
        keyId: encoded.keyId,
      }),
    );
    if (existing) {
      if (
        existing.record.operation !== "rotate" ||
        existing.record.serviceId !== normalizedServiceId ||
        existing.record.priorKeyId !== normalizedPriorKeyId ||
        existing.record.publicKeySpki !== encoded.publicKeySpki ||
        existing.record.reason !== normalizedReason
      ) {
        corrupt("attestor rotation event identity was reused");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        serviceId: normalizedServiceId,
        keyId: encoded.keyId,
        operation: "rotate",
        recordDigest: existing.record.recordDigest,
      });
    }
    const snapshot = await this._stateSnapshot();
    const state = snapshot.states.get(normalizedServiceId);
    if (!state?.active || state.active.keyId !== normalizedPriorKeyId) {
      throw new Error("attestor prior key is not currently active");
    }
    if (state.seen.has(encoded.keyId)) {
      throw new Error("attestor keyId cannot be reused");
    }
    return this._commitLifecycle(
      {
        operation: "rotate",
        serviceId: normalizedServiceId,
        ...encoded,
        priorKeyId: state.active.keyId,
        priorPublicKeySpki: state.active.publicKeySpki,
        reason: normalizedReason,
      },
      snapshot.authority,
    );
  }

  async revokeKey({
    serviceId: inputServiceId,
    keyId,
    reason: inputReason,
  } = {}) {
    const normalizedServiceId = serviceId(inputServiceId);
    const normalizedKeyId = identifier(keyId, "keyId");
    const normalizedReason = reason(inputReason);
    const existing = await this._entry(
      eventId({
        operation: "revoke",
        serviceId: normalizedServiceId,
        keyId: normalizedKeyId,
      }),
    );
    if (existing) {
      if (
        existing.record.operation !== "revoke" ||
        existing.record.serviceId !== normalizedServiceId ||
        existing.record.reason !== normalizedReason
      ) {
        corrupt("attestor revocation event identity was reused");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        serviceId: normalizedServiceId,
        keyId: normalizedKeyId,
        operation: "revoke",
        recordDigest: existing.record.recordDigest,
      });
    }
    const snapshot = await this._stateSnapshot();
    const state = snapshot.states.get(normalizedServiceId);
    const trusted =
      state?.active?.keyId === normalizedKeyId
        ? state.active
        : state?.retired.get(normalizedKeyId);
    if (!trusted) throw new Error("attestor key is not currently trusted");
    return this._commitLifecycle(
      {
        operation: "revoke",
        serviceId: normalizedServiceId,
        keyId: normalizedKeyId,
        publicKeySpki: trusted.publicKeySpki,
        priorKeyId: null,
        priorPublicKeySpki: null,
        reason: normalizedReason,
      },
      snapshot.authority,
    );
  }

  async _commitLifecycle(input, expectedHead) {
    const core = {
      schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_RECORD_SCHEMA,
      tenantId: this.descriptor.tenantId,
      ...input,
      effectiveAt: this._timestamp(),
    };
    const record = freeze({
      ...core,
      recordDigest: digestGovernedSkillSynthesisAttestorTrustRecord(core),
    });
    validateRecord(record, this.descriptor);
    const result = await this._appendRecord(record, expectedHead);
    return Object.freeze({
      ...result,
      serviceId: record.serviceId,
      keyId: record.keyId,
      operation: record.operation,
      recordDigest: record.recordDigest,
    });
  }

  createVerifier({ serviceId: inputServiceId } = {}) {
    const normalizedServiceId = serviceId(inputServiceId);
    const authority = this._verify();
    const descriptor = Object.freeze({
      schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_VERIFIER_SCHEMA,
      tenantId: this.descriptor.tenantId,
      serviceId: normalizedServiceId,
      ledgerId: authority.ledgerId,
      epoch: authority.epoch,
      isolation: "durable-ledger-key-lifecycle",
    });
    const verifyAttestation = async (value) => {
      const input = verificationInput(value);
      if (!input) return false;
      const identity = getGovernedSkillSynthesisExternalAttestationIdentity(
        input.attestation,
      );
      if (!identity || identity.serviceId !== normalizedServiceId) return false;
      const snapshot = await this._stateSnapshot();
      const currentAuthority = snapshot.authority;
      if (
        currentAuthority.ledgerId !== descriptor.ledgerId ||
        currentAuthority.epoch !== descriptor.epoch
      ) {
        return false;
      }
      let sequence = null;
      if (input.ledgerContext !== undefined) {
        try {
          exact(
            input.ledgerContext,
            new Set(["epoch", "ledgerId", "sequence"]),
            "attestor verification ledger context",
          );
        } catch {
          return false;
        }
        if (
          input.ledgerContext.ledgerId !== descriptor.ledgerId ||
          input.ledgerContext.epoch !== descriptor.epoch ||
          !Number.isSafeInteger(input.ledgerContext.sequence) ||
          input.ledgerContext.sequence < 1 ||
          input.ledgerContext.sequence > currentAuthority.sequence + 1
        ) {
          return false;
        }
        sequence = input.ledgerContext.sequence;
      }
      const state = snapshot.states.get(normalizedServiceId);
      if (!state || state.revoked.has(identity.keyId)) return false;
      let trusted = null;
      if (state.active?.keyId === identity.keyId) {
        if (sequence === null || sequence >= state.active.registeredSequence) {
          trusted = state.active;
        }
      } else {
        const retired = state.retired.get(identity.keyId);
        if (
          sequence !== null &&
          retired &&
          sequence >= retired.registeredSequence &&
          sequence < retired.retiredSequence
        ) {
          trusted = retired;
        }
      }
      if (!trusted) return false;
      return verifyGovernedSkillSynthesisExternalAttestation(
        {
          receiptDigest: input.receiptDigest,
          candidateDigest: input.candidateDigest,
          descriptor: input.descriptor,
          attestation: input.attestation,
        },
        {
          publicKey: decodePublicKey(trusted.publicKeySpki, trusted.keyId),
        },
      );
    };
    Object.freeze(verifyAttestation);
    const verifier = Object.freeze({ descriptor, verifyAttestation });
    VERIFIERS.add(verifier);
    return verifier;
  }
}

export function createGovernedSkillSynthesisAttestorTrustLedger(options) {
  return new GovernedSkillSynthesisAttestorTrustLedger(options);
}

export function createGovernedSkillSynthesisAttestorTrustVerifier(
  options = {},
) {
  exact(
    options,
    new Set([
      "artifactPorts",
      "descriptor",
      "ledger",
      "ledgerArtifactResolver",
      "serviceId",
    ]),
    "attestor trust verifier options",
  );
  const data = Object.getOwnPropertyDescriptors(options);
  return new GovernedSkillSynthesisAttestorTrustLedger({
    descriptor: data.descriptor.value,
    artifactPorts: data.artifactPorts.value,
    ledger: data.ledger.value,
    ledgerArtifactResolver: data.ledgerArtifactResolver.value,
  }).createVerifier({ serviceId: data.serviceId.value });
}

export function isGovernedSkillSynthesisAttestorTrustVerifier(value) {
  return VERIFIERS.has(value);
}
