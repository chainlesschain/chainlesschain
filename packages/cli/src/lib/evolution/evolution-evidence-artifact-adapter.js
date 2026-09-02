/**
 * Durable composition for the evidence projection boundary.
 *
 * Raw plaintext is handed only to a captured encryption authority. ArtifactStore
 * receives opaque ciphertext, while model/trusted projections and their complete
 * derivation lineage are persisted through authenticated EvolutionArtifactPorts.
 */

import crypto from "node:crypto";
import { types as utilTypes } from "node:util";

import { ArtifactStore } from "../artifact-store.js";
import {
  EvolutionArtifactPorts,
  EVOLUTION_ARTIFACT_DEFAULT_TTL_MS,
  EVOLUTION_ARTIFACT_MAX_TTL_MS,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_RAW_STORAGE_RECEIPT_SCHEMA,
  EvolutionEvidenceBundleVerifier,
  EvolutionEvidenceProjector,
} from "./evolution-evidence-projector.js";

export const EVOLUTION_ENCRYPTED_RAW_LINEAGE_SCHEMA =
  "chainlesschain.evolution-encrypted-raw-lineage/v1";
export const EVOLUTION_EVIDENCE_DERIVATION_MANIFEST_SCHEMA =
  "chainlesschain.evolution-evidence-derivation-manifest/v1";
export const EVOLUTION_EVIDENCE_ARTIFACT_RESULT_SCHEMA =
  "chainlesschain.evolution-evidence-artifact-result/v1";

const SAFE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._:-][a-z0-9]+)*$/u;
const RAW_RESULT_KEYS = new Set(["algorithm", "keyRef", "sealedBytes"]);
const RAW_REQUEST_KEYS = new Set([
  "tenantId",
  "principalId",
  "evidenceId",
  "sourceCommitment",
  "commitmentReceiptDigest",
  "sourceVerificationReceiptDigest",
  "storagePolicyReceiptDigest",
  "storagePolicyDigest",
  "storagePolicyRevision",
  "storagePolicyDecisionExpiresAt",
  "requestNonce",
  "requestedAt",
  "sensitivity",
  "retention",
  "acl",
  "aad",
  "payload",
]);
const COMPONENT_DESCRIPTOR_KEYS = new Set([
  "digest",
  "envelope",
  "ref",
  "type",
]);
const COMPONENT_TYPES = Object.freeze({
  rawRecord: "source-evidence",
  modelProjection: "model-projection",
  trustedProjection: "trusted-projection",
  receipt: "receipt",
});

function canonicalJson(value, seen = new Set()) {
  if (value === null || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new TypeError("canonical value contains a non-finite number");
    return JSON.stringify(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (!value || typeof value !== "object" || seen.has(value)) {
    throw new TypeError("canonical value must be an acyclic JSON value");
  }
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = `[${value.map((entry) => canonicalJson(entry, seen)).join(",")}]`;
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("canonical value must use plain objects");
    }
    output = `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], seen)}`)
      .join(",")}}`;
  }
  seen.delete(value);
  return output;
}

function digestBytes(bytes) {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

function digestRecord(domain, value) {
  return digestBytes(Buffer.from(`${domain}\0${canonicalJson(value)}`, "utf8"));
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value);
}

function clone(value) {
  return JSON.parse(canonicalJson(value));
}

function assertPlainExact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a non-proxy plain object`);
  }
  const ownKeys = Reflect.ownKeys(value);
  if (
    ownKeys.length !== keys.size ||
    ownKeys.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw new TypeError(`${label} contains unsupported fields`);
  }
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(
        `${label}.${String(key)} must be an enumerable data property`,
      );
    }
  }
}

function assertInstance(value, prototype, label) {
  if (
    !value ||
    utilTypes.isProxy(value) ||
    Object.getPrototypeOf(value) !== prototype
  ) {
    throw new TypeError(`${label} must be the repository implementation`);
  }
}

