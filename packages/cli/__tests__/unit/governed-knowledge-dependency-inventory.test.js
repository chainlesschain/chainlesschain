import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { openKnowledgeSkillRollbackStore } from "../fixtures/governed-knowledge-skill-rollback.js";
import { buildGovernedKnowledgeDependencyInventory } from "../../src/lib/evolution/governed-knowledge-dependency-inventory.js";

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
