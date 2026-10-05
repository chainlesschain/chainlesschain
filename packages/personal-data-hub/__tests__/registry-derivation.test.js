"use strict";

import { afterEach, describe, expect, it, vi } from "vitest";
import { BM25Search } from "../../cli/src/lib/bm25-search.js";
import * as realKg from "../../cli/src/lib/knowledge-graph.js";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { LocalVault } = require("../lib/vault");
const { AdapterRegistry } = require("../lib/registry");
const { MockAdapter } = require("../lib/mock-adapter");
const { CcRagSink } = require("../lib/bridges/cc-rag-sink");
const { CcKgSink } = require("../lib/bridges/cc-kg-sink");
const { generateKeyHex } = require("../lib/key-providers");

const openVaults = [];
const tempDirs = [];

function freshVault() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "pdh-registry-derive-"),
  );
  tempDirs.push(directory);
  const vault = new LocalVault({
    path: path.join(directory, "vault.db"),
    key: generateKeyHex(),
    kdfIter: 1000,
    skipAudit: true,
  });
  vault.open();
  openVaults.push(vault);
  return vault;
}

function event(id, text = "body", adapter = "test", scope = "") {
  return {
    id,
    type: "event",
    subtype: "message",
    occurredAt: 1750000000000,
    content: { text },
    ingestedAt: 1750000000000,
    source: {
      adapter,
      ...(scope ? { scope } : {}),
      adapterVersion: "1.0.0",
      originalId: id,
      capturedAt: 1750000000000,
      capturedBy: "manual",
    },
  };
}

function successfulRegistry(vault, options = {}) {
  return new AdapterRegistry({
    vault,
    consumerId: "persistent-search",
    ragSink: vi.fn(async () => ({ errors: [] })),
    kgSink: vi.fn(async () => ({ errors: [] })),
    ragRemove: vi.fn(async () => ({ errors: [] })),
    kgRemove: vi.fn(async () => ({ errors: [] })),
    ...options,
  });
}

