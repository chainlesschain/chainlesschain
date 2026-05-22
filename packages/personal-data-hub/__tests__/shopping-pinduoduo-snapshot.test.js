"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  PinduoduoAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
} = require("../lib/adapters/shopping-pinduoduo");
const { validateBatch } = require("../lib/batch");

// §2.4c v0.2 — Pinduoduo snapshot-only adapter. Pinduoduo's web API requires
// anti_token JS-VM signing (similar to 抖音 X-Bogus); cookie/api mode is
// deferred to v0.3 via a browser extension that exports order JSON.

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "shopping-pinduoduo.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

function writeRaw(dir, fileName, content) {
  const p = path.join(dir, fileName);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

describe("PinduoduoAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdd-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1 and VALID_SNAPSHOT_KINDS = [order]", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_SNAPSHOT_KINDS).toEqual(["order"]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new PinduoduoAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new PinduoduoAdapter();
    const res = await a.authenticate({ inputPath: path.join(tmpDir, "missing.json") });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with no inputPath returns NO_INPUT (no cookie mode in v0.2)", async () => {
    const a = new PinduoduoAdapter({ account: { uid: "u1" } });
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
    // Honest hint about the anti_token gap
    expect(res.message).toMatch(/snapshot mode/);
  });

  it("sync() without inputPath throws with anti_token hint", async () => {
    const a = new PinduoduoAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({})) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/anti_token/);
  });

  it("rejects non-JSON inputPath with HTML-parsing-future hint", async () => {
    const p = writeRaw(tmpDir, "orders.html", "<html><body>not json</body></html>");
    const a = new PinduoduoAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/snapshot must be JSON/);
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 99,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new PinduoduoAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/schemaVersion mismatch/);
  });

  it("empty events array yields nothing (no crash)", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new PinduoduoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("order event round-trips normalize cleanly", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      vendor: "pinduoduo",
      account: { uid: "u-alice", displayName: "alice" },
      events: [
        {
          kind: "order",
          id: "order-PDD-9001",
          capturedAt: now - 1000,
          orderId: "PDD-9001",
          merchantName: "拼多多旗舰店",
          placedAt: now - 86400_000,
          paidAt: now - 86400_000 + 5_000,
          status: "已发货",
          items: [
            { name: "纸巾100抽", quantity: 5, unitPrice: 9.9, sku: "sku-001" },
            { name: "牙刷4支装", quantity: 1, unitPrice: 12.5 },
          ],
          totalAmount: { value: 62.0, currency: "CNY" },
          recipient: "张三",
          shippingAddress: "上海市浦东新区...",
          trackingNumber: "SF1234567890",
        },
      ],
    });
    const a = new PinduoduoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("order");
    expect(raws[0].originalId).toMatch(/^pinduoduo:order:/);
    expect(raws[0].originalId).toBe("pinduoduo:order:order-PDD-9001");

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    // normalizeOrderRecord emits an Event for the placed order. Confirm the
    // shape matches what the LocalVault audit row expects.
    expect(batch.events.length).toBeGreaterThan(0);
    // Items survive into the normalized record's extras / event content
    expect(JSON.stringify(batch)).toContain("纸巾100抽");
    // Recipient / address survive
    expect(JSON.stringify(batch)).toContain("张三");
  });

  it("status mapping handles pinduoduo-typical strings", async () => {
    const now = Date.now();
    const cases = [
      { status: "已发货", expect: "shipped" },
      { status: "已收货", expect: "delivered" },
      { status: "已完成", expect: "delivered" },
      { status: "退款", expect: "refunded" },
      { status: "已关闭", expect: "cancelled" },
      { status: "待付款", expect: "placed" },
    ];
    for (const c of cases) {
      const p = writeSnapshot(tmpDir, {
        schemaVersion: 1,
        snapshottedAt: now,
        events: [
          {
            kind: "order", id: `o-${c.status}`,
            orderId: `o-${c.status}`, merchantName: "m",
            placedAt: now, paidAt: now, status: c.status,
            items: [{ name: "x", quantity: 1, unitPrice: 1 }],
            totalAmount: { value: 1, currency: "CNY" },
          },
        ],
      });
      const a = new PinduoduoAdapter();
      const raws = [];
      for await (const r of a.sync({ inputPath: p })) raws.push(r);
      const batch = a.normalize(raws[0]);
      // Find the order event and check status survives via extras (the
      // shopping-base normalizer puts mapped status into the event)
      const stringified = JSON.stringify(batch);
      // Status maps to one of the canonical enum values. We can't easily
      // get the field path without depending on shopping-base internals,
      // so verify the canonical value appears somewhere in the batch.
      expect(stringified).toContain(c.expect);
    }
  });

  it("respects per-kind include opt-out", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "order", id: "o1", orderId: "o1", merchantName: "m", placedAt: now,
          items: [], totalAmount: { value: 1, currency: "CNY" } },
      ],
    });
    const a = new PinduoduoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, include: { order: false } })) {
      raws.push(r);
    }
    expect(raws.length).toBe(0);
  });

  it("respects opts.limit", async () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      kind: "order", id: `o${i}`, orderId: `o${i}`, merchantName: "m",
      placedAt: now - i * 1000,
      items: [], totalAmount: { value: 1, currency: "CNY" },
    }));
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new PinduoduoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, limit: 2 })) raws.push(r);
    expect(raws.length).toBe(2);
  });

  it("filters out unknown kinds (forward compat)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "order", id: "o1", orderId: "o1", merchantName: "m", placedAt: now,
          items: [], totalAmount: { value: 1, currency: "CNY" } },
        { kind: "refund", id: "r1", orderId: "o1" }, // not yet supported
        { kind: "future-kind", id: "x" },
      ],
    });
    const a = new PinduoduoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("order");
  });

  it("snapshottedAt fallback when event capturedAt missing", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [
        { kind: "order", id: "o1", orderId: "o1", merchantName: "m", items: [],
          totalAmount: { value: 1, currency: "CNY" } },
      ],
    });
    const a = new PinduoduoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });

  it("snapshotEventToRecord handles snake_case goods_name/goods_price fallback", async () => {
    // Pinduoduo's internal field names use snake_case (goods_name, goods_price,
    // goods_count); the normalizer falls back to those if camelCase is absent.
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        {
          kind: "order", id: "o-snake",
          orderId: "o-snake", merchantName: "店铺A",
          placedAt: now, paidAt: now,
          items: [
            { goods_name: "纸巾", goods_count: 3, goods_price: 5.5, sku_id: "sk1" },
          ],
          totalAmount: { value: 16.5, currency: "CNY" },
        },
      ],
    });
    const a = new PinduoduoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    const batch = a.normalize(raws[0]);
    expect(JSON.stringify(batch)).toContain("纸巾");
  });
});
