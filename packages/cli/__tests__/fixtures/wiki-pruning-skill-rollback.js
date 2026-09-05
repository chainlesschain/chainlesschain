import { openEvolutionDurableStore } from "./evolution-durable-store.js";
import { openRevocationReleaseRegistry } from "./skill-revocation-release-registry.js";
import { openPruningMaintenanceStore } from "./governed-wiki-pruning-maintenance.js";
import { GovernedWikiPruningSkillRollback } from "../../src/lib/evolution/governed-wiki-pruning-skill-rollback.js";
import {
  WIKI_EVIDENCE_SCHEMA,
  digestWikiState as D,
} from "../../src/lib/evolution/evidence-backed-wiki-maintainer.js";

// One actual ArtifactStore/Ledger/witness for release, Wiki and pruning. PKI,
// admission and review identities remain explicitly test-owned authorities.
export async function openPruningRollbackStore(
  root,
  {
    seed = false,
    baselinePatternRefs = [],
    candidateId = null,
    crashPoint = "none",
    ...hooks
  } = {},
) {
  const resources = openEvolutionDurableStore(root);
  const release = await openRevocationReleaseRegistry({
    root,
    storage: { ...resources, now: resources.clock() },
    fsImpl: resources.fsImpl,
    tenantId: resources.descriptor.tenantId,
    artifactTenantId: resources.descriptor.artifactTenantId,
    candidateEvidenceRefs: [
      {
        ref: `artifact://${resources.descriptor.tenantId}/trusted/retained-metadata`,
        digest: D("retained-source"),
      },
    ],
    seed,
    crashPoint,
  });
  const rollback = new GovernedWikiPruningSkillRollback(
    release.pruningRollbackOptions,
  );
  const h = openPruningMaintenanceStore(root, {
    realDependencies: true,
    dependencyDeletion: true,
    skillRollbackProvider: rollback,
    ...hooks,
  });
  if (seed) {
    await h.seed(1, { skillNames: ["safe-refactor"] });
    for (const [current, patternRefs] of [
      [release.baseline, baselinePatternRefs],
      [release.candidateRelease, ["pat-maintenance-0000"]],
    ]) {
      const decision = {
        candidateId:
          current === release.candidateRelease && candidateId !== null
            ? candidateId
            : current.candidate.candidateId,
        skillName: "safe-refactor",
        outcome: "accepted",
        patternRefs,
        reason: "test-authority lineage of actual committed release",
      };
      const receiptRef = `decision:${current.candidate.candidateId}`;
      await h.writeWiki(
        [{ type: "proposal-impact", decision: { ...decision, receiptRef } }],
        null,
        {
          schema: WIKI_EVIDENCE_SCHEMA,
          tenantId: h.descriptor.tenantId,
          ref: receiptRef,
          sourceDigest: current.mutationRequestDigest,
          projectionDigest: D(decision),
          artifactRef: `artifact://${h.descriptor.tenantId}/trusted/${current.releaseDigest.slice(7)}`,
          trustedProjection: true,
          trustDomain: "test-release-lineage",
          kind: "proposal-decision",
          status: "active",
          observedAt: "2026-09-05T00:00:00.000Z",
          expiresAt: null,
          data: {
            decisionDigest: D(decision),
            releaseDigest: current.releaseDigest,
          },
        },
      );
    }
  }
  return { ...h, release, rollback };
}