afterEach(() => {
  realKg._resetState();
  for (const vault of openVaults.splice(0)) vault.close();
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("AdapterRegistry durable derivation", () => {
  it("advances a source checkpoint after durable enqueue and retries only failed destinations after reopening", async () => {
    const vault = freshVault();
    const kgSink = vi.fn(async () => ({ errors: [] }));
    const registry = successfulRegistry(vault, {
      kgSink,
      ragSink: vi.fn(async () => ({
        errors: [{ error: "temporary destination failure" }],
      })),
    });
    registry.register(new MockAdapter({ count: 3, seed: 1 }));
    const report = await registry.syncAdapter("mock");
    expect(report.status).toBe("ok");
    expect(report.checkpointCommitted).toBe(true);
    expect(report.watermark).toBe("3");
    expect(vault.getWatermark("mock").watermark).toBe("3");
    expect(report.derivationStatus).toBe("failed");
    expect(report.derivationFailureCount).toBeGreaterThan(0);
    expect(registry.getDerivationStatus().failed).toBe(
      report.derivationFailureCount,
    );
    const completedKgCalls = kgSink.mock.calls.length;

    vault.close();
    vault.open();
    const restarted = successfulRegistry(vault, { kgSink });
    const retry = await restarted.retryDerivations();
    expect(retry.processed).toBe(report.derivationFailureCount);
    expect(retry.failed).toBe(0);
    expect(retry.remaining).toBe(0);
    expect(retry.status).toBe("complete");
    expect(kgSink).toHaveBeenCalledTimes(completedKgCalls);
    expect(restarted.ragSink).toHaveBeenCalledTimes(
      report.derivationFailureCount,
    );
    expect(restarted.getDerivationStatus().pending).toBe(0);
    expect(restarted.has("mock")).toBe(false);
  });

  it("rebuilds ephemeral destinations with a new consumer and handles same-ID revisions", async () => {
    const vault = freshVault();
    vault.putEvent(event("a", "old"));
    const first = successfulRegistry(vault, { consumerId: undefined });
    expect((await first.retryDerivations()).succeeded).toBe(2);
    expect((await first.retryDerivations()).processed).toBe(0);
    const fresh = successfulRegistry(vault, { consumerId: undefined });
    expect(fresh.consumerId).not.toBe(first.consumerId);
    expect((await fresh.retryDerivations()).succeeded).toBe(2);
    expect(fresh.ragSink.mock.calls[0][0][0].text).toContain("old");
    const oldDerivation = fresh.ragSink.mock.calls[0][0][0].metadata.derivation;
    expect(oldDerivation).toEqual({
      entityType: "event",
      entityId: "a",
      revision: 1,
      transformVersion: "pdh-rag-v1",
    });
    vault.putEvent(event("a", "new"));
    expect((await fresh.retryDerivations()).succeeded).toBe(2);
    expect(fresh.ragSink.mock.lastCall[0][0].text).toContain("new");
    const state = vault
      .getDerivationStore()
      .getState("event", "a", { consumerId: fresh.consumerId });
    expect(state.revision).toBeGreaterThan(1);
    expect(fresh.ragSink.mock.lastCall[0][0].metadata.derivation).toEqual({
      ...oldDerivation,
      revision: state.revision,
    });
    expect(
      state.deliveries.every(
        (delivery) => delivery.revision === state.revision,
      ),
    ).toBe(true);
  });

  it("propagates durable tombstones to real BM25 and KG removal and permits reimport", async () => {
    const vault = freshVault();
    const bm25 = new BM25Search({ language: "en" });
    const rag = new CcRagSink({ bm25 });
    const registry = successfulRegistry(vault, {
      ragSink: (docs) => rag.write(docs),
      ragRemove: (ids) => rag.remove(ids),
    });
    vault.putEvent(event("a", "obsolete"));
    await registry.retryDerivations();
    expect(bm25.search("obsolete")[0].id).toBe("a");
    vault.deleteEntity("event", "a");
    expect((await registry.retryDerivations()).succeeded).toBe(2);
    expect(bm25.search("obsolete")).toEqual([]);
    expect(registry.kgRemove).toHaveBeenCalledExactlyOnceWith(["a"]);
    expect((await registry.retryDerivations()).processed).toBe(0);

    vault.putEvent(event("a", "restored"));
    expect((await registry.retryDerivations()).succeeded).toBe(2);
    expect(bm25.search("restored")[0].id).toBe("a");
    expect(bm25.search("obsolete")).toEqual([]);
  });

  it("records unsupported removal and independently retries it after capability arrives", async () => {
    const vault = freshVault();
    vault.putEvent(event("a"));
    const registry = successfulRegistry(vault, { kgRemove: undefined });
    await registry.retryDerivations();
    vault.deleteEntity("event", "a");
    const result = await registry.retryDerivations();
    expect(result.succeeded).toBe(1);
    expect(result.unsupported).toBe(1);
    expect(result.remaining).toBe(1);
    expect(result.status).toBe("unsupported");
    expect(registry.getDerivationStatus().unsupported).toBe(1);
    registry.kgRemove = vi.fn(async () => undefined);
    expect((await registry.retryDerivations()).succeeded).toBe(1);
    expect(registry.ragRemove).toHaveBeenCalledTimes(1);
    expect(registry.kgRemove).toHaveBeenCalledExactlyOnceWith(["a"]);
  });

  it("hydrates reference endpoints without losing their edges and reconciles deletion and reimport", async () => {
    const vault = freshVault();
    const sourceEvent = { ...event("e", "linked event"), topics: ["child"] };
    const topic = (id, extra = {}) => ({
      id,
      type: "topic",
      name: id,
      ingestedAt: sourceEvent.ingestedAt,
      source: { ...sourceEvent.source, originalId: id },
      ...extra,
    });
    const child = topic("child", {
      parentTopic: "parent",
      derivedFromEvents: ["e"],
    });
    vault.putEvent(sourceEvent);
    vault.putTopic(child);
    vault.putTopic(topic("parent"));
    const kg = new CcKgSink(realKg);
    const registry = successfulRegistry(vault, {
      kgSink: (triples, context) => kg.write(triples, context),
      kgRemove: (ids) => kg.remove(ids),
    });
    const first = await registry.retryDerivations();
    expect(first.failed).toBe(0);
    expect(first.remaining).toBe(0);
    expect(realKg.listRelations()).toHaveLength(3);

    vault.putEvent({ ...sourceEvent, content: { text: "changed" } });
    expect((await registry.retryDerivations()).failed).toBe(0);
    expect(realKg.listRelations()).toHaveLength(3);
    expect(realKg.listRelations()).toContainEqual(
      expect.objectContaining({ sourceId: "child", targetId: "parent" }),
    );

    vault.deleteEntity("topic", "child");
    const deleted = await registry.retryDerivations();
    expect(deleted.failed).toBe(0);
    expect(deleted.remaining).toBe(0);
    expect(realKg.getEntity("child")).toBeNull();
    expect(realKg.listRelations()).toEqual([]);
    vault.putTopic(child);
    expect((await registry.retryDerivations()).remaining).toBe(0);
    expect(realKg.listRelations()).toHaveLength(3);
  });

  it("keeps missing destinations explicit rather than acknowledging unused callbacks", async () => {
    const vault = freshVault();
    vault.putEvent(event("a"));
    const registry = new AdapterRegistry({ vault });
    const result = await registry.retryDerivations();
    expect(result).toMatchObject({
      processed: 2,
      succeeded: 0,
      unsupported: 2,
      remaining: 2,
      status: "unsupported",
    });
    expect(registry.getDerivationStatus()).toMatchObject({
      total: 2,
      unsupported: 2,
      succeeded: 0,
    });
  });

  it("restricts retries and status to the requested adapter and account scope", async () => {
    const vault = freshVault();
    vault.putEvent(event("a", "account one", "mail", "account:one"));
    vault.putEvent(event("b", "account two", "mail", "account:two"));
    vault.putEvent(event("c", "other source", "files", "account:one"));
    const registry = successfulRegistry(vault);
    const result = await registry.retryDerivations({
      adapter: "mail",
      scope: "account:one",
      limit: 10,
    });
    expect(result.succeeded).toBe(2);
    expect(result.remaining).toBe(0);
    expect(registry.ragSink).toHaveBeenCalledTimes(1);
    expect(registry.ragSink.mock.calls[0][0][0].id).toBe("a");
    expect(registry.getDerivationStatus()).toMatchObject({
      total: 6,
      pending: 4,
      succeeded: 2,
    });
    expect(
      registry.getDerivationStatus({ adapter: "mail", scope: "account:two" }),
    ).toMatchObject({ total: 2, pending: 2 });
  });

  it("rejects a stale acknowledgement while a newer revision waits for the running sink", async () => {
    const vault = freshVault();
    vault.putEvent(event("a", "old"));
    let release;
    let notifyStarted;
    const started = new Promise((resolve) => {
      notifyStarted = resolve;
    });
    const blocked = new Promise((resolve) => {
      release = resolve;
    });
    const ragSink = vi.fn(async () => {
      if (ragSink.mock.calls.length === 1) {
        notifyStarted();
        await blocked;
      }
      return { errors: [] };
    });
    const registry = successfulRegistry(vault, { ragSink });
    const first = registry.retryDerivations();
    await started;
    vault.putEvent(event("a", "new"));
    const concurrent = await registry.retryDerivations();
    expect(concurrent.blocked).toBe(1);
    expect(ragSink).toHaveBeenCalledTimes(1);
    release();
    const original = await first;
    expect(original.superseded).toBe(1);
    expect(original.remaining).toBe(1);
    expect(registry.getDerivationStatus().pending).toBe(1);
    expect((await registry.retryDerivations()).succeeded).toBe(1);
    expect(ragSink.mock.lastCall[0][0].text).toContain("new");
  });

  it("does not automatically reclaim unknown running effects after a stable-consumer restart", async () => {
    const vault = freshVault();
    vault.putEvent(event("a"));
    const store = vault.getDerivationStore();
    const pending = store.listPending({
      consumerId: "stable",
      targets: ["rag"],
    });
    store.claim(pending[0], { consumerId: "stable", target: "rag" });
    vault.close();
    vault.open();
    const registry = successfulRegistry(vault, { consumerId: "stable" });
    const result = await registry.retryDerivations();
    expect(result.succeeded).toBe(1);
    expect(result.blocked).toBe(1);
    expect(result.status).toBe("blocked");
    expect(registry.ragSink).not.toHaveBeenCalled();
    expect(registry.getDerivationStatus().running).toBe(1);
  });

  it("stores safe error codes while counting structured failures and thrown errors", async () => {
    const vault = freshVault();
    vault.putEvent(event("a"));
    const secret = "Authorization: Bearer private-synthetic-test-value";
    const registry = successfulRegistry(vault, {
      kgSink: async () => ({ errors: [{ error: secret }, { error: secret }] }),
      ragSink: async () => {
        throw new Error(secret);
      },
    });
    const result = await registry.retryDerivations();
    expect(result.failed).toBe(2);
    expect(result.errorCount).toBe(3);
    const state = vault
      .getDerivationStore()
      .getState("event", "a", { consumerId: registry.consumerId });
    expect(state.deliveries.map((entry) => entry.errorCode).sort()).toEqual([
      "DERIVATION_SINK_FAILED",
      "DERIVATION_SINK_REJECTED",
    ]);
    const audits = vault.queryAudit({ limit: 100 });
    expect(JSON.stringify({ result, state, audits })).not.toContain(secret);
    expect(
      audits.some((entry) => entry.action === "adapter.sync.rag_sink_failed"),
    ).toBe(true);
  });

  it("preserves legacy batch collectors and exposes structured failures on custom vaults", async () => {
    const vault = freshVault();
    const customVault = new Proxy(vault, {
      get(target, key) {
        if (key === "getDerivationStore") return undefined;
        const value = target[key];
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const triples = [];
    const registry = new AdapterRegistry({
      vault: customVault,
      kgSink: (batch) => triples.push(...batch),
      ragSink: async () => ({
        success: false,
        errors: [{ error: "first" }, { error: "second" }],
      }),
    });
    registry.register(new MockAdapter({ count: 2 }));
    const report = await registry.syncAdapter("mock");
    expect(report.status).toBe("ok");
    expect(report.checkpointCommitted).toBe(true);
    expect(report.kgTripleCount).toBe(triples.length);
    expect(report.derivationFailureCount).toBe(2);
    expect(report.derivationStatus).toBe("failed");
    expect(registry.getDerivationStatus()).toMatchObject({
      available: false,
      status: "unsupported",
    });
    expect(await registry.retryDerivations()).toMatchObject({
      available: false,
      processed: 0,
      status: "unsupported",
    });
  });

  it("blocks cross-type ID overwrites and tombstone removal of another type's projection", async () => {
    const vault = freshVault();
    const bm25 = new BM25Search({ language: "en" });
    const rag = new CcRagSink({ bm25 });
    const ragSink = vi.fn((docs) => rag.write(docs));
    const ragRemove = vi.fn((ids) => rag.remove(ids));
    const registry = successfulRegistry(vault, { ragSink, ragRemove });
    const original = event("shared", "retained");
    vault.putEvent(original);
    await registry.retryDerivations();
    vault.putPerson({
      id: "shared",
      type: "person",
      subtype: "contact",
      names: ["Conflicting person"],
      ingestedAt: original.ingestedAt,
      source: original.source,
    });
    vault.putEvent({ ...original, content: { text: "changed" } });
    const conflicted = await registry.retryDerivations();
    expect(conflicted.failed).toBe(4);
    expect(ragSink).toHaveBeenCalledTimes(1);
    expect(registry.kgSink).toHaveBeenCalledTimes(1);
    expect(bm25.search("retained")[0].id).toBe("shared");

    vault.deleteEntity("person", "shared");
    const deletion = await registry.retryDerivations();
    expect(deletion.failed).toBe(4);
    expect(ragRemove).not.toHaveBeenCalled();
    expect(registry.kgRemove).not.toHaveBeenCalled();
    expect(bm25.search("retained")[0].id).toBe("shared");
    const state = vault.getDerivationStore().getState("person", "shared", {
      consumerId: registry.consumerId,
    });
    expect(state.operation).toBe("delete");
    expect(
      state.deliveries.every(
        (entry) => entry.errorCode === "DERIVATION_ID_CONFLICT",
      ),
    ).toBe(true);
  });

  it("blocks conflicted reference hydration even when one colliding type is tombstoned", async () => {
    const vault = freshVault();
    const sourceEvent = { ...event("e"), actor: "shared" };
    vault.putEvent(sourceEvent);
    vault.putPerson({
      id: "shared",
      type: "person",
      subtype: "contact",
      names: ["Person"],
      ingestedAt: sourceEvent.ingestedAt,
      source: { ...sourceEvent.source, originalId: "shared" },
    });
    vault.putTopic({
      id: "shared",
      type: "topic",
      name: "Topic",
      ingestedAt: sourceEvent.ingestedAt,
      source: { ...sourceEvent.source, originalId: "shared" },
    });
    vault.deleteEntity("topic", "shared");
    const registry = successfulRegistry(vault);
    const result = await registry.retryDerivations();
    expect(result.failed).toBe(5);
    expect(result.succeeded).toBe(1);
    expect(registry.kgSink).not.toHaveBeenCalled();
    expect(registry.kgRemove).not.toHaveBeenCalled();
    expect(registry.ragRemove).not.toHaveBeenCalled();
    expect(registry.ragSink).toHaveBeenCalledTimes(1);
    const state = vault.getDerivationStore().getState("event", "e", {
      consumerId: registry.consumerId,
    });
    expect(
      state.deliveries.find((entry) => entry.target === "kg").errorCode,
    ).toBe("DERIVATION_ID_CONFLICT");
  });

  it("validates bounded retries and explicit consumer identity", async () => {
    const registry = new AdapterRegistry({ vault: {} });
    for (const limit of [0, 1001, 1.5, Infinity]) {
      await expect(registry.retryDerivations({ limit })).rejects.toThrow(
        /limit/,
      );
    }
    expect(() => new AdapterRegistry({ vault: {}, consumerId: " " })).toThrow(
      /consumerId/,
    );
  });
});