function normalizeId(value, label) {
  if (
    typeof value !== "string" ||
    value.length > 256 ||
    !SAFE_ID_PATTERN.test(value)
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function captureMethod(owner, method, label) {
  if (
    !owner ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function"
  ) {
    throw new TypeError(`${label} must provide ${method}()`);
  }
  const fn = owner[method];
  return (...args) => Reflect.apply(fn, owner, args);
}

/**
 * Ciphertext-only Raw persistence. The encryptor is expected to be backed by a
 * tenant KMS/HSM in production and must never return plaintext or key bytes.
 */
export class ArtifactStoreEncryptedRawStore {
  #tenantId;
  #publish;
  #verifyIntegrity;
  #encrypt;

  constructor({ tenantId, artifactStore, encryptor } = {}) {
    this.#tenantId = normalizeId(tenantId, "Raw store tenantId");
    assertInstance(artifactStore, ArtifactStore.prototype, "artifactStore");
    this.#publish = captureMethod(
      artifactStore,
      "publishDataOnce",
      "artifactStore",
    );
    this.#verifyIntegrity = captureMethod(
      artifactStore,
      "verifyIntegrity",
      "artifactStore",
    );
    this.#encrypt = captureMethod(encryptor, "encrypt", "Raw encryptor");
    Object.freeze(this);
  }

  async putEncrypted(request) {
    assertPlainExact(request, RAW_REQUEST_KEYS, "Raw storage request");
    if (!Object.isFrozen(request)) {
      throw new TypeError("Raw storage request must be immutable");
    }
    if (request.tenantId !== this.#tenantId) {
      throw new TypeError("cross-tenant Raw storage is denied");
    }
    const evidenceId = normalizeId(request.evidenceId, "Raw evidenceId");
    const plaintext = Buffer.from(canonicalJson(request.payload), "utf8");
    const aadBytes = Buffer.from(canonicalJson(request.aad), "utf8");
    const encrypted = await this.#encrypt(
      Object.freeze({
        aad: Buffer.from(aadBytes),
        evidenceId,
        plaintext: Buffer.from(plaintext),
        tenantId: this.#tenantId,
      }),
    );
    assertPlainExact(encrypted, RAW_RESULT_KEYS, "Raw encryption result");
    if (encrypted.algorithm !== "aes-256-gcm") {
      throw new TypeError(
        "Raw encryption authority returned an unsupported algorithm",
      );
    }
    if (
      typeof encrypted.keyRef !== "string" ||
      !encrypted.keyRef.startsWith(`kms://${this.#tenantId}/`) ||
      encrypted.keyRef.length > 2048
    ) {
      throw new TypeError(
        "Raw encryption authority returned an invalid keyRef",
      );
    }
    if (
      !Buffer.isBuffer(encrypted.sealedBytes) ||
      encrypted.sealedBytes.length < 29
    ) {
      throw new TypeError(
        "Raw encryption authority returned invalid ciphertext",
      );
    }
    const sealedBytes = Buffer.from(encrypted.sealedBytes);
    const cipherDigest = digestBytes(sealedBytes);
    const aadDigest = digestRecord(
      "chainlesschain.evolution-raw-storage-aad/v1",
      request.aad,
    );
    const lineage = deepFreeze({
      aadDigest,
      algorithm: encrypted.algorithm,
      cipherDigest,
      evidenceId,
      keyRef: encrypted.keyRef,
      schema: EVOLUTION_ENCRYPTED_RAW_LINEAGE_SCHEMA,
      tenantId: this.#tenantId,
    });
    const expiresAtMs = Date.parse(request.retention?.expiresAt);
    const requestedAtMs = Date.parse(request.requestedAt);
    if (
      !Number.isFinite(expiresAtMs) ||
      !Number.isFinite(requestedAtMs) ||
      expiresAtMs <= requestedAtMs
    ) {
      throw new TypeError("Raw retention is invalid");
    }
    const publication = this.#publish({
      data: sealedBytes,
      fileName: `${cipherDigest.slice("sha256:".length)}.raw.enc`,
      title: "Encrypted evolution Raw evidence",
      kind: "data",
      mime: "application/octet-stream",
      ttlDays: Math.max(
        1,
        Math.ceil((expiresAtMs - requestedAtMs) / 86_400_000),
      ),
      immutable: true,
      recordDigest: cipherDigest,
      lineage,
    });
    const entry = publication?.entry;
    if (
      !entry ||
      entry.recordDigest !== cipherDigest ||
      entry.sha256 !== cipherDigest.slice("sha256:".length) ||
      this.#verifyIntegrity(entry).ok !== true
    ) {
      throw new Error("encrypted Raw artifact failed persistence readback");
    }
    const core = {
      schema: EVOLUTION_RAW_STORAGE_RECEIPT_SCHEMA,
      stored: true,
      tenantId: this.#tenantId,
      evidenceId,
      sourceCommitment: request.sourceCommitment,
      commitmentReceiptDigest: request.commitmentReceiptDigest,
      sourceVerificationReceiptDigest: request.sourceVerificationReceiptDigest,
      storagePolicyReceiptDigest: request.storagePolicyReceiptDigest,
      storagePolicyDigest: request.storagePolicyDigest,
      storagePolicyRevision: request.storagePolicyRevision,
      storagePolicyDecisionExpiresAt: request.storagePolicyDecisionExpiresAt,
      requestNonce: request.requestNonce,
      requestedAt: request.requestedAt,
      storedAt: request.requestedAt,
      artifactRef: `artifact://${this.#tenantId}/raw/${entry.id}`,
      cipherDigest,
      keyRef: encrypted.keyRef,
      algorithm: encrypted.algorithm,
      aadDigest,
      sensitivity: request.sensitivity,
      retention: clone(request.retention),
      acl: clone(request.acl),
    };
    return deepFreeze({
      ...core,
      receiptDigest: digestRecord(
        "chainlesschain.evolution-raw-storage-receipt/v1",
        core,
      ),
    });
  }
}

