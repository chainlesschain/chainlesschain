import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import { isGovernedKnowledgeDependencyExecutor } from "./governed-knowledge-dependency-ledger-executor.js";
import { isGovernedKnowledgeArtifactLifecycle } from "./governed-knowledge-artifact-lifecycle.js";

export const GOVERNED_KNOWLEDGE_SYNC_SCHEMA =
  "chainlesschain.governed-evolution-knowledge-sync/v1";
export const GOVERNED_KNOWLEDGE_ENVELOPE_SCHEMA =
  "chainlesschain.governed-evolution-knowledge-envelope/v1";
export const GOVERNED_KNOWLEDGE_ARTIFACT_BINDING_SCHEMA =
  "chainlesschain.governed-knowledge-artifact-binding/v2";
export const GOVERNED_KNOWLEDGE_ARTIFACT_BINDING_LEGACY_SCHEMA =
  "chainlesschain.governed-knowledge-artifact-binding/v1";
export const GOVERNED_KNOWLEDGE_SCOPE = Object.freeze({
  PERSONAL: "personal",
  PROJECT: "project",
  TEAM: "team",
  ORG: "org",
});

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const SCOPES = new Set(Object.values(GOVERNED_KNOWLEDGE_SCOPE));
const ACTIONS = new Set(["upsert", "tombstone", "revoke"]);
const MAX_CIPHERTEXT_BYTES = 12 * 1024 * 1024;
const EXECUTION_RECORDS = new WeakSet();
const SYNCHRONIZERS = new WeakSet();
const ENVELOPE_KEYS = new Set([
  "action",
  "ciphertext",
  "ciphertextDigest",
  "contentDigest",
  "envelopeDigest",
  "keyRef",
  "knowledgeId",
  "schema",
  "scope",
  "scopeId",
  "senderDeviceId",
  "signature",
  "tenantId",
  "vectorClock",
]);
const ARTIFACT_BINDING_KEYS = new Set([
  "activate",
  "authorizationReceiptDigest",
  "baseline",
  "evidenceDigest",
  "humanReviewed",
  "issuedAt",
  "operationId",
  "operation",
  "schema",
]);
const LEGACY_ARTIFACT_BINDING_KEYS = new Set(
  [...ARTIFACT_BINDING_KEYS].filter((key) => key !== "activate"),
);

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

function hashBytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function record(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError(`${label} must be a plain object`);
  return value;
}

