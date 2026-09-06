import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import { afterEach, expect, it, vi } from "vitest";
import { registerGovernedKnowledgeCommands } from "../../src/commands/evolution-knowledge.js";
import { APP_SERVER_PROTOCOL_VERSION } from "../../src/lib/app-server/protocol.js";
import { MemoryRolloutStore } from "../../src/lib/app-server/rollout-store.js";
import { CcAppServer } from "../../src/lib/app-server/server.js";
import { openKnowledgeSkillRollbackStore } from "../fixtures/governed-knowledge-skill-rollback.js";
import {
  GovernedKnowledgeDependencyInventoryPlanner,
  buildGovernedKnowledgeDependencyInventory,
} from "../../src/lib/evolution/governed-knowledge-dependency-inventory.js";
import { createGovernedKnowledgeRevocationHost } from "../../src/lib/evolution/governed-knowledge-revocation-host.js";

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

  const quarantine = buildGovernedKnowledgeDependencyInventory({
    tenantId: h.knowledge.tenantId,
    knowledgeId: h.knowledge.knowledgeId,
    contentDigest: h.knowledge.contentDigest,
    candidateRegistry: h.release.candidateRegistry,
    releaseRegistry: h.release.pruningRollbackOptions.releaseRegistry,
    wikiAdapters: [
      h.wiki.adapter,
      ...h.upstreamWikis.map(({ adapter }) => adapter),
    ],
    activeDisposition: "quarantine",
    candidateDisposition: "quarantine",
    wikiDisposition: "quarantine",
  });
  expect(
    quarantine.dependencies.map(({ kind, disposition }) => [kind, disposition]),
  ).toEqual([
    ["active-skill", "quarantine"],
    ["candidate", "quarantine"],
    ["wiki", "quarantine"],
    ["wiki", "quarantine"],
  ]);
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

it("rejects every caller-supplied dependency field before inventory planning", async () => {
  const h = await setup();
  const planner = new GovernedKnowledgeDependencyInventoryPlanner({
    tenantId: h.knowledge.tenantId,
    candidateRegistry: h.release.candidateRegistry,
    releaseRegistry: h.release.pruningRollbackOptions.releaseRegistry,
    wikiAdapters: [h.wiki.adapter],
  });
  const draft = { ...h.knowledge, dependencies: [] };

  expect(() => planner.plan(draft)).toThrow(/must not supply/u);
  expect(() => planner.plan({ ...draft, dependencies: null })).toThrow(
    /must not supply/u,
  );
  expect(() => planner.plan({ ...draft, dependencies: {} })).toThrow(
    /must not supply/u,
  );
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
  const firstHost = createGovernedKnowledgeRevocationHost({
    sync: h.makeSync(h.executor, planner),
  });
  const prepareRoot = new Command().exitOverride();
  registerGovernedKnowledgeCommands(prepareRoot.command("evolution"), {
    governedKnowledgeRevocationHost: firstHost,
  });
  const printed = vi.spyOn(console, "log").mockImplementation(() => {});
  await prepareRoot.parseAsync([
    "node",
    "cc",
    "evolution",
    "knowledge",
    "revoke-prepare",
    "--record",
    JSON.stringify(draft),
  ]);
  const planned = JSON.parse(printed.mock.calls.at(-1)[0]);

  expect(planned.knowledge.dependencies).toEqual(h.knowledge.dependencies);
  expect(
    h.resources.backend.ledger
      .read()
      .filter(
        (event) => event.type === "knowledge.revocation-dependencies.prepared",
      ),
  ).toHaveLength(1);

  const recoveredHost = createGovernedKnowledgeRevocationHost({
    sync: h.makeSync(h.executor, planner),
  });
  const publishRoot = new Command().exitOverride();
  registerGovernedKnowledgeCommands(publishRoot.command("evolution"), {
    governedKnowledgeRevocationHost: recoveredHost,
  });
  await publishRoot.parseAsync([
    "node",
    "cc",
    "evolution",
    "knowledge",
    "revoke-publish",
    planned.operationDigest,
  ]);
  const published = JSON.parse(printed.mock.calls.at(-1)[0]);
  printed.mockRestore();
  expect(published).toMatchObject({
    authenticated: true,
    durable: true,
    recoveredPlan: true,
    operationDigest: planned.operationDigest,
    knowledgeId: planned.knowledge.knowledgeId,
    contentDigest: planned.knowledge.contentDigest,
    dependencyCount: planned.knowledge.dependencies.length,
  });
  expect(published).not.toHaveProperty("artifact");
  expect(h.release.readActive().release).toEqual(h.release.baseline);
  expect(h.wiki.adapter.loadWiki().state.patterns["pat-knowledge"].status).toBe(
    "tombstoned",
  );

  const server = new CcAppServer({
    send: async () => {},
    store: new MemoryRolloutStore(),
    governedKnowledgeRevocationHost: recoveredHost,
  });
  try {
    const initialized = await server.receive({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: APP_SERVER_PROTOCOL_VERSION,
        minimumProtocolVersion: 1,
        client: { name: "knowledge-revocation-test", version: "1" },
        features: [],
      },
    });
    expect(initialized.result.governedKnowledgeRevocation).toEqual({
      available: true,
      methods: ["prepare", "publish"],
    });
    const repeated = await server.receive({
      jsonrpc: "2.0",
      id: 2,
      method: "evolution/knowledge/revocation/publish",
      params: { operationDigest: planned.operationDigest },
    });
    expect(repeated.result).toMatchObject({
      authenticated: true,
      durable: true,
      operationDigest: planned.operationDigest,
    });
  } finally {
    await server.close();
  }
});
