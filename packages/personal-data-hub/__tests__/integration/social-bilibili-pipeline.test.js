"use strict";

/**
 * Integration test — A8 v0.1 Bilibili snapshot → vault pipeline.
 *
 * Exercises the full chain WITHOUT any real WebView / OkHttp / Android JNI:
 *
 *   Synthetic snapshot JSON (4 kinds)
 *      ↓
 *   AdapterRegistry (real) + LocalVault (real, SQLCipher)
 *      ↓
 *   adapter.sync({ inputPath }) → _syncViaSnapshot yields raw events
 *      ↓
 *   registry.putRawEvent → vault.raw_events
 *      ↓
 *   adapter.normalize(raw) → batch
 *      ↓
 *   vault.putBatch → events / persons / places / items / topics tables
 *
 * Two scenarios:
 *   A. happy path — 4-kind snapshot ingests; vault yields exact counts;
 *      KG triples derive; originalId stable across re-sync (idempotency)
 *   B. partial snapshot — only history + follow; vault gets correct subset
 *
 * Win note: bs3mc has a known NODE_MODULE_VERSION mismatch on this dev box
 * (Node 22.22.2 ABI v127 vs prebuild ABI v140); test passes on CI Linux
 * which uses the matched prebuild. See memory pdh-plan-a-android-standalone-
 * design §"bs3mc NODE_MODULE_VERSION mismatch".
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  LocalVault,
  generateKeyHex,
  AdapterRegistry,
} = require("../../lib");
const {
  BilibiliAdapter,
  SNAPSHOT_SCHEMA_VERSION,
} = require("../../lib/adapters/social-bilibili");

function makeRig() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bili-int-"));
  const vault = new LocalVault({ path: path.join(dir, "v.db"), key: generateKeyHex() });
  vault.open();
  const registry = new AdapterRegistry({ vault });
  return { vault, registry, dir };
}

function cleanup(rig) {
  if (!rig) return;
  try { rig.vault.close(); } catch (_e) { /* noop */ }
  try { fs.rmSync(rig.dir, { recursive: true, force: true }); } catch (_e) { /* noop */ }
}

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "social-bilibili.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

function sampleSnapshot(opts = {}) {
  const include = {
    history: true,
    favourite: true,
    dynamic: true,
    follow: true,
    ...opts.include,
  };
  const events = [];
  if (include.history) {
    events.push({
      kind: "history",
      id: "BV1abc",
      capturedAt: 1715000000000,
      title: "Rust 异步学习",
      bvid: "BV1abc",
      avid: 42,
      duration: 600,
      uploader: "技术UP主",
      uploaderMid: 100,
      part: "01 介绍",
    });
  }
  if (include.favourite) {
    events.push({
      kind: "favourite",
      id: "fav-BV2def",
      capturedAt: 1714000000000,
      title: "前端架构",
      bvid: "BV2def",
      folderName: "学习",
      uploader: "码农UP",
    });
  }
  if (include.dynamic) {
    events.push({
      kind: "dynamic",
      id: "dyn-99",
      capturedAt: 1713000000000,
      summary: "今天发了一个新视频",
      dynamicType: "av",
      rid: "99",
      authorMid: 200,
      authorName: "我关注的UP",
    });
  }
  if (include.follow) {
    events.push({
      kind: "follow",
      id: "follow-300",
      capturedAt: 1712000000000,
      mid: 300,
      uname: "美食UP",
      face: "https://i0.hdslb.com/300.jpg",
      sign: "好吃的视频",
    });
  }
  return {
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    snapshottedAt: 1716000000000,
    account: { uid: "12345", displayName: "alice" },
    events,
  };
}

