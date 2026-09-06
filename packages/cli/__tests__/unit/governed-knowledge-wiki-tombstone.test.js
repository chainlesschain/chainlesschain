import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { openKnowledgeSkillRollbackStore } from "../fixtures/governed-knowledge-skill-rollback.js";
import { createGovernedKnowledgeWikiTombstoneAuthority } from "../../src/lib/evolution/governed-knowledge-wiki-tombstone.js";
import { WikiMaintainerLedgerAdapter } from "../../src/lib/evolution/wiki-maintainer-ledger-adapter.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});
async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(
      fs.realpathSync.native(os.tmpdir()),
      "cc-knowledge-wiki-disposition-",
    ),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, {
    seed: true,
    wikiProvenance: true,
    wikiTombstone: true,
    ...options,
  });
}
const events = (h, type) =>
  h.resources.backend.ledger.read().filter((event) => event.type === type);

it("commits exact Wiki tombstones and independent settlement without claiming a Skill rollback", async () => {
  const h = await setup();
  const before = h.wiki.adapter.loadWiki();
  const active = h.release.readActive();
  await expect(h.makeSync().publish(h.knowledge)).resolves.toMatchObject({
    action: "revoke",
  });
  const current = h.wiki.adapter.loadWiki();
  expect(current.state.patterns["pat-knowledge"].status).toBe("tombstoned");
  expect(current.state.patterns["pat-safe"]).toEqual(
    before.state.patterns["pat-safe"],
  );
  expect(current.state.evidence).toEqual(before.state.evidence);
  expect(
    current.state.index.some((entry) => entry.patternId === "pat-knowledge"),
  ).toBe(false);
  expect(h.release.readActive()).toEqual(active);
  expect(events(h, "wiki.revision.committed")).toHaveLength(3);
  expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
    1,
  );
  const reopened = await openKnowledgeSkillRollbackStore(h.root, {
    wikiProvenance: true,
    wikiTombstone: true,
  });
  await expect(
    reopened.executor.execute(reopened.knowledge),
  ).resolves.toMatchObject({ recovered: true });
  expect(reopened.wiki.adapter.loadWiki()).toEqual(current);
  expect(events(reopened, "wiki.revision.committed")).toHaveLength(3);
}, 240_000);

it("settles rollback, candidate rejection and Wiki tombstone together before publication", async () => {
  const h = await setup({ wikiTombstone: "combined" });
  await h.makeSync().publish(h.knowledge);
  expect(h.release.readActive().release).toEqual(h.release.baseline);
  expect(h.release.readActive().state.revision).toBe(3);
  expect(h.wiki.adapter.loadWiki().state.patterns["pat-knowledge"].status).toBe(
    "tombstoned",
  );
  const result = await h.executor.execute(h.knowledge);
  expect(result.resultDigests).toHaveLength(3);
  expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
    1,
  );
  expect(events(h, "knowledge.sync.committed")).toHaveLength(1);
}, 240_000);

it.each(["unrelated", "missing", "quarantine"])(
  "rejects %s Wiki disposition without effects or publication",
  async (attack) => {
    const h = await setup();
    const before = h.wiki.adapter.loadWiki();
    const dependency = { ...h.knowledge.dependencies[0] };
    if (attack === "unrelated")
      dependency.digest = h.wikiSeed.baseline.stateDigest;
    if (attack === "missing") dependency.digest = `sha256:${"d".repeat(64)}`;
    if (attack === "quarantine") dependency.disposition = "quarantine";
    await expect(
      h.makeSync().publish({ ...h.knowledge, dependencies: [dependency] }),
    ).rejects.toThrow();
    expect(h.wiki.adapter.loadWiki()).toEqual(before);
    expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
      0,
    );
    expect(h.sent).toHaveLength(0);
  },
  180_000,
);

it("does not adopt an unrelated Wiki successor as its own effect", async () => {
  const h = await setup();
  await h.wiki.write(true, { tombstone: true });
  const before = h.wiki.adapter.loadWiki();
  await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow(
    /successors outside/,
  );
  expect(h.wiki.adapter.loadWiki()).toEqual(before);
  expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
    0,
  );
}, 180_000);

it("rejects a ledger mutation between final effect verification and settlement CAS", async () => {
  let h;
  let armed = true;
  h = await setup({
    beforeDependencyAppend(event) {
      if (armed && event.type === "knowledge.revocation-dependencies.settled") {
        armed = false;
        // A synchronous competing authenticated ledger writer wins after the
        // final read-only verification. Even an unrelated record invalidates CAS.
        h.resources.backend.ledger.appendDomainEvent({
          ...event,
          eventId: `${event.eventId}.racing-writer`,
          type: "test.concurrent-write",
        });
      }
    },
  });
  await expect(h.makeSync().publish(h.knowledge)).rejects.toThrow();
  expect(armed).toBe(false);
  expect(h.wiki.adapter.loadWiki().state.patterns["pat-knowledge"].status).toBe(
    "tombstoned",
  );
  expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
    0,
  );
  expect(h.sent).toHaveLength(0);
  await h.makeSync().publish(h.knowledge);
  expect(events(h, "wiki.revision.committed")).toHaveLength(3);
  expect(events(h, "knowledge.revocation-dependencies.settled")).toHaveLength(
    1,
  );
}, 240_000);

it("tombstones 129 source-derived patterns in two deterministic batches", async () => {
  const h = await setup({ wikiPatternCount: 129 });
  const before = h.wiki.adapter.loadWiki();
  const revisionsBefore = events(h, "wiki.revision.committed").length;
  await h.makeSync().publish(h.knowledge);
  const current = h.wiki.adapter.loadWiki();
  const targets = Object.values(current.state.patterns).filter(
    (pattern) => pattern.patternId !== "pat-safe",
  );
  expect(targets).toHaveLength(129);
  expect(targets.every((pattern) => pattern.status === "tombstoned")).toBe(
    true,
  );
  expect(current.state.patterns["pat-safe"]).toEqual(
    before.state.patterns["pat-safe"],
  );
  expect(current.state.evidence).toEqual(before.state.evidence);
  expect(events(h, "wiki.revision.committed")).toHaveLength(
    revisionsBefore + 2,
  );
  expect(Object.keys(current.state.maintenanceRequests)).toHaveLength(2);
  await h.executor.execute(h.knowledge);
  expect(h.wiki.adapter.loadWiki()).toEqual(current);
}, 240_000);

it("requires independent actual Wiki/Ledger readers, not a ledger-shaped wrapper", async () => {
  const h = await setup();
  const options = h.wikiTombstoneOptions;
  expect(() =>
    createGovernedKnowledgeWikiTombstoneAuthority({
      ...options,
      verifierWikiLedgerAdapter: options.wikiLedgerAdapter,
    }),
  ).toThrow(/independent/);
  const actual = h.resources.backend.ledger;
  const wrapper = new WikiMaintainerLedgerAdapter({
    descriptor: h.wiki.adapter.descriptor,
    artifactPorts: h.resources.artifactPorts,
    ledgerArtifactResolver: h.resources.resolver,
    ledger: {
      read: actual.read.bind(actual),
      verify: actual.verify.bind(actual),
      appendDomainEvent: actual.appendDomainEvent.bind(actual),
    },
  });
  expect(() =>
    createGovernedKnowledgeWikiTombstoneAuthority({
      ...options,
      wikiLedgerAdapter: wrapper,
    }),
  ).toThrow(/same genuine ledger/);
  await expect(h.authority.apply({})).rejects.toThrow(/prepared executor/);
}, 180_000);
