import { createHash } from "node:crypto";

export const WIKI_STATE_SCHEMA = "chainlesschain.evolution-wiki-state/v1";
export const WIKI_EVIDENCE_SCHEMA = "chainlesschain.evolution-wiki-evidence/v1";
export const WIKI_REVISION_SCHEMA = "chainlesschain.evolution-wiki-revision/v1";
export const WIKI_MAINTENANCE_REQUEST_SCHEMA =
  "chainlesschain.evolution-wiki-maintenance-request/v1";

export const WIKI_PATTERN_STATUS = Object.freeze({
  HYPOTHESIS: "hypothesis",
  CORROBORATED: "corroborated",
  CONTRADICTED: "contradicted",
  STALE: "stale",
  REVOKED: "revoked",
  TOMBSTONED: "tombstoned",
});

const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PATTERN_ID = /^pat-[a-z0-9][a-z0-9-]{2,127}$/u;
const MAINTENANCE_REQUEST_ID = /^wiki-maintenance:[a-f0-9]{64}$/u;
const REVISION_ID = /^wiki:[a-f0-9]{64}$/u;
const KINDS = new Set(["success", "failure", "constraint", "anti-pattern"]);
const EVIDENCE_KINDS = new Set([
  "user-statement",
  "tool-observation",
  "model-inference",
  "grader-receipt",
  "proposal-decision",
  "tombstone",
]);
const EVIDENCE_FIELDS = new Set([
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
  "envelopeDigest",
]);
const OPERATIONS = new Set([
  "upsert",
  "merge",
  "revoke",
  "tombstone",
  "proposal-impact",
]);
const FORBIDDEN_KEYS = new Set([
  "content",
  "output",
  "payload",
  "prompt",
  "secret",
  "token",
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

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function requiredString(value, name) {
  if (typeof value !== "string" || value.trim() === "")
    throw new TypeError(`${name} is required`);
  return value;
}

function stringList(value, name, { allowEmpty = true, max = 128 } = {}) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.length > max ||
    value.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    throw new TypeError(`${name} must be a bounded string list`);
  }
  return [...new Set(value)].sort();
}

function validTime(value, name) {
  requiredString(value, name);
  if (!Number.isFinite(Date.parse(value)))
    throw new TypeError(`${name} must be an ISO timestamp`);
  return value;
}

function assertMetadataOnly(value, path = "data") {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      const error = new Error(
        `${path}.${key} cannot contain raw or secret material`,
      );
      error.code = "WIKI_MAINTAINER_UNSAFE_EVIDENCE";
      throw error;
    }
    assertMetadataOnly(child, `${path}.${key}`);
  }
}

export function createEmptyWikiState(tenantId) {
  return freeze({
    schema: WIKI_STATE_SCHEMA,
    tenantId: requiredString(tenantId, "tenantId"),
    revision: 0,
    revisionId: null,
    patterns: {},
    index: [],
    evidence: {},
    evidenceDependents: {},
    maintenanceRequests: {},
    skillImpact: {},
    evolutionLog: [],
  });
}

function normalizeMaintenanceRequest(input, tenantId) {
  if (input == null) return null;
  const keys = Reflect.ownKeys(input);
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    keys.length !== 4 ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !["schema", "tenantId", "requestId", "requestDigest"].includes(key),
    ) ||
    input.schema !== WIKI_MAINTENANCE_REQUEST_SCHEMA ||
    input.tenantId !== tenantId ||
    !DIGEST.test(input.requestDigest ?? "") ||
    !MAINTENANCE_REQUEST_ID.test(input.requestId ?? "") ||
    input.requestId !==
      `wiki-maintenance:${input.requestDigest.slice("sha256:".length)}`
  ) {
    throw new TypeError(
      "maintenanceRequest must be exact, tenant-scoped, and digest-bound",
    );
  }
  return freeze(clone(input));
}

export function digestWikiState(state) {
  return hash(state);
}

