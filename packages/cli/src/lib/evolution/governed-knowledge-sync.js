import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export const GOVERNED_KNOWLEDGE_SYNC_SCHEMA =
  "chainlesschain.governed-evolution-knowledge-sync/v1";
export const GOVERNED_KNOWLEDGE_ENVELOPE_SCHEMA =
  "chainlesschain.governed-evolution-knowledge-envelope/v1";
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

function normalizeRecord(input, descriptor) {
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
  return freeze({
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
}

export class GovernedKnowledgeSync {
  constructor({ tenantId, deviceId, ports } = {}) {
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
  }

  async publish(input) {
    const knowledge = normalizeRecord(input, this);
    if (knowledge.scope === "personal")
      throw new Error("personal knowledge cannot enter a shared sync channel");
    await this._admit("publish", knowledge);
    const plaintext = Buffer.from(canonical(knowledge), "utf8");
    const encrypted = await this._encrypt({ knowledge, plaintext });
    if (
      !Buffer.isBuffer(encrypted?.ciphertext) ||
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
    await this._persist(knowledge, envelope, "local");
    const sent = await this._send({ envelope });
    if (sent?.durable !== true || sent.envelopeDigest !== envelopeDigest)
      throw new Error("sync transport did not durably accept the envelope");
    return envelope;
  }

  async receive(envelope) {
    record(envelope, "knowledge envelope");
    const core = { ...envelope };
    delete core.envelopeDigest;
    delete core.signature;
    if (
      envelope.schema !== GOVERNED_KNOWLEDGE_ENVELOPE_SCHEMA ||
      envelope.tenantId !== this.tenantId ||
      envelope.senderDeviceId === this.deviceId ||
      envelope.ciphertextDigest !==
        hashBytes(Buffer.from(envelope.ciphertext || "", "base64")) ||
      envelope.envelopeDigest !==
        hash(GOVERNED_KNOWLEDGE_ENVELOPE_SCHEMA, core) ||
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
    const knowledge = normalizeRecord(parsed, this);
    if (
      knowledge.knowledgeId !== envelope.knowledgeId ||
      knowledge.contentDigest !== envelope.contentDigest ||
      !["team", "org", "project"].includes(knowledge.scope)
    )
      throw new Error("knowledge envelope substituted its governed record");
    await this._admit("receive", knowledge);
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
        await this._persist(
          { ...knowledge, conflictWithDigest: current.contentDigest },
          envelope,
          "conflict",
        );
        return freeze({
          applied: false,
          reason: "conflict",
          requiresHumanMerge: true,
        });
      }
    }
    await this._persist(knowledge, envelope, "remote");
    return freeze({ applied: true, action: knowledge.action });
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
  }

  async _persist(knowledge, envelope, disposition) {
    const result = await this._commit({
      knowledge,
      envelopeDigest: envelope.envelopeDigest,
      disposition,
    });
    if (
      result?.authenticated !== true ||
      result.durable !== true ||
      result.envelopeDigest !== envelope.envelopeDigest ||
      result.knowledgeId !== knowledge.knowledgeId
    )
      throw new Error("knowledge synchronization was not durably committed");
  }
}
