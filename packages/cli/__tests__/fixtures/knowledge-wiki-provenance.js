import {
  WikiMaintainerLedgerAdapter,
  captureWikiRevisionReader,
} from "../../src/lib/evolution/wiki-maintainer-ledger-adapter.js";
import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  digestWikiState as D,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";

export function openKnowledgeWikiProvenance(resources, source) {
  const descriptor = {
    ...resources.descriptor,
    evolutionRunId: "knowledge-source-wiki",
  };
  const adapter = new WikiMaintainerLedgerAdapter({
    descriptor,
    artifactPorts: resources.artifactPorts,
    ledger: resources.backend.ledger,
    ledgerArtifactResolver: resources.resolver,
  });
  const evidence = (known) => {
    const core = {
      schema: WIKI_EVIDENCE_SCHEMA,
      tenantId: descriptor.tenantId,
      ref: known ? source.ref : "knowledge://safe/source",
      sourceDigest: known ? source.digest : D("safe-source"),
      projectionDigest: D(known ? "knowledge-projection" : "safe-projection"),
      artifactRef: known ? source.ref : "knowledge://safe/source",
      trustedProjection: true,
      trustDomain: "test-knowledge-authority",
      kind: "tool-observation",
      status: "active",
      observedAt: "2026-09-05T00:00:00.000Z",
      expiresAt: null,
      data: { result: "verified source metadata" },
    };
    return { ...core, envelopeDigest: D(core) };
  };
  async function write(known, { delayed = false, tombstone = false } = {}) {
    const item = evidence(known);
    const patternId = known ? "pat-knowledge" : "pat-safe";
    let pending = null;
    const maintainer = new EvidenceBackedWikiMaintainer({
      descriptor: {
        tenantId: descriptor.tenantId,
        evolutionRunId: descriptor.evolutionRunId,
        maintainerModel: "test:knowledge-maintainer",
        rulesDigest: D("knowledge-wiki-rules"),
      },
      policy: {
        trustedProjectionRead: true,
        rawEvidenceRead: false,
        activeSkillWrite: false,
        shell: false,
        network: false,
        secretRead: false,
      },
      ports: {
        ...adapter.maintainerPorts({
          resolveEvidence: () => item,
          derive: () => ({
            operations: [
              tombstone
                ? {
                    type: "tombstone",
                    patternId,
                    reason:
                      "later Wiki removal must preserve historical lineage",
                  }
                : {
                    type: "upsert",
                    pattern: {
                      patternId,
                      kind: "success",
                      summary: known
                        ? "Procedure derived from revoked knowledge"
                        : "Independent safe baseline procedure",
                      rootCause: known
                        ? "Knowledge evidence"
                        : "Unrelated evidence",
                      procedure: "Verify the applicable procedure",
                      appliesWhen: ["verified source"],
                      doesNotApplyWhen: [],
                      positiveEvidence: [item.ref],
                      negativeEvidence: [],
                      contradicts: [],
                      supersedes: [],
                      confidence: 0.8,
                      trustDomains: [],
                      lastVerifiedAt: item.observedAt,
                      expiresAt: null,
                      skillNames: ["safe-refactor"],
                    },
                  },
            ],
          }),
        }),
        ...(delayed
          ? {
              commitRevision(input) {
                pending = input;
                throw new Error("test-delayed-wiki-commit");
              },
            }
          : {}),
      },
    });
    try {
      await maintainer.maintain({
        evidenceRefs: [item.ref],
        effectiveAt: item.observedAt,
      });
    } catch (error) {
      if (!delayed || error.message !== "test-delayed-wiki-commit") throw error;
    }
    return (
      pending ?? {
        revision: {
          ...adapter.loadWiki(),
          revisionId: adapter.loadWiki().state.revisionId,
        },
      }
    );
  }
  const reader = captureWikiRevisionReader(adapter);
  return {
    adapter,
    reader,
    write,
    async seed({ late = false } = {}) {
      await write(false);
      const baseline = adapter.loadWiki();
      const pending = await write(true, { delayed: late });
      const candidate = late
        ? {
            state: pending.revision.state,
            stateDigest: pending.revision.stateDigest,
          }
        : adapter.loadWiki();
      return {
        baseline,
        candidate,
        commitDelayed: () => adapter.commitRevision(pending),
      };
    },
  };
}
