import { randomUUID } from "node:crypto";
import {
  openKnowledgeSkillRollbackStore,
  knowledgeId,
} from "../../fixtures/governed-knowledge-skill-rollback.js";

const processInstanceId = randomUUID();
const [
  root,
  mode,
  crashPoint = "none",
  provenance = "direct",
  dependencies = "active",
] = process.argv.slice(2);
if (!root || !["seed", "execute", "inspect"].includes(mode))
  throw new Error("invalid rollback worker request");
const h = await openKnowledgeSkillRollbackStore(root, {
  seed: mode === "seed",
  crashPoint,
  wikiProvenance: ["wiki", "wiki-multihop"].includes(provenance),
  wikiHops: provenance === "wiki-multihop" ? 2 : 0,
  candidateRejection: dependencies === "combined" ? "combined" : false,
  candidateQuarantine: dependencies === "quarantine" ? "combined" : false,
  wikiTombstone: ["all", "all-wikis"].includes(dependencies)
    ? "combined"
    : dependencies === "wiki",
  wikiTombstoneAllRuns: dependencies === "all-wikis",
});
if (mode === "execute") {
  await h.makeSync().publishWithArtifactEvidence(h.knowledge, {
    operationId: "knowledge-rollback-process-journey",
  });
}
const events = h.resources.backend.ledger.read();
const dependencyResult =
  ["combined", "quarantine", "wiki", "all", "all-wikis"].includes(
    dependencies,
  ) &&
  events.some(
    (event) => event.type === "knowledge.revocation-dependencies.settled",
  )
    ? await h.executor.execute(h.knowledge)
    : null;
const persistedKnowledge = await h.persisted.load({ knowledgeId });
process.stdout.write(
  JSON.stringify({
    pid: process.pid,
    ...(["combined", "quarantine", "wiki", "all", "all-wikis"].includes(
      dependencies,
    )
      ? { dependencyResultCount: dependencyResult?.resultDigests.length ?? 0 }
      : {}),
    ...(dependencies === "quarantine"
      ? {
          dependencyDispositions:
            persistedKnowledge?.dependencies.map((item) => item.disposition) ??
            [],
        }
      : {}),
    ...(dependencies === "all-wikis"
      ? {
          processInstanceId,
          wikiStates: [...h.upstreamWikis, h.wiki].map((wiki) => {
            const current = wiki.adapter.loadWiki();
            return {
              runId: wiki.adapter.descriptor.evolutionRunId,
              stateDigest: current.stateDigest,
              status: current.state.patterns["pat-knowledge"].status,
              safeStatus: current.state.patterns["pat-safe"].status,
              revision: current.state.revision,
            };
          }),
        }
      : {}),
    ...(["wiki", "all", "all-wikis"].includes(dependencies)
      ? {
          wikiStatus:
            h.wiki.adapter.loadWiki().state.patterns["pat-knowledge"].status,
          wikiStateDigest: h.wiki.adapter.loadWiki().stateDigest,
          wikiRevisions: events.filter(
            (event) => event.type === "wiki.revision.committed",
          ).length,
        }
      : {}),
    activeReleaseDigest: h.release.readActive().release.releaseDigest,
    baselineReleaseDigest: h.release.baseline.releaseDigest,
    candidateReleaseDigest: h.release.candidateRelease.releaseDigest,
    revision: h.release.readActive().state.revision,
    transitions: h.release.inspect().transitions,
    prepared: events.filter(
      (event) => event.type === "knowledge.revocation-dependencies.prepared",
    ).length,
    settled: events.filter(
      (event) => event.type === "knowledge.revocation-dependencies.settled",
    ).length,
    published: events.filter(
      (event) => event.type === "knowledge.sync.committed",
    ).length,
    knowledge: persistedKnowledge,
    sequence: h.resources.backend.ledger.verify().sequence,
  }),
);
