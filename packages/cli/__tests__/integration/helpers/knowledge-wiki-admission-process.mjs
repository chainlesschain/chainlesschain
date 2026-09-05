import { openKnowledgeSkillRollbackStore } from "../../fixtures/governed-knowledge-skill-rollback.js";
import {
  stageWikiAdmission,
  appendRawWiki,
} from "../../fixtures/knowledge-wiki-admission.js";
import { WIKI_SOURCE_REVOKED_CODE } from "../../../src/lib/evolution/knowledge-wiki-source-admission.js";

const [root, mode, writer = "adapter", run = "same", attempt = "one"] =
  process.argv.slice(2);
if (!root || !["seed", "prepare", "attempt", "inspect"].includes(mode))
  throw new Error("invalid Wiki admission worker request");
const h = await openKnowledgeSkillRollbackStore(root, {
  seed: mode === "seed",
  wikiProvenance: true,
  wikiTombstone: true,
  crashPoint: mode === "prepare" ? "after-dependency-prepare" : "none",
});
if (mode === "prepare") await h.makeSync().publish(h.knowledge);
let blocked = null;
if (mode === "attempt") {
  const staged = await stageWikiAdmission(h, {
    patternId: `pat-knowledge-new-${attempt}`,
    evolutionRunId:
      run === "new"
        ? `new-wiki-${attempt}`
        : h.wiki.adapter.descriptor.evolutionRunId,
  });
  try {
    if (writer === "raw") appendRawWiki(h, staged);
    else staged.wiki.adapter.commitRevision(staged.pending);
    blocked = false;
  } catch (error) {
    if (error.code !== WIKI_SOURCE_REVOKED_CODE) throw error;
    blocked = true;
  }
}
const events = h.resources.backend.ledger.read();
process.stdout.write(
  JSON.stringify({
    pid: process.pid,
    blocked,
    wikiStateDigest: h.wiki.adapter.loadWiki().stateDigest,
    wikiRevisions: events.filter(
      (event) => event.type === "wiki.revision.committed",
    ).length,
    prepared: events.filter(
      (event) => event.type === "knowledge.revocation-dependencies.prepared",
    ).length,
    settled: events.filter(
      (event) => event.type === "knowledge.revocation-dependencies.settled",
    ).length,
    published: events.filter(
      (event) => event.type === "knowledge.sync.committed",
    ).length,
    sequence: h.resources.backend.ledger.verify().sequence,
  }),
);
