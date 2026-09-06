import { createHash } from "node:crypto";
import { types as utilTypes } from "node:util";

import {
  EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA,
  isEvolutionLedgerArtifactResolver,
} from "./evolution-artifact-ports.js";
import {
  EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA,
  EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA,
} from "./evolution-ledger.js";
import {
  WIKI_REVISION_SCHEMA,
  digestWikiState,
} from "./evidence-backed-wiki-maintainer.js";
import { captureWikiRevisionReader } from "./wiki-maintainer-ledger-adapter.js";
import { verifyWikiRevision } from "./wiki-revision-protocol.js";

export const GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_SCHEMA =
  "chainlesschain.governed-knowledge-quarantine-release/v1";
export const GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_REQUEST_SCHEMA =
  "chainlesschain.governed-knowledge-quarantine-release-request/v1";
export const GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_EVENT_TYPE =
  "knowledge.quarantine-release.committed";
export const GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_CORRUPT_CODE =
  "CC_GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_CORRUPT";

const ARTIFACT_TYPE = "governed-knowledge-quarantine-release";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,255}$/u;
const RELEASES = new WeakSet();
const DECISIONS = new WeakMap();
const DEPENDENCY_KEYS = new Set(["kind", "digest", "disposition"]);
const DESCRIPTOR_KEYS = new Set([
  "authorityId",
  "handlerArtifactDigest",
  "revision",
]);
const VERIFICATION_KEYS = new Set([
  "authenticated",
  "durable",
  "authorityId",
  "authorityRevision",
  "handlerArtifactDigest",
  "requestDigest",
  "receiptDigest",
  "decision",
  "verifiedAt",
]);
const REQUEST_KEYS = new Set([
  "schema",
  "tenantId",
  "operationDigest",
  "knowledgeId",
  "contentDigest",
  "dependencies",
  "preparedRecordDigest",
  "settlementRecordDigest",
  "reason",
  "requestDigest",
]);
const RECORD_KEYS = new Set([
  "schema",
  "tenantId",
  "operationDigest",
  "knowledgeId",
  "contentDigest",
  "dependencies",
  "preparedRecordDigest",
  "settlementRecordDigest",
  "reason",
  "requestDigest",
  "approval",
  "evaluation",
  "committedAt",
  "recordDigest",
]);

function fail(message) {
  const error = new Error(message);
  error.code = GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_CORRUPT_CODE;
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
    throw new TypeError(`${label} must be a plain object`);
  }
  const actual = Reflect.ownKeys(value);
  if (
    actual.length !== keys.size ||
    actual.some((key) => typeof key !== "string" || !keys.has(key)) ||
    actual.some(
      (key) =>
        !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
    )
  ) {
    throw new TypeError(`${label} has an invalid shape`);
  }
  return value;
}

function identifier(value, label) {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new TypeError(`${label} is invalid`);
  }
  return value;
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

function wikiHash(value) {
  return `sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`;
}

