"use strict";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { LocalVault } = require("../lib/vault");
const { generateKeyHex } = require("../lib/key-providers");
const { AdapterRegistry } = require("../lib/registry");
const { EntityResolver } = require("../lib/entity-resolver");

// Minimal adapter that yields raw rows then normalizes to UnifiedSchema
class FakeAdapter {
  constructor(name, persons) {
    this.name = name;
    this.version = "0.1.0";
    this.capabilities = ["sync:test"];
    this.rateLimits = {};
    this.dataDisclosure = { fields: [], sensitivity: "low", legalGate: false };
    this._persons = persons;
  }
  async authenticate() { return { ok: true }; }
  async healthCheck() { return { ok: true, lastChecked: Date.now() }; }
  async *sync() {
    for (const p of this._persons) {
      yield { adapter: this.name, originalId: p.id, capturedAt: Date.now(), payload: { person: p } };
    }
  }
  normalize(raw) {
    const p = raw.payload.person;
    const now = Date.now();
    const source = {
      adapter: this.name, adapterVersion: this.version,
      originalId: raw.originalId, capturedAt: raw.capturedAt, capturedBy: "api",
    };
    return {
      events: [{
        id: `evt-${raw.originalId}`,
        type: "event",
        subtype: "interaction",
        occurredAt: now,
        actor: p.id,
        ingestedAt: now,
        source,
      }],
      persons: [{
        id: p.id,
        type: "person",
        subtype: "contact",
        names: p.names || [],
        identifiers: p.identifiers || {},
        ingestedAt: now,
        source,
      }],
      places: [], items: [], topics: [],
    };
  }
}

function makeRig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "er-hook-"));
  const vault = new LocalVault({ path: path.join(dir, "v.db"), key: generateKeyHex() });
  vault.open();
  const resolver = new EntityResolver({ vault });
  const registry = new AdapterRegistry({ vault, entityResolver: resolver });
  return { vault, resolver, registry, dir };
}

function cleanup({ vault, dir }) {
  try { vault.close(); } catch (_e) {}
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) {}
}

// ─── tests ────────────────────────────────────────────────────────────────

describe("Phase 8.6 — registry → entity resolver ingest hook", () => {
  let rig;
  afterEach(() => cleanup(rig));

  it("registry.syncAdapter fires resolveOnIngest with new Persons", async () => {
    rig = makeRig();
    const adapter = new FakeAdapter("a1", [
      { id: "p-1", names: ["Alice"], identifiers: { email: ["alice@x.com"] } },
      { id: "p-2", names: ["Bob"], identifiers: { email: ["bob@x.com"] } },
    ]);
    rig.registry.register(adapter);
    const report = await rig.registry.syncAdapter("a1");
    expect(report.status).toBe("ok");
    expect(report.entityResolver).toBeDefined();
    expect(report.entityResolver.newPersons).toBe(2);
  });

  it("cross-adapter R1 match: same email → auto-merged", async () => {
    rig = makeRig();
    // Adapter 1 imports Alice via email
    rig.registry.register(new FakeAdapter("email", [
      { id: "p-email-alice", names: ["Alice"], identifiers: { email: ["alice@x.com"] } },
    ]));
    await rig.registry.syncAdapter("email");

    // Adapter 2 imports same Alice via different name + same email
    rig.registry.register(new FakeAdapter("alipay", [
      { id: "p-alipay-alice-X", names: ["A. Alice"], identifiers: { email: ["alice@x.com"] } },
    ]));
    const report = await rig.registry.syncAdapter("alipay");
    expect(report.entityResolver.sameImmediate).toBeGreaterThanOrEqual(1);

    // Verify merge group exists
    const members = rig.vault.getMergeGroupMembers("p-email-alice").sort();
    expect(members).toEqual(["p-alipay-alice-X", "p-email-alice"]);
  });

  it("uncertain pairs (name overlap only) → enqueued for async", async () => {
    rig = makeRig();
    rig.registry.register(new FakeAdapter("email", [
      { id: "p-1", names: ["张三"] }, // no identifiers
    ]));
    await rig.registry.syncAdapter("email");

    rig.registry.register(new FakeAdapter("alipay", [
      { id: "p-2", names: ["张三"] },
    ]));
    const report = await rig.registry.syncAdapter("alipay");
    expect(report.entityResolver.enqueued).toBeGreaterThanOrEqual(1);
    expect(rig.vault.resolveQueueStats().pending).toBeGreaterThanOrEqual(1);
  });

  it("zero-overlap pair → no merge, no resolver decisions, person still ingested", async () => {
    rig = makeRig();
    rig.registry.register(new FakeAdapter("email", [
      { id: "p-1", names: ["Alice"], identifiers: { email: ["a@x.com"] } },
    ]));
    await rig.registry.syncAdapter("email");

    rig.registry.register(new FakeAdapter("alipay", [
      { id: "p-2", names: ["Bob"], identifiers: { phone: ["13999998888"] } },
    ]));
    const report = await rig.registry.syncAdapter("alipay");
    expect(report.status).toBe("ok");
    expect(rig.vault.stats().mergeGroups).toBe(0);
  });

  it("resolver failure does NOT break ingest (audit-logged)", async () => {
    rig = makeRig();
    // Mock resolver that throws on resolveOnIngest
    rig.registry.entityResolver = {
      resolveOnIngest: () => { throw new Error("resolver boom"); },
    };
    rig.registry.register(new FakeAdapter("a1", [
      { id: "p-1", names: ["Alice"], identifiers: { email: ["alice@x.com"] } },
    ]));
    const report = await rig.registry.syncAdapter("a1");
    expect(report.status).toBe("ok"); // sync completes
    expect(report.entityCounts.persons).toBe(1); // person still ingested
    const audits = rig.vault.queryAudit({ action: "adapter.sync.entity_resolver_failed", limit: 5 });
    expect(audits.length).toBeGreaterThanOrEqual(1);
  });

  it("no entityResolver = registry works as before (backward-compat)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "er-hook-"));
    const vault = new LocalVault({ path: path.join(dir, "v.db"), key: generateKeyHex() });
    vault.open();
    try {
      const registry = new AdapterRegistry({ vault }); // no entityResolver
      registry.register(new FakeAdapter("a1", [
        { id: "p-1", names: ["x"], identifiers: { email: ["a@x.com"] } },
      ]));
      const report = await registry.syncAdapter("a1");
      expect(report.status).toBe("ok");
      expect(report.entityResolver).toBeUndefined();
    } finally {
      vault.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
