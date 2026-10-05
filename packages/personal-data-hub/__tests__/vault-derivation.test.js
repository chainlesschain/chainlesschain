import { afterEach, beforeEach, describe, expect, it } from "vitest";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LocalVault } = require("../lib/vault");
const { installDerivationSchema } = require("../lib/derivation-store");

function person(id = "person-a", scope = "account-a") {
  return {
    id,
    type: "person",
    subtype: "contact",
    names: ["Sample"],
    ingestedAt: 1700000000000,
    source: {
      adapter: "fixture",
      scope,
      originalId: id,
      adapterVersion: "1",
      capturedAt: 1700000000000,
      capturedBy: "manual",
    },
  };
}

describe("durable source projections in the encrypted LocalVault", () => {
  let folder, vault, store;
  const consumerId = "test-index-generation";
  function reopen() {
    vault?.close();
    vault = new LocalVault({
      path: path.join(folder, "vault.db"),
      key: "a".repeat(64),
      kdfIter: 1000,
      skipAudit: true,
    });
    vault.open();
    store = vault.getDerivationStore();
  }
  beforeEach(() => {
    folder = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-derivation-"));
    reopen();
  });
  afterEach(() => {
    vault?.close();
    fs.rmSync(folder, { recursive: true, force: true });
  });

  it("persists intents for direct entity writes and failed target receipts across reopen", () => {
    vault.putPerson(person());
    const jobs = store.listPending({ consumerId });
    expect(jobs).toHaveLength(2);
    const claim = store.claim(
      jobs.find((job) => job.target === "rag"),
      { consumerId, transformVersion: "pdh-rag-v1" },
    );
    store.complete(claim, {
      success: false,
      errorCode: "RAG_PROJECTION_FAILED",
    });
    reopen();
    expect(store.summary({ consumerId })).toMatchObject({
      pending: 1,
      failed: 1,
    });
    expect(
      store.getState("person", "person-a", { consumerId }).deliveries,
    ).toContainEqual(
      expect.objectContaining({
        target: "rag",
        status: "failed",
        attempts: 1,
        transformVersion: "pdh-rag-v1",
      }),
    );
  });

  it("rolls back source mutations and intents together on a failed batch", () => {
    expect(() =>
      vault.putBatch({ persons: [person()], events: [{ id: "invalid" }] }),
    ).toThrow();
    expect(vault.getPerson("person-a")).toBeNull();
    expect(store.summary({ consumerId }).total).toBe(0);
    expect(() =>
      vault.db.transaction(() => {
        vault.putPerson(person());
        throw new Error("abort");
      })(),
    ).toThrow("abort");
    expect(store.summary({ consumerId }).total).toBe(0);
  });

  it("uses the actual canonical ID when source identity conflicts update an existing row", () => {
    const original = person();
    vault.putPerson(original);
    vault.putPerson({ ...original, id: "alternate", names: ["Updated"] });
    const jobs = store.listPending({ consumerId });
    expect(jobs).toHaveLength(2);
    expect(
      jobs.every((job) => job.entityId === original.id && job.revision === 2),
    ).toBe(true);
    expect(vault.getPerson(original.id).names).toEqual(["Updated"]);
  });

  it("keeps target acknowledgements independent and rebuilds a fresh in-memory generation", () => {
    vault.putPerson(person());
    for (const job of store.listPending({ consumerId })) {
      const claim = store.claim(job, { consumerId });
      expect(store.complete(claim, { success: true })).toBe(true);
    }
    expect(store.summary({ consumerId }).succeeded).toBe(2);
    expect(store.listPending({ consumerId })).toEqual([]);
    expect(store.summary({ consumerId: "fresh-process" }).pending).toBe(2);
  });

  it("does not acknowledge newer content with an older completion", () => {
    vault.putPerson(person());
    const job = store.listPending({ consumerId, targets: ["rag"] })[0];
    const claim = store.claim(job, { consumerId });
    vault.putPerson({ ...person(), names: ["Version two"] });
    expect(store.claim(job, { consumerId })).toBeNull();
    expect(store.complete(claim, { success: true })).toBe(false);
    const pending = store.listPending({ consumerId, targets: ["rag"] })[0];
    expect(pending).toMatchObject({ revision: 2, status: "pending" });
    const current = store.claim(pending, { consumerId });
    expect(
      store.complete({ ...current, token: "stale-token" }, { success: true }),
    ).toBe(false);
    expect(store.complete(current, { success: true })).toBe(true);
  });

  it("reprocesses a successful revision when the transform contract changes", () => {
    vault.putPerson(person());
    const job = store.listPending({ consumerId, targets: ["rag"] })[0];
    const claim = store.claim(job, { consumerId });
    store.complete(claim, { success: true });
    const transformVersions = { rag: "pdh-rag-v2", kg: "pdh-kg-v1" };
    expect(
      store.summary({ consumerId, targets: ["rag"], transformVersions })
        .pending,
    ).toBe(1);
    const upgraded = store.listPending({
      consumerId,
      targets: ["rag"],
      transformVersions,
    })[0];
    const upgradedClaim = store.claim(upgraded, {
      consumerId,
      transformVersion: "pdh-rag-v2",
    });
    expect(upgradedClaim).not.toBeNull();
    store.complete(upgradedClaim, { success: true });
    expect(
      store.summary({ consumerId, targets: ["rag"], transformVersions })
        .succeeded,
    ).toBe(1);
  });

  it("does not silently replay an unknown running claim on reopen", () => {
    vault.putPerson(person());
    const job = store.listPending({ consumerId, targets: ["rag"] })[0];
    store.claim(job, { consumerId });
    reopen();
    expect(store.summary({ consumerId }).running).toBe(1);
    expect(store.listPending({ consumerId, targets: ["rag"] })).toEqual([]);
    expect(store.claim(job, { consumerId })).toBeNull();
  });

  it("coalesces deletion and reimport to the latest revision without storing source content", () => {
    vault.putPerson({ ...person(), notes: "private-source-content" });
    const job = store.listPending({ consumerId, targets: ["rag"] })[0];
    const claim = store.claim(job, { consumerId });
    expect(vault.deleteEntity("person", "person-a").deleted).toBe(true);
    expect(vault.getPerson("person-a")).toBeNull();
    expect(store.complete(claim, { success: true })).toBe(false);
    reopen();
    expect(
      store.listPending({ consumerId, targets: ["rag"] })[0],
    ).toMatchObject({ revision: 2, operation: "delete" });
    const state = store.getState("person", "person-a", { consumerId });
    expect(JSON.stringify(state)).not.toContain("private-source-content");
    expect(vault.deleteEntity("person", "person-a").deleted).toBe(false);
    vault.putPerson(person());
    expect(
      store.listPending({ consumerId, targets: ["rag"] })[0],
    ).toMatchObject({ revision: 3, operation: "upsert" });
  });

  it("bounds and scopes pending reads and rejects unsafe query arguments", () => {
    vault.putPerson(person("a", "account-a"));
    vault.putPerson(person("b", "account-b"));
    expect(
      store.listPending({
        consumerId,
        adapter: "fixture",
        scope: "account-a",
        limit: 1,
      }),
    ).toHaveLength(1);
    expect(store.summary({ consumerId, scope: "account-b" }).total).toBe(2);
    expect(store.summary({ consumerId, targets: [] }).total).toBe(0);
    expect(() => store.listPending({ consumerId, limit: 1001 })).toThrow(
      /limit/,
    );
    expect(() => store.listPending({ consumerId, targets: ["bad"] })).toThrow(
      /targets/,
    );
    expect(() =>
      vault.deleteEntity("persons; DROP TABLE persons", "a"),
    ).toThrow();
  });

  it("invalidates dependents when a referenced entity is deleted or reimported", () => {
    vault.putPerson(person());
    vault.putEvent({
      id: "event-a",
      type: "event",
      subtype: "message",
      occurredAt: 1700000000000,
      actor: "person-a",
      participants: ["person-a"],
      content: { text: "message" },
      source: { ...person().source, originalId: "event-a" },
      ingestedAt: 1700000000000,
    });
    for (const job of store.listPending({ consumerId })) {
      store.complete(store.claim(job, { consumerId }), { success: true });
    }
    expect(store.listPending({ consumerId })).toEqual([]);
    const before = store.getState("event", "event-a", { consumerId }).revision;
    vault.deleteEntity("person", "person-a");
    expect(store.getState("event", "event-a", { consumerId }).revision).toBe(
      before + 1,
    );
    for (const job of store.listPending({ consumerId })) {
      store.complete(store.claim(job, { consumerId }), { success: true });
    }
    vault.putPerson(person());
    expect(store.getState("event", "event-a", { consumerId }).revision).toBe(
      before + 2,
    );
    expect(
      store
        .listPending({ consumerId })
        .filter((job) => job.entityType === "event"),
    ).toHaveLength(2);
    // Replacing the reference removes its dependency; unrelated future
    // person updates must not keep invalidating the old event.
    vault.putEvent({
      ...vault.getEvent("event-a"),
      actor: undefined,
      participants: [],
    });
    const detached = store.getState("event", "event-a", {
      consumerId,
    }).revision;
    vault.putPerson({ ...person(), notes: "unrelated update" });
    expect(store.getState("event", "event-a", { consumerId }).revision).toBe(
      detached,
    );
  });

  it("seeds existing canonical rows during migration and installation is idempotent", () => {
    vault.putPerson(person());
    vault.db.prepare("DELETE FROM derivation_sources").run();
    installDerivationSchema(vault.db);
    expect(store.listPending({ consumerId })).toHaveLength(2);
    installDerivationSchema(vault.db);
    expect(store.listPending({ consumerId })).toHaveLength(2);
    vault.putPerson({ ...person(), names: ["new"] });
    expect(store.getState("person", "person-a", { consumerId }).revision).toBe(
      2,
    );
  });

  it("migrates legacy malformed reference JSON without preventing the vault from opening", () => {
    vault.putEvent({
      id: "event-old",
      type: "event",
      subtype: "message",
      occurredAt: 1700000000000,
      content: { text: "legacy" },
      source: { ...person().source, originalId: "event-old" },
      ingestedAt: 1700000000000,
    });
    // Recreate the pre-ledger schema with a damaged legacy JSON column.
    for (const { name } of vault.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'pdh_derive_%'",
      )
      .all()) {
      vault.db.exec(`DROP TRIGGER "${name}"`);
    }
    vault.db.exec(
      "DROP TABLE derivation_deliveries; DROP TABLE derivation_dependencies; DROP TABLE derivation_sources",
    );
    vault.db
      .prepare("UPDATE events SET participants=?, items=?, topics=? WHERE id=?")
      .run("broken[", "[", "{", "event-old");
    vault.db
      .prepare("UPDATE _meta SET value='11' WHERE key='schema_version'")
      .run();
    expect(() => reopen()).not.toThrow();
    expect(store.getState("event", "event-old", { consumerId })).toMatchObject({
      revision: 1,
      operation: "upsert",
    });
    // A later unrelated source edit must still capture an intent. Canonical
    // decoding remains responsible for reporting the damaged payload itself.
    vault.db
      .prepare("UPDATE events SET duration_ms=1 WHERE id=?")
      .run("event-old");
    expect(store.getState("event", "event-old", { consumerId }).revision).toBe(
      2,
    );
  });
});