function clone(value) {
  return structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function capture(owner, method, label) {
  if (!owner || typeof owner !== "object" || utilTypes.isProxy(owner)) {
    throw new TypeError(`${label}.${method}() is required`);
  }
  const implementation = owner[method];
  if (
    typeof implementation !== "function" ||
    utilTypes.isProxy(implementation)
  ) {
    throw new TypeError(`${label}.${method}() must be a non-proxy function`);
  }
  return (...args) => Reflect.apply(implementation, owner, args);
}

function authorityDescriptor(input, label) {
  exact(input, DESCRIPTOR_KEYS, `${label} descriptor`);
  if (
    !Number.isSafeInteger(input.revision) ||
    input.revision < 1 ||
    !DIGEST.test(input.handlerArtifactDigest ?? "")
  ) {
    throw new TypeError(`${label} descriptor is invalid`);
  }
  return freeze({
    authorityId: identifier(input.authorityId, `${label} authorityId`),
    revision: input.revision,
    handlerArtifactDigest: input.handlerArtifactDigest,
  });
}

function decisionAuthority(input, label, decision) {
  exact(input, new Set(["descriptor", "verify"]), label);
  const descriptor = authorityDescriptor(input.descriptor, label);
  const verify = capture(input, "verify", label);
  return Object.freeze({ descriptor, verify, decision });
}

function validateVerification(value, request, authority) {
  exact(value, VERIFICATION_KEYS, `${authority.decision} verification`);
  if (
    value.authenticated !== true ||
    value.durable !== true ||
    value.authorityId !== authority.descriptor.authorityId ||
    value.authorityRevision !== authority.descriptor.revision ||
    value.handlerArtifactDigest !==
      authority.descriptor.handlerArtifactDigest ||
    value.requestDigest !== request.requestDigest ||
    value.decision !== authority.decision ||
    !DIGEST.test(value.receiptDigest ?? "") ||
    !Number.isFinite(Date.parse(value.verifiedAt)) ||
    new Date(Date.parse(value.verifiedAt)).toISOString() !== value.verifiedAt
  ) {
    throw new Error(
      `quarantine release ${authority.decision} was not independently verified`,
    );
  }
  return freeze(clone(value));
}

function validateStoredVerification(value, request, decision) {
  exact(value, VERIFICATION_KEYS, `stored ${decision} verification`);
  if (
    value.authenticated !== true ||
    value.durable !== true ||
    !ID.test(value.authorityId ?? "") ||
    !Number.isSafeInteger(value.authorityRevision) ||
    value.authorityRevision < 1 ||
    !DIGEST.test(value.handlerArtifactDigest ?? "") ||
    value.requestDigest !== request.requestDigest ||
    !DIGEST.test(value.receiptDigest ?? "") ||
    value.decision !== decision ||
    !Number.isFinite(Date.parse(value.verifiedAt)) ||
    new Date(Date.parse(value.verifiedAt)).toISOString() !== value.verifiedAt
  ) {
    fail(`stored ${decision} verification is invalid`);
  }
  return value;
}

export function createGovernedKnowledgeQuarantineReleaseDecisionAuthority({
  approval,
  evaluation,
} = {}) {
  if (approval === evaluation) {
    throw new TypeError(
      "quarantine release approval and evaluation must be independent",
    );
  }
  const approvalAuthority = decisionAuthority(
    approval,
    "approval authority",
    "approved",
  );
  const evaluationAuthority = decisionAuthority(
    evaluation,
    "evaluation authority",
    "passed",
  );
  if (
    approvalAuthority.descriptor.authorityId ===
      evaluationAuthority.descriptor.authorityId ||
    approvalAuthority.descriptor.handlerArtifactDigest ===
      evaluationAuthority.descriptor.handlerArtifactDigest
  ) {
    throw new TypeError(
      "quarantine release approval and evaluation identities must differ",
    );
  }
  const authority = Object.freeze({
    approval: approvalAuthority.descriptor,
    evaluation: evaluationAuthority.descriptor,
  });
  DECISIONS.set(
    authority,
    Object.freeze(async ({ request, approvalReceipt, evaluationReceipt }) => {
      const approvalResult = validateVerification(
        await approvalAuthority.verify({
          request: freeze(clone(request)),
          receipt: freeze(clone(approvalReceipt)),
        }),
        request,
        approvalAuthority,
      );
      const evaluationResult = validateVerification(
        await evaluationAuthority.verify({
          request: freeze(clone(request)),
          receipt: freeze(clone(evaluationReceipt)),
        }),
        request,
        evaluationAuthority,
      );
      if (approvalResult.receiptDigest === evaluationResult.receiptDigest) {
        throw new Error(
          "quarantine release approval and evaluation receipts must differ",
        );
      }
      return freeze({
        approval: approvalResult,
        evaluation: evaluationResult,
      });
    }),
  );
  return authority;
}

function normalizeDependency(value) {
  exact(value, DEPENDENCY_KEYS, "quarantine release dependency");
  if (
    !["active-skill", "candidate", "wiki"].includes(value.kind) ||
    !DIGEST.test(value.digest ?? "") ||
    value.disposition !== "quarantine"
  ) {
    throw new TypeError("quarantine release dependency is invalid");
  }
  return { kind: value.kind, digest: value.digest, disposition: "quarantine" };
}

function normalizeDependencies(value) {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > 256 ||
    Object.keys(value).length !== value.length
  ) {
    throw new TypeError("quarantine release dependencies are invalid");
  }
  const dependencies = value.map(normalizeDependency);
  const identities = dependencies.map(
    (item) => `${item.kind}\0${item.digest}\0${item.disposition}`,
  );
  if (new Set(identities).size !== identities.length) {
    throw new TypeError("quarantine release dependencies must be unique");
  }
  return dependencies;
}

