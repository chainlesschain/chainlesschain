import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export const SKILL_OUTCOME_SOURCE_CATALOG_SCHEMA =
  "chainlesschain.skill-outcome-source-catalog/v1";
export const SKILL_OUTCOME_SOURCE_CATALOG_ATTESTATION_SCHEMA =
  "chainlesschain.skill-outcome-source-catalog-attestation/v1";

const AUTHORITIES = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const MAX_SOURCES = 128;
const CATALOG_KEYS = new Set([
  "attestation",
  "catalogDigest",
  "catalogId",
  "entries",
  "issuedAt",
  "revision",
  "schema",
  "tenantId",
]);
const ENTRY_KEYS = new Set(["runId", "skillNames"]);
const ATTESTATION_KEYS = new Set(["algorithm", "keyId", "schema", "value"]);
const VERIFICATION_KEYS = new Set([
  "authenticated",
  "catalogDigest",
  "catalogId",
  "durable",
  "receiptDigest",
  "revision",
  "tenantId",
]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256")
    .update(SKILL_OUTCOME_SOURCE_CATALOG_SCHEMA)
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
    Reflect.ownKeys(value).length !== keys.size ||
    Reflect.ownKeys(value).some(
      (key) => typeof key !== "string" || !keys.has(key),
    )
  ) {
    throw new TypeError(`${label} is invalid`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${String(key)} is invalid`);
    }
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

function capture(owner, method, label) {
  if (!owner || typeof owner !== "object" || utilTypes.isProxy(owner)) {
    throw new TypeError(`${label}.${method}() is required`);
  }
  const operation = owner[method];
  if (typeof operation !== "function" || utilTypes.isProxy(operation)) {
    throw new TypeError(`${label}.${method}() is required`);
  }
  return Object.freeze((...args) => Reflect.apply(operation, owner, args));
}

export function digestSkillOutcomeSourceCatalog(value) {
  return hash({
    schema: value.schema,
    tenantId: value.tenantId,
    catalogId: value.catalogId,
    revision: value.revision,
    issuedAt: value.issuedAt,
    entries: value.entries,
  });
}

function verifyCatalog(value, tenantId) {
  exact(value, CATALOG_KEYS, "Skill outcome source catalog");
  if (
    value.schema !== SKILL_OUTCOME_SOURCE_CATALOG_SCHEMA ||
    value.tenantId !== tenantId ||
    !SAFE_ID.test(value.catalogId ?? "") ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1 ||
    typeof value.issuedAt !== "string" ||
    !Number.isFinite(Date.parse(value.issuedAt)) ||
    !Array.isArray(value.entries) ||
    utilTypes.isProxy(value.entries) ||
    value.entries.length < 1 ||
    value.entries.length > MAX_SOURCES ||
    !DIGEST.test(value.catalogDigest ?? "")
  ) {
    throw new TypeError("Skill outcome source catalog is invalid or unbounded");
  }
  const runIds = new Set();
  let sourceCount = 0;
  const entries = value.entries.map((input, index) => {
    const entry = exact(input, ENTRY_KEYS, `catalog.entries[${index}]`);
    const runId = identifier(entry.runId, `catalog.entries[${index}].runId`);
    if (runIds.has(runId)) {
      throw new TypeError(
        "Skill outcome source catalog contains a duplicate run",
      );
    }
    runIds.add(runId);
    if (
      !Array.isArray(entry.skillNames) ||
      utilTypes.isProxy(entry.skillNames) ||
      entry.skillNames.length < 1 ||
      entry.skillNames.length > MAX_SOURCES
    ) {
      throw new TypeError(
        `catalog.entries[${index}].skillNames is invalid or unbounded`,
      );
    }
    const skillNames = entry.skillNames.map((skillName, skillIndex) =>
      identifier(
        skillName,
        `catalog.entries[${index}].skillNames[${skillIndex}]`,
      ),
    );
    if (new Set(skillNames).size !== skillNames.length) {
      throw new TypeError(
        "Skill outcome source catalog contains a duplicate Skill",
      );
    }
    sourceCount += skillNames.length;
    if (sourceCount > MAX_SOURCES) {
      throw new TypeError(
        "Skill outcome source catalog is invalid or unbounded",
      );
    }
    return Object.freeze({ runId, skillNames: Object.freeze(skillNames) });
  });
  exact(
    value.attestation,
    ATTESTATION_KEYS,
    "Skill outcome source catalog attestation",
  );
  if (
    value.attestation.schema !==
      SKILL_OUTCOME_SOURCE_CATALOG_ATTESTATION_SCHEMA ||
    !SAFE_ID.test(value.attestation.algorithm ?? "") ||
    !SAFE_ID.test(value.attestation.keyId ?? "") ||
    typeof value.attestation.value !== "string" ||
    value.attestation.value.length < 16 ||
    value.attestation.value.length > 4096 ||
    value.catalogDigest !== digestSkillOutcomeSourceCatalog(value)
  ) {
    throw new Error("Skill outcome source catalog integrity is invalid");
  }
  return Object.freeze({ ...value, entries: Object.freeze(entries) });
}

export function createSkillOutcomeSourceCatalogAuthority({
  tenantId: tenantIdInput,
  loader,
  verifier,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const load = capture(loader, "load", "catalog loader");
  const verify = capture(verifier, "verify", "catalog verifier");
  const authority = Object.freeze({
    async loadCatalog() {
      const catalog = verifyCatalog(await load({ tenantId }), tenantId);
      const verification = exact(
        await verify({
          tenantId,
          catalogId: catalog.catalogId,
          revision: catalog.revision,
          catalogDigest: catalog.catalogDigest,
          attestation: catalog.attestation,
        }),
        VERIFICATION_KEYS,
        "Skill outcome source catalog verification",
      );
      if (
        verification.authenticated !== true ||
        verification.durable !== true ||
        verification.tenantId !== tenantId ||
        verification.catalogId !== catalog.catalogId ||
        verification.revision !== catalog.revision ||
        verification.catalogDigest !== catalog.catalogDigest ||
        !DIGEST.test(verification.receiptDigest ?? "")
      ) {
        throw new Error("Skill outcome source catalog is not authoritative");
      }
      return Object.freeze({
        authenticated: true,
        durable: true,
        tenantId,
        catalogId: catalog.catalogId,
        revision: catalog.revision,
        catalogDigest: catalog.catalogDigest,
        receiptDigest: verification.receiptDigest,
        entries: catalog.entries,
      });
    },
  });
  AUTHORITIES.add(authority);
  return authority;
}

export function captureSkillOutcomeSourceCatalogAuthority(value) {
  if (!AUTHORITIES.has(value)) {
    throw new TypeError(
      "a branded Skill outcome source catalog authority is required",
    );
  }
  return value;
}