function componentDescriptor(type, publication) {
  return deepFreeze({
    digest: publication.digest,
    envelope: publication.envelope,
    ref: clone(publication.ref),
    type,
  });
}

/** Commit-point adapter for authenticated projection bundles. */
export class EvolutionEvidenceArtifactAdapter {
  #tenantId;
  #audience;
  #purpose;
  #ttlMs;
  #project;
  #verify;
  #ports;

  constructor({
    tenantId,
    audience,
    purpose = "evidence-projection",
    ttlMs = EVOLUTION_ARTIFACT_DEFAULT_TTL_MS,
    projector,
    bundleVerifier,
    artifactPorts,
  } = {}) {
    this.#tenantId = normalizeId(tenantId, "evidence adapter tenantId");
    this.#audience = normalizeId(audience, "evidence adapter audience");
    this.#purpose = normalizeId(purpose, "evidence adapter purpose");
    if (
      !Number.isSafeInteger(ttlMs) ||
      ttlMs < 1 ||
      ttlMs > EVOLUTION_ARTIFACT_MAX_TTL_MS
    ) {
      throw new TypeError("evidence adapter ttlMs is invalid");
    }
    assertInstance(
      projector,
      EvolutionEvidenceProjector.prototype,
      "projector",
    );
    assertInstance(
      bundleVerifier,
      EvolutionEvidenceBundleVerifier.prototype,
      "bundleVerifier",
    );
    assertInstance(
      artifactPorts,
      EvolutionArtifactPorts.prototype,
      "artifactPorts",
    );
    this.#ttlMs = ttlMs;
    this.#project = captureMethod(projector, "project", "projector");
    this.#verify = captureMethod(bundleVerifier, "verify", "bundleVerifier");
    this.#ports = artifactPorts;
    Object.freeze(this);
  }

