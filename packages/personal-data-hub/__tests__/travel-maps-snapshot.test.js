"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  BaiduMapAdapter,
  SNAPSHOT_SCHEMA_VERSION: BAIDU_VERSION,
} = require("../lib/adapters/travel-baidu-map");
const {
  TencentMapAdapter,
  SNAPSHOT_SCHEMA_VERSION: TENCENT_VERSION,
} = require("../lib/adapters/travel-tencent-map");
const { validateBatch } = require("../lib/batch");

// §2.5b 地图三联 v0.2 — snapshot-mode tests, mirror of social-weibo-snapshot
// & social-bilibili-snapshot patterns.
//
// Snapshot mode is in-APK Android cc reading JSON written by the
// {Baidu,Tencent}MapLocalCollector (WebView cookie scrape). Sqlite/device-pull
// tests remain in travel-adapters.test.js. Three kinds: favourite / search /
// route — all 3 reuse normalizeTravelRecord via on-the-fly TravelRecord build.

function writeSnapshot(dir, fileName, snapshot) {
  const p = path.join(dir, fileName);
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("BaiduMapAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "baidu-map-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1", () => {
    expect(BAIDU_VERSION).toBe(1);
  });

  it("authenticate(inputPath) ok when readable + mode=snapshot-file", async () => {
    const p = writeSnapshot(tmpDir, "travel-baidu-map.json", {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new BaiduMapAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new BaiduMapAdapter();
    const res = await a.authenticate({ inputPath: path.join(tmpDir, "missing.json") });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with neither inputPath nor dbPath returns NO_INPUT", async () => {
    const a = new BaiduMapAdapter();
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
  });

  it("authenticate(dbPath) without account.deviceId returns NO_ACCOUNT_DEVICE_ID", async () => {
    const a = new BaiduMapAdapter({ dbPath: path.join(tmpDir, "fake.db") });
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_ACCOUNT_DEVICE_ID");
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, "travel-baidu-map.json", {
      schemaVersion: 99,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new BaiduMapAdapter();
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
    const p = writeSnapshot(tmpDir, "travel-baidu-map.json", {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new BaiduMapAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("favourite + search + route round-trip normalize cleanly", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, "travel-baidu-map.json", {
      schemaVersion: 1,
      snapshottedAt: now,
      vendor: "baidu-map",
      account: { uid: "12345", displayName: "alice" },
      events: [
        {
          kind: "favourite",
          id: "fav-R1",
          capturedAt: now - 1000,
          name: "公司",
          address: "厦门市象屿路 93 号",
          lat: 24.4781,
          lng: 118.0894,
          category: "company",
        },
        {
          kind: "search",
          id: "search-S1",
          capturedAt: now - 2000,
          query: "鼓浪屿",
          city: "厦门",
        },
        {
          kind: "route",
          id: "route-RT1",
          capturedAt: now - 3000,
          from: { name: "厦门北站", lat: 24.6, lng: 118.0 },
          to: { name: "厦门大学", lat: 24.43, lng: 118.09 },
          mode: "drive",
        },
      ],
    });
    const a = new BaiduMapAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(3);

    const kinds = raws.map((r) => r.kind);
    expect(kinds).toEqual(["favourite", "search", "route"]);

    // Each originalId namespaced under baidu-map:<kind>:<id>
    expect(raws[0].originalId).toMatch(/^baidu-map:favourite:/);
    expect(raws[1].originalId).toMatch(/^baidu-map:search:/);
    expect(raws[2].originalId).toMatch(/^baidu-map:route:/);

    // Normalize each + validate
    for (const raw of raws) {
      const batch = a.normalize(raw);
      expect(validateBatch(batch).valid).toBe(true);
    }

    // Favourite: visit-type trip event + 1 place (to) + carrier merchant
    const favBatch = a.normalize(raws[0]);
    expect(favBatch.events.length).toBe(1);
    expect(favBatch.events[0].subtype).toBe("trip");
    // The to-place name flows through as the trip's destination
    // (Place uses singular `name`; aliases array for redundant labels)
    const favToPlace = favBatch.places.find(
      (pl) => pl.name === "公司" || (pl.aliases && pl.aliases.includes("公司")),
    );
    expect(favToPlace).toBeTruthy();

    // Route: from/to places (2) + carrier merchant
    const routeBatch = a.normalize(raws[2]);
    expect(routeBatch.places.length).toBeGreaterThanOrEqual(2);

    // Carrier always "百度地图"
    const allBatches = raws.map((r) => a.normalize(r));
    const carriers = allBatches.flatMap((b) =>
      b.persons.filter((p) => p.names.includes("百度地图")),
    );
    expect(carriers.length).toBe(3);
  });

  it("respects per-kind include opt-out", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, "travel-baidu-map.json", {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "favourite", id: "f1", capturedAt: now, name: "家", lat: 24, lng: 118 },
        { kind: "search", id: "s1", capturedAt: now, query: "餐厅" },
        { kind: "route", id: "r1", capturedAt: now, from: { name: "A" }, to: { name: "B" }, mode: "walk" },
      ],
    });
    const a = new BaiduMapAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, include: { search: false } })) {
      raws.push(r);
    }
    const kinds = raws.map((r) => r.kind);
    expect(kinds).toEqual(["favourite", "route"]);
  });

  it("respects opts.limit", async () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      kind: "favourite",
      id: `f${i}`,
      capturedAt: now - i * 100,
      name: `place-${i}`,
      lat: 24,
      lng: 118,
    }));
    const p = writeSnapshot(tmpDir, "travel-baidu-map.json", {
      schemaVersion: 1,
      snapshottedAt: now,
      events,
    });
    const a = new BaiduMapAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, limit: 2 })) raws.push(r);
    expect(raws.length).toBe(2);
  });

  it("filters out unknown kinds (forward compat)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, "travel-baidu-map.json", {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "favourite", id: "f1", capturedAt: now, name: "ok", lat: 1, lng: 2 },
        { kind: "future-kind", id: "x", capturedAt: now },
        { kind: "trip-summary", id: "ts", capturedAt: now }, // hypothetical future
      ],
    });
    const a = new BaiduMapAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("favourite");
  });

  it("snapshottedAt fallback when event capturedAt missing", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, "travel-baidu-map.json", {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [
        { kind: "favourite", id: "f1", name: "no time", lat: 1, lng: 2 },
      ],
    });
    const a = new BaiduMapAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });

  it("sync() without inputPath OR dbPath throws", async () => {
    const a = new BaiduMapAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({})) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/needs opts.inputPath/);
  });

  it("snapshot mode does NOT require account.deviceId at construction", () => {
    // The whole point of snapshot mode: stateless adapter, account from snapshot
    expect(() => new BaiduMapAdapter()).not.toThrow();
    expect(() => new BaiduMapAdapter({})).not.toThrow();
  });
});

