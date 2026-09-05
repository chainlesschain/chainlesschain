import {
  openKnowledgeSkillRollbackStore,
  knowledgeId,
} from "../../fixtures/governed-knowledge-skill-rollback.js";

const [root, mode, crashPoint = "none", provenance = "direct"] =
  process.argv.slice(2);
if (!root || !["seed", "execute", "inspect"].includes(mode))
  throw new Error("invalid rollback worker request");
const h = await openKnowledgeSkillRollbackStore(root, {
  seed: mode === "seed",
  crashPoint,
  wikiProvenance: provenance === "wiki",
});
if (mode === "execute") {
  await h.makeSync().publishWithArtifactEvidence(h.knowledge, {
    operationId: "knowledge-rollback-process-journey",
  });
}
const events = h.resources.backend.ledger.read();
process.stdout.write(
  JSON.stringify({
    pid: process.pid,
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
    knowledge: await h.persisted.load({ knowledgeId }),
    sequence: h.resources.backend.ledger.verify().sequence,
  }),
);
