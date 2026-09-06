import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  openKnowledgeSkillRollbackStore,
  source,
} from "../fixtures/governed-knowledge-skill-rollback.js";
import {
  stageWikiAdmission,
  appendRawWiki,
  rebuildAdmissionTestIndex,
  appendAdmissionTestFence,
} from "../fixtures/knowledge-wiki-admission.js";
import {
  WIKI_SOURCE_REVOKED_CODE,
  WIKI_SOURCE_ADMISSION_INVALID_CODE,
} from "../../src/lib/evolution/knowledge-wiki-source-admission.js";

const roots = [];
const D = (char) => `sha256:${char.repeat(64)}`;
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-wiki-source-admission-"),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, {
    seed: true,
    wikiProvenance: true,
    wikiTombstone: true,
    ...options,
  });
}
function snapshot(h) {
  const events = h.resources.backend.ledger.read();
  return {
    head: h.resources.backend.ledger.verify(),
    wiki: h.wiki.adapter.loadWiki(),
    prepared: events.filter(
      (event) => event.type === "knowledge.revocation-dependencies.prepared",
    ).length,
    settled: events.filter(
      (event) => event.type === "knowledge.revocation-dependencies.settled",
    ).length,
    published: events.filter(
      (event) => event.type === "knowledge.sync.committed",
    ).length,
  };
}
async function prepareOnly(h) {
  // A valid prepared source fence survives an unresolved downstream target.
  await expect(
    h.makeSync().publish({
      ...h.knowledge,
      dependencies: [
        { kind: "wiki", digest: D("e"), disposition: "tombstone" },
      ],
    }),
  ).rejects.toThrow();
  expect(snapshot(h)).toMatchObject({ prepared: 1, settled: 0, published: 0 });
}

it("honors a same-tenant fence from another Knowledge stream and device", async () => {
  const h = await setup();
  appendAdmissionTestFence(h);
  const before = snapshot(h);
  const staged = await stageWikiAdmission(h);
  expect(() => appendRawWiki(h, staged)).toThrow(
    expect.objectContaining({ code: WIKI_SOURCE_REVOKED_CODE }),
  );
  expect(snapshot(h)).toEqual(before);
}, 180_000);

it.each([
  [1, false],
  [2, false],
  [2, true],
])(
  "follows %s immutable Wiki source hops (hidden URI: %s)",
  async (hops, hiddenUri) => {
    const h = await setup();
    let parent = h.wiki.adapter.loadWiki();
    if (hops === 2) {
      const middle = await stageWikiAdmission(h, {
        ref: `wiki-source://${h.descriptor.tenantId}/${parent.state.revisionId}`,
        contentDigest: parent.stateDigest,
        evolutionRunId: "knowledge-derived-middle",
        patternId: "pat-knowledge-middle",
      });
      middle.wiki.adapter.commitRevision(middle.pending);
      parent = middle.wiki.adapter.loadWiki();
    }
    await prepareOnly(h);
    const before = snapshot(h);
    const staged = await stageWikiAdmission(h, {
      ref: hiddenUri
        ? "knowledge://opaque/wiki-copy"
        : `wiki-source://${h.descriptor.tenantId}/${parent.state.revisionId}`,
      contentDigest: parent.stateDigest,
      evolutionRunId: "knowledge-derived-leaf",
    });
    expect(() => appendRawWiki(h, staged)).toThrow(
      expect.objectContaining({ code: WIKI_SOURCE_REVOKED_CODE }),
    );
    expect(snapshot(h)).toEqual(before);
  },
  180_000,
);

