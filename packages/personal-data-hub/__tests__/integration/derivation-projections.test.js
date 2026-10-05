import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as kg from "../../../cli/src/lib/knowledge-graph.js";
import { BM25Search } from "../../../cli/src/lib/bm25-search.js";

const { LocalVault } = require("../../lib/vault");
const { AdapterRegistry } = require("../../lib/registry");
const { CcKgSink } = require("../../lib/bridges/cc-kg-sink");
const { CcRagSink } = require("../../lib/bridges/cc-rag-sink");
const { generateKeyHex } = require("../../lib/key-providers");

let vault;
let directory;
const now = 1_700_000_000_000;
const source = {
  adapter: "local-project",
  adapterVersion: "1",
  capturedAt: now,
  capturedBy: "manual",
};
const person = (id, name) => ({
  id,
  type: "person",
  subtype: "contact",
  names: [name],
  ingestedAt: now,
  source,
});
const event = (text) => ({
  id: "delivery",
  type: "event",
  subtype: "message",
  occurredAt: now,
  ingestedAt: now,
  source,
  actor: "owner",
  content: { text },
});

function createRuntime() {
  kg._resetState();
  const bm25 = new BM25Search();
  const kgSink = new CcKgSink(kg);
  const ragSink = new CcRagSink({ bm25 });
  const registry = new AdapterRegistry({
    vault,
    kgSink: kgSink.write.bind(kgSink),
    kgRemove: kgSink.remove.bind(kgSink),
    ragSink: ragSink.write.bind(ragSink),
    ragRemove: ragSink.remove.bind(ragSink),
  });
  return { registry, bm25 };
}

async function drain(registry) {
  let pages = 0;
  for (; pages < 100; pages += 1) {
    const result = await registry.retryDerivations({ limit: 1000 });
    if (!result.remaining) return pages + 1;
    if (result.summary.pending > 0) continue;
    if (!result.succeeded || result.unsupported || result.blocked) break;
  }
  throw new Error(
    `Projection drain did not complete: ${JSON.stringify(registry.getDerivationStatus())}`,
  );
}

afterEach(() => {
  vault?.close();
  vault = null;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = null;
  kg._resetState();
});

describe("native vault to real KG/BM25 projection recovery", () => {
  it("rehydrates more than one page after reopen, then reconciles updates, target deletion and reimport", async () => {
    directory = mkdtempSync(join(tmpdir(), "pdh-derived-native-"));
    const config = {
      path: join(directory, "vault.db"),
      key: generateKeyHex(),
      skipAudit: true,
    };
    vault = new LocalVault(config);
    vault.open();
    vault.putBatch({
      events: [event("oldlaunchmarker")],
      persons: [
        person("owner", "Alice"),
        ...Array.from({ length: 500 }, (_, index) =>
          person(`p-${index}`, `Colleague ${index}`),
        ),
      ],
    });
    const first = createRuntime();
    expect(await drain(first.registry)).toBeGreaterThan(1);
    expect(first.bm25.search("oldlaunchmarker")).toHaveLength(1);
    const oldDerivation =
      first.bm25.search("oldlaunchmarker")[0].doc.meta.derivation;
    expect(oldDerivation).toEqual({
      entityType: "event",
      entityId: "delivery",
      revision: vault.getDerivationStore().getState("event", "delivery", {
        consumerId: first.registry.consumerId,
      }).revision,
      transformVersion: "pdh-rag-v1",
    });
    expect(kg.listRelations()).toHaveLength(1);
    vault.close();

    vault = new LocalVault(config);
    vault.open();
    const restarted = createRuntime();
    expect(restarted.registry.consumerId).not.toBe(first.registry.consumerId);
    expect(await drain(restarted.registry)).toBeGreaterThan(1);
    expect(restarted.bm25.search("oldlaunchmarker")).toHaveLength(1);
    expect(
      restarted.bm25.search("oldlaunchmarker")[0].doc.meta.derivation,
    ).toEqual(oldDerivation);
    expect(kg.listRelations()).toHaveLength(1);

    vault.putBatch({
      events: [event("newlaunchmarker")],
      persons: [person("owner", "Alicia")],
    });
    await drain(restarted.registry);
    expect(restarted.bm25.search("oldlaunchmarker")).toEqual([]);
    expect(restarted.bm25.search("newlaunchmarker")).toHaveLength(1);
    const updatedDerivation =
      restarted.bm25.search("newlaunchmarker")[0].doc.meta.derivation;
    expect(updatedDerivation).toEqual({
      ...oldDerivation,
      revision: vault.getDerivationStore().getState("event", "delivery", {
        consumerId: restarted.registry.consumerId,
      }).revision,
    });
    expect(updatedDerivation.revision).toBeGreaterThan(oldDerivation.revision);
    expect(kg.getEntity("owner").name).toBe("Alicia");
    vault.deleteEntity("person", "owner");
    await restarted.registry.retryDerivations({ limit: 1000 });
    expect(kg.getEntity("owner")).toBeNull();
    expect(kg.listRelations()).toEqual([]);
    // Dependency invalidation advances the projection revision even when
    // this event's own source text has not changed.
    const afterDependencyDeletion =
      restarted.bm25.search("newlaunchmarker")[0].doc.meta.derivation;
    expect(afterDependencyDeletion.revision).toBeGreaterThan(
      updatedDerivation.revision,
    );

    vault.putBatch({ persons: [person("owner", "Restored owner")] });
    await drain(restarted.registry);
    expect(kg.listRelations()).toHaveLength(1);
    expect(
      restarted.bm25.search("newlaunchmarker")[0].doc.meta.derivation.revision,
    ).toBeGreaterThan(afterDependencyDeletion.revision);
    expect(kg.listRelations()[0]).toMatchObject({
      sourceId: "delivery",
      targetId: "owner",
    });
    vault.deleteEntity("event", "delivery");
    await drain(restarted.registry);
    expect(restarted.bm25.search("newlaunchmarker")).toEqual([]);
    expect(kg.getEntity("delivery")).toBeNull();
    expect(kg.listRelations()).toEqual([]);
  }, 30_000);
});
