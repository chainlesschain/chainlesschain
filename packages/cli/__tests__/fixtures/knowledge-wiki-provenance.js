import {
  WikiMaintainerLedgerAdapter,
  captureWikiRevisionReader,
} from "../../src/lib/evolution/wiki-maintainer-ledger-adapter.js";
import {
  EvidenceBackedWikiMaintainer,
  WIKI_EVIDENCE_SCHEMA,
  digestWikiState as D,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";

export function openKnowledgeWikiProvenance(
  resources,
  source,
  { evolutionRunId = "knowledge-source-wiki", negativeSource = false } = {},
) {
  const descriptor = {
    ...resources.descriptor,
    evolutionRunId,
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
  async function write(
    known,
    {
      delayed = false,
      tombstone = false,
      patternIds = [known ? "pat-knowledge" : "pat-safe"],
    } = {},
  ) {
    const item = evidence(known);
    const positive = known && negativeSource ? evidence(false) : item;
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
          resolveEvidence: (ref) => (ref === item.ref ? item : positive),
          derive: () => ({
            operations: patternIds.map((patternId) =>
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
                        ? `Procedure derived from revoked knowledge${patternId.startsWith("pat-knowledge-") ? ` ${patternId}` : ""}`
                        : "Independent safe baseline procedure",
                      rootCause: known
                        ? "Knowledge evidence"
                        : "Unrelated evidence",
                      procedure: "Verify the applicable procedure",
                      appliesWhen: ["verified source"],
                      doesNotApplyWhen: [],
                      positiveEvidence: [positive.ref],
                      negativeEvidence: positive === item ? [] : [item.ref],
                      contradicts: [],
                      supersedes: [],
                      confidence: 0.8,
                      trustDomains: [],
                      lastVerifiedAt: item.observedAt,
                      expiresAt: null,
                      skillNames: ["safe-refactor"],
                    },
                  },
            ),
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
        evidenceRefs: [...new Set([item.ref, positive.ref])],
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
    async seed({ late = false, patternCount = 1 } = {}) {
      if (
        !Number.isSafeInteger(patternCount) ||
        patternCount < 1 ||
        (late && patternCount !== 1)
      )
        throw new Error("invalid test Wiki pattern count");
      await write(false);
      const baseline = adapter.loadWiki();
      let pending;
      for (let offset = 0; offset < patternCount; offset += 128) {
        pending = await write(true, {
          delayed: late,
          patternIds: Array.from(
            { length: Math.min(128, patternCount - offset) },
            (_, index) =>
              offset + index === 0
                ? "pat-knowledge"
                : `pat-knowledge-${String(offset + index).padStart(4, "0")}`,
          ),
        });
      }
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
