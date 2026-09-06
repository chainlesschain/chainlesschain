import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  openKnowledgeSkillRollbackStore,
  source,
} from "../fixtures/governed-knowledge-skill-rollback.js";
import { createGovernedKnowledgeWikiTombstoneAuthority } from "../../src/lib/evolution/governed-knowledge-wiki-tombstone.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-multihop-wiki-effect-"),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, {
    seed: true,
    wikiProvenance: true,
    wikiHops: 2,
    wikiTombstone: "combined",
    wikiTombstoneAllRuns: true,
    ...options,
  });
}
const events = (h, type) =>
  h.resources.backend.ledger.read().filter((event) => event.type === type);

it.each(["uri", "state-digest", "artifact-digest"])(
  "actually cleans every explicitly planned Wiki run through %s ancestry",
  async (wikiHopReference) => {
    const h = await setup({ wikiHopReference });
    const wikis = [...h.upstreamWikis, h.wiki];
    const before = wikis.map((wiki) => wiki.adapter.loadWiki());
    await h.makeSync().publish(h.knowledge);
    expect(h.release.readActive().release).toEqual(h.release.baseline);
    for (const [index, wiki] of wikis.entries()) {
      const current = wiki.adapter.loadWiki();
      expect(current.state.patterns["pat-knowledge"].status).toBe("tombstoned");
      expect(current.state.patterns["pat-safe"]).toEqual(
        before[index].state.patterns["pat-safe"],
      );
      expect(current.state.evidence).toEqual(before[index].state.evidence);
      expect(
        current.state.index.some(
          (entry) => entry.patternId === "pat-knowledge",
        ),
      ).toBe(false);
    }
    expect(events(h, "wiki.revision.committed")).toHaveLength(9);
    expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
      1,
    );
    expect(events(h, "knowledge.sync.committed")).toHaveLength(1);
    expect((await h.executor.execute(h.knowledge)).resultDigests).toHaveLength(
      5,
    );
    const reopened = await openKnowledgeSkillRollbackStore(h.root, {
      wikiProvenance: true,
      wikiHops: 2,
      wikiHopReference,
      wikiTombstone: "combined",
      wikiTombstoneAllRuns: true,
    });
    expect(reopened.knowledge).toEqual(h.knowledge);
    expect(await reopened.executor.execute(reopened.knowledge)).toMatchObject({
      recovered: true,
    });
    expect(events(reopened, "wiki.revision.committed")).toHaveLength(9);
  },
  300_000,
);

it("requires unique, genuinely bound, independent readers for every configured run", async () => {
  const h = await setup();
  const options = h.wikiTombstoneOptions;
  const target = options.additionalWikiTargets[0];
  let accessed = false;
  const accessor = {
    verifierWikiLedgerAdapter: target.verifierWikiLedgerAdapter,
  };
  Object.defineProperty(accessor, "wikiLedgerAdapter", {
    enumerable: true,
    get() {
      accessed = true;
      return target.wikiLedgerAdapter;
    },
  });
  expect(() =>
    createGovernedKnowledgeWikiTombstoneAuthority({
      ...options,
      additionalWikiTargets: [accessor],
    }),
  ).toThrow(/accessors/);
  expect(accessed).toBe(false);
  expect(() =>
    createGovernedKnowledgeWikiTombstoneAuthority({
      ...options,
      additionalWikiTargets: new Array(1),
    }),
  ).toThrow(/dense/);
  expect(() =>
    createGovernedKnowledgeWikiTombstoneAuthority({
      ...options,
      additionalWikiTargets: new Proxy([], {}),
    }),
  ).toThrow(/dense/);
  expect(() =>
    createGovernedKnowledgeWikiTombstoneAuthority({
      ...options,
      additionalWikiTargets: [target, target],
    }),
  ).toThrow(/duplicate|unique/);
  expect(() =>
    createGovernedKnowledgeWikiTombstoneAuthority({
      ...options,
      additionalWikiTargets: [
        { ...target, verifierWikiLedgerAdapter: target.wikiLedgerAdapter },
      ],
    }),
  ).toThrow(/independent/);
  expect(() =>
    createGovernedKnowledgeWikiTombstoneAuthority({
      ...options,
      additionalWikiTargets: [
        { ...target, wikiLedgerAdapter: { ...target.wikiLedgerAdapter } },
      ],
    }),
  ).toThrow();
}, 180_000);

it("does not infer exact destructive authority from a URI-only conservative admission match", async () => {
  const h = await setup({
    wikiTombstone: true,
    wikiTombstoneAllRuns: false,
    transformWikiHopSource: (entry, hop) =>
      hop === 2
        ? { ref: source.ref, digest: `sha256:${"d".repeat(64)}` }
        : entry,
  });
  const before = h.wiki.adapter.loadWiki();
  await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
    /does not identify/,
  );
  expect(h.wiki.adapter.loadWiki()).toEqual(before);
  expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
    0,
  );
  expect(h.sent).toHaveLength(0);
}, 180_000);

it("resolves the originally pinned lineage after an upstream Wiki was independently tombstoned", async () => {
  const h = await setup({
    wikiTombstone: true,
    wikiTombstoneAllRuns: false,
    wikiNegativeSource: true,
  });
  await h.upstreamWikis[0].write(true, { tombstone: true });
  const upstream = h.upstreamWikis[0].adapter.loadWiki();
  await h.makeSync().publish(h.knowledge);
  expect(h.wiki.adapter.loadWiki().state.patterns["pat-knowledge"].status).toBe(
    "tombstoned",
  );
  expect(h.upstreamWikis[0].adapter.loadWiki()).toEqual(upstream);
  expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
    1,
  );
}, 240_000);

it("retains partial effects but refuses settlement for a target outside the fixed run set", async () => {
  const h = await setup({ wikiTombstone: true, wikiTombstoneAllRuns: false });
  const upstream = h.upstreamWikis[0].adapter.loadWiki();
  const knowledge = {
    ...h.knowledge,
    dependencies: [
      ...h.knowledge.dependencies,
      { kind: "wiki", disposition: "tombstone", digest: upstream.stateDigest },
    ],
  };
  await expect(h.makeSync().publish(knowledge)).rejects.toThrow(
    /absent from the configured/,
  );
  expect(h.wiki.adapter.loadWiki().state.patterns["pat-knowledge"].status).toBe(
    "tombstoned",
  );
  expect(h.upstreamWikis[0].adapter.loadWiki()).toEqual(upstream);
  expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
    0,
  );
  expect(h.sent).toHaveLength(0);
}, 240_000);