function verifyStateEnvelope(envelope, tenantId) {
  const state = envelope?.state;
  if (
    envelope?.trusted !== true ||
    state?.schema !== WIKI_STATE_SCHEMA ||
    state.tenantId !== tenantId ||
    !DIGEST.test(envelope?.stateDigest ?? "") ||
    envelope.stateDigest !== hash(state)
  ) {
    const error = new Error(
      "Wiki state is not trusted, digest-bound, and tenant-scoped",
    );
    error.code = "WIKI_MAINTAINER_UNTRUSTED_STATE";
    throw error;
  }
  return clone(state);
}

function verifyEvidence(envelope, tenantId, expectedRef) {
  const signed = Object.fromEntries(
    Object.entries(envelope ?? {}).filter(([key]) => key !== "envelopeDigest"),
  );
  if (
    Object.keys(envelope ?? {}).some((key) => !EVIDENCE_FIELDS.has(key)) ||
    envelope?.schema !== WIKI_EVIDENCE_SCHEMA ||
    envelope?.trustedProjection !== true ||
    envelope?.tenantId !== tenantId ||
    envelope?.ref !== expectedRef ||
    !DIGEST.test(envelope?.sourceDigest ?? "") ||
    !DIGEST.test(envelope?.projectionDigest ?? "") ||
    !DIGEST.test(envelope?.envelopeDigest ?? "") ||
    envelope.envelopeDigest !== hash(signed) ||
    !EVIDENCE_KINDS.has(envelope?.kind) ||
    !["active", "revoked", "deleted"].includes(envelope?.status)
  ) {
    const error = new Error(
      "evidence is not authenticated, trusted, and tenant-scoped",
    );
    error.code = "WIKI_MAINTAINER_UNTRUSTED_EVIDENCE";
    throw error;
  }
  requiredString(envelope.artifactRef, "evidence.artifactRef");
  requiredString(envelope.trustDomain, "evidence.trustDomain");
  validTime(envelope.observedAt, "evidence.observedAt");
  if (envelope.expiresAt != null)
    validTime(envelope.expiresAt, "evidence.expiresAt");
  assertMetadataOnly(envelope.data);
  return freeze(clone(envelope));
}

function normalizePattern(input) {
  const patternId = requiredString(input?.patternId, "pattern.patternId");
  if (!PATTERN_ID.test(patternId))
    throw new TypeError("patternId must be canonical");
  if (!KINDS.has(input.kind)) throw new TypeError("pattern.kind is invalid");
  const confidence = Number(input.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    throw new TypeError("pattern.confidence must be between zero and one");
  }
  return {
    patternId,
    kind: input.kind,
    summary: requiredString(input.summary, "pattern.summary"),
    rootCause: requiredString(input.rootCause, "pattern.rootCause"),
    procedure:
      input.procedure == null
        ? null
        : requiredString(input.procedure, "pattern.procedure"),
    appliesWhen: stringList(input.appliesWhen, "pattern.appliesWhen"),
    doesNotApplyWhen: stringList(
      input.doesNotApplyWhen,
      "pattern.doesNotApplyWhen",
    ),
    positiveEvidence: stringList(
      input.positiveEvidence,
      "pattern.positiveEvidence",
      { allowEmpty: false },
    ),
    negativeEvidence: stringList(
      input.negativeEvidence ?? [],
      "pattern.negativeEvidence",
    ),
    contradicts: stringList(input.contradicts ?? [], "pattern.contradicts"),
    supersedes: stringList(input.supersedes ?? [], "pattern.supersedes"),
    confidence,
    trustDomains: stringList(input.trustDomains ?? [], "pattern.trustDomains"),
    lastVerifiedAt:
      input.lastVerifiedAt == null
        ? null
        : validTime(input.lastVerifiedAt, "pattern.lastVerifiedAt"),
    expiresAt:
      input.expiresAt == null
        ? null
        : validTime(input.expiresAt, "pattern.expiresAt"),
    skillNames: stringList(input.skillNames ?? [], "pattern.skillNames"),
  };
}

function fingerprint(pattern) {
  return hash({
    kind: pattern.kind,
    summary: pattern.summary,
    rootCause: pattern.rootCause,
    appliesWhen: pattern.appliesWhen,
    doesNotApplyWhen: pattern.doesNotApplyWhen,
  });
}

function appendLog(state, type, subjectId, effectiveAt, details = {}) {
  const entry = {
    sequence: state.evolutionLog.length + 1,
    type,
    subjectId,
    effectiveAt,
    details,
  };
  entry.entryDigest = hash(entry);
  state.evolutionLog.push(entry);
}

