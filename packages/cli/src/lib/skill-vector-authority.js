import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

export const SKILL_VECTOR_REQUEST_SCHEMA =
  "chainlesschain.skill-vector-request/v1";
export const SKILL_VECTOR_RESULT_SCHEMA =
  "chainlesschain.skill-vector-result/v1";
export const SKILL_VECTOR_AUTHORITY_SCHEMA =
  "chainlesschain.skill-vector-authority/v1";
export const SKILL_VECTOR_ATTESTATION_SCHEMA =
  "chainlesschain.skill-vector-attestation/v1";

const AUTHORITIES = new WeakSet();
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const MAX_SKILLS = 10_000;
const MAX_TEXT_BYTES = 8 * 1024 * 1024;
const RESULT_KEYS = new Set([
  "attestation",
  "corpusDigest",
  "indexDigest",
  "modelId",
  "modelRevision",
  "requestDigest",
  "resultDigest",
  "schema",
  "scores",
  "tenantId",
]);
const SCORE_KEYS = new Set(["digest", "score"]);
const ATTESTATION_KEYS = new Set(["algorithm", "keyId", "schema", "value"]);
const VERIFICATION_KEYS = new Set([
  "authenticated",
  "durable",
  "receiptDigest",
  "requestDigest",
  "resultDigest",
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

function boundedText(value, label, maximum = 4096) {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > maximum
  ) {
    throw new TypeError(`${label} is invalid or unbounded`);
  }
  return value.trim();
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

function corpusFor(skills) {
  if (
    !Array.isArray(skills) ||
    utilTypes.isProxy(skills) ||
    skills.length < 1 ||
    skills.length > MAX_SKILLS
  ) {
    throw new TypeError("Skill vector corpus is invalid or unbounded");
  }
  let bytes = 0;
  const digests = new Set();
  const corpus = skills.map((skill, index) => {
    if (!skill || typeof skill !== "object" || utilTypes.isProxy(skill)) {
      throw new TypeError(`Skill vector corpus[${index}] is invalid`);
    }
    const digest = skill.executionIdentity?.contentDigest;
    if (!DIGEST.test(digest ?? "") || digests.has(digest)) {
      throw new TypeError(
        "Skill vector corpus has a missing or duplicate digest",
      );
    }
    digests.add(digest);
    const entry = {
      digest,
      id: boundedText(skill.id, `skills[${index}].id`, 256),
      displayName: boundedText(
        skill.displayName || skill.id,
        `skills[${index}].displayName`,
        512,
      ),
      description: boundedText(
        skill.description || "(no description)",
        `skills[${index}].description`,
        16_384,
      ),
      category: boundedText(
        skill.category || "uncategorized",
        `skills[${index}].category`,
        128,
      ),
      tags: Array.isArray(skill.tags)
        ? skill.tags.map((tag, tagIndex) =>
            boundedText(tag, `skills[${index}].tags[${tagIndex}]`, 128),
          )
        : [],
    };
    if (
      entry.tags.length > 64 ||
      new Set(entry.tags).size !== entry.tags.length
    ) {
      throw new TypeError("Skill vector corpus tags are invalid or unbounded");
    }
    bytes += Buffer.byteLength(canonical(entry), "utf8");
    if (bytes > MAX_TEXT_BYTES) {
      throw new TypeError("Skill vector corpus is invalid or unbounded");
    }
    return Object.freeze({ ...entry, tags: Object.freeze(entry.tags) });
  });
  corpus.sort((left, right) => left.digest.localeCompare(right.digest));
  return Object.freeze(corpus);
}

export function digestSkillVectorResult(value) {
  return hash(SKILL_VECTOR_RESULT_SCHEMA, {
    schema: value.schema,
    tenantId: value.tenantId,
    requestDigest: value.requestDigest,
    corpusDigest: value.corpusDigest,
    modelId: value.modelId,
    modelRevision: value.modelRevision,
    indexDigest: value.indexDigest,
    scores: value.scores,
  });
}

export function createSkillVectorAuthority({
  tenantId: tenantIdInput,
  provider,
  verifier,
} = {}) {
  const tenantId = identifier(tenantIdInput, "tenantId");
  const scoreProvider = capture(provider, "score", "Skill vector provider");
  const verifyResult = capture(verifier, "verify", "Skill vector verifier");
  const authority = Object.freeze({
    tenantId,
    async score({ query: queryInput, skills } = {}) {
      const query = boundedText(queryInput, "Skill vector query");
      const corpus = corpusFor(skills);
      const corpusDigest = hash(
        "chainlesschain.skill-vector-corpus/v1",
        corpus,
      );
      const requestCore = {
        schema: SKILL_VECTOR_REQUEST_SCHEMA,
        tenantId,
        query,
        corpusDigest,
        corpus,
      };
      const request = Object.freeze({
        ...requestCore,
        requestDigest: hash(SKILL_VECTOR_REQUEST_SCHEMA, requestCore),
      });
      const result = exact(
        await scoreProvider(request),
        RESULT_KEYS,
        "Skill vector result",
      );
      if (
        result.schema !== SKILL_VECTOR_RESULT_SCHEMA ||
        result.tenantId !== tenantId ||
        result.requestDigest !== request.requestDigest ||
        result.corpusDigest !== corpusDigest ||
        !SAFE_ID.test(result.modelId ?? "") ||
        !SAFE_ID.test(result.modelRevision ?? "") ||
        !DIGEST.test(result.indexDigest ?? "") ||
        !DIGEST.test(result.resultDigest ?? "") ||
        !Array.isArray(result.scores) ||
        utilTypes.isProxy(result.scores) ||
        result.scores.length !== corpus.length
      ) {
        throw new Error("Skill vector result is not authoritative");
      }
      const expected = new Set(corpus.map(({ digest }) => digest));
      const scores = new Map();
      for (const [index, input] of result.scores.entries()) {
        const entry = exact(input, SCORE_KEYS, `Skill vector scores[${index}]`);
        if (
          !expected.has(entry.digest) ||
          scores.has(entry.digest) ||
          typeof entry.score !== "number" ||
          !Number.isFinite(entry.score) ||
          entry.score < 0 ||
          entry.score > 1
        ) {
          throw new Error("Skill vector scores are invalid or incomplete");
        }
        scores.set(entry.digest, entry.score);
      }
      if (scores.size !== expected.size) {
        throw new Error("Skill vector scores are invalid or incomplete");
      }
      exact(result.attestation, ATTESTATION_KEYS, "Skill vector attestation");
      if (
        result.attestation.schema !== SKILL_VECTOR_ATTESTATION_SCHEMA ||
        !SAFE_ID.test(result.attestation.algorithm ?? "") ||
        !SAFE_ID.test(result.attestation.keyId ?? "") ||
        typeof result.attestation.value !== "string" ||
        result.attestation.value.length < 16 ||
        result.attestation.value.length > 4096
      ) {
        throw new Error("Skill vector attestation is invalid");
      }
      if (result.resultDigest !== digestSkillVectorResult(result)) {
        throw new Error("Skill vector result integrity is invalid");
      }
      const verification = exact(
        await verifyResult({
          tenantId,
          requestDigest: request.requestDigest,
          resultDigest: result.resultDigest,
          attestation: result.attestation,
        }),
        VERIFICATION_KEYS,
        "Skill vector verification",
      );
      if (
        verification.authenticated !== true ||
        verification.durable !== true ||
        verification.tenantId !== tenantId ||
        verification.requestDigest !== request.requestDigest ||
        verification.resultDigest !== result.resultDigest ||
        !DIGEST.test(verification.receiptDigest ?? "")
      ) {
        throw new Error("Skill vector result is not independently verified");
      }
      return Object.freeze({
        scores: Object.freeze(Object.fromEntries(scores)),
        evidence: Object.freeze({
          schema: SKILL_VECTOR_AUTHORITY_SCHEMA,
          status: "verified",
          tenantId,
          requestDigest: request.requestDigest,
          corpusDigest,
          skillCount: corpus.length,
          modelId: result.modelId,
          modelRevision: result.modelRevision,
          indexDigest: result.indexDigest,
          resultDigest: result.resultDigest,
          receiptDigest: verification.receiptDigest,
        }),
      });
    },
  });
  AUTHORITIES.add(authority);
  return authority;
}

export function captureSkillVectorAuthority(value) {
  if (!AUTHORITIES.has(value)) {
    throw new TypeError("a branded Skill vector authority is required");
  }
  return value;
}

export function unavailableSkillVectorEvidence(
  code = "CC_SKILL_VECTOR_AUTHORITY_UNCONFIGURED",
) {
  if (!/^CC_SKILL_VECTOR_[A-Z0-9_]{1,96}$/u.test(code)) {
    throw new TypeError("Skill vector unavailable code is invalid");
  }
  return Object.freeze({
    schema: SKILL_VECTOR_AUTHORITY_SCHEMA,
    status: "unavailable",
    code,
  });
}
