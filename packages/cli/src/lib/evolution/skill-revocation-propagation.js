import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  SKILL_WIKI_PILOT_OUTCOME_SCHEMA,
  SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA,
  captureSkillWikiReconciliationSource,
} from "./skill-wiki-reconciliation.js";

export const SKILL_REVOCATION_DEPENDENCY_RESOLUTION_SCHEMA =
  "chainlesschain.skill-revocation-dependency-resolution/v1";
export const SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA =
  "chainlesschain.skill-revocation-dependency-request/v1";
export const SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA =
  "chainlesschain.skill-revocation-dependency-result/v1";
export const SKILL_REVOCATION_PROPAGATION_CHECKPOINT_SCHEMA =
  "chainlesschain.skill-revocation-propagation-checkpoint/v1";
export const SKILL_REVOCATION_PROPAGATION_ERROR_CODE =
  "CC_SKILL_REVOCATION_PROPAGATION_INVALID";

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const DEPENDENCY_KINDS = Object.freeze([
  "wiki-pattern",
  "memory",
  "retrieval-index",
  "marketplace-badge",
]);
const DISPOSITIONS = Object.freeze({
  "wiki-pattern": "stale",
  memory: "quarantine",
  "retrieval-index": "invalidate",
  "marketplace-badge": "revoke",
});
const PORTS = Object.freeze({
  "wiki-pattern": "stalePattern",
  memory: "quarantineMemory",
  "retrieval-index": "invalidateRetrieval",
  "marketplace-badge": "revokeMarketplaceBadge",
});
const DEPENDENCY_KEYS = new Set(["kind", "ref", "digest", "disposition"]);
const RESOLUTION_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "transitionDigest",
  "candidateId",
  "skillName",
  "completeKinds",
  "dependencies",
  "resolutionDigest",
  "receiptDigest",
]);
const RESULT_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "applied",
  "idempotent",
  "tenantId",
  "operationId",
  "requestDigest",
  "dependencyKind",
  "dependencyRef",
  "dependencyDigest",
  "disposition",
  "receiptDigest",
]);
const CHECKPOINT_KEYS = new Set([
  "schema",
  "authenticated",
  "durable",
  "tenantId",
  "streamId",
  "cursor",
  "lastTransitionDigest",
  "resultDigest",
  "checkpointDigest",
]);
const CHECKPOINT_RECEIPT_KEYS = new Set([
  "authenticated",
  "durable",
  "committed",
  "checkpointDigest",
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
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function freeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return value;
}

function fail(message, options) {
  const error = new Error(message, options);
  error.code = SKILL_REVOCATION_PROPAGATION_ERROR_CODE;
  throw error;
}

function exact(value, keys, label) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    utilTypes.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) {
    fail(`${label} must be a plain record`);
  }
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.size ||
    own.some((key) => typeof key !== "string" || !keys.has(key))
  ) {
    fail(`${label} must contain exactly the supported fields`);
  }
  for (const key of own) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable) {
      fail(`${label}.${String(key)} must be an enumerable data field`);
    }
  }
}

function string(value, label, maximum = 512) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.trim() !== value ||
    Buffer.byteLength(value, "utf8") > maximum
  ) {
    fail(`${label} is invalid`);
  }
  return value;
}

function digest(value, label) {
  if (!DIGEST.test(value ?? "")) fail(`${label} must be sha256-bound`);
  return value;
}

