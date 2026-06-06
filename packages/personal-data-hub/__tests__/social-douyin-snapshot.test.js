"use strict";

import { describe, it, expect, beforeEach } from "vitest";

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const {
  DouyinAdapter,
  SNAPSHOT_SCHEMA_VERSION,
  VALID_SNAPSHOT_KINDS,
} = require("../lib/adapters/social-douyin");
const { validateBatch } = require("../lib/batch");

// §A8 v0.2 — Douyin snapshot mode tests, mirror of social-weibo-snapshot.
//
// Snapshot mode is in-APK Android cc reading JSON written by
// DouyinLocalCollector (WebView cookie + 1 endpoint `passport/account/info/v2/`
// that works without X-Bogus). v0.2 SURFACE = profile kind only;
// history/favourite/like kinds are reserved in VALID_SNAPSHOT_KINDS for v0.3
// (X-Bogus path).

function writeSnapshot(dir, snapshot) {
  const p = path.join(dir, "social-douyin.json");
  fs.writeFileSync(p, JSON.stringify(snapshot), "utf-8");
  return p;
}

describe("DouyinAdapter snapshot mode", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "douyin-snap-"));
  });

  it("exports SNAPSHOT_SCHEMA_VERSION = 1 + 6 VALID_SNAPSHOT_KINDS", () => {
    expect(SNAPSHOT_SCHEMA_VERSION).toBe(1);
    // Forward-compat list (lib index.js): profile/history/favourite/like from
    // v0.2/v0.3, plus message/contact added in Phase 2a (3c5126401, _im.db pull).
    expect(VALID_SNAPSHOT_KINDS).toEqual([
      "profile",
      "history",
      "favourite",
      "like",
      "message",
      "contact",
    ]);
  });

  it("authenticate(inputPath) ok when readable", async () => {
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: Date.now(),
      events: [],
    });
    const a = new DouyinAdapter();
    const res = await a.authenticate({ inputPath: p });
    expect(res.ok).toBe(true);
    expect(res.mode).toBe("snapshot-file");
  });

  it("authenticate(inputPath) fails when path unreadable", async () => {
    const a = new DouyinAdapter();
    const res = await a.authenticate({ inputPath: path.join(tmpDir, "missing.json") });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("INPUT_PATH_UNREADABLE");
  });

  it("authenticate() with neither inputPath nor dbPath returns NO_INPUT", async () => {
    const a = new DouyinAdapter();
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
    const a = new DouyinAdapter();
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
    const a = new DouyinAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(0);
  });

  it("profile event round-trips normalize cleanly", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      account: {
        secUid: "MS4wLjABAAAA_alice",
        shortId: "12345678",
        displayName: "alice",
      },
      events: [
        {
          kind: "profile",
          id: "profile-MS4wLjABAAAA_alice",
          capturedAt: now - 1000,
          secUid: "MS4wLjABAAAA_alice",
          shortId: "12345678",
          nickname: "alice",
          signature: "hello world",
          followingCount: 100,
          followerCount: 200,
          awemeCount: 5,
          favoritingCount: 30,
          totalFavorited: 1500,
        },
      ],
    });
    const a = new DouyinAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("profile");
    expect(raws[0].originalId).toMatch(/^douyin:profile:/);

    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    // v0.2 emits a person record (self) not an event — repeated syncs
    // dedupe on the same id.
    expect(batch.events.length).toBe(0);
    expect(batch.persons.length).toBe(1);
    const person = batch.persons[0];
    expect(person.id).toBe("person-douyin-MS4wLjABAAAA_alice");
    expect(person.subtype).toBe("self");
    expect(person.names).toEqual(["alice"]);
    expect(person.identifiers["douyin-sec-uid"]).toEqual(["MS4wLjABAAAA_alice"]);
    expect(person.identifiers["douyin-short-id"]).toEqual(["12345678"]);
    expect(person.extra.platform).toBe("douyin");
    expect(person.extra.signature).toBe("hello world");
    expect(person.extra.followerCount).toBe(200);
    expect(person.extra.awemeCount).toBe(5);
    expect(person.extra.totalFavorited).toBe(1500);
    expect(person.source.capturedBy).toBe("api");
  });

  it("respects per-kind include opt-out", async () => {
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        { kind: "profile", id: "profile-X", capturedAt: now, secUid: "X", nickname: "x" },
      ],
    });
    const a = new DouyinAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p, include: { profile: false } })) {
      raws.push(r);
    }
    expect(raws.length).toBe(0);
  });

  it("respects opts.limit", async () => {
    // v0.2 unlikely to emit more than 1 profile, but verify the gate is wired.
    const now = Date.now();
    const events = [
      { kind: "profile", id: "p1", capturedAt: now, secUid: "X1", nickname: "x1" },
      // simulate forward-compat: a v0.3 snapshot with history events
      { kind: "history", id: "h1", capturedAt: now - 1000, awemeId: "A1", title: "t1" },
      { kind: "history", id: "h2", capturedAt: now - 2000, awemeId: "A2", title: "t2" },
    ];
    const p = writeSnapshot(tmpDir, { schemaVersion: 1, snapshottedAt: now, events });
    const a = new DouyinAdapter();
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
        { kind: "profile", id: "p1", capturedAt: now, secUid: "X", nickname: "x" },
        { kind: "future-kind", id: "x", capturedAt: now },
        { kind: "search", id: "s", capturedAt: now }, // search is sqlite-only
      ],
    });
    const a = new DouyinAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("profile");
  });

  it("snapshottedAt fallback when event capturedAt missing", async () => {
    const ts = 1700000000000;
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: ts,
      events: [
        { kind: "profile", id: "p1", secUid: "X", nickname: "x" },
      ],
    });
    const a = new DouyinAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws[0].capturedAt).toBe(ts);
  });

  it("v0.3 forward-compat: history events round-trip if a future snapshot ships them", async () => {
    // The Kotlin LocalCollector won't emit these in v0.2, but the JS adapter
    // already knows how to ingest them — so when v0.3 lands we won't have to
    // bump SNAPSHOT_SCHEMA_VERSION.
    const now = Date.now();
    const p = writeSnapshot(tmpDir, {
      schemaVersion: 1,
      snapshottedAt: now,
      events: [
        {
          kind: "history",
          id: "history-A1",
          capturedAt: now - 1000,
          awemeId: "A1",
          title: "future video",
          author: "creator",
          duration: 30,
        },
      ],
    });
    const a = new DouyinAdapter();
    const raws = [];
    for await (const r of a.sync({ inputPath: p })) raws.push(r);
    expect(raws.length).toBe(1);
    expect(raws[0].kind).toBe("history");
    const batch = a.normalize(raws[0]);
    expect(validateBatch(batch).valid).toBe(true);
    expect(batch.events[0].subtype).toBe("browse");
    expect(batch.events[0].extra.awemeId).toBe("A1");
    expect(batch.events[0].extra.duration).toBe(30);
  });
});
