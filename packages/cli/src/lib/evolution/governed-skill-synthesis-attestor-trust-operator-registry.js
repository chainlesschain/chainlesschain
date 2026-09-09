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

export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operator-registry/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_RECORD_SCHEMA =
  "chainlesschain.governed-skill-synthesis-attestor-trust-operator-registry-record/v1";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_GENESIS_EVENT =
  "learning.skill-synthesis-attestor-trust.operator-registry.genesis.committed";
export const GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CORRUPT_CODE =
  "CC_LEARNING_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CORRUPT";

const ARTIFACT_TYPE =
  "governed-skill-synthesis-attestor-trust-operator-registry";
const REGISTRIES = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const KEY_ID = /^key:ed25519:[a-f0-9]{64}$/u;
const MAX_OPERATORS = 16;
const RECORD_KEYS = new Set([
  "createdAt",
  "operatorCount",
  "operators",
  "policyDigest",
  "policyId",
  "recordDigest",
  "requiredApprovals",
  "revision",
  "schema",
  "tenantId",
]);
const OPERATOR_KEYS = new Set(["keyId", "operatorId", "publicKeySpki"]);

function corrupt(message) {
  const error = new Error(message);
  error.code =
    GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_CORRUPT_CODE;
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
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
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

function publicKeyIdentity(value, label) {
  let key;
  try {
    if (
      (utilTypes.isKeyObject(value) && value.type !== "public") ||
      (typeof value === "string" && /PRIVATE KEY/u.test(value)) ||
      (value &&
        typeof value === "object" &&
        !Buffer.isBuffer(value) &&
        Object.hasOwn(value, "d"))
    ) {
      throw new Error();
    }
    key = utilTypes.isKeyObject(value) ? value : createPublicKey(value);
  } catch {
    throw new TypeError(`${label} must be an Ed25519 public key`);
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new TypeError(`${label} must be an Ed25519 public key`);
  }
  const bytes = key.export({ type: "spki", format: "der" });
  return Object.freeze({
    keyId: `key:ed25519:${createHash("sha256").update(bytes).digest("hex")}`,
    publicKeySpki: bytes.toString("base64url"),
  });
}

function decodePublicKey(value) {
  if (
    !KEY_ID.test(value.keyId ?? "") ||
    typeof value.publicKeySpki !== "string"
  ) {
    corrupt("operator registry public key identity is invalid");
  }
  const bytes = Buffer.from(value.publicKeySpki, "base64url");
  if (bytes.toString("base64url") !== value.publicKeySpki) {
    corrupt("operator registry public key is not canonical");
  }
  const identity = publicKeyIdentity(
    { key: bytes, type: "spki", format: "der" },
    "stored operator public key",
  );
  if (
    identity.keyId !== value.keyId ||
    identity.publicKeySpki !== value.publicKeySpki
  ) {
    corrupt("operator registry keyId does not bind its SPKI");
  }
  return createPublicKey({ key: bytes, type: "spki", format: "der" });
}

function normalizeOperators(value, tenantId) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > MAX_OPERATORS ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1
  ) {
    throw new TypeError("operator identities must be a bounded array");
  }
  const operatorIds = new Set();
  const keyIds = new Set();
  const operators = value.map((entry) => {
    exact(
      entry,
      new Set(["operatorId", "publicKey", "tenantId"]),
      "operator identity",
    );
    if (entry.tenantId !== tenantId) {
      throw new Error("operator identity crossed its tenant boundary");
    }
    const operatorId = identifier(entry.operatorId, "operatorId");
    const key = publicKeyIdentity(entry.publicKey, "operator publicKey");
    if (operatorIds.has(operatorId) || keyIds.has(key.keyId)) {
      throw new Error("operator identity or key is duplicated");
    }
    operatorIds.add(operatorId);
    keyIds.add(key.keyId);
    return { operatorId, ...key };
  });
  return operators.sort((left, right) =>
    left.operatorId.localeCompare(right.operatorId),
  );
}

function policyCore({
  tenantId,
  policyId,
  revision,
  requiredApprovals,
  operators,
}) {
  return {
    tenantId,
    policyId,
    revision,
    requiredApprovals,
    operators: operators.map(({ operatorId, keyId }) => ({
      operatorId,
      keyId,
    })),
  };
}

function recordCore(value) {
  const core = structuredClone(value);
  delete core.recordDigest;
  return core;
}

export function digestGovernedSkillSynthesisAttestorTrustOperatorRegistryRecord(
  value,
) {
  return hash(
    GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_RECORD_SCHEMA,
    recordCore(value),
  );
}