function id(value, label) {
  if (typeof value !== "string" || !ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be sha256-bound`);
  return value;
}

function capture(owner, method) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function"
  )
    throw new TypeError(`${method} authority is required`);
  return (...args) => Reflect.apply(owner[method], owner, args);
}

function vectorClock(value) {
  record(value, "vectorClock");
  const entries = Object.entries(value);
  if (entries.length < 1 || entries.length > 64)
    throw new TypeError("vectorClock is empty or unbounded");
  const result = {};
  for (const [deviceId, revision] of entries.sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    id(deviceId, "vectorClock device");
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new TypeError("vectorClock revision is invalid");
    result[deviceId] = revision;
  }
  return result;
}

function relation(left, right) {
  const devices = new Set([...Object.keys(left), ...Object.keys(right)]);
  let before = false;
  let after = false;
  for (const device of devices) {
    const a = left[device] || 0;
    const b = right[device] || 0;
    before ||= a < b;
    after ||= a > b;
  }
  if (before && after) return "concurrent";
  if (before) return "before";
  if (after) return "after";
  return "equal";
}

function normalizeDependencies(value, action) {
  if (!Array.isArray(value) || value.length > 256)
    throw new TypeError("dependency dispositions are unbounded");
  const seen = new Set();
  return value.map((entry) => {
    record(entry, "dependency disposition");
    const normalized = {
      kind: id(entry.kind, "dependency kind"),
      digest: digest(entry.digest, "dependency digest"),
      disposition: id(entry.disposition, "dependency disposition"),
    };
    const key = `${normalized.kind}:${normalized.digest}`;
    if (seen.has(key)) throw new TypeError("duplicate dependency disposition");
    seen.add(key);
    if (
      ["tombstone", "revoke"].includes(action) &&
      ![
        "tombstone",
        "quarantine",
        "reject-candidate",
        "rollback-active",
      ].includes(normalized.disposition)
    )
      throw new TypeError("revocation dependency disposition is unsafe");
    return normalized;
  });
}

function normalizeRecord(input, descriptor, { executionRecord = false } = {}) {
  record(input, "knowledge record");
  const action = ACTIONS.has(input.action) ? input.action : null;
  const scope = SCOPES.has(input.scope) ? input.scope : null;
  if (!action || !scope || input.tenantId !== descriptor.tenantId)
    throw new TypeError("knowledge record boundary is invalid");
  const dependencies = normalizeDependencies(input.dependencies || [], action);
  if (
    ["team", "org"].includes(scope) &&
    !DIGEST.test(input.approvalReceiptDigest || "")
  )
    throw new TypeError("shared knowledge requires approval");
  if (
    ["tombstone", "revoke"].includes(action) &&
    (!DIGEST.test(input.revocationReceiptDigest || "") ||
      dependencies.length < 1)
  )
    throw new TypeError(
      "revocation must bind its receipt and dependency graph",
    );
  const normalized = freeze({
    schema: GOVERNED_KNOWLEDGE_SYNC_SCHEMA,
    tenantId: descriptor.tenantId,
    knowledgeId: id(input.knowledgeId, "knowledgeId"),
    scope,
    scopeId: id(input.scopeId, "scopeId"),
    action,
    contentDigest: digest(input.contentDigest, "contentDigest"),
    vectorClock: vectorClock(input.vectorClock),
    approvalReceiptDigest: input.approvalReceiptDigest || null,
    revocationReceiptDigest: input.revocationReceiptDigest || null,
    dependencies,
  });
  if (executionRecord) EXECUTION_RECORDS.add(normalized);
  return normalized;
}

export function verifyGovernedKnowledgeRecord(input, { tenantId } = {}) {
  return normalizeRecord(input, { tenantId: id(tenantId, "tenantId") });
}

export function verifyGovernedKnowledgeArtifactBinding(
  input,
  { tenantId, knowledge, authorizationReceiptDigest } = {},
) {
  record(input, "knowledge artifact binding");
  const expectedTenantId = id(tenantId, "tenantId");
  const normalizedKnowledge = verifyGovernedKnowledgeRecord(knowledge, {
    tenantId: expectedTenantId,
  });
  const keys = Reflect.ownKeys(input);
  const current = input.schema === GOVERNED_KNOWLEDGE_ARTIFACT_BINDING_SCHEMA;
  const legacy =
    input.schema === GOVERNED_KNOWLEDGE_ARTIFACT_BINDING_LEGACY_SCHEMA;
  const expectedKeys = current
    ? ARTIFACT_BINDING_KEYS
    : LEGACY_ARTIFACT_BINDING_KEYS;
  const baseline =
    input.baseline === null
      ? null
      : verifyGovernedKnowledgeRecord(input.baseline, {
          tenantId: expectedTenantId,
        });
  if (
    (!current && !legacy) ||
    keys.length !== expectedKeys.size ||
    keys.some((key) => typeof key !== "string" || !expectedKeys.has(key)) ||
    !ID.test(input.operationId ?? "") ||
    !(
      current ? ["publish", "merge", "receive"] : ["publish", "merge"]
    ).includes(input.operation) ||
    (current && typeof input.activate !== "boolean") ||
    !Number.isFinite(Date.parse(input.issuedAt)) ||
    input.authorizationReceiptDigest !== authorizationReceiptDigest ||
    !DIGEST.test(input.authorizationReceiptDigest ?? "") ||
    !DIGEST.test(input.evidenceDigest ?? "") ||
    typeof input.humanReviewed !== "boolean" ||
    (baseline !== null &&
      (baseline.knowledgeId !== normalizedKnowledge.knowledgeId ||
        baseline.scope !== normalizedKnowledge.scope ||
        baseline.scopeId !== normalizedKnowledge.scopeId)) ||
    canonical(baseline) !== canonical(input.baseline)
  ) {
    throw new Error("knowledge artifact binding is invalid");
  }
  return freeze(clone(input));
}

export function isGovernedKnowledgeExecutionRecord(value) {
  return EXECUTION_RECORDS.has(value);
}

export function verifyGovernedKnowledgeEnvelopeIntegrity(
  envelope,
  { tenantId } = {},
) {
  record(envelope, "knowledge envelope");
  const expectedTenantId = id(tenantId, "tenantId");
  if (typeof envelope.ciphertext !== "string") {
    throw new Error("knowledge envelope ciphertext is invalid");
  }
  const ciphertext = Buffer.from(envelope.ciphertext, "base64");
  const keys = Reflect.ownKeys(envelope);
  const core = { ...envelope };
  delete core.envelopeDigest;
  delete core.signature;
  if (
    envelope.schema !== GOVERNED_KNOWLEDGE_ENVELOPE_SCHEMA ||
    keys.length !== ENVELOPE_KEYS.size ||
    keys.some((key) => typeof key !== "string" || !ENVELOPE_KEYS.has(key)) ||
    envelope.tenantId !== expectedTenantId ||
    !ID.test(envelope.senderDeviceId || "") ||
    !ID.test(envelope.knowledgeId || "") ||
    !SCOPES.has(envelope.scope) ||
    !ID.test(envelope.scopeId || "") ||
    !ACTIONS.has(envelope.action) ||
    !DIGEST.test(envelope.contentDigest || "") ||
    canonical(vectorClock(envelope.vectorClock)) !==
      canonical(envelope.vectorClock) ||
    ciphertext.length < 1 ||
    ciphertext.length > MAX_CIPHERTEXT_BYTES ||
    ciphertext.toString("base64") !== envelope.ciphertext ||
    envelope.ciphertextDigest !== hashBytes(ciphertext) ||
    !ID.test(envelope.keyRef || "") ||
    envelope.envelopeDigest !== hash(GOVERNED_KNOWLEDGE_ENVELOPE_SCHEMA, core)
  ) {
    throw new Error("knowledge envelope integrity is invalid");
  }
  return freeze({ core: freeze(clone(core)) });
}

export class GovernedKnowledgeSync {
  constructor({
    tenantId,
    deviceId,
    ports,
    dependencyExecutor = null,
    artifactLifecycle,
    clock = () => Date.now(),
  } = {}) {
    this.tenantId = id(tenantId, "tenantId");
    this.deviceId = id(deviceId, "deviceId");
    this._authorize = capture(ports, "authorize");
    this._encrypt = capture(ports, "encrypt");
    this._decrypt = capture(ports, "decrypt");
    this._sign = capture(ports, "sign");
    this._verify = capture(ports, "verify");
    this._load = capture(ports, "load");
    this._commit = capture(ports, "commit");
    this._send = capture(ports, "send");
    this._loadPublication =
      ports?.loadPublication === undefined
        ? null
        : capture(ports, "loadPublication");
    this._loadReception = capture(ports, "loadReception");
    if (!isGovernedKnowledgeArtifactLifecycle(artifactLifecycle)) {
      throw new TypeError(
        "a branded governed Knowledge artifact lifecycle is required",
      );
    }
    this._prepareArtifact = capture(artifactLifecycle, "prepare");
    this._commitArtifact = capture(artifactLifecycle, "commit");
    if (typeof clock !== "function") throw new TypeError("clock is required");
    this._clock = clock;
    if (
      dependencyExecutor !== null &&
      !isGovernedKnowledgeDependencyExecutor(dependencyExecutor)
    ) {
      throw new TypeError(
        "dependencyExecutor must be a branded governed dependency executor",
      );
    }
    this._executeDependencies = dependencyExecutor
      ? capture(dependencyExecutor, "execute")
      : null;
    SYNCHRONIZERS.add(this);
  }

  async publish(input, options = {}) {
    const result = await this.publishWithArtifactEvidence(input, options);
    return result.envelope;
  }

  async publishWithArtifactEvidence(
    input,
    {
      operationId = null,
      artifactOperation = "publish",
      artifactEvidenceDigest = null,
      artifactHumanReviewed = false,
    } = {},
  ) {
    const knowledge = normalizeRecord(input, this, { executionRecord: true });
    if (knowledge.scope === "personal")
      throw new Error("personal knowledge cannot enter a shared sync channel");
    if (operationId !== null) {
      id(operationId, "publish operationId");
      if (!this._loadPublication) {
        throw new Error("durable publication recovery is unavailable");
      }
      const existing = await this._loadPublication({ operationId });
      if (existing) {
        const comparable = { ...existing.knowledge };
        delete comparable.conflictWithDigest;
        if (
          existing.operationId !== operationId ||
          existing.disposition !== "local" ||
          canonical(comparable) !== canonical(knowledge) ||
          existing.envelope?.envelopeDigest !== existing.envelopeDigest
        ) {
          throw new Error("publish operationId resolved different knowledge");
        }
        verifyGovernedKnowledgeEnvelopeIntegrity(existing.envelope, this);
        const binding = verifyGovernedKnowledgeArtifactBinding(
          existing.artifactBinding,
          {
            tenantId: this.tenantId,
            knowledge,
            authorizationReceiptDigest: existing.authorizationReceiptDigest,
          },
        );
        if (
          artifactOperation !== binding.operation ||
          (artifactEvidenceDigest !== null &&
            artifactEvidenceDigest !== binding.evidenceDigest) ||
          artifactHumanReviewed !== binding.humanReviewed
        ) {
          throw new Error("publish artifact recovery binding differs");
        }
        const prepared = await this._prepareArtifact({
          knowledge,
          currentKnowledge: binding.baseline,
          operation: binding.operation,
          operationId: binding.operationId,
          authorizationReceiptDigest: binding.authorizationReceiptDigest,
          evidenceDigest: binding.evidenceDigest,
          issuedAt: binding.issuedAt,
          humanReviewed: binding.humanReviewed,
        });
        const sent = await this._send({ envelope: existing.envelope });
        if (
          sent?.durable !== true ||
          sent.envelopeDigest !== existing.envelopeDigest
        ) {
          throw new Error("sync transport did not durably accept the envelope");
        }
        const artifact = await this._commitArtifact(prepared);
        return freeze({
          envelope: clone(existing.envelope),
          artifact: clone(artifact),
          recovered: true,
        });
      }
    }
    const admission = await this._admit("publish", knowledge);
    const current = await this._load({ knowledgeId: knowledge.knowledgeId });
    const effectiveOperationId =
      operationId ??
      `knowledge-publish:${hash(
        "chainlesschain.governed-knowledge-publish-operation/v1",
        { tenantId: this.tenantId, deviceId: this.deviceId, knowledge },
      ).slice(7)}`;
    const milliseconds = Number(this._clock());
    if (!Number.isFinite(milliseconds))
      throw new TypeError("knowledge sync clock is invalid");
    const binding = freeze({
      schema: GOVERNED_KNOWLEDGE_ARTIFACT_BINDING_SCHEMA,
      activate: true,
      operationId: effectiveOperationId,
      operation: artifactOperation,
      issuedAt: new Date(milliseconds).toISOString(),
      authorizationReceiptDigest: admission.receiptDigest,
      evidenceDigest: artifactEvidenceDigest ?? admission.receiptDigest,
      humanReviewed: artifactHumanReviewed,
      baseline: current === null ? null : clone(current),
    });
    verifyGovernedKnowledgeArtifactBinding(binding, {
      tenantId: this.tenantId,
      knowledge,
      authorizationReceiptDigest: admission.receiptDigest,
    });
    const prepared = await this._prepareArtifact({
      knowledge,
      currentKnowledge: binding.baseline,
      operation: binding.operation,
      operationId: binding.operationId,
      authorizationReceiptDigest: binding.authorizationReceiptDigest,
      evidenceDigest: binding.evidenceDigest,
      issuedAt: binding.issuedAt,
      humanReviewed: binding.humanReviewed,
    });
    await this._applyRevocationDependencies(knowledge);
    const plaintext = Buffer.from(canonical(knowledge), "utf8");
    const encrypted = await this._encrypt({ knowledge, plaintext });
    if (
      !Buffer.isBuffer(encrypted?.ciphertext) ||
      encrypted.ciphertext.length < 1 ||
      encrypted.ciphertext.length > MAX_CIPHERTEXT_BYTES ||
      encrypted.ciphertext.includes(plaintext) ||
      encrypted.ciphertextDigest !== hashBytes(encrypted.ciphertext)
    )
      throw new Error("sync encryption authority returned unsafe ciphertext");
    const core = {
      schema: GOVERNED_KNOWLEDGE_ENVELOPE_SCHEMA,
      tenantId: this.tenantId,
      senderDeviceId: this.deviceId,
      knowledgeId: knowledge.knowledgeId,
      scope: knowledge.scope,
      scopeId: knowledge.scopeId,
      action: knowledge.action,
      contentDigest: knowledge.contentDigest,
      vectorClock: knowledge.vectorClock,
      ciphertext: encrypted.ciphertext.toString("base64"),
      ciphertextDigest: encrypted.ciphertextDigest,
      keyRef: id(encrypted.keyRef, "encryption keyRef"),
    };
    const envelopeDigest = hash(GOVERNED_KNOWLEDGE_ENVELOPE_SCHEMA, core);
    const signature = await this._sign({ core, envelopeDigest });
    const envelope = freeze({
      ...core,
      envelopeDigest,
      signature: clone(signature),
    });
    await this._persist(
      knowledge,
      envelope,
      "local",
      admission,
      operationId,
      binding,
    );
    const sent = await this._send({ envelope });
    if (sent?.durable !== true || sent.envelopeDigest !== envelopeDigest)
      throw new Error("sync transport did not durably accept the envelope");
    const artifact = await this._commitArtifact(prepared);
    return freeze({ envelope, artifact: clone(artifact), recovered: false });
  }

  async receive(envelope) {
    let core;
    try {
      ({ core } = verifyGovernedKnowledgeEnvelopeIntegrity(envelope, this));
    } catch {
      throw new Error("knowledge envelope is unauthenticated or cross-tenant");
    }
    if (
      envelope.senderDeviceId === this.deviceId ||
      (await this._verify({
        core,
        envelopeDigest: envelope.envelopeDigest,
        signature: envelope.signature,
      })) !== true
    )
      throw new Error("knowledge envelope is unauthenticated or cross-tenant");
    const decrypted = await this._decrypt({ envelope });
    if (!Buffer.isBuffer(decrypted?.plaintext))
      throw new Error("knowledge envelope decryption failed");
    let parsed;
    try {
      parsed = JSON.parse(decrypted.plaintext.toString("utf8"));
    } catch {
      throw new Error("knowledge envelope plaintext is not canonical JSON");
    }
    if (canonical(parsed) !== decrypted.plaintext.toString("utf8"))
      throw new Error("knowledge envelope plaintext is not canonical JSON");
    const knowledge = normalizeRecord(parsed, this, { executionRecord: true });
    if (
      knowledge.knowledgeId !== envelope.knowledgeId ||
      knowledge.contentDigest !== envelope.contentDigest ||
      knowledge.scope !== envelope.scope ||
      knowledge.scopeId !== envelope.scopeId ||
      knowledge.action !== envelope.action ||
      canonical(knowledge.vectorClock) !== canonical(envelope.vectorClock) ||
      !["team", "org", "project"].includes(knowledge.scope)
    )
      throw new Error("knowledge envelope substituted its governed record");
    const admission = await this._admit("receive", knowledge);
    const existing = await this._loadReception({
      envelopeDigest: envelope.envelopeDigest,
    });
    if (existing) {
      const comparable = { ...existing.knowledge };
      delete comparable.conflictWithDigest;
      if (
        !["remote", "conflict"].includes(existing.disposition) ||
        existing.envelopeDigest !== envelope.envelopeDigest ||
        canonical(comparable) !== canonical(knowledge)
      ) {
        throw new Error("receive envelope resolved different knowledge");
      }
      const binding = verifyGovernedKnowledgeArtifactBinding(
        existing.artifactBinding,
        {
          tenantId: this.tenantId,
          knowledge,
          authorizationReceiptDigest: existing.authorizationReceiptDigest,
        },
      );
      if (
        binding.operation !== "receive" ||
        binding.activate !== (existing.disposition === "remote")
      ) {
        throw new Error("receive artifact recovery binding differs");
      }
      const prepared = await this._prepareArtifact({
        knowledge,
        currentKnowledge: binding.baseline,
        operation: binding.operation,
        operationId: binding.operationId,
        authorizationReceiptDigest: binding.authorizationReceiptDigest,
        evidenceDigest: binding.evidenceDigest,
        issuedAt: binding.issuedAt,
        activate: binding.activate,
        humanReviewed: binding.humanReviewed,
      });
      const artifact = await this._commitArtifact(prepared);
      return existing.disposition === "conflict"
        ? freeze({
            applied: false,
            reason: "conflict",
            requiresHumanMerge: true,
            recovered: true,
            artifact: clone(artifact),
          })
        : freeze({
            applied: true,
            action: knowledge.action,
            recovered: true,
            artifact: clone(artifact),
          });
    }
    const current = await this._load({ knowledgeId: knowledge.knowledgeId });
    if (current) {
      const order = relation(current.vectorClock, knowledge.vectorClock);
      if (order === "after") return freeze({ applied: false, reason: "stale" });
      if (order === "equal") {
        if (current.contentDigest !== knowledge.contentDigest)
          throw new Error("equal vector clock binds conflicting knowledge");
        return freeze({ applied: false, reason: "replay" });
      }
      if (order === "concurrent") {
        const binding = this._receiveArtifactBinding({
          knowledge,
          current,
          admission,
          envelope,
          activate: false,
        });
        const prepared = await this._prepareArtifact({
          knowledge,
          currentKnowledge: binding.baseline,
          operation: binding.operation,
          operationId: binding.operationId,
          authorizationReceiptDigest: binding.authorizationReceiptDigest,
          evidenceDigest: binding.evidenceDigest,
          issuedAt: binding.issuedAt,
          activate: binding.activate,
          humanReviewed: binding.humanReviewed,
        });
        await this._persist(
          { ...knowledge, conflictWithDigest: current.contentDigest },
          envelope,
          "conflict",
          admission,
          null,
          binding,
        );
        const artifact = await this._commitArtifact(prepared);
        return freeze({
          applied: false,
          reason: "conflict",
          requiresHumanMerge: true,
          recovered: false,
          artifact: clone(artifact),
        });
      }
    }
    const binding = this._receiveArtifactBinding({
      knowledge,
      current,
      admission,
      envelope,
      activate: true,
    });
    const prepared = await this._prepareArtifact({
      knowledge,
      currentKnowledge: binding.baseline,
      operation: binding.operation,
      operationId: binding.operationId,
      authorizationReceiptDigest: binding.authorizationReceiptDigest,
      evidenceDigest: binding.evidenceDigest,
      issuedAt: binding.issuedAt,
      activate: binding.activate,
      humanReviewed: binding.humanReviewed,
    });
    await this._applyRevocationDependencies(knowledge);
    await this._persist(
      knowledge,
      envelope,
      "remote",
      admission,
      null,
      binding,
    );
    const artifact = await this._commitArtifact(prepared);
    return freeze({
      applied: true,
      action: knowledge.action,
      recovered: false,
      artifact: clone(artifact),
    });
  }

  _receiveArtifactBinding({
    knowledge,
    current,
    admission,
    envelope,
    activate,
  }) {
    const milliseconds = Number(this._clock());
    if (!Number.isFinite(milliseconds))
      throw new TypeError("knowledge sync clock is invalid");
    const binding = freeze({
      schema: GOVERNED_KNOWLEDGE_ARTIFACT_BINDING_SCHEMA,
      activate,
      operationId: `knowledge-receive:${envelope.envelopeDigest.slice(7)}`,
      operation: "receive",
      issuedAt: new Date(milliseconds).toISOString(),
      authorizationReceiptDigest: admission.receiptDigest,
      evidenceDigest: envelope.envelopeDigest,
      humanReviewed: false,
      baseline: current === null ? null : clone(current),
    });
    verifyGovernedKnowledgeArtifactBinding(binding, {
      tenantId: this.tenantId,
      knowledge,
      authorizationReceiptDigest: admission.receiptDigest,
    });
    return binding;
  }

  async _admit(operation, knowledge) {
    const result = await this._authorize({ operation, knowledge });
    if (
      result?.authenticated !== true ||
      result.allowed !== true ||
      result.tenantId !== this.tenantId ||
      result.knowledgeId !== knowledge.knowledgeId ||
      result.scope !== knowledge.scope ||
      result.scopeId !== knowledge.scopeId ||
      !DIGEST.test(result.receiptDigest || "")
    )
      throw new Error("knowledge synchronization is not authorized");
    return freeze(clone(result));
  }

  async _persist(
    knowledge,
    envelope,
    disposition,
    admission,
    operationId = null,
    artifactBinding = null,
  ) {
    const result = await this._commit({
      knowledge,
      envelope,
      envelopeDigest: envelope.envelopeDigest,
      disposition,
      authorizationReceiptDigest: admission.receiptDigest,
      operationId,
      artifactBinding,
    });
    if (
      result?.authenticated !== true ||
      result.durable !== true ||
      result.envelopeDigest !== envelope.envelopeDigest ||
      result.knowledgeId !== knowledge.knowledgeId
    )
      throw new Error("knowledge synchronization was not durably committed");
  }

  async _applyRevocationDependencies(knowledge) {
    if (!["tombstone", "revoke"].includes(knowledge.action)) return;
    if (!this._executeDependencies) {
      throw new Error("revocation dependency executor is unavailable");
    }
    const result = await this._executeDependencies(knowledge);
    if (
      result?.authenticated !== true ||
      result.durable !== true ||
      result.tenantId !== this.tenantId ||
      result.deviceId !== this.deviceId ||
      result.knowledgeId !== knowledge.knowledgeId ||
      result.revocationReceiptDigest !== knowledge.revocationReceiptDigest ||
      !DIGEST.test(result.operationDigest ?? "") ||
      !Array.isArray(result.resultDigests) ||
      result.resultDigests.length !== knowledge.dependencies.length ||
      result.resultDigests.some((value) => !DIGEST.test(value))
    ) {
      throw new Error("revocation dependencies were not durably applied");
    }
  }
}

export function isGovernedKnowledgeSync(value) {
  return SYNCHRONIZERS.has(value);
}
