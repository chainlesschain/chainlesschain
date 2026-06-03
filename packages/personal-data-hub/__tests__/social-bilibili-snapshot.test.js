"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  BilibiliAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_KINDS,
} = require("../lib/adapters/social-bilibili");
const { validateBatch } = require("../lib/batch");

// A8 v0.1 (2026-05-22) — snapshot-mode tests, mirroring system-data-android.
//
// Why a separate file? `social-adapters.test.js` covers the legacy sqlite
// path (Phase 7.5 device-pull). Snapshot mode is a brand-new ingestion path
// driven by in-APK Android cc reading JSON from the phone's own WebView+OkHttp
// pipeline. Keeping tests separated makes it obvious which mode a regression
// belongs to.

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "social-bilibili.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("BilibiliAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bili-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1 + 4 VALID_KINDS", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_KINDS).toEqual(["history", "favourite", "dynamic", "follow"]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new BilibiliAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new BilibiliAdapter();
    const res = await a.authenticate({ inputPath: path.join(tmpDir, "missing.json") });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with neither inputPath nor dbPath returns NO_INPUT", async () => {
    const a = new BilibiliAdapter();
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 99,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new BilibiliAdapter();
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
    const a = new BilibiliAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws).toHaveLength(0);
  });

  it("yields all 4 kinds + normalize produces valid batches", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: 1716000000000,
      account: { uid: "12345", displayName: "alice" },
      events: [
        {
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
        },
        {
          kind: "favourite",
          id: "fav-BV2def",
          capturedAt: 1714000000000,
          title: "前端架构",
          bvid: "BV2def",
          folderName: "学习",
          uploader: "码农UP",
        },
        {
          kind: "dynamic",
          id: "dyn-99",
          capturedAt: 1713000000000,
          summary: "今天发了一个新视频",
          dynamicType: "video",
          rid: 99,
          authorMid: 200,
          authorName: "我关注的UP",
        },
        {
          kind: "follow",
          id: "follow-300",
          capturedAt: 1712000000000,
          mid: 300,
          uname: "美食UP",
          face: "https://i0.hdslb.com/...",
          sign: "好吃的视频",
        },
      ],
    });
    const a = new BilibiliAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);

    expect(raws).toHaveLength(4);
    expect(raws.map((r) => r.kind).sort()).toEqual([
      "dynamic",
      "favourite",
      "follow",
      "history",
    ]);
    // Stable originalId format
    expect(raws.find((r) => r.kind === "history").originalId).toBe("bilibili:history:BV1abc");
    expect(raws.find((r) => r.kind === "favourite").originalId).toBe("bilibili:favourite:fav-BV2def");
    expect(raws.find((r) => r.kind === "dynamic").originalId).toBe("bilibili:dynamic:dyn-99");
    expect(raws.find((r) => r.kind === "follow").originalId).toBe("bilibili:follow:follow-300");

    // Normalize each + validate
    for (const raw of raws) {
      const batch = a.normalize(raw);
      const v = validateBatch(batch);
      expect(v.valid).toBe(true);

      if (raw.kind === "history") {
        expect(batch.events[0].subtype).toBe("browse");
        expect(batch.events[0].extra.bvid).toBe("BV1abc");
        expect(batch.events[0].extra.duration).toBe(600);
        expect(batch.items).toHaveLength(1);
        expect(batch.items[0].name).toBe("Rust 异步学习");
      } else if (raw.kind === "favourite") {
        expect(batch.events[0].subtype).toBe("like");
        expect(batch.events[0].extra.folderName).toBe("学习");
        expect(batch.items).toHaveLength(1);
      } else if (raw.kind === "dynamic") {
        expect(batch.events[0].subtype).toBe("browse");
        expect(batch.events[0].extra.dynamicType).toBe("video");
        expect(batch.events[0].extra.authorName).toBe("我关注的UP");
      } else if (raw.kind === "follow") {
        // Follow yields a person, not an event
        expect(batch.events).toHaveLength(0);
        expect(batch.persons).toHaveLength(1);
        expect(batch.persons[0].names[0]).toBe("美食UP");
        expect(batch.persons[0].identifiers["bilibili-mid"]).toEqual(["300"]);
      }
    }
  });

  it("per-kind include filter (e.g. include.follow=false drops follows)", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [
        { kind: "history", id: "h1", title: "x" },
        { kind: "follow", id: "f1", mid: 1, uname: "u" },
      ],
    });
    const a = new BilibiliAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, include: { follow: false } })) {
      raws.push(r);
    }
    expect(raws).toHaveLength(1);
    expect(raws[0].kind).toBe("history");
  });

  it("limit caps emission", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [
        { kind: "history", id: "1", title: "a" },
        { kind: "history", id: "2", title: "b" },
        { kind: "history", id: "3", title: "c" },
      ],
    });
    const a = new BilibiliAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, limit: 2 })) raws.push(r);
    expect(raws).toHaveLength(2);
  });

  it("skips unknown kinds (forward-compat with future event types)", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [
        { kind: "history", id: "1", title: "ok" },
        { kind: "fancy-new-kind-from-future", id: "x", data: "?" },
        { kind: "favourite", id: "f", title: "also ok" },
      ],
    });
    const a = new BilibiliAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws).toHaveLength(2);
    expect(raws.map((r) => r.kind).sort()).toEqual(["favourite", "history"]);
  });

  it("uses fallback originalId when event.id absent (no crash, still ingestable)", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [
        // Missing id — adapter should derive from bvid/mid/rid or generate fallback
        { kind: "history", bvid: "BV1xyz", title: "no-id" },
        { kind: "follow", mid: 999, uname: "with-mid-no-id" },
        { kind: "dynamic", summary: "no id no rid" },
      ],
    });
    const a = new BilibiliAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws).toHaveLength(3);
    // history derives from bvid
    expect(raws[0].originalId).toBe("bilibili:history:BV1xyz");
    // follow derives from mid
    expect(raws[1].originalId).toBe("bilibili:follow:999");
    // dynamic with no id/bvid/mid/rid → fallback unknown- prefix
    expect(raws[2].originalId).toMatch(/^bilibili:dynamic:unknown-/);
  });

  it("snapshot account propagates to payload (Path Y can re-attribute later)", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      account: { uid: "55555", displayName: "tester" },
      events: [{ kind: "history", id: "1", title: "x" }],
    });
    const a = new BilibiliAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws).toHaveLength(1);
    expect(raws[0].payload.account.uid).toBe("55555");
  });
});
