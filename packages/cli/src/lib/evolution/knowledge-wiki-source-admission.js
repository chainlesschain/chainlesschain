import {
  GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE,
  verifyGovernedKnowledgeDependencyPrepared,
} from "./governed-knowledge-revocation-record.js";
import {
  WIKI_PATTERN_STATUS,
  WIKI_EVIDENCE_SCHEMA,
  createEmptyWikiState,
  digestWikiState,
} from "./evidence-backed-wiki-maintainer.js";
import {
  verifyWikiRevision,
  verifyWikiRequestTransition,
} from "./wiki-revision-protocol.js";

export const WIKI_SOURCE_REVOKED_CODE = "CC_EVOLUTION_WIKI_SOURCE_REVOKED";
export const WIKI_SOURCE_ADMISSION_INVALID_CODE =
  "CC_EVOLUTION_WIKI_SOURCE_ADMISSION_INVALID";
const WIKI_EVENT = "wiki.revision.committed";
const DOMAIN_EVENT_SCHEMA = "chainlesschain.evolution-domain-event/v1";
const ARTIFACT_SCHEMA = "chainlesschain.evolution-durable-artifact-record/v1";
const RECORD_KEYS = [
  "audience",
  "purpose",
  "retention",
  "schema",
  "tenantId",
  "type",
  "value",
];
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const PATTERN = /^pat-[a-z0-9][a-z0-9-]{2,127}$/u;
const STATUSES = new Set(Object.values(WIKI_PATTERN_STATUS));
const TERMINAL = new Set([
  WIKI_PATTERN_STATUS.REVOKED,
  WIKI_PATTERN_STATUS.TOMBSTONED,
]);
const TAINT_LIMIT = 16_384;
const MAX_BYTES = 1024 * 1024;
function fail(message, code = WIKI_SOURCE_ADMISSION_INVALID_CODE) {
  const error = new Error(`Wiki source admission: ${message}`);
  error.code = code;
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
const same = (a, b) => canonical(a) === canonical(b);
const object = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);
function remember(set, key, budget, value = true) {
  if (set.has(key)) return;
  if (++budget.entries > TAINT_LIMIT)
    fail("historical source bindings exceed their bounded budget");
  if (set instanceof Map) set.set(key, value);
  else set.add(key);
}

