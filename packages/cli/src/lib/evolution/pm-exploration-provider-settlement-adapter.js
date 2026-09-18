import { createHash } from "node:crypto";
import { isPromise, isProxy, isUint8Array } from "node:util/types";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  EvolutionArtifactPorts,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_DURABILITY_BINDING_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RECEIPT_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RESOLUTION_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RESOLVE_REQUEST_SCHEMA,
  EVOLUTION_ARTIFACT_DURABILITY_RETAIN_REQUEST_SCHEMA,
} from "./evolution-ledger-ports.js";
import {
  PM_EXPLORATION_PROVIDER_PERSISTENCE_SCHEMA,
  verifyPmExplorationVolcengineSettlement,
} from "./pm-exploration-volcengine-provider.js";

export const PM_EXPLORATION_PROVIDER_SETTLEMENT_RECORD_SCHEMA =
  "chainlesschain.pm-exploration-provider-settlement-record/v1";
export const PM_EXPLORATION_PROVIDER_SETTLEMENT_ADAPTER_SCHEMA =
  "chainlesschain.pm-exploration-provider-settlement-adapter/v1";
export const PM_EXPLORATION_PROVIDER_SETTLEMENT_CORRUPT_CODE =
  "CC_PM_PROVIDER_SETTLEMENT_CORRUPT";

const ARTIFACT_TYPE = "pm-exploration-provider-settlement";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const DESCRIPTOR_KEYS = new Set([
  "tenantId",
  "artifactTenantId",
  "audience",
  "purpose",
  "durabilityAuthorityId",
  "handlerArtifactDigest",
]);
const AUTHORITY_KEYS = new Set(["id", "retain", "resolve"]);
const DURABILITY_RECEIPT_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "authorityId",
  "artifactTenantId",
  "digest",
  "purpose",
  "ref",
  "retention",
  "type",
  "receiptDigest",
]);
const DURABILITY_RESOLUTION_KEYS = new Set([
  ...DURABILITY_RECEIPT_KEYS,
  "bytes",
]);
const STORE_PORTS = new WeakMap();

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

function sha256Bytes(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && "value" in descriptor) deepFreeze(descriptor.value, seen);
  }
  return Object.freeze(value);
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    throw new TypeError(`${label} must be a plain record`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.size ||
    actual.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }
  for (const key of actual) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor))
      throw new TypeError(`${label}.${String(key)} must be an own data field`);
  }
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value))
    throw new TypeError(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (typeof value !== "string" || !DIGEST.test(value))
    throw new TypeError(`${label} must be a sha256 digest`);
  return value;
}

function corrupt(message, options) {
  const error = new Error(message, options);
  error.code = PM_EXPLORATION_PROVIDER_SETTLEMENT_CORRUPT_CODE;
  throw error;
}

function normalizeDescriptor(input) {
  exact(input, DESCRIPTOR_KEYS, "PM provider settlement descriptor");
  const core = {
    tenantId: identifier(input.tenantId, "tenantId"),
    artifactTenantId: identifier(input.artifactTenantId, "artifactTenantId"),
    audience: identifier(input.audience, "audience"),
    purpose: identifier(input.purpose, "purpose"),
    durabilityAuthorityId: identifier(
      input.durabilityAuthorityId,
      "durabilityAuthorityId",
    ),
    handlerArtifactDigest: digest(
      input.handlerArtifactDigest,
      "handlerArtifactDigest",
    ),
  };
  return deepFreeze({
    schema: PM_EXPLORATION_PROVIDER_SETTLEMENT_ADAPTER_SCHEMA,
    ...core,
    descriptorDigest: hash(
      PM_EXPLORATION_PROVIDER_SETTLEMENT_ADAPTER_SCHEMA,
      core,
    ),
  });
}

