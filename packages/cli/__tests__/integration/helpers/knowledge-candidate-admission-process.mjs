import { openKnowledgeSkillRollbackStore } from "../../fixtures/governed-knowledge-skill-rollback.js";

const [root, mode] = process.argv.slice(2);
if (!root || !["seed", "prepare", "promote"].includes(mode))
  throw new Error("invalid test worker mode");
const h = await openKnowledgeSkillRollbackStore(root, {
  seed: mode === "seed",
  crashPoint: mode === "prepare" ? "after-dependency-prepare" : "none",
});
let errors = [];
if (mode === "seed") await h.release.rollback(h.knowledge.contentDigest);
if (mode === "prepare") {
  await h.makeSync().publish({
    ...h.knowledge,
    dependencies: [
      {
        kind: "candidate",
        digest: h.release.candidateRelease.candidate.candidateId,
        disposition: "reject-candidate",
      },
    ],
  });
  throw new Error("test process did not stop after durable preparation");
}
if (mode === "promote") {
  try {
    await h.release.promoteCandidate(`process:promotion:${process.pid}`);
    throw new Error("revoked candidate was promoted");
  } catch (error) {
    let current = error;
    while (current) {
      errors.push(current.code ?? null);
      current = current.cause;
    }
    if (!errors.includes("CC_EVOLUTION_LEDGER_CANDIDATE_REVOKED"))
      throw new Error("promotion failed for the wrong reason");
  }
}
const events = h.resources.backend.ledger.read();
process.stdout.write(
  JSON.stringify({
    pid: process.pid,
    errors,
    active: h.release.readActive().release.releaseDigest,
    baseline: h.release.baseline.releaseDigest,
    revision: h.release.readActive().state.revision,
    transitions: h.release.inspect().transitions.length,
    prepared: events.filter(
      (e) => e.type === "knowledge.revocation-dependencies.prepared",
    ).length,
    settled: events.filter(
      (e) => e.type === "knowledge.revocation-dependencies.settled",
    ).length,
    published: events.filter((e) => e.type === "knowledge.sync.committed")
      .length,
  }),
);
