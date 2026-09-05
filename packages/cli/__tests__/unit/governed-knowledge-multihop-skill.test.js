import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { EVOLUTION_LEDGER_SOURCE_REVOKED_CODE } from "../../src/lib/evolution/evolution-ledger-ports.js";
import { WIKI_SOURCE_ADMISSION_INVALID_CODE } from "../../src/lib/evolution/knowledge-wiki-source-provenance.js";
import { openKnowledgeSkillRollbackStore } from "../fixtures/governed-knowledge-skill-rollback.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync(os.tmpdir()), "cc-knowledge-multihop-"),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, {
    seed: true,
    wikiProvenance: true,
    wikiHops: 2,
    candidateRejection: "combined",
    ...options,
  });
}
function codes(error) {
  const result = [];
  while (error) {
    result.push(error.code);
    error = error.cause;
  }
  return result;
}

it.each(["missing", "digest-mismatch"])(
  "fails closed for a declared upstream Wiki source that is %s",
  async (mode) => {
    const h = await setup({
      transformWikiHopSource: (entry, hop) =>
        hop !== 1
          ? entry
          : mode === "missing"
            ? {
                ...entry,
                ref: `wiki-source://${"tenant-knowledge-rollback"}/wiki:${"c".repeat(64)}`,
              }
            : { ...entry, digest: `sha256:${"d".repeat(64)}` },
    });
    expect(() => provenance(h)).toThrow(
      /earlier authenticated source revision/,
    );
    await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
      /earlier authenticated source revision/,
    );
    expect(h.release.inspect().transitions).toHaveLength(2);
    expect(h.sent).toHaveLength(0);
    const candidate = h.release.createDerivedCandidate();
    const before = h.release.readActive();
    const error = await h.release
      .promoteCandidate("multihop:bad-source", candidate.candidateId)
      .catch((cause) => cause);
    expect(codes(error)).toContain(WIKI_SOURCE_ADMISSION_INVALID_CODE);
    expect(h.release.readActive()).toEqual(before);
    expect(h.release.inspect().transitions).toHaveLength(2);
  },
  180_000,
);
function provenance(h, contentDigest = h.knowledge.contentDigest) {
  return h.wiki.reader.readKnowledgeProvenance({
    tenantId: h.knowledge.tenantId,
    knowledgeId: h.knowledge.knowledgeId,
    contentDigest,
    revisionId: h.release.candidateRelease.candidate.wikiRevision,
  });
}
async function rejectNewCandidate(h) {
  // Self-reported safe evidence must not replace the whole pinned Wiki context.
  const candidate = h.release.createDerivedCandidate({
    sourceEvidenceRefs: h.release.baseline.candidate.sourceEvidenceRefs,
  });
  const before = h.release.readActive();
  const transitions = h.release.inspect().transitions.length;
  const error = await h.release
    .promoteCandidate("multihop:denied", candidate.candidateId)
    .catch((e) => e);
  expect(codes(error)).toContain(EVOLUTION_LEDGER_SOURCE_REVOKED_CODE);
  expect(h.release.readActive()).toEqual(before);
  expect(h.release.inspect().transitions).toHaveLength(transitions);
}

it.each([
  [1, "uri", false],
  [2, "uri", false],
  [2, "state-digest", false],
  [2, "artifact-digest", false],
  [2, "uri", true],
])(
  "settles rollback/rejection through %s hops (%s, negative=%s) and denies reuse",
  async (wikiHops, wikiHopReference, wikiNegativeSource) => {
    const h = await setup({ wikiHops, wikiHopReference, wikiNegativeSource });
    expect(provenance(h)).toMatchObject({
      authenticated: true,
      affectedPatternIds: ["pat-knowledge"],
      unsafePatternIds: ["pat-knowledge"],
    });
    // A later removal must not erase the immutable ancestry of an existing Skill.
    await h.upstreamWikis[0].write(true, { tombstone: true });
    await expect(h.makeSync().publish(h.knowledge)).resolves.toMatchObject({
      action: "revoke",
    });
    expect(h.release.readActive().release).toEqual(h.release.baseline);
    expect(h.independent.readActive().release).toEqual(h.release.baseline);
    const result = await h.executor.execute(h.knowledge);
    expect(result).toMatchObject({ recovered: true, durable: true });
    expect(result.resultDigests).toHaveLength(2);
    expect(h.release.inspect().transitions).toHaveLength(3);
    await rejectNewCandidate(h);
  },
  240_000,
);

it("refuses an indirectly tainted last-known-good instead of settling a false rollback", async () => {
  const h = await setup({ unsafeWikiBaseline: true });
  await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
    /last-known-good Wiki revision still depends/,
  );
  expect(h.release.readActive().release).toEqual(h.release.candidateRelease);
  expect(h.release.inspect().transitions).toHaveLength(2);
  expect(
    h.resources.backend.ledger
      .read()
      .filter((e) => e.type.endsWith("dependencies.settled")),
  ).toHaveLength(0);
  expect(h.sent).toHaveLength(0);
}, 180_000);

it("distinguishes exact destructive provenance from conservative admission for a changed source digest", async () => {
  const h = await setup();
  const contentDigest = `sha256:${"f".repeat(64)}`;
  expect(provenance(h, contentDigest)).toMatchObject({
    affectedPatternIds: [],
    unsafePatternIds: ["pat-knowledge"],
  });
  await expect(
    h.makeSync().publish({ ...h.knowledge, contentDigest }),
  ).rejects.toThrow(/no exact Knowledge source lineage/);
  expect(h.release.inspect().transitions).toHaveLength(2);
  await rejectNewCandidate(h);
}, 180_000);

it("does not accept a multi-hop Wiki revision committed after the original release preparation", async () => {
  const h = await setup({ lateWikiProvenance: true });
  await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
    /precede the original release preparation/,
  );
  expect(h.release.readActive().release).toEqual(h.release.candidateRelease);
  expect(h.release.inspect().transitions).toHaveLength(2);
}, 180_000);

it("allows the original unrelated Wiki baseline without treating later taint as earlier ancestry", async () => {
  const h = await setup();
  await h.makeSync().publish(h.knowledge);
  const baseline = h.release.baseline.candidate;
  const candidate = h.release.createDerivedCandidate({
    wikiRevision: baseline.wikiRevision,
    sourceEvidenceRefs: baseline.sourceEvidenceRefs,
  });
  await expect(
    h.release.promoteCandidate("multihop:safe", candidate.candidateId),
  ).resolves.toMatchObject({ state: { revision: 4 } });
}, 180_000);
