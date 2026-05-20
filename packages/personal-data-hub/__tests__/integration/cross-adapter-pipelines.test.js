"use strict";

/**
 * Integration tests — cross-adapter pipelines.
 *
 * Exercises the full ingest → vault → EntityResolver → analysis skill
 * flow with multiple adapters feeding the same vault. Each test scenario
 * mirrors a real-world user journey from architecture-doc §7.1.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  LocalVault, generateKeyHex, AdapterRegistry,
  EntityResolver,
  SpendingSkill, RelationsSkill, FootprintSkill, TimelineSkill,
} = require("../../lib");

function makeRig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pdh-int-"));
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

// Minimal adapter for integration tests — yields pre-baked normalized
// batches so we don't depend on real Email/Alipay/etc subprocesses
class FixtureAdapter {
  constructor(name, batches, opts = {}) {
    this.name = name;
    this.version = "1.0.0";
    this.capabilities = ["sync:fixture"];
    this.extractMode = opts.extractMode || "web-api";
    this.rateLimits = {};
    this.dataDisclosure = { fields: [], sensitivity: "low", legalGate: false };
    this._batches = batches;
  }
  async authenticate() { return { ok: true }; }
  async healthCheck() { return { ok: true, lastChecked: Date.now() }; }
  async *sync() {
    for (const b of this._batches) {
      yield {
        adapter: this.name,
        originalId: b.originalId,
        capturedAt: b.capturedAt || Date.now(),
        payload: { batch: b.batch },
      };
    }
  }
  normalize(raw) { return raw.payload.batch; }
}

function source(adapter, originalId) {
  return {
    adapter, adapterVersion: "1.0.0", originalId,
    capturedAt: Date.now(), capturedBy: "api",
  };
}

// ─── Scenario 1: Email + Alipay → cross-source person merge ─────────────

describe("Integration — Email + Alipay → EntityResolver merges same person", () => {
  let rig;
  afterEach(() => cleanup(rig));

  it("same email across both adapters → one merge group, analysis sees combined spending", async () => {
    rig = makeRig();
    const src = (a, oid) => source(a, oid);

    // Email adapter: mom@163.com sends an order confirmation
    const emailBatch = {
      events: [{
        id: "evt-email-1", type: "event", subtype: "message",
        occurredAt: Date.parse("2026-05-15T10:00:00Z"),
        actor: "person-email-mom",
        content: { title: "妈 forwarded a link", text: "看看这个" },
        ingestedAt: Date.now(),
        source: src("email-imap", "msg-1"),
      }],
      persons: [{
        id: "person-email-mom",
        type: "person", subtype: "contact",
        names: ["妈"],
        identifiers: { email: ["mom@163.com"] },
        ingestedAt: Date.now(),
        source: src("email-imap", "person-1"),
      }],
      places: [], items: [], topics: [],
    };

    // Alipay adapter: 转账给 with same email associated
    const alipayBatch = {
      events: [{
        id: "evt-alipay-1", type: "event", subtype: "transfer",
        occurredAt: Date.parse("2026-05-20T12:00:00Z"),
        actor: "person-self",
        participants: ["person-self", "person-alipay-chen"],
        content: {
          title: "转账给 陈XX",
          amount: { value: 500, currency: "CNY", direction: "out" },
        },
        ingestedAt: Date.now(),
        source: src("alipay-bill", "tx-1"),
      }],
      persons: [{
        id: "person-alipay-chen",
        type: "person", subtype: "contact",
        names: ["陈XX"],
        identifiers: { email: ["mom@163.com"] }, // same email → R1 merge
        ingestedAt: Date.now(),
        source: src("alipay-bill", "person-1"),
      }],
      places: [], items: [], topics: [],
    };

    rig.registry.register(new FixtureAdapter("email-imap", [
      { originalId: "msg-1", batch: emailBatch },
    ]));
    rig.registry.register(new FixtureAdapter("alipay-bill", [
      { originalId: "tx-1", batch: alipayBatch },
    ]));

    const r1 = await rig.registry.syncAdapter("email-imap");
    const r2 = await rig.registry.syncAdapter("alipay-bill");

    expect(r1.status).toBe("ok");
    expect(r2.status).toBe("ok");
    // EntityResolver auto-merged via email rule
    expect(r2.entityResolver.sameImmediate).toBeGreaterThanOrEqual(1);

    // Both persons now in same merge group
    const members = rig.vault.getMergeGroupMembers("person-email-mom").sort();
    expect(members).toEqual(["person-alipay-chen", "person-email-mom"]);

    // RelationsSkill with merge-group expansion picks up BOTH events
    const skill = new RelationsSkill({ vault: rig.vault });
    const result = await skill.run({ personId: "person-email-mom" });
    expect(result.profile.totalInteractions).toBeGreaterThanOrEqual(2);
    expect(result.profile.totalSpend).toBe(500);
  });

  it("non-overlapping persons stay separate", async () => {
    rig = makeRig();
    const src = (a, oid) => source(a, oid);

    const emailBatch = {
      events: [], topics: [], places: [], items: [],
      persons: [{
        id: "p-alice", type: "person", subtype: "contact",
        names: ["Alice"], identifiers: { email: ["alice@x.com"] },
        ingestedAt: Date.now(), source: src("email-imap", "p1"),
      }],
    };
    const alipayBatch = {
      events: [], topics: [], places: [], items: [],
      persons: [{
        id: "p-bob", type: "person", subtype: "contact",
        names: ["Bob"], identifiers: { phone: ["13999998888"] },
        ingestedAt: Date.now(), source: src("alipay-bill", "p1"),
      }],
    };
    rig.registry.register(new FixtureAdapter("email-imap", [{ originalId: "1", batch: emailBatch }]));
    rig.registry.register(new FixtureAdapter("alipay-bill", [{ originalId: "1", batch: alipayBatch }]));
    await rig.registry.syncAdapter("email-imap");
    await rig.registry.syncAdapter("alipay-bill");
    // No merge group should form
    expect(rig.vault.stats().mergeGroups).toBe(0);
  });
});

// ─── Scenario 2: Multi-adapter spending analysis ────────────────────────

describe("Integration — SpendingSkill aggregates across adapters", () => {
  let rig;
  afterEach(() => cleanup(rig));

  it("sums spend from Alipay + Shopping (Taobao) + Travel (12306)", async () => {
    rig = makeRig();
    const now = Date.now();
    const src = (a, oid) => source(a, oid);

    function payEvent(adapter, id, amount, merchant, subtype = "payment") {
      return {
        events: [{
          id, type: "event", subtype,
          occurredAt: now - 24 * 3600_000,
          actor: "person-self",
          participants: ["person-self", `person-${adapter}-${merchant}`],
          content: { title: `${merchant} 消费`, amount: { value: amount, currency: "CNY", direction: "out" } },
          ingestedAt: now,
          source: src(adapter, id),
          extra: { counterparty: merchant },
        }],
        persons: [{
          id: `person-${adapter}-${merchant}`, type: "person", subtype: "merchant",
          names: [merchant], identifiers: {},
          ingestedAt: now, source: src(adapter, `p-${merchant}`),
        }],
        places: [], items: [], topics: [],
      };
    }

    rig.registry.register(new FixtureAdapter("alipay-bill", [
      { originalId: "alipay-1", batch: payEvent("alipay-bill", "evt-1", 38.50, "美团") },
      { originalId: "alipay-2", batch: payEvent("alipay-bill", "evt-2", 299, "淘宝") },
    ]));
    rig.registry.register(new FixtureAdapter("shopping-taobao", [
      { originalId: "tb-1", batch: payEvent("shopping-taobao", "evt-3", 999, "Apple官方", "order") },
    ]));
    rig.registry.register(new FixtureAdapter("travel-12306", [
      { originalId: "12306-1", batch: payEvent("travel-12306", "evt-4", 553, "12306", "payment") },
    ]));

    await rig.registry.syncAdapter("alipay-bill");
    await rig.registry.syncAdapter("shopping-taobao");
    await rig.registry.syncAdapter("travel-12306");

    const skill = new SpendingSkill({ vault: rig.vault });
    const result = await skill.run({});
    expect(result.summary.eventCount).toBe(4);
    expect(result.summary.totalSpend).toBeCloseTo(38.50 + 299 + 999 + 553, 2);
    expect(result.summary.uniqueCounterparties).toBe(4);
    // Top merchant should be Apple
    expect(result.breakdown[0].key).toBe("Apple官方");
  });
});

// ─── Scenario 3: Travel adapters + footprint ────────────────────────────

describe("Integration — Travel adapters → FootprintSkill", () => {
  let rig;
  afterEach(() => cleanup(rig));

  it("Amap routes + 12306 tickets feed unified footprint", async () => {
    rig = makeRig();
    const now = Date.now();
    const src = (a, oid) => source(a, oid);

    function tripEvent(adapter, id, from, to, ts) {
      return {
        events: [{
          id, type: "event", subtype: "trip",
          occurredAt: ts,
          actor: "person-self",
          content: { title: `${from} → ${to}` },
          ingestedAt: now,
          source: src(adapter, id),
          extra: { from, to },
        }],
        persons: [], places: [], items: [], topics: [],
      };
    }

    rig.registry.register(new FixtureAdapter("travel-12306", [
      { originalId: "t1", batch: tripEvent("travel-12306", "evt-1", "上海虹桥", "北京南", now - 7 * 24 * 3600_000) },
      { originalId: "t2", batch: tripEvent("travel-12306", "evt-2", "北京南", "上海虹桥", now - 5 * 24 * 3600_000) },
    ]));
    rig.registry.register(new FixtureAdapter("travel-amap", [
      { originalId: "a1", batch: tripEvent("travel-amap", "evt-3", "家", "公司", now - 4 * 24 * 3600_000) },
    ]));

    await rig.registry.syncAdapter("travel-12306");
    await rig.registry.syncAdapter("travel-amap");

    const skill = new FootprintSkill({ vault: rig.vault });
    const result = await skill.run({});
    expect(result.summary.totalTrips).toBeGreaterThanOrEqual(3);
    expect(result.topPlaces.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Scenario 4: Timeline weaves multiple adapter sources ──────────────

describe("Integration — TimelineSkill weaves messaging + payment events", () => {
  let rig;
  afterEach(() => cleanup(rig));

  it("chronological merge of WeChat + Alipay events", async () => {
    rig = makeRig();
    const now = Date.now();
    const src = (a, oid) => source(a, oid);

    const wechatBatch = {
      events: [{
        id: "wc-1", type: "event", subtype: "message",
        occurredAt: now - 1 * 3600_000, // 1h ago
        actor: "person-wechat-friend",
        content: { title: "妈: 吃饭了么", text: "吃饭了么" },
        ingestedAt: now,
        source: src("wechat", "msg-1"),
      }],
      persons: [], places: [], items: [], topics: [],
    };
    const alipayBatch = {
      events: [{
        id: "ap-1", type: "event", subtype: "payment",
        occurredAt: now - 30 * 60_000, // 30min ago
        actor: "person-self",
        content: { title: "美团外卖", amount: { value: 30, currency: "CNY", direction: "out" } },
        ingestedAt: now,
        source: src("alipay-bill", "tx-1"),
        extra: { counterparty: "美团" },
      }],
      persons: [], places: [], items: [], topics: [],
    };

    rig.registry.register(new FixtureAdapter("wechat", [{ originalId: "wc-1", batch: wechatBatch }]));
    rig.registry.register(new FixtureAdapter("alipay-bill", [{ originalId: "tx-1", batch: alipayBatch }]));
    await rig.registry.syncAdapter("wechat");
    await rig.registry.syncAdapter("alipay-bill");

    const skill = new TimelineSkill({ vault: rig.vault });
    const result = await skill.run({ sinceDays: 1 });
    expect(result.entries.length).toBe(2);
    // WeChat msg older → first; Alipay payment newer → second
    expect(result.entries[0].adapter).toBe("wechat");
    expect(result.entries[1].adapter).toBe("alipay-bill");
    expect(result.summary.byAdapter.wechat).toBe(1);
    expect(result.summary.byAdapter["alipay-bill"]).toBe(1);
  });
});

// ─── Scenario 5: EntityResolver + analysis cascade ─────────────────────

describe("Integration — EntityResolver review queue + manual merge unlocks combined view", () => {
  let rig;
  afterEach(() => cleanup(rig));

  it("uncertain pair queued → user merges → analysis picks up combined events", async () => {
    rig = makeRig();
    const now = Date.now();
    const src = (a, oid) => source(a, oid);

    // Two "张三" persons across email + alipay with no overlapping ids
    const emailBatch = {
      events: [{
        id: "evt-1", type: "event", subtype: "message",
        occurredAt: now, actor: "person-email-zs",
        content: { title: "msg" }, ingestedAt: now,
        source: src("email-imap", "m1"),
      }],
      persons: [{
        id: "person-email-zs", type: "person", subtype: "contact",
        names: ["张三"], identifiers: {},
        ingestedAt: now, source: src("email-imap", "p1"),
      }],
      places: [], items: [], topics: [],
    };
    const alipayBatch = {
      events: [{
        id: "evt-2", type: "event", subtype: "transfer",
        occurredAt: now, actor: "person-self",
        participants: ["person-self", "person-alipay-zs"],
        content: { title: "转账", amount: { value: 100, currency: "CNY", direction: "out" } },
        ingestedAt: now,
        source: src("alipay-bill", "t1"),
      }],
      persons: [{
        id: "person-alipay-zs", type: "person", subtype: "contact",
        names: ["张三"], identifiers: {},
        ingestedAt: now, source: src("alipay-bill", "p1"),
      }],
      places: [], items: [], topics: [],
    };
    rig.registry.register(new FixtureAdapter("email-imap", [{ originalId: "1", batch: emailBatch }]));
    rig.registry.register(new FixtureAdapter("alipay-bill", [{ originalId: "1", batch: alipayBatch }]));
    await rig.registry.syncAdapter("email-imap");
    const r2 = await rig.registry.syncAdapter("alipay-bill");

    // Without identifier overlap, rule stage = uncertain → queued
    expect(r2.entityResolver.enqueued).toBeGreaterThanOrEqual(1);
    expect(rig.vault.stats().mergeGroups).toBe(0);

    // User manually merges via UI
    rig.resolver.manualMerge({ aId: "person-email-zs", bId: "person-alipay-zs" });
    expect(rig.vault.getMergeGroupMembers("person-email-zs").sort()).toEqual(
      ["person-alipay-zs", "person-email-zs"]
    );

    // Now relations skill sees combined view
    const skill = new RelationsSkill({ vault: rig.vault });
    const result = await skill.run({ personId: "person-email-zs" });
    expect(result.profile.totalInteractions).toBe(2);
  });
});