it.each(["missing", "wrong-digest"])(
  "rejects %s declared Wiki provenance",
  async (attack) => {
    const h = await setup();
    await prepareOnly(h);
    const before = snapshot(h);
    const revisionId =
      attack === "missing"
        ? `wiki:${"b".repeat(64)}`
        : before.wiki.state.revisionId;
    const staged = await stageWikiAdmission(h, {
      ref: `wiki-source://${h.descriptor.tenantId}/${revisionId}`,
      contentDigest: D("a"),
      evolutionRunId: "wiki-unresolved-source",
    });
    expect(() => appendRawWiki(h, staged)).toThrow(
      expect.objectContaining({ code: WIKI_SOURCE_ADMISSION_INVALID_CODE }),
    );
    expect(snapshot(h)).toEqual(before);
  },
  180_000,
);

it("does not let another tenant's fence block this tenant's Wiki", async () => {
  const h = await setup();
  appendAdmissionTestFence(h, { tenantId: "tenant:unrelated" });
  const staged = await stageWikiAdmission(h);
  expect(staged.wiki.adapter.commitRevision(staged.pending)).toMatchObject({
    committed: true,
  });
  expect(
    h.wiki.adapter.loadWiki().state.patterns["pat-knowledge-reappeared"],
  ).toBeDefined();
}, 180_000);

it("treats an invalid retained revocation record as corruption, not absence", async () => {
  const h = await setup();
  appendAdmissionTestFence(h, {
    mutate(prepared) {
      prepared.knowledge.contentDigest = D("a");
    },
  });
  const before = snapshot(h);
  const staged = await stageWikiAdmission(h, {
    ref: "knowledge://unrelated/source",
    contentDigest: D("b"),
  });
  expect(() => appendRawWiki(h, staged)).toThrow(
    expect.objectContaining({ code: WIKI_SOURCE_ADMISSION_INVALID_CODE }),
  );
  expect(snapshot(h)).toEqual(before);
}, 180_000);

it.each([
  ["same run", {}],
  ["new run", { evolutionRunId: "new-knowledge-wiki" }],
  ["same content under another URI", { ref: "knowledge://alias/source" }],
  ["same URI with different content", { contentDigest: D("a") }],
])(
  "blocks a new Wiki pattern from revoked Knowledge: %s",
  async (_name, options) => {
    const h = await setup();
    await prepareOnly(h);
    const before = snapshot(h);
    const staged = await stageWikiAdmission(h, options);
    expect(() => staged.wiki.adapter.commitRevision(staged.pending)).toThrow(
      expect.objectContaining({ code: WIKI_SOURCE_REVOKED_CODE }),
    );
    expect(snapshot(h)).toEqual(before);
  },
  180_000,
);

it("the raw Ledger writer cannot bypass the source fence or revive a tombstoned ID", async () => {
  const h = await setup();
  await h.makeSync().publish(h.knowledge);
  const before = snapshot(h);
  const staged = await stageWikiAdmission(h, { patternId: "pat-knowledge" });
  expect(() => appendRawWiki(h, staged)).toThrow(
    expect.objectContaining({ code: WIKI_SOURCE_REVOKED_CODE }),
  );
  expect(snapshot(h)).toEqual(before);
}, 180_000);

it("does not erase historical pattern identity by swapping to safe evidence", async () => {
  const h = await setup();
  await h.makeSync().publish(h.knowledge);
  const before = snapshot(h);
  const staged = await stageWikiAdmission(h, { patternId: "pat-knowledge" });
  expect(() =>
    appendRawWiki(h, staged, (state) => {
      state.patterns["pat-knowledge"].positiveEvidence = [
        "knowledge://safe/source",
      ];
      rebuildAdmissionTestIndex(state);
    }),
  ).toThrow(expect.objectContaining({ code: WIKI_SOURCE_REVOKED_CODE }));
  expect(snapshot(h)).toEqual(before);
}, 180_000);