function evidenceUsable(item, effectiveAt) {
  return (
    item?.status === "active" &&
    (item.expiresAt == null ||
      Date.parse(item.expiresAt) > Date.parse(effectiveAt))
  );
}

function rebuildDerivedState(state, effectiveAt, descriptor) {
  const dependents = {};
  for (const pattern of Object.values(state.patterns)) {
    for (const ref of [
      ...pattern.positiveEvidence,
      ...pattern.negativeEvidence,
    ]) {
      (dependents[ref] ??= []).push(pattern.patternId);
    }
    if (
      [WIKI_PATTERN_STATUS.REVOKED, WIKI_PATTERN_STATUS.TOMBSTONED].includes(
        pattern.status,
      )
    )
      continue;
    const positive = pattern.positiveEvidence
      .map((ref) => state.evidence[ref])
      .filter((item) => evidenceUsable(item, effectiveAt));
    const negative = pattern.negativeEvidence
      .map((ref) => state.evidence[ref])
      .filter((item) => evidenceUsable(item, effectiveAt));
    const domains = [
      ...new Set(positive.map((item) => item.trustDomain)),
    ].sort();
    const hasGrader = positive.some((item) => item.kind === "grader-receipt");
    const expired =
      pattern.expiresAt != null &&
      Date.parse(pattern.expiresAt) <= Date.parse(effectiveAt);
    const verifiedAt = pattern.lastVerifiedAt ?? pattern.updatedAt;
    const ageDays = Math.max(
      0,
      (Date.parse(effectiveAt) - Date.parse(verifiedAt)) / 86_400_000,
    );
    const decayFactor = 0.5 ** (ageDays / descriptor.decayHalfLifeDays);
    pattern.operationalConfidence = Number(
      (
        (pattern.confidence * decayFactor) /
        (1 + (pattern.rejectionCount ?? 0))
      ).toFixed(6),
    );
    if (
      (pattern.rollbackCount ?? 0) > 0 ||
      positive.length === 0 ||
      expired ||
      pattern.operationalConfidence < descriptor.staleConfidenceFloor
    ) {
      pattern.status = WIKI_PATTERN_STATUS.STALE;
    } else if (negative.length > 0 || pattern.contradicts.length > 0)
      pattern.status = WIKI_PATTERN_STATUS.CONTRADICTED;
    else if (hasGrader || domains.length >= descriptor.minCorroboratingSources)
      pattern.status = WIKI_PATTERN_STATUS.CORROBORATED;
    else pattern.status = WIKI_PATTERN_STATUS.HYPOTHESIS;
    pattern.trustDomains = domains;
    pattern.evidenceCounts = {
      positive: positive.length,
      negative: negative.length,
      trustDomains: domains.length,
    };
    pattern.actionable =
      pattern.status === WIKI_PATTERN_STATUS.CORROBORATED &&
      pattern.procedure != null &&
      (pattern.rejectionCount ?? 0) === 0;
  }
  state.evidenceDependents = Object.fromEntries(
    Object.entries(dependents)
      .sort()
      .map(([ref, ids]) => [ref, [...new Set(ids)].sort()]),
  );
  state.index = Object.values(state.patterns)
    .filter(
      (pattern) =>
        ![
          WIKI_PATTERN_STATUS.REVOKED,
          WIKI_PATTERN_STATUS.TOMBSTONED,
          WIKI_PATTERN_STATUS.STALE,
        ].includes(pattern.status),
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
    .sort((a, b) => a.patternId.localeCompare(b.patternId));
}

function applyUpsert(state, operation, evidenceByRef, effectiveAt) {
  const proposed = normalizePattern(operation.pattern);
  for (const ref of [
    ...proposed.positiveEvidence,
    ...proposed.negativeEvidence,
  ]) {
    if (!evidenceByRef.has(ref) && !state.evidence[ref])
      throw new Error(`pattern references unresolved evidence: ${ref}`);
  }
  const duplicate = Object.values(state.patterns).find(
    (item) =>
      item.status !== WIKI_PATTERN_STATUS.TOMBSTONED &&
      fingerprint(item) === fingerprint(proposed),
  );
  const existing = duplicate ?? state.patterns[proposed.patternId];
  const patternId = existing?.patternId ?? proposed.patternId;
  state.patterns[patternId] = {
    ...proposed,
    patternId,
    positiveEvidence: [
      ...new Set([
        ...(existing?.positiveEvidence ?? []),
        ...proposed.positiveEvidence,
      ]),
    ].sort(),
    negativeEvidence: [
      ...new Set([
        ...(existing?.negativeEvidence ?? []),
        ...proposed.negativeEvidence,
      ]),
    ].sort(),
    contradicts: [
      ...new Set([...(existing?.contradicts ?? []), ...proposed.contradicts]),
    ].sort(),
    supersedes: [
      ...new Set([...(existing?.supersedes ?? []), ...proposed.supersedes]),
    ].sort(),
    rejectionCount: existing?.rejectionCount ?? 0,
    rollbackCount: existing?.rollbackCount ?? 0,
    status: WIKI_PATTERN_STATUS.HYPOTHESIS,
    actionable: false,
    evidenceCounts: { positive: 0, negative: 0, trustDomains: 0 },
    operationalConfidence: proposed.confidence,
    updatedAt: effectiveAt,
  };
  appendLog(
    state,
    duplicate
      ? "pattern-deduplicated"
      : existing
        ? "pattern-updated"
        : "pattern-created",
    patternId,
    effectiveAt,
    duplicate && duplicate.patternId !== proposed.patternId
      ? { discardedPatternId: proposed.patternId }
      : {},
  );
}

function applyOperation(state, operation, evidenceByRef, effectiveAt) {
  if (!OPERATIONS.has(operation?.type))
    throw new TypeError("Wiki maintenance operation is invalid");
  if (operation.type === "upsert")
    return applyUpsert(state, operation, evidenceByRef, effectiveAt);
  if (operation.type === "merge") {
    const target =
      state.patterns[
        requiredString(operation.targetPatternId, "targetPatternId")
      ];
    const sources = stringList(operation.sourcePatternIds, "sourcePatternIds", {
      allowEmpty: false,
    });
    if (
      !target ||
      sources.some(
        (id) =>
          !state.patterns[id] ||
          id === target.patternId ||
          state.patterns[id].kind !== target.kind,
      )
    ) {
      throw new Error(
        "merge patterns are missing, cyclic, or belong to different kinds",
      );
    }
    for (const id of sources) {
      const source = state.patterns[id];
      target.positiveEvidence = [
        ...new Set([...target.positiveEvidence, ...source.positiveEvidence]),
      ].sort();
      target.negativeEvidence = [
        ...new Set([...target.negativeEvidence, ...source.negativeEvidence]),
      ].sort();
      source.status = WIKI_PATTERN_STATUS.REVOKED;
      source.revocationReason = `merged-into:${target.patternId}`;
      target.supersedes = [...new Set([...target.supersedes, id])].sort();
    }
    appendLog(state, "patterns-merged", target.patternId, effectiveAt, {
      sourcePatternIds: sources,
    });
    return;
  }
  if (operation.type === "revoke" || operation.type === "tombstone") {
    const pattern =
      state.patterns[requiredString(operation.patternId, "patternId")];
    if (!pattern) throw new Error("cannot revoke an unknown pattern");
    pattern.status =
      operation.type === "revoke"
        ? WIKI_PATTERN_STATUS.REVOKED
        : WIKI_PATTERN_STATUS.TOMBSTONED;
    pattern.revocationReason = requiredString(operation.reason, "reason");
    pattern.actionable = false;
    appendLog(
      state,
      `pattern-${operation.type}d`,
      pattern.patternId,
      effectiveAt,
      { reason: pattern.revocationReason },
    );
    return;
  }
  const decision = operation.decision;
  if (!decision || !["accepted", "rejected"].includes(decision.outcome))
    throw new TypeError("proposal impact decision is invalid");
  const receiptRef = requiredString(decision.receiptRef, "decision.receiptRef");
  const evidence = evidenceByRef.get(receiptRef) ?? state.evidence[receiptRef];
  if (
    evidence?.kind !== "proposal-decision" ||
    !evidenceUsable(evidence, effectiveAt)
  )
    throw new Error("proposal impact requires an active decision receipt");
  const skillName = requiredString(decision.skillName, "decision.skillName");
  const patternRefs = stringList(decision.patternRefs, "decision.patternRefs");
  const decisionCore = {
    candidateId: requiredString(decision.candidateId, "decision.candidateId"),
    skillName,
    outcome: decision.outcome,
    patternRefs,
    reason: requiredString(decision.reason, "decision.reason"),
  };
  if (evidence.data?.decisionDigest !== hash(decisionCore)) {
    throw new Error(
      "proposal impact fields are not bound to the decision receipt",
    );
  }
  const record = (state.skillImpact[skillName] ??= {
    accepted: 0,
    rejected: 0,
    decisions: [],
  });
  record[decision.outcome] += 1;
  record.decisions.push({
    ...decisionCore,
    receiptRef,
    decidedAt: effectiveAt,
  });
  for (const patternId of patternRefs) {
    const pattern = state.patterns[patternId];
    if (!pattern)
      throw new Error(
        `proposal decision references unknown pattern: ${patternId}`,
      );
    if (decision.outcome === "rejected") {
      pattern.rejectionCount = (pattern.rejectionCount ?? 0) + 1;
      if (evidence.data?.pilotOutcome === "rollback") {
        pattern.rollbackCount = (pattern.rollbackCount ?? 0) + 1;
      }
    }
  }
  appendLog(
    state,
    "proposal-impact-recorded",
    decisionCore.candidateId,
    effectiveAt,
    { skillName, outcome: decision.outcome, patternRefs },
  );
}

function normalizeDescriptor(input) {
  const decayHalfLifeDays = Number(input?.decayHalfLifeDays ?? 30);
  const staleConfidenceFloor = Number(input?.staleConfidenceFloor ?? 0.2);
  if (
    !Number.isFinite(decayHalfLifeDays) ||
    decayHalfLifeDays <= 0 ||
    !Number.isFinite(staleConfidenceFloor) ||
    staleConfidenceFloor < 0 ||
    staleConfidenceFloor > 1
  ) {
    throw new TypeError("Wiki decay policy is invalid");
  }
  return freeze({
    tenantId: requiredString(input?.tenantId, "tenantId"),
    evolutionRunId: requiredString(input?.evolutionRunId, "evolutionRunId"),
    maintainerModel: requiredString(input?.maintainerModel, "maintainerModel"),
    rulesDigest: DIGEST.test(input?.rulesDigest ?? "")
      ? input.rulesDigest
      : (() => {
          throw new TypeError("rulesDigest must be sha256-bound");
        })(),
    minCorroboratingSources: Math.max(
      2,
      Number(input?.minCorroboratingSources) || 2,
    ),
    decayHalfLifeDays,
    staleConfidenceFloor,
  });
}

export class EvidenceBackedWikiMaintainer {
  constructor({ descriptor, policy, ports } = {}) {
    this.descriptor = normalizeDescriptor(descriptor);
    if (
      policy?.trustedProjectionRead !== true ||
      policy?.rawEvidenceRead === true ||
      policy?.activeSkillWrite === true ||
      policy?.shell === true ||
      policy?.network === true ||
      policy?.secretRead === true
    ) {
      throw new Error(
        "Maintainer policy must allow only trusted projection reads and Wiki revision writes",
      );
    }
    for (const name of [
      "loadWiki",
      "resolveEvidence",
      "derive",
      "commitRevision",
    ]) {
      if (typeof ports?.[name] !== "function")
        throw new TypeError(`${name} port is required`);
    }
    this._ports = ports;
    Object.freeze(this);
  }

  async maintain({ evidenceRefs, effectiveAt, maintenanceRequest } = {}) {
    const timestamp = validTime(effectiveAt, "effectiveAt");
    const refs = stringList(evidenceRefs, "evidenceRefs", {
      allowEmpty: false,
      max: 256,
    });
    const request = normalizeMaintenanceRequest(
      maintenanceRequest,
      this.descriptor.tenantId,
    );
    const stateEnvelope = await this._ports.loadWiki({
      tenantId: this.descriptor.tenantId,
    });
    const state = verifyStateEnvelope(stateEnvelope, this.descriptor.tenantId);
    const priorStateDigest = stateEnvelope.stateDigest;
    state.maintenanceRequests ??= {};
    if (request) {
      const existing = state.maintenanceRequests[request.requestId];
      if (existing) {
        if (
          existing.requestDigest !== request.requestDigest ||
          canonical(existing.evidenceRefs) !== canonical(refs) ||
          existing.effectiveAt !== timestamp ||
          !Number.isSafeInteger(existing.revision) ||
          !REVISION_ID.test(existing.revisionId ?? "")
        ) {
          const error = new Error(
            "maintenance request id is already bound to different work",
          );
          error.code = "WIKI_MAINTENANCE_REQUEST_CONFLICT";
          throw error;
        }
        return freeze({
          revisionId: existing.revisionId,
          revision: existing.revision,
          currentRevision: state.revision,
          stateDigest: priorStateDigest,
          state: clone(state),
          maintenanceRequestId: request.requestId,
          recovered: true,
        });
      }
    }
    const evidenceByRef = new Map();
    for (const ref of refs) {
      const evidence = verifyEvidence(
        await this._ports.resolveEvidence(ref),
        this.descriptor.tenantId,
        ref,
      );
      evidenceByRef.set(ref, evidence);
      state.evidence[ref] = Object.fromEntries(
        Object.entries(evidence).filter(([key]) => key !== "envelopeDigest"),
      );
    }
    const derived = await this._ports.derive(
      freeze({
        descriptor: this.descriptor,
        state: clone(state),
        evidence: [...evidenceByRef.values()],
        effectiveAt: timestamp,
      }),
    );
    if (!Array.isArray(derived?.operations) || derived.operations.length > 128)
      throw new TypeError("derive must return a bounded operations list");
    for (const operation of derived.operations)
      applyOperation(state, clone(operation), evidenceByRef, timestamp);
    rebuildDerivedState(state, timestamp, this.descriptor);
    state.revision += 1;
    const revisionPayload = {
      schema: WIKI_REVISION_SCHEMA,
      tenantId: this.descriptor.tenantId,
      evolutionRunId: this.descriptor.evolutionRunId,
      revision: state.revision,
      priorStateDigest,
      rulesDigest: this.descriptor.rulesDigest,
      maintainerModel: this.descriptor.maintainerModel,
      effectiveAt: timestamp,
      evidenceRefs: refs,
      operationDigest: hash(derived.operations),
      maintenanceRequestId: request?.requestId ?? null,
      maintenanceRequestDigest: request?.requestDigest ?? null,
    };
    state.revisionId = `wiki:${hash(revisionPayload).slice(7)}`;
    if (request) {
      state.maintenanceRequests[request.requestId] = {
        requestDigest: request.requestDigest,
        evidenceRefs: refs,
        effectiveAt: timestamp,
        operationDigest: revisionPayload.operationDigest,
        revision: state.revision,
        revisionId: state.revisionId,
      };
    }
    const stateDigest = hash(state);
    const revision = freeze({
      ...revisionPayload,
      revisionId: state.revisionId,
      stateDigest,
      state: freeze(clone(state)),
    });
    const committed = await this._ports.commitRevision(
      freeze({ expectedStateDigest: priorStateDigest, revision }),
    );
    if (
      committed?.committed !== true ||
      committed?.revisionId !== revision.revisionId ||
      committed?.stateDigest !== stateDigest ||
      committed?.evolutionRunId !== this.descriptor.evolutionRunId
    ) {
      const error = new Error(
        "Wiki persistence did not confirm the exact revision and EvolutionRun binding",
      );
      error.code = "WIKI_MAINTAINER_COMMIT_UNCONFIRMED";
      throw error;
    }
    return freeze({
      revisionId: revision.revisionId,
      revision: state.revision,
      currentRevision: state.revision,
      stateDigest,
      state: clone(state),
      maintenanceRequestId: request?.requestId ?? null,
      recovered: false,
    });
  }
}

export function createEvidenceBackedWikiMaintainer(options) {
  return new EvidenceBackedWikiMaintainer(options);
}
