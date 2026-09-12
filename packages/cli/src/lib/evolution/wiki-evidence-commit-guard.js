import { randomUUID } from "node:crypto";
import { types } from "node:util";
import {
  captureWikiRevisionReader,
  WikiMaintainerLedgerAdapter,
} from "./wiki-maintainer-ledger-adapter.js";
import {
  digestWikiState,
  WIKI_EVIDENCE_SCHEMA,
  WIKI_PATTERN_STATUS,
} from "./evidence-backed-wiki-maintainer.js";
import { verifyWikiRevision } from "./wiki-revision-protocol.js";

export const WIKI_EVIDENCE_COMMIT_REQUEST_SCHEMA =
  "chainlesschain.wiki-evidence-commit-request/v1";
export const WIKI_EVIDENCE_COMMIT_LEASE_SCHEMA =
  "chainlesschain.wiki-evidence-commit-lease/v1";
export const WIKI_EVIDENCE_COMMIT_DENIED_CODE =
  "CC_WIKI_EVIDENCE_COMMIT_DENIED";
export const WIKI_EVIDENCE_COMMIT_RELEASE_FAILED_CODE =
  "CC_WIKI_EVIDENCE_COMMIT_RELEASE_FAILED";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const USED_LEASES = new WeakSet();
const TERMINAL = new Set([
  WIKI_PATTERN_STATUS.QUARANTINED,
  WIKI_PATTERN_STATUS.REVOKED,
  WIKI_PATTERN_STATUS.TOMBSTONED,
]);
const EVIDENCE_KEYS = [
  "schema",
  "tenantId",
  "ref",
  "sourceDigest",
  "projectionDigest",
  "artifactRef",
  "trustedProjection",
  "trustDomain",
  "kind",
  "status",
  "observedAt",
  "expiresAt",
  "data",
];
const LEASE_KEYS = [
  "schema",
  "tenantId",
  "runId",
  "requestDigest",
  "evidenceBindingDigest",
  "leaseId",
  "assertCurrent",
  "release",
];
function denied(message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = WIKI_EVIDENCE_COMMIT_DENIED_CODE;
  return error;
}
function record(value, label, keys) {
  if (
    !value ||
    typeof value !== "object" ||
    types.isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw denied(`${label} must be a plain non-Proxy record`);
  const own = Reflect.ownKeys(value);
  if (
    (keys &&
      (own.length !== keys.length || own.some((key) => !keys.includes(key)))) ||
    own.some(
      (key) =>
        typeof key !== "string" ||
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
    )
  )
    throw denied(`${label} must contain only exact own data fields`);
  return value;
}
function syncMethod(value, name, label) {
  const method = Object.getOwnPropertyDescriptor(value, name)?.value;
  if (
    typeof method !== "function" ||
    types.isProxy(method) ||
    types.isAsyncFunction(method) ||
    types.isGeneratorFunction(method)
  )
    throw denied(`${label}.${name} must be synchronous`);
  return (...args) => Reflect.apply(method, value, args);
}
// Copy before calling any host authority. No getters, toJSON, custom prototypes,
// proxies, sparse arrays or mutable aliases survive into the publish request.
function snapshot(value, budget = { nodes: 0, bytes: 0 }, depth = 0) {
  if (++budget.nodes > 100_000 || depth > 32)
    throw denied("Wiki revision exceeds its structural budget");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    budget.bytes += Buffer.byteLength(value, "utf8");
    if (budget.bytes > 1_048_576)
      throw denied("Wiki revision strings exceed their byte budget");
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "object" || types.isProxy(value))
    throw denied("Wiki revision is not plain data");
  if (Array.isArray(value)) {
    if (
      Object.getPrototypeOf(value) !== Array.prototype ||
      value.length > 100_000 ||
      Reflect.ownKeys(value).length !== value.length + 1
    )
      throw denied("Wiki revision array is not dense and bounded");
    const result = [];
    for (let i = 0; i < value.length; i++) {
      const entry = Object.getOwnPropertyDescriptor(value, String(i));
      if (!entry || !Object.hasOwn(entry, "value"))
        throw denied("Wiki revision array contains an accessor or hole");
      result.push(snapshot(entry.value, budget, depth + 1));
    }
    return Object.freeze(result);
  }
  record(value, "Wiki revision record");
  return Object.freeze(
    Object.fromEntries(
      Object.keys(value).map((key) => [
        key,
        snapshot(
          Object.getOwnPropertyDescriptor(value, key).value,
          budget,
          depth + 1,
        ),
      ]),
    ),
  );
}
function bindingsFor(revision) {
  const state = revision.state;
  record(state.evidence, "Wiki evidence map");
  record(state.patterns, "Wiki pattern map");
  const refs = new Set();
  const add = (ref) => {
    if (typeof ref !== "string" || !ref || !Object.hasOwn(state.evidence, ref))
      throw denied("Wiki dependency has no bound evidence");
    refs.add(ref);
    if (refs.size > 256)
      throw denied(
        "Wiki active dependencies exceed 256; none may be truncated",
      );
  };
  // Old evidence can be reused by upsert or merged into an existing pattern.
  // Therefore scope is the OUTPUT dependencies, not just this request's refs.
  for (const pattern of Object.values(state.patterns)) {
    if (TERMINAL.has(pattern.status)) continue;
    if (!Object.values(WIKI_PATTERN_STATUS).includes(pattern.status))
      throw denied("Wiki pattern status is invalid");
    for (const field of ["positiveEvidence", "negativeEvidence"]) {
      if (!Array.isArray(pattern[field]))
        throw denied("Wiki pattern dependencies are invalid");
      for (const ref of pattern[field]) add(ref);
    }
  }
  // Newly read active evidence is also admitted even when no pattern is made.
  // Terminal cleanup may retain old tombstones without reauthorizing learning.
  for (const ref of revision.evidenceRefs) {
    const item = state.evidence[ref];
    if (!item || !["active", "revoked", "deleted"].includes(item.status))
      throw denied("Wiki request evidence status is invalid");
    if (item.status === "active") add(ref);
  }
  return Object.freeze(
    [...refs].sort().map((ref) => {
      const item = record(
        state.evidence[ref],
        "Wiki evidence binding",
        EVIDENCE_KEYS,
      );
      if (
        item.schema !== WIKI_EVIDENCE_SCHEMA ||
        item.tenantId !== revision.tenantId ||
        item.ref !== ref ||
        item.trustedProjection !== true ||
        item.status !== "active" ||
        !DIGEST.test(item.sourceDigest) ||
        !DIGEST.test(item.projectionDigest) ||
        typeof item.artifactRef !== "string" ||
        !item.artifactRef ||
        typeof item.trustDomain !== "string" ||
        !item.trustDomain ||
        !["tool-observation", "grader-receipt"].includes(item.kind) ||
        !Number.isFinite(Date.parse(item.observedAt)) ||
        !Number.isFinite(Date.parse(item.expiresAt))
      )
        throw denied(
          "Wiki active dependency is not authenticated typed evidence",
        );
      record(item.data, "Wiki trusted metadata");
      for (const key of [
        "rawRecordDigest",
        "manifestDigest",
        "projectionReceiptDigest",
        "schemaDigest",
      ])
        if (!DIGEST.test(item.data[key]))
          throw denied("Wiki evidence identity digest is missing");
      return item;
    }),
  );
}

