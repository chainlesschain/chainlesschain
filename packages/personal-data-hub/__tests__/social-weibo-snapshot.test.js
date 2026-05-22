"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  WeiboAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
} = require("../lib/adapters/social-weibo");
const { validateBatch } = require("../lib/batch");

// §A8 v0.2 — snapshot-mode tests, mirror of social-bilibili-snapshot.test.js.
//
// Snapshot mode is in-APK Android cc reading JSON written by WeiboLocalCollector
// (WebView + OkHttp). Sqlite/device-pull tests stay in social-adapters.test.js.

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "social-weibo.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("WeiboAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "weibo-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1 + 3 VALID_SNAPSHOT_KINDS", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_SNAPSHOT_KINDS).toEqual(["post", "favourite", "follow"]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new WeiboAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new WeiboAdapter();
    const res = await a.authenticate({ inputPath: path.join(tmpDir, "missing.json") });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with neither inputPath nor dbPath returns NO_INPUT", async () => {
    const a = new WeiboAdapter();
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
    const a = new WeiboAdapter();
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
    const a = new WeiboAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("post + favourite + follow round-trip normalize cleanly", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      account: { uid: "12345", displayName: "alice" },
      events: [
        {
          kind: "post",
          id: "post-M1",
          capturedAt: now - 1000,
          text: "今天天气真好",
          mid: "M1",
          source: "iPhone",
          repostsCount: 5,
          commentsCount: 3,
          likesCount: 10,
          picCount: 1,
        },
        {
          kind: "favourite",
          id: "fav-M2",
          capturedAt: now - 2000,
          text: "收藏的微博",
          mid: "M2",
          authorScreenName: "bob",
        },
        {
          kind: "follow",
          id: "follow-99",
          capturedAt: now - 3000,
          uid: 99,
          screenName: "carol",
          description: "hello",
          avatarUrl: "https://example.com/c.jpg",
        },
      ],
    });
    const a = new WeiboAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(3);

    const kinds = raws.map((r) => r.kind);
    expect(kinds).toEqual(["post", "favourite", "follow"]);

    // Each originalId namespaced under weibo:<kind>:<id>
    expect(raws[0].originalId).toMatch(/^weibo:post:/);
    expect(raws[1].originalId).toMatch(/^weibo:favourite:/);
    expect(raws[2].originalId).toMatch(/^weibo:follow:/);

    // Normalize each + validate
    for (const raw of raws) {
      const batch = a.normalize(raw);
      expect(validateBatch(batch).valid).toBe(true);
    }

    const postBatch = a.normalize(raws[0]);
    expect(postBatch.events[0].subtype).toBe("post");
    expect(postBatch.events[0].extra.weiboMid).toBe("M1");
    expect(postBatch.events[0].extra.repostsCount).toBe(5);
    expect(postBatch.events[0].extra.commentsCount).toBe(3);
    expect(postBatch.events[0].extra.likesCount).toBe(10);
    expect(postBatch.events[0].extra.picCount).toBe(1);
    expect(postBatch.events[0].source.capturedBy).toBe("api");

    const favBatch = a.normalize(raws[1]);
    expect(favBatch.events[0].subtype).toBe("like");
    expect(favBatch.events[0].extra.authorScreenName).toBe("bob");

    const followBatch = a.normalize(raws[2]);
    expect(followBatch.events.length).toBe(0);
    expect(followBatch.persons.length).toBe(1);
    expect(followBatch.persons[0].names).toEqual(["carol"]);
    expect(followBatch.persons[0].identifiers["weibo-uid"]).toEqual(["99"]);
  });

  it("respects per-kind include opt-out", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "post", id: "p1", capturedAt: now, text: "p1", mid: "M1" },
        { kind: "favourite", id: "f1", capturedAt: now, text: "f1", mid: "M2" },
        { kind: "follow", id: "fl1", capturedAt: now, uid: 99, screenName: "x" },
      ],
    });
    const a = new WeiboAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, include: { favourite: false } })) {
      raws.push(r);
    }
    const kinds = raws.map((r) => r.kind);
    expect(kinds).toEqual(["post", "follow"]);
  });

  it("respects opts.limit", async () => {
    const now = Date.now();
    const events = Array.from({ length: 5 }, (_, i) => ({
      kind: "post", id: `p${i}`, capturedAt: now - i * 100, text: `t${i}`, mid: `M${i}`,
    }));
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new WeiboAdapter();
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
        { kind: "post", id: "p1", capturedAt: now, text: "ok", mid: "M1" },
        { kind: "future-kind", id: "x", capturedAt: now },
        { kind: "search", id: "s", capturedAt: now }, // search is sqlite-only
      ],
    });
    const a = new WeiboAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("post");
  });

  it("snapshottedAt fallback when event capturedAt missing", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [
        { kind: "post", id: "p1", text: "no time", mid: "M1" },
      ],
    });
    const a = new WeiboAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });
});
