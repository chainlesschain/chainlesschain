import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { openKnowledgeSkillRollbackStore } from "../fixtures/governed-knowledge-skill-rollback.js";
import {
  GovernedKnowledgeDependencyInventoryPlanner,
  buildGovernedKnowledgeDependencyInventory,
} from "../../src/lib/evolution/governed-knowledge-dependency-inventory.js";

const roots = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

async function setup(options = {}) {
  const root = fs.mkdtempSync(
    path.join(fs.realpathSync.native(os.tmpdir()), "cc-knowledge-inventory-"),
  );
  roots.push(root);
  return openKnowledgeSkillRollbackStore(root, {
    seed: true,
    wikiProvenance: true,
    wikiTombstone: "combined",
    ...options,
  });
}

it("discovers and orders every active, candidate, and Wiki dependency", async () => {
  const h = await setup({ wikiHops: 1, wikiTombstoneAllRuns: true });
  const inventory = buildGovernedKnowledgeDependencyInventory({
    tenantId: h.knowledge.tenantId,
    knowledgeId: h.knowledge.knowledgeId,
    contentDigest: h.knowledge.contentDigest,
    candidateRegistry: h.release.candidateRegistry,
    releaseRegistry: h.release.pruningRollbackOptions.releaseRegistry,
    wikiAdapters: [
      h.wiki.adapter,
      ...h.upstreamWikis.map(({ adapter }) => adapter),
    ],
  });

  expect(inventory.dependencies).toEqual(h.knowledge.dependencies);
  expect(inventory.wikiRuns).toEqual(
    [h.wiki, ...h.upstreamWikis]
      .map(({ adapter }) => adapter.descriptor.evolutionRunId)
      .sort(),
  );
  expect(inventory.inventoryDigest).toMatch(/^sha256:[a-f0-9]{64}$/u);
});

it("fails closed when a discovered tenant Wiki run is omitted", async () => {
  const h = await setup({ wikiHops: 1, wikiTombstoneAllRuns: true });
  expect(() =>
    buildGovernedKnowledgeDependencyInventory({
      tenantId: h.knowledge.tenantId,
      knowledgeId: h.knowledge.knowledgeId,
      contentDigest: h.knowledge.contentDigest,
      candidateRegistry: h.release.candidateRegistry,
      releaseRegistry: h.release.pruningRollbackOptions.releaseRegistry,
      wikiAdapters: [h.wiki.adapter],
    }),
  ).toThrow(/manifest is incomplete/u);
});

it("rejects rollback planning when the last-known-good still has unsafe Wiki lineage", async () => {
  const h = await setup({ unsafeWikiBaseline: true });
  expect(() =>
    buildGovernedKnowledgeDependencyInventory({
      tenantId: h.knowledge.tenantId,
      knowledgeId: h.knowledge.knowledgeId,
      contentDigest: h.knowledge.contentDigest,
      candidateRegistry: h.release.candidateRegistry,
      releaseRegistry: h.release.pruningRollbackOptions.releaseRegistry,
      wikiAdapters: [h.wiki.adapter],
    }),
  ).toThrow(/no safe distinct last-known-good/u);
});

it("durably freezes an authorized plan before effects and recovers it without rescanning", async () => {
  const h = await setup();
  const planner = new GovernedKnowledgeDependencyInventoryPlanner({
    tenantId: h.knowledge.tenantId,
    candidateRegistry: h.release.candidateRegistry,
    releaseRegistry: h.release.pruningRollbackOptions.releaseRegistry,
    wikiAdapters: [h.wiki.adapter],
  });
  const draft = { ...h.knowledge };
  delete draft.dependencies;
  const firstSync = h.makeSync(h.executor, planner);
  const planned = await firstSync.planRevocation(draft);

  expect(planned.knowledge.dependencies).toEqual(h.knowledge.dependencies);
  expect(
    h.resources.backend.ledger
      .read()
      .filter(
        (event) => event.type === "knowledge.revocation-dependencies.prepared",
      ),
  ).toHaveLength(1);

  const recoveredSync = h.makeSync(h.executor, planner);
  const recovered = await recoveredSync.recoverPlannedRevocation({
    operationDigest: planned.operationDigest,
  });
  expect(recovered).toMatchObject({
    recovered: true,
    operationDigest: planned.operationDigest,
    knowledge: planned.knowledge,
  });
  await recoveredSync.publishPlanned(recovered);
  expect(h.release.readActive().release).toEqual(h.release.baseline);
  expect(h.wiki.adapter.loadWiki().state.patterns["pat-knowledge"].status).toBe(
    "tombstoned",
  );
});