function captureDurabilityAuthority(value) {
  exact(value, AUTHORITY_KEYS, "PM settlement durability authority");
  const retain = Object.getOwnPropertyDescriptor(value, "retain").value;
  const resolve = Object.getOwnPropertyDescriptor(value, "resolve").value;
  if (
    typeof retain !== "function" ||
    typeof resolve !== "function" ||
    isProxy(retain) ||
    isProxy(resolve)
  ) {
    throw new TypeError(
      "PM settlement durability authority requires direct retain and resolve methods",
    );
  }
  return Object.freeze({
    id: identifier(value.id, "PM settlement durability authority id"),
    retain: Object.freeze((request) => Reflect.apply(retain, value, [request])),
    resolve: Object.freeze((request) =>
      Reflect.apply(resolve, value, [request]),
    ),
  });
}

function settlementRecord(descriptor, input) {
  const settlement = verifyPmExplorationVolcengineSettlement(input);
  const core = deepFreeze({
    schema: PM_EXPLORATION_PROVIDER_SETTLEMENT_RECORD_SCHEMA,
    descriptorDigest: descriptor.descriptorDigest,
    settlement,
  });
  return deepFreeze({
    ...core,
    recordDigest: hash(PM_EXPLORATION_PROVIDER_SETTLEMENT_RECORD_SCHEMA, core),
  });
}

function persistenceReceipt(settlementDigest, recordDigest) {
  return deepFreeze({
    schema: PM_EXPLORATION_PROVIDER_PERSISTENCE_SCHEMA,
    settlementDigest,
    persisted: true,
    durable: true,
    recordDigest,
  });
}

function validateDurabilityReceipt(
  value,
  binding,
  authorityId,
  expectedSchema,
  label,
) {
  exact(value, DURABILITY_RECEIPT_KEYS, label);
  if (
    value.schema !== expectedSchema ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.authorityId !== authorityId ||
    value.artifactTenantId !== binding.artifactTenantId ||
    value.digest !== binding.digest ||
    value.purpose !== binding.purpose ||
    value.ref !== binding.ref ||
    value.retention !== binding.retention ||
    value.type !== binding.type ||
    !DIGEST.test(value.receiptDigest ?? "")
  ) {
    corrupt(`${label} is not authenticated durable evidence`);
  }
  return value;
}

function safeBytes(value, label) {
  if (
    !value ||
    typeof value !== "object" ||
    isProxy(value) ||
    !(
      (Buffer.isBuffer(value) &&
        Object.getPrototypeOf(value) === Buffer.prototype) ||
      (isUint8Array(value) &&
        Object.getPrototypeOf(value) === Uint8Array.prototype)
    )
  ) {
    corrupt(`${label} bytes are invalid`);
  }
  return Buffer.from(value);
}

export class PmExplorationProviderSettlementAdapter {
  #artifactPut;
  #authority;

  constructor({ descriptor, artifactPorts, artifactDurabilityAuthority } = {}) {
    this.descriptor = normalizeDescriptor(descriptor);
    if (
      !artifactPorts ||
      typeof artifactPorts !== "object" ||
      isProxy(artifactPorts) ||
      Object.getPrototypeOf(artifactPorts) !== EvolutionArtifactPorts.prototype
    ) {
      throw new TypeError("EvolutionArtifactPorts exact instance is required");
    }
    this.#artifactPut =
      EvolutionArtifactPorts.prototype.putCanonical.bind(artifactPorts);
    this.#authority = captureDurabilityAuthority(artifactDurabilityAuthority);
    if (this.#authority.id !== this.descriptor.durabilityAuthorityId) {
      throw new TypeError(
        "PM settlement durability authority differs from the descriptor",
      );
    }
    STORE_PORTS.set(
      this,
      Object.freeze({
        inspect: () => this.descriptor,
        persistSettlement: (settlement) => this.persistSettlement(settlement),
        verifySettlementPersistence: (settlement, persistence) =>
          this.verifySettlementPersistence(settlement, persistence),
      }),
    );
    Object.freeze(this);
  }