function validateRecord(value, descriptor) {
  try {
    exact(value, RECORD_KEYS, "operator registry record");
  } catch {
    corrupt("operator registry record shape is invalid");
  }
  if (
    value.schema !==
      GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_RECORD_SCHEMA ||
    value.tenantId !== descriptor.tenantId ||
    !ID.test(value.policyId ?? "") ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    !Number.isSafeInteger(value.requiredApprovals) ||
    value.requiredApprovals < 1 ||
    !Number.isSafeInteger(value.operatorCount) ||
    value.operatorCount < value.requiredApprovals ||
    value.operatorCount > MAX_OPERATORS ||
    !DIGEST.test(value.policyDigest ?? "") ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    new Date(Date.parse(value.createdAt)).toISOString() !== value.createdAt ||
    !Array.isArray(value.operators) ||
    value.operators.length !== value.operatorCount ||
    value.recordDigest !==
      digestGovernedSkillSynthesisAttestorTrustOperatorRegistryRecord(value)
  ) {
    corrupt("operator registry record binding is invalid");
  }
  const ids = new Set();
  const keys = new Set();
  let previous = null;
  for (const operator of value.operators) {
    try {
      exact(operator, OPERATOR_KEYS, "stored operator identity");
    } catch {
      corrupt("stored operator identity shape is invalid");
    }
    if (
      !ID.test(operator.operatorId ?? "") ||
      ids.has(operator.operatorId) ||
      keys.has(operator.keyId) ||
      (previous !== null && previous.localeCompare(operator.operatorId) >= 0)
    ) {
      corrupt("stored operator identities are not unique and sorted");
    }
    decodePublicKey(operator);
    ids.add(operator.operatorId);
    keys.add(operator.keyId);
    previous = operator.operatorId;
  }
  const expectedPolicy = hash(
    "chainlesschain.attestor-trust-operations-policy/v1",
    policyCore(value),
  );
  if (value.policyDigest !== expectedPolicy) {
    corrupt("operator registry policy digest is invalid");
  }
  return freeze(structuredClone(value));
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
    corrupt("operator registry artifact resolution is incomplete");
  }
  let artifact;
  try {
    artifact = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    corrupt("operator registry artifact is not JSON");
  }
  if (
    artifact?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    artifact.tenantId !== descriptor.artifactTenantId ||
    artifact.audience !== descriptor.audience ||
    artifact.purpose !== descriptor.purpose ||
    artifact.retention !== "ledger" ||
    artifact.type !== ARTIFACT_TYPE
  ) {
    corrupt("operator registry durable artifact binding is invalid");
  }
  return validateRecord(artifact.value, descriptor);
}

function sameConfiguration(record, expected) {
  return (
    canonical({
      tenantId: record.tenantId,
      policyId: record.policyId,
      revision: record.revision,
      requiredApprovals: record.requiredApprovals,
      operatorCount: record.operatorCount,
      operators: record.operators,
      policyDigest: record.policyDigest,
    }) === canonical(expected)
  );
}

function snapshot(record, recovered) {
  return freeze({
    authenticated: true,
    durable: true,
    recovered,
    recordDigest: record.recordDigest,
    policyDigest: record.policyDigest,
    policyId: record.policyId,
    revision: record.revision,
    requiredApprovals: record.requiredApprovals,
    operatorCount: record.operatorCount,
    operatorIdentities: record.operators.map((operator) => ({
      tenantId: record.tenantId,
      operatorId: operator.operatorId,
      publicKey: decodePublicKey(operator).export({
        type: "spki",
        format: "pem",
      }),
    })),
  });
}