function validateRequest(value, tenantId) {
  exact(value, REQUEST_KEYS, "quarantine release request");
  const dependencies = normalizeDependencies(value.dependencies);
  if (
    value.schema !== GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_REQUEST_SCHEMA ||
    value.tenantId !== tenantId ||
    !DIGEST.test(value.operationDigest ?? "") ||
    !ID.test(value.knowledgeId ?? "") ||
    !DIGEST.test(value.contentDigest ?? "") ||
    !DIGEST.test(value.preparedRecordDigest ?? "") ||
    !DIGEST.test(value.settlementRecordDigest ?? "") ||
    typeof value.reason !== "string" ||
    value.reason.trim() !== value.reason ||
    value.reason.length < 8 ||
    value.reason.length > 2048
  ) {
    throw new TypeError("quarantine release request binding is invalid");
  }
  const core = clone(value);
  delete core.requestDigest;
  if (
    value.requestDigest !==
    hash(GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_REQUEST_SCHEMA, core)
  ) {
    throw new TypeError("quarantine release request digest is invalid");
  }
  return freeze({ ...clone(value), dependencies });
}

function recordCore(value) {
  const core = clone(value);
  delete core.recordDigest;
  return core;
}

export function digestGovernedKnowledgeQuarantineRelease(value) {
  return hash(GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_SCHEMA, recordCore(value));
}

export function verifyGovernedKnowledgeQuarantineReleaseRecord(
  value,
  { tenantId } = {},
) {
  exact(value, RECORD_KEYS, "quarantine release record");
  const request = validateRequest(
    {
      schema: GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_REQUEST_SCHEMA,
      tenantId: value.tenantId,
      operationDigest: value.operationDigest,
      knowledgeId: value.knowledgeId,
      contentDigest: value.contentDigest,
      dependencies: value.dependencies,
      preparedRecordDigest: value.preparedRecordDigest,
      settlementRecordDigest: value.settlementRecordDigest,
      reason: value.reason,
      requestDigest: value.requestDigest,
    },
    tenantId,
  );
  validateStoredVerification(value.approval, request, "approved");
  validateStoredVerification(value.evaluation, request, "passed");
  if (
    value.schema !== GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_SCHEMA ||
    value.tenantId !== tenantId ||
    value.approval.authenticated !== true ||
    value.approval.durable !== true ||
    value.approval.decision !== "approved" ||
    value.approval.requestDigest !== request.requestDigest ||
    value.evaluation.authenticated !== true ||
    value.evaluation.durable !== true ||
    value.evaluation.decision !== "passed" ||
    value.evaluation.requestDigest !== request.requestDigest ||
    value.approval.authorityId === value.evaluation.authorityId ||
    value.approval.handlerArtifactDigest ===
      value.evaluation.handlerArtifactDigest ||
    value.approval.receiptDigest === value.evaluation.receiptDigest ||
    !Number.isFinite(Date.parse(value.committedAt)) ||
    new Date(Date.parse(value.committedAt)).toISOString() !==
      value.committedAt ||
    value.recordDigest !== digestGovernedKnowledgeQuarantineRelease(value)
  ) {
    fail("quarantine release record binding is invalid");
  }
  return freeze(clone(value));
}

function normalizeDescriptor(input) {
  return freeze({
    tenantId: identifier(input?.tenantId, "tenantId"),
    artifactTenantId: identifier(input?.artifactTenantId, "artifactTenantId"),
    streamId: identifier(input?.streamId, "streamId"),
    audience: identifier(input?.audience, "audience"),
    purpose: identifier(input?.purpose, "purpose"),
  });
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
    fail("quarantine release artifact resolution is incomplete");
  }
  let artifact;
  try {
    artifact = JSON.parse(resolution.bytes.toString("utf8"));
  } catch {
    fail("quarantine release artifact is not JSON");
  }
  if (
    artifact?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
    artifact.tenantId !== descriptor.artifactTenantId ||
    artifact.audience !== descriptor.audience ||
    artifact.purpose !== descriptor.purpose ||
    artifact.retention !== "ledger" ||
    artifact.type !== ARTIFACT_TYPE
  ) {
    fail("quarantine release durable artifact binding is invalid");
  }
  return verifyGovernedKnowledgeQuarantineReleaseRecord(artifact.value, {
    tenantId: descriptor.tenantId,
  });
}