/**
 * Explicit host trust boundary. acquireCurrentEvidence MUST synchronously hold
 * a cross-evidence state/principal/ACL lock (or irrevocable scoped grant) until
 * release. A timestamp/read receipt alone is not that contract. Deployments must
 * prove the coordinator's cross-process semantics; this wrapper does not defend
 * against a malicious authority. The authority NEVER receives publish authority.
 */
export function createWikiEvidenceCommitGuard({
  wikiAdapter,
  commitCoordinator,
  principalEnvelope,
  clock = Date.now,
} = {}) {
  if (
    !wikiAdapter ||
    types.isProxy(wikiAdapter) ||
    Object.getPrototypeOf(wikiAdapter) !== WikiMaintainerLedgerAdapter.prototype
  )
    throw denied("a genuine production Wiki adapter is required");
  const reader = captureWikiRevisionReader(wikiAdapter);
  const publish = syncMethod(wikiAdapter, "commitRevision", "Wiki adapter");
  record(commitCoordinator, "Wiki commit coordinator", [
    "acquireCurrentEvidence",
  ]);
  const acquire = syncMethod(
    commitCoordinator,
    "acquireCurrentEvidence",
    "Wiki commit coordinator",
  );
  if (
    typeof principalEnvelope !== "string" ||
    !principalEnvelope ||
    principalEnvelope.length > 65_536 ||
    typeof clock !== "function" ||
    types.isProxy(clock) ||
    types.isAsyncFunction(clock)
  )
    throw denied("Wiki principal envelope and synchronous clock are required");
  let committing = false;
  return Object.freeze({
    commitRevision(input) {
      if (committing) throw denied("Wiki publication is not reentrant");
      const owned = snapshot(input);
      record(
        owned,
        "Wiki commit input",
        Object.hasOwn(owned, "expectedLedgerHead")
          ? ["expectedStateDigest", "revision", "expectedLedgerHead"]
          : ["expectedStateDigest", "revision"],
      );
      const revision = verifyWikiRevision(owned.revision, reader.descriptor);
      if (
        !DIGEST.test(owned.expectedStateDigest) ||
        owned.expectedStateDigest !== revision.priorStateDigest
      )
        throw denied("Wiki prior state is not bound to the publication");
      const evidenceBindings = bindingsFor(revision);
      const requestedAt = new Date(clock()).toISOString();
      if (
        evidenceBindings.some(
          (item) => Date.parse(item.expiresAt) <= Date.parse(requestedAt),
        )
      )
        throw denied("Wiki evidence expired before lease acquisition");
      const evidenceBindingDigest = digestWikiState({
        domain: "chainlesschain.wiki-evidence-bindings/v1",
        tenantId: reader.descriptor.tenantId,
        runId: reader.descriptor.evolutionRunId,
        evidenceBindings,
      });
      const core = Object.freeze({
        schema: WIKI_EVIDENCE_COMMIT_REQUEST_SCHEMA,
        tenantId: reader.descriptor.tenantId,
        runId: reader.descriptor.evolutionRunId,
        principalEnvelope,
        expectedStateDigest: owned.expectedStateDigest,
        revisionId: revision.revisionId,
        stateDigest: revision.stateDigest,
        evidenceRefs: revision.evidenceRefs,
        evidenceBindings,
        evidenceBindingDigest,
        requestNonce: randomUUID(),
        requestedAt,
      });
      const request = Object.freeze({
        ...core,
        requestDigest: digestWikiState(core),
      });
      let release;
      let receipt;
      let failure;
      committing = true;
      try {
        const lease = acquire(request);
        record(lease, "Wiki commit lease", LEASE_KEYS);
        if (!Object.isFrozen(lease))
          throw denied("Wiki commit lease must be immutable");
        if (USED_LEASES.has(lease))
          throw denied("Wiki commit lease cannot be reused");
        USED_LEASES.add(lease);
        release = syncMethod(lease, "release", "Wiki commit lease");
        const assertCurrent = syncMethod(
          lease,
          "assertCurrent",
          "Wiki commit lease",
        );
        if (
          lease.schema !== WIKI_EVIDENCE_COMMIT_LEASE_SCHEMA ||
          lease.tenantId !== request.tenantId ||
          lease.runId !== request.runId ||
          lease.requestDigest !== request.requestDigest ||
          lease.evidenceBindingDigest !== request.evidenceBindingDigest ||
          typeof lease.leaseId !== "string" ||
          !lease.leaseId ||
          lease.leaseId.length > 256
        )
          throw denied("Wiki commit lease is not bound to the entire request");
        if (assertCurrent() !== true)
          throw denied("Wiki commit lease is not currently held");
        // No await or host-supplied publish callback between lease and real write.
        receipt = publish(owned);
      } catch (error) {
        failure = error?.code
          ? error
          : denied("Wiki evidence commit authorization failed", error);
      } finally {
        let releaseFailure;
        try {
          if (release && release() !== undefined)
            releaseFailure = new Error(
              "Wiki commit lease release must be synchronous and return undefined",
            );
        } catch (error) {
          releaseFailure = error;
        }
        if (releaseFailure) {
          if (receipt?.committed === true) {
            failure = new Error(
              "Wiki was committed but its authorization lease failed to release",
              { cause: releaseFailure },
            );
            failure.code = WIKI_EVIDENCE_COMMIT_RELEASE_FAILED_CODE;
            failure.committed = true;
            failure.receipt = receipt;
          } else if (!failure)
            failure = denied(
              "Wiki commit lease failed to release",
              releaseFailure,
            );
        }
        committing = false;
      }
      if (failure) throw failure;
      return receipt;
    },
  });
}