// Only called with bytes resolved and digest-authenticated by the real Ledger
// while its write lock is held. There is no public success flag / writer port.
export function assertKnowledgeWikiSourceAdmission({
  input,
  events,
  resolveSubject,
}) {
  if (input.type !== WIKI_EVENT) return;
  if (
    !events.some(
      (event) =>
        event.type === GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE &&
        event.tenantId === input.tenantId,
    )
  )
    return;
  if (typeof input.correlationId !== "string" || !input.correlationId.trim())
    fail("Wiki run identity is missing");

  function record(event, type, audience = null) {
    if (
      event.artifactTenantId !== input.artifactTenantId ||
      (event.schema !== undefined && event.schema !== DOMAIN_EVENT_SCHEMA) ||
      event.tenantId !== input.tenantId ||
      event.skillName !== null
    )
      fail("event tenant or artifact boundary differs");
    const bytes = resolveSubject(event);
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES)
      fail("record exceeds its byte budget");
    let value;
    let json;
    try {
      json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      value = JSON.parse(json);
    } catch {
      fail("record is not canonical UTF-8 JSON");
    }
    if (
      !object(value) ||
      Object.keys(value).length !== RECORD_KEYS.length ||
      RECORD_KEYS.some((key) => !Object.hasOwn(value, key)) ||
      canonical(value) !== json ||
      value.schema !== ARTIFACT_SCHEMA ||
      value.tenantId !== input.artifactTenantId ||
      value.type !== type ||
      value.retention !== "ledger" ||
      value.purpose !== "evolution-ledger" ||
      typeof value.audience !== "string" ||
      !value.audience ||
      (audience !== null && value.audience !== audience)
    )
      fail("record is not bound to the retained canonical subject");
    return value;
  }

  const candidateRecord = record(input, "wiki-revision");
  function wiki(event, capturedRecord = null) {
    if (typeof event.correlationId !== "string" || !event.correlationId.trim())
      fail("historical Wiki run identity is missing");
    const revision = verifyWikiRevision(
      (
        capturedRecord ??
        record(event, "wiki-revision", candidateRecord.audience)
      ).value,
      { tenantId: input.tenantId, evolutionRunId: event.correlationId },
    );
    if (
      event.decision !== "committed" ||
      event.timestamp !== revision.effectiveAt ||
      event.eventId !== `wiki.revision.${revision.revisionId.slice(5)}`
    )
      fail("Wiki event does not bind its actual revision");
    validateState(revision.state);
    return revision;
  }
  // Validate the proposed event too: direct append callers do not get a weaker
  // contract than the standard Wiki adapter.
  const candidate = wiki(input, candidateRecord);
  const history = events.filter(
    (event) => event.type === WIKI_EVENT && event.tenantId === input.tenantId,
  );

  for (const event of events) {
    if (
      event.type !== GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE ||
      event.tenantId !== input.tenantId
    )
      continue;
    const preparedValue = record(
      event,
      "governed-knowledge-dependency-operation",
      candidateRecord.audience,
    ).value;
    const prepared = verifyGovernedKnowledgeDependencyPrepared(preparedValue, {
      tenantId: input.tenantId,
      deviceId: preparedValue?.deviceId,
    });
    if (
      event.decision !== "prepared" ||
      event.timestamp !== prepared.preparedAt ||
      !Array.isArray(event.sourceRefs) ||
      event.sourceRefs.length ||
      event.eventId !==
        `${GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE}.${prepared.operationDigest.slice(7)}`
    )
      fail("revocation is not an exact durable prepared operation");
    const knowledge = prepared.knowledge;
    const sourceRef = `knowledge://${encodeURIComponent(knowledge.tenantId)}/${encodeURIComponent(knowledge.knowledgeId)}`;
    // Follow immutable Wiki-to-Wiki sources in Ledger order too. Retain only
    // bounded source/identity metadata and predecessor events, not every full
    // Wiki state. No authorization cache survives this append.
    const budget = { entries: 0 };
    const digests = new Set([knowledge.contentDigest]);
    const wikiRefs = new Set();
    const knownWikiSources = new Map();
    const runs = new Map();
    const run = (id) => {
      if (!runs.has(id))
        remember(runs, id, budget, {
          refs: new Set(),
          patterns: new Set(),
          previous: null,
        });
      return runs.get(id);
    };
    const mark = (state, scope) => {
      for (const entry of Object.values(state.evidence)) {
        for (const declared of [entry.ref, entry.artifactRef]) {
          if (declared.startsWith("wiki-source://")) {
            const parent = knownWikiSources.get(declared);
            if (!parent || entry.sourceDigest !== parent)
              fail(
                "Wiki evidence does not bind an earlier authenticated source revision",
              );
          }
        }
        if (
          entry.ref === sourceRef ||
          entry.artifactRef === sourceRef ||
          digests.has(entry.sourceDigest) ||
          wikiRefs.has(entry.ref) ||
          wikiRefs.has(entry.artifactRef)
        )
          remember(scope.refs, entry.ref, budget);
      }
      for (const pattern of Object.values(state.patterns)) {
        if (
          [...pattern.positiveEvidence, ...pattern.negativeEvidence].some(
            (ref) => scope.refs.has(ref),
          )
        )
          remember(scope.patterns, pattern.patternId, budget);
      }
      return Object.keys(state.patterns).some((id) => scope.patterns.has(id));
    };
    for (const entry of history) {
      const revision = wiki(entry);
      const scope = run(entry.correlationId);
      const previous = scope.previous
        ? wiki(scope.previous).state
        : createEmptyWikiState(input.tenantId);
      successor(previous, scope.previous?.subjectRef ?? null, revision, entry);
      const uri = `wiki-source://${input.tenantId}/${revision.revisionId}`;
      if (mark(revision.state, scope)) {
        remember(digests, revision.stateDigest, budget);
        remember(digests, entry.subjectRef.digest, budget);
        remember(wikiRefs, uri, budget);
        remember(wikiRefs, revision.revisionId, budget);
        remember(wikiRefs, entry.subjectRef.ref, budget);
      }
      remember(knownWikiSources, uri, budget, revision.stateDigest);
      scope.previous = entry;
    }
    const scope = run(input.correlationId);
    const previous = scope.previous
      ? wiki(scope.previous).state
      : createEmptyWikiState(input.tenantId);
    successor(previous, scope.previous?.subjectRef ?? null, candidate, input);
    mark(candidate.state, scope);
    for (const id of scope.patterns) {
      const next = candidate.state.patterns[id];
      // Removing / terminalizing a target is safe, even while other batches
      // still contain unchanged pre-revocation targets. No new live exposure.
      if (!next || (TERMINAL.has(next.status) && next.actionable === false))
        continue;
      if (
        !previous.patterns[id] ||
        !same(exposure(previous, id), exposure(candidate.state, id))
      )
        fail(
          "revoked Knowledge cannot create, rewrite or reactivate a Wiki pattern",
          WIKI_SOURCE_REVOKED_CODE,
        );
    }
  }
}