describe("TencentMapAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tencent-map-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1", () => {
    expect(TENCENT_VERSION).toBe(1);
  });

  it("constructor allows missing account (stateless snapshot mode)", () => {
    expect(() => new TencentMapAdapter()).not.toThrow();
    expect(() => new TencentMapAdapter({})).not.toThrow();
  });

  it("authenticate(inputPath) ok", async () => {
    const p = writeSnapshot(tmpDir, "travel-tencent-map.json", {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new TencentMapAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(dbPath) without deviceId returns NO_ACCOUNT_DEVICE_ID", async () => {
    const a = new TencentMapAdapter({ dbPath: "/tmp/fake.db" });
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_ACCOUNT_DEVICE_ID");
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, "travel-tencent-map.json", {
      schemaVersion: 99,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new TencentMapAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) { /* drain */ }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/schemaVersion mismatch/);
  });

  it("favourite + route normalize cleanly with carrier=腾讯地图", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, "travel-tencent-map.json", {
      schemaVersion: 1,
      snapshottedAt: now,
      vendor: "tencent-map",
      account: { uid: "qq-12345", displayName: "alice" },
      events: [
        {
          kind: "favourite",
          id: "fav-T1",
          capturedAt: now - 1000,
          name: "公司",
          address: "广州市天河区珠江新城",
          lat: 23.12,
          lng: 113.32,
          category: "company",
        },
        {
          kind: "route",
          id: "route-T1",
          capturedAt: now - 2000,
          from: { name: "广州南站", lat: 22.99, lng: 113.27 },
          to: { name: "天河客运站", lat: 23.16, lng: 113.36 },
          mode: "transit",
        },
      ],
    });
    const a = new TencentMapAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(2);

    expect(raws[0].originalId).toMatch(/^tencent-map:favourite:/);
    expect(raws[1].originalId).toMatch(/^tencent-map:route:/);

    for (const raw of raws) {
      const batch = a.normalize(raw);
      expect(validateBatch(batch).valid).toBe(true);
    }

    // Carrier must be 腾讯地图 (not 百度地图 or 高德地图 — paranoid catch
    // copy-paste regression)
    const allBatches = raws.map((r) => a.normalize(r));
    for (const b of allBatches) {
      const tencentCarrier = b.persons.find((p) => p.names.includes("腾讯地图"));
      expect(tencentCarrier).toBeTruthy();
      expect(b.persons.find((p) => p.names.includes("百度地图"))).toBeFalsy();
      expect(b.persons.find((p) => p.names.includes("高德地图"))).toBeFalsy();
    }

    // Route mode "transit" maps to bus
    const routeBatch = a.normalize(raws[1]);
    const tripEvent = routeBatch.events[0];
    expect(tripEvent.extra.vehicleType).toBe("bus");
  });

  it("empty events array yields nothing", async () => {
    const p = writeSnapshot(tmpDir, "travel-tencent-map.json", {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new TencentMapAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("filters unknown kinds", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, "travel-tencent-map.json", {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "favourite", id: "f1", capturedAt: now, name: "ok", lat: 1, lng: 2 },
        { kind: "speculative-future", id: "x", capturedAt: now },
      ],
    });
    const a = new TencentMapAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("favourite");
  });

  it("snapshottedAt fallback when event capturedAt missing", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, "travel-tencent-map.json", {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [
        { kind: "favourite", id: "f1", name: "no time", lat: 1, lng: 2 },
      ],
    });
    const a = new TencentMapAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });
});
