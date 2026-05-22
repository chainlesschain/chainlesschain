"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  KuaishouAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
} = require("../lib/adapters/social-kuaishou");
const { validateBatch } = require("../lib/batch");

// §A8 v0.2 — Kuaishou snapshot mode tests, mirror of social-toutiao-snapshot.
// Snapshot mode reads JSON produced by the phone's KuaishouLocalCollector
// (root + SQLCipher decrypt of /data/data/com.smile.gifmaker/databases/).

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "social-kuaishou.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("KuaishouAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kuaishou-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1 + 3 VALID_SNAPSHOT_KINDS", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_SNAPSHOT_KINDS).toEqual(["watch", "collect", "search"]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new KuaishouAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new KuaishouAdapter();
    const res = await a.authenticate({
      inputPath: path.join(tmpDir, "missing.json"),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with neither inputPath nor dbPath returns NO_INPUT", async () => {
    const a = new KuaishouAdapter();
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
  });

  it("authenticate() sqlite mode without account.uid returns NO_ACCOUNT_UID", async () => {
    const a = new KuaishouAdapter({ dbPath: "/no/such/path.db" });
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_ACCOUNT_UID");
  });

  it("rejects schemaVersion mismatch", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 99,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new KuaishouAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ inputPath: p })) {
        /* drain */
      }
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
    const a = new KuaishouAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("watch event round-trips normalize cleanly (BROWSE subtype)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      account: { uid: "67890", displayName: "alice" },
      events: [
        {
          kind: "watch",
          id: "photo-p-1",
          capturedAt: now - 1000,
          photoId: "p-1",
          caption: "搞笑视频",
          duration: 30,
          authorId: "u-author-1",
          authorName: "UpA",
        },
      ],
    });
    const a = new KuaishouAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("watch");
    expect(raws[0].originalId).toMatch(/^kuaishou:watch:/);

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events[0].subtype).toBe("browse");
    expect(batch.events[0].content.title).toBe("搞笑视频");
    expect(batch.events[0].extra.photoId).toBe("p-1");
    expect(batch.events[0].extra.duration).toBe(30);
    expect(batch.events[0].extra.authorId).toBe("u-author-1");
    expect(batch.events[0].extra.authorName).toBe("UpA");
    expect(batch.events[0].extra.platform).toBe("kuaishou");
    expect(batch.events[0].source.capturedBy).toBe("api");
  });

  it("collect event round-trips normalize cleanly (LIKE subtype)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        {
          kind: "collect",
          id: "collect-p-2",
          capturedAt: now - 2000,
          photoId: "p-2",
          caption: "美食 vlog",
          authorId: "u-author-2",
          authorName: "FoodVlogger",
        },
      ],
    });
    const a = new KuaishouAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events[0].subtype).toBe("like");
    expect(batch.events[0].content.title).toBe("美食 vlog");
    expect(batch.events[0].extra.photoId).toBe("p-2");
    expect(batch.events[0].extra.authorName).toBe("FoodVlogger");
    expect(batch.events[0].source.capturedBy).toBe("api");
  });

  it("search event round-trips normalize cleanly (POST subtype, keyword in title)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        {
          kind: "search",
          id: "search-square-dance:1700002000",
          capturedAt: now - 3000,
          keyword: "广场舞",
        },
      ],
    });
    const a = new KuaishouAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events[0].subtype).toBe("post");
    expect(batch.events[0].content.title).toBe("广场舞");
    expect(batch.events[0].extra.kind).toBe("search");
    expect(batch.events[0].extra.keyword).toBe("广场舞");
  });

  it("respects per-kind include opt-out", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "watch", id: "w1", capturedAt: now, photoId: "p-1", caption: "c1" },
        { kind: "collect", id: "c1", capturedAt: now, photoId: "p-2", caption: "c2" },
        { kind: "search", id: "s1", capturedAt: now, keyword: "kw" },
      ],
    });
    const a = new KuaishouAdapter();
    const raws = [];
    for await (const r of a.sync({
      inputPath: p,
      include: { collect: false, search: false },
    })) {
      raws.push(r);
    }
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("watch");
  });

  it("respects opts.limit", async () => {
    const now = Date.now();
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push({
        kind: "watch",
        id: `w${i}`,
        capturedAt: now - i * 1000,
        photoId: `p-${i}`,
        caption: `c${i}`,
      });
    }
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new KuaishouAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, limit: 5 })) raws.push(r);
    expect(raws.length).toBe(5);
  });

  it("filters out unknown kinds (forward compat)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "watch", id: "w1", capturedAt: now, photoId: "p-1", caption: "c1" },
        { kind: "future-kind", id: "x", capturedAt: now },
        { kind: "live-watch", id: "lv-1", capturedAt: now }, // v0.3 hypothetical
      ],
    });
    const a = new KuaishouAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("watch");
  });

  it("snapshottedAt fallback when event capturedAt missing", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [{ kind: "watch", id: "w1", photoId: "p-1", caption: "c1" }],
    });
    const a = new KuaishouAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });

  it("sqlite mode throws when account.uid missing at sync time", async () => {
    const a = new KuaishouAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync({ dbPath: "/no/such/path.db" })) {
        /* drain */
      }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/account\.uid required/);
  });

  it("sqlite mode gracefully exits when dbPath unreadable (with account.uid)", async () => {
    const a = new KuaishouAdapter({
      account: { uid: "u-2" },
      dbPath: "/no/such/path.db",
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toEqual([]);
  });

  it("sync() with neither inputPath nor dbPath throws", async () => {
    const a = new KuaishouAdapter();
    let threw = null;
    try {
      for await (const _r of a.sync()) {
        /* drain */
      }
    } catch (err) {
      threw = err;
    }
    expect(threw).toBeTruthy();
    expect(String(threw.message)).toMatch(/needs opts\.inputPath/);
  });
});