function successor(previous, previousRef, revision, event) {
  let baseline = previous;
  if (
    !previousRef &&
    !Object.hasOwn(revision, "maintenanceRequestId") &&
    !Object.hasOwn(revision.state, "maintenanceRequests")
  ) {
    const legacy = { ...previous };
    delete legacy.maintenanceRequests;
    if (revision.priorStateDigest === digestWikiState(legacy))
      baseline = legacy;
  }
  if (
    revision.revision !== baseline.revision + 1 ||
    revision.priorStateDigest !== digestWikiState(baseline) ||
    !same(event.sourceRefs, previousRef ? [previousRef] : [])
  )
    fail("Wiki revision does not extend its authenticated predecessor");
  verifyWikiRequestTransition(baseline, revision);
  return revision.state;
}

function validateState(state) {
  if (
    !object(state.patterns) ||
    !object(state.evidence) ||
    !Array.isArray(state.index)
  )
    fail("Wiki state is missing pattern, evidence or index data");
  for (const [ref, entry] of Object.entries(state.evidence)) {
    if (
      !object(entry) ||
      entry.schema !== WIKI_EVIDENCE_SCHEMA ||
      entry.trustedProjection !== true ||
      entry.tenantId !== state.tenantId ||
      !ref ||
      entry.ref !== ref ||
      typeof entry.artifactRef !== "string" ||
      !entry.artifactRef ||
      !DIGEST.test(entry.sourceDigest ?? "")
    )
      fail("Wiki evidence source binding is invalid");
  }
  const index = new Map();
  for (const entry of state.index) {
    if (
      !object(entry) ||
      index.has(entry.patternId) ||
      !Object.hasOwn(state.patterns, entry.patternId)
    )
      fail("Wiki index has a duplicate or unresolved pattern");
    index.set(entry.patternId, entry);
  }
  for (const [id, pattern] of Object.entries(state.patterns)) {
    if (
      !object(pattern) ||
      !PATTERN.test(id) ||
      pattern.patternId !== id ||
      !STATUSES.has(pattern.status) ||
      typeof pattern.actionable !== "boolean"
    )
      fail("Wiki pattern identity or lifecycle is invalid");
    for (const key of ["positiveEvidence", "negativeEvidence"]) {
      if (
        !Array.isArray(pattern[key]) ||
        (key === "positiveEvidence" && pattern[key].length === 0) ||
        pattern[key].length > 128 ||
        pattern[key].some(
          (ref) =>
            typeof ref !== "string" || !Object.hasOwn(state.evidence, ref),
        )
      )
        fail("Wiki pattern has unresolved evidence");
    }
    if (
      TERMINAL.has(pattern.status) ||
      pattern.status === WIKI_PATTERN_STATUS.STALE
    ) {
      if (index.has(id) || pattern.actionable)
        fail("non-live Wiki pattern still has an actionable exposure");
    } else if (
      !same(index.get(id), {
        patternId: id,
        kind: pattern.kind,
        status: pattern.status,
        summary: pattern.summary,
        confidence: pattern.operationalConfidence,
        actionable: pattern.actionable,
        skillNames: pattern.skillNames,
      })
    )
      fail("Wiki index differs from its pattern projection");
  }
}

function exposure(state, id) {
  const pattern = state.patterns[id];
  return {
    pattern,
    index: state.index.filter((entry) => entry.patternId === id),
    evidence: [
      ...new Set([...pattern.positiveEvidence, ...pattern.negativeEvidence]),
    ]
      .sort()
      .map((ref) => state.evidence[ref]),
  };
}