it("retains historical evidence aliases even after the source digest is replaced", async () => {
  const h = await setup();
  const alias = "knowledge://opaque/alias";
  const historical = await stageWikiAdmission(h, {
    ref: alias,
    patternId: "pat-knowledge-alias-original",
  });
  historical.wiki.adapter.commitRevision(historical.pending);
  await prepareOnly(h);
  const before = snapshot(h);
  const staged = await stageWikiAdmission(h, {
    ref: alias,
    contentDigest: D("a"),
    patternId: "pat-knowledge-laundered",
  });
  expect(() =>
    appendRawWiki(h, staged, (state) => {
      delete state.patterns["pat-knowledge-alias-original"];
      rebuildAdmissionTestIndex(state);
    }),
  ).toThrow(expect.objectContaining({ code: WIKI_SOURCE_REVOKED_CODE }));
  expect(snapshot(h)).toEqual(before);
}, 180_000);

it("treats negative Knowledge evidence as a dependency too", async () => {
  const h = await setup();
  await prepareOnly(h);
  const before = snapshot(h);
  const staged = await stageWikiAdmission(h);
  expect(() =>
    appendRawWiki(h, staged, (state) => {
      state.patterns["pat-knowledge-reappeared"].positiveEvidence = [
        "knowledge://safe/source",
      ];
      state.patterns["pat-knowledge-reappeared"].negativeEvidence = [
        source.ref,
      ];
      rebuildAdmissionTestIndex(state);
    }),
  ).toThrow(expect.objectContaining({ code: WIKI_SOURCE_REVOKED_CODE }));
  expect(snapshot(h)).toEqual(before);
}, 180_000);

it.each(["terminal-index", "missing-evidence", "unknown-index"])(
  "rejects source/index laundering: %s",
  async (attack) => {
    const h = await setup();
    await prepareOnly(h);
    const before = snapshot(h);
    const staged = await stageWikiAdmission(h);
    expect(() =>
      appendRawWiki(h, staged, (state) => {
        if (attack === "terminal-index")
          state.patterns["pat-knowledge-reappeared"].status = "tombstoned";
        if (attack === "missing-evidence") delete state.evidence[source.ref];
        if (attack === "unknown-index")
          state.index.push({
            ...state.index[0],
            patternId: "pat-unknown-index",
          });
      }),
    ).toThrow(
      expect.objectContaining({ code: WIKI_SOURCE_ADMISSION_INVALID_CODE }),
    );
    expect(snapshot(h)).toEqual(before);
  },
  180_000,
);

it("permits unrelated sources and repeats no already committed Wiki effect after reopen", async () => {
  const h = await setup();
  await h.makeSync().publish(h.knowledge);
  const staged = await stageWikiAdmission(h, {
    ref: "knowledge://unrelated/source",
    contentDigest: D("a"),
    patternId: "pat-knowledge-unrelated",
  });
  staged.wiki.adapter.commitRevision(staged.pending);
  const before = snapshot(h);
  const reopened = await openKnowledgeSkillRollbackStore(h.root, {
    wikiProvenance: true,
    wikiTombstone: true,
  });
  expect(snapshot(reopened)).toEqual(before);
  expect(reopened.wiki.adapter.commitRevision(staged.pending)).toMatchObject({
    committed: true,
    recovered: true,
  });
  expect(snapshot(reopened)).toEqual(before);
}, 180_000);

it("revocation-first rejects a previously staged writer, while an earlier Wiki commit remains readable", async () => {
  const h = await setup();
  const first = await stageWikiAdmission(h, {
    patternId: "pat-knowledge-before-fence",
  });
  first.wiki.adapter.commitRevision(first.pending);
  const pending = await stageWikiAdmission(h, {
    patternId: "pat-knowledge-after-fence",
  });
  await prepareOnly(h);
  const before = snapshot(h);
  expect(() => pending.wiki.adapter.commitRevision(pending.pending)).toThrow(
    expect.objectContaining({ code: WIKI_SOURCE_REVOKED_CODE }),
  );
  expect(snapshot(h)).toEqual(before);
  expect(
    before.wiki.state.patterns["pat-knowledge-before-fence"],
  ).toBeDefined();
}, 180_000);
