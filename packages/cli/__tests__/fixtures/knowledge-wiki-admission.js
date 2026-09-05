import { source } from "./governed-knowledge-skill-rollback.js";
import { openKnowledgeWikiProvenance } from "./knowledge-wiki-provenance.js";
import { digestWikiState } from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";
import { verifyGovernedKnowledgeRecord } from "../../src/lib/evolution/governed-knowledge-record.js";
import {
  GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA,
  GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE,
  digestGovernedKnowledgeDependencyOperation,
} from "../../src/lib/evolution/governed-knowledge-revocation-record.js";
import { pruningDigest } from "../../src/lib/evolution/governed-wiki-pruning-journal.js";

export function appendAdmissionTestFence(
  h,
  {
    tenantId = h.descriptor.tenantId,
    deviceId = "device:other",
    streamId = "knowledge:other-stream",
    mutate = null,
  } = {},
) {
  const knowledge = verifyGovernedKnowledgeRecord(
    { ...h.knowledge, tenantId },
    { tenantId },
  );
  const operationDigest = digestGovernedKnowledgeDependencyOperation({
    tenantId,
    deviceId,
    knowledge,
  });
  const core = {
    schema: GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA,
    tenantId,
    deviceId,
    operationDigest,
    knowledge,
    preparedAt: new Date(h.resources.clock()).toISOString(),
  };
  const prepared = structuredClone({
    ...core,
    recordDigest: pruningDigest(
      GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_SCHEMA,
      core,
    ),
  });
  mutate?.(prepared);
  const artifact = h.resources.artifactPorts.putCanonical(
    "governed-knowledge-dependency-operation",
    prepared,
    {
      audience: h.descriptor.audience,
      purpose: h.descriptor.purpose,
      retention: "ledger",
    },
  );
  return h.resources.backend.ledger.appendDomainEvent({
    artifactTenantId: h.descriptor.artifactTenantId,
    correlationId: streamId,
    decision: "prepared",
    eventId: `${GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE}.${operationDigest.slice(7)}`,
    reason: "test independently retained Knowledge fence",
    skillName: null,
    sourceRefs: [],
    subjectRef: artifact.ref,
    tenantId,
    timestamp: core.preparedAt,
    type: GOVERNED_KNOWLEDGE_DEPENDENCY_PREPARED_EVENT_TYPE,
  });
}

export async function stageWikiAdmission(
  h,
  {
    ref = source.ref,
    contentDigest = source.digest,
    patternId = "pat-knowledge-reappeared",
    evolutionRunId = h.wiki.adapter.descriptor.evolutionRunId,
  } = {},
) {
  const wiki = openKnowledgeWikiProvenance(
    h.resources,
    { ref, digest: contentDigest },
    { evolutionRunId },
  );
  const pending = await wiki.write(true, {
    delayed: true,
    patternIds: [patternId],
  });
  return { wiki, pending };
}

// Adversarial direct writer: real retained artifact and genuine Ledger, with
// no Wiki adapter or optional head CAS. It must still hit mandatory admission.
export function appendRawWiki(h, staged, mutate = null) {
  const revision = structuredClone(staged.pending.revision);
  mutate?.(revision.state);
  revision.stateDigest = digestWikiState(revision.state);
  const descriptor = staged.wiki.adapter.descriptor;
  const previous = h.resources.backend.ledger
    .read()
    .filter(
      (event) =>
        event.type === "wiki.revision.committed" &&
        event.tenantId === descriptor.tenantId &&
        event.correlationId === descriptor.evolutionRunId,
    )
    .at(-1);
  const artifact = h.resources.artifactPorts.putCanonical(
    "wiki-revision",
    revision,
    {
      audience: descriptor.audience,
      purpose: descriptor.purpose,
      retention: "ledger",
    },
  );
  return h.resources.backend.ledger.appendDomainEvent({
    artifactTenantId: descriptor.artifactTenantId,
    correlationId: descriptor.evolutionRunId,
    decision: "committed",
    eventId: `wiki.revision.${revision.revisionId.slice(5)}`,
    reason: "test direct Wiki writer",
    skillName: null,
    sourceRefs: previous ? [previous.subjectRef] : [],
    subjectRef: artifact.ref,
    tenantId: descriptor.tenantId,
    timestamp: revision.effectiveAt,
    type: "wiki.revision.committed",
  });
}

export function rebuildAdmissionTestIndex(state) {
  state.index = Object.values(state.patterns)
    .filter(
      (pattern) => !["tombstoned", "revoked", "stale"].includes(pattern.status),
    )
    .map((pattern) => ({
      patternId: pattern.patternId,
      kind: pattern.kind,
      status: pattern.status,
      summary: pattern.summary,
      confidence: pattern.operationalConfidence,
      actionable: pattern.actionable,
      skillNames: pattern.skillNames,
    }));
}
