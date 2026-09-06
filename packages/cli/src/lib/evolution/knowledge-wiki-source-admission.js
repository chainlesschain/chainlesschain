import {
  GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE,
  verifyGovernedKnowledgeDependencyPrepared,
} from "./governed-knowledge-revocation-record.js";
import {
  WIKI_SOURCE_ADMISSION_INVALID_CODE,
  readWikiSourceRecord,
  readRetainedWikiRevision,
  createKnowledgeWikiSourceTracker,
} from "./knowledge-wiki-source-provenance.js";
import {
  GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_EVENT_TYPE,
  verifyGovernedKnowledgeQuarantineReleaseRecord,
} from "./governed-knowledge-quarantine-release.js";

export { WIKI_SOURCE_ADMISSION_INVALID_CODE } from "./knowledge-wiki-source-provenance.js";
export const WIKI_SOURCE_REVOKED_CODE = "CC_EVOLUTION_WIKI_SOURCE_REVOKED";
const WIKI_EVENT = "wiki.revision.committed";
const TERMINAL = new Set(["quarantined", "revoked", "tombstoned"]);

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
    .join(",")}}`;
}
const same = (a, b) => canonical(a) === canonical(b);

function quarantineReleaseFor({
  events,
  prepared,
  descriptor,
  resolveSubject,
  fail,
}) {
  const eventId = `${GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_EVENT_TYPE}.${prepared.operationDigest.slice(7)}`;
  const matches = events.filter(
    (event) =>
      event.type === GOVERNED_KNOWLEDGE_QUARANTINE_RELEASE_EVENT_TYPE &&
      event.eventId === eventId &&
      event.tenantId === prepared.tenantId,
  );
  if (matches.length > 1) fail("quarantine release is ambiguous");
  if (matches.length === 0) return null;
  const event = matches[0];
  const value = readWikiSourceRecord(
    event,
    "governed-knowledge-quarantine-release",
    descriptor,
    resolveSubject,
  ).value;
  let release;
  try {
    release = verifyGovernedKnowledgeQuarantineReleaseRecord(value, {
      tenantId: prepared.tenantId,
    });
  } catch {
    fail("quarantine release record is invalid");
  }
  const quarantines = prepared.knowledge.dependencies.filter(
    (dependency) => dependency.disposition === "quarantine",
  );
  if (
    event.decision !== "committed" ||
    event.timestamp !== release.committedAt ||
    !Array.isArray(event.sourceRefs) ||
    event.sourceRefs.length !== 0 ||
    release.preparedRecordDigest !== prepared.recordDigest ||
    release.knowledgeId !== prepared.knowledge.knowledgeId ||
    release.contentDigest !== prepared.knowledge.contentDigest ||
    !same(release.dependencies, quarantines)
  ) {
    fail("quarantine release does not bind the prepared revocation");
  }
  return release;
}

function isReleasedWikiRestoration(
  previous,
  candidate,
  patternId,
  release,
  releaseCoversRun,
  baseline,
) {
  if (
    !release ||
    !releaseCoversRun ||
    !baseline ||
    previous.patterns[patternId]?.status !== "quarantined" ||
    !candidate.state.patterns[patternId] ||
    TERMINAL.has(candidate.state.patterns[patternId].status) ||
    !release.dependencies.some(
      (dependency) =>
        dependency.kind === "wiki" && dependency.disposition === "quarantine",
    )
  ) {
    return false;
  }
  const expectedPattern = {
    ...baseline.patterns[patternId],
    updatedAt: release.committedAt,
  };
  const actualPattern = candidate.state.patterns[patternId];
  const expectedIndex = [
    {
      patternId: expectedPattern.patternId,
      kind: expectedPattern.kind,
      status: expectedPattern.status,
      summary: expectedPattern.summary,
      confidence: expectedPattern.operationalConfidence,
      actionable: expectedPattern.actionable,
      skillNames: expectedPattern.skillNames,
    },
  ];
  const refs = [
    ...new Set([
      ...expectedPattern.positiveEvidence,
      ...expectedPattern.negativeEvidence,
    ]),
  ].sort();
  if (
    !same(actualPattern, expectedPattern) ||
    !same(
      candidate.state.index.filter((entry) => entry.patternId === patternId),
      expectedIndex,
    ) ||
    !same(
      refs.map((ref) => candidate.state.evidence[ref]),
      refs.map((ref) => baseline.evidence[ref]),
    )
  ) {
    return false;
  }
  return candidate.state.evolutionLog.some(
    (entry) =>
      entry.type === "pattern-quarantine-released" &&
      entry.subjectId === patternId &&
      entry.details?.operationDigest === release.operationDigest &&
      entry.details?.releaseRecordDigest === release.recordDigest,
  );
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
  const fail = (message) => {
    const error = new Error(`Wiki source admission: ${message}`);
    error.code = WIKI_SOURCE_ADMISSION_INVALID_CODE;
    throw error;
  };
  const candidateRecord = readWikiSourceRecord(
    input,
    "wiki-revision",
    input,
    resolveSubject,
  );
  const descriptor = { ...input, audience: candidateRecord.audience };
  const wiki = (event) =>
    readRetainedWikiRevision(event, descriptor, resolveSubject);
  const candidate = wiki(input);
  const history = events.filter(
    (event) => event.type === WIKI_EVENT && event.tenantId === input.tenantId,
  );
  for (const event of events) {
    if (
      event.type !== GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE ||
      event.tenantId !== input.tenantId
    )
      continue;
    const value = readWikiSourceRecord(
      event,
      "governed-knowledge-dependency-operation",
      descriptor,
      resolveSubject,
    ).value;
    const prepared = verifyGovernedKnowledgeDependencyPrepared(value, {
      tenantId: input.tenantId,
      deviceId: value?.deviceId,
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
    const release = quarantineReleaseFor({
      events,
      prepared,
      descriptor,
      resolveSubject,
      fail,
    });
    const tracker = createKnowledgeWikiSourceTracker({
      tenantId: input.tenantId,
      knowledge: prepared.knowledge,
      readWiki: wiki,
    });
    for (const entry of history) tracker.visit(entry, wiki(entry));
    const releaseWikiDigests = new Set(
      (release?.dependencies ?? [])
        .filter(
          (dependency) =>
            dependency.kind === "wiki" &&
            dependency.disposition === "quarantine",
        )
        .map((dependency) => dependency.digest),
    );
    const releaseCoversRun = history
      .filter((event) => event.correlationId === input.correlationId)
      .some((event) => releaseWikiDigests.has(wiki(event).stateDigest));
    const { previous, unsafePatternIds } = tracker.visit(input, candidate, {
      proposed: true,
    });
    for (const id of unsafePatternIds) {
      let restorationBaseline = null;
      for (const event of history) {
        if (event.correlationId !== input.correlationId) continue;
        const state = wiki(event).state;
        if (state.patterns[id] && state.patterns[id].status !== "quarantined") {
          restorationBaseline = state;
        }
        if (state.patterns[id]?.status === "quarantined") break;
      }
      const next = candidate.state.patterns[id];
      // Permit removal/terminalization and unchanged pending cleanup batches.
      if (!next || (TERMINAL.has(next.status) && next.actionable === false))
        continue;
      if (
        !previous.patterns[id] ||
        !same(exposure(previous, id), exposure(candidate.state, id))
      ) {
        if (
          isReleasedWikiRestoration(
            previous,
            candidate,
            id,
            release,
            releaseCoversRun,
            restorationBaseline,
          )
        ) {
          continue;
        }
        const error = new Error(
          "Wiki source admission: revoked Knowledge cannot create, rewrite or reactivate a Wiki pattern",
        );
        error.code = WIKI_SOURCE_REVOKED_CODE;
        throw error;
      }
    }
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
