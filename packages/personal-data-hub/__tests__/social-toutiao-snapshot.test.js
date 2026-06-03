"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  ToutiaoAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
} = require("../lib/adapters/social-toutiao");
const { validateBatch } = require("../lib/batch");

// §A8 v0.2 — Toutiao snapshot mode tests, mirror of social-douyin-snapshot.
// Snapshot mode is the in-APK Android cc path: ToutiaoLocalCollector reads
// (root + SQLCipher decrypt) the on-device DB and writes a JSON snapshot;
// this adapter's snapshot mode ingests that JSON. v0.2 SURFACE = read /
// collection / search kinds.

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "social-toutiao.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("ToutiaoAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "toutiao-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1 + 4 VALID_SNAPSHOT_KINDS (v0.2.1 adds profile)", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    expect(VALID_SNAPSHOT_KINDS).toEqual([
      "profile",
      "read",
      "collection",
      "search",
    ]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new ToutiaoAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new ToutiaoAdapter();
    const res = await a.authenticate({
      inputPath: path.join(tmpDir, "missing.json"),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with neither inputPath nor dbPath returns NO_INPUT", async () => {
    const a = new ToutiaoAdapter();
    const res = await a.authenticate({});
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("NO_INPUT");
  });

  it("authenticate() sqlite mode without account.uid returns NO_ACCOUNT_UID", async () => {
    const a = new ToutiaoAdapter({ dbPath: "/no/such/path.db" });
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
    const a = new ToutiaoAdapter();
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
    const a = new ToutiaoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("v0.2 profile event normalizes to person-self with toutiao-uid identifier", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      account: { uid: "99999", displayName: "alice" },
      events: [
        {
          kind: "profile",
          id: "profile-99999",
          capturedAt: now - 500,
          uid: "99999",
          nickname: "alice",
          avatarUrl: "https://p.toutiao.com/u/alice.jpg",
          description: "hi there",
          followingCount: 12,
          followerCount: 34,
          mediaId: "media-1",
        },
      ],
    });
    const a = new ToutiaoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("profile");
    expect(raws[0].originalId).toMatch(/^toutiao:profile:/);

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    // KIND_PROFILE produces a person record (not an event)
    expect(batch.events.length).toBe(0);
    expect(batch.persons.length).toBe(1);
    const person = batch.persons[0];
    expect(person.id).toBe("person-toutiao-99999");
    expect(person.subtype).toBe("self");
    expect(person.names).toEqual(["alice"]);
    expect(person.identifiers["toutiao-uid"]).toEqual(["99999"]);
    expect(person.identifiers["toutiao-media-id"]).toEqual(["media-1"]);
    expect(person.extra.platform).toBe("toutiao");
    expect(person.extra.avatarUrl).toBe("https://p.toutiao.com/u/alice.jpg");
    expect(person.extra.description).toBe("hi there");
    expect(person.extra.followingCount).toBe(12);
    expect(person.extra.followerCount).toBe(34);
    expect(person.source.capturedBy).toBe("api");
  });

  it("read event round-trips normalize cleanly (BROWSE subtype)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      account: { uid: "12345", displayName: "alice" },
      events: [
        {
          kind: "read",
          id: "read-i-1",
          capturedAt: now - 1000,
          itemId: "i-1",
          title: "5G 商用进展",
          category: "tech",
          author: "TechCN",
          readDuration: 120,
          source: "首页推荐",
        },
      ],
    });
    const a = new ToutiaoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("read");
    expect(raws[0].originalId).toMatch(/^toutiao:read:/);

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events.length).toBe(1);
    const ev = batch.events[0];
    expect(ev.subtype).toBe("browse");
    expect(ev.content.title).toBe("5G 商用进展");
    expect(ev.extra.itemId).toBe("i-1");
    expect(ev.extra.category).toBe("tech");
    expect(ev.extra.author).toBe("TechCN");
    expect(ev.extra.readDuration).toBe(120);
    expect(ev.extra.platform).toBe("toutiao");
    expect(ev.source.capturedBy).toBe("api");
  });

  it("collection event round-trips normalize cleanly (LIKE subtype)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        {
          kind: "collection",
          id: "collect-i-2",
          capturedAt: now - 2000,
          itemId: "i-2",
          title: "深度长文",
          category: "investigation",
          author: "FinanceCN",
        },
      ],
    });
    const a = new ToutiaoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events[0].subtype).toBe("like");
    expect(batch.events[0].content.title).toBe("深度长文");
    expect(batch.events[0].extra.itemId).toBe("i-2");
    expect(batch.events[0].extra.category).toBe("investigation");
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
          id: "search-rust:1700002000",
          capturedAt: now - 3000,
          keyword: "Rust 语言",
        },
      ],
    });
    const a = new ToutiaoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events[0].subtype).toBe("post");
    expect(batch.events[0].content.title).toBe("Rust 语言");
    expect(batch.events[0].extra.kind).toBe("search");
    expect(batch.events[0].extra.keyword).toBe("Rust 语言");
  });

  it("respects per-kind include opt-out", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "read", id: "r1", capturedAt: now, itemId: "i-1", title: "t1" },
        { kind: "collection", id: "c1", capturedAt: now, itemId: "i-2", title: "t2" },
        { kind: "search", id: "s1", capturedAt: now, keyword: "kw" },
      ],
    });
    const a = new ToutiaoAdapter();
    const raws = [];
    for await (const r of a.sync({
      inputPath: p,
      include: { collection: false, search: false },
    })) {
      raws.push(r);
    }
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("read");
  });

  it("respects opts.limit", async () => {
    const now = Date.now();
    const events = [];
    for (let i = 0; i < 10; i++) {
      events.push({
        kind: "read",
        id: `r${i}`,
        capturedAt: now - i * 1000,
        itemId: `i-${i}`,
        title: `t${i}`,
      });
    }
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new ToutiaoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, limit: 3 })) raws.push(r);
    expect(raws.length).toBe(3);
  });

  it("filters out unknown kinds (forward compat)", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "read", id: "r1", capturedAt: now, itemId: "i-1", title: "t1" },
        { kind: "future-kind", id: "x", capturedAt: now },
        { kind: "subscription", id: "sub-1", capturedAt: now }, // v0.3 hypothetical
      ],
    });
    const a = new ToutiaoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("read");
  });

  it("snapshottedAt fallback when event capturedAt missing", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [{ kind: "read", id: "r1", itemId: "i-1", title: "t1" }],
    });
    const a = new ToutiaoAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });

  it("sqlite mode throws when account.uid missing at sync time", async () => {
    const a = new ToutiaoAdapter();
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
    const a = new ToutiaoAdapter({
      account: { uid: "u-1" },
      dbPath: "/no/such/path.db",
    });
    const raws = [];
    for await (const r of a.sync()) raws.push(r);
    expect(raws).toEqual([]);
  });

  it("sync() with neither inputPath nor dbPath throws", async () => {
    const a = new ToutiaoAdapter();
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
