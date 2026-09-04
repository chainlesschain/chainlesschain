import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
  SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA,
  digestSkillRevocationDependencyRequest,
} from "./skill-revocation-propagation.js";

export const SKILL_RETRIEVAL_REVOCATION_STATE_SCHEMA =
  "chainlesschain.skill-retrieval-revocation-state/v1";
export const SKILL_RETRIEVAL_REVOCATION_READER_SCHEMA =
  "chainlesschain.skill-retrieval-revocation-reader/v1";
export const MAX_SKILL_RETRIEVAL_INVALIDATIONS = 10_000;

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const REQUEST_KEYS = new Set([
  "schema",
  "tenantId",
  "streamId",
  "operationId",
  "transitionDigest",
  "candidateId",
  "skillName",
  "occurredAt",
  "sourceReceiptDigest",
  "resolutionDigest",
  "dependency",
  "requestDigest",
]);
const DEPENDENCY_KEYS = new Set(["kind", "ref", "digest", "disposition"]);
const STATE_KEYS = new Set([
  "schema",
  "tenantId",
  "revision",
  "invalidations",
  "stateDigest",
]);
const INVALIDATION_KEYS = new Set([
  "skillName",
  "contentDigest",
  "transitionDigest",
  "sourceReceiptDigest",
  "propagationRequestDigest",
  "invalidatedAt",
]);
const LOAD_KEYS = new Set([
  "authenticated",
  "durable",
  "found",
  "state",
  "receiptDigest",
]);
const COMMIT_KEYS = new Set([
  "authenticated",
  "durable",
  "committed",
  "stateDigest",
  "receiptDigest",
]);
const readerBrand = new WeakSet();

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}

function hash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return Object.freeze(value);
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
    throw new TypeError(`${label} must contain exactly the supported fields`);
  }
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      throw new TypeError(`${label}.${String(key)} is unsafe`);
    }
  }
}

function id(value, label) {
  if (!ID.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) throw new TypeError(`${label} is invalid`);
  return value;
}

function timestamp(value, label) {
  if (typeof value !== "string" || new Date(value).toISOString() !== value) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
}

export function digestSkillRetrievalRevocationState(core) {
  return hash({ domain: SKILL_RETRIEVAL_REVOCATION_STATE_SCHEMA, ...core });
}

export function verifySkillRetrievalRevocationState(value, tenantId) {
  exact(value, STATE_KEYS, "retrieval revocation state");
  if (
    value.schema !== SKILL_RETRIEVAL_REVOCATION_STATE_SCHEMA ||
    value.tenantId !== tenantId ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 1
  ) {
    throw new Error("Retrieval revocation state authority is invalid");
  }
  exact(
    value.invalidations,
    new Set(Object.keys(value.invalidations)),
    "invalidations",
  );
  const entries = Object.entries(value.invalidations);
  if (entries.length > MAX_SKILL_RETRIEVAL_INVALIDATIONS) {
    throw new Error("Retrieval revocation capacity exceeded");
  }
  for (const [contentDigest, entry] of entries) {
    digest(contentDigest, "invalidation content digest");
    exact(entry, INVALIDATION_KEYS, "retrieval invalidation");
    id(entry.skillName, "invalidation skillName");
    if (entry.contentDigest !== contentDigest) {
      throw new Error("Retrieval invalidation key is not digest-bound");
    }
    digest(entry.transitionDigest, "invalidation transitionDigest");
    digest(entry.sourceReceiptDigest, "invalidation sourceReceiptDigest");
    digest(entry.propagationRequestDigest, "invalidation requestDigest");
    timestamp(entry.invalidatedAt, "invalidation invalidatedAt");
  }
  const core = {
    schema: value.schema,
    tenantId: value.tenantId,
    revision: value.revision,
    invalidations: value.invalidations,
  };
  if (value.stateDigest !== digestSkillRetrievalRevocationState(core)) {
    throw new Error("Retrieval revocation state digest is invalid");
  }
  return freeze(structuredClone(value));
}

function normalizeRequest(request, tenantId) {
  exact(request, REQUEST_KEYS, "retrieval invalidation request");
  exact(
    request.dependency,
    DEPENDENCY_KEYS,
    "retrieval invalidation dependency",
  );
  id(request.skillName, "request.skillName");
  id(request.streamId, "request.streamId");
  id(request.operationId, "request.operationId");
  const expectedRef = `skill-content:${tenantId}:${request.skillName}`;
  if (
    request.schema !== SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA ||
    request.tenantId !== tenantId ||
    request.dependency.kind !== "retrieval-index" ||
    request.dependency.disposition !== "invalidate" ||
    request.dependency.ref !== expectedRef ||
    request.requestDigest !== digestSkillRevocationDependencyRequest(request)
  ) {
    throw new Error("Retrieval invalidation request is not exactly bound");
  }
  digest(request.dependency.digest, "request.dependency.digest");
  digest(request.transitionDigest, "request.transitionDigest");
  digest(request.candidateId, "request.candidateId");
  digest(request.sourceReceiptDigest, "request.sourceReceiptDigest");
  digest(request.resolutionDigest, "request.resolutionDigest");
  timestamp(request.occurredAt, "request.occurredAt");
  return request;
}