function appendWikiReleaseLog(state, patternId, release) {
  const entry = {
    sequence: state.evolutionLog.length + 1,
    type: "pattern-quarantine-released",
    subjectId: patternId,
    effectiveAt: release.committedAt,
    details: {
      operationDigest: release.operationDigest,
      releaseRecordDigest: release.recordDigest,
    },
  };
  entry.entryDigest = wikiHash(entry);
  state.evolutionLog.push(entry);
}

function hasWikiReleaseLog(state, patternId, release) {
  return state.evolutionLog.some(
    (entry) =>
      entry.type === "pattern-quarantine-released" &&
      entry.subjectId === patternId &&
      entry.details?.operationDigest === release.operationDigest &&
      entry.details?.releaseRecordDigest === release.recordDigest,
  );
}

function wikiReleaseRevision({
  current,
  original,
  targetIds,
  release,
  reader,
}) {
  const state = clone(current.state);
  for (const patternId of targetIds) {
    const before = original.state.patterns[patternId];
    const quarantined = state.patterns[patternId];
    if (!before || !quarantined) {
      throw new Error("quarantine release Wiki target is missing");
    }
    if (quarantined.status !== "quarantined") {
      throw new Error(
        "quarantine release cannot overwrite a non-quarantined Wiki target",
      );
    }
    state.patterns[patternId] = clone(before);
    state.patterns[patternId].updatedAt = release.committedAt;
    appendWikiReleaseLog(state, patternId, release);
  }
  state.index = Object.values(state.patterns)
    .filter(
      (pattern) =>
        !["revoked", "tombstoned", "quarantined", "stale"].includes(
          pattern.status,
        ),
    )
    .map((pattern) => ({
      patternId: pattern.patternId,
      kind: pattern.kind,
      status: pattern.status,
      summary: pattern.summary,
      confidence: pattern.operationalConfidence,
      actionable: pattern.actionable,
      skillNames: pattern.skillNames,
    }))
    .sort((left, right) => left.patternId.localeCompare(right.patternId));
  state.revision += 1;
  const evidenceRefs = Object.keys(state.evidence ?? {})
    .sort()
    .slice(0, 1);
  if (evidenceRefs.length !== 1) {
    throw new Error(
      "quarantine release requires retained authenticated Wiki evidence",
    );
  }
  const operations = targetIds.map((patternId) => ({
    type: "release-quarantine",
    patternId,
    releaseRecordDigest: release.recordDigest,
  }));
  const payload = {
    schema: WIKI_REVISION_SCHEMA,
    tenantId: reader.descriptor.tenantId,
    evolutionRunId: reader.descriptor.evolutionRunId,
    revision: state.revision,
    priorStateDigest: current.stateDigest,
    rulesDigest: original.rulesDigest,
    maintainerModel: original.maintainerModel,
    effectiveAt: release.committedAt,
    evidenceRefs,
    operationDigest: wikiHash(operations),
  };
  state.revisionId = `wiki:${wikiHash(payload).slice(7)}`;
  return freeze({
    ...payload,
    revisionId: state.revisionId,
    stateDigest: digestWikiState(state),
    state: freeze(state),
  });
}

export class GovernedKnowledgeQuarantineReleaseLedger {
  constructor({
    descriptor: input,
    artifactPorts,
    ledger,
    ledgerArtifactResolver,
    dependencyExecutor,
    decisionAuthority,
    now = Date.now,
  } = {}) {
    this.descriptor = normalizeDescriptor(input);
    this._put = capture(artifactPorts, "putCanonical", "artifactPorts");
    this._readLedger = capture(ledger, "read", "ledger");
    this._verifyLedger = capture(ledger, "verify", "ledger");
    this._append = capture(ledger, "appendDomainEvent", "ledger");
    if (!isEvolutionLedgerArtifactResolver(ledgerArtifactResolver)) {
      throw new TypeError(
        "a branded EvolutionArtifactPorts ledger resolver is required",
      );
    }
    if (typeof now !== "function" || utilTypes.isProxy(now)) {
      throw new TypeError("now must be a non-proxy function");
    }
    const verifyDecision = DECISIONS.get(decisionAuthority);
    if (!verifyDecision) {
      throw new TypeError(
        "a governed quarantine release decision authority is required",
      );
    }
    this._resolve = ledgerArtifactResolver;
    this._ledger = ledger;
    this._readPrepared = capture(
      dependencyExecutor,
      "readPrepared",
      "dependencyExecutor",
    );
    this._readSettlement = capture(
      dependencyExecutor,
      "readSettlement",
      "dependencyExecutor",
    );
    this._verifyDecision = verifyDecision;
    this._now = now;
    Object.freeze(this);
    RELEASES.add(this);
  }

