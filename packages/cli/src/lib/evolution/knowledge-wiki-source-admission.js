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
    const tracker = createKnowledgeWikiSourceTracker({
      tenantId: input.tenantId,
      knowledge: prepared.knowledge,
      readWiki: wiki,
    });
    for (const entry of history) tracker.visit(entry, wiki(entry));
    const { previous, unsafePatternIds } = tracker.visit(input, candidate, {
      proposed: true,
    });
    for (const id of unsafePatternIds) {
      const next = candidate.state.patterns[id];
      // Permit removal/terminalization and unchanged pending cleanup batches.
      if (!next || (TERMINAL.has(next.status) && next.actionable === false))
        continue;
      if (
        !previous.patterns[id] ||
        !same(exposure(previous, id), exposure(candidate.state, id))
      ) {
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