function matches(entry, request) {
  return (
    entry?.skillName === request.skillName &&
    entry.contentDigest === request.dependency.digest &&
    entry.transitionDigest === request.transitionDigest &&
    entry.sourceReceiptDigest === request.sourceReceiptDigest &&
    entry.propagationRequestDigest === request.requestDigest &&
    entry.invalidatedAt === request.occurredAt
  );
}

export async function openSkillRetrievalRevocationAuthority({
  tenantId,
  ports,
} = {}) {
  id(tenantId, "tenantId");
  if (
    !ports ||
    typeof ports.load !== "function" ||
    typeof ports.commit !== "function"
  ) {
    throw new TypeError("Retrieval revocation persistence ports are required");
  }
  const load = ports.load.bind(ports);
  const commit = ports.commit.bind(ports);
  let state = null;

  async function reload() {
    const loaded = await load({ tenantId });
    exact(loaded, LOAD_KEYS, "retrieval revocation load receipt");
    if (
      loaded.authenticated !== true ||
      loaded.durable !== true ||
      typeof loaded.found !== "boolean" ||
      !DIGEST.test(loaded.receiptDigest ?? "") ||
      (loaded.found ? loaded.state === null : loaded.state !== null)
    ) {
      throw new Error("Retrieval revocation load is not authoritative");
    }
    state = loaded.found
      ? verifySkillRetrievalRevocationState(loaded.state, tenantId)
      : null;
    return state;
  }

  await reload();
  const reader = {
    schema: SKILL_RETRIEVAL_REVOCATION_READER_SCHEMA,
    tenantId,
    inspect({ skillName, contentDigest } = {}) {
      id(skillName, "skillName");
      digest(contentDigest, "contentDigest");
      const entry = state?.invalidations[contentDigest] ?? null;
      if (entry !== null && entry.skillName !== skillName) {
        throw new Error("Retrieval invalidation crossed its skill identity");
      }
      return freeze({
        invalidated: entry !== null,
        tenantId,
        skillName,
        contentDigest,
        stateDigest: state?.stateDigest ?? null,
        receiptDigest: entry?.propagationRequestDigest ?? null,
      });
    },
    async invalidateRetrieval(input) {
      const request = normalizeRequest(input, tenantId);
      const contentDigest = request.dependency.digest;
      if (matches(state?.invalidations[contentDigest], request)) {
        return result(request, state.stateDigest);
      }
      if (state?.invalidations[contentDigest]) {
        throw new Error(
          "Retrieval content digest has a conflicting invalidation",
        );
      }
      if (
        Object.keys(state?.invalidations ?? {}).length >=
        MAX_SKILL_RETRIEVAL_INVALIDATIONS
      ) {
        throw new Error("Retrieval revocation capacity exceeded");
      }
      const core = {
        schema: SKILL_RETRIEVAL_REVOCATION_STATE_SCHEMA,
        tenantId,
        revision: (state?.revision ?? 0) + 1,
        invalidations: {
          ...(state?.invalidations ?? {}),
          [contentDigest]: {
            skillName: request.skillName,
            contentDigest,
            transitionDigest: request.transitionDigest,
            sourceReceiptDigest: request.sourceReceiptDigest,
            propagationRequestDigest: request.requestDigest,
            invalidatedAt: request.occurredAt,
          },
        },
      };
      const next = freeze({
        ...core,
        stateDigest: digestSkillRetrievalRevocationState(core),
      });
      try {
        const receipt = await commit({
          state: next,
          expectedStateDigest: state?.stateDigest ?? null,
        });
        exact(receipt, COMMIT_KEYS, "retrieval revocation commit receipt");
        if (
          receipt.authenticated !== true ||
          receipt.durable !== true ||
          receipt.committed !== true ||
          receipt.stateDigest !== next.stateDigest ||
          !DIGEST.test(receipt.receiptDigest ?? "")
        ) {
          throw new Error("Retrieval invalidation commit is not authoritative");
        }
        state = next;
      } catch (cause) {
        await reload();
        if (!matches(state?.invalidations[contentDigest], request)) throw cause;
      }
      return result(request, state.stateDigest);
    },
  };
  readerBrand.add(reader);
  return Object.freeze(reader);
}

function result(request, receiptDigest) {
  return freeze({
    schema: SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA,
    authenticated: true,
    durable: true,
    applied: true,
    idempotent: true,
    tenantId: request.tenantId,
    operationId: request.operationId,
    requestDigest: request.requestDigest,
    dependencyKind: request.dependency.kind,
    dependencyRef: request.dependency.ref,
    dependencyDigest: request.dependency.digest,
    disposition: request.dependency.disposition,
    receiptDigest,
  });
}

export function captureSkillRetrievalRevocationReader(reader) {
  if (
    !readerBrand.has(reader) ||
    reader.schema !== SKILL_RETRIEVAL_REVOCATION_READER_SCHEMA ||
    typeof reader.inspect !== "function"
  ) {
    throw new TypeError(
      "A branded Skill retrieval revocation reader is required",
    );
  }
  return reader;
}