export function createGovernedSkillSynthesisAttestorTrustOperatorRegistry({
  descriptor: input,
  artifactPorts,
  ledger,
  ledgerArtifactResolver,
  now = Date.now,
} = {}) {
  const descriptor = Object.freeze({
    schema: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_SCHEMA,
    tenantId: identifier(input?.tenantId, "tenantId"),
    artifactTenantId: identifier(input?.artifactTenantId, "artifactTenantId"),
    streamId: identifier(input?.streamId, "streamId"),
    audience: identifier(input?.audience, "audience"),
    purpose: identifier(input?.purpose, "purpose"),
  });
  const put = capture(artifactPorts, "putCanonical", "artifactPorts");
  const readLedger = capture(ledger, "read", "ledger");
  const verifyLedger = capture(ledger, "verify", "ledger");
  const appendLedger = capture(ledger, "appendDomainEvent", "ledger");
  if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
    throw new TypeError(
      "a branded EvolutionArtifactPorts ledger resolver is required",
    );
  }
  if (typeof now !== "function" || utilTypes.isProxy(now)) {
    throw new TypeError("operator registry clock is invalid");
  }

  const load = async () => {
    const ledgerEvents = readLedger();
    if (!Array.isArray(ledgerEvents)) {
      corrupt("EvolutionLedger returned no operator registry events");
    }
    const events = ledgerEvents.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.tenantId === descriptor.tenantId &&
        event.correlationId === descriptor.streamId &&
        event.type ===
          GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_GENESIS_EVENT,
    );
    if (events.length > 1) corrupt("operator registry genesis is ambiguous");
    if (events.length === 0) return null;
    const event = events[0];
    const authority = verifyLedger();
    const resolution = await ledgerArtifactResolver({
      epoch: authority.epoch,
      ledgerId: authority.ledgerId,
      ref: event.subjectRef,
      tenantId: descriptor.artifactTenantId,
    });
    if (
      resolution?.ref !== event.subjectRef.ref ||
      resolution?.digest !== event.subjectRef.digest
    ) {
      corrupt("operator registry resolved a substituted artifact");
    }
    const record = parseArtifact(resolution, descriptor);
    if (
      event.eventId !==
        GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_GENESIS_EVENT ||
      event.decision !== "committed" ||
      event.timestamp !== record.createdAt ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== 0
    ) {
      corrupt("operator registry genesis event binding is invalid");
    }
    return { event, record };
  };

  const registry = Object.freeze({
    descriptor,
    async initialize({
      operatorIdentities,
      policyId: policyIdInput,
      revision: revisionInput,
      requiredApprovals: requiredApprovalsInput,
    } = {}) {
      const policyId = identifier(policyIdInput, "policyId");
      const revision = Number(revisionInput);
      const requiredApprovals = Number(requiredApprovalsInput);
      const operators = normalizeOperators(
        operatorIdentities,
        descriptor.tenantId,
      );
      if (!Number.isSafeInteger(revision) || revision < 1) {
        throw new TypeError("operator registry revision is invalid");
      }
      if (
        !Number.isSafeInteger(requiredApprovals) ||
        requiredApprovals < 1 ||
        requiredApprovals > operators.length
      ) {
        throw new TypeError("operator registry approval threshold is invalid");
      }
      const policy = policyCore({
        tenantId: descriptor.tenantId,
        policyId,
        revision,
        requiredApprovals,
        operators,
      });
      const expected = {
        ...policy,
        operatorCount: operators.length,
        operators,
        policyDigest: hash(
          "chainlesschain.attestor-trust-operations-policy/v1",
          policy,
        ),
      };
      const existing = await load();
      if (existing) {
        if (!sameConfiguration(existing.record, expected)) {
          throw new Error(
            "operator registry bootstrap differs from its durable genesis",
          );
        }
        return snapshot(existing.record, true);
      }
      const milliseconds = Number(now());
      if (!Number.isFinite(milliseconds)) {
        throw new TypeError("operator registry clock is invalid");
      }
      const core = {
        schema:
          GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_RECORD_SCHEMA,
        tenantId: descriptor.tenantId,
        policyId,
        revision,
        requiredApprovals,
        operatorCount: operators.length,
        operators,
        policyDigest: expected.policyDigest,
        createdAt: new Date(milliseconds).toISOString(),
      };
      const record = freeze({
        ...core,
        recordDigest:
          digestGovernedSkillSynthesisAttestorTrustOperatorRegistryRecord(core),
      });
      validateRecord(record, descriptor);
      const head = verifyLedger();
      const published = put(ARTIFACT_TYPE, record, {
        audience: descriptor.audience,
        purpose: descriptor.purpose,
        retention: "ledger",
      });
      if (
        !published?.ref ||
        published.receipt?.persisted !== true ||
        published.receipt?.readbackVerified !== true ||
        published.receipt?.integrityVerified !== true ||
        published.receipt?.retention !== "ledger"
      ) {
        corrupt("operator registry genesis was not durably read back");
      }
      try {
        const receipt = appendLedger(
          {
            artifactTenantId: descriptor.artifactTenantId,
            correlationId: descriptor.streamId,
            decision: "committed",
            eventId:
              GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_GENESIS_EVENT,
            reason: `attestor trust operator registry genesis with ${operators.length} operator(s)`,
            skillName: null,
            sourceRefs: [],
            subjectRef: published.ref,
            tenantId: descriptor.tenantId,
            timestamp: record.createdAt,
            type: GOVERNED_SKILL_SYNTHESIS_ATTESTOR_TRUST_OPERATOR_REGISTRY_GENESIS_EVENT,
          },
          {
            expectedHeadDigest: head.headDigest,
            expectedSequence: head.sequence,
          },
        );
        if (receipt?.authenticated !== true || receipt.durable !== true) {
          corrupt("operator registry genesis append was not durable");
        }
      } catch (error) {
        const recovered = await load();
        if (!recovered || canonical(recovered.record) !== canonical(record)) {
          throw error;
        }
      }
      const stored = await load();
      if (!stored || canonical(stored.record) !== canonical(record)) {
        corrupt("operator registry genesis readback differs");
      }
      return snapshot(stored.record, false);
    },
    async snapshot() {
      const current = await load();
      if (!current) throw new Error("operator registry is not initialized");
      return snapshot(current.record, true);
    },
  });
  REGISTRIES.add(registry);
  return registry;
}

export function isGovernedSkillSynthesisAttestorTrustOperatorRegistry(value) {
  return REGISTRIES.has(value);
}
