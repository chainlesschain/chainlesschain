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
  WIKI_PATTERN_STATUS.QUARANTINED,
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

export function readWikiSourceRecord(event, type, descriptor, resolveSubject) {
  const input = descriptor;
  const audience = descriptor.audience ?? null;
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
    value.purpose !== (descriptor.purpose ?? "evolution-ledger") ||
    typeof value.audience !== "string" ||
    !value.audience ||
    (audience !== null && value.audience !== audience)
  )
    fail("record is not bound to the retained canonical subject");
  return value;
}

export function readRetainedWikiRevision(event, descriptor, resolveSubject) {
  if (typeof event.correlationId !== "string" || !event.correlationId.trim())
    fail("historical Wiki run identity is missing");
  const value = readWikiSourceRecord(
    event,
    "wiki-revision",
    descriptor,
    resolveSubject,
  );
  const revision = verifyWikiRevision(value.value, {
    tenantId: descriptor.tenantId,
    evolutionRunId: event.correlationId,
  });
  if (
    event.decision !== "committed" ||
    event.timestamp !== revision.effectiveAt ||
    event.eventId !== `wiki.revision.${revision.revisionId.slice(5)}`
  )
    fail("Wiki event does not bind its actual revision");
  validateState(revision.state);
  return revision;
}

// A replay-scoped, bounded provenance index, not a cache or mutation authority.
// Exact ancestry authorizes disposition; unsafe ancestry denies new admission.
// Whole pinned contexts (including negative and terminal patterns) may inform
// generation. Historical ref/pattern reuse cannot erase an earlier dependency.
export function createKnowledgeWikiSourceTracker({
  tenantId,
  knowledge,
  readWiki,
}) {
  const sourceRef = `knowledge://${encodeURIComponent(tenantId)}/${encodeURIComponent(knowledge.knowledgeId)}`;
  const budget = { entries: 0 };
  const knownWikiSources = new Map();
  const runs = new Map();
  const ancestry = () => ({ digests: new Set(), refs: new Set() });
  const exact = ancestry();
  const unsafe = ancestry();
  unsafe.digests.add(knowledge.contentDigest);
  const run = (id) => {
    if (!runs.has(id))
      remember(runs, id, budget, {
        exactRefs: new Set(),
        unsafeRefs: new Set(),
        exactPatterns: new Set(),
        unsafePatterns: new Set(),
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
      const sameRef =
        entry.ref === sourceRef || entry.artifactRef === sourceRef;
      const sameContent = entry.sourceDigest === knowledge.contentDigest;
      if ((sameRef && sameContent) || exact.digests.has(entry.sourceDigest))
        remember(scope.exactRefs, entry.ref, budget);
      if (
        sameRef ||
        unsafe.digests.has(entry.sourceDigest) ||
        unsafe.refs.has(entry.ref) ||
        unsafe.refs.has(entry.artifactRef)
      )
        remember(scope.unsafeRefs, entry.ref, budget);
    }
    for (const pattern of Object.values(state.patterns)) {
      const refs = [...pattern.positiveEvidence, ...pattern.negativeEvidence];
      if (refs.some((ref) => scope.exactRefs.has(ref)))
        remember(scope.exactPatterns, pattern.patternId, budget);
      if (refs.some((ref) => scope.unsafeRefs.has(ref)))
        remember(scope.unsafePatterns, pattern.patternId, budget);
    }
    const present = (set) =>
      Object.keys(state.patterns)
        .filter((id) => set.has(id))
        .sort();
    return {
      affectedPatternIds: present(scope.exactPatterns),
      unsafePatternIds: present(scope.unsafePatterns),
    };
  };
  return Object.freeze({
    visit(event, revision, { proposed = false } = {}) {
      const scope = run(event.correlationId);
      const previous = scope.previous
        ? readWiki(scope.previous).state
        : createEmptyWikiState(tenantId);
      successor(previous, scope.previous?.subjectRef ?? null, revision, event);
      const result = mark(revision.state, scope);
      if (!proposed) {
        const uri = `wiki-source://${tenantId}/${revision.revisionId}`;
        for (const [channel, affected] of [
          [exact, result.affectedPatternIds],
          [unsafe, result.unsafePatternIds],
        ]) {
          if (!affected.length) continue;
          remember(channel.digests, revision.stateDigest, budget);
          remember(channel.digests, event.subjectRef.digest, budget);
          remember(channel.refs, uri, budget);
          remember(channel.refs, revision.revisionId, budget);
          remember(channel.refs, event.subjectRef.ref, budget);
        }
        remember(knownWikiSources, uri, budget, revision.stateDigest);
        scope.previous = event;
      }
      return { previous, ...result };
    },
  });
}

// Input events and retained bytes must already be authenticated by the caller's
// fixed real Ledger reader. Never follow a later revision to prove an old Skill.
export function resolveKnowledgeWikiSourceProvenance({
  events,
  descriptor,
  resolveSubject,
  revisionId,
  knowledge,
}) {
  const selected = events.find(
    (event) =>
      event.type === WIKI_EVENT &&
      event.tenantId === descriptor.tenantId &&
      event.eventId === `wiki.revision.${revisionId.slice(5)}`,
  );
  if (!selected || selected.correlationId !== descriptor.evolutionRunId)
    fail("original Wiki revision is missing or belongs to another run");
  const readWiki = (event) =>
    readRetainedWikiRevision(event, descriptor, resolveSubject);
  const tracker = createKnowledgeWikiSourceTracker({
    tenantId: descriptor.tenantId,
    knowledge,
    readWiki,
  });
  for (const event of events) {
    if (event.sequence > selected.sequence) break;
    if (event.type !== WIKI_EVENT || event.tenantId !== descriptor.tenantId)
      continue;
    const revision = readWiki(event);
    const result = tracker.visit(event, revision);
    if (event === selected)
      return {
        revisionId: revision.revisionId,
        stateDigest: revision.stateDigest,
        checkpoint: {
          epoch: event.epoch,
          ledgerId: event.ledgerId,
          identityDigest: event.identityDigest,
          sequence: event.sequence,
          headDigest: event.eventDigest,
        },
        affectedPatternIds: result.affectedPatternIds,
        unsafePatternIds: result.unsafePatternIds,
      };
  }
  fail("original Wiki revision is not in the authenticated event range");
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
