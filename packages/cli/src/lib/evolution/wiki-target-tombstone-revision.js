import {
  EvidenceBackedWikiMaintainer,
  WIKI_MAINTENANCE_REQUEST_SCHEMA,
  digestWikiState,
} from "./evidence-backed-wiki-maintainer.js";

const POLICY = Object.freeze({
  trustedProjectionRead: true,
  rawEvidenceRead: false,
  activeSkillWrite: false,
  shell: false,
  network: false,
  secretRead: false,
});
function freeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

// Pure derivation only; this function has no persistence or authorization port.
// Callers must authenticate the source and authorize the exact operations, then
// commit through the real adapter with the same authenticated head/sequence CAS.
export async function deriveWikiTargetTombstoneRevision({
  source,
  descriptor,
  operations,
  effectiveAt,
  requestDigest,
}) {
  if (
    !Array.isArray(operations) ||
    operations.length < 1 ||
    operations.length > 128 ||
    operations.some((operation) => operation.type !== "tombstone")
  )
    throw new TypeError(
      "target-only Wiki derivation requires bounded tombstones",
    );
  const ref = Object.keys(source.state.evidence ?? {}).sort()[0];
  if (!ref)
    throw new TypeError(
      "Wiki tombstones require retained authenticated evidence metadata",
    );
  const core = source.state.evidence[ref];
  const evidence = { ...core, envelopeDigest: digestWikiState(core) };
  let revision = null;
  const maintainer = new EvidenceBackedWikiMaintainer({
    descriptor,
    policy: POLICY,
    ports: Object.freeze({
      loadWiki: () => source,
      resolveEvidence: () => evidence,
      derive: () => ({ operations }),
      commitRevision: ({ revision: next }) => {
        revision = next;
        return {
          committed: true,
          revisionId: next.revisionId,
          stateDigest: next.stateDigest,
          evolutionRunId: next.evolutionRunId,
        };
      },
    }),
  });
  await maintainer.maintain({
    evidenceRefs: [ref],
    effectiveAt,
    maintenanceRequest: {
      schema: WIKI_MAINTENANCE_REQUEST_SCHEMA,
      tenantId: descriptor.tenantId,
      requestDigest,
      requestId: `wiki-maintenance:${requestDigest.slice(7)}`,
    },
  });
  if (!revision)
    throw new Error(
      "Wiki tombstone derivation unexpectedly reused an existing request",
    );
  // General maintenance also recalculates unrelated patterns. A targeted
  // revocation has no authority to change their lifecycle, confidence or facts.
  const scoped = structuredClone(source.state);
  const targets = new Set(operations.map((operation) => operation.patternId));
  for (const id of targets) scoped.patterns[id] = revision.state.patterns[id];
  if (!Array.isArray(source.state.index))
    throw new TypeError("Wiki source index is invalid");
  scoped.index = source.state.index.filter(
    (entry) => !targets.has(entry.patternId),
  );
  scoped.revision = revision.revision;
  scoped.revisionId = revision.revisionId;
  scoped.maintenanceRequests = revision.state.maintenanceRequests;
  scoped.evolutionLog = revision.state.evolutionLog;
  return freeze({
    ...revision,
    state: scoped,
    stateDigest: digestWikiState(scoped),
  });
}