  #materialize(input) {
    const record = settlementRecord(this.descriptor, input);
    const published = this.#artifactPut(ARTIFACT_TYPE, record, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      !published?.ref ||
      published.digest !== published.ref.digest ||
      published.receipt?.persisted !== true ||
      published.receipt.readbackVerified !== true ||
      published.receipt.integrityVerified !== true ||
      published.receipt.retention !== "ledger"
    ) {
      corrupt("PM provider settlement artifact persistence was not confirmed");
    }
    const durableRecord = deepFreeze({
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
      schema: EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
      tenantId: this.descriptor.artifactTenantId,
      type: ARTIFACT_TYPE,
      value: record,
    });
    const bytes = Buffer.from(canonical(durableRecord), "utf8");
    if (sha256Bytes(bytes) !== published.digest) {
      corrupt("PM provider settlement canonical artifact bytes differ");
    }
    const binding = deepFreeze({
      artifactTenantId: this.descriptor.artifactTenantId,
      digest: published.digest,
      purpose: this.descriptor.purpose,
      ref: published.ref.ref,
      retention: "ledger",
      schema: EVOLUTION_ARTIFACT_DURABILITY_BINDING_SCHEMA,
      type: ARTIFACT_TYPE,
    });
    return { binding, bytes, published, record };
  }

  #resolve(materialized) {
    const result = this.#authority.resolve(
      Object.freeze({
        artifactTenantId: materialized.binding.artifactTenantId,
        digest: materialized.binding.digest,
        purpose: materialized.binding.purpose,
        ref: materialized.binding.ref,
        retention: materialized.binding.retention,
        schema: EVOLUTION_ARTIFACT_DURABILITY_RESOLVE_REQUEST_SCHEMA,
      }),
    );
    if (isPromise(result))
      corrupt("PM provider settlement durability resolve must be synchronous");
    exact(
      result,
      DURABILITY_RESOLUTION_KEYS,
      "PM provider settlement durability resolution",
    );
    validateDurabilityReceipt(
      Object.fromEntries(
        [...DURABILITY_RECEIPT_KEYS].map((key) => [key, result[key]]),
      ),
      materialized.binding,
      this.#authority.id,
      EVOLUTION_ARTIFACT_DURABILITY_RESOLUTION_SCHEMA,
      "PM provider settlement durability resolution",
    );
    const bytes = safeBytes(
      result.bytes,
      "PM provider settlement durability resolution",
    );
    if (!bytes.equals(materialized.bytes))
      corrupt("PM provider settlement durability readback differs");
  }

  persistSettlement(input) {
    const materialized = this.#materialize(input);
    const retained = this.#authority.retain(
      Object.freeze({
        binding: materialized.binding,
        bytes: Buffer.from(materialized.bytes),
        schema: EVOLUTION_ARTIFACT_DURABILITY_RETAIN_REQUEST_SCHEMA,
      }),
    );
    if (isPromise(retained))
      corrupt("PM provider settlement durability retain must be synchronous");
    validateDurabilityReceipt(
      retained,
      materialized.binding,
      this.#authority.id,
      EVOLUTION_ARTIFACT_DURABILITY_RECEIPT_SCHEMA,
      "PM provider settlement durability receipt",
    );
    this.#resolve(materialized);
    return persistenceReceipt(
      materialized.record.settlement.settlementDigest,
      materialized.published.digest,
    );
  }

  verifySettlementPersistence(input, persistence) {
    exact(
      persistence,
      new Set([
        "schema",
        "settlementDigest",
        "persisted",
        "durable",
        "recordDigest",
      ]),
      "PM provider settlement persistence",
    );
    const materialized = this.#materialize(input);
    if (
      persistence.schema !== PM_EXPLORATION_PROVIDER_PERSISTENCE_SCHEMA ||
      persistence.settlementDigest !==
        materialized.record.settlement.settlementDigest ||
      persistence.persisted !== true ||
      persistence.durable !== true ||
      persistence.recordDigest !== materialized.published.digest
    ) {
      corrupt("PM provider settlement persistence does not match the artifact");
    }
    this.#resolve(materialized);
    return persistenceReceipt(
      materialized.record.settlement.settlementDigest,
      materialized.published.digest,
    );
  }
}

export function capturePmExplorationProviderSettlementStore(value) {
  const ports = STORE_PORTS.get(value);
  if (!ports)
    throw new TypeError(
      "a real PmExplorationProviderSettlementAdapter is required",
    );
  return ports;
}