function sequence(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive safe integer`);
  }
  return value;
}

function capture(owner, method, label = method) {
  if (
    !owner ||
    typeof owner !== "object" ||
    utilTypes.isProxy(owner) ||
    typeof owner[method] !== "function" ||
    utilTypes.isProxy(owner[method])
  ) {
    throw new TypeError(`${label}.${method} is required`);
  }
  return owner[method].bind(owner);
}

function normalizeResolution(value, outcome, tenantId) {
  exact(value, RESOLUTION_KEYS, "revocation dependency resolution");
  if (
    !Array.isArray(value.completeKinds) ||
    utilTypes.isProxy(value.completeKinds) ||
    canonical([...value.completeKinds].sort()) !==
      canonical([...DEPENDENCY_KINDS].sort()) ||
    !Array.isArray(value.dependencies) ||
    utilTypes.isProxy(value.dependencies) ||
    value.dependencies.length > 512
  ) {
    fail("revocation dependency resolution is incomplete or unbounded");
  }
  const dependencies = value.dependencies.map((entry, index) => {
    exact(entry, DEPENDENCY_KEYS, `dependency[${index}]`);
    const kind = string(entry.kind, `dependency[${index}].kind`, 64);
    const normalized = {
      kind,
      ref: string(entry.ref, `dependency[${index}].ref`, 1024),
      digest: digest(entry.digest, `dependency[${index}].digest`),
      disposition: string(
        entry.disposition,
        `dependency[${index}].disposition`,
        64,
      ),
    };
    if (
      !DEPENDENCY_KINDS.includes(kind) ||
      normalized.disposition !== DISPOSITIONS[kind]
    ) {
      fail(`dependency[${index}] has an unsafe disposition`);
    }
    return normalized;
  });
  dependencies.sort((left, right) =>
    `${left.kind}:${left.ref}`.localeCompare(`${right.kind}:${right.ref}`),
  );
  if (
    new Set(dependencies.map(({ kind, ref }) => `${kind}:${ref}`)).size !==
    dependencies.length
  ) {
    fail("revocation dependencies contain duplicates");
  }
  const core = {
    schema: SKILL_REVOCATION_DEPENDENCY_RESOLUTION_SCHEMA,
    tenantId,
    transitionDigest: outcome.transitionDigest,
    candidateId: outcome.candidateId,
    skillName: outcome.skillName,
    completeKinds: [...DEPENDENCY_KINDS],
    dependencies,
  };
  if (
    value.schema !== core.schema ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.tenantId !== tenantId ||
    value.transitionDigest !== outcome.transitionDigest ||
    value.candidateId !== outcome.candidateId ||
    value.skillName !== outcome.skillName ||
    value.resolutionDigest !== hash(core) ||
    !DIGEST.test(value.receiptDigest ?? "")
  ) {
    fail("revocation dependency resolution is not bound to the rollback");
  }
  return freeze({
    ...core,
    resolutionDigest: value.resolutionDigest,
    receiptDigest: value.receiptDigest,
  });
}

function requestFor(tenantId, streamId, outcome, resolution, dependency) {
  const core = {
    schema: SKILL_REVOCATION_DEPENDENCY_REQUEST_SCHEMA,
    tenantId,
    streamId,
    operationId: `skill-revocation:${outcome.transitionDigest.slice(7)}:${hash(dependency).slice(7)}`,
    transitionDigest: outcome.transitionDigest,
    candidateId: outcome.candidateId,
    skillName: outcome.skillName,
    occurredAt: outcome.occurredAt,
    sourceReceiptDigest: outcome.sourceReceiptDigest,
    resolutionDigest: resolution.resolutionDigest,
    dependency,
  };
  return freeze({
    ...core,
    requestDigest: digestSkillRevocationDependencyRequest(core),
  });
}

export function digestSkillRevocationDependencyRequest(value) {
  const core = structuredClone(value);
  delete core.requestDigest;
  return hash(core);
}

function normalizeResult(value, request, dependency, tenantId) {
  exact(value, RESULT_KEYS, "revocation dependency result");
  if (
    value.schema !== SKILL_REVOCATION_DEPENDENCY_RESULT_SCHEMA ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.applied !== true ||
    value.idempotent !== true ||
    value.tenantId !== tenantId ||
    value.operationId !== request.operationId ||
    value.requestDigest !== request.requestDigest ||
    value.dependencyKind !== dependency.kind ||
    value.dependencyRef !== dependency.ref ||
    value.dependencyDigest !== dependency.digest ||
    value.disposition !== dependency.disposition ||
    !DIGEST.test(value.receiptDigest ?? "")
  ) {
    fail("revocation dependency result is not durably bound");
  }
  return freeze(structuredClone(value));
}

function checkpointCore(tenantId, streamId, outcome, resultDigest) {
  return {
    schema: SKILL_REVOCATION_PROPAGATION_CHECKPOINT_SCHEMA,
    tenantId,
    streamId,
    cursor: outcome.sequence,
    lastTransitionDigest: outcome.transitionDigest,
    resultDigest,
  };
}

function normalizeCheckpoint(value, tenantId, streamId) {
  if (value == null) return null;
  exact(value, CHECKPOINT_KEYS, "revocation propagation checkpoint");
  const core = {
    schema: SKILL_REVOCATION_PROPAGATION_CHECKPOINT_SCHEMA,
    tenantId,
    streamId,
    cursor: sequence(value.cursor, "checkpoint.cursor"),
    lastTransitionDigest: digest(
      value.lastTransitionDigest,
      "checkpoint.lastTransitionDigest",
    ),
    resultDigest: digest(value.resultDigest, "checkpoint.resultDigest"),
  };
  if (
    value.schema !== core.schema ||
    value.authenticated !== true ||
    value.durable !== true ||
    value.tenantId !== tenantId ||
    value.streamId !== streamId ||
    value.checkpointDigest !== hash(core)
  ) {
    fail("revocation checkpoint is not durably tenant-bound");
  }
  return freeze({ ...core, checkpointDigest: value.checkpointDigest });
}

export class SkillRevocationPropagation {
  constructor({ source, ports, crashHook = null } = {}) {
    this.source = captureSkillWikiReconciliationSource(source);
    this._resolveDependencies = capture(ports, "resolveDependencies", "ports");
    this._effects = Object.fromEntries(
      Object.entries(PORTS).map(([kind, method]) => [
        kind,
        capture(ports, method, "ports"),
      ]),
    );
    this._loadCheckpoint = capture(ports, "loadCheckpoint", "ports");
    this._commitCheckpoint = capture(ports, "commitCheckpoint", "ports");
    if (crashHook !== null && typeof crashHook !== "function") {
      throw new TypeError("crashHook must be a function or null");
    }
    this._crashHook = crashHook;
    Object.freeze(this._effects);
    Object.freeze(this);
  }

  async _checkpoint() {
    return normalizeCheckpoint(
      await this._loadCheckpoint({
        tenantId: this.source.tenantId,
        streamId: this.source.streamId,
      }),
      this.source.tenantId,
      this.source.streamId,
    );
  }

  async _commit(next, previous) {
    try {
      const receipt = await this._commitCheckpoint({
        checkpoint: next,
        expectedCheckpointDigest: previous?.checkpointDigest ?? null,
      });
      exact(receipt, CHECKPOINT_RECEIPT_KEYS, "checkpoint commit receipt");
      if (
        receipt.authenticated !== true ||
        receipt.durable !== true ||
        receipt.committed !== true ||
        receipt.checkpointDigest !== next.checkpointDigest
      ) {
        fail("revocation checkpoint commit was not durably acknowledged");
      }
    } catch (cause) {
      const recovered = await this._checkpoint();
      if (recovered?.checkpointDigest !== next.checkpointDigest) {
        fail("revocation checkpoint commit could not be recovered", { cause });
      }
    }
  }

  async propagate({ limit = 64 } = {}) {
    let checkpoint = await this._checkpoint();
    const outcomes = await this.source.list({
      afterSequence: checkpoint?.cursor ?? 0,
      limit,
    });
    const processed = [];
    for (const outcome of outcomes) {
      if (
        outcome.schema !== SKILL_WIKI_PILOT_OUTCOME_SCHEMA &&
        outcome.schema !== SKILL_WIKI_REVOCATION_OUTCOME_SCHEMA
      ) {
        fail("revocation propagation requires a rollback or revoke source");
      }
      let results = [];
      if (["rollback", "revoke"].includes(outcome.outcome)) {
        const resolution = normalizeResolution(
          await this._resolveDependencies(outcome),
          outcome,
          this.source.tenantId,
        );
        for (const dependency of resolution.dependencies) {
          const request = requestFor(
            this.source.tenantId,
            this.source.streamId,
            outcome,
            resolution,
            dependency,
          );
          results.push(
            normalizeResult(
              await this._effects[dependency.kind](request),
              request,
              dependency,
              this.source.tenantId,
            ),
          );
        }
      }
      const resultDigest = hash(
        results.map(({ receiptDigest }) => receiptDigest),
      );
      if (this._crashHook) {
        await this._crashHook(
          "after-dependencies",
          freeze({ outcome, resultDigest }),
        );
      }
      const core = checkpointCore(
        this.source.tenantId,
        this.source.streamId,
        outcome,
        resultDigest,
      );
      const next = freeze({
        ...core,
        authenticated: true,
        durable: true,
        checkpointDigest: hash(core),
      });
      await this._commit(next, checkpoint);
      checkpoint = next;
      processed.push({
        sequence: outcome.sequence,
        outcome: outcome.outcome,
        effects: results.length,
        resultDigest,
      });
    }
    return freeze({
      processed: processed.length,
      cursor: checkpoint?.cursor ?? 0,
      outcomes: processed,
    });
  }
}

export function createSkillRevocationPropagation(options) {
  return new SkillRevocationPropagation(options);
}