  _events() {
    const events = this._readLedger();
    if (!Array.isArray(events)) fail("EvolutionLedger returned no events");
    return events.filter(
      (event) =>
        event.schema === EVOLUTION_LEDGER_DOMAIN_EVENT_SCHEMA &&
        event.tenantId === this.descriptor.tenantId &&
        event.type === GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_EVENT_TYPE,
    );
  }

  async _entry(operationDigest) {
    const eventId = `${GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_EVENT_TYPE}.${operationDigest.slice(7)}`;
    const matches = this._events().filter((event) => event.eventId === eventId);
    if (matches.length > 1) fail("quarantine release event is ambiguous");
    if (matches.length === 0) return null;
    const event = matches[0];
    const identity = this._verifyLedger();
    const resolution = await this._resolve({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.ref !== event.subjectRef.ref ||
      resolution?.digest !== event.subjectRef.digest
    ) {
      fail("quarantine release resolved a substituted artifact");
    }
    const record = parseArtifact(resolution, this.descriptor);
    if (
      record.operationDigest !== operationDigest ||
      event.correlationId !== this.descriptor.streamId ||
      event.decision !== "committed" ||
      event.timestamp !== record.committedAt ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length !== 0
    ) {
      fail("quarantine release event binding is invalid");
    }
    return { event, record };
  }

  async read({ operationDigest } = {}) {
    if (!RELEASES.has(this) || !DIGEST.test(operationDigest ?? "")) {
      throw new TypeError("quarantine release operation identity is invalid");
    }
    const entry = await this._entry(operationDigest);
    return entry === null
      ? null
      : freeze({
          authenticated: true,
          durable: true,
          record: clone(entry.record),
        });
  }

  async _wikiRevision(reader, revisionId) {
    const eventId = `wiki.revision.${revisionId.slice("wiki:".length)}`;
    const matches = this._readLedger().filter(
      (event) =>
        event.type === "wiki.revision.committed" &&
        event.eventId === eventId &&
        event.tenantId === this.descriptor.tenantId &&
        event.correlationId === reader.descriptor.evolutionRunId,
    );
    if (matches.length !== 1) {
      throw new Error(
        "quarantine release Wiki revision is missing or ambiguous",
      );
    }
    const event = matches[0];
    const identity = this._verifyLedger();
    const resolution = await this._resolve({
      epoch: identity.epoch,
      ledgerId: identity.ledgerId,
      ref: event.subjectRef,
      tenantId: this.descriptor.artifactTenantId,
    });
    if (
      resolution?.schema !== EVOLUTION_ARTIFACT_RESOLUTION_SCHEMA ||
      resolution.authenticated !== true ||
      resolution.found !== true ||
      resolution.ref !== event.subjectRef.ref ||
      resolution.digest !== event.subjectRef.digest ||
      !Buffer.isBuffer(resolution.bytes)
    ) {
      fail("quarantine release Wiki revision resolution is invalid");
    }
    let artifact;
    try {
      artifact = JSON.parse(resolution.bytes.toString("utf8"));
    } catch {
      fail("quarantine release Wiki revision artifact is not JSON");
    }
    if (
      artifact?.schema !== EVOLUTION_DURABLE_ARTIFACT_RECORD_SCHEMA ||
      artifact.tenantId !== this.descriptor.artifactTenantId ||
      artifact.audience !== this.descriptor.audience ||
      artifact.purpose !== this.descriptor.purpose ||
      artifact.retention !== "ledger" ||
      artifact.type !== "wiki-revision"
    ) {
      fail("quarantine release Wiki revision artifact binding is invalid");
    }
    return verifyWikiRevision(artifact.value, reader.descriptor);
  }

  async restoreWikis({ operationDigest, wikiAdapters } = {}) {
    if (!RELEASES.has(this) || !DIGEST.test(operationDigest ?? "")) {
      throw new TypeError("quarantine release operation identity is invalid");
    }
    if (
      !Array.isArray(wikiAdapters) ||
      wikiAdapters.length < 1 ||
      wikiAdapters.length > 64 ||
      Object.keys(wikiAdapters).length !== wikiAdapters.length ||
      new Set(wikiAdapters).size !== wikiAdapters.length
    ) {
      throw new TypeError("quarantine release Wiki adapters are invalid");
    }
    const entry = await this._entry(operationDigest);
    if (!entry) {
      throw new Error("quarantine release was not durably committed");
    }
    const release = entry.record;
    const dependencies = release.dependencies.filter(
      (dependency) => dependency.kind === "wiki",
    );
    if (dependencies.length === 0) {
      return freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        operationDigest,
        results: [],
      });
    }
    const bindings = wikiAdapters.map((adapter) => {
      const reader = captureWikiRevisionReader(adapter);
      if (
        reader.descriptor.tenantId !== this.descriptor.tenantId ||
        !reader.matchesLedger(this._ledger)
      ) {
        throw new TypeError(
          "quarantine release Wiki adapter must share the genuine tenant Ledger",
        );
      }
      return {
        adapter,
        reader,
        commit: capture(adapter, "commitRevision", "wikiAdapter"),
      };
    });
    const results = [];
    for (const dependency of dependencies) {
      const matches = bindings
        .map((binding) => ({
          binding,
          original: binding.reader.findStateRevision({
            tenantId: this.descriptor.tenantId,
            stateDigest: dependency.digest,
          }),
        }))
        .filter((entryValue) => entryValue.original !== null);
      if (matches.length !== 1) {
        throw new Error(
          "quarantine release Wiki source is missing or ambiguous",
        );
      }
      const { binding, original } = matches[0];
      const provenance = binding.reader.readKnowledgeProvenance({
        tenantId: this.descriptor.tenantId,
        revisionId: original.revisionId,
        knowledgeId: release.knowledgeId,
        contentDigest: release.contentDigest,
      });
      if (
        provenance.authenticated !== true ||
        provenance.stateDigest !== dependency.digest ||
        !Array.isArray(provenance.affectedPatternIds) ||
        provenance.affectedPatternIds.length < 1
      ) {
        throw new Error(
          "quarantine release Wiki provenance is not authenticated and complete",
        );
      }
      const targetIds = provenance.affectedPatternIds;
      const originalRevision = await this._wikiRevision(
        binding.reader,
        original.revisionId,
      );
      let current = binding.reader.loadWiki();
      const alreadyRestored = targetIds.every(
        (patternId) =>
          current.state.patterns[patternId]?.status !== "quarantined" &&
          hasWikiReleaseLog(current.state, patternId, release),
      );
      if (!alreadyRestored) {
        const currentRevision = binding.reader.readStateRevision({
          tenantId: this.descriptor.tenantId,
          stateDigest: current.stateDigest,
        });
        const revision = wikiReleaseRevision({
          current,
          original: {
            ...original,
            rulesDigest: originalRevision.rulesDigest,
            maintainerModel: originalRevision.maintainerModel,
          },
          targetIds,
          release,
          reader: binding.reader,
        });
        let commitError = null;
        try {
          const expectedLedgerHead = Object.fromEntries(
            [
              "epoch",
              "ledgerId",
              "identityDigest",
              "sequence",
              "headDigest",
            ].map((key) => [key, currentRevision.ledgerHead[key]]),
          );
          binding.commit({
            expectedStateDigest: current.stateDigest,
            expectedLedgerHead,
            revision,
          });
        } catch (error) {
          commitError = error;
        }
        current = binding.reader.loadWiki();
        const completed = targetIds.every(
          (patternId) =>
            current.state.patterns[patternId]?.status !== "quarantined" &&
            hasWikiReleaseLog(current.state, patternId, release),
        );
        if (!completed) {
          if (commitError) throw commitError;
          throw new Error("quarantine release Wiki commit was not recovered");
        }
      }
      results.push({
        dependencyDigest: dependency.digest,
        evolutionRunId: binding.reader.descriptor.evolutionRunId,
        stateDigest: current.stateDigest,
        revisionId: current.state.revisionId,
        recovered: alreadyRestored,
      });
    }
    return freeze({
      authenticated: true,
      durable: true,
      recovered: results.every((result) => result.recovered),
      operationDigest,
      results,
    });
  }

  async commit({
    operationDigest,
    reason,
    approvalReceipt,
    evaluationReceipt,
  } = {}) {
    if (!RELEASES.has(this) || !DIGEST.test(operationDigest ?? "")) {
      throw new TypeError("quarantine release operation identity is invalid");
    }
    const prepared = this._readPrepared({ operationDigest });
    const settlement = this._readSettlement({ operationDigest });
    if (
      prepared?.authenticated !== true ||
      prepared.durable !== true ||
      settlement?.authenticated !== true ||
      settlement.durable !== true
    ) {
      throw new Error(
        "quarantine release requires settled authenticated dependency effects",
      );
    }
    const dependencies = normalizeDependencies(
      prepared.knowledge.dependencies.filter(
        (dependency) => dependency.disposition === "quarantine",
      ),
    );
    const requestCore = {
      schema: GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_REQUEST_SCHEMA,
      tenantId: this.descriptor.tenantId,
      operationDigest,
      knowledgeId: prepared.knowledge.knowledgeId,
      contentDigest: prepared.knowledge.contentDigest,
      dependencies,
      preparedRecordDigest: prepared.preparedRecordDigest,
      settlementRecordDigest: settlement.record.recordDigest,
      reason,
    };
    const request = validateRequest(
      {
        ...requestCore,
        requestDigest: hash(
          GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_REQUEST_SCHEMA,
          requestCore,
        ),
      },
      this.descriptor.tenantId,
    );
    const decisions = await this._verifyDecision({
      request,
      approvalReceipt,
      evaluationReceipt,
    });
    const existing = await this._entry(operationDigest);
    if (existing) {
      if (
        existing.record.requestDigest !== request.requestDigest ||
        canonical(existing.record.approval) !== canonical(decisions.approval) ||
        canonical(existing.record.evaluation) !==
          canonical(decisions.evaluation)
      ) {
        fail("quarantine release operation resolved different approval work");
      }
      return freeze({
        authenticated: true,
        durable: true,
        recovered: true,
        record: clone(existing.record),
      });
    }
    const milliseconds = Number(this._now());
    if (!Number.isFinite(milliseconds)) {
      throw new TypeError("quarantine release clock is invalid");
    }
    const core = {
      schema: GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_SCHEMA,
      ...Object.fromEntries(
        Object.entries(request).filter(([key]) => key !== "schema"),
      ),
      approval: decisions.approval,
      evaluation: decisions.evaluation,
      committedAt: new Date(milliseconds).toISOString(),
    };
    const record = verifyGovernedKnowledgeQuarantineReleaseRecord(
      {
        ...core,
        recordDigest: digestGovernedKnowledgeQuarantineRelease(core),
      },
      { tenantId: this.descriptor.tenantId },
    );
    const head = this._verifyLedger();
    const published = this._put(ARTIFACT_TYPE, record, {
      audience: this.descriptor.audience,
      purpose: this.descriptor.purpose,
      retention: "ledger",
    });
    if (
      !published?.ref ||
      published.receipt?.persisted !== true ||
      published.receipt?.readbackVerified !== true ||
      published.receipt?.integrityVerified !== true ||
      published.receipt?.retention !== "ledger"
    ) {
      fail("quarantine release artifact was not durably read back");
    }
    const eventId = `${GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_EVENT_TYPE}.${operationDigest.slice(7)}`;
    let recoveredAfterAppend = false;
    try {
      const receipt = await this._append(
        {
          artifactTenantId: this.descriptor.artifactTenantId,
          correlationId: this.descriptor.streamId,
          decision: "committed",
          eventId,
          reason: "governed knowledge quarantine released",
          skillName: null,
          sourceRefs: [],
          subjectRef: published.ref,
          tenantId: this.descriptor.tenantId,
          timestamp: record.committedAt,
          type: GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_EVENT_TYPE,
        },
        {
          expectedHeadDigest: head.headDigest,
          expectedSequence: head.sequence,
        },
      );
      if (receipt?.authenticated !== true || receipt.durable !== true) {
        fail("quarantine release append was not durably confirmed");
      }
    } catch (error) {
      const recovered = await this._entry(operationDigest);
      if (!recovered || canonical(recovered.record) !== canonical(record)) {
        throw error;
      }
      recoveredAfterAppend = true;
    }
    const stored = await this._entry(operationDigest);
    if (!stored || canonical(stored.record) !== canonical(record)) {
      fail("quarantine release readback differs after commit");
    }
    return freeze({
      authenticated: true,
      durable: true,
      recovered: recoveredAfterAppend,
      record: clone(record),
    });
  }
}

export function createGovernedKnowledgeQuarantineReleaseLedger(options) {
  return new GovernedKnowledgeQuarantineReleaseLedger(options);
}