describe("Integration — A8 Bilibili snapshot → vault end-to-end", () => {
  let rig;
  afterEach(() => { cleanup(rig); rig = null; });

  it("4 kinds ingest into vault with exact entity counts", async () => {
    rig = makeRig();
    const adapter = new BilibiliAdapter();
    rig.registry.register(adapter);

    const snapshotPath = writeSnapshot(rig.dir, sampleSnapshot());
    const report = await rig.registry.syncAdapter("social-bilibili", {
      inputPath: snapshotPath,
    });

    // 3 events (history + favourite + dynamic) + 1 person (follow) +
    // 2 items (history-video + favourite-video)
    expect(report.status).toBe("ok");
    expect(report.entityCounts.events).toBe(3);
    expect(report.entityCounts.persons).toBe(1);
    expect(report.entityCounts.items).toBe(2);

    // Vault round-trip
    const events = rig.vault.queryEvents({ limit: 100 });
    expect(events).toHaveLength(3);
    const subtypes = events.map((e) => e.subtype).sort();
    expect(subtypes).toEqual(["browse", "browse", "like"]); // history+dynamic+favourite

    const persons = rig.vault.queryPersons({ limit: 100 });
    expect(persons).toHaveLength(1);
    expect(persons[0].names[0]).toBe("美食UP");

    const items = rig.vault.queryItems({ limit: 100 });
    expect(items).toHaveLength(2);
    expect(items.map((i) => i.name).sort()).toEqual(["Rust 异步学习", "前端架构"]);
  });

  it("re-sync is idempotent — same snapshot twice does NOT double entities", async () => {
    rig = makeRig();
    const adapter = new BilibiliAdapter();
    rig.registry.register(adapter);
    const snapshotPath = writeSnapshot(rig.dir, sampleSnapshot());

    // First sync
    const report1 = await rig.registry.syncAdapter("social-bilibili", {
      inputPath: snapshotPath,
    });
    expect(report1.status).toBe("ok");

    // Second sync — same snapshot
    const report2 = await rig.registry.syncAdapter("social-bilibili", {
      inputPath: snapshotPath,
    });
    expect(report2.status).toBe("ok");

    // Stable originalId means re-sync de-dups at raw_events layer.
    // The person/item entities should remain at 1 / 2 respectively
    // because their IDs derive from bvid / mid (stable). Events can
    // legitimately double-write because each "browse" is a separate
    // occurrence — registry doesn't dedup events.
    const persons = rig.vault.queryPersons({ limit: 100 });
    expect(persons).toHaveLength(1);

    const items = rig.vault.queryItems({ limit: 100 });
    // Items with same bvid produce same ID, so item table stays at 2
    // (UPSERT semantics via primary-key id).
    expect(items).toHaveLength(2);
  });

  it("partial snapshot (history + follow only) yields exact subset", async () => {
    rig = makeRig();
    const adapter = new BilibiliAdapter();
    rig.registry.register(adapter);

    const snapshotPath = writeSnapshot(
      rig.dir,
      sampleSnapshot({ include: { favourite: false, dynamic: false } })
    );
    const report = await rig.registry.syncAdapter("social-bilibili", {
      inputPath: snapshotPath,
    });
    expect(report.status).toBe("ok");
    expect(report.entityCounts.events).toBe(1); // history only
    expect(report.entityCounts.persons).toBe(1); // follow
    expect(report.entityCounts.items).toBe(1); // history video
  });

  it("empty events array → ok status with 0 entity counts", async () => {
    rig = makeRig();
    const adapter = new BilibiliAdapter();
    rig.registry.register(adapter);

    const snapshotPath = writeSnapshot(rig.dir, {
      schemaVersion: SNAPSHOT_SCHEMA_VERSION,
      snapshottedAt: Date.now(),
      events: [],
    });
    const report = await rig.registry.syncAdapter("social-bilibili", {
      inputPath: snapshotPath,
    });
    expect(report.status).toBe("ok");
    expect(report.entityCounts.events).toBe(0);
    expect(report.entityCounts.persons).toBe(0);
    expect(report.entityCounts.items).toBe(0);
  });

  it("schemaVersion mismatch surfaces in SyncReport.error (not silent)", async () => {
    rig = makeRig();
    const adapter = new BilibiliAdapter();
    rig.registry.register(adapter);

    const snapshotPath = writeSnapshot(rig.dir, {
      schemaVersion: 99, // wrong
      snapshottedAt: Date.now(),
      events: [],
    });
    const report = await rig.registry.syncAdapter("social-bilibili", {
      inputPath: snapshotPath,
    });
    expect(report.status).toBe("error");
    expect(String(report.error)).toMatch(/schemaVersion mismatch/);
  });

  it("registry queryable by adapter.name after register()", () => {
    rig = makeRig();
    const adapter = new BilibiliAdapter();
    rig.registry.register(adapter);
    expect(rig.registry.has("social-bilibili")).toBe(true);
    expect(rig.registry.list().some((m) => m.name === "social-bilibili")).toBe(true);
  });
});