  #put(type, value) {
    return this.#ports.putCanonical(type, value, {
      audience: this.#audience,
      purpose: this.#purpose,
      retention: "ttl",
      ttlMs: this.#ttlMs,
    });
  }

  async projectAndPersist(input) {
    const bundle = await this.#project(input);
    const verification = await this.#verify(bundle);
    if (
      verification.verified !== true ||
      verification.tenantId !== this.#tenantId ||
      verification.receiptDigest !== bundle.receipt.receiptDigest ||
      verification.attestationDigest !== bundle.attestation.attestationDigest
    ) {
      throw new Error("projection bundle verification is unbound");
    }
    const components = {};
    for (const [field, type] of Object.entries(COMPONENT_TYPES)) {
      components[field] = componentDescriptor(
        type,
        this.#put(type, bundle[field]),
      );
    }
    const manifest = deepFreeze({
      schema: EVOLUTION_EVIDENCE_DERIVATION_MANIFEST_SCHEMA,
      tenantId: this.#tenantId,
      evidenceId: bundle.receipt.evidenceId,
      sourceCommitment: bundle.receipt.sourceCommitment,
      rulesetDigest: bundle.receipt.rulesetDigest,
      projectionReceiptDigest: bundle.receipt.receiptDigest,
      attestation: clone(bundle.attestation),
      components: deepFreeze(components),
    });
    const publication = this.#put("evidence", manifest);
    return deepFreeze({
      schema: EVOLUTION_EVIDENCE_ARTIFACT_RESULT_SCHEMA,
      tenantId: this.#tenantId,
      evidenceId: manifest.evidenceId,
      manifest: componentDescriptor("evidence", publication),
    });
  }

  async resolve(result) {
    assertPlainExact(
      result,
      new Set(["schema", "tenantId", "evidenceId", "manifest"]),
      "evidence artifact result",
    );
    if (
      result.schema !== EVOLUTION_EVIDENCE_ARTIFACT_RESULT_SCHEMA ||
      result.tenantId !== this.#tenantId
    ) {
      throw new TypeError(
        "evidence artifact result is invalid or cross-tenant",
      );
    }
    assertPlainExact(
      result.manifest,
      COMPONENT_DESCRIPTOR_KEYS,
      "evidence manifest descriptor",
    );
    if (result.manifest.type !== "evidence") {
      throw new TypeError("evidence manifest descriptor type is invalid");
    }
    const manifestResolved = this.#ports.resolve(result.manifest.envelope, {
      expectedDigest: result.manifest.digest,
      expectedType: "evidence",
      purpose: this.#purpose,
      tenantId: this.#tenantId,
    });
    const manifest = manifestResolved.value;
    if (
      manifest.schema !== EVOLUTION_EVIDENCE_DERIVATION_MANIFEST_SCHEMA ||
      manifest.tenantId !== this.#tenantId ||
      manifest.evidenceId !== result.evidenceId
    ) {
      throw new Error("evidence derivation manifest is invalid");
    }
    const bundle = { attestation: clone(manifest.attestation) };
    for (const [field, type] of Object.entries(COMPONENT_TYPES)) {
      const descriptor = manifest.components[field];
      assertPlainExact(
        descriptor,
        COMPONENT_DESCRIPTOR_KEYS,
        `evidence ${field} descriptor`,
      );
      if (!descriptor || descriptor.type !== type) {
        throw new Error("evidence derivation component type is invalid");
      }
      bundle[field] = this.#ports.resolve(descriptor.envelope, {
        expectedDigest: descriptor.digest,
        expectedType: type,
        purpose: this.#purpose,
        tenantId: this.#tenantId,
      }).value;
    }
    const verification = await this.#verify(bundle);
    if (
      verification.receiptDigest !== manifest.projectionReceiptDigest ||
      verification.attestationDigest !==
        manifest.attestation.attestationDigest ||
      bundle.receipt.rulesetDigest !== manifest.rulesetDigest ||
      bundle.receipt.sourceCommitment !== manifest.sourceCommitment
    ) {
      throw new Error("persisted evidence derivation lineage is unbound");
    }
    return deepFreeze({ bundle, manifest: clone(manifest), verification });
  }
}

Object.freeze(ArtifactStoreEncryptedRawStore.prototype);
Object.freeze(EvolutionEvidenceArtifactAdapter.prototype);
